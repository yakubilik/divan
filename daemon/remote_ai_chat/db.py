"""SQLite persistence: groups, chats, events (the timeline), plan limits, and
the handful of facts that have to outlive the process.

The Divan board — projects, branches, cards, the two faces — is in the same
file and on the same connection, but its tables, its reads and its writes are
`divan.py`'s. One process needs one writer, and a board is not a chat.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import divan as divanmod
from . import filing

SCHEMA = """
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, created_at REAL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  perm_mode TEXT NOT NULL,
  cwd TEXT NOT NULL,
  provider_session_id TEXT,
  account_id TEXT,
  status TEXT DEFAULT 'idle',
  last_preview TEXT DEFAULT '',
  max_turns INTEGER,
  max_budget_usd REAL,
  total_cost_usd REAL DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at REAL, updated_at REAL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_chat ON events(chat_id, seq);
CREATE TABLE IF NOT EXISTS limits (
  account_key TEXT NOT NULL,
  window TEXT NOT NULL,
  payload TEXT NOT NULL,
  at REAL NOT NULL,
  PRIMARY KEY (account_key, window)
);
-- Small, rare, and nothing to do with chats: when this daemon last started,
-- how many times it has, what the last update did. Each of them describes a
-- process that has already ended, so none of them can be kept in memory.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, at REAL NOT NULL
);
"""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._c = sqlite3.connect(str(path), check_same_thread=False)
        self._c.row_factory = sqlite3.Row
        self._c.execute("PRAGMA journal_mode=WAL")
        self._c.executescript(SCHEMA)
        self._migrate()
        divanmod.migrate(self._c)
        cols = {r["name"] for r in self._c.execute("PRAGMA table_info(chats)").fetchall()}
        if "session_ids" not in cols:
            self._c.execute("ALTER TABLE chats ADD COLUMN session_ids TEXT DEFAULT '{}'")
        # Nothing can be running right after start; clear stale states from a
        # crash/restart. Which chats they were is worth keeping for a moment —
        # they are the ones whose turn died mid-sentence.
        interrupted = [r["id"] for r in
                       self._c.execute("SELECT id FROM chats WHERE status!='idle'").fetchall()]
        self._c.execute("UPDATE chats SET status='idle' WHERE status!='idle'")
        self._c.commit()
        self._lock = threading.Lock()
        # The board, on this connection and behind this lock. Built here rather
        # than by the server so that anything holding a DB — a test, a script —
        # has the board too, and so that there is only ever one of it.
        self.divan = divanmod.Board(self._c, self._lock)
        self._file_unfiled()
        self._expire_orphan_approvals()
        # What the last process was doing when it stopped, and whether this one
        # can carry on with it. Decided here, before anything else runs: the
        # answer needs the attempt count on disk, and writing that down before
        # the turn starts again is what stops a turn that kills the daemon from
        # being retried for ever.
        self.to_resume = self._plan_resumes(interrupted)

    # A turn is picked up again once. Twice would let a turn that stops the
    # daemon stop it on every start, and a crash loop is worse than a question
    # left unanswered.
    RESUME_TRIES = 1

    def _plan_resumes(self, chat_ids: list[str]) -> list[dict]:
        """For each chat whose turn died with the last process: carry on, or say so.

        `text.delta` is not durable and the answer is only written down as
        `message.assistant` once it is whole, so an interrupted turn shows up in
        the timeline as a question with silence after it. But the question is on
        disk, and the provider session it was asked in can be resumed — so the
        work can simply start again, and nobody has to be told to send anything
        twice. Only a chat this process will not pick up gets the note, and this
        is the only place it can be written: the process that would have
        reported it is the one that ended.
        """
        tries = self.meta_get("resume_tries", {}) or {}
        plans, spent = [], dict(tries)
        for cid in chat_ids:
            msgs = self._unanswered_messages(cid)
            if not msgs:
                # Nothing on disk to run again — a turn the model opened by
                # itself, or a chat whose question is already answered.
                self.close_interrupted_turn(cid)
                continue
            seq = msgs[-1]["seq"]
            prev = tries.get(cid) or {}
            n = int(prev.get("tries", 0)) if prev.get("seq") == seq else 0
            if n >= self.RESUME_TRIES:
                self.close_interrupted_turn(cid, again=True)
                continue
            spent[cid] = {"seq": seq, "tries": n + 1}
            plans.append({"chat_id": cid,
                          "messages": [(m["text"], m["attachments"]) for m in msgs]})
        if spent != tries:
            self.meta_set("resume_tries", spent)
        return plans

    def _unanswered_messages(self, chat_id: str) -> list[dict]:
        """The user's messages since the last turn that ended, oldest first.

        More than one when messages were queued behind the turn in flight: each
        was written down as it arrived, while the queue holding them was only
        memory. The order is the order they were asked in.
        """
        rows = self._c.execute(
            "SELECT seq, type, payload FROM events WHERE chat_id=? ORDER BY seq DESC LIMIT 400",
            (chat_id,)).fetchall()
        out: list[dict] = []
        for r in rows:
            if r["type"] in ("turn.done", "turn.error"):
                break
            if r["type"] != "message.user":
                continue
            try:
                p = json.loads(r["payload"])
            except Exception:
                continue
            if not (p.get("text") or "").strip():
                continue
            out.append({"seq": r["seq"], "text": p["text"],
                        "attachments": p.get("attachments") or []})
        out.reverse()
        return out

    def close_interrupted_turn(self, chat_id: str, again: bool = False) -> None:
        """Say in the timeline that a turn ended with the process running it."""
        self.append_event(chat_id, "turn.error", {
            "message": ("The daemon stopped again while this turn was being picked up, "
                        "so it was left alone. Send again to retry."
                        if again else
                        "The daemon stopped while this turn was running, "
                        "so it never finished. Send again to pick it up."),
            "code": "daemon_stopped",
        })

    def _expire_orphan_approvals(self) -> None:
        """Approval requests whose waiting coroutine died with the old process can never
        be answered; mark them expired so the phone stops showing Allow/Deny."""
        rows = self._c.execute(
            "SELECT chat_id, payload FROM events WHERE type='approval.request' ORDER BY seq").fetchall()
        resolved = {json.loads(r["payload"]).get("request_id") for r in self._c.execute(
            "SELECT payload FROM events WHERE type='approval.resolved'").fetchall()}
        for r in rows:
            rid = json.loads(r["payload"]).get("request_id")
            if rid and rid not in resolved:
                self.append_event(r["chat_id"], "approval.resolved", {"request_id": rid, "decision": "expired"})

    def _migrate(self) -> None:
        """Additive column migrations for databases created by older versions."""
        have = {r[1] for r in self._c.execute("PRAGMA table_info(chats)")}
        for col, decl in (("account_id", "TEXT"), ("agent_id", "TEXT"),
                          ("pool_pinned", "INTEGER DEFAULT 0"), ("project_id", "TEXT"),
                          ("project_set", "INTEGER DEFAULT 0"), ("owner", "TEXT"),
                          # who the title is by ('user' once a person renamed it) and how
                          # many messages had been sent when it was last looked at (`naming`)
                          ("title_by", "TEXT"), ("named_at", "INTEGER DEFAULT 0"),
                          # what the chat is working on, in a line, and what has
                          # been done in it, a line each (`recap`)
                          ("task", "TEXT"), ("done", "TEXT")):
            if col not in have:
                self._c.execute(f"ALTER TABLE chats ADD COLUMN {col} {decl}")
        self._c.commit()

    # ── groups ─────────────────────────────────────────────────────────────
    def list_groups(self) -> list[dict]:
        rows = self._c.execute("SELECT * FROM groups ORDER BY sort, created_at").fetchall()
        return [dict(r) for r in rows]

    def create_group(self, name: str) -> dict:
        if any(g["name"].strip().lower() == name.strip().lower() for g in self.list_groups()):
            raise ValueError("a group with that name already exists")
        g = {"id": new_id(), "name": name, "sort": 0, "created_at": time.time()}
        with self._lock:
            self._c.execute("INSERT INTO groups VALUES (:id,:name,:sort,:created_at)", g)
            self._c.commit()
        return g

    def rename_group(self, gid: str, name: str) -> None:
        with self._lock:
            self._c.execute("UPDATE groups SET name=? WHERE id=?", (name, gid))
            self._c.commit()

    def delete_group(self, gid: str) -> None:
        with self._lock:
            self._c.execute("UPDATE chats SET group_id=NULL WHERE group_id=?", (gid,))
            self._c.execute("DELETE FROM groups WHERE id=?", (gid,))
            self._c.commit()

    # ── chats ──────────────────────────────────────────────────────────────
    # A chat carries the product it is filed under by id, and is handed out
    # with that product's name beside it: the name is what a list draws, and a
    # product renamed on the board is renamed in every list without a write.
    _CHATS = ("SELECT chats.*, projects.name AS project FROM chats "
              "LEFT JOIN projects ON projects.id = chats.project_id")

    def list_chats(self, include_archived: bool = False) -> list[dict]:
        q = self._CHATS + ("" if include_archived else " WHERE chats.archived=0")
        q += " ORDER BY chats.pinned DESC, chats.updated_at DESC"
        return [dict(r) for r in self._c.execute(q).fetchall()]

    def get_chat(self, cid: str) -> dict | None:
        r = self._c.execute(self._CHATS + " WHERE chats.id=?", (cid,)).fetchone()
        return dict(r) if r else None

    def file_chat(self, cid: str) -> None:
        """Put a chat under the product it is work on (`filing`).

        Written without touching `updated_at`: that is when the chat last
        moved, lists sort and age by it, and being looked at is not moving.
        `''` is "looked, and nothing claims it", which is not the same as
        never having been looked at.

        A chat is filed once: a product it already has is never taken away
        by later work, and one a person put it under (`project_set`, Unfiled
        included) is never the computer's to change.
        """
        chat = self._c.execute("SELECT cwd, project_id, project_set FROM chats WHERE id=?",
                               (cid,)).fetchone()
        if not chat or chat["project_id"] or chat["project_set"]:
            return
        repos = [(r["path"], r["project_id"])
                 for r in self._c.execute("SELECT project_id, path FROM project_repos")]
        inputs = (r["payload"] for r in self._c.execute(
            "SELECT payload FROM events WHERE chat_id=? AND type='tool.use' "
            "ORDER BY seq DESC LIMIT ?", (cid, filing.WINDOW)))
        pid = filing.pick(inputs, chat["cwd"], filing.matcher(repos))
        with self._lock:
            self._c.execute("UPDATE chats SET project_id=? WHERE id=? AND project_set=0",
                            (pid, cid))
            self._c.commit()

    def set_project(self, cid: str, pid: str | None) -> dict | None:
        """A person files the chat under `pid` (None/'' = Unfiled), for good."""
        pid = pid or ""
        if pid and not self._c.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
            raise ValueError("no such project")
        with self._lock:
            self._c.execute("UPDATE chats SET project_id=?, project_set=1, updated_at=? WHERE id=?",
                            (pid, time.time(), cid))
            self._c.commit()
        return self.get_chat(cid)

    def _file_unfiled(self) -> None:
        """File every chat nobody has looked at yet: the ones from before chats
        were filed at all. Once each, at start."""
        for r in self._c.execute("SELECT id FROM chats WHERE project_id IS NULL").fetchall():
            self.file_chat(r["id"])

    def create_chat(self, **kw: Any) -> dict:
        now = time.time()
        chat = {
            "id": new_id(), "group_id": None, "title": "New chat",
            "provider": "claude", "model": "fable", "effort": "high",
            "perm_mode": "ask", "cwd": "", "provider_session_id": None, "account_id": None,
            "agent_id": None, "pool_pinned": 0, "project_set": 0, "owner": None,
            "status": "idle", "last_preview": "", "max_turns": None,
            "max_budget_usd": None, "total_cost_usd": 0.0, "pinned": 0,
            "archived": 0, "created_at": now, "updated_at": now, "session_ids": "{}",
        }
        chat.update({k: v for k, v in kw.items() if k in chat})
        cols = ",".join(chat.keys())
        vals = ",".join(":" + k for k in chat.keys())
        with self._lock:
            self._c.execute(f"INSERT INTO chats ({cols}) VALUES ({vals})", chat)
            self._c.commit()
        # It has run nothing yet, so it is filed by the folder it was opened in.
        self.file_chat(chat["id"])
        return {**chat, **(self.get_chat(chat["id"]) or {})}

    def update_chat(self, cid: str, **fields: Any) -> dict | None:
        allowed = {"group_id", "title", "provider", "model", "effort", "perm_mode", "cwd",
                   "provider_session_id", "status", "last_preview", "max_turns",
                   "max_budget_usd", "total_cost_usd", "pinned", "archived", "session_ids",
                   "account_id", "agent_id", "pool_pinned", "owner", "title_by", "named_at"}
        fields = {k: v for k, v in fields.items() if k in allowed}
        if not fields:
            return self.get_chat(cid)
        fields["updated_at"] = time.time()
        sets = ",".join(f"{k}=:{k}" for k in fields)
        fields["id"] = cid
        with self._lock:
            self._c.execute(f"UPDATE chats SET {sets} WHERE id=:id", fields)
            self._c.commit()
        return self.get_chat(cid)

    def recap_chat(self, cid: str, task: str, done: list[str]) -> dict | None:
        """Write down what a chat is for and what came of it (`recap`).

        Without touching `updated_at`, for the reason `file_chat` gives: being
        summed up is not moving.
        """
        with self._lock:
            self._c.execute("UPDATE chats SET task=?, done=? WHERE id=?",
                            (task, "\n".join(done), cid))
            self._c.commit()
        return self.get_chat(cid)

    def touch_chat(self, cid: str, preview: str | None = None) -> None:
        if preview is not None:
            self.update_chat(cid, last_preview=preview[:200])
        else:
            self.update_chat(cid, status=self.get_chat(cid)["status"])

    def delete_chat(self, cid: str) -> None:
        with self._lock:
            self._c.execute("DELETE FROM events WHERE chat_id=?", (cid,))
            self._c.execute("DELETE FROM chats WHERE id=?", (cid,))
            self._c.commit()

    # ── events ─────────────────────────────────────────────────────────────
    def append_event(self, chat_id: str, type_: str, payload: dict) -> dict:
        ts = time.time()
        with self._lock:
            cur = self._c.execute(
                "INSERT INTO events (chat_id,type,payload,ts) VALUES (?,?,?,?)",
                (chat_id, type_, json.dumps(payload, ensure_ascii=False), ts),
            )
            self._c.commit()
            seq = cur.lastrowid
        return {"seq": seq, "chat_id": chat_id, "event": type_, "data": payload, "ts": ts}

    def events(self, chat_id: str, since_seq: int = 0, limit: int = 500) -> list[dict]:
        rows = self._c.execute(
            "SELECT * FROM events WHERE chat_id=? AND seq>? ORDER BY seq LIMIT ?",
            (chat_id, since_seq, limit),
        ).fetchall()
        return [self._event_row(r) for r in rows]

    def recent_events(self, chat_id: str, limit: int = 500) -> list[dict]:
        """The last `limit` events of a chat, oldest first.

        `events()` walks forward from a sequence number, which is what a client
        catching up after a reconnect wants. A client opening a chat for the
        first time wants the opposite end: a chat with three thousand events
        answered from the front is answered with its first afternoon, and every
        word said since is missing until the client asks two thousand five
        hundred more times.
        """
        rows = self._c.execute(
            "SELECT * FROM (SELECT * FROM events WHERE chat_id=? ORDER BY seq DESC LIMIT ?)"
            " ORDER BY seq",
            (chat_id, limit),
        ).fetchall()
        return [self._event_row(r) for r in rows]

    def count_events(self, chat_id: str, since_seq: int = 0) -> int:
        row = self._c.execute(
            "SELECT COUNT(*) AS n FROM events WHERE chat_id=? AND seq>?",
            (chat_id, since_seq),
        ).fetchone()
        return int(row["n"]) if row else 0

    @staticmethod
    def _event_row(r) -> dict:
        return {"seq": r["seq"], "chat_id": r["chat_id"], "event": r["type"],
                "data": json.loads(r["payload"]), "ts": r["ts"]}

    def tail_events(self, chat_id: str, types: tuple[str, ...], limit: int = 12) -> list[dict]:
        """The newest events of a few kinds, newest first.

        `events()` walks a chat forward from a sequence number, which is what a
        phone rebuilding a timeline wants. Answering "what is it doing right
        now" wants the opposite: the last handful, and only the kinds that say
        anything about the current state.
        """
        if not types:
            return []
        holes = ",".join("?" * len(types))
        rows = self._c.execute(
            f"SELECT * FROM events WHERE chat_id=? AND type IN ({holes}) "
            "ORDER BY seq DESC LIMIT ?",
            (chat_id, *types, limit),
        ).fetchall()
        return [{"seq": r["seq"], "chat_id": r["chat_id"], "event": r["type"],
                 "data": json.loads(r["payload"]), "ts": r["ts"]} for r in rows]

    def spoken(self, chat_id: str) -> list[dict]:
        """What was said in a chat, by either side, oldest first: no tool
        calls, no deltas. What `naming` reads."""
        rows = self._c.execute(
            "SELECT * FROM events WHERE chat_id=? AND type IN ('message.user','message.assistant') "
            "ORDER BY seq", (chat_id,)).fetchall()
        return [self._event_row(r) for r in rows]

    def last_seq(self, chat_id: str) -> int:
        r = self._c.execute("SELECT MAX(seq) FROM events WHERE chat_id=?", (chat_id,)).fetchone()
        return int(r[0] or 0)

    # ── plan limits ────────────────────────────────────────────────────────
    # The tool reports what is left of the plan only while a turn is running.
    # Keeping the last word on disk is what lets the ring show a number right
    # after a restart, instead of going blank until someone sends a message.

    def save_limits(self, account_key: str, windows: list[dict], at: float,
                    complete: bool = False) -> None:
        """Write down what the tool just said about one account's plan.

        `complete` is the difference between adding to a picture and replacing
        it. A complete report is every window the plan has right now, so one
        that is missing from it has gone — an account whose overage allowance
        was spent stops being told about that window at all, and upserting
        forever left it pinned at the last number anybody saw. Forty hours
        later the phone was still drawing a full ring from it.
        """
        names = [str(w.get("window")) for w in windows]
        with self._lock:
            if complete and names:
                q = ",".join("?" * len(names))
                self._c.execute(
                    f"DELETE FROM limits WHERE account_key=? AND window NOT IN ({q})",
                    (account_key, *names))
            self._c.executemany(
                "INSERT INTO limits (account_key, window, payload, at) VALUES (?,?,?,?) "
                "ON CONFLICT(account_key, window) DO UPDATE SET payload=excluded.payload, at=excluded.at",
                [(account_key, n, json.dumps(w), at) for n, w in zip(names, windows)],
            )
            self._c.commit()

    # ── meta ───────────────────────────────────────────────────────────────
    # JSON in, JSON out, so a caller can store a record rather than a string
    # and a reader never has to know which of the two a key holds.

    def meta_get(self, key: str, default: Any = None) -> Any:
        r = self._c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        if r is None:
            return default
        try:
            return json.loads(r["value"])
        except Exception:
            return default

    def meta_set(self, key: str, value: Any) -> None:
        with self._lock:
            self._c.execute(
                "INSERT INTO meta (key, value, at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at",
                (key, json.dumps(value), time.time()),
            )
            self._c.commit()

    def load_limits(self) -> dict[str, dict[str, dict]]:
        """Every window still on record, exactly as it was left.

        Nothing is judged stale here on purpose. It is tempting: all the
        windows of one report share an instant, so a row lagging the newest one
        looks abandoned. But a report that carried only the headline window
        leaves its siblings behind legitimately, and there is no way to tell
        the two apart from the timestamps alone — which is the whole reason
        `save_limits` is told `complete` instead of working it out. A window
        dies where that is known, and a complete report arrives on the first
        turn of any chat, so a row that should go does not last long.
        """
        out: dict[str, dict[str, dict]] = {}
        for r in self._c.execute("SELECT * FROM limits").fetchall():
            try:
                d = json.loads(r["payload"])
            except Exception:
                continue
            d["at"] = r["at"]
            out.setdefault(r["account_key"], {})[r["window"]] = d
        return out
