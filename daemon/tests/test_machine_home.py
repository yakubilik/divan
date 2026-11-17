"""A second daemon for a second person on one login: DIVAN_CLAUDE_HOME and
DIVAN_CODEX_HOME move the folder the tools call their own, so her chats never
read his instructions, skills or notes, and never run on his sign-in."""
import hashlib
from pathlib import Path

from divan import accounts as acct
from divan import agents, config


def test_the_usual_folder_when_nothing_is_named(monkeypatch):
    monkeypatch.delenv("DIVAN_CLAUDE_HOME", raising=False)
    monkeypatch.delenv("DIVAN_CODEX_HOME", raising=False)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)   # a test run from inside a chat
    assert config.machine_home("claude") == Path.home() / ".claude"
    assert config.machine_home("codex") == Path.home() / ".codex"
    assert config.machine_home_moved("claude") is None
    builtin = acct.default_accounts()[0]
    assert "CLAUDE_CONFIG_DIR" not in builtin.env()
    assert acct.keychain_service(builtin) == acct.KEYCHAIN_SERVICE


def test_a_named_folder_is_where_the_builtin_account_lives(monkeypatch, tmp_path):
    hers = tmp_path / "hers" / ".claude"
    monkeypatch.setenv("DIVAN_CLAUDE_HOME", str(hers))
    monkeypatch.setenv("DIVAN_CODEX_HOME", str(tmp_path / "hers" / ".codex"))
    where = str(hers.resolve())
    claude, codex = acct.default_accounts()
    assert claude.home is None                      # still the built-in one
    assert claude.env()["CLAUDE_CONFIG_DIR"] == where
    assert codex.env()["CODEX_HOME"] == str((tmp_path / "hers" / ".codex").resolve())
    assert acct._cred_path(claude) == hers / ".credentials.json"
    # never the first person's keychain item: forgetting hers must not sign him out
    assert acct.keychain_service(claude) == (
        acct.KEYCHAIN_SERVICE + "-" + hashlib.sha256(where.encode()).hexdigest()[:8])


def test_an_added_account_shares_her_folder_not_his(monkeypatch, tmp_path):
    hers = tmp_path / "hers" / ".claude"
    (hers / "skills").mkdir(parents=True)
    (hers / "CLAUDE.md").write_text("hers")
    monkeypatch.setenv("DIVAN_CLAUDE_HOME", str(hers))
    home = tmp_path / "accounts" / "claude-abc123"
    home.mkdir(parents=True)
    acct._link_shared("claude", home)
    assert (home / "CLAUDE.md").resolve() == (hers / "CLAUDE.md").resolve()
    assert (home / "skills").resolve() == (hers / "skills").resolve()
    assert (hers / "agents", "user") in agents._dirs(str(home), None)


def test_her_own_folder_is_not_linked_to_itself(monkeypatch, tmp_path):
    hers = tmp_path / ".claude"
    hers.mkdir()
    monkeypatch.setattr(acct.claude_memory, "default_claude_home", lambda: hers)
    called = []
    monkeypatch.setattr(acct.claude_memory, "link_project", lambda *a, **k: called.append(a))
    acct.share_memory(str(hers), str(tmp_path))
    assert called == []
    acct.share_memory(str(tmp_path / "other"), str(tmp_path))
    assert len(called) == 1
