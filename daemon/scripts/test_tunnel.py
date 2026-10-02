#!/usr/bin/env python3
"""The tunnel's door: its own devices, a lock and its key, a sign-in, and a word to the phone.

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
import socket
import sys
import threading
import tempfile
import time
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="rac-tunnel-")
os.environ["RAC_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx                                                     # noqa: E402
import jwt                                                       # noqa: E402
import uvicorn                                                   # noqa: E402
import tomli_w                                                   # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa        # noqa: E402
from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

import remote_ai_chat.__main__ as cli                            # noqa: E402
import remote_ai_chat.config as config_mod                       # noqa: E402
import remote_ai_chat.server as server_mod                       # noqa: E402
from remote_ai_chat.config import CONFIG_PATH, UPLOAD_DIR, Config  # noqa: E402
from remote_ai_chat.security import TunnelLock                   # noqa: E402
from remote_ai_chat.server import Server                         # noqa: E402

HOUSE, ELSEWHERE, GUESSER = "203.0.113.4", "203.0.113.9", "198.51.100.7"
# A household whose browser holds a token that does not open the tunnel.
RETRIER = "203.0.113.5"
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


def ws_close(client: TestClient, token: str, via: str | None = None,
             access: str | None = None, cookie: str | None = None) -> tuple[int, str]:
    """(0, "") if the socket was served, else the code and reason it was closed with."""
    headers = carrying(via, access, cookie)
    try:
        with client.websocket_connect(f"/ws?token={token}", headers=headers) as ws:
            ws.receive_json()
            return 0, ""
    except WebSocketDisconnect as exc:
        return exc.code, exc.reason or ""


def ws_code(client: TestClient, token: str, via: str | None = None,
            access: str | None = None, cookie: str | None = None) -> int:
    """0 if the socket was served, else the code it was closed with."""
    return ws_close(client, token, via, access, cookie)[0]


def ws_call(client: TestClient, token: str, typ: str, data: dict, via: str | None = None) -> dict:
    """One request on a socket; the reply's type and data."""
    with client.websocket_connect(f"/ws?token={token}", headers=carrying(via, None, None)) as ws:
        ws.receive_json()
        ws.send_json({"id": 1, "type": typ, "data": data})
        while True:
            msg = ws.receive_json()
            if msg.get("id") == 1:
                return msg


