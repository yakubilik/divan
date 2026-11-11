#!/usr/bin/env python3
"""Merge every Claude account's memory into the one they all share.

    python3 daemon/scripts/share_claude_memory.py --dry-run    # say what it would do
    python3 daemon/scripts/share_claude_memory.py              # and do it

Before this, each account's config dir kept its own
`projects/<folder>/memory/`, so what one account learned the others never saw.
The shared place is `~/.claude/projects/<folder>/memory/` (Claude Code's own
default, so terminal sessions see it too). For every Claude account under the
accounts folders, every real memory folder is:

 1. tarred, together with the shared folder it is about to change, into one
    archive under ~/.divan/rollback/;
 2. merged into the shared folder: a file both have with the same content is
    kept once; the same name with other content keeps both, the account's copy
    renamed `<name>-<account id>.md` and listed below; MEMORY.md lines are
    unioned, each line once;
 3. replaced by a symlink to the shared folder.

Transcripts (`projects/<folder>/*.jsonl`), credentials and Codex accounts are
never touched. Once every account links, a second run finds nothing to merge
and changes nothing, not even a new backup. The daemon links new accounts and
new folders itself, so this is run once.

Every path is an argument, so it can be pointed at a copy (the test does).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import claude_memory, legacy  # noqa: E402  (standard library only)


def parse(argv: list[str] | None) -> argparse.Namespace:
    home = Path.home()
    ap = argparse.ArgumentParser(description="Merge every Claude account's memory into one shared place.")
    ap.add_argument("--claude-home", type=Path, default=home / ".claude",
                    help="the shared Claude config dir (default ~/.claude)")
    ap.add_argument("--accounts", type=Path, action="append",
                    help="a folder of account homes; repeatable "
                         f"(default ~/.divan/accounts and ~/{legacy.HOME_NAME}/accounts)")
    ap.add_argument("--rollback", type=Path, default=home / ".divan" / "rollback",
                    help="where the backup archive goes (default ~/.divan/rollback)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    a = ap.parse_args(argv)
    if not a.accounts:
        a.accounts = [home / ".divan" / "accounts", home / legacy.HOME_NAME / "accounts"]
    return a


def main(argv: list[str] | None = None) -> int:
    a = parse(argv)
    homes = claude_memory.claude_account_homes(a.accounts)
    report = claude_memory.migrate(homes, a.claude_home, a.rollback, dry_run=a.dry_run)
    if a.json:
        print(json.dumps(report, indent=2))
        return 0
    if not report["merged"]:
        print("nothing to merge: every account already shares one memory")
        return 0
    verb = "would merge" if a.dry_run else "merged"
    if report["backup"]:
        print(f"backup: {report['backup']}")
    for m in report["merged"]:
        print(f"{verb} {m['account']} / {m['project']}")
    if report["conflicts"]:
        print(f"\n{len(report['conflicts'])} file(s) differed and were kept under a second name:")
        for c in report["conflicts"]:
            print(f"  {c['project']}: {c['account']} {c['file']} -> {c['kept_as']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
