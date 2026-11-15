"""A chat archived while its turn is still running stays archived.

    uv run python -m pytest -q tests/test_archive_mid_turn.py

15 Nov 2026: Archive in the panel did nothing the first time and worked the
second. The daemon brings an archived chat back on any new event, so the
running turn's next tool call put it straight back in the list; once the turn
was over a second press stuck. What is guarded here:

  * the rest of the turn that was running when the chat was archived does not
    bring it back;
  * a message typed into it, or a question for the person, still does;
  * the next turn does, as before;
  * a chat archived while idle comes back on its next event, as before.
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.config import Config  # noqa: E402
from divan.db import DB  # noqa: E402
from divan.session import ChatSession  # noqa: E402


async def _nothing(*_a, **_k) -> None:
    pass


def _setup():
    db = DB(Path(tempfile.mkdtemp()) / "db.sqlite")
    chat = db.create_chat(provider="claude", model="opus", effort="high", perm_mode="bypass",
                          cwd=tempfile.mkdtemp())
    return db, ChatSession(chat, db, Config(), _nothing, _nothing)


def _archive(db: DB, s: ChatSession) -> None:
    db.update_chat(s.chat_id, archived=1)
    s.archived_by_hand()


def _archived(db: DB, s: ChatSession) -> bool:
    return bool(db.get_chat(s.chat_id)["archived"])


async def _busy(s: ChatSession) -> asyncio.Future:
    gate = asyncio.get_running_loop().create_future()
    s.running = asyncio.ensure_future(gate)
    return gate


def test_the_running_turn_does_not_bring_it_back():
    async def go():
        db, s = _setup()
        gate = await _busy(s)
        _archive(db, s)
        await s.emit("tool.use", {"name": "Bash"}, True)
        await s.emit("tool.result", {"text": "ok"}, True)
        await s.emit("message.assistant", {"text": "done"}, True)
        await s.emit("turn.done", {}, True)
        assert _archived(db, s)
        gate.set_result(None)
        await asyncio.sleep(0)
        # The next turn is something new.
        await s.emit("message.assistant", {"text": "later"}, True)
        assert not _archived(db, s)
    asyncio.run(go())


def test_a_message_or_a_question_still_brings_it_back():
    async def go():
        for wake in ("message.user", "approval.request"):
            db, s = _setup()
            gate = await _busy(s)
            _archive(db, s)
            await s.emit("tool.use", {"name": "Bash"}, True)
            assert _archived(db, s)
            await s.emit(wake, {"text": "hey"}, True)
            assert not _archived(db, s), wake
            gate.set_result(None)
    asyncio.run(go())


def test_archived_while_idle_comes_back_on_the_next_event():
    async def go():
        db, s = _setup()
        _archive(db, s)
        await s.emit("message.assistant", {"text": "a background task finished"}, True)
        assert not _archived(db, s)
    asyncio.run(go())
