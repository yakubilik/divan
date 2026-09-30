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

And the rule everything else is built around: **a card the coding agent has
follows its ticket; a card a person has follows the person.** Nobody drags a
ticket across the board by hand (Yakup, 2026-09-30: "ben tek tek kaydırmayacağım").
The queue already knows where each ticket is — queued, running, blocked, failed,
done, cancelled — and the mirror reads that into two things at once: the small
status mark on the card, and the column the card sits in (`STATUS_COLUMN`). A
worker picking a ticket up moves its card into In Progress; a verifier passing
it moves it into Done; a cancellation lands in Done too, with its mark saying
cancelled. The move happens on a status *change*: a card somebody dragged
somewhere in between stays there until the ticket's status next changes, and
then the status wins. Cards with no ticket on them — a human's, or one nobody
has started — are moved by fingers and by nothing else.

The mirror is one-way. ustabasi keeps its own database and stays the coding
executor; this side reads its snapshot and writes down what it saw. The single
write in the other direction is filing a new ticket, and it goes through that
program's own CLI (`ustabasi.add`), because what "queue this" means is its
sequence to define.

And the mirror **creates nothing**. A product exists because somebody said it
does, which is one request (`divan.project.create`) and no other, so a ticket in
a folder no product owns does not conjure a product out of the folder's name. It
lands in the single hidden holding place instead — in no list and no count a
dashboard draws — and it moves onto a real board the moment a product claims its
path. Which product that is comes off the **path** first and the name second:
the ticket in `~/projects/babysee/app` is babysee's because babysee owns that
folder, and a product whose name is nothing like its folder — Divan, checked out
in `remote-ai-chat` — must be neither matched nor renamed by a folder name.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime
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

#: What kind of thing a product is. Suggestions and not a closed set, the same
#: arrangement as `BRANCH_KINDS`: `create_project` takes any word, so a product
#: that turns out to be a newsletter is a `newsletter` without a migration.
#: Written as a slug, which is why `client work` arrives as `client-work`.
PROJECT_KINDS = ("app", "web", "library", "client", "research", "content", "infra")

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

#: Which column a ticket's status puts its card in. Read on import, and again
#: on every poll where the status has changed since the mirror last placed the
#: card (`agent_column` remembers what it placed by). `blocked` and `failed`
#: stay in In Progress: they are work that stopped, not work that is finished,
#: and a red mark in the middle column is what says so at seven in the morning.
STATUS_COLUMN = {
    "queued": "queued",
    "running": "in_progress",
    "blocked": "in_progress",
    "failed": "in_progress",
    "done": "done",
    "cancelled": "done",
}
IMPORT_COLUMN = STATUS_COLUMN  # the older name, kept for the tests that use it

#: The human face is deliberately small. A title is a line and a summary is two
#: or three sentences; anything longer is the agent face, or it is a new card.
MAX_TITLE = 160
MAX_SUMMARY = 600

#: The slug of the one row in `projects` that is not a product: where a card
#: goes when no product owns its repository and no product answers to the name
#: the path suggests. Seeded by the migration — never by the mirror — and
#: `hidden`, so it is in no project list and in no count a dashboard draws. A
#: ticket out of an unknown folder is work waiting to be filed, not a
#: twenty-second product on somebody's board.
UNFILED = "unfiled"
UNFILED_NAME = "Unfiled"

#: How long a kind may be. A product's purpose is held to `MAX_SUMMARY`, the
#: same as a card's: it is the sentence or two a screen draws under the name.
MAX_KIND = 40

#: What `update_project` will write, and the words it answers to. `purpose` is
#: `summary` said the other way round and is accepted as such: what a product is
#: *for* is the line a screen draws under its name, and one field cannot
#: contradict itself the way two would. `slug` and `hidden` are not here — the
#: first is the key two machines match a product by and the second is what marks
#: the row that is not a product at all.
PROJECT_FIELDS = frozenset({"name", "summary", "purpose", "kind", "started_at",
                            "sort", "archived", "repos"})

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  -- what a screen calls it, and what two machines match the same product by.
  -- The name is editable and the slug is not: it is the merge key the clients
  -- fold two computers' answers under (`app/src/divan.ts projectKey`), so a
  -- rename moves the name and leaves the key where it was.
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  -- what the product is *for*, in a sentence or two. One field and not two:
  -- "summary" and "purpose" are the same sentence said twice, and two of them
  -- is two things to keep from contradicting each other.
  summary TEXT DEFAULT '',
  -- app, web, library, client work, research… an open set (`PROJECT_KINDS`).
  kind TEXT DEFAULT '',
  -- when the product actually began, which is not when this row was written:
  -- a board met on Tuesday can hold a product started last March.
  started_at REAL,
  sort INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  -- a row in this table that is not a product. Exactly one, seeded by the
  -- migration, holding the cards no product has claimed.
  hidden INTEGER DEFAULT 0,
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
  -- the column the mirror last placed the card in by its ticket's status;
  -- NULL on a card the mirror has never placed
  agent_column TEXT,
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
    "cards": (("agent_detail", "TEXT DEFAULT ''"), ("agent_column", "TEXT")),
    "projects": (("summary", "TEXT DEFAULT ''"), ("kind", "TEXT DEFAULT ''"),
                 ("started_at", "REAL"), ("hidden", "INTEGER DEFAULT 0")),
}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "project"


