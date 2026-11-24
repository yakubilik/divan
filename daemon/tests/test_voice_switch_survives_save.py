"""Turning dictation back on by hand in config.toml survives the running daemon's
next save.

    uv run python -m pytest -q

23 Nov 2026: `voice = true` was written into config.toml while the daemon ran
with `voice = false` in memory; its next save (every `hello` saves) put
`false` back, and dictation was still off after the next restart.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ["DIVAN_HOME"] = tempfile.mkdtemp(prefix="divan-voice-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import config as cfgmod  # noqa: E402
from divan.config import Config  # noqa: E402


def _set(key: str, value: str) -> None:
    p = cfgmod.CONFIG_PATH
    lines = [l for l in p.read_text().splitlines() if not l.startswith(f"{key} =")]
    # top-level keys must come before the first table
    lines.insert(0, f"{key} = {value}")
    p.write_text("\n".join(lines) + "\n")


def test_hand_edit_of_voice_is_not_undone_by_a_save():
    Config.load()                        # writes a first config.toml
    _set("voice", "false")
    _set("voice_call", "false")
    running = Config.load()              # the daemon starts with both off
    assert running.voice is False

    _set("voice", "true")
    _set("voice_call", "true")
    running.save()                       # the running daemon, still on its old copy
    again = Config.load()
    assert again.voice is True
    assert again.voice_call is True
