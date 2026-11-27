"""Turkish test data, read from the language pack (divan/lang.py).

The repository holds English only; a test that needs Turkish words reads them
from `<lang dir>/tr/tests/daemon/<name>.json` and skips that part, saying
`skip: no language pack`, on a machine without the pack (CI has none).
"""
from __future__ import annotations

import pytest

from divan import lang


def tr_data(name: str) -> dict:
    data = lang.load("tr", f"tests/daemon/{name}")
    if not data:
        print("skip: no language pack")
        pytest.skip("no language pack")
    return data
