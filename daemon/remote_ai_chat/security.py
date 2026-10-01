"""Dangerous-command detection, path allowlist, secret redaction."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from contextvars import ContextVar
from pathlib import Path

import httpx
import jwt

log = logging.getLogger("rac.security")

DESTRUCTIVE_PATTERNS = [
    re.compile(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(/|~|\$HOME|\*)(\s|$)"),
    re.compile(r"\brm\s+-rf\s+\*"),
    re.compile(r"\bsudo\s+rm\b"),
    re.compile(r"\bdd\s+[^|]*\bof=/dev/"),
    re.compile(r"\bmkfs\."),
    re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),
    re.compile(r"\bshutdown\b"),
    re.compile(r"\breboot\b"),
    re.compile(r"\bgit\s+push\s+[^|]*--force\b"),
    re.compile(r"\bgit\s+push\s+[^|]*-f\b(?!\w)"),
    re.compile(r"\bgit\s+reset\s+--hard\b"),
    re.compile(r"security\s+delete-(keychain|generic-password|internet-password)"),
    re.compile(r">\s*/dev/(sd[a-z]|disk\d)"),
    re.compile(r"\blaunchctl\s+(unload|bootout|disable|remove)\b"),
    re.compile(r"\bkillall\s+-9\b"),
    re.compile(r"\bpkill\s+-9?\s*-f\s+remote[-_]ai[-_]chat"),
    re.compile(r"\.remote-ai-chat/(?!uploads/)"),   # daemon config / token store (uploads are fine)
]


def destructive_reason(cmd: str) -> str | None:
    if not cmd:
        return None
    for pat in DESTRUCTIVE_PATTERNS:
        if pat.search(cmd):
            return pat.pattern
    return None


SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"\b\d{9,10}:[A-Za-z0-9_\-]{35}\b"),   # telegram bot token
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[=:]\s*['\"]?([A-Za-z0-9_\-/+=]{16,})"),
]


def redact(text: str) -> str:
    if not text:
        return text
    for pat in SECRET_PATTERNS:
        if pat.groups:
            text = pat.sub(lambda m: m.group(0).replace(m.group(m.lastindex), "••••••"), text)
        else:
            text = pat.sub("••••••", text)
    return text


# Files the phone must never be handed even when they sit inside an allowed
# root: keys, credentials, the agent's own environment. The roots are for
# *code*; these are the things that live next to code and are not it.
UNSERVABLE_NAMES = re.compile(
    r"^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keychain(-db)?|jks))$",
    re.IGNORECASE,
)
UNSERVABLE_DIRS = {".git", ".ssh", ".aws", ".gnupg", ".config", ".remote-ai-chat", ".claude", ".codex"}


class PathPolicy:
    def __init__(self, allowed_roots: list[str], denied: list[str]):
        self.roots = [Path(p).expanduser().resolve() for p in allowed_roots]
        self.denied = [Path(p).expanduser().resolve() for p in denied]

    def is_servable(self, path: str | Path) -> bool:
        """May this file be handed to the phone over `/files`?

        Inside an allowed root, outside every denied path, a regular file, and
        not one of the names or folders that hold secrets. Symlinks are
        resolved first, so a link out of the root does not get out.
        """
        try:
            p = Path(path).expanduser().resolve(strict=True)
        except Exception:
            return False
        if not p.is_file():
            return False
        if any(p == d or d in p.parents for d in self.denied):
            return False
        if not any(r in p.parents for r in self.roots):
            return False
        if UNSERVABLE_NAMES.match(p.name):
            return False
        return not any(part in UNSERVABLE_DIRS for part in p.parts)

    def is_allowed_cwd(self, cwd: str) -> bool:
        return self.cwd_error(cwd) is None

    def cwd_error(self, cwd: str) -> str | None:
        """None if a chat may open here, else the error code saying why not.

        A folder that is simply not there is its own answer: told it was
        "outside the allowed roots", you go looking at the roots for a folder
        that was only renamed.
        """
        try:
            p = Path(cwd).expanduser().resolve()
        except Exception:
            return "no_such_folder"
        if any(p == d or d in p.parents for d in self.denied):
            return "cwd_outside"
        if not any(p == r or r in p.parents for r in self.roots):
            return "cwd_outside"
        return None if p.is_dir() else "no_such_folder"

    def project_for(self, cwd: str) -> str | None:
        """The project a folder belongs to, by name.

        A project is what `list_projects` says it is: a folder one level under
        an allowed root. Anything deeper belongs to the project above it —
        `~/projects/remote-ai-chat/app` is still remote-ai-chat — and a folder
        that is a root itself, or outside every root, has no project to name.
        """
        try:
            p = Path(cwd).expanduser().resolve()
        except Exception:
            return None
        for r in self.roots:
            if p == r:
                return None
            if r in p.parents:
                # The first component under the root, which is the project.
                return p.relative_to(r).parts[0]
        return None

    def list_projects(self) -> list[dict]:
        out = []
        for r in self.roots:
            if not r.is_dir():
                continue
            for child in sorted(r.iterdir()):
                if child.is_dir() and not child.name.startswith("."):
                    out.append({"path": str(child), "name": child.name,
                                "is_git": (child / ".git").exists()})
        return out


class AccessRefused(Exception):
    """A tunnelled request whose Access token did not verify. The message is why."""


async def fetch_jwks(url: str) -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


# The mail Access signed the current request in as: None off the tunnel and
# where Access is not configured. Set by `TunnelGate` around the request, so
# whatever answers it can say who it was without every route passing it along.
ACCESS_EMAIL: ContextVar[str | None] = ContextVar("tunnel_access_email", default=None)


class TunnelAccess:
    """Cloudflare Access's word for who is asking, checked rather than taken.

    With Access in front of the hostname, the edge signs somebody in and then
    puts a token on every request it lets through — `Cf-Access-Jwt-Assertion`,
    and the `CF_Authorization` cookie the browser carries back, the WebSocket
    handshake included. It is an RS256 JWT signed by the team's own keys, and
    it is the only thing here that names a person rather than an address or a
    machine.

    The edge refusing the unsigned is not enough to lean on: a hostname that
    is taken out of the Access application, or a second route to the same
    tunnel, forwards requests nobody signed in for and nothing would say so.
    So the token is verified here — signature, `aud`, `iss`, `exp` — and a
    request without a good one is refused before a device token is looked at.

    The keys are fetched once and kept. Access rotates them, so a `kid` that
    is not among them fetches again — at most once a minute, whatever the
    answer was, or anybody could make this daemon fetch on every request by
    inventing one. A fetch that fails keeps the keys already held.

    The fetcher and the clock are passed in so a test can replace both.
    """

    HEADER = b"cf-access-jwt-assertion"
    COOKIE = "CF_Authorization"
    REFETCH_S = 60.0
    # Between the edge's clock and this machine's. Without it somebody who
    # signed in a second ago is refused for a token from the future.
    LEEWAY_S = 60
    TEAM = re.compile(r"[a-z0-9][a-z0-9-]*")

    def __init__(self, fetch=fetch_jwks, clock=time.monotonic) -> None:
        self.fetch = fetch
        self.clock = clock
        self.team: str | None = None      # whose keys these are
        self.keys: dict[str, jwt.PyJWK] = {}
        self.fetched_at: float | None = None
        self._fetching = asyncio.Lock()

    @classmethod
    def token(cls, scope) -> str:
        """The token on a request: the edge's header, or else the browser's cookie."""
        cookies = ""
        for name, value in scope.get("headers") or []:
            name = name.lower()
            if name == cls.HEADER:
                return value.decode("latin-1").strip()
            if name == b"cookie":
                cookies = value.decode("latin-1")
        for part in cookies.split(";"):
            name, _, value = part.strip().partition("=")
            if name == cls.COOKIE:
                return value
        return ""

    async def email(self, token: str, team: str, aud: str, emails: set[str]) -> str:
        """The mail a token was issued to, or `AccessRefused`.

        Empty for a token that verifies and has no mail in it — a service
        token — which only passes when there is no list to be on.
        """
        if not aud or not self.TEAM.fullmatch(team):
            raise AccessRefused("tunnel_access_team and tunnel_access_aud are not both set")
        if not token:
            raise AccessRefused("no Access token")
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as exc:
            raise AccessRefused(f"not a token: {exc}") from None
        key = await self._key(team, kid) if isinstance(kid, str) else None
        if key is None:
            raise AccessRefused("signed by a key the team does not publish")
        try:
            claims = jwt.decode(
                token, key.key, algorithms=["RS256"], audience=aud,
                issuer=f"https://{team}.cloudflareaccess.com", leeway=self.LEEWAY_S,
                options={"require": ["exp", "aud", "iss"]})
        except jwt.PyJWTError as exc:
            raise AccessRefused(str(exc)) from None
        email = str(claims.get("email") or "").strip().lower()
        if emails and email not in emails:
            raise AccessRefused(f"{email or 'a token with no mail'} is not in tunnel_access_emails")
        return email

    async def _key(self, team: str, kid: str) -> jwt.PyJWK | None:
        if team != self.team:
            self.team, self.keys, self.fetched_at = team, {}, None
        if kid in self.keys:
            return self.keys[kid]
        # One fetch at a time: the requests that arrive while it is out wait
        # for its answer instead of each sending their own.
        async with self._fetching:
            now = self.clock()
            due = self.fetched_at is None or now - self.fetched_at >= self.REFETCH_S
            if kid not in self.keys and due and team == self.team:
                self.fetched_at = now
                try:
                    keys = self._parse(await self.fetch(
                        f"https://{team}.cloudflareaccess.com/cdn-cgi/access/certs"))
                except Exception as exc:
                    log.warning("could not fetch the Access keys of %s: %s", team, exc)
                else:
                    if team == self.team:
                        self.keys = keys
        return self.keys.get(kid) if team == self.team else None

    @staticmethod
    def _parse(jwks: dict) -> dict[str, jwt.PyJWK]:
        keys = {}
        for raw in jwks.get("keys") or []:
            try:
                keys[raw["kid"]] = jwt.PyJWK.from_dict(raw)
            except Exception:
                continue
        return keys


class TunnelGate:
    """The door a Cloudflare tunnel comes in by.

    `bind` decides who can reach the daemon over the network, and for a tailnet
    that is the whole of the question. A tunnel goes around it: `cloudflared`
    runs on this machine, so as far as the socket is concerned every request it
    forwards is local, and the address that actually asked is in a header —
    `CF-Connecting-IP`, written by Cloudflare's own edge and not by whoever
    connected to it.

    So that header is what tells a tunnelled request from a local one, and a
    tunnelled request is served only when its address is in
    `tunnel_allow_ips`. An empty list refuses all of them, which is the point:
    starting a tunnel in front of this daemon opens nothing by itself.

    Forging the header gains nobody anything. Without it a client on the
    tailnet or on loopback is already answered, exactly as before; with it,
    they are held to the list. The only thing it can do is narrow the door.

    With `tunnel_access_*` set, an address in the list is not enough: the
    request must also carry a Cloudflare Access token that verifies — see
    `TunnelAccess`. Both are settled here, before a device token is looked at.

    Pure ASGI rather than `BaseHTTPMiddleware` because the socket matters more
    than the routes do: `/ws` is where a client asks for anything, and an HTTP
    middleware never sees it.
    """

    HEADER = b"cf-connecting-ip"

    def __init__(self, app, cfg, access: TunnelAccess | None = None) -> None:
        self.app = app
        self.cfg = cfg
        self.access = access or TunnelAccess()

    @staticmethod
    def address(value: str | None) -> str | None:
        """The address in a `CF-Connecting-IP` value, or None if there is none.

        A proxy chain would comma-separate; the edge's own is first.
        """
        if value is None:
            return None
        return value.split(",")[0].strip()

    async def __call__(self, scope, receive, send) -> None:
        ip = self._claimed(scope) if scope["type"] in ("http", "websocket") else None
        if ip is None:
            await self.app(scope, receive, send)
            return
        # Only on the tunnel's path: one stat per tunnelled request, none at
        # all for the tailnet, and an edited setting needs no restart — see
        # Config.refresh_tunnel.
        self.cfg.refresh_tunnel()
        if not self.cfg.tunnel_allows(ip):
            await self._refuse(scope, send)
            return
        email = None
        want = self.cfg.tunnel_access()
        if want is not None:
            try:
                email = await self.access.email(self.access.token(scope), *want)
            except AccessRefused as exc:
                log.warning("tunnel request from %s refused by Access: %s", ip, exc)
                await self._refuse(scope, send)
                return
        signed_in = ACCESS_EMAIL.set(email)
        try:
            await self.app(scope, receive, send)
        finally:
            ACCESS_EMAIL.reset(signed_in)

    def _claimed(self, scope) -> str | None:
        """The address Cloudflare says asked, or None if this is not tunnelled."""
        for name, value in scope.get("headers") or []:
            if name.lower() == self.HEADER:
                return self.address(value.decode("latin-1"))
        return None

    async def _refuse(self, scope, send) -> None:
        if scope["type"] == "websocket":
            # Closing before accepting is what turns the handshake into a 403,
            # which is what a browser needs to stop retrying.
            await send({"type": "websocket.close", "code": 1008})
            return
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"detail":"forbidden"}'})


class TunnelLock:
    """Failed sign-ins through the tunnel, counted per address and acted on.

    An address in `tunnel_allow_ips` is a household, and the token is all that
    tells one machine in it from another — so somebody inside the list can sit
    and guess. Five wrong tokens inside ten minutes and the address is refused
    for the next ten, the right token included: a guesser must not be able to
    tell a lock from a miss.

    Only the tunnel's addresses are ever in here. `CF-Connecting-IP` is written
    by Cloudflare's edge, so it is the one address a request cannot choose; a
    tailnet client has no such header and never meets this.

    The clock is passed in so a test can move it.
    """

    LIMIT = 5
    WINDOW_S = 600.0

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.failed: dict[str, list[float]] = {}
        self.until: dict[str, float] = {}

    def locked(self, key: str) -> bool:
        until = self.until.get(key)
        if until is None:
            return False
        if self.clock() < until:
            return True
        del self.until[key]
        return False

    def fail(self, key: str) -> bool:
        """Count one failure. True if it is the one that locked the address."""
        now = self.clock()
        hist = [t for t in self.failed.get(key, []) if now - t < self.WINDOW_S]
        hist.append(now)
        if len(hist) < self.LIMIT:
            self.failed[key] = hist
            return False
        # The count starts again when the lock lifts, so one window is one lock
        # and one notification.
        self.failed.pop(key, None)
        self.until[key] = now + self.WINDOW_S
        return True
