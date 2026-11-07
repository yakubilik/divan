#!/usr/bin/env python3
"""End to end: a daemon restarts in the middle of a turn and the turn carries on.

Not collected by pytest (it starts real daemons and takes a minute):

    .venv312/bin/python tests/e2e_held_restart.py            # scripted claude
    .venv312/bin/python tests/e2e_held_restart.py --real     # the real claude CLI

A throwaway daemon on its own port and DIVAN_HOME — never the live one — is
given a chat and a long turn, and is stopped twice in the middle of turns:
once politely (SIGTERM, which is what launchd and `daemon.restart` do) and once
dead (SIGKILL, a crash). A new daemon is started each time. Checked from its
database afterwards: the turn finished, its answer is in the timeline once and
whole, the CLI saw one handshake and was never asked the question twice, and
the chat ended idle. With --real, the answer is checked for the word asked for.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DAEMON = HERE.parent
REAL = "--real" in sys.argv
CODEX = "--codex" in sys.argv
HOME = Path(tempfile.mkdtemp(prefix="dve2e-", dir=os.environ.get("TMPDIR"))).resolve()
PORT = 18791
os.environ["DIVAN_HOME"] = str(HOME)
os.environ["DIVAN_PORT"] = str(PORT)
sys.path.insert(0, str(DAEMON))

from divan.config import Config  # noqa: E402
from divan import held  # noqa: E402
from divan.__main__ import _protocol  # noqa: E402

# Not under HOME: the daemon's own home is a folder no chat may open.
WORK = Path(tempfile.mkdtemp(prefix="dve2e-work-", dir=os.environ.get("TMPDIR"))).resolve()
LOG = HOME / "cli.jsonl"
ENV = {**os.environ, "DIVAN_HOME": str(HOME), "DIVAN_PORT": str(PORT),
       "CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK": "1", "FAKE_LOG": str(LOG)}
if not REAL:
    ENV["DIVAN_CLAUDE_CLI"] = str(HERE / "fake_claude.py")
    ENV["DIVAN_CODEX_CLI"] = str(HERE / "fake_codex.py")
    (HERE / "fake_claude.py").chmod(0o755)
    (HERE / "fake_codex.py").chmod(0o755)

fails = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global fails
    print(("  ok    " if cond else "  FAIL  ") + name + ("" if cond else f"\n        {detail}"))
    fails += 0 if cond else 1


def configure() -> None:
    cfg = Config.load()
    cfg.allowed_roots = [str(WORK)]
    cfg.auto_update = False
    cfg.bind = ["127.0.0.1"]
    cfg.port = PORT
    cfg.save()


def start() -> subprocess.Popen:
    p = subprocess.Popen([sys.executable, "-m", "divan", "serve"], cwd=str(DAEMON), env=ENV,
                         stdout=open(HOME / "daemon.out", "ab"), stderr=subprocess.STDOUT)
    end = time.time() + 30
    while time.time() < end:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=1)
            return p
        except Exception:
            time.sleep(0.3)
    raise SystemExit("the test daemon did not come up")


def call(typ: str, data: dict) -> dict:
    return asyncio.run(_protocol(Config.load(), typ, data))


def db() -> sqlite3.Connection:
    c = sqlite3.connect(str(HOME / "db.sqlite"), timeout=5)
    c.row_factory = sqlite3.Row
    return c


def events(cid: str) -> list[tuple[str, dict]]:
    with db() as c:
        rows = c.execute("SELECT type, payload FROM events WHERE chat_id=? ORDER BY seq", (cid,)).fetchall()
    return [(r["type"], json.loads(r["payload"])) for r in rows]


def status(cid: str) -> str:
    with db() as c:
        return c.execute("SELECT status FROM chats WHERE id=?", (cid,)).fetchone()["status"]


def wait(pred, timeout: float) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            if pred():
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def cli_lines(kind: str) -> int:
    if not LOG.exists():
        return 0
    n = 0
    for line in LOG.read_text().splitlines():
        o = json.loads(line)["obj"]
        if kind == "initialize" and o.get("type") == "control_request" \
                and (o.get("request") or {}).get("subtype") == "initialize":
            n += 1
        if kind == "user" and o.get("type") == "user":
            n += 1
        if kind == "initialize" and o.get("method") == "initialize":
            n += 1
        if kind == "user" and o.get("method") == "turn/start":
            n += 1
    return n


def turn_across(cid: str, prompt: str, how: str, daemon: subprocess.Popen) -> subprocess.Popen:
    before = len(events(cid))
    users_before = cli_lines("user")
    call("chat.send", {"chat_id": cid, "text": prompt, "client_id": f"e2e-{how}"})
    # Into the turn: words are streaming.
    ok(f"{how}: the turn is running", wait(lambda: status(cid) == "running", 20), status(cid))
    time.sleep(3 if not REAL else 6)
    if how == "polite":
        daemon.send_signal(signal.SIGTERM)
    else:
        daemon.send_signal(signal.SIGKILL)
    daemon.wait(30)
    st = held.read_state(cid)
    ok(f"{how}: the CLI is still alive and in its turn after the daemon went",
       bool(st and st["in_turn"] and held._alive(st.get("cli_pid"))), str(st))
    time.sleep(2)
    daemon = start()
    done = wait(lambda: status(cid) == "idle" and any(
        t == "turn.done" for t, _ in events(cid)[before:]), 120)
    new = events(cid)[before:]
    answers = [p.get("text", "") for t, p in new if t == "message.assistant"]
    errors = [p for t, p in new if t == "turn.error"]
    ok(f"{how}: the turn finished after the restart, and the chat is idle", done,
       f"status={status(cid)} types={[t for t, _ in new][-12:]}")
    ok(f"{how}: no turn error", not errors, str(errors))
    if REAL:
        ok(f"{how}: the answer arrived", any("PINEAPPLE" in a for a in answers), str(answers))
        uses = [(p.get("tool"), p.get("id")) for t, p in new if t == "tool.use" and p.get("tool") == "Bash"]
        ok(f"{how}: the sleep ran once — the turn went on, it was not started again",
           len({i for _, i in uses}) == 1, str(uses))
        ok(f"{how}: and its card is drawn once", len(uses) == 1, str(uses))
    else:
        whole = "".join(f"{'c' if CODEX else 'w'}{i} " for i in range(16)).strip()
        ok(f"{how}: the answer is in the timeline once, and whole",
           [a.strip() for a in answers] == [whole], str(answers))
        ok(f"{how}: the CLI was asked the question once", cli_lines("user") - users_before == 1,
           str(cli_lines("user") - users_before))
    return daemon


def main() -> int:
    configure()
    d = start()
    try:
        spec = {"cwd": str(WORK), "provider": "codex" if CODEX else "claude",
                "perm_mode": "bypass", "title": "held e2e"}
        if not CODEX:
            spec["model"] = "haiku" if REAL else "opus"
        elif not REAL:
            spec["model"] = "fake"
        chat = call("chat.create", spec)
        cid = chat["id"]
        prompt = ("Run `sleep 20` with the Bash tool, then reply with the single word PINEAPPLE."
                  if REAL else "SLOW one")
        d = turn_across(cid, prompt, "polite", d)
        d = turn_across(cid, prompt.replace("one", "two"), "crash", d)
        if not REAL:
            ok("the CLI saw one handshake across both restarts", cli_lines("initialize") == 1,
               str(cli_lines("initialize")))
        call("chat.delete", {"chat_id": cid})
        ok("deleting the chat stops its held CLI", wait(lambda: cid not in held.live_keys(), 20),
           str(held.live_keys()))
    finally:
        d.send_signal(signal.SIGTERM)
        try:
            d.wait(20)
        except Exception:
            d.kill()
        for k in held.live_keys():
            asyncio.run(held.stop(k))
    print(f"\n{'all passed' if not fails else f'{fails} failed'} — home {HOME}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
