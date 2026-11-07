"""A message sent while the daemon is restarting is taken, not refused.

On 7 Nov 2026 a restart waited on a busy chat for minutes, and every message
sent to any chat in that time came back "this computer is restarting". Now it
is written into the timeline and onto disk, starts nothing (or the restart
would wait on it), and runs once the restart is over or called off.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from divan.config import Config
from divan.server import Server


def server() -> tuple[Server, str]:
    root = Path(tempfile.mkdtemp(prefix="divan-hold-")).resolve()
    cfg = Config.load()
    cfg.allowed_roots = [str(root)]
    cfg.demo = True                      # the scripted provider: no CLI starts
    cfg.save()
    srv = Server(Config.load())
    return srv, str(root)


def test_a_send_during_a_restart_is_held_then_delivered():
    async def go():
        srv, cwd = server()
        chat = await srv.h_chat_create(None, {"cwd": cwd, "title": "held"})
        cid = chat["id"]
        srv.draining = {"reason": "test", "since": 0, "deadline": 9e12, "force": False, "pending": []}
        ack = await srv.h_chat_send(None, {"chat_id": cid, "text": "a long thought", "client_id": "m-1"})
        assert ack["accepted"] and ack["held"] and ack["client_id"] == "m-1"
        users = [e for e in srv.db.tail_events(cid, ("message.user",), limit=10)]
        assert any((e["data"] or {}).get("held") and e["data"]["text"] == "a long thought" for e in users)
        assert srv.db.meta_get(Server.HELD_KEY)[0]["text"] == "a long thought"
        sess = srv.sessions.peek(cid)
        assert sess is not None and not sess.is_busy() and not sess.queued   # nothing started
        # The same message sent again is the same message, not a second one.
        again = await srv.h_chat_send(None, {"chat_id": cid, "text": "a long thought", "client_id": "m-1"})
        assert again["accepted"] and len(srv.db.meta_get(Server.HELD_KEY)) == 1
        # …and it is not part of an interrupted turn to pick up at the next start.
        assert srv.db._unanswered_messages(cid) == []
        srv.draining = None
        await srv.deliver_held()
        assert srv.db.meta_get(Server.HELD_KEY) == []
        assert sess.running is not None                                   # it runs now
        users = srv.db.tail_events(cid, ("message.user",), limit=10)
        assert len(users) == 1                                            # announced once, not twice
        sess.running.cancel()
        await asyncio.gather(sess.running, return_exceptions=True)
    asyncio.run(go())
