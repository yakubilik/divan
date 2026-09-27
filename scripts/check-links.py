#!/usr/bin/env python3
"""Every relative link in the documentation points at a file that exists.

    python3 scripts/check-links.py            # the documented set
    python3 scripts/check-links.py --all      # every tracked .md as well
    python3 scripts/check-links.py README.md  # just these

A README is read by people who have not cloned the repository, and a dead
`docs/screenshots/chat.png` is invisible until it renders as a broken image on
the front page of the project. Screenshots get renamed, docs get moved, and
nothing in git notices. This does.

What it checks: markdown links and images, and the `src`/`href` of inline HTML,
that point at a path inside the repository. What it skips, on purpose:

* `http://`, `https://`, `mailto:` and friends — checking those means going to
  the network, which makes a check that fails for reasons nobody caused;
* a bare `#anchor`, and the `#anchor` on a path that exists — GitHub's heading
  slugs are its own business and guessing them wrongly would fail a link that
  works;
* anything inside a code span or a fenced block. `docs/PROTOCOL.md` documents
  the attachment syntax by printing `![caption](/abs/path.png)`, which is an
  example of a path, not a path.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent

# The files the project promises are correct. docs/ is walked rather than
# listed: a new page under it is exactly the one nobody remembers to add here.
DEFAULT = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md",
           "PRIVACY.md", "NOTICE.md"]

# [text](target) and ![alt](target), with the optional "title" markdown allows.
MD = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
# <img src="…">, <a href="…">, either quote.
HTML = re.compile(r"""<(?:img|a|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']""",
                  re.I)

SKIP = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)   # scheme:… or //host

# Fenced blocks and code spans, blanked before anything is matched.
CODE = re.compile(r"^\s*(?:```|~~~).*?(?:^\s*(?:```|~~~).*?$|\Z)|`[^`\n]*`",
                  re.S | re.M)


def blank_code(text: str) -> str:
    """Code out, newlines kept, so the line numbers still mean something."""
    out = list(text)
    for m in CODE.finditer(text):
        for i in range(m.start(), m.end()):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)


def targets(text: str):
    """Every link in the file, with the line it is on."""
    text = blank_code(text)
    for pattern in (MD, HTML):
        for m in pattern.finditer(text):
            yield text.count("\n", 0, m.start()) + 1, m.group(1).strip()


def files(args: list[str]) -> list[Path]:
    if args and args != ["--all"]:
        return [Path(a) for a in args]
    docs = sorted(p.relative_to(ROOT) for p in (ROOT / "docs").rglob("*.md"))
    named = [Path(f) for f in DEFAULT if (ROOT / f).exists()]
    if args == ["--all"]:
        rest = sorted(p.relative_to(ROOT) for p in ROOT.rglob("*.md")
                      if "node_modules" not in p.parts and ".venv312" not in p.parts
                      and "webui" not in p.parts and ".git" not in p.parts)
        return sorted(set(named) | set(docs) | set(rest))
    return named + docs


def main() -> int:
    args = [a for a in sys.argv[1:]]
    checked = broken = 0
    for rel in files(args):
        path = ROOT / rel
        if not path.exists():
            print(f"{rel}: no such file")
            broken += 1
            continue
        for line, raw in targets(path.read_text(encoding="utf-8")):
            if not raw or raw.startswith("#") or SKIP.match(raw):
                continue
            target = unquote(raw.split("#", 1)[0].split("?", 1)[0])
            if not target:
                continue
            base = ROOT if target.startswith("/") else path.parent
            resolved = (base / target.lstrip("/")).resolve()
            checked += 1
            if not resolved.exists():
                print(f"{rel}:{line}: {raw} -> {resolved.relative_to(ROOT) if ROOT in resolved.parents else resolved} does not exist")
                broken += 1
    print(f"{checked} link{'' if checked == 1 else 's'} in "
          f"{len(files(args))} file{'' if len(files(args)) == 1 else 's'}, "
          f"{broken} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
