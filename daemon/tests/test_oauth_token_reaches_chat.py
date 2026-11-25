"""A `claude setup-token` sign-in has to reach the chat (25 Nov 2026).

The token is kept on the account and handed to the CLI as
CLAUDE_CODE_OAUTH_TOKEN. The sign-in check ran the CLI with the account's own
environment and passed; a chat, a call and the concierge copied only
CLAUDE_CONFIG_DIR and ANTHROPIC_API_KEY across, so every chat on that account
failed to authenticate. And the built-in account, having no folder of its own,
was never written down, so its key was gone after the next restart.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from divan import accounts, config
from divan.providers.base import ProviderConfig
from divan.providers.claude import ACCOUNT_ENV, ClaudeProvider
from divan.server import Server

TOKEN = "sk-ant-oat01-x"          # short, so the secret scanner leaves it alone


@pytest.fixture(autouse=True)
def quiet(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SCRATCH_DIR", tmp_path / "scratch")
    monkeypatch.setattr(accounts, "share_memory", lambda *a, **k: None)


def _env(account_env, home=None):
    p = ClaudeProvider.__new__(ClaudeProvider)
    p.cfg = ProviderConfig(model="sonnet", effort=None, perm_mode="ask", cwd="/tmp",
                           session_id=None, chat_id=None,
                           account_home=home, account_env=account_env)
    p._session_id = None
    return p._options().env


def test_a_setup_token_reaches_the_chat():
    acc = accounts.Account(id="default-claude", provider="claude", label="x", api_key=TOKEN)
    assert _env(acc.env())["CLAUDE_CODE_OAUTH_TOKEN"] == TOKEN


def test_a_token_in_the_daemons_shell_is_not_inherited(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "inherited-from-the-shell")
    home = str(tmp_path / "a")
    acc = accounts.Account(id="claude-a", provider="claude", label="a", home=home)
    env = _env(acc.env(), home=home)
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in env and env["CLAUDE_CONFIG_DIR"] == home


def test_call_and_voice_use_the_same_list():
    from divan import call, voice
    assert call.ACCOUNT_ENV is ACCOUNT_ENV and voice.ACCOUNT_ENV is ACCOUNT_ENV
    assert "CLAUDE_CODE_OAUTH_TOKEN" in ACCOUNT_ENV


def test_the_built_in_accounts_key_is_written_down():
    saved = {}
    host = SimpleNamespace(cfg=SimpleNamespace(accounts={}, save=lambda: saved.update(host.cfg.accounts)))
    host.accounts = {a.id: a for a in accounts.default_accounts()}
    host.accounts["default-claude"].api_key = TOKEN
    Server._save_accounts(host)
    assert saved["default-claude"]["api_key"] == TOKEN
    assert "default-codex" not in saved          # nothing to keep for it

    host.cfg.accounts = saved
    Server._load_accounts(host)
    assert host.accounts["default-claude"].api_key == TOKEN
    assert host.accounts["default-claude"].home is None
    assert host.accounts["default-codex"].api_key is None


def test_signing_a_key_out_sticks_and_leaves_the_computers_login(monkeypatch):
    import asyncio
    ran = []
    monkeypatch.setattr(accounts.subprocess, "run", lambda cmd, **kw: ran.append(cmd))
    monkeypatch.setattr(accounts, "refresh", lambda acc: acc)
    saved = {}
    host = SimpleNamespace(cfg=SimpleNamespace(accounts={}, save=lambda: saved.update(
        {"now": dict(host.cfg.accounts)})))
    host.accounts = {a.id: a for a in accounts.default_accounts()}
    host.accounts["default-claude"].api_key = TOKEN
    Server._save_accounts(host)
    assert "default-claude" in saved["now"]

    async def release(_aid):
        pass
    host._release_chats = release
    host._save_accounts = lambda: Server._save_accounts(host)
    asyncio.run(Server.h_account_logout(host, None, {"account_id": "default-claude"}))
    assert host.accounts["default-claude"].api_key is None
    assert "default-claude" not in saved["now"]          # gone from disk too
    assert not any("logout" in c for c in ran)           # the computer's login was not touched
