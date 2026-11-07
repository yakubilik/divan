"""The CLI outlives the daemon (`held.py`).

Driven with a scripted claude (`fake_claude.py`) through the real SDK, relay and
holder: a turn is started, the "daemon" lets go in the middle of it as it does
when it restarts, and a new provider takes the CLI back and drains the rest of
the turn — no second handshake reaching the CLI, no word lost or repeated, and
a permission request that was open when the daemon went is asked again.
"""
from __future__ import annotations

import asyncio
import json
import os
import stat
import tempfile
import time
from pathlib import Path

import pytest

from divan import held
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider

FAKE = Path(__file__).with_name("fake_claude.py")

pytestmark = pytest.mark.skipif(not held.enabled(), reason="held CLIs are unix-only")


@pytest.fixture()
def fake(monkeypatch):
    FAKE.chmod(FAKE.stat().st_mode | stat.S_IXUSR)
    logf = Path(tempfile.mkdtemp(prefix="dv-fake-")) / "cli.jsonl"
    monkeypatch.setenv("DIVAN_CLAUDE_CLI", str(FAKE))
    monkeypatch.setenv("CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK", "1")
    monkeypatch.setenv("FAKE_LOG", str(logf))
    yield logf
    held.clear_detaching()


CWDS: dict[str, str] = {}


def provider(chat_id: str, events: list, perm: str = "bypass", answer=None) -> ClaudeProvider:
    async def emit(t, payload, persist):
        events.append((t, payload))

    async def approval(tool, inp, reason):
        return answer(tool, inp) if answer else "allow"
    # One folder per chat: a different one is a different CLI (`held.fingerprint`).
    cwd = CWDS.setdefault(chat_id, tempfile.mkdtemp(prefix="dv-cwd-"))
    pc = ProviderConfig(model="opus", effort=None, perm_mode=perm, cwd=cwd, session_id=None,
                        chat_id=chat_id)
    return ClaudeProvider(pc, emit, approval)


def text_of(events) -> str:
    return "".join(p.get("text", "") for t, p in events if t == "message.assistant")


def handshakes(logf: Path) -> int:
    n = 0
    for line in logf.read_text().splitlines():
        o = json.loads(line)["obj"]
        if o.get("type") == "control_request" and (o.get("request") or {}).get("subtype") == "initialize":
            n += 1
    return n