def project_kind(value) -> str:
    """A kind, as a word. Empty is a value: most products never say.

    Slugged rather than checked against a list, because the list is a set of
    suggestions and not a fence — `PROJECT_KINDS` is what the clients offer,
    `client work` is stored as `client-work`, and a product that is none of them
    still gets to say what it is.
    """
    text = ("" if value is None else str(value)).strip()
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:MAX_KIND]


def parse_when(value) -> float | None:
    """A date somebody typed, as a timestamp. `None` and "" clear it.

    `started_at` is the day the *product* began and is given by a person, so it
    arrives the way a person writes one: `2026-03-01`, `2026-03`, `2026`, an ISO
    moment, or a timestamp from a client that already has one. A date nobody can
    read is refused rather than silently dropped — a product quietly missing the
    one thing that was being set is worse than an error.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"I could not read {value!r} as a date: try 2026-03-01")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}", text):
        text += "-01-01"
    elif re.fullmatch(r"\d{4}-\d{2}", text):
        text += "-01"
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        pass
    try:
        # A client that has a timestamp and sent it as text.
        return float(text)
    except ValueError:
        raise ValueError(f"I could not read {value!r} as a date: try 2026-03-01")


def repo_path(path) -> str:
    """A repository path, as this side compares two of them.

    Lexical and nothing else: `resolve()` would touch the filesystem, and the
    folder a card names may have been renamed or be on a volume that is not
    mounted, neither of which changes which product owns it. Windows sends
    backslashes and the same checkout may arrive with a trailing separator, so
    both are flattened.
    """
    text = str(path or "").strip().replace("\\", "/")
    while len(text) > 1 and text.endswith("/"):
        text = text[:-1]
    return text


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
    _seed_unfiled(conn)
    conn.commit()


def _seed_unfiled(conn: sqlite3.Connection) -> None:
    """The one place a card can be, on no product's board.

    Making a product is a decision a person takes, so the mirror does not take
    it — and a ticket out of a folder no product owns still has to land where it
    can be found again. Hence exactly one holding row, written here, by the
    migration, once: the mirror only ever puts cards in it.

    It is `hidden`, which is the whole of the difference between this and what
    the mirror used to do. A hidden row is in no project list, in no dashboard
    count and in nobody's board — so a strange folder costs a line under
    "unfiled" rather than a product nobody created.

    A database that already has a project of this slug — one the old mirror made
    — is adopted rather than argued with: it becomes the holding place and its
    cards are already where they belong.
    """
    now = time.time()
    conn.execute(
        "INSERT INTO projects (id,name,slug,summary,kind,started_at,sort,archived,hidden,"
        "created_at,updated_at) SELECT ?,?,?,'','',NULL,0,0,1,?,? WHERE NOT EXISTS"
        " (SELECT 1 FROM projects WHERE slug=?)",
        (UNFILED, UNFILED_NAME, UNFILED, now, now, UNFILED))
    conn.execute("UPDATE projects SET hidden=1 WHERE slug=? AND hidden!=1", (UNFILED,))
    # It needs the one branch a card can sit on. `ensure_branch` is a Board
    # method and the migration runs before there is a Board, so it is said here
    # in SQL, guarded by the same unique index that guards that method.
    conn.execute(
        "INSERT INTO branches (id,project_id,kind,name,summary,summary_at,sort,created_at)"
        " SELECT ?,p.id,'engineering',?,'',NULL,0,? FROM projects p WHERE p.slug=?"
        " AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.project_id=p.id"
        " AND b.kind='engineering')",
        (new_id(), BRANCH_NAMES["engineering"], now, UNFILED))


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
        """The products. Not the archived ones, and never the holding place."""
        rows = self._c.execute(
            "SELECT * FROM projects WHERE archived=0 AND hidden=0 ORDER BY sort, name"
        ).fetchall()
        return [self._project(r) for r in rows]

    def get_project(self, pid: str) -> dict | None:
        r = self._c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        return self._project(r) if r else None

    def project_by_name(self, name: str) -> dict | None:
        r = self._c.execute("SELECT * FROM projects WHERE slug=?",
                            (slugify(name),)).fetchone()
        return self._project(r) if r else None

    def find_project(self, ref: str) -> dict | None:
        """A product by its id, its slug, or the name on the screen.

        Three spellings of one question, asked in the order that cannot be
        ambiguous: an id is unique, a slug is unique, and a name is neither but
        is what a person says out loud. The last is why this exists at all — the
        entrance to a project is a sentence in a chat, and `divan.project.update
        {project: "Divan"}` has to work without anybody looking up a hex id.
        """
        ref = (ref or "").strip()
        if not ref:
            return None
        for sql, arg in (("id=?", ref), ("slug=?", ref), ("slug=?", slugify(ref)),
                         ("name=?", ref)):
            r = self._c.execute(f"SELECT * FROM projects WHERE {sql} ORDER BY sort, name",
                                (arg,)).fetchone()
            if r is not None:
                return self._project(r)
        return None

    def unfiled_project(self) -> dict:
        """The holding place: the one row in this table that is not a product.

        Seeded by the migration, so it is here on every database this daemon has
        opened. Read by slug rather than by id, because a database whose old
        mirror already made an `unfiled` project has that row adopted as the
        holding place.
        """
        r = self._c.execute("SELECT * FROM projects WHERE slug=?", (UNFILED,)).fetchone()
        if r is None:                                            # pragma: no cover
            raise ValueError("the unfiled holding place is missing; run the migration")
        return self._project(r)

    def create_project(self, name: str, repos: list[str] | None = None,
                       branches: list[str] | None = None, *, slug: str | None = None,
                       kind: Any = "", summary: str = "",
                       started_at: Any = None) -> dict:
        """A product, with its branches, its repositories and what it is.

        **The only thing on this computer that writes a row into `projects`.**
        Nothing derives a product from a folder any more: the mirror files the
        work it finds and a product exists because somebody said it does, which
        is this call and the one request that reaches it.

        Everything past the name is optional and stays empty on the four
        products that predate it. `kind` is a word (`PROJECT_KINDS` is the list
        of suggestions, not a fence), `summary` is what the product is *for* in
        a sentence or two, and `started_at` is the day it actually began, which
        has nothing to do with the day this row was written.

        `slug` is the cross-machine key and is normally the name, slugged. It is
        given by hand for the one case that needs it: a product whose visible
        name has moved away from the checkout every machine knows it by — Divan,
        in `remote-ai-chat`.

        The branch list is the default five plus whatever else was asked for: a
        product with a support desk gets a support branch here rather than in a
        migration, and one that never needs SEO simply never looks at it.
        """
        name = (name or "").strip()
        if not name:
            raise ValueError("a project needs a name")
        key = slugify(slug) if (slug or "").strip() else slugify(name)
        if key == UNFILED:
            raise ValueError(f"'{UNFILED}' is reserved for the cards no product has claimed")
        if self._c.execute("SELECT 1 FROM projects WHERE slug=?", (key,)).fetchone():
            raise ValueError("a project with that name already exists")
        now = time.time()
        row = {"id": new_id(), "name": name[:MAX_TITLE], "slug": key,
               "summary": (summary or "").strip()[:MAX_SUMMARY],
               "kind": project_kind(kind), "started_at": parse_when(started_at),
               "sort": 0, "archived": 0, "hidden": 0,
               "created_at": now, "updated_at": now}
        cols = ",".join(row)
        vals = ",".join(":" + k for k in row)
        with self._lock:
            self._c.execute(f"INSERT INTO projects ({cols}) VALUES ({vals})", row)
            self._c.commit()
        kinds = list(BRANCH_KINDS) + [k for k in (branches or []) if k not in BRANCH_KINDS]
        for i, kind_name in enumerate(kinds):
            self.ensure_branch(row["id"], kind_name, sort=i)
        for path in repos or []:
            self.attach_repo(row["id"], path)
        return self.get_project(row["id"])

    def update_project(self, project_id: str, **fields: Any) -> dict:
        """Change a product: its name, what it is, what it is for, when it
        began, where its code is, and whether it is still on the board.

        The other half of the entrance. There is no form for a project anywhere
        in the clients and none is planned — a product is made and changed by
        saying so, in a chat, to the agent that can call this — so this takes
        every field `create_project` does and answers a wrong word with the list
        of right ones rather than ignoring it. A quiet no-op is the one thing a
        conversational entrance cannot afford.

        `repos` is the list, not an addition to it: a product whose API moved is
        told where its repositories are now. `slug` is absent on purpose. It is
        the key two machines fold the same product under, so a rename moves the
        name and leaves the key — which is exactly how a product can be called
        Divan while every computer still knows it as `remote-ai-chat`.
        """
        project = self.get_project(project_id)
        if project is None:
            raise ValueError("no such project")
        if project["slug"] == UNFILED:
            raise ValueError("the unfiled holding place is not a project")
        unknown = sorted(set(fields) - PROJECT_FIELDS)
        if unknown:
            raise ValueError(f"a project has no {', '.join(unknown)}"
                             f" — it has {', '.join(sorted(PROJECT_FIELDS))}")
        out: dict[str, Any] = {}
        if "name" in fields:
            name = str(fields["name"] or "").strip()
            if not name:
                raise ValueError("a project needs a name")
            out["name"] = name[:MAX_TITLE]
        for said in ("summary", "purpose"):
            if said in fields:
                out["summary"] = str(fields[said] or "").strip()[:MAX_SUMMARY]
        if "kind" in fields:
            out["kind"] = project_kind(fields["kind"])
        if "started_at" in fields:
            out["started_at"] = parse_when(fields["started_at"])
        if "sort" in fields:
            try:
                out["sort"] = int(fields["sort"])
            except (TypeError, ValueError):
                raise ValueError("sort is a number")
        if "archived" in fields:
            out["archived"] = 1 if fields["archived"] else 0
        if out:
            out["updated_at"] = time.time()
            sets = ",".join(f"{k}=:{k}" for k in out)
            out["id"] = project_id
            with self._lock:
                self._c.execute(f"UPDATE projects SET {sets} WHERE id=:id", out)
                self._c.commit()
        if "repos" in fields:
            paths = [repo_path(x) for x in _lines(fields["repos"])]
            with self._lock:
                self._c.execute("DELETE FROM project_repos WHERE project_id=?", (project_id,))
                self._c.executemany(
                    "INSERT OR IGNORE INTO project_repos (project_id, path) VALUES (?,?)",
                    [(project_id, x) for x in paths if x])
                self._c.execute("UPDATE projects SET updated_at=? WHERE id=?",
                                (time.time(), project_id))
                self._c.commit()
        return self.get_project(project_id)

    def project_for_repo(self, repo: str) -> dict | None:
        """The product whose repository this path is in, or none.

        Asked **before** any name, because the path is the fact and the name is
        a label. `~/projects/babysee/app` is work on babysee because babysee owns
        that folder; and the product checked out in `remote-ai-chat` is called
        Divan, which no rule about folder names would ever have guessed and
        which the old mirror used to overwrite.

        The longest registered path containing it wins, so a product that owns
        both `x` and `x/api` gets the one that is nearer the work.
        """
        path = repo_path(repo)
        if not path:
            return None
        best: tuple[str, str] | None = None
        for row in self._c.execute("SELECT project_id, path FROM project_repos"):
            owned = repo_path(row["path"])
            if not owned:
                continue
            if path == owned or path.startswith(owned + "/"):
                if best is None or len(owned) > len(best[1]):
                    best = (row["project_id"], owned)
        return self.get_project(best[0]) if best else None

    def project_for_ticket(self, ticket: dict,
                           project_for: Callable[[str], str | None] | None = None
                           ) -> dict:
        """Which board a queue ticket's card belongs on. Nothing is created here.

        The path first, the name second, the holding place last. The name is
        still asked because a product may own no repository yet and a ticket may
        carry one nobody registered; the holding place is what makes the first
        two able to answer "no" without a product being invented.
        """
        found = self.project_for_repo(ticket.get("repo") or "")
        if found is None:
            found = self.project_by_name(
                (ticket.get("project") or "").strip()
                or project_name_for(ticket.get("repo") or "", project_for))
        return found or self.unfiled_project()

    def attach_repo(self, project_id: str, path: str) -> None:
        """One more repository on a product. Written as it will be compared."""
        path = repo_path(path)
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
        """Write the queue's number on the card. Said once, when it is filed.

        The mirror may have got there first. Filing is: hand the spec to the
        CLI, wait for it, then write the number back — and an `ustabasi.list`
        poll landing in that gap sees a ticket with no card and imports it,
        which is precisely what the mirror is for. Left alone that ends as two
        cards for one ticket and a unique index refusing the second, so the
        import's card is folded into the one somebody actually dragged: it is
        seconds old, nothing on it was written by a person, and what it does
        carry — the status the queue had already reached — comes across.
        """
        now = time.time()
        with self._lock:
            dup = self._c.execute(
                "SELECT * FROM cards WHERE ustabasi_id=? AND id!=?",
                (int(ticket_id), card_id)).fetchone()
            # A card dragged into In Progress and filed is a queued ticket in a
            # column the person chose. `agent_column` is set to what the status
            # would have chosen, so the next poll sees nothing has changed and
            # leaves the card under the thumb that put it there; the first real
            # change — a worker picking it up — moves it, and by then that is
            # the same column.
            status, detail, placed = "queued", "", STATUS_COLUMN["queued"]
            if dup is not None:
                status = dup["agent_status"] or status
                detail = dup["agent_detail"] or ""
                placed = dup["agent_column"] or placed
                self._c.execute("DELETE FROM cards WHERE id=?", (dup["id"],))
                # The gap it leaves, closed here rather than by `delete_card`:
                # this lock is not re-entrant and the whole fold has to be one
                # transaction, or a reader sees the board with neither card on
                # it.
                self._c.execute(
                    "UPDATE cards SET position = position - 1"
                    " WHERE project_id=? AND column=? AND position > ?",
                    (dup["project_id"], dup["column"], dup["position"]))
            self._c.execute(
                "UPDATE cards SET ustabasi_id=?, agent_status=?, agent_detail=?,"
                " agent_status_at=?, agent_column=?, updated_at=? WHERE id=?",
                (int(ticket_id), status, detail, now, placed, now, card_id))
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
        after: the ticket's status, written onto the card as a mark — and, when
        the status has changed since the card was last placed, the card moved
        into the column that status means (`STATUS_COLUMN`). A ticket that is
        picked up, finishes or is cancelled while nobody is watching moves its
        own card, because nobody is going to drag forty of them by hand. A card
        the mirror has never placed (`agent_column` is NULL: one from before
        this rule) is placed on the first poll, which is the whole of the
        repair an older board needs.

        Neither of them creates a product, and neither writes anything else a
        person owns: no project row, no branch, not even a repository added to
        somebody's product because a ticket mentioned a folder inside it. The
        whole of what this writes is cards and the marks on them. What it cannot
        place goes to the holding place, and `filed` counts the cards it was
        able to move out of there afterwards, once a product claimed their path.
        """
        if not snapshot.get("available"):
            return {"imported": 0, "mirrored": 0, "filed": 0}
        imported = mirrored = filed = 0
        for ticket in snapshot.get("tickets") or []:
            card = self.card_by_ustabasi(ticket["id"])
            if card is None:
                self._import_ticket(ticket, machine, project_for)
                imported += 1
                continue
            if self._refile(card, ticket, project_for):
                filed += 1
                card = self.get_card(card["id"]) or card
            if self._mirror(card, ticket):
                mirrored += 1
        return {"imported": imported, "mirrored": mirrored, "filed": filed}

    def _import_ticket(self, ticket: dict, machine: str | None,
                       project_for: Callable[[str], str | None] | None) -> dict:
        project = self.project_for_ticket(ticket, project_for)
        branch = self._import_branch(project)
        if branch is None:
            # A product with no branch at all is one this import cannot sit on,
            # and adding one is a decision about a product. The holding place
            # has had its engineering branch since the migration.
            project = self.unfiled_project()
            branch = self._import_branch(project)
        status, detail = self._status_of(ticket)
        card = self.create_card(
            project["id"],
            title=(ticket.get("title") or f"ticket {ticket['id']}"),
            # Nothing of the agent's goes on the human face, not even on a card
            # that was an agent's ticket before it was a card.
            summary="",
            branch=branch["kind"],
            column=STATUS_COLUMN.get(ticket.get("status") or "", "queued"),
            executor="coding_agent", machine=machine, repo=ticket.get("repo"),
            agent={"goal": ticket.get("goal") or "",
                   "done_criteria": ticket.get("done_criteria") or []},
            ustabasi_id=ticket["id"], position=None)
        with self._lock:
            self._c.execute(
                "UPDATE cards SET agent_status=?, agent_status_at=?, agent_detail=?,"
                " agent_column=? WHERE id=?",
                (status, time.time(), detail, card["column"], card["id"]))
            self._c.commit()
        return self.get_card(card["id"])

    def _import_branch(self, project: dict) -> dict | None:
        """The branch an imported card lands on.

        Engineering, which every product gets on the day it is created — or, on
        a product somebody has rearranged, whichever branch it has first. The
        mirror does not add one: a face of a product is a decision too.
        """
        return (self.branch(project["id"], "engineering")
                or (self.branches(project["id"]) or [None])[0])

    def _refile(self, card: dict, ticket: dict,
                project_for: Callable[[str], str | None] | None) -> bool:
        """A card in the holding place, put on the board that now claims it.

        The one move the mirror is allowed, and it is not a move on anybody's
        board: a card lands in the holding place because no product owned its
        folder at the time, and the answer to that is usually somebody creating
        the product a day later. Without this the card would sit under "unfiled"
        for ever and the board it belongs to would look empty.

        Cards that are already on a product's board are never touched. That one
        is where a person put it, and the whole rule of this side is that the
        mirror does not move those.
        """
        if card["project_id"] != self.unfiled_project()["id"]:
            return False
        project = self.project_for_ticket(ticket, project_for)
        if project["id"] == card["project_id"]:
            return False
        branch = self._import_branch(project)
        if branch is None:
            return False
        with self._lock:
            # The bottom of the column it is already in: the column was read off
            # the ticket's status when it was imported and is still the truest
            # thing said about it, and the order of a column it is arriving in
            # is not this side's to guess at.
            n = self._c.execute(
                "SELECT COUNT(*) FROM cards WHERE project_id=? AND column=?",
                (project["id"], card["column"])).fetchone()[0]
            self._c.execute(
                "UPDATE cards SET project_id=?, branch_id=?, position=?, updated_at=?"
                " WHERE id=?", (project["id"], branch["id"], n, time.time(), card["id"]))
            # …and the gap it left behind in the holding place.
            self._c.execute(
                "UPDATE cards SET position = position - 1"
                " WHERE project_id=? AND column=? AND position > ?",
                (card["project_id"], card["column"], card["position"]))
            self._c.commit()
        return True

    def _mirror(self, card: dict, ticket: dict) -> bool:
        """The ticket's status onto the card: the mark, and the column.

        The column moves only when the status has changed since the mirror
        last placed the card — `agent_column` is what it placed by — so a card
        somebody dragged in the meantime is not snapped back on the next poll
        for no reason, and *is* moved the moment the ticket actually goes
        somewhere. A card with no `agent_column` yet has never been placed:
        it is placed now, wherever its status says, which is how boards from
        before this rule come right on their first poll.
        """
        status, detail = self._status_of(ticket)
        target = STATUS_COLUMN.get((ticket.get("status") or "").strip(), "queued")
        moved = False
        if card["agent_column"] != target:
            if card["column"] != target:
                # `move` takes the lock itself, and it is the one writer of
                # `column`/`position`: the mirror does not learn a second way.
                self.move(card["id"], target)
            moved = True
        if not moved and card["agent_status"] == status and card["agent_detail"] == detail:
            return False
        with self._lock:
            self._c.execute(
                "UPDATE cards SET agent_status=?, agent_detail=?, agent_status_at=?,"
                " agent_column=? WHERE id=?",
                (status, detail, time.time(), target, card["id"]))
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
                "summary": r["summary"] or "", "kind": r["kind"] or "",
                "started_at": r["started_at"], "sort": r["sort"],
                "archived": bool(r["archived"]), "hidden": bool(r["hidden"]),
                "repos": repos,
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
            "agent_column": r["agent_column"],
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

    # ── the whole board, for a phone holding several machines ──────────────

    def snapshot(self, machine: str) -> dict:
        """Everything this computer has to say about its board, in one answer.

        The phone is paired with several computers and the project is the
        context, not the machine — so every screen it draws is every machine at
        once, and it has to ask all of them. Asked project by project that is a
        dozen round trips per computer, and a laptop that is asleep costs a
        timeout for each one. One request per machine is the whole of the
        difference: it is asked on connect, when the app comes forward and on a
        slow timer, and a machine that does not answer costs one wait.

        Nothing here is merged or ranked. Which of two machines a project lives
        on, and what a stale one's numbers are worth, is the phone's to work out
        — it is the only party that knows how long ago each machine answered
        (`app/src/divan.ts`). This end's job is to say what is true here and to
        say which computer "here" is.

        `cards` is the open board: everything outside `done`. That column grows
        for ever, the counts beside each project already say how many are in it,
        and nothing on a dashboard is drawn from a card finished last March.

        `unfiled` is the work no product has claimed, whole: a ticket
        out of a folder this computer's board knows nothing about is a card in
        the holding place, and it travels here so that it can be seen and filed
        rather than quietly waiting in a project nobody made. It is deliberately
        *not* in `projects`: it is in no count, no dashboard total and no
        product's board, because a strange folder is not a product.

        `activity` is what git says about the repositories those products own —
        the one thing on the answer that is not the board. It is keyed by path
        and not by project so that a phone holding two machines can tell the
        same checkout on both from two halves of one product; which of its
        products each path belongs to is already in `projects`.
        """
        projects = self.list_projects()
        mine = {p["id"] for p in projects}
        # A card whose project has been archived belongs to a board nobody is
        # looking at: the lists have to agree, or the phone holds cards of a
        # project it was never told about.
        cards = [c for c in self.cards()
                 if c["project_id"] in mine and c["column"] != "done"]
        holder = self.unfiled_project()
        # All of them, `done` included, unlike the boards above. A card in the
        # holding place is not a card somebody has finished with — the column it
        # is in was read off a ticket's status and no person has ever looked at
        # it — so dropping the finished ones would be the one way a ticket out of
        # an unknown folder could still go unseen. The list stays short on its
        # own: a card leaves it as soon as a product claims its path.
        unfiled = self.cards(holder["id"])
        names = {p["id"]: p["name"] for p in projects}
        names[holder["id"]] = holder["name"]
        return {
            "machine": machine,
            "projects": [self.project_view(p) for p in projects],
            "cards": cards,
            "unfiled": unfiled,
            "unfiled_project_id": holder["id"],
            # Every agent actually at work on this computer, including one on a
            # card nothing has claimed: a worker is running whether or not the
            # board has worked out whose product it is.
            "agents": [self._agent_view(c, machine, names.get(c["project_id"], ""))
                       for c in cards + unfiled if c["agent_status"] == "running"],
            "activity": activity_of([path for p in projects for path in p["repos"]]),
            # …and what the code host says about those same repositories, which
            # is the one reading here that leaves the machine. Absent per path
            # where nobody could be asked, and an empty list where nothing is
            # open: the phone draws the two differently.
            "pulls": pulls_of([path for p in projects for path in p["repos"]]),
        }

    def _agent_view(self, card: dict, machine: str, project: str) -> dict:
        """An agent at work right now, as a line on a dashboard: who is doing
        what, on which machine.

        Only the ones actually running. A card that stopped to ask is waiting on
        a person rather than working, and it is read as a card — under "waiting
        on you", where somebody will answer it — not as an agent.

        `machine` falls back to the computer answering: a card that nobody
        assigned is being worked where it is, and a row that cannot say where
        its agent is running is no use on a screen whose whole subject is
        several machines.
        """
        return {"card_id": card["id"], "project_id": card["project_id"],
                "project": project, "branch": card["branch"], "title": card["title"],
                "executor": card["executor"], "machine": card["machine"] or machine,
                "status": card["agent_status"], "detail": card["agent_detail"],
                "since": card["agent_status_at"], "ustabasi_id": card["ustabasi_id"]}


