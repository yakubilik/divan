"""`host.rename` changes the computer's name without a restart, and it lasts.

    uv run python -m pytest -q

The owner, 22 Nov 2026: name the computers MacBook, Windows, Worker 1. Editing
`host_name` in config.toml by hand did not hold: the running daemon writes its
own copy of the name back on the next `hello`, so the file said the old name
again within seconds and the panel never changed. The name has to change in the
process and in the file together.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

os.environ["DIVAN_HOME"] = tempfile.mkdtemp(prefix="divan-rename-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from divan.config import Config  # noqa: E402
from divan.server import Err, Server  # noqa: E402


def test_rename_shows_at_once_and_survives_a_save_and_a_restart():
    srv = Server(Config.load())
    assert srv.host_info()["name"] != "MacBook"
    out = asyncio.run(srv.h_host_rename(None, {"name": "  MacBook  "}))
    assert out == {"name": "MacBook"}
    assert srv.host_info()["name"] == "MacBook"
    srv.cfg.save()                       # what every `hello` does
    assert Config.load().host_name == "MacBook"
    assert Server(Config.load()).host_info()["name"] == "MacBook"


@pytest.mark.parametrize("bad", ["", "   ", "x" * 61, "bell\x07name", None])
def test_a_name_that_cannot_be_shown_is_refused(bad):
    srv = Server(Config.load())
    before = srv.cfg.host_name
    with pytest.raises(Err) as e:
        asyncio.run(srv.h_host_rename(None, {"name": bad}))
    assert e.value.code == "bad_name"
    assert srv.cfg.host_name == before
