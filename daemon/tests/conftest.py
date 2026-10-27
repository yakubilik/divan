"""Every test runs against a throwaway DIVAN_HOME, never the real one.

divan.config fixes CONFIG_DIR and DB_PATH the first time it is imported, so a
test module that sets DIVAN_HOME at its own import is too late whenever an
earlier module (collected first) already imported divan. On 15 Oct 2026 that
put 21 test chats ("ledger · #1 Fix the login") into the live panel. pytest
loads this file before any test module, so the home is set before anything
reads it; a module may still point DIVAN_HOME elsewhere for itself.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

# `python3 -m pytest` is how the queue's check runs this, and the python3 on PATH
# is whatever the Mac has (Homebrew or python.org), never the daemon's venv: on
# 24 Oct 2026 the check died on `No module named 'tomli_w'`. When the daemon's
# own dependencies are missing here, run the same pytest again in the venv the
# daemon runs from. DIVAN_PYTEST_REEXEC guards against looping.
if importlib.util.find_spec("tomli_w") is None and not os.environ.get("DIVAN_PYTEST_REEXEC"):
    _daemon = Path(__file__).resolve().parents[1]
    for _venv in (_daemon / ".venv312", _daemon / ".venv",
                  Path.home() / "projects/divan/daemon/.venv312"):
        _py = _venv / "bin" / "python"
        if _py.is_file() and Path(sys.prefix).resolve() != _venv.resolve():
            os.environ["DIVAN_PYTEST_REEXEC"] = "1"
            # pytest already holds stdout/stderr at the fd level; give them back
            # first, or the second run reports into pytest's capture file.
            import gc
            from _pytest.capture import CaptureManager
            for _cm in [o for o in gc.get_objects() if isinstance(o, CaptureManager)]:
                _cm.stop_global_capturing()
            sys.stdout.flush()
            sys.stderr.flush()
            os.execv(str(_py), [str(_py), "-m", "pytest", *sys.argv[1:]])

os.environ["DIVAN_HOME"] = tempfile.mkdtemp(prefix="divan-pytest-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import config  # noqa: E402

_real = {(Path.home() / config.HOME_NAME).resolve(), (Path.home() / ".remote-ai-chat").resolve()}
if config.CONFIG_DIR.resolve() in _real:
    raise RuntimeError(f"tests would write to the live daemon home {config.CONFIG_DIR}")

# Shared Claude memory lives under ~/.claude/projects; a test that starts a chat
# on an account would otherwise create folders in the real one.
from divan import claude_memory  # noqa: E402

_claude_home = Path(tempfile.mkdtemp(prefix="divan-pytest-claude-"))
claude_memory.default_claude_home = lambda: _claude_home
