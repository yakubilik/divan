"""Plane's board, and the queue behind it.

Every Plane work item says who does it with one of two labels: `ustabaşı`
(the queue's agents) or `insan` (a person). The panel will not save a new one
without either (`plane_gateway.LOCK_JS`); this is what the labels mean.

  - An `ustabaşı` item moved to In Progress is filed with the queue, exactly as
    dragging a coding card into In Progress on Divan's own board was: its title,
    its description as the goal, the product's first repository. The ticket's
    number goes on the item (`external_source = ustabasi`, `external_id = N`)
    and a comment says so. An item that already carries a number is not filed
    twice.
  - An `insan` item moved anywhere is left alone.
  - An item with neither label moved to In Progress goes back to Todo, with a
    comment saying why: nobody has said who does it.
  - A ticket the queue finishes moves its item to Done; one it cancels, to
    Cancelled; one that blocks or fails gets a comment, once per status.

Plane is polled rather than told: its webhooks will not call a private
address, and a daemon on a laptop has no other kind. Each pass asks each
mapped project for what changed since the last one, newest first, and stops
at the first item it has already seen.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import time
from pathlib import Path
from typing import Callable

import httpx

log = logging.getLogger("divan.plane.sync")

BOT = "ustabaşı"
HUMAN = "insan"
SOURCE = "ustabasi"
EVERY_S = 20.0
KEY_SERVICE = "rac-secret-plane-api"


def _text(desc_html: str | None) -> str:
    """A work item's description, as the plain paragraphs a goal is."""
    s = re.sub(r"</(p|li|h\d|blockquote)>|<br\s*/?>", "\n", desc_html or "", flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return "\n".join(line.strip() for line in s.splitlines() if line.strip())


def who(labels: list[str]) -> str | None:
    # Turkish casing: "İnsan" lowers to "i̇nsan" in Python, not "insan".
    names = {str(n).strip().replace("İ", "i").replace("I", "ı").lower() for n in labels}
    if BOT in names:
        return "bot"
    if HUMAN in names:
        return "human"
    return None


def spec_for(item: dict, repo: str) -> dict:
    """The queue's `add` input for a work item (divan.ticket_spec's shape)."""
    from .divan import METHOD_CONSTRAINTS
    title = str(item.get("name") or "").strip()
    goal = _text(item.get("description_html")) or title
    return {"title": title, "repo": repo, "base_branch": "main",
            "card": {"goal": goal, "done_criteria": [title], "verify_cmd": None,
                     "constraints": list(METHOD_CONSTRAINTS), "allowed": []}}


class PlaneSync:
    def __init__(self, cfg, repos_for: Callable[[str], list[str]],
                 is_allowed: Callable[[str], bool], state_path: Path,
                 key: Callable[[], str | None] | None = None,
                 add: Callable | None = None, status_of: Callable | None = None,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self.cfg = cfg
        self.repos_for = repos_for
        self.is_allowed = is_allowed
        self.state_path = state_path
        self._key = key or self._keychain
        from . import ustabasi as u
        self._add = add or u.add
        self._status_of = status_of or _queue_status
        self.state = self._load()
        self._states: dict[str, dict[str, str]] = {}   # project id -> state name -> id
        self._labels: dict[str, dict[str, str]] = {}   # project id -> label id -> name
        self._groups: dict[str, str] = {}               # state id -> group

    # ── what is kept between passes ───────────────────────────────────────
    def _load(self) -> dict:
        try:
            d = json.loads(self.state_path.read_text())
            if isinstance(d, dict):
                d.setdefault("seen", {}); d.setdefault("filed", {})
                return d
        except (OSError, ValueError):
            pass
        return {"seen": {}, "filed": {}}

    def _save(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state))
        tmp.replace(self.state_path)

    @staticmethod
    def _keychain() -> str | None:
        from . import secret_share
        return secret_share.read(KEY_SERVICE)

    # ── Plane ─────────────────────────────────────────────────────────────
    def _client(self) -> httpx.AsyncClient | None:
        base = str(self.cfg.plane.get("url") or "").rstrip("/")
        ws = str(self.cfg.plane.get("workspace") or "").strip("/")
        key = self._key()
        if not base or not ws or not key:
            return None
        return httpx.AsyncClient(base_url=f"{base}/api/v1/workspaces/{ws}/",
                                 headers={"X-API-Key": key}, timeout=20.0,
                                 transport=self._transport)

    async def _meta(self, c, pid: str) -> None:
        if pid not in self._states:
            r = await c.get(f"projects/{pid}/states/"); r.raise_for_status()
            self._states[pid] = {s["name"]: s["id"] for s in r.json()["results"]}
            self._groups.update({s["id"]: s["group"] for s in r.json()["results"]})
        r = await c.get(f"projects/{pid}/labels/"); r.raise_for_status()
        self._labels[pid] = {x["id"]: x["name"] for x in r.json()["results"]}

    async def _changed(self, c, pid: str) -> list[dict]:
        """Items updated since the last pass over this project, newest first."""
        since = self.state["seen"].get(pid)
        if since is None:  # the first pass only learns where "now" is
            r = await c.get(f"projects/{pid}/issues/", params={"per_page": 1, "order_by": "-updated_at"})
            r.raise_for_status()
            res = r.json()["results"]
            self.state["seen"][pid] = res[0]["updated_at"] if res else ""
            return []
        out, cursor = [], None
        for _ in range(20):
            params = {"per_page": 50, "order_by": "-updated_at"}
            if cursor:
                params["cursor"] = cursor
            r = await c.get(f"projects/{pid}/issues/", params=params); r.raise_for_status()
            j = r.json()
            fresh = [i for i in j["results"] if i["updated_at"] > since]
            out += fresh
            if len(fresh) < len(j["results"]) or not j.get("next_page_results"):
                break
            cursor = j.get("next_cursor")
        if out:
            self.state["seen"][pid] = out[0]["updated_at"]
        return out

    async def _comment(self, c, pid: str, iid: str, text: str) -> None:
        await c.post(f"projects/{pid}/issues/{iid}/comments/",
                     json={"comment_html": f"<p>{html.escape(text)}</p>"})

    # ── one pass ──────────────────────────────────────────────────────────
    async def run_once(self) -> dict:
        c = self._client()
        if c is None:
            return {"skipped": "no plane or no key"}
        done = {"filed": 0, "returned": 0, "closed": 0}
        async with c:
            for slug, pid in (self.cfg.plane.get("projects") or {}).items():
                try:
                    await self._project(c, slug, str(pid), done)
                except httpx.HTTPError as e:
                    log.warning("plane sync %s: %s", slug, e)
            await self._back(c, done)
        self._save()
        return done

    async def _project(self, c, slug: str, pid: str, done: dict) -> None:
        items = await self._changed(c, pid)
        if not items:
            return
        await self._meta(c, pid)
        states = self._states[pid]
        for it in items:
            if self._groups.get(it.get("state")) != "started":
                continue
            labels = [self._labels[pid].get(x, "") for x in it.get("labels") or []]
            kind = who(labels)
            if kind == "human":
                continue
            if kind is None:
                await c.patch(f"projects/{pid}/issues/{it['id']}/", json={"state": states.get("Todo")})
                await self._comment(c, pid, it["id"],
                    "Kim yapacak belli değil: önce “ustabaşı” ya da “insan” etiketini seç, sonra In Progress’e çek.")
                done["returned"] += 1
                continue
            if it.get("external_source") == SOURCE and it.get("external_id") or it["id"] in self.state["filed"]:
                continue
            repos = self.repos_for(slug)
            if not repos or not self.is_allowed(repos[0]):
                await self._comment(c, pid, it["id"], "Bu ürünün çalışılacak bir reposu yok; ustabaşı başlatamadı.")
                continue
            try:
                n = await self._add(spec_for(it, repos[0]))
            except (ValueError, OSError) as e:
                await self._comment(c, pid, it["id"], f"Ustabaşı kuyruğa almadı: {e}")
                continue
            self.state["filed"][it["id"]] = {"project": pid, "ticket": n, "said": "queued"}
            await c.patch(f"projects/{pid}/issues/{it['id']}/",
                          json={"external_source": SOURCE, "external_id": str(n)})
            await self._comment(c, pid, it["id"], f"Ustabaşı kuyruğa aldı: #{n}.")
            done["filed"] += 1

    async def _back(self, c, done: dict) -> None:
        """What the queue did with what was filed from here."""
        for iid, f in list(self.state["filed"].items()):
            status = self._status_of(int(f["ticket"]))
            if not status or status == f.get("said"):
                continue
            pid = f["project"]
            if pid not in self._states:
                await self._meta(c, pid)
            target = {"done": "Done", "cancelled": "Cancelled"}.get(status)
            if target:
                await c.patch(f"projects/{pid}/issues/{iid}/", json={"state": self._states[pid].get(target)})
                await self._comment(c, pid, iid, f"Ustabaşı #{f['ticket']}: {'bitti' if status == 'done' else 'iptal edildi'}.")
                del self.state["filed"][iid]
                done["closed"] += 1
                continue
            if status in ("blocked", "failed"):
                await self._comment(c, pid, iid,
                    f"Ustabaşı #{f['ticket']} {'takıldı' if status == 'blocked' else 'başarısız oldu'}; Divan'daki ticket sayfasına bak.")
            f["said"] = status

    async def loop(self) -> None:
        while True:
            try:
                await self.run_once()
            except Exception:  # noqa: BLE001 - one bad pass must not end the loop
                log.exception("plane sync pass failed")
            await asyncio.sleep(EVERY_S)


def _queue_status(ticket_id: int) -> str | None:
    from . import ustabasi as u
    if not u.available():
        return None
    with u._connect() as conn:
        row = conn.execute("SELECT status FROM tickets WHERE id=?", (int(ticket_id),)).fetchone()
    return row["status"] if row else None
