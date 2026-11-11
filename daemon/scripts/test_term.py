#!/usr/bin/env python3
"""A real shell over the socket (divan/term.py). No model turns, no network.

    python scripts/test_term.py

A real `Server` over a temporary `DIVAN_HOME` and `HOME`, driven through a test
client; the shell is /bin/sh so no profile of the person running this gets in
the way. The promises:

  1. `term.open` answers a term id, and `echo hi` typed into it comes back as
     `term.output` with `hi` in it — from $HOME, the default.
  2. `term.resize` changes the pty's size: `stty size` says the new one.
  3. `term.close` ends the shell, its foreground job and its background job
     (`sleep 1000 &`); nothing of its session is left running or a zombie, the
     pty master is closed and the entry is gone. A shell that exits on its own
     says `term.exit` and is reaped the same way.
  4. Only a socket `_admit` let in can open one: no token, a wrong token and a
     revoked token are all closed with 4401 and start no shell. Another
     person's device can neither see nor drive somebody's terminal.
  5. There is a cap, a fence on `cwd`, and a reaper for shells nobody is
     attached to or that went quiet; the peer gateway relays `term.*` as is.
  6. A terminal ends whole even when something raises while it ends, logged
     once; with no `os.waitid` (macOS before Python 3.13) just the same; and
     `close_all` at shutdown ends every one the same way.
"""
from __future__ import annotations

import asyncio
import atexit
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path

