#!/usr/bin/env python3
"""Write `fixtures/unfiled-ask-snapshot.json`: a `divan.snapshot` answer, made by
the daemon's own board code, holding a blocked ticket with a question that sits
in the holding place (its folder belongs to no product).

    daemon/.venv312/bin/python web/scripts/make-unfiled-ask-fixture.py

This is the shape the daemon sends today, so `test-asking-unfiled.mjs` reads it
rather than a hand-made card. Re-run it when `divan.py snapshot` changes.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
tmp = Path(tempfile.mkdtemp(prefix="divan-fixture-"))
os.environ["USTABASI_STATE_DIR"] = str(tmp / "queue")
sys.path.insert(0, str(root / "daemon"))

from divan import divan  # noqa: E402
from divan.db import DB  # noqa: E402

db = DB(tmp / "board.sqlite")
board = db.divan
board.create_project("Divan", repos=["/Users/me/projects/divan"])

# audit: language-data — a Turkish question as a blocked ticket asked it
ASK = "Harfiyen'in gizlilik sayfası example.dev'de mi dursun, yoksa uygulamanın kendi sitesinde mi?"
# audit: end-language-data
queue = {"available": True, "tickets": [
    # A ticket out of a folder no product claims: imported into the holding place.
    {"id": 348, "title": "Harfiyen: App Store readiness", "status": "running",
     "stage": "worker", "repo": "/Users/me/projects/passaparola", "goal": "Get it ready."},
    # A filed one on the Divan board, working: not a question.
    {"id": 352, "title": "Web Dashboard question window", "status": "running",
     "stage": "worker", "repo": "/Users/me/projects/divan", "goal": "Fix it."},
]}
board.sync_ustabasi(queue, "studio")
# …and then it stops on a question, the way `_escalate` leaves it.
queue["tickets"][0].update(status="blocked", escalation="blocked_on: privacy page host", ask=ASK)
board.sync_ustabasi(queue, "studio")

snap = board.snapshot("studio")
for p in snap["projects"]:
    p["milestones"] = []
snap.pop("pulls", None)
snap["activity"] = {}
out = Path(__file__).resolve().parent / "fixtures" / "unfiled-ask-snapshot.json"
out.write_text(json.dumps(snap, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
print(out)