# ── what git has to say about a product ──────────────────────────────────────
# The board says what is being worked on. It cannot say whether a product is
# alive: a project with an empty board and nine commits this week is busy, and
# one with four cards nobody has touched since August is not. That fact is in
# the repositories the product owns and nowhere else, so it is read out of them
# — by this end, because the repositories are here.
#
# Two figures and no third. What a product *earns* — the MRR, the DAU, the
# visits the frames put at the top of a project card — has no source connected
# yet, and a card with a made-up number on it is worse than a card with a gap.

#: How long a repository's history is believed for. A week's worth of commits
#: does not change between two polls a minute apart, and every miss is two
#: `git log` calls per repository on a computer that may have twenty.
_ACTIVITY_TTL = 300.0
_activity_cache: dict[str, tuple[float, dict | None]] = {}

#: Long enough that a repository on a network volume does not hold up a whole
#: snapshot, short enough that the phone's own wait (8 s for everything) is not
#: spent here.
_GIT_TIMEOUT_S = 3.0

#: What "finished in the last seven days" is counted over.
ACTIVITY_WINDOW_S = 7 * 24 * 3600


def repo_activity(path: str, now: float | None = None) -> dict | None:
    """When one repository last moved, and how much landed in it lately.

    `at` is the last commit's own time, `week` the commits of the last seven
    days and `today` those since midnight here — the two figures a project card
    carries and the one a dashboard counts "done today" out of.

    Commits, not merges and not tickets: a merge is one worker's work landing
    and so is a commit pushed straight to the branch, and this repository is run
    both ways. Nothing is guessed — `None` comes back for a path that is not a
    git repository, that is not there any more, or that git would not answer
    about, and a figure nobody could measure is then absent rather than zero.
    """
    now = now or time.time()
    hit = _activity_cache.get(path)
    if hit and now - hit[0] < _ACTIVITY_TTL:
        return hit[1]

    def run(*args: str) -> str | None:
        try:
            r = subprocess.run(("git", "-C", path, *args), capture_output=True,
                               text=True, timeout=_GIT_TIMEOUT_S)
        except Exception:
            return None
        return r.stdout if r.returncode == 0 else None

    out = run("log", "-1", "--format=%ct")
    if out is None:
        # Not a repository, gone, or a repository with no commit in it yet.
        # All three are "nothing to say", which is what the phone draws.
        info = None
    else:
        head = out.strip().splitlines()
        at = _float(head[0]) if head else None
        # One pass over the window, counted twice: the day is inside the week.
        midnight = datetime.fromtimestamp(now).replace(
            hour=0, minute=0, second=0, microsecond=0).timestamp()
        stamps = [t for t in (_float(x) for x in
                              (run("log", f"--since={int(now - ACTIVITY_WINDOW_S)}",
                                   "--format=%ct") or "").split())
                  if t is not None]
        info = {"at": at, "week": len(stamps),
                "today": sum(1 for t in stamps if t >= midnight)}
    _activity_cache[path] = (now, info)
    return info


