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
        # Called with (epoch_s, line) for each line, by DivanOffice.
        self.on_line = None

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
        if self.on_line is not None:
            try:
                self.on_line(now, line)
            except Exception as exc:  # noqa: BLE001
                log.debug("office on_line: %s", exc)
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
            self._became("subscribed")
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
        self._became("owner")
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

    def _became(self, mode: str) -> None:
        # Said once per change: which way the lines come in is the first thing
        # to know when the office stays empty.
        if mode != self.mode:
            log.warning("office: %s on %s", mode, self.path)
        self.mode = mode

    def status(self) -> dict:
        self._prune()
        return {"mode": self.mode, "lines": len(self.lines), "socket": str(self.path),
                "watchers": len(self.watchers)}


# ── Divan's own chats ──────────────────────────────────────────────────────
#
# The plugin's hooks only reach a CLI started after the plugin was installed,
# and a chat that Divan keeps alive for days never restarts. So every chat is
# put in the office from what the daemon itself knows: the chat list, and the
# events it already broadcasts (server.broadcast). Each becomes the hook line
# Claude Code would have sent, keyed on the chat id, so pixtuoid's reducer does
# the rest. Each product gets a room of its own; a session the plugin reports
# that no Divan chat owns (a terminal, a script) goes to the "Terminal" room.

SRC = "claude-code"
# Chats with nothing for this long are left out, unless they are still in the
# list (not archived).
RECENT_S = 12 * 3600
OTHER_ROOM = "Other"
TERMINAL_ROOM = "Terminal"


def _short(chat_id: str) -> str:
    # pixtuoid labels an agent `cc·<cwd basename>` and cuts it at about ten
    # characters; eight of the chat id survive that and say which chat it is.
    return chat_id[:8]


def hook_line(chat_id: str, event: str, ts: float, **extra) -> str:
    short = _short(chat_id)
    body = {"_pixtuoid_source": SRC, "_shim_ts_ms": int(ts * 1000), "hook_event_name": event,
            "session_id": chat_id, "cwd": f"/divan/{short}",
            "transcript_path": f"/divan/{short}/{chat_id}.jsonl", **extra}
    return json.dumps(body, ensure_ascii=False)


