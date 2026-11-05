"""A chat nobody wrote in is deleted an hour after it was opened.

    uv run python -m pytest -q

Yakup, 5 Nov 2026: "boş chat diye bir şey olmasın". The pen makes a chat the
moment it is pressed; one pressed and put down used to stay until auto-archive
moved it to the archive, where it stayed for good. What is guarded here: the
sweep deletes exactly the chats with nothing written in them that are older
than `EMPTY_CHAT_S`, tells every client (`chat.deleted`), and leaves alone a
fresh one, one with a message, one with a preview, a pinned one and a busy one.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-empty-")
os.environ["DIVAN_HOME"] = HOME
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.config import Config  # noqa: E402
from divan.server import Server  # noqa: E402


def make(srv: Server, title: str, age: float, **row) -> str:
    chat = srv.db.create_chat(account_id=None, agent_id=None, pool_pinned=0, provider="claude",
                              model="opus", effort=None, perm_mode="bypass", cwd=HOME, group_id=None,
                              title=title, max_turns=None, max_budget_usd=None, owner=None)
    srv.db._c.execute("UPDATE chats SET created_at=? WHERE id=?", (time.time() - age, chat["id"]))
    srv.db._c.commit()
    if row:
        srv.db.update_chat(chat["id"], **row)
    return chat["id"]


def test_only_old_empty_chats_are_deleted():
    srv = Server(Config.load())
    told: list[dict] = []

    async def hear(msg):
        told.append(msg)
    srv.broadcast = hear
    hour = srv.EMPTY_CHAT_S
    old_empty = make(srv, "old empty", hour + 60)
    fresh_empty = make(srv, "fresh empty", hour - 600)
    written = make(srv, "written", hour + 60)
    srv.db.append_event(written, "message.user", {"text": "merhaba"})
    previewed = make(srv, "previewed", hour + 60, last_preview="from a call")
    pinned = make(srv, "pinned", hour + 60, pinned=1)
    busy = make(srv, "busy", hour + 60)

    class Busy:
        def is_busy(self):
            return True
    srv.sessions.sessions[busy] = Busy()

    gone = asyncio.run(srv.drop_empty())
    assert gone == [old_empty]
    assert srv.db.get_chat(old_empty) is None
    for cid in (fresh_empty, written, previewed, pinned, busy):
        assert srv.db.get_chat(cid) is not None
    assert [m["event"] for m in told] == ["chat.deleted"] and told[0]["chat_id"] == old_empty
    srv.sessions.sessions.pop(busy)
    shutil.rmtree(HOME, ignore_errors=True)