#: How long the whole set of repositories may take on one snapshot. The phone
#: gives a machine eight seconds for *everything* and a computer here has twenty
#: products on it; twenty cold `git log` pairs on a spinning network volume is
#: how this request would come to be the one that times out. So it is a budget:
#: whatever is already known travels for free, new readings stop when the time is
#: up, and the rest arrive on the next poll — a card without a figure for a
#: minute, rather than a dashboard with nothing on it at all.
_BUDGET_S = 2.5


def activity_of(paths: list[str], now: float | None = None,
                budget_s: float = _BUDGET_S) -> dict[str, dict]:
    """The same, for every repository a machine's products own, keyed by path.

    Keyed by path rather than by project because the phone merges several
    machines: isghocam's site may be checked out on the studio and its API on
    the mini, and one product's figure is the union of its repositories. Two
    machines that hold the *same* checkout would otherwise have their commits
    counted twice, and a path is the only thing the two answers agree on.
    """
    now = now or time.time()
    out: dict[str, dict] = {}
    deadline = time.monotonic() + budget_s
    for path in dict.fromkeys(paths):
        hit = _activity_cache.get(path)
        cold = hit is None or now - hit[0] >= _ACTIVITY_TTL
        if cold and time.monotonic() >= deadline:
            # Out of time for a new reading. A reading from six minutes ago is
            # still worth sending — a week's commit count does not move in
            # minutes — and a path never read is absent until the next poll.
            info = hit[1] if hit else None
        else:
            info = repo_activity(path, now)
        if info is not None:
            out[path] = info
    return out


