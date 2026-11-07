"""Agent processes that outlive the daemon.

The daemon is a bridge between a phone and the coding CLIs — it should be able
to stop and start without any chat noticing. It could not: every `claude` and
`codex app-server` was its child, wired to it by stdin/stdout pipes, and when
the daemon went the pipes went and the CLI with them. A restart cut every turn
in flight; the next process could only start the question again (7 Nov 2026).

So the CLI is no longer the daemon's child. Two small processes stand between:

* the **relay** is what the daemon starts in the CLI's place (`claude` via the
  SDK's `cli_path`, `codex app-server` directly). It is a dumb pipe: its stdin
  and stdout are the daemon's, its other end is a unix socket. It dies with the
  daemon, and that is fine;
* the **holder** is started by the first relay of a chat, in a session of its
  own (`setsid`), so nothing that stops the daemon reaches it. It runs the real
  CLI, keeps its output, and listens on `<held dir>/<chat id>.sock`.

A daemon that starts again finds the holders still there and connects a new
relay to each. The CLI never noticed: the turn it was in carries on, and what
it said meanwhile is handed over. Three things make that reconnection clean,
all done here, in the holder, where the whole stream passes:

* **the handshake is not repeated.** Both protocols open with `initialize`
  (and Codex with `thread/start|resume` after it). A running CLI must not see
  them twice, so the holder keeps its first answers and gives them again;
* **a question nobody answered is asked again.** A permission request the old
  daemon received and died holding would otherwise wait for ever. The holder
  keeps every request the CLI has open and re-sends it to the next relay;
* **an answer for the old daemon does not reach the new one.** A response to a
  request the previous process sent is dropped: the new one would match it to
  a request of its own with the same id.

What was delivered and not yet acted on is the one thing that can be lost: a
text block the old daemon was halfway through. So the holder rewinds to the
start of the open block (`content_block_start`, Codex's `item/started`), which
the daemon only writes down once it is whole.

Whether a relay going away means "the daemon is restarting, keep the CLI" or
"this chat is done with it, stop it" is the relay's to say. It says detach when
its daemon has written the detach marker (`mark_detaching`, at shutdown) or has
died under it; stop otherwise — the session closing the client on purpose.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from .config import CONFIG_DIR

#: Lines a resumed thread or a big tool result can make.
LIMIT = 64 * 1024 * 1024
#: A holder whose daemon has not come back for this long stops its CLI — unless
#: a turn is in flight, which gets until ORPHAN_HARD_S.
ORPHAN_S = 6 * 3600
ORPHAN_HARD_S = 24 * 3600
#: How long a returning daemon gets to send its `initialize` before the replay
#: starts anyway.
HANDSHAKE_S = 10
#: How long the tail of a CLI that exited waits for a daemon to collect it.
EXITED_KEEP_S = 3600
#: Environment the provider sets for the relay; none of it reaches the CLI.
ENV_KEY, ENV_DIALECT, ENV_CLI = "DIVAN_HELD_KEY", "DIVAN_HELD_DIALECT", "DIVAN_HELD_CLI"
#: …and where the holders are: the daemon's own, named outright, so a relay and
#: its holder can never look in another home than the daemon that started them.
ENV_DIR = "DIVAN_HELD_DIR"
_OURS = (ENV_KEY, ENV_DIALECT, ENV_CLI, ENV_DIR)


def enabled() -> bool:
    """Off on Windows (no unix sockets, no setsid) and when DIVAN_HELD=0."""
    return os.name != "nt" and os.environ.get("DIVAN_HELD", "1") != "0"


def held_dir() -> Path:
    d = Path(os.environ[ENV_DIR]) if os.environ.get(ENV_DIR) else CONFIG_DIR / "held"
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    return d


def sock_path(key: str) -> Path:
    return held_dir() / f"{key}.sock"


def state_path(key: str) -> Path:
    return held_dir() / f"{key}.json"


def marker_path() -> Path:
    return held_dir() / "DETACH"


def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def read_state(key: str) -> dict | None:
    try:
        return json.loads(state_path(key).read_text())
    except Exception:
        return None


def live_keys() -> list[str]:
    """The chats whose CLI a holder is still keeping, oldest first."""
    out = []
    for p in sorted(held_dir().glob("*.json"), key=lambda p: p.stat().st_mtime):
        st = read_state(p.stem)
        if st and _alive(st.get("pid")) and sock_path(p.stem).exists():
            out.append(p.stem)
    return out


def mark_detaching() -> None:
    """Said by a daemon about to stop: the relays going away now are a restart."""
    marker_path().write_text(json.dumps({"pid": os.getpid(), "at": time.time()}))


def clear_detaching() -> None:
    try:
        marker_path().unlink()
    except FileNotFoundError:
        pass


def relay_script() -> str:
    """An executable that is the relay, for the SDK's `cli_path` (which takes a
    program, not a program and arguments)."""
    d = held_dir() / "bin"
    d.mkdir(exist_ok=True)
    p = d / "relay"
    body = f'#!/bin/sh\nexec "{sys.executable}" -m divan.held relay "$@"\n'
    try:
        if p.read_text() == body:
            return str(p)
    except FileNotFoundError:
        pass
    tmp = p.with_suffix(".tmp")
    tmp.write_text(body)
    tmp.chmod(0o755)
    tmp.replace(p)
    return str(p)


def relay_env(key: str, dialect: str, cli: str) -> dict[str, str]:
    return {ENV_KEY: key, ENV_DIALECT: dialect, ENV_CLI: cli, ENV_DIR: str(held_dir())}


def fingerprint(cli: str, args: list[str], cwd: str, env: dict) -> str:
    """Which CLI process this is, for handing it to a new daemon: the tool, the
    folder and the sign-in.

    Not the model, effort or permission mode: a daemon that has just started
    names the model before its catalog has loaded (`opus`, not the full id) and
    would take its own chat's CLI for a stranger and stop it mid-turn (7 Nov
    2026). A change of those is the session's to act on — it closes the client,
    which stops the CLI — and never reaches here. Not the system prompt, which
    differs on every start, nor `--resume`.
    """
    home = env.get("CLAUDE_CONFIG_DIR") or env.get("CODEX_HOME") or ""
    raw = json.dumps([os.path.realpath(cli), os.path.realpath(cwd), home])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def stop(key: str, timeout: float = 15) -> bool:
    """Stop a holder and its CLI, for a chat that no longer exists."""
    try:
        r, w = await asyncio.wait_for(asyncio.open_unix_connection(str(sock_path(key)), limit=LIMIT), 3)
    except Exception:
        return False
    try:
        w.write(b'{"stop":1}\n')
        await w.drain()
        end = time.time() + timeout
        while time.time() < end:
            line = await asyncio.wait_for(r.readline(), max(0.1, end - time.time()))
            if not line:
                break
        return True
    except Exception:
        return False
    finally:
        w.close()


# ── the holder ──────────────────────────────────────────────────────────────

def _obj(line: str) -> dict | None:
    if not line.startswith("{"):
        return None
    try:
        o = json.loads(line)
    except ValueError:
        return None
    return o if isinstance(o, dict) else None


class Holder:
    def __init__(self, key: str, dialect: str, fp: str, argv: list[str]):
        self.key, self.dialect, self.fp, self.argv = key, dialect, fp, argv
        self.lines: list[str | None] = []    # the CLI's output; None is a line dropped
        self.base = 0                        # offset of lines[0]
        self.delivered = 0                   # next offset to hand a relay
        self.open_req: dict = {}             # request id the CLI is waiting on -> offset
        self.unit_start: int | None = None   # offset of the block being written
        self.in_turn = False
        self.turn_id: str | None = None
        self.init_resp = None
        self.init_req_id = None
        self.thread_resp = None
        self.thread_req_id = None
        self.client_ids: set = set()
        self.handshook = False               # this client's `initialize` answered from the cache
        self.gated = False                   # a client is attaching: hand nothing over yet
        self.writer: asyncio.StreamWriter | None = None
        self.attaches = 0
        self.last_client = time.time()
        self.exit_code: int | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.done = asyncio.Event()
        self._stopping = False
        # One hand-over at a time: the CLI's reader and a relay's replay both
        # deliver, and two of them walking `delivered` would send a line twice.
        self.pump = asyncio.Lock()

    # offsets
    def _end(self) -> int:
        return self.base + len(self.lines)

    def _line(self, off: int) -> str | None:
        return self.lines[off - self.base]

    def _trim(self) -> None:
        keep = self.delivered
        if self.unit_start is not None:
            keep = min(keep, self.unit_start)
        if self.open_req:
            keep = min(keep, min(self.open_req.values()))
        cut = keep - self.base
        if cut > 256:
            del self.lines[:cut]
            self.base = keep

    def _save(self) -> None:
        st = {"pid": os.getpid(), "cli_pid": self.proc.pid if self.proc else None,
              "dialect": self.dialect, "fp": self.fp, "in_turn": self.in_turn,
              "turn_id": self.turn_id, "attaches": self.attaches,
              "exit": self.exit_code, "at": time.time()}
        tmp = state_path(self.key).with_suffix(".tmp")
        tmp.write_text(json.dumps(st))
        tmp.replace(state_path(self.key))

    # what the CLI says
    def _classify_out(self, off: int, o: dict) -> bool:
        """Book-keep one line of the CLI's; False drops it."""
        was = self.in_turn
        keep = True
        if self.dialect == "claude":
            t = o.get("type")
            if t == "control_response":
                rid = (o.get("response") or {}).get("request_id")
                if rid is not None and rid == self.init_req_id:
                    self.init_resp = (o.get("response") or {}).get("response")
                    self.init_req_id = None
                if rid not in self.client_ids:
                    keep = False
                self.client_ids.discard(rid)
            elif t == "control_request":
                self.open_req[o.get("request_id")] = off
            elif t == "control_cancel_request":
                self.open_req.pop(o.get("request_id"), None)
            elif t == "result":
                self.in_turn = False
            elif t == "stream_event" and not o.get("parent_tool_use_id"):
                et = (o.get("event") or {}).get("type")
                if et == "content_block_start":
                    self.unit_start = off
                elif et in ("content_block_stop", "message_stop"):
                    self.unit_start = None
        else:
            if "id" in o and "method" not in o:
                rid = o["id"]
                if rid == self.init_req_id:
                    self.init_resp, self.init_req_id = o.get("result"), None
                elif rid == self.thread_req_id:
                    self.thread_resp, self.thread_req_id = o.get("result"), None
                if rid not in self.client_ids:
                    keep = False
                self.client_ids.discard(rid)
            elif "id" in o:
                self.open_req[o["id"]] = off
            else:
                m, p = o.get("method"), o.get("params") or {}
                if m == "turn/started":
                    self.in_turn, self.turn_id = True, (p.get("turn") or {}).get("id")
                elif m == "turn/completed":
                    self.in_turn = False
                elif m == "item/started" and (p.get("item") or {}).get("type") == "agentMessage":
                    self.unit_start = off
                elif m == "item/completed" and (p.get("item") or {}).get("type") == "agentMessage":
                    self.unit_start = None
        if self.in_turn != was:
            self._save()
        return keep

    async def _send(self, frame: dict) -> bool:
        w = self.writer
        if w is None:
            return False
        try:
            w.write((json.dumps(frame) + "\n").encode())
            await w.drain()
            return True
        except Exception:
            self._drop_client(w)
            return False

    def _drop_client(self, w) -> None:
        if self.writer is w:
            self.writer = None
            self.last_client = time.time()
        try:
            w.close()
        except Exception:
            pass

    async def _pump_out(self) -> None:
        """Hand every line not yet handed over, in order."""
        async with self.pump:
            await self._pump_locked()

    async def _pump_locked(self) -> None:
        if self.gated:
            return
        while self.writer is not None and self.delivered < self._end():
            line = self._line(self.delivered)
            if line is not None and not await self._send({"l": line}):
                return
            self.delivered += 1
        self._trim()

    async def read_cli(self) -> None:
        assert self.proc and self.proc.stdout
        while True:
            raw = await self.proc.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip("\n")
            off = self._end()
            o = _obj(line)
            keep = self._classify_out(off, o) if o is not None else True
            self.lines.append(line if keep else None)
            await self._pump_out()
        self.exit_code = await self.proc.wait()
        self._save()
        # A client still attaching is told by `serve_client`, after its replay.
        if self.writer is not None and not self.gated:
            await self._pump_out()
            await self._send({"x": self.exit_code})
        self.done.set()

    async def read_err(self) -> None:
        assert self.proc and self.proc.stderr
        log = open(held_dir() / f"{self.key}.err", "ab")
        try:
            while chunk := await self.proc.stderr.read(8192):
                log.write(chunk)
                log.flush()
                await self._send({"e": chunk.decode(errors="replace")})
        finally:
            log.close()

    # what the daemon says
    async def _write_cli(self, line: str) -> None:
        if self.proc is None or self.proc.stdin is None or self.exit_code is not None:
            return
        try:
            self.proc.stdin.write((line + "\n").encode())
            await self.proc.stdin.drain()
        except Exception:
            pass

    async def _from_client(self, line: str) -> None:
        o = _obj(line)
        if o is None:
            return await self._write_cli(line)
        if self.dialect == "claude":
            t = o.get("type")
            if t == "control_request":
                rid = o.get("request_id")
                if (o.get("request") or {}).get("subtype") == "initialize":
                    if self.init_resp is not None:
                        await self._send({"l": json.dumps({"type": "control_response", "response": {
                            "subtype": "success", "request_id": rid, "response": self.init_resp}})})
                        self.handshook = True
                        return
                    self.init_req_id = rid
                self.client_ids.add(rid)
            elif t == "control_response":
                self.open_req.pop((o.get("response") or {}).get("request_id"), None)
            elif t == "user" and not o.get("parent_tool_use_id"):
                if not self.in_turn:
                    self.in_turn = True
                    self._save()
        else:
            if "method" in o and "id" in o:
                m, rid = o["method"], o["id"]
                if m == "initialize":
                    if self.init_resp is not None:
                        await self._send({"l": json.dumps({"id": rid, "result": self.init_resp})})
                        self.handshook = True
                        return
                    self.init_req_id = rid
                elif m in ("thread/start", "thread/resume"):
                    if self.thread_resp is not None:
                        await self._send({"l": json.dumps({"id": rid, "result": self.thread_resp})})
                        return
                    self.thread_req_id = rid
                self.client_ids.add(rid)
            elif "method" in o:
                if o["method"] == "initialized" and self.attaches > 1:
                    return
            elif "id" in o:
                self.open_req.pop(o["id"], None)
        await self._write_cli(line)

    async def serve_client(self, r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
        try:
            first = await asyncio.wait_for(r.readline(), 10)
        except Exception:
            w.close()
            return
        hello = _obj(first.decode(errors="replace")) or {}
        if hello.get("stop"):
            await self.stop()
            w.write(b'{"x":0}\n')
            w.close()
            return
        if hello.get("fp") != self.fp:
            w.write(b'{"mismatch":1}\n')
            await w.drain()
            w.close()
            return
        if self.writer is not None:
            self._drop_client(self.writer)
        self.writer = w
        self.attaches += 1
        self.client_ids = set()
        self.handshook = False
        self.gated = True
        self._save()
        await self._send({"ok": 1, "attached": self.attaches > 1, "in_turn": self.in_turn,
                          "turn_id": self.turn_id})
        # The handshake goes first, the replay after it. The SDK parks every
        # line but a control answer in a 100-deep buffer that nobody empties
        # until `connect` returns; a replay longer than that — a long Write
        # still being typed out — filled it ahead of the `initialize` answer,
        # and the new daemon gave up on the CLI after 60 s (7 Nov 2026).
        # Meanwhile the CLI's new lines are kept, not handed over (`gated`).
        try:
            if self.init_resp is not None:
                end = time.time() + HANDSHAKE_S
                while not self.handshook and time.time() < end:
                    try:
                        raw = await asyncio.wait_for(r.readline(), max(0.1, end - time.time()))
                    except asyncio.TimeoutError:
                        break
                    if not raw or await self._client_frame(raw) is False:
                        self._drop_client(w)
                        return
        except Exception:
            self._drop_client(w)
            return
        # Replay: the requests still open from before, then everything not yet
        # handed over — rewound to the start of the block being written.
        async with self.pump:
            self.gated = False
            start = self.delivered
            if self.unit_start is not None and self.unit_start < start:
                start = self.unit_start
            start = max(start, self.base)
            for rid, off in sorted(self.open_req.items(), key=lambda kv: kv[1]):
                if off < start and off >= self.base and self._line(off) is not None:
                    await self._send({"l": self._line(off)})
            self.delivered = start
            await self._pump_locked()
        if self.exit_code is not None:
            await self._send({"x": self.exit_code})
        try:
            while True:
                raw = await r.readline()
                if not raw or await self._client_frame(raw) is False:
                    break
        except Exception:
            pass
        finally:
            self._drop_client(w)

    async def _client_frame(self, raw: bytes) -> bool:
        """One frame from the relay; False when the client is leaving."""
        f = _obj(raw.decode(errors="replace"))
        if not f:
            return True
        if "w" in f:
            await self._from_client(f["w"])
        elif f.get("stop"):
            await self.stop()
            await self._send({"x": self.exit_code if self.exit_code is not None else 0})
            return False
        elif f.get("detach"):
            return False
        return True

    async def stop(self) -> None:
        if self._stopping or self.proc is None:
            return
        self._stopping = True
        p = self.proc
        if p.returncode is None:
            try:
                if p.stdin:
                    p.stdin.close()
                await asyncio.wait_for(p.wait(), 3)
            except Exception:
                try:
                    p.terminate()
                    await asyncio.wait_for(p.wait(), 5)
                except Exception:
                    try:
                        p.kill()
                        await p.wait()
                    except Exception:
                        pass
        await self.done.wait()

    async def watch_orphan(self) -> None:
        while not self.done.is_set():
            await asyncio.sleep(60)
            if self.writer is not None:
                continue
            quiet = time.time() - self.last_client
            if quiet > ORPHAN_HARD_S or (quiet > ORPHAN_S and not self.in_turn):
                await self.stop()

    async def run(self) -> int:
        env = {k: v for k, v in os.environ.items() if k not in _OURS}
        self.proc = await asyncio.create_subprocess_exec(
            *self.argv, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=env, limit=LIMIT)
        sp = sock_path(self.key)
        try:
            sp.unlink()
        except FileNotFoundError:
            pass
        server = await asyncio.start_unix_server(self.serve_client, path=str(sp), limit=LIMIT)
        os.chmod(sp, 0o600)
        self._save()
        tasks = [asyncio.create_task(self.read_cli()), asyncio.create_task(self.read_err()),
                 asyncio.create_task(self.watch_orphan())]
        await self.done.wait()
        # The tail of a CLI that exited is kept for a daemon that is not here
        # to collect it, for a while.
        end = time.time() + EXITED_KEEP_S
        while self.writer is None and time.time() < end and not self._stopping:
            await asyncio.sleep(1)
        while self.writer is not None and time.time() < end:
            await asyncio.sleep(0.2)
        server.close()
        for t in tasks:
            t.cancel()
        for p in (sp, state_path(self.key), held_dir() / f"{self.key}.err",
                  held_dir() / f"{self.key}.log"):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
        return self.exit_code or 0


def hold_main(key: str, dialect: str, fp: str, argv: list[str]) -> int:
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    h = Holder(key, dialect, fp, argv)

    async def go() -> int:
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.ensure_future(h.stop()))
        return await h.run()
    return asyncio.run(go())


