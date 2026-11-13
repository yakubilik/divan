"""The bridge over HTTP: nothing without a token, and a token only through the password."""
import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.testclient import TestClient

from divan import mcp_auth, mcp_bridge
from test_mcp_bridge import home  # noqa: F401  (fixture)

URL = "https://mcp.example.dev"
REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Host": "mcp.example.dev"}


@pytest.fixture
def client(home, tmp_path):  # noqa: F811
    provider = mcp_auth.Provider(URL, state_path=tmp_path / "oauth.json", password=lambda: "right horse")
    server = mcp_bridge.build(URL, provider=provider)
    from mcp.server.transport_security import TransportSecuritySettings
    app = server.streamable_http_app(stateless_http=True, json_response=True,
                                     transport_security=TransportSecuritySettings(allowed_hosts=["mcp.example.dev"]))
    with TestClient(app, base_url=URL) as c:
        c.provider = provider
        yield c


def _register(c, redirect=REDIRECT):
    return c.post("/register", json={"redirect_uris": [redirect], "token_endpoint_auth_method": "none",
                                     "grant_types": ["authorization_code", "refresh_token"],
                                     "response_types": ["code"], "client_name": "ChatGPT"})


def _authorize(c, client_id):
    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    r = c.get("/authorize", params={"response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT,
                                    "code_challenge": challenge, "code_challenge_method": "S256",
                                    "state": "s1", "scope": "divan.read"}, follow_redirects=False)
    assert r.status_code == 302, r.text
    rid = parse_qs(urlparse(r.headers["location"]).query)["r"][0]
    return rid, verifier


def _token(c, client_id):
    rid, verifier = _authorize(c, client_id)
    r = c.post("/login", data={"r": rid, "password": "right horse"}, follow_redirects=False)
    assert r.status_code == 302
    loc = urlparse(r.headers["location"])
    assert loc.netloc == "chatgpt.com" and parse_qs(loc.query)["state"] == ["s1"]
    code = parse_qs(loc.query)["code"][0]
    r = c.post("/token", data={"grant_type": "authorization_code", "code": code, "client_id": client_id,
                               "redirect_uri": REDIRECT, "code_verifier": verifier})
    assert r.status_code == 200, r.text
    return r.json()


def _call(c, token, method, params=None):
    h = dict(MCP_HEADERS)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return c.post("/mcp", headers=h, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})


def test_no_token_no_entry(client):
    r = _call(client, None, "tools/list")
    assert r.status_code == 401
    assert "resource_metadata" in r.headers.get("www-authenticate", "")


def test_only_openai_hosts_may_register(client):
    assert _register(client, "https://evil.example/cb").status_code == 400
    assert _register(client).status_code == 201


def test_wrong_password_then_lockout(client):
    cid = _register(client).json()["client_id"]
    rid, _ = _authorize(client, cid)
    for _ in range(mcp_auth.MAX_FAILS):
        assert client.post("/login", data={"r": rid, "password": "nope"}).status_code == 401
    assert client.post("/login", data={"r": rid, "password": "right horse"}).status_code == 429


def test_full_flow_reads_and_refreshes(client):
    cid = _register(client).json()["client_id"]
    tok = _token(client, cid)
    _call(client, tok["access_token"], "initialize", {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    r = _call(client, tok["access_token"], "tools/call",
              {"name": "divan_chat_result", "arguments": {"chat_id": "abcd1111"}})
    assert r.status_code == 200, r.text
    assert "bir" in r.text and "sk-ant-api03" not in r.text
    r = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                    "client_id": cid})
    assert r.status_code == 200, r.text
    # rotated: the old one is spent
    r = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                    "client_id": cid})
    assert r.status_code == 400
    assert "right horse" not in (client.provider.path.read_text())
    assert tok["access_token"] not in client.provider.path.read_text()
