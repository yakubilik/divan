"""Config + device registry at ~/.remote-ai-chat/config.toml.

Tokens are stored as sha256 hashes; the plaintext only ever leaves via the
pairing QR. Nothing here is logged.
"""
from __future__ import annotations

import os
import hashlib
import ipaddress
import secrets
import socket
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

import tomli_w

# RAC_HOME lets a machine host a second, fully separate daemon (own config,
# database, uploads and port) — used for testing and for per-user installs.
CONFIG_DIR = Path(os.environ.get("RAC_HOME") or (Path.home() / ".remote-ai-chat")).expanduser()
CONFIG_PATH = CONFIG_DIR / "config.toml"
DB_PATH = CONFIG_DIR / "db.sqlite"
LOG_DIR = CONFIG_DIR / "logs"
UPLOAD_DIR = CONFIG_DIR / "uploads"

DEFAULT_PORT = 8790


def _mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


@dataclass
class Device:
    id: str
    name: str
    token_hash: str
    created_at: float
    push_token: str | None = None
    # A second token, for a second APNs topic. A phone that can take a banner
    # cannot necessarily take a call: this one only exists on an iPhone, and
    # only in a build that carries the call module.
    voip_token: str | None = None
    last_seen: float | None = None
    push_approval: bool = True
    push_done: bool = True
    # The phone's UI language, sent at pairing and on every reconnect. Push
    # text is written in it; a device from before this field spoke English.
    lang: str = "en"
    # Made by `web --at` for a browser behind the tunnel (docs/TUNNEL.md). The
    # two kinds of token do not cross: this one is answered only through the
    # tunnel, and every other one only off it. A row from before the field is
    # a device that was never the tunnel's.
    tunnel: bool = False
    # Where a tunnel device last connected from, and every address it has
    # connected from before — a new one is worth telling the phone about, and
    # only once. The second is a list of `tunnel_key`s: a v6 address is its /64.
    last_addr: str | None = None
    seen_addrs: list[str] = field(default_factory=list)


# How many addresses a tunnel device is remembered at. A browser that has been
# in more places than this is told about the oldest of them again.
SEEN_ADDRS_MAX = 32

# How many revoked tokens are remembered, by hash. Only so that a refusal can
# say "revoked" to a browser that still holds one, rather than "unknown"; the
# oldest are forgotten and then simply read as unknown.
REVOKED_MAX = 64


def _device(did: str, d: dict) -> "Device":
    """A device row from disk, minus anything this version does not know about.

    A config.toml outlives the daemon that wrote it — downgrade, or a field
    retired between releases — and a stray key must not stop the daemon from
    starting. Unknown keys are dropped; the next save writes the current shape.
    """
    fields = Device.__dataclass_fields__
    return Device(id=did, **{k: v for k, v in d.items() if k in fields and k != "id"})


