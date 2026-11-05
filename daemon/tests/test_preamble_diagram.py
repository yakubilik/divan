"""The session preamble tells agents that a ```mermaid block is drawn as a
diagram in the phone app (#645), next to how to show a file.

    .venv/bin/python -m pytest -q tests/test_preamble_diagram.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import preamble  # noqa: E402
from divan.config import Config  # noqa: E402
from divan.providers.base import ProviderConfig  # noqa: E402

SENTENCE = (
    "A ```mermaid block (flowchart, sequence, pie, xychart-beta) is drawn as a "
    "diagram in the app; for a simple chart or diagram prefer it over rendering a PNG."
)


def _built(tool: str) -> str:
    pc = ProviderConfig(model="opus", effort=None, perm_mode="ask", cwd=tempfile.mkdtemp(), session_id=None)
    return preamble.build(Config(), pc, tool)


def test_the_built_preamble_says_mermaid_blocks_are_drawn():
    for tool in ("claude", "codex"):
        text = _built(tool)
        assert SENTENCE in text, tool
        # One sentence, said once, right after how to show a file.
        assert text.count("```mermaid") == 1
        assert text.index("To show the person a file") < text.index(SENTENCE) < text.index("If you are asked how")