DIVAN_HOME = tempfile.mkdtemp(prefix="divan-term-")
USER_HOME = os.path.realpath(tempfile.mkdtemp(prefix="divan-term-home-"))
PROJECTS = os.path.realpath(tempfile.mkdtemp(prefix="divan-term-projects-"))
os.environ["DIVAN_HOME"] = DIVAN_HOME
os.environ["HOME"] = USER_HOME
os.environ["SHELL"] = "/bin/sh"
atexit.register(shutil.rmtree, DIVAN_HOME, ignore_errors=True)
atexit.register(shutil.rmtree, USER_HOME, ignore_errors=True)
atexit.register(shutil.rmtree, PROJECTS, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tomli_w                                                   # noqa: E402
from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

from divan import fleet, term                                    # noqa: E402
from divan.config import CONFIG_PATH, Config                     # noqa: E402
from divan.server import Server                                  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def configure(**settings) -> None:
    raw = tomllib.loads(CONFIG_PATH.read_text())
    before = CONFIG_PATH.stat().st_mtime_ns
    CONFIG_PATH.write_text(tomli_w.dumps({**raw, **settings}))
    if CONFIG_PATH.stat().st_mtime_ns <= before:
        os.utime(CONFIG_PATH, ns=(before + 1, before + 1))


def alive(pid: int) -> bool:
    """Running or a zombie: either way, still in the process table."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def running(pattern: str) -> list[str]:
    r = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return r.stdout.split()


def session_left(sid: int) -> list[int]:
    """Every process still in the shell's session (its pid is the session id)."""
    r = subprocess.run(["ps", "-A", "-o", "pid="], capture_output=True, text=True)
    left = []
    for n in r.stdout.split():
        try:
            if os.getsid(int(n)) == sid:
                left.append(int(n))
        except OSError:
            pass
    return left


def fd_identity(fd: int) -> tuple | None:
    try:
        st = os.fstat(fd)
    except OSError:
        return None
    return (st.st_dev, st.st_ino, st.st_rdev)


def wait_until(cond, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(0.05)
    return cond()


class Sock:
    """One client socket: requests answered by id, events kept in order."""

    def __init__(self, client: TestClient, token: str):
        self.cm = client.websocket_connect(f"/ws?token={token}")
        self.ws = self.cm.__enter__()
        self.events: list[dict] = []
        self.next_id = 0

    def call(self, typ: str, data: dict | None = None) -> dict:
        self.next_id += 1
        rid = self.next_id
        self.ws.send_text(json.dumps({"id": rid, "type": typ, "data": data or {}}))
        while True:
            msg = json.loads(self.ws.receive_text())
            if msg.get("type") == "event":
                self.events.append(msg)
            elif msg.get("id") == rid:
                return msg

    def ok(self, typ: str, data: dict | None = None) -> dict:
        msg = self.call(typ, data)
        if msg["type"] != "ok":
            raise AssertionError(f"{typ}: {msg}")
        return msg["data"]

    def output(self, tid: str) -> str:
        return "".join(e["data"]["data"] for e in self.events
                       if e["event"] == "term.output" and e["data"]["term_id"] == tid)

    def exited(self, tid: str) -> dict | None:
        for e in self.events:
            if e["event"] == "term.exit" and e["data"]["term_id"] == tid:
                return e["data"]
        return None

    def until(self, cond, timeout: float = 8.0) -> bool:
        """Read events until `cond()` holds. Pings keep the read from blocking."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if cond():
                return True
            self.ok("ping")
            time.sleep(0.03)
        return cond()

    def close(self) -> None:
        self.cm.__exit__(None, None, None)


def refusal(client: TestClient, token: str) -> object:
    """How a socket asking for a shell was answered: a close code, or the reply."""
    try:
        with client.websocket_connect(f"/ws?token={token}") as ws:
            ws.send_text(json.dumps({"id": 1, "type": "term.open", "data": {"cols": 80, "rows": 24}}))
            while True:
                msg = json.loads(ws.receive_text())
                if msg.get("id") == 1:
                    return msg
    except WebSocketDisconnect as exc:
        return exc.code


def on_loop(srv: Server, coro) -> None:
    asyncio.run_coroutine_threadsafe(coro, srv.terms.loop).result(timeout=10)


def background_job(a: Sock, tid: str) -> int:
    """`sleep 1000 &` in the terminal; its pid, as `$!` says it."""
    marker = f"bg-{tid}="
    a.ok("term.write", {"term_id": tid, "data": f"sleep 1000 &\necho {marker}$!\n"})
    found: list[int] = []

    def seen() -> bool:
        m = re.search(re.escape(marker) + r"(\d+)", a.output(tid))
        if m:
            found.append(int(m.group(1)))
        return bool(m)
    if not a.until(seen):
        raise AssertionError(f"no pid for `sleep 1000 &`: {a.output(tid)[-300:]!r}")
    pid = found[-1]
    if not wait_until(lambda: alive(pid)):
        raise AssertionError(f"`sleep 1000 &` (pid {pid}) is not running")
    return pid


def ends_whole(srv: Server, tid: str, shell: int, bg: int, fd: int, ident: tuple | None,
               how: str) -> None:
    """Everything a terminal's end promises, whichever way it ended."""
    check(tid not in srv.terms.terms, f"{how}: the entry leaves Terms.terms")
    check(fd_identity(fd) != ident, f"{how}: the pty master is closed", f"fd {fd}")
    check(wait_until(lambda: not alive(shell)), f"{how}: the shell is gone, not even a zombie",
          f"pid {shell}")
    check(wait_until(lambda: not alive(bg)), f"{how}: its `sleep 1000 &` is gone", f"pid {bg}")
    check(wait_until(lambda: not session_left(shell)), f"{how}: nothing of its session is left",
          str(session_left(shell)))


def opened(srv: Server, a: Sock, tid: str) -> tuple[int, int, int, tuple | None]:
    t = srv.terms.terms[tid]
    return t.pid, background_job(a, tid), t.master, fd_identity(t.master)


def test_echo(a: Sock) -> str:
    print("term.open / term.write")
    opened = a.ok("term.open", {"cols": 80, "rows": 24})
    tid = opened.get("term_id")
    check(isinstance(tid, str) and len(tid) >= 8, "term.open answers a term_id", str(opened))
    check(opened.get("cwd") == USER_HOME, "the shell starts in $HOME", str(opened))
    check(opened.get("shell") == "/bin/sh", "it runs the login shell ($SHELL)", str(opened))
    wrote = a.ok("term.write", {"term_id": tid, "data": "echo hi\n"})
    check(wrote.get("written") == len("echo hi\n"), "term.write says what it wrote", str(wrote))
    # The first line can be typed before the shell has printed its first prompt:
    # the pty echoes it at once, and the late `$ ` lands in front of the answer
    # (`echo hi\r\n$ hi\r\n`). So an answer line may start with the prompt.
    got = a.until(lambda: re.search(r"(^|\n)(\$ )?hi\r?\n", a.output(tid)) is not None)
    check(got, "`echo hi` comes back as term.output containing `hi`", repr(a.output(tid)[-300:]))
    a.ok("term.write", {"term_id": tid, "data": "pwd\n"})
    check(a.until(lambda: re.search(r"\n(\$ )?" + re.escape(USER_HOME) + r"\r\n", a.output(tid)) is not None),
          "`pwd` in it is $HOME", repr(a.output(tid)[-300:]))
    a.ok("term.write", {"term_id": tid, "data": "echo \"tty=$(tty)\"\n"})
    check(a.until(lambda: re.search(r"tty=/dev/\w+", a.output(tid)) is not None),
          "its stdin is a real terminal", repr(a.output(tid)[-300:]))
    return tid


def test_resize(a: Sock, tid: str) -> None:
    print("term.resize")
    a.ok("term.write", {"term_id": tid, "data": "stty size\n"})
    check(a.until(lambda: "24 80" in a.output(tid)), "`stty size` starts at 24 80",
          repr(a.output(tid)[-300:]))
    r = a.ok("term.resize", {"term_id": tid, "cols": 132, "rows": 41})
    check(r == {"cols": 132, "rows": 41}, "term.resize answers the new size", str(r))
    a.ok("term.write", {"term_id": tid, "data": "stty size\n"})
    check(a.until(lambda: "41 132" in a.output(tid)), "`stty size` then says 41 132",
          repr(a.output(tid)[-300:]))
    bad = a.call("term.resize", {"term_id": tid, "cols": 0, "rows": 99999})
    check(bad["type"] == "error" and bad["data"].get("code") == "bad_size",
          "a nonsense size is refused", str(bad))


def test_close(srv: Server, a: Sock, tid: str) -> None:
    print("term.close")
    listed = a.ok("term.list")["terms"]
    row = next((t for t in listed if t["term_id"] == tid), None)
    check(row is not None and row["mine"], "term.list shows it, attached here", str(listed))
    pid, bg, fd, ident = opened(srv, a, tid)
    a.ok("term.write", {"term_id": tid, "data": "sleep 4242\n"})

    def foreground() -> list[int]:
        # Only this shell's: another checkout's run of this script may have its own.
        return [int(n) for n in running("sleep 4242") if int(n) in session_left(pid)]
    check(wait_until(lambda: bool(foreground())), "a foreground job is running in it")
    fg = foreground()
    closed = a.ok("term.close", {"term_id": tid})
    check(closed.get("ended") is True, "term.close ends the last client's terminal", str(closed))
    check(not alive(pid), "the shell is gone, not even a zombie", f"pid {pid}")
    check(wait_until(lambda: not any(alive(n) for n in fg)), "its foreground job is gone",
          str([n for n in fg if alive(n)]))
    ends_whole(srv, tid, pid, bg, fd, ident, "term.close")
    check(a.until(lambda: a.exited(tid) is not None), "term.exit is sent", str(a.events[-3:]))
    check(isinstance((a.exited(tid) or {}).get("code"), int), "with an exit code",
          str(a.exited(tid)))
    check(not any(t["term_id"] == tid for t in a.ok("term.list")["terms"]),
          "term.list no longer has it")
    again = a.call("term.write", {"term_id": tid, "data": "x"})
    check(again["type"] == "error" and again["data"].get("code") == "no_term",
          "writing to a closed terminal is no_term", str(again))

    # A shell that leaves of its own accord.
    tid2 = a.ok("term.open", {})["term_id"]
    pid2 = next(t["pid"] for t in a.ok("term.list")["terms"] if t["term_id"] == tid2)
    a.ok("term.write", {"term_id": tid2, "data": "exit 3\n"})
    check(a.until(lambda: a.exited(tid2) is not None), "`exit` sends term.exit")
    check((a.exited(tid2) or {}).get("code") == 3, "with the shell's exit code", str(a.exited(tid2)))
    check(not alive(pid2), "and the shell is reaped", f"pid {pid2}")


def test_refused(client: TestClient, srv: Server, revoked_tok: str) -> None:
    print("only admitted devices")
    before = len(srv.terms.terms)
    check(refusal(client, "") == 4401, "no token: closed with 4401")
    check(refusal(client, "not-a-token-" + "z" * 30) == 4401, "a wrong token: closed with 4401")
    check(refusal(client, revoked_tok) == 4401, "a revoked token: closed with 4401")
    check(len(srv.terms.terms) == before, "and none of them started a shell")


def test_people(a: Sock, b: Sock) -> None:
    print("another person's device")
    tid = a.ok("term.open", {})["term_id"]
    check(not any(t["term_id"] == tid for t in b.ok("term.list")["terms"]),
          "does not see the terminal")
    for typ, data in [("term.write", {"data": "echo pwned\n"}), ("term.resize", {"cols": 10, "rows": 10}),
                      ("term.attach", {}), ("term.close", {})]:
        r = b.call(typ, {"term_id": tid, **data})
        check(r["type"] == "error" and r["data"].get("code") == "no_term",
              f"cannot {typ} it", str(r))
    a.ok("term.close", {"term_id": tid})


def test_limits(client: TestClient, srv: Server, a: Sock, a_tok: str) -> None:
    print("cap, cwd fence, reaper, gateway")
    outside = a.call("term.open", {"cwd": "/etc"})
    check(outside["type"] == "error" and outside["data"].get("code") == "cwd_outside",
          "a cwd outside the allowed roots is refused", str(outside))
    root = srv.cfg.allowed_roots[0]
    inside = a.ok("term.open", {"cwd": root})
    check(inside["cwd"] == str(Path(root).expanduser().resolve()), "a cwd inside one is used", str(inside))
    tids = [inside["term_id"]]
    while len(tids) < term.MAX_TERMS:
        tids.append(a.ok("term.open", {})["term_id"])
    over = a.call("term.open", {})
    check(over["type"] == "error" and over["data"].get("code") == "too_many_terms",
          f"the {term.MAX_TERMS + 1}th terminal is refused", str(over))
    for tid in tids:
        a.ok("term.close", {"term_id": tid})

    # A socket that goes away leaves its shell to the reaper, not running for ever.
    c = Sock(client, a_tok)
    tid = c.ok("term.open", {})["term_id"]
    pid = c.ok("term.attach", {"term_id": tid})["pid"]
    c.close()
    check(wait_until(lambda: srv.terms.terms[tid].detached_at is not None),
          "a dropped socket detaches from its terminal")
    on_loop(srv, srv.terms.reap(time.monotonic() + 1))
    check(tid in srv.terms.terms, "which survives a short absence (a reconnect can re-attach)")
    re_attached = a.ok("term.attach", {"term_id": tid})
    check(re_attached["attached"] == 1, "term.attach takes it up again", str(re_attached))
    a.ok("term.close", {"term_id": tid})
    check(not alive(pid), "and closing it from there ends it")

    c = Sock(client, a_tok)
    tid = c.ok("term.open", {})["term_id"]
    pid, bg, fd, ident = opened(srv, c, tid)
    c.close()
    wait_until(lambda: srv.terms.terms[tid].detached_at is not None)
    on_loop(srv, srv.terms.reap(time.monotonic() + term.DETACHED_S + 1))
    check(tid not in srv.terms.terms and not alive(pid),
          f"one left detached for {term.DETACHED_S}s is killed")
    ends_whole(srv, tid, pid, bg, fd, ident, "reaper, detached")

    tid = a.ok("term.open", {})["term_id"]
    pid, bg, fd, ident = opened(srv, a, tid)
    on_loop(srv, srv.terms.reap(time.monotonic() + term.IDLE_S + 1))
    check(tid not in srv.terms.terms and not alive(pid), f"one idle for {term.IDLE_S}s is killed")
    check(a.until(lambda: a.exited(tid) is not None), "and its client is told term.exit")
    check(isinstance((a.exited(tid) or {}).get("code"), int), "reaper, idle: with an exit code",
          str(a.exited(tid)))
    ends_whole(srv, tid, pid, bg, fd, ident, "reaper, idle")

    for typ in ("term.open", "term.write", "term.resize", "term.close", "term.list", "term.attach"):
        raw = json.dumps({"id": 1, "type": typ, "data": {"term_id": "x"}})
        fwd, answer = fleet.filter_request(raw)
        check(fwd == raw and answer is None, f"the peer gateway relays {typ} unchanged")


def test_failure(srv: Server, a: Sock) -> None:
    print("a failure while ending one")
    tid = a.ok("term.open", {})["term_id"]
    pid, bg, fd, ident = opened(srv, a, tid)
    records: list[logging.LogRecord] = []

    class Catch(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            if record.levelno >= logging.WARNING:
                records.append(record)
    catch = Catch()
    term.log.addHandler(catch)
    real = term._exited

    def broken(pid: int) -> bool:
        raise RuntimeError("injected: cannot look at the shell")
    term._exited = broken
    try:
        closed = a.ok("term.close", {"term_id": tid})
    finally:
        term._exited = real
        term.log.removeHandler(catch)
    check(closed.get("ended") is True, "term.close still answers ended", str(closed))
    check(a.until(lambda: a.exited(tid) is not None), "term.exit is still sent")
    ends_whole(srv, tid, pid, bg, fd, ident, "a failure while ending")
    injected = [r for r in records if "injected" in r.getMessage()]
    check(len(injected) == 1, "the error is logged once", str([r.getMessage() for r in records]))

    print("waitid missing (macOS before Python 3.13)")
    tid = a.ok("term.open", {})["term_id"]
    pid, bg, fd, ident = opened(srv, a, tid)
    saved = getattr(term.os, "waitid", None)
    if saved is not None:
        del term.os.waitid
    try:
        closed = a.ok("term.close", {"term_id": tid})
    finally:
        if saved is not None:
            term.os.waitid = saved
    check(closed.get("ended") is True, "without os.waitid: term.close answers ended", str(closed))
    check(a.until(lambda: a.exited(tid) is not None), "without os.waitid: term.exit is sent")
    ends_whole(srv, tid, pid, bg, fd, ident, "without os.waitid")


def test_close_all(srv: Server, a: Sock) -> None:
    print("close_all at shutdown")
    ended = []
    for _ in range(2):
        tid = a.ok("term.open", {})["term_id"]
        ended.append((tid, *opened(srv, a, tid)))
    on_loop(srv, srv.terms.close_all())
    for tid, pid, bg, fd, ident in ended:
        check(a.until(lambda: a.exited(tid) is not None), "close_all: term.exit is sent")
        ends_whole(srv, tid, pid, bg, fd, ident, "close_all")


def main() -> None:
    cfg = Config.load()
    a_dev, a_tok = cfg.add_device("Yakup phone")
    b_dev, b_tok = cfg.add_device("Bedirhan laptop")
    gone_dev, gone_tok = cfg.add_device("old phone")
    cfg.revoke(gone_dev.id)
    configure(people={"Yakup": [a_dev.id], "Bedirhan": [b_dev.id]},
              allowed_roots=[PROJECTS])
    srv = Server(Config.load())
    with TestClient(srv.app) as client:
        a = Sock(client, a_tok)
        b = Sock(client, b_tok)
        try:
            tid = test_echo(a)
            test_resize(a, tid)
            test_close(srv, a, tid)
            test_refused(client, srv, gone_tok)
            test_people(a, b)
            test_limits(client, srv, a, a_tok)
            test_failure(srv, a)
            test_close_all(srv, a)
        finally:
            if srv.terms.loop is not None:
                on_loop(srv, srv.terms.close_all())
            a.close()
            b.close()
    print()
    if failures:
        print(f"{len(failures)} failed")
        sys.exit(1)
    print("all ok")


if __name__ == "__main__":
    main()
