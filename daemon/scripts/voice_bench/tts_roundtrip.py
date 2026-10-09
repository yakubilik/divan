#!/usr/bin/env python3
"""Is the synthesised Turkish intelligible? Read EMA's output back with whisper.

    PY=~/projects/remote-ai-chat/daemon/.venv312/bin/python
    $PY daemon/scripts/voice_bench/tts_roundtrip.py [--proof docs/voice-bench/proof.json]

Every first piece `proof.py` had EMA say is transcribed by whisper-large-v3-turbo
(the daemon's `transcribe.pcm`, language forced to Turkish) and scored against
the text it was given. A low WER says the words are recoverable from the audio;
it says nothing about how natural the voice sounds, which only a listener can
judge — the WAVs stay in /tmp/divan-voice-bench/ema for that.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "daemon"))
import bench  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proof", default=str(ROOT / "docs" / "voice-bench" / "proof.json"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "voice-bench" / "tts-roundtrip.json"))
    a = ap.parse_args()
    from remote_ai_chat import transcribe
    rows = [r for r in json.loads(Path(a.proof).read_text())["rows"]
            if r.get("first_piece") and r.get("tts_wav") and Path(r["tts_wav"]).exists()]
    out = []
    with tempfile.TemporaryDirectory() as t:
        for r in rows:
            wav = Path(t) / "x.wav"
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{bench.RATE}", "-c", "1", r["tts_wav"], str(wav)],
                           check=True, capture_output=True)
            heard = (transcribe.pcm(bench.read_wav(wav).tobytes(), None, "tr") or {}).get("text", "")
            w = bench.wer(r["first_piece"], heard)
            out.append({"id": r["id"], "round": r.get("round"), "said": r["first_piece"], "heard": heard, "wer": w})
            print(f"{r['id']:<17} WER {w:.2f}  {r['first_piece'][:50]!r} -> {heard[:50]!r}")
    pooled = bench.pooled_wer([(x["said"], x["heard"]) for x in out])
    Path(a.out).write_text(json.dumps({"model": transcribe.MODEL, "pieces": len(out), "pooled_wer": pooled,
                                       "rows": out}, ensure_ascii=False, indent=1))
    print(f"pooled WER {pooled:.3f} over {len(out)} pieces")
    return 0


if __name__ == "__main__":
    sys.exit(main())
