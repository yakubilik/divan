"""A CLI whose stream ends mid-turn ends the turn; it does not hang it.

24 Nov 2026 14:50: a chat woke from a usage-limit wait, its new CLI went away
right after the question was sent, and the SDK's stream simply ended — no
exception. The reader returned without a word, the turn waited on an inbox
nobody would fill again, and the chat sat on "running" for nineteen hours
while every message typed into it was queued behind a turn that never ended.
"""
from __future__ import annotations

import asyncio

from divan.providers import claude as claude_mod
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider


class VanishingClient:
    """Connects, takes the question, then the stream just stops."""

    def __init__(self, options=None):
        self.asked = asyncio.Event()

    async def connect(self, prompt=None):
        pass

    async def query(self, prompt):
        self.asked.set()

    async def receive_messages(self):
        await self.asked.wait()
        return
        yield  # an async generator that ends cleanly

    async def interrupt(self):
        pass

    async def disconnect(self):
        pass


def provider() -> ClaudeProvider:
    async def emit(t, payload, persist):
        pass

    async def approval(tool, inp, reason):
        return "allow"
    pc = ProviderConfig(model="opus", effort=None, perm_mode="bypass", cwd="/tmp",
                        session_id=None, chat_id=None)
    return ClaudeProvider(pc, emit, approval)


def test_a_stream_that_ends_mid_turn_ends_the_turn(monkeypatch):
    monkeypatch.setattr(claude_mod, "ClaudeSDKClient", VanishingClient)

    async def go():
        p = provider()
        try:
            res = await asyncio.wait_for(p.run("hello"), timeout=5)
        except asyncio.TimeoutError:
            raise AssertionError("the turn hung on a stream that had ended")
        else:
            # Ended as a kill, so the session picks the turn up on a fresh CLI.
            assert res.is_error and res.killed
        finally:
            await p.close()
    asyncio.run(go())
