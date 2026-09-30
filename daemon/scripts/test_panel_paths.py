#!/usr/bin/env python3
"""The panel's own addresses, served.

    .venv312/bin/python scripts/test_panel_paths.py

The panel has pages now, and they are paths rather than a query string:
`/p/babysee/board`, `/machine/accounts`, `/chats/<id>`. None of them is a file
on disk — the browser routes them once the bundle is running — so the daemon
has to answer a request for one with `index.html`, or every reload of a deep
address is a 404 and every link somebody sends is broken.

That is one behaviour with two halves, and the second is the one worth a check
of its own: **a miss that really is a miss stays a 404.** A mistyped script tag
answered with HTML fails three stacks deeper, in the browser, as a syntax error
in what it thought was JavaScript — so anything under `/assets/` and anything
with a file extension is left alone.

Nothing here talks to a model, a socket or a real computer: it is the mount
from `server.py`, a temporary directory shaped like a built panel, and a test
client.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

failures = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failures
    if cond:
        return
    failures += 1
    print(f"  x {name}" + (f"\n    {detail}" if detail else ""))


def build_panel(root: Path) -> Path:
    """A directory shaped like a built panel: an index, a hashed asset, the
    build stamp the updater reads."""
    panel = root / "webui"
    (panel / "assets").mkdir(parents=True)
    (panel / "index.html").write_text(
        '<!doctype html><html><head><script src="/assets/index-abc123.js">'
        "</script></head><body><div id=root></div></body></html>")
    (panel / "assets" / "index-abc123.js").write_text("console.log('panel')")
    (panel / "build.json").write_text('{"sha": "deadbeef", "built_at": 1}')
    return panel


def app_for(panel: Path) -> FastAPI:
    """The mount as `server.py` writes it — the caching, and the fallback."""
    class Panel(StaticFiles):
        def file_response(self, full_path, stat_result, scope, status_code=200):
            r = super().file_response(full_path, stat_result, scope, status_code)
            name = Path(str(full_path)).name
            if "/assets/" in str(full_path).replace("\\", "/"):
                r.headers["cache-control"] = "public, max-age=31536000, immutable"
            elif name in ("index.html", "build.json"):
                r.headers["cache-control"] = "no-store, must-revalidate"
            else:
                r.headers["cache-control"] = "no-cache"
            return r

    class Deep(Panel):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != 404:
                    raise
                tail = path.rsplit("/", 1)[-1]
                if path.startswith("assets/") or "." in tail:
                    raise
                return await super().get_response("index.html", scope)

    app = FastAPI()
    app.get("/health")(lambda: {"ok": True})
    app.mount("/", Deep(directory=str(panel), html=True), name="panel")
    return app


def main() -> int:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        panel = build_panel(Path(tmp))
        c = TestClient(app_for(panel), raise_server_exceptions=False)

        print("-- the panel, and every address inside it")
        r = c.get("/")
        ok("the panel itself is served", r.status_code == 200 and "<div id=root>" in r.text)
        for path in ("/p/babysee", "/p/babysee/board", "/p/babysee/b/engineering",
                     "/p/babysee/c/0d2279020af7", "/machine/accounts", "/chats",
                     "/chats/c1", "/chats/c1?host=studio"):
            r = c.get(path)
            ok(f"{path} comes back as the panel",
               r.status_code == 200 and "<div id=root>" in r.text,
               f"{r.status_code} {r.headers.get('content-type')}")
        ok("…and never cached, so a new build is picked up on the next load",
           c.get("/p/babysee/board").headers.get("cache-control") == "no-store, must-revalidate")

        print("-- a miss that is really a miss")
        ok("a script that is not there is a 404 and not HTML",
           c.get("/assets/index-nope.js").status_code == 404)
        ok("…as is anything else with an extension on it",
           c.get("/favicon.ico").status_code == 404
           and c.get("/p/babysee/thing.png").status_code == 404)
        ok("the asset that is there is served, and kept for ever",
           c.get("/assets/index-abc123.js").status_code == 200
           and "immutable" in c.get("/assets/index-abc123.js").headers.get("cache-control", ""))

        print("-- the routes that are not the panel's")
        ok("a route registered before the mount still wins",
           c.get("/health").json() == {"ok": True})

    print("\nall good" if not failures else f"\n{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
