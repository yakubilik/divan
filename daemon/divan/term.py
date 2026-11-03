"""A real shell on this computer, on a pty, driven over the socket.

`term.open` starts the user's login shell in $HOME on a fresh pseudo-terminal
and answers with its id; what the shell prints comes back as `term.output`
events to every socket attached to it, and `term.exit` when it ends. Nothing
here checks who is asking: the handlers are only reachable from a socket that
was already admitted (server.py `_admit`), exactly like `chat.*`, and a term is
only ever shown to devices of the person who opened it.

A shell nobody is attached to, or that has been silent for a long time, is
killed rather than left running: a phone that dropped off a train does not get
to leave a shell behind on the machine for ever. So is the whole process group
on close, and the child is always waited for — no zombie, no orphan.

POSIX only. Windows answers `term_unsupported`; ConPTY is a later ticket.
"""
from __future__ import annotations

import asyncio
import codecs
import logging
import os
import secrets
import signal
import struct
import subprocess
import sys
import time
from typing import Awaitable, Callable

if sys.platform != "win32":
    import fcntl
    import pwd
    import termios

from .errors import Err

log = logging.getLogger("rac.term")

MAX_TERMS = 8                 # open shells per daemon, every device together
IDLE_S = 30 * 60              # no input and no output for this long: killed
DETACHED_S = 5 * 60           # no socket attached for this long: killed
REAP_EVERY_S = 30.0
FLUSH_S = 0.01                # output is coalesced this long before it is sent
CHUNK_MAX = 64 * 1024         # one term.output carries at most this much
BUFFER_MAX = 256 * 1024       # reading pauses while this much is unsent
KILL_GRACE_S = 1.0            # SIGHUP, then this long, then SIGKILL
MIN_DIM, MAX_DIM = 1, 1000

Send = Callable[[object, dict], Awaitable[None]]


def _dims(d: dict, cols: int = 80, rows: int = 24) -> tuple[int, int]:
    try:
        c = int(d.get("cols", cols))
        r = int(d.get("rows", rows))
    except (TypeError, ValueError):
        raise Err("bad_size", "cols and rows must be numbers")
    if not (MIN_DIM <= c <= MAX_DIM and MIN_DIM <= r <= MAX_DIM):
        raise Err("bad_size", f"cols and rows must be between {MIN_DIM} and {MAX_DIM}")
    return c, r


def login_shell() -> str:
    """$SHELL if it is a real file, else what the password database says."""
    sh = os.environ.get("SHELL", "")
    if sh and os.path.isfile(sh) and os.access(sh, os.X_OK):
        return sh
    try:
        sh = pwd.getpwuid(os.getuid()).pw_shell
    except KeyError:
        sh = ""
    return sh if sh and os.path.isfile(sh) else "/bin/sh"


def _set_size(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _take_terminal() -> None:
    # Runs in the child between fork and exec: the slave on stdin becomes the
    # controlling terminal of the new session, so job control and ^C work.
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


class Term:
    def __init__(self, tid: str, owner: str | None, device_id: str, cwd: str,
                 cols: int, rows: int, shell: str):
        self.id = tid
        self.owner = owner
        self.device_id = device_id
        self.cwd = cwd
        self.cols, self.rows = cols, rows
        self.shell = shell
        self.created = time.time()
        self.active = time.monotonic()
        self.detached_at: float | None = None
        self.clients: set = set()
        self.buf = bytearray()
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.flushing: asyncio.TimerHandle | None = None
        self.reading = False
        self.ended = False
        self.master, slave = os.openpty()
        try:
            _set_size(slave, cols, rows)
            env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}
            env.setdefault("LANG", "en_US.UTF-8")
            env.pop("COLUMNS", None)
            env.pop("LINES", None)
            # `-l` for a login shell, so it reads the same profile a Terminal
            # window would and $PATH is the one the person knows.
            self.proc = subprocess.Popen(
                [shell, "-l"], stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env,
                close_fds=True, start_new_session=True, preexec_fn=_take_terminal)
        except BaseException:
            os.close(self.master)
            raise
        finally:
            os.close(slave)
        os.set_blocking(self.master, False)

    @property
    def pid(self) -> int:
        return self.proc.pid

    def public(self) -> dict:
        return {"term_id": self.id, "pid": self.pid, "cwd": self.cwd, "shell": self.shell,
                "cols": self.cols, "rows": self.rows, "created_at": self.created,
                "attached": len(self.clients)}


