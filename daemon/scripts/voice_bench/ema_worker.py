#!/usr/bin/env python3
"""EMA Lightning as a line-in, line-out process, for the bench.

    tts/.venv/bin/python daemon/scripts/voice_bench/ema_worker.py [--models DIR] [--out DIR]

Reads JSON lines {"id": ..., "text": ...} and answers each with
{"id", "ms": synthesis time of the first piece, "total_ms", "audio_s", "wav"}
once the first piece is made and again when all of it is. It runs the same three
ONNX graphs and host steps the phone runs (`tts/common.py`, the `check.py`
order), on one CPU thread like the phone's budget, so its timings are a desk
proxy for the phone's first-audio delay — not the phone's own number.

It needs `tts/.venv` (ema-lightning's frontend, onnxruntime) and the exported
models (`tts/verify.sh` makes them; they are git-ignored). `--models` points at
a checkout that has them.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

TTS = Path(__file__).resolve().parents[3] / "tts"
sys.path.insert(0, str(TTS))
import common  # noqa: E402
from ema_lightning.chunker import chunk  # noqa: E402
from ema_lightning.frontend import Frontend  # noqa: E402


def sessions(models: Path):
    o = ort.SessionOptions()
    o.intra_op_num_threads = 1
    o.inter_op_num_threads = 1
    return {s: ort.InferenceSession(str(models / f"{s}.onnx"), o, providers=["CPUExecutionProvider"])
            for s in ("text", "sound", "decoder")}


def piece_audio(run, stoi, spoken: str, seed: int) -> np.ndarray:
    ids = np.array([stoi.get(ch, 1) for ch in spoken], np.int64)
    cw, wstart = common.words(spoken)
    h, dur = run["text"].run(None, {"ids": ids[None]})
    _, fw, fp = common.plan(dur[0], cw)
    noise = common.noise(seed, fw.size)
    (lat,) = run["sound"].run(None, {"h": h, "dur": dur, "cw": cw[None], "wstart": wstart[None],
                                     "fw": fw[None], "fp": fp[None], "noise": noise[None]})
    return common.decode(lambda z: run["decoder"].run(None, {"z": z})[0], lat[0])


def save(path: Path, audio: np.ndarray) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(common.RATE)
        w.writeframes(pcm.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=str(Path.home() / "projects" / "remote-ai-chat" / "tts" / "models"))
    ap.add_argument("--out", default="/tmp/divan-voice-bench/ema")
    a = ap.parse_args()
    vocab = json.loads(common.VECTORS.read_text())["vocab"]
    stoi = {ch: i for i, ch in enumerate(vocab)}
    frontend = Frontend(vocab)
    run = sessions(Path(a.models))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    piece_audio(run, stoi, "tamam", 0)                     # first runs allocate; keep them out of the timing
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        req = json.loads(line)
        t0 = time.perf_counter()
        parts, first_ms = [], None
        for i, (spoken, *_rest) in enumerate(chunk(frontend(req["text"]), 1.0)):
            parts.append(piece_audio(run, stoi, spoken, 7 + i))
            if first_ms is None:
                first_ms = int((time.perf_counter() - t0) * 1000)
                print(json.dumps({"id": req.get("id"), "first": True, "ms": first_ms,
                                  "first_audio_s": round(parts[0].size / common.RATE, 2)}), flush=True)
        if first_ms is None:                                # nothing speakable: answer anyway
            first_ms = int((time.perf_counter() - t0) * 1000)
            print(json.dumps({"id": req.get("id"), "first": True, "ms": first_ms, "first_audio_s": 0}), flush=True)
        audio = np.concatenate(parts) if parts else np.zeros(1, np.float32)
        wav = out / f"{req.get('id', 'x')}.wav"
        save(wav, audio)
        print(json.dumps({"id": req.get("id"), "ms": first_ms, "total_ms": int((time.perf_counter() - t0) * 1000),
                          "audio_s": round(audio.size / common.RATE, 2), "wav": str(wav)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
