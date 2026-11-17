"""`voice = false` in config.toml turns speech recognition off for good.

    uv run python -m pytest -q

The owner, 17 Nov 2026: voice is not used, turn it off. Each daemon that ever
heard a voice note kept two Whisper models in GPU memory for life, ~3 GB apiece,
and on a 16 GB Mac two daemons pushed it into swap until the disk filled. Off
must survive a save and a restart, and must mean no recogniser is reported, so
nothing ever loads a model.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ["DIVAN_HOME"] = tempfile.mkdtemp(prefix="divan-voice-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import transcribe  # noqa: E402
from divan.config import Config  # noqa: E402
from divan.server import Server  # noqa: E402


def test_voice_off_survives_a_restart_and_loads_nothing():
    cfg = Config.load()
    assert cfg.voice is True
    cfg.voice = False
    cfg.save()
    srv = Server(Config.load())
    assert srv.cfg.voice is False
    assert transcribe.available() is False
    assert srv.host_info()["transcription"] is False
