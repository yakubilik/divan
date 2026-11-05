"""A hand edit of `ask_for` survives the running daemon and takes effect live.

4 Nov 2026: Yakup had kept only money asks on 28 Oct, but config.toml was back to all
three categories — the running daemon wrote its in-memory copy over the hand edit on its
next save (a pairing, a push token, the stop before a restart). Run:
    .venv312/bin/python scripts/test_ask_for_live.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-askfor-")
os.environ["DIVAN_HOME"] = HOME
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from divan.config import CONFIG_PATH, Config  # noqa: E402
from divan.providers.base import ProviderConfig  # noqa: E402


def edit(text_from: str, text_to: str) -> None:
    s = CONFIG_PATH.read_text()
    assert text_from in s, s
    CONFIG_PATH.write_text(s.replace(text_from, text_to, 1))
    t = time.time() + 2          # a new mtime even on a coarse clock
    os.utime(CONFIG_PATH, (t, t))


def main() -> int:
    cfg = Config.load()          # writes the defaults: all three categories
    assert cfg.ask_for == ["money", "exposure", "destruction"], cfg.ask_for
    pc = ProviderConfig(model="opus", effort=None, perm_mode="bypass", cwd=HOME,
                        session_id=None, ask_for=cfg.ask_for)    # what a running chat holds

    three = 'ask_for = [\n    "money",\n    "exposure",\n    "destruction",\n]'
    edit(three, 'ask_for = [\n    "money",\n]')
    cfg.save()                   # e.g. a push token arriving
    assert 'ask_for = [\n    "money",\n]' in CONFIG_PATH.read_text(), "save undid the hand edit"
    assert cfg.ask_for == ["money"], cfg.ask_for
    assert pc.ask_for == ["money"], "a running chat still asks the old categories"

    # and the other way, by a refresh alone (a request), no save
    edit('ask_for = [\n    "money",\n]', 'ask_for = [\n    "money",\n    "exposure",\n]')
    cfg.refresh_tunnel()
    assert pc.ask_for == ["money", "exposure"], pc.ask_for

    # a fresh load reads what the file says
    assert Config.load().ask_for == ["money", "exposure"]
    print("ok: ask_for hand edits survive saves and reach running chats")
    return 0


if __name__ == "__main__":
    sys.exit(main())
