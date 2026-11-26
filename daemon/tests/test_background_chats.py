"""A job's own chat is marked `background`, and stops being one once it is back in the list.

    uv run python -m pytest -q tests/test_background_chats.py

The owner, 26 Nov 2026: the daily Vice run and the posting agents showed up in the web's
Archive as if they were his own chats. Jobs that run out of sight open their chat with
`background: true`; older ones are recognised by their first message.
"""
from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

from divan.db import DB


def test_flag_set_and_cleared() -> None:
    db = DB(Path(tempfile.mkdtemp()) / "db.sqlite")
    c = db.create_chat(title="job", background=1)
    assert c["background"] == 1
    db.update_chat(c["id"], archived=1)
    assert db.get_chat(c["id"])["background"] == 1
    db.update_chat(c["id"], archived=0)
    assert db.get_chat(c["id"])["background"] == 0
    assert db.create_chat(title="mine")["background"] == 0


def test_old_job_chats_found_by_first_message() -> None:
    path = Path(tempfile.mkdtemp()) / "db.sqlite"
    db = DB(path)
    job = db.create_chat(title="vice")
    mine = db.create_chat(title="mine")
    for cid, text in ((job["id"], "Vice Anları günlük üretim, 2026-11-26"), (mine["id"], "kanka naber")):
        db.update_chat(cid, archived=1)
        db._c.execute("INSERT INTO events (chat_id, type, payload, ts) VALUES (?, 'message.user', ?, 0)",
                      (cid, json.dumps({"text": text})))
    db._c.commit()
    db._c.close()
    con = sqlite3.connect(path)
    con.execute("ALTER TABLE chats DROP COLUMN background")
    con.commit(); con.close()
    db = DB(path)
    assert db.get_chat(job["id"])["background"] == 1
    assert db.get_chat(mine["id"])["background"] == 0
