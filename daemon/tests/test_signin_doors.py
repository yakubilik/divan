"""A sign-in leaves this computer only for a tailnet device.

    uv run python -m pytest -q tests/test_signin_doors.py

`account.export` hands over a Claude/Codex sign-in, a bearer credential, and
`account.import` writes one. Moving a sign-in is the phone's job, over the
tailnet (app/app/move-signin.tsx); the panel never asks. So a browser behind
the Cloudflare tunnel is answered `forbidden` for both, and the fleet gateway
answers `forbidden` itself rather than relay either to a peer. A tailnet
device is answered as before. The CLI is never run: the account helpers the
handlers call are replaced for the test.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-signin-")
os.environ["DIVAN_HOME"] = HOME
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
import tomli_w  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from divan import accounts as acct, config, fleet  # noqa: E402
from divan import server as servermod  # noqa: E402
from divan.config import Config  # noqa: E402
from divan.server import Server  # noqa: E402

TUNNEL_IP = "203.0.113.4"
BLOB = {"claudeAiOauth": {"accessToken": "sk-test-not-a-real-token"}}


def ws_call(client: TestClient, token: str, typ: str, data: dict, headers: dict | None = None) -> dict:
    with client.websocket_connect(f"/ws?token={token}", headers=headers or {}) as ws:
        ws.send_text(json.dumps({"id": 7, "type": typ, "data": data}))
        while True:
            msg = json.loads(ws.receive_text())
            if msg.get("id") == 7:
                return msg


@pytest.fixture()
def setup(monkeypatch):
    # conftest may have pointed config at its own home before this module ran.
    monkeypatch.setattr(config, "CONFIG_DIR", Path(HOME))
    monkeypatch.setattr(config, "CONFIG_PATH", Path(HOME) / "config.toml")
    monkeypatch.setattr(config, "LOG_DIR", Path(HOME) / "logs")
    cfg = Config.load()
    _, phone_tok = cfg.add_device("phone")
    _, browser_tok = cfg.add_device("tunnel browser", tunnel=True)
    raw = tomllib.loads(config.CONFIG_PATH.read_text())
    config.CONFIG_PATH.write_text(tomli_w.dumps({**raw, "tunnel_allow_ips": [TUNNEL_IP]}))
    srv = Server(Config.load())
    account = acct.Account(id="acc1", provider="claude", label="work", home=str(Path(HOME) / "acc1"))
    srv.accounts[account.id] = account
    calls: list[str] = []

    def refresh(a):
        a.logged_in = True
        return a

    def export(a):
        calls.append("export")
        return BLOB

    def import_(a, blob):
        calls.append("import")
        return a

    monkeypatch.setattr(servermod.acct, "refresh", refresh)
    monkeypatch.setattr(servermod.acct, "export_credentials", export)
    monkeypatch.setattr(servermod.acct, "import_credentials", import_)
    monkeypatch.setattr(servermod.acct, "verify_signed_in", lambda a: (True, ""))
    monkeypatch.setattr(srv, "_save_accounts", lambda: None)
    # The tunnel's header is believed only from this machine (cloudflared runs
    # here), so the test client speaks from loopback.
    with TestClient(srv.app, client=("127.0.0.1", 50000)) as client:
        yield client, phone_tok, browser_tok, calls
    shutil.rmtree(HOME, ignore_errors=True)


def test_tunnel_device_cannot_move_a_signin(setup):
    client, _, browser_tok, calls = setup
    via = {"CF-Connecting-IP": TUNNEL_IP}
    out = ws_call(client, browser_tok, "account.export", {"account_id": "acc1"}, via)
    assert out["type"] == "error" and out["data"]["code"] == "forbidden", out
    assert "credentials" not in json.dumps(out["data"]) and BLOB["claudeAiOauth"]["accessToken"] not in json.dumps(out)
    out = ws_call(client, browser_tok, "account.import", {"account_id": "acc1", "credentials": BLOB}, via)
    assert out["type"] == "error" and out["data"]["code"] == "forbidden", out
    assert calls == []
    # The same browser is otherwise served: it is the door, not the socket.
    assert ws_call(client, browser_tok, "ping", {}, via)["type"] == "ok"


def test_tailnet_device_moves_a_signin_as_before(setup):
    client, phone_tok, _, calls = setup
    out = ws_call(client, phone_tok, "account.export", {"account_id": "acc1"})
    assert out["type"] == "ok", out
    assert out["data"]["credentials"] == BLOB and out["data"]["provider"] == "claude"
    out = ws_call(client, phone_tok, "account.import", {"account_id": "acc1", "credentials": BLOB})
    assert out["type"] == "ok" and out["data"]["verified"] is True, out
    assert calls == ["export", "import"]


@pytest.mark.parametrize("typ", ["account.export", "account.import"])
def test_gateway_answers_forbidden_and_relays_nothing(typ):
    raw = json.dumps({"id": 3, "type": typ, "data": {"account_id": "acc1", "credentials": BLOB}})
    fwd, answer = fleet.filter_request(raw)
    assert fwd is None
    assert answer == {"id": 3, "type": "error", "data": {"code": "forbidden", "message": fleet.BLOCKED[typ]}}
