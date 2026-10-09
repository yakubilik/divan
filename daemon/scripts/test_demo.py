#!/usr/bin/env python3
"""A demo machine serves chats with no CLI on it, and never touches the disk.

    python scripts/test_demo.py

Starts a second daemon (its own DIVAN_HOME and DIVAN_PORT, `demo = true`) with a
PATH on which neither claude nor codex can be found, and drives it over the
WebSocket the way the phone does: one turn allowed, one denied. Then seeds it
twice with `divan demo-seed`. No model turns, no network beyond
loopback.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
TMP = Path(tempfile.mkdtemp(prefix="rac-demo-"))
os.environ["DIVAN_HOME"] = str(TMP / "rac")
sys.path.insert(0, str(ROOT))

import websockets                                               # noqa: E402

from divan.config import Config                       # noqa: E402
from divan.server import Server                       # noqa: E402
from divan.session import PROVIDERS                   # noqa: E402
from divan.providers.claude import ClaudeProvider     # noqa: E402
from divan.providers.codex import CodexProvider       # noqa: E402
from divan.providers.demo import DemoProvider         # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def snapshot(folder: Path) -> dict[str, str]:
    """Every path under the folder, with its contents' hash and its mtime."""
    out = {}
    for p in sorted(folder.rglob("*")):
        st = p.stat()
        digest = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else "dir"
        out[str(p.relative_to(folder))] = f"{digest}:{st.st_mtime_ns}"
    return out


class Phone:
    """One paired device on the socket: requests, and the events in between."""

    def __init__(self, ws) -> None:
        self.ws, self.rid, self.events = ws, 0, []
        self.waiting: dict[int, asyncio.Future] = {}
        self.arrived = asyncio.Event()
        self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        async for raw in self.ws:
            m = json.loads(raw)
            if m.get("type") == "event":
                self.events.append(m)
                self.arrived.set()
            elif m.get("id") in self.waiting:
                self.waiting.pop(m["id"]).set_result(m)

    async def call(self, typ: str, data: dict | None = None) -> dict:
        self.rid += 1
        fut = asyncio.get_running_loop().create_future()
        self.waiting[self.rid] = fut
        await self.ws.send(json.dumps({"id": self.rid, "type": typ, "data": data or {}}))
        m = await asyncio.wait_for(fut, 30)
        if m["type"] == "error":
            raise RuntimeError(f"{typ}: {m['data']}")
        return m["data"]

    async def until(self, chat_id: str, name: str, start: int) -> int:
        """Index of the first `name` event for this chat at or after `start`."""
        deadline = time.monotonic() + 30
        while True:
            for i in range(start, len(self.events)):
                e = self.events[i]
                if e["chat_id"] == chat_id and e["event"] == name:
                    return i
            self.arrived.clear()
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"no {name} for {chat_id}")
            try:
                await asyncio.wait_for(self.arrived.wait(), left)
            except asyncio.TimeoutError:
                pass


async def turn(phone: Phone, chat_id: str, decision: str) -> list[dict]:
    """Send one message, answer its approval, and return the turn's events."""
    start = len(phone.events)
    await phone.call("chat.send", {"chat_id": chat_id, "text": "hello"})
    i = await phone.until(chat_id, "approval.request", start)
    await phone.call("approval.respond", {"chat_id": chat_id, "decision": decision,
                                          "request_id": phone.events[i]["data"]["request_id"]})
    end = await phone.until(chat_id, "turn.done", i)
    return [e for e in phone.events[start:end + 1] if e["chat_id"] == chat_id]


async def counts(phone: Phone) -> dict:
    projects = (await phone.call("divan.projects"))["projects"]
    sample = [p for p in projects if p["slug"] == "sample-app"]
    columns: dict[str, int] = {}
    for p in sample:
        board = await phone.call("divan.board", {"project_id": p["id"]})
        for col, cards in board["columns"].items():
            if cards:
                columns[col] = columns.get(col, 0) + len(cards)
    chats = (await phone.call("chat.list", {"include_archived": True}))["chats"]
    seeded = [c for c in chats if c["cwd"].endswith("/sample-app")]
    finished = 0
    for c in seeded:
        got = await phone.call("chat.get", {"chat_id": c["id"]})
        if got["chat"]["status"] == "idle" and any(e["event"] == "turn.done" for e in got["events"]):
            finished += 1
    return {"projects": len(projects), "sample": len(sample), "columns": columns,
            "cards": sum(columns.values()), "chats": len(chats), "seeded": len(seeded),
            "finished": finished}


def seed(env: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "divan", "demo-seed"],
                          cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)


