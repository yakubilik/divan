#!/usr/bin/env python3
"""What the daemon writes down when a phone's socket goes, and when it comes back.

    python scripts/test_reconnect.py

1. Every disconnect line carries the close code, how long the socket lived,
   which way it came in (tunnel or direct) and how long since its last `ping`.
2. The reason the phone gives in its next `hello` is logged.
3. An event loop held up past the threshold is logged, with where it was held.
4. A one-shot socket (`callOnce`, `?once=1`) is not written down as the phone's
   connection coming and going (#291).
5. A `ping` is answered ahead of everything already queued for that client, so
   a heartbeat is never stuck behind a replay or a stream (#291).
7. The LAN door: `hello` logs which door the phone came back by and how its
   dials failed; `/lan/proof` proves the computer to the phone without giving
   away the token or its hash, and never through the tunnel; `host.status`
   carries the LAN address.
6. A `chat.send` resent under a client id the daemon already accepted for that
   chat runs nothing and gets the first answer again; one without an id sends
   as it always did (#292).

A real `Server` over a temporary `DIVAN_HOME`, driven through a test client.
"""
from __future__ import annotations

import argparse
import asyncio
import atexit
import contextlib
import hashlib
import io
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="rac-reconnect-")
os.environ["DIVAN_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient                        # noqa: E402

import divan.__main__ as cli                            # noqa: E402
import divan.config as config_mod                       # noqa: E402
from divan.config import CONFIG_PATH, Config            # noqa: E402
from divan.looplag import LoopWatch                     # noqa: E402
from divan.server import Outbox, Server                 # noqa: E402

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


class SlowSock:
    """A client on a slow link: every message takes `per` seconds to be accepted."""

    def __init__(self, per: float):
        self.per = per
        self.got: list[tuple[float, str]] = []
        self.client = None
        self.query_params: dict = {}

    async def send_text(self, msg: str) -> None:
        await asyncio.sleep(self.per)
        self.got.append((time.monotonic(), msg))

    async def close(self) -> None:
        pass


async def ping_jumps_the_queue(srv: Server) -> None:
    """A client's outbox full of large events — a history replay, a long tool
    result — and then a ping: the answer is written next, not after them."""
    from divan.server import Conn
    dev = next(d for d in srv.cfg.devices.values() if d.name == "iPhone")
    ws = SlowSock(per=0.05)                  # 120 events of 256 KB: six seconds of sending
    srv.clients[ws] = dev
    srv.conns[ws] = Conn(None, "127.0.0.1")
    srv.outbox[ws] = Outbox()
    srv.writers[ws] = asyncio.create_task(srv._writer(ws, srv.outbox[ws]))
    big = "x" * 256 * 1024
    for i in range(120):
        await srv.broadcast({"event": "text.delta", "chat_id": "c", "seq": i, "data": {"text": big}, "ts": 0})
    await asyncio.sleep(0.12)                # the writer is mid-queue, as it would be
    sent = time.monotonic()
    await srv._dispatch(ws, dev, {"id": 7, "type": "ping", "data": {}})
    await srv._dispatch(ws, dev, {"id": 8, "type": "no.such", "data": {}})
    deadline = sent + 60                     # order is checked here, not speed: a loaded machine sends slower
    while time.monotonic() < deadline and not any('"id": 8' in m for _, m in ws.got):
        await asyncio.sleep(0.02)
    got = [json.loads(m) for _, m in ws.got]
    at = {m.get("id"): t for (t, _), m in zip(ws.got, got) if m.get("id")}
    events_before_pong = sum(1 for m in got[:[m.get("id") for m in got].index(7)] if m.get("type") == "event") \
        if 7 in at else -1
    took = at[7] - sent if 7 in at else float("inf")
    check(took < 1.0, "the ping's answer arrives within a second, past 120 large queued events",
          f"took {took:.2f}s")
    check(0 <= events_before_pong < 120, "it overtakes the queue rather than waiting it out",
          f"{events_before_pong} events went first")
    check(8 in at and [m.get("id") for m in got].index(8) > 120,
          "any other answer still keeps its place behind the events it follows",
          f"position {[m.get('id') for m in got].index(8)} of {len(got)}" if 8 in at
          else f"not sent after {time.monotonic() - sent:.1f}s, {len(got)} messages so far")
    srv._drop(ws)
    srv.conns.pop(ws, None)


def resent_once(client, srv: Server, phone: str) -> None:
    """The phone's outbox resends a message it never heard the answer to; the
    daemon has to tell the copy from a new message by the id the phone gave it.
    The demo provider plays every turn, and each one it starts is counted."""
    from divan.providers.demo import DemoProvider
    srv.cfg.demo = True
    turns: list[str] = []
    real_run = DemoProvider.run

    async def counted(self, prompt, attachments=None):
        turns.append(prompt)
        return await real_run(self, prompt, attachments)
    DemoProvider.run = counted
    chat = srv.db.create_chat(title="resend")["id"]
    other = srv.db.create_chat(title="resend elsewhere")["id"]
    try:
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            rid = iter(range(100, 10_000))

            def ask(data: dict) -> dict:
                i = next(rid)
                ws.send_json({"id": i, "type": "chat.send", "data": data})
                while True:
                    m = ws.receive_json()
                    if m.get("id") == i:
                        return m

            first = ask({"chat_id": chat, "text": "only once, please", "client_id": "m-1"})
            again = ask({"chat_id": chat, "text": "only once, please", "client_id": "m-1"})
            check(first.get("type") == "ok" and first["data"].get("accepted") is True
                  and first["data"].get("client_id") == "m-1",
                  "the first copy is accepted, and the answer names its client id", repr(first))
            check(again == {**first, "id": again.get("id")},
                  "the second copy gets the same answer", f"{first!r} / {again!r}")
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and not turns:
                time.sleep(0.02)
            time.sleep(0.3)
            said = [e for e in srv.db.tail_events(chat, ("message.user",), limit=50)]
            check(len(said) == 1 and said[0]["data"].get("client_id") == "m-1",
                  "one user message is in the timeline, carrying the client id", repr(said))
            check(len(turns) == 1, "one turn ran", f"{len(turns)} turns: {turns!r}")

            # The same id in another chat is another message.
            ask({"chat_id": other, "text": "same id, other chat", "client_id": "m-1"})
            check(len(srv.db.tail_events(other, ("message.user",), limit=50)) == 1,
                  "the same id in another chat is a message of its own")

            # After a restart the memory is gone, and the timeline answers.
            srv._sent.clear()
            third = ask({"chat_id": chat, "text": "only once, please", "client_id": "m-1"})
            check(third.get("type") == "ok" and third["data"] == first["data"]
                  and len(srv.db.tail_events(chat, ("message.user",), limit=50)) == 1,
                  "a copy that arrives after a restart is found in the timeline and not run",
                  repr(third))

            # An older phone names nothing, and every message it sends is one.
            ask({"chat_id": chat, "text": "no id one"})
            plain = ask({"chat_id": chat, "text": "no id two"})
            said = srv.db.tail_events(chat, ("message.user",), limit=50)
            check(plain.get("type") == "ok" and plain["data"].get("accepted") is True
                  and "client_id" not in plain["data"] and len(said) == 3,
                  "a send without a client id is accepted as before, every time", repr(plain))
            for c in (chat, other):
                ask_i = next(rid)
                ws.send_json({"id": ask_i, "type": "chat.interrupt", "data": {"chat_id": c}})
                while ws.receive_json().get("id") != ask_i:
                    pass
    finally:
        DemoProvider.run = real_run
        srv.cfg.demo = False


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
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            ws.send_json({"id": 1, "type": "hello", "data": {
                "device_name": "iPhone", "reconnect": {"reason": "foreground", "code": None,
                                                       "offline_s": 0.2, "silent_s": 404.5}}})
            while ws.receive_json().get("id") != 1:
                pass
        back = lines("device reconnected: iPhone")
        check(len(back) == 2 and "offline=0.2s silent=404.5s" in back[-1],
              "how long the old socket had been silent is logged beside it", repr(back[-1:]))

        print("7. the LAN door (2026-11-06)")
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            ws.receive_json()
            ws.send_json({"id": 1, "type": "hello", "data": {
                "device_name": "iPhone", "reconnect": {"reason": "socket", "code": 1006, "offline_s": 1.6,
                                                       "via": "tailnet", "dials": 2, "fails": ["lan-timeout"]}}})
            while ws.receive_json().get("id") != 1:
                pass
        back = lines("device reconnected: iPhone")[-1]
        check("via=tailnet" in back and "dials=2" in back and "fails=lan-timeout" in back,
              "`hello` says which door the phone came back by and how its dials failed", back)
        dev = next(d for d in srv.cfg.devices.values() if d.name == "iPhone")
        nonce = "ab" * 16
        r = client.get(f"/lan/proof?device={dev.id}&nonce={nonce}")
        want = hashlib.sha256(f"{hashlib.sha256(phone.encode()).hexdigest()}:{nonce}".encode()).hexdigest()
        check(r.status_code == 200 and r.json().get("proof") == want,
              "the proof is sha256(token hash + nonce), which the phone can work out from its token",
              f"{r.status_code} {r.text}")
        check(phone not in r.text and dev.token_hash not in r.text, "it gives away neither the token nor its hash")
        r = client.get(f"/lan/proof?device=nobody&nonce={nonce}")
        check(r.status_code == 404, "an unknown device gets no proof", str(r.status_code))
        r = client.get(f"/lan/proof?device={dev.id}&nonce=short")
        check(r.status_code == 404, "nor does a nonce too short to be one", str(r.status_code))
        r = client.get(f"/lan/proof?device={dev.id}&nonce={nonce}", headers={"CF-Connecting-IP": TUNNEL_IP})
        check(r.status_code in (403, 404), "and the tunnel never answers it", str(r.status_code))
        srv.lan_addrs = ["192.168.1.20"]
        with client.websocket_connect(f"/ws?token={phone}") as ws:
            info = ws.receive_json()
        check(info.get("data", {}).get("lan") == ["192.168.1.20"], "`host.status` tells the phone the LAN address",
              json.dumps(info)[:200])
        srv.lan_addrs = []
        ip = config_mod.lan_ip()
        check(ip is None or (not ip.startswith("100.") and not ip.startswith("127.")),
              "`lan` binds a private address, never the tailnet or loopback", str(ip))

        print("4. a one-shot socket")
        logging.getLogger("rac").setLevel(logging.DEBUG)
        gone_before = len(lines("device disconnected: iPhone"))
        came_before = len(lines("device connected: iPhone"))
        for _ in range(3):
            with client.websocket_connect(f"/ws?token={phone}&once=1") as ws:
                ws.receive_json()
                ws.send_json({"id": 1, "type": "ping", "data": {}})
                while ws.receive_json().get("id") != 1:
                    pass
                ws.close(code=1000)
        time.sleep(0.2)
        logging.getLogger("rac").setLevel(logging.INFO)
        check(len(lines("device disconnected: iPhone")) == gone_before
              and len(lines("device connected: iPhone")) == came_before,
              "is not logged as the phone connecting and disconnecting",
              repr(lines("device disconnected: iPhone")[gone_before:]))
        once = lines("one-shot socket closed: iPhone")
        check(len(once) == 3 and "code=1000" in once[-1],
              "but as a one-shot socket, with its close line", repr(once))

        print("6. a message sent twice under one client id")
        resent_once(client, srv, phone)

    print("5. a ping is answered ahead of the queue")
    asyncio.run(ping_jumps_the_queue(srv))

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
