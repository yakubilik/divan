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