# ── the relay ───────────────────────────────────────────────────────────────

def _passthrough(dialect: str, args: list[str]) -> bool:
    """Calls that are not a session — `claude -v`, a codex subcommand — run the
    real CLI as they are."""
    if dialect == "claude":
        return "--input-format" not in args
    return args != ["app-server"]


def _detaching(parent: int) -> bool:
    if os.getppid() != parent:
        return True                         # the daemon died under us
    try:
        m = json.loads(marker_path().read_text())
        return m.get("pid") == parent
    except Exception:
        return False


async def _connect(key: str, fp: str):
    r, w = await asyncio.open_unix_connection(str(sock_path(key)), limit=LIMIT)
    w.write((json.dumps({"hello": 1, "fp": fp}) + "\n").encode())
    await w.drain()
    first = _obj((await asyncio.wait_for(r.readline(), 10)).decode(errors="replace")) or {}
    return r, w, first


def _spawn_holder(key: str, dialect: str, fp: str, argv: list[str]) -> None:
    errlog = open(held_dir() / f"{key}.log", "ab")
    subprocess.Popen([sys.executable, "-m", "divan.held", "hold", key, dialect, fp, "--", *argv],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errlog,
                     cwd=os.getcwd(), env=dict(os.environ), start_new_session=True,
                     close_fds=True)
    errlog.close()


