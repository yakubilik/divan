#!/usr/bin/env python3
"""A chat's task and what was done in it: what the model is shown, what is kept.

    python scripts/test_recap.py

The model is not called here.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import recap                                 # noqa: E402
from divan.db import DB                                 # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def user(text: str) -> dict:
    return {"event": "message.user", "data": {"text": text}}


def reply(text: str) -> dict:
    return {"event": "message.assistant", "data": {"text": text}}


# ── what the model is shown ──────────────────────────────────────────────
had = recap.Recap("Fix the login redirect", ["Found the loop in the callback"])
shown = recap.brief([user("it loops"), reply("one"), reply("two"), reply("three"), reply("four")], had)
check("the log so far is handed back",
      shown.splitlines()[:3], ["The log as it stands:", "TASK: Fix the login redirect",
                               "- Found the loop in the callback"])
check("only the latest replies are shown",
      [w for w in ("one", "two", "three", "four") if f"> {w}" in shown], ["two", "three", "four"])

# ── what is made of its answer ───────────────────────────────────────────
check("a task and its bullets",
      recap.parse("TASK: Proje sayfasını sadeleştir.\n- Sekmeler kaldırıldı\n* Sidebar eklendi\n"),
      recap.Recap("Proje sayfasını sadeleştir", ["Sekmeler kaldırıldı", "Sidebar eklendi"]))
check("a task with nothing done yet", recap.parse("TASK: Set up mail"), recap.Recap("Set up mail", []))
check("unclear is no log", recap.parse("UNCLEAR"), None)
check("prose is no log", recap.parse("This conversation is about mail."), None)
check("the list is capped",
      len(recap.parse("TASK: t\n" + "\n".join(f"- did {i}" for i in range(20))).done), recap.MAX_DONE)

# ── where it is kept ─────────────────────────────────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    db = DB(Path(tmp) / "t.db")
    chat = db.create_chat(title="t", provider="claude", model="opus", cwd=tmp)
    kept = db.recap_chat(chat["id"], "Set up mail", ["Added the DNS records", "Sent a test"])
    check("the chat carries its task", kept["task"], "Set up mail")
    check("…and what was done, a line each", recap.lines(kept["done"]), ["Added the DNS records", "Sent a test"])
    check("being summed up does not move the chat", kept["updated_at"], chat["updated_at"])

if fails:
    print("\n".join(fails))
    sys.exit(1)
print("ok")
