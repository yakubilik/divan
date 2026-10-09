#!/usr/bin/env python3
"""How long a chat's turn takes, from the daemon's own event table. Read-only.

    python3 daemon/scripts/voice_bench/turn_durations.py [--db ~/.divan/db.sqlite] [--days 14]

A call placed from inside a chat (`app/app/call.tsx`, `askChat`) sends the
utterance with `chat.send` and says nothing until the chat goes idle, then reads
`call.reply`. So the silence a caller hears is at least the agent's whole turn.
This prints that distribution — user message to `turn.done`/`turn.error`, the
first assistant text, and the turns that used no tool — and nothing else: no
text, no chat ids. The database is opened read-only (`mode=ro`).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import statistics
import time


def q(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return round(xs[int(p * (len(xs) - 1))], 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.expanduser("~/.divan/db.sqlite"))
    ap.add_argument("--days", type=int, default=14)
    a = ap.parse_args()
    db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    since = time.time() - a.days * 86400
    rows = db.execute("SELECT chat_id, type, ts FROM events WHERE ts > ? AND type IN "
                      "('message.user','message.assistant','turn.done','turn.error','tool.use') "
                      "ORDER BY chat_id, seq", (since,)).fetchall()
    turns, first, no_tool = [], [], []
    cur = None
    for chat, typ, ts in rows:
        if typ == "message.user":
            cur = {"chat": chat, "t": ts, "first": None, "tools": 0}
        elif cur and chat == cur["chat"]:
            if typ == "tool.use":
                cur["tools"] += 1
            elif typ == "message.assistant" and cur["first"] is None:
                cur["first"] = ts - cur["t"]
            elif typ in ("turn.done", "turn.error"):
                turns.append(ts - cur["t"])
                if cur["first"] is not None:
                    first.append(cur["first"])
                if not cur["tools"]:
                    no_tool.append(ts - cur["t"])
                cur = None
    if not turns:
        print(json.dumps({"turns": 0}))
        return 0
    out = {
        "days": a.days, "turns": len(turns),
        "turn_s": {"median": round(statistics.median(turns), 1), "p25": q(turns, .25), "p75": q(turns, .75),
                   "p95": q(turns, .95)},
        "first_assistant_text_s": {"median": round(statistics.median(first), 1), "p95": q(first, .95)},
        "no_tool_turns": {"n": len(no_tool), "median_s": round(statistics.median(no_tool), 1) if no_tool else None,
                          "p95_s": q(no_tool, .95) if no_tool else None},
    }
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
