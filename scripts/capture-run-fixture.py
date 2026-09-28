#!/usr/bin/env python3
"""Copy a real ustabasi run log into the fixture both sides are checked against.

    python3 scripts/capture-run-fixture.py <run_dir>/stdout.log

The daemon hands a run's log out a page at a time and the app turns those pages
into chat turns, and both are checked against the same recording rather than
against a log written by hand: a log written by hand agrees with the reader by
construction, and the shapes that break a reader — a thinking block with no
words in it, a tool result the size of a file, the odd line that is not JSON at
all — are exactly the ones nobody would think to write.

What this does to the recording, and why:

  * every `/Users/<somebody>` and `/home/<somebody>` becomes `/Users/you`, and
    so does the same path written as a dash-joined slug, `-Users-<somebody>-`.
    A run log is full of absolute paths and every one of them is a person's home
    directory. `scripts/audit.py` fails on both forms, which is what it is for —
    though it only learned the second one after a fixture went out with one in
    it, the scrubber and the audit sharing a blind spot between them.
  * the run of identical `thinking_tokens` lines in the middle is cut to a few
    of each. They are two hundred bytes each, there are hundreds of them, and
    what they are checked for is that the reader drops them — three prove that
    as well as three hundred.
  * a thinking block keeps its words and loses its signature, which is five
    kilobytes of base64 proving the block came from the model and is of no
    interest to anything reading it. (In every run recorded so far the words
    are empty and the signature is the whole block, which is itself worth a
    reader being tested against.)
  * a tool result is cut to a few thousand characters, and the `tool_use_result`
    sidecar the CLI writes next to it — the same answer again, structured — is
    dropped. Most results are a whole file read back, and a fixture is not a
    place to keep a second copy of the repository, let alone two. What is left
    is still several times what a reader is allowed to send on, which is the
    thing being checked.

Nothing else is rewritten. What is left is still what the model actually said.

Re-run it if the stream's shape changes; `app/scripts/fixtures/README.md` says
which run the committed one came from.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

#: How many of a repeated noise line to keep. Enough that a reader has to drop
#: a run of them rather than one.
KEEP_NOISE = 3

#: How much of a tool result to keep — comfortably more than the daemon will
#: hand on, so that its own cut is the one under test.
KEEP_RESULT = 4000

HOME = re.compile(r"/(?:Users|home)/[A-Za-z0-9._-]+")

#: The same home directory with its slashes turned into dashes. The CLI keys a
#: project's own directory by the path it belongs to, written as one slug —
#: `.../projects/-Users-<name>-projects-thing/memory` — and `HOME` above, anchored
#: on slashes, walks straight past it. It is the same person's name, and the
#: first cut of this fixture went out with one in it. A slug's name segment ends
#: at the next dash, so the class here has no dash in it.
SLUG = re.compile(r"(?<![A-Za-z0-9])(-(?:Users|home)-)[A-Za-z0-9._]+")

OUT = Path(__file__).resolve().parents[1] / "app" / "scripts" / "fixtures" / "run.log"


def noise(line: str) -> bool:
    try:
        d = json.loads(line)
    except ValueError:
        return False
    return isinstance(d, dict) and d.get("type") == "system" and d.get("subtype") == "thinking_tokens"


def shrink(line: str) -> str:
    """One line, cut to something a repository can carry."""
    try:
        d = json.loads(line)
    except ValueError:
        return line
    if not isinstance(d, dict) or d.get("type") not in ("user", "assistant"):
        return line
    changed = d.pop("tool_use_result", None) is not None
    for b in (d.get("message") or {}).get("content") or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "thinking" and b.get("signature"):
            b["signature"] = ""
            changed = True
        body = b.get("content")
        if b.get("type") == "tool_result" and isinstance(body, str) and len(body) > KEEP_RESULT:
            b["content"] = body[:KEEP_RESULT]
            changed = True
    return json.dumps(d) if changed else line


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip().split("\n\n")[1].strip())
        return 2
    src = Path(sys.argv[1]).expanduser()
    lines = [l for l in src.read_text("utf-8", "replace").split("\n") if l.strip()]

    kept: list[str] = []
    run = 0
    for line in lines:
        if noise(line):
            run += 1
            if run > KEEP_NOISE:
                continue
        else:
            run = 0
        kept.append(SLUG.sub(r"\1you", HOME.sub("/Users/you", shrink(line))))

    OUT.write_text("\n".join(kept) + "\n")
    print(f"{OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT}: "
          f"{len(kept)} of {len(lines)} lines, {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
