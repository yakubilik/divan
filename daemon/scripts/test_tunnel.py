#!/usr/bin/env python3
"""The tunnel's door: its own devices, a lock, and a word to the phone.

    python scripts/test_tunnel.py

A real `Server` over a temporary `RAC_HOME`, driven through a test client.
`send_push` is replaced by a recorder, so nothing reaches Expo.
"""
from __future__ import annotations

import argparse
import atexit
import contextlib
import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="rac-tunnel-")
os.environ["RAC_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

import remote_ai_chat.__main__ as cli                            # noqa: E402
import remote_ai_chat.config as config_mod                       # noqa: E402
import remote_ai_chat.server as server_mod                       # noqa: E402
from remote_ai_chat.config import CONFIG_PATH, UPLOAD_DIR, Config  # noqa: E402
from remote_ai_chat.server import Server                         # noqa: E402

HOUSE, ELSEWHERE, GUESSER = "203.0.113.4", "203.0.113.9", "198.51.100.7"
failures: list[str] = []
sent: list[dict] = []
now = [1_000_000.0]


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


async def recorder(tokens, title, body, data=None):
    sent.append({"tokens": tokens, "title": title, "body": body, "data": data or {}})


def run_cli(fn, **args) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        fn(argparse.Namespace(**args))
    return out.getvalue()


def token_in(printed: str) -> str:
    """The token `web` put in the link's fragment."""
    return printed.split("#t=")[1].split("&")[0]


def start() -> tuple[Server, TestClient]:
    """A daemon, as a restart would bring it up: from what is on disk."""
    srv = Server(Config.load())
    srv.tunnel_lock.clock = lambda: now[0]
    return srv, TestClient(srv.app)


def ws_code(client: TestClient, token: str, via: str | None = None) -> int:
    """0 if the socket was served, else the code it was closed with."""
    headers = {"CF-Connecting-IP": via} if via else {}
    try:
        with client.websocket_connect(f"/ws?token={token}", headers=headers) as ws:
            ws.receive_json()
            return 0
    except WebSocketDisconnect as exc:
        return exc.code


def http(client: TestClient, method: str, path: str, token: str, via: str | None = None, **kw) -> int:
    headers = {"Authorization": f"Bearer {token}"}
    if via:
        headers["CF-Connecting-IP"] = via
    return client.request(method, path, headers=headers, **kw).status_code


def settle(srv: Server, client: TestClient) -> None:
    """Let the pushes raised so far be sent."""
    async def drain() -> None:
        while srv._alerts:
            await next(iter(srv._alerts))
    client.portal.call(drain)


def main() -> None:
    cli._already_serving = lambda port: True
    cli._panel_built = lambda: True
    config_mod.tailscale_ip = lambda: None
    server_mod.send_push = recorder

    print("1. which device is the tunnel's")
    CONFIG_PATH.write_text(
        'tunnel_allow_ips = ["203.0.113.4", "203.0.113.9", "198.51.100.7"]\n'
        '[devices.old]\nname = "old phone"\ntoken_hash = "x"\ncreated_at = 1.0\n')
    panel = token_in(run_cli(cli.cmd_web, name="laptop", at="divan.example.com", no_open=True))
    local = token_in(run_cli(cli.cmd_web, name="here", at=None, no_open=True))
    run_cli(cli.cmd_pair, name="iPhone")
    rows = {d.name: d for d in Config.load().devices.values()}
    written = CONFIG_PATH.read_text()
    check(rows["laptop"].tunnel and written.count("tunnel = true") == 1,
          "`web --at` writes tunnel = true, and nothing else does", written)
    check(not rows["here"].tunnel and not rows["iPhone"].tunnel and not rows["old phone"].tunnel,
          "`web`, `pair` and a row from before the field are not tunnel devices")

    cfg = Config.load()
    for name, lang in (("iPhone", "tr"), ("here", "en")):
        dev = next(d for d in cfg.devices.values() if d.name == name)
        dev.push_token, dev.lang = f"ExponentPushToken[{name}]", lang
    cfg.save()
    upload = UPLOAD_DIR / "c1" / "note.txt"
    upload.parent.mkdir(parents=True)
    upload.write_text("x")
    files = {"params": {"path": str(upload)}}

    srv, client = start()
    with client:
        print("\n2. each token opens one door")
        check(ws_code(client, local, HOUSE) == 4401, "a tailnet token through the tunnel closes 4401")
        got = [http(client, "GET", "/files", local, HOUSE, **files),
               http(client, "POST", "/upload", local, HOUSE, files={"file": ("a.txt", b"x")}),
               http(client, "GET", "/screen.jpg", local, HOUSE)]
        check(got == [401, 401, 401], "and is refused /files, /upload and /screen.jpg there", repr(got))
        got = [ws_code(client, local), http(client, "GET", "/files", local, **files),
               http(client, "POST", "/upload", local, files={"file": ("a.txt", b"x")})]
        check(got == [0, 200, 200], "the same token off the tunnel works as before", repr(got))
        got = [ws_code(client, panel), http(client, "GET", "/files", panel, **files)]
        check(got == [4401, 401], "a tunnel token off the tunnel is refused", repr(got))
        sent.clear()

        print("\n4. a new address is said once")
        got = [ws_code(client, panel, HOUSE), ws_code(client, panel, HOUSE)]
        settle(srv, client)
        check(got == [0, 0] and [s["data"]["kind"] for s in sent] == ["tunnel_new_address"] * 2
              and all("laptop" in s["body"] and HOUSE in s["body"] for s in sent),
              "two phones with a push token, one push each, naming the device and the address",
              repr((got, sent)))
        text = server_mod.TUNNEL_PUSH_TEXT
        check({s["tokens"][0]: s["body"] for s in sent} == {
            f"ExponentPushToken[{name}]": text[lang]["new_address"].format(name="laptop", addr=HOUSE)
            for name, lang in (("iPhone", "tr"), ("here", "en"))} and text["tr"] != text["en"],
              "each in the language its phone asked for", repr([s["body"] for s in sent]))

    srv, client = start()
    with client:
        got = ws_code(client, panel, HOUSE)
        settle(srv, client)
        check(got == 0 and len(sent) == 2, "nothing more after a restart, from the same address",
              repr((got, sent[2:])))

        print("\n3. five wrong tokens lock the address")
        sent.clear()
        tries = [ws_code(client, "wrong", GUESSER) for _ in range(4)]
        tries.append(http(client, "GET", "/files", "wrong", GUESSER, **files))
        locked = [ws_code(client, panel, GUESSER), ws_code(client, "wrong", GUESSER),
                  http(client, "GET", "/files", panel, GUESSER, **files)]
        check(tries == [4401] * 4 + [401] and locked == [4401, 4401, 401],
              "the right token is refused from it for the rest of the window", repr((tries, locked)))
        check(ws_code(client, local) == 0 and ws_code(client, panel, HOUSE) == 0,
              "the tailnet and the other addresses are not")
        settle(srv, client)
        check([s["data"]["kind"] for s in sent] == ["tunnel_locked"] * 2
              and all(GUESSER in s["body"] for s in sent),
              "4. one push per phone for the lock, however often it is tried", repr(sent))
        now[0] += srv.tunnel_lock.WINDOW_S + 1
        check(ws_code(client, panel, GUESSER) == 0, "and when the window ends the right token is served")

        print("\n5. `devices`")
        lines = {ln.split()[1]: ln for ln in run_cli(cli.cmd_devices).splitlines()}
        check("tunnel" in lines["laptop"] and f"from={GUESSER}" in lines["laptop"]
              and "tunnel" not in lines["here"] and "from=" not in lines["here"],
              "marks the tunnel device and says where it last connected from", repr(lines))

    live = {d.name: d.last_seen for d in srv.cfg.devices.values()}
    srv, client = start()
    disk = {d.name: d.last_seen for d in srv.cfg.devices.values()}
    check(disk == live and disk["laptop"] and disk["here"] and disk["old phone"] is None
          and "seen=20" in lines["laptop"] and "seen=20" in lines["here"]
          and "seen=never" in lines["old"],
          "says when each was last seen, and a restarted daemon reads the same",
          repr((live, disk, lines)))

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
