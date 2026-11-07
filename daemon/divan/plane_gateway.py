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

The door. Nothing is served without a pass: a short-lived signed cookie that
only the daemon's own `/plane/pass` hands out, and only to a device that got
through Divan's whole door (on the tunnel: address or Access; everywhere: the
device token). On the tunnel it is scoped to the domain the panel and the
gateway share; on the tailnet it is the panel's host, which a browser sends to
every port of that host. So the panel sets it and the frame carries it.

One sign-in. The pass names whose device asked (`Config.person_of`), and a
person with a Plane session of their own (`divan plane-login`) is signed in
to Plane as themselves: a request that carries no Plane session gets theirs,
on the way up and as a cookie on the way back. A person without one sees
Plane's own sign-in, and nobody is ever signed in as somebody else.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Callable
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


def _sign(key: bytes, body: str) -> str:
    return hmac.new(key, body.encode(), hashlib.sha256).hexdigest()


def mint(key: bytes, person: str | None = None, now: float | None = None) -> str:
    """`<expiry>.<person, hex>.<signature>`: hex because a cookie value is
    no place for a name with a space or a dotless i in it."""
    exp = int((now if now is not None else time.time()) + PASS_TTL_S)
    body = f"{exp}.{(person or '').encode().hex()}"
    return f"{body}.{_sign(key, body)}"


def holder(key: bytes, value: str | None, now: float | None = None) -> str | None:
    """Whose the pass is ("" for nobody in particular), or None when it is not
    a pass: forged, expired, or not there."""
    if not value or value.count(".") != 2:
        return None
    exp, who, sig = value.split(".")
    if not exp.isdigit() or not hmac.compare_digest(_sign(key, f"{exp}.{who}"), sig):
        return None
    if int(exp) <= (now if now is not None else time.time()):
        return None
    try:
        return bytes.fromhex(who).decode()
    except ValueError:
        return None


def valid(key: bytes, value: str | None, now: float | None = None) -> bool:
    return holder(key, value, now) is not None


def session_name(person: str) -> str:
    """The keychain name a person's Plane session is kept under:
    `rac-secret-plane-session-<person>`, the person folded to a-z0-9-."""
    import unicodedata
    folded = unicodedata.normalize("NFKD", person.replace("ı", "i").replace("İ", "I"))
    slug = re.sub(r"[^a-z0-9]+", "-", folded.encode("ascii", "ignore").decode().lower()).strip("-")
    return f"plane-session-{slug or person.encode().hex()[:40]}"


def stored_session(person: str) -> str | None:
    from . import secret_share
    return secret_share.read(secret_share.service_for(session_name(person)))


# The Django shell script that makes a session for one Plane user, run where
# Plane runs (`[plane] shell`, which reads the script on stdin). Prints the key
# on a line of its own after a marker; `{email}` is filled in as a literal.
MINT_SCRIPT = r"""
from importlib import import_module
from django.conf import settings
from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
from plane.db.models import User
email = {email}
u = User.objects.get(email__iexact=email, is_active=True)
s = import_module(settings.SESSION_ENGINE).SessionStore()
s[SESSION_KEY] = str(u.pk)
s[BACKEND_SESSION_KEY] = "django.contrib.auth.backends.ModelBackend"
s[HASH_SESSION_KEY] = u.get_session_auth_hash()
s["device_info"] = {"user_agent": "divan", "ip_address": "", "domain": "divan"}
s.set_expiry(365 * 86400)
s.create()
print("DIVAN-SESSION " + s.session_key)
"""


EMAIL = re.compile(r"^[^@\s'\"\\]+@[^@\s'\"\\]+\.[a-z]{2,}$", re.I)


def mint_session(shell: str, email: str, timeout: float = 120.0) -> str:
    """A new Plane session for `email`, made by Plane's own Django shell."""
    import shlex
    import subprocess
    if not EMAIL.match(email or ""):
        raise ValueError("not an email address")
    if not shell.strip():
        raise ValueError("[plane] shell is not set: the command that opens Plane's Django shell")
    r = subprocess.run(shlex.split(shell), input=MINT_SCRIPT.replace("{email}", repr(email)),
                       capture_output=True, text=True, timeout=timeout)
    for line in r.stdout.splitlines():
        if line.startswith("DIVAN-SESSION "):
            key = line.split(" ", 1)[1].strip()
            if re.fullmatch(r"[a-z0-9]{20,128}", key):
                return key
    tail = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["no answer"]
    raise RuntimeError(f"Plane made no session: {tail[0][:200]}")


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

    SESSION_COOKIE = "session-id"  # Plane's own (SESSION_COOKIE_NAME)
    SESSION_AGE_S = 30 * 86400

    def __init__(self, upstream: str, key: bytes, ancestors: list[str],
                 session_for: Callable[[str], str | None] | None = None) -> None:
        u = urlsplit(upstream.rstrip("/"))
        # A person's Plane session, or None: read where it is kept (the
        # keychain), each time, so a new sign-in needs no restart.
        self.session_for = session_for or (lambda person: None)
        self._sessions: dict[str, tuple[str | None, float]] = {}
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

    def _holder(self, h: dict[str, str]) -> str | None:
        return holder(self.key, _cookies(h.get("cookie", "")).get(PASS_COOKIE))

    SESSION_KEEP_S = 300.0

    async def _session(self, person: str) -> str | None:
        """The person's session, read from where it is kept at most every five
        minutes (a keychain read is a process, and Plane's page is dozens of
        requests), and never on the loop's own thread."""
        hit = self._sessions.get(person)
        if hit and time.monotonic() - hit[1] < self.SESSION_KEEP_S:
            return hit[0]
        try:
            value = await asyncio.to_thread(self.session_for, person) or None
        except Exception:  # noqa: BLE001 - no session is Plane's own sign-in
            log.warning("no Plane session for %s", person)
            value = None
        self._sessions[person] = (value, time.monotonic())
        return value

    async def _signed_in(self, h: dict[str, str]) -> str | None:
        """The session to sign this request in with: the person's own, when
        the browser carries none of its own. A browser that has one — signed
        in by hand, or by an earlier answer from here — keeps it."""
        if self.SESSION_COOKIE in _cookies(h.get("cookie", "")):
            return None
        person = self._holder(h)
        if not person:
            return None
        return await self._session(person)

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
        if self._holder(h) is None:
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
        session = await self._signed_in(h)
        if session:
            h = {**h, "cookie": "; ".join(c for c in (h.get("cookie", ""), f"{self.SESSION_COOKIE}={session}") if c)}
        if scope["type"] == "websocket":
            await self._ws(scope, receive, send, h)
        else:
            await self._http(scope, receive, send, h, session)

    async def _http(self, scope, receive, send, h, session: str | None = None) -> None:
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
            origin = self._origin(scope, h)
            headers = self._response_headers(r.headers.multi_items(), origin)
            # …and the browser keeps it, unless Plane has just said otherwise
            # (a sign-out answers with its own cookie).
            if session and not any(k == b"set-cookie" and v.startswith(f"{self.SESSION_COOKIE}=".encode())
                                   for k, v in headers):
                secure = "; Secure" if origin.startswith("https://") else ""
                headers.append((b"set-cookie", (
                    f"{self.SESSION_COOKIE}={session}; Max-Age={self.SESSION_AGE_S}; Path=/; "
                    f"HttpOnly; SameSite=Lax{secure}").encode("latin-1")))
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
