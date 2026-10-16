"""Every test runs against a throwaway DIVAN_HOME, never the real one.

divan.config fixes CONFIG_DIR and DB_PATH the first time it is imported, so a
test module that sets DIVAN_HOME at its own import is too late whenever an
earlier module (collected first) already imported divan. On 15 Oct 2026 that
put 21 test chats ("ledger · #1 Fix the login") into the live panel. pytest
loads this file before any test module, so the home is set before anything
reads it; a module may still point DIVAN_HOME elsewhere for itself.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ["DIVAN_HOME"] = tempfile.mkdtemp(prefix="divan-pytest-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import config  # noqa: E402

_real = {(Path.home() / config.HOME_NAME).resolve(), (Path.home() / ".remote-ai-chat").resolve()}
if config.CONFIG_DIR.resolve() in _real:
    raise RuntimeError(f"tests would write to the live daemon home {config.CONFIG_DIR}")
