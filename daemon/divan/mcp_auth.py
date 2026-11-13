"""OAuth for the MCP bridge when it is reached over a public HTTPS address.

One person, one password. ChatGPT registers itself (dynamic client
registration), sends the browser to `/authorize`, and this sends it on to a
small page here that asks for the password kept in the keychain. Right password:
an authorization code goes back to ChatGPT, which trades it for tokens. Nothing
else can get a token, and a token only reads (the bridge has no other tools).

The door, in order:
  * a client may only register redirect addresses on OpenAI's own hosts, so a
    stranger cannot use this page to collect a code for themselves;
  * the password page refuses everybody for 15 minutes after 5 wrong tries;
  * codes live 5 minutes, access tokens an hour, refresh tokens 30 days and
    are rotated on use;
  * only hashes of tokens are written to disk (`mcp-oauth.json`, mode 600), so
    the file is no key to the bridge.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import secrets as pysecrets
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizationParams, AuthorizeError,
    RefreshToken, RegistrationError, TokenError, construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from .config import resolve_home

PASSWORD_SERVICE = os.environ.get("DIVAN_MCP_PASSWORD_SERVICE", "rac-secret-divan-mcp")
#: Where a registered client may send a code. ChatGPT's connector redirect
#: lives on chatgpt.com; the others are OpenAI's other surfaces.
REDIRECT_HOSTS = tuple(h.strip() for h in os.environ.get(
    "DIVAN_MCP_REDIRECT_HOSTS", "chatgpt.com,chat.openai.com,platform.openai.com").split(",") if h.strip())

CODE_TTL = 300
ACCESS_TTL = 3600
REFRESH_TTL = 30 * 86400
PENDING_TTL = 600
MAX_FAILS = 5
LOCKOUT = 900
SCOPE = "divan.read"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def keychain_password() -> str | None:
    try:
        out = subprocess.run(["security", "find-generic-password", "-s", PASSWORD_SERVICE, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


class Provider:
    """`OAuthAuthorizationServerProvider` for a single person behind one password."""

    def __init__(self, public_url: str, state_path: Path | None = None,
                 password: callable = keychain_password):
        self.public_url = public_url.rstrip("/")
        self.path = state_path or (resolve_home() / "mcp-oauth.json")
        self._password = password
        self.pending: dict[str, tuple[float, str, AuthorizationParams]] = {}
        self.codes: dict[str, AuthorizationCode] = {}
        self.fails: list[float] = []
        self.state = self._load()

    # --- persistence: clients and token hashes survive a restart ------------
    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            data = {}
        data.setdefault("clients", {})
        data.setdefault("access", {})
        data.setdefault("refresh", {})
        return data

    def _save(self) -> None:
        now = time.time()
        for kind in ("access", "refresh"):
            self.state[kind] = {k: v for k, v in self.state[kind].items()
                                if not v.get("expires_at") or v["expires_at"] > now}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    # --- clients -------------------------------------------------------------
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        raw = self.state["clients"].get(client_id)
        return OAuthClientInformationFull.model_validate(raw) if raw else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        for uri in client_info.redirect_uris or []:
            u = urlparse(str(uri))
            if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")
                                            and "localhost" in REDIRECT_HOSTS):
                raise RegistrationError("invalid_redirect_uri", "redirects must be https")
            if u.hostname not in REDIRECT_HOSTS:
                raise RegistrationError("invalid_redirect_uri", f"{u.hostname} may not receive codes here")
        self.state["clients"][client_info.client_id] = client_info.model_dump(mode="json", exclude_none=True)
        self._save()

    # --- the password step ---------------------------------------------------
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        now = time.time()
        self.pending = {k: v for k, v in self.pending.items() if v[0] > now}
        rid = pysecrets.token_urlsafe(24)
        self.pending[rid] = (now + PENDING_TTL, client.client_id, params)
        return f"{self.public_url}/login?r={rid}"

    def locked(self) -> bool:
        now = time.time()
        self.fails = [t for t in self.fails if t > now - LOCKOUT]
        return len(self.fails) >= MAX_FAILS

    async def login_page(self, request: Request) -> Response:
        rid = request.query_params.get("r") or ""
        if request.method == "POST":
            form = await request.form()
            rid = str(form.get("r") or "")
        entry = self.pending.get(rid)
        if not entry or entry[0] < time.time():
            return _page("This sign-in has expired. Start again from ChatGPT.", status=400)
        _, client_id, params = entry
        if request.method == "GET":
            return _page(None, rid=rid)
        if self.locked():
            return _page("Too many wrong passwords. Try again in 15 minutes.", status=429)
        given = str(form.get("password") or "")
        expected = self._password()
        if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
            self.fails.append(time.time())
            return _page("Wrong password.", rid=rid, status=401)
        del self.pending[rid]
        code = pysecrets.token_urlsafe(32)
        self.codes[code] = AuthorizationCode(
            code=code, scopes=params.scopes or [SCOPE], expires_at=time.time() + CODE_TTL,
            client_id=client_id, code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource, subject="owner")
        return RedirectResponse(construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state),
                                status_code=302)

    # --- codes and tokens ----------------------------------------------------
    async def load_authorization_code(self, client, authorization_code: str):
        code = self.codes.get(authorization_code)
        if not code or code.client_id != client.client_id or code.expires_at < time.time():
            return None
        return code

    def _issue(self, client_id: str, scopes: list[str], resource: str | None) -> OAuthToken:
        access, refresh = pysecrets.token_urlsafe(32), pysecrets.token_urlsafe(32)
        now = int(time.time())
        common = {"client_id": client_id, "scopes": scopes, "resource": resource}
        self.state["access"][_hash(access)] = {**common, "expires_at": now + ACCESS_TTL}
        self.state["refresh"][_hash(refresh)] = {**common, "expires_at": now + REFRESH_TTL}
        self._save()
        return OAuthToken(access_token=access, expires_in=ACCESS_TTL, scope=" ".join(scopes),
                          refresh_token=refresh)

    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode) -> OAuthToken:
        if self.codes.pop(authorization_code.code, None) is None:
            raise TokenError("invalid_grant", "code already used")
        return self._issue(client.client_id, authorization_code.scopes, authorization_code.resource)

    async def load_refresh_token(self, client, refresh_token: str):
        raw = self.state["refresh"].get(_hash(refresh_token))
        if not raw or raw["client_id"] != client.client_id or raw["expires_at"] < time.time():
            return None
        return RefreshToken(token=refresh_token, subject="owner", **raw)

    async def exchange_refresh_token(self, client, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        if self.state["refresh"].pop(_hash(refresh_token.token), None) is None:
            raise TokenError("invalid_grant", "refresh token already used")
        return self._issue(client.client_id, scopes or refresh_token.scopes, refresh_token.resource)

    async def load_access_token(self, token: str):
        raw = self.state["access"].get(_hash(token))
        if not raw or raw["expires_at"] < time.time():
            return None
        return AccessToken(token=token, subject="owner", **raw)

    async def revoke_token(self, token) -> None:
        h = _hash(token.token)
        self.state["access"].pop(h, None)
        self.state["refresh"].pop(h, None)
        self._save()


def _page(error: str | None, rid: str = "", status: int = 200) -> HTMLResponse:
    form = "" if not rid else f"""
<form method="post" action="/login">
  <input type="hidden" name="r" value="{html.escape(rid)}">
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Allow read access</button>
</form>"""
    err = f'<p class="err">{html.escape(error)}</p>' if error else ""
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Divan</title>
<style>body{{font:16px -apple-system,system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px}}
input,button{{font:inherit;width:100%;padding:12px;margin:6px 0;box-sizing:border-box;border-radius:10px;border:1px solid #ccc}}
button{{background:#111;color:#fff;border:0}}.err{{color:#b00}}</style></head><body>
<h2>Divan</h2><p>ChatGPT asks to read your chats and tickets on this computer. It cannot change anything.</p>
{err}{form}</body></html>""", status_code=status, headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})
