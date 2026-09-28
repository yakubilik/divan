#!/usr/bin/env python3
"""A run's log, read a page at a time — the three ways it can be too big.

    python scripts/test_ustabasi_run.py

Every ustabasi run writes the model's stream-json to `<run_dir>/stdout.log`:
one JSON object a line, append-only, and 400KB of it by the time a worker is
finished. A phone opening that ticket wants a chat, which is the last few turns
and then whatever is written next — never the file.

So the whole of this is about what does *not* cross the wire:

  * a first open takes the end, not the beginning, and is capped in records and
    in bytes both. A single tool result can be a whole file; a single page can
    be four hundred of them.
  * a reader that has been away is moved up to the end rather than reading its
    way through a quarter of a megabyte of tool output.
  * a poll that finds nothing new is a couple of hundred bytes and no records.
  * a line still being written is not a record yet. The worker is appending to
    this file while it is being read, and half a JSON object parses as nothing.

And about the four silences a reader has to be able to tell apart: no queue on
this computer, no such ticket, a ticket nobody has started yet, and a run whose
directory has been cleared away.

The queue's database belongs to another program, so the tables here are built
by hand from its shape rather than by importing anything of it.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

tmp = Path(tempfile.mkdtemp(prefix="rac-ustabasi-run-"))
os.environ["USTABASI_STATE_DIR"] = str(tmp / "state")
(tmp / "state").mkdir()

from remote_ai_chat import ustabasi as u                          # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


def holds(what: str, ok: bool, detail: str = "") -> None:
    if not ok:
        fails.append(f"{what}\n    got:  {detail}")


def wire(answer: dict) -> int:
    """What the answer costs to send, which is the figure every cap is about."""
    return len(json.dumps(answer))


def kinds(answer: dict) -> list[str]:
    return [e["k"] for e in answer["events"]]


# ── the log a run writes ─────────────────────────────────────────────────────

def line(obj) -> str:
    return json.dumps(obj) + "\n"


def assistant(*blocks) -> str:
    return line({"type": "assistant", "message": {"content": list(blocks)}})


def text(s) -> dict:
    return {"type": "text", "text": s}


def tool(tid, name, **args) -> dict:
    return {"type": "tool_use", "id": tid, "name": name, "input": args}


def result(tid, out, error=False) -> str:
    return line({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": tid, "content": out, "is_error": error}]}})


NOW = time.time()
DB = tmp / "state" / "ustabasi.db"
conn = sqlite3.connect(DB)
conn.executescript("""
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY, slug TEXT, title TEXT, card TEXT, repo TEXT,
  base_branch TEXT, status TEXT, stage TEXT, round INTEGER,
  created_at REAL, updated_at REAL, started_at REAL, finished_at REAL,
  worktree TEXT, branch TEXT, run_dir TEXT, notes TEXT, verdict TEXT, escalation TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, ts REAL, kind TEXT, msg TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
