"""A key an agent hands to the person: a pointer in the chat, the value only on a tap.

The agent never prints the value. It puts it in the login keychain (`divan
secret put`, value on stdin) or points at an item already there, and writes

    [secret-share rac-secret-openai-prod OpenAI key]

into its reply. The app draws that as a chip; a tap asks the daemon for the
value (`secret.copy`) and puts it on the clipboard. Nothing else carries it:
not the events table, not the transcript, not the provider.

There is no table of shares. A share is the line in the chat: the daemon
answers only for an item whose token an assistant message of that same chat
contains, and only for an hour from the latest such message — the clock is the
message's own timestamp, so neither the agent nor the phone can set it, and
sharing again starts a new hour.
Only `rac-secret-` items, Divan's own, can be shared; the rest of the keychain
(Wi-Fi, the CLIs' sign-ins) is never reachable this way.

Nothing in this module logs or returns a value except `read`, to its caller.
"""
from __future__ import annotations

import re
import subprocess
import time

from . import secrets

TTL_S = 3600
SERVICE = r"rac-secret-[a-z0-9][a-z0-9-]{1,80}"
TOKEN = re.compile(r"\[secret-share (" + SERVICE + r")(?: ([^\]\n]{1,60}))?\]")
_SERVICE = re.compile(r"^" + SERVICE + r"$")
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")


class ShareError(Exception):
    """Why a value is not handed out. The message never contains one."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def valid_service(service: str) -> bool:
    return bool(_SERVICE.match(service or ""))


def token(service: str, label: str | None = None) -> str:
    label = re.sub(r"[\]\n]", " ", (label or "").strip())[:60].strip()
    return f"[secret-share {service}{' ' + label if label else ''}]"


def needles(service: str) -> tuple[str, str]:
    """What an assistant message contains when it shares exactly `service`:
    the token with a label, or without one."""
    return f"[secret-share {service} ", f"[secret-share {service}]"


def service_for(name: str) -> str:
    if not _NAME.match(name or ""):
        raise ValueError("a name is 2-61 characters of a-z, 0-9 and '-', starting with a letter or digit")
    return f"{secrets.SERVICE_PREFIX}{name}"


def put(name: str, value: str, keychain=None) -> str:
    """Keep `value` under `rac-secret-<name>` and return the service."""
    if not value:
        raise ValueError("nothing on stdin to keep")
    service = service_for(name)
    (keychain or secrets.Keychain()).store(service, value)
    return service


def _parse_g(stderr: str) -> str | None:
    """The value from `security … -g`: `password: "…"`, or `password: 0x…  "…"`
    when it is not printable ASCII (then the hex is the truth)."""
    for line in stderr.splitlines():
        if not line.startswith("password:"):
            continue
        rest = line[len("password:"):].strip()
        if rest.startswith("0x"):
            hexpart = rest[2:].split()[0]
            try:
                return bytes.fromhex(hexpart).decode("utf-8")
            except ValueError:
                return None
        if len(rest) >= 2 and rest.startswith('"') and rest.endswith('"'):
            return rest[1:-1]
        return None
    return None


def read(service: str, timeout: float = 10.0) -> str | None:
    if not valid_service(service):
        return None
    try:
        r = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, "-g"],
                           capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return _parse_g(r.stderr)


def check(service: str, shared_at: float | None, now: float | None = None) -> None:
    """Raise unless `service` may be handed out now, given when the chat shared it."""
    if not valid_service(service):
        raise ShareError("not a Divan keychain item", "secret_not_shareable")
    if shared_at is None:
        raise ShareError("this chat did not share that key", "secret_not_shared")
    if (time.time() if now is None else now) > shared_at + TTL_S:
        raise ShareError("the share has expired; ask the agent to share it again", "secret_expired")
