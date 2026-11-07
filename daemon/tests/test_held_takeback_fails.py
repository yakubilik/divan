"""A held CLI that cannot be taken back is stopped and its turn picked up again.

7 Nov 2026: a take-back timed out and the daemon simply logged it. The SDK's
reader and the relay stayed attached to the CLI, the chat stayed "running", and
every tool call the CLI made waited sixteen minutes on a hook nobody answered.
Now a failed connect leaves nothing attached, and the turn starts again from the
transcript on a fresh CLI.
"""
from __future__ import annotations

import asyncio

import pytest

from divan import held
from divan.providers import claude as claude_mod
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider
from divan.server import Server

from test_restart_holds_sends import server


class FailingClient:
    made: list = []

    def __init__(self, options=None):
        self.disconnected = False
        FailingClient.made.append(self)

    async def connect(self, prompt=None):
        raise Exception("Control request timeout: initialize")

    async def disconnect(self):
        self.disconnected = True


@pytest.fixture()
def failing(monkeypatch):
    FailingClient.made = []
    stopped: list = []

    async def stop(key, timeout=15):
        stopped.append(key)
        return True
    monkeypatch.setattr(claude_mod, "ClaudeSDKClient", FailingClient)
    monkeypatch.setattr(held, "enabled", lambda: True)
    monkeypatch.setattr(held, "stop", stop)
    monkeypatch.setattr(held, "relay_script", lambda: "/bin/false")
    return stopped


def provider() -> ClaudeProvider:
    async def emit(t, payload, persist):
        pass

    async def approval(tool, inp, reason):
        return "allow"
    pc = ProviderConfig(model="opus", effort=None, perm_mode="bypass", cwd="/tmp", session_id=None,
                        chat_id="takeback-1")
    return ClaudeProvider(pc, emit, approval)


def test_a_failed_take_back_disconnects_and_stops_the_held_cli(failing):
    async def go():
        p = provider()
        with pytest.raises(Exception):
            await p.attach(True)
        assert len(FailingClient.made) == 1                # no second try mid-turn
        assert FailingClient.made[0].disconnected          # the relay and reader are gone
        assert failing == ["takeback-1"]                   # and the CLI with them
        assert p._client is None and not p._turn_active
    asyncio.run(go())


def test_a_new_message_on_a_dead_held_cli_gets_a_fresh_one(failing):
    async def go():
        p = provider()
        with pytest.raises(Exception):
            await p._ensure_client()
        assert len(FailingClient.made) == 2                # stopped, then started again
        assert all(c.disconnected for c in FailingClient.made)
    asyncio.run(go())


@pytest.fixture()
def config_kept():
    """`server()` writes a demo config into the shared test home; put it back."""
    from divan.config import CONFIG_PATH
    before = CONFIG_PATH.read_text() if CONFIG_PATH.exists() else None
    yield
    if before is None:
        CONFIG_PATH.unlink(missing_ok=True)
    else:
        CONFIG_PATH.write_text(before)


def test_the_server_resumes_a_turn_it_could_not_take_back(monkeypatch, config_kept):
    async def go():
        srv, cwd = server()
        chat = await srv.h_chat_create(None, {"cwd": cwd, "title": "takeback"})
        cid = chat["id"]
        srv.db.append_event(cid, "message.user", {"text": "apply the plan", "attachments": []})
        stopped: list = []

        async def stop(key, timeout=15):
            stopped.append(key)
            return True

        async def attach(state):
            raise Exception("Control request timeout: initialize")
        monkeypatch.setattr(held, "enabled", lambda: True)
        monkeypatch.setattr(held, "live_keys", lambda: [cid])
        monkeypatch.setattr(held, "read_state", lambda k: {"in_turn": True})
        monkeypatch.setattr(held, "stop", stop)
        monkeypatch.setattr(srv.sessions.get(cid), "attach", attach)
        plans = await srv.attach_held()
        assert stopped == [cid]
        assert plans == [{"chat_id": cid, "messages": [("apply the plan", [])]}]
    asyncio.run(go())
