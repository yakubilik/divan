#!/usr/bin/env python3
"""The ustabasi wall's side of the wire, and the three readings it adds.

    python scripts/test_ustabasi.py

The daemon only looks at that queue: it reads the queue's own SQLite file and
answers one question about it, and the single write it makes goes through the
queue's own CLI. Both clients — the desktop panel and the phone — are built on
the exact shape of that answer, and the shape is not obvious:

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

Three more readings are the daemon's own, because the queue does not store them.
A card that says "48m" about a ticket opened fifteen hours ago has been read as
a total, because nothing on the card was one. So the snapshot also carries:

  * the project a ticket is work on, by name, so a wall can group by it
  * when the round it is in began — the *first* hand-over of that round, since a
    worker that hit a usage limit is started again within the same round
  * what is on the branch: how many commits, and the newest subject

The last one is read from the worktree, which may be gone, may have no commit on
it yet, or may not be recorded at all. Every one of those is "say nothing".

The queue's database belongs to another program, so the tables here are built by
hand from its shape rather than by importing anything of it.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

tmp = Path(tempfile.mkdtemp(prefix="rac-ustabasi-"))
os.environ["USTABASI_STATE_DIR"] = str(tmp / "state")
(tmp / "state").mkdir()

from remote_ai_chat import ustabasi as u                          # noqa: E402
from remote_ai_chat.security import PathPolicy                    # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def holds(what: str, ok: bool, detail: str = "") -> None:
    """For the checks whose answer is a sentence rather than a value."""
    if not ok:
        fails.append(f"{what}\n    got:  {detail}")


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True,
                   capture_output=True, text=True)


seq = 0


def commit(cwd: Path, subject: str) -> None:
    # A file per commit: the merge below has to be a merge, not a conflict.
    global seq
    seq += 1
    (cwd / f"f{seq}.txt").write_text(subject + "\n")
    git(cwd, "add", ".")
    git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", subject)


# ── a project tree, a repository in it, and a branch with work on it ─────────

root = tmp / "projects"
(root / "ledger" / "app").mkdir(parents=True)
(root / "elsewhere").mkdir()
policy = PathPolicy([str(root)], [])

work = tmp / "work"
work.mkdir()
git(work, "init", "-b", "main")
commit(work, "the commit main already had")
git(work, "checkout", "-b", "ticket/1")
commit(work, "first thing the worker did")
commit(work, "second thing the worker did")

# A branch that has been merged into and a branch that is still empty.
git(work, "checkout", "main")
commit(work, "something that landed on main meanwhile")
git(work, "checkout", "ticket/1")
git(work, "-c", "user.name=t", "-c", "user.email=t@t", "merge", "main", "-m", "Merge branch 'main'")
commit(work, "third thing, after the merge")

empty = tmp / "empty"
empty.mkdir()
git(empty, "init", "-b", "main")
commit(empty, "the only commit there is")

# ── the queue's database, as the queue shapes it ─────────────────────────────

NOW = time.time()
DB = tmp / "state" / "ustabasi.db"
conn = sqlite3.connect(DB)
conn.executescript("""
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY, slug TEXT, title TEXT, card TEXT, repo TEXT,
  base_branch TEXT, status TEXT, stage TEXT, round INTEGER,
  created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  worktree TEXT, branch TEXT, notes TEXT, verdict TEXT, escalation TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL,
  kind TEXT, msg TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
