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


def test_call_off_refuses_the_call_and_leaves_dictation_alone():
    """The owner, 21 Nov 2026: "turn voice off" meant the call, not dictation.
    `voice_call = false` is the call alone: every way into it is refused and
    the apps are told, while the recogniser stays whatever `voice` says."""
    import asyncio

    import pytest

    from divan.server import Err

    cfg = Config.load()
    cfg.voice, cfg.voice_call = True, False
    cfg.save()
    cfg = Config.load()
    assert (cfg.voice, cfg.voice_call) == (True, False)
    transcribe._known = None
    srv = Server(cfg)
    assert transcribe.known() is not False        # dictation was not switched off
    assert srv.host_info()["call"] is False
    for h, args in ((srv.h_voice_start, (None, {}, None)), (srv.h_call_hello, (None, {})),
                    (srv.h_call_ask, (None, {"text": "hi"})), (srv.h_call_reply, (None, {"chat_id": "x"}))):
        with pytest.raises(Err) as e:
            asyncio.run(h(*args))
        assert e.value.code == "call_off"
