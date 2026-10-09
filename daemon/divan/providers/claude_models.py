"""The Claude model list, read out of the binary the chats actually run.

A list typed by hand here goes stale the day Claude Code ships a model, and it
goes stale quietly: the phone keeps offering last month's models, the picker
still looks right, and nothing errors until a turn is refused. The CLI already
carries the answer. Compiled into the binary is a hand-maintained model catalog
— ids, display names, context windows, pricing tiers, which efforts each model
takes, and the alias (`opus`, `sonnet`, …) each family resolves to — as a
minified JS object literal. This finds that object in the file and shapes it
into the catalog the phone renders.

The binary read is deliberately the one the SDK will spawn: claude_agent_sdk
prefers the `claude` it bundles over anything on PATH, so a newer CLI in
~/.local/bin is *not* what a chat runs, and listing its models would offer the
phone models the chat then rejects.

Everything here fails soft. A binary that cannot be found, a catalog that moved
or changed shape, a row missing a field — all of it returns None, and the
hand-written fallback in claude.py stands in.
"""
from __future__ import annotations

import asyncio
import json
import logging
import mmap
import os
import re
import shutil
import sys
from pathlib import Path

log = logging.getLogger("rac.claude.models")

# The catalog's own leading comment. Distinctive enough to find the object by,
# and it sits inside the first key, so the object starts just before it.
_MARKER = b"Hand-maintained baked-in model catalog"
_OBJ_START = b'{"//":'
# The object is ~15-30 KB; this window is slack, not a measurement.
_WINDOW = 1 << 20

# Efforts in the order a picker should show them, and the capability flags that
# unlock the two beyond the common three. A model without "effort" at all takes
# no effort setting — Haiku errors when sent one.
_EFFORT_ORDER = ("low", "medium", "high", "xhigh", "max")
_BASE_EFFORTS = ("low", "medium", "high")
_EFFORT_CAPS = {"xhigh": "xhigh_effort", "max": "max_effort"}

_IDENT = re.compile(r"[A-Za-z_$][A-Za-z_$0-9]*")
# Whole numbers, exponent and all: `1e6` read a character at a time would leave
# `e6` looking like an identifier.
_NUM = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")

# (path, size, mtime) → shaped models. Keyed on the file so a CLI updated under
# a running daemon is picked up without a restart.
_cache: tuple[tuple, list[dict]] | None = None


def cli_path() -> str | None:
    """The binary a chat will run: the SDK's bundled CLI first, then PATH.

    Mirrors SubprocessCLITransport._find_cli. Kept separate from tools.find_cli,
    which answers a different question — what is installed on this machine —
    and prefers PATH.
    """
    try:
        import claude_agent_sdk

        name = "claude.exe" if sys.platform == "win32" else "claude"
        bundled = Path(claude_agent_sdk.__file__).parent / "_bundled" / name
        if bundled.is_file():
            return str(bundled)
    except Exception:
        pass
    return shutil.which("claude")


def _object_source(path: str) -> str | None:
    """The catalog's object literal, as it appears in the binary."""
    with open(path, "rb") as fh:
        mm = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            at = mm.find(_MARKER)
            if at < 0:
                return None
            start = mm.rfind(_OBJ_START, 0, at)
            if start < 0:
                return None
            chunk = mm[start:start + _WINDOW].decode("utf-8", "replace")
        finally:
            mm.close()
    end = _close_brace(chunk)
    return chunk[:end] if end else None


