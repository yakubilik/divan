"""uvicorn's proxy_headers rewrites the socket peer from X-Forwarded-For, so every
request cloudflared forwards looked like a forged tunnel request from outside and
got 403 (a tunnelled computer, 25 Nov 2026). The daemon reads the socket itself."""
import ast
from pathlib import Path

import divan.__main__ as m


def test_every_uvicorn_server_keeps_the_real_socket_peer():
    tree = ast.parse(Path(m.__file__).read_text())
    configs = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
               and getattr(n.func, "attr", None) == "Config"]
    assert configs
    for c in configs:
        kw = {k.arg: k.value for k in c.keywords}
        assert "proxy_headers" in kw and kw["proxy_headers"].value is False
