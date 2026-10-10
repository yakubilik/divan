"""The machines this daemon speaks for: a shared directory and a gateway.

A browser on the panel's HTTPS address can only open secure sockets to that
same address. Every other computer on the tailnet answers plain `ws://` on a
`100.x` address, which such a page is not allowed to dial — so the panel
behind the tunnel could only ever see the computer that served it, and each
browser kept its own list of computers besides.

So the computer that serves the panel keeps the list, and reaches the others on
the browser's behalf. A peer is registered once, explicitly, with a pairing
link its own `divan pair` printed; the link's token becomes this daemon's
credential on that computer and never leaves this file again. A browser asks
`fleet.list` for the names and addresses, and opens `/peer/<id>/ws` on the
page's own origin with its own token. That token is checked here exactly as a
token on `/ws` is — the same doors, the same tunnel lock, the same Access
sign-in — and the socket is relayed to the peer with the peer's credential.

What a peer is not: any computer that happens to be on the tailnet. Nothing
here discovers anything. A computer is a Divan machine because somebody pasted
its pairing link.

Credentials live in `peers.json` next to config.toml, readable by this user
only. No answer to a client carries one: `public()` is the only shape a peer is
ever sent in.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import secrets
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

log = logging.getLogger("rac.fleet")

#: How long dialling a peer may take before it counts as unreachable. A peer
#: that is asleep should not hold a browser's socket open for a minute.
CONNECT_TIMEOUT_S = 6.0
#: How long a peer has to answer the one request a registration makes.
ANSWER_TIMEOUT_S = 15.0
#: Messages from a daemon can be a whole chat's history; the websockets
#: library's default of 1 MiB would cut a long one off.
MAX_MESSAGE = 64 * 1024 * 1024

#: Requests a browser may not send a peer through the gateway. The credential
#: is this daemon's, shared by every browser that may use it: one tab revoking
#: it would take the computer away from all of them, and is what
#: `fleet.remove` is for.
BLOCKED = {"device.revoke_self"}


class PeerError(Exception):
    """A peer that could not be registered or reached, with a stable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Peer:
    id: str
    name: str
    host: str
    port: int
    token: str
    # The device id the peer gave this credential, so `fleet.remove` and its
    # own `devices` list can be matched up.
    device_id: str | None = None
    # Whose credential this is: the person whose device registered it. Only
    # that person's devices may see or use it. None on a computer with nobody
    # listed in `people`, where everybody is the one person.
    owner: str | None = None
    created_at: float = field(default_factory=time.time)

    @property
    def addr(self) -> str:
        return f"{self.host}:{self.port}"

    def public(self) -> dict:
        """What a client is told about this peer. Never the token."""
        return {"id": self.id, "name": self.name, "host": self.host, "port": self.port,
                "addr": self.addr, "owner": self.owner}


def parse_link(link: str) -> dict:
    """The fields of a pairing link, its QR JSON, or a panel `#t=` link.

    Raises PeerError("bad_link") for anything else. Validates the address
    shape too, so nothing below has to: an IP or a hostname, and a port.
    """
    text = (link or "").strip()
    if not text:
        raise PeerError("bad_link", "that is not a pairing link")
    fields: dict = {}
    try:
        j = json.loads(text)
        if isinstance(j, dict):
            fields = {k: j.get(k) for k in ("host", "port", "token", "name", "device_id")}
    except ValueError:
        parts = urlsplit(text)
        q = {k: v[0] for k, v in parse_qs(parts.query).items() if v}
        if parts.fragment and "t=" in parts.fragment:
            f = {k: v[0] for k, v in parse_qs(parts.fragment).items() if v}
            q = {"token": f.get("t"), "host": f.get("h"), "port": f.get("p"),
                 "name": f.get("n"), "device_id": f.get("d")}
        fields = {k: q.get(k) for k in ("host", "port", "token", "name", "device_id")}
    host = str(fields.get("host") or "").strip()
    token = str(fields.get("token") or "").strip()
    try:
        port = int(fields.get("port") or 8790)
    except (TypeError, ValueError):
        port = 0
    if not host or not token or not (0 < port < 65536):
        raise PeerError("bad_link", "that is not a pairing link")
    if not _host_ok(host):
        raise PeerError("bad_link", "the address in that link is not one a computer answers on")
    return {"host": host, "port": port, "token": token,
            "name": str(fields.get("name") or host)[:80],
            "device_id": (str(fields["device_id"])[:40] if fields.get("device_id") else None)}


