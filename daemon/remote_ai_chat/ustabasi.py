"""The ustabasi ticket queue: read for the wall, written to only through its CLI.

The queue is a separate program with its own SQLite database and its own CLI;
this daemon only looks at it. Three things are needed and no more: a snapshot of
what the workers are doing, a way to answer a ticket that stopped to ask a
question, and — since the Divan board became the thing work is arranged on — a
way to file a new ticket when a card is dragged into In Progress. Everything
else — cancelling work, editing a card, re-running it — stays where it belongs,
on the other side of that CLI.

Two readings are not in that database. A ticket's project is the daemon's own
answer — the folder one level under an allowed root, as chat titles use — and
what a worker has committed so far is read from the worktree's git log, because
the queue does not record it and "where is it now" has no other answer.

Both writes go through the CLI rather than the database, because neither is an
INSERT: answering a blocked ticket appends the note, clears the escalation and
puts the ticket back in the queue, and filing one picks a slug, a branch name, a
worker model and a place in the queue. Those sequences are the other program's
to define, and copying them here would mean maintaining them twice.

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

    Round one began when the ticket did, and that is the only round `started_at`
    answers for. A later round with no hand-over of its own has not begun: the
    verifier sent it back and it is waiting for a free slot. Answering that with
    `started_at` would put hours on a round that has not started — which is the
    exact misreading this figure exists to stop — so it goes unanswered instead.
    """
    mine = [ts for ts, r in starts if r == round_no]
    if mine:
        return min(mine)
    return float(started_at) if started_at and round_no <= 1 else None


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
            starts: list[tuple[float, int]], project: str | None,
            steps: list[dict], git: bool = True) -> dict:
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
        # One `git log` per worktree, and that is a subprocess: twenty-five
        # tickets is seconds, not milliseconds. Whoever is only reading statuses
        # asks for it to be left out (see `snapshot`).
        "git": _git(_col(row, "worktree"), _col(row, "base_branch")) if git else None,
        "goal": card.get("goal") or "",
        "done_criteria": card.get("done_criteria") or [],
        # The command that proves it. Read all along and drawn nowhere until
        # the panel could rewrite a card: an editor that cannot see this field
        # is an editor that clears it.
        "verify_cmd": card.get("verify_cmd") or "",
        "escalation": row["escalation"] or "",
        "verdict": verdict,
        "notes": notes[-6:],
        "note_count": len(notes),
        "last_event": last_event,
        # Which steps the ticket has been through and which one it is on, read
        # out of the events. Nothing else answers "what is it doing now" —
        # `stage` and `round` say where it is, not how it got there.
        "steps": steps,
    }


