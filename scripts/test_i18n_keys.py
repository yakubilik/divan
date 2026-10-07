#!/usr/bin/env python3
"""Every string the app asks for is in the app's one string table.

    python scripts/test_i18n_keys.py

`app/src/i18n.ts` holds the whole of the app's English text, and `t(key)` — as
`T(...)` at almost every call site, via the `useT()` hook — returns `en[key] ??
key`. That fallback is the problem this script exists for: rename or delete a
key and nothing breaks, nothing is typechecked at runtime, and the screen shows
the key name to a user. `npx tsc --noEmit` would catch it, but it needs
`app/node_modules`, and `npm ci` in `app/` does not currently install (the
lockfile is out of sync with `package.json`; see `docs/audit/`). This check
needs nothing but git and a Python interpreter, which is why it can run in CI.

Three ways a key is referenced, all of them checked:

  * `T('key')` / `t('key')` in a `.ts`/`.tsx` file under `app/`
  * a value in the `ERR_KEYS` table — a daemon error code mapped to a key
  * a key built from a literal prefix and a variable (`limits.tsx` does this),
    which is reported as a reference this script cannot resolve rather than
    passed over in silence

It is not a check that every key is *used*: an unused key is a dead string, not
a broken screen, and the table is written in one place on purpose.

`web/src/lib/i18n.ts` is the panel's equivalent and is deliberately not read
here: CI typechecks the panel (`npm run build` is `tsc --noEmit && vite build`),
so its `Key` type already refuses a name that is not in the table.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / "app" / "src" / "i18n.ts"

# `T('key'` or `t('key'`, single or double quoted. The word boundary in front
# keeps `format(` and `useT(` out.
CALL = re.compile(r"(?<![A-Za-z0-9_$])[tT]\(\s*(['\"])([A-Za-z0-9_]+)\1")
# `T(cond ? 'a' : 'b')`, which is how the two-step screens pick their text.
TERNARY = re.compile(r"(?<![A-Za-z0-9_$])[tT]\(\s*[^()'\"]+\?\s*"
                     r"(['\"])([A-Za-z0-9_]+)\1\s*:\s*(['\"])([A-Za-z0-9_]+)\3\s*[,)]")
# A lookup table of keys, declared `Record<string, Key>`: the screens that pick
# a key by a daemon-supplied id go through one of these rather than through a
# literal at the call site.
KEY_TABLE = re.compile(r"Record<\s*string\s*,\s*Key\s*>\s*=\s*\{(.*?)\n\}", re.S)
# A call whose key this script cannot resolve at all: `T(k)`, `T(NAME[x])`.
NON_LITERAL = re.compile(r"(?<![A-Za-z0-9_$])[tT]\(\s*(?![)'\"])")
# `T(NAME[x])` — resolved above from the table's own declaration, so the call
# site itself needs no reading.
KEY_LOOKUP = re.compile(r"(?<![A-Za-z0-9_$])[tT]\(\s*[A-Z][A-Za-z0-9_]*\[")


def tracked(*globs: str) -> list[Path]:
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files", *globs],
                         capture_output=True, text=True, check=True).stdout
    return [ROOT / line for line in out.splitlines() if line]


def table_keys(text: str) -> set[str]:
    """The keys of `const en = { … };`, which ends at the first line that is `};`."""
    start = text.index("const en = {")
    end = text.index("\n};", start)
    body = text[start:end]
    # `key: '…'` at the start of a declaration. Values can contain colons and
    # commas, so the anchor is "after { or , and whitespace".
    return set(re.findall(r"(?:[{,]|^)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", body, re.M))


def err_keys(text: str) -> set[str]:
    start = text.index("const ERR_KEYS")
    end = text.index("\n};", start)
    return set(re.findall(r":\s*'([A-Za-z0-9_]+)'", text[start:end]))


def main() -> int:
    fails: list[str] = []

    def check(ok: bool, label: str, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f"   {detail}" if not ok else ""))
        if not ok:
            fails.append(label)

    text = I18N.read_text(encoding="utf-8")
    keys = table_keys(text)
    check(len(keys) > 200, f"the table has {len(keys)} keys")
    check("cancel" in keys and "callStart" in keys, "and it parsed as a table of keys",
          f"sample missing from {sorted(keys)[:8]}")

    sources = [p for p in tracked("app/*.ts", "app/*.tsx", "app/**/*.ts", "app/**/*.tsx")
               if p != I18N and "node_modules" not in p.parts]
    check(len(sources) > 20, f"{len(sources)} app sources to read")

    missing: list[str] = []
    seen: set[str] = set()
    unresolved: list[str] = []
    tables = 0
    for path in sources:
        rel = path.relative_to(ROOT)
        body = path.read_text(encoding="utf-8")
        for m in KEY_TABLE.finditer(body):
            tables += 1
            n = body[:m.start()].count("\n") + 1
            for key in re.findall(r":\s*'([A-Za-z0-9_]+)'", m.group(1)):
                seen.add(key)
                if key not in keys:
                    missing.append(f"{rel}:{n}  Record<string, Key> -> '{key}'")
        for n, line in enumerate(body.splitlines(), 1):
            found = [k for _, k in CALL.findall(line)]
            found += [k for m in TERNARY.finditer(line) for k in (m.group(2), m.group(4))]
            for key in found:
                seen.add(key)
                if key not in keys:
                    missing.append(f"{rel}:{n}  T('{key}')")
            if NON_LITERAL.search(line) and not found and not KEY_LOOKUP.search(line):
                unresolved.append(f"{rel}:{n}  {line.strip()[:70]}")

    # settings.tsx, login-method.tsx twice, limits.tsx. ERR_KEYS is the fifth
    # and lives in i18n.ts, which is read separately below.
    check(tables == 4, f"{tables} lookup tables of keys, read as well",
          "`grep -rn 'Record<string, Key>' app` should list five, one of them in i18n.ts")
    check(len(seen) > 300, f"{len(seen)} distinct keys are asked for by name")
    check(not missing, "every one of them is in the table", "\n        " + "\n        ".join(missing))

    errs = err_keys(text)
    check(len(errs) > 20, f"{len(errs)} daemon error codes map to a key")
    gone = sorted(k for k in errs if k not in keys)
    check(not gone, "and every one of those keys is in the table too", repr(gone))

    # Not a failure: a key this script cannot resolve is a key a person has to
    # read. It is printed so that "no missing keys" is not mistaken for "every
    # reference was checked".
    print(f"\n{len(unresolved)} reference(s) built from a variable, not checked here:")
    for u in unresolved:
        print(f"   {u}")

    print(f"\n{'all good' if not fails else str(len(fails)) + ' failed'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
