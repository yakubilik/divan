"""Which product a chat is work on, read off what its agent touched.

The folder a chat was opened in does not say: most chats here start in the
folder that holds every project, and the conversation decides the rest. What
does say is the work — the files the agent read and wrote, the commands it ran
and where. Every one of those is a `tool.use` event with its input on it, and
the board already knows which folders each product owns (`project_repos`), so
a chat is filed under the product its recent tool calls were inside of most.

Recent, because a long chat moves: the one that fixed the site this morning and
is in the app now is an app chat. And a product's own command being *run* is
not work on that product — filing a ticket runs `ustabasi/bin/ustabasi` from
every chat there is, and none of them is about the queue.
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Callable, Iterable

# How many tool calls back a chat is read. Enough that one stray path does not
# move it, few enough that yesterday's subject does not outvote today's.
WINDOW = 300


def _flat(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").rstrip("/")


def matcher(repos: Iterable[tuple[str, str]], home: str | None = None) -> Callable[[str], set[str]]:
    """What finds the products a piece of text names a folder of.

    `repos` is (path, project id). A path is matched whole — `isghocam-seo` is
    not `isghocam` — and in both the forms an agent writes it: absolute, and
    from `~`. The longest path is tried first, so a product that owns both `x`
    and `x/api` is not shadowed by another that owns only `x`.
    """
    home = _flat(home if home is not None else str(Path.home()))
    forms: dict[str, str] = {}
    for path, pid in repos:
        path = _flat(path)
        if not path:
            continue
        forms[path] = pid
        if home and path.startswith(home + "/"):
            forms["~" + path[len(home):]] = pid
    if not forms:
        return lambda text: set()
    found = re.compile(
        "(" + "|".join(re.escape(f) for f in sorted(forms, key=len, reverse=True)) + ")"
        r"(?![\w.-])(?!/bin/)")
    return lambda text: {forms[m] for m in found.findall(str(text or "").replace("\\\\", "/"))}


def pick(inputs: Iterable[str], cwd: str, projects_in: Callable[[str], set[str]]) -> str:
    """The product a chat belongs to, or `''` when nothing claims it.

    `inputs` are its tool calls, newest first. Each votes once for every
    product it names, and the newest call breaks a tie. A chat that has run
    nothing yet is where it was opened.
    """
    votes: Counter[str] = Counter()
    for text in inputs:
        for pid in projects_in(text):
            votes[pid] += 1
    if votes:
        # Counter keeps first-seen order among equals, and first seen is newest.
        return votes.most_common(1)[0][0]
    return next(iter(projects_in(_flat(cwd))), "")
