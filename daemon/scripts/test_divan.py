#!/usr/bin/env python3
"""The Divan board: the model, the wire, and the one rule under both.

    .venv312/bin/python scripts/test_divan.py

Until this landed, the only work object on the computer was the ustabasi queue,
and a queue has no columns, no order somebody chose, no branches beside the
code, no human/agent split and no executor. Every Divan screen needs all five,
so they are here — and so is the rule they are arranged around:

**The column is the human's intent and the status is reality.** A card moves
because a finger moved it. What the agent on it is doing is a separate field,
written by the mirror on the ordinary snapshot poll, and writing it never moves
anything. Get that wrong and a worker that fails at four in the morning drags
its own card across the board, which is exactly the behaviour that would make a
board not worth looking at. It is checked here from both ends: every status the
queue has, applied to a card somebody had put somewhere on purpose, and the
card still where it was left.

The rest is the things that are easy to get subtly wrong and impossible to see:

  * a database from before the board gains four empty tables and keeps every
    chat and every event it had;
  * a card is created from the human face **alone** — a title and maybe two
    sentences — because a card written down mid-conversation is a line, and a
    board that demands a goal and done criteria before it will take one is a
    form;
  * agent text never lands on the human face, not even on a card that was an
    agent's ticket before it was a card;
  * positions stay contiguous through every move, in both directions and within
    one column, because "Queued, top to bottom" is the only planning this
    product has;
  * dragging into In Progress on the coding executor files a real ticket
    through that queue's own CLI and writes the number back — and a queue that
    is absent or refuses leaves the card where the finger put it rather than
    springing it back;
  * the tickets that already existed become cards, under the project name the
    panel already groups them by.

Nothing here talks to the network or starts a model. The queue is a SQLite file
and a stub CLI built here, the way `test_ustabasi.py` builds one: its database
belongs to another program, so its tables are written out by hand rather than
imported.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

tmp = Path(tempfile.mkdtemp(prefix="rac-divan-"))
QUEUE = tmp / "queue"
QUEUE.mkdir()
os.environ["USTABASI_STATE_DIR"] = str(QUEUE)

from remote_ai_chat import divan                                   # noqa: E402
from remote_ai_chat.accounts import Account                        # noqa: E402
from remote_ai_chat.pool import Pool, Settings as PoolSettings     # noqa: E402
from remote_ai_chat import ustabasi as u                           # noqa: E402
from remote_ai_chat.db import DB, SCHEMA as CHAT_SCHEMA            # noqa: E402
from remote_ai_chat.security import PathPolicy                     # noqa: E402
from remote_ai_chat.server import Server                           # noqa: E402

# Two of the checks below are a queue declining to take a card, and the handler
# says so in the log on its way to saying so in the answer. That is the
# behaviour being checked; printed here it reads like a failure in a script
# whose whole output is one line.
logging.getLogger("rac.server").setLevel(logging.ERROR)

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def holds(what: str, ok: bool, detail: str = "") -> None:
    """For the checks whose answer is a sentence rather than a value."""
    if not ok:
        fails.append(f"{what}\n    got:  {detail or 'no'}")


def refuses(what: str, fn, *args, **kw) -> None:
    try:
        fn(*args, **kw)
    except ValueError:
        return
    fails.append(f"{what}\n    got:  it was accepted")


# ── a machine with projects on it ────────────────────────────────────────────

ROOT = tmp / "projects"
for name in ("babysee", "isghocam", "a-new-product", "secrets", "remote-ai-chat"):
    (ROOT / name).mkdir(parents=True)
(ROOT / "babysee" / "app").mkdir()
# The case the folder's name cannot answer: the product checked out here is
# called Divan, and nothing about the board may rename it back.
(ROOT / "remote-ai-chat" / "app").mkdir()

# babysee is a real repository, because "is this product alive at all" is a
# question only git can answer and the answer travels on the snapshot. Two
# commits: one now, one three weeks ago. isghocam is left a plain folder, which
# is the other case that matters — a figure nobody can measure has to be absent
# rather than zero.
def _git(*args: str, at: float | None = None) -> None:
    env = {**os.environ, "GIT_CONFIG_GLOBAL": str(tmp / "gitconfig"),
           "GIT_CONFIG_SYSTEM": "/dev/null",
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    if at is not None:
        stamp = f"{int(at)} +0000"
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = stamp
    r = subprocess.run(("git", "-C", str(ROOT / "babysee"), *args),
                       capture_output=True, text=True, env=env)
    if r.returncode:                                        # pragma: no cover
        raise SystemExit(f"git {args}: {r.stderr}")


_git("init", "-q", "-b", "main")
(ROOT / "babysee" / "old.txt").write_text("x")
_git("add", "-A")
_git("commit", "-qm", "three weeks ago", at=time.time() - 21 * 24 * 3600)
(ROOT / "babysee" / "new.txt").write_text("y")
_git("add", "-A")
_git("commit", "-qm", "this morning", at=time.time() - 120)
# Outside every root, and therefore no place to start a coding agent: the home
# directory of the machine running this, as far as the policy is concerned.
OUTSIDE = tmp / "outside-every-root"
OUTSIDE.mkdir()
policy = PathPolicy([str(ROOT)], [str(ROOT / "secrets")])


def fresh_db(name: str) -> DB:
    return DB(tmp / f"{name}.sqlite")


#: Two sign-ins, so that "what is left on this machine" has more than one
#: account to be the best of. The limit readings themselves are written per
#: Host, because a machine out of quota and a machine with room are the same
#: board asked twice.
ACCOUNTS = {
    "default-claude": Account(id="default-claude", provider="claude", label="this computer"),
    "acct-2": Account(id="acct-2", provider="claude", label="second", home="/tmp/a2",
                      created_at=2),
}


class Host:
    """Just enough of `Server` for the board's handlers: a database, a path
    policy, this computer's name and an account pool. Constructing a real one
    would open the daemon's own config and its own database."""

    def __init__(self, db: DB, host_name: str = "this-mac"):
        self.db = db
        self.policy = policy
        self.cfg = types.SimpleNamespace(host_name=host_name)
        # The plan readings this machine has, keyed as the server keys them.
        # Written by the checks that are about quota and empty for the rest.
        self.limits: dict[str, list[dict]] = {}
        self.pool = Pool(PoolSettings.from_dict({"enabled": True}),
                         lambda: ACCOUNTS, lambda k: self.limits.get(k, []))
        for attr in dir(Server):
            if (attr.startswith("h_divan_") or attr == "h_ustabasi_list"
                    or attr in ("_checked_repo", "_mirrored_queue")):
                setattr(self, attr, getattr(Server, attr).__get__(self))