def _float(text: str | None) -> float | None:
    try:
        return float((text or "").strip())
    except (TypeError, ValueError):
        return None


# ── what the code host says about a repository ───────────────────────────────
# The board and the git history above are both *here*: this computer's database
# and this computer's checkouts. A pull request is neither. It lives on the code
# host, and the only thing on this machine that can ask about one is the `gh`
# already signed in for whoever runs this daemon — so this is the one reading on
# the snapshot that leaves the machine, and it is fenced accordingly.
#
#   * **Only a repository whose `origin` is on GitHub**, read out of the local
#     git config and nowhere else. No remote, no reading, no request.
#   * **Only where `gh` is installed and answers.** Where it is not, the map has
#     no entry for that path and the phone says the source is not connected —
#     which is a different sentence from "nothing is open", and the branch page
#     draws the two differently. An empty list is an answer; a missing entry is
#     the absence of one.
#   * **A refusal is remembered as long as an answer is.** A laptop with no
#     network must not spend part of every poll finding that out again, so
#     `None` is cached exactly like a reading.
#   * **And the whole set runs against a budget**, as the git readings do: the
#     phone allows a machine eight seconds for everything.
#
# Nothing here is written down. The cards, the board and the marks on them are
# the daemon's; what the code host says is read on the way past and cached in
# memory, because it is true for ten minutes and false the moment somebody
# merges something.

