#!/usr/bin/env python3
"""scripts/migrate_to_divan.py, run against a home directory made for the test.

    .venv312/bin/python scripts/test_migrate_to_divan.py

Nothing here touches the real home, LaunchAgents or launchctl: every path the
script takes is an argument, and all of them point into a temporary folder.
"""
import hashlib
import os
import plistlib
import re
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "migrate_to_divan.py"
OLD_NAME = re.compile(r"remote[-_ ]?ai[-_ ]?chat|\bRAC_", re.IGNORECASE)
OLD_LABEL = "com.dilara.remote-ai-chat"

failures = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {'ok' if cond else 'x '}  {name}" + (f"\n    {detail}" if detail and not cond else ""))
    failures += not cond


def make_home(root: Path) -> Path:
    """An install from before the rename, the way install.sh leaves one."""
    home = root / "home"
    old = home / ".remote-ai-chat"
    (old / "logs").mkdir(parents=True)
    (old / "accounts" / "claude-1" / "projects").mkdir(parents=True)
    (old / "accounts" / "claude-1" / "projects" / "session.jsonl").write_text(f'{{"cwd":"{old}/uploads"}}\n')
    (old / "config.toml").write_text(
        f'port = 8790\nallowed_roots = ["{home}/projects"]\n'
        f'scrub_extra_paths = ["{old}/accounts/claude-1/memory"]\n')
    (old / "ustabasi-follow.json").write_text(f'{{"log": "{old}/logs/daemon.log"}}')
    (old / "db.sqlite").write_bytes(b"SQLite format 3\x00" + bytes(range(64)))
    agents = home / "Library" / "LaunchAgents"
    agents.mkdir(parents=True)
    with (agents / f"{OLD_LABEL}.plist").open("wb") as f:
        plistlib.dump({
            "Label": OLD_LABEL,
            "ProgramArguments": [f"{home}/projects/remote-ai-chat/daemon/.venv312/bin/remote-ai-chat", "serve"],
            "EnvironmentVariables": {"RAC_HOME": str(old), "HOME": str(home)},
            "KeepAlive": True, "RunAtLoad": True,
            "StandardOutPath": f"{old}/logs/launchd.out.log",
            "StandardErrorPath": f"{old}/logs/launchd.err.log",
        }, f)
    return home


def snapshot(root: Path) -> dict[str, str]:
    """Every path under `root` and what is at it, links not followed."""
    seen = {}
    for dirpath, dirs, files in os.walk(root):
        for name in dirs + files:
            p = Path(dirpath) / name
            rel = str(p.relative_to(root))
            if p.is_symlink():
                seen[rel] = "link:" + os.readlink(p)
            elif p.is_dir():
                seen[rel] = "dir"
            else:
                seen[rel] = hashlib.sha256(p.read_bytes()).hexdigest() + f":{p.stat().st_mtime_ns}"
    return seen


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def migrate(home: Path, port: int, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--home", str(home), "--port", str(port),
         "--daemon-dir", str(home / "projects" / "divan" / "daemon"), *extra],
        capture_output=True, text=True)


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp).resolve()
    home = make_home(root)
    old, new = home / ".remote-ai-chat", home / ".divan"
    agents = home / "Library" / "LaunchAgents"
    before = snapshot(root)

    print("the port is in use")
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        r = migrate(home, busy.getsockname()[1])
    ok("it exits non-zero and says why", r.returncode != 0 and "listening" in r.stderr, r.stdout + r.stderr)
    ok("and touches nothing", snapshot(root) == before)

    print("--dry-run")
    port = free_port()
    r = migrate(home, port, "--dry-run")
    ok("it exits 0", r.returncode == 0, r.stdout + r.stderr)
    ok("it names every step", all(s in r.stdout for s in (
        f"move {old} -> {new}", f"link {old} -> {new}", "config.toml", "com.yakup.divan.plist")), r.stdout)
    ok("and changes nothing on disk", snapshot(root) == before)

    print("a real run")
    r = migrate(home, port)
    ok("it exits 0", r.returncode == 0, r.stdout + r.stderr)
    ok("the folder is at the new home, with what was in it",
       new.is_dir() and not new.is_symlink()
       and (new / "db.sqlite").read_bytes() == b"SQLite format 3\x00" + bytes(range(64)))
    ok("the old path is a symlink to the new home",
       old.is_symlink() and Path(os.readlink(old)) == new)
    ok("a path recorded under the old home still resolves",
       (old / "accounts" / "claude-1" / "projects" / "session.jsonl").is_file())
    config = (new / "config.toml").read_text()
    ok("config.toml names the new home and no longer the old one",
       f'"{new}/accounts/claude-1/memory"' in config and str(old) not in config
       and f'"{home}/projects"' in config, config)
    ok("another text config beside it is rewritten too",
       (new / "ustabasi-follow.json").read_text() == f'{{"log": "{new}/logs/daemon.log"}}')
    ok("a session record is left as it was written",
       (new / "accounts" / "claude-1" / "projects" / "session.jsonl").read_text() == f'{{"cwd":"{old}/uploads"}}\n')

    target = agents / "com.yakup.divan.plist"
    plist = plistlib.loads(target.read_bytes()) if target.exists() else {}
    ok("the plist is written under the new label", plist.get("Label") == "com.yakup.divan", str(plist))
    paths = [*plist.get("ProgramArguments", ["remote-ai-chat"]),
             plist.get("StandardOutPath", "remote-ai-chat"), plist.get("StandardErrorPath", "remote-ai-chat")]
    ok("its program and log paths carry no old name",
       not any(OLD_NAME.search(p) for p in paths)
       and paths == [f"{home}/projects/divan/daemon/.venv312/bin/divan", "serve",
                     f"{new}/logs/launchd.out.log", f"{new}/logs/launchd.err.log"], str(paths))
    ok("its environment is renamed with it, and the rest is kept",
       plist.get("EnvironmentVariables") == {"DIVAN_HOME": str(new), "HOME": str(home)}
       and plist.get("KeepAlive") is True, str(plist))
    ok("the old plist is set aside, where launchd will not load it",
       sorted(p.name for p in agents.iterdir()) == [f"{OLD_LABEL}.plist.migrated", "com.yakup.divan.plist"])
    ok("the launchctl commands are printed, not run",
       f"launchctl bootout gui/{os.getuid()}/{OLD_LABEL}" in r.stdout
       and f"launchctl bootstrap gui/{os.getuid()} {target}" in r.stdout, r.stdout)

    print("a second run")
    after = snapshot(root)
    r = migrate(home, port)
    ok("it exits 0 and says there is nothing to do", r.returncode == 0 and "Nothing to do" in r.stdout,
       r.stdout + r.stderr)
    ok("and changes nothing", snapshot(root) == after)

print("\nall good" if not failures else f"\n{failures} failed")
sys.exit(1 if failures else 0)
