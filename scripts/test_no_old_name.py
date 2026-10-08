#!/usr/bin/env python3
"""The product is called Divan, and the repository says so everywhere.

    python3 scripts/test_no_old_name.py

Every tracked file is read for the name the product had before. It may appear
in exactly the places listed here, and each has a reason:

 · the history files, which say what was true when they were written;
 · the two legacy blocks, where the old name is still *recognised* — the
   daemon's `divan/legacy.py`, and the marked block in each pairing parser
   (the app's and the panel's are separate packages, so each has its own);
 · the migration script and its test, which exist to move an old install;
 · the placeholder bundle identifier in `app/app.json`, which is an identity
   and is not renamed with the product.

A new use of the old name anywhere else fails this, on purpose: add the
compatibility to a legacy block, or do not add it.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The second half is spelled in two pieces so that this line is not a hit for a
# plain grep of the same pattern.
OLD_NAME = re.compile(r"remote[-_ ]?ai[-_ ]?chat|\b" + "RAC" + "_", re.IGNORECASE)

HISTORY = ("CHANGELOG.md", "docs/audit/", "docs/night-watch/")
WHOLE_FILES = {
    "daemon/divan/legacy.py",
    "daemon/scripts/migrate_to_divan.py",
    "daemon/scripts/test_migrate_to_divan.py",
}
# Files that hold one marked block; only the lines between the markers are let off.
BLOCKS = {"app/src/pair.ts", "web/src/lib/actions.ts"}
BEGIN, END = "LEGACY NAME BLOCK: begin", "LEGACY NAME BLOCK: end"
# One line, by what it sets rather than what it says: the value is the identity.
LINES = {"app/app.json": '"bundleIdentifier":'}


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def hits(path: str, text: str) -> list[str]:
    found, inside, blocks = [], False, 0
    for n, line in enumerate(text.splitlines(), 1):
        if path in BLOCKS and BEGIN in line:
            inside, blocks = True, blocks + 1
            continue
        if path in BLOCKS and END in line:
            inside = False
            continue
        if inside or (path in LINES and line.strip().startswith(LINES[path])):
            continue
        if OLD_NAME.search(line):
            found.append(f"{path}:{n}: {line.strip()[:120]}")
    if path in BLOCKS and (blocks != 1 or inside):
        found.append(f"{path}: expected exactly one closed legacy block, found {blocks}")
    return found


def main() -> int:
    paths = tracked()
    found = [f"{p}: the path itself" for p in paths
             if OLD_NAME.search(p) and not p.startswith(HISTORY)]
    for path in paths:
        if path.startswith(HISTORY) or path in WHOLE_FILES:
            continue
        try:
            text = (ROOT / path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue                       # a picture, or a file deleted but not yet committed
        found += hits(path, text)
    missing = sorted(p for p in WHOLE_FILES | BLOCKS | set(LINES) if p not in paths)
    found += [f"{p}: on the allowlist but not in the repository" for p in missing]
    for line in found:
        print(f"  x   {line}")
    print(f"\n{len(found)} place(s) still carry the old name" if found
          else f"  ok  {len(paths)} tracked files, none carries the old name outside the allowlist")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