""")

runs = tmp / "state" / "runs"


def ticket(tid: int, run: str | None, status: str = "running") -> Path | None:
    conn.execute(
        "INSERT INTO tickets (id, slug, title, card, repo, base_branch, status, stage,"
        " round, created_at, updated_at, started_at, finished_at, worktree, branch,"
        " run_dir, notes, verdict, escalation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, f"t{tid}", f"ticket {tid}", "{}", "/repo", "main", status, "worker", 1,
         NOW - 9000, NOW, NOW - 9000, None, None, "b", str(runs / run) if run else None,
         "[]", None, ""))
    if not run:
        return None
    d = runs / run
    d.mkdir(parents=True, exist_ok=True)
    return d


# 1 · a worker part way through a long run: far more log than a page.
busy = ticket(1, "r1-worker-1")
log = busy / "stdout.log"
with log.open("w") as fh:
    fh.write(line({"type": "system", "subtype": "init", "model": "m"}))
    for i in range(400):
        fh.write(line({"type": "system", "subtype": "thinking_tokens", "n": i}))
        fh.write(line({"type": "rate_limit_event", "rate_limit_info": {"utilization": 0.4}}))
        fh.write(assistant(text(f"sentence {i}. " + "x" * 200)))
        fh.write(assistant(tool(f"t{i}", "Bash", command=f"echo {i}", description="say a number")))
        # A tool result the size of a file, which is what most of them are.
        fh.write(result(f"t{i}", f"output {i}\n" + "y" * 40_000))
    fh.write(assistant(text("the last thing said")))
SIZE = log.stat().st_size

# 2 · a finished run, marked the way the queue marks one.
over = ticket(2, "r1-verifier-2", status="done")
(over / "stdout.log").write_text(
    assistant(text("I checked it."))
    + assistant(tool("a", "Read", file_path="/tmp/x.ts"))
    + result("a", "1\tconst x = 1\n")
    + line({"type": "result", "subtype": "success", "total_cost_usd": 1.5,
            "duration_ms": 900, "usage": {"output_tokens": 12}}))
(over / "exit.code").write_text("0")

# 3 · a ticket with a run directory whose log is gone.
gone = ticket(3, "r1-worker-3")
# 4 · a ticket nobody has started.
ticket(4, None, status="queued")
# 5 · a run whose log has a line still being written, and one that is not JSON.
half = ticket(5, "r1-worker-5")
(half / "stdout.log").write_text(
    assistant(text("first"))
    + "npm warn deprecated something\n"
    + assistant(text("second"))
    + '{"type":"assistant","message":{"content":[{"type":"text","te')
conn.commit()
conn.close()

# ── a first open is the end of the file, and it is capped ────────────────────

first = u.run(1)
holds("a log this size is there to be too big for one answer", SIZE > 400_000, str(SIZE))
check("the run is named by its directory, never by its path", first["run"], "r1-worker-1")
check("it is a first open", first["reset"], True)
holds("a 400KB log does not cross the wire in one message",
      wire(first) < u.MAX_RUN_BYTES + 4000, f"{wire(first)} bytes of {SIZE}")
holds("and what does cross it is a small fraction of the file",
      wire(first) < SIZE / 8, f"{wire(first)} of {SIZE}")
holds("the records are capped as well as the bytes",
      sum(1 for e in first["events"] if e["k"] not in ("system", "other")) <= u.MAX_RUN_EVENTS,
      str(len(first["events"])))
holds("what it took is the end of the file, not the beginning",
      first["events"][-1] == {"k": "text", "text": "the last thing said"},
      repr(first["events"][-1]))
holds("nothing of the beginning is in it",
      not any("sentence 0." in (e.get("text") or "") for e in first["events"]))
check("the end of the file is the end of the reading", first["caught_up"], True)
check("a run whose ticket is running is live", first["live"], True)
holds("a tool result the size of a file is cut down",
      all(len(e.get("text") or "") <= u.MAX_RUN_RESULT for e in first["events"] if e["k"] == "result"))
holds("and says it was cut",
      all(e.get("clipped") for e in first["events"] if e["k"] == "result"))

# The noise travels — the client decides what is worth drawing — but it does
# not eat the page. A tail of eighty hook lines and three sentences is what
# counting it would give.
holds("the noise is in the page", "system" in kinds(first) and "other" in kinds(first))
holds("…and it is cheap",
      sum(len(json.dumps(e)) for e in first["events"] if e["k"] in ("system", "other"))
      < wire(first) / 3)
# Two noise lines for every sentence in this log. Counting them would give a
# page of eighty records with twenty sentences in it at best, and — because
# they come in runs — a page with none in it at worst.
holds("…and did not crowd out what there is to read",
      sum(1 for e in first["events"] if e["k"] == "text") > 3,
      str(sum(1 for e in first["events"] if e["k"] == "text")))
holds("the page is spent on what is worth reading",
      sum(len(json.dumps(e)) for e in first["events"] if e["k"] in ("text", "result"))
      > wire(first) * 0.8)

# ── a poll that finds nothing new ────────────────────────────────────────────

idle = u.run(1, first["cursor"])
check("nothing new is no records", idle["events"], [])
holds("and a couple of hundred bytes", wire(idle) < 400, f"{wire(idle)} bytes")
check("the cursor stands still", idle["cursor"], first["cursor"])
check("and it is still caught up", idle["caught_up"], True)
check("a poll that found nothing is not a reset", idle["reset"], False)

# ── and one that finds something ─────────────────────────────────────────────

with log.open("a") as fh:
    fh.write(assistant(text("and then one more thing")))
    fh.write(assistant(tool("z", "Edit", file_path="/tmp/y.ts", old_string="a" * 900, new_string="b")))
more = u.run(1, idle["cursor"])
check("only what was written after the cursor", len(more["events"]), 2)
check("in the order it was written", more["events"][0]["text"], "and then one more thing")
check("a tool call keeps its name", more["events"][1]["name"], "Edit")
check("and what it was called on", more["events"][1]["input"]["file_path"], "/tmp/y.ts")
holds("a thousand-character argument is cut to a line",
      len(more["events"][1]["input"]["old_string"]) <= u.MAX_RUN_INPUT_VALUE)
check("appending is not a reset", more["reset"], False)
holds("the cursor moved", more["cursor"] != idle["cursor"], more["cursor"])

# ── a reader that has been away is moved up, not made to read its way back ───

behind = u.run(1, f"r1-worker-1:0")
check("it says so, so the client starts again rather than appending", behind["reset"], True)
holds("and the answer is still one page", wire(behind) < u.MAX_RUN_BYTES + 4000, str(wire(behind)))
holds("and it is the end of the file", behind["caught_up"], str(behind["caught_up"]))
holds("not the beginning of it",
      not any("sentence 0." in (e.get("text") or "") for e in behind["events"]))

# ── a cursor for another run is a cursor for another file ────────────────────

stale = u.run(1, "r1-worker-99:12")
check("a cursor from the round before reads as a first open", stale["reset"], True)
check("and the cursor comes back naming this run", stale["cursor"].split(":")[0], "r1-worker-1")
check("a cursor that is not one is a first open too", u.run(1, "nonsense")["reset"], True)
check("and so is none at all", u.run(1, None)["reset"], True)
check("a cursor past the end of the file is a first open",
      u.run(1, f"r1-worker-1:{SIZE * 2}")["reset"], True)

# ── a finished run is read the same way, and says it is over ─────────────────

done = u.run(2)
check("a run with an exit code is not live", done["live"], False)
check("what it said is all there", kinds(done), ["text", "tool", "result", "done"])
check("the closing record carries what it cost", done["events"][-1]["cost"], 1.5)
check("a tool result is a tool result", done["events"][2]["text"], "1\tconst x = 1\n")
check("and is tied to the call it answers", done["events"][2]["id"], done["events"][1]["id"])

# ── a line still being written is not a record yet ───────────────────────────

part = u.run(5)
check("a half-written line is left for next time",
      [e.get("text") for e in part["events"] if e["k"] == "text"], ["first", "second"])
check("a line that is not JSON at all is still a record, so there is no gap",
      [e for e in part["events"] if e["k"] == "other"], [{"k": "other", "type": "unparsable"}])
# Now it is finished, and the reader picks it up from where it stopped.
with (half / "stdout.log").open("a") as fh:
    fh.write('xt":"third"}]}}\n')
check("and is read when it is whole",
      [e.get("text") for e in u.run(5, part["cursor"])["events"]], ["third"])

# ── the four silences, each with its own word ────────────────────────────────

check("a run directory with no log in it", u.run(3)["reason"], "no_log")
check("a ticket nobody has started", u.run(4)["reason"], "never_run")
check("a ticket that is not in the queue", u.run(999)["reason"], "no_ticket")
holds("…and that is not an error either", u.run(999)["available"] is True)
was, u.DB_PATH = u.DB_PATH, tmp / "no-such.db"
try:
    check("a computer with no queue", u.run(1)["reason"], "no_queue")
    check("…which is not an available queue", u.run(1)["available"], False)
finally:
    u.DB_PATH = was
# Whatever the reason, the answer is the same shape: nothing to draw, nowhere
# to carry on from, and nothing to wait for. A client that has to take each of
# these apart differently is a client with four spinners in it.
for silence in (u.run(3), u.run(4), u.run(999)):
    holds("every silence answers the same shape",
          silence["events"] == [] and silence["cursor"] is None
          and silence["caught_up"] is True, repr(silence))

# ── a real log, captured, with this machine's home scrubbed out of it ────────
#
# The shapes above are written by hand and agree with each other by
# construction. This one is 1,300 lines the queue actually wrote, and is the
# same fixture the app's own reading is checked against — one recording, two
# languages, so the two cannot drift apart without one of them going red.

fixture = Path(__file__).resolve().parents[2] / "app" / "scripts" / "fixtures" / "run.log"
holds("the captured log is where both sides look for it", fixture.exists(), str(fixture))
if fixture.exists():
    real = ticket_dir = runs / "r1-worker-real"
    ticket_dir.mkdir()
    (ticket_dir / "stdout.log").write_bytes(fixture.read_bytes())
    conn = sqlite3.connect(DB)
    conn.execute("UPDATE tickets SET run_dir = ? WHERE id = 3", (str(real),))
    conn.commit()
    conn.close()
    got = u.run(3)
    seen = set(kinds(got))
    holds("a real log has every kind in it that the client draws",
          {"text", "thinking", "tool", "result", "system"} <= seen, repr(sorted(seen)))
    holds("and it is still one page", wire(got) < u.MAX_RUN_BYTES + 4000, str(wire(got)))
    # The same rule `scripts/audit.py` scans the tree with: a fixture is a
    # tracked file, and a run log is nothing but absolute paths.
    home = re.compile(r"/(?:Users|home)/(?!you\b)[a-z][a-z0-9._-]{2,}")
    holds("nobody's home directory came with it",
          not home.search(json.dumps(got)),
          (home.search(json.dumps(got)) or [""])[0] if home.search(json.dumps(got)) else "")

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print(f"ok — a run's log, read in pages of at most {u.MAX_RUN_EVENTS} records "
      f"and {u.MAX_RUN_BYTES} bytes")