def snapshot(project_for: Callable[[str], str | None] | None = None,
             git: bool = True) -> dict:
    """Everything the wall draws, in one read.

    `project_for` names the project a repository path belongs to — the daemon's
    own path policy answers that, and it is the same answer chat titles get, so
    a ticket and a chat about the same work are filed under the same name.

    `git=False` leaves out what has landed on each branch, which is the only
    part of this that is not a database read: a `git log` per worktree, one
    subprocess each, and twenty-five tickets took three and a half seconds of a
    poll's four. The board's mirror does not draw commits — it reads statuses —
    so the request behind a dashboard asks without it and comes back in
    milliseconds. The wall itself still asks for everything.
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
        # And the stage history: every event that opens or closes a step, for
        # the round figure and for the checklist an opened ticket draws. There
        # are a few dozen of these per ticket in total, ever, and they are read
        # in one query for the whole wall rather than one per ticket.
        history = conn.execute(
            "SELECT ticket_id, ts, kind, msg FROM events "
            "WHERE kind IN ('start', 'check', 'report', 'done', 'failed', 'blocked',"
            " 'cancelled', 'requeue', 'stuck', 'crash', 'limit') ORDER BY id"
        ).fetchall()
        meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta").fetchall()}
    last = {e["ticket_id"]: {"ts": e["ts"], "kind": e["kind"], "msg": e["msg"]} for e in events}
    starts: dict[int, list[tuple[float, int]]] = {}
    by_ticket: dict[int, list[sqlite3.Row]] = {}
    for h in history:
        by_ticket.setdefault(h["ticket_id"], []).append(h)
        if h["kind"] != "start":
            continue
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
                    _project(r["repo"], project_for),
                    _steps(by_ticket.get(r["id"], []), r["status"]), git)
            for r in rows
        ],
        "queue": {
            "last_tick": tick,
            "paused_until": float(paused) if paused else None,
        },
    }


#: How long the CLI is given to answer. `add` writes one row and prints a line;
#: anything slower than this is a database somebody else is holding open.
CLI_TIMEOUT = 20


async def _cli(*args: str, stdin: str | None = None) -> str:
    """Run the queue's CLI and hand back what it said, or raise what it said."""
    if not CLI.exists():
        raise ValueError("ustabasi is not installed on this machine")
    proc = await asyncio.create_subprocess_exec(
        str(CLI), *args,
        stdin=asyncio.subprocess.PIPE if stdin is not None else None,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(
            proc.communicate((stdin or "").encode() if stdin is not None else None),
            timeout=CLI_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise ValueError("ustabasi did not answer")
    msg = (out or b"").decode(errors="replace").strip()
    if proc.returncode != 0:
        raise ValueError(msg or "ustabasi refused")
    return msg


# What `add` prints when it has queued something: `#41 queued: the title …`.
QUEUED = re.compile(r"#(\d+)\s+queued\b")


async def add(spec: dict) -> int:
    """File a ticket and hand back the number the queue gave it.

    The spec goes in on stdin as JSON — the CLI's own `--json -` — rather than
    as a dozen flags, because a card's constraints and paths are lists and a
    goal is a paragraph. The number comes back out of the line it prints, which
    is the only thing it says: there is no `--porcelain`, and inventing one on
    the other side of a program this daemon does not own would be a change to
    that program for the convenience of this one.
    """
    out = await _cli("add", "--json", "-", stdin=json.dumps(spec, ensure_ascii=False))
    m = QUEUED.search(out)
    if not m:
        raise ValueError(out or "ustabasi queued nothing")
    return int(m.group(1))


async def note(ticket_id: int, text: str) -> dict:
    """Answer a ticket. The CLI owns what that means; we only report back."""
    text = (text or "").strip()
    if not text:
        raise ValueError("empty note")
    if len(text) > MAX_NOTE:
        raise ValueError("note too long")
    return {"ok": True, "message": await _cli("note", str(int(ticket_id)), text)}


async def cancel(ticket_id: int) -> dict:
    """Stop a ticket. A running one is killed with its process group."""
    return {"ok": True, "message": await _cli("cancel", str(int(ticket_id)))}


async def restart(ticket_id: int) -> dict:
    """Put a stopped or finished ticket back in the queue."""
    return {"ok": True, "message": await _cli("restart", str(int(ticket_id)))}


async def delete(ticket_id: int, force: bool = False) -> dict:
    """Take a ticket off the queue for good.

    The queue keeps a branch that has work nobody merged unless `force` says
    otherwise — commits are the one thing here that cannot be written again.
    """
    args = ["delete", str(int(ticket_id))] + (["--force"] if force else [])
    return {"ok": True, "message": await _cli(*args)}


async def edit(ticket_id: int, *, title: str | None = None, goal: str | None = None,
               done_criteria: list[str] | None = None,
               verify_cmd: str | None = None) -> dict:
    """Rewrite what a ticket asks for. Refused while somebody is working on it."""
    args = ["edit", str(int(ticket_id))]
    if title is not None:
        args += ["--title", title]
    if goal is not None:
        args += ["--goal", goal]
    if verify_cmd is not None:
        args += ["--verify", verify_cmd]
    if done_criteria is not None:
        args += ["--criteria", *done_criteria]
    return {"ok": True, "message": await _cli(*args)}


async def prioritise(ticket_id: int, priority: int = 1) -> dict:
    """Put this ticket in front of the others that are waiting.

    What a drag into In Progress means for a card the queue already holds. The
    queue decides when a ticket actually starts — there are only so many slots
    — so the honest thing a finger can do is say which one is next, and this is
    the queue's own word for that (`priority`, picked `ORDER BY priority, id`).

    A ticket that is running, finished or cancelled is refused by the CLI, and
    the refusal comes back as the sentence it printed.
    """
    return {"ok": True,
            "message": await _cli("priority", str(int(ticket_id)), str(int(priority)))}


# ── the stage and round history a ticket has been through ────────────────────
#
# The tickets table holds the round the ticket is in *now* and nothing about how
# it got there. The events table holds the rest: every hand-over to a worker, a
# check or a verifier, and everything that ended one. Read in time order those
# events are a checklist — which steps are behind it, which one it is on, and
# which of the ones behind it were turned down.

# `worker round 1 pid 26328 model claude-opus-5 account yakup`, which is the
# queue writing to its own log. Every field after the round is optional: an
# older queue wrote fewer of them, and a step with no pid is still a step.
START_LINE = re.compile(
    r"^\s*(\w+)\s+round\s+(\d+)"
    r"(?:.*?\bpid\s+(\d+))?"
    r"(?:.*?\bmodel\s+(\S+))?"
    r"(?:.*?\baccount\s+(\S+))?"
)

# What ended the step that was running, in the word the checklist marks it with.
# `ok` is a step that did what it was for; `rejected` is a verifier sending the
# work back; `stopped` is a step that did not get to finish — killed for being
# silent, out of usage, crashed.
ENDED_BY = {
    "report": "ok", "done": "ok", "check": "ok",
    "requeue": "rejected",
    "blocked": "blocked", "failed": "failed", "cancelled": "cancelled",
    "stuck": "stopped", "crash": "stopped", "limit": "stopped",
}

# One line of why a step ended, next to the mark. A report is thousands of
# characters and this is a line on a checklist.
MAX_STEP_NOTE = 120


def _steps(events: list[sqlite3.Row], status: str) -> list[dict]:
    """The ticket's steps, oldest first, each with how it ended.

    A step is opened by the hand-over that started it and closed by whatever
    came next — its own report, the verifier's verdict, a usage limit, or simply
    the next hand-over. The one left open at the end is the one running now, and
    only if the ticket says it is running: a ticket that stopped between two
    events is not still working, it is stopped.
    """
    out: list[dict] = []

    def step(**kw) -> dict:
        # Nothing but what there is to say. A step is a handful of fields and a
        # wall of twenty tickets has a hundred of them, so the halves that are
        # always null — the pid of a check, the outcome of the one still
        # running — are left out rather than sent as null a hundred times.
        return {k: v for k, v in kw.items() if v not in (None, "")}

    def close(ts: float, outcome: str, note: str = "") -> None:
        if out and "ended_at" not in out[-1]:
            out[-1]["ended_at"] = ts
            out[-1]["outcome"] = outcome
            # Only where it did not simply finish. A step that did what it was
            # for needs no line explaining itself, and the line there would be
            # is the opening of a report the ticket already carries.
            if note and outcome != "ok":
                out[-1]["note"] = note

    for ev in events:
        kind = ev["kind"]
        msg = ev["msg"] or ""
        line = msg.split("\n", 1)[0].strip()[:MAX_STEP_NOTE]
        if kind == "start":
            m = START_LINE.match(msg)
            if not m:
                continue
            close(ev["ts"], "stopped")
            out.append(step(
                stage=m.group(1), round=int(m.group(2)), at=ev["ts"],
                pid=int(m.group(3)) if m.group(3) else None,
                # The queue writes a dash for the two a check has none of.
                model=None if m.group(4) == "-" else m.group(4),
                account=None if m.group(5) == "-" else m.group(5),
            ))
        elif kind == "check":
            # The check's own words on how it went. It is usually a step that
            # was handed out like any other and is already open, in which case
            # this closes it; where there is no verify_cmd the queue writes
            # only this one event, and then it is the whole step.
            outcome = "failed" if re.search(r"\bfail|\berror", msg, re.I) else "ok"
            if out and "ended_at" not in out[-1] and out[-1]["stage"] == "check":
                close(ev["ts"], outcome, line)
                continue
            close(ev["ts"], "ok")
            out.append(step(
                stage="check", round=out[-1]["round"] if out else 1,
                at=ev["ts"], ended_at=ev["ts"], outcome=outcome, note=line,
            ))
        elif kind in ENDED_BY:
            close(ev["ts"], ENDED_BY[kind], line)

    # The step left open is the one running now — but only on a ticket that
    # says it is running. One left open on a ticket that is not is a step that
    # stopped without the queue getting to write down why.
    if out and "ended_at" not in out[-1] and status != "running":
        out[-1]["outcome"] = "stopped"
    return out


# ── a run's own log, read a page at a time ───────────────────────────────────
#
# Every run writes the model's stream-json to `<run_dir>/stdout.log`: one JSON
# object a line, append-only, and hundreds of kilobytes by the time a worker is
# finished. What a reader wants is a chat — what the agent said, what it is
# doing right now — and what a phone can be sent is a few tens of kilobytes at a
# time, so this hands out pages of it and remembers the place with a cursor.
#
# The cursor is `<run>:<byte offset>`: the run directory's own name, so that a
# cursor from the previous round cannot be read as an offset into this one, and
# an offset, because the file only ever grows. No path in it — the run directory
# is under this machine's home and that is nobody's business on a phone.

#: How many records one answer carries, and how many bytes of them.
MAX_RUN_EVENTS = 80
MAX_RUN_BYTES = 48_000

#: How far back a first open looks, and how far behind a reader is allowed to
#: fall before being moved up to the end rather than reading its way there.
RUN_TAIL_BYTES = 256_000

#: What one record is allowed to carry of a block that has no size limit of its
#: own. A tool result is a whole file; a thought is a paragraph nobody asked
#: for; and either of them whole would be the page budget on its own.
MAX_RUN_TEXT = 6000
MAX_RUN_THINKING = 2000
MAX_RUN_RESULT = 2000
MAX_RUN_INPUT_VALUE = 400
MAX_RUN_INPUT = 1400


def _cut(text, n: int) -> tuple[str, bool]:
    s = text if isinstance(text, str) else ("" if text is None else str(text))
    return (s[:n], True) if len(s) > n else (s, False)


def _tool_input(raw) -> tuple[dict, bool]:
    """A tool's arguments, small enough to be a line on a screen.

    The reader needs the name of the thing it was called on — a path, a command,
    a pattern — and never the 300 lines of a file being written. So every string
    is cut to a line's worth and the whole is cut again, because a call can have
    a dozen of them.
    """
    if not isinstance(raw, dict):
        return {}, False
    out: dict = {}
    clipped = False
    total = 0
    for key, val in raw.items():
        if isinstance(val, str):
            val, cut = _cut(val, MAX_RUN_INPUT_VALUE)
            clipped = clipped or cut
        elif not isinstance(val, (int, float, bool, type(None))):
            val, cut = _cut(json.dumps(val, default=str), MAX_RUN_INPUT_VALUE)
            clipped = clipped or cut
        size = len(str(val)) + len(key) + 4
        if total + size > MAX_RUN_INPUT:
            clipped = True
            continue
        total += size
        out[key] = val
    return out, clipped


def _result_text(content) -> tuple[str, bool]:
    """What a tool answered, as text. The CLI writes a string for most tools and
    a list of blocks for the ones that can answer with an image."""
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content
                 if isinstance(b, dict) and b.get("type") == "text"]
        content = "\n".join(p for p in parts if p)
    return _cut(content, MAX_RUN_RESULT)


def _records(line: str) -> list[dict]:
    """One line of the log, as the records a reader is built out of.

    Everything keeps its own kind, including the kinds nobody wants to read: a
    hook firing and a rate-limit warning are two bytes each here and are dropped
    by the client, which is where "what is worth showing" is decided. A line
    that is not JSON at all is a record too — the CLI writes the odd warning to
    the same stream and swallowing it would make a gap nobody could explain.
    """
    try:
        d = json.loads(line)
    except (ValueError, TypeError):
        return [{"k": "other", "type": "unparsable"}]
    if not isinstance(d, dict):
        return [{"k": "other", "type": "unparsable"}]

    kind = d.get("type")
    if kind in ("assistant", "user"):
        blocks = (d.get("message") or {}).get("content")
        if isinstance(blocks, str):
            blocks = [{"type": "text", "text": blocks}]
        out: list[dict] = []
        for b in blocks or []:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                text, cut = _cut(b.get("text"), MAX_RUN_TEXT)
                out.append({"k": "text", "text": text, **({"clipped": True} if cut else {})})
            elif bt == "thinking":
                text, cut = _cut(b.get("thinking"), MAX_RUN_THINKING)
                out.append({"k": "thinking", "text": text, **({"clipped": True} if cut else {})})
            elif bt == "tool_use":
                args, cut = _tool_input(b.get("input"))
                out.append({"k": "tool", "id": b.get("id"), "name": b.get("name") or "",
                            "input": args, **({"clipped": True} if cut else {})})
            elif bt == "tool_result":
                text, cut = _result_text(b.get("content"))
                out.append({"k": "result", "id": b.get("tool_use_id"), "text": text,
                            "error": bool(b.get("is_error")),
                            **({"clipped": True} if cut else {})})
        return out
    if kind == "system":
        return [{"k": "system", "subtype": d.get("subtype") or ""}]
    if kind == "result":
        usage = d.get("usage") or {}
        return [{"k": "done", "error": bool(d.get("is_error")),
                 "subtype": d.get("subtype") or "",
                 "duration_ms": d.get("duration_ms") or d.get("duration_api_ms"),
                 "cost": d.get("total_cost_usd"),
                 "output_tokens": usage.get("output_tokens")}]
    return [{"k": "other", "type": str(kind or "")}]


def _run_row(ticket_id: int) -> sqlite3.Row | None:
    with _connect() as conn:
        return conn.execute("SELECT * FROM tickets WHERE id = ?", (int(ticket_id),)).fetchone()


def _parse_cursor(cursor) -> tuple[str, int]:
    """`<run>:<offset>`, or nothing at all — a cursor this side did not write is
    a first open rather than an error."""
    if not isinstance(cursor, str) or ":" not in cursor:
        return "", 0
    run, _, off = cursor.rpartition(":")
    try:
        return run, max(0, int(off))
    except ValueError:
        return "", 0


#: Which records the page budget is spent on. A hook firing and a rate-limit
#: warning are forty bytes each and are dropped by the client, so counting them
#: would mean a page of eighty records with three sentences in it — which is
#: exactly what the tail of a busy log looks like.
def _worth(rec: dict) -> int:
    return 0 if rec["k"] in ("system", "other") else 1


def _page(fh, start: int, end: int, newest: bool) -> tuple[list[dict], int, bool]:
    """The records between two offsets, up to what one answer carries.

    `newest` is a first open, which wants the end of the file the way opening a
    chat does: the whole window is parsed and the *last* records of it are kept.
    Every other read is a reader moving forward, and takes the first ones.
    """
    fh.seek(start)
    raw = fh.read(max(0, end - start))
    # Only whole lines: the last one may still be being written.
    cut = raw.rfind(b"\n")
    if cut < 0:
        return [], start, False
    lines = raw[:cut].split(b"\n")

    events: list[dict] = []
    size = 0
    kept = 0
    at = start
    truncated = False
    if newest:
        for line in reversed(lines):
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            got = _records(text)
            if not got:
                continue
            cost = sum(len(json.dumps(r, default=str)) for r in got)
            worth = sum(_worth(r) for r in got)
            if events and (kept + worth > MAX_RUN_EVENTS or size + cost > MAX_RUN_BYTES):
                truncated = True
                break
            events = got + events
            size += cost
            kept += worth
        return events, start + cut + 1, truncated

    for line in lines:
        at += len(line) + 1
        text = line.decode("utf-8", "replace").strip()
        if not text:
            continue
        got = _records(text)
        if not got:
            continue
        cost = sum(len(json.dumps(r, default=str)) for r in got)
        worth = sum(_worth(r) for r in got)
        if events and (kept + worth > MAX_RUN_EVENTS or size + cost > MAX_RUN_BYTES):
            truncated = True
            at -= len(line) + 1
            break
        events.extend(got)
        size += cost
        kept += worth
    return events, at, truncated


#: What a worker leaves for a person to look at, in the run directory it left
#: it in (`USTABASI_SHOTS`). Pictures only: this is a folder an agent writes
#: into, and anything else in it is not something to hand a browser.
SHOT_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif")

#: Enough of them to say what a screen looks like. A worker that wrote fifty is
#: one whose ticket is about something else.
MAX_SHOTS = 12


def _shots(run_dir: str | None) -> list[dict]:
    """The pictures this run left, oldest first.

    A ticket that changes a screen is finished when the screen is right, and
    "it is right" is a picture rather than a sentence. The queue gives every
    run a folder for them and the prompt asks for the finished state; this is
    the reading of it — the path, so the panel can ask for the file over the
    same route everything else on disk comes through, and the name, which is
    what the worker called the screen.
    """
    if not run_dir:
        return []
    folder = Path(run_dir) / "shots"
    try:
        found = [p for p in folder.iterdir()
                 if p.is_file() and p.suffix.lower() in SHOT_SUFFIXES]
    except OSError:
        return []
    out = []
    for p in sorted(found, key=lambda x: x.stat().st_mtime)[:MAX_SHOTS]:
        try:
            st = p.stat()
        except OSError:
            continue
        out.append({"path": str(p), "name": p.stem, "at": st.st_mtime, "size": st.st_size})
    return out


def run(ticket_id: int, cursor=None) -> dict:
    """A page of what the agent on this ticket has printed.

    Answers the same shape whatever the state of the queue, because every one of
    these is a thing the reader has to be told apart from the others: no queue on
    this computer, no such ticket, a ticket that has never been handed to
    anybody, a run whose directory has been cleared away, and a run that is
    simply quiet right now.
    """
    if not available():
        return {"available": False, "reason": "no_queue", "events": [],
                "cursor": None, "live": False, "caught_up": True, "shots": []}
    row = _run_row(ticket_id)
    if row is None:
        return {"available": True, "reason": "no_ticket", "events": [],
                "cursor": None, "live": False, "caught_up": True, "shots": []}

    run_dir = _col(row, "run_dir")
    if not run_dir:
        return {"available": True, "reason": "never_run", "events": [],
                "cursor": None, "live": False, "caught_up": True, "shots": []}
    path = Path(run_dir) / "stdout.log"
    name = Path(run_dir).name
    # The run is over the moment the queue writes its exit code, whatever the
    # ticket says: a ticket can sit in `running` between a worker finishing and
    # the verifier being handed it.
    finished = (Path(run_dir) / "exit.code").exists()
    live = row["status"] == "running" and not finished

    try:
        size = path.stat().st_size
    except OSError:
        return {"available": True, "reason": "no_log", "events": [], "run": name,
                "cursor": None, "live": live, "caught_up": True, "shots": _shots(run_dir)}

    want_run, at = _parse_cursor(cursor)
    # A cursor from another run is a cursor for another file. So is one past the
    # end of this one, which is what a truncated or replaced log looks like.
    reset = want_run != name or at > size
    skipped = False
    if reset:
        at = max(0, size - RUN_TAIL_BYTES)
    elif size - at > RUN_TAIL_BYTES:
        # Too far behind to read its way back. Being moved up to the end is the
        # honest answer; reading a phone through 300KB of tool output is not.
        at = size - RUN_TAIL_BYTES
        skipped = True

    newest = reset or skipped
    try:
        with path.open("rb") as fh:
            events, at, truncated = _page(fh, at, size, newest=newest)
    except OSError:
        return {"available": True, "reason": "no_log", "events": [], "run": name,
                "cursor": None, "live": live, "caught_up": True, "shots": _shots(run_dir)}

    return {
        "available": True,
        "reason": "",
        "run": name,
        "events": events,
        "cursor": f"{name}:{at}",
        # A first open, or a reader that was moved up: whatever it had is not
        # continuous with this, so it starts again rather than appending.
        "reset": reset or skipped,
        "live": live,
        # Nothing more to read right now. A page taken off the end left its
        # overflow *behind* it rather than ahead, so it is caught up whatever
        # it dropped; a page read forwards is caught up only if it got there.
        "caught_up": at >= size - 1 and (newest or not truncated),
        "size": size,
        # Whatever this run left for a person to look at. Sent with every page
        # rather than once: a screenshot appears when the work that produced it
        # is finished, which is in the middle of a run and not at the start.
        "shots": _shots(run_dir),
    }
