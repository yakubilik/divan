"""Dangerous-command detection, path allowlist, secret redaction."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shlex
import tempfile
import time
from contextvars import ContextVar
from pathlib import Path

import httpx
import jwt

from .secrets import FAMILIES, find as find_secrets

log = logging.getLogger("rac.security")

# What a regex can still say: these have one spelling, and no path to resolve.
# `rm`, `git push`, `find`, `chmod`, the shutdown family and a download piped
# into a shell are parsed instead, further down.
DESTRUCTIVE_PATTERNS = [
    re.compile(r"\bdd\s+[^|]*\bof=/dev/"),
    re.compile(r"\bmkfs\."),
    re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),
    re.compile(r"\bgit\s+reset\s+--hard\b"),
    re.compile(r"security\s+delete-(keychain|generic-password|internet-password)"),
    re.compile(r">\s*/dev/(sd[a-z]|disk\d)"),
    re.compile(r"\blaunchctl\s+(unload|bootout|disable|remove)\b"),
    re.compile(r"\bkillall\s+-9\b"),
    re.compile(r"\bpkill\s+-9?\s*-f\s+remote[-_]ai[-_]chat"),
    # Options after the pattern are not options on macOS: they become more
    # patterns, and `pkill -f x -u me -P 1` kills everything with "me" or "1" in it.
    re.compile(r"\bpkill(?:\s+(?:-[uUPgGtsF]\s+\S+|-[fvilnxaoqILN0-9]+|-[A-Z]{2,}))*"
               r"\s+(?:\"[^\"]*\"|'[^']*'|[^-\s]\S*)\s+-[A-Za-z]"),
    # The sign-ins and the push key: even reading these puts a token in a chat.
    re.compile(r"\.credentials\.json|\.remote-ai-chat/apns/"),
    # Python deleting a tree is `rm -r` with the path hidden inside a string.
    re.compile(r"\brmtree\s*\("),
    # `sh -c "$(curl …)"` and `bash <(curl …)`: the pipe spelled another way.
    re.compile(r"\b(?:sh|bash|zsh|dash|ksh)\b[^|;&\n]*[$<]\(\s*(?:curl|wget)\b"),
]

_SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
_POWER = {"shutdown", "reboot", "halt", "poweroff"}
# Words that run the command after them, so the command is the next word.
_WRAPPERS = {"command", "builtin", "exec", "nohup", "time", "nice", "env", "noglob",
             "xargs", "caffeinate"}
_SUDO_TAKES_VALUE = {"-u", "-g", "-h", "-p", "-C", "-D", "-U", "-T", "-R"}
_GIT_TAKES_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
_OPERATORS = frozenset(";<>|&\n")
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
_GLOB = re.compile(r"[*?\[]|(?<!\$)\{")
_EVERYTHING = {"*", ".*", "{*,.*}", "{.*,*}", "{,.}*", ".[!.]*"}
_OPEN_MODE = re.compile(r"^(0?777|[ugoa]*a[ugoa]*[+=]rwx|ugo[+=]rwx)$")
# The daemon's own folder: its config, its database. Uploads, the log and the
# accounts' memory and skills are what a chat works in all day.
_DAEMON_HOME = re.compile(r"\.remote-ai-chat(?:/(?!(?:uploads|logs|accounts)/)|$)")
_READS = {"cat", "head", "tail", "less", "grep", "egrep", "fgrep", "rg", "ls", "wc", "stat",
          "file", "cut", "sort", "uniq", "diff", "du", "jq", "awk", "nl", "tr", "tree",
          "echo", "printf", "test", "[", "readlink", "realpath", "basename", "dirname",
          "shasum", "md5", "xxd", "strings", "cd", "pwd"}
_SINKS = {"/dev/null", "/dev/stdout", "/dev/stderr"}


def _tokens(cmd: str) -> list[str]:
    """Shell words, with the operators between commands as words of their own."""
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="".join(_OPERATORS))
    lex.whitespace = " \t\r"        # a newline ends a command, like `;`
    lex.whitespace_split = True
    lex.commenters = ""             # `fix#3` in a commit message is not a comment
    try:
        return list(lex)
    except ValueError:
        # An unclosed quote, usually a heredoc with an apostrophe in it. Read it
        # the blunt way rather than not at all.
        return [t.strip("\"'") for t in re.findall(r"[;<>|&\n]+|[^\s;<>|&]+", cmd)]


def _segments(tokens: list[str]) -> list[tuple[list[str], bool]]:
    """Each command of a pipeline or chain, and whether it is piped into."""
    out: list[tuple[list[str], bool]] = []
    cur: list[str] = []
    piped = False
    for t in tokens:
        if t and set(t) <= _OPERATORS:
            if cur:
                out.append((cur, piped))
            cur, piped = [], t in ("|", "|&")
        else:
            cur.append(t)
    if cur:
        out.append((cur, piped))
    return out


def _command(words: list[str]) -> tuple[str, list[str], bool]:
    """The program a segment really runs, its arguments, and whether under sudo."""
    words = list(words)
    if words and words[-1] != ")":
        words[-1] = words[-1].rstrip(")") or words[-1]
    sudo = False
    i = 0
    while i < len(words):
        w = words[i].lstrip("({") if i == 0 or words[i] in ("(", "{") else words[i]
        name = os.path.basename(w)
        if not w or _ASSIGNMENT.match(w):
            i += 1
        elif name in ("sudo", "doas"):
            sudo = True
            i += 1
            while i < len(words) and words[i].startswith("-"):
                i += 2 if words[i] in _SUDO_TAKES_VALUE else 1
        elif name in _WRAPPERS:
            i += 1
            while i < len(words) and (words[i].startswith("-") or _ASSIGNMENT.match(words[i])):
                i += 1
        else:
            return name, words[i + 1:], sudo
    return "", [], sudo


def _flags(args: list[str]) -> tuple[set[str], set[str], list[str]]:
    """Short flags, long flags, and what is left, honouring `--`."""
    short: set[str] = set()
    long: set[str] = set()
    rest: list[str] = []
    for n, a in enumerate(args):
        if a == "--":
            rest.extend(args[n + 1:])
            break
        if a.startswith("--"):
            long.add(a.split("=", 1)[0])
        elif a.startswith("-") and len(a) > 1:
            short.update(a[1:])
        else:
            rest.append(a)
    return short, long, rest


def _resolve(target: str, here: Path | None) -> Path | None:
    """Where a path argument points, or None when that cannot be known."""
    home = os.path.expanduser("~")
    t = re.sub(r"\$\{?HOME\}?(?![A-Za-z0-9_])", lambda _: home, target)
    if here is not None:
        t = re.sub(r"\$\{?PWD\}?(?![A-Za-z0-9_])", lambda _: str(here), t)
    if t == "~" or t.startswith("~/"):
        t = home + t[1:]
    if t.startswith(("$", "~")):
        return None
    if not os.path.isabs(t):
        if here is None:
            return None
        t = os.path.join(here, t)
    # normpath first: `..` is taken at face value, then links are followed.
    return Path(os.path.realpath(os.path.normpath(t)))


def _inside(p: Path, root: Path) -> bool:
    return root in p.parents


# Scratch space: a chat clears what it put in /tmp all evening (7 Oct 2026).
# Emptying the folder itself still asks.
_SCRATCH = {Path(os.path.realpath(d)) for d in ("/tmp", tempfile.gettempdir())}


def _scratch(p: Path) -> bool:
    return any(_inside(p, d) for d in _SCRATCH)


def _rm_reason(args: list[str], root: Path, here: Path | None) -> str | None:
    short, long, targets = _flags(args)
    if not ({"r", "R"} & short or "--recursive" in long):
        return None
    for t in targets:
        # `build/*` empties build, so build is what must be inside; `*.pyc`
        # only picks from the folder it is in, so that folder may be the root.
        whole = True
        m = _GLOB.search(t)
        if m:
            head, sep, _ = t[:m.start()].rpartition("/")
            whole = t[len(head + sep):].split("/", 1)[0] in _EVERYTHING
            t = head + sep or "."
        p = _resolve(t, here)
        if p is None:
            return f"rm -r of a path that cannot be resolved: {t}"
        if not (_inside(p, root) or (p == root and not whole) or _scratch(p)):
            if p == root:
                return "rm -r of the chat's whole folder"
            return f"rm -r outside the chat's folder: {p}"
    return None


def _git_push_reason(args: list[str]) -> str | None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in _GIT_TAKES_VALUE else 1
    if i >= len(args) or args[i] != "push":
        return None
    short, long, rest = _flags(args[i + 1:])
    if "f" in short or long & {"--force", "--force-with-lease", "--force-if-includes", "--mirror"}:
        return "git push --force"
    # rest[0] is the remote; a refspec with a leading + is a forced one.
    if any(r.startswith("+") for r in rest[1:]):
        return "git push with a forced (+) refspec"
    return None


def _find_reason(args: list[str], root: Path, here: Path | None) -> str | None:
    deletes = "-delete" in args or any(
        a in ("-exec", "-execdir", "-ok") and os.path.basename(args[n + 1]) == "rm"
        for n, a in enumerate(args[:-1]))
    if not deletes:
        return None
    i = 0
    while i < len(args) and args[i] in ("-H", "-L", "-P"):
        i += 1
    paths = []
    while i < len(args) and not args[i].startswith(("-", "(", "!")):
        paths.append(args[i])
        i += 1
    for t in paths or ["."]:
        p = _resolve(t, here)
        if p is None or not (p == root or _inside(p, root) or _scratch(p)):
            return f"find … -delete outside the chat's folder: {t}"
    return None


def _chmod_reason(args: list[str]) -> str | None:
    short, long, rest = _flags(args)
    if ("R" in short or "--recursive" in long) and any(_OPEN_MODE.match(a) for a in rest):
        return "chmod -R 777"
    return None


def _reads_only(name: str, args: list[str]) -> bool:
    if name in _READS:
        return True
    if name == "sed":
        short, long, _ = _flags(args)
        return "i" not in short and "--in-place" not in long
    if name == "find":
        return not any(a == "-delete" or a.startswith(("-exec", "-ok", "-fprint")) for a in args)
    if name == "sqlite3":
        return "-readonly" in args or any("mode=ro" in a for a in args)
    return False


def _daemon_home_reason(name: str, words: list[str], args: list[str], here: Path | None) -> str | None:
    """A command that can change the daemon's own files.

    Reading them is how the daemon gets debugged, and it asked for that twenty
    times an evening (7 Oct 2026). The target of a `>` arrives here as a
    command of its own, named after the file, so a redirect is caught too.
    """
    if not name or _reads_only(name, args):
        return None
    if len(words) == 1 and (words[0].isdigit() or words[0] in _SINKS):
        return None     # the far side of `2>&1` or `> /dev/null`, not a file here
    hit = next((w for w in words if _DAEMON_HOME.search(w)), None)
    if hit is None and here is not None and _DAEMON_HOME.search(str(here)):
        hit = str(here)
    return f"changes the daemon's own files: {hit}" if hit else None


def _parsed_reason(cmd: str, root: Path, here: Path | None, depth: int = 0) -> str | None:
    if depth > 4:
        return None
    for inner in _SUBSTITUTION.findall(cmd):
        reason = _parsed_reason(inner[0] or inner[1], root, here, depth + 1)
        if reason:
            return reason
    downloading = False
    for words, piped in _segments(_tokens(cmd)):
        name, args, sudo = _command(words)
        if piped and downloading and name in _SHELLS:
            return "a download piped into a shell"
        downloading = name in ("curl", "wget")
        reason = None
        if name == "cd":
            # Where the commands after this one run. A `cd` that cannot be
            # followed leaves every relative path after it unknown.
            dest = next((a for a in args if a != "--"), "~")
            here = _resolve(dest, here)
        elif name == "rm":
            reason = "sudo rm" if sudo else _rm_reason(args, root, here)
        elif name == "git":
            reason = _git_push_reason(args)
        elif name == "find":
            reason = _find_reason(args, root, here)
        elif name == "chmod":
            reason = _chmod_reason(args)
        elif name in _POWER:
            reason = name
        elif name in _SHELLS or name == "eval":
            # `bash -lc '…'` is how Codex hands over every command.
            script = None
            if name == "eval":
                script = " ".join(args)
            else:
                for n, a in enumerate(args[:-1]):
                    if a.startswith("-") and not a.startswith("--") and a.endswith("c"):
                        script = args[n + 1]
                        break
            if script:
                reason = _parsed_reason(script, root, here, depth + 1)
                name = ""       # what it touches was just read from the script
        reason = reason or _daemon_home_reason(name, words, args, here)
        if reason:
            return reason
    return None


def destructive_reason(cmd: str, cwd: str | None = None, at: str | None = None) -> str | None:
    """Why this shell command must be put to the phone, or None if it need not be.

    `cwd` is the chat's folder: deleting inside it is everyday work, deleting
    outside it is not. `at` is where the shell stands when it differs — a
    session that ran `cd` earlier resolves its relative paths from there.

    The command is parsed, one command of a pipeline or chain at a time, so a
    word in a commit message is not a command and `rm -r -f /` is the same
    thing as `rm -rf /`.
    """
    if not cmd:
        return None
    for pat in DESTRUCTIVE_PATTERNS:
        if pat.search(cmd):
            return pat.pattern
    root = Path(os.path.realpath(os.path.expanduser(cwd or os.getcwd())))
    here = Path(os.path.realpath(os.path.expanduser(at))) if at else root
    try:
        return _parsed_reason(cmd, root, here)
    except Exception:
        # A classifier that falls over must not be the reason nobody was asked.
        log.exception("could not parse a command; asking")
        return "a command that could not be read"


# The families live in secrets.py, which also keeps what a user pastes; here
# they only blank out what the agent says and what its tools print.
SECRET_PATTERNS = [f.pattern for f in FAMILIES]


def redact(text: str) -> str:
    if not text:
        return text
    out, pos = [], 0
    for h in find_secrets(text):
        out.append(text[pos:h.start])
        out.append("••••••")
        pos = h.end
    out.append(text[pos:])
    return "".join(out)


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
    TOLD_EVERY_S = 600.0

    def __init__(self, app, cfg, access: TunnelAccess | None = None) -> None:
        self.app = app
        self.cfg = cfg
        self.access = access or TunnelAccess()
        self._told: dict[str, float] = {}

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
            # Said once per address every ten minutes: "Divan is down" from
            # somebody at home is, most days, a provider that changed their
            # address, and without this line nothing here shows it.
            now = time.monotonic()
            if now - self._told.get(ip, -self.TOLD_EVERY_S) >= self.TOLD_EVERY_S:
                if len(self._told) > 500:
                    self._told.clear()
                self._told[ip] = now
                log.warning("tunnel request from %s refused: not in tunnel_allow_ips", ip)
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
    and guess. Five different wrong tokens inside ten minutes and the address
    is refused for the next ten, the right token included.

    What is counted is a guess, and a guess is a token nobody has seen before.
    The same wrong token again is not a second guess: it is a browser that
    stored a stale token and keeps reconnecting, and counting every retry is
    how the panel locked its own household out (2 Oct 2026). So a token is
    counted once per window, by its hash. A token the daemon knows but that
    does not open the tunnel is not counted at all — see `Server._admit`.

    Only the tunnel's addresses are ever in here. `CF-Connecting-IP` is written
    by Cloudflare's edge, so it is the one address a request cannot choose; a
    tailnet client has no such header and never meets this.

    The lock lives in memory, and `unlock` lifts it on the running daemon —
    `remote-ai-chat unlock <ip>`, or the same request from a paired phone.

    The clock is passed in so a test can move it.
    """

    LIMIT = 5
    WINDOW_S = 600.0

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        # Per address: when each distinct wrong token was first seen, by hash.
        self.failed: dict[str, dict[str, float]] = {}
        self.until: dict[str, float] = {}

    def locked(self, key: str) -> bool:
        return self.locked_until(key) is not None

    def locked_until(self, key: str) -> float | None:
        """When the lock on this address lifts, or None if it is not locked."""
        until = self.until.get(key)
        if until is None:
            return None
        if self.clock() < until:
            return until
        del self.until[key]
        return None

    def fail(self, key: str, token: str = "") -> bool:
        """Count one wrong token. True if it is the one that locked the address.

        A token already counted inside the window is not counted again.
        """
        now = self.clock()
        seen = {h: t for h, t in self.failed.get(key, {}).items() if now - t < self.WINDOW_S}
        digest = hashlib.sha256(token.encode()).hexdigest()
        if digest in seen:
            self.failed[key] = seen
            return False
        seen[digest] = now
        if len(seen) < self.LIMIT:
            self.failed[key] = seen
            return False
        # The count starts again when the lock lifts, so one window is one lock
        # and one notification.
        self.failed.pop(key, None)
        self.until[key] = now + self.WINDOW_S
        return True

    def unlock(self, key: str) -> bool:
        """Lift the lock on an address and forget its count. True if it was locked."""
        was = self.locked(key)
        self.failed.pop(key, None)
        self.until.pop(key, None)
        return was
