"""Bad socket messages are answered, uploads are capped while read, the log rotates.

    uv run python -m pytest -q tests/test_robustness.py

A socket message that was valid JSON but not a request (a list, a number, a
`type` that is not a string) used to raise inside a dispatch task nobody held:
no answer, and "Task exception was never retrieved" in the log. /upload read the
whole body before looking at its size. daemon.log never rotated, and under
launchd every line was written a second time to launchd.err.log.
"""
from __future__ import annotations

import gc
import io
import json
import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from divan import server as servermod
from divan.__main__ import setup_logging
from divan.config import UPLOAD_DIR, Config
from divan.server import Server


@pytest.fixture(scope="module")
def served():
    cfg = Config.load()
    _, token = cfg.add_device("robust-phone")
    cfg.save()
    srv = Server(Config.load())
    with TestClient(srv.app) as client:
        yield client, srv, token


def _answer(ws):
    """The next message on the socket that is not an event."""
    while True:
        msg = ws.receive_json()
        if msg.get("type") != "event":
            return msg


@pytest.mark.parametrize("raw, rid", [
    ("[1, 2, 3]", None),
    ("42", None),
    ('{"type": 5}', None),
    ('{"type": 5, "id": "r-7"}', "r-7"),
    ('{"type": ["ping"], "id": 3}', 3),
])
def test_bad_message_is_answered_bad_request(served, caplog, raw, rid):
    client, srv, token = served
    caplog.set_level(logging.DEBUG)
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_text(raw)
        msg = _answer(ws)
        assert msg["type"] == "error"
        assert msg["data"]["code"] == "bad_request"
        assert msg.get("id") == rid
        # The socket is still served afterwards.
        ws.send_text(json.dumps({"id": "after", "type": "ping", "data": {}}))
        after = _answer(ws)
        assert after["id"] == "after" and after["type"] == "ok"
    gc.collect()
    time.sleep(0.05)
    gc.collect()
    text = caplog.text
    assert "never retrieved" not in text
    assert "Traceback" not in text


def test_dispatch_tasks_are_held_and_released(served, monkeypatch):
    client, srv, token = served
    seen: list[int] = []
    orig = Server.h_ping

    async def counting_ping(self, dev, d, ws):
        seen.append(len(self._dispatches))
        return await orig(self, dev, d, ws)

    monkeypatch.setattr(Server, "h_ping", counting_ping)
    n = 30
    with client.websocket_connect(f"/ws?token={token}") as ws:
        for i in range(n):
            ws.send_text(json.dumps({"id": i, "type": "ping", "data": {}}))
        ids = set()
        while len(ids) < n:
            msg = _answer(ws)
            assert msg["type"] == "ok", msg
            ids.add(msg["id"])
        assert ids == set(range(n))
        deadline = time.monotonic() + 2
        while srv._dispatches and time.monotonic() < deadline:
            time.sleep(0.01)
        assert srv._dispatches == set()
    # Every request was in the set while it ran.
    assert len(seen) == n and min(seen) >= 1


def _uploads() -> set[Path]:
    return {p for p in UPLOAD_DIR.rglob("*") if p.is_file()} if UPLOAD_DIR.exists() else set()


def test_upload_over_the_limit_is_413_and_reads_no_further(served, monkeypatch):
    client, srv, token = served
    monkeypatch.setattr(servermod, "UPLOAD_MAX", 4096)
    monkeypatch.setattr(servermod, "UPLOAD_CHUNK", 1024)
    reads: list[int] = []
    from starlette.datastructures import UploadFile
    orig = UploadFile.read

    async def counted(self, size=-1):
        reads.append(size)
        return await orig(self, size)

    monkeypatch.setattr(UploadFile, "read", counted)
    before = _uploads()
    body = b"x" * 50_000
    r = client.post("/upload", files={"file": ("big.bin", body)}, data={"chat_id": "robust"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 413
    # Read in bounded chunks and stopped just past the cap, not read whole.
    assert reads and all(0 < s <= 1024 for s in reads)
    assert len(reads) <= 4096 // 1024 + 1
    assert _uploads() == before


def test_upload_under_the_limit_answers_as_before(served, monkeypatch):
    client, srv, token = served
    monkeypatch.setattr(servermod, "UPLOAD_MAX", 4096)
    monkeypatch.setattr(servermod, "UPLOAD_CHUNK", 1000)
    body = bytes(range(256)) * 16          # exactly the limit, several chunks
    r = client.post("/upload", files={"file": ("notes.txt", body)}, data={"chat_id": "robust"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["name"].endswith("-notes.txt")
    assert out["size"] == len(body) and out["kind"] == "file"
    assert out["url"] == f"/files?path={out['path']}"
    assert Path(out["path"]).read_bytes() == body


class _Stream(io.StringIO):
    def __init__(self, tty: bool):
        super().__init__()
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


@pytest.fixture
def restore_logging():
    root = logging.getLogger()
    kept, level = root.handlers[:], root.level
    yield
    for h in root.handlers:
        if h not in kept:
            h.close()
    root.handlers[:] = kept
    root.setLevel(level)


def test_log_rotates_at_10mb_keeping_5(tmp_path, restore_logging):
    handlers = setup_logging(tmp_path, stderr=_Stream(False))
    files = [h for h in handlers if isinstance(h, RotatingFileHandler)]
    assert len(files) == 1
    fh = files[0]
    assert fh.maxBytes == 10 * 1024 * 1024 and fh.backupCount == 5
    assert Path(fh.baseFilename) == tmp_path / "daemon.log"
    # It really rotates: shrink the cap and write past it many times over.
    fh.maxBytes = 2000
    log = logging.getLogger("rac.test.rotate")
    for i in range(500):
        log.info("line %d %s", i, "y" * 60)
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["daemon.log"] + [f"daemon.log.{i}" for i in range(1, 6)]
    assert all(p.stat().st_size <= 2100 for p in tmp_path.iterdir())


def test_stderr_only_when_a_terminal(tmp_path, restore_logging):
    piped = _Stream(False)
    setup_logging(tmp_path, stderr=piped)
    logging.getLogger("rac.test").info("under launchd")
    assert piped.getvalue() == ""
    assert "under launchd" in (tmp_path / "daemon.log").read_text()

    term = _Stream(True)
    setup_logging(tmp_path, stderr=term)
    logging.getLogger("rac.test").info("in a terminal")
    assert "in a terminal" in term.getvalue()
    assert "in a terminal" in (tmp_path / "daemon.log").read_text()
