#!/usr/bin/env python3
"""An isolated daemon for the phone's voice-session test (app/scripts/test-voice-session.cjs).

    python scripts/voice_peer.py [--fixtures /tmp/divan-voice-bench/fixtures] [--synthetic]

The daemon of `test_voice.py` — its own RAC_HOME and free loopback port under a
temporary folder, demo chats, the replaying recogniser and the scripted fast
layer — served until stdin closes. The running daemon is never touched.

The phone under test is JavaScript in another process, so the words each
caller has said cannot be handed over in memory: the caller writes them to
`<timelines>/<device>.json` (`[[start_ms, end_ms, text], ...]` on the session's
audio timeline) before it streams them, and the recogniser reads that file.

Prints one JSON line: {port, token, timelines, fixtures}.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_voice as tv                                         # noqa: E402


class FileTimelines(dict):
    def __init__(self, where: Path):
        super().__init__()
        self.where = where

    def get(self, key, default=None):
        f = self.where / f"{key}.json"
        try:
            return [tuple(x) for x in json.loads(f.read_text())]
        except (OSError, ValueError):
            return default


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    fx = tv.fixtures(Path(a.fixtures), a.synthetic)
    where = tv.TMP / "timelines"
    where.mkdir(parents=True, exist_ok=True)
    tv.TIMELINES = FileTimelines(where)
    srv, server, task, port, token, _projects = await tv.daemon(False, None)
    fdir = next(iter(fx.values()))["dir"]
    print(json.dumps({"port": port, "token": token, "timelines": str(where), "fixtures": str(fdir)}), flush=True)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, sys.stdin.read)
    server.should_exit = True
    await asyncio.wait_for(task, 15)


if __name__ == "__main__":
    asyncio.run(main())
