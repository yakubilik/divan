"""The ustabasi ticket queue, read-only, for the panel's terminal wall.

The queue is a separate program with its own SQLite database and its own CLI;
this daemon only looks at it. Two things are needed and no more: a snapshot of
what the workers are doing, and a way to answer a ticket that stopped to ask a
question. Everything else — starting work, cancelling it, editing a card —
stays where it belongs, on the other side of that CLI.

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
import sqlite3
from pathlib import Path

# Both are overridable so a second install, or a test, can point elsewhere.
STATE_DIR = Path(os.environ.get("USTABASI_STATE_DIR") or (Path.home() / "projects" / ".ustabasi")).expanduser()
CLI = Path(os.environ.get("USTABASI_CLI") or (Path.home() / "projects" / "ustabasi" / "bin" / "ustabasi")).expanduser()

DB_PATH = STATE_DIR / "ustabasi.db"
HEARTBEAT = STATE_DIR / "supervisor.heartbeat"

# A note long enough to be a card rewrite is a new ticket, not a note.
MAX_NOTE = 2000


def available() -> bool:
    return DB_PATH.exists()


def _connect() -> sqlite3.Connection:
    # Read-only and short-lived: the supervisor writes to this file every few
    # minutes and must never wait on a panel that left a transaction open.
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=2.0)
    conn.row_factory = sqlite3.Row
    return conn


def _json(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _ticket(row: sqlite3.Row, last_event: dict | None) -> dict:
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
        "branch": row["branch"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "goal": card.get("goal") or "",
        "done_criteria": card.get("done_criteria") or [],
        "escalation": row["escalation"] or "",
        "verdict": verdict,
        "notes": notes[-6:],
        "note_count": len(notes),
        "last_event": last_event,
    }


def snapshot() -> dict:
    """Everything the wall draws, in one read."""
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
        meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta").fetchall()}
    last = {e["ticket_id"]: {"ts": e["ts"], "kind": e["kind"], "msg": e["msg"]} for e in events}

    try:
        tick = HEARTBEAT.stat().st_mtime
    except OSError:
        tick = None

    paused = meta.get("paused_until")
    return {
        "available": True,
        "tickets": [_ticket(r, last.get(r["id"])) for r in rows],
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
