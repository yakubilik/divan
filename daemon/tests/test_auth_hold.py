"""A sign-in held as signed out after a refused turn comes back.

13 Nov 2026: both signed-in Claude accounts were refused once at 11:19 and
held for six hours; every new chat failed. On a Mac the claude CLI keeps its
credentials in the keychain, so the hold never saw a sign-in again either.
"""
import subprocess
import time

from divan import accounts as acct


def _account(tmp_path):
    return acct.Account(id="claude-x", label="x", provider="claude", home=str(tmp_path))


def test_a_passing_refusal_is_held_for_half_an_hour_at_most(tmp_path, monkeypatch):
    monkeypatch.setattr(acct.sys, "platform", "linux")
    a = _account(tmp_path)
    a.auth_failed_at = time.time() - 31 * 60
    assert not acct.auth_broken(a)


def test_signing_in_again_into_the_keychain_lifts_the_hold(tmp_path, monkeypatch):
    failed = time.time() - 60
    written = time.strftime("%Y%m%d%H%M%S", time.gmtime(failed + 30))
    out = f'    "mdat"<timedate>=0x00  "{written}Z\\000"\n'
    monkeypatch.setattr(acct.sys, "platform", "darwin")
    monkeypatch.setattr(acct.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, out, ""))
    a = _account(tmp_path)
    a.auth_failed_at = failed
    assert not acct.auth_broken(a)
