"""Divan: the board every project is actually run from.

Until now the only work object on this computer was the ustabasi queue, and a
queue is all it is — one flat list, ordered by priority and by whatever a
supervisor picked up last. There are no columns in it, no order a person chose,
no branches of work beside the code, no way to say "this one is mine" and no
way to say "this one is not a coding job at all". Every Divan screen needs all
five, so the model lives here and the queue becomes one executor under it.

Four tables and one rule.

**projects** are products, not folders. isghocam is a product; its repository is
a detail of its engineering branch, and it may have several. So a project owns
a list of repository paths rather than being one.

**branches** are the faces of a product: engineering, seo, analytics, marketing,
customers, and whatever a product turns out to need next. One row per project
per branch, seeded on creation and extensible afterwards.

**cards** are the work. Each sits in one column — `ice_box`, `queued`,
`in_progress`, `done` — at an explicit position in it, because "Queued" is a
priority order somebody arranged by hand and not a timestamp sort.

**The two faces.** A card is opened by a person and worked by an agent, and the
two want different things written down. The human face is a one-line title and
two or three sentences; the field is physically small so it stays that way. The
agent face is a goal, done criteria, a verify command, constraints, paths and
notes, as long as it needs to be. Text an agent produced never lands on the
human face.

And the rule everything else is built around: **the column is the human's
intent and the status is reality.** A card moves because somebody moved it.
What the agent on it is doing — running, stuck, asking, turned down, verified —
is a separate field written by the mirror, and writing it never moves the card.
A worker that fails at 3am leaves its card exactly where it was left, with a red
mark on it, which is the only behaviour that lets a board be trusted overnight.

The mirror is one-way. ustabasi keeps its own database and stays the coding
executor; this side reads its snapshot and writes down what it saw. The single
write in the other direction is filing a new ticket, and it goes through that
program's own CLI (`ustabasi.add`), because what "queue this" means is its
sequence to define.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import uuid
from typing import Any, Callable

from . import ustabasi as ustabasimod

# ── the vocabulary ───────────────────────────────────────────────────────────

#: Left to right, and the order a board is drawn in. `ice_box` is everything
#: that has been thought of; `queued` is what is next, top to bottom; nothing
#: starts until a person drags it into `in_progress`.
COLUMNS = ("ice_box", "queued", "in_progress", "done")

#: Who does the work. `coding_agent` is ustabasi and is the only one this
#: daemon can start; `branch_agent` is the overnight SEO/marketing/customer
#: kind; `assistant` is a one-off piece of research or writing; `human` is a
#: card nothing runs on — it waits for a person and says so.
EXECUTORS = ("coding_agent", "branch_agent", "assistant", "human")

#: The branches a product gets on the day it is created. Not a closed set:
#: `Board.ensure_branch` takes any kind, which is how a product that needs a
#: "support" or "finance" branch gets one without a migration.
BRANCH_KINDS = ("engineering", "seo", "analytics", "marketing", "customers")

#: What each of them is called on a screen. A kind this table does not carry is
#: titled from its own name, which is why the set can be open.
BRANCH_NAMES = {
    "engineering": "Engineering",
    "seo": "SEO",
    "analytics": "Analytics",
    "marketing": "Marketing",
    "customers": "Customers",
}

#: The queue's word for where a ticket is, in this side's word for it. The
#: mirror writes this and nothing else: `verified` is a ticket the verifier
#: passed, which is not the same as a card somebody has finished with.
AGENT_STATUS = {
    "queued": "queued",
    "running": "running",
    "done": "verified",
    "failed": "failed",
    "cancelled": "cancelled",
}

#: A blocked ticket with a question on it is asking; one without is simply
#: stopped. The difference is the whole of "waiting on you", so it is not
#: flattened into one word.
ASKING = "asking"
BLOCKED = "blocked"

#: Where a ticket that already exists lands the first time it is imported, by
#: its status. Used **once per ticket**, on the import that makes a card out of
#: it, and never again: after that the column is the person's.
IMPORT_COLUMN = {
    "queued": "queued",
    "running": "in_progress",
    "blocked": "in_progress",
    "failed": "in_progress",
    "done": "done",
    "cancelled": "done",
}

#: The human face is deliberately small. A title is a line and a summary is two
#: or three sentences; anything longer is the agent face, or it is a new card.
MAX_TITLE = 160
MAX_SUMMARY = 600

#: A repository path this daemon has nothing to say about still names a project
#: — the last component of it — which is what the panel already does with a
#: ticket whose repo is outside every allowed root (`web/src/lib/ustabasi.ts`).
UNFILED = "unfiled"

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at REAL, updated_at REAL
);
-- A product may be several repositories, and a repository belongs to one
-- product. Kept beside the project rather than on it so that "which project is
-- this path" is a lookup and not a scan of parsed JSON.
CREATE TABLE IF NOT EXISTS project_repos (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT DEFAULT '',
  summary_at REAL,
  sort INTEGER DEFAULT 0,
  created_at REAL,
  UNIQUE (project_id, kind)
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- the human's intent
  column TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- the human face
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  -- the agent face
  goal TEXT DEFAULT '',
  done_criteria TEXT DEFAULT '[]',
  verify_cmd TEXT DEFAULT '',
  constraints TEXT DEFAULT '[]',
  paths TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  -- who does it, where, and on which repository of the product
  executor TEXT,
  machine TEXT,
  repo TEXT,
  -- reality, written by the mirror and by nothing else
  ustabasi_id INTEGER,
  agent_status TEXT,
  agent_status_at REAL,
  agent_detail TEXT DEFAULT '',
  created_at REAL, updated_at REAL, moved_at REAL
);
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(project_id, column, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_ustabasi ON cards(ustabasi_id)
  WHERE ustabasi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repos_path ON project_repos(path);
"""