def http_why(client: TestClient, path: str, token: str, via: str | None = None, **kw) -> tuple[int, str]:
    r = client.get(path, headers={"Authorization": f"Bearer {token}", **carrying(via, None, None)}, **kw)
    return r.status_code, (r.json().get("detail") if r.status_code == 401 else "")


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
        'tunnel_allow_ips = ["203.0.113.4", "203.0.113.9", "198.51.100.7", "203.0.113.5"]\n'
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
        tries = [ws_code(client, f"wrong-{i}", GUESSER) for i in range(4)]
        tries.append(http(client, "GET", "/files", "wrong-4", GUESSER, **files))
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

        print("\n3b. our own browser's retries never lock it")
        lock, key = srv.tunnel_lock, srv.cfg.tunnel_key(RETRIER)
        got = {ws_close(client, local, RETRIER) for _ in range(12)}
        got |= {http_why(client, "/files", local, RETRIER, **files) for _ in range(4)}
        got |= {http_why(client, "/screen.jpg", local, RETRIER) for _ in range(4)}
        check(got == {(4401, "not_tunnel_device"), (401, "not_tunnel_device")},
              "a tailnet token at the tunnel is refused, and says it is the wrong door", repr(got))
        check(key not in lock.failed and not lock.locked(key),
              "and twenty of those count for nothing", repr(lock.failed.get(key)))
        got = {ws_close(client, "stale", RETRIER) for _ in range(15)}
        check(got == {(4401, "unknown_token")} and len(lock.failed[key]) == 1 and not lock.locked(key),
              "the same unknown token fifteen times is counted once", repr((got, lock.failed.get(key))))
        sent.clear()
        got = [ws_close(client, f"guess-{i}", RETRIER) for i in range(4)]
        until = int(now[0] + TunnelLock.WINDOW_S)
        check(got[:3] == [(4401, "unknown_token")] * 3 and got[3] == (4401, "unknown_token")
              and lock.locked(key), "four more different ones make five, and lock the address", repr(got))
        got = [ws_close(client, panel, RETRIER), ws_close(client, local, RETRIER),
               http_why(client, "/files", panel, RETRIER, **files)]
        check(got == [(4401, f"locked:{until}:{RETRIER}")] * 2 + [(401, f"locked:{until}:{RETRIER}")],
              "a locked address is told so, and when it lifts", repr(got))
        settle(srv, client)
        check(sent and all("remote-ai-chat unlock " + RETRIER in s["body"] for s in sent),
              "the lock's push says how to lift it", repr([s["body"] for s in sent]))

        print("\n3c. a lock lifted without a restart")
        refused = ws_close(client, panel, None)
        check(refused == (4401, "tunnel_only"), "a tunnel token off the tunnel says so", repr(refused))
        got = ws_call(client, panel, "tunnel.unlock", {"addr": RETRIER}, HOUSE)
        check(got["type"] == "error" and got["data"]["code"] == "forbidden" and lock.locked(key),
              "a tunnel device may not lift a tunnel lock", repr(got))
        got = ws_call(client, local, "tunnel.unlock", {"addr": RETRIER})
        check(got["type"] == "ok" and got["data"] == {"addr": RETRIER, "was_locked": True},
              "a tailnet device asks the running daemon to unlock it", repr(got))
        check(ws_code(client, panel, RETRIER) == 0 and not lock.locked(key) and key not in lock.failed,
              "and the right token is served from it at once, with the count forgotten")
        sent.clear()

        print("\n3d. a revoked device is the only one called revoked")
        gone, gone_token = srv.cfg.add_device("old tab")
        srv.cfg.revoke(gone.id)
        got = [ws_close(client, gone_token), ws_close(client, "never-issued"), ws_close(client, ""),
               http_why(client, "/files", gone_token, **files)]
        check(got == [(4401, "revoked"), (4401, "unknown_token"), (4401, "no_token"), (401, "revoked")],
              "revoked, unknown and no token are three different answers", repr(got))

        print("\n5. `devices`")
        lines = {ln.split()[1]: ln for ln in run_cli(cli.cmd_devices).splitlines()}
        check("tunnel" in lines["laptop"] and f"from={RETRIER}" in lines["laptop"]
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

    print("\n8. `remote-ai-chat unlock`, against a daemon that is running")
    srv, _ = start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    cfg = Config.load()
    cfg.port = port
    cfg.save()
    daemon = uvicorn.Server(uvicorn.Config(srv.app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=daemon.run, daemon=True)
    thread.start()
    while not daemon.started:
        time.sleep(0.05)
    try:
        def get(token: str) -> int:
            return httpx.get(f"http://127.0.0.1:{port}/files", params=files["params"], headers={
                "Authorization": f"Bearer {token}", "CF-Connecting-IP": ELSEWHERE,
                "Cf-Access-Jwt-Assertion": signed()}).status_code
        got = [get(f"cli-guess-{i}") for i in range(5)] + [get(panel)]
        printed = run_cli(cli.cmd_unlock, addr=ELSEWHERE)
        after = get(panel)
        again = run_cli(cli.cmd_unlock, addr=ELSEWHERE)
    finally:
        daemon.should_exit = True
        thread.join(10)
    check(got == [401] * 6 and printed.strip() == f"unlocked {ELSEWHERE}" and after == 200,
          "five guesses lock it, `unlock` lifts it in the running daemon, the right token is served",
          repr((got, printed, after)))
    check(again.strip() == f"{ELSEWHERE} was not locked", "and a second unlock says there was nothing", again)
    check(not any(d.name == "cli" for d in Config.load().devices.values()),
          "the device minted for the call is gone again")

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