class DivanOffice:
    def __init__(self, tap: OfficeTap, list_chats) -> None:
        self.tap = tap
        self.list_chats = list_chats  # () -> list[dict], the db's chat rows
        self.chats: dict[str, dict] = {}
        # provider session id -> chat id, so a plugin line of a Divan chat is
        # not shown twice
        self.sessions: dict[str, str] = {}
        self.watchers: set[asyncio.Queue] = set()
        # What a polling page has not seen yet: (seq, item). Polling rather than
        # only a stream, because a stream through the Cloudflare tunnel can sit
        # buffered and leave the page empty.
        self.seq = 1  # 0 is a page that has seen nothing
        self.log: deque[tuple[int, tuple]] = deque(maxlen=3000)
        tap.on_line = self._tap_line
        self._loaded = False

    # ── the chat list ──────────────────────────────────────────────────────
    def _room(self, chat: dict) -> str:
        return (chat.get("project") or "").strip() or OTHER_ROOM

    def _wanted(self, chat: dict, now: float) -> bool:
        if not chat.get("archived"):
            return True
        return (now - float(chat.get("updated_at") or 0)) < RECENT_S

    def load(self) -> None:
        now = time.time()
        try:
            rows = self.list_chats()
        except Exception as exc:  # noqa: BLE001
            log.warning("office: chat list: %s", exc)
            return
        for c in rows:
            if self._wanted(c, now):
                self._adopt(c, quiet=True)
        self._loaded = True

    def _adopt(self, chat: dict, quiet: bool = False) -> dict:
        cid = chat["id"]
        cur = self.chats.get(cid)
        info = {
            "id": cid, "short": _short(cid), "room": self._room(chat),
            "title": (chat.get("title") or "").strip() or "New chat",
            "busy": (chat.get("status") or "idle") != "idle",
            "since": float(chat.get("created_at") or time.time()),
            "last": cur["last"] if cur else None,  # the last state line
            "tool": cur["tool"] if cur else None,
        }
        for key in ("provider_session_id",):
            if chat.get(key):
                self.sessions[str(chat[key])] = cid
        try:
            for sid in (json.loads(chat.get("session_ids") or "{}") or {}).values():
                if sid:
                    self.sessions[str(sid)] = cid
        except Exception:  # noqa: BLE001
            pass
        self.chats[cid] = info
        changed = cur is None or any(cur.get(k) != info[k] for k in ("room", "title"))
        if cur is None and not quiet:
            self._send(hook_line(cid, "SessionStart", time.time(), source="startup"), info["room"])
        if changed and not quiet:
            self._rooms_changed()
        return info

    # ── what the daemon broadcasts ─────────────────────────────────────────
    def observe(self, event: dict) -> None:
        kind = event.get("event")
        cid = event.get("chat_id")
        if not cid:
            return
        data = event.get("data") or {}
        if kind == "chat.updated" and isinstance(data, dict):
            if data.get("archived") and cid in self.chats and \
                    time.time() - float(data.get("updated_at") or 0) > RECENT_S:
                info = self.chats.pop(cid)
                self._send(hook_line(cid, "SessionEnd", time.time(), reason="other"), info["room"])
                self._rooms_changed()
                return
            if cid not in self.chats and data.get("archived"):
                return
            self._adopt(data)
            return
        info = self.chats.get(cid)
        if info is None:
            return
        now = time.time()
        line = None
        if kind in ("turn.started", "message.user"):
            info["busy"], info["tool"] = True, None
            line = hook_line(cid, "UserPromptSubmit", now, prompt="")
        elif kind == "tool.use" and isinstance(data, dict):
            info["busy"] = True
            name = str(data.get("name") or data.get("tool") or "Tool")
            tid = str(data.get("id") or "")
            info["tool"] = (name, tid)
            line = hook_line(cid, "PreToolUse", now, tool_name=name, tool_use_id=tid,
                             tool_input=data.get("input") if isinstance(data.get("input"), dict) else {})
        elif kind == "tool.result" and isinstance(data, dict):
            name, tid = info["tool"] or ("Tool", str(data.get("id") or ""))
            info["tool"] = None
            line = hook_line(cid, "PostToolUse", now, tool_name=name, tool_use_id=tid, tool_input={},
                             tool_response={})
        elif kind == "approval.request":
            line = hook_line(cid, "PermissionRequest", now, tool_name=str((data or {}).get("tool") or "Bash"),
                             tool_input={})
        elif kind == "approval.resolved":
            line = hook_line(cid, "UserPromptSubmit", now, prompt="")
        elif kind in ("turn.done", "turn.error"):
            info["busy"], info["tool"] = False, None
            line = hook_line(cid, "Stop", now)
        if line:
            info["last"] = (now, line)
            self._send(line, info["room"], now)

    # ── lines the plugin reports ───────────────────────────────────────────
    def _tap_line(self, ts: float, line: str) -> None:
        try:
            sid = str(json.loads(line).get("session_id") or "")
        except Exception:  # noqa: BLE001
            return
        if sid and (sid in self.sessions or sid in self.chats):
            return
        self._send(line, TERMINAL_ROOM, ts)

    # ── the page ───────────────────────────────────────────────────────────
    def rooms(self) -> dict:
        return {"chats": {c["short"]: {"id": c["id"], "title": c["title"], "room": c["room"]}
                          for c in self.chats.values()},
                "rooms": sorted({c["room"] for c in self.chats.values()} | {TERMINAL_ROOM})}

    def backlog(self) -> list[tuple[float, str, str]]:
        """Every chat as it is now: its start, then where it is."""
        if not self._loaded:
            self.load()
        out: list[tuple[float, str, str]] = []
        now = time.time()
        for c in self.chats.values():
            start = min(c["since"], now - 1)
            out.append((start, hook_line(c["id"], "SessionStart", start, source="startup"), c["room"]))
            if c["last"] is not None:
                out.append((c["last"][0], c["last"][1], c["room"]))
            elif c["busy"]:
                out.append((now - 0.5, hook_line(c["id"], "UserPromptSubmit", now - 0.5, prompt=""), c["room"]))
            else:
                out.append((start + 0.5, hook_line(c["id"], "Stop", start + 0.5), c["room"]))
        for ts, line in self.tap.backlog():
            try:
                sid = str(json.loads(line).get("session_id") or "")
            except Exception:  # noqa: BLE001
                continue
            if not (sid in self.sessions or sid in self.chats):
                out.append((ts, line, TERMINAL_ROOM))
        out.sort(key=lambda x: x[0])
        return out

    def watch(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.watchers.add(q)
        return q

    def unwatch(self, q: asyncio.Queue) -> None:
        self.watchers.discard(q)

    def poll(self, after: int) -> dict:
        """Everything after `after`, or the whole office when the page is new
        or has fallen further behind than the log keeps."""
        oldest = self.log[0][0] if self.log else self.seq + 1
        if after <= 0 or after < oldest - 1 or after > self.seq:
            return {"seq": self.seq, "reset": True, "rooms": self.rooms(),
                    "backlog": [[int(t * 1000), l, r] for t, l, r in self.backlog()]}
        items = []
        for n, item in self.log:
            if n <= after:
                continue
            if item[0] == "rooms":
                items.append(["rooms", item[1]])
            else:
                items.append(["line", int(item[1] * 1000), item[2], item[3]])
        return {"seq": self.seq, "items": items}

    def _put(self, item) -> None:
        self.seq += 1
        self.log.append((self.seq, item))
        for q in list(self.watchers):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                self.watchers.discard(q)

    def _send(self, line: str, room: str, ts: float | None = None) -> None:
        self._put(("line", ts or time.time(), line, room))

    def _rooms_changed(self) -> None:
        self._put(("rooms", self.rooms()))