#: Columns a database may predate. Same shape as `db.DB._migrate`: the table is
#: read on every start and whatever is missing is added in place. `CREATE TABLE
#: IF NOT EXISTS` cannot do this — it does nothing at all to a table that is
#: already there — and rebuilding the table would mean rewriting a board.
ADDED_COLUMNS = {
    "cards": (("agent_detail", "TEXT DEFAULT ''"),),
    "projects": (("summary", "TEXT DEFAULT ''"),),
}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "project"


def project_name_for(repo: str, project_for: Callable[[str], str | None] | None) -> str:
    """The product a repository path is work on.

    The same rule the panel groups the ticket wall by: the path policy's answer
    where it has one — `~/projects/babysee/app` is babysee — the folder's own
    name where it does not, and `unfiled` for a ticket with no repository at
    all. Reimplemented here rather than imported because the panel's copy is
    TypeScript, and the two have to agree: a ticket and the card made out of it
    must land under the same heading.
    """
    named = (project_for(repo) if (project_for and repo) else None) or ""
    named = named.strip()
    if named:
        return named
    parts = [p for p in (repo or "").split("/") if p]
    return parts[-1] if parts else UNFILED


def _json(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _lines(value) -> list[str]:
    """A list of short strings, however it was sent: a list, or one string."""
    if value is None:
        return []
    if isinstance(value, str):
        return [l.strip() for l in value.splitlines() if l.strip()]
    return [str(v).strip() for v in value if str(v).strip()]


def migrate(conn: sqlite3.Connection) -> None:
    """Make an older database carry the board.

    `CREATE TABLE IF NOT EXISTS` does the first half — a database from before
    Divan simply gains four empty tables on the next start, with its chats and
    its timeline untouched — and the additive column pass does the rest.
    """
    conn.executescript(SCHEMA)
    for table, cols in ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if not have:
            continue
        for col, decl in cols:
            if col not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    conn.commit()


class Board:
    """Every read and write of the Divan model, on the daemon's own connection.

    One process, one connection, one lock — the same one `db.DB` uses for its
    own writes, because a second connection to a WAL database is a second
    writer waiting on the first for no reason.
    """

    def __init__(self, conn: sqlite3.Connection, lock: threading.Lock):
        self._c = conn
        self._lock = lock

    # ── projects and branches ──────────────────────────────────────────────

    def list_projects(self) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM projects WHERE archived=0 ORDER BY sort, name").fetchall()
        return [self._project(r) for r in rows]

    def get_project(self, pid: str) -> dict | None:
        r = self._c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        return self._project(r) if r else None

    def project_by_name(self, name: str) -> dict | None:
        r = self._c.execute("SELECT * FROM projects WHERE slug=?",
                            (slugify(name),)).fetchone()
        return self._project(r) if r else None

    def create_project(self, name: str, repos: list[str] | None = None,
                       branches: list[str] | None = None) -> dict:
        """A product, with its branches and the repositories it owns.

        The branch list is the default five plus whatever else was asked for:
        a product with a support desk gets a support branch here rather than in
        a migration, and one that never needs SEO simply never looks at it.
        """
        name = (name or "").strip()
        if not name:
            raise ValueError("a project needs a name")
        existing = self.project_by_name(name)
        if existing:
            raise ValueError("a project with that name already exists")
        now = time.time()
        row = {"id": new_id(), "name": name[:MAX_TITLE], "slug": slugify(name),
               "summary": "", "sort": 0, "archived": 0,
               "created_at": now, "updated_at": now}
        with self._lock:
            self._c.execute(
                "INSERT INTO projects (id,name,slug,summary,sort,archived,created_at,updated_at)"
                " VALUES (:id,:name,:slug,:summary,:sort,:archived,:created_at,:updated_at)", row)
            self._c.commit()
        kinds = list(BRANCH_KINDS) + [k for k in (branches or []) if k not in BRANCH_KINDS]
        for i, kind in enumerate(kinds):
            self.ensure_branch(row["id"], kind, sort=i)
        for path in repos or []:
            self.attach_repo(row["id"], path)
        return self.get_project(row["id"])

    def ensure_project(self, name: str, repo: str | None = None) -> dict:
        """The project of this name, created if this computer has not met it yet.

        The import path: a ticket names a product, and the product either
        already has a board or is about to.
        """
        found = self.project_by_name(name)
        if found is None:
            found = self.create_project(name)
        if repo:
            self.attach_repo(found["id"], repo)
            found = self.get_project(found["id"])
        return found

    def attach_repo(self, project_id: str, path: str) -> None:
        path = (path or "").strip()
        if not path:
            return
        with self._lock:
            self._c.execute(
                "INSERT OR IGNORE INTO project_repos (project_id, path) VALUES (?,?)",
                (project_id, path))
            self._c.commit()

    def branches(self, project_id: str) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM branches WHERE project_id=? ORDER BY sort, kind",
            (project_id,)).fetchall()
        return [dict(r) for r in rows]

    def branch(self, project_id: str, kind: str) -> dict | None:
        r = self._c.execute("SELECT * FROM branches WHERE project_id=? AND kind=?",
                            (project_id, kind)).fetchone()
        return dict(r) if r else None

    def ensure_branch(self, project_id: str, kind: str, name: str | None = None,
                      sort: int = 99) -> dict:
        found = self.branch(project_id, kind)
        if found:
            return found
        row = {"id": new_id(), "project_id": project_id, "kind": kind,
               "name": name or BRANCH_NAMES.get(kind) or kind.replace("_", " ").title(),
               "summary": "", "summary_at": None, "sort": sort, "created_at": time.time()}
        with self._lock:
            self._c.execute(
                "INSERT INTO branches (id,project_id,kind,name,summary,summary_at,sort,created_at)"
                " VALUES (:id,:project_id,:kind,:name,:summary,:summary_at,:sort,:created_at)", row)
            self._c.commit()
        return self.branch(project_id, kind)

    # ── the board ──────────────────────────────────────────────────────────

    def board(self, project_id: str) -> dict:
        """One project's board: its branches, and its cards by column in order."""
        project = self.get_project(project_id)
        if project is None:
            raise ValueError("no such project")
        rows = self._c.execute(
            "SELECT c.*, b.kind AS branch FROM cards c JOIN branches b ON b.id = c.branch_id"
            " WHERE c.project_id=? ORDER BY c.column, c.position", (project_id,)).fetchall()
        cards = [self._card(r) for r in rows]
        columns = {col: [c for c in cards if c["column"] == col] for col in COLUMNS}
        return {"project": project,
                "branches": self._branch_views(project_id, cards),
                "columns": columns}

    def cards(self, project_id: str | None = None) -> list[dict]:
        q = ("SELECT c.*, b.kind AS branch FROM cards c JOIN branches b ON b.id = c.branch_id")
        args: tuple = ()
        if project_id:
            q += " WHERE c.project_id=?"
            args = (project_id,)
        q += " ORDER BY c.column, c.position"
        return [self._card(r) for r in self._c.execute(q, args).fetchall()]

    def get_card(self, card_id: str, agent: bool = True) -> dict | None:
        r = self._c.execute(
            "SELECT c.*, b.kind AS branch FROM cards c JOIN branches b ON b.id = c.branch_id"
            " WHERE c.id=?", (card_id,)).fetchone()
        return self._card(r, agent=agent) if r else None

    def card_by_ustabasi(self, ticket_id: int) -> dict | None:
        r = self._c.execute(
            "SELECT c.*, b.kind AS branch FROM cards c JOIN branches b ON b.id = c.branch_id"
            " WHERE c.ustabasi_id=?", (int(ticket_id),)).fetchone()
        return self._card(r) if r else None

    def create_card(self, project_id: str, title: str, summary: str = "",
                    branch: str = "engineering", column: str = "ice_box",
                    executor: str | None = None, machine: str | None = None,
                    repo: str | None = None, agent: dict | None = None,
                    ustabasi_id: int | None = None,
                    position: int | None = 0) -> dict:
        """A card, from the human face alone.

        Everything but the project and the title is optional, which is the
        point: a card written
        down while talking is a line and nothing else, and the agent face is
        filled in later — or never, because nobody runs an agent on it.

        A new card lands at the **top** of its column by default. `ice_box` is
        where a thought goes so it is not lost and `queued` is a priority order,
        and in both the thing just written down is the thing on your mind. The
        import passes `None` instead, which is the bottom: those cards are
        older than the board and arrive oldest first.
        """
        title = (title or "").strip()
        if not title:
            raise ValueError("a card needs a title")
        if column not in COLUMNS:
            raise ValueError(f"no such column: {column}")
        if executor is not None and executor not in EXECUTORS:
            raise ValueError(f"no such executor: {executor}")
        project = self.get_project(project_id)
        if project is None:
            raise ValueError("no such project")
        b = self.branch(project_id, branch)
        if b is None:
            raise ValueError(f"no such branch: {branch}")
        agent = agent or {}
        now = time.time()
        row = {
            "id": new_id(), "project_id": project_id, "branch_id": b["id"],
            "column": column, "position": 0,
            "title": title[:MAX_TITLE], "summary": (summary or "").strip()[:MAX_SUMMARY],
            "goal": (agent.get("goal") or "").strip(),
            "done_criteria": json.dumps(_lines(agent.get("done_criteria"))),
            "verify_cmd": (agent.get("verify_cmd") or "").strip(),
            "constraints": json.dumps(_lines(agent.get("constraints"))),
            "paths": json.dumps(_lines(agent.get("paths"))),
            "notes": (agent.get("notes") or "").strip(),
            "executor": executor, "machine": machine,
            "repo": repo or (project["repos"][0] if project["repos"] else None),
            "ustabasi_id": ustabasi_id, "agent_status": None, "agent_status_at": None,
            "agent_detail": "",
            "created_at": now, "updated_at": now, "moved_at": now,
        }
        cols = ",".join(row)
        vals = ",".join(":" + k for k in row)
        with self._lock:
            n = self._c.execute("SELECT COUNT(*) FROM cards WHERE project_id=? AND column=?",
                                (project_id, column)).fetchone()[0]
            row["position"] = n if position is None else max(0, min(int(position), n))
            self._c.execute("UPDATE cards SET position = position + 1"
                            " WHERE project_id=? AND column=? AND position >= ?",
                            (project_id, column, row["position"]))
            self._c.execute(f"INSERT INTO cards ({cols}) VALUES ({vals})", row)
            self._c.commit()
        return self.get_card(row["id"])

    def move(self, card_id: str, column: str, position: int | None = None) -> dict:
        """Put a card in a column, at a place in it. The one human action.

        This is the only method that writes `column` or `position`, and nothing
        the mirror does calls it. That is the rule the whole board rests on: a
        worker that starts, stalls, asks or fails at four in the morning leaves
        every card exactly where it was left.

        `position` is an index in the target column after the card has left
        wherever it was — `0` is the top, past the end is the bottom, and
        omitting it means the bottom of a column the card is arriving in and
        no move at all within the one it is already in.
        """
        if column not in COLUMNS:
            raise ValueError(f"no such column: {column}")
        card = self.get_card(card_id)
        if card is None:
            raise ValueError("no such card")
        same = card["column"] == column
        if same and position is None:
            return card
        now = time.time()
        with self._lock:
            # Close the gap the card leaves behind, then open one where it goes.
            self._c.execute(
                "UPDATE cards SET position = position - 1"
                " WHERE project_id=? AND column=? AND position > ?",
                (card["project_id"], card["column"], card["position"]))
            n = self._c.execute(
                "SELECT COUNT(*) FROM cards WHERE project_id=? AND column=? AND id!=?",
                (card["project_id"], column, card_id)).fetchone()[0]
            at = n if position is None else max(0, min(int(position), n))
            self._c.execute(
                "UPDATE cards SET position = position + 1"
                " WHERE project_id=? AND column=? AND position >= ? AND id!=?",
                (card["project_id"], column, at, card_id))
            self._c.execute(
                "UPDATE cards SET column=?, position=?, updated_at=?, moved_at=? WHERE id=?",
                (column, at, now, now, card_id))
            self._c.commit()
        return self.get_card(card_id)

    def set_executor(self, card_id: str, executor: str | None,
                     machine: str | None = None) -> dict:
        """Who does this one, or nobody.

        Clearing it is an ordinary thing to do — a card whose agent was the
        wrong guess goes back to having none rather than to having `human` —
        so `None` is a value and not a missing argument.
        """
        if executor is not None and executor not in EXECUTORS:
            raise ValueError(f"no such executor: {executor}")
        if self.get_card(card_id) is None:
            raise ValueError("no such card")
        with self._lock:
            self._c.execute(
                "UPDATE cards SET executor=?, machine=COALESCE(?, machine), updated_at=?"
                " WHERE id=?", (executor, machine, time.time(), card_id))
            self._c.commit()
        return self.get_card(card_id)

    def update_card(self, card_id: str, **fields: Any) -> dict:
        """The faces, and the few marks that are not the column.

        This is how a card written down in one line grows an agent face: a goal
        and done criteria are filled in when somebody gets round to it, not
        when the card is made.

        `column` and `position` are not in the allowed set on purpose, and
        neither are `executor`, `ustabasi_id` or anything the mirror writes.
        They each have a method of their own, and a field that could be written
        from two places is how a status update ends up dragging a card.
        """
        human = {"title", "summary", "repo", "machine"}
        agent_text = {"goal", "verify_cmd", "notes"}
        agent_lists = {"done_criteria", "constraints", "paths"}
        out: dict[str, Any] = {}
        for k, v in fields.items():
            if k in human or k in agent_text:
                out[k] = (v or "").strip()
            elif k in agent_lists:
                out[k] = json.dumps(_lines(v))
        if "title" in out:
            if not out["title"]:
                raise ValueError("a card needs a title")
            out["title"] = out["title"][:MAX_TITLE]
        if "summary" in out:
            out["summary"] = out["summary"][:MAX_SUMMARY]
        if not out:
            return self.get_card(card_id)
        out["updated_at"] = time.time()
        sets = ",".join(f"{k}=:{k}" for k in out)
        out["id"] = card_id
        with self._lock:
            self._c.execute(f"UPDATE cards SET {sets} WHERE id=:id", out)
            self._c.commit()
        return self.get_card(card_id)

    def attach_ustabasi(self, card_id: str, ticket_id: int) -> dict:
        """Write the queue's number on the card. Said once, when it is filed."""
        with self._lock:
            self._c.execute(
                "UPDATE cards SET ustabasi_id=?, agent_status=?, agent_status_at=?,"
                " updated_at=? WHERE id=?",
                (int(ticket_id), "queued", time.time(), time.time(), card_id))
            self._c.commit()
        return self.get_card(card_id)

    def delete_card(self, card_id: str) -> None:
        card = self.get_card(card_id)
        if card is None:
            return
        with self._lock:
            self._c.execute("DELETE FROM cards WHERE id=?", (card_id,))
            self._c.execute(
                "UPDATE cards SET position = position - 1"
                " WHERE project_id=? AND column=? AND position > ?",
                (card["project_id"], card["column"], card["position"]))
            self._c.commit()

    # ── the mirror ─────────────────────────────────────────────────────────

    def sync_ustabasi(self, snapshot: dict, machine: str | None = None,
                      project_for: Callable[[str], str | None] | None = None) -> dict:
        """Take in what the queue just said, and write down only what is ours.

        Two jobs, and they are not the same one.

        The first is the **import**, and it happens once per ticket: a ticket
        this board has never seen becomes a card on its product's engineering
        branch, and its column is read off its current status — that is the one
        moment a status decides a column, because the tickets predate the board
        and have to land somewhere honest.

        The second is the **mirror**, and it happens on every poll forever
        after: the ticket's status, written onto the card as a mark. It touches
        `agent_status` and `agent_detail`. It does not touch `column`, it does
        not touch `position`, and a ticket that finishes, fails or is picked up
        by a worker while nobody is watching leaves its card where it is.
        """
        if not snapshot.get("available"):
            return {"imported": 0, "mirrored": 0}
        imported = mirrored = 0
        for ticket in snapshot.get("tickets") or []:
            card = self.card_by_ustabasi(ticket["id"])
            if card is None:
                self._import_ticket(ticket, machine, project_for)
                imported += 1
            elif self._mirror(card, ticket):
                mirrored += 1
        return {"imported": imported, "mirrored": mirrored}

    def _import_ticket(self, ticket: dict, machine: str | None,
                       project_for: Callable[[str], str | None] | None) -> dict:
        name = (ticket.get("project") or "").strip() or project_name_for(
            ticket.get("repo") or "", project_for)
        project = self.ensure_project(name, ticket.get("repo"))
        self.ensure_branch(project["id"], "engineering")
        status, detail = self._status_of(ticket)
        card = self.create_card(
            project["id"],
            title=(ticket.get("title") or f"ticket {ticket['id']}"),
            # Nothing of the agent's goes on the human face, not even on a card
            # that was an agent's ticket before it was a card.
            summary="",
            branch="engineering",
            column=IMPORT_COLUMN.get(ticket.get("status") or "", "queued"),
            executor="coding_agent", machine=machine, repo=ticket.get("repo"),
            agent={"goal": ticket.get("goal") or "",
                   "done_criteria": ticket.get("done_criteria") or []},
            ustabasi_id=ticket["id"], position=None)
        with self._lock:
            self._c.execute(
                "UPDATE cards SET agent_status=?, agent_status_at=?, agent_detail=? WHERE id=?",
                (status, time.time(), detail, card["id"]))
            self._c.commit()
        return self.get_card(card["id"])

    def _mirror(self, card: dict, ticket: dict) -> bool:
        status, detail = self._status_of(ticket)
        if card["agent_status"] == status and card["agent_detail"] == detail:
            return False
        with self._lock:
            self._c.execute(
                "UPDATE cards SET agent_status=?, agent_detail=?, agent_status_at=? WHERE id=?",
                (status, detail, time.time(), card["id"]))
            self._c.commit()
        return True

    @staticmethod
    def _status_of(ticket: dict) -> tuple[str, str]:
        """The queue's word for a ticket, in this side's word, with its line.

        `blocked` splits: a blocked ticket carrying an escalation is *asking*,
        and that is the whole of "waiting on you". One without is stopped and
        nobody has said why yet.
        """
        raw = (ticket.get("status") or "").strip()
        question = (ticket.get("escalation") or "").strip()
        if raw == "blocked":
            return (ASKING if question else BLOCKED), question
        return AGENT_STATUS.get(raw, raw or "queued"), question

    # ── rows into answers ──────────────────────────────────────────────────

    def _project(self, r: sqlite3.Row) -> dict:
        repos = [x["path"] for x in self._c.execute(
            "SELECT path FROM project_repos WHERE project_id=? ORDER BY path",
            (r["id"],)).fetchall()]
        return {"id": r["id"], "name": r["name"], "slug": r["slug"],
                "summary": r["summary"] or "", "sort": r["sort"],
                "archived": bool(r["archived"]), "repos": repos,
                "created_at": r["created_at"], "updated_at": r["updated_at"]}

    def _card(self, r: sqlite3.Row, agent: bool = False) -> dict:
        out = {
            "id": r["id"], "project_id": r["project_id"], "branch_id": r["branch_id"],
            "branch": r["branch"],
            "column": r["column"], "position": r["position"],
            "title": r["title"], "summary": r["summary"] or "",
            "executor": r["executor"], "machine": r["machine"], "repo": r["repo"],
            "ustabasi_id": r["ustabasi_id"],
            "agent_status": r["agent_status"], "agent_status_at": r["agent_status_at"],
            "agent_detail": r["agent_detail"] or "",
            "created_at": r["created_at"], "updated_at": r["updated_at"],
            "moved_at": r["moved_at"],
        }
        if agent:
            # The second face, and only where it was asked for. A board of forty
            # cards has no use for forty sets of constraints, and the rule that
            # agent text stays off the human face is easiest to keep when the
            # two travel separately.
            out["agent"] = {
                "goal": r["goal"] or "",
                "done_criteria": _json(r["done_criteria"], []),
                "verify_cmd": r["verify_cmd"] or "",
                "constraints": _json(r["constraints"], []),
                "paths": _json(r["paths"], []),
                "notes": r["notes"] or "",
            }
        return out

    def _branch_views(self, project_id: str, cards: list[dict]) -> list[dict]:
        """The branch cards of a project page.

        `summary` is whatever was written down for that branch and is usually
        empty: the real sources — the SEO nightly, PostHog, Sentry, the bill —
        are not connected yet, and a branch with nothing to say says nothing
        rather than a made-up number. `cards` is the one figure this side
        genuinely holds.
        """
        out = []
        for b in self.branches(project_id):
            mine = [c for c in cards if c["branch_id"] == b["id"]]
            out.append({
                "id": b["id"], "kind": b["kind"], "name": b["name"],
                "summary": b["summary"] or "", "summary_at": b["summary_at"],
                "cards": {col: sum(1 for c in mine if c["column"] == col) for col in COLUMNS},
                "open": sum(1 for c in mine if c["column"] != "done"),
            })
        return out

    # ── the line a project is read by ──────────────────────────────────────

    def project_view(self, project: dict) -> dict:
        """A project with its branches and one line saying where it stands.

        The line is counted, never guessed: how many agents are running on it,
        how many cards are waiting for a person, and how much is queued behind
        them. "Waiting on you" is the number the dashboard is really for — an
        agent that stopped to ask, one that was turned down, and every card
        whose executor is a person.
        """
        cards = self.cards(project["id"])
        running = sum(1 for c in cards if c["agent_status"] == "running")
        waiting = sum(1 for c in cards if _waiting(c))
        queued = sum(1 for c in cards if c["column"] == "queued")
        counts = {col: sum(1 for c in cards if c["column"] == col) for col in COLUMNS}
        return {**project,
                "branches": self._branch_views(project["id"], cards),
                "counts": counts, "running": running, "waiting": waiting,
                "summary_line": _summary_line(running, waiting, queued)}


