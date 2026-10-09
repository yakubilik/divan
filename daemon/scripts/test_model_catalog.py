#!/usr/bin/env python3
"""The model list is read from the CLI, not typed out.

    python scripts/test_model_catalog.py

What this guards is a list that looks right and is wrong. The catalog lives in
the binary as minified JS, so the risks are a parse that half-succeeds, a shape
change that goes unnoticed, and a read that fails loudly enough to take the
picker down with it. The last check runs against the binary actually installed
here, which is the only place the real shape can be observed.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan.providers import claude_models as cm       # noqa: E402
from divan.providers.claude import ClaudeProvider     # noqa: E402

failures = 0


def check(ok: bool, what: str, detail: str = "") -> None:
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {what}" + (f" — {detail}" if not ok and detail else ""))
    if not ok:
        failures += 1


# A bundler's object literal: bare keys, `!0`/`!1` booleans, exponent numbers,
# and structure characters inside a string that must not be read as structure.
_JS = '{"//":"a note: {not} a brace",schema_version:1,on:!0,off:!1,window:1e6,neg:-0.5}'


def parsing() -> None:
    import json

    print("\nthe bundler's JS reads as JSON")
    got = json.loads(cm._to_json(_JS))
    check(got == {"//": "a note: {not} a brace", "schema_version": 1, "on": True,
                  "off": False, "window": 1e6, "neg": -0.5}, "every liberty it takes", repr(got))

    try:
        cm._to_json("{model:someVariable}")
        check(False, "a value it cannot read raises instead of guessing")
    except ValueError:
        check(True, "a value it cannot read raises instead of guessing")

    print("\nthe object ends where its braces close")
    src = '{"//":"x",a:{b:"}"}}trailing junk'
    check(src[:cm._close_brace(src)] == '{"//":"x",a:{b:"}"}}', "a brace in a string is not a brace")


def shaping() -> None:
    print("\ncatalog → picker rows")
    cat = {
        "pricing_tiers": {"cheap": {"input": 1, "output": 5}},
        "best": "big",
        "aliases": {"big": {"default": "m-big"}, "quick": {"default": "m-quick"},
                    "gone": {"default": "m-retired"}},
        "models": [
            {"id": "m-big", "display_name": "Big 2", "context": {"window": 1000000},
             "pricing": "cheap", "capabilities": ["effort", "max_effort"],
             "default_effort": "high", "advisor_rank": 2},
            {"id": "m-quick", "display_name": "Quick 1", "context": {"window": 200000},
             "pricing": "cheap", "capabilities": [], "advisor_rank": 1},
        ],
    }
    rows = cm._shape(cat)
    check([r["id"] for r in rows] == ["big", "quick"],
          "an alias pointing at a model this CLI dropped is not offered", repr(rows))
    check(rows[0]["label"] == "Big 2" and rows[0]["model_id"] == "m-big",
          "the label is the CLI's display name, the id is the alias")
    check(rows[0]["efforts"] == ["low", "medium", "high", "max"],
          "efforts follow the capability flags", repr(rows[0]["efforts"]))
    check(rows[1]["efforts"] == [] and "default_effort" not in rows[1],
          "a model without the effort capability offers none", repr(rows[1]))
    check(rows[0]["hint"] == "most capable · 1M context · $1/$5 per 1M",
          "the hint is what it holds and what it costs", rows[0]["hint"])
    check("no effort setting" in rows[1]["hint"],
          "and says so when the control is missing", rows[1]["hint"])


def _stub_catalog(label: str) -> bytes:
    """A file shaped like the binary: the catalog somewhere in the middle of it."""
    return (b"binary padding" + (
        '{"//":"Hand-maintained baked-in model catalog","x":1,'
        'pricing_tiers:{t:{input:1,output:2}},'
        'models:[{id:"m",display_name:"%s",context:{window:2e5},pricing:"t",'
        'capabilities:[],advisor_rank:1}],'
        'aliases:{only:{default:"m"}},best:"only"}' % label).encode() + b"more padding")


def refresh() -> None:
    print("\na CLI that changes under a running daemon")
    import tempfile

    cm._cache = None
    with tempfile.NamedTemporaryFile(suffix="-claude", delete=False) as fh:
        fh.write(_stub_catalog("Before 1"))
        stub = fh.name
    real, cm.cli_path = cm.cli_path, lambda: stub
    try:
        first = cm.models()
        check(first and first[0]["label"] == "Before 1", "the list is read", repr(first))
        Path(stub).write_bytes(_stub_catalog("After 2"))
        again = cm.models()
        check(again and again[0]["label"] == "After 2",
              "and read again once the binary is replaced — no restart", repr(again))
    finally:
        cm.cli_path = real
        Path(stub).unlink(missing_ok=True)
        cm._cache = None


def installed() -> None:
    print("\nthe binary installed here")
    path = cm.cli_path()
    if not path:
        print("  skip no claude on this machine")
        return
    rows = cm.models()
    check(bool(rows), "its catalog was read", "no models")
    if not rows:
        return
    check(all(r["id"] and r["label"] and r["model_id"] for r in rows),
          "every row is complete", repr(rows))
    check(any(r["efforts"] for r in rows) and all(isinstance(r["efforts"], list) for r in rows),
          "efforts came through as lists, at least one of them non-empty")
    check(cm.resolved(rows[0]["id"]) == rows[0]["model_id"],
          "an alias resolves to the id the CLI will accept")
    check(ClaudeProvider.catalog()["models"] == rows,
          "and the provider hands the phone that list")


def unreadable() -> None:
    print("\na binary with no catalog in it")
    import tempfile

    cm._cache = None
    with tempfile.NamedTemporaryFile(suffix="-claude", delete=False) as fh:
        fh.write(b"not a CLI")
        stub = fh.name
    real, cm.cli_path = cm.cli_path, lambda: stub
    try:
        check(cm.models() is None, "reads as nothing rather than as something wrong")
        check(ClaudeProvider.catalog()["models"] == ClaudeProvider.FALLBACK_MODELS,
              "so the picker falls back to the written list")
    finally:
        cm.cli_path = real
        Path(stub).unlink(missing_ok=True)
        cm._cache = None


def main() -> None:
    parsing()
    shaping()
    unreadable()
    refresh()
    installed()
    print("\nall checks passed" if not failures else f"\n{failures} FAILED")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
