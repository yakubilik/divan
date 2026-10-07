"""A plan's windows, asked for instead of waited for.

Claude Code only reports its windows while a turn is running, so between turns
the newest reading there is can be days old — and a sign-in that is spent from
another computer, or from claude.ai, never reports here at all. The service
answers the same question directly: it is what the CLI's own `/usage` reads,
and the figure on the subscription's settings page.

The sign-in's token is read where the CLI keeps it and used as it is. It is
never refreshed from here: refresh tokens are single-use, and spending one
would sign the CLI out. A token that has run out means no reading until the
CLI has next run, and the last one a turn reported stays.
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.request
from datetime import datetime

from . import accounts as acct

URL = "https://api.anthropic.com/api/oauth/usage"
WINDOWS = ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet")
TIMEOUT_S = 4.0


def _service(a: acct.Account) -> str:
    """The keychain item a sign-in lives in: the CLI's own name, and for a
    config folder that is not its usual one, that folder's hash after it."""
    if not a.home:
        return acct.KEYCHAIN_SERVICE
    return acct.KEYCHAIN_SERVICE + "-" + hashlib.sha256(a.home.encode()).hexdigest()[:8]


def _token(a: acct.Account, now: float) -> str | None:
    """The newest token this sign-in has that still works. The file and the
    keychain can both hold one, and the older of them is usually dead."""
    raws: list[str] = []
    try:
        raws.append(acct._cred_path(a).read_text(encoding="utf-8"))
    except OSError:
        pass
    kept = acct._keychain_read(_service(a))
    if kept:
        raws.append(kept)
    best: tuple[float, str] | None = None
    for raw in raws:
        try:
            o = json.loads(raw).get("claudeAiOauth") or {}
            token, ends = o.get("accessToken"), float(o.get("expiresAt") or 0) / 1000
        except (ValueError, TypeError, AttributeError):
            continue
        if token and ends > now + 30 and (best is None or ends > best[0]):
            best = (ends, token)
    return best[1] if best else None


def rows(body: dict) -> list[dict]:
    """The service's answer as window rows, in the shape a turn reports them:
    a share of the window rather than a percentage, and a clock in seconds."""
    out = []
    for window in WINDOWS:
        w = body.get(window)
        if not isinstance(w, dict) or not isinstance(w.get("utilization"), (int, float)):
            continue
        try:
            resets = datetime.fromisoformat(str(w.get("resets_at"))).timestamp()
        except ValueError:
            resets = None
        out.append({"window": window, "utilization": float(w["utilization"]) / 100, "resets_at": resets})
    return out


def read(a: acct.Account) -> list[dict]:
    """Ask the service where this sign-in's plan stands. Never raises; nothing
    to say is an empty list."""
    if a.provider != "claude" or a.api_key:
        return []
    token = _token(a, time.time())
    if not token:
        return []
    req = urllib.request.Request(URL, headers={
        "Authorization": "Bearer " + token, "anthropic-beta": "oauth-2025-04-20"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            body = json.loads(r.read())
    except Exception:
        return []
    return rows(body) if isinstance(body, dict) else []
