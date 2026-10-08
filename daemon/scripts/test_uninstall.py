#!/usr/bin/env python3
"""`divan uninstall` removes the service whichever way it was installed.

    .venv312/bin/python scripts/test_uninstall.py

`divan install` and `daemon/install.sh` register one launchd label; an
install from before the rename sits under one of two older ones
(`divan/legacy.py`). Uninstall has to find any of them. Nothing here calls
launchctl: the runner is a stub and the home directory is a temporary one.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import legacy  # noqa: E402
from divan.__main__ import PLIST_LABEL, _uninstall_launchd  # noqa: E402

failures = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {'ok' if cond else 'x '}  {name}" + (f"\n    {detail}" if detail and not cond else ""))
    failures += not cond


def run_with(labels: list[str]) -> tuple[list[str], list[list[str]], list[str]]:
    calls: list[list[str]] = []
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        agents = home / "Library" / "LaunchAgents"
        agents.mkdir(parents=True)
        for label in labels:
            (agents / f"{label}.plist").write_text("<plist/>")
        removed = _uninstall_launchd(home, "501", "ada", lambda cmd, **kw: calls.append(cmd))
        left = sorted(p.name for p in agents.iterdir())
    return removed, calls, left


SCRIPT = legacy.plist_labels("ada")[1]

removed, calls, left = run_with([SCRIPT])
ok("a plist from before the rename is booted out and deleted",
   removed == [SCRIPT] and calls == [["launchctl", "bootout", f"gui/501/{SCRIPT}"]] and not left,
   f"{removed} {calls} {left}")

removed, calls, left = run_with([PLIST_LABEL])
ok("a plist from `divan install` is booted out and deleted",
   removed == [PLIST_LABEL] and calls == [["launchctl", "bootout", f"gui/501/{PLIST_LABEL}"]] and not left,
   f"{removed} {calls} {left}")

removed, calls, left = run_with([PLIST_LABEL, SCRIPT, "com.other.thing"])
ok("both at once go, and nothing else in LaunchAgents does",
   sorted(removed) == sorted([PLIST_LABEL, SCRIPT]) and left == ["com.other.thing.plist"],
   f"{removed} {left}")

removed, calls, left = run_with([])
ok("with nothing installed, launchctl is not called", removed == [] and calls == [])

print("\nall good" if not failures else f"\n{failures} failed")
sys.exit(1 if failures else 0)
