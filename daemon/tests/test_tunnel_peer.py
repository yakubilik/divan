"""CF-Connecting-IP is cloudflared's, and cloudflared is on this machine: the
header is believed from loopback and refused from anywhere else."""
import pytest
from fastapi import HTTPException

from divan.security import SOCKET_PEER, ForgedTunnel, forged_peer, is_loopback, tunnel_via


@pytest.mark.parametrize("host", ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"])
def test_loopback(host):
    assert is_loopback(host)


@pytest.mark.parametrize("host", ["100.101.102.103", "192.168.178.20", "::ffff:192.168.1.2",
                                  "fd7a:115c:a1e0::1", "testclient", "", None, "0.0.0.0"])
def test_not_loopback(host):
    assert not is_loopback(host)


def test_the_header_is_read_only_from_loopback():
    assert tunnel_via(None, "100.101.102.103") is None
    assert tunnel_via(None, None) is None
    assert tunnel_via("203.0.113.4, 10.0.0.1", "127.0.0.1") == "203.0.113.4"
    assert tunnel_via("203.0.113.4", "::1") == "203.0.113.4"
    for peer in ("100.101.102.103", "192.168.178.20", None, "testclient"):
        with pytest.raises(ForgedTunnel):
            tunnel_via("203.0.113.4", peer)


def test_forged_peer_reads_the_scope():
    h = [(b"cf-connecting-ip", b"203.0.113.4")]
    assert forged_peer({"headers": h, "client": ("127.0.0.1", 1)}) is None
    assert forged_peer({"headers": h, "client": ("100.1.2.3", 1)}) == "100.1.2.3"
    assert forged_peer({"headers": h, "client": None}) == "?"
    assert forged_peer({"headers": [], "client": ("100.1.2.3", 1)}) is None


def test_a_route_refuses_the_header_without_the_gate_in_front(tmp_path, monkeypatch):
    """`Server._device` checks the socket itself, so a route reached without
    TunnelGate around it (no peer known) still does not take the header."""
    from divan.server import Server

    class Bare:
        def _admit(self, token, via, peer=None):
            raise AssertionError("the token must not be looked at")

    with pytest.raises(HTTPException) as exc:
        Server._device(Bare(), "Bearer t", "203.0.113.4")
    assert exc.value.status_code == 403
    seen = []

    class Counting:
        def _admit(self, token, via, peer=None):
            seen.append(via)
            return object(), ""

    tok = SOCKET_PEER.set("127.0.0.1")
    try:
        Server._device(Counting(), "Bearer t", "203.0.113.4")
    finally:
        SOCKET_PEER.reset(tok)
    Server._device(Counting(), "Bearer t", None)
    assert seen == ["203.0.113.4", None]
