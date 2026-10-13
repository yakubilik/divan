#!/usr/bin/env python3
"""Chats archive themselves after going quiet, and come back when anything happens.

    python scripts/test_autoarchive.py

A real `Server` over a temporary `DIVAN_HOME`; no network and no model turns
(the provider is a stand-in that answers at once). The promises:

  1. The sweep archives a chat whose `updated_at` is past `auto_archive_h`
     (24 by default), and leaves alone one that is younger, one that is pinned,
     and one that is running or waiting on an approval. Every chat it archives
     is announced as `chat.updated` with `archived` set, and none is deleted.
  2. `auto_archive_h = 0` is off: nothing is archived however old.
  3. `chat.autoarchive` reads the threshold, writes a new one to config.toml,
     and refuses nonsense.
  4. A message sent into an archived chat, and the daemon's own ustabasi 🔔
     note posted into one by the ticket follower, unarchive it — announced
     before the message itself.
"""
from __future__ import annotations

import asyncio
import atexit
import os
import shutil
import sys
import tempfile
import time
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-autoarchive-")
os.environ["DIVAN_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import config as configmod                            # noqa: E402
from divan import ustabasi as ustabasimod                        # noqa: E402
from divan.config import Config                                  # noqa: E402
from divan.providers.base import TurnResult                      # noqa: E402
from divan.server import Server                                  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


class FakeProvider:
    """A CLI that answers every turn at once."""

    async def steer(self, prompt, attachments=None):
        return False

    async def run(self, prompt, attachments=None):
        return TurnResult(session_id="sess-1", cost_usd=None, usage=None, duration_ms=1, num_turns=1)

    def has_pending(self):
        return False

    async def interrupt(self):
        pass

    async def close(self):
        pass


def aged(srv: Server, title: str, hours: float, **fields) -> str:
    """A chat that last moved `hours` ago."""
    chat = srv.db.create_chat(title=title, provider="claude", model="sonnet",
                              perm_mode="ask", cwd=HOME)
    with srv.db._lock:
        srv.db._c.execute("UPDATE chats SET updated_at=? WHERE id=?",
                          (time.time() - hours * 3600, chat["id"]))
        for k, v in fields.items():
            srv.db._c.execute(f"UPDATE chats SET {k}=? WHERE id=?", (v, chat["id"]))
        srv.db._c.commit()
    return chat["id"]


def archived(srv: Server, cid: str) -> int:
    return srv.db.get_chat(cid)["archived"]


def fake_session(srv: Server, cid: str) -> None:
    s = srv.sessions.get(cid)
    s._make_provider = lambda chat: FakeProvider()


async def sweep(srv: Server, heard: list[dict]) -> None:
    print("\nthe sweep")
    ids = {
        "old": aged(srv, "quiet for 25h", 25),
        "young": aged(srv, "quiet for 23h", 23),
        "pinned": aged(srv, "pinned, 25h", 25, pinned=1),
        "running": aged(srv, "running, 25h", 25, status="running"),
        "waiting": aged(srv, "awaiting approval, 25h", 25, status="awaiting_approval"),
    }
    before = srv.db.get_chat(ids["old"])["updated_at"]
    check(srv.cfg.auto_archive_h == 24, "the threshold is 24 hours by default", repr(srv.cfg.auto_archive_h))
    heard.clear()
    got = await srv.archive_quiet()
    check([c["id"] for c in got] == [ids["old"]], "the sweep archives exactly the 25h-old idle chat",
          repr([c["title"] for c in got]))
    check(archived(srv, ids["old"]) == 1, "the 25h-old, unpinned, idle chat has archived=1")
    for k in ("young", "pinned", "running", "waiting"):
        check(archived(srv, ids[k]) == 0, f"the {k} chat is left alone")
    check(srv.db.get_chat(ids["old"])["updated_at"] == before,
          "archiving keeps updated_at, so the archive still says when the chat last moved")
    told = [e for e in heard if e["event"] == "chat.updated" and e["chat_id"] == ids["old"]]
    check(len(told) == 1 and told[0]["data"]["archived"] == 1,
          "the clients are told with chat.updated carrying archived=1", repr(heard))
    check(srv.db.get_chat(ids["old"]) is not None and all(srv.db.get_chat(i) for i in ids.values()),
          "nothing is deleted")
    check(ids["old"] in [c["id"] for c in srv.db.list_chats(True)]
          and ids["old"] not in [c["id"] for c in srv.db.list_chats()],
          "the archived chat is in the full list and out of the default one")

    # A live session that is busy is not archived even if its row lags behind.
    lag = aged(srv, "busy session, row says idle", 30)
    fake_session(srv, lag)
    srv.sessions.get(lag).is_busy = lambda: True
    await srv.archive_quiet()
    check(archived(srv, lag) == 0, "a chat whose session is busy is skipped even with an idle row")
    srv.sessions.get(lag).is_busy = lambda: False
    await srv.sessions.drop(lag)

    # A second sweep finds nothing new and says nothing.
    heard.clear()
    again = await srv.archive_quiet()
    check([c["id"] for c in again] == [lag] and not [e for e in heard if e["chat_id"] == ids["old"]],
          "once its session is idle it goes too, and an archived chat is not announced again",
          repr([c["title"] for c in again]))


async def threshold(srv: Server, dev) -> None:
    print("\nthe threshold")
    off = aged(srv, "ancient", 24 * 400)
    got = await srv.h_chat_autoarchive(dev, {"hours": 0})
    check(got == {"hours": 0}, "chat.autoarchive sets 0", repr(got))
    check(tomllib.loads(configmod.CONFIG_PATH.read_text()).get("auto_archive_h") == 0,
          "0 is written to config.toml")
    check(await srv.archive_quiet() == [] and archived(srv, off) == 0,
          "with the threshold at 0 the sweep archives nothing, however old the chat")
    check(Config.load().auto_archive_h == 0, "a daemon started on that config has the sweep off")

    got = await srv.h_chat_autoarchive(dev, {})
    check(got == {"hours": 0}, "chat.autoarchive with no hours only reads", repr(got))
    for bad in (-1, "soon", 24 * 366):
        try:
            await srv.h_chat_autoarchive(dev, {"hours": bad})
            check(False, f"hours={bad!r} is refused")
        except Exception as exc:
            check(getattr(exc, "code", None) == "bad_hours", f"hours={bad!r} is refused", repr(exc))
    got = await srv.h_chat_autoarchive(dev, {"hours": 48})
    check(got == {"hours": 48} and tomllib.loads(configmod.CONFIG_PATH.read_text())["auto_archive_h"] == 48,
          "48 is answered and written down", repr(got))
    check(archived(srv, off) == 1, "turning it back on sweeps at once")
    young = aged(srv, "quiet for 30h", 30)
    await srv.archive_quiet()
    check(archived(srv, young) == 0, "a 30h-old chat stays under a 48h threshold")
    await srv.h_chat_autoarchive(dev, {"hours": 24})


async def unarchive(srv: Server, dev, heard: list[dict]) -> None:
    print("\nunarchiving")
    # 1 · a person sends into it
    cid = aged(srv, "sent into", 40)
    await srv.archive_quiet()
    check(archived(srv, cid) == 1, "the chat starts archived")
    fake_session(srv, cid)
    heard.clear()
    await srv.h_chat_send(dev, {"chat_id": cid, "text": "back to this one"})
    await srv.sessions.get(cid).running
    check(archived(srv, cid) == 0, "sending a message into an archived chat sets archived=0")
    order = [(e["event"], (e.get("data") or {}).get("archived")) for e in heard if e["chat_id"] == cid]
    first_user = next((i for i, (ev, _) in enumerate(order) if ev == "message.user"), -1)
    check(order and order[0] == ("chat.updated", 0) and first_user > 0,
          "the phone hears chat.updated with archived=0 before the message itself", repr(order[:4]))

    # 2 · the daemon posts the ticket follower's 🔔 note into it
    cid = aged(srv, "filed a ticket", 40)
    await srv.archive_quiet()
    check(archived(srv, cid) == 1, "the filing chat starts archived")
    fake_session(srv, cid)
    note = {"ticket": 220, "kind": "done", "title": "Auto-archive", "ask": "", "body": "merged",
            "chat": cid}
    real = (ustabasimod.newest_notification, ustabasimod.followed, Server.FOLLOW_STATE,
            Server.FOLLOW_EVERY_S)
    served = []

    def followed(after):
        served.append(after)
        return ([note], 1) if len(served) == 1 else ([], 1)

    ustabasimod.newest_notification = lambda: 0
    ustabasimod.followed = followed
    Server.FOLLOW_STATE = Path(HOME) / "follow.json"
    Server.FOLLOW_EVERY_S = 0.05
    heard.clear()
    task = asyncio.create_task(srv.follow_tickets())
    try:
        for _ in range(100):
            if any(e["event"] == "message.user" and e["chat_id"] == cid for e in heard):
                break
            await asyncio.sleep(0.02)
    finally:
        task.cancel()
        (ustabasimod.newest_notification, ustabasimod.followed, Server.FOLLOW_STATE,
         Server.FOLLOW_EVERY_S) = real
    running = srv.sessions.get(cid).running
    if running:
        await running
    said = [e for e in heard if e["event"] == "message.user" and e["chat_id"] == cid]
    check(said and said[0]["data"]["text"].startswith("🔔 ustabasi #220"),
          "the ticket follower posted its note into the chat", repr(said))
    check(archived(srv, cid) == 0, "the daemon's 🔔 note sets archived=0")
    check(any(e["event"] == "chat.updated" and e["chat_id"] == cid and e["data"]["archived"] == 0
              for e in heard), "and the clients are told")

    # 3 · any other event the daemon writes into it, and nothing for a live chat
    cid = aged(srv, "a turn error", 40)
    await srv.archive_quiet()
    s = srv.sessions.get(cid)
    await s.emit("turn.error", {"message": "x"}, True)
    check(archived(srv, cid) == 0, "an event the daemon writes into an archived chat unarchives it")
    heard.clear()
    await s.emit("turn.error", {"message": "y"}, True)
    check(not [e for e in heard if e["event"] == "chat.updated"],
          "an event in a chat that is not archived announces no chat.updated")
    srv.db.update_chat(cid, archived=1)
    await s.emit("text.delta", {"text": "z"}, False)
    check(archived(srv, cid) == 1, "a delta that is not written down does not unarchive")


async def main() -> None:
    cfg = Config.load()
    dev, _ = cfg.add_device("Yakup iPhone")
    srv = Server(Config.load())
    heard: list[dict] = []
    real = srv.broadcast

    async def broadcast(ev: dict) -> None:
        heard.append(ev)
        await real(ev)

    srv.broadcast = broadcast
    srv.sessions.broadcast = broadcast
    await sweep(srv, heard)
    await threshold(srv, dev)
    await unarchive(srv, dev, heard)
    await srv.sessions.close_all()


if __name__ == "__main__":
    asyncio.run(main())
    print()
    if failures:
        print(f"{len(failures)} failed")
        sys.exit(1)
    print("all ok")
