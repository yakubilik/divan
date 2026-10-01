#!/usr/bin/env python3
"""A chat is filed under the product its agent has been working in.

    python scripts/test_filing.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat.db import DB                                 # noqa: E402
from remote_ai_chat.filing import matcher, pick                  # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


HOME = "/Users/x"
ROOT = f"{HOME}/projects"
found = matcher([(f"{ROOT}/site", "site"), (f"{ROOT}/site-seo", "seo"),
                 (f"{ROOT}/shop", "shop"), (f"{ROOT}/shop/api", "shop"),
                 (f"{ROOT}/queue", "queue")], HOME)


def call(**inp) -> str:
    return json.dumps({"tool": "Bash", "input": inp})


check("the work decides, not the folder the chat was opened in",
      pick([call(file_path=f"{ROOT}/shop/api/pay.ts"), call(command="cd ~/projects/shop && npm test"),
            call(file_path=f"{ROOT}/site/index.html")], ROOT, found), "shop")
check("a folder that only starts with a product's name is not that product",
      pick([call(command=f"ls {ROOT}/site-seo/notes")], ROOT, found), "seo")
check("running a product's own command is not work on it",
      pick([call(command="~/projects/queue/bin/queue add --json /tmp/t.json"),
            call(command=f"{ROOT}/queue/bin/queue ls"), call(file_path=f"{ROOT}/site/a.css")],
           ROOT, found), "site")
check("the newest call breaks a tie",
      pick([call(file_path=f"{ROOT}/site/a"), call(file_path=f"{ROOT}/shop/b")], ROOT, found), "site")
check("a chat that has run nothing is where it was opened",
      pick([], f"{ROOT}/shop/api", found), "shop")
check("…and nowhere, when that is no product's folder", pick([], ROOT, found), "")

with tempfile.TemporaryDirectory() as tmp:
    db = DB(Path(tmp) / "db.sqlite")
    shop = db.divan.create_project("Shop", repos=[f"{tmp}/shop"])
    chat = db.create_chat(title="t", cwd=tmp)
    db.append_event(chat["id"], "tool.use", {"tool": "Read", "input": {"file_path": f"{tmp}/shop/a.py"}})
    before = db.get_chat(chat["id"])["updated_at"]
    db.file_chat(chat["id"])
    listed = db.list_chats()[0]
    check("a filed chat is listed with its product's name",
          (listed["project_id"], listed["project"]), (shop["id"], "Shop"))
    check("…and filing it is not the chat moving", listed["updated_at"], before)

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — filing")