# ── 1 · the migration, on a database from before the board ───────────────────

old = tmp / "old.sqlite"
conn = sqlite3.connect(old)
conn.executescript(CHAT_SCHEMA)
conn.execute("INSERT INTO groups (id,name,sort,created_at) VALUES ('g1','work',0,1.0)")
conn.execute("INSERT INTO chats (id,title,provider,model,perm_mode,cwd,created_at,updated_at)"
             " VALUES ('c1','a chat from before',  'claude','m','ask','/tmp',1.0,1.0)")
conn.execute("INSERT INTO events (chat_id,type,payload,ts) VALUES ('c1','message.user','{}',1.0)")
conn.commit()
conn.close()

db = DB(old)
tables = {r[0] for r in db._c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
holds("the board's tables arrive on a database that predates it",
      {"projects", "project_repos", "branches", "cards"} <= tables, repr(sorted(tables)))
check("and the chats that were there are still there",
      [c["title"] for c in db.list_chats()], ["a chat from before"])
check("with their timeline", db.count_events("c1"), 1)
check("and their groups", [g["name"] for g in db.list_groups()], ["work"])
check("the board itself starts empty", db.divan.list_projects(), [])

# Opening it again runs the same migration over tables that now exist.
p1 = db.divan.create_project("kept", repos=[str(ROOT / "babysee")])
again = DB(old)
check("a second open leaves what the first one wrote",
      [p["name"] for p in again.divan.list_projects()], ["kept"])
check("and its branches", len(again.divan.branches(p1["id"])), len(divan.BRANCH_KINDS))

# A column added to `cards` after the first release: the same additive pass
# `db.DB._migrate` does for chats, on a table built without it.
thin = tmp / "thin.sqlite"
conn = sqlite3.connect(thin)
conn.executescript(divan.SCHEMA.replace("  agent_detail TEXT DEFAULT '',\n", ""))
conn.execute("INSERT INTO cards (id,project_id,branch_id,column,position,title,created_at)"
             " VALUES ('x','p','b','queued',0,'a card written by an older daemon',1.0)")
conn.commit()
divan.migrate(conn)
check("a column added after the first release arrives on its own",
      "agent_detail" in {r[1] for r in conn.execute("PRAGMA table_info(cards)")}, True)
check("and the card that was there kept every word of itself",
      conn.execute("SELECT title, column, position FROM cards").fetchone(),
      ("a card written by an older daemon", "queued", 0))
conn.close()

# ── 2 · projects, branches, and the two faces ────────────────────────────────

db = fresh_db("model")
board = db.divan

bs = board.create_project("babysee", repos=[str(ROOT / "babysee")])
ig = board.create_project("isghocam", repos=[str(ROOT / "isghocam")],
                          branches=["support"])

check("a product is not a folder: it owns its repositories",
      bs["repos"], [str(ROOT / "babysee")])
board.attach_repo(bs["id"], str(ROOT / "babysee" / "app"))
check("and it may own several",
      len(board.get_project(bs["id"])["repos"]), 2)
check("every product gets the five branches",
      [b["kind"] for b in board.branches(bs["id"])], list(divan.BRANCH_KINDS))
check("and the set is open",
      [b["kind"] for b in board.branches(ig["id"])][-1], "support")
check("a branch nobody named is still titled",
      board.branch(ig["id"], "support")["name"], "Support")
check("one row per project per branch",
      board.ensure_branch(bs["id"], "seo")["id"], board.branch(bs["id"], "seo")["id"])
refuses("two products of one name", board.create_project, "babysee")
refuses("a product with no name", board.create_project, "  ")

# A card from the human face alone: a title, and nothing else required.
line = board.create_card(bs["id"], title="the invite mail never arrives")
check("a card needs a title and nothing else", line["title"],
      "the invite mail never arrives")
check("and lands where nothing starts", line["column"], "ice_box")
check("on engineering unless told otherwise", line["branch"], "engineering")
check("with nobody on it", (line["executor"], line["ustabasi_id"]), (None, None))
check("and no status, because nothing is running", line["agent_status"], None)
check("the repository defaults to the product's first",
      line["repo"], str(ROOT / "babysee"))
refuses("a card with no title", board.create_card, bs["id"], title="   ")
refuses("a card in a column that does not exist", board.create_card, bs["id"],
        title="t", column="someday")
refuses("a card on a branch this product has not got", board.create_card, bs["id"],
        title="t", branch="legal")
refuses("an executor nobody has heard of", board.create_card, bs["id"], title="t",
        executor="intern")

full = board.create_card(
    bs["id"], title="rotate the signing key", summary="It expires in March.",
    branch="engineering", executor="coding_agent",
    agent={"goal": "Move the key out of the bundle and into the keychain.",
           "done_criteria": ["the bundle carries no key", "the tests pass"],
           "verify_cmd": "npm test", "constraints": ["no UI work"],
           "paths": ["app/src/auth"], "notes": "ask before touching the store"})

check("the board's cards carry the human face", full["title"], "rotate the signing key")
on_board = next(c for c in board.board(bs["id"])["columns"]["ice_box"]
                if c["id"] == full["id"])
holds("and not the agent's, which has no business on forty cards at once",
      "agent" not in on_board, repr(sorted(on_board)))
opened = board.get_card(full["id"])
check("an opened card carries the goal", opened["agent"]["goal"],
      "Move the key out of the bundle and into the keychain.")
check("the done criteria", opened["agent"]["done_criteria"],
      ["the bundle carries no key", "the tests pass"])
check("the verify command", opened["agent"]["verify_cmd"], "npm test")
check("the constraints", opened["agent"]["constraints"], ["no UI work"])
check("the paths", opened["agent"]["paths"], ["app/src/auth"])
check("and the notes for whoever picks it up", opened["agent"]["notes"],
      "ask before touching the store")
check("the human face stays short", len(board.create_card(
    bs["id"], title="x" * 400, summary="y" * 2000)["title"]), divan.MAX_TITLE)
check("both halves of it", len(board.get_card(board.create_card(
    bs["id"], title="t", summary="y" * 2000)["id"])["summary"]), divan.MAX_SUMMARY)

# ── 3 · the order somebody put them in ───────────────────────────────────────

db = fresh_db("order")
board = db.divan
p = board.create_project("ordering", repos=["/repo/ordering"])
cards = [board.create_card(p["id"], title=f"card {i}", column="queued") for i in range(4)]


def order(col: str) -> list[str]:
    return [c["title"] for c in board.board(p["id"])["columns"][col]]


def positions(col: str) -> list[int]:
    return [c["position"] for c in board.board(p["id"])["columns"][col]]


check("a new card lands on top of the column", order("queued"),
      ["card 3", "card 2", "card 1", "card 0"])
check("and the positions are the order", positions("queued"), [0, 1, 2, 3])

board.move(cards[3]["id"], "queued", 3)
check("a card can be dropped to the bottom of its own column",
      order("queued"), ["card 2", "card 1", "card 0", "card 3"])
check("with no gap left behind it", positions("queued"), [0, 1, 2, 3])

board.move(cards[0]["id"], "queued", 0)
check("and back to the top", order("queued"),
      ["card 0", "card 2", "card 1", "card 3"])
check("still with no gaps", positions("queued"), [0, 1, 2, 3])

board.move(cards[1]["id"], "in_progress")
check("a card moved to another column leaves that one closed up",
      (order("queued"), positions("queued")),
      (["card 0", "card 2", "card 3"], [0, 1, 2]))
check("and arrives at the bottom of the one it went to",
      order("in_progress"), ["card 1"])

board.move(cards[2]["id"], "in_progress", 0)
check("dropped where the finger was, not at the end",
      order("in_progress"), ["card 2", "card 1"])
check("a position past the end is the end",
      board.move(cards[2]["id"], "in_progress", 99)["position"], 1)
check("and a position below zero is the top",
      board.move(cards[2]["id"], "in_progress", -5)["position"], 0)
check("a move to the column it is already in, with no place named, is not a move",
      board.move(cards[2]["id"], "in_progress")["position"], 0)
refuses("a move to a column that does not exist", board.move, cards[0]["id"], "backlog")
refuses("a move of a card that does not exist", board.move, "nope", "done")

board.delete_card(cards[0]["id"])
check("deleting one closes the gap too",
      (order("queued"), positions("queued")), (["card 3"], [0]))

# ── 3b · the agent face is written later, and only ever on its own ───────────

late = board.create_card(p["id"], title="the sitemap is not regenerating")
board.move(late["id"], "in_progress", 0)
placed = board.get_card(late["id"])
grown = board.update_card(late["id"], summary="Since the nightly moved to 21:17.",
                          goal="Regenerate it at the end of the nightly.",
                          done_criteria=["the sitemap is younger than the run"],
                          verify_cmd="npm run seo:check", constraints=["no new cron"],
                          paths=["scripts/"], notes="the old path stays for a week")
check("a card written as one line grows an agent face later",
      grown["agent"]["goal"], "Regenerate it at the end of the nightly.")
check("with its criteria", grown["agent"]["done_criteria"],
      ["the sitemap is younger than the run"])
check("its test", grown["agent"]["verify_cmd"], "npm run seo:check")
check("and the human face beside it, unchanged", grown["title"],
      "the sitemap is not regenerating")
check("…but not where the card is: that has a method of its own",
      (grown["column"], grown["position"]), (placed["column"], placed["position"]))

board.update_card(late["id"], column="done", position=99, executor="coding_agent",
                  ustabasi_id=7, agent_status="running")
after = board.get_card(late["id"])
check("a field the mirror owns cannot be written through the faces",
      (after["column"], after["position"], after["executor"],
       after["ustabasi_id"], after["agent_status"]),
      (placed["column"], placed["position"], None, None, None))
check("a criterion list sent as text is read a line at a time",
      board.update_card(late["id"], done_criteria="one\ntwo\n")["agent"]["done_criteria"],
      ["one", "two"])
refuses("a card left with no title at all", board.update_card, late["id"], title="  ")
board.delete_card(late["id"])

# ── 4 · who does it ──────────────────────────────────────────────────────────

mine = board.create_card(p["id"], title="decide the pricing")
check("a card opens with nobody on it", mine["executor"], None)
check("and takes one", board.set_executor(mine["id"], "human")["executor"], "human")
check("which can be cleared, because a wrong guess is not a person",
      board.set_executor(mine["id"], None)["executor"], None)
check("the machine it was set on is remembered",
      board.set_executor(mine["id"], "branch_agent", machine="this-mac")["machine"],
      "this-mac")
check("and is not wiped by a later change that does not mention one",
      board.set_executor(mine["id"], "assistant")["machine"], "this-mac")
refuses("an executor that is not one of the four", board.set_executor, mine["id"], "robot")
refuses("an executor on a card that is not there", board.set_executor, "nope", "human")

# ── 5 · the line a project is read by ────────────────────────────────────────

view = board.project_view(board.get_project(p["id"]))
check("a project carries its branches", len(view["branches"]), len(divan.BRANCH_KINDS))
check("and counts its own columns", view["counts"]["in_progress"], 2)
check("the line leaves out everything that is zero", view["summary_line"], "1 queued")
check("and a product nothing has happened to yet says so",
      board.project_view(board.create_project("an idea"))["summary_line"],
      "nothing running")
board.set_executor(mine["id"], "human")
board.move(mine["id"], "in_progress")
check("a card that is yours, in progress, is waiting on you",
      board.project_view(board.get_project(p["id"]))["waiting"], 1)
check("and the line says so",
      board.project_view(board.get_project(p["id"]))["summary_line"],
      "1 waiting on you · 1 queued")
check("a branch with no source connected says nothing rather than a number",
      [b["summary"] for b in view["branches"]], [""] * len(divan.BRANCH_KINDS))
check("but the cards on it are real", view["branches"][0]["cards"]["in_progress"], 2)

# ── 6 · the project a repository is work on ──────────────────────────────────

check("a repository under a root is its project",
      divan.project_name_for(str(ROOT / "babysee"), policy.project_for), "babysee")
check("a folder inside it is still that project",
      divan.project_name_for(str(ROOT / "babysee" / "app"), policy.project_for), "babysee")
check("a repository this computer has no policy for is named by its folder",
      divan.project_name_for("/somewhere/else/ledger", policy.project_for), "ledger")
check("and a ticket with no repository at all is unfiled",
      divan.project_name_for("", policy.project_for), divan.UNFILED)

# ── the queue, as a file and a CLI ───────────────────────────────────────────

QUEUE_SCHEMA = """
CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT, status TEXT, stage TEXT,
  round INTEGER, repo TEXT, branch TEXT, base_branch TEXT, worktree TEXT, run_dir TEXT,
  created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  card TEXT, escalation TEXT, verdict TEXT, notes TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL,
  kind TEXT, msg TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

# `add --json -`, as the queue's own CLI takes it: a spec on stdin, a row
# written, and one line printed with the number in it. The done-criteria rule is
# the real one's — a ticket nobody can verify is refused — which is what makes
# the human face standing in for a missing agent face worth checking.
CLI_STUB = """#!/usr/bin/env python3
import json, os, sqlite3, sys, time
if sys.argv[1:3] != ["add", "--json"]:
    sys.exit("usage: add --json -")
spec = json.loads(sys.stdin.read())
if not spec.get("repo"):
    sys.exit("need --repo")
if not spec["card"].get("goal"):
    sys.exit("card.goal is required")
if not spec["card"].get("done_criteria"):
    sys.exit("at least one done criterion is required")
conn = sqlite3.connect(os.path.join(os.environ["USTABASI_STATE_DIR"], "ustabasi.db"))
now = time.time()
tid = conn.execute("SELECT COALESCE(MAX(id), 0) FROM tickets").fetchone()[0] + 1
conn.execute("INSERT INTO tickets (id,title,status,stage,round,repo,branch,base_branch,"
             "worktree,run_dir,created_at,updated_at,started_at,finished_at,card,"
             "escalation,verdict,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
             (tid, spec["title"], "queued", "worker", 1, spec["repo"], None,
              spec.get("base_branch") or "main", None, None, now, now, None, None,
              json.dumps(spec["card"]), "", None, "[]"))
conn.commit()
print("#%d queued: %s  (worker opus, verifier opus)" % (tid, spec["title"]))
"""

QDB = QUEUE / "ustabasi.db"
CLI = QUEUE / "ustabasi"
u.DB_PATH = QDB
u.HEARTBEAT = QUEUE / "supervisor.heartbeat"
u.CLI = CLI
(QUEUE / "supervisor.heartbeat").write_text("")


def queue_ticket(tid: int, title: str, repo: str, status: str, *,
                 escalation: str = "", goal: str = "g",
                 done: list[str] | None = None, run_dir: str | None = None) -> None:
    now = time.time()
    conn = sqlite3.connect(QDB)
    conn.execute(
        "INSERT INTO tickets (id,title,status,stage,round,repo,branch,base_branch,worktree,"
        "run_dir,created_at,updated_at,started_at,finished_at,card,escalation,verdict,notes)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, title, status, "worker", 1, repo, None, "main", None, run_dir,
         now - 100, now, now - 90, None,
         json.dumps({"goal": goal, "done_criteria": done or ["it works"]}),
         escalation, None, "[]"))
    conn.commit()
    conn.close()


def queue_status(tid: int, status: str, escalation: str = "") -> None:
    conn = sqlite3.connect(QDB)
    conn.execute("UPDATE tickets SET status=?, escalation=?, updated_at=? WHERE id=?",
                 (status, escalation, time.time(), tid))
    conn.commit()
    conn.close()


def queue_count() -> int:
    conn = sqlite3.connect(QDB)
    n = conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
    conn.close()
    return n


def queue_card(tid: int) -> dict:
    conn = sqlite3.connect(QDB)
    row = conn.execute("SELECT card FROM tickets WHERE id=?", (tid,)).fetchone()
    conn.close()
    return json.loads(row[0])


async def wire() -> None:
    db = fresh_db("wire")
    host = Host(db)
    board = db.divan

    # ── 7 · a machine with no queue ──────────────────────────────────────────
    check("no queue is not an error and not an empty one",
          (await host.h_ustabasi_list(None, {}))["available"], False)
    check("and nothing is imported from it", board.list_projects(), [])

    conn = sqlite3.connect(QDB)
    conn.executescript(QUEUE_SCHEMA)
    conn.commit()
    conn.close()

    # ── 8 · the tickets that already existed become cards ────────────────────
    #
    # Onto boards somebody made. A product exists because a person said it does
    # — `divan.project.create` and nothing else — so the three this queue is
    # working on are created before the first poll. One of them is created the
    # way the real one is: a visible name that is nothing like the folder every
    # machine knows it by.
    board.create_project("babysee", repos=[str(ROOT / "babysee")])
    board.create_project("isghocam", repos=[str(ROOT / "isghocam")])
    board.create_project("Divan", slug="remote-ai-chat",
                         repos=[str(ROOT / "remote-ai-chat")])

    run_dir = tmp / "run-1"
    run_dir.mkdir()
    (run_dir / "stdout.log").write_text("".join(json.dumps(r) + "\n" for r in [
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "reading the migration"}]}},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "pytest"}}]}},
    ]))
    queue_ticket(1, "the invite mail never arrives", str(ROOT / "babysee"), "running",
                 goal="Find where the mail is dropped.", run_dir=str(run_dir))
    queue_ticket(2, "rank tracking is stale", str(ROOT / "isghocam"), "queued")
    queue_ticket(3, "the verifier turned this down", str(ROOT / "babysee" / "app"), "failed")
    queue_ticket(4, "which account should this use?", str(ROOT / "isghocam"), "blocked",
                 escalation="Which account should the beta use?")
    queue_ticket(5, "a job on a repository nobody registered", "/elsewhere/ledger", "done")
    queue_ticket(6, "the board draws nothing on the second wall",
                 str(ROOT / "remote-ai-chat" / "app"), "queued")
    queue_ticket(7, "rank tracking shipped", str(ROOT / "isghocam"), "done")

    rows = lambda: sqlite3.connect(str(tmp / "wire.sqlite")).execute(
        "SELECT id, slug, name, archived, hidden FROM projects").fetchall()
    before_rows = rows()
    snap = await host.h_ustabasi_list(None, {})
    check("the wall still answers what it always did", len(snap["tickets"]), 7)

    check("a poll of a queue full of tickets writes no project of its own",
          rows(), before_rows)
    names = sorted(p["name"] for p in board.list_projects())
    check("the products are the ones somebody created, and no more",
          names, ["Divan", "babysee", "isghocam"])
    by_ticket = {c["ustabasi_id"]: c for c in board.cards()}
    check("every ticket is a card", sorted(by_ticket), [1, 2, 3, 4, 5, 6, 7])
    check("a ticket in a folder under a product belongs to the product",
          board.get_project(by_ticket[3]["project_id"])["name"], "babysee")
    check("…by the path and not by the name of the folder",
          board.get_project(by_ticket[6]["project_id"])["name"], "Divan")
    check("and the name the person gave it is untouched by having work under it",
          [(p["name"], p["slug"]) for p in board.list_projects()
           if p["slug"] == "remote-ai-chat"], [("Divan", "remote-ai-chat")])
    check("a ticket out of a folder no product owns is not lost",
          bool(by_ticket[5]), True)
    check("…it is in the holding place",
          by_ticket[5]["project_id"], board.unfiled_project()["id"])
    check("…which is in no project list",
          [p["slug"] for p in board.list_projects() if p["slug"] == divan.UNFILED], [])
    check("every one of them is engineering work",
          {c["branch"] for c in by_ticket.values()}, {"engineering"})
    check("and the coding executor's", {c["executor"] for c in by_ticket.values()},
          {"coding_agent"})
    check("on this machine", by_ticket[1]["machine"], "this-mac")

    # The one moment a status decides a column, and it happens once per ticket.
    check("a running ticket lands in progress", by_ticket[1]["column"], "in_progress")
    check("a queued one in the queue", by_ticket[2]["column"], "queued")
    check("one that was turned down is still in progress, with a mark on it",
          (by_ticket[3]["column"], by_ticket[3]["agent_status"]), ("in_progress", "failed"))
    check("one that stopped to ask, likewise",
          (by_ticket[4]["column"], by_ticket[4]["agent_status"]), ("in_progress", "asking"))
    check("and the question is on the card",
          by_ticket[4]["agent_detail"], "Which account should the beta use?")
    check("a finished one is done", by_ticket[5]["column"], "done")
    check("…and reads as verified, which is the verifier's word, not yours",
          by_ticket[5]["agent_status"], "verified")

    check("the ticket's title is the human face",
          by_ticket[1]["title"], "the invite mail never arrives")
    check("and the agent's goal never lands on it", by_ticket[1]["summary"], "")
    check("it lands on the agent face, where it belongs",
          board.get_card(by_ticket[1]["id"])["agent"]["goal"],
          "Find where the mail is dropped.")

    before = {c["id"]: (c["column"], c["position"]) for c in board.cards()}
    again = await host.h_ustabasi_list(None, {})
    check("the same snapshot twice imports nothing twice", len(board.cards()), 7)
    check("and moves nothing", {c["id"]: (c["column"], c["position"])
                                for c in board.cards()}, before)
    check("the wall is unchanged by having been mirrored",
          [t["id"] for t in again["tickets"]], [1, 2, 3, 4, 5, 6, 7])

    # ── 9 · a status change never moves a column ─────────────────────────────
    #
    # The card is put somewhere on purpose first — a place no status mapping
    # would ever choose — and then every status the queue has is walked past it.
    card_id = by_ticket[1]["id"]
    board.move(card_id, "ice_box", 0)
    placed = board.get_card(card_id)
    check("a card is where the person put it", (placed["column"], placed["position"]),
          ("ice_box", 0))

    for status, escalation, expected in [
        ("running", "", "running"),
        ("blocked", "Which way should this go?", "asking"),
        ("blocked", "", "blocked"),
        ("failed", "", "failed"),
        ("done", "", "verified"),
        ("cancelled", "", "cancelled"),
        ("queued", "", "queued"),
    ]:
        queue_status(1, status, escalation)
        await host.h_ustabasi_list(None, {})
        now = board.get_card(card_id)
        check(f"'{status}' is mirrored as '{expected}'", now["agent_status"], expected)
        check(f"…and moves nothing: the card is still where it was put ({status})",
              (now["column"], now["position"]), ("ice_box", 0))
    check("the question that came with it is on the card too",
          board.get_card(card_id)["agent_detail"], "")

    # ── 10 · dragging into In Progress files a ticket ────────────────────────
    CLI.write_text(CLI_STUB)
    CLI.chmod(0o755)

    bs = board.project_by_name("babysee")
    plain = board.create_card(bs["id"], title="the receipts page prints blank",
                              summary="Only on iPad. Started after the PDF change.")
    check("a card written from a conversation has nobody on it", plain["executor"], None)

    moved = await host.h_divan_card_move(None, {"card_id": plain["id"],
                                                "column": "in_progress"})
    check("in progress with no executor starts nothing",
          (moved["card"]["ustabasi_id"], moved["error"]), (None, None))

    await host.h_divan_card_executor(None, {"card_id": plain["id"],
                                            "executor": "coding_agent"})
    moved = await host.h_divan_card_move(None, {"card_id": plain["id"],
                                                "column": "in_progress", "position": 0})
    tid = moved["card"]["ustabasi_id"]
    holds("dragging it in on the coding executor files a ticket", bool(tid), repr(moved))
    check("and nothing went wrong doing it", moved["error"], None)
    check("the card says it is queued there now", moved["card"]["agent_status"], "queued")

    filed = queue_card(tid)
    check("with no goal of its own, the human face stands in",
          filed["goal"], "Only on iPad. Started after the PDF change.")
    check("and the title is the one thing done means",
          filed["done_criteria"], ["the receipts page prints blank"])
    check("the repository is the product's", queue_card(tid) and
          sqlite3.connect(QDB).execute("SELECT repo FROM tickets WHERE id=?",
                                       (tid,)).fetchone()[0], str(ROOT / "babysee"))

    # Filed once. Dragging it out and back in does not file it twice.
    board.move(plain["id"], "queued")
    again = await host.h_divan_card_move(None, {"card_id": plain["id"],
                                               "column": "in_progress"})
    check("a card that has already been filed is not filed again",
          again["card"]["ustabasi_id"], tid)
    check("and the queue has one ticket for it, not two",
          sqlite3.connect(QDB).execute(
              "SELECT COUNT(*) FROM tickets WHERE title=?",
              ("the receipts page prints blank",)).fetchone()[0], 1)

    # The agent face, where somebody wrote one, is what goes.
    written = board.create_card(
        bs["id"], title="split the upload path", executor="coding_agent",
        agent={"goal": "Give video its own uploader.", "done_criteria": ["one path each"],
               "verify_cmd": "npm test", "constraints": ["no UI work"],
               "paths": ["daemon/"], "notes": "the old path stays until the next release"})
    out = await host.h_divan_card_move(None, {"card_id": written["id"],
                                              "column": "in_progress"})
    spec = queue_card(out["card"]["ustabasi_id"])
    check("the agent face is what the queue is handed", spec["goal"],
          "Give video its own uploader.")
    check("with its criteria", spec["done_criteria"], ["one path each"])
    check("its test", spec["verify_cmd"], "npm test")
    check("its constraints", spec["constraints"], ["no UI work"])
    check("and the paths it may touch", spec["allowed"], ["daemon/"])

    # ── 11 · a queue that will not take it ───────────────────────────────────
    lonely = board.create_project("a product with no repository")
    orphan = board.create_card(lonely["id"], title="write the launch note",
                               executor="coding_agent")
    out = await host.h_divan_card_move(None, {"card_id": orphan["id"],
                                              "column": "in_progress"})
    check("a card with nowhere to work says why", out["error"],
          "this project has no repository to work in")
    check("and stays exactly where the finger left it",
          (out["card"]["column"], out["card"]["ustabasi_id"]), ("in_progress", None))

    CLI.unlink()
    gone = board.create_card(bs["id"], title="a card filed on a machine with no queue",
                             executor="coding_agent")
    out = await host.h_divan_card_move(None, {"card_id": gone["id"],
                                              "column": "in_progress"})
    check("a machine with no queue says so", out["error"],
          "ustabasi is not installed on this machine")
    check("and the card is still in progress, not sprung back",
          out["card"]["column"], "in_progress")
    CLI.write_text(CLI_STUB)
    CLI.chmod(0o755)

    # ── 11b · where a coding agent may be pointed ────────────────────────────
    #
    # A card's repository is where an autonomous worker gets a shell. Every
    # other client-supplied path on this daemon goes through the allowed roots
    # — a chat's cwd does, `/files` does — and these three arrive from exactly
    # the same place. Without the fence, "create a project on the home
    # directory" and one drag is a worker loose in it.

    fenced = board.project_by_name("babysee")
    for name, data in [
        ("h_divan_project_create",
         {"name": "somewhere else entirely", "repos": [str(OUTSIDE)]}),
        ("h_divan_card_create",
         {"project_id": fenced["id"], "title": "t", "repo": str(OUTSIDE)}),
    ]:
        try:
            await getattr(host, name)(None, data)
            holds(f"{name} refuses a repository outside every root", False, "it was accepted")
        except Exception as exc:
            check(f"{name} refuses a repository outside every root",
                  getattr(exc, "code", None), "cwd_outside")

    fence_card = board.create_card(fenced["id"], title="a card to point somewhere")
    try:
        await host.h_divan_card_update(None, {"card_id": fence_card["id"],
                                              "repo": str(OUTSIDE)})
        holds("h_divan_card_update refuses one too", False, "it was accepted")
    except Exception as exc:
        check("h_divan_card_update refuses one too", getattr(exc, "code", None),
              "cwd_outside")
    check("and the card's repository is untouched by the attempt",
          board.get_card(fence_card["id"])["repo"], str(ROOT / "babysee"))

    try:
        await host.h_divan_card_create(None, {"project_id": fenced["id"], "title": "t",
                                              "repo": str(ROOT / "secrets")})
        holds("a denied path inside a root is refused as well", False, "it was accepted")
    except Exception as exc:
        check("a denied path inside a root is refused as well",
              getattr(exc, "code", None), "cwd_outside")
    try:
        await host.h_divan_card_create(None, {"project_id": fenced["id"], "title": "t",
                                              "repo": str(ROOT / "never-existed")})
        holds("a folder that is simply not there says so", False, "it was accepted")
    except Exception as exc:
        check("a folder that is simply not there says so",
              getattr(exc, "code", None), "no_such_folder")
    inside = await host.h_divan_card_create(None, {
        "project_id": fenced["id"], "title": "a card pointed somewhere allowed",
        "repo": str(ROOT / "babysee" / "app")})
    check("a repository inside a root is taken", inside["repo"],
          str(ROOT / "babysee" / "app"))

    # The way in is fenced; so is the way out. A card whose repository is
    # outside the roots by some route the handlers do not cover — the import
    # files them from the queue's own rows, which answer to nobody here — still
    # never becomes a worktree.
    check("a card imported out of a folder nobody registered kept that folder",
          policy.is_allowed_cwd(board.card_by_ustabasi(5)["repo"]), False)
    loose = board.create_card(board.unfiled_project()["id"],
                              title="work in a folder nobody allowed",
                              executor="coding_agent", repo=str(OUTSIDE))
    before = queue_count()
    out = await host.h_divan_card_move(None, {"card_id": loose["id"],
                                              "column": "in_progress"})
    check("a card pointed outside the roots is never filed", out["error"],
          "that folder is outside the allowed roots")
    check("nothing was written on it", out["card"]["ustabasi_id"], None)
    check("and the queue was never asked", queue_count(), before)

    # ── 11c · the mirror landing in the middle of a filing ───────────────────
    #
    # Filing is: hand the spec to the CLI, wait for it, write the number back.
    # A poll that lands in that gap sees a ticket with no card and imports it —
    # which is what the mirror is *for* — and the board would end with two cards
    # for one ticket and a unique index refusing the second. Reproduced exactly
    # by polling from inside the call the filing is waiting on.

    real_add = u.add

    async def add_then_poll(spec):
        tid = await real_add(spec)
        await host.h_ustabasi_list(None, {})          # the mirror, mid-filing
        return tid

    raced = board.create_card(bs["id"], title="two things happening at once",
                              executor="coding_agent")
    u.add = add_then_poll
    try:
        out = await host.h_divan_card_move(None, {"card_id": raced["id"],
                                                  "column": "in_progress", "position": 0})
    finally:
        u.add = real_add

    tid = out["card"]["ustabasi_id"]
    holds("a poll landing mid-filing does not turn the drag into a failure",
          out["error"] is None and bool(tid), repr(out["error"]))
    carrying = [c for c in board.cards() if c["ustabasi_id"] == tid]
    check("exactly one card carries the ticket", len(carrying), 1)
    check("and it is the one that was dragged", carrying[0]["id"], raced["id"])
    check("which is still where the finger put it",
          (carrying[0]["column"], carrying[0]["position"]), ("in_progress", 0))
    check("the status the mirror had already read comes across",
          carrying[0]["agent_status"], "queued")
    check("the card the mirror made in the gap is gone",
          [c["title"] for c in board.cards()
           if c["title"] == "two things happening at once"],
          ["two things happening at once"])
    for col in divan.COLUMNS:
        check(f"and the '{col}' column closed up behind it",
              [c["position"] for c in board.board(bs["id"])["columns"][col]],
              list(range(len(board.board(bs["id"])["columns"][col]))))

    after_poll = await host.h_ustabasi_list(None, {})
    check("a later poll mirrors that card rather than importing it again",
          len([c for c in board.cards() if c["ustabasi_id"] == tid]), 1)
    check("and the wall is unbothered by any of it",
          any(t["id"] == tid for t in after_poll["tickets"]), True)

    # ── 12 · the requests, as a client sends them ────────────────────────────
    projects = await host.h_divan_projects(None, {})
    names = [p["name"] for p in projects["projects"]]
    holds("every product is listed", "babysee" in names and "isghocam" in names, repr(names))
    one = next(p for p in projects["projects"] if p["name"] == "babysee")
    check("with its branches", [b["kind"] for b in one["branches"]], list(divan.BRANCH_KINDS))
    holds("and a line saying where it stands", bool(one["summary_line"]), repr(one))
    check("the computer answering says which one it is", projects["machine"], "this-mac")

    made = await host.h_divan_project_create(None, {"name": "a new product",
                                                    "repos": [str(ROOT / "a-new-product")],
                                                    "branches": ["finance"]})
    check("a product can be created over the wire", made["name"], "a new product")
    check("with an extra branch of its own",
          [b["kind"] for b in made["branches"]][-1], "finance")

    b = await host.h_divan_board(None, {"project_id": one["id"]})
    check("a board comes back as four columns", sorted(b["columns"]), sorted(divan.COLUMNS))
    check("each in the order somebody put it in",
          [c["position"] for c in b["columns"]["in_progress"]],
          list(range(len(b["columns"]["in_progress"]))))
    check("and the project it belongs to comes with it", b["project"]["name"], "babysee")

    created = await host.h_divan_card_create(None, {
        "project_id": one["id"], "title": "the Android build is 40 MB bigger",
        "summary": "Since the map SDK landed."})
    check("a card can be created from the human face alone",
          (created["title"], created["column"]), ("the Android build is 40 MB bigger",
                                                  "ice_box"))
    check("and it is stamped with the machine it was written on",
          created["machine"], "this-mac")

    got = await host.h_divan_card_get(None, {"card_id": created["id"]})
    check("an unopened card has both faces", sorted(got["card"]["agent"]),
          ["constraints", "done_criteria", "goal", "notes", "paths", "verify_cmd"])
    check("and nothing running on it", (got["run"], got["ticket"]), (None, None))

    running = board.card_by_ustabasi(1)
    got = await host.h_divan_card_get(None, {"card_id": running["id"]})
    check("a card with a ticket carries the ticket", got["ticket"]["id"], 1)
    check("and a page of what the worker has printed", got["run"]["available"], True)
    kinds = [e["k"] for e in got["run"]["events"]]
    holds("with the agent's own words in it", "text" in kinds and "tool" in kinds,
          repr(kinds))
    holds("and a cursor to ask for the next page with",
          isinstance(got["run"]["cursor"], str), repr(got["run"].get("cursor")))

    updated = await host.h_divan_card_update(None, {
        "card_id": created["id"], "summary": "Since the map SDK landed, on Pixel too.",
        "agent": {"goal": "Find what the SDK pulls in.",
                  "done_criteria": ["the apk is back under 30 MB"]}})
    check("a card's faces can be rewritten over the wire",
          updated["summary"], "Since the map SDK landed, on Pixel too.")
    check("including the agent face it did not have",
          updated["agent"]["goal"], "Find what the SDK pulls in.")
    check("and the title nobody touched is the title it had",
          updated["title"], "the Android build is 40 MB bigger")

    executor = await host.h_divan_card_executor(None, {"card_id": created["id"],
                                                       "executor": "human"})
    check("an executor can be set over the wire", executor["executor"], "human")
    cleared = await host.h_divan_card_executor(None, {"card_id": created["id"],
                                                      "executor": None})
    check("and cleared", cleared["executor"], None)

    # ── 13 · one answer per machine ──────────────────────────────────────────
    #
    # The phone is paired with several computers and draws all of them at once.
    # Asked project by project that is a dozen round trips per machine, and a
    # dozen waits on one that is asleep, so everything a Divan screen needs
    # comes back in one request — including which computer answered, when the
    # answer was true, and what is left of the plans the agents run on.

    now = time.time()
    # A worker picks up ticket 3 again. Ticket 1's card was dragged to the Ice
    # Box a few checks ago to prove the mirror moves nothing, and a card nobody
    # is working is no use to a check about agents at work.
    queue_status(3, "running")
    worked = board.card_by_ustabasi(3)
    # One sign-in a third of the way through a window that comes back in four
    # hours, and one nothing has ever been measured on.
    host.limits["acct-2"] = [{"window": "five_hour", "status": "allowed",
                              "utilization": 0.36, "resets_at": now + 4 * 3600,
                              "at": now}]
    snapshot = await host.h_divan_snapshot(None, {})
    check("the machine that answered says which one it is", snapshot["machine"], "this-mac")
    holds("and when the answer was true",
          abs(snapshot["at"] - time.time()) < 5, repr(snapshot.get("at")))
    holds("every product is in it, with its line",
          {p["name"] for p in snapshot["projects"]} >= {"babysee", "isghocam"}
          and all(p["summary_line"] for p in snapshot["projects"]),
          repr([p["name"] for p in snapshot["projects"]]))
    check("the cards are the open board and nothing that is finished with",
          {c["column"] for c in snapshot["cards"]} & {"done"}, set())
    holds("which is not the whole board: the counts still say what is in done",
          any(p["counts"]["done"] for p in snapshot["projects"]),
          repr([p["counts"] for p in snapshot["projects"]]))
    check("a card that has been given a machine carries it",
          {c["machine"] for c in snapshot["cards"] if c["machine"]}, {"this-mac"})
    # And one nobody assigned stays unassigned. The answer does not invent a
    # machine for it: the reader knows which computer answered and falls back to
    # that, which is where such a card would be worked anyway — a guess written
    # into the field would be indistinguishable from somebody's decision.
    holds("and one nobody assigned is left alone rather than guessed at",
          any(c["machine"] is None for c in snapshot["cards"]),
          repr([(c["title"], c["machine"]) for c in snapshot["cards"]]))
    ids = {p["id"] for p in snapshot["projects"]}
    check("and no card belongs to a project the answer never mentioned",
          [c["id"] for c in snapshot["cards"] if c["project_id"] not in ids], [])

    running = [a for a in snapshot["agents"]]
    holds("the agents are the ones actually running",
          bool(running) and {a["status"] for a in running} == {"running"},
          repr([(a["title"], a["status"]) for a in running]))
    holds("each saying what it is on, for which product, on which machine",
          all(a["title"] and a["project"] and a["machine"] == "this-mac" for a in running),
          repr(running))
    asking = [c for c in snapshot["cards"] if c["agent_status"] == "asking"]
    holds("a card that stopped to ask is not an agent at work",
          bool(asking) and not any(a["card_id"] == asking[0]["id"] for a in running),
          repr([a["card_id"] for a in running]))

    # What git says about the products on this machine, which is the one thing
    # on the answer that is not the board — and the only thing that can say
    # whether a product with an empty board is alive.
    act = snapshot["activity"]
    mine = act.get(str(ROOT / "babysee"))
    holds("a product's repository says when it last moved",
          bool(mine) and abs(mine["at"] - (time.time() - 120)) < 30, repr(act))
    check("…and how much was finished in the last seven days", mine["week"], 1)
    check("…and how much of that was today", mine["today"], 1)
    holds("a folder that is not a repository is absent rather than zero",
          str(ROOT / "isghocam") not in act, repr(sorted(act)))
    holds("…and so is one nobody could read",
          divan.repo_activity(str(tmp / "never-existed")) is None)
    check("the map is keyed by path, so two machines cannot count one checkout twice",
          sorted(divan.activity_of([str(ROOT / "babysee"), str(ROOT / "babysee")])),
          [str(ROOT / "babysee")])
    # The phone gives a machine eight seconds for the whole answer. Twenty cold
    # repositories must not be able to spend it, so new readings run against a
    # budget: what is already known still travels, and a path nobody has had
    # time to read is absent until the next poll.
    divan._activity_cache.pop(str(tmp / "unread"), None)
    check("a repository there was no time to read is absent rather than holding up the answer",
          divan.activity_of([str(tmp / "unread")], budget_s=-1), {})
    holds("…while one that was read before still travels, budget or no budget",
          str(ROOT / "babysee") in divan.activity_of([str(ROOT / "babysee")], budget_s=-1))

    q = snapshot["quota"]
    check("the quota is this machine's, read off the pool", q["accounts"], len(ACCOUNTS))
    holds("what is left is the roomiest sign-in's share of a window",
          abs((q["left"] or 0) - 0.64) < 0.001, repr(q))
    holds("with the time it goes back up",
          q["resets_at"] and abs(q["resets_at"] - (now + 4 * 3600)) < 5, repr(q))
    check("and nothing is spent", (q["spent"], q["blocked"]), (False, 0))

    # Both sign-ins full, and one of them is not coming back for four hours:
    # the machine cannot start an agent, and the honest thing to say is when it
    # can rather than how much of nothing is left.
    host.limits["acct-2"] = [{"window": "five_hour", "status": "rejected",
                              "utilization": 1.0, "resets_at": now + 4 * 3600,
                              "at": now}]
    host.limits["default-claude"] = [{"window": "five_hour", "status": "rejected",
                                      "utilization": 1.0, "resets_at": now + 5 * 3600,
                                      "at": now}]
    spent = (await host.h_divan_snapshot(None, {}))["quota"]
    check("a machine whose every sign-in is full says so",
          (spent["spent"], spent["blocked"], spent["left"]), (True, 2, 0.0))
    holds("…and when work picks up again, which is the first one back",
          spent["resets_at"] and abs(spent["resets_at"] - (now + 4 * 3600)) < 5, repr(spent))
    host.limits.clear()
    empty = (await host.h_divan_snapshot(None, {}))["quota"]
    check("a machine nobody has run anything on has not run out of anything",
          (empty["spent"], empty["left"], empty["unknown"]), (False, None, True))

    # What a poll costs. The mirror reads statuses; the commit counts are a
    # `git log` per worktree, one subprocess each, and on a real queue of
    # twenty-five tickets they were three and a half seconds of a four-second
    # answer — long enough for the phone's own timeout to give up on a computer
    # that was answering perfectly well. The wall still asks for them.
    real_git, asked = u._git, []
    u._git = lambda *a, **kw: asked.append(a) or None
    try:
        await host.h_divan_snapshot(None, {})
        check("a board poll does not pay for a git log per worktree", asked, [])
        await host.h_ustabasi_list(None, {})
        holds("…and the wall, which draws them, still asks", bool(asked), repr(asked))
    finally:
        u._git = real_git

    check("the coding executor's own state comes along",
          snapshot["queue"]["available"], True)
    holds("including whether it is paused", "paused_until" in snapshot["queue"],
          repr(snapshot["queue"]))

    # The mirror is what makes any of it true, and a dashboard may never open
    # the wall: a snapshot that only read the board would draw a worker that
    # finished in the night as still running.
    queue_status(3, "done")
    after = await host.h_divan_snapshot(None, {})
    check("the snapshot mirrors the queue on its way past",
          board.card_by_ustabasi(3)["agent_status"], "verified")
    check("so an agent that finished is no longer running anywhere in it",
          [a["card_id"] for a in after["agents"] if a["ustabasi_id"] == 3], [])
    check("and its card is still exactly where it was left",
          board.card_by_ustabasi(3)["column"], worked["column"])

    for name, data, code in [
        ("h_divan_board", {"project_id": "nope"}, "no_such_project"),
        ("h_divan_card_get", {"card_id": "nope"}, "no_such_card"),
        ("h_divan_card_move", {"card_id": "nope", "column": "done"}, "bad_move"),
        ("h_divan_card_move", {"card_id": created["id"], "column": "later"}, "bad_move"),
        ("h_divan_card_create", {"project_id": "nope", "title": "t"}, "bad_card"),
        ("h_divan_card_executor", {"card_id": "nope", "executor": "human"}, "bad_executor"),
        ("h_divan_project_create", {"name": "babysee"}, "bad_project"),
        ("h_divan_card_update", {"card_id": "nope", "title": "t"}, "no_such_card"),
        ("h_divan_card_update", {"card_id": created["id"], "title": " "}, "bad_card"),
    ]:
        try:
            await getattr(host, name)(None, data)
            holds(f"{name} refuses {data}", False, "it was accepted")
        except Exception as exc:
            check(f"{name} refuses {data} by name", getattr(exc, "code", None), code)


asyncio.run(wire())

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — the board: migration, the two faces, the order, the mirror, and the wire")
