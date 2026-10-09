#!/usr/bin/env python3
"""What a ticket's runs took and used, added up without counting anything twice.

    python scripts/test_ustabasi_usage.py

The queue records no tokens and no cost. Each run's stream-json does, in its
closing `result` lines — as totals for the *session*, which a later round
resumes. So the ways to get this wrong are specific, and each is a case here:
a resumed session counted once per run, a streamed `assistant` line read as use,
a run still going read as zero, another ticket's folder read as this one's, and
a ticket's age read as the time somebody was running.

The queue's database belongs to another program, so the table here is built by
hand from its shape rather than by importing anything of it.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

tmp = Path(tempfile.mkdtemp(prefix="rac-ustabasi-usage-"))
os.environ["USTABASI_STATE_DIR"] = str(tmp / "state")
(tmp / "state").mkdir()

from divan import ustabasi as u                          # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


T0 = 1_791_000_000
conn = sqlite3.connect(tmp / "state" / "ustabasi.db")
conn.executescript("""
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY, slug TEXT, title TEXT, status TEXT, stage TEXT, round INTEGER,
  created_at REAL, started_at REAL, finished_at REAL, run_dir TEXT
);
""")
runs = tmp / "state" / "runs"


def ticket(tid: int, status: str, current: str | None) -> Path:
    folder = runs / f"{tid}-t{tid}"
    conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (tid, f"t{tid}", f"ticket {tid}", status, "worker", 1,
                  # Opened a day before anything ran: the age no figure may show.
                  T0 - 86400, T0, None, str(folder / current) if current else None))
    return folder


def run(folder: Path, name: str, lines: list[dict], took: float | None) -> None:
    """One run directory. `took` is how long after the moment in its name the
    queue wrote its exit code; None leaves it running."""
    d = folder / name
    d.mkdir(parents=True)
    (d / "stdout.log").write_text("".join(json.dumps(l) + "\n" for l in lines))
    if took is not None:
        (d / "exit.code").write_text("0")
        end = int(name.rsplit("-", 1)[1]) + took
        os.utime(d / "exit.code", (end, end))


def init(session: str, key: str = "none") -> dict:
    return {"type": "system", "subtype": "init", "session_id": session, "apiKeySource": key}


def streamed(mid: str, out: int) -> dict:
    """One block of an assistant message: the same usage on every block of it."""
    return {"type": "assistant", "message": {"id": mid, "content": [], "usage": {
        "input_tokens": 500, "output_tokens": out, "cache_read_input_tokens": 9000}}}


def result(session: str, uid: str, cost, tokens: tuple[int, int, int, int] | None,
           model: str = "opus") -> dict:
    """A closing line: the session's totals so far, as the CLI writes them."""
    d = {"type": "result", "session_id": session, "uuid": uid}
    if cost is not None:
        d["total_cost_usd"] = cost
    if tokens is not None:
        i, o, cr, cw = tokens
        d["modelUsage"] = {model: {"inputTokens": i, "outputTokens": o,
                                   "cacheReadInputTokens": cr, "cacheCreationInputTokens": cw}}
    return d


# 1 · two rounds on one resumed session, a check between them, and a verifier
#     on a session of its own. Round 2's closing line starts where round 1's
#     ended, and its log opens with a line that repeats round 1's total.
t1 = ticket(1, "done", "r2-verifier-%d" % (T0 + 3000))
run(t1, f"r1-worker-{T0}", [
    init("s-work"), streamed("m1", 3), streamed("m1", 3), streamed("m1", 40),
    result("s-work", "a", 1.0, (100, 1000, 50_000, 2000)),
], took=600)
run(t1, f"r1-check-{T0 + 700}", [], took=30)
run(t1, f"r2-worker-{T0 + 1000}", [
    init("s-work"),
    result("s-work", "b", 1.0, (100, 1000, 50_000, 2000)),      # carried over, nothing new
    streamed("m2", 7),
    result("s-work", "c", 1.75, (130, 1600, 80_000, 2500)),
    result("s-work", "c", 1.75, (130, 1600, 80_000, 2500)),     # the same line, written twice
], took=300)
run(t1, f"r2-verifier-{T0 + 3000}", [
    init("s-verify"), result("s-verify", "d", 0.25, (10, 200, 4000, 800), model="sonnet"),
], took=60)

