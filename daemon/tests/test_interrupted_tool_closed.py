"""A tool the restart cut off is closed, not left running for ever.

On 27 Nov 2026 a daemon restart took a chat's CLI with it in the middle of a
Bash call. The turn was picked up again from the transcript, but the call's
`tool.use` never got a `tool.result`, and the panel drew its row as running —
"looking at files… 39m" — long after the next turns had finished.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from divan.db import DB


def test_a_turn_cut_by_a_restart_closes_its_open_tools():
    path = Path(tempfile.mkdtemp(prefix="divan-tools-")) / "db.sqlite"
    db = DB(path)
    cid = db.create_chat(cwd="/tmp")["id"]
    db.append_event(cid, "message.user", {"text": "fix it"})
    db.append_event(cid, "tool.use", {"id": "done-1", "tool": "Bash", "input": {}})
    db.append_event(cid, "tool.result", {"id": "done-1", "output": "ok"})
    db.append_event(cid, "tool.use", {"id": "cut-1", "tool": "Bash", "input": {}})
    db.update_chat(cid, status="running")
    db._c.close()

    db = DB(path)                                  # the next daemon starting
    results = {e["data"]["id"]: e["data"] for e in db.tail_events(cid, ("tool.result",), limit=10)}
    assert results["done-1"]["output"] == "ok"
    assert results["cut-1"]["is_error"] is True
    assert "restart" in results["cut-1"]["output"]
    assert len(results) == 2                       # the finished one is not closed twice
