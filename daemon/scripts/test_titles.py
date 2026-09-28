#!/usr/bin/env python3
"""Every chat title starts with the project it is about.

    python scripts/test_titles.py

A list of forty chats is read by scanning it, and "Fix the login redirect" is
the same sentence in four repositories. The folder is in the chat's settings,
which is not a place anybody looks while scanning — so the project goes in
front of the title, once, wherever a title is set: at creation, when the first
message names the chat, and when somebody renames it by hand.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat.security import PathPolicy                   # noqa: E402
from remote_ai_chat.session import (                             # noqa: E402
    NEW_CHAT_TITLE, TITLE_MAX, is_untitled, with_project,
)

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


root = Path(__file__).resolve().parents[2].parent          # the folder holding this repo
policy = PathPolicy([str(root)], [])
here = Path(__file__).resolve().parents[2]                 # …/remote-ai-chat
project = here.name

# ── which project a folder belongs to ────────────────────────────────────
check("the project folder itself", policy.project_for(str(here)), project)
check("a folder inside it", policy.project_for(str(here / "daemon" / "scripts")), project)
check("the root is not a project", policy.project_for(str(root)), None)
check("outside every root", policy.project_for("/"), None)
check("a folder that is not there", policy.project_for(str(here / "nope" / "deeper")), project)

# ── composing the title ──────────────────────────────────────────────────
check("plain title", with_project("Fix the login redirect", "aristo"),
      "aristo · Fix the login redirect")
check("already prefixed", with_project("aristo · Fix it", "aristo"), "aristo · Fix it")
check("prefixed in another case", with_project("Aristo · Fix it", "aristo"), "Aristo · Fix it")
check("no project to name", with_project("Fix it", None), "Fix it")
check("an empty title is still the placeholder", with_project("   ", "aristo"),
      f"aristo · {NEW_CHAT_TITLE}")
check("a long first line is cut, the project is not",
      with_project("x" * 200, "aristo"), "aristo · " + "x" * TITLE_MAX)
check("a project named like a sentence start",
      with_project("aristotle is not aristo", "aristo"), "aristo · aristotle is not aristo")

# ── what counts as still untitled ────────────────────────────────────────
check("bare placeholder", is_untitled(NEW_CHAT_TITLE), True)
check("prefixed placeholder", is_untitled(f"aristo · {NEW_CHAT_TITLE}"), True)
check("a real title", is_untitled("aristo · Fix the login redirect"), False)
check("a title that merely mentions it", is_untitled("New chat about the parser"), False)

# ── twice is the same as once ────────────────────────────────────────────
once = with_project("Fix it", "aristo")
check("idempotent", with_project(once, "aristo"), once)

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print(f"ok — project prefix, {project}")
