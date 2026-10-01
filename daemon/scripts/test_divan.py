#!/usr/bin/env python3
"""The Divan board: the model, the wire, and the one rule under both.

    .venv312/bin/python scripts/test_divan.py

Until this landed, the only work object on the computer was the ustabasi queue,
and a queue has no columns, no order somebody chose, no branches beside the
code, no human/agent split and no executor. Every Divan screen needs all five,
so they are here — and so is the rule they are arranged around:

**A card the coding agent has follows its ticket; a card a person has follows
the person.** Nobody drags tickets across a board by hand: the queue already
knows where each one is, and the mirror, on the ordinary snapshot poll, writes
that into the status mark *and* the column — a worker picking a ticket up puts
its card in In Progress, a verifier passing it puts it in Done. The move
happens on a status change, not on every poll: a card somebody dragged
elsewhere in the meantime stays there until the ticket next goes somewhere,
and then the status wins. It is checked here from both ends: every status the
queue has walked past one card, the card landing where each one means; and a
board from before the rule, whose cards had been left wherever they were
imported, coming right on the first poll.

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
  * the tickets that already existed become cards, on the board of the product
    that owns the folder they are in;
  * and **a poll creates nothing**: no product, no branch, not a repository
    added to somebody's product because a ticket mentioned a folder inside it.
    Every ticket in that queue names a folder and the mirror used to be allowed
    to make a product out of it, which is how the machine this runs on came to
    have seventeen projects nobody had decided on. What cannot be placed waits
    in the one hidden holding row — in no list and no count — and moves onto a
    real board the poll after a product claims its path.

Nothing here talks to the network or starts a model. The queue is a SQLite file
and a stub CLI built here, the way `test_ustabasi.py` builds one: its database
belongs to another program, so its tables are written out by hand rather than
imported.
"""
from __future__ import annotations

import ast
import asyncio
import json
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
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
for name in ("babysee", "isghocam", "a-new-product", "secrets", "remote-ai-chat",
             "yatak-kontrol"):
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
# …and it has a GitHub remote, because the one reading on the snapshot that
# leaves this machine is the code host's and it is only ever made for a checkout
# whose `origin` is one. isghocam has none, which is the other half of that.
_git("remote", "add", "origin", "git@github.com:t/babysee.git")


class GH:
    """`gh`, stubbed. Nothing in this file talks to the network, so the one
    function in `divan` that would is replaced here before anything can call
    it: `GH.answer` is what `gh pr list` would have printed, and `None` is a
    machine with no `gh`, no sign-in or no network."""

    answer: str | None = None


divan._gh = lambda path, *args: GH.answer


def pull(number: int, title: str, rollup: list | None, *, minutes: int = 0,
         draft: bool = False) -> dict:
    """One row of what `gh pr list --json` prints."""
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - minutes * 60))
    return {"number": number, "title": title, "headRefName": f"pr/{number}",
            "isDraft": draft, "updatedAt": at, "statusCheckRollup": rollup}


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
        # The mirror runs one at a time on a real server, and the handler
        # borrowed below takes that lock.
        self._mirror_lock = asyncio.Lock()
        self.pool = Pool(PoolSettings.from_dict({"enabled": True}),
                         lambda: ACCOUNTS, lambda k: self.limits.get(k, []))
        for attr in dir(Server):
            if (attr.startswith("h_divan_") or attr == "h_ustabasi_list"
                    or attr in ("_checked_repo", "_mirrored_queue")):
                setattr(self, attr, getattr(Server, attr).__get__(self))


# ── 0 · two of everything at once ────────────────────────────────────────────
# The mirror is not a thing one caller does: the panel polls the board, the
# phone polls it, and the wall polls the queue, all every few seconds and all
# through the same database connection. Two passes that interleave read "no
# card has ticket 71" at the same moment and both write one — the unique index
# refuses the second, the connection is left in a failed transaction, and the
# pass dies where it stands having written **no statuses at all**. On a real
# board that reads as a card that will not stay where it was dragged and a mark
# two rounds old.