async def wait_for(pred, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        await asyncio.sleep(0.1)
    return False


def test_a_turn_runs_through_the_holder(fake):
    async def go():
        ev: list = []
        p = provider("held-plain", ev)
        res = await asyncio.wait_for(p.run("hello"), 30)
        assert not res.is_error, res.error
        assert text_of(ev).strip() == "w0 w1 w2 w3"
        st = held.read_state("held-plain")
        assert st and not st["in_turn"]
        assert "held-plain" in held.live_keys()
        await p.close()                                   # closed on purpose: the CLI stops
        assert await wait_for(lambda: "held-plain" not in held.live_keys())
    asyncio.run(go())


def test_the_turn_survives_the_daemon_letting_go(fake):
    async def go():
        ev1: list = []
        p1 = provider("held-restart", ev1)
        p1._turn_active = True
        await p1._ensure_client()
        await p1._client.query("SLOW please")
        # A few words in, the daemon stops to come back.
        assert await wait_for(lambda: sum(1 for t, _ in ev1 if t == "text.delta") >= 0, 1)
        await asyncio.sleep(2.2)
        held.mark_detaching()
        await p1.close()
        st = held.read_state("held-restart")
        assert st and st["in_turn"], st                   # the CLI is still in its turn
        held.clear_detaching()
        await asyncio.sleep(1.5)                          # it carries on with nobody listening
        ev2: list = []
        p2 = provider("held-restart", ev2)
        await p2.attach(True)
        res = await asyncio.wait_for(p2.run_continuation(), 30)
        assert not res.is_error, res.error
        words = "".join(f"w{i} " for i in range(16))
        assert text_of(ev2).strip() == words.strip()       # the whole block, once
        assert handshakes(fake) == 1                       # the CLI saw one initialize
        await p2.close()
    asyncio.run(go())


def test_an_open_permission_request_is_asked_again(fake):
    async def go():
        ev1: list = []
        asked1: list = []
        hang = asyncio.Event()

        async def emit(t, payload, persist):
            ev1.append((t, payload))
        p1 = provider("held-ask", ev1, perm="ask")

        async def never(tool, inp, reason):
            asked1.append(tool)
            await hang.wait()                              # the daemon dies holding it
            return "deny"
        p1.approval = never
        p1._turn_active = True
        await p1._ensure_client()
        await p1._client.query("ASK for it")
        assert await wait_for(lambda: bool(asked1), 15)
        held.mark_detaching()
        await p1.close()
        held.clear_detaching()
        ev2: list = []
        asked2: list = []

        async def allow(tool, inp, reason):
            asked2.append(tool)
            return "allow"
        p2 = provider("held-ask", ev2, perm="ask")
        p2.approval = allow
        await p2.attach(True)
        res = await asyncio.wait_for(p2.run_continuation(), 30)
        assert not res.is_error, res.error
        assert asked2 == ["Write"]                         # asked again, once
        assert "permission allow" in text_of(ev2)
        await p2.close()
    asyncio.run(go())


# ── Codex, the same through `codex app-server` ─────────────────────────────

FAKE_CODEX = Path(__file__).with_name("fake_codex.py")


@pytest.fixture()
def fake_codex(monkeypatch):
    from divan import tools
    FAKE_CODEX.chmod(FAKE_CODEX.stat().st_mode | stat.S_IXUSR)
    logf = Path(tempfile.mkdtemp(prefix="dv-fakecx-")) / "cli.jsonl"
    monkeypatch.setattr(tools, "find_cli", lambda name: str(FAKE_CODEX))
    monkeypatch.setenv("FAKE_LOG", str(logf))
    yield logf
    held.clear_detaching()


def codex(chat_id: str, events: list, perm: str = "bypass", session_id=None):
    from divan.providers.codex import CodexProvider

    async def emit(t, payload, persist):
        events.append((t, payload))

    async def approval(tool, inp, reason):
        return "allow"
    cwd = CWDS.setdefault(chat_id, tempfile.mkdtemp(prefix="dv-cwd-"))
    pc = ProviderConfig(model="fake", effort=None, perm_mode=perm, cwd=cwd, session_id=session_id,
                        chat_id=chat_id)
    return CodexProvider(pc, emit, approval)


def sent(logf: Path, method: str) -> int:
    return sum(1 for l in logf.read_text().splitlines() if json.loads(l)["obj"].get("method") == method)


def test_a_codex_turn_survives_the_daemon_letting_go(fake_codex):
    async def go():
        ev1: list = []
        p1 = codex("held-codex", ev1)
        await p1._ensure()
        p1._turn_done = asyncio.Event()
        await p1._call("turn/start", {"threadId": p1._thread_id,
                                      "input": [{"type": "text", "text": "SLOW", "text_elements": []}]})
        await asyncio.sleep(2.2)
        held.mark_detaching()
        await p1.close()
        st = held.read_state("held-codex")
        assert st and st["in_turn"] and st["turn_id"] == "tu1", st
        held.clear_detaching()
        await asyncio.sleep(1)
        ev2: list = []
        p2 = codex("held-codex", ev2, session_id="th1")
        await p2.attach(True, st["turn_id"])
        res = await asyncio.wait_for(p2.run_continuation(), 30)
        assert not res.is_error, res.error
        assert text_of(ev2).strip() == "".join(f"c{i} " for i in range(16)).strip()
        assert sent(fake_codex, "initialize") == 1 and sent(fake_codex, "thread/resume") == 0
        await p2.close()
        assert await wait_for(lambda: "held-codex" not in held.live_keys())
    asyncio.run(go())


def test_a_codex_approval_open_at_the_restart_is_asked_again(fake_codex):
    async def go():
        ev1: list = []
        p1 = codex("held-codex-ask", ev1, perm="suggest")
        asked1: list = []
        hang = asyncio.Event()

        async def never(tool, inp, reason):
            asked1.append(tool)
            await hang.wait()
            return "deny"
        p1.approval = never
        await p1._ensure()
        p1._turn_done = asyncio.Event()
        await p1._call("turn/start", {"threadId": p1._thread_id,
                                      "input": [{"type": "text", "text": "ASK", "text_elements": []}]})
        assert await wait_for(lambda: bool(asked1), 15)
        held.mark_detaching()
        await p1.close()
        held.clear_detaching()
        ev2: list = []
        p2 = codex("held-codex-ask", ev2, perm="suggest", session_id="th1")
        st = held.read_state("held-codex-ask")
        await p2.attach(True, st["turn_id"])
        res = await asyncio.wait_for(p2.run_continuation(), 30)
        assert not res.is_error, res.error
        assert "decision accept" in text_of(ev2)
        await p2.close()
    asyncio.run(go())
