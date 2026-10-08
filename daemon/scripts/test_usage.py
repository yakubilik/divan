#!/usr/bin/env python3
"""The subscription's week, asked of the service. No network, no keychain.

    python scripts/test_usage.py
"""
from __future__ import annotations

import asyncio
import sys
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import usage                                # noqa: E402
from divan.accounts import Account                    # noqa: E402
from divan.server import Server                       # noqa: E402

fails: list[str] = []


def check(what: str, got, want) -> None:
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


class Host:
    """Just enough of `Server` to file a reading: the accounts, the readings,
    and somewhere for them to be written down and swept."""

    def __init__(self):
        self.accounts = {"acct-1": Account(id="acct-1", provider="claude", label="main", home="/tmp/a1")}
        self.limits: dict[str, dict[str, dict]] = {}
        self._usage_asked: dict[str, float] = {}
        self.db = types.SimpleNamespace(save_limits=lambda *a, **k: None)
        self.swept: list[str] = []
        self._sweep_later = self.swept.append
        self.USAGE_EVERY_S = Server.USAGE_EVERY_S
        self._learn_steps = Server._learn_steps
        for attr in ("_fresh_usage", "_weekly"):
            setattr(self, attr, getattr(Server, attr).__get__(self))


async def main() -> None:
    check("a percentage and a date become a share and a clock, and a window the plan lacks is left out",
          usage.rows({"five_hour": {"utilization": 7.0, "resets_at": "2026-10-07T20:50:00+00:00"},
                      "seven_day": {"utilization": 52.0, "resets_at": "2026-10-08T13:00:00+00:00"},
                      "seven_day_opus": None}),
          [{"window": "five_hour", "utilization": 0.07, "resets_at": 1791406200.0},
           {"window": "seven_day", "utilization": 0.52, "resets_at": 1791464400.0}])

    now = time.time()
    host = Host()
    host.limits["acct-1"] = {"seven_day": {
        "window": "seven_day", "status": "allowed", "utilization": 0.11, "resets_at": now + 3600,
        "overage_status": "allowed", "at": now - 4 * 86400}}
    asked: list[str] = []

    def read(a):
        asked.append(a.id)
        return [{"window": "seven_day", "utilization": 0.52, "resets_at": now + 3600}]
    usage.read = read

    await host._fresh_usage("acct-1")
    week = host._weekly("acct-1")
    check("the bar's figure is what the service says now, not what a turn said four days ago",
          (week["used"], week["at"] > now - 5), (0.52, True))
    check("what only a turn reports stays on the row, and the pool is told to look again",
          (host.limits["acct-1"]["seven_day"]["overage_status"], host.swept), ("allowed", ["acct-1"]))

    await host._fresh_usage("acct-1")
    await host._fresh_usage("nobody")
    check("a second poll inside the minute, or one for a sign-in that is not here, asks nothing",
          asked, ["acct-1"])

    host.limits["acct-1"]["seven_day"]["resets_at"] = now - 1
    check("a week that has ended is not shown as this one", host._weekly("acct-1"), None)


asyncio.run(main())
if fails:
    print("\n".join("FAIL  " + f for f in fails))
    sys.exit(1)
print("ok")
