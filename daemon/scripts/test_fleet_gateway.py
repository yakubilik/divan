#!/usr/bin/env python3
"""The shared machine directory and the gateway to its peers (divan/fleet.py).

    python scripts/test_fleet_gateway.py

A real `Server` over a temporary `DIVAN_HOME`, driven through a test client,
and a stand-in peer daemon on a real loopback port that answers like a Divan
computer and writes down every token it is shown. No model turns.

The promises:

  1. Only an authenticated device registers a peer, only with a link the peer
     accepts, and the directory is shared: every device of the same person
     sees the same rows, and re-pairing keeps one row per computer.
  2. No answer, event or listing carries a peer credential; peers.json is
     private to this user; the peer never sees a browser's token.
  3. The gateway keeps the doors: a refused browser token is a 4401, a tunnel
     device off the tunnel is refused, another person's peer is invisible.
  4. A peer that goes away is offline without touching the browser's token or
     the home computer, and is reachable again without re-pairing.
"""
from __future__ import annotations

import argparse
import asyncio
import atexit
import contextlib
import io
import json
import os
import shutil
import socket
import stat
import sys
import tempfile
import threading
import time
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-fleet-")
os.environ["DIVAN_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tomli_w                                                   # noqa: E402
import uvicorn                                                   # noqa: E402
from fastapi import FastAPI, Request, WebSocket                  # noqa: E402
from fastapi.responses import JSONResponse                       # noqa: E402
from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

import divan.__main__ as cli                                     # noqa: E402
from divan import fleet                                          # noqa: E402
from divan.config import CONFIG_PATH, Config                     # noqa: E402
from divan.server import Server                                  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


# ── a stand-in peer ─────────────────────────────────────────────────────────

PEER_TOKEN = "peer-credential-" + "x" * 32
OLD_PEER_TOKEN = "peer-credential-old-" + "y" * 28


class FakePeer:
    """Enough of a Divan daemon to be dialled: a socket that takes one token,
    greets with `host.status`, answers every request with what it was sent,
    and `/files` and `/upload` that say what they were shown."""

    def __init__(self) -> None:
        self.tokens = {PEER_TOKEN, OLD_PEER_TOKEN}
        self.seen_auth: list[str] = []
        self.seen_query: list[str] = []
        self.requests: list[dict] = []
        self.port = _free_port()
        self.app = FastAPI()
        self.app.websocket("/ws")(self.ws)
        self.app.api_route("/{rest:path}", methods=["GET", "POST"])(self.http)
        self.server: uvicorn.Server | None = None

    async def ws(self, ws: WebSocket) -> None:
        auth = ws.headers.get("authorization", "")
        self.seen_auth.append(auth)
        self.seen_query.append(str(ws.url.query))
        await ws.accept()
        token = auth[7:] if auth.lower().startswith("bearer ") else ws.query_params.get("token", "")
        if token not in self.tokens:
            await ws.close(code=4401, reason="unknown_token")
            return
        await ws.send_text(json.dumps({"type": "event", "event": "host.status", "chat_id": None,
                                       "seq": None, "ts": time.time(),
                                       "data": {"name": "Cinema PC", "started_at": 1.0}}))
        try:
            while True:
                req = json.loads(await ws.receive_text())
                self.requests.append({**req, "token": token})
                if req.get("type") == "device.revoke_self":
                    self.tokens.discard(token)
                await ws.send_text(json.dumps({"id": req.get("id"), "type": "ok",
                                               "data": {"echo": req.get("type"), "data": req.get("data")}}))
        except Exception:
            pass

    async def http(self, request: Request, rest: str):
        auth = request.headers.get("authorization", "")
        self.seen_auth.append(auth)
        self.seen_query.append(str(request.url.query))
        if auth[7:] not in self.tokens:
            return JSONResponse({"detail": "unknown_token"}, status_code=401)
        body = await request.body()
        return JSONResponse({"path": rest, "query": dict(request.query_params), "size": len(body)},
                            headers={"Content-Disposition": "attachment; filename=x.txt"})

    def start(self) -> None:
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port,
                                                    log_level="warning", ws="websockets"))
        threading.Thread(target=self.server.run, daemon=True).start()
        for _ in range(100):
            if self.server.started:
                return
            time.sleep(0.05)
        raise RuntimeError("fake peer did not start")

    def stop(self) -> None:
        if self.server:
            self.server.should_exit = True
            for _ in range(100):
                if not self.server.started or _port_closed(self.port):
                    break
                time.sleep(0.05)
            time.sleep(0.2)
        self.server = None

    def link(self, token: str = PEER_TOKEN) -> str:
        return f"divan://pair?host=127.0.0.1&port={self.port}&token={token}&name=desktop&device_id=abc123"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _port_closed(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


# ── the home daemon ─────────────────────────────────────────────────────────

def configure(**settings) -> None:
    raw = tomllib.loads(CONFIG_PATH.read_text())
    before = CONFIG_PATH.stat().st_mtime_ns
    CONFIG_PATH.write_text(tomli_w.dumps({**raw, **settings}))
    if CONFIG_PATH.stat().st_mtime_ns <= before:
        os.utime(CONFIG_PATH, ns=(before + 1, before + 1))


def ws_call(client: TestClient, token: str, typ: str, data: dict | None = None,
            path: str = "/ws", headers: dict | None = None) -> tuple[dict, list[str]]:
    """One request; the answer, and every raw frame the socket carried."""
    frames: list[str] = []
    with client.websocket_connect(f"{path}?token={token}", headers=headers or {}) as ws:
        ws.send_text(json.dumps({"id": 7, "type": typ, "data": data or {}}))
        while True:
            raw = ws.receive_text()
            frames.append(raw)
            msg = json.loads(raw)
            if msg.get("id") == 7:
                return msg, frames


def ws_refusal(client: TestClient, path: str, token: str, headers: dict | None = None) -> object:
    """How a socket was turned away: its close code, or 'open' if it was let in."""
    try:
        with client.websocket_connect(f"{path}?token={token}", headers=headers or {}) as ws:
            ws.receive_text()
            ws.send_text(json.dumps({"id": 1, "type": "ping", "data": {}}))
            ws.receive_text()
            return "open"
    except WebSocketDisconnect as exc:
        return exc.code


def main() -> None:
    peer = FakePeer()
    peer.start()
    cfg = Config.load()
    _, owner_tok = cfg.add_device("Yakup browser")
    other_dev, other_tok = cfg.add_device("Bedirhan laptop")
    _, tunnel_tok = cfg.add_device("tunnel browser", tunnel=True)
    configure(people={"Yakup": [], "Bedirhan": [other_dev.id]}, tunnel_allow_ips=["203.0.113.4"])
    srv = Server(Config.load())
    client = TestClient(srv.app)
    peers_file = Path(HOME) / "peers.json"
    try:
        run(srv, client, peer, peers_file, owner_tok, other_tok, tunnel_tok)
    finally:
        client.close()
        peer.stop()
    print()
    if failures:
        print(f"{len(failures)} failed")
        sys.exit(1)
    print("all ok")


def run(srv: Server, client: TestClient, peer: FakePeer, peers_file: Path,
        owner_tok: str, other_tok: str, tunnel_tok: str) -> None:
    print("── registering a peer")
    code = ws_refusal(client, "/ws", "not-a-token")
    check(code == 4401, "an unknown token cannot reach fleet.add at all", str(code))

    ans, _ = ws_call(client, owner_tok, "fleet.add", {"link": "https://example.com/"})
    check(ans["type"] == "error" and ans["data"]["code"] == "bad_link", "a link that is not a pairing link is refused", str(ans))
    ans, _ = ws_call(client, owner_tok, "fleet.add", {"link": peer.link("wrong-token")})
    check(ans["type"] == "error" and ans["data"]["code"] == "peer_refused",
          "a token the peer refuses is not registered", str(ans))
    dead = f"divan://pair?host=127.0.0.1&port={_free_port()}&token=abc"
    ans, _ = ws_call(client, owner_tok, "fleet.add", {"link": dead})
    check(ans["type"] == "error" and ans["data"]["code"] == "peer_unreachable",
          "a computer that does not answer is not registered", str(ans))
    check(not peers_file.exists(), "nothing was written by a refused registration")

    # The first credential, later replaced by a second pairing of the same computer.
    ans, frames = ws_call(client, owner_tok, "fleet.add", {"link": peer.link(OLD_PEER_TOKEN)})
    check(ans["type"] == "ok", "a good pairing link registers the peer", str(ans))
    first_id = ans["data"].get("id")
    check(ans["data"].get("name") == "Cinema PC", "the row carries the name the peer reports", str(ans))
    ans, frames = ws_call(client, owner_tok, "fleet.add", {"link": peer.link()})
    pid = ans["data"].get("id")
    check(pid == first_id, "pairing the same computer again keeps its one row", f"{first_id} {pid}")
    check(len(srv.peers.all()) == 1, "the directory has exactly one row", str(srv.peers.all()))
    for _ in range(50):
        if OLD_PEER_TOKEN not in peer.tokens:
            break
        time.sleep(0.05)
    check(OLD_PEER_TOKEN not in peer.tokens, "the replaced credential is revoked on the peer")

    print("── no credential in any answer")
    blob = "".join(frames)
    check(PEER_TOKEN not in blob and OLD_PEER_TOKEN not in blob, "fleet.add's answer and events carry no credential")
    lst, frames = ws_call(client, owner_tok, "fleet.list")
    check([p["id"] for p in lst["data"]["peers"]] == [pid], "fleet.list lists the peer", str(lst))
    check(PEER_TOKEN not in "".join(frames) and "token" not in lst["data"]["peers"][0],
          "fleet.list carries no credential", str(lst))
    mode = stat.S_IMODE(peers_file.stat().st_mode)
    check(sys.platform == "win32" or mode == 0o600, "peers.json is readable by this user only", oct(mode))
    check(PEER_TOKEN in peers_file.read_text(), "the credential is kept on disk for the gateway")

    print("── one directory, every device of the person")
    _, fresh_tok = srv.cfg.add_device("fresh browser")
    lst2, _ = ws_call(client, fresh_tok, "fleet.list")
    check([p["id"] for p in lst2["data"]["peers"]] == [pid], "a freshly paired browser sees the same peer", str(lst2))
    srv2 = Server(Config.load())
    check([p.id for p in srv2.peers.all()] == [pid], "a restarted daemon still has it")

    print("── the gateway")
    peer.seen_auth.clear(); peer.seen_query.clear()
    ans, frames = ws_call(client, owner_tok, "chat.create", {"provider": "claude", "cwd": "C:/x"},
                          path=f"/peer/{pid}/ws")
    check(json.loads(frames[0]).get("data", {}).get("name") == "Cinema PC",
          "the socket opens with the peer's own host.status", frames[0][:120])
    check(ans["type"] == "ok" and ans["data"]["echo"] == "chat.create",
          "a request is answered by the peer, not by this computer", str(ans))
    check(peer.seen_auth == [f"Bearer {PEER_TOKEN}"], "the peer is shown the gateway's credential", str(peer.seen_auth))
    check(not any(owner_tok in q for q in peer.seen_query + peer.seen_auth),
          "the peer never sees the browser's token")
    ans, _ = ws_call(client, owner_tok, "hello", {"device_name": "Cinema PC", "lang": "en"}, path=f"/peer/{pid}/ws")
    check(ans["data"]["data"] == {"lang": "en"}, "hello does not rename the gateway's device on the peer", str(ans))
    before = len(peer.requests)
    ans, _ = ws_call(client, owner_tok, "device.revoke_self", {}, path=f"/peer/{pid}/ws")
    check(ans["type"] == "error" and len(peer.requests) == before and PEER_TOKEN in peer.tokens,
          "a browser cannot revoke the shared credential through the gateway", str(ans))

    print("── the gateway keeps the doors")
    check(ws_refusal(client, f"/peer/{pid}/ws", "not-a-token") == 4401, "an unknown browser token is a 4401")
    check(ws_refusal(client, f"/peer/{pid}/ws", "") == 4401, "no token is a 4401")
    check(ws_refusal(client, f"/peer/{pid}/ws", tunnel_tok) == 4401, "a tunnel device off the tunnel is refused")
    check(ws_refusal(client, f"/peer/{pid}/ws", owner_tok, {"CF-Connecting-IP": "203.0.113.4"}) == 4401,
          "a tailnet device through the tunnel is refused")
    code = ws_refusal(client, f"/peer/{pid}/ws", owner_tok, {"CF-Connecting-IP": "198.51.100.7"})
    check(code != "open", "an address the tunnel does not allow is refused", str(code))
    check(ws_refusal(client, f"/peer/{pid}/ws", tunnel_tok, {"CF-Connecting-IP": "203.0.113.4"}) == "open",
          "a tunnel device through the tunnel is let in")
    check(ws_refusal(client, "/peer/nope/ws", owner_tok) not in ("open", 4401),
          "an unknown peer is declined without blaming the browser's token")

    print("── ownership")
    lst3, _ = ws_call(client, other_tok, "fleet.list")
    check(lst3["data"]["peers"] == [], "another person does not see the peer", str(lst3))
    check(ws_refusal(client, f"/peer/{pid}/ws", other_tok) not in ("open", 4401),
          "another person cannot use the gateway to it")
    r = client.get(f"/peer/{pid}/files", params={"path": "/x", "token": other_tok})
    check(r.status_code == 404, "nor its files", str(r.status_code))
    ans, _ = ws_call(client, other_tok, "fleet.remove", {"id": pid})
    check(ans["type"] == "error" and ans["data"]["code"] == "no_peer" and srv.peers.get(pid),
          "nor remove it", str(ans))
    ans, _ = ws_call(client, other_tok, "fleet.add", {"link": peer.link()})
    check(ans["type"] == "error" and ans["data"]["code"] == "forbidden", "nor re-pair it as theirs", str(ans))

    print("── HTTP through the gateway")
    peer.seen_auth.clear(); peer.seen_query.clear()
    r = client.get(f"/peer/{pid}/files", params={"path": "C:/a.txt", "token": owner_tok})
    check(r.status_code == 200 and r.json()["path"] == "files" and r.json()["query"] == {"path": "C:/a.txt"},
          "a file is fetched from the peer", r.text[:200])
    check(peer.seen_auth == [f"Bearer {PEER_TOKEN}"] and owner_tok not in "".join(peer.seen_query),
          "with the gateway's credential, never the browser's", str(peer.seen_auth))
    check(r.headers.get("content-disposition", "").startswith("attachment"), "the download name rides along")
    r = client.post(f"/peer/{pid}/upload", headers={"Authorization": f"Bearer {owner_tok}"},
                    files={"file": ("a.txt", b"hello")}, data={"chat_id": "c1"})
    check(r.status_code == 200 and r.json()["path"] == "upload" and r.json()["size"] > 0,
          "an upload reaches the peer", r.text[:200])
    r = client.get(f"/peer/{pid}/files", params={"path": "/x", "token": "not-a-token"})
    check(r.status_code == 401, "a bad browser token is a 401 here", str(r.status_code))
    r = client.get(f"/peer/{pid}/health", params={"token": owner_tok})
    check(r.status_code == 404, "only the daemon's own routes are relayed", str(r.status_code))
    peer.tokens.discard(PEER_TOKEN)
    r = client.get(f"/peer/{pid}/files", params={"path": "/x", "token": owner_tok})
    check(r.status_code == 502, "the peer refusing the credential is a 502, not the browser's 401", str(r.status_code))
    code = ws_refusal(client, f"/peer/{pid}/ws", owner_tok)
    check(code not in ("open", 4401), "…and a declined socket, not a 4401", str(code))
    peer.tokens.add(PEER_TOKEN)

    print("── offline and back")
    peer.stop()
    code = ws_refusal(client, f"/peer/{pid}/ws", owner_tok)
    check(code not in ("open", 4401), "an unreachable peer is declined, not the browser's token", str(code))
    ans, _ = ws_call(client, owner_tok, "host.info")
    check(ans["type"] == "ok", "the home computer stays usable while the peer is away", str(ans)[:120])
    check(srv.peers.get(pid) is not None, "the peer stays registered while it is away")
    peer.start()
    check(ws_refusal(client, f"/peer/{pid}/ws", owner_tok) == "open", "it is reachable again without re-pairing")

    print("── this computer is not its own peer")
    srv.cfg.host_name = "home"
    home_tok = owner_tok
    srv_port = _free_port()
    daemon = uvicorn.Server(uvicorn.Config(srv.app, host="127.0.0.1", port=srv_port, log_level="warning"))
    threading.Thread(target=daemon.run, daemon=True).start()
    for _ in range(100):
        if daemon.started:
            break
        time.sleep(0.05)
    ans, _ = ws_call(client, owner_tok, "fleet.add",
                     {"link": f"divan://pair?host=127.0.0.1&port={srv_port}&token={home_tok}"})
    check(ans["type"] == "error" and ans["data"]["code"] == "peer_is_self", "a link for this computer is refused", str(ans))
    daemon.should_exit = True

    print("── the CLI")
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        cli.cmd_peer(argparse.Namespace(what="list", target="", owner=None))
    check(pid in out.getvalue() and PEER_TOKEN not in out.getvalue(), "peer list names it and prints no credential",
          out.getvalue())
    peer.tokens.add(OLD_PEER_TOKEN)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        cli.cmd_peer(argparse.Namespace(what="add", target=peer.link(OLD_PEER_TOKEN), owner=None))
    check("re-paired" in out.getvalue() and OLD_PEER_TOKEN not in out.getvalue(),
          "peer add from a shell re-pairs it without printing the credential", out.getvalue())
    lst, _ = ws_call(client, owner_tok, "fleet.list")
    check([p["id"] for p in lst["data"]["peers"]] == [pid], "the running daemon sees the shell's change, still one row")

    print("── unpairing")
    ans, frames = ws_call(client, owner_tok, "fleet.remove", {"id": pid})
    check(ans["type"] == "ok" and srv.peers.get(pid) is None, "the owner removes it", str(ans))
    for _ in range(50):
        if OLD_PEER_TOKEN not in peer.tokens:
            break
        time.sleep(0.05)
    check(OLD_PEER_TOKEN not in peer.tokens, "and the peer is told to forget the credential")
    check(ws_refusal(client, f"/peer/{pid}/ws", owner_tok) not in ("open", 4401), "the gateway to it is gone")

    print("── parse_link")
    f = fleet.parse_link(json.dumps({"host": "100.76.67.2", "port": 8790, "token": "t", "name": "PC"}))
    check(f["host"] == "100.76.67.2" and f["port"] == 8790, "the QR's JSON is a link too")
    f = fleet.parse_link("http://100.76.67.2:8790/#t=tok&h=100.76.67.2&p=8790&n=PC&d=dd")
    check(f["token"] == "tok" and f["device_id"] == "dd", "so is a panel link")
    for bad in ("divan://pair?host=a b&token=t", "divan://pair?host=x&port=99999&token=t", ""):
        try:
            fleet.parse_link(bad)
            check(False, f"refuses {bad!r}")
        except fleet.PeerError:
            check(True, f"refuses {bad!r}")


if __name__ == "__main__":
    main()
