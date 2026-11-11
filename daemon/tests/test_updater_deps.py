"""The updater installs dependencies with whatever this venv has, and does not
retry a commit that could not be installed.

Everything here runs against fake executables and local git repositories: no
network, no real pip or uv, and never the checkout the tests run from.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from divan import updater as upd

GIT = shutil.which("git")
pytestmark = pytest.mark.skipif(GIT is None or sys.platform == "win32",
                                reason="needs git and a POSIX shell")


def _script(path: Path, body: str) -> Path:
    path.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    path.chmod(0o755)
    return path


def _fake_python(bin_dir: Path, log: Path, pip: bool, install_rc: int = 0) -> Path:
    """A stand-in for the venv's interpreter that writes down every call.

    `-m pip --version` answers like a venv with or without pip; `-m pip install`
    exits with `install_rc`; anything else (the import smoke test) succeeds.
    """
    return _script(bin_dir / "python", f"""echo "python $*" >> "{log}"
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  {"" if pip else 'echo "No module named pip" >&2; exit 1'}
  if [ "$3" = "install" ]; then exit {install_rc}; fi
  exit 0
fi
exit 0
""")


def _fake_uv(bin_dir: Path, log: Path, rc: int = 0) -> Path:
    return _script(bin_dir / "uv", f'echo "uv $*" >> "{log}"\nexit {rc}\n')


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A PATH with git and a shell but no real uv, plus a log of fake calls."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    log.touch()
    path = os.pathsep.join([str(bin_dir), os.path.dirname(GIT), "/usr/bin", "/bin"])
    monkeypatch.setenv("PATH", path)
    if shutil.which("uv") is not None:
        pytest.skip("a real uv sits in a system directory; cannot test without it")
    for k, v in {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                 "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
                 "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}.items():
        monkeypatch.setenv(k, v)
    # The panel is somebody else's test; no npm build may start from here.
    monkeypatch.setattr(upd, "panel_needs_build", lambda panel: False)
    return SimpleNamespace(tmp=tmp_path, bin=bin_dir, log=log)


def _calls(log: Path, word: str) -> list[str]:
    return [l for l in log.read_text().splitlines() if word in l]


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run([GIT, *args], cwd=cwd, check=True, capture_output=True,
                          text=True).stdout.strip()


def _commit_dep(repo: Path, dep: str) -> str:
    (repo / "daemon" / "pyproject.toml").write_text(
        f'[project]\nname = "x"\ndependencies = ["{dep}"]\n', encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "-c", "commit.gpgsign=false", "commit", "-qm", f"deps: {dep}")
    _git(repo, "push", "-q", "origin", "HEAD:main")
    return _git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repos(env):
    """An origin, the checkout the updater runs in, and a second clone that
    pushes the commits it is to follow."""
    origin = env.tmp / "origin.git"
    _git(env.tmp, "init", "-q", "--bare", "-b", "main", str(origin))
    other = env.tmp / "other"
    _git(env.tmp, "clone", "-q", str(origin), str(other))
    _git(other, "checkout", "-q", "-b", "main")
    (other / "daemon").mkdir()
    start = _commit_dep(other, "a")
    work = env.tmp / "work"
    _git(env.tmp, "clone", "-q", "-b", "main", str(origin), str(work))
    return SimpleNamespace(origin=origin, other=other, work=work, start=start)


def _updater(work: Path, python: Path, announced: list) -> upd.Updater:
    async def announce(ev):
        announced.append(ev)
    u = upd.Updater(SimpleNamespace(auto_update=True), is_idle=lambda: True,
                    announce=announce, request_restart=lambda: None)
    u.root = work
    u.python = str(python)
    return u


# ── 1. which tool installs ───────────────────────────────────────────────────

def test_uv_installs_into_a_venv_without_pip(env, tmp_path):
    py = _fake_python(env.bin, env.log, pip=False)
    _fake_uv(env.bin, env.log)
    u = _updater(tmp_path, py, [])
    ok, _ = asyncio.run(u._install_deps())
    assert ok
    uv = _calls(env.log, "uv ")
    assert uv == [f"uv pip install --quiet --python {py} -e {tmp_path / 'daemon'}"]
    assert not _calls(env.log, "python -m pip install")


def test_pip_installs_when_present_and_uv_is_not(env, tmp_path):
    py = _fake_python(env.bin, env.log, pip=True)
    u = _updater(tmp_path, py, [])
    ok, _ = asyncio.run(u._install_deps())
    assert ok
    assert _calls(env.log, "pip install") == [
        f"python -m pip install --quiet -e {tmp_path / 'daemon'}"]
    assert not _calls(env.log, "uv ")


# ── 2. neither tool ─────────────────────────────────────────────────────────

def test_neither_tool_fails_the_update_and_rolls_back(env, repos):
    py = _fake_python(env.bin, env.log, pip=False)
    _commit_dep(repos.other, "b")
    u = _updater(repos.work, py, [])
    res = asyncio.run(u.apply())
    assert res["ok"] is False
    assert "pip" in res["error"] and "uv" in res["error"]
    assert _git(repos.work, "rev-parse", "HEAD") == repos.start
    assert _git(repos.work, "status", "--porcelain") == ""


# ── 3. a commit that would not install is not retried ────────────────────────

def test_a_failed_commit_is_held_until_origin_moves_or_someone_asks(env, repos):
    py = _fake_python(env.bin, env.log, pip=True, install_rc=1)
    bad = _commit_dep(repos.other, "b")
    announced: list = []
    u = _updater(repos.work, py, announced)

    async def go():
        await u.tick()
        await u.tick()
    asyncio.run(go())
    # Two passes over the same origin/main, one attempt.
    assert len(_calls(env.log, "pip install")) == 1
    assert _git(repos.work, "rev-parse", "HEAD") == repos.start
    assert "held on" in u.state["error"] and "dependency install failed" in u.state["error"]
    assert u.failed["sha"] == bad
    last = [e for e in announced if e["event"] == "update.available"][-1]
    assert last["error"] == u.state["error"]
    assert any("failed" in b for b in u.blockers())

    # A person asking is an attempt, held or not.
    async def by_hand():
        await u.check()
        return await u.apply()
    res = asyncio.run(by_hand())
    assert res["ok"] is False
    assert len(_calls(env.log, "pip install")) == 2

    # origin/main moves: the new commit gets its own attempt.
    _commit_dep(repos.other, "c")
    asyncio.run(u.tick())
    assert len(_calls(env.log, "pip install")) == 3


def test_a_good_commit_clears_the_hold(env, repos):
    py = _fake_python(env.bin, env.log, pip=True, install_rc=1)
    _commit_dep(repos.other, "b")
    u = _updater(repos.work, py, [])
    asyncio.run(u.tick())
    assert u.failed is not None
    # The machine gets fixed; the next commit installs and the hold is gone.
    _fake_python(env.bin, env.log, pip=True, install_rc=0)
    good = _commit_dep(repos.other, "c")
    asyncio.run(u.tick())
    assert u.failed is None
    assert u.state["error"] is None
    assert _git(repos.work, "rev-parse", "HEAD") == good
