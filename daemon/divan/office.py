"""The office: every agent on this computer as a pixel character at a desk.

The drawing is pixtuoid's (github.com/pixtuoid/pixtuoid, MIT): its web build
runs in the page under `office/`, and all it needs from here is the hook lines
its shim sends. Every Claude Code and Codex config dir on this machine has the
pixtuoid plugin, whose hook writes one JSON line per event into a unix socket.

This tap gets those lines one of two ways, both pixtuoid's own protocol
(crates/pixtuoid-core/src/source/hook/relay.rs and unix.rs):

* a pixtuoid window is open and owns the socket: subscribe to it, as a second
  pixtuoid would;
* nothing owns it: own it, as pixtuoid would — the exclusive flock on
  `<sock>.lock`, a fresh bind — and fan the lines out to any pixtuoid that
  starts later and subscribes to us.

Lines are kept for as long as pixtuoid itself would keep an agent that went
quiet (half an hour), so a phone that opens the page sees who is at work now,
replayed at the times the lines arrived.
"""
from __future__ import annotations

import asyncio
import contextlib
import fcntl
import json
import logging
import os
import socket
import stat
import time
from collections import deque
from pathlib import Path

log = logging.getLogger("divan.office")

SUBSCRIBE = b"pixtuoid-subscribe\n"
SUBSCRIBED = b"pixtuoid-subscribed\n"
STATUS = b"pixtuoid-status\n"
# pixtuoid sweeps an idle agent after 30 minutes and a blocked one after an
# hour; a line older than that cannot put anybody on the page.
KEEP_S = 65 * 60
KEEP_LINES = 6000
MAX_LINE = 2 * 1024 * 1024
CONN_TIMEOUT_S = 1.0


def socket_path() -> Path:
    """Where the shim sends, by the shim's own rule (pixtuoid-hook paths.rs)."""
    env = (os.environ.get("PIXTUOID_SOCKET") or "").strip()
    if env:
        return Path(env)
    xdg = (os.environ.get("XDG_RUNTIME_DIR") or "").strip()
    if xdg and os.path.isabs(xdg):
        return Path(xdg) / "pixtuoid.sock"
    return Path(f"/tmp/pixtuoid-{os.getuid()}") / "pixtuoid.sock"


class OfficeTap:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or socket_path()
        self.lines: deque[tuple[float, str]] = deque(maxlen=KEEP_LINES)
        self.watchers: set[asyncio.Queue] = set()
        # pixtuoid instances subscribed to us while we own the socket
        self.relays: set[asyncio.StreamWriter] = set()
        self.mode = "starting"
        self._lock_fd: int | None = None
        self._server: asyncio.base_events.Server | None = None
        self._since = time.time()
        self._last_hook: float | None = None

    # ── what the page reads ────────────────────────────────────────────────
    def backlog(self) -> list[tuple[float, str]]:
        self._prune()
        return list(self.lines)

    def watch(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.watchers.add(q)
        return q

    def unwatch(self, q: asyncio.Queue) -> None:
        self.watchers.discard(q)

    def _prune(self) -> None:
        cut = time.time() - KEEP_S
        while self.lines and self.lines[0][0] < cut:
            self.lines.popleft()

    def _land(self, line: str) -> None:
        line = line.strip()
        if not line or not line.startswith("{"):
            return
        now = time.time()
        self._last_hook = now
        self.lines.append((now, line))
        self._prune()
        for q in list(self.watchers):
            try:
                q.put_nowait((now, line))
            except asyncio.QueueFull:
                # A page that stopped reading is dropped, not waited for.
                self.watchers.discard(q)
        if self.relays:
            data = (line + "\n").encode()
            for w in list(self.relays):
                try:
                    w.write(data)
                except Exception:
                    self.relays.discard(w)

    # ── the loop ───────────────────────────────────────────────────────────
    async def run(self) -> None:
        while True:
            try:
                if await self._subscribe():
                    continue  # the owner went away: try again at once
                if await self._own():
                    return  # owning until the daemon stops
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("office tap: %s", exc)
            self.mode = "waiting"
            await asyncio.sleep(3)

    async def _subscribe(self) -> bool:
        """Read an owner's lines until it closes. False when there is none."""
        try:
            reader, writer = await asyncio.open_unix_connection(str(self.path), limit=MAX_LINE)
        except (FileNotFoundError, ConnectionRefusedError, OSError):
            return False
        try:
            writer.write(SUBSCRIBE)
            await writer.drain()
            first = await asyncio.wait_for(reader.readline(), 5)
            if first != SUBSCRIBED:
                return False
            self.mode = "subscribed"
            while True:
                raw = await reader.readline()
                if not raw:
                    return True
                self._land(raw.decode("utf-8", "replace"))
        finally:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()

    async def _own(self) -> bool:
        """Take the socket the way pixtuoid does. False when somebody beat us to it."""
        d = self.path.parent
        if not self.path.name or not d:
            return False
        if not d.exists():
            d.mkdir(mode=0o700, parents=True)
        st = d.stat()
        if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) & 0o077:
            log.warning("office tap: %s is not ours alone; not binding", d)
            return False
        lock_path = str(self.path) + ".lock"
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        # The lock is ours: whatever socket file is there belongs to a dead owner
        # (or one from before the lock), so probe it once and clear it.
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.settimeout(0.5)
            probe.connect(str(self.path))
            live = True
        except OSError:
            live = False
        finally:
            probe.close()
        if live:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
            return False
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()
        self._server = await asyncio.start_unix_server(self._conn, path=str(self.path), limit=MAX_LINE)
        os.chmod(self.path, 0o600)
        self._lock_fd = fd
        self._since = time.time()
        self.mode = "owner"
        async with self._server:
            await self._server.serve_forever()
        return True

    async def _conn(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            try:
                head = await asyncio.wait_for(reader.readline(), CONN_TIMEOUT_S)
            except (asyncio.TimeoutError, ValueError):
                return
            if head == SUBSCRIBE:
                writer.write(SUBSCRIBED)
                await writer.drain()
                self.relays.add(writer)
                with contextlib.suppress(Exception):
                    await reader.read()  # until the subscriber leaves
                self.relays.discard(writer)
                return
            if head == STATUS:
                ago = {} if self._last_hook is None else {"claude-code": int((time.time() - self._last_hook) * 1000)}
                writer.write((json.dumps({"held_for_ms": int((time.time() - self._since) * 1000),
                                          "connected": ["claude-code", "codex"],
                                          "last_hook_ago_ms": ago}) + "\n").encode())
                await writer.drain()
                return
            self._land(head.decode("utf-8", "replace"))
            deadline = time.monotonic() + CONN_TIMEOUT_S
            while (left := deadline - time.monotonic()) > 0:
                try:
                    raw = await asyncio.wait_for(reader.readline(), left)
                except (asyncio.TimeoutError, ValueError):
                    break
                if not raw:
                    break
                self._land(raw.decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            log.debug("office conn: %s", exc)
        finally:
            if writer not in self.relays:
                writer.close()

    def status(self) -> dict:
        self._prune()
        return {"mode": self.mode, "lines": len(self.lines), "socket": str(self.path),
                "watchers": len(self.watchers)}