async def _attach(key: str, dialect: str, fp: str, argv: list[str]):
    for attempt in range(2):
        try:
            r, w, first = await _connect(key, fp)
        except (FileNotFoundError, ConnectionRefusedError, OSError, asyncio.TimeoutError):
            first, r, w = None, None, None
        if first and first.get("ok"):
            return r, w
        if first and first.get("mismatch"):
            # A different CLI under this chat's name (the model changed while we
            # were away): it is not ours to talk to, so it is stopped.
            w.close()
            await stop(key)
        elif w is not None:
            w.close()
        _spawn_holder(key, dialect, fp, argv)
        end = time.time() + 15
        while time.time() < end:
            await asyncio.sleep(0.05)
            try:
                r, w, first = await _connect(key, fp)
            except (FileNotFoundError, ConnectionRefusedError, OSError, asyncio.TimeoutError):
                continue
            if first.get("ok"):
                return r, w
            w.close()
    raise RuntimeError(f"could not start the holder for {key}")


async def relay(argv_in: list[str]) -> int:
    key = os.environ.get(ENV_KEY) or ""
    dialect = os.environ.get(ENV_DIALECT) or "claude"
    cli = os.environ.get(ENV_CLI) or ""
    argv = [cli, *argv_in]
    parent = os.getppid()
    fp = fingerprint(cli, argv_in, os.getcwd(), dict(os.environ))
    r, w = await _attach(key, dialect, fp, argv)
    loop = asyncio.get_running_loop()
    stdin = asyncio.StreamReader(limit=LIMIT)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(stdin), sys.stdin)
    out = sys.stdout.buffer
    exit_code: list[int] = []
    leaving = asyncio.Event()

    async def leave() -> None:
        if leaving.is_set():
            return
        leaving.set()
        try:
            if _detaching(parent):
                w.write(b'{"detach":1}\n')
            else:
                w.write(b'{"stop":1}\n')
            await w.drain()
        except Exception:
            pass

    async def down() -> None:
        try:
            while True:
                raw = await r.readline()
                if not raw:
                    break
                f = _obj(raw.decode(errors="replace"))
                if not f:
                    continue
                if "l" in f:
                    try:
                        out.write(f["l"].encode() + b"\n")
                        out.flush()
                    except (BrokenPipeError, ValueError):
                        await leave()
                        break
                elif "e" in f:
                    try:
                        sys.stderr.write(f["e"])
                        sys.stderr.flush()
                    except Exception:
                        pass
                elif "x" in f:
                    exit_code.append(int(f["x"] or 0))
                    break
        except Exception:
            pass

    async def up() -> None:
        while True:
            raw = await stdin.readline()
            if not raw:
                break
            w.write((json.dumps({"w": raw.decode(errors="replace").rstrip("\n")}) + "\n").encode())
            await w.drain()
        await leave()

    loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.ensure_future(leave()))
    loop.add_signal_handler(signal.SIGHUP, lambda: asyncio.ensure_future(leave()))
    d = asyncio.create_task(down())
    u = asyncio.create_task(up())
    left = asyncio.create_task(leaving.wait())
    done, _ = await asyncio.wait({d, u, left}, return_when=asyncio.FIRST_COMPLETED)
    if d not in done:
        # Asked to stop: the CLI's exit status comes back; asked to detach:
        # nothing will, and there is nothing to wait for.
        await leaving.wait()
        try:
            await asyncio.wait_for(d, 0.5 if _detaching(parent) else 15)
        except Exception:
            pass
    for t in (u, left):
        t.cancel()
    try:
        w.close()
    except Exception:
        pass
    return exit_code[0] if exit_code else 0


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: python -m divan.held relay|hold …", file=sys.stderr)
        return 2
    if argv[0] == "hold":
        key, dialect, fp = argv[1], argv[2], argv[3]
        rest = argv[argv.index("--") + 1:]
        return hold_main(key, dialect, fp, rest)
    if argv[0] == "relay":
        args = argv[1:]
        dialect = os.environ.get(ENV_DIALECT) or "claude"
        cli = os.environ.get(ENV_CLI) or ""
        if not os.environ.get(ENV_KEY) or not cli or _passthrough(dialect, args):
            env = {k: v for k, v in os.environ.items() if k not in _OURS}
            os.execvpe(cli or "claude", [cli or "claude", *args], env)
        return asyncio.run(relay(args))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
