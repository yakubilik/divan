"""A turn that comes back refused for the plan limit moves to the next sign-in.

    uv run python -m pytest -q tests/test_limit_result_moves.py

23 Nov 2026 17:44: a background run's chat on claude-61d851 woke up for a
finished background task (a continuation turn, which never passes the pool's
check before a turn) and the CLI answered "You've hit your monthly spend limit
· … resets 7:30pm". The pool only moves chats that are mid-turn when a window
report says full (`_pool_sweep`); a refusal that arrives as the turn's own
result just ended the chat in an error. claude-9f9930 had room; the chat sat
for two hours until its owner asked whether automatic account switching was broken.

Guarded here:
  * a limit refusal as the turn's result hands the turn to `pool_next`, which
    carries it on the next sign-in with the transcript, no error shown;
  * with nowhere to go the chat stops as before, saying every account is out;
  * moves are capped, so sign-ins refusing in turn cannot loop forever.
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import session as sessmod  # noqa: E402
from divan.config import Config  # noqa: E402
from divan.db import DB  # noqa: E402
from divan.providers.base import TurnResult  # noqa: E402
from divan.session import ChatSession  # noqa: E402

LIMIT = ("You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage"
         " · your 5-hour limit resets 7:30pm (Europe/Amsterdam)")


def _ok() -> TurnResult:
    return TurnResult("s-ok", 0.01, {}, 10, 1)


def _refused() -> TurnResult:
    return TurnResult("s-x", None, None, None, None, is_error=True, error=LIMIT)


class FakeProvider:
    def __init__(self, answers: list[TurnResult], log: list):
        self.answers, self.log = answers, log

    async def run(self, prompt, attachments=None):
        self.log.append(("run", prompt))
        return self.answers.pop(0)

    async def run_continuation(self):
        self.log.append(("continuation", None))
        return self.answers.pop(0)

    def has_pending(self) -> bool:
        return False

    async def interrupt(self) -> None:
        pass

    async def close(self) -> None:
        pass


def _setup(answers: list[TurnResult], nexts: list):
    db = DB(Path(tempfile.mkdtemp()) / "db.sqlite")
    chat = db.create_chat(provider="claude", model="opus", effort="high", perm_mode="bypass",
                          cwd=tempfile.mkdtemp())
    db.update_chat(chat["id"], account_id="claude-a")
    events: list[str] = []

    async def emit_hook(*_a, **_k):
        pass

    s = ChatSession(db.get_chat(chat["id"]), db, Config(), emit_hook, emit_hook)
    calls: list = []
    s.provider = FakeProvider(answers, calls)
    s._provider_owner = "claude-a"

    async def pool_next(_chat):
        return nexts.pop(0) if nexts else None
    s.pool_next = pool_next

    async def no_rebuild():
        pass
    s._rebuild = no_rebuild
    s._build_provider = lambda chat: s.provider
    s._windows_allow = lambda _aid: False   # the windows back the refusal: no quiet retry
    real_emit = s.emit

    async def emit(type_, data, persist):
        events.append(type_)
        return await real_emit(type_, data, persist)
    s.emit = emit
    return db, s, calls, events


def test_a_refused_continuation_carries_on_on_the_next_sign_in():
    async def go():
        db, s, calls, events = _setup([_refused(), _ok()], ["claude-b"])
        await s._run(None, None, continuation=True)
        chat = db.get_chat(s.chat_id)
        assert chat["account_id"] == "claude-b"
        assert "account.switched" in events
        assert "turn.error" not in events
        assert "turn.done" in events
        assert calls[0] == ("continuation", None)
        assert calls[1][0] == "run" and sessmod.HANDOVER_NOTE in calls[1][1]
    asyncio.run(go())


def test_with_nowhere_to_go_it_stops_and_says_so():
    async def go():
        db, s, calls, events = _setup([_refused()], [])
        await s._run(None, None, continuation=True)
        assert db.get_chat(s.chat_id)["account_id"] == "claude-a"
        assert "pool.exhausted" in events
        assert len(calls) == 1
    asyncio.run(go())


def test_sign_ins_refusing_in_turn_do_not_loop():
    async def go():
        n = sessmod.LIMIT_MOVES_MAX
        db, s, calls, events = _setup([_refused()] * (n + 2), [f"claude-{i}" for i in range(n + 2)])
        await asyncio.wait_for(s._run(None, None, continuation=True), 10)
        assert len(calls) == n + 1
        assert events.count("account.switched") == n
        assert "turn.error" in events
    asyncio.run(go())


def test_an_ordinary_error_is_not_moved():
    async def go():
        boom = TurnResult(None, None, None, None, None, is_error=True, error="tool crashed")
        db, s, calls, events = _setup([boom], ["claude-b"])
        await s._run(None, None, continuation=True)
        assert db.get_chat(s.chat_id)["account_id"] == "claude-a"
        assert "turn.error" in events and "account.switched" not in events
    asyncio.run(go())
