#!/usr/bin/env python3
"""Cut a release.

    python scripts/release.py patch          # 0.2.1 -> 0.2.2
    python scripts/release.py minor          # 0.2.1 -> 0.3.0
    python scripts/release.py 1.0.0          # say it outright
    python scripts/release.py patch --dry-run

The tag is the version. Everything else is a copy of it, and the only reason
the copies exist is that a wheel installed from PyPI has no git to ask — so
they are written here, in one commit, and the release workflow refuses a tag
whose copies disagree with it. That check is the whole point: `__version__`
said 0.1.0 on two computers that were weeks apart, and a number nothing
verifies is a number nobody raises.

What this does not do is push. A tag is the one action in this repository that
other people's computers act on, so the last step stays a human's.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Every place the number is written down, and the line that carries it.
COPIES: list[tuple[Path, re.Pattern[str], str]] = [
    (ROOT / "daemon" / "pyproject.toml",
     re.compile(r'^version = "[^"]*"$', re.M), 'version = "{v}"'),
    (ROOT / "daemon" / "remote_ai_chat" / "__init__.py",
     re.compile(r'^__version__ = "[^"]*"$', re.M), '__version__ = "{v}"'),
    (ROOT / "web" / "package.json",
     re.compile(r'^  "version": "[^"]*",$', re.M), '  "version": "{v}",'),
]

CHANGELOG = ROOT / "CHANGELOG.md"
MARKER = "<!-- releases -->"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"git {' '.join(args)}: {(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def last_tag() -> str | None:
    """The newest release tag, or None before there has ever been one."""
    tags = [t for t in git("tag", "--list", "v*").splitlines() if SEMVER.match(t[1:])]
    if not tags:
        return None
    return max(tags, key=lambda t: tuple(int(p) for p in t[1:].split(".")))


def current(tag: str | None) -> str:
    """What to count up from.

    Before there has ever been a tag, the packaged constant stands in — not
    0.0.0. The repository already claimed 0.1.0 in three files before any of
    this existed, and counting up from zero would make the first release a
    number smaller than the one it replaces.
    """
    if tag:
        return tag[1:]
    init = (ROOT / "daemon" / "remote_ai_chat" / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'^__version__ = "(\d+\.\d+\.\d+)"$', init, re.M)
    return m.group(1) if m else "0.0.0"


def bump(version: str, part: str) -> str:
    major, minor, patch = (int(p) for p in version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def notes(tag: str | None) -> list[str]:
    """One line per commit since the last release, in the order they landed.

    The commit subjects are the notes. That is not laziness — this project asks
    for subjects that say what is now true that was not true before, which is
    the same sentence a changelog entry wants.
    """
    span = f"{tag}..HEAD" if tag else "HEAD"
    lines = git("log", "--reverse", "--no-merges", "--format=%s", span).splitlines()
    return [ln.strip() for ln in lines if ln.strip()]


def rewrite(version: str, dry: bool) -> None:
    for path, pattern, template in COPIES:
        text = path.read_text(encoding="utf-8")
        new, n = pattern.subn(template.format(v=version), text, count=1)
        if n != 1:
            sys.exit(f"{path.relative_to(ROOT)}: could not find the version line to rewrite")
        print(f"  {path.relative_to(ROOT)} -> {version}")
        if not dry:
            path.write_text(new, encoding="utf-8")


def prepend_changelog(version: str, lines: list[str], dry: bool) -> None:
    """Newest entry straight under the marker, so nothing has to be parsed.

    The release workflow reads this file back to find the notes for a tag, and
    a format held together by counting blank lines is a format that breaks the
    first time somebody edits the preamble.
    """
    entry = [f"## v{version} — {date.today().isoformat()}", ""]
    entry += [f"- {ln}" for ln in lines] if lines else ["- No changes recorded."]
    body = CHANGELOG.read_text(encoding="utf-8")
    if MARKER not in body:
        sys.exit(f"CHANGELOG.md has no {MARKER} line to insert under")
    new = body.replace(MARKER, MARKER + "\n\n" + "\n".join(entry), 1)
    print(f"  CHANGELOG.md -> {len(lines)} entr{'y' if len(lines) == 1 else 'ies'}")
    if not dry:
        CHANGELOG.write_text(new, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", help="major | minor | patch, or an explicit 1.2.3")
    ap.add_argument("--dry-run", action="store_true", help="say what would happen, change nothing")
    ap.add_argument("--allow-branch", default="main", help="branch releases may be cut from")
    a = ap.parse_args()

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch != a.allow_branch:
        sys.exit(f"on {branch}, not {a.allow_branch} — a release is cut from the branch "
                 f"every computer follows, or it is a release nobody gets")
    if git("status", "--porcelain"):
        sys.exit("uncommitted changes — a release has to be a commit anyone can check out")

    tag = last_tag()
    previous = current(tag)
    version = a.version if SEMVER.match(a.version) else None
    if version is None:
        if a.version not in ("major", "minor", "patch"):
            sys.exit(f"{a.version!r} is neither major/minor/patch nor a version like 1.2.3")
        version = bump(previous, a.version)
    if f"v{version}" in git("tag", "--list", f"v{version}").splitlines():
        sys.exit(f"v{version} already exists")

    lines = notes(tag)
    print(f"v{previous} -> v{version}   ({len(lines)} commit{'' if len(lines) == 1 else 's'})\n")
    for ln in lines:
        print(f"  · {ln}")
    print()
    rewrite(version, a.dry_run)
    prepend_changelog(version, lines, a.dry_run)

    if a.dry_run:
        print("\n(dry run — nothing written)")
        return

    git("add", "CHANGELOG.md", *[str(p.relative_to(ROOT)) for p, _, _ in COPIES])
    git("commit", "-m", f"Release v{version}")
    git("tag", "-a", f"v{version}", "-m", f"v{version}")
    print(f"\nCommitted and tagged v{version}. Pushing is yours to do:\n"
          f"\n    git push origin {branch} --follow-tags\n"
          f"\nThe tag is what builds the release; every daemon following "
          f"origin/{branch} picks the commit up on its own.")


if __name__ == "__main__":
    main()
