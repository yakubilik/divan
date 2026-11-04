#!/usr/bin/env python3
"""A product's picture reaches the chat rows filed under it.

    python scripts/test_projectmarks.py
"""
from __future__ import annotations

import base64
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import projectmarks                           # noqa: E402

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
fails: list[str] = []


def check(what, got, want):
    if got != want:
        fails.append(f"{what}\n    got:  {got!r}\n    want: {want!r}")


with tempfile.TemporaryDirectory() as tmp:
    d = Path(tmp)
    (d / "shop.png").write_bytes(PNG)
    (d / "huge.png").write_bytes(PNG + b"\0" * projectmarks.MAX_BYTES)
    rows = [{"id": "p1", "name": "Shop", "slug": "shop"},
            {"id": "p2", "name": "Site", "slug": "site"},
            {"id": "p3", "name": "Huge", "slug": "huge"}]
    got = projectmarks.marks(rows, d)
    check("a product with a picture gets it, as a PNG data URI, with its name",
          got.get("p1"), {"image": "data:image/png;base64," + base64.b64encode(PNG).decode(), "label": "Shop"})
    check("a product without one is left out, and so is a file too big for a row",
          sorted(got), ["p1"])
    (d / "shop.png").write_bytes(PNG + b"x")
    import os; os.utime(d / "shop.png", (1, 1))
    check("a picture replaced on disk is read again",
          projectmarks.marks(rows[:1], d)["p1"]["image"].endswith(base64.b64encode(PNG + b"x").decode()), True)

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — project marks")
