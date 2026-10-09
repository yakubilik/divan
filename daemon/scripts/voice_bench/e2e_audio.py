#!/usr/bin/env python3
"""Was every word of each answer heard? Read the end-to-end run's audio back.

    PY=~/projects/remote-ai-chat/daemon/.venv312/bin/python
    $PY daemon/scripts/voice_bench/e2e_audio.py --run docs/voice-bench/e2e.json [--out docs/voice-bench/e2e-audio.json]

`app/scripts/voice-e2e.cjs` writes each answer as the caller would have heard it
(every piece the player played, at the moment it started, EMA's own audio).
Here each one is transcribed by whisper-large-v3-turbo (the daemon's
`transcribe.pcm`, Turkish, no vocabulary prompt) and compared with the text the
daemon sent: pooled WER, and whether the first and the last word of the answer
are in what was heard — a clipped start or a cut tail shows up there. Long
silences inside the answer and loud edges are measured from the samples. A low
WER says the words are recoverable; how natural the voice sounds is for a
listener, and the WAVs stay where the run put them for that.
"""
from __future__ import annotations

import argparse
import array
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


def near(word: str, heard: list[str]) -> bool:
    """A word is there if whisper wrote it, or the same stem (Turkish suffixes vary)."""
    stem = word[:max(3, len(word) - 3)]
    return any(h == word or h.startswith(stem) or word.startswith(h[:max(3, len(h) - 3)]) for h in heard)


def silences(samples: array.array, floor_db: float = -50.0, frame_ms: int = 20) -> list[int]:
    """Quiet stretches inside the answer (not at its ends), in ms; 16 kHz audio."""
    levels = bench.frame_db(samples, frame_ms)
    loud = [i for i, d in enumerate(levels) if d > floor_db]
    if not loud:
        return []
    out, run = [], 0
    for d in levels[loud[0]:loud[-1] + 1]:
        if d <= floor_db:
            run += 1
        else:
            if run:
                out.append(run * frame_ms)
            run = 0
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=str(ROOT / "docs" / "voice-bench" / "e2e.json"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "voice-bench" / "e2e-audio.json"))
    a = ap.parse_args()
    from remote_ai_chat import transcribe
    run = json.loads(Path(a.run).read_text())
    rows = [r for r in run["conversation"]["rows"] if r.get("audio") and Path(r["audio"]["wav"]).exists()]
    out = []
    with tempfile.TemporaryDirectory() as t:
        for r in rows:
            wav = Path(t) / "x.wav"
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{bench.RATE}", "-c", "1", r["audio"]["wav"], str(wav)],
                           check=True, capture_output=True)
            pcm = bench.read_wav(wav)
            heard = (transcribe.pcm(pcm.tobytes(), None, "tr") or {}).get("text", "")
            said_w, heard_w = bench.normalize_tr(r["said"]), bench.normalize_tr(heard)
            gaps = silences(pcm)
            row = {"id": r["id"], "round": r["round"], "said": r["said"], "heard": heard,
                   "wer": bench.wer(r["said"], heard),
                   "first_word": bool(said_w) and near(said_w[0], heard_w[:3]),
                   "last_word": bool(said_w) and near(said_w[-1], heard_w[-3:]),
                   "longest_inner_silence_ms": max(gaps) if gaps else 0,
                   "duration_s": round(len(pcm) / bench.RATE, 2), "wav": r["audio"]["wav"]}
            out.append(row)
            print(f"{r['id']:<17} r{r['round']} WER {row['wer']:.2f} first {row['first_word']} last {row['last_word']} "
                  f"gap {row['longest_inner_silence_ms']} ms  {r['said'][:40]!r} -> {heard[:40]!r}")
    summary = {
        "answers": len(out), "pooled_wer": bench.pooled_wer([(x["said"], x["heard"]) for x in out]),
        "first_word_heard": sum(x["first_word"] for x in out), "last_word_heard": sum(x["last_word"] for x in out),
        "inner_silences_over_700ms": [x["longest_inner_silence_ms"] for x in out if x["longest_inner_silence_ms"] > 700],
        "model": transcribe.MODEL,
    }
    Path(a.out).write_text(json.dumps({"summary": summary, "rows": out}, ensure_ascii=False, indent=1))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
