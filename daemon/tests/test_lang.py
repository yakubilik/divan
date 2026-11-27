"""Language packs (divan/lang.py) and the `lang.get` request that hands them out.

Everything here runs on packs written into a temporary folder, so it needs no
real pack and holds no word of another language.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from divan import lang
from divan.server import Server


@pytest.fixture
def packs(tmp_path, monkeypatch):
    root = tmp_path / "lang"
    for name, data in {"app/words": {"yes": "ja"}, "web/steps": {"step": "stap"},
                       "daemon/voice": {"hanging": ["en"]}, "tests/daemon/x": {"a": 1}}.items():
        p = root / "nl" / f"{name}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data))
    (root / "nl" / "app" / "broken.json").write_text("{not json")
    (root / "nl" / "app" / "list.json").write_text("[1, 2]")
    monkeypatch.setenv("DIVAN_LANG_DIR", str(root))
    lang.reset()
    yield root
    lang.reset()


def test_the_dir_is_the_env_or_the_home(monkeypatch, tmp_path):
    monkeypatch.setenv("DIVAN_LANG_DIR", str(tmp_path / "x"))
    assert lang.lang_dir() == tmp_path / "x"
    monkeypatch.delenv("DIVAN_LANG_DIR")
    monkeypatch.setenv("DIVAN_HOME", str(tmp_path / "home"))
    assert lang.lang_dir() == tmp_path / "home" / "lang"


def test_load_reads_a_pack_and_is_empty_without_one(packs):
    assert lang.available()
    assert lang.load("nl", "app/words") == {"yes": "ja"}
    assert lang.load("nl", "app/missing") == {}
    assert lang.load("nl", "app/broken") == {}
    assert lang.load("nl", "app/list") == {}
    assert lang.load("de", "app/words") == {}


def test_load_never_leaves_the_folder(packs):
    for name in ("../nl/app/words", "/etc/passwd", "app/../app/words", "app//words", ""):
        assert lang.load("nl", name) == {}
    assert lang.load("../nl", "app/words") == {}


def test_nothing_raises_when_there_is_no_folder(monkeypatch, tmp_path):
    monkeypatch.setenv("DIVAN_LANG_DIR", str(tmp_path / "nowhere"))
    lang.reset()
    assert not lang.available()
    assert lang.load("tr", "daemon/voice") == {}
    assert lang.client_packs("tr") == {"lang": "tr", "packs": {}}
    lang.reset()


def test_lang_get_serves_the_client_areas_only(packs):
    got = asyncio.run(Server.h_lang_get(None, None, {"lang": "nl"}))
    assert got == {"lang": "nl", "packs": {"app/words": {"yes": "ja"}, "web/steps": {"step": "stap"}}}
    got = asyncio.run(Server.h_lang_get(None, None, {"lang": "nl", "names": ["web/steps", "app/missing"]}))
    assert got == {"lang": "nl", "packs": {"web/steps": {"step": "stap"}}}
    for names in (["daemon/voice"], ["tests/daemon/x"], ["app/../daemon/voice"], ["app"], "app/words"):
        with pytest.raises(ValueError):
            asyncio.run(Server.h_lang_get(None, None, {"lang": "nl", "names": names}))
    for code in ("", "../nl", "nl/app"):
        with pytest.raises(ValueError):
            asyncio.run(Server.h_lang_get(None, None, {"lang": code}))