def _waiting(card: dict) -> bool:
    """A card that needs a person before anything else happens to it."""
    if card["column"] == "done":
        return False
    if card["agent_status"] in (ASKING, BLOCKED, "failed"):
        return True
    return card["executor"] == "human" and card["column"] == "in_progress"


def _summary_line(running: int, waiting: int, queued: int) -> str:
    """One line, in whole words, with nothing in it that is zero."""
    parts = []
    if running:
        parts.append(f"{running} running")
    if waiting:
        parts.append(f"{waiting} waiting on you")
    if queued:
        parts.append(f"{queued} queued")
    return " · ".join(parts) or "nothing running"


# ── handing a card to the coding executor ────────────────────────────────────


def wants_ustabasi(card: dict) -> bool:
    """Is this the drag that starts a coding job?

    In progress, on the coding executor, and not already filed. Everything else
    — a card the branch agent has, a card that is yours, a card that was filed
    on an earlier drag and dragged back — is a move and nothing more.
    """
    return (card["column"] == "in_progress"
            and card["executor"] == "coding_agent"
            and not card["ustabasi_id"])


def ticket_spec(card: dict, project: dict) -> dict:
    """The card, in the shape the queue's `add` takes.

    The agent face is what is sent, and the human face stands in for whatever
    it is missing: a card dragged straight out of the Ice Box has a title and
    two sentences and nothing else, and refusing to start it because nobody
    wrote a "goal" would make the drag a form. So the goal falls back to the
    summary and then to the title, and the one done criterion the queue insists
    on falls back to the title — which is, after all, what done means on a card
    somebody wrote in a sentence.
    """
    face = card.get("agent") or {}
    goal = (face.get("goal") or "").strip() or (card["summary"] or "").strip() or card["title"]
    done = list(face.get("done_criteria") or []) or [card["title"]]
    repo = card.get("repo") or (project.get("repos") or [None])[0]
    if not repo:
        raise ValueError("this project has no repository to work in")
    card_spec = {"goal": goal, "done_criteria": done,
                 "verify_cmd": (face.get("verify_cmd") or "").strip() or None,
                 "constraints": list(face.get("constraints") or []),
                 "allowed": list(face.get("paths") or [])}
    notes = (face.get("notes") or "").strip()
    if notes:
        card_spec["notes"] = notes
    return {"title": card["title"], "repo": repo, "base_branch": "main",
            "card": card_spec}


async def file_with_ustabasi(board: Board, card_id: str) -> dict:
    """Queue a card as a ticket and write the number it came back with.

    The write goes through that program's CLI rather than its database, for the
    same reason a note does: what "queue this" means — the row, the branch name,
    the lane, the priority — is its own sequence and copying it here would mean
    keeping two copies of it correct.
    """
    card = board.get_card(card_id)
    if card is None:
        raise ValueError("no such card")
    if card["ustabasi_id"]:
        return card
    project = board.get_project(card["project_id"])
    ticket_id = await ustabasimod.add(ticket_spec(card, project or {}))
    return board.attach_ustabasi(card_id, ticket_id)
