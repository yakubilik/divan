#!/usr/bin/env python3
"""A phrase of dictation is the words somebody said, or nothing.

    python scripts/test_dictation.py

No model is loaded: whisper is stood in for, and what is checked is what the
daemon does around it — the language the panel named reaches it, a language it
has never heard of costs a detection rather than the phrase, and the sentence
it invents for silence is not written into anybody's message.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import transcribe as tr                      # noqa: E402

fails: list[str] = []


def check(name: str, got, want) -> None:
    if got != want:
        fails.append(f"{name}: {got!r} != {want!r}")


second = b"\x01\x00" * tr.SAMPLE_RATE
asked: list = []


def whisper(answer: str):
    def run(audio, prompt, language):
        asked.append(language)
        if language == "xx":
            raise ValueError("unsupported language")
        return {"text": answer, "language": language or "tr"}
    return run


tr._backend = lambda: "mlx"

tr._mlx = whisper("Yeni bir branch aç.")
check("the language reaches whisper", (tr.pcm(second, None, "tr") or {}).get("text"), "Yeni bir branch aç.")
check("…as the one it was told", asked, ["tr"])

asked.clear()
check("an unknown language is detected instead", (tr.pcm(second, None, "xx") or {}).get("text"),
      "Yeni bir branch aç.")
check("…on a second pass", asked, ["xx", None])

tr._mlx = whisper("Altyazı M.K.")
check("what whisper says to silence is nothing", tr.pcm(second, None, "tr"), None)
tr._mlx = whisper("Altyazı metnini düzelt.")
check("a sentence that only starts like it is kept",
      (tr.pcm(second, None, "tr") or {}).get("text"), "Altyazı metnini düzelt.")

if fails:
    print(f"FAIL ({len(fails)})")
    for f in fails:
        print(" ", f)
    sys.exit(1)
print("ok — dictation")