#: Long enough that a poll is not a request: pull requests do not change minute
#: to minute, and every miss is a call over the network per repository.
_PULLS_TTL = 600.0
_pulls_cache: dict[str, tuple[float, dict | None]] = {}

#: Shorter than git's, because this one can hang on DNS rather than on disk — and
#: because the git readings above have already had their share of the eight
#: seconds the phone allows a machine for the whole answer. One `gh` that is
#: slower than this is a slow network, and its answer arrives on the next poll.
_GH_TIMEOUT_S = 2.0

#: …and a smaller budget than the git readings have, for the same reason. It is
#: spent on new readings only; everything already known travels for free.
_PULLS_BUDGET_S = 1.5

#: How many of a repository's open pull requests travel. A phone draws the first
#: few on a branch page; a repository with forty open is a repository whose
#: fortieth is not news.
_PULLS_LIMIT = 10

#: A check run or a commit status that has finished badly. `gh` reports the two
#: in one list and they do not use the same word for it.
_FAILING = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE",
            "STALE", "ERROR"}

#: …and one that has not finished at all.
_PENDING = {"PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"}

_GH_REMOTE = re.compile(
    r"^(?:https://|git@|ssh://git@)github\.com[:/]+([^/]+)/(.+?)(?:\.git)?/?$")


