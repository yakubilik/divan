"""Each chat gets its own TMPDIR (5 Nov 2026).

Yakup: a chat leaves the Mac clean when its work is done, like a ticket. A ticket's runs
have had their own scratch folder since #375; a chat wrote to the system TMPDIR and /tmp,
where nobody knew whose a file was. Now the CLI of a chat runs with TMPDIR set to
<divan home>/scratch/<chat id>, made before the CLI starts; mac-bekci deletes a folder
nothing used for a day.
"""
from __future__ import annotations

import asyncio

from divan import accounts, config
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider
from divan.providers.codex import CodexProvider
from divan.security import destructive_reason

import pytest


@pytest.fixture
def scratch(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SCRATCH_DIR", tmp_path / "scratch")
    monkeypatch.setattr(accounts, "share_memory", lambda *a, **k: None)
    return tmp_path / "scratch"


def _env(chat_id):
    p = ClaudeProvider.__new__(ClaudeProvider)
    p.cfg = ProviderConfig(model="sonnet", effort=None, perm_mode="ask", cwd="/tmp",
                           session_id=None, chat_id=chat_id)
    p._session_id = None
    return p._options().env


def test_chat_runs_with_its_own_tmpdir(scratch):
    env = _env("c-123")
    assert env["TMPDIR"] == str(scratch / "c-123")
    assert (scratch / "c-123").is_dir()


def test_two_chats_two_folders(scratch):
    assert _env("a")["TMPDIR"] != _env("b")["TMPDIR"]


def test_chat_id_cannot_leave_the_scratch_root(scratch):
    d = config.chat_scratch("../../etc", root=scratch)
    assert d.parent == scratch


# The command guard knows the chat's scratch folder (11 Nov 2026): `$TMPDIR` and a bare
# `mktemp` are that folder, so cleaning them up does not go to the phone.
_IN_SCRATCH = 'T=$(mktemp -d); touch "$T/a"; rm -rf "$T" "$TMPDIR/build"'


@pytest.fixture
def home_scratch(monkeypatch):
    # the throwaway DIVAN_HOME conftest set, laid out like the real one
    monkeypatch.setattr(config, "SCRATCH_DIR", config.CONFIG_DIR / "scratch")
    return config.CONFIG_DIR / "scratch"


def _provider(cls, chat_id, asked):
    async def approval(tool, tool_input, reason):
        asked.append(reason)
        return "deny"

    async def emit(*_):
        pass

    cfg = ProviderConfig(model="m", effort=None, perm_mode="bypass", cwd="/tmp/project",
                         session_id=None, chat_id=chat_id)
    return cls(cfg, emit, approval)


@pytest.mark.parametrize("chat_id, asks", [("c-1", False), (None, True)])
def test_claude_guard_gets_the_scratch(home_scratch, chat_id, asks):
    asked: list = []
    p = _provider(ClaudeProvider, chat_id, asked)
    hook = {"tool_name": "Bash", "tool_input": {"command": _IN_SCRATCH}, "cwd": "/tmp/project"}
    asyncio.run(p._pre_tool_hook(hook, "t1", None))
    assert bool(asked) is asks, asked
    if chat_id:
        assert p.scratch_dir() == str(home_scratch / chat_id)


@pytest.mark.parametrize("chat_id, asks", [("c-1", False), (None, True)])
def test_codex_guard_gets_the_scratch(home_scratch, chat_id, asks):
    asked: list = []
    p = _provider(CodexProvider, chat_id, asked)
    sent: list = []

    async def send(msg):
        sent.append(msg)

    p._send = send
    asyncio.run(p._server_request(1, "item/commandExecution/requestApproval",
                                  {"command": _IN_SCRATCH, "cwd": "/tmp/project"}))
    assert bool(asked) is asks, asked
    assert sent[-1]["result"]["decision"] == ("decline" if asks else "accept")


def test_rest_of_the_home_still_asks(home_scratch):
    home = str(config.CONFIG_DIR)
    for cmd in (f"rm -rf {home}/scratch", f"rm -rf {home}", f"echo x > {home}/db.sqlite",
                f"sed -i '' s/a/b/ {home}/config.toml"):
        assert destructive_reason(cmd, "/tmp/project", tmpdir=str(home_scratch / "c-1")), cmd
