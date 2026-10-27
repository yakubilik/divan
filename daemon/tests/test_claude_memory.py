"""Every Claude account shares one memory per project folder.

    .venv/bin/python -m pytest -q tests/test_claude_memory.py

27 Oct 2026: each account's config dir kept its own projects/<folder>/memory,
so a chat that moved to another account, or a new account, knew nothing the
others had learned. Guarded here, all on temp folders:

  * starting a chat links the account's memory for that folder to
    ~/.claude/projects/<folder>/memory, on a new account and on one that had a
    real memory dir (which is merged in, never lost);
  * a file written through one account is read through another;
  * the one-off migration dedupes, keeps both of a conflict, unions MEMORY.md,
    backs up first, and changes nothing the second time;
  * folder names are Claude Code's own;
  * Codex accounts and transcripts are not touched.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import accounts, claude_memory as cm  # noqa: E402
from divan.providers.base import ProviderConfig  # noqa: E402
from divan.providers.claude import ClaudeProvider  # noqa: E402

DAEMON = Path(__file__).resolve().parents[1]
CWD = "/Users/someone/projects/my.app"
NAME = "-Users-someone-projects-my-app"


@pytest.fixture
def world(tmp_path, monkeypatch):
    claude = tmp_path / "claude"
    monkeypatch.setattr(cm, "default_claude_home", lambda: claude)
    monkeypatch.setattr(accounts, "ACCOUNTS_DIR", tmp_path / "accounts")
    monkeypatch.setattr(accounts, "CONFIG_DIR", tmp_path / "divan")
    return tmp_path


def _start_chat(home: str | None, cwd: str = CWD) -> dict:
    """What the daemon does right before the CLI is spawned for a chat."""
    cfg = ProviderConfig(model="sonnet", effort=None, perm_mode="ask", cwd=cwd,
                         session_id=None, account_home=home)
    p = ClaudeProvider.__new__(ClaudeProvider)
    p.cfg = cfg
    p._session_id = None
    return p._options().env


def _write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


# ── 1. starting a chat links the memory ──────────────────────────────────

def test_new_account_chat_links_memory(world):
    acc = accounts.new_account("claude", "New")
    env = _start_chat(acc.home)
    assert env["CLAUDE_CONFIG_DIR"] == acc.home
    mem = Path(acc.home) / "projects" / NAME / "memory"
    canon = world / "claude" / "projects" / NAME / "memory"
    assert mem.is_symlink() and canon.is_dir() and not canon.is_symlink()
    assert mem.resolve() == canon.resolve()


def test_new_account_links_every_known_project(world):
    _write(world / "claude/projects/-a/memory/x.md", "x")
    acc = accounts.new_account("claude", "New")
    assert (Path(acc.home) / "projects/-a/memory/x.md").read_text() == "x"


def test_existing_real_memory_dir_is_merged_then_linked(world):
    home = world / "accounts" / "claude-old"
    proj = home / "projects" / NAME
    _write(proj / "memory/a.md", "from old")
    _write(proj / "memory/MEMORY.md", "- [A](a.md) — a\n")
    _write(proj / "chat.jsonl", "{}\n")
    _start_chat(str(home))
    mem = proj / "memory"
    assert mem.is_symlink()
    canon = world / "claude/projects" / NAME / "memory"
    assert (canon / "a.md").read_text() == "from old"
    assert "- [A](a.md)" in (canon / "MEMORY.md").read_text()
    assert (proj / "chat.jsonl").read_text() == "{}\n"          # transcript untouched
    backups = list((world / "divan/rollback").glob("*.tar.gz"))
    assert len(backups) == 1
    with tarfile.open(backups[0]) as t:
        assert any(n.endswith("memory/a.md") for n in t.getnames())
    # a second chat changes nothing
    _start_chat(str(home))
    assert len(list((world / "divan/rollback").glob("*.tar.gz"))) == 1


def test_wrong_or_dangling_link_is_repointed(world):
    home = world / "accounts" / "claude-x"
    mem = home / "projects" / NAME / "memory"
    mem.parent.mkdir(parents=True)
    mem.symlink_to(world / "nowhere")
    _start_chat(str(home))
    assert mem.resolve() == (world / "claude/projects" / NAME / "memory").resolve()


def test_default_account_is_left_alone(world):
    env = _start_chat(None)
    assert "CLAUDE_CONFIG_DIR" not in env
    assert not (world / "claude/projects").exists()


# ── 2. one account writes, another reads ─────────────────────────────────

def test_memory_written_by_one_account_is_read_by_another(world):
    a = accounts.new_account("claude", "A")
    b = accounts.new_account("claude", "B")
    _start_chat(a.home)
    _start_chat(b.home)
    _write(Path(a.home) / "projects" / NAME / "memory/learned.md", "the build needs node 20")
    assert (Path(b.home) / "projects" / NAME / "memory/learned.md").read_text() == "the build needs node 20"
    # and the terminal's own ~/.claude sees it too
    assert (world / "claude/projects" / NAME / "memory/learned.md").exists()


# ── 3. the migration ─────────────────────────────────────────────────────

def _run(world: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-I", str(DAEMON / "scripts/share_claude_memory.py"),
         "--claude-home", str(world / "claude"),
         "--accounts", str(world / "accounts"),
         "--accounts", str(world / "old-accounts"),
         "--rollback", str(world / "divan/rollback"), *extra],
        capture_output=True, text=True, check=True)


def _snapshot(root: Path) -> dict:
    out = {}
    for p in sorted(root.rglob("*")):
        key = str(p.relative_to(root))
        if p.is_symlink():
            out[key] = ("link", os.readlink(p))
        elif p.is_file():
            out[key] = ("file", p.read_bytes())
        else:
            out[key] = ("dir",)
    return out


@pytest.fixture
def pool(world):
    acc = world / "accounts"
    canon = world / "claude/projects/-p/memory"
    _write(canon / "same.md", "same")
    _write(canon / "clash.md", "canonical version")
    _write(canon / "MEMORY.md", "- [Same](same.md) — s\n- [Clash](clash.md) — c\n")
    a = acc / "claude-aaa/projects/-p/memory"
    _write(a / "same.md", "same")
    _write(a / "clash.md", "aaa version")
    _write(a / "only-a.md", "a")
    _write(a / "MEMORY.md", "- [Same](same.md) — s\n- [Clash](clash.md) — c\n- [Only A](only-a.md) — a\n")
    b = acc / "claude-bbb/projects/-q/memory"            # no canonical yet
    _write(b / "q.md", "q")
    _write(b / "MEMORY.md", "- [Q](q.md) — q\n")
    _write(acc / "claude-bbb/projects/-q/t.jsonl", "transcript\n")
    _write(acc / "codex-ccc/projects/-p/memory/codex.md", "codex")
    _write(acc / "codex-ccc/auth.json", "{}")
    # the old home is a symlink to the new one: each account counted once
    (world / "old-accounts").symlink_to(acc)
    return world


def test_migration_dedupes_identical_files(pool):
    _run(pool)
    canon = pool / "claude/projects/-p/memory"
    assert (canon / "same.md").read_text() == "same"
    assert not list(canon.glob("same-*"))
    assert (canon / "only-a.md").read_text() == "a"
    assert (pool / "claude/projects/-q/memory/q.md").read_text() == "q"
    for acc, proj in (("claude-aaa", "-p"), ("claude-bbb", "-q")):
        mem = pool / "accounts" / acc / "projects" / proj / "memory"
        assert mem.is_symlink()
        assert mem.resolve() == (pool / "claude/projects" / proj / "memory").resolve()


def test_migration_keeps_both_of_a_conflict_and_lists_it(pool):
    out = _run(pool).stdout
    canon = pool / "claude/projects/-p/memory"
    assert (canon / "clash.md").read_text() == "canonical version"
    assert (canon / "clash-claude-aaa.md").read_text() == "aaa version"
    assert "clash.md -> clash-claude-aaa.md" in out


def test_migration_unions_memory_index(pool):
    _run(pool)
    lines = (pool / "claude/projects/-p/memory/MEMORY.md").read_text().splitlines()
    assert lines == ["- [Same](same.md) — s", "- [Clash](clash.md) — c",
                     "- [Clash](clash-claude-aaa.md) — c", "- [Only A](only-a.md) — a"]
    assert len(lines) == len(set(lines))


def test_migration_backs_up_first_and_second_run_changes_nothing(pool):
    out = _run(pool).stdout
    backups = list((pool / "divan/rollback").glob("claude-memory-*.tar.gz"))
    assert len(backups) == 1 and str(backups[0]) in out
    with tarfile.open(backups[0]) as t:
        names = set(t.getnames())
    assert "claude-aaa/projects/-p/memory/clash.md" in names
    assert "claude-bbb/projects/-q/memory/q.md" in names
    assert "canonical/projects/-p/memory/clash.md" in names     # shared side, before
    assert not any(n.endswith(".jsonl") for n in names)
    with tarfile.open(backups[0]) as t:
        assert t.extractfile("claude-aaa/projects/-p/memory/clash.md").read() == b"aaa version"

    before = _snapshot(pool)
    out2 = _run(pool).stdout
    assert "nothing to merge" in out2
    assert _snapshot(pool) == before


def test_dry_run_changes_nothing(pool):
    before = _snapshot(pool)
    out = _run(pool, "--dry-run").stdout
    assert "would merge claude-aaa / -p" in out
    assert _snapshot(pool) == before


def test_migration_leaves_codex_and_transcripts_alone(pool):
    _run(pool)
    codex = pool / "accounts/codex-ccc"
    assert not (codex / "projects/-p/memory").is_symlink()
    assert (codex / "projects/-p/memory/codex.md").read_text() == "codex"
    assert (codex / "auth.json").read_text() == "{}"
    assert not (pool / "claude/projects/-p/memory/codex.md").exists()
    assert (pool / "accounts/claude-bbb/projects/-q/t.jsonl").read_text() == "transcript\n"


# ── 4. Claude Code's own folder names ────────────────────────────────────

@pytest.mark.parametrize("cwd,name", [
    ("/Users/dilarakilic/projects/divan", "-Users-dilarakilic-projects-divan"),
    ("/Users/dilarakilic/projects/.ustabasi/wt/581-divan-every",
     "-Users-dilarakilic-projects--ustabasi-wt-581-divan-every"),
    ("/private/var/folders/xz/rj8h30t94h9bgmqhbw5p238r0000gn/T/divan-auth-probe-meh8v1b6",
     "-private-var-folders-xz-rj8h30t94h9bgmqhbw5p238r0000gn-T-divan-auth-probe-meh8v1b6"),
    ("/tmp/my_proj dir/çay", "-tmp-my-proj-dir--ay"),
])
def test_sanitize_matches_claude_code(cwd, name):
    assert cm.sanitize(cwd) == name


def test_sanitize_long_path_is_truncated_with_hash():
    cwd = "/" + "a" * 250
    s = cm.sanitize(cwd)
    assert s.startswith("-" + "a" * 199 + "-") and len(s) > 201
    # Claude Code: (h<<5)-h+charCode|0 over the path, then Math.abs(h).toString(36)
    h = 0
    for ch in cwd:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    h = h - (1 << 32) if h >= 1 << 31 else h
    n, digits = abs(h), ""
    while True:
        n, r = divmod(n, 36)
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + digits
        if not n:
            break
    assert s == "-" + "a" * 199 + "-" + digits


def test_sanitize_matches_live_account_folders():
    """Read-only: every folder name under the live accounts' projects/ is what
    sanitize() gives the cwd its transcripts record. Skipped off this Mac."""
    roots = [Path.home() / ".divan/accounts", Path.home() / ".claude"]
    checked = 0
    for root in roots:
        for proj in root.glob("*/projects/*") if root.name == "accounts" else root.glob("projects/*"):
            for jl in sorted(proj.glob("*.jsonl"))[:1]:
                with open(jl, encoding="utf-8", errors="replace") as f:
                    for line in f:
                        if '"cwd":"' in line:
                            cwd = line.split('"cwd":"', 1)[1].split('"', 1)[0]
                            assert cm.sanitize(cwd) == proj.name, (cwd, proj.name)
                            checked += 1
                            break
    if not checked:
        pytest.skip("no live account folders on this machine")


# ── 5. Codex accounts ────────────────────────────────────────────────────

def test_codex_account_is_untouched(world):
    acc = accounts.new_account("codex", "C")
    assert not (Path(acc.home) / "projects").exists()
    assert not (world / "claude/projects").exists()