def _host_ok(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    labels = host.split(".")
    return len(host) <= 253 and all(
        0 < len(x) <= 63 and x.replace("-", "").isalnum() and not x.startswith("-")
        for x in labels)


def upstream_url(peer: Peer) -> str:
    return f"ws://{peer.host}:{peer.port}/ws"


def http_base(peer: Peer) -> str:
    return f"http://{peer.host}:{peer.port}"


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def dial(host: str, port: int, token: str):
    """An open, authenticated socket to a peer, or PeerError.

    The token goes in a header rather than the query string, so it is not in
    any access log on the way. A peer that refuses it closes with 4401 straight
    after accepting; that is waited for here, so a socket handed back is one
    that was let in.
    """
    import websockets
    uri = f"ws://{host}:{port}/ws"
    try:
        ws = await asyncio.wait_for(
            websockets.connect(uri, additional_headers=auth_headers(token),
                               max_size=MAX_MESSAGE, open_timeout=CONNECT_TIMEOUT_S),
            CONNECT_TIMEOUT_S + 1)
    except Exception as exc:
        raise PeerError("peer_unreachable", f"{host}:{port} did not answer") from exc
    # Every accepted connection opens with `host.status`; a refused one closes.
    try:
        first = await asyncio.wait_for(ws.recv(), ANSWER_TIMEOUT_S)
    except Exception as exc:
        code = getattr(getattr(exc, "rcvd", None), "code", None)
        await _close(ws)
        if code in (4401, 1008):
            raise PeerError("peer_refused", f"{host}:{port} refused the credential") from exc
        raise PeerError("peer_unreachable", f"{host}:{port} did not answer") from exc
    return ws, first


async def probe(host: str, port: int, token: str) -> dict:
    """Prove a credential works, and learn the computer's own name."""
    ws, first = await dial(host, port, token)
    try:
        try:
            msg = json.loads(first)
        except ValueError:
            msg = {}
        if msg.get("event") != "host.status":
            raise PeerError("peer_unreachable", f"{host}:{port} is not a Divan computer")
        return msg.get("data") or {}
    finally:
        await _close(ws)


async def revoke(peer: Peer) -> bool:
    """Tell the peer to forget this daemon's credential. Best effort."""
    try:
        ws, _ = await dial(peer.host, peer.port, peer.token)
    except PeerError:
        return False
    try:
        await ws.send(json.dumps({"id": 1, "type": "device.revoke_self", "data": {}}))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), ANSWER_TIMEOUT_S))
            if msg.get("id") == 1:
                return msg.get("type") == "ok"
    except Exception:
        return False
    finally:
        await _close(ws)


async def _close(ws) -> None:
    try:
        await ws.close()
    except Exception:
        pass


def filter_request(raw: str) -> tuple[str | None, dict | None]:
    """A browser's message on its way to a peer.

    Returns what to forward (or None) and, for a request that is answered here
    instead, the answer. `hello` loses its `device_name`: the peer's device is
    this daemon's credential, and every tab renaming it after itself would make
    the peer's device list say whichever tab spoke last.
    """
    try:
        req = json.loads(raw)
    except ValueError:
        return raw, None
    if not isinstance(req, dict):
        return raw, None
    typ = req.get("type")
    if typ in BLOCKED:
        return None, {"id": req.get("id"), "type": "error",
                      "data": {"code": "forbidden",
                               "message": "unpair this computer from the machine list instead"}}
    if typ == "hello" and isinstance(req.get("data"), dict) and "device_name" in req["data"]:
        req = {**req, "data": {k: v for k, v in req["data"].items() if k != "device_name"}}
        return json.dumps(req), None
    return raw, None


class Directory:
    """`peers.json`: the registered peers, with their credentials.

    Re-read when the file changes under the daemon, so `divan peer add` from a
    shell takes effect without a restart, the way `divan pair` does.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self.peers: dict[str, Peer] = {}
        self._mtime: int | None = None
        self.reload()

    def _stat(self) -> int | None:
        try:
            return self.path.stat().st_mtime_ns
        except OSError:
            return None

    def reload(self) -> None:
        mtime = self._stat()
        if mtime == self._mtime:
            return
        self._mtime = mtime
        if mtime is None:
            self.peers = {}
            return
        try:
            raw = json.loads(self.path.read_text())
        except (OSError, ValueError):
            log.warning("peers.json could not be read; keeping the peers already known")
            return
        known = Peer.__dataclass_fields__
        peers = {}
        for pid, p in (raw.get("peers") or {}).items():
            if isinstance(p, dict):
                try:
                    peers[pid] = Peer(id=pid, **{k: v for k, v in p.items() if k in known and k != "id"})
                except TypeError:
                    continue
        self.peers = peers

    def save(self) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        data = {"peers": {p.id: {k: v for k, v in asdict(p).items() if k != "id"}
                          for p in self.peers.values()}}
        tmp = self.path.with_suffix(".tmp")
        # Created private rather than chmod'ed after: there is no moment the
        # credentials sit in a file somebody else could read.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(self.path)
        self._mtime = self._stat()

    def all(self) -> list[Peer]:
        self.reload()
        return sorted(self.peers.values(), key=lambda p: p.created_at)

    def get(self, pid: str) -> Peer | None:
        self.reload()
        return self.peers.get(pid)

    def find(self, host: str, port: int) -> Peer | None:
        for p in self.all():
            if p.host == host and p.port == port:
                return p
        return None

    def put(self, fields: dict, name: str, owner: str | None) -> tuple[Peer, Peer | None]:
        """Register a peer, or replace the credential of the one at that address.

        One computer is one row: pairing it again swaps the credential and
        keeps the id, so a browser already showing it keeps showing one row.
        Returns the peer and the one it replaced, whose credential the caller
        should revoke.
        """
        old = self.find(fields["host"], fields["port"])
        peer = Peer(id=old.id if old else secrets.token_hex(6), name=name,
                    host=fields["host"], port=fields["port"], token=fields["token"],
                    device_id=fields.get("device_id"), owner=owner if not old else old.owner,
                    created_at=old.created_at if old else time.time())
        self.peers[peer.id] = peer
        self.save()
        return peer, (old if old and old.token != peer.token else None)

    def remove(self, pid: str) -> Peer | None:
        self.reload()
        gone = self.peers.pop(pid, None)
        if gone is not None:
            self.save()
        return gone
