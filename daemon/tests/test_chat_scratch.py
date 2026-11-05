"""Each chat gets its own TMPDIR (5 Nov 2026).

Yakup: a chat leaves the Mac clean when its work is done, like a ticket. A ticket's runs
have had their own scratch folder since #375; a chat wrote to the system TMPDIR and /tmp,
where nobody knew whose a file was. Now the CLI of a chat runs with TMPDIR set to
<divan home>/scratch/<chat id>, made before the CLI starts; mac-bekci deletes a folder
nothing used for a day.
"""
from __future__ import annotations

from divan import accounts, config
from divan.providers.base import ProviderConfig
from divan.providers.claude import ClaudeProvider

import pytest


@pytest.fixture
def scratch(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SCRATCH_DIR", tmp_path / "scratch")
    monkeypatch.setattr(accounts, "share_memory", lambda *a, **k: None)
    return tmp_path / "scratch"


def _env(chat_id):
    p = ClaudeProvider.__new__(ClaudeProvider)
    p.cfg = ProviderConfig(model="sonnet", effort=None, perm_mode="ask", cwd="/tmp",
                           session_id=None, chat_id=chat_id)
    p._session_id = None
    return p._options().env


def test_chat_runs_with_its_own_tmpdir(scratch):
    env = _env("c-123")
    assert env["TMPDIR"] == str(scratch / "c-123")
    assert (scratch / "c-123").is_dir()


def test_two_chats_two_folders(scratch):
    assert _env("a")["TMPDIR"] != _env("b")["TMPDIR"]


def test_chat_id_cannot_leave_the_scratch_root(scratch):
    d = config.chat_scratch("../../etc", root=scratch)
    assert d.parent == scratch
