#!/usr/bin/env python3
"""The app's string table, and the tunnel's words in both languages.

    python scripts/test_i18n_keys.py

The app's check is the repository's own `scripts/test_i18n_keys.py`, run from
here so the daemon's checks can name it. What this adds is the tunnel's: every
refusal `_admit` can send has words in the panel in English and Turkish, and
the push that says an address was locked says, in both, how to lift it.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

DAEMON = Path(__file__).resolve().parents[1]
ROOT = DAEMON.parent
sys.path.insert(0, str(DAEMON))

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def panel_kinds(lang: str) -> set[str]:
    """The refusal kinds the panel has words for in one language."""
    src = (ROOT / "web" / "src" / "lib" / "refusal.ts").read_text()
    block = re.search(rf"^  {lang}: \{{\n(.*?)^  \}},", src, re.S | re.M)
    return set(re.findall(r"^    (\w+): \{", block.group(1), re.M)) if block else set()


def main() -> None:
    print("1. the app's string table")
    app = subprocess.run([sys.executable, str(ROOT / "scripts" / "test_i18n_keys.py")],
                         capture_output=True, text=True)
    check(app.returncode == 0, "scripts/test_i18n_keys.py passes", app.stdout[-400:] + app.stderr[-400:])

    print("\n2. the panel's refusals")
    server = (DAEMON / "divan" / "server.py").read_text()
    sent = set(re.findall(r'"(\w+)"', server)) & {
        "not_tunnel_device", "tunnel_only", "revoked", "no_token", "unknown_token"}
    sent |= {"locked"} if 'f"locked:' in server else set()
    en, tr = panel_kinds("en"), panel_kinds("tr")
    check(len(sent) == 6, "the daemon sends six reasons", repr(sorted(sent)))
    check(sent <= en and sent <= tr, "each has English and Turkish words", repr((sent - en, sent - tr)))
    check(en == tr, "and the two tables name the same kinds", repr(en ^ tr))

    print("\n3. the lock's push")
    from divan.server import TUNNEL_PUSH_TEXT
    langs = sorted(TUNNEL_PUSH_TEXT)
    check({"en", "tr"} <= set(langs), "English and Turkish", repr(langs))
    check(all(TUNNEL_PUSH_TEXT[lang].keys() == TUNNEL_PUSH_TEXT["en"].keys() for lang in langs),
          "every language has every message")
    holes = {lang: {k: set(re.findall(r"\{(\w+)\}", v)) for k, v in TUNNEL_PUSH_TEXT[lang].items()}
             for lang in langs}
    check(all(holes[lang] == holes["en"] for lang in langs), "with the same placeholders", repr(holes))
    check(all("divan unlock {addr}" in TUNNEL_PUSH_TEXT[lang]["locked"] for lang in langs),
          "the lock says how to lift it, in each")

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
