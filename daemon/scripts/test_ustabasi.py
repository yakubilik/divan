#!/usr/bin/env python3
"""The ustabasi wall's side of the wire. No model turns, no network, no queue.

    python scripts/test_ustabasi.py

The daemon only looks at that queue: it reads the queue's own SQLite file and
answers one question about it, and the single write it makes goes through the
queue's own CLI. Both clients — the desktop panel and, now, the phone — are built
on the exact shape of that answer, and the shape is not obvious:

  * a computer with no queue is `available: false`, which is neither an error nor
    an empty queue. Most computers running this daemon have never heard of
    ustabasi, and a phone that cannot tell those three apart shows a spinner
    forever on all of them.
  * the newest event of every ticket comes out of one query for the whole wall,
    not one per ticket, and a ticket with no events at all still has to appear.
  * the notes are the last few, with the true count beside them.
  * the CLI owns what a note *means* — appended, escalation cleared, ticket back
    in the queue — so what is checked here is that its words and its failures
    reach the client rather than being swallowed or rewritten.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


SCHEMA = """
CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT, status TEXT, stage TEXT, round INTEGER,
  repo TEXT, branch TEXT, created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  card TEXT, escalation TEXT, verdict TEXT, notes TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL, kind TEXT, msg TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def write_queue(state: Path, *, paused: float | None = None) -> None:
    """A queue shaped like the real one: one of each state that matters, one
    ticket with more notes than a client is given, and one with no events."""
    now = time.time()
    conn = sqlite3.connect(state / "ustabasi.db")
    conn.executescript(SCHEMA)
    card = lambda goal, crit: json.dumps({"goal": goal, "done_criteria": crit})  # noqa: E731
    verdict = json.dumps({"verdict": "rejected", "findings": [
        {"criterion": "the first thing", "status": "met"},
        {"criterion": "the second thing", "status": "unmet", "detail": "nothing does this yet"}]})
    notes = json.dumps([{"ts": now - i, "from": "user", "text": f"note {i}"} for i in range(9)])
    conn.executemany("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        (1, "nothing has happened to this one", "queued", "worker", 1, "/repo/one", None,
         now - 90, now - 90, None, None, card("start", ["it starts"]), None, None, "[]"),
        (2, "stopped to ask", "blocked", "worker", 1, "/repo/two", "b/two",
         now - 900, now - 800, now - 880, None, card("decide", ["it is decided"]),
         "Which way should this go?", None, notes),
        (3, "turned down", "failed", "verifier", 3, "/repo/two", None,
         now - 9000, now - 30, now - 8000, now - 30, card("pass", ["the first thing", "the second thing"]),
         "the verifier turned it down twice", verdict, "[]"),
    ])
    conn.executemany("INSERT INTO events (ticket_id, ts, kind, msg) VALUES (?,?,?,?)", [
        (2, now - 900, "stage", "an older event nobody should see"),
        (2, now - 800, "escalate", "stopped to ask"),
        (3, now - 30, "verdict", "rejected, round 3"),
    ])
    conn.execute("INSERT INTO meta VALUES ('last_tick', ?)", (str(now - 60),))
    conn.execute("INSERT INTO meta VALUES ('paused_until', ?)", (str(paused) if paused else None,))
    conn.commit()
    conn.close()
    (state / "supervisor.heartbeat").write_text("")


# A stand-in for the queue's CLI that does what its `note` command does. The
# real one is another program; what is checked here is the contract between them.
CLI = """#!/usr/bin/env python3
import json, os, sqlite3, sys, time
if sys.argv[1] != "note":
    sys.exit("usage: note <id> <text>")
conn = sqlite3.connect(os.path.join(os.environ["USTABASI_STATE_DIR"], "ustabasi.db"))
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT * FROM tickets WHERE id=?", (int(sys.argv[2]),)).fetchone()
if row is None:
    sys.exit("no such ticket")
notes = json.loads(row["notes"] or "[]")
notes.append({"ts": time.time(), "from": "user", "text": sys.argv[3]})
conn.execute("UPDATE tickets SET notes=? WHERE id=?", (json.dumps(notes), row["id"]))
if row["status"] in ("blocked", "failed"):
    conn.execute("UPDATE tickets SET status='queued', stage='worker', escalation=NULL WHERE id=?", (row["id"],))
    print("note added; ticket re-queued for the worker")
else:
    print("note added; picked up at the next stage boundary")
conn.commit()
"""