class Terms:
    """Every open shell on this daemon."""

    def __init__(self, send: Send):
        self.send = send
        self.terms: dict[str, Term] = {}
        self._reaper: asyncio.Task | None = None
        self.loop: asyncio.AbstractEventLoop | None = None

    # ── requests ───────────────────────────────────────────────────────────
    def open(self, ws, owner: str | None, device_id: str, d: dict, cwd: str) -> Term:
        if sys.platform == "win32":
            raise Err("term_unsupported", "a terminal is not available on Windows yet")
        live = [t for t in self.terms.values() if not t.ended]
        if len(live) >= MAX_TERMS:
            raise Err("too_many_terms", f"at most {MAX_TERMS} terminals can be open at once")
        cols, rows = _dims(d)
        self.loop = asyncio.get_running_loop()
        tid = secrets.token_hex(6)
        t = Term(tid, owner, device_id, cwd, cols, rows, login_shell())
        t.clients.add(ws)
        self.terms[tid] = t
        self._start_reading(t)
        if self._reaper is None or self._reaper.done():
            self._reaper = asyncio.get_running_loop().create_task(self._reap())
        log.info("term %s opened: pid %s, %s in %s, %dx%d, device %s",
                 tid, t.pid, t.shell, cwd, cols, rows, device_id)
        return t

    def get(self, owner: str | None, tid: object) -> Term:
        t = self.terms.get(str(tid or ""))
        # Another person's shell is not there, rather than forbidden.
        if t is None or t.ended or t.owner != owner:
            raise Err("no_term", "no such terminal")
        return t

    async def write(self, t: Term, data: object) -> int:
        if not isinstance(data, str):
            raise Err("bad_data", "data must be a string")
        raw = data.encode("utf-8")
        t.active = time.monotonic()
        # The master is non-blocking; a shell that is not reading its input
        # fills the pty's buffer and the rest is waited for a moment, not lost.
        view = memoryview(raw)
        deadline = time.monotonic() + 2.0
        while view:
            try:
                n = os.write(t.master, view)
                view = view[n:]
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise Err("term_busy", "the terminal is not reading its input")
                await asyncio.sleep(0.005)
            except OSError:
                raise Err("no_term", "that terminal has ended")
        return len(raw)

    def resize(self, t: Term, d: dict) -> None:
        cols, rows = _dims(d, t.cols, t.rows)
        _set_size(t.master, cols, rows)
        t.cols, t.rows = cols, rows
        try:
            # The kernel tells the foreground group itself; this is for a shell
            # that is in the background of its own terminal.
            os.killpg(t.pid, signal.SIGWINCH)
        except OSError:
            pass

    def attach(self, t: Term, ws) -> None:
        t.clients.add(ws)
        t.detached_at = None

    async def close(self, t: Term, ws) -> bool:
        """Let go of it for this socket; the last one to let go ends it."""
        if t.clients - {ws}:
            t.clients.discard(ws)
            return False
        # Still attached while it ends, so the closer is told `term.exit` too.
        await self.kill(t, "closed")
        return True

    def list(self, owner: str | None, ws) -> list[dict]:
        return [{**t.public(), "mine": ws in t.clients}
                for t in self.terms.values() if not t.ended and t.owner == owner]

    def detach(self, ws) -> None:
        """A socket went away. Its shells live on until DETACHED_S."""
        now = time.monotonic()
        for t in self.terms.values():
            if ws in t.clients:
                t.clients.discard(ws)
                if not t.clients:
                    t.detached_at = now

    async def close_all(self) -> None:
        await asyncio.gather(*(self.kill(t, "daemon_stopped") for t in list(self.terms.values())),
                             return_exceptions=True)
        if self._reaper is not None:
            self._reaper.cancel()

    # ── output ─────────────────────────────────────────────────────────────
    def _start_reading(self, t: Term) -> None:
        if not t.reading and not t.ended:
            asyncio.get_running_loop().add_reader(t.master, self._readable, t)
            t.reading = True

    def _stop_reading(self, t: Term) -> None:
        if t.reading:
            asyncio.get_running_loop().remove_reader(t.master)
            t.reading = False

    def _readable(self, t: Term) -> None:
        try:
            chunk = os.read(t.master, 65536)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""          # EIO: every process on the slave side is gone
        if not chunk:
            self._stop_reading(t)
            asyncio.get_running_loop().create_task(self._ended(t))
            return
        t.active = time.monotonic()
        t.buf += chunk
        if len(t.buf) >= BUFFER_MAX:
            # A client cannot keep up with `yes`; let the pty fill instead of
            # this process's memory, and read again once this is sent.
            self._stop_reading(t)
        if t.flushing is None:
            t.flushing = asyncio.get_running_loop().call_later(FLUSH_S, self._flush_soon, t)

    def _flush_soon(self, t: Term) -> None:
        t.flushing = None
        asyncio.get_running_loop().create_task(self._flush(t))

    async def _flush(self, t: Term, final: bool = False) -> None:
        while t.buf:
            raw = bytes(t.buf[:CHUNK_MAX])
            del t.buf[:CHUNK_MAX]
            text = t.decoder.decode(raw, final=final and not t.buf)
            if text:
                await self._emit(t, "term.output", {"term_id": t.id, "data": text})
        if final:
            tail = t.decoder.decode(b"", final=True)
            if tail:
                await self._emit(t, "term.output", {"term_id": t.id, "data": tail})
        elif not t.ended:
            self._start_reading(t)

    async def _emit(self, t: Term, event: str, data: dict) -> None:
        payload = {"type": "event", "event": event, "chat_id": None, "seq": None,
                   "data": data, "ts": time.time()}
        for ws in list(t.clients):
            await self.send(ws, payload)

    # ── ending ─────────────────────────────────────────────────────────────
    async def _ended(self, t: Term) -> None:
        """The shell's side of the pty closed: it exited, or was killed."""
        if t.ended:
            return
        t.ended = True
        if t.flushing is not None:
            t.flushing.cancel()
            t.flushing = None
        # Anything still in the pty, then whatever the decoder held back.
        while True:
            try:
                more = os.read(t.master, 65536)
            except OSError:
                break
            if not more:
                break
            t.buf += more
        await self._flush(t, final=True)
        code = await self._wait(t)
        try:
            os.close(t.master)
        except OSError:
            pass
        self.terms.pop(t.id, None)
        log.info("term %s ended: pid %s, code %s", t.id, t.pid, code)
        await self._emit(t, "term.exit", {"term_id": t.id, "code": code})

    async def _wait(self, t: Term) -> int | None:
        """Reap the shell, and make sure nothing of its group outlives it.

        The shell is looked at without being reaped until its group has been
        cleared: an unreaped leader keeps its pid, so the group id cannot have
        been handed to some unrelated process by the time it is signalled.
        """
        deadline = time.monotonic() + KILL_GRACE_S
        while not _exited(t.pid) and time.monotonic() < deadline:
            await asyncio.sleep(0.02)
        while not _exited(t.pid):
            _signal_group(t.pid, signal.SIGKILL)
            await asyncio.sleep(0.02)
        # Whatever the shell left running in its own group would keep running
        # with nobody to see it: end it too.
        _signal_group(t.pid, signal.SIGKILL)
        return await asyncio.get_running_loop().run_in_executor(None, t.proc.wait)

    async def kill(self, t: Term, why: str) -> None:
        if t.ended:
            return
        log.info("term %s killed: %s", t.id, why)
        # The job in front (a `sleep`, a `vim`) and the shell itself; the shell
        # passes the hangup on to its other jobs, as it does when a window closes.
        try:
            fg = os.tcgetpgrp(t.master)
        except OSError:
            fg = None
        if fg and fg != t.pid:
            _signal_group(fg, signal.SIGHUP)
            _signal_group(fg, signal.SIGCONT)
        _signal_group(t.pid, signal.SIGHUP)
        _signal_group(t.pid, signal.SIGCONT)
        self._stop_reading(t)
        await self._ended(t)

    async def _reap(self) -> None:
        while True:
            await asyncio.sleep(REAP_EVERY_S)
            try:
                await self.reap()
            except Exception as exc:
                log.warning("term reaper: %s", exc)

    async def reap(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for t in list(self.terms.values()):
            if t.ended:
                continue
            if not t.clients and t.detached_at is not None and now - t.detached_at >= DETACHED_S:
                await self.kill(t, "detached")
            elif now - t.active >= IDLE_S:
                await self.kill(t, "idle")


def _exited(pid: int) -> bool:
    """Whether the child has exited, without reaping it."""
    try:
        return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    except ChildProcessError:
        return True


def _signal_group(pgid: int, sig: int) -> None:
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass
