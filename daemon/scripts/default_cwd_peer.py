#!/usr/bin/env python3
"""An isolated daemon for the two-client default-folder test
(app/scripts/test-default-cwd-live.cjs).

    python scripts/default_cwd_peer.py

Its own DIVAN_HOME and loopback port under a temporary folder, one allowed root
holding three folders — `DevTrace-main` first in any sorted list, the way the
real ~/projects has it — and two paired devices, one for the phone and one for
the web panel. No `default_cwd` set, so the computer starts on its first root.
Chats are only created, never sent to, so no CLI is ever started. Served until
stdin closes; the running daemon is never touched.

Prints one JSON line: {port, phone, web, root, folders}.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="divan-default-cwd-"))
os.environ["DIVAN_HOME"] = str(TMP / "home")
os.environ["USTABASI_STATE_DIR"] = str(TMP / "nowhere")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import naming, recap                                  # noqa: E402
from divan.config import Config                                  # noqa: E402
from divan.providers.base import TurnResult                      # noqa: E402
from divan.session import ChatSession                            # noqa: E402

FOLDERS = ["DevTrace-main", "quire", "zeta"]


class StandIn:
    """A CLI that answers every turn at once, and never runs."""

    async def steer(self, prompt, attachments=None):
        return False

    async def run(self, prompt, attachments=None):
        return TurnResult(session_id="sess-1", cost_usd=None, usage=None, duration_ms=1, num_turns=1)

    def has_pending(self):
        return False

    async def interrupt(self):
        pass

    async def close(self):
        pass


async def nothing(*a, **k):
    return None


ChatSession._make_provider = lambda self, chat: StandIn()
# Titles and recaps are asked of a CLI after a turn; here nobody is asked.
naming.ask = nothing
recap.ask = nothing


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def main() -> None:
    import uvicorn
    from divan.server import Server
    root = (TMP / "projects").resolve()
    for name in FOLDERS:
        (root / name).mkdir(parents=True, exist_ok=True)
    cfg = Config.load()
    cfg.bind = ["127.0.0.1"]
    cfg.allowed_roots = [str(root)]
    cfg.auto_update = False
    _, phone = cfg.add_device("phone")
    _, web = cfg.add_device("web panel")
    cfg.save()
    port = free_port()
    srv = Server(cfg)

    async def no_fetch() -> None:
        return None
    srv.warm_models = no_fetch                 # the catalog's own lists, no CLI asked
    uc = uvicorn.Config(srv.app, host="127.0.0.1", port=port, log_level="warning",
                        ws_ping_interval=None, ws_ping_timeout=None)
    server = uvicorn.Server(uc)
    task = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.05)
    print(json.dumps({"port": port, "phone": phone, "web": web, "root": str(root),
                      "folders": {n: str(root / n) for n in FOLDERS}}), flush=True)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, sys.stdin.read)
    server.should_exit = True
    await asyncio.wait_for(task, 15)
    await srv.sessions.close_all()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
