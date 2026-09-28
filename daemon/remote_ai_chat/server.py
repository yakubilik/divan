"""FastAPI + WebSocket server. One JSON protocol, see docs/PROTOCOL.md."""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
import platform
import shutil
import subprocess
import sys
import time
from urllib.parse import unquote
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import __version__
from .supervisor import supervisor
from .updater import Updater
from .config import Config, DB_PATH, UPLOAD_DIR, Device
from .db import DB
from . import accounts as acct
from . import pool as poolmod
from .errors import Err
from . import agents, tools
from .call import Concierge, headline as call_headline, snapshot as call_snapshot
from .push import send_push
from .transcribe import transcribe, available as transcribe_available
from .attachments import KINDS, normalize_image, sniff
from .security import PathPolicy
from . import screen as screenmod
from . import ustabasi as ustabasimod
from .session import NEW_CHAT_TITLE, PROVIDER_FIELDS, PROVIDERS, SessionManager, with_project
from .providers.codex import live_models as codex_live_models

log = logging.getLogger("rac.server")

# The upload is handed to the agent as a path, so there is no allowlist: a
# .pptx, a .zip or a .docx the agent could read perfectly well is just "file".
# The media kinds live in attachments.py, next to the other direction.

# Notification bodies, keyed by the UI language a device reported at `hello`.
# Only English is written here; a device that asks for a language this table
# does not carry is answered in English rather than refused.
PUSH_TEXT = {
    "en": {"approval": "Approval pending", "done": "Task finished"},
}

# How far a client may fall behind before it is cut loose, and how long one
# write may take before the socket counts as gone.
#
# A phone in a pocket, a laptop that slept, a NAT that dropped an idle flow:
# the socket still reads OPEN on both ends and a write into it blocks until the
# OS gives up, which is minutes. Broadcasting straight onto the sockets meant
# one such client stopped the whole house — every other device stopped
# receiving, and because the turn itself awaits its own events, the running
# turn stopped with it. That is the stream that "cuts off" in the middle of a
# long turn. So every client gets a queue and a writer of its own, and a client
# that cannot keep up is closed rather than waited for: it reconnects and asks
# for what it missed, which is a round trip, not a dead chat.
OUTBOX_MAX = 1024
SEND_TIMEOUT_S = 20.0

# ── git status (for the panel) ───────────────────────────────────────────────
# The panel's project grid shows a branch, a dirty count and a last commit for
# every folder. `host.projects` does not carry that: the phone's folder picker
# would have to wait on 60 git calls for 19 folders. It is a separate request
# instead, answered from a thread pool behind a short-lived cache.
_GIT_TTL = 20.0
_git_cache: dict[str, tuple[float, dict]] = {}


def _git_info(path: str) -> dict:
    now = time.time()
    hit = _git_cache.get(path)
    if hit and now - hit[0] < _GIT_TTL:
        return hit[1]

    def run(*args: str) -> str | None:
        try:
            r = subprocess.run(("git", "-C", path, *args), capture_output=True,
                               text=True, timeout=3)
        except Exception:
            return None
        return r.stdout.strip() if r.returncode == 0 else None

    inside = run("rev-parse", "--is-inside-work-tree")
    if inside != "true":
        info = {"is_git": False}
    else:
        status = run("status", "--porcelain") or ""
        dirty = [ln for ln in status.splitlines() if ln.strip()]
        last = run("log", "-1", "--format=%s%x1f%an%x1f%ct")
        subject = author = None
        committed = None
        if last:
            bits = last.split("\x1f")
            subject = bits[0] if bits else None
            author = bits[1] if len(bits) > 1 else None
            try:
                committed = float(bits[2]) if len(bits) > 2 else None
            except ValueError:
                committed = None
        info = {
            "is_git": True,
            "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
            "dirty": len(dirty),
            "staged": sum(1 for ln in dirty if ln[:1] not in (" ", "?")),
            "untracked": sum(1 for ln in dirty if ln.startswith("??")),
            "subject": subject,
            "author": author,
            "committed_at": committed,
        }
    _git_cache[path] = (now, info)
    return info


