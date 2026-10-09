#!/usr/bin/env python3
"""A chat is renamed after what it is about, at a few points, and never over a person.

    python scripts/test_naming.py

The model is not called here: what is checked is when it would be asked, what
it would be shown, and what is made of its answer.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import naming                                # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def user(text: str) -> dict:
    return {"event": "message.user", "data": {"text": text}}


def reply(text: str) -> dict:
    return {"event": "message.assistant", "data": {"text": text}}


# ── when the name is looked at ───────────────────────────────────────────
check("after the first message", naming.due(1, 0), True)
check("not again on the second", naming.due(2, 1), False)
check("again on the third", naming.due(3, 1), True)
check("a checkpoint passed while nothing was asked still counts", naming.due(7, 3), True)
check("past the last checkpoint the name is settled", naming.due(400, 25), False)

# ── what the model is shown ──────────────────────────────────────────────
long = [user(f"message {i}") for i in range(1, 13)] + [reply("first"), reply("latest")]
shown = naming.brief(long, "test")
check("the title it has now is given", shown.splitlines()[0], "Current title: test")
check("a long chat is shown its opening and its latest messages, not its middle",
      [n for n in range(1, 13) if f"- message {n}\n" in shown + "\n"], [1, 2, 3, 8, 9, 10, 11, 12])
check("the project is named as the thing to leave out",
      "left out of the title: ledger" in naming.brief(long, "test", "ledger"), True)
check("only the latest reply is shown", ("latest" in shown, "first" in shown), (True, False))
check("a pasted wall is cut", len(naming.brief([user("x" * 5000)], "t")) < 600, True)

# ── what is made of its answer ───────────────────────────────────────────
check("a plain title", naming.parse("Grikoç tasarım eksikleri\n"), "Grikoç tasarım eksikleri")
check("quotes and the full stop go", naming.parse('"Fix the login redirect."'), "Fix the login redirect")
check("unclear is no title", naming.parse("UNCLEAR"), None)
check("a paragraph is no title", naming.parse("I think this conversation is mostly about the login flow"), None)
check("nothing is no title", naming.parse("  \n"), None)

if fails:
    print("\n".join(fails))
    sys.exit(1)
print("ok")
