"""Plane, served from inside Divan.

Plane (plane.so) is the board; it runs on another computer and answers at
`[plane] url`. Divan shows it as one of its two faces, in a frame of the
panel's own page, so it is reached through Divan rather than beside it: this
is a small reverse proxy on the daemon's port + 1 that hands every request to
that Plane and the answer back.

Why a second port rather than a path on the first: Plane's pages and API live
at the root (`/api`, `/auth`, `/assets`, `/<workspace>/…`, and its sign-in page
is `/` itself), and a frame that navigates to `/` would load Divan inside
Divan. A second origin on the same site keeps the two apart while the browser
still treats them as one site, so Plane's sign-in cookie travels in the frame.

What it changes on the way through, and only this:
  - `X-Frame-Options: DENY` is dropped and `frame-ancestors` names the panel's
    own origins, so Plane can be framed by Divan and by nobody else.
  - A `Location` that points at Plane's own address is pointed back at this
    gateway, so a sign-in lands here and not on the other computer.
  - `Origin` and `Referer` are rewritten to Plane's own address, so its CSRF
    check sees the origin it was configured with.
  - The gate's own cookie is not passed on.

The door. Off the tunnel (tailnet, loopback) it is the network's, exactly as
Plane on the other computer already is. On the tunnel — the request carries
`CF-Connecting-IP` — nothing is served without a pass: a short-lived signed
cookie that only the daemon's own `/plane/pass` hands out, and only to a
device that got through Divan's whole door (address or Access, then device
token). The cookie is scoped to the domain the panel and the gateway share,
so the panel sets it and the frame carries it.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import websockets

log = logging.getLogger("divan.plane")

PASS_COOKIE = "divan_plane"
PASS_TTL_S = 12 * 3600

# Hop-by-hop headers (RFC 9110 §7.6.1) and what the proxy writes itself.
_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host",
}
_WS_SKIP = _HOP | {
    "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions",
    "sec-websocket-accept", "sec-websocket-protocol", "content-length",
}


# ── the pass ──────────────────────────────────────────────────────────────
def load_key(path: Path) -> bytes:
    """The gate's signing key, made once and kept beside the config, so a
    restart does not sign everybody out of the board."""
    try:
        key = path.read_bytes()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_bytes(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


def mint(key: bytes, now: float | None = None) -> str:
    exp = int((now if now is not None else time.time()) + PASS_TTL_S)
    sig = hmac.new(key, str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def valid(key: bytes, value: str | None, now: float | None = None) -> bool:
    if not value or "." not in value:
        return False
    exp, sig = value.split(".", 1)
    if not exp.isdigit():
        return False
    want = hmac.new(key, exp.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, sig):
        return False
    return int(exp) > (now if now is not None else time.time())


def shared_domain(a: str, b: str) -> str:
    """The domain two host names share, for a cookie both are sent: at least
    two labels, never a bare TLD, never an IP address. "" when there is none."""
    a, b = a.split(":")[0].lower(), b.split(":")[0].lower()
    if not a or not b or a.replace(".", "").isdigit() or b.replace(".", "").isdigit():
        return ""
    la, lb = a.split("."), b.split(".")
    common = []
    for x, y in zip(reversed(la), reversed(lb)):
        if x != y:
            break
        common.append(x)
    return ".".join(reversed(common)) if len(common) >= 2 else ""


def _cookies(raw: str) -> dict[str, str]:
    out = {}
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k:
            out[k] = v
    return out


def _without_pass(raw: str) -> str:
    return "; ".join(p.strip() for p in raw.split(";")
                     if p.strip() and not p.strip().startswith(PASS_COOKIE + "="))


# ── the gateway ───────────────────────────────────────────────────────────
class PlaneGateway:
    """An ASGI app: everything that reaches it goes to Plane."""

    def __init__(self, upstream: str, key: bytes, ancestors: list[str]) -> None:
        u = urlsplit(upstream.rstrip("/"))
        self.upstream = f"{u.scheme}://{u.netloc}"
        self.up_host = u.netloc
        self.key = key
        # Who may frame Plane: the panel's own origins.
        self.ancestors = " ".join(sorted(set(a.rstrip("/") for a in ancestors if a)))
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0),
                                        follow_redirects=False)

    # who is asking, and from where
    @staticmethod
    def _headers(scope) -> dict[str, str]:
        return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

    def _origin(self, scope, h: dict[str, str]) -> str:
        """This gateway's origin as the browser sees it."""
        tunnelled = "cf-connecting-ip" in h
        proto = h.get("x-forwarded-proto") or ("https" if tunnelled else
                                                 ("https" if scope.get("scheme") in ("https", "wss") else "http"))
        host = h.get("host") or self.up_host
        return f"{proto}://{host}"

    def _admitted(self, h: dict[str, str]) -> bool:
        if "cf-connecting-ip" not in h:
            return True  # tailnet or loopback: the network is the door
        return valid(self.key, _cookies(h.get("cookie", "")).get(PASS_COOKIE))

    def _upstream_headers(self, h: dict[str, str], skip: set[str]) -> list[tuple[str, str]]:
        out = []
        for k, v in h.items():
            if k in skip or k.startswith("cf-") or k in ("x-forwarded-proto", "x-forwarded-for", "cdn-loop"):
                continue
            if k == "cookie":
                v = _without_pass(v)
                if not v:
                    continue
            elif k == "origin":
                v = self.upstream
            elif k == "referer":
                p = urlsplit(v)
                v = self.upstream + (p.path or "/") + (f"?{p.query}" if p.query else "")
            out.append((k, v))
        # httpx asks for gzip when nothing is said, and the body is passed on
        # as it came: a client that did not ask must not get it compressed.
        if "accept-encoding" not in h:
            out.append(("accept-encoding", "identity"))
        return out

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            while True:
                msg = await receive()
                if msg["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif msg["type"] == "lifespan.shutdown":
                    await self.client.aclose()
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        h = self._headers(scope)
        if not self._admitted(h):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 4401})
                return
            body = (b"<!doctype html><meta charset=utf-8><title>Divan</title>"
                    b"<body style=\"font:15px system-ui;padding:40px;color:#888\">"
                    b"Open the board from Divan.</body>")
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"text/html; charset=utf-8"),
                                    (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": body})
            return
        if scope["type"] == "websocket":
            await self._ws(scope, receive, send, h)
        else:
            await self._http(scope, receive, send, h)

    async def _http(self, scope, receive, send, h) -> None:
        path = scope.get("raw_path") or scope["path"].encode()
        url = self.upstream + path.decode("latin-1")
        if scope.get("query_string"):
            url += "?" + scope["query_string"].decode("latin-1")

        async def body():
            while True:
                msg = await receive()
                if msg["type"] == "http.disconnect":
                    return
                chunk = msg.get("body", b"")
                if chunk:
                    yield chunk
                if not msg.get("more_body"):
                    return

        method = scope["method"]
        has_body = method not in ("GET", "HEAD", "OPTIONS") or "content-length" in h
        req = self.client.build_request(
            method, url, headers=self._upstream_headers(h, _HOP),
            content=body() if has_body else None)
        try:
            r = await self.client.send(req, stream=True)
        except httpx.HTTPError as e:
            log.warning("plane unreachable: %s", e)
            msg = b"Plane does not answer."
            await send({"type": "http.response.start", "status": 502,
                        "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
            await send({"type": "http.response.body", "body": msg})
            return
        try:
            headers = self._response_headers(r.headers.multi_items(), self._origin(scope, h))
            await send({"type": "http.response.start", "status": r.status_code, "headers": headers})
            async for chunk in r.aiter_raw():
                await send({"type": "http.response.body", "body": chunk, "more_body": True})
            await send({"type": "http.response.body", "body": b""})
        finally:
            await r.aclose()

    def _response_headers(self, items, origin: str) -> list[tuple[bytes, bytes]]:
        out = []
        for k, v in items:
            lk = k.lower()
            if lk in _HOP or lk == "x-frame-options":
                continue
            if lk == "content-security-policy":
                v = "; ".join(d for d in (p.strip() for p in v.split(";"))
                              if d and not d.lower().startswith("frame-ancestors"))
                if not v:
                    continue
            if lk == "location" and v.startswith(self.upstream):
                v = origin + v[len(self.upstream):]
            out.append((lk.encode("latin-1"), v.encode("latin-1")))
        out.append((b"content-security-policy",
                    f"frame-ancestors 'self' {self.ancestors}".strip().encode("latin-1")))
        return out

    async def _ws(self, scope, receive, send, h) -> None:
        path = scope.get("raw_path") or scope["path"].encode()
        url = "ws" + self.upstream[4:] + path.decode("latin-1")
        if scope.get("query_string"):
            url += "?" + scope["query_string"].decode("latin-1")
        protocols = [p.strip() for p in h.get("sec-websocket-protocol", "").split(",") if p.strip()]
        msg = await receive()  # websocket.connect
        if msg["type"] != "websocket.connect":
            return
        try:
            up = await websockets.connect(
                url, additional_headers=self._upstream_headers(h, _WS_SKIP | {"origin"}),
                origin=self.upstream, subprotocols=protocols or None,
                open_timeout=10, ping_interval=None, max_size=None)
        except Exception as e:  # noqa: BLE001 - any failure is "Plane does not answer"
            log.warning("plane websocket refused: %s", e)
            await send({"type": "websocket.close", "code": 1011})
            return
        await send({"type": "websocket.accept", "subprotocol": up.subprotocol})

        async def down():
            try:
                async for m in up:
                    if isinstance(m, bytes):
                        await send({"type": "websocket.send", "bytes": m})
                    else:
                        await send({"type": "websocket.send", "text": m})
            except websockets.ConnectionClosed:
                pass

        async def upward():
            while True:
                m = await receive()
                if m["type"] == "websocket.disconnect":
                    return
                if m.get("bytes") is not None:
                    await up.send(m["bytes"])
                elif m.get("text") is not None:
                    await up.send(m["text"])

        tasks = [asyncio.create_task(down()), asyncio.create_task(upward())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            await up.close()
            try:
                await send({"type": "websocket.close", "code": 1000})
            except Exception:  # noqa: BLE001 - already closed
                pass