@dataclass
class Config:
    host_name: str = field(default_factory=socket.gethostname)
    port: int = DEFAULT_PORT
    bind: list[str] = field(default_factory=lambda: ["auto", "127.0.0.1"])
    # Who may come in through a Cloudflare tunnel. `bind` is the tailnet's door
    # and this is the tunnel's: a request that arrived through `cloudflared`
    # carries the browser's own address in `CF-Connecting-IP`, and is served
    # only if that address is listed here. Addresses or CIDR blocks, IPv4 or
    # IPv6. Empty means nobody, which is the point — starting a tunnel opens
    # nothing by itself, and a tailnet client never meets this list at all.
    tunnel_allow_ips: list[str] = field(default_factory=list)
    # Cloudflare Access in front of the tunnel's hostname: a sign-in at the
    # edge, which then puts a signed token on every request it lets through.
    # The team is the name in `<team>.cloudflareaccess.com` and the aud is the
    # application's Audience tag; with either set, a tunnelled request has to
    # carry a token that verifies against both. The mail list, if there is
    # one, is who the token may belong to. All empty is no Access at all.
    tunnel_access_team: str = ""
    tunnel_access_aud: str = ""
    tunnel_access_emails: list[str] = field(default_factory=list)
    # The people who share this computer, and which devices are whose: a name,
    # and the ids of that person's devices. A chat belongs to whoever's device
    # opened it, and the list of chats can be read one person at a time. The
    # first name is whose everything else is — a phone nobody listed, a chat an
    # agent opened. Empty is a computer with one person on it, and no picker.
    # Written by hand and re-read like the tunnel's settings.
    people: dict = field(default_factory=dict)
    allowed_roots: list[str] = field(default_factory=lambda: [str(Path.home() / "projects")])
    # Subtracted from allowed_roots. Anything that holds a credential, plus this
    # daemon's own state — a chat has no business opening in its own token store.
    denied_paths: list[str] = field(default_factory=lambda: [
        str(Path.home() / ".ssh"),
        str(Path.home() / ".aws"),
        str(Path.home() / ".gnupg"),
        str(Path.home() / ".docker"),
        str(Path.home() / "AppData"),          # Windows: creds, tokens, browser profiles
        str(Path.home() / ".config" / "gh"),
        str(CONFIG_DIR),
    ])
    idle_disconnect_s: int = 1800
    approval_timeout_s: int = 900
    # Whether a bypass chat still puts the destructive list to the phone. Off
    # is bypass meaning bypass: nothing at all asks.
    bypass_asks: bool = True
    # Letting a paired device drive the mouse and keyboard. Off until somebody
    # turns it on, and stored here rather than in memory so that "off" survives
    # a restart — a switch this size should never come back on by accident.
    remote_control: bool = False
    # Follow origin/main by itself. Safe to leave on even where the code is
    # written: a checkout with uncommitted work is never touched (see updater).
    auto_update: bool = True
    update_interval_s: int = 900
    # Calling the phone. Only the pointers live here — the key itself is a file
    # under CONFIG_DIR, which denied_paths already keeps chats out of. Empty
    # until somebody configures it, and a daemon without it simply cannot call.
    apns_key_path: str = str(CONFIG_DIR / "apns")
    apns_key_id: str = ""
    apns_team_id: str = ""
    apns_bundle_id: str = ""
    # A development build's device tokens only exist in Apple's sandbox, and a
    # production push to one comes back BadDeviceToken.
    apns_sandbox: bool = False
    devices: dict[str, Device] = field(default_factory=dict)
    # The token hashes of removed devices — see REVOKED_MAX. Not a key to
    # anything: a hash in here opens no door, it only names the refusal.
    revoked_tokens: list[str] = field(default_factory=list)
    accounts: dict[str, dict] = field(default_factory=dict)   # id -> stored fields
    # Several sign-ins of one tool, driven as one: see pool.Settings. Off until
    # somebody turns it on — a machine with one account has nothing to pool.
    pool: dict = field(default_factory=dict)
    # A demo machine: every chat runs the scripted demo provider, whatever tool
    # it names, and no CLI is ever started. For lending a computer to somebody
    # who has no subscription of their own — App Review. See daemon/README.md.
    demo: bool = False
    # More directories for `python -m remote_ai_chat.scrub` to look for keys in,
    # beside the daemon's own and the CLIs' transcripts: wherever this machine
    # keeps session notes. Absolute, or starting with `~`. Empty by default.
    scrub_extra_paths: list[str] = field(default_factory=list)
    # The live call's fast conversational layer (voice.py, voice_api.py).
    # "cli" is Haiku through the Claude Code CLI on a signed-in subscription;
    # "anthropic-api" is the Messages API directly, billed per token to a key
    # stored for it on purpose (`python -m remote_ai_chat.voice_api set-key`).
    # Nothing paid happens until both are true. Re-read on every call, so
    # switching back is an edit, not a restart. The cap is in US dollars per
    # local day, counted from the API's own usage figures.
    voice_fast_layer: str = "cli"
    voice_api_model: str = "claude-haiku-4-5"
    voice_api_daily_usd: float = 1.0

    # ── persistence ────────────────────────────────────────────────────────
    @classmethod
    def load(cls) -> "Config":
        if not CONFIG_PATH.exists():
            cfg = cls()
            if os.environ.get("RAC_PORT"):
                cfg.port = int(os.environ["RAC_PORT"])
            cfg.save()
            return cfg
        raw = tomllib.loads(CONFIG_PATH.read_text())
        devices = {
            did: _device(did, d) for did, d in raw.pop("devices", {}).items()
        }
        accounts = raw.pop("accounts", {})
        pool = raw.pop("pool", {})
        cfg = cls(**{k: v for k, v in raw.items() if k in cls.__dataclass_fields__})
        cfg.devices = devices
        cfg.accounts = accounts
        cfg.pool = pool if isinstance(pool, dict) else {}
        cfg._devices_mtime = _mtime(CONFIG_PATH)
        # The port of a second daemon on the same machine, beside RAC_HOME.
        if os.environ.get("RAC_PORT"):
            cfg.port = int(os.environ["RAC_PORT"])
        return cfg

    def save(self) -> None:
        CONFIG_DIR.mkdir(mode=0o700, exist_ok=True)
        LOG_DIR.mkdir(exist_ok=True)
        # The tunnel's settings are only ever written by hand, so the file is
        # right and this process's copy may be stale. Written back unread, a
        # push token arriving would undo an edit nobody had asked the tunnel
        # about yet — and an undone `tunnel_access_*` is a sign-in turned off.
        self.refresh_tunnel()
        data = {
            "host_name": self.host_name,
            "port": self.port,
            "bind": self.bind,
            "tunnel_allow_ips": self.tunnel_allow_ips,
            "tunnel_access_team": self.tunnel_access_team,
            "tunnel_access_aud": self.tunnel_access_aud,
            "tunnel_access_emails": self.tunnel_access_emails,
            "people": self.people,
            "allowed_roots": self.allowed_roots,
            "denied_paths": self.denied_paths,
            "idle_disconnect_s": self.idle_disconnect_s,
            "approval_timeout_s": self.approval_timeout_s,
            # Written back, not just read: every pairing calls save(), so a
            # setting left out here is one somebody turns off by hand and finds
            # back on the next time they add a device.
            "auto_update": self.auto_update,
            "remote_control": self.remote_control,
            # Left out once, and `bypass_asks = false` set by hand was gone
            # after the next pairing — the exact trap the comment above names.
            "bypass_asks": self.bypass_asks,
            "update_interval_s": self.update_interval_s,
            "apns_key_path": self.apns_key_path,
            "apns_key_id": self.apns_key_id,
            "apns_team_id": self.apns_team_id,
            "apns_bundle_id": self.apns_bundle_id,
            "apns_sandbox": self.apns_sandbox,
            # A field a device does not have is left out rather than written
            # empty: TOML has no null, and `tunnel = false` on every phone is a
            # line somebody will one day flip to see what happens.
            "devices": {
                d.id: {k: v for k, v in d.__dict__.items()
                       if k != "id" and v is not None and v != [] and (k != "tunnel" or v)}
                for d in self.devices.values()
            },
            "revoked_tokens": self.revoked_tokens,
            "accounts": self.accounts,
            "pool": self.pool,
            "demo": self.demo,
            "scrub_extra_paths": self.scrub_extra_paths,
            "voice_fast_layer": self.voice_fast_layer,
            "voice_api_model": self.voice_api_model,
            "voice_api_daily_usd": self.voice_api_daily_usd,
        }
        tmp = CONFIG_PATH.with_suffix(".tmp")
        tmp.write_text(tomli_w.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(CONFIG_PATH)
        self._devices_mtime = _mtime(CONFIG_PATH)

    # ── devices / tokens ───────────────────────────────────────────────────
    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def add_device(self, name: str, tunnel: bool = False) -> tuple[Device, str]:
        token = secrets.token_urlsafe(32)
        dev = Device(
            id=secrets.token_hex(6), name=name,
            token_hash=self.hash_token(token), created_at=time.time(), tunnel=tunnel,
        )
        self.devices[dev.id] = dev
        self.save()
        return dev, token

    def find_device_by_token(self, token: str) -> Device | None:
        dev = self._match_token(token)
        if dev is None and self.reload_devices():
            dev = self._match_token(token)
        return dev

    def _match_token(self, token: str) -> Device | None:
        h = self.hash_token(token)
        for d in self.devices.values():
            if secrets.compare_digest(d.token_hash, h):
                return d
        return None

    def reload_devices(self) -> bool:
        """Re-read the device registry if config.toml changed under us (a `pair` or
        `revoke` from the CLI while the daemon is running). Returns True if it did.

        Devices already in memory keep their live fields (push token, last_seen);
        new ones are added and revoked ones dropped."""
        mtime = _mtime(CONFIG_PATH)
        if mtime is None or mtime == getattr(self, "_devices_mtime", None):
            return False
        self._devices_mtime = mtime
        try:
            whole = tomllib.loads(CONFIG_PATH.read_text())
        except Exception:
            return False
        raw = whole.get("devices", {})
        for did, d in raw.items():
            if did not in self.devices:
                self.devices[did] = _device(did, d)
        for did in [d for d in self.devices if d not in raw]:
            del self.devices[did]
        revoked = whole.get("revoked_tokens", [])
        if isinstance(revoked, list):
            self.revoked_tokens = [str(h) for h in revoked][-REVOKED_MAX:]
        return True

    def refresh_tunnel(self) -> bool:
        """Re-read the tunnel's settings if config.toml changed under us.

        A home address is not a fixed one: the modem restarts, the lease
        renews, and the list has to be edited. Everything else here is read
        once at startup, which for a restart-and-be-done setting is fine — but
        restarting this daemon drops every phone and every chat with it, which
        is too much to ask of somebody whose only crime was getting a new
        address from their provider. So `tunnel_allow_ips` is re-read, and the
        three `tunnel_access_*` settings with it — turning Access on, or
        letting one more person in, is the same kind of edit — and the change
        takes effect on the next request.

        Its own mtime, not `reload_devices`': the two are read at different
        moments and each must be able to see a change the other consumed.
        """
        mtime = _mtime(CONFIG_PATH)
        if mtime is None or mtime == getattr(self, "_tunnel_mtime", None):
            return False
        self._tunnel_mtime = mtime
        try:
            raw = tomllib.loads(CONFIG_PATH.read_text())
        except Exception:
            return False
        ips = raw.get("tunnel_allow_ips", [])
        if isinstance(ips, list):
            self.tunnel_allow_ips = [str(x) for x in ips]
        self.tunnel_access_team = str(raw.get("tunnel_access_team", ""))
        self.tunnel_access_aud = str(raw.get("tunnel_access_aud", ""))
        emails = raw.get("tunnel_access_emails", [])
        if isinstance(emails, list):
            self.tunnel_access_emails = [str(x) for x in emails]
        people = raw.get("people", {})
        if isinstance(people, dict):
            self.people = people
        return True

    def person_names(self) -> list[str]:
        return [str(n) for n in self.people]

    def person_of(self, device_id: str | None) -> str | None:
        """Whose device this is: the person who lists it, else the first one."""
        names = self.person_names()
        for name in names:
            ids = self.people.get(name)
            if device_id and isinstance(ids, list) and device_id in ids:
                return name
        return names[0] if names else None

    def record(self) -> None:
        """Write the devices' live fields down, on top of whatever the CLI wrote.

        `save()` writes this process's whole picture of the file, and a `pair`
        since the last read is not in it. Fine for a write that follows a
        token lookup, which has just re-read; this one runs whenever a socket
        opens or closes, so it reads first.
        """
        self.reload_devices()
        self.save()

    def was_revoked(self, token: str) -> bool:
        """Whether this token belonged to a device that has since been removed."""
        self.reload_devices()
        return self.hash_token(token) in self.revoked_tokens

    def revoke(self, device_id: str, remember: bool = True) -> bool:
        if device_id in self.devices:
            gone = self.devices.pop(device_id)
            if remember:
                self.revoked_tokens = [*self.revoked_tokens, gone.token_hash][-REVOKED_MAX:]
            self.save()
            return True
        return False

    # ── network ────────────────────────────────────────────────────────────
    def tunnel_allows(self, ip: str) -> bool:
        """Whether an address arriving through the tunnel is one of ours.

        An unparseable address is refused rather than ignored: the header is
        written by Cloudflare's edge, so anything else in it is either a bug or
        somebody trying, and neither deserves the benefit of the doubt. A
        malformed entry in the list is skipped instead — one typo in a config
        file should narrow the door, never open it.
        """
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        for entry in self.tunnel_allow_ips:
            try:
                if addr in ipaddress.ip_network(str(entry).strip(), strict=False):
                    return True
            except ValueError:
                continue
        return False

    def tunnel_access(self) -> tuple[str, str, set[str]] | None:
        """What a tunnelled request's Access token is held to, or None for no Access.

        The team as the bare name, whichever way it was written down; the aud;
        and the mails allowed, lowercased, where an empty set is anybody the
        Access policy let through. Half a configuration is not None: a team
        without an aud, or a mail list with neither, comes back with the
        missing part empty and verifies nothing, so every tunnelled request is
        refused. Somebody who wrote one of the three meant Access to be on.
        """
        team = self.tunnel_access_team.strip().lower()
        team = team.removeprefix("https://").rstrip("/").removesuffix(".cloudflareaccess.com")
        aud = self.tunnel_access_aud.strip()
        emails = {e.strip().lower() for e in self.tunnel_access_emails if e.strip()}
        if not (team or aud or emails):
            return None
        return team, aud, emails

    @staticmethod
    def tunnel_key(ip: str) -> str:
        """The name an address is counted and remembered under.

        A v4 address is itself. A v6 one is its /64: the second half belongs to
        the interface and changes on its own, so by the whole address one
        laptop would be a new place every morning and a guesser a new stranger
        every request.
        """
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return ip
        if addr.version == 6:
            return str(ipaddress.ip_network(f"{addr}/64", strict=False))
        return str(addr)

    def resolve_bind(self) -> list[str]:
        out: list[str] = []
        for b in self.bind:
            if b == "auto":
                ip = tailscale_ip()
                if ip:
                    out.append(ip)
            else:
                out.append(b)
        # dedupe, keep order
        seen: set[str] = set()
        return [x for x in out if not (x in seen or seen.add(x))]


def tailscale_ip() -> str | None:
    """This machine's Tailscale IPv4 (100.64.0.0/10), or None if Tailscale is down."""
    candidates = [["tailscale", "ip", "-4"]]
    if sys.platform == "darwin":
        candidates.append(["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "ip", "-4"])
    elif sys.platform == "win32":
        candidates.append([r"C:\Program Files\Tailscale\tailscale.exe", "ip", "-4"])
        candidates.append([r"C:\Program Files (x86)\Tailscale\tailscale.exe", "ip", "-4"])
    for cmd in candidates:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            for line in (r.stdout or "").splitlines():
                if _is_tailscale_v4(line.strip()):
                    return line.strip()
        except Exception:
            pass
    # No CLI: read the interface addresses directly.
    try:
        import socket as _s
        for info in _s.getaddrinfo(_s.gethostname(), None, _s.AF_INET):
            ip = info[4][0]
            if _is_tailscale_v4(ip):
                return ip
    except Exception:
        pass
    if sys.platform != "win32":
        try:
            r = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=3)
            for line in r.stdout.splitlines():
                line = line.strip()
                if line.startswith("inet 100.") and _is_tailscale_v4(line.split()[1]):
                    return line.split()[1]
        except Exception:
            pass
    return None


def _is_tailscale_v4(ip: str) -> bool:
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    try:
        a, b = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return a == 100 and 64 <= b <= 127
