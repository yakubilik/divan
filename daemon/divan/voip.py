"""VoIP pushes, straight to APNs.

The ordinary banner path goes through Expo (``push.py``). This one cannot: a
VoIP push is a different APNs push type on a different topic, and Expo's service
does not send it. So the Mac talks to Apple itself, with a key of its own.

Content-free for the same reason the banner path is: what reaches Apple is a
chat id and who is calling, never a word of the conversation.

One rule governs the other end. iOS terminates an app that takes a VoIP push
without reporting a call, and repeating that stops delivery altogether — so this
module is only ever called when there is a real call to place. It is not a way
to wake the phone up for something else.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

log = logging.getLogger("rac.voip")

PRODUCTION = "https://api.push.apple.com"
SANDBOX = "https://api.sandbox.push.apple.com"
# Apple rejects a token older than an hour and throttles refreshing one younger
# than twenty minutes. Halfway between is the only number that argues with
# neither.
TOKEN_TTL = 45 * 60


@dataclass(frozen=True)
class Credentials:
    """What Apple needs to believe a push came from this developer.

    ``key_path`` points at the ``.p8`` downloaded once from the developer
    account; it is a private key and lives outside this repo and outside
    config.toml, at mode 600.
    """

    key_path: Path
    key_id: str
    team_id: str
    bundle_id: str

    @classmethod
    def from_config(cls, cfg) -> "Credentials":
        """Read the pointers off the daemon config.

        ``apns_key_path`` may name the ``.p8`` directly or the folder holding
        it; a folder is resolved by Apple's own naming, ``AuthKey_<key id>.p8``,
        so rotating a key means dropping the new file in and changing one line.
        """
        path = Path(cfg.apns_key_path).expanduser()
        if path.is_dir():
            path = path / f"AuthKey_{cfg.apns_key_id}.p8"
        return cls(
            key_path=path,
            key_id=cfg.apns_key_id,
            team_id=cfg.apns_team_id,
            bundle_id=cfg.apns_bundle_id,
        )

    @property
    def topic(self) -> str:
        """The VoIP topic is the bundle id with a suffix — a *different* topic
        from the one a banner is sent to, which is why one key has to cover
        both (a team-scoped key does)."""
        return f"{self.bundle_id}.voip"

    def missing(self) -> str | None:
        if not (self.key_id and self.team_id and self.bundle_id):
            return "key id, team id or bundle id is not configured"
        if not self.key_path.is_file():
            return f"the APNs key is not at {self.key_path}"
        return None


class _Token:
    """The signed JWT Apple wants in every request, cached until it goes stale."""

    def __init__(self, creds: Credentials) -> None:
        self._creds = creds
        self._value: str | None = None
        self._made_at = 0.0

    def get(self) -> str:
        now = time.time()
        if self._value and now - self._made_at < TOKEN_TTL:
            return self._value
        import jwt  # imported here so a daemon that never calls out never needs it

        key = self._creds.key_path.read_text()
        self._value = jwt.encode(
            {"iss": self._creds.team_id, "iat": int(now)},
            key,
            algorithm="ES256",
            headers={"kid": self._creds.key_id},
        )
        self._made_at = now
        return self._value


class Voip:
    """Places calls on one device at a time. Holds an HTTP/2 connection open:
    APNs requires HTTP/2, and a new TLS session per call would show up as
    latency in the one place latency is audible."""

    def __init__(self, creds: Credentials, *, sandbox: bool = False) -> None:
        self._creds = creds
        self._token = _Token(creds)
        self._base = SANDBOX if sandbox else PRODUCTION
        self._client: httpx.AsyncClient | None = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(http2=True, timeout=10, base_url=self._base)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def ring(self, device_token: str, *, chat_id: str, caller: str) -> tuple[bool, str]:
        """Make one phone ring. Returns whether APNs accepted it, and why not.

        A failure is worth surfacing rather than logging quietly: a call that
        does not arrive looks exactly like an agent that had nothing to say.
        """
        problem = self._creds.missing()
        if problem:
            return False, problem
        if not device_token:
            return False, "this device has no VoIP token yet"

        payload = {"chat_id": chat_id, "from": caller}
        headers = {
            "authorization": f"bearer {self._token.get()}",
            "apns-topic": self._creds.topic,
            "apns-push-type": "voip",
            # A call is the one thing that must not wait for a delivery window.
            "apns-priority": "10",
            # A ring nobody answered is not worth delivering late: by the time
            # a stale one arrives the agent has moved on, and iOS would still
            # force a call screen for it.
            "apns-expiration": str(int(time.time()) + 30),
        }
        try:
            client = await self._http()
            r = await client.post(f"/3/device/{device_token}", headers=headers, content=json.dumps(payload))
        except Exception as exc:
            log.warning("voip push failed: %s", exc)
            return False, str(exc)

        if r.status_code == 200:
            return True, ""
        reason = ""
        try:
            reason = (r.json() or {}).get("reason", "")
        except Exception:
            reason = r.text[:120]
        # BadDeviceToken on production usually means the build is a development
        # one, whose tokens only exist in the sandbox. Saying so beats the
        # bare word.
        if reason == "BadDeviceToken" and self._base == PRODUCTION:
            reason = "BadDeviceToken (a development build's token only works against the sandbox)"
        log.warning("voip push refused: %s %s", r.status_code, reason)
        return False, reason or f"HTTP {r.status_code}"
