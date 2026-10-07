"""CLI: serve | pair | web | project | demo-seed | devices | revoke | unlock | status"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import sys
import time

from .config import CONFIG_DIR, Config, LOG_DIR, DEFAULT_PORT


def _sanitize_env() -> None:
    """Drop env vars a parent Claude Code session would leak into the CLI
    subprocesses (they point at a session-scoped proxy / expired token)."""
    import os
    for k in list(os.environ):
        if k.startswith(("CLAUDE_CODE_", "CLAUDE_AGENT_SDK", "CLAUDE_PREVIEW")) or k in (
            "CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "ANTHROPIC_BASE_URL",
        ):
            os.environ.pop(k, None)


def _already_serving(port: int) -> bool:
    """Is another daemon already answering on this port?"""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
            return b'"ok":true' in r.read(200)
    except Exception:
        return False


def _panel_built() -> bool:
    return (Path(__file__).parent / "webui" / "index.html").exists()


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn
    _sanitize_env()
    from .server import Server

    cfg = Config.load()
    if args.bind:
        cfg.bind = args.bind
    if args.port:
        cfg.port = args.port
    if _already_serving(cfg.port):
        # Windows lets a second process bind the same port (SO_REUSEADDR), so a
        # duplicate daemon does not fail loudly — it quietly shares the SQLite
        # file and config.toml with the first one and they overwrite each other.
        print(f"remote-ai-chat is already running (127.0.0.1:{cfg.port}).", file=sys.stderr)
        return
    binds = cfg.resolve_bind()
    if not binds:
        print("No address to bind to (is Tailscale down?). Try --bind 127.0.0.1.", file=sys.stderr)
        sys.exit(2)
    if not cfg.devices:
        print("No paired device yet. Run: remote-ai-chat pair", file=sys.stderr)

    srv = Server(cfg)

    async def main() -> None:
        servers = []
        for host in binds:
            # uvicorn's own websocket keepalive tears every connection down at
            # exactly ws_ping_interval + ws_ping_timeout, whether or not the
            # client answered the pings — a plain `websockets` client, which
            # pongs for you, dies on the 40s dot the same as the phone does. And
            # the close never reaches the client, so the phone goes on believing
            # it is online while events quietly stop arriving; the backlog only
            # lands when something else finally times out. The phone sends a
            # `ping` request of its own every 15s (see app/src/ws.ts), which is a
            # liveness check we can actually trust: it proves the app is on the
            # other end and this loop is still serving it.
            # `timeout_graceful_shutdown` because every client here holds a
            # long-lived websocket, and uvicorn's default is to wait for open
            # connections forever. The draining already happened by the time
            # this fires — whatever is still attached is a socket, not work, and
            # a restart must not be hostage to one that will not close.
            uc = uvicorn.Config(srv.app, host=host, port=cfg.port, log_level="warning",
                                ws_ping_interval=None, ws_ping_timeout=None,
                                timeout_graceful_shutdown=10)
            servers.append(uvicorn.Server(uc))
        print(f"remote-ai-chat {cfg.host_name} listening on: " + ", ".join(f"ws://{h}:{cfg.port}/ws" for h in binds))
        reaper = asyncio.create_task(srv.reaper())
        updater = asyncio.create_task(srv.updater.loop())
        resumer = asyncio.create_task(srv.resume_interrupted())
        follower = asyncio.create_task(srv.follow_tickets())
        warmer = asyncio.create_task(srv.warm_models())

        async def stopper() -> None:
            """Stand down once an update has been staged.

            The new code is already on disk by the time this fires; this process
            is the only thing still running the old code. Exiting hands over to
            whatever keeps the daemon alive on this machine — launchd with
            KeepAlive on macOS, start.ps1 on Windows — and it comes back on the
            new commit within seconds.
            """
            await srv.restart_requested.wait()
            print("update staged — stopping so the supervisor can restart us")
            for s in servers:
                s.should_exit = True

        stop = asyncio.create_task(stopper())
        try:
            await asyncio.gather(*(s.serve() for s in servers))
        finally:
            reaper.cancel()
            updater.cancel()
            resumer.cancel()
            follower.cancel()
            warmer.cancel()
            stop.cancel()
            await srv.sessions.close_all()
            await srv.concierge.close()

    asyncio.run(main())


def cmd_pair(args: argparse.Namespace) -> None:
    cfg = Config.load()
    dev, token = cfg.add_device(args.name)
    # The phone must reach the Tailscale address even when the daemon only binds
    # 127.0.0.1 (Windows without admin: `tailscale serve` forwards to loopback).
    from .config import tailscale_ip
    binds = [b for b in cfg.resolve_bind() if not b.startswith("127.")]
    host = tailscale_ip() or (binds[0] if binds else "127.0.0.1")
    payload = {"v": 1, "host": host, "port": cfg.port, "token": token,
               "name": cfg.host_name, "device_id": dev.id}
    text = json.dumps(payload, separators=(",", ":"))
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(text)
        qr.print_ascii(invert=True)
    except Exception:
        pass
    from urllib.parse import urlencode
    link = "remoteaichat://pair?" + urlencode({"host": host, "port": cfg.port, "token": token,
                                              "name": cfg.host_name, "device_id": dev.id})
    print(f"\nDevice: {dev.name} ({dev.id})  Host: {host}:{cfg.port}")
    print("Token for manual entry (shown once):")
    print(token)
    print("\nOr open this link on the phone:")
    print(link)


def cmd_web(args: argparse.Namespace) -> None:
    """Open the desktop panel in a browser, paired.

    The panel is just another device: it gets its own token, shows up in
    `devices`, and `revoke` cuts it off like it cuts off a phone. The token
    rides in the URL fragment, which browsers never send to a server and which
    the panel wipes out of the address bar once it has stored it.
    """
    from urllib.parse import urlencode
    cfg = Config.load()
    if not _panel_built():
        print("The panel is not built. Run: cd web && npm install && npm run build")
        return
    if not _already_serving(cfg.port):
        print(f"Nothing answers on port {cfg.port}. Start it first: remote-ai-chat serve")
        return
    # `--at` is the panel behind a tunnel (docs/TUNNEL.md): the browser is
    # somewhere else, so the address it dials is the tunnel's hostname on 443
    # and not this machine's loopback, and there is no browser here to open it
    # in. The device is marked as the tunnel's, which is the only door its
    # token opens; otherwise it is a device like any other — its own line in
    # `devices`, revocable on its own.
    dev, token = cfg.add_device(args.name, tunnel=bool(args.at))
    host, port = (args.at, 443) if args.at else ("127.0.0.1", cfg.port)
    scheme = "https" if args.at else "http"
    url = f"{scheme}://{host}:{port}/#" + urlencode({
        "t": token, "h": host, "p": port, "n": cfg.host_name, "d": dev.id,
    })
    print(f"Device: {dev.name} ({dev.id})")
    print(url)
    if args.at and not cfg.tunnel_allow_ips:
        print("\nNote: tunnel_allow_ips is empty, so the tunnel will refuse this"
              "\naddress along with every other. Add the browser's address to"
              "\n~/.remote-ai-chat/config.toml first — see docs/TUNNEL.md.")
    if not args.no_open and not args.at:
        import webbrowser
        webbrowser.open(url)


def _device_line(d) -> str:
    """One device, on one line: which door it uses, and when and where it last did."""
    seen = (time.strftime("%Y-%m-%d %H:%M", time.localtime(d.last_seen))
            if d.last_seen else "never")
    line = (f"{d.id}  {d.name:20s}  push={'yes' if d.push_token else 'no'}"
            f"  {'tunnel' if d.tunnel else '      '}  seen={seen}")
    if d.tunnel and d.last_addr:
        line += f"  from={d.last_addr}"
    return line.rstrip()


def cmd_devices(args: argparse.Namespace) -> None:
    cfg = Config.load()
    if not cfg.devices:
        print("(no devices)")
    for d in cfg.devices.values():
        print(_device_line(d))


def cmd_revoke(args: argparse.Namespace) -> None:
    cfg = Config.load()
    print("revoked" if cfg.revoke(args.device_id) else "no such device")


def cmd_unlock(args: argparse.Namespace) -> None:
    """Lift a tunnel lock on the running daemon (docs/TUNNEL.md).

    The lock lives only in the daemon's memory, so this asks the daemon — over
    loopback, as a device minted for the call — rather than editing a file.
    """
    cfg = Config.load()
    if not _already_serving(cfg.port):
        print(f"Nothing answers on port {cfg.port}, so nothing is locked.", file=sys.stderr)
        sys.exit(2)
    out = asyncio.run(_protocol(cfg, "tunnel.unlock", {"addr": args.addr}))
    print(f"unlocked {out.get('addr')}" if out.get("was_locked")
          else f"{out.get('addr')} was not locked")


# ── products, from a shell on the computer they are run from ─────────────────
#
# Divan has no form for making a project and is not getting one. A product is
# something a person decides exists, and the way that is said is a sentence in
# the app's chat — so the thing that has to be able to make one is the agent in
# that chat, which has this shell and no screen at all.
#
# So this is that entrance, and it goes the way the phone goes: the
# `divan.project.*` requests over the daemon's own socket, through the handlers
# that fence a repository path and refuse a field nobody has. Writing to the
# database directly would skip both, on the one table whose rows decide where an
# autonomous worker gets a shell.

#: How long the daemon is given to answer. Generous for a call over loopback,
#: because the first connection to a daemon that has just started costs it a
#: probe of every CLI it can find (seconds, once) — and a request that gave up
#: early would be a product created by a command that printed a timeout, which
#: the next attempt would then refuse as a duplicate.
_ANSWER_TIMEOUT_S = 120


async def _protocol(cfg: Config, typ: str, data: dict) -> dict:
    """One request to the daemon on this computer, as a paired device.

    The token is minted for the call and revoked after it, the way `web` mints
    one for a browser: a command that leaves a permanent key in the device list
    is a key nobody knows is there.
    """
    import websockets
    dev, token = cfg.add_device("cli")
    try:
        uri = f"ws://127.0.0.1:{cfg.port}/ws?token={token}"
        async with websockets.connect(uri, max_size=8 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"id": 1, "type": typ, "data": data}))
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), _ANSWER_TIMEOUT_S)
                except asyncio.TimeoutError:
                    raise SystemExit(
                        "the daemon did not answer. It may have done the work"
                        " anyway — check `remote-ai-chat project list` before"
                        " trying again.")
                msg = json.loads(raw)
                if msg.get("id") != 1:
                    # Every connection opens with a `host.status` event.
                    continue
                if msg.get("type") == "error":
                    d = msg.get("data") or {}
                    raise SystemExit(f"{d.get('code') or 'refused'}: {d.get('message')}")
                return msg.get("data") or {}
    finally:
        cfg.revoke(dev.id, remember=False)


#: The flags, and the fields they are. Kept as a table because the mapping is
#: the whole of this command: `--started` is `started_at`, and a flag nobody
#: passed is not a field set to nothing.
PROJECT_FLAGS = (("name", "name"), ("slug", "slug"), ("kind", "kind"),
                 ("purpose", "purpose"), ("started", "started_at"),
                 ("stage", "stage"), ("sort", "sort"))


def _project_fields(args: argparse.Namespace) -> dict:
    """The fields this invocation actually gives.

    Only what was passed. `--purpose ""` clears a purpose and no `--purpose` at
    all leaves it alone, and the request tells those apart by whether the key is
    in the object — which is also why `--archive` and `--unarchive` are two
    flags and not one with a value.
    """
    out: dict = {}
    for flag, field in PROJECT_FLAGS:
        value = getattr(args, flag, None)
        if value is not None:
            out[field] = value
    if getattr(args, "repo", None) is not None:
        out["repos"] = list(args.repo)
    if getattr(args, "branch", None):
        out["branches"] = list(args.branch)
    if getattr(args, "archive", False):
        out["archived"] = True
    if getattr(args, "unarchive", False):
        out["archived"] = False
    return out


def _project_line(p: dict) -> str:
    """One product, on one line: what it is called, what it is, where it stands."""
    kind = f" ({p['kind']})" if p.get("kind") else ""
    stage = f" · {p['stage']}" if p.get("stage") else ""
    since = (" since " + time.strftime("%Y-%m-%d", time.localtime(p["started_at"]))
             if p.get("started_at") else "")
    where = p.get("summary_line") or ""
    return (f"{p.get('name', '')}{kind}{stage}  [{p.get('slug', '')}]{since}"
            + (f"  — {where}" if where else ""))


def cmd_project(args: argparse.Namespace) -> None:
    cfg = Config.load()
    if not _already_serving(cfg.port):
        print(f"Nothing answers on port {cfg.port}. Start it first: remote-ai-chat serve",
              file=sys.stderr)
        sys.exit(2)
    fields = _project_fields(args)
    if args.what == "list":
        out = asyncio.run(_protocol(cfg, "divan.projects", {}))
        if args.json:
            print(json.dumps(out, indent=2))
            return
        for p in out.get("projects") or []:
            print(_project_line(p))
            for repo in p.get("repos") or []:
                print(f"    {repo}")
        held = sum(((out.get("unfiled") or {}).get("counts") or {}).values())
        if held:
            print(f"\n{held} card(s) no product has claimed yet — `unfiled`.")
        return
    if args.what == "create":
        fields["name"] = args.name
        out = asyncio.run(_protocol(cfg, "divan.project.create", fields))
    else:
        fields["project"] = args.project
        out = asyncio.run(_protocol(cfg, "divan.project.update", fields))
    print(json.dumps(out, indent=2) if args.json else _project_line(out))


def _project_parser(sub) -> None:
    p = sub.add_parser("project", help="create or edit a product on the board")
    what = p.add_subparsers(dest="what", required=True)

    def shared(sp, creating: bool) -> None:
        sp.add_argument("--repo", action="append",
                        help="a repository this product owns; repeatable, and on"
                             " `update` it replaces the list")
        sp.add_argument("--kind", help="app, web, library, client work, research…")
        sp.add_argument("--purpose", help="what it is for, in a sentence or two")
        sp.add_argument("--started", help="when the product began: 2026-03-01")
        sp.add_argument("--stage", help="where it is in its life: idea, build, beta,"
                                       " live, growth")
        sp.add_argument("--json", action="store_true")
        if creating:
            sp.add_argument("--branch", action="append",
                            help="a branch beyond the default five; repeatable")
            sp.add_argument("--slug", help="the key every machine matches it by,"
                                          " when that is not the name")
        else:
            sp.add_argument("--name", help="what a screen calls it; the key stays put")
            sp.add_argument("--sort", type=int)
            sp.add_argument("--archive", action="store_true",
                            help="take it off the board without deleting it")
            sp.add_argument("--unarchive", action="store_true")

    ls = what.add_parser("list", help="every product, and what is unclaimed")
    ls.add_argument("--json", action="store_true")
    create = what.add_parser("create", help="a product. The only thing that makes one")
    create.add_argument("name")
    shared(create, True)
    update = what.add_parser("update", help="change one, by id, key or name")
    update.add_argument("project")
    shared(update, False)
    p.set_defaults(fn=cmd_project)


# ── a demo machine's first screen ────────────────────────────────────────────
#
# A reviewer pairs a phone with a demo machine (`demo = true`) and the first
# thing they see is Divan. Empty, it explains nothing; so this puts one product
# on it, a few cards across the board and one chat that has run, all through
# the same requests the phone makes. Everything is looked up by name before it
# is made, so running it again changes nothing.

DEMO_PROJECT = ("Sample app", "sample-app")
DEMO_PURPOSE = "A small app to show what a board and a chat look like."
DEMO_CARDS = (
    ("Sign in with Apple", "Let people sign in with their Apple ID.", "done"),
    ("Offline reading", "Keep the last ten articles readable without a connection.",
     "in_progress"),
    ("Fix the README typo", "The first line says 'exmaple'.", "review"),
    ("Export notes as PDF", "One button, one file, shareable.", "queued"),
    ("Home screen widget", "Today's reading time at a glance.", "ice_box"),
)
DEMO_CHAT = "Fix the README typo"
DEMO_README = "# Sample app\n\nA small exmaple project.\n"


class _Link:
    """Several requests over one socket, and the events that arrive between them.

    `_protocol` is one request and done; seeding a chat has to send a message,
    answer the approval it raises and wait for the turn to end, all as the same
    device.
    """

    def __init__(self, ws) -> None:
        self.ws = ws
        self.rid = 0
        self.events: list[dict] = []

    async def call(self, typ: str, data: dict) -> dict:
        self.rid += 1
        rid = self.rid
        await self.ws.send(json.dumps({"id": rid, "type": typ, "data": data}))
        while True:
            msg = await self._recv()
            if msg.get("id") != rid:
                continue
            if msg.get("type") == "error":
                d = msg.get("data") or {}
                raise SystemExit(f"{typ}: {d.get('code') or 'refused'}: {d.get('message')}")
            return msg.get("data") or {}

    async def event(self, chat_id: str, names: tuple[str, ...]) -> dict:
        """The next event of one of these kinds for this chat."""
        while True:
            for i, ev in enumerate(self.events):
                if ev.get("chat_id") == chat_id and ev.get("event") in names:
                    return self.events.pop(i)
            await self._recv()

    async def _recv(self) -> dict:
        try:
            raw = await asyncio.wait_for(self.ws.recv(), _ANSWER_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise SystemExit("the daemon did not answer")
        msg = json.loads(raw)
        if msg.get("type") == "event":
            self.events.append(msg)
        return msg


async def _demo_seed(cfg: Config, folder: Path) -> dict:
    import websockets
    dev, token = cfg.add_device("cli")
    made = {"project": 0, "cards": 0, "chat": 0}
    try:
        uri = f"ws://127.0.0.1:{cfg.port}/ws?token={token}"
        async with websockets.connect(uri, max_size=8 * 1024 * 1024) as ws:
            link = _Link(ws)
            name, slug = DEMO_PROJECT
            listed = await link.call("divan.projects", {})
            project = next((p for p in listed.get("projects") or []
                            if p.get("slug") == slug), None)
            if project is None:
                project = await link.call("divan.project.create", {
                    "name": name, "slug": slug, "kind": "app",
                    "purpose": DEMO_PURPOSE, "repos": [str(folder)]})
                made["project"] = 1
            board = await link.call("divan.board", {"project_id": project["id"]})
            have = {c["title"] for col in (board.get("columns") or {}).values() for c in col}
            # Created bottom of the board first, so each column reads top-down
            # in the order written above.
            for title, summary, column in reversed(DEMO_CARDS):
                if title in have:
                    continue
                await link.call("divan.card.create", {
                    "project_id": project["id"], "title": title,
                    "summary": summary, "column": column})
                made["cards"] += 1
            chats = (await link.call("chat.list", {"include_archived": True})).get("chats") or []
            if not any(c.get("cwd") == str(folder) and DEMO_CHAT in (c.get("title") or "")
                       for c in chats):
                chat = await link.call("chat.create", {
                    "provider": "demo", "cwd": str(folder), "title": DEMO_CHAT})
                await link.call("chat.send", {"chat_id": chat["id"],
                                              "text": "Can you fix the typo in the README?"})
                ask = await link.event(chat["id"], ("approval.request", "turn.done", "turn.error"))
                if ask["event"] == "approval.request":
                    await link.call("approval.respond", {
                        "chat_id": chat["id"], "decision": "allow",
                        "request_id": ask["data"]["request_id"]})
                    ask = await link.event(chat["id"], ("turn.done", "turn.error"))
                if ask["event"] == "turn.error":
                    raise SystemExit(f"the sample chat failed: {(ask.get('data') or {}).get('message')}")
                await link.call("chat.update", {"chat_id": chat["id"],
                                                "project_id": project["id"]})
                made["chat"] = 1
    finally:
        cfg.revoke(dev.id, remember=False)
    return made


def cmd_demo_seed(args: argparse.Namespace) -> None:
    cfg = Config.load()
    if not cfg.demo:
        # Off a demo machine the chat below would be a real agent's turn,
        # on somebody's real subscription, editing a real folder.
        print("This is not a demo machine. Set `demo = true` in config.toml first"
              " (daemon/README.md, 'Demo machine').", file=sys.stderr)
        sys.exit(2)
    if not _already_serving(cfg.port):
        print(f"Nothing answers on port {cfg.port}. Start it first: remote-ai-chat serve",
              file=sys.stderr)
        sys.exit(2)
    # The chat needs a folder to sit in, inside the roots a chat may open. The
    # demo agent never touches it; this is the one write, and only once.
    folder = Path(cfg.allowed_roots[0]).expanduser().resolve() / DEMO_PROJECT[1]
    folder.mkdir(parents=True, exist_ok=True)
    readme = folder / "README.md"
    if not readme.exists():
        readme.write_text(DEMO_README)
    made = asyncio.run(_demo_seed(cfg, folder))
    if not any(made.values()):
        print("Already seeded; nothing to add.")
        return
    print(f"Seeded: {made['project']} project, {made['cards']} card(s),"
          f" {made['chat']} chat — in {folder}")


PLIST_LABEL = "com.remote-ai-chat.daemon"


def _plist_path():
    from pathlib import Path
    return Path.home() / "Library" / "LaunchAgents" / f"{PLIST_LABEL}.plist"


WIN_RUN_KEY = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
WIN_TASK = "remote-ai-chat"


def _win_uninstall() -> None:
    """Undo what daemon/install.ps1 set up: autostart (task or Run key), the
    Tailscale Serve forward, and the running daemon. No admin needed."""
    import subprocess
    from pathlib import Path
    cfg = Config.load()
    subprocess.run(["reg", "delete", WIN_RUN_KEY, "/v", WIN_TASK, "/f"], capture_output=True)
    subprocess.run(["schtasks", "/Delete", "/TN", WIN_TASK, "/F"], capture_output=True)
    for ts in ("tailscale", r"C:\Program Files\Tailscale\tailscale.exe"):
        r = subprocess.run([ts, "serve", f"--tcp={cfg.port}", "off"], capture_output=True)
        if r.returncode == 0:
            break
    # The supervisor (start.ps1) restarts the daemon on exit, so stop it first.
    # Only the daemon (python -m remote_ai_chat serve) and its launcher
    # (powershell -File ...\start.ps1): match name + exact argument shape so a
    # shell or editor that merely mentions these strings is never killed.
    import os
    ps = ("Get-CimInstance Win32_Process | Where-Object { "
          "(($_.Name -match '^python' -and $_.CommandLine -match '-m remote_ai_chat serve') -or "
          "($_.Name -match '^powershell' -and $_.CommandLine -match '-File .*\\\\start\\.ps1')) "
          f"-and $_.ProcessId -ne {os.getpid()} }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    launcher = Path(LOG_DIR).parent / "start.ps1"
    launcher.unlink(missing_ok=True)
    print("Removed: autostart, tailscale serve, and the running daemon.")


def cmd_install(args: argparse.Namespace) -> None:
    """Register the daemon so it starts with the machine and restarts on crash.

    macOS uses a launchd agent, Linux a systemd --user unit. On Windows the
    logon task is created by install.ps1, which also handles the firewall."""
    if sys.platform == "linux":
        return _install_systemd()
    if sys.platform == "win32":
        print("On Windows, use this instead: powershell -ExecutionPolicy Bypass -File .\\daemon\\install.ps1",
              file=sys.stderr)
        sys.exit(2)
    import plistlib, subprocess
    from pathlib import Path
    exe = Path(sys.argv[0]).resolve()
    plist = {
        "Label": PLIST_LABEL,
        "ProgramArguments": [str(exe), "serve"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "WorkingDirectory": str(Path.home()),
        "StandardOutPath": str(LOG_DIR / "launchd.out.log"),
        "StandardErrorPath": str(LOG_DIR / "launchd.err.log"),
        "EnvironmentVariables": {
            "PATH": str(Path.home() / ".local/bin") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            "HOME": str(Path.home()),
        },
    }
    path = _plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        plistlib.dump(plist, f)
    uid = subprocess.run(["id", "-u"], capture_output=True, text=True).stdout.strip()
    import time
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{PLIST_LABEL}"], capture_output=True)
    # bootout is asynchronous; a bootstrap right after it can fail with EIO. Retry briefly.
    for attempt in range(6):
        time.sleep(1)
        r = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(path)], capture_output=True, text=True)
        if r.returncode == 0:
            break
    else:
        print("launchctl bootstrap failed:", r.stderr.strip(), file=sys.stderr); sys.exit(1)
    print(f"Installed and started: {path}\nLogs: {LOG_DIR}/launchd.*.log")


SYSTEMD_UNIT = Path.home() / ".config" / "systemd" / "user" / "remote-ai-chat.service"


def _install_systemd() -> None:
    import subprocess
    exe = Path(sys.argv[0]).resolve()
    SYSTEMD_UNIT.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SYSTEMD_UNIT.write_text(f"""[Unit]
