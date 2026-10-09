#!/usr/bin/env python3
"""What the daemon writes down when a phone's socket goes, and when it comes back.

    python scripts/test_reconnect.py

1. Every disconnect line carries the close code, how long the socket lived,
   which way it came in (tunnel or direct) and how long since its last `ping`.
2. The reason the phone gives in its next `hello` is logged.
3. An event loop held up past the threshold is logged, with where it was held.

A real `Server` over a temporary `RAC_HOME`, driven through a test client.
"""
from __future__ import annotations

import argparse
import asyncio
import atexit
import contextlib
import io
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="rac-reconnect-")
os.environ["RAC_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient                        # noqa: E402

import remote_ai_chat.__main__ as cli                            # noqa: E402
import remote_ai_chat.config as config_mod                       # noqa: E402
from remote_ai_chat.config import CONFIG_PATH, Config            # noqa: E402
from remote_ai_chat.looplag import LoopWatch                     # noqa: E402
from remote_ai_chat.server import Server                         # noqa: E402

TUNNEL_IP = "203.0.113.4"
failures: list[str] = []
logged: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def token_in(printed: str) -> str:
    return printed.split("#t=")[1].split("&")[0]


def run_cli(fn, **args) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        fn(argparse.Namespace(**args))
    return out.getvalue()


def lines(prefix: str) -> list[str]:
    return [m for m in logged if m.startswith(prefix)]


def main() -> None:
    cli._already_serving = lambda port: True
    cli._panel_built = lambda: True
    config_mod.tailscale_ip = lambda: None
    said = logging.Handler()
    said.emit = lambda record: logged.append(record.getMessage())
    logging.getLogger("rac").addHandler(said)         # rac.loop included
    logging.getLogger("rac").setLevel(logging.INFO)

    CONFIG_PATH.write_text(f'tunnel_allow_ips = ["{TUNNEL_IP}"]\n')
    panel = token_in(run_cli(cli.cmd_web, name="laptop", at="divan.example.com", no_open=True))
    _, phone = Config.load().add_device("iPhone")
    srv = Server(Config.load())

    async def no_catalog() -> dict:
        return {}
    srv.catalog_async = no_catalog          # `hello` would otherwise ask both CLIs for models

    with TestClient(srv.app) as client:
        print("1. the disconnect line")
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()                                    # host.status
            ws.send_json({"id": 1, "type": "ping", "data": {}})
            while ws.receive_json().get("id") != 1:
                pass
            time.sleep(0.3)
            ws.close(code=4000, reason="gone")
        time.sleep(0.2)
        gone = lines("device disconnected: iPhone")
        line = gone[-1] if gone else ""
        m = re.search(r"code=(\S+) reason='([^']*)' lifetime=([\d.]+)s transport=(\w+) peer=(.+?) since_ping=([\d.]+)s",
                      line)
        check(bool(m) and m.group(1) == "4000" and m.group(2) == "gone" and m.group(4) == "direct",
              "a direct socket's close code, reason and transport are on the line", line)
        check(bool(m) and float(m.group(3)) >= 0.3 and float(m.group(6)) >= 0.3
              and float(m.group(6)) <= float(m.group(3)),
              "with how long it lived and how long since its last ping", line)

        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
        line = lines("device disconnected: iPhone")[-1]
        check("since_ping=never" in line and "code=1000" in line,
              "a socket that never pinged says so", line)

        with client.websocket_connect(f"/ws?token={panel}", headers={"CF-Connecting-IP": TUNNEL_IP}) as ws:
            ws.receive_json()
        gone = lines("device disconnected: laptop")
        line = gone[-1] if gone else ""
        check(f"transport=tunnel peer={TUNNEL_IP}" in line, "a tunnelled socket is marked as the tunnel's", line)

        print("2. the reason the phone gives for coming back")
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            ws.close(code=1000)
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            ws.send_json({"id": 1, "type": "hello", "data": {
                "device_name": "iPhone", "reconnect": {"reason": "heartbeat", "code": None, "offline_s": 0.1}}})
            while ws.receive_json().get("id") != 1:
                pass
        back = lines("device reconnected: iPhone")
        check(len(back) == 1 and "reason=heartbeat" in back[0] and "offline=0.1s" in back[0],
              "`hello` with a reason is logged with it", repr(back))
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            ws.send_json({"id": 1, "type": "hello", "data": {"device_name": "iPhone"}})
            while ws.receive_json().get("id") != 1:
                pass
        check(len(lines("device reconnected:")) == 1, "a first `hello`, with no reason, logs none")

    print("3. a held-up event loop")

    def stuck_in_a_sync_call() -> None:
        time.sleep(1.2)

    async def drive() -> LoopWatch:
        watch = LoopWatch(every=0.1, threshold=0.5)
        task = asyncio.create_task(watch.run())
        await asyncio.sleep(0.3)
        stuck_in_a_sync_call()
        await asyncio.sleep(0.3)
        task.cancel()
        return watch

    before = len(logged)
    watch = asyncio.run(drive())
    late = [m for m in logged[before:] if m.startswith("event loop woke")]
    check(len(late) == 1 and float(re.search(r"woke ([\d.]+)s late", late[0]).group(1)) >= 0.9,
          "a loop blocked past the threshold is logged, once, with how late it woke", repr(late))
    check(bool(late) and "stuck_in_a_sync_call" in late[0],
          "with the frame it was stuck in", late[0] if late else "")
    check(watch.worst >= 0.9, "and the worst lateness is kept", str(watch.worst))

    before = len(logged)

    async def calm() -> None:
        task = asyncio.create_task(LoopWatch(every=0.05, threshold=0.5).run())
        await asyncio.sleep(0.5)
        task.cancel()

    asyncio.run(calm())
    check(not [m for m in logged[before:] if m.startswith("event loop woke")],
          "a loop that is not held up logs nothing")

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
