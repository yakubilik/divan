"""A Claude sign-in kept in the keychain still shows when it ends.

25 Nov 2026: bedriyan's sign-in (made 26 Oct) reached Claude's 30-day end at
05:54 and dropped out of the picker without a word. On a Mac the CLI keeps
the tokens in the keychain, so the end date was never read and the panel
never warned; `claude auth status` reports it as loginExpiresAt.
"""
import json
import subprocess

from divan import accounts as acct


def test_the_end_of_a_keychain_sign_in_comes_from_auth_status(tmp_path, monkeypatch):
    out = json.dumps({"loggedIn": True, "authMethod": "claude.ai", "email": "x@y",
                      "loginExpiresAt": "2026-12-07T11:12:16.770Z"})
    monkeypatch.setattr(acct.tools, "find_cli", lambda name: "/bin/claude")
    monkeypatch.setattr(acct.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, out, ""))
    a = acct.Account(id="claude-x", label="x", provider="claude", home=str(tmp_path))
    acct.refresh(a)
    assert a.logged_in
    assert a.expires_at == 1796641936.77


def test_a_setup_token_signs_in_as_an_oauth_token_not_a_key(tmp_path, monkeypatch):
    """`claude setup-token` lasts a year; handed over as ANTHROPIC_API_KEY it is refused."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "inherited")
    a = acct.Account(id="claude-x", label="x", provider="claude", home=str(tmp_path),
                     api_key="sk-ant-oat01-x")
    e = a.env()
    assert e["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-x"
    assert "ANTHROPIC_API_KEY" not in e
    a.api_key = "sk-ant-api03-x"
    e = a.env()
    assert e["ANTHROPIC_API_KEY"] == "sk-ant-api03-x"
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in e


def test_a_setup_token_is_checked_by_the_cli_and_kept(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(acct, "check_api_key", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    monkeypatch.setattr(acct, "verify_signed_in",
                        lambda acc, timeout=90: (seen.setdefault("env", acc.env()), (True, ""))[1])
    monkeypatch.setattr(acct, "refresh", lambda acc: acc)
    a = acct.Account(id="claude-x", label="x", provider="claude", home=str(tmp_path))
    a, ok, _ = acct.login_with_key(a, "sk-ant-oat01-x")
    assert ok and a.api_key == "sk-ant-oat01-x"
    assert seen["env"]["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-x"
