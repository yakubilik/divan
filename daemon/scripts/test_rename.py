#!/usr/bin/env python3
"""What the rename to Divan promises, and the three things kept from before it.

    .venv312/bin/python scripts/test_rename.py

The data home, the link `divan pair` prints, and what a chat's process is told
about itself. Everything runs in a temporary folder; no CLI is signed in to.
"""
import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path

DAEMON = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DAEMON))
tmp = Path(tempfile.mkdtemp(prefix="divan-rename-")).resolve()
os.environ["DIVAN_HOME"] = str(tmp / "daemon-home")

from divan import legacy, tools  # noqa: E402
from divan.config import resolve_home  # noqa: E402
from divan.providers.base import ProviderConfig  # noqa: E402
from divan.providers.claude import ClaudeProvider  # noqa: E402
from divan.providers.codex import CodexProvider  # noqa: E402

failures = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failures
    print(f"  {'ok' if cond else 'x '}  {name}" + (f"\n    {detail}" if detail and not cond else ""))
    failures += not cond


print("the data home")
home = tmp / "home"
(home / legacy.HOME_NAME).mkdir(parents=True)
ok("only the old folder is there: it is the home",
   resolve_home({}, home) == home / legacy.HOME_NAME, str(resolve_home({}, home)))
(home / ".divan").mkdir()
ok("~/.divan is there: it is the home, whatever else is",
   resolve_home({}, home) == home / ".divan", str(resolve_home({}, home)))
ok("DIVAN_HOME wins over both",
   resolve_home({"DIVAN_HOME": str(tmp / "elsewhere")}, home) == tmp / "elsewhere")
ok("neither is there: a new install starts at ~/.divan",
   resolve_home({}, tmp / "nobody") == tmp / "nobody" / ".divan")

print("divan pair")
r = subprocess.run([sys.executable, "-m", "divan", "pair", "--name", "test phone"], cwd=DAEMON,
                   capture_output=True, text=True, env={**os.environ, "PYTHONPATH": str(DAEMON)})
links = [ln for ln in r.stdout.splitlines() if "://pair?" in ln]
ok("it prints a divan://pair?… link and no other",
   r.returncode == 0 and len(links) == 1 and links[0].startswith("divan://pair?host=")
   and "token=" in links[0], r.stdout[-400:] + r.stderr[-400:])

print("a chat's process")


async def noop(*a, **kw):
    return None


def pc() -> ProviderConfig:
    return ProviderConfig(model="m", effort=None, perm_mode="ask", cwd=str(tmp), session_id=None,
                          chat_id="chat-42")


env = ClaudeProvider(pc(), noop, noop)._options().env
ok("claude is handed DIVAN_CHAT_ID and the legacy variable, both the chat's id",
   env.get("DIVAN_CHAT_ID") == "chat-42" and env.get(legacy.CHAT_ID_ENV) == "chat-42"
   and legacy.CHAT_ID_ENV != "DIVAN_CHAT_ID")

# A stand-in for the codex CLI: a process that writes down the environment it
# was started with. The provider starts it exactly as it starts the real one.
seen = tmp / "env.txt"
cli = tmp / "codex"
cli.write_text(f'#!/bin/sh\nenv > "{seen}"\n')
cli.chmod(0o755)
tools.find_cli = lambda name: str(cli)


async def start_codex() -> None:
    p = CodexProvider(pc(), noop, noop)
    try:
        await asyncio.wait_for(p._ensure(), timeout=5)
    except Exception:
        pass                      # it is not a codex; all it had to do was start
    for _ in range(50):
        if seen.exists() and seen.read_text().strip():
            break
        await asyncio.sleep(0.1)
    try:
        await asyncio.wait_for(p.close(), timeout=5)
    except Exception:
        pass


asyncio.run(start_codex())
started = dict(ln.split("=", 1) for ln in seen.read_text().splitlines() if "=" in ln) if seen.exists() else {}
ok("the process codex is started as has both in its environment",
   started.get("DIVAN_CHAT_ID") == "chat-42" and started.get(legacy.CHAT_ID_ENV) == "chat-42",
   str({k: v for k, v in started.items() if "CHAT" in k}))

print("\nall good" if not failures else f"\n{failures} failed")
sys.exit(1 if failures else 0)
