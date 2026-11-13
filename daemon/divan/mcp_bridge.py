"""A read-only MCP server over this daemon's chats and the ustabasi queue.

It lets an outside assistant — ChatGPT's dot, reached over OpenAI's Secure MCP
Tunnel — ask what is going on here: which chats exist, what a chat said, what a
chat or a ticket finished with. Nothing in it starts, stops or answers anything;
giving work is a later, separate tool behind the daemon's own approval.

It is its own process, not part of the daemon. It speaks MCP over stdio, so the
tunnel client starts it as a child and no port is opened: the only way in is
the tunnel, and the tunnel is gated by OpenAI's runtime key on this machine.

    python -m divan.mcp_bridge            # stdio, what tunnel-client runs

It reads the daemon's SQLite database read-only and the queue through
`ustabasi.snapshot`, the same read the wall uses. Every text that leaves goes
through `secrets.mask` first, so a key pasted into a chat leaves as its
placeholder. Long texts are cut; the cut is said, not hidden.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import secrets, ustabasi
from .config import resolve_home

#: One message is cut at this many characters, a chat preview much shorter.
MAX_MESSAGE = 4000
MAX_PREVIEW = 300
MAX_LIST = 50
MAX_MESSAGES = 30

INSTRUCTIONS = """\
Divan is the user's own computer running coding agents (Claude Code, Codex), one
per chat, plus a ticket queue called ustabasi for longer autonomous work.
These tools only read. Use list_chats to find a chat (search by words in its
title or task), chat_result for what a chat finished with, read_chat for the
conversation itself, and list_tickets / ticket for the queue. Chat ids may be
given by their first few characters. Chats are mostly in Turkish."""


class Refused(ToolError):
    """A wrong id or a missing database: told to the caller in words, not a crash."""


def db_path() -> Path:
    return resolve_home() / "db.sqlite"


def _connect() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        raise Refused(f"no Divan database at {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _when(ts) -> str | None:
    if not ts:
        return None
    return dt.datetime.fromtimestamp(float(ts)).astimezone().isoformat(timespec="seconds")


def _cut(text: str | None, n: int) -> str:
    text = secrets.mask(text or "")
    if len(text) <= n:
        return text
    return text[:n] + f" … [cut, {len(text) - n} more characters]"


def _chat_row(conn: sqlite3.Connection, chat_id: str) -> sqlite3.Row:
    chat_id = (chat_id or "").strip()
    if len(chat_id) < 4:
        raise Refused("give at least the first 4 characters of the chat id")
    rows = conn.execute(
        "SELECT c.*, p.name AS project_name FROM chats c "
        "LEFT JOIN projects p ON p.id = c.project_id WHERE c.id LIKE ? || '%' LIMIT 2",
        (chat_id,)).fetchall()
    if not rows:
        raise Refused(f"no chat with id {chat_id}")
    if len(rows) > 1:
        raise Refused(f"more than one chat starts with {chat_id}; give more characters")
    return rows[0]


def _summary(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "title": secrets.mask(r["title"] or ""),
        "project": r["project_name"],
        "agent": r["provider"],
        "running": r["status"] == "running",
        "archived": bool(r["archived"]),
        "folder": r["cwd"],
        "task": _cut(r["task"], MAX_PREVIEW) or None,
        "done": _cut(r["done"], MAX_PREVIEW) or None,
        "last_preview": _cut(r["last_preview"], MAX_PREVIEW) or None,
        "created": _when(r["created_at"]),
        "updated": _when(r["updated_at"]),
    }


def _text(payload: str) -> str:
    try:
        return json.loads(payload).get("text") or ""
    except (ValueError, AttributeError):
        return ""


# --- the tools, as plain functions so a test can call them without MCP -------

def list_chats(query: str = "", limit: int = 15, running_only: bool = False,
               include_archived: bool = True) -> dict:
    limit = max(1, min(int(limit), MAX_LIST))
    where, args = [], []
    for word in (query or "").split():
        where.append("(c.title LIKE ? OR c.task LIKE ? OR c.done LIKE ? OR p.name LIKE ?)")
        args += [f"%{word}%"] * 4
    if running_only:
        where.append("c.status = 'running'")
    if not include_archived:
        where.append("c.archived = 0")
    sql = ("SELECT c.*, p.name AS project_name FROM chats c "
           "LEFT JOIN projects p ON p.id = c.project_id "
           + ("WHERE " + " AND ".join(where) + " " if where else "")
           + "ORDER BY c.updated_at DESC LIMIT ?")
    with _connect() as conn:
        rows = conn.execute(sql, (*args, limit)).fetchall()
    return {"chats": [_summary(r) for r in rows], "count": len(rows)}


def read_chat(chat_id: str, last: int = 10) -> dict:
    last = max(1, min(int(last), MAX_MESSAGES))
    with _connect() as conn:
        r = _chat_row(conn, chat_id)
        events = conn.execute(
            "SELECT type, payload, ts FROM events WHERE chat_id = ? "
            "AND type IN ('message.user', 'message.assistant') ORDER BY seq DESC LIMIT ?",
            (r["id"], last)).fetchall()
    messages = [{
        "from": "user" if e["type"] == "message.user" else "agent",
        "at": _when(e["ts"]),
        "text": _cut(_text(e["payload"]), MAX_MESSAGE),
    } for e in reversed(events)]
    return {"chat": _summary(r), "messages": messages}


def chat_result(chat_id: str) -> dict:
    """What the newest turn ended with: every agent message after the last user one."""
    with _connect() as conn:
        r = _chat_row(conn, chat_id)
        asked = conn.execute(
            "SELECT seq, payload, ts FROM events WHERE chat_id = ? AND type = 'message.user' "
            "ORDER BY seq DESC LIMIT 1", (r["id"],)).fetchone()
        since = asked["seq"] if asked else 0
        answers = conn.execute(
            "SELECT payload, ts FROM events WHERE chat_id = ? AND type = 'message.assistant' "
            "AND seq > ? ORDER BY seq", (r["id"], since)).fetchall()
        ended = conn.execute(
            "SELECT type, ts FROM events WHERE chat_id = ? AND type IN ('turn.done', 'turn.error') "
            "AND seq > ? ORDER BY seq DESC LIMIT 1", (r["id"], since)).fetchone()
    answer = "\n\n".join(t for t in (_text(a["payload"]) for a in answers) if t)
    if r["status"] == "running":
        state = "still working"
    elif ended is None:
        state = "no finished answer since the last message"
    else:
        state = "failed" if ended["type"] == "turn.error" else "finished"
    return {
        "chat": _summary(r),
        "state": state,
        "asked": _cut(_text(asked["payload"]), MAX_PREVIEW) if asked else None,
        "asked_at": _when(asked["ts"]) if asked else None,
        "answer": _cut(answer, MAX_MESSAGE * 2) or None,
        "answered_at": _when(ended["ts"]) if ended else None,
    }


def _ticket_brief(t: dict) -> dict:
    last = t.get("last_event") or {}
    return {
        "id": t["id"],
        "title": secrets.mask(t.get("title") or ""),
        "status": t.get("status"),
        "stage": t.get("stage"),
        "round": t.get("round"),
        "project": t.get("project"),
        "updated": _when(t.get("updated_at")),
        "finished": _when(t.get("finished_at")),
        "waiting_for_answer": _cut(t.get("ask") or t.get("escalation"), MAX_PREVIEW) or None,
        "last_event": _cut(last.get("msg"), MAX_PREVIEW) or None,
    }


def list_tickets(status: str = "", limit: int = 20) -> dict:
    limit = max(1, min(int(limit), MAX_LIST))
    snap = ustabasi.snapshot(git=False)
    if not snap.get("available"):
        return {"available": False, "tickets": []}
    tickets = snap["tickets"]
    if status:
        tickets = [t for t in tickets if (t.get("status") or "") == status.strip().lower()]
    tickets = sorted(tickets, key=lambda t: t.get("updated_at") or 0, reverse=True)[:limit]
    return {"available": True, "tickets": [_ticket_brief(t) for t in tickets]}


def ticket(ticket_id: int) -> dict:
    snap = ustabasi.snapshot(git=False)
    for t in snap.get("tickets", []):
        if t["id"] == int(ticket_id):
            out = _ticket_brief(t)
            out.update({
                "goal": _cut(t.get("goal"), MAX_MESSAGE),
                "summary": _cut(t.get("summary"), MAX_MESSAGE) or None,
                "verdict": _cut(t.get("verdict"), MAX_MESSAGE) or None,
                "branch": t.get("branch"),
                "steps": [{k: s.get(k) for k in ("name", "state", "note") if k in s}
                          for s in (t.get("steps") or [])],
            })
            return out
    raise Refused(f"no ticket #{ticket_id}")


def build() -> MCPServer:
    server = MCPServer(name="divan", title="Divan", instructions=INSTRUCTIONS, version="0.1")
    ro = {"annotations": {"readOnlyHint": True}} if _accepts_annotations(server) else {}

    @server.tool(description="List the chats on this computer, newest first. "
                 "`query` matches words in the title, task, result or project.", **ro)
    def divan_list_chats(query: str = "", limit: int = 15, running_only: bool = False,
                         include_archived: bool = True) -> dict:
        return list_chats(query, limit, running_only, include_archived)

    @server.tool(description="The last messages of one chat, oldest first.", **ro)
    def divan_read_chat(chat_id: str, last: int = 10) -> dict:
        return read_chat(chat_id, last)

    @server.tool(description="What a chat's newest turn ended with: still working, "
                 "finished or failed, and the agent's answer.", **ro)
    def divan_chat_result(chat_id: str) -> dict:
        return chat_result(chat_id)

    @server.tool(description="Tickets in the ustabasi queue, newest first. `status` "
                 "filters, e.g. queued, running, blocked, done, failed.", **ro)
    def divan_list_tickets(status: str = "", limit: int = 20) -> dict:
        return list_tickets(status, limit)

    @server.tool(description="One ustabasi ticket in detail: goal, steps, summary, verdict.", **ro)
    def divan_ticket(ticket_id: int) -> dict:
        return ticket(ticket_id)

    return server


def _accepts_annotations(server: MCPServer) -> bool:
    import inspect
    return "annotations" in inspect.signature(server.tool).parameters


def main() -> None:
    build().run()


if __name__ == "__main__":
    main()