def _close_brace(s: str) -> int | None:
    """Index just past the `}` that closes the object `s` opens with."""
    depth = 0
    in_str = esc = False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def _to_json(src: str) -> str:
    """The minifier's JS object literal as JSON.

    Two liberties a bundler takes that JSON does not: bare identifier keys, and
    `!0` / `!1` for the booleans. Strings are copied through untouched, so a
    brace or colon inside one cannot be mistaken for structure. Anything else
    unexpected raises rather than guessing — a wrong parse would hand the phone
    a plausible, wrong model list.
    """
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == '"':
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            continue
        if ch == "!" and src[i + 1:i + 2] in ("0", "1"):
            out.append("true" if src[i + 1] == "0" else "false")
            i += 2
            continue
        if ch.isdigit() or (ch == "-" and src[i + 1:i + 2].isdigit()):
            m = _NUM.match(src, i)
            if not m:
                raise ValueError(f"unreadable number at {i}")
            out.append(m.group(0))
            i = m.end()
            continue
        m = _IDENT.match(src, i)
        if m:
            word = m.group(0)
            i = m.end()
            if word in ("true", "false", "null"):
                out.append(word)
                continue
            j = i
            while j < n and src[j] in " \t\r\n":
                j += 1
            if src[j:j + 1] != ":":
                raise ValueError(f"bare identifier {word!r} where a value belongs")
            out.append(json.dumps(word))
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _window(n: int) -> str:
    return f"{n // 1_000_000}M" if n >= 1_000_000 else f"{n // 1000}K"


def _hint(row: dict, tiers: dict, is_best: bool, has_efforts: bool) -> str:
    """What a person needs in order to choose — how much it holds, what it
    costs, and the one control it does not have."""
    bits: list[str] = []
    if is_best:
        bits.append("most capable")
    win = (row.get("context") or {}).get("window")
    if isinstance(win, (int, float)) and win:
        bits.append(f"{_window(int(win))} context")
    price = tiers.get(row.get("pricing")) or {}
    inp, outp = price.get("input"), price.get("output")
    if inp and outp:
        bits.append(f"${inp:g}/${outp:g} per 1M")
    if not has_efforts:
        bits.append("no effort setting")
    return " · ".join(bits)


def _shape(cat: dict) -> list[dict] | None:
    """Catalog → the picker rows, one per alias the CLI resolves.

    The aliases are the choice worth offering: they are the families this CLI
    still points somewhere, and each one follows its family forward on its own
    as the CLI updates. Dated ids in the catalog's long tail are not offered.
    """
    tiers = cat.get("pricing_tiers") or {}
    rows = {m["id"]: m for m in cat.get("models") or [] if m.get("id")}
    best = cat.get("best")
    out: list[dict] = []
    for alias, spec in (cat.get("aliases") or {}).items():
        model_id = (spec or {}).get("default")
        row = rows.get(model_id)
        if not row:
            continue
        caps = row.get("capabilities") or []
        efforts: list[str] = []
        if "effort" in caps:
            efforts = [e for e in _EFFORT_ORDER
                       if e in _BASE_EFFORTS or _EFFORT_CAPS[e] in caps]
        model = {
            "id": alias,
            "label": row.get("display_name") or model_id,
            "model_id": model_id,
            "hint": _hint(row, tiers, alias == best, bool(efforts)),
            "efforts": efforts,
        }
        if row.get("default_effort") in efforts:
            model["default_effort"] = row["default_effort"]
        # advisor_rank runs weakest-first in the catalog, which is the reverse of
        # how a picker reads; the fallback keeps an unranked model last.
        out.append((row.get("advisor_rank") or 0, model))
    out.sort(key=lambda pair: -pair[0])
    return [m for _, m in out] or None


def models() -> list[dict] | None:
    """The live model list, or None if the catalog could not be read."""
    global _cache
    path = cli_path()
    if not path:
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_size, st.st_mtime_ns)
    if _cache and _cache[0] == key:
        return _cache[1]
    try:
        src = _object_source(path)
        if not src:
            log.warning("no model catalog found in %s", path)
            return None
        shaped = _shape(json.loads(_to_json(src)))
    except Exception as exc:
        log.warning("model catalog in %s unreadable: %s", path, exc)
        return None
    if shaped:
        _cache = (key, shaped)
    return shaped


def cached() -> list[dict] | None:
    """What models() last read, without going near the disk. For the callers on
    a turn's path, which must not stop to scan a 200 MB binary."""
    return _cache[1] if _cache else None


def resolved(alias: str) -> str | None:
    """The model id a picker alias means, from the cached catalog only."""
    for m in cached() or ():
        if m["id"] == alias:
            return m["model_id"]
    return None


async def live_models(timeout: float = 12) -> list[dict] | None:
    """models() off the event loop — it reads a 200 MB file the first time."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(models), timeout=timeout)
    except Exception as exc:
        log.warning("claude model list failed: %s", exc)
        return None
