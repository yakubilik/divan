"""Rehearse the panel going live without a restart, away from the real daemon.

    python daemon/scripts/rehearse_panel_swap.py <old-sha>

What a merge to main does to the web panel: the daemon's self-update runs
`updater.build_panel`, which builds `web/` to a sibling directory and swaps it
in under `webui/` while the server keeps running. This does the same thing on
a throwaway daemon — its own RAC_HOME, its own port, this checkout's code — so
it can be checked before the merge:

  1. the panel built from <old-sha> is served, and `/build.json` names it;
  2. `build_panel` on this checkout swaps the new bundle in;
  3. the same server process, never restarted, now answers `/build.json` with
     this checkout's HEAD, and the bundle it serves is the new one.

Nothing here touches the running daemon, its config, database or chats.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path(tempfile.mkdtemp(prefix="rac-panel-swap-"))
os.environ["RAC_HOME"] = str(SCRATCH / "home")
sys.path.insert(0, str(ROOT / "daemon"))

import uvicorn  # noqa: E402
from remote_ai_chat import updater  # noqa: E402
from remote_ai_chat.config import Config  # noqa: E402

PORT = int(os.environ.get("REHEARSE_PORT", "8796"))
MARK = os.environ.get("REHEARSE_MARK", "Go details")


def get(path: str) -> str:
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=10) as r:
        return r.read().decode("utf-8", "replace")


def served() -> tuple[str | None, bool]:
    """The sha the served bundle says it is, and whether its code has MARK."""
    sha = json.loads(get("/build.json")).get("sha")
    index = get("/")
    scripts = [p.split('"')[0] for p in index.split('src="')[1:] if p.startswith("/assets/")]
    return sha, any(MARK in get(s) for s in scripts)


def main() -> int:
    old = sys.argv[1]
    head = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    if updater.PANEL_DIR.resolve().parents[2] != ROOT:
        print("refusing: the panel directory is not this checkout's"); return 2

    # 1 · the old panel, built from <old-sha>'s web/ by the same function.
    old_root = SCRATCH / "old"
    (old_root / "web").mkdir(parents=True)
    archive = subprocess.run(["git", "-C", str(ROOT), "archive", old, "web"], check=True, capture_output=True).stdout
    subprocess.run(["tar", "-x", "-C", str(old_root)], input=archive, check=True)
    ok, msg = asyncio.run(updater.build_panel(old_root))
    if not ok:
        print("old build failed:", msg); return 1
    (updater.PANEL_DIR / updater.STAMP).write_text(json.dumps({"sha": old, "built_at": time.time()}))

    cfg = Config.load()
    cfg.bind = ["127.0.0.1"]; cfg.port = PORT; cfg.auto_update = False
    cfg.allowed_roots = [str(SCRATCH)]
    from remote_ai_chat.server import Server
    server = uvicorn.Server(uvicorn.Config(Server(cfg).app, host="127.0.0.1", port=PORT, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started: break
        time.sleep(0.1)
    before = served()
    print(f"before swap: pid {os.getpid()} serves {before[0]}  has {MARK!r}: {before[1]}")

    # 2 · the swap a merge triggers.
    ok, msg = asyncio.run(updater.build_panel(ROOT))
    print("build_panel:", ok, msg)

    # 3 · same process, same server, new bundle.
    after = served()
    alive = thread.is_alive() and server.started and not server.should_exit
    deep = get("/chats/c1") == get("/")
    print(f"after swap:  pid {os.getpid()} serves {after[0]}  has {MARK!r}: {after[1]}  server never restarted: {alive}  /chats/c1 is the panel: {deep}")
    good = (before[0] == old and not before[1] and ok and after[0] == head and after[1] and alive and deep)
    server.should_exit = True
    thread.join(timeout=10)
    print("PASS" if good else "FAIL")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
