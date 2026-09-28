#!/usr/bin/env python3
"""The three readings the ustabasi wall needs and the queue does not store.

    python scripts/test_ustabasi.py

A card that says "48m" about a ticket opened fifteen hours ago has been read as
a total, because nothing on the card was one. So the snapshot now carries three
figures a person can check against the clock and against git:

  * the project a ticket is work on, by name, so the wall can group by it
  * when the round it is in began — the *first* hand-over of that round, since a
    worker that hit a usage limit is started again within the same round
  * what is on the branch: how many commits, and the newest subject

The last one is read from the worktree, which may be gone, may have no commit on
it yet, or may not be recorded at all. Every one of those is "say nothing", and
that is most of what this checks.

The queue's database belongs to another program, so the tables here are built by
hand from its shape rather than by importing anything of it.
"""
from __future__ import annotations

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

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print(f"ok — ustabasi snapshot, {len(snap['tickets'])} tickets read")