async def drive(port: int, token: str, cwd: Path, env: dict) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{port}/ws?token={token}",
                                  max_size=8 * 1024 * 1024) as ws:
        phone = Phone(ws)
        hello = await phone.call("hello", {"device_name": "test", "lang": "en"})
        check(list(hello["catalog"]) == ["demo"], "with demo on, the catalog lists only the demo provider",
              str(list(hello["catalog"])))
        check(len(hello["catalog"]["demo"]["models"]) == 1, "and its one model")

        chat = await phone.call("chat.create", {"provider": "claude", "cwd": str(cwd)})
        check(chat["provider"] == "demo", "a chat asked for as claude runs the demo provider",
              chat["provider"])
        before = snapshot(cwd)

        print("turn 1, allowed")
        ev = await turn(phone, chat["id"], "allow")
        names = [e["event"] for e in ev]
        deltas = [e["data"]["text"] for e in ev
                  if e["event"] == "text.delta" and e["data"]["segment"] == 0]
        first = "".join(deltas)
        check(len(deltas) > 1 and "demo machine" in first.lower(),
              "the reply streams, and its first text says it is a demo machine", first[:80])
        tools = [e["data"]["tool"] for e in ev if e["event"] == "tool.use"]
        check(tools == ["Bash", "Edit"], "one tool call before the approval, an edit after it", str(tools))
        edit = next(e["data"] for e in ev if e["event"] == "tool.use" and e["data"]["tool"] == "Edit")
        check(edit["input"].get("diff", "").startswith("--- a/")
              and edit["input"].get("old_string") and edit["input"].get("new_string"),
              "the edit event carries a diff", json.dumps(edit["input"])[:120])
        last_edit = max(i for i, n in enumerate(names) if n == "tool.use")
        check("message.assistant" in names[last_edit:] and names[-1] == "turn.done",
              "a final message follows the edit and the turn ends", str(names[last_edit:]))
        results = {e["data"]["id"]: e["data"] for e in ev if e["event"] == "tool.result"}
        check(edit["id"] in results and not results[edit["id"]]["is_error"],
              "the edit has a result, as the claude provider sends one")

        print("turn 2, denied")
        ev = await turn(phone, chat["id"], "deny")
        tools = [e["data"]["tool"] for e in ev if e["event"] == "tool.use"]
        msgs = [e["data"]["text"] for e in ev if e["event"] == "message.assistant"]
        check("Edit" not in tools, "a denied turn has no edit event", str(tools))
        check(bool(msgs) and "skipped" in msgs[-1].lower(),
              "and ends saying the step was skipped", msgs[-1][:80] if msgs else "")
        check(snapshot(cwd) == before, "the chat's folder is unchanged after both turns")

        print("demo-seed")
        r = seed(env)
        check(r.returncode == 0, "demo-seed runs against the demo daemon", r.stderr[-300:])
        once = await counts(phone)
        check(once["sample"] == 1, "one sample project", str(once))
        check(len(once["columns"]) >= 2, "with cards in at least two columns", str(once["columns"]))
        check(once["seeded"] == 1 and once["finished"] == 1, "and one finished chat", str(once))
        r = seed(env)
        check(r.returncode == 0, "a second demo-seed runs", r.stderr[-300:])
        twice = await counts(phone)
        check(twice == once, "and changes no count", f"{once} -> {twice}")
        phone.reader.cancel()


def source_is_inert() -> None:
    src = (ROOT / "divan" / "providers" / "demo.py").read_text()
    banned = [r"\bsubprocess\b", r"os\.system", r"\bsocket\b", r"\bopen\(", r"write_text",
              r"write_bytes", r"create_subprocess", r"\burllib\b", r"\bhttpx\b",
              r"\bwebsockets\b", r"^import os\b", r"^from os\b", r"\bshutil\b", r"\bpathlib\b"]
    hits = [b for b in banned if re.search(b, src, re.M)]
    check(not hits, "providers/demo.py has no process, file-write or network use", str(hits))


def demo_off_unchanged() -> None:
    check(PROVIDERS == {"claude": ClaudeProvider, "codex": CodexProvider},
          "with demo off, PROVIDERS is claude and codex as before", str(PROVIDERS))
    off = Server.catalog(SimpleNamespace(cfg=Config(), _models={}))
    check(off == {"claude": ClaudeProvider.catalog(), "codex": CodexProvider.catalog()},
          "and the catalog is theirs, as before", str(list(off)))
    on = Server.catalog(SimpleNamespace(cfg=Config(demo=True), _models={}))
    check(on == {"demo": DemoProvider.catalog()}, "with demo on, only the demo provider", str(list(on)))


def main() -> None:
    bare = TMP / "bin"
    bare.mkdir()
    for tool in ("claude", "codex"):
        check(shutil.which(tool, path=str(bare)) is None, f"{tool} cannot be found on the test PATH")
    projects = TMP / "projects"
    cwd = projects / "app"
    cwd.mkdir(parents=True)
    (cwd / "README.md").write_text("# Sample app\n\nA small exmaple project.\n")
    (cwd / "main.py").write_text("print('hi')\n")

    port = free_port()
    cfg = Config.load()
    cfg.bind = ["127.0.0.1"]
    cfg.allowed_roots = [str(projects)]
    cfg.auto_update = False
    cfg.demo = True
    _, token = cfg.add_device("test")

    env = {"DIVAN_HOME": str(TMP / "rac"), "DIVAN_PORT": str(port), "PATH": str(bare),
           "HOME": str(TMP / "home"), "PYTHONPATH": str(ROOT)}
    (TMP / "home").mkdir()
    log = open(TMP / "daemon.log", "w")
    proc = subprocess.Popen([sys.executable, "-m", "divan", "serve"],
                            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(150):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as r:
                    if b'"ok":true' in r.read():
                        break
            except Exception:
                if proc.poll() is not None:
                    break
                time.sleep(0.2)
        check(proc.poll() is None, "the demo daemon starts with no CLI on PATH",
              (TMP / "daemon.log").read_text()[-500:])
        if proc.poll() is None:
            asyncio.run(drive(port, token, cwd, env))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
    source_is_inert()
    demo_off_unchanged()
    if failures:
        print(f"\n{len(failures)} failed; daemon log: {TMP / 'daemon.log'}")
        sys.exit(1)
    shutil.rmtree(TMP, ignore_errors=True)
    print("\nall passed")


if __name__ == "__main__":
    main()
