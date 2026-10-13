#!/usr/bin/env python3
"""A real shell over the socket (divan/term.py). No model turns, no network.

    python scripts/test_term.py

A real `Server` over a temporary `DIVAN_HOME` and `HOME`, driven through a test
client; the shell is /bin/sh so no profile of the person running this gets in
the way. The promises:

  1. `term.open` answers a term id, and `echo hi` typed into it comes back as
     `term.output` with `hi` in it — from $HOME, the default.
  2. `term.resize` changes the pty's size: `stty size` says the new one.
  3. `term.close` ends the shell, its foreground job and its background job;
     nothing is left running and nothing is left a zombie. A shell that exits
     on its own says `term.exit` and is reaped the same way.
  4. Only a socket `_admit` let in can open one: no token, a wrong token and a
     revoked token are all closed with 4401 and start no shell. Another
     person's device can neither see nor drive somebody's terminal.
  5. There is a cap, a fence on `cwd`, and a reaper for shells nobody is
     attached to or that went quiet; the peer gateway relays `term.*` as is.
"""
from __future__ import annotations

import asyncio
import atexit
import json
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


def test_echo(a: Sock) -> str:
    print("term.open / term.write")
    opened = a.ok("term.open", {"cols": 80, "rows": 24})
    tid = opened.get("term_id")
    check(isinstance(tid, str) and len(tid) >= 8, "term.open answers a term_id", str(opened))
    check(opened.get("cwd") == USER_HOME, "the shell starts in $HOME", str(opened))
    check(opened.get("shell") == "/bin/sh", "it runs the login shell ($SHELL)", str(opened))
    wrote = a.ok("term.write", {"term_id": tid, "data": "echo hi\n"})
    check(wrote.get("written") == len("echo hi\n"), "term.write says what it wrote", str(wrote))
    got = a.until(lambda: re.search(r"(^|\n)hi\r?\n", a.output(tid)) is not None)
    check(got, "`echo hi` comes back as term.output containing `hi`", repr(a.output(tid)[-300:]))
    a.ok("term.write", {"term_id": tid, "data": "pwd\n"})
    check(a.until(lambda: f"\n{USER_HOME}\r\n" in a.output(tid)),
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


def test_close(a: Sock, tid: str) -> None:
    print("term.close")
    listed = a.ok("term.list")["terms"]
    row = next((t for t in listed if t["term_id"] == tid), None)
    check(row is not None and row["mine"], "term.list shows it, attached here", str(listed))
    pid = row["pid"] if row else -1
    a.ok("term.write", {"term_id": tid, "data": "sleep 4243 &\n"})
    a.ok("term.write", {"term_id": tid, "data": "sleep 4242\n"})
    check(wait_until(lambda: running("sleep 4242") and running("sleep 4243")),
          "a foreground and a background job are running in it")
    closed = a.ok("term.close", {"term_id": tid})
    check(closed.get("ended") is True, "term.close ends the last client's terminal", str(closed))
    check(not alive(pid), "the shell is gone, not even a zombie", f"pid {pid}")
    check(wait_until(lambda: not running("sleep 4242")), "its foreground job is gone",
          str(running("sleep 4242")))
    check(wait_until(lambda: not running("sleep 4243")), "its background job is gone",
          str(running("sleep 4243")))
    check(a.until(lambda: a.exited(tid) is not None), "term.exit is sent", str(a.events[-3:]))
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
    pid = c.ok("term.attach", {"term_id": tid})["pid"]
    c.close()
    wait_until(lambda: srv.terms.terms[tid].detached_at is not None)
    on_loop(srv, srv.terms.reap(time.monotonic() + term.DETACHED_S + 1))
    check(tid not in srv.terms.terms and not alive(pid),
          f"one left detached for {term.DETACHED_S}s is killed")

    tid = a.ok("term.open", {})["term_id"]
    pid = srv.terms.terms[tid].pid
    on_loop(srv, srv.terms.reap(time.monotonic() + term.IDLE_S + 1))
    check(tid not in srv.terms.terms and not alive(pid), f"one idle for {term.IDLE_S}s is killed")
    check(a.until(lambda: a.exited(tid) is not None), "and its client is told term.exit")

    for typ in ("term.open", "term.write", "term.resize", "term.close", "term.list", "term.attach"):
        raw = json.dumps({"id": 1, "type": typ, "data": {"term_id": "x"}})
        fwd, answer = fleet.filter_request(raw)
        check(fwd == raw and answer is None, f"the peer gateway relays {typ} unchanged")


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
            test_close(a, tid)
            test_refused(client, srv, gone_tok)
            test_people(a, b)
            test_limits(client, srv, a, a_tok)
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
