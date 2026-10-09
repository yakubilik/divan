#!/usr/bin/env python3
"""A chat is filed under the product its agent has been working in.

    python scripts/test_filing.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.db import DB                                 # noqa: E402
from divan.errors import Err                            # noqa: E402
from divan.filing import matcher, pick                  # noqa: E402
from divan.server import Server                         # noqa: E402

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
check("running another repo's interpreter or node binary is no vote for it",
      [found(call(command=f"{ROOT}/queue/.venv/bin/python /tmp/mail.py")),
       found(call(command="~/projects/queue/.venv312/bin/python -m x")),
       found(call(command=f"{ROOT}/queue/venv/bin/pip list")),
       found(call(command=f"{ROOT}/queue/node_modules/.bin/tsc -p /tmp/y"))], [set()] * 4)
check("…while a real path inside the repo, or the repo itself, still is",
      [found(call(file_path=f"{ROOT}/queue/src/a.py")), found(call(command=f"cd {ROOT}/queue && ls")),
       found(call(command=f"{ROOT}/queue/.venv/bin/python {ROOT}/queue/docs/x.py"))],
      [{"queue"}] * 3)
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

    # A chat is filed once. Work on another product later does not move it.
    site = db.divan.create_project("Site", repos=[f"{tmp}/site"])

    def work_in(cid: str, repo: str) -> None:
        for _ in range(3):
            db.append_event(cid, "tool.use", {"tool": "Edit", "input": {"file_path": f"{tmp}/{repo}/x.py"}})
        db.file_chat(cid)

    work_in(chat["id"], "site")
    check("a chat that has a product keeps it when a turn works in another",
          db.get_chat(chat["id"])["project_id"], shop["id"])

    loose = db.create_chat(title="loose", cwd=tmp)
    check("a chat opened outside every product has none yet", db.get_chat(loose["id"])["project_id"], "")
    work_in(loose["id"], "site")
    check("…and is filed by its first turn that works in one", db.get_chat(loose["id"])["project_id"], site["id"])

    # By hand, through the real chat.update handler.
    sent: list[dict] = []

    class Host:
        pass

    host = Host()
    host.db = db
    host.sessions = type("S", (), {"peek": staticmethod(lambda _cid: None)})()
    host.broadcast = lambda ev: (sent.append(ev), asyncio.sleep(0))[1]

    async def update(cid: str, **fields):
        return await Server.h_chat_update(host, None, {"chat_id": cid, **fields})

    moved = asyncio.run(update(chat["id"], project_id=site["id"]))
    check("chat.update files a chat under the product it is given",
          (moved["project_id"], moved["project"]), (site["id"], "Site"))
    check("…and says so to every device",
          [(e["event"], e["data"]["project_id"]) for e in sent], [("chat.updated", site["id"])])
    work_in(chat["id"], "shop")
    check("…and later work elsewhere does not move it back", db.get_chat(chat["id"])["project_id"], site["id"])

    try:
        asyncio.run(update(chat["id"], project_id="nope"))
        check("an unknown product is refused", "accepted", "Err")
    except Err as e:
        check("an unknown product is refused", e.code, "no_project")
    check("…and leaves the chat where it was", db.get_chat(chat["id"])["project_id"], site["id"])

    asyncio.run(update(chat["id"], project_id=None))
    work_in(chat["id"], "shop")
    check("a chat put under Unfiled by hand stays there through work on a product",
          db.get_chat(chat["id"])["project_id"], "")
    check("…and a restart's filing pass does not touch it either",
          DB(Path(tmp) / "db.sqlite").get_chat(chat["id"])["project_id"], "")

    # What Daily sends: no product, set by hand — straight through set_project
    # on a chat the computer had filed, and as the '' the clients send.
    filed = db.create_chat(title="filed", cwd=tmp)
    work_in(filed["id"], "shop")
    db.set_project(filed["id"], None)
    work_in(filed["id"], "site")
    got = db.get_chat(filed["id"])
    check("after set_project(cid, None) later work does not refile the chat",
          (got["project_id"], got["project_set"]), ("", 1))
    asyncio.run(update(loose["id"], project_id="", group_id=None))
    work_in(loose["id"], "shop")
    got = db.get_chat(loose["id"])
    check("…nor after chat.update with project_id ''", (got["project_id"], got["project_set"]), ("", 1))

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — filing")