def github_remote(path: str) -> str | None:
    """`owner/name` where this checkout's `origin` is on GitHub, else `None`.

    Read off the local git config, which is the whole point: a folder that is
    not a GitHub checkout is never the subject of a request, and working that
    out costs one `git` call rather than one round trip.
    """
    try:
        r = subprocess.run(("git", "-C", path, "remote", "get-url", "origin"),
                           capture_output=True, text=True, timeout=_GIT_TIMEOUT_S)
    except Exception:
        return None
    if r.returncode:
        return None
    m = _GH_REMOTE.match((r.stdout or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else None


def _gh(path: str, *args: str) -> str | None:
    """`gh` in that checkout, or `None` where it is absent, slow or said no.

    The one seam in this file a test replaces: everything above it is local and
    can be stood up in a temporary folder, and this cannot.
    """
    if not shutil.which("gh"):
        return None
    env = {**os.environ, "GH_NO_UPDATE_NOTIFIER": "1", "GH_PROMPT_DISABLED": "1",
           "NO_COLOR": "1", "CLICOLOR": "0"}
    try:
        r = subprocess.run(("gh", *args), cwd=path, capture_output=True, text=True,
                           timeout=_GH_TIMEOUT_S, env=env)
    except Exception:
        return None
    return r.stdout if r.returncode == 0 else None


def _checks(rollup: Any) -> tuple[str | None, int]:
    """One pull request's checks, as a word and a count of what is failing.

    A word rather than the runs themselves: a phone draws `× 2 checks` and has
    no use for forty check names, and the ones that matter are the failing ones.
    `None` where the pull request has no checks at all, which is not the same as
    passing — a repository with no CI must not be drawn with a green tick.
    """
    if not isinstance(rollup, list) or not rollup:
        return (None, 0)
    failing = pending = 0
    for c in rollup:
        if not isinstance(c, dict):
            continue
        state = str(c.get("conclusion") or c.get("state") or "").upper()
        status = str(c.get("status") or "").upper()
        if state in _FAILING:
            failing += 1
        elif not state or state in _PENDING or (status and status != "COMPLETED"):
            pending += 1
    if failing:
        return ("failing", failing)
    if pending:
        return ("pending", 0)
    return ("passing", 0)


def _at(text: Any) -> float | None:
    """A code host's timestamp as seconds, or `None`."""
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def read_pulls(path: str, now: float | None = None) -> dict | None:
    """What is open on one repository, and how the checks on it stand.

    `{"at": when this was read, "open": [...]}`, newest first. `None` where
    nobody could be asked — not a GitHub checkout, no `gh`, not signed in, no
    network — and a repository with nothing open is the same answer with an
    empty list in it. The phone needs both: "nothing to review" and "nobody
    asked" are different things to see on a branch page.
    """
    now = now or time.time()
    if github_remote(path) is None:
        return None
    out = _gh(path, "pr", "list", "--state", "open", "--limit", str(_PULLS_LIMIT),
              "--json", "number,title,headRefName,isDraft,updatedAt,statusCheckRollup")
    if out is None:
        return None
    try:
        rows = json.loads(out or "[]")
    except Exception:
        return None
    if not isinstance(rows, list):
        return None
    open_: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        word, failing = _checks(r.get("statusCheckRollup"))
        open_.append({"number": int(r.get("number") or 0),
                      "title": str(r.get("title") or ""),
                      "branch": str(r.get("headRefName") or ""),
                      "draft": bool(r.get("isDraft")),
                      "checks": word, "failing": failing,
                      "at": _at(r.get("updatedAt"))})
    open_.sort(key=lambda p: -(p["at"] or 0))
    return {"at": now, "open": open_}


def pulls_of(paths: list[str], now: float | None = None,
             budget_s: float = _PULLS_BUDGET_S) -> dict[str, dict]:
    """The same for every repository a machine's products own, keyed by path.

    Keyed by path for the reason the git readings are: one product's answer is
    the union of its repositories, and the same checkout on two machines must
    not be read as two. Out of time is the same as not read yet — absent, and on
    the next poll.
    """
    now = now or time.time()
    out: dict[str, dict] = {}
    deadline = time.monotonic() + budget_s
    for path in dict.fromkeys(paths):
        hit = _pulls_cache.get(path)
        cold = hit is None or now - hit[0] >= _PULLS_TTL
        if cold and time.monotonic() >= deadline:
            info = hit[1] if hit else None
        else:
            info = read_pulls(path, now) if cold else hit[1]
            _pulls_cache[path] = (now, info)
        if info is not None:
            out[path] = info
    return out


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


#: Filing is: read the card, decide, run a subprocess, write the number back —
#: and the decision is a long way from the write. Two devices dragging one card
#: into In Progress at the same moment would otherwise start two workers on it,
#: and two worktrees on one card is worse than any duplicate row. One lock for
#: the whole daemon: a filing is a human drag and a tenth of a second of
#: subprocess, so there is nothing here worth making finer.
_filing = asyncio.Lock()


async def file_with_ustabasi(board: Board, card_id: str,
                             is_allowed: Callable[[str], bool] | None = None) -> dict:
    """Queue a card as a ticket and write the number it came back with.

    The write goes through that program's CLI rather than its database, for the
    same reason a note does: what "queue this" means — the row, the branch name,
    the lane, the priority — is its own sequence and copying it here would mean
    keeping two copies of it correct.

    `is_allowed` is the path fence, asked about the repository this is actually
    going to be run in — the card's, or the product's first. The handlers check
    a repository on the way in, and this checks it again on the way out: what
    goes through here starts an autonomous agent with a shell in that directory,
    and a path that reached the database by some route nobody has thought of yet
    must still not become a worktree.
    """
    async with _filing:
        card = board.get_card(card_id)
        if card is None:
            raise ValueError("no such card")
        # Re-read under the lock, not before it: the card may have been filed
        # by the drag this one was waiting behind.
        if card["ustabasi_id"]:
            return card
        project = board.get_project(card["project_id"])
        spec = ticket_spec(card, project or {})
        if is_allowed is not None and not is_allowed(spec["repo"]):
            raise ValueError("that folder is outside the allowed roots")
        ticket_id = await ustabasimod.add(spec)
        return board.attach_ustabasi(card_id, ticket_id)
