"""`/files` hands an agent's audio to the phone in a shape AVPlayer will play.

    uv run python -m pytest -q

AVPlayer streams a remote file with Range requests and decides from the
Content-Type whether it can open it at all. The host's mime.types used to pick
that type: on macOS `.m4a` came out as `audio/mp4a-latm`, which AVPlayer
refuses ("Cannot Open"), so an agent's song showed a waveform and never
played. What is guarded here: a Range request is answered 206 with the right
Content-Range, and the type is one AVPlayer opens, whatever the host says.
"""
from __future__ import annotations

import mimetypes
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

HOME = tempfile.mkdtemp(prefix="divan-files-")
os.environ["DIVAN_HOME"] = HOME
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from divan.config import Config  # noqa: E402
from divan.server import Server  # noqa: E402

AUDIO = {"song.m4a": "audio/mp4", "song.mp3": "audio/mpeg", "song.wav": "audio/wav",
         "SONG.M4A": "audio/mp4", "song.aac": "audio/aac"}
BODY = bytes(range(256)) * 40


@pytest.fixture(scope="module")
def served():
    root = Path(tempfile.mkdtemp(prefix="divan-root-")).resolve()
    for name in AUDIO:
        (root / name).write_bytes(BODY)
    (root / "notes.txt").write_text("plain")
    cfg = Config.load()
    cfg.allowed_roots = [str(root)]
    _, token = cfg.add_device("phone")
    cfg.save()
    with TestClient(Server(Config.load()).app) as client:
        yield client, root, token
    shutil.rmtree(root, ignore_errors=True)
    shutil.rmtree(HOME, ignore_errors=True)


def get(served, name: str, **headers):
    client, root, token = served
    # The token rides in the query, as it does in the URL the app hands AVPlayer.
    return client.get("/files", params={"path": str(root / name), "token": token}, headers=headers)


@pytest.mark.parametrize("name", AUDIO)
def test_range_is_answered_206_with_an_audio_type(served, name):
    r = get(served, name, Range="bytes=0-1")
    assert r.status_code == 206
    assert r.headers["content-range"] == f"bytes 0-1/{len(BODY)}"
    assert r.headers["content-length"] == "2"
    assert r.content == BODY[:2]
    assert r.headers["content-type"] == AUDIO[name]
    assert r.headers["accept-ranges"] == "bytes"


def test_a_range_further_in_is_the_bytes_there(served):
    r = get(served, "song.m4a", Range="bytes=1000-")
    assert r.status_code == 206
    assert r.headers["content-range"] == f"bytes 1000-{len(BODY) - 1}/{len(BODY)}"
    assert r.content == BODY[1000:]


def test_whole_file_without_range(served):
    r = get(served, "song.m4a")
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mp4"
    assert r.content == BODY


def test_host_mime_types_do_not_decide(served, monkeypatch):
    """The macOS mime.types answer, forced, does not reach the phone."""
    monkeypatch.setattr(mimetypes, "guess_type", lambda *a, **k: ("audio/mp4a-latm", None))
    assert get(served, "song.m4a", Range="bytes=0-1").headers["content-type"] == "audio/mp4"


def test_other_files_keep_their_guessed_type(served):
    assert get(served, "notes.txt").headers["content-type"].startswith("text/plain")


def test_no_token_no_file(served):
    client, root, _ = served
    assert client.get("/files", params={"path": str(root / "song.m4a")}).status_code == 401
