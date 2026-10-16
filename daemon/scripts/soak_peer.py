#!/usr/bin/env python3
"""A real daemon for the phone's connection soak (app/scripts/soak-ws.cjs) and
its live socket test (app/scripts/test-ws-live.cjs).

    python scripts/soak_peer.py --home /tmp/x --port 8791 [--tick-ms 200] [--say-every 5]

The real `Server` under uvicorn on 127.0.0.1, configured as `divan serve`
configures it (`ws_ping_interval=None`), over its own DIVAN_HOME — the running
daemon is never touched. One chat, `soak`, gets a numbered event every
`--tick-ms`, written to the database and broadcast the way a turn's events
are, so a client can check by sequence number that it saw every one of them,
live or by replay.

`--say-every N` also has the chat say the time every N seconds as an assistant
message, so a person (or a simulator screenshot) can see at a glance whether
the chat on screen is live. `--tick-ms 0` turns the numbered events off.

Run it again with the same --home and --port and it is the same computer
after a restart: same device token, same chat, sequence numbers carrying on.

Prints one JSON line once it is accepting connections: {port, token, chat_id}.
Logs go to stderr at DEBUG. Serves until stdin closes or SIGTERM.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import sys
import time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--home", required=True)
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--tick-ms", type=int, default=200)
ap.add_argument("--say-every", type=float, default=0)
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--drop-ack", action="store_true",
                help="a chat.send whose text has [drop-ack] in it is accepted, and then its socket "
                     "is closed before the answer goes out — once per client id (#292)")
args = ap.parse_args()
os.environ["DIVAN_HOME"] = args.home
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn                                          # noqa: E402

import divan.config as config_mod                       # noqa: E402
from divan.config import Config                         # noqa: E402
from divan.server import Server                         # noqa: E402

log = logging.getLogger("rac.soak")


async def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("rac").setLevel(logging.DEBUG)
    config_mod.tailscale_ip = lambda: None
    state = Path(args.home) / "soak.json"
    cfg = Config.load()
    cfg.bind = ["127.0.0.1"]
    cfg.auto_update = False
    cfg.demo = True
    if state.exists():
        known = json.loads(state.read_text())
    else:
        _, token = cfg.add_device("iPhone")
        known = {"token": token}
    srv = Server(cfg)

    async def no_catalog() -> dict:
        return {}
    srv.catalog_async = no_catalog          # `hello` would otherwise ask both CLIs for models
    if args.drop_ack:
        real_send = srv.h_chat_send
        dropped: set[str] = set()

        async def send_and_drop(dev, d, ws):
            ack = await real_send(dev, d)
            cid = d.get("client_id")
            if "[drop-ack]" in str(d.get("text")) and cid and cid not in dropped:
                dropped.add(cid)
                log.warning("soak_peer: chat.send %s accepted; closing the socket before the answer", cid)
                with contextlib.suppress(Exception):
                    await ws.close(code=1011)
            return ack
        srv.h_chat_send = send_and_drop
    if "chat_id" not in known:
        known["chat_id"] = srv.db.create_chat(title="soak")["id"]
        state.write_text(json.dumps(known))
    chat_id = known["chat_id"]

    uc = uvicorn.Config(srv.app, host=args.host, port=args.port, log_level="warning",
                        ws_ping_interval=None, ws_ping_timeout=None)
    server = uvicorn.Server(uc)
    serving = asyncio.create_task(server.serve())
    while not server.started:
        if serving.done():
            raise SystemExit(f"uvicorn did not start: {serving.exception()}")
        await asyncio.sleep(0.02)

    async def tick() -> None:
        n = 0
        while args.tick_ms > 0:
            await asyncio.sleep(args.tick_ms / 1000)
            n += 1
            ev = srv.db.append_event(chat_id, "soak.tick", {"n": n, "pid": os.getpid()})
            await srv.broadcast(ev)

    async def say() -> None:
        while args.say_every > 0:
            await asyncio.sleep(args.say_every)
            text = f"Live from the Mac: {time.strftime('%H:%M:%S')}"
            ev = srv.db.append_event(chat_id, "message.assistant", {"text": text})
            await srv.broadcast(ev)

    ticker = asyncio.gather(tick(), say())
    print(json.dumps({"port": args.port, "token": known["token"], "chat_id": chat_id}), flush=True)

    loop = asyncio.get_running_loop()
    stdin_closed = loop.run_in_executor(None, sys.stdin.read)
    await asyncio.wait([serving, asyncio.ensure_future(stdin_closed)], return_when=asyncio.FIRST_COMPLETED)
    ticker.cancel()
    server.should_exit = True
    try:
        await asyncio.wait_for(serving, 10)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass
    os._exit(0)                              # the stdin reader thread would hold the exit


if __name__ == "__main__":
    asyncio.run(main())
