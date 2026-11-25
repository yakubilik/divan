"""A computer that cannot join the tailnet is reached through its own Cloudflare
tunnel, on 443, which speaks only TLS (25 Nov 2026)."""
from divan.fleet import Peer, http_base, upstream_url


def test_a_tunnelled_peer_is_dialled_over_tls_and_a_tailnet_one_is_not():
    tunnelled = Peer(id="a", name="kurgu", host="kurgu.yakupkeskin.dev", port=443, token="t")
    tailnet = Peer(id="b", name="w", host="100.76.67.2", port=8790, token="t")
    assert (upstream_url(tunnelled), http_base(tunnelled)) == (
        "wss://kurgu.yakupkeskin.dev/ws", "https://kurgu.yakupkeskin.dev")
    assert (upstream_url(tailnet), http_base(tailnet)) == (
        "ws://100.76.67.2:8790/ws", "http://100.76.67.2:8790")