class Server:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.db = DB(DB_PATH)
        self.policy = PathPolicy(cfg.allowed_roots, cfg.denied_paths)
        self.sessions = SessionManager(self.db, cfg, self.broadcast, self.notify,
                                       resolve_account=self._resolve_account_home,
                                       agent_prompt=self._agent_prompt,
                                       pool_pick=self._pool_pick,
                                       pool_next=self._pool_next_for)
        self.clients: dict[WebSocket, Device] = {}
        # One queue per connected client, drained by that client's own writer.
        self.outbox: dict[WebSocket, asyncio.Queue[str]] = {}
        self.writers: dict[WebSocket, asyncio.Task] = {}
        self.accounts: dict[str, acct.Account] = {}
        self.logins: dict[str, acct.LoginSession] = {}
        self._installing: str | None = None
        # account id -> window -> last reported usage of the plan's limits,
        # reloaded from disk so a restart does not blank the ring out.
        self.limits: dict[str, dict[str, dict]] = self.db.load_limits()
        # Several sign-ins of one tool, driven as one. It reads the two
        # dictionaries above rather than keeping copies: an account is added or
        # a window fills, and the pool is already looking at the new answer.
        self.pool = poolmod.Pool(poolmod.Settings.from_dict(cfg.pool),
                                 lambda: self.accounts, self._limit_rows)
        # Sweeps in flight. Held onto because a task nobody references can be
        # collected mid-await, and this one is moving chats between accounts.
        self._sweeps: set[asyncio.Task] = set()
        # Every computer follows origin/main on its own. Set when an update has
        # been staged and the supervisor should take it from here.
        self.restart_requested = asyncio.Event()
        # Set while the daemon is waiting for its turns to finish so it can
        # stop without killing them. New turns are refused for as long as it
        # is: a restart that keeps accepting work never arrives.
        self.draining: dict | None = None
        self._drain: asyncio.Task | None = None
        # A restart is the one event this daemon cannot watch itself have: the
        # process that would report it is the process that ended. So it is
        # counted on the way back in, and the count outlives every one of them.
        self.started = time.time()
        self.restarts = int(self.db.meta_get("restarts", 0) or 0) + 1
        self.db.meta_set("restarts", self.restarts)
        self.db.meta_set("started_at", self.started)
        self.updater = Updater(
            cfg,
            # Queued messages count: they would be dropped by the restart an
            # update ends with, and the phone was already told they landed.
            is_idle=lambda: self.sessions.pending_count() == 0,
            announce=self._announce_update,
            request_restart=lambda: self.begin_restart("update"),
            record=lambda entry: self.db.meta_set("last_update", entry),
            last_update=self.db.meta_get("last_update"),
        )
        self._load_accounts()
        self.failed_auth: dict[str, list[float]] = {}
        self.app = FastAPI(title="remote-ai-chat")
        self._allow_cross_origin()
        self.app.websocket("/ws")(self.ws_endpoint)
        self.app.get("/health")(lambda: {"ok": True, "version": __version__})
        self.app.post("/upload")(self.upload)
        self.app.get("/files")(self.files)
        # Frames go over HTTP rather than the socket: a phone draws one with
        # <Image> and a browser with <img>, and neither wants base64 in a
        # websocket frame five times a second.
        self.app.get("/screen.jpg")(self.screen_jpg)
        self._mount_panel()
        self._versions: dict | None = None
        self._codex_models: list[dict] | None = None
        self._codex_models_task: asyncio.Task | None = None
        # The voice concierge. Built here but not connected — the CLI only
        # starts when somebody actually asks it something.
        self.concierge = Concierge(self.call_snapshot, self._concierge_account,
                                   self._concierge_actions())

    def _allow_cross_origin(self) -> None:
        """Let a browser talk to a daemon that did not serve the page.

        The socket never needed this — WebSocket is not subject to the same
        origin rule — so everything the panel does over `/ws` worked, and the
        one thing it does over HTTP did not: dragging a file onto a chat sends
        `Authorization` with the POST, which makes the browser ask permission
        first, and nothing here answered the question. The answer is "failed to
        fetch", with no status code and nothing in the daemon's log, because the
        upload was never sent. That is every drop from `npm run dev`, and every
        drop onto a chat belonging to a second paired computer — the panel is
        served by one of them and talks to all of them.

        Any origin may ask, because asking is not the same as being answered:
        every route is guarded by a device token carried in a header, never by a
        cookie, so a page that does not have one gets the 401 it deserves.
        `allow_credentials` stays off for the same reason — there is no ambient
        credential here to attach, and leaving it on would forbid the wildcard.
        """
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            # A file fetched for a download carries the name to save it under.
            expose_headers=["Content-Disposition"],
            max_age=600,
        )

    def _mount_panel(self) -> None:
        """Serve the desktop panel, when it has been built.

        Mounted last and at "/", so /ws, /health, /upload and /files still win —
        FastAPI matches routes in registration order. The bundle itself holds no
        secret: it asks for a token like any other client, so handing it to
        anyone who can reach the port costs nothing.
        """
        panel = Path(__file__).parent / "webui"
        if not (panel / "index.html").exists():
            return
        from fastapi.staticfiles import StaticFiles

        class Panel(StaticFiles):
            """The same files, with the caching said out loud.

            Starlette sends an ETag and a Last-Modified and no `Cache-Control`,
            and a browser given that is entitled to guess how long the page
            stays fresh — it guesses from the file's age, so the longer a panel
            goes unchanged the longer a new one takes to appear. That is how an
            updated daemon comes to serve a rebuilt panel to a browser quietly
            running last week's, with a hard reload as the only cure and nothing
            on screen to suggest it.

            `index.html` is the only file that has to be re-read to find the
            rest, so it is the only one that must never be cached. Everything
            under /assets/ is content-hashed by vite — a new build is a new
            filename — so those can be kept forever, which is what makes the
            uncached page cheap.
            """

            def file_response(self, full_path, stat_result, scope, status_code=200):
                r = super().file_response(full_path, stat_result, scope, status_code)
                name = Path(str(full_path)).name
                if "/assets/" in str(full_path).replace("\\", "/"):
                    r.headers["cache-control"] = "public, max-age=31536000, immutable"
                elif name in ("index.html", "build.json"):
                    r.headers["cache-control"] = "no-store, must-revalidate"
                else:
                    r.headers["cache-control"] = "no-cache"
                return r

        self.app.mount("/", Panel(directory=str(panel), html=True), name="panel")

    # ── tools (CLI kurulumu) ───────────────────────────────────────────────
    async def h_tool_status(self, dev: Device, d: dict) -> dict:
        tools.forget()
        return {"tools": [{"provider": p, "version": tools.version(p),
                           "path": tools.find_cli(p),
                           "login_methods": acct.methods_for(p)} for p in ("claude", "codex")],
                "npm": tools.npm_available()}

    async def h_tool_install(self, dev: Device, d: dict, ws: WebSocket) -> dict:
        provider = d.get("provider", "")
        if provider not in tools.PACKAGES:
            raise Err("unknown_tool", "unknown tool")
        if self._installing:
            raise Err("install_running", "an installation is already running")
        if tools.find_cli(provider) and not d.get("force"):
            return {"provider": provider, "version": tools.version(provider), "already": True}

        async def out(line: str) -> None:
            await self.send_to(ws, {"type": "event", "event": "tool.install.output",
                                    "chat_id": None, "seq": None,
                                    "data": {"provider": provider, "line": line},
                                    "ts": time.time()})

        self._installing = provider
        try:
            res = await tools.install(provider, out)
        except Exception as exc:
            await out(f"\n{exc}\n")
            raise
        finally:
            self._installing = None
        self._versions = None                      # host.info reports the new version
        await self.broadcast({"seq": None, "chat_id": None, "event": "host.status",
                              "data": self.host_info(), "ts": time.time()})
        return res

    # ── accounts ───────────────────────────────────────────────────────────
    def _load_accounts(self) -> None:
        self.accounts = {a.id: a for a in acct.default_accounts()}
        for aid, raw in (self.cfg.accounts or {}).items():
            try:
                self.accounts[aid] = acct.Account(id=aid, **raw)
            except Exception as exc:
                log.warning("skipping stored account %s: %s", aid, exc)

    def _save_accounts(self) -> None:
        # TOML has no null: a field without a value is left out, not written.
        self.cfg.accounts = {
            a.id: {k: v for k, v in
                   {"provider": a.provider, "label": a.label, "home": a.home,
                    "created_at": a.created_at, "imported": a.imported,
                    "api_key": a.api_key}.items() if v is not None}
            for a in self.accounts.values() if a.home
        }
        self.cfg.save()

    def _agent_prompt(self, chat: dict) -> str | None:
        aid = chat.get("agent_id")
        if not aid:
            return None
        home = self._account(chat.get("account_id"), chat["provider"]).home
        if aid == agents.CREATOR_ID:
            return agents.builtin(home)["prompt"]
        a = agents.find(aid, home, chat.get("cwd"))
        return agents.body(a["path"]) if a else None

    async def h_agent_list(self, dev: Device, d: dict) -> dict:
        home = self._account(d.get("account_id"), d.get("provider", "claude")).home
        cwd = d.get("cwd") or None
        items = await asyncio.to_thread(agents.listing, home, cwd)
        return {"agents": items}

    async def h_agent_store(self, dev: Device, d: dict) -> dict:
        items = await asyncio.to_thread(agents.store, str(d.get("source") or ""))
        return {"sources": items}

    async def h_agent_install(self, dev: Device, d: dict) -> dict:
        home = self._account(d.get("account_id"), d.get("provider", "claude")).home
        r = await asyncio.to_thread(agents.install, str(d.get("id") or ""), home)
        log.warning("agent installed: %s from %s by %s", r["name"], r["source"], dev.name)
        return r

    async def h_agent_remove(self, dev: Device, d: dict) -> dict:
        home = self._account(d.get("account_id"), d.get("provider", "claude")).home
        ok = await asyncio.to_thread(agents.uninstall, str(d.get("name") or ""), home)
        if not ok:
            raise Err("agent_not_removable", "that agent is not one this app installed")
        return {"removed": True}

    def _resolve_account_home(self, chat: dict) -> tuple[str | None, dict[str, str]]:
        """Where the account keeps its login, and the environment that carries
        it — an account signed in with a key has nothing on disk to point at."""
        a = self._account(chat.get("account_id"), chat["provider"])
        return a.home, a.env()

    def _account(self, account_id: str | None, provider: str) -> acct.Account:
        """Resolve a chat's account. A missing id is refused rather than falling
        back to the machine login — silently using the wrong subscription is the
        exact failure this feature exists to prevent."""
        if not account_id:
            return self.accounts[acct.DEFAULT_ID + "-" + provider]
        a = self.accounts.get(account_id)
        if a is None:
            raise Err("account_gone", "that account was removed")
        if a.provider != provider:
            raise Err("account_provider", "that account belongs to a different tool")
        return a

    # ── fan-out ────────────────────────────────────────────────────────────
    def _remember_limits(self, event: dict) -> str | None:
        """Keep the last word on every plan window, on disk as well as in
        memory. A report only arrives while a turn is running, so what was
        remembered is all there is to show between turns — and after a restart
        it is all there is to show at all, until someone sends a message."""
        d = event.get("data") or {}
        chat = self.db.get_chat(event.get("chat_id") or "") or {}
        key = chat.get("account_id") or acct.DEFAULT_ID + "-" + (chat.get("provider") or "claude")
        rows = d.get("windows")
        # Whether this is the plan's whole answer or only the window the tool
        # singled out. Only the provider knows, so only the provider says: a
        # one-window list is indistinguishable from a complete list of one.
        complete = bool(d.get("windows_complete"))
        if not isinstance(rows, list) or not rows:
            # A provider that reports a single window, or a report from before
            # the daemon learned to read them all.
            rows = [{k: d.get(k) for k in ("window", "status", "utilization", "resets_at")}] \
                if d.get("window") else []
            complete = False
        now = time.time()
        # Overage is a property of the account, not of any one window, so every
        # row carries it and the app can read it off whichever row it shows.
        shared = {k: d.get(k) for k in
                  ("overage_status", "overage_resets_at", "overage_disabled_reason", "is_using_overage")
                  if d.get(k) is not None}
        kept = [{**shared, **r, "at": now} for r in rows if isinstance(r, dict) and r.get("window")]
        if not kept:
            return None
        slot = self.limits.setdefault(key, {})
        self._learn_steps(slot, kept)
        for r in kept:
            slot[str(r["window"])] = r
        if complete:
            # Everything the plan has, as of now. A window that is not in it is
            # a window the tool has stopped having — an overage allowance that
            # was spent, a plan that changed — and keeping the last number
            # anybody saw for it means showing a full ring for days.
            fresh = {str(r["window"]) for r in kept}
            for gone in [w for w in slot if w not in fresh]:
                log.info("%s no longer reports %s — dropping it", key, gone)
                del slot[gone]
        try:
            self.db.save_limits(key, kept, now, complete=complete)
        except Exception as e:
            log.warning("could not write down the plan's limits: %s", e)
        return key

    @staticmethod
    def _learn_steps(previous: dict[str, dict], kept: list[dict]) -> None:
        """How far a window can move between two readings of it.

        The only thing the daemon cannot see is what happens between reports,
        and this is the measurement of it: the biggest jump one window has ever
        made on this account. A margin that size is the difference between
        stopping before the line and noticing after it. It is carried forward
        rather than recomputed, because the worst case is what matters and it
        may not happen again for days; a window rolling over is a drop, not a
        jump, and is ignored.
        """
        for r in kept:
            old = previous.get(str(r.get("window"))) or {}
            was, now_ = old.get("utilization"), r.get("utilization")
            step = old.get("step")
            if isinstance(was, (int, float)) and isinstance(now_, (int, float)) and now_ > was:
                jump = float(now_) - float(was)
                step = jump if not isinstance(step, (int, float)) else max(float(step), jump)
            if isinstance(step, (int, float)):
                r["step"] = step

    def limits_for(self, account_id: str | None, provider: str = "claude") -> list[dict]:
        return self._limit_rows(account_id or acct.DEFAULT_ID + "-" + provider)

    def _limit_rows(self, key: str) -> list[dict]:
        return sorted(self.limits.get(key, {}).values(), key=lambda x: str(x.get("window")))

    async def h_limits_get(self, dev: Device, d: dict) -> dict:
        return {"accounts": {k: sorted(v.values(), key=lambda x: str(x.get("window")))
                             for k, v in self.limits.items()}}

    # ── the pool ───────────────────────────────────────────────────────────
    async def h_pool_get(self, dev: Device, d: dict) -> dict:
        """What the pool is set to, and where every sign-in stands under it."""
        return {"settings": self.pool.settings.to_dict(),
                "accounts": self.pool.states(d.get("provider"))}

    async def h_pool_set(self, dev: Device, d: dict) -> dict:
        """Change the pool. Only the keys that were sent move, so the phone can
        flip the switch without having to know the rest of the settings."""
        raw = {**self.pool.settings.to_dict(),
               **{k: v for k, v in d.items()
                  if k in ("enabled", "threshold", "thresholds", "use_overage",
                           "overage_by_account", "reserve", "order", "max_hops")}}
        self.pool.settings = poolmod.Settings.from_dict(raw)
        self.cfg.pool = self.pool.settings.to_dict()
        self.cfg.save()
        await self.broadcast({"seq": None, "chat_id": None, "event": "pool.updated",
                              "data": {"settings": self.cfg.pool,
                                       "accounts": self.pool.states()}, "ts": time.time()})
        return {"settings": self.cfg.pool, "accounts": self.pool.states()}

    async def _pool_pick(self, chat: dict) -> str | None:
        """Which sign-in should this chat's next turn open on?

        None means "the one it is already on" — the answer for every chat while
        the pool is off, for a chat pinned to its account on purpose, and for
        one whose account still has room. Only a blocked account produces a
        move, and only to a sign-in that is actually signed in.

        The pool being on is the whole opt-in: a mode, not a per-chat setting
        anybody has to remember. `pool_pinned` is the way out of it, for the
        chat that has to stay on one sign-in.
        """
        if not self.pool.settings.enabled or chat.get("pool_pinned"):
            return None
        provider = chat.get("provider") or "claude"
        current = chat.get("account_id") or acct.DEFAULT_ID + "-" + provider
        if not self.pool.state(current, provider).blocked:
            return None
        return await self._pool_next(provider, {current})

    async def _pool_next_for(self, chat: dict) -> str | None:
        """Where a chat whose turn has just been stopped should carry on.

        Split from `_pool_pick` because it is asked at a different moment and
        answers a different question: the decision to move has already been
        made and acted on, and all that is left is where to.
        """
        if not self.pool.settings.enabled or chat.get("pool_pinned"):
            return None
        provider = chat.get("provider") or "claude"
        current = chat.get("account_id") or acct.DEFAULT_ID + "-" + provider
        return await self._pool_next(provider, {current})

    async def _pool_next(self, provider: str, exclude: set[str]) -> str | None:
        """The next sign-in worth moving to, confirmed to still be signed in.

        The pool ranks accounts on what their plans last reported. Whether a
        sign-in is still valid is a different question and only the CLI can
        answer it, at the cost of a subprocess — so it is asked of candidates
        one at a time, best first, and only when somebody is about to be moved.
        """
        for aid in self.pool.candidates(provider, exclude)[:self.pool.settings.max_hops]:
            a = self.accounts.get(aid)
            if a is None:
                continue
            try:
                await asyncio.to_thread(acct.refresh, a)
            except Exception:
                continue
            if a.logged_in:
                return aid
        return None

    def _sessions_on(self, account_key: str) -> list:
        """Every running chat on this sign-in that the pool may move."""
        out = []
        for cid, s in list(self.sessions.sessions.items()):
            if not s.is_busy():
                continue
            chat = self.db.get_chat(cid) or {}
            if chat.get("pool_pinned"):
                continue
            provider = chat.get("provider") or "claude"
            if self.pool.key(chat.get("account_id"), provider) == account_key:
                out.append(s)
        return out

    async def _pool_sweep(self, account_key: str) -> None:
        """A window just filled. Take every running chat off this sign-in.

        The report arrives on one chat's turn, but the limit belongs to the
        account, so every chat on it is equally out of plan. The idle ones are
        caught later, by `_pool_pick`, when their next turn opens; these are the
        ones that cannot wait, because they are mid-sentence.
        """
        try:
            a = self.accounts.get(account_key)
            if a is None or not self.pool.state(account_key, a.provider).blocked:
                return
            live = self._sessions_on(account_key)
            if not live:
                return
            # Stop first, choose afterwards. Working out where a chat goes next
            # means asking the CLI whether that sign-in is still signed in, and
            # that is a subprocess — half a second in which the model is still
            # generating on a plan that has already run out. When the user has
            # said not to spend past the plan, that half second is the whole
            # thing we are here to prevent. The session asks for itself, once
            # the model has actually stopped.
            for s in live:
                await s.handover(None, "limit")
        except Exception:
            log.exception("the pool could not move a chat off %s", account_key)

    # ── stopping on purpose ────────────────────────────────────────────────
    # Killing the process is not a restart, it is a crash somebody chose. Each
    # chat's CLI is a child of this process, so every turn in flight dies with
    # it and a half-written answer is simply gone. Draining is the difference:
    # stop taking work, let what is running finish, then leave. The supervisor
    # (launchd with KeepAlive, start.ps1 on Windows) brings the daemon back on
    # the new code within seconds, and the clients reconnect on their own.

    # Long enough for the clients to be back on their sockets, so they watch
    # the turn start again instead of finding it already under way.
    RESUME_DELAY_S = 3.0

    async def resume_interrupted(self) -> None:
        """Carry on with the turns the process before this one was running.

        A restart used to end every turn in flight with a line telling the
        phone to send its message again. The message is already on disk and the
        session it was asked in can be resumed, so nobody needs telling: the
        work starts itself.
        """
        plans = list(getattr(self.db, "to_resume", None) or [])
        if not plans:
            return
        await asyncio.sleep(self.RESUME_DELAY_S)
        for plan in plans:
            cid = plan["chat_id"]
            try:
                sess = self.sessions.get(cid)
            except KeyError:
                continue                      # the chat was deleted meanwhile
            try:
                await sess.resume(plan["messages"])
                log.info("picked up the interrupted turn in %s (%d message(s))",
                         cid, len(plan["messages"]))
            except Exception:
                # The note the old process could not write. Better a chat that
                # says what happened than one that silently never answers.
                log.warning("could not pick up %s again", cid, exc_info=True)
                self.db.close_interrupted_turn(cid)

    DRAIN_TIMEOUT_S = 180
    DRAIN_POLL_S = 1.0

    def begin_restart(self, reason: str, force: bool = False,
                      timeout: float | None = None) -> dict:
        """Start draining, or stop now if there is nothing to wait for.

        Returns straight away with what it decided — the caller is on a socket
        this process is about to close, so there is no later in which to
        answer.
        """
        if self.draining:
            return {"ok": True, "already": True, **self.draining}
        pending = self.sessions.pending()
        deadline = time.time() + (timeout if timeout is not None else self.DRAIN_TIMEOUT_S)
        self.draining = {"reason": reason, "since": time.time(), "deadline": deadline,
                         "force": bool(force), "pending": pending}
        self._drain = asyncio.create_task(self._drain_then_stop())
        return {"ok": True, "draining": not force and bool(pending),
                "pending": pending, "deadline": deadline, "reason": reason}

    async def _drain_then_stop(self) -> None:
        state = self.draining or {}
        force, deadline = state.get("force"), state.get("deadline", 0.0)
        # Only say "draining" when there is something to drain. An idle daemon
        # that flashes it for a fifth of a second teaches a client to distrust
        # the word.
        if not force and state.get("pending"):
            await self._announce_drain("draining")
        last = -1
        while not force:
            pending = self.sessions.pending()
            if not pending:
                break
            if len(pending) != last:
                # Only when the number moves. A client watching this does not
                # need a message a second saying the same thing.
                self.draining = {**state, "pending": pending}
                await self._announce_drain("draining")
                last = len(pending)
            if time.time() >= deadline:
                # Giving up is the safe answer. "The restart did not happen,
                # this chat is still working" is recoverable; killing somebody
                # mid-turn is not, and nobody asked for that when they asked
                # for a restart.
                log.warning("restart abandoned: %d chat(s) still working", len(pending))
                self.draining = {**state, "pending": pending}
                await self._announce_drain("cancelled")
                self.draining, self._drain = None, None
                return
            await asyncio.sleep(self.DRAIN_POLL_S)

        try:
            self.db.meta_set("last_restart", {
                "at": time.time(), "reason": state.get("reason"),
                "forced": bool(force),
                "abandoned_chats": [p["chat_id"] for p in self.sessions.pending()],
            })
        except Exception:
            log.warning("could not write down the restart", exc_info=True)
        await self._announce_drain("stopping")
        # A beat for that last event to reach the sockets before they close.
        await asyncio.sleep(0.2)
        self.restart_requested.set()

    async def _announce_drain(self, state: str) -> None:
        d = self.draining or {}
        await self.broadcast({"seq": None, "chat_id": None, "event": "daemon.restarting",
                              "data": {"state": state, "reason": d.get("reason"),
                                       "pending": d.get("pending") or [],
                                       "deadline": d.get("deadline"),
                                       "forced": bool(d.get("force"))},
                              "ts": time.time()})

    async def h_daemon_restart(self, dev: Device, d: dict) -> dict:
        """Stop, so the supervisor can start us again on whatever is on disk.

        Refused outright where nothing would bring the process back: that is
        not a restart, it is a shutdown nobody could undo from the phone that
        asked for it. Doubt is not refusal — a platform this daemon cannot read
        goes ahead, because stranding a machine that was fine is the worse of
        the two mistakes.

        `force` waives the waiting, and only that. It kills turns in flight,
        which is why it is not the default; the chats it interrupts are told so
        in their own timelines on the way back up.
        """
        sup = supervisor()
        if sup["supervised"] is False and not d.get("force"):
            raise Err("no_supervisor",
                      f"nothing would start this daemon again — {sup['detail']}")
        return {**self.begin_restart(str(d.get("reason") or "asked for"),
                                     force=bool(d.get("force")),
                                     timeout=d.get("timeout_s")),
                "supervisor": sup}

    async def h_daemon_status(self, dev: Device, d: dict) -> dict:
        """What a restart would cost right now, before anyone asks for one."""
        return {"started_at": self.started, "restarts": self.restarts,
                "uptime_s": int(time.time() - self.started),
                "pending": self.sessions.pending(),
                "draining": self.draining,
                "last_restart": self.db.meta_get("last_restart"),
                "supervisor": supervisor()}

    async def h_daemon_restart_cancel(self, dev: Device, d: dict) -> dict:
        """Changed your mind while it was still waiting."""
        if not self.draining or self.restart_requested.is_set():
            raise Err("not_restarting", "this daemon is not restarting")
        if self._drain:
            self._drain.cancel()
        await self._announce_drain("cancelled")
        self.draining, self._drain = None, None
        return {"ok": True}

    async def _announce_update(self, data: dict) -> None:
        await self.broadcast({"seq": None, "chat_id": None,
                              "event": data.pop("event", "update.available"),
                              "data": data, "ts": time.time()})

    async def h_update_status(self, dev: Device, d: dict) -> dict:
        """Where this computer stands. `refresh` asks the remote, which costs a
        network round trip, so the phone only does it when someone is looking."""
        if d.get("refresh"):
            await self.updater.check()
        return {**self.updater.state, "blockers": self.updater.blockers()}

    async def h_update_apply(self, dev: Device, d: dict) -> dict:
        """Move onto origin/main now. Answers before the restart lands, because
        after it there is no connection left to answer on."""
        await self.updater.check()
        return await self.updater.apply(force=bool(d.get("force")))

    async def broadcast(self, event: dict) -> None:
        if event.get("event") == "limits":
            key = self._remember_limits(event)
            if key and self.pool.settings.enabled:
                task = asyncio.create_task(self._pool_sweep(key))
                self._sweeps.add(task)
                task.add_done_callback(self._sweeps.discard)
        msg = json.dumps({"type": "event", "event": event["event"], "chat_id": event.get("chat_id"),
                          "seq": event.get("seq"), "data": event.get("data"), "ts": event.get("ts")},
                         ensure_ascii=False, default=str)
        for ws in list(self.outbox):
            self._enqueue(ws, msg)

    def _enqueue(self, ws: WebSocket, msg: str) -> None:
        """Hand one message to a client's writer. Never waits on the socket."""
        q = self.outbox.get(ws)
        if q is None:
            return
        if q.qsize() >= OUTBOX_MAX:
            # Hopelessly behind. Closing it is kinder than growing the queue:
            # the client reconnects and replays from its last seq.
            log.warning("client is %s events behind; dropping it", q.qsize())
            self._drop(ws)
            return
        q.put_nowait(msg)

    async def send_to(self, ws: WebSocket, payload: dict) -> None:
        """One message to one client, through that client's queue.

        Replies go the same way as events so the two keep their order: a
        `chat.get` answer that overtook the events it was meant to precede
        would be folded in twice by the client.
        """
        self._enqueue(ws, json.dumps(payload, ensure_ascii=False, default=str))

    def _drop(self, ws: WebSocket) -> None:
        """Let go of a client. Its writer closes the socket on its way out.

        Cancelled rather than asked to stop: the reason a client is dropped is
        usually that its writer is stuck inside a send that will never return,
        and a message on the queue would be read after that send, which is the
        wait we are trying not to do.
        """
        self.clients.pop(ws, None)
        self.outbox.pop(ws, None)
        t = self.writers.pop(ws, None)
        if t is not None:
            t.cancel()

    async def _writer(self, ws: WebSocket, q: "asyncio.Queue[str]") -> None:
        """Drain one client's queue onto its socket, for as long as it lives."""
        try:
            while True:
                msg = await q.get()
                try:
                    await asyncio.wait_for(ws.send_text(msg), timeout=SEND_TIMEOUT_S)
                except asyncio.TimeoutError:
                    log.warning("a client took over %ss to accept a message; dropping it",
                                SEND_TIMEOUT_S)
                    break
                except Exception:
                    break
        except asyncio.CancelledError:
            pass
        finally:
            self.clients.pop(ws, None)
            self.outbox.pop(ws, None)
            self.writers.pop(ws, None)
            try:
                await asyncio.wait_for(ws.close(), timeout=5)
            except BaseException:      # teardown: a cancel here must not hide the exit
                pass

    async def notify(self, kind: str, chat: dict) -> None:
        title = chat.get("title", "Chat")
        for d in self.cfg.devices.values():
            if not d.push_token:
                continue
            if kind == "approval" and d.push_approval:
                body = PUSH_TEXT.get(d.lang, PUSH_TEXT["en"])["approval"]
            elif kind == "done" and d.push_done:
                # Sent to connected phones too. A phone that is looking at this
                # very chat silences it itself — the computer cannot know what
                # is on screen, and staying silent for every open app meant the
                # notification never arrived at all.
                body = PUSH_TEXT.get(d.lang, PUSH_TEXT["en"])["done"]
            else:
                continue
            # Which computer this came from, named by the pairing it was sent
            # to — the same id the phone files that computer under. A phone
            # paired to two computers was otherwise told a chat id and left to
            # guess whose it was, and opened it against whichever one it
            # happened to be connected to, which does not have it.
            await send_push([d.push_token], title, body, {
                "chat_id": chat.get("id"), "kind": kind,
                "device_id": d.id, "host_name": self.cfg.host_name,
            })

    # ── uploads (attachments) ──────────────────────────────────────────────
    async def upload(self, file: UploadFile = File(...), chat_id: str = Form(""), authorization: str = Header(default="")) -> dict:
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        dev = self.cfg.find_device_by_token(token) if token else None
        if dev is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        safe_chat = "".join(c for c in (chat_id or "misc") if c.isalnum())[:32] or "misc"
        # The name arrives percent-encoded. Without decoding it the `%` was then
        # dropped by the filter below and "Screen Shot" reached disk as
        # "Screen20Shot" — the escape read as if it were text.
        name = Path(unquote(file.filename or "file")).name
        stem = "".join(("-" if c in " " else c) for c in Path(name).stem if c.isalnum() or c in " -_")[:40] or "file"
        ext = Path(name).suffix.lower()[:12]
        data = await file.read()
        if len(data) > 100 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="file too large (100MB)")
        # What it is, decided by what is in it. A screenshot shared from another
        # app can arrive with no extension at all, or with the tail of a dotted
        # name ('… 21.48.33') read as one; by the name alone both became "file",
        # and a picture the person can see turned into a grey chip.
        found = sniff(data[:64])
        if found:
            kind, real_ext = found
            if KINDS.get(ext) != kind:
                ext = real_ext
        else:
            kind = KINDS.get(ext, "file")
        target_dir = UPLOAD_DIR / safe_chat
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{int(time.time())}-{stem}{ext}"
        target.write_bytes(data)
        if kind == "image":
            target = normalize_image(target)
        out = {"path": str(target), "name": target.name, "size": target.stat().st_size, "kind": kind,
               "url": f"/files?path={target}"}
        if kind == "audio":
            t = await transcribe(target)
            if t:
                out["transcript"] = t["text"]
        return out

    # ── the screen ─────────────────────────────────────────────────────────
    async def screen_jpg(self, authorization: str = Header(default=""), token: str = Query(default=""),
                         w: int = Query(default=screenmod.MAX_W), q: int = Query(default=screenmod.QUALITY),
                         display: str = Query(default="")):
        """One frame. The token rides as a query parameter for the same reason
        it does on /files: an <img> tag cannot carry a header."""
        tok = authorization[7:].strip() if authorization.lower().startswith("bearer ") else token
        if not tok or self.cfg.find_device_by_token(tok) is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        try:
            data, meta = await screenmod.grab(max(320, min(3840, w)), max(20, min(90, q)),
                                              display or None)
        except screenmod.ScreenError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        return Response(content=data, media_type="image/jpeg", headers={
            # Every frame is a new picture at the same URL, so nothing may keep
            # one. The sizes ride along for a client that wants to lay out
            # before the image has decoded.
            "Cache-Control": "no-store, max-age=0",
            "X-Screen-Width": str(meta["screen_w"]),
            "X-Screen-Height": str(meta["screen_h"]),
            "X-Screen-Display": str(meta.get("display") or ""),
        })

    async def h_screen_info(self, dev: Device, d: dict) -> dict:
        """What this machine can do, and whether it is currently allowed to."""
        return {**screenmod.available(), "enabled": self.cfg.remote_control}

    async def h_screen_enable(self, dev: Device, d: dict) -> dict:
        """Turn control on or off.

        Announced to everybody, not just the device that asked: a computer that
        has just become drivable from a phone is something every other paired
        device deserves to be told, and the one thing this feature must never
        be is quiet.
        """
        on = bool(d.get("enabled"))
        if on and not screenmod.available()["control"]:
            raise Err("unsupported", "clicking is not implemented on this platform yet")
        if on != self.cfg.remote_control:
            self.cfg.remote_control = on
            self.cfg.save()
            log.warning("remote control %s by device %s (%s)",
                        "ENABLED" if on else "disabled", dev.name, dev.id)
            await self.broadcast({"seq": None, "chat_id": None, "event": "host.status",
                                  "data": self.host_info(), "ts": time.time()})
        return {"enabled": self.cfg.remote_control}

    async def h_screen_frame(self, dev: Device, d: dict) -> dict:
        """A frame over the socket. The HTTP route above is the one a client
        should normally draw from; this is here for anything holding a socket
        and nothing else — a check that capture works, mostly."""
        try:
            return await screenmod.grab_b64(int(d.get("width") or screenmod.MAX_W),
                                            int(d.get("quality") or screenmod.QUALITY),
                                            d.get("display") or None)
        except screenmod.ScreenError as exc:
            raise Err("screen_failed", str(exc))

    async def h_screen_input(self, dev: Device, d: dict) -> dict:
        """Move, click, scroll or type. Coordinates are 0..1 across the whole
        desktop, so no client ever has to learn the resolution."""
        if not self.cfg.remote_control:
            raise Err("control_disabled", "remote control is turned off on this computer")
        try:
            display = d.get("display") or None
            for action in (d.get("actions") or [d]):
                await screenmod.act(action, action.get("display") or display)
        except screenmod.ScreenError as exc:
            raise Err("screen_failed", str(exc))
        return {"ok": True}

    async def files(self, path: str = Query(...), authorization: str = Header(default=""), token: str = Query(default=""),
                    download: int = Query(default=0)) -> FileResponse:
        """Serve a file to the phone.

        Two kinds of file come through here: something the phone uploaded
        (images, voice notes — they live under the uploads folder), and
        something the agent wants the person to see — a screenshot it took, a
        PDF it built. The second kind lives wherever the agent put it, so the
        rule is the path policy's: inside an allowed root and not a secret.
        `download=1` asks the browser to save rather than display.
        """
        tok = authorization[7:].strip() if authorization.lower().startswith("bearer ") else token
        if not tok or self.cfg.find_device_by_token(tok) is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        p = Path(path).expanduser().resolve()
        uploaded = UPLOAD_DIR.resolve() in p.parents and p.is_file()
        if not uploaded and not self.policy.is_servable(p):
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(str(p), filename=p.name if download else None)

    # ── auth ───────────────────────────────────────────────────────────────
    def _rate_limited(self, ip: str) -> bool:
        """Whether this address has already failed five times in ten minutes.

        Nothing acts on the answer: the caller only uses it to stop the history
        growing, so this is a count, not a throttle. SECURITY.md says as much
        under "What it does not" — the size of the token is what stands in the
        way of a guesser, and acting on the count is still to be done.
        """
        now = time.time()
        hist = [t for t in self.failed_auth.get(ip, []) if now - t < 600]
        self.failed_auth[ip] = hist
        return len(hist) >= 5

    def _auth(self, ws: WebSocket) -> Device | None:
        ip = ws.client.host if ws.client else "?"
        token = ws.query_params.get("token") or ""
        auth = ws.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        dev = self.cfg.find_device_by_token(token) if token else None
        if dev is not None:
            return dev  # a valid token is always accepted; only failures are counted
        if not self._rate_limited(ip):
            self.failed_auth.setdefault(ip, []).append(time.time())
        return None

    # ── websocket ──────────────────────────────────────────────────────────
    async def ws_endpoint(self, ws: WebSocket) -> None:
        dev = self._auth(ws)
        # Accept first so the client receives a real close frame (4401) instead of HTTP 403.
        await ws.accept()
        if dev is None:
            await ws.close(code=4401, reason="unauthorized")
            return
        self.clients[ws] = dev
        self.outbox[ws] = asyncio.Queue()
        self.writers[ws] = asyncio.create_task(self._writer(ws, self.outbox[ws]))
        dev.last_seen = time.time()
        log.info("device connected: %s (%s)", dev.name, dev.id)
        await self.send_to(ws, {"type": "event", "event": "host.status", "chat_id": None,
                                "seq": None, "data": self.host_info(), "ts": time.time()})
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    req = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                asyncio.create_task(self._dispatch(ws, dev, req))
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            log.warning("ws loop error: %s", exc)
        finally:
            self._drop(ws)
            log.info("device disconnected: %s", dev.name)

    async def _dispatch(self, ws: WebSocket, dev: Device, req: dict) -> None:
        rid = req.get("id")
        typ = req.get("type", "")
        data = req.get("data") or {}
        handler = getattr(self, "h_" + typ.replace(".", "_"), None)
        try:
            if handler is None:
                raise ValueError(f"unknown type: {typ}")
            if "ws" in inspect.signature(handler).parameters:
                result = await handler(dev, data, ws)
            else:
                result = await handler(dev, data)
            out = {"id": rid, "type": "ok", "data": result}
        except Exception as exc:
            log.warning("%s failed: %s", typ, exc)
            out = {"id": rid, "type": "error",
                   "data": {"message": str(exc), "code": getattr(exc, "code", None)}}
        await self.send_to(ws, out)

    # ── handlers ───────────────────────────────────────────────────────────
    async def h_ping(self, dev: Device, d: dict) -> dict:
        """The phone's heartbeat. A protocol-level ping only proves the socket is
        open somewhere in the OS; this proves the app is on the other end and the
        event loop is still serving it, which is what the phone needs to know
        before it decides a quiet connection is a dead one."""
        dev.last_seen = time.time()
        return {"ts": time.time()}

    async def h_hello(self, dev: Device, d: dict) -> dict:
        if d.get("push_token"):
            dev.push_token = d["push_token"]
        # Sent as an empty string when iOS invalidates it, which must clear the
        # stored one: ringing a dead token is a call that never arrives.
        if "voip_token" in d:
            dev.voip_token = d["voip_token"] or None
        if d.get("device_name"):
            dev.name = d["device_name"]
        if d.get("lang") in ("en", "tr"):
            dev.lang = d["lang"]
        self.cfg.save()
        return {"host": self.host_info(), "catalog": await self.catalog_async(),
                "device": {"id": dev.id, "name": dev.name, "push_approval": dev.push_approval,
                           "push_done": dev.push_done, "has_push_token": bool(dev.push_token),
                           "can_be_called": bool(dev.voip_token)}}

    async def h_host_info(self, dev: Device, d: dict) -> dict:
        return self.host_info()

    async def h_device_prefs(self, dev: Device, d: dict) -> dict:
        if "push_approval" in d:
            dev.push_approval = bool(d["push_approval"])
        if "push_done" in d:
            dev.push_done = bool(d["push_done"])
        if "push_token" in d:
            dev.push_token = d["push_token"] or None
        if "voip_token" in d:
            dev.voip_token = d["voip_token"] or None
        self.cfg.save()
        return {"push_approval": dev.push_approval, "push_done": dev.push_done,
                "has_push_token": bool(dev.push_token), "can_be_called": bool(dev.voip_token)}

    async def h_device_revoke_self(self, dev: Device, d: dict) -> dict:
        self.cfg.revoke(dev.id)
        return {}

    async def h_host_models(self, dev: Device, d: dict) -> dict:
        return await self.catalog_async()

    async def h_host_projects(self, dev: Device, d: dict) -> dict:
        return {"projects": self.policy.list_projects(), "roots": self.cfg.allowed_roots}

    async def h_host_git(self, dev: Device, d: dict) -> dict:
        """Git state for the panel's project grid. Read-only, and only for
        folders the path policy already allows a chat to run in."""
        paths = [str(p) for p in (d.get("paths") or [])][:80]
        if not paths:
            paths = [p["path"] for p in self.policy.list_projects()]
        allowed = [p for p in paths if self.policy.is_allowed_cwd(p)]
        results = await asyncio.gather(
            *(asyncio.to_thread(_git_info, p) for p in allowed),
            return_exceptions=True,
        )
        repos = {p: r for p, r in zip(allowed, results) if isinstance(r, dict)}
        return {"repos": repos}

    async def h_group_list(self, dev: Device, d: dict) -> dict:
        return {"groups": self.db.list_groups()}

    async def _groups_changed(self) -> None:
        await self.broadcast({"seq": None, "chat_id": None, "event": "groups.changed",
                              "data": {"groups": self.db.list_groups()}, "ts": time.time()})

    async def h_group_create(self, dev: Device, d: dict) -> dict:
        g = self.db.create_group(str(d.get("name") or "Group").strip()[:60])
        await self._groups_changed()
        return g

    async def h_group_rename(self, dev: Device, d: dict) -> dict:
        self.db.rename_group(d["group_id"], str(d["name"]).strip()[:60])
        await self._groups_changed()
        return {}

    async def h_group_delete(self, dev: Device, d: dict) -> dict:
        self.db.delete_group(d["group_id"])
        await self._groups_changed()
        await self.broadcast({"seq": None, "chat_id": None, "event": "chats.changed",
                              "data": {"chats": self.db.list_chats(True)}, "ts": time.time()})
        return {}

    async def h_chat_list(self, dev: Device, d: dict) -> dict:
        return {"chats": self.db.list_chats(bool(d.get("include_archived"))),
                "groups": self.db.list_groups()}

    async def h_chat_create(self, dev: Device, d: dict) -> dict:
        provider = d.get("provider", "claude")
        if provider not in PROVIDERS:
            raise Err("unknown_provider", "unknown tool")
        cwd = d.get("cwd") or self.cfg.allowed_roots[0]
        if err := self.policy.cwd_error(cwd):
            raise Err(err, "that folder cannot be opened")
        cat = PROVIDERS[provider].catalog()
        agent_id = d.get("agent_id") or None
        model = d.get("model") or cat["models"][0]["id"]
        effort = d.get("effort") or ("high" if cat["efforts"] else None)
        # An agent chat nobody gave a mode opens in `bypass`; any other chat
        # opens in the first mode the tool offers, which is the one that asks.
        # An agent is work handed over — the whole point is not being at the
        # screen for it — and a delegated turn that stops on the first prompt
        # has been stopped, not delegated. An explicit `perm_mode` still wins:
        # this is the default, not an override.
        fallback = "bypass" if agent_id and "bypass" in cat["perm_modes"] else cat["perm_modes"][0]
        perm = d.get("perm_mode") or fallback
        if perm not in cat["perm_modes"]:
            raise Err("unknown_perm_mode", "unknown permission mode")
        account_id = d.get("account_id")
        self._account(account_id, provider)          # raises if unknown/mismatched
        if agent_id and agent_id != agents.CREATOR_ID \
                and not agents.find(agent_id, self._account(account_id, provider).home, cwd):
            raise Err("no_agent", "that agent is not on this computer")
        chat = self.db.create_chat(
            account_id=account_id, agent_id=agent_id, pool_pinned=1 if d.get("pool_pinned") else 0,
            provider=provider, model=model, effort=effort, perm_mode=perm,
            cwd=str(Path(cwd).expanduser().resolve()), group_id=d.get("group_id"),
            title=with_project(d.get("title") or NEW_CHAT_TITLE,
                               self.policy.project_for(cwd)),
            max_turns=d.get("max_turns"), max_budget_usd=d.get("max_budget_usd"),
        )
        await self.broadcast({"seq": None, "chat_id": chat["id"], "event": "chat.created",
                              "data": chat, "ts": time.time()})
        return chat

    async def h_chat_get(self, dev: Device, d: dict) -> dict:
        """A chat's timeline, in at most `limit` events at a time.

        Which end of it depends on what is being asked. `since_seq: 0` is a
        client opening a chat, and it is answered from the *back*: a long chat
        answered from the front handed back its first afternoon and nothing
        since, so the phone showed a conversation that had stopped days ago
        while the panel — fed live, never truncated — showed the real one.
        `truncated` says there is older history above what was sent.

        A `since_seq` is a client catching up after a reconnect, and that is
        answered forward, in order, with `more` set while events remain. A
        client that stops at one page leaves a hole in its own timeline, so it
        keeps asking until `more` is false.
        """
        chat = self.db.get_chat(d["chat_id"])
        if chat is None:
            raise Err("no_chat", "no such chat")
        since = int(d.get("since_seq") or 0)
        limit = max(1, min(2000, int(d.get("limit") or 500)))
        if since <= 0:
            total = self.db.count_events(chat["id"])
            events = self.db.recent_events(chat["id"], limit=limit)
            more, truncated = False, total > len(events)
        else:
            events = self.db.events(chat["id"], since_seq=since, limit=limit + 1)
            more = len(events) > limit
            if more:
                events = events[:limit]
            truncated = False
        pending = []
        s = self.sessions.peek(chat["id"])
        if s:
            pending = list(s.pending.keys())
        return {"chat": chat, "events": events, "pending_approvals": pending,
                "more": more, "truncated": truncated,
                "busy": bool(s and s.is_busy())}

    async def h_chat_update(self, dev: Device, d: dict) -> dict:
        cid = d["chat_id"]
        fields = {k: v for k, v in d.items() if k != "chat_id"}
        if "cwd" in fields:
            if err := self.policy.cwd_error(fields["cwd"]):
                raise Err(err, "that folder cannot be opened")
            # Same canonical form as chat.create (case/slash-insensitive on Windows).
            fields["cwd"] = str(Path(fields["cwd"]).expanduser().resolve())
        if "account_id" in fields:
            current = self.db.get_chat(cid)
            self._account(fields["account_id"], (current or {}).get("provider", "claude"))
            # a resume id belongs to one account's transcript store
            fields["provider_session_id"] = None
        prev = self.db.get_chat(cid)
        if prev is None:
            raise Err("no_chat", "no such chat")
        # A rename keeps the project in front of it, and a chat that moves to
        # another folder takes the new project's name with it — the old prefix
        # is dropped first, or moving a chat twice would stack them.
        moving = fields.get("cwd", prev["cwd"])
        if "title" in fields or "cwd" in fields:
            was = self.policy.project_for(prev["cwd"])
            title = str(fields.get("title", prev["title"]) or "")
            if was and "cwd" in fields:
                head = f"{was} · "
                if title.casefold().startswith(head.casefold()):
                    title = title[len(head):]
            fields["title"] = with_project(title, self.policy.project_for(moving))
        if "provider" in fields and fields["provider"] != prev["provider"]:
            if fields["provider"] not in PROVIDERS:
                raise Err("unknown_provider", "unknown tool")
            # Each tool keeps its own session; remember the old one and restore the new one's.
            ids = json.loads(prev.get("session_ids") or "{}")
            if prev.get("provider_session_id"):
                ids[prev["provider"]] = prev["provider_session_id"]
            fields["provider_session_id"] = ids.get(fields["provider"])
            fields["session_ids"] = json.dumps(ids)
        chat = self.db.update_chat(cid, **fields)
        s = self.sessions.peek(cid)
        if s and PROVIDER_FIELDS & fields.keys():
            await s.reconfigure()
        await self.broadcast({"seq": None, "chat_id": cid, "event": "chat.updated",
                              "data": chat, "ts": time.time()})
        return chat

    async def h_chat_delete(self, dev: Device, d: dict) -> dict:
        cid = d["chat_id"]
        await self.sessions.drop(cid)
        self.db.delete_chat(cid)
        shutil.rmtree(UPLOAD_DIR / "".join(c for c in cid if c.isalnum())[:32], ignore_errors=True)
        await self.broadcast({"seq": None, "chat_id": cid, "event": "chat.deleted",
                              "data": {"id": cid}, "ts": time.time()})
        return {}

    async def h_chat_send(self, dev: Device, d: dict) -> dict:
        text = str(d.get("text") or "").strip()
        if not text:
            raise Err("empty_message", "empty message")
        # Refused rather than queued: the queue is in memory and this process
        # is leaving. Better to say no and keep the message in the composer
        # than to accept it and lose it.
        if self.draining:
            raise Err("restarting", "this computer is restarting — try again in a moment")
        s = self.sessions.get(d["chat_id"])
        queued = await s.send(text, d.get("attachments"))
        return {"accepted": True, "queued": queued}

    async def h_chat_interrupt(self, dev: Device, d: dict) -> dict:
        s = self.sessions.peek(d["chat_id"])
        if s:
            await s.interrupt()
        return {}

    async def h_approval_respond(self, dev: Device, d: dict) -> dict:
        s = self.sessions.peek(d["chat_id"])
        ok = bool(s and s.respond(d["request_id"], d.get("decision", "deny")))
        if not ok:
            raise Err("no_pending_approval", "no pending approval")
        return {}

    # ── the call ───────────────────────────────────────────────────────────
    # A phone call is a different shape of question than a chat. Nobody wants a
    # coding agent read out loud; they want to know whether the thing finished.
    # So the concierge is answered from the daemon's own state, and never waits
    # for a session's turn — see call.py.

    def call_snapshot(self):
        return call_snapshot(self.db, self.sessions, self.cfg.host_name)

    def _concierge_actions(self) -> dict:
        """The four things the concierge may do, as the daemon already does them.

        Each one goes through the same path the phone's own buttons use, so a
        session started by voice is a session like any other: same permission
        mode, same approvals coming back to the phone, same place in the list.
        Nothing here is a shortcut around the session layer."""

        async def send(chat_id: str, text: str) -> bool:
            return await self.sessions.get(chat_id).send(text.strip(), None)

        async def start(project: str, instruction: str) -> str:
            want = project.strip().casefold()
            hits = [p for p in self.policy.list_projects()
                    if p["name"].casefold() == want]
            if not hits:
                hits = [p for p in self.policy.list_projects()
                        if want and want in p["name"].casefold()]
            if not hits:
                raise Err("no_project", f"there is no project called {project}")
            cwd = hits[0]["path"]
            chat = await self.h_chat_create(None, {"cwd": cwd, "title": instruction[:60]})
            await self.sessions.get(chat["id"]).send(instruction.strip(), None)
            return hits[0]["name"]

        async def approve(chat_id: str, allow: bool) -> None:
            s = self.sessions.peek(chat_id)
            if not s or not s.pending:
                raise Err("no_pending_approval", "nothing is waiting there")
            request_id = next(iter(s.pending))
            # Whether it is dangerous is already decided and already written
            # down; read it back rather than judging it again here.
            danger = False
            for ev in self.db.tail_events(chat_id, ("approval.request",), limit=8):
                if (ev["data"] or {}).get("request_id") == request_id:
                    danger = bool((ev["data"] or {}).get("danger"))
                    break
            if danger and allow:
                raise PermissionError(
                    "that one is destructive; it has to be approved in the app")
            s.respond(request_id, "allow" if allow else "deny")

        async def stop(chat_id: str) -> None:
            s = self.sessions.peek(chat_id)
            if s:
                await s.interrupt()

        return {"send": send, "start": start, "approve": approve, "stop": stop}

    def _concierge_account(self) -> tuple[str | None, dict[str, str]]:
        """The concierge speaks as the computer, so it uses the computer's own
        Claude login rather than any one chat's account.

        On a machine where that login was never made — nothing in ~/.claude, and
        every sign-in held under a named account instead — insisting on it gave a
        call that picked up and then answered "not logged in" out loud. Any
        signed-in Claude account is a better answer than none; which subscription
        pays for a status question matters far less than the call working, and
        the concierge never touches a chat's files either way."""
        a = self._account(None, "claude")
        # `logged_in` is only true after a refresh, and this runs once per
        # concierge session rather than per turn, so the cost is paid while the
        # caller is still being greeted.
        acct.refresh(a)
        if not a.logged_in:
            for x in self.accounts.values():
                if x.provider != "claude" or x is a:
                    continue
                acct.refresh(x)
                if x.logged_in:
                    log.info("concierge: no machine login, speaking as account=%s", x.id)
                    a = x
                    break
        return a.home, a.env()

    async def h_call_hello(self, dev: Device, d: dict) -> dict:
        """Picking up the phone.

        Answers off one SQLite read so the greeting is immediate, and starts the
        model session in the background while the caller is being greeted. By
        the time they have finished saying what they want, the session that
        would have cost them five seconds is already open."""
        asyncio.create_task(self.concierge.warm())
        return call_headline(self.db, self.sessions)

    async def h_call_ask(self, dev: Device, d: dict) -> dict:
        text = str(d.get("text") or "").strip()
        if not text:
            raise Err("empty_message", "empty question")
        if d.get("reset"):
            await self.concierge.reset()
        return await self.concierge.ask(text, d.get("lang"))

    async def h_call_digest(self, dev: Device, d: dict) -> dict:
        """The snapshot itself, with no model in the way. Answering a status
        question badly is almost always the snapshot's fault, not the model's,
        and this is how you find out which."""
        return {"digest": self.call_snapshot()[0]}


    # ── accounts ───────────────────────────────────────────────────────────
    async def h_account_list(self, dev: Device, d: dict) -> dict:
        # Each refresh shells out to a CLI, so asking them one after another
        # made the list take as long as the slowest tool times the account count.
        await asyncio.gather(*(asyncio.to_thread(acct.refresh, a) for a in self.accounts.values()))
        order = {"claude": 0, "codex": 1}
        items = sorted(self.accounts.values(), key=lambda a: (order.get(a.provider, 9), a.home is not None, a.created_at))
        return {"accounts": [a.public() for a in items]}

    def _check_label(self, provider: str, label: str, skip: str = "") -> None:
        """Two accounts with the same name on one tool are indistinguishable in
        every picker in the app."""
        want = label.strip().casefold()
        if not want:
            return
        for a in self.accounts.values():
            if a.provider == provider and a.id != skip and a.label.strip().casefold() == want:
                raise Err("duplicate_label", "an account with that name already exists")

    async def h_account_rename(self, dev: Device, d: dict) -> dict:
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        if not a.home:
            raise Err("default_account", "this computer's own account cannot be renamed")
        label = str(d.get("label") or "").strip()[:40]
        if not label:
            raise Err("empty_label", "give the account a name")
        self._check_label(a.provider, label, skip=a.id)
        a.label = label
        self._save_accounts()
        return a.public()

    async def h_account_create(self, dev: Device, d: dict) -> dict:
        label = str(d.get("label") or "").strip()[:40]
        self._check_label(d.get("provider", ""), label)
        a = acct.new_account(d.get("provider", ""), label)
        self.accounts[a.id] = a
        self._save_accounts()
        return a.public()

    async def h_account_login(self, dev: Device, d: dict, ws: WebSocket) -> dict:
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        old = self.logins.pop(a.id, None)
        if old:
            await old.cancel()                      # one live login per account
        live = [s for s in self.logins.values() if not s.done]
        if len(live) >= acct.MAX_LOGINS:
            raise Err("too_many_logins", "too many sign-ins are already in progress")

        async def emit(kind: str, payload: dict) -> None:
            # Only the phone that asked; never written to the event table.
            await self.send_to(ws, {"type": "event", "event": kind, "chat_id": None,
                                    "seq": None, "data": payload, "ts": time.time()})
            if kind == "account.login.done":
                self._save_accounts()

        email = str(d.get("email") or "").strip()[:200]
        method = str(d.get("method") or "").strip() or acct.default_method(a.provider)
        key = str(d.get("api_key") or "").strip()
        log.info("login started account=%s provider=%s method=%s email=%s",
                 a.id, a.provider, method, bool(email))

        # A key is not a browser flow: there is nothing to watch, so it is done
        # here and answered straight away.
        if method == "api_key":
            if not key:
                raise Err("key_required", "paste the key for that sign-in method")
            await self._release_chats(a.id)
            a, ok, why = await asyncio.to_thread(acct.login_with_key, a, key)
            self.accounts[a.id] = a
            self._save_accounts()
            log.info("key sign-in account=%s ok=%s", a.id, ok)
            await emit("account.login.done", {
                "account_id": a.id, "ok": ok, "detail": a.detail,
                "error": None if ok else why, "error_code": None if ok else "bad_key",
                "retryable": not ok,
            })
            return {"started": True, "provider": a.provider, "needs_code": False}

        s = acct.LoginSession(a, emit, email=email, method=method, api_key=key)
        self.logins[a.id] = s
        await s.start()
        return {"started": True, "provider": a.provider, "needs_code": s.needs_code}

    async def h_account_login_submit(self, dev: Device, d: dict) -> dict:
        s = self.logins.get(d.get("account_id", ""))
        if s is None or s.done:
            raise Err("no_pending_login", "no sign-in is waiting for a code")
        await s.submit_code(str(d.get("code") or ""))
        return {}

    async def h_account_login_cancel(self, dev: Device, d: dict) -> dict:
        s = self.logins.pop(d.get("account_id", ""), None)
        if s:
            await s.cancel()
        return {}

    async def h_account_export(self, dev: Device, d: dict) -> dict:
        """Hand this account's stored sign-in to the phone so it can be moved to
        another computer. The blob is a bearer credential: the app keeps it in
        memory for one transfer and never writes it to disk. The phone calls
        account.forget here once the destination has verified it — two computers
        cannot share one login, the refresh token is single-use."""
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        await asyncio.to_thread(acct.refresh, a)
        if not a.logged_in:
            raise Err("no_credentials", "that account is not signed in on this computer")
        blob = await asyncio.to_thread(acct.export_credentials, a)
        log.warning("sign-in exported: account=%s provider=%s device=%s",
                    a.id, a.provider, dev.name)
        return {"provider": a.provider, "label": a.label, "detail": a.detail, "credentials": blob}

    async def h_account_import(self, dev: Device, d: dict) -> dict:
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        blob = d.get("credentials")
        await self._release_chats(a.id)
        a = await asyncio.to_thread(acct.import_credentials, a, blob)
        self._save_accounts()
        log.warning("sign-in imported: account=%s provider=%s device=%s",
                    a.id, a.provider, dev.name)
        # `auth status` reads a local file, so it would call a revoked token
        # healthy. Ask the tool to actually reach the service before saying yes.
        ok, why = await asyncio.to_thread(acct.verify_signed_in, a)
        return {**a.public(), "verified": ok, "verify_error": None if ok else why}

    async def h_account_forget(self, dev: Device, d: dict) -> dict:
        """Clear this computer's copy of a sign-in that was moved elsewhere.
        Local only: a real sign-out would revoke the token the other computer
        is now using."""
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        await self._release_chats(a.id)
        await asyncio.to_thread(acct.forget_credentials, a)
        log.warning("sign-in moved away: account=%s provider=%s device=%s",
                    a.id, a.provider, dev.name)
        return a.public()

    async def h_account_logout(self, dev: Device, d: dict) -> dict:
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        await self._release_chats(a.id)
        await asyncio.to_thread(acct.logout, a)
        return a.public()

    async def h_account_delete(self, dev: Device, d: dict) -> dict:
        a = self.accounts.get(d.get("account_id", ""))
        if a is None:
            raise Err("account_gone", "that account was removed")
        if not a.home:
            raise Err("default_account", "this computer's own account cannot be removed")
        await self._release_chats(a.id)
        s = self.logins.pop(a.id, None)
        if s:
            await s.cancel()
        await asyncio.to_thread(acct.delete_account_dir, a)
        self.accounts.pop(a.id, None)
        self._save_accounts()
        return {}

    # ── the ustabasi wall ──────────────────────────────────────────────────
    async def h_ustabasi_list(self, dev: Device, d: dict) -> dict:
        """The ticket queue, for the panel's second wall. Reading someone
        else's SQLite file is a blocking read, so it goes to a thread."""
        return await asyncio.to_thread(ustabasimod.snapshot)

    async def h_ustabasi_note(self, dev: Device, d: dict) -> dict:
        """Answer a ticket that stopped to ask. The only write this daemon
        makes to that queue, and it goes through the queue's own CLI."""
        try:
            tid = int(d.get("id"))
        except (TypeError, ValueError):
            raise Err("bad_ticket", "no such ticket")
        try:
            return await ustabasimod.note(tid, str(d.get("text") or ""))
        except ValueError as exc:
            raise Err("ustabasi_refused", str(exc))

    async def _release_chats(self, account_id: str) -> None:
        """Free every chat bound to this account: a running turn is interrupted,
        the CLI session is dropped and the binding cleared — a resume id from one
        account is meaningless under another."""
        for chat in self.db.list_chats(include_archived=True):
            if chat.get("account_id") != account_id:
                continue
            live = self.sessions.peek(chat["id"])
            if live and live.is_busy():
                await live.interrupt()
            await self.sessions.drop(chat["id"])
            updated = self.db.update_chat(chat["id"], account_id=None, provider_session_id=None)
            await self.broadcast({"seq": None, "chat_id": chat["id"], "event": "chat.updated",
                                  "data": updated, "ts": time.time()})

    # ── info ───────────────────────────────────────────────────────────────
    def catalog(self) -> dict:
        cat = {name: cls.catalog() for name, cls in PROVIDERS.items()}
        if self._codex_models:
            cat["codex"]["models"] = self._codex_models
        return cat

    async def catalog_async(self) -> dict:
        """Static catalog, plus Codex's live model list once it has been fetched.
        The fetch runs at most once per daemon lifetime and never blocks hello for long."""
        if self._codex_models is None and self._codex_models_task is None:
            self._codex_models_task = asyncio.create_task(codex_live_models())
        if self._codex_models_task and not self._codex_models_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._codex_models_task), timeout=3)
            except Exception:
                pass
        if self._codex_models_task and self._codex_models_task.done() and self._codex_models is None:
            try:
                self._codex_models = self._codex_models_task.result()
            except Exception:
                self._codex_models = None
            if self._codex_models is None:
                self._codex_models_task = None  # retry on a later call
        return self.catalog()

    def host_info(self) -> dict:
        if self._versions is None:
            self._versions = {p: tools.version(p) for p in ("claude", "codex")}
        return {
            "name": self.cfg.host_name, "os": platform.system(), "os_version": _os_version(),
            "daemon_version": __version__, "uptime_s": int(time.time() - self.started),
            # The version above is a constant that ships with the package and
            # says the same thing on every computer. These are what is actually
            # running here: a commit, and a version counted from the last tag.
            "revision": self.updater.state.get("local"),
            "release": self.updater.state.get("release"),
            "started_at": self.started, "restarts": self.restarts,
            "draining": bool(self.draining),
            "last_update": self.updater.state.get("last_update"),
            "update": {k: self.updater.state.get(k) for k in
                       ("behind", "ahead", "auto", "repo", "error", "checked_at",
                        "web", "latest")},
            "screen": {**screenmod.available(), "enabled": self.cfg.remote_control},
            "active_sessions": self.sessions.active_count(),
            "connected_devices": len(self.clients),
            "versions": self._versions, "roots": self.cfg.allowed_roots,
            "transcription": transcribe_available(),
            "npm": tools.npm_available(),
            # Every device is told, every time it asks and every time it
            # changes. A computer that can be driven from a pocket does not get
            # to be discreet about it.
        }

    async def reaper(self) -> None:
        while True:
            await asyncio.sleep(60)
            try:
                await self.sessions.reap_idle()
            except Exception as exc:
                log.warning("reaper: %s", exc)


def _os_version() -> str:
    if sys.platform == "darwin":
        return platform.mac_ver()[0] or platform.release()
    if sys.platform == "win32":
        return platform.version()          # "10.0.26200" (release() says "10" on Windows 11)
    return platform.release()


def _ver(cmd: list[str]) -> str | None:
    exe = shutil.which(cmd[0])          # resolves .cmd/.exe shims on Windows
    if not exe:
        return None
    try:
        r = subprocess.run([exe, *cmd[1:]], capture_output=True, text=True, timeout=5)
        return (r.stdout or r.stderr).strip().splitlines()[0][:40]
    except Exception:
        return None
