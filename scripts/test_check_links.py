#!/usr/bin/env python3
"""`check-links.py` fails when a link is dead, and says where.

    python3 scripts/test_check_links.py

A checker that exits 0 on everything is worse than no checker: it is a green
tick that means nothing, and the broken image on the front page stays there.
So the thing under test here is mostly the failure — a real README with one bad
path appended has to come back with exit 1, the line the path is on, and the
path itself — and after that the exemptions, because a checker that fails on
`https://…` or on a path printed inside a code fence gets turned off within a
week.

The README is tested by copying it into a shadow root: a directory of symlinks
to everything in the repository, with the copy standing in for `README.md`.
Relative links then resolve exactly as the real ones do, and nothing is written
inside the working tree.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKER = ROOT / "check-links.py" if (ROOT / "check-links.py").exists() \
    else ROOT / "scripts" / "check-links.py"

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def contains(what: str, haystack: str, needle: str) -> None:
    if needle not in haystack:
        fails.append(f"{what}\n    looked for: {needle!r}\n    in:\n{haystack}")


def run(*args: str) -> tuple[int, str]:
    """The checker as a user runs it: a process, an exit code, its output."""
    p = subprocess.run([sys.executable, str(CHECKER), *args],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def shadow_root(tmp: Path) -> Path:
    """A directory that looks like the repository, made of symlinks."""
    root = tmp / "shadow"
    root.mkdir()
    for entry in ROOT.iterdir():
        if entry.name == ".git":
            continue
        os.symlink(entry, root / entry.name)
    return root


tmp = Path(tempfile.mkdtemp(prefix="check-links-test-"))
try:
    # ── the real README, unchanged, in a place that resolves the same ─────
    root = shadow_root(tmp)
    (root / "README.md").unlink()
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    copy = root / "README.md"
    copy.write_text(readme, encoding="utf-8")

    code, out = run(str(copy))
    check("the README as it stands passes", code, 0)
    contains("and says how many links it looked at", out, "links in 1 file, 0 broken")

    # ── the same README with one dead path ───────────────────────────────
    # After a fenced block, because the line number has to survive the
    # blanking that keeps code out of the search.
    broken = readme + (
        "\n\n```bash\n"
        "# not a link: ![x](docs/screenshots/also-nope.png)\n"
        "```\n"
        "\n[x](docs/screenshots/nope.png)\n"
    )
    copy.write_text(broken, encoding="utf-8")
    line = broken.rstrip("\n").count("\n") + 1          # the last line

    code, out = run(str(copy))
    check("one dead path fails the file", code, 1)
    contains("the file and the line are in the message", out, f"{copy}:{line}:")
    contains("so is the path as written", out, "docs/screenshots/nope.png")
    contains("and the count", out, "1 broken")
    check("the fenced path is not counted as broken",
          out.count("also-nope.png"), 0)

    # ── a file named on the command line that is not there ───────────────
    code, out = run("docs/no-such-page.md")
    check("a missing file fails", code, 1)
    contains("and is named", out, "docs/no-such-page.md: no such file")

    # ── what is skipped on purpose, and what is not ──────────────────────
    (tmp / "there.png").write_bytes(b"")
    exempt = tmp / "exempt.md"
    exempt.write_text(
        "[web](https://example.com/missing.png)\n"
        "[mail](mailto:nobody@example.com)\n"
        "[protocol relative](//example.com/x.png)\n"
        "[anchor](#a-heading)\n"
        "[anchor on a file that exists](there.png#top)\n"
        "[query on a file that exists](there.png?v=2)\n"
        "`![inline](docs/screenshots/nope.png)`\n"
        "\n```\n![fenced](docs/screenshots/nope.png)\n```\n"
        '<img src="there.png" alt="html is checked too">\n'
        '<a href="there.png">so is an anchor tag</a>\n',
        encoding="utf-8")
    code, out = run(str(exempt))
    check("nothing in the exempt set fails", code, 0)
    contains("the four real paths were the ones counted", out, "4 links in 1 file")

    # ── html is checked, not skipped ─────────────────────────────────────
    html = tmp / "html.md"
    html.write_text('<img src="gone.png" width="300">\n', encoding="utf-8")
    code, out = run(str(html))
    check("a dead <img src> fails", code, 1)
    contains("and is named", out, "gone.png")

    # ── an absolute path is repository-relative, not filesystem-absolute ──
    abs_md = tmp / "abs.md"
    abs_md.write_text("[license](/LICENSE)\n[gone](/no-such-file)\n", encoding="utf-8")
    code, out = run(str(abs_md))
    check("a leading slash means the repository root", code, 1)
    contains("the one that is not there is named", out, "/no-such-file")
    check("the one that is there is not", out.count("LICENSE"), 0)

    # ── the check the project actually promises ──────────────────────────
    code, out = run()
    check("the documented set passes", code, 0)
    contains("and the tail says so", out, "0 broken")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — check-links reports dead paths and exempts what it should")
