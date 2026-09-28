"""The ustabasi ticket queue, read-only, for the panel's terminal wall.

The queue is a separate program with its own SQLite database and its own CLI;
this daemon only looks at it. Two things are needed and no more: a snapshot of
what the workers are doing, and a way to answer a ticket that stopped to ask a
question. Everything else — starting work, cancelling it, editing a card —
stays where it belongs, on the other side of that CLI.

Two readings are not in that database. A ticket's project is the daemon's own
answer — the folder one level under an allowed root, as chat titles use — and
what a worker has committed so far is read from the worktree's git log, because
the queue does not record it and "where is it now" has no other answer.

The one write goes through the CLI rather than the database, because "answer a
blocked ticket" is not an INSERT: it appends the note, clears the escalation and
puts the ticket back in the queue, and that sequence is the other program's to
define. Copying it here would mean maintaining it twice.

Absent queue, absent CLI, locked database: all of those are an empty wall, not
an error. Most machines running this daemon have never heard of ustabasi.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Callable

# Both are overridable so a second install, or a test, can point elsewhere.
STATE_DIR = Path(os.environ.get("USTABASI_STATE_DIR") or (Path.home() / "projects" / ".ustabasi")).expanduser()
CLI = Path(os.environ.get("USTABASI_CLI") or (Path.home() / "projects" / "ustabasi" / "bin" / "ustabasi")).expanduser()

DB_PATH = STATE_DIR / "ustabasi.db"
HEARTBEAT = STATE_DIR / "supervisor.heartbeat"

# A note long enough to be a card rewrite is a new ticket, not a note.
MAX_NOTE = 2000

# How long a worktree's git reading is reused. The wall re-reads every few
# seconds and a worker commits every few minutes, so a fresh read per poll
# would be dozens of processes an hour for an answer that has not changed.
GIT_TTL = 20.0

# Long enough to say something, short enough to fit on a card next to it.
MAX_SUBJECT = 160

# The queue writes one of these when it hands a ticket to a worker, a check or
# a verifier: "worker round 2 pid 5880 model … account …". The round in there is
# how the wall knows when the current round began, which the tickets table does
# not record.
START_ROUND = re.compile(r"\bround (\d+)\b")

_git_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}


def available() -> bool:
    return DB_PATH.exists()


def _connect() -> sqlite3.Connection:
    # Read-only and short-lived: the supervisor writes to this file every few
    # minutes and must never wait on a panel that left a transaction open.
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=2.0)
    conn.row_factory = sqlite3.Row
    return conn


def _git(worktree: str | None, base: str | None) -> dict | None:
    """What the worker has actually committed on the branch, or None.

    None covers every way there is nothing to say — a ticket that never got a
    worktree, a worktree that has been removed, a branch with no commits on it
    yet — because a card with no commit line reads better than a card saying
    N/A. Merges are left out: a `main` merged into the branch is not a thing
    the worker did, and it makes a poor "last commit" line.
    """
    if not worktree:
        return None
    key = (worktree, base or "main")
    hit = _git_cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < GIT_TTL:
        return hit[1]

    out = None
    if Path(worktree).is_dir():
        try:
            proc = subprocess.run(
                ["git", "-C", worktree, "log", "--no-merges", "--format=%s",
                 f"{base or 'main'}..HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            if proc.returncode == 0:
                lines = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
                if lines:
                    out = {"commits": len(lines), "subject": lines[0][:MAX_SUBJECT]}
        except (OSError, subprocess.SubprocessError):
            out = None
    _git_cache[key] = (now, out)
    return out


def _project(repo: str, project_for: Callable[[str], str | None] | None) -> str | None:
    """The readable name of the project a ticket works on.

    Falls back to the folder name, which is what the path says when the policy
    has nothing to say about it — a repository outside the allowed roots, or a
    root itself.
    """
    name = project_for(repo) if (project_for and repo) else None
    return name or (Path(repo).name if repo else None)


def _round_start(starts: list[tuple[float, int]], round_no: int, started_at) -> float | None:
    """When the round the ticket is in began.

    A round can be started several times — a worker that hit a usage limit is
    picked up again by the next tick — so it is the *first* start of this round
    that answers "how long has this round been going", not the last one.
    """
    mine = [ts for ts, r in starts if r == round_no]
    if mine:
        return min(mine)
    return float(started_at) if started_at else None


def _col(row: sqlite3.Row, name: str):
    """A column this daemon would like but does not own the schema for."""
    try:
        return row[name]
    except IndexError:
        return None


def _json(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _ticket(row: sqlite3.Row, last_event: dict | None,
            starts: list[tuple[float, int]], project: str | None) -> dict:
    card = _json(row["card"], {})
    verdict = _json(row["verdict"], None)
    notes = _json(row["notes"], [])
    return {
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "stage": row["stage"],
        "round": row["round"],
        "repo": row["repo"],
        # The project this ticket is work on, which is not always the folder:
        # a ticket in babysee/app belongs to babysee. The wall groups by it.
        "project": project,
        "branch": row["branch"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "round_started_at": _round_start(starts, row["round"], row["started_at"]),
        "finished_at": row["finished_at"],
        "git": _git(_col(row, "worktree"), _col(row, "base_branch")),
        "goal": card.get("goal") or "",
        "done_criteria": card.get("done_criteria") or [],
        "escalation": row["escalation"] or "",
        "verdict": verdict,
        "notes": notes[-6:],
        "note_count": len(notes),
        "last_event": last_event,
    }


def snapshot(project_for: Callable[[str], str | None] | None = None) -> dict:
    """Everything the wall draws, in one read.

    `project_for` names the project a repository path belongs to — the daemon's
    own path policy answers that, and it is the same answer chat titles get, so
    a ticket and a chat about the same work are filed under the same name.
    """
    if not available():
        return {"available": False, "tickets": [], "queue": {}}
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM tickets ORDER BY id").fetchall()
        # One query for the whole wall rather than one per tile: the newest
        # event of every ticket, which is the line each tile shows.
        events = conn.execute(
            "SELECT e.ticket_id, e.ts, e.kind, e.msg FROM events e "
            "JOIN (SELECT ticket_id, MAX(id) AS id FROM events GROUP BY ticket_id) m "
            "ON e.id = m.id"
        ).fetchall()
        # And every hand-over, for the "how long has this round been going"
        # figure. There are a few dozen of these in total, ever.
        handovers = conn.execute(
            "SELECT ticket_id, ts, msg FROM events WHERE kind = 'start'"
        ).fetchall()
        meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta").fetchall()}
    last = {e["ticket_id"]: {"ts": e["ts"], "kind": e["kind"], "msg": e["msg"]} for e in events}
    starts: dict[int, list[tuple[float, int]]] = {}
    for h in handovers:
        m = START_ROUND.search(h["msg"] or "")
        if m:
            starts.setdefault(h["ticket_id"], []).append((h["ts"], int(m.group(1))))

    try:
        tick = HEARTBEAT.stat().st_mtime
    except OSError:
        tick = None

    paused = meta.get("paused_until")
    return {
        "available": True,
        "tickets": [
            _ticket(r, last.get(r["id"]), starts.get(r["id"], []),
                    _project(r["repo"], project_for))
            for r in rows
        ],
        "queue": {
            "last_tick": tick,
            "paused_until": float(paused) if paused else None,
        },
    }


async def note(ticket_id: int, text: str) -> dict:
    """Answer a ticket. The CLI owns what that means; we only report back."""
    text = (text or "").strip()
    if not text:
        raise ValueError("empty note")
    if len(text) > MAX_NOTE:
        raise ValueError("note too long")
    if not CLI.exists():
        raise ValueError("ustabasi is not installed on this machine")

    proc = await asyncio.create_subprocess_exec(
        str(CLI), "note", str(int(ticket_id)), text,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
    except asyncio.TimeoutError:
        proc.kill()
        raise ValueError("ustabasi did not answer")
    msg = (out or b"").decode(errors="replace").strip()
    if proc.returncode != 0:
        raise ValueError(msg or "ustabasi refused the note")
    return {"ok": True, "message": msg}
