#!/usr/bin/env python3
"""The tunnel's door: its own devices, a lock, a sign-in, and a word to the phone.

    python scripts/test_tunnel.py

A real `Server` over a temporary `RAC_HOME`, driven through a test client.
`send_push` is replaced by a recorder, so nothing reaches Expo, and the Access
keys come from a fetcher that hands back ones made here.
"""
from __future__ import annotations

import argparse
import atexit
import contextlib
import io
import logging
import os
import shutil
import sys
import tempfile
import time
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="rac-tunnel-")
os.environ["RAC_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jwt                                                       # noqa: E402
import tomli_w                                                   # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa        # noqa: E402
from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

import remote_ai_chat.__main__ as cli                            # noqa: E402
import remote_ai_chat.config as config_mod                       # noqa: E402
import remote_ai_chat.server as server_mod                       # noqa: E402
from remote_ai_chat.config import CONFIG_PATH, UPLOAD_DIR, Config  # noqa: E402
from remote_ai_chat.server import Server                         # noqa: E402

HOUSE, ELSEWHERE, GUESSER = "203.0.113.4", "203.0.113.9", "198.51.100.7"
TEAM, AUD, ME = "divan-test", "0123abcd", "me@example.com"
ISS = f"https://{TEAM}.cloudflareaccess.com"
KEYS = {kid: rsa.generate_private_key(public_exponent=65537, key_size=2048) for kid in ("k1", "k2")}
failures: list[str] = []
sent: list[dict] = []
logged: list[str] = []
now = [1_000_000.0]
# What the team publishes, and every time it was asked. None is a fetch that fails.
published: list[str] | None = ["k1"]
fetched: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


async def recorder(tokens, title, body, data=None):
    sent.append({"tokens": tokens, "title": title, "body": body, "data": data or {}})


async def jwks(url: str) -> dict:
    fetched.append(url)
    if published is None:
        raise OSError("no route to host")
    return {"keys": [{**jwt.algorithms.RSAAlgorithm.to_jwk(KEYS[kid].public_key(), as_dict=True),
                      "kid": kid} for kid in published]}


def signed(kid: str = "k1", key: str = "", **claims) -> str:
    """An Access token, good unless a claim or the signing key says otherwise."""
    body = {"aud": [AUD], "iss": ISS, "exp": time.time() + 600, "email": ME, **claims}
    return jwt.encode(body, KEYS[key or kid], algorithm="RS256", headers={"kid": kid})


def configure(**settings) -> None:
    """Edit config.toml by hand, as its owner would, under a running daemon."""
    raw = tomllib.loads(CONFIG_PATH.read_text())
    before = CONFIG_PATH.stat().st_mtime_ns
    CONFIG_PATH.write_text(tomli_w.dumps({**raw, **settings}))
    if CONFIG_PATH.stat().st_mtime_ns <= before:
        os.utime(CONFIG_PATH, ns=(before + 1, before + 1))


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
    srv.tunnel_lock.clock = srv.tunnel_access.clock = lambda: now[0]
    srv.tunnel_access.fetch = jwks
    return srv, TestClient(srv.app)


def carrying(via: str | None, access: str | None, cookie: str | None) -> dict:
    headers = {"CF-Connecting-IP": via} if via else {}
    if access:
        headers["Cf-Access-Jwt-Assertion"] = access
    if cookie:
        headers["Cookie"] = f"other=1; CF_Authorization={cookie}"
    return headers


def ws_code(client: TestClient, token: str, via: str | None = None,
            access: str | None = None, cookie: str | None = None) -> int:
    """0 if the socket was served, else the code it was closed with."""
    headers = carrying(via, access, cookie)
    try:
        with client.websocket_connect(f"/ws?token={token}", headers=headers) as ws:
            ws.receive_json()
            return 0
    except WebSocketDisconnect as exc:
        return exc.code


def http(client: TestClient, method: str, path: str, token: str, via: str | None = None,
         access: str | None = None, cookie: str | None = None, **kw) -> int:
    headers = {"Authorization": f"Bearer {token}", **carrying(via, access, cookie)}
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
    said = logging.Handler()
    said.emit = lambda record: logged.append(record.getMessage())
    logging.getLogger("rac").addHandler(said)
    logging.getLogger("rac").setLevel(logging.INFO)

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

    global published
    with client:
        def both(**kw) -> list[int]:
            return [ws_code(client, panel, HOUSE, **kw), http(client, "GET", "/files", panel, HOUSE, **kw, **files)]

        print("\n6. Cloudflare Access")
        check(both() == [0, 200] and fetched == [],
              "with the three settings empty no Access token is asked for", repr(fetched))
        configure(tunnel_access_team=TEAM, tunnel_access_aud=AUD)
        srv.cfg.save()
        check(both() == [1008, 403],
              "team and aud written under a running daemon, which saves over neither: no token is 1008 and 403",
              repr(both()))
        check(both(access=signed()) == [0, 200], "a good token and the tunnel device are served")
        check(both(cookie=signed()) == [0, 200], "and so is the token in the CF_Authorization cookie alone")
        check(fetched == [f"{ISS}/cdn-cgi/access/certs"], "the keys were fetched once for all of it", repr(fetched))
        check([ws_code(client, local), http(client, "GET", "/files", local, **files)] == [0, 200],
              "off the tunnel nothing asks for one")

        for label, bad in (("signed with another key", signed(key="k2")),
                           ("past its exp", signed(exp=time.time() - 3600)),
                           ("for another aud", signed(aud=["somebody-else"])),
                           ("from another iss", signed(iss="https://other.cloudflareaccess.com"))):
            check(both(access=bad) == [1008, 403], f"a token {label} is refused", repr(both(access=bad)))
        configure(tunnel_access_emails=["Me@Example.com"])
        got = [both(access=signed(email="you@example.com")), both(access=signed())]
        check(got == [[1008, 403], [0, 200]], "with a mail list, a mail off it is refused and one on it served",
              repr(got))
        configure(tunnel_access_aud="")
        check(both(access=signed()) == [1008, 403], "a team without an aud refuses everybody")
        configure(tunnel_access_aud=AUD)

        published = ["k1", "k2"]
        got = [both(access=signed("k2")), len(fetched)]
        now[0] += 61
        got += [both(access=signed("k2")), len(fetched), both(access=signed("k3", key="k2")), len(fetched)]
        check(got == [[1008, 403], 1, [0, 200], 2, [1008, 403], 2],
              "an unknown kid fetches the keys again, and not twice inside a minute", repr(got))

        print("\n7. who signed in")
        sent.clear(), logged.clear()
        got = ws_code(client, panel, ELSEWHERE, access=signed())
        settle(srv, client)
        check(got == 0 and {s["tokens"][0]: s["body"] for s in sent} == {
            f"ExponentPushToken[{name}]": text[lang]["new_address_as"].format(name="laptop", email=ME, addr=ELSEWHERE)
            for name, lang in (("iPhone", "tr"), ("here", "en"))}
              and all(ME in s["body"] and s["data"]["kind"] == "tunnel_new_address" for s in sent),
              "the new-address push names the mail", repr((got, sent)))
        check(any(ln.startswith("device connected: laptop") and ME in ln for ln in logged),
              "and so does the connection log", repr(logged))

    published = None
    srv, client = start()
    with client:
        down = [both(access=signed()), ws_code(client, local), http(client, "GET", "/files", local, **files)]
        published = ["k1"]
        now[0] += 61
        check(down == [[1008, 403], 0, 200] and both(access=signed()) == [0, 200],
              "keys that cannot be fetched refuse the tunnel, not the tailnet, and are asked for again later",
              repr(down))

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