Description=remote-ai-chat daemon
After=network-online.target

[Service]
ExecStart={exe} serve
Environment=RAC_HOME={CONFIG_DIR}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
""")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    r = subprocess.run(["systemctl", "--user", "enable", "--now", "remote-ai-chat.service"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("systemctl failed:", r.stderr.strip(), file=sys.stderr)
        sys.exit(1)
    subprocess.run(["loginctl", "enable-linger", os.environ.get("USER", "")], capture_output=True)
    print(f"Installed and started: {SYSTEMD_UNIT}")


def _uninstall_systemd() -> None:
    import subprocess
    subprocess.run(["systemctl", "--user", "disable", "--now", "remote-ai-chat.service"], capture_output=True)
    if SYSTEMD_UNIT.exists():
        SYSTEMD_UNIT.unlink()
    print("Removed.")


def cmd_uninstall(args: argparse.Namespace) -> None:
    if sys.platform == "linux":
        return _uninstall_systemd()
    if sys.platform == "win32":
        print("On Windows: Unregister-ScheduledTask -TaskName remote-ai-chat", file=sys.stderr)
        sys.exit(2)
    import subprocess
    if sys.platform == "win32":
        _win_uninstall()
        return
    uid = subprocess.run(["id", "-u"], capture_output=True, text=True).stdout.strip()
    subprocess.run(["launchctl", "bootout", f"gui/{uid}/{PLIST_LABEL}"], capture_output=True)
    path = _plist_path()
    if path.exists():
        path.unlink()
    print("Removed.")


def cmd_status(args: argparse.Namespace) -> None:
    cfg = Config.load()
    print(f"host={cfg.host_name} port={cfg.port} bind={cfg.resolve_bind()} devices={len(cfg.devices)}")
    print(f"roots={cfg.allowed_roots}")


def main() -> None:
    p = argparse.ArgumentParser(prog="remote-ai-chat")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve"); s.add_argument("--bind", nargs="*"); s.add_argument("--port", type=int)
    s.set_defaults(fn=cmd_serve)
    s = sub.add_parser("pair"); s.add_argument("--name", default="iPhone"); s.set_defaults(fn=cmd_pair)
    s = sub.add_parser("web", help="open the desktop panel in a browser")
    s.add_argument("--name", default="Panel"); s.add_argument("--no-open", action="store_true")
    s.add_argument("--at", metavar="HOSTNAME",
                   help="a tunnel's hostname: print a link for a browser elsewhere (docs/TUNNEL.md)")
    s.set_defaults(fn=cmd_web)
    _project_parser(sub)
    s = sub.add_parser("demo-seed", help="put a sample product, cards and chat on a demo machine")
    s.set_defaults(fn=cmd_demo_seed)
    s = sub.add_parser("devices"); s.set_defaults(fn=cmd_devices)
    s = sub.add_parser("revoke"); s.add_argument("device_id"); s.set_defaults(fn=cmd_revoke)
    s = sub.add_parser("unlock", help="lift a tunnel lock on an address, without a restart")
    s.add_argument("addr"); s.set_defaults(fn=cmd_unlock)
    s = sub.add_parser("status"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("install", help="start automatically at login"); s.set_defaults(fn=cmd_install)
    s = sub.add_parser("uninstall"); s.set_defaults(fn=cmd_uninstall)
    args = p.parse_args()
    if sys.platform == "win32":
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(),
                                  logging.FileHandler(LOG_DIR / "daemon.log")])
    args.fn(args)


if __name__ == "__main__":
    main()