async def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        state = Path(tmp) / "state"
        state.mkdir()
        cli = Path(tmp) / "ustabasi"
        db = state / "ustabasi.db"
        # The module reads both at import time, so they are set before it loads.
        os.environ["USTABASI_STATE_DIR"] = str(state)
        os.environ["USTABASI_CLI"] = str(cli)
        from remote_ai_chat import ustabasi  # noqa: PLC0415

        print("a computer with no queue")
        check(ustabasi.available() is False, "no database, no queue")
        empty = ustabasi.snapshot()
        check(empty == {"available": False, "tickets": [], "queue": {}},
              "and the answer says so rather than failing", repr(empty))

        write_queue(state, paused=time.time() + 600)
        # The CLI takes the database path as a fourth argument so this test can
        # point it at the temporary one; the real CLI knows its own.
        # It finds the database the way the real one does — from the environment
        # this daemon was started with, which a subprocess inherits.
        cli.write_text(CLI)
        cli.chmod(0o755)

        print("\na computer with one")
        snap = ustabasi.snapshot()
        check(snap["available"] is True, "the queue is there")
        check([t["id"] for t in snap["tickets"]] == [1, 2, 3], "every ticket, in id order",
              repr([t["id"] for t in snap["tickets"]]))
        by_id = {t["id"]: t for t in snap["tickets"]}
        check(by_id[2]["status"] == "blocked" and by_id[3]["status"] == "failed",
              "the two that need a person say which they are")
        check(by_id[2]["last_event"]["msg"] == "stopped to ask",
              "a ticket's last event is its newest one", repr(by_id[2]["last_event"]))
        check(by_id[1]["last_event"] is None, "a ticket with no events is still a ticket")
        check(by_id[2]["escalation"] == "Which way should this go?", "the question comes through")
        check(by_id[1]["escalation"] == "", "and is empty, not null, where there is none",
              repr(by_id[1]["escalation"]))
        check(by_id[3]["goal"] == "pass" and by_id[3]["done_criteria"] == ["the first thing", "the second thing"],
              "the card is unpacked into goal and criteria")
        check(by_id[1]["verdict"] is None and by_id[3]["verdict"]["findings"][1]["status"] == "unmet",
              "the verdict is a verdict, and absent where there is none")
        check(len(by_id[2]["notes"]) == 6 and by_id[2]["note_count"] == 9,
              "the last six notes, and the count of all nine",
              f'{len(by_id[2]["notes"])} of {by_id[2]["note_count"]}')
        check(by_id[2]["notes"][-1]["text"] == "note 8", "the six are the last six, in order",
              repr(by_id[2]["notes"][-1]))
        check(isinstance(snap["queue"]["last_tick"], float) and snap["queue"]["paused_until"] is not None,
              "the supervisor's heartbeat and its pause are reported", repr(snap["queue"]))

        print("\nanswering a ticket")
        r = await ustabasi.note(2, "decided: the second way")
        check(r["ok"] is True and "re-queued" in r["message"],
              "the queue's own words come back", repr(r))
        after = {t["id"]: t for t in ustabasi.snapshot()["tickets"]}[2]
        check(after["status"] == "queued" and after["stage"] == "worker",
              "and the ticket is back in front of the worker", after["status"])
        check(after["escalation"] == "", "with the question cleared", repr(after["escalation"]))
        check(after["notes"][-1]["text"] == "decided: the second way",
              "the note itself landed", repr(after["notes"][-1]["text"]))

        print("\nwhat it refuses")
        for text, why in (("", "an empty note"), ("   ", "whitespace is an empty note"),
                          ("x" * (ustabasi.MAX_NOTE + 1), "a note the size of a new ticket")):
            try:
                await ustabasi.note(2, text)
                check(False, f"{why} is refused", "it was accepted")
            except ValueError as exc:
                check(True, f"{why} is refused ({exc})")
        cli.unlink()
        try:
            await ustabasi.note(2, "anybody there?")
            check(False, "a missing CLI is refused", "it was accepted")
        except ValueError as exc:
            check(True, f"a missing CLI is refused ({exc})")

        print("\na queue that went away while we were looking")
        db.unlink()
        check(ustabasi.snapshot()["available"] is False,
              "reads as no queue, not as an error")

    print()
    if failures:
        print(f"{len(failures)} failed: " + ", ".join(failures))
        sys.exit(1)
    print("all good")


if __name__ == "__main__":
    asyncio.run(main())