""")


def ticket(tid: int, repo: str, *, worktree: str | None = None, round_no: int = 1,
           stage: str = "worker", status: str = "running", base: str = "main",
           started: bool = True) -> None:
    conn.execute(
        "INSERT INTO tickets (id, slug, title, card, repo, base_branch, status, stage,"
        " round, created_at, updated_at, started_at, finished_at, worktree, branch,"
        " notes, verdict, escalation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, f"t{tid}", f"ticket {tid}", '{"goal": "g", "done_criteria": ["a"]}',
         repo, base, status, stage, round_no, NOW - 54000, NOW - 600,
         NOW - 53000 if started else None, None, worktree, "ticket/1", "[]", None, ""),
    )


def event(tid: int, ts: float, kind: str, msg: str) -> None:
    conn.execute("INSERT INTO events (ticket_id, ts, kind, msg) VALUES (?,?,?,?)",
                 (tid, ts, kind, msg))


ticket(1, str(root / "ledger"), worktree=str(work), round_no=2, stage="verifier")
# Round 1 ran, then round 2 was started twice — the second time because the
# first attempt stopped on a usage limit.
event(1, NOW - 53000, "start", "worker round 1 pid 1 model m account a")
event(1, NOW - 40000, "start", "verifier round 1 pid 2 model m account a")
event(1, NOW - 9000, "start", "worker round 2 pid 3 model m account a")
event(1, NOW - 3000, "start", "verifier round 2 pid 4 model m account b")
event(1, NOW - 600, "report", "the worker said something")

ticket(2, str(root / "ledger" / "app"), worktree=str(work))      # a folder inside a project
ticket(3, str(root / "elsewhere"))                               # no worktree at all
ticket(4, str(tmp / "outside"), worktree=str(tmp / "gone"))       # worktree removed
ticket(5, str(root / "ledger"), worktree=str(empty))             # nothing on the branch yet
ticket(6, str(root / "ledger"), worktree=str(work), base="no-such-branch")
ticket(7, str(root / "ledger"), status="queued", started=False)   # not started yet

# Sent back by the verifier and waiting for a free slot: round 2 on the row, but
# nobody has been handed it yet, so there is no "worker round 2" to time from.
ticket(8, str(root / "ledger"), worktree=str(work), round_no=2, status="queued")
event(8, NOW - 53000, "start", "worker round 1 pid 7 model m account a")
event(8, NOW - 20000, "start", "verifier round 1 pid 8 model m account a")
event(8, NOW - 19000, "requeue", "-> worker round 2")
conn.execute("INSERT INTO meta (key, value) VALUES ('paused_until', ?)", (str(NOW + 900),))
conn.commit()
conn.close()

snap = u.snapshot(policy.project_for)
by_id = {t["id"]: t for t in snap["tickets"]}

# ── the project a ticket is work on ──────────────────────────────────────────

check("the wall has a ticket per row", sorted(by_id), [1, 2, 3, 4, 5, 6, 7, 8])
check("a repository is its project", by_id[1]["project"], "ledger")
check("a folder inside it is still that project", by_id[2]["project"], "ledger")
check("a project with no ticket work is not invented",
      [t["project"] for t in snap["tickets"] if t["project"] == "app"], [])
check("outside every root, the folder name is the name", by_id[4]["project"], "outside")

# ── when the round began ─────────────────────────────────────────────────────

check("the round's first hand-over, not its last",
      round(by_id[1]["round_started_at"]), round(NOW - 9000))
check("round one began when the ticket did, with nothing else to go on",
      by_id[3]["round_started_at"], by_id[3]["started_at"])
check("a ticket still in the queue has no round to time",
      by_id[7]["round_started_at"], None)
# The one that would have put fifteen hours on a round that has not begun.
check("a round sent back and still waiting for a slot is not timed from the first",
      by_id[8]["round_started_at"], None)

# ── what is on the branch ────────────────────────────────────────────────────

check("commits on the branch, merges left out", by_id[1]["git"]["commits"], 3)
check("the newest subject", by_id[1]["git"]["subject"], "third thing, after the merge")
check("no worktree, no commit line", by_id[3]["git"], None)
check("a worktree that is gone says nothing", by_id[4]["git"], None)
check("a branch level with its base says nothing", by_id[5]["git"], None)
check("a base branch this copy does not know says nothing", by_id[6]["git"], None)

# ── it is still the same snapshot it was ─────────────────────────────────────

check("the queue's own state is still read", snap["available"], True)
check("paused_until survives", round(snap["queue"]["paused_until"]), round(NOW + 900))
check("the newest event is still the card's line", by_id[1]["last_event"]["kind"], "report")
check("the card is still unpacked", by_id[1]["done_criteria"], ["a"])

# ── a long subject is cut, not wrapped onto a card ───────────────────────────

u._git_cache.clear()
commit(work, "x" * 400)
check("a subject longer than a card is cut",
      len(u._git(str(work), "main")["subject"]), u.MAX_SUBJECT)

# ── the reading is reused for a few seconds ──────────────────────────────────

before = u._git(str(work), "main")
commit(work, "one more, within the cache window")
check("a second look inside the window is the first answer",
      u._git(str(work), "main"), before)
u._git_cache.clear()
check("and after it, the new commit is there",
      u._git(str(work), "main")["subject"], "one more, within the cache window")

# ── a queue whose table does not carry a worktree at all ─────────────────────

other = tmp / "older.db"
conn = sqlite3.connect(other)
conn.executescript("""
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY, title TEXT, card TEXT, repo TEXT, status TEXT,
  stage TEXT, round INTEGER, created_at REAL, updated_at REAL, started_at REAL,
  finished_at REAL, branch TEXT, notes TEXT, verdict TEXT, escalation TEXT
);
CREATE TABLE events (id INTEGER PRIMARY KEY, ticket_id INTEGER, ts REAL, kind TEXT, msg TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO tickets VALUES (1,'t','{}','/tmp/x','running','worker',1,1,1,1,NULL,'b','[]',NULL,'');
""")
conn.commit()
conn.close()
was, u.DB_PATH = u.DB_PATH, other
try:
    older = u.snapshot(policy.project_for)
    check("a queue without those columns is a wall, not an error",
          older["tickets"][0]["git"], None)
finally:
    u.DB_PATH = was

# ── the shape of the answer both clients are built on ────────────────────────
#
# A second queue, in its own folder, read through the same module: what a
# ticket looks like on the wire, and what the one write does. The module was
# imported against the queue above, so the three paths it reads are pointed at
# this one rather than the module being imported twice.

wire = tmp / "wire"
wire.mkdir()
CLI_STUB = """#!/usr/bin/env python3
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

WIRE_SCHEMA = """
CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT, status TEXT, stage TEXT, round INTEGER,
  repo TEXT, branch TEXT, created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  card TEXT, escalation TEXT, verdict TEXT, notes TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL, kind TEXT, msg TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def write_wire_queue(state: Path, *, paused: float | None = None) -> None:
    """A queue shaped like the real one: one of each state that matters, one
    ticket with more notes than a client is given, and one with no events."""
    now = time.time()
    conn = sqlite3.connect(state / "ustabasi.db")
    conn.executescript(WIRE_SCHEMA)
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
         now - 9000, now - 30, now - 8000, now - 30,
         card("pass", ["the first thing", "the second thing"]),
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


async def the_wire() -> None:
    stub = wire / "ustabasi"
    u.DB_PATH = wire / "ustabasi.db"
    u.HEARTBEAT = wire / "supervisor.heartbeat"
    u.CLI = stub
    os.environ["USTABASI_STATE_DIR"] = str(wire)

    holds("no database, no queue", u.available() is False)
    empty = u.snapshot()
    check("and the answer says so rather than failing", empty,
          {"available": False, "tickets": [], "queue": {}})

    write_wire_queue(wire, paused=time.time() + 600)
    # The stub finds the database the way the real CLI does — from the
    # environment this daemon was started with, which a subprocess inherits.
    stub.write_text(CLI_STUB)
    stub.chmod(0o755)

    snap = u.snapshot()
    holds("the queue is there", snap["available"] is True)
    check("every ticket, in id order", [t["id"] for t in snap["tickets"]], [1, 2, 3])
    by = {t["id"]: t for t in snap["tickets"]}
    holds("the two that need a person say which they are",
          by[2]["status"] == "blocked" and by[3]["status"] == "failed")
    check("a ticket's last event is its newest one", by[2]["last_event"]["msg"], "stopped to ask")
    check("a ticket with no events is still a ticket", by[1]["last_event"], None)
    check("the question comes through", by[2]["escalation"], "Which way should this go?")
    check("and is empty, not null, where there is none", by[1]["escalation"], "")
    check("the card is unpacked into a goal", by[3]["goal"], "pass")
    check("and into criteria", by[3]["done_criteria"], ["the first thing", "the second thing"])
    check("no verdict where there is none", by[1]["verdict"], None)
    check("and a verdict where there is one", by[3]["verdict"]["findings"][1]["status"], "unmet")
    check("the last six notes", len(by[2]["notes"]), 6)
    check("and the count of all nine", by[2]["note_count"], 9)
    check("the six are the last six, in order", by[2]["notes"][-1]["text"], "note 8")
    holds("the supervisor's heartbeat and its pause are reported",
          isinstance(snap["queue"]["last_tick"], float) and snap["queue"]["paused_until"] is not None,
          repr(snap["queue"]))

    r = await u.note(2, "decided: the second way")
    holds("the queue's own words come back", r["ok"] is True and "re-queued" in r["message"], repr(r))
    after = {t["id"]: t for t in u.snapshot()["tickets"]}[2]
    check("and the ticket is back in front of the worker", after["status"], "queued")
    check("at the stage it was sent back to", after["stage"], "worker")
    check("with the question cleared", after["escalation"], "")
    check("the note itself landed", after["notes"][-1]["text"], "decided: the second way")

    for text, why in (("", "an empty note"), ("   ", "whitespace is an empty note"),
                      ("x" * (u.MAX_NOTE + 1), "a note the size of a new ticket")):
        try:
            await u.note(2, text)
            holds(f"{why} is refused", False, "it was accepted")
        except ValueError:
            holds(f"{why} is refused", True)
    stub.unlink()
    try:
        await u.note(2, "anybody there?")
        holds("a missing CLI is refused", False, "it was accepted")
    except ValueError:
        holds("a missing CLI is refused", True)

    (wire / "ustabasi.db").unlink()
    holds("a queue that went away reads as no queue, not as an error",
          u.snapshot()["available"] is False)


asyncio.run(the_wire())

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print(f"ok — ustabasi snapshot, {len(snap['tickets'])} tickets read, and the wire's shape")