# 2 · another ticket, with a cost that must never reach ticket 1.
t2 = ticket(2, "running", f"r1-worker-{T0 + 50}")
run(t2, f"r1-worker-{T0 + 50}", [init("s-other"), streamed("m9", 12)], took=None)

# 3 · a run that reported nothing used, a run cut off before its closing line,
#     and a session paid for by an API key.
t3 = ticket(3, "failed", f"r1-verifier-{T0 + 500}")
run(t3, f"r1-worker-{T0}", [init("s-zero", "ANTHROPIC_API_KEY"),
                            result("s-zero", "z", 0, (0, 0, 0, 0))], took=5)
run(t3, f"r1-verifier-{T0 + 500}", [init("s-cut", "ANTHROPIC_API_KEY"), streamed("m3", 99)], took=20)

# 4 · a session whose totals went down: the CLI started counting again, so the
#     second run's line is worth all of itself.
t4 = ticket(4, "done", f"r2-worker-{T0 + 900}")
run(t4, f"r1-worker-{T0}", [init("s-again"), result("s-again", "p", 2.0, (50, 500, 0, 0))], took=100)
run(t4, f"r2-worker-{T0 + 900}", [init("s-again"), result("s-again", "q", 0.5, (5, 60, 0, 0))], took=100)

# 5 · a ticket nobody has started.
ticket(5, "queued", None)
conn.commit()
conn.close()


one = u.telemetry(1)
by = {r["run"].rsplit("-", 1)[0]: r for r in one["runs"]}

check("a resumed session is counted once: round 2 is worth what it added",
      (by["r1-worker"]["cost_usd"], by["r2-worker"]["cost_usd"], one["cost_usd"]),
      (1.0, 0.75, 2.0))
check("tokens the same way, input and output and both halves of the cache apart",
      (by["r2-worker"]["tokens"], one["tokens"]),
      ({"input": 30, "output": 600, "cache_read": 30_000, "cache_write": 500},
       {"input": 140, "output": 1800, "cache_read": 84_000, "cache_write": 3300}))
check("a check is a shell: it took time and has no figures to be missing",
      (by["r1-check"]["model"], by["r1-check"]["tokens"], one["unreported"]), (False, None, 0))
check("time is the runs' own, start to exit — not the day the ticket has been open",
      ([r["ended_at"] - r["started_at"] for r in one["runs"]], one["active_seconds"]),
      ([600.0, 30.0, 300.0, 60.0], 990.0))
check("no API key behind any session: the cost is an estimate",
      one["cost_basis"], "estimate")

two = u.telemetry(2)
check("a run still going has no end and no figures — null, not zero, and not"
      " what its streamed lines said",
      (two["runs"][0]["live"], two["runs"][0]["ended_at"], two["tokens"], two["cost_usd"],
       two["active_seconds"], two["unreported"]),
      (True, None, None, None, 0, 0))

three = u.telemetry(3)
check("a run that said zero is zero, the one cut off is unreported, and a key paid",
      (three["tokens"], three["cost_usd"], three["runs"][1]["tokens"], three["unreported"],
       three["cost_basis"]),
      ({"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}, 0.0, None, 1, "api"))

four = u.telemetry(4)
check("a session that started counting again is not read as a negative",
      (four["cost_usd"], four["tokens"]["output"]), (2.5, 560))

check("a ticket that never ran has nothing to say", u.telemetry(5), None)
check("…and neither has one that does not exist", u.telemetry(99), None)

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — a ticket's time, tokens and cost, each counted once")
