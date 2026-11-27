"""Language packs: the words of languages other than English, kept out of the code.

The repository is English only. A feature that has to speak, hear or match
another language (a call answered in the language it was made in, a password
said in a sentence, the phrases whisper invents over silence) reads those words
at runtime from a language pack:

    <lang dir>/<lang>/<name>.json       e.g. tr/daemon/voice.json

The lang dir is `$DIVAN_LANG_DIR` when it is set, else `<divan home>/lang`
(`config.resolve_home`, which honours DIVAN_HOME). Keys are English
identifiers; values are the strings, lists and maps a module needs.

A missing pack is not an error. `load` returns `{}`, the module falls back to
its English behaviour, and the absence is logged once per file. Packs are
trusted local files, like config.toml: a pack may hold regular expressions.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

log = logging.getLogger("divan.lang")

_cache: dict[tuple[str, str, str], dict] = {}
_told: set[tuple[str, str, str]] = set()
# A language code and a pack name, as they may appear in a path.
_LANG = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$")
_NAME = re.compile(r"^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$")


def lang_dir() -> Path:
    """Where the packs are: $DIVAN_LANG_DIR, else <divan home>/lang."""
    env = os.environ.get("DIVAN_LANG_DIR", "").strip()
    if env:
        return Path(env).expanduser()
    try:
        from .config import resolve_home
    except ImportError:
        # A tool run outside the daemon's venv (no tomli_w): the same rule, by hand.
        home = os.environ.get("DIVAN_HOME", "").strip()
        return (Path(home).expanduser() if home else Path.home() / ".divan") / "lang"
    return resolve_home() / "lang"


def available() -> bool:
    """Whether any pack is installed on this machine."""
    try:
        return any(p.is_dir() for p in lang_dir().iterdir())
    except OSError:
        return False


def valid(lang: str, name: str) -> bool:
    """Whether a language code and pack name are safe to turn into a path."""
    return bool(_LANG.match(str(lang or ""))) and bool(_NAME.match(str(name or "")))


def load(lang: str, name: str) -> dict:
    """The pack `<lang>/<name>.json` as a dict, or {} when it is missing,
    unreadable, not an object, or its name is not a plain relative path."""
    root = lang_dir()
    key = (str(root), str(lang), str(name))
    if key in _cache:
        return _cache[key]
    data: dict = {}
    if valid(lang, name):
        path = root / lang / f"{name}.json"
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
            else:
                _tell(key, "language pack %s is not a JSON object", path)
        except FileNotFoundError:
            _tell(key, "no language pack %s", path)
        except (OSError, ValueError) as e:
            _tell(key, "language pack %s unreadable: %s", path, e)
    _cache[key] = data
    return data


def names(lang: str, prefix: str) -> list[str]:
    """Every pack name under `<lang>/<prefix>/`, e.g. ("tr", "app") -> ["app/x", ...]."""
    if not valid(lang, prefix):
        return []
    base = lang_dir() / lang
    try:
        found = sorted((base / prefix).rglob("*.json"))
    except OSError:
        return []
    out = []
    for p in found:
        rel = p.relative_to(base).with_suffix("").as_posix()
        if valid(lang, rel):
            out.append(rel)
    return out


# The areas a client may fetch over the socket (`lang.get`): the phone app's
# and the web panel's own words. The daemon's and the tests' packs are not
# handed out; nothing in them is secret, but nothing outside needs them either.
CLIENT_AREAS = ("app", "web")


def client_packs(lang: str, wanted: list[str] | None = None) -> dict:
    """`lang.get`: the client packs of a language, `{lang, packs: {name: data}}`.

    `wanted` names packs (`app/tts-words`); without it every pack of the client
    areas is sent. A name outside those areas, or not a plain relative name, is
    refused; a pack that is not installed is left out, so a machine without the
    language answers with no packs and the client stays in English."""
    lang = str(lang or "").strip()
    if not _LANG.match(lang):
        raise ValueError("lang must be a language code like tr")
    if wanted is None:
        wanted = [n for area in CLIENT_AREAS for n in names(lang, area)]
    elif not isinstance(wanted, list):
        raise ValueError("names must be a list")
    packs = {}
    for n in wanted:
        n = str(n)
        if not _NAME.match(n) or n.split("/")[0] not in CLIENT_AREAS or "/" not in n:
            raise ValueError(f"not a client language pack: {n}")
        data = load(lang, n)
        if data:
            packs[n] = data
    return {"lang": lang, "packs": packs}


def reset() -> None:
    """Forget what was read (tests that point DIVAN_LANG_DIR somewhere else)."""
    _cache.clear()
    _told.clear()


def _tell(key, msg: str, *args) -> None:
    if key not in _told:
        _told.add(key)
        log.info(msg, *args)