def race_probe() -> None:
    import threading
    path = tmp / "race.sqlite"
    if path.exists():
        path.unlink()
    rdb = DB(path)
    board = rdb.divan
    project = board.create_project("babysee", repos=[str(ROOT / "babysee")])
    snapshot = {"available": True, "tickets": [
        {"id": 900 + i, "title": f"ticket {900 + i}", "status": "queued", "stage": "worker",
         "round": 1, "repo": str(ROOT / "babysee"), "goal": "", "done_criteria": [],
         "escalation": "", "notes": [], "verdict": None, "git": None,
         "created_at": 1.0, "updated_at": 1.0, "started_at": None,
         "round_started_at": None, "finished_at": None, "note_count": 0,
         "last_event": None, "project": "babysee", "branch": None}
        for i in range(12)]}
    errors: list[str] = []

    def pass_once() -> None:
        try:
            board.sync_ustabasi(snapshot, "this-mac", policy.project_for)
        except Exception as exc:                       # noqa: BLE001 — the point
            errors.append(f"{type(exc).__name__}: {exc}")

    threads = [threading.Thread(target=pass_once) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    check("six mirrors at once, and not one of them fell over", errors, [])
    cards = {c["ustabasi_id"] for c in board.cards()}
    check("…every ticket has a card", sorted(cards), [900 + i for i in range(12)])
    counts = rdb._c.execute(
        "SELECT ustabasi_id, count(*) FROM cards GROUP BY ustabasi_id HAVING count(*) > 1"
    ).fetchall()
    check("…and not one of them has two", counts, [])
    check("…and the statuses were written, which is what a pass that died never did",
          {c["agent_status"] for c in board.cards()}, {"queued"})
    check("the product nobody touched is still the product",
          board.get_project(project["id"])["name"], "babysee")


race_probe()


# ── 0b · the column between the writing and the end ──────────────────────────
# A ticket being verified looked exactly like a ticket being written: both
# `running`, both In Progress. The board could not answer the one question it
# is for — what is left to do — because half of In Progress was already done
# and waiting on a check.

def review_probe() -> None:
    ticket = {"id": 300, "title": "a ticket walking its stages", "status": "queued",
              "stage": "worker", "round": 1, "repo": str(ROOT / "babysee"),
              "goal": "", "done_criteria": [], "escalation": "", "notes": [],
              "verdict": None, "git": None, "created_at": 1.0, "updated_at": 1.0,
              "started_at": None, "round_started_at": None, "finished_at": None,
              "note_count": 0, "last_event": None, "project": "babysee",
              "branch": None, "steps": []}
    walk = [
        ({"status": "queued", "stage": "worker"}, "queued"),
        ({"status": "running", "stage": "worker"}, "in_progress"),
        # The queue deciding what to do about a worker that stopped is still
        # the writing of it, not a review of it.
        ({"status": "running", "stage": "triage"}, "in_progress"),
        ({"status": "running", "stage": "check"}, "review"),
        ({"status": "running", "stage": "verifier"}, "review"),
        # A verifier that turns it down hands it back to a worker.
        ({"status": "running", "stage": "worker"}, "in_progress"),
        ({"status": "running", "stage": "verifier"}, "review"),
        ({"status": "done", "stage": "verifier"}, "done"),
    ]
    for patch, column in walk:
        check(f"{patch['status']} · {patch['stage']} belongs in {column}",
              divan.column_for({**ticket, **patch}), column)
    # …and a ticket that stopped is not in Review whatever stage it stopped on:
    # work that stopped is work, and a red card in the middle column is what
    # says so at seven in the morning.
    for status in ("blocked", "failed"):
        check(f"a {status} ticket stays where the work is",
              divan.column_for({**ticket, "status": status, "stage": "verifier"}),
              "in_progress")
    check("a cancelled one is finished with, wherever it was",
          divan.column_for({**ticket, "status": "cancelled", "stage": "check"}), "done")


review_probe()


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

# The same, for the four columns a project grew: what it is, what it is for,
# when it began, and the flag on the row that is not a product. There is real
# data in this table on the machine this runs on — four products and a board of
# cards — so the pass has to be additive and the rows have to come through it
# saying exactly what they said before.
older = tmp / "older-projects.sqlite"
conn = sqlite3.connect(older)
conn.row_factory = sqlite3.Row
conn.executescript("""
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  summary TEXT DEFAULT '', sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  created_at REAL, updated_at REAL);
""")
conn.execute("INSERT INTO projects (id,name,slug,summary,sort,archived,created_at,"
             "updated_at) VALUES ('p1','Divan','remote-ai-chat','',0,0,1.0,2.0)")
conn.execute("INSERT INTO projects (id,name,slug,summary,sort,archived,created_at,"
             "updated_at) VALUES ('p2','tutor-v3','tutor-v3','',0,1,1.0,2.0)")
conn.commit()
divan.migrate(conn)
check("the columns a project grew arrive on their own",
      {"kind", "started_at", "hidden", "stage"}
      <= {r[1] for r in conn.execute("PRAGMA table_info(projects)")}, True)
check("…and so does the table its history lives in",
      bool(conn.execute("SELECT name FROM sqlite_master WHERE type='table'"
                        " AND name='milestones'").fetchone()), True)
older_board = divan.Board(conn, threading.Lock())
kept = older_board.find_project("remote-ai-chat")
check("and the product that was there is word for word what it was",
      (kept["name"], kept["slug"], kept["summary"]), ("Divan", "remote-ai-chat", ""))
check("with the new fields simply empty",
      (kept["kind"], kept["started_at"], kept["stage"]), ("", None, ""))
check("a product that was archived is still archived",
      older_board.find_project("tutor-v3")["archived"], True)
check("…and the migration did not put it back on the board",
      [p["slug"] for p in older_board.list_projects()], ["remote-ai-chat"])
check("the holding place arrives with the migration, once",
      len(conn.execute("SELECT id FROM projects WHERE hidden=1").fetchall()), 1)
divan.migrate(conn)
check("…and running the migration again does not add a second",
      len(conn.execute("SELECT id FROM projects WHERE hidden=1").fetchall()), 1)
check("nor a second branch on it",
      len(older_board.branches(older_board.unfiled_project()["id"])), 1)
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

# ── what a product is still waiting on ──────────────────────────────────────
# Not the board: a card is work an agent can be handed, and these are the other
# kind — a key somebody has to make, a registrar sitting on a transfer. A
# product could read "closed beta" with nothing on this computer able to say
# what the beta was waiting for.
keys = board.add_open_item(bs["id"], "Payment provider keys",
                           body="The production parameter is still a placeholder.",
                           state="blocked", area="payments")
domain = board.add_open_item(bs["id"], "Custom domain approval",
                             state="waiting", owner="the registrar")
mail = board.add_open_item(bs["id"], "Write the onboarding mail")
check("an item needs only a line, and starts as nobody's to-do",
      (mail["state"], mail["owner"], mail["body"]), ("todo", "", ""))
refuses("an item with no title", board.add_open_item, bs["id"], "   ")
refuses("a state nothing can be in", board.add_open_item, bs["id"], "x", state="soon")
check("worst first: blocked, then waiting, then to-do",
      [o["title"] for o in board.open_items(bs["id"])],
      ["Payment provider keys", "Custom domain approval", "Write the onboarding mail"])

# The thread says who. A finding from the assistant read as the person's
# decision is how the wrong thing gets done.
board.comment_open_item(domain["id"], "Still pending as of this morning.", who="hermes")
board.comment_open_item(domain["id"], "Bedirhan has the registrar login.", who="you")
check("a comment keeps the voice that wrote it",
      [(c["who"], c["text"][:8]) for c in board.get_open_item(domain["id"])["comments"]],
      [("hermes", "Still pe"), ("you", "Bedirhan")])
refuses("an empty comment", board.comment_open_item, domain["id"], "  ")

# Settled items stay on the product: a beta is partly described by the list it
# got through. They sink, and the date is the day it closed.
done = board.update_open_item(keys["id"], state="done")
check("settling one stamps it and sinks it",
      (done["closed_at"] is not None,
       [o["title"] for o in board.open_items(bs["id"])][-1]),
      (True, "Payment provider keys"))
check("…and reopening clears the date rather than leaving one that lies",
      board.update_open_item(keys["id"], state="todo")["closed_at"], None)
check("a product's own answer carries them, so no page asks twice",
      [o["title"] for o in board.project_view(board.get_project(bs["id"]))["open_items"]][:1],
      ["Custom domain approval"])
board.delete_open_item(keys["id"])
board.delete_open_item(domain["id"])
board.delete_open_item(mail["id"])
check("and dropping one leaves the product with none",
      board.open_items(bs["id"]), [])

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

# ── 2b · what a product is, beside its name ──────────────────────────────────
#
# The table used to hold a name, a slug and a sort order, so the answer to "what
# is this project" was the folder it happened to be in. A product now says what
# kind of thing it is, what it is for, and when it actually began — none of it
# required, because the products that predate the fields have to keep working
# without them, and all of it written from the one entrance: the create and
# update calls an agent makes from a chat. There is no form for this anywhere in
# the clients and none is coming.

db = fresh_db("config")
board = db.divan

full_p = board.create_project(
    "Babysee", repos=[str(ROOT / "babysee")], kind="app",
    summary="A time capsule a parent fills in and a child opens at eighteen.",
    started_at="2026-03-01")
check("a product says what kind of thing it is", full_p["kind"], "app")
check("and what it is for", full_p["summary"],
      "A time capsule a parent fills in and a child opens at eighteen.")
holds("and when it actually began, which is not when the row was written",
      full_p["started_at"] and full_p["started_at"] < full_p["created_at"] - 86400,
      repr((full_p["started_at"], full_p["created_at"])))
check("the kind is an open set, not five choices",
      board.create_project("A client", kind="newsletter")["kind"], "newsletter")
check("…and is a word however it was typed",
      board.create_project("Research", kind="  Client Work  ")["kind"], "client-work")

bare = board.create_project("an old product")
check("none of it is required: the four products that predate it still open",
      (bare["kind"], bare["summary"], bare["started_at"]), ("", "", None))

# The name is what a screen says; the slug is what two computers match the same
# product by (`app/src/divan.ts projectKey`). They are separate for one real
# product — Divan, in ~/projects/remote-ai-chat — so the slug can be given.
divan_p = board.create_project("Divan", slug="remote-ai-chat")
check("a product's key can be the checkout every machine knows it by",
      (divan_p["name"], divan_p["slug"]), ("Divan", "remote-ai-chat"))

edited = board.update_project(divan_p["id"], name="Divan board", kind="web",
                             purpose="The board every project is run from.",
                             started_at="2026-09-28",
                             repos=[str(ROOT / "babysee" / "app")])
check("a product can be renamed", edited["name"], "Divan board")
check("…and the key does not move with the name, or two machines stop agreeing",
      edited["slug"], "remote-ai-chat")
check("its kind rewritten", edited["kind"], "web")
check("what it is for, said as a purpose, is the same field as the summary",
      edited["summary"], "The board every project is run from.")
check("its start date given", time.strftime("%Y-%m-%d",
                                           time.localtime(edited["started_at"])),
      "2026-09-28")
check("and its repositories are the list, not an addition to it",
      edited["repos"], [str(ROOT / "babysee" / "app")])
check("only what was sent is touched",
      board.update_project(divan_p["id"], sort=3)["name"], "Divan board")
check("a date can be cleared", board.update_project(
    divan_p["id"], started_at=None)["started_at"], None)
board.update_project(divan_p["id"], archived=True)
check("a product can be taken off the board",
      [p["slug"] for p in board.list_projects() if p["slug"] == "remote-ai-chat"], [])
check("…and put back", board.update_project(divan_p["id"], archived=False)["archived"],
      False)
holds("…where it is listed again",
      "remote-ai-chat" in [p["slug"] for p in board.list_projects()],
      repr([p["slug"] for p in board.list_projects()]))

check("a start date can be a year", time.strftime("%Y-%m-%d", time.localtime(
    board.update_project(bare["id"], started_at="2025")["started_at"])), "2025-01-01")
check("…or a month", time.strftime("%Y-%m-%d", time.localtime(
    board.update_project(bare["id"], started_at="2025-06")["started_at"])), "2025-06-01")
check("…or a timestamp a client already had",
      board.update_project(bare["id"], started_at=1_700_000_000)["started_at"],
      1_700_000_000.0)
refuses("a date nobody can read", board.update_project, bare["id"],
        started_at="last spring")
refuses("a field a project has not got", board.update_project, bare["id"],
        deadline="friday")
refuses("a product left with no name", board.update_project, bare["id"], name="  ")
refuses("an update to a product that is not there", board.update_project, "nope",
        kind="app")
try:
    board.update_project(bare["id"], owner="me")
    fails.append("an unknown field is refused by name")
except ValueError as exc:
    holds("…and the refusal says which fields there are",
          "kind" in str(exc) and "started_at" in str(exc), str(exc))

# ── 2b · where a product is in its life, and how it got there ────────────────
#
# The two facts on a product that nothing on this machine can count: a
# repository with three commits a day can be a dead experiment, and one nobody
# has touched since May can be the thing paying for the others. So both are
# written, and both are refused rather than guessed at when the word is wrong.

check("a product can be told where it is in its life",
      board.update_project(bare["id"], stage="beta")["stage"], "beta")
check("…and it can be cleared, which is not the same as saying idea",
      board.update_project(bare["id"], stage="")["stage"], "")
refuses("a stage that is not one of the five", board.update_project, bare["id"],
        stage="shipping")
try:
    board.update_project(bare["id"], stage="shipping")
except ValueError as exc:
    holds("…and the refusal names the five", "growth" in str(exc), str(exc))

check("a product with no history has none", board.milestones(bare["id"]), [])
m = board.add_milestone(bare["id"], "2026-03-01", "Project started",
                        note="first commit", kind="start")
check("a milestone is a date, a line and what sort of thing it is",
      (time.strftime("%Y-%m-%d", time.localtime(m["at"])), m["title"], m["kind"]),
      ("2026-03-01", "Project started", "start"))
board.add_milestone(bare["id"], "2026-01-09", "Something earlier")
check("…and they come back oldest first, whatever order they were written in",
      [x["title"] for x in board.milestones(bare["id"])],
      ["Something earlier", "Project started"])
refuses("a milestone with no date", board.add_milestone, bare["id"], None, "Nothing")
refuses("…or no title", board.add_milestone, bare["id"], "2026-03-01", "  ")
refuses("…or a kind nobody has", board.add_milestone, bare["id"], "2026-03-01",
        "Launch", "", "shipped")
refuses("a history on a product that is not there", board.add_milestone, "nope",
        "2026-03-01", "Launch")
check("a history is written whole, so reading a repository twice costs nothing",
      [x["title"] for x in board.set_milestones(bare["id"], [
          {"at": "2026-03-01", "title": "Project started", "kind": "start"},
          {"at": "2026-06-01", "title": "Live", "kind": "live"}])],
      ["Project started", "Live"])
check("…and the old lines are gone rather than doubled",
      len(board.milestones(bare["id"])), 2)
check("a date in the future is a promise, and it is kept with the rest",
      [x["title"] for x in board.set_milestones(bare["id"], [
          {"at": "2026-06-01", "title": "Live", "kind": "live"},
          {"at": "2099-01-01", "title": "v4", "kind": "target"}])][-1], "v4")
check("a product's history travels with the product",
      [x["title"] for x in board.project_view(board.get_project(bare["id"]))["milestones"]],
      ["Live", "v4"])
check("…and an empty history is a list, not a missing field",
      board.set_milestones(bare["id"], []), [])

check("a product is found by its id", board.find_project(bare["id"])["id"], bare["id"])
check("…by its key", board.find_project("remote-ai-chat")["name"], "Divan board")
check("…and by the name on the screen, which is what a person says out loud",
      board.find_project("Divan board")["slug"], "remote-ai-chat")
check("and a product nobody has is nobody's", board.find_project("nothing"), None)

# ── 2c · the row in `projects` that is not a product ─────────────────────────

holder = board.unfiled_project()
check("every database has one holding place", holder["slug"], divan.UNFILED)
check("it is hidden, which is the whole of the difference", holder["hidden"], True)
check("so it is in no project list",
      [p["slug"] for p in board.list_projects() if p["hidden"]], [])
check("it has the one branch a card can sit on",
      [b["kind"] for b in board.branches(holder["id"])], ["engineering"])
refuses("it cannot be edited like a product", board.update_project, holder["id"],
        name="My unfiled things")
refuses("and nobody can create a second one", board.create_project, "unfiled")
check("opening the database again does not add another",
      len(fresh_db("config")._c.execute(
          "SELECT id FROM projects WHERE slug=?", (divan.UNFILED,)).fetchall()), 1)

# ── 2d · which product a path belongs to ─────────────────────────────────────
#
# Asked before any name, because the path is the fact and the name is a label.

db = fresh_db("paths")
board = db.divan
site = board.create_project("isghocam", repos=["/w/isghocam", "/w/isghocam-api"])
seo = board.create_project("isghocam SEO", repos=["/w/isghocam/seo"])
check("a repository a product owns is that product",
      board.project_for_repo("/w/isghocam")["name"], "isghocam")
check("a folder inside it is still that product",
      board.project_for_repo("/w/isghocam/app/src")["name"], "isghocam")
check("a second repository of the same product, likewise",
      board.project_for_repo("/w/isghocam-api")["name"], "isghocam")
check("the longest path that contains it wins, not the first",
      board.project_for_repo("/w/isghocam/seo/notes")["name"], "isghocam SEO")
check("a trailing separator is the same folder",
      board.project_for_repo("/w/isghocam/")["name"], "isghocam")
check("a neighbour whose name merely starts the same is not it",
      board.project_for_repo("/w/isghocam-seo"), None)
check("and a folder nobody owns is nobody's", board.project_for_repo("/w/other"), None)
check("nor does a product's name match a path by accident",
      board.project_for_repo(""), None)

# And the second question, asked only where the first has no answer: the name. A
# product may own no repository yet, and a ticket may name a folder nobody
# registered — which is the case the panel's own rule was written for.
board.create_project("ledger")
check("a product that owns no repository is still found by the name a path suggests",
      board.project_for_ticket({"repo": "/w/none/ledger"})["name"], "ledger")
check("the path wins over a name, when both have something to say",
      board.project_for_ticket({"repo": "/w/isghocam/seo",
                                "project": "isghocam"})["name"], "isghocam SEO")
check("a ticket with no repository at all is not a product called 'unfiled'",
      board.project_for_ticket({"repo": ""})["hidden"], True)
check("and neither is one nothing answers for",
      board.project_for_ticket({"repo": "/w/nobody/here"})["slug"], divan.UNFILED)

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
                 escalation: str = "", goal: str = "g", summary: str = "",
                 done: list[str] | None = None, run_dir: str | None = None) -> None:
    now = time.time()
    conn = sqlite3.connect(QDB)
    conn.execute(
        "INSERT INTO tickets (id,title,status,stage,round,repo,branch,base_branch,worktree,"
        "run_dir,created_at,updated_at,started_at,finished_at,card,escalation,verdict,notes)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, title, status, "worker", 1, repo, None, "main", None, run_dir,
         now - 100, now, now - 90, None,
         json.dumps({"goal": goal, "summary": summary,
                     "done_criteria": done or ["it works"]}),
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
    queue_ticket(2, "rank tracking is stale", str(ROOT / "isghocam"), "queued",
                 goal="Patch seo/rank.ts so fetchRanks() reads the cached run;"
                      " see docs/rank-notes.md.",
                 summary="The rank numbers on the dashboard are days old."
                         " They should be yesterday's.")
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
    # The old rule was that nothing of the agent's went on the human face, and
    # what it produced was an empty box on every card — because every card here
    # was a ticket first. So the box opens on what the brief opens on, and it is
    # a default: the first thing a person writes replaces it.
    check("and the box opens on what the brief opens on, rather than empty",
          by_ticket[1]["summary"], "Find where the mail is dropped.")
    check("…a long brief is cut to its first sentences",
          divan.opening("One. Two. Three. Four. Five."), "One. Two. Three.")
    check("…and a ticket with no brief still leaves the box empty",
          divan.opening(""), "")
    # The box is the description a person reads. A ticket filed with one shows
    # that and not the brief: the opening of a goal is file paths and commands,
    # which is the right text for a worker and the wrong one for this box.
    check("a ticket filed with its own sentences shows those instead",
          by_ticket[2]["summary"],
          "The rank numbers on the dashboard are days old. They should be"
          " yesterday's.")
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

    # ── 8b · a poll creates nothing ──────────────────────────────────────────
    #
    # The behaviour this whole section exists for. Every ticket in that queue
    # names a folder, and it used to be enough for the mirror to make a product
    # out of it — which is how this machine came to have seventeen projects
    # nobody had decided on and one called "unfiled". A poll now writes cards and
    # the marks on them, and nothing else at all.

    # Said once at the source, because it is the rule and not an outcome: two
    # places in that module put a row in `projects`, and a third one appearing is
    # this whole behaviour coming back by a different route.
    tree = ast.parse(Path(divan.__file__).read_text())
    writers = sorted({n.name for n in ast.walk(tree)
                      if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                      and "INSERT INTO projects" in ast.unparse(n)})
    check("only two things in the module write a project row: the create, and the"
          " migration that seeds the holding place", writers,
          ["_seed_unfiled", "create_project"])

    bare = fresh_db("bare")
    bare_host = Host(bare)
    bare_rows = lambda: sqlite3.connect(str(tmp / "bare.sqlite")).execute(
        "SELECT id, slug, hidden FROM projects").fetchall()
    before_rows = bare_rows()
    await bare_host.h_ustabasi_list(None, {})
    check("a whole queue of tickets, mirrored onto a board with no products on it,"
          " writes no project", bare_rows(), before_rows)
    check("and creates no product by any other name either",
          bare.divan.list_projects(), [])
    check("every ticket is still a card that can be found",
          len(bare.divan.cards()), 7)
    check("…all of them in the one holding place",
          {c["project_id"] for c in bare.divan.cards()},
          {bare.divan.unfiled_project()["id"]})
    check("no branch was invented on the way either",
          [b["kind"] for b in bare.divan.branches(bare.divan.unfiled_project()["id"])],
          ["engineering"])
    check("and no repository was written onto anybody's product",
          sqlite3.connect(str(tmp / "bare.sqlite")).execute(
              "SELECT COUNT(*) FROM project_repos").fetchone()[0], 0)
    await bare_host.h_ustabasi_list(None, {})
    check("a second poll neither creates nor duplicates", len(bare.divan.cards()), 7)

    # The holding place on the board that does have products: one card, the same
    # card on every poll, and not a figure on anybody's dashboard.
    holder = board.unfiled_project()
    unclaimed = board.card_by_ustabasi(5)
    check("the card out of the unknown folder is in the holding place",
          unclaimed["project_id"], holder["id"])
    check("…and stays there, on the same card, poll after poll",
          [c["ustabasi_id"] for c in board.cards(holder["id"])], [5])
    shot = await host.h_divan_snapshot(None, {})
    check("the holding place is in no project the answer lists",
          [p["slug"] for p in shot["projects"] if p["slug"] == divan.UNFILED], [])
    check("so it is in no count a dashboard adds up",
          sum(sum(p["counts"].values()) for p in shot["projects"]),
          len([c for c in board.cards() if c["project_id"] != holder["id"]]))
    check("but the work is on the answer, under its own name, rather than lost",
          [c["title"] for c in shot["unfiled"]],
          ["a job on a repository nobody registered"])
    check("…and it says where to look for it",
          shot["unfiled_project_id"], holder["id"])
    listed = await host.h_divan_projects(None, {})
    check("the project list says the same: products here, the holding place beside",
          (divan.UNFILED in [p["slug"] for p in listed["projects"]],
           listed["unfiled"]["slug"]), (False, divan.UNFILED))
    check("and it carries the vocabulary a client offers for a product's kind",
          listed["kinds"], list(divan.PROJECT_KINDS))

    # ── 8c · a product taken off the board is not put back by a poll ──────────
    iggy = board.project_by_name("isghocam")
    board.update_project(iggy["id"], archived=True)
    queue_ticket(8, "a ticket on a product nobody is looking at any more",
                 str(ROOT / "isghocam"), "queued")
    await host.h_ustabasi_list(None, {})
    landed = board.card_by_ustabasi(8)
    check("a ticket on an archived product's repository is filed to that product",
          landed["project_id"], iggy["id"])
    check("and the product is still archived: a poll does not reopen a board",
          board.get_project(iggy["id"])["archived"], True)
    check("…so it is still in no list",
          [p["slug"] for p in board.list_projects() if p["slug"] == "isghocam"], [])
    check("and the card did not go to the holding place either",
          [c["ustabasi_id"] for c in board.cards(holder["id"])], [5])
    board.update_project(iggy["id"], archived=False)

    # ── 8d · and what could not be placed is placed when a product claims it ──
    #
    # Which is the answer to the only real objection to not creating products:
    # the ticket arrives on Tuesday and the product is created on Wednesday.
    queue_ticket(9, "the sleep chart is empty on the first night",
                 str(ROOT / "yatak-kontrol"), "queued")
    await host.h_ustabasi_list(None, {})
    waiting = board.card_by_ustabasi(9)
    check("a ticket out of a folder no product owns waits in the holding place",
          waiting["project_id"], holder["id"])
    settled = {c["id"]: (c["project_id"], c["column"], c["position"])
               for c in board.cards() if c["project_id"] != holder["id"]}
    claimed = board.create_project("yatak kontrol", kind="app",
                                  repos=[str(ROOT / "yatak-kontrol")])
    await host.h_ustabasi_list(None, {})
    moved = board.card_by_ustabasi(9)
    check("creating the product moves its card onto its board",
          moved["project_id"], claimed["id"])
    check("onto the engineering branch", moved["branch"], "engineering")
    check("in the column its status put it in", moved["column"], waiting["column"])
    check("and the holding place is closed up behind it",
          sorted(c["position"] for c in board.cards(holder["id"])),
          list(range(len(board.cards(holder["id"])))))
    check("nothing that was already on a board was touched by any of it",
          {c["id"]: (c["project_id"], c["column"], c["position"])
           for c in board.cards() if c["project_id"] != holder["id"]
           and c["id"] in settled}, settled)
    check("and the card that nobody can place is still where it was",
          board.card_by_ustabasi(5)["project_id"], holder["id"])

    # ── 9 · a status change moves the card to the column it means ────────────
    #
    # Ticket 1 was imported running, so its card is in In Progress. Somebody
    # drags it to the Ice Box; while the ticket stays where it is the drag
    # holds, and the moment the ticket goes somewhere else — a column the
    # status means that is not the one it meant before — the card goes with
    # it. Running, blocked and failed all mean In Progress, so moving between
    # those is not going anywhere.
    card_id = by_ticket[1]["id"]
    board.move(card_id, "ice_box", 0)
    placed = board.get_card(card_id)
    check("a card is where the person put it", (placed["column"], placed["position"]),
          ("ice_box", 0))
    await host.h_ustabasi_list(None, {})
    now = board.get_card(card_id)
    check("and a poll with nothing new about the ticket leaves it there",
          (now["column"], now["position"]), ("ice_box", 0))

    queue_status(1, "failed")
    await host.h_ustabasi_list(None, {})
    now = board.get_card(card_id)
    check("running to failed is a mark, not a move: the drag still holds",
          (now["agent_status"], now["column"]), ("failed", "ice_box"))

    for status, escalation, expected, col in [
        ("done", "", "verified", "done"),
        ("queued", "", "queued", "queued"),
        ("running", "", "running", "in_progress"),
        ("blocked", "Which way should this go?", "asking", "in_progress"),
        ("blocked", "", "blocked", "in_progress"),
        ("failed", "", "failed", "in_progress"),
        ("cancelled", "", "cancelled", "done"),
    ]:
        queue_status(1, status, escalation)
        await host.h_ustabasi_list(None, {})
        now = board.get_card(card_id)
        check(f"'{status}' is mirrored as '{expected}'", now["agent_status"], expected)
        check(f"…and puts the card in {col} ({status})", now["column"], col)
        col_cards = board.board(now["project_id"])["columns"][col]
        check(f"…at the bottom of it, positions contiguous ({status})",
              ([c["position"] for c in col_cards], col_cards[-1]["id"]),
              (list(range(len(col_cards))), card_id))
    check("the question that came with it is on the card too",
          board.get_card(card_id)["agent_detail"], "")
    # Dragged while cancelled: stays until the status changes, then follows it.
    board.move(card_id, "queued", 0)
    await host.h_ustabasi_list(None, {})
    check("a drag holds across polls that bring nothing new",
          board.get_card(card_id)["column"], "queued")
    queue_status(1, "queued")
    await host.h_ustabasi_list(None, {})
    check("and is only overruled when the ticket itself moves",
          board.get_card(card_id)["column"], "queued")
    check("…which is where the status put it, not the finger",
          board.get_card(card_id)["agent_column"], "queued")

    # ── 9b · a board from before the rule comes right on the first poll ──────
    #
    # Cards imported before `agent_column` existed were put in a column once
    # and never moved: verified tickets sat in Queued for a week. The first
    # poll after the upgrade puts each where its status says.
    stale = board.card_by_ustabasi(3)     # failed, so in progress
    conn = sqlite3.connect(tmp / "wire.sqlite")
    conn.execute("UPDATE cards SET column='queued', position=0, agent_column=NULL WHERE id=?",
                 (stale["id"],))
    conn.commit()
    conn.close()
    await host.h_ustabasi_list(None, {})
    fixed = board.card_by_ustabasi(3)
    check("a card the mirror never placed is placed on the first poll",
          (fixed["column"], fixed["agent_column"]), ("in_progress", "in_progress"))

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
                                                    "branches": ["finance"],
                                                    "kind": "app",
                                                    "purpose": "The one it is for.",
                                                    "started_at": "2026-04-15"})
    check("a product can be created over the wire", made["name"], "a new product")
    check("with an extra branch of its own",
          [b["kind"] for b in made["branches"]][-1], "finance")
    check("and with what it is", made["kind"], "app")
    check("what it is for", made["summary"], "The one it is for.")
    check("and when it began", time.strftime("%Y-%m-%d",
                                            time.localtime(made["started_at"])),
          "2026-04-15")

    # ── 12b · a product is created and edited by saying so ───────────────────
    #
    # There is no project form in either client and none is planned: this is the
    # entrance, called by the agent in a chat on the phone. So it takes every
    # field the model does, it answers to the name a person would say rather than
    # a hex id, and a word it does not know comes back as an error naming the
    # ones it does — a conversational entrance cannot afford a silent no-op.
    changed = await host.h_divan_project_update(None, {
        "project": "a new product", "name": "The new product",
        "kind": "client work", "purpose": "What it turned out to be for.",
        "started_at": "2026-05-01", "sort": 2})
    check("a product can be edited over the wire, named as a person names it",
          changed["name"], "The new product")
    check("its kind", changed["kind"], "client-work")
    check("what it is for", changed["summary"], "What it turned out to be for.")
    check("when it began", time.strftime("%Y-%m-%d",
                                        time.localtime(changed["started_at"])),
          "2026-05-01")
    check("where it sits", changed["sort"], 2)
    check("and the key two machines match it by has not moved with the name",
          changed["slug"], "a-new-product")
    check("it can be found by that key too",
          (await host.h_divan_project_update(None, {
              "project": "a-new-product", "kind": "app"}))["kind"], "app")
    check("and by its id, as every other request names a thing",
          (await host.h_divan_project_update(None, {
              "project_id": changed["id"], "kind": "web"}))["kind"], "web")
    check("its repositories can be moved, and are the list rather than an addition",
          (await host.h_divan_project_update(None, {
              "project_id": changed["id"],
              "repos": [str(ROOT / "babysee" / "app")]}))["repos"],
          [str(ROOT / "babysee" / "app")])
    check("and the board it holds came through the rename",
          (await host.h_divan_board(None, {"project_id": changed["id"]}))["project"]["name"],
          "The new product")

    # The fence, on the way in, exactly as on `divan.project.create`: a
    # repository is where an autonomous worker is given a shell.
    for data, code in [
        ({"project_id": changed["id"], "repos": [str(OUTSIDE)]}, "cwd_outside"),
        ({"project_id": changed["id"], "repos": [str(ROOT / "secrets")]}, "cwd_outside"),
        ({"project_id": changed["id"], "repos": [str(ROOT / "never-existed")]},
         "no_such_folder"),
    ]:
        try:
            await host.h_divan_project_update(None, data)
            holds(f"h_divan_project_update refuses {data['repos']}", False,
                  "it was accepted")
        except Exception as exc:
            check(f"h_divan_project_update refuses {data['repos']} by name",
                  getattr(exc, "code", None), code)
    check("and the repositories it had are untouched by the attempt",
          board.get_project(changed["id"])["repos"], [str(ROOT / "babysee" / "app")])

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
    # A worker picks up ticket 3 again. Ticket 1 was walked through every
    # status a few checks ago and ended cancelled, so it is no use to a check
    # about agents at work.
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
    # Done travels only as far back as a month. Ticket 1 finished (cancelled)
    # a moment ago and comes along; one that finished last spring does not,
    # and the counts still say it is there.
    old = board.card_by_ustabasi(1)
    conn = sqlite3.connect(tmp / "wire.sqlite")
    conn.execute("UPDATE cards SET moved_at=? WHERE id=?",
                 (time.time() - 90 * 24 * 3600, old["id"]))
    conn.commit(); conn.close()
    snapshot = await host.h_divan_snapshot(None, {})
    sent_done = [c for c in snapshot["cards"] if c["column"] == "done"]
    holds("the cards are the open board and this month's finished work",
          sent_done and all(c["ustabasi_id"] != 1 for c in sent_done),
          repr([(c["ustabasi_id"], c["moved_at"]) for c in sent_done]))
    holds("which is not the whole board: the counts still say what is in done",
          any(p["counts"]["done"] > 0 for p in snapshot["projects"]),
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

    # What the code host says about those same repositories: the one reading on
    # the answer that leaves this machine, and the only source for a pull
    # request or a check.
    divan._pulls_cache.clear()
    GH.answer = json.dumps([
        pull(412, "Bulk invite from CSV",
             [{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"},
              {"__typename": "StatusContext", "state": "PENDING"}], minutes=40),
        pull(410, "GBP price localisation",
             [{"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE"},
              {"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "TIMED_OUT"},
              {"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"}], minutes=5),
        pull(409, "Invoice PDF redesign", [], minutes=90, draft=True)])
    fresh = await host.h_divan_snapshot(None, {})
    mine = fresh["pulls"].get(str(ROOT / "babysee")) or {"open": []}
    check("a repository's open pull requests travel, newest first",
          [p["number"] for p in mine["open"]], [410, 412, 409])
    check("…each with its title and the branch it is on",
          [(p["title"], p["branch"]) for p in mine["open"]][:1],
          [("GBP price localisation", "pr/410")])
    check("the checks failing on one are counted, and the rest are a word",
          [(p["checks"], p["failing"]) for p in mine["open"]],
          [("failing", 2), ("pending", 0), (None, 0)])
    holds("…and a pull request nobody has finished is marked as a draft",
          [p["number"] for p in mine["open"] if p["draft"]] == [409], repr(mine["open"]))

    divan._pulls_cache.clear()
    GH.answer = "[]"
    empty = await host.h_divan_snapshot(None, {})
    check("a repository with nothing open answers with an empty list, not with nothing",
          empty["pulls"].get(str(ROOT / "babysee"), {}).get("open"), [])

    divan._pulls_cache.clear()
    GH.answer = None
    none = await host.h_divan_snapshot(None, {})
    holds("a machine with no gh, no sign-in or no network has no entry at all",
          str(ROOT / "babysee") not in none["pulls"], repr(none["pulls"]))
    holds("…and neither has a checkout that is not on the code host",
          divan.github_remote(str(ROOT / "isghocam")) is None
          and divan.read_pulls(str(ROOT / "isghocam")) is None)
    check("the remote is read off the checkout and nowhere else",
          divan.github_remote(str(ROOT / "babysee")), "t/babysee")
    divan._pulls_cache.clear()
    check("a repository there was no time to ask about is absent rather than holding up the answer",
          divan.pulls_of([str(ROOT / "babysee")], budget_s=-1), {})
    GH.answer = "[]"

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
    check("and its card has moved itself into Done",
          board.card_by_ustabasi(3)["column"], "done")

    for name, data, code in [
        ("h_divan_board", {"project_id": "nope"}, "no_such_project"),
        ("h_divan_card_get", {"card_id": "nope"}, "no_such_card"),
        ("h_divan_card_move", {"card_id": "nope", "column": "done"}, "bad_move"),
        ("h_divan_card_move", {"card_id": created["id"], "column": "later"}, "bad_move"),
        ("h_divan_card_create", {"project_id": "nope", "title": "t"}, "bad_card"),
        ("h_divan_card_executor", {"card_id": "nope", "executor": "human"}, "bad_executor"),
        ("h_divan_project_create", {"name": "babysee"}, "bad_project"),
        ("h_divan_project_create", {"name": "  "}, "bad_project"),
        ("h_divan_project_create", {"name": "unfiled"}, "bad_project"),
        ("h_divan_project_create", {"name": "a product with a bad date",
                                    "started_at": "some time in spring"}, "bad_project"),
        ("h_divan_project_update", {"project": "nothing at all", "kind": "app"},
         "no_such_project"),
        ("h_divan_project_update", {"project": "babysee", "deadline": "friday"},
         "bad_project"),
        ("h_divan_project_update", {"project": "babysee", "name": " "}, "bad_project"),
        ("h_divan_project_update", {"project": "unfiled", "name": "mine"},
         "bad_project"),
        ("h_divan_card_update", {"card_id": "nope", "title": "t"}, "no_such_card"),
        ("h_divan_card_update", {"card_id": created["id"], "title": " "}, "bad_card"),
    ]:
        try:
            await getattr(host, name)(None, data)
            holds(f"{name} refuses {data}", False, "it was accepted")
        except Exception as exc:
            check(f"{name} refuses {data} by name", getattr(exc, "code", None), code)


asyncio.run(wire())

# ── 14 · the entrance an agent in a chat actually has ────────────────────────
#
# The requests above are reached from the phone over a socket. The thing that has
# to be able to make a product is the agent in the app's chat, which has a shell
# on this computer and no screen — so `remote-ai-chat project` is that entrance,
# and it speaks the same two requests over the daemon's own socket rather than
# writing to the database behind it. What is checked here is the part that can be
# wrong quietly: which flags become which fields, and that a flag nobody passed
# is not a field set to nothing.

from remote_ai_chat.__main__ import _project_fields, _project_line   # noqa: E402


def flags(**kw) -> dict:
    given = {"name": None, "slug": None, "kind": None, "purpose": None,
             "started": None, "sort": None, "repo": None, "branch": None,
             "archive": False, "unarchive": False}
    return _project_fields(types.SimpleNamespace(**{**given, **kw}))


check("a command that gives nothing sends nothing", flags(), {})
check("every field a product has can be given",
      flags(name="Divan", slug="remote-ai-chat", kind="app", purpose="The board.",
            started="2026-09-28", sort=2, repo=["/w/rac"], branch=["finance"]),
      {"name": "Divan", "slug": "remote-ai-chat", "kind": "app",
       "purpose": "The board.", "started_at": "2026-09-28", "sort": 2,
       "repos": ["/w/rac"], "branches": ["finance"]})
check("a repeated repository is the list", flags(repo=["/a", "/b"])["repos"], ["/a", "/b"])
check("and an empty one is an emptied list, not an absent field",
      flags(repo=[]), {"repos": []})
check("a purpose can be cleared, which is not the same as not saying",
      flags(purpose=""), {"purpose": ""})
check("taking a product off the board is one flag", flags(archive=True),
      {"archived": True})
check("and putting it back is the other", flags(unarchive=True), {"archived": False})
holds("a product reads back as one line saying what it is and where it stands",
      _project_line({"name": "Divan", "slug": "remote-ai-chat", "kind": "app",
                     "started_at": 1_759_000_000, "summary_line": "2 running"})
      == "Divan (app)  [remote-ai-chat] since "
      + time.strftime("%Y-%m-%d", time.localtime(1_759_000_000)) + "  — 2 running",
      _project_line({"name": "Divan", "slug": "remote-ai-chat", "kind": "app",
                     "started_at": 1_759_000_000, "summary_line": "2 running"}))
check("and a product with none of it still reads",
      _project_line({"name": "an old product", "slug": "an-old-product"}),
      "an old product  [an-old-product]")

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — the board: migration, the two faces, the order, the mirror, and the wire")
