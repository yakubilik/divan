"""An approval nobody answered says so, to the chat, to the agent and to a late Allow.

    uv run python -m pytest -q tests/test_approval_expiry.py

15 Oct 2026: a harmless command asked, the request timed out before Yakup
saw it, the chat recorded it as "deny", and the Allow he pressed afterwards
said "Could not send. Please try again." What is guarded here:

  * a request that times out is recorded as `expired` with a line saying so,
    and the agent is told it was NOT approved, not that it was denied;
  * the approval timeout itself is unchanged;
  * an Allow on a timed-out request, on one a restart dropped, or on one the
    daemon has never heard of, says which — never "try again";
  * on restart, every chat with a request still waiting gets a line saying it
    was dropped.
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.config import Config  # noqa: E402
from divan.db import DB  # noqa: E402
from divan.errors import Err  # noqa: E402
from divan.providers.base import CANCELLED_NOTE, DROPPED_NOTE, EXPIRED, EXPIRED_NOTE, EXPIRED_TO_AGENT, ProviderConfig  # noqa: E402
from divan.providers.claude import ClaudeProvider  # noqa: E402
from divan.server import Server  # noqa: E402
from divan.session import ChatSession, SessionManager  # noqa: E402


async def _nothing(*_a, **_k) -> None:
    pass


def _session(db: DB, timeout: float) -> ChatSession:
    chat = db.create_chat(provider="claude", model="opus", effort="high", perm_mode="bypass",
                          cwd=tempfile.mkdtemp())
    cfg = Config()
    cfg.approval_timeout_s = timeout
    return ChatSession(chat, db, cfg, _nothing, _nothing)


def _respond(db: DB, sessions, chat_id: str, request_id: str) -> Err:
    fake = SimpleNamespace(sessions=sessions, db=db)
    with pytest.raises(Err) as exc:
        asyncio.run(Server.h_approval_respond(fake, None, {
            "chat_id": chat_id, "request_id": request_id, "decision": "allow"}))
    return exc.value


def test_the_timeout_is_unchanged():
    assert Config().approval_timeout_s == 900


def test_a_timed_out_request_is_told_as_such(tmp_path):
    db = DB(tmp_path / "db.sqlite")
    s = _session(db, 0.05)
    decision = asyncio.run(s._approval("Bash", {"command": "rm -rf ~/projects"}, "can destroy"))
    assert decision == EXPIRED
    resolved = [e["data"] for e in db.events(s.chat_id) if e["event"] == "approval.resolved"]
    assert resolved == [{"request_id": resolved[0]["request_id"], "decision": EXPIRED,
                         "why": "timeout", "note": EXPIRED_NOTE}]
    assert "not run" in EXPIRED_NOTE

    # An Allow pressed after it: the request is gone, and the answer says why.
    sessions = SimpleNamespace(peek=lambda cid: s)
    err = _respond(db, sessions, s.chat_id, resolved[0]["request_id"])
    assert err.code == "approval_expired"
    assert "timed out" in str(err) and "not run" in str(err)
    assert "Could not send" not in str(err)


def test_a_structured_request_still_cancels_on_timeout(tmp_path):
    db = DB(tmp_path / "db.sqlite")
    s = _session(db, 0.05)
    decision = asyncio.run(s._approval("Questions", {"kind": "user_input", "questions": []}, None))
    assert decision == "deny"


def test_the_agent_is_told_it_was_not_approved(tmp_path):
    async def expire(*_):
        return EXPIRED

    cfg = ProviderConfig(model="m", effort=None, perm_mode="bypass", cwd=str(tmp_path), session_id=None)
    p = ClaudeProvider(cfg, _nothing, expire)
    out = asyncio.run(p._pre_tool_hook({"tool_name": "Bash", "tool_input": {"command": "rm -rf ~/"},
                                        "cwd": str(tmp_path)}, "t1", None))
    spec = out["hookSpecificOutput"]
    assert spec["permissionDecision"] == "deny"
    assert spec["permissionDecisionReason"] == EXPIRED_TO_AGENT
    assert "NOT approved" in EXPIRED_TO_AGENT and "did not run" in EXPIRED_TO_AGENT

    p.cfg.perm_mode = "ask"
    res = asyncio.run(p._can_use_tool("Write", {"file_path": "x"}, None))
    assert res.message == EXPIRED_TO_AGENT


def test_a_cancelled_request_is_resolved_not_left_open(tmp_path):
    """30 Oct 2026: the CLI cancelled the hook, nothing was recorded, and Allow stayed up for good."""
    db = DB(tmp_path / "d.sqlite")
    session = _session(db, 60)

    async def run():
        task = asyncio.create_task(session._approval("Bash", {"command": "dropdb x"}, "danger"))
        await asyncio.sleep(0.01)
        request_id = next(iter(session.pending))
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return request_id

    request_id = asyncio.run(run())
    assert not session.pending
    assert db.get_chat(session.chat_id)["status"] == "running"
    outcome = db.approval_outcome(session.chat_id, request_id)
    assert (outcome["decision"], outcome["why"], outcome["note"]) == (EXPIRED, "cancelled", CANCELLED_NOTE)
    assert _respond(db, SimpleNamespace(peek=lambda _id: session), session.chat_id, request_id).code == "approval_cancelled"


def test_the_bash_hook_outlives_the_approval_timeout():
    """A hook cut off first means the 900 s never ran and the request died unresolved."""
    pc = ProviderConfig(model="opus", effort=None, perm_mode="bypass", cwd=tempfile.mkdtemp(),
                        session_id=None, approval_timeout_s=900)
    provider = ClaudeProvider(pc, _nothing, _nothing)
    assert provider._options().hooks["PreToolUse"][0].timeout > 900


def test_a_restart_drops_waiting_requests_in_words(tmp_path):
    path = tmp_path / "db.sqlite"
    db = DB(path)
    waiting = db.create_chat(provider="claude", model="opus", effort="high", perm_mode="ask", cwd="/tmp")
    answered = db.create_chat(provider="claude", model="opus", effort="high", perm_mode="ask", cwd="/tmp")
    db.append_event(waiting["id"], "approval.request", {"request_id": "r1", "tool": "Bash"})
    db.append_event(answered["id"], "approval.request", {"request_id": "r2", "tool": "Bash"})
    db.append_event(answered["id"], "approval.resolved", {"request_id": "r2", "decision": "allow"})
    db._c.close()

    db = DB(path)       # the daemon starting again
    dropped = [e["data"] for e in db.events(waiting["id"]) if e["event"] == "approval.resolved"]
    assert dropped == [{"request_id": "r1", "decision": EXPIRED, "why": "restart", "note": DROPPED_NOTE}]
    assert "restarted" in DROPPED_NOTE and "not run" in DROPPED_NOTE
    # The chat that had nothing waiting is not told anything.
    assert [e["data"]["decision"] for e in db.events(answered["id"])
            if e["event"] == "approval.resolved"] == ["allow"]

    # An Allow on the dropped request — the session is new, nothing is pending.
    sessions = SessionManager(db, Config(), _nothing, _nothing)
    err = _respond(db, sessions, waiting["id"], "r1")
    assert err.code == "approval_dropped" and "restarted" in str(err) and "not run" in str(err)
    # …and on one the daemon never heard of.
    err = _respond(db, sessions, waiting["id"], "nope")
    assert err.code == "no_pending_approval" and "nothing was run" in str(err)
    # …and on one already answered.
    err = _respond(db, sessions, answered["id"], "r2")
    assert err.code == "approval_answered"
