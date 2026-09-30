"""Dangerous-command detection, path allowlist, secret redaction."""
from __future__ import annotations

import re
from pathlib import Path

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

    Pure ASGI rather than `BaseHTTPMiddleware` because the socket matters more
    than the routes do: `/ws` is where a client asks for anything, and an HTTP
    middleware never sees it.
    """

    HEADER = b"cf-connecting-ip"

    def __init__(self, app, cfg) -> None:
        self.app = app
        self.cfg = cfg

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] in ("http", "websocket"):
            ip = self._claimed(scope)
            if ip is not None:
                # Only on the tunnel's path: one stat per tunnelled request,
                # none at all for the tailnet, and an edited list needs no
                # restart — see Config.refresh_tunnel_allow_ips.
                self.cfg.refresh_tunnel_allow_ips()
            if ip is not None and not self.cfg.tunnel_allows(ip):
                await self._refuse(scope, send)
                return
        await self.app(scope, receive, send)

    def _claimed(self, scope) -> str | None:
        """The address Cloudflare says asked, or None if this is not tunnelled."""
        for name, value in scope.get("headers") or []:
            if name.lower() == self.HEADER:
                # A proxy chain would comma-separate; the edge's own is first.
                return value.decode("latin-1").split(",")[0].strip()
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
