#!/usr/bin/env python3
"""Build the live-voice bench's audio from scenarios.json, with the Mac's own voice.

    python3 daemon/scripts/voice_bench/make_fixtures.py [--out DIR]

Every segment is spoken by `say` (Turkish voice Yelda, which every Mac has),
trimmed to where the voice starts and stops, and laid out with the scenario's
pauses exactly as written — so the time each word ends is known, not guessed,
and a pause of 1500 ms is 1500 ms. A quiet noise floor (-62 dBFS) sits under
everything, because a recogniser fed digital silence behaves better than one fed
a room.

Writes DIR/<id>.wav (what the microphone hears) and DIR/manifest.json (where the
speech is). The barge-in scenario also gets DIR/<id>.assistant.wav, the answer
being played, and its microphone track carries that answer's echo at the
scenario's level under the caller's voice. Default DIR is /tmp/divan-voice-bench/fixtures.
Synthetic speech is cleaner than a person on a phone; that limit is in the report.
"""
from __future__ import annotations

import argparse
import array
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench import RATE, frame_db, read_wav, write_wav  # noqa: E402

HERE = Path(__file__).resolve().parent
LEAD_MS = 300        # quiet before the caller starts
TAIL_MS = 3000       # quiet after, so every endpointer gets to decide
NOISE_DBFS = -62.0


def spoken(text: str, voice: str, rate: int, tmp: Path) -> array.array:
    aiff, wav = tmp / "s.aiff", tmp / "s.wav"
    subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(aiff), str(wav)],
                   check=True, capture_output=True)
    s = read_wav(wav)
    levels = frame_db(s, 10)
    loud = [i for i, db in enumerate(levels) if db > -50]
    if not loud:
        return array.array("h")
    a, b = loud[0] * RATE // 100, (loud[-1] + 1) * RATE // 100
    return s[a:b]


def silence(ms: int) -> array.array:
    return array.array("h", bytes(2 * RATE * ms // 1000))


def mix_noise(s: array.array, seed: int) -> array.array:
    rng = random.Random(seed)
    amp = 32768 * 10 ** (NOISE_DBFS / 20) * 1.7          # uniform noise RMS ~ amp/1.7
    return array.array("h", (max(-32768, min(32767, int(v + rng.uniform(-amp, amp)))) for v in s))


def overlay(base: array.array, top: array.array, at: int, gain: float = 1.0) -> None:
    for i, v in enumerate(top):
        j = at + i
        if j >= len(base):
            base.extend(array.array("h", [0] * (j - len(base) + 1)))
        base[j] = max(-32768, min(32767, int(base[j] + v * gain)))


def build(sc: dict, voice: str, rate: int, out: Path, tmp: Path, seed: int) -> dict:
    ms = lambda n: n * 1000 // RATE
    track = silence(LEAD_MS)
    spans = []
    for seg in sc["segments"]:
        voice_part = spoken(seg["text"], voice, rate, tmp)
        start = len(track)
        track.extend(voice_part)
        spans.append({"text": seg["text"], "start_ms": ms(start), "end_ms": ms(len(track)),
                      "pause_after_ms": seg["pause_ms"]})
        track.extend(silence(seg["pause_ms"]))
    if sc["kind"] == "silence":
        track.extend(silence(sc["silence_ms"]))
    entry = {"id": sc["id"], "kind": sc["kind"], "reference": sc["reference"], "spans": spans}

    if sc["kind"] == "barge-in":
        # The answer plays from 0; the caller cuts in at user_onset_ms; the mic
        # hears both, the answer as echo that the phone's canceller let through.
        answer = spoken(sc["assistant"], voice, rate, tmp)
        write_wav(out / f"{sc['id']}.assistant.wav", mix_noise(answer, seed + 1))
        onset = RATE * sc["user_onset_ms"] // 1000
        user = array.array("h")
        for seg in sc["segments"]:
            user.extend(spoken(seg["text"], voice, rate, tmp))
        mic = silence(0)
        overlay(mic, answer, 0, 10 ** (sc["echo_db"] / 20))
        overlay(mic, user, onset)
        track = mic
        spans = [{"text": sc["segments"][0]["text"], "start_ms": ms(onset), "end_ms": ms(onset + len(user)),
                  "pause_after_ms": 0}]
        entry.update(spans=spans, assistant_ms=ms(len(answer)), user_onset_ms=sc["user_onset_ms"],
                     echo_db=sc["echo_db"])

    track.extend(silence(TAIL_MS))
    write_wav(out / f"{sc['id']}.wav", mix_noise(track, seed))
    entry["duration_ms"] = ms(len(track))
    entry["speech_end_ms"] = spans[-1]["end_ms"] if spans else None
    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--only", action="append", default=[])
    a = ap.parse_args()
    cfg = json.loads((HERE / "scenarios.json").read_text())
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    with tempfile.TemporaryDirectory() as t:
        for i, sc in enumerate(cfg["scenarios"]):
            if a.only and sc["id"] not in a.only:
                continue
            e = build(sc, cfg["voice"], cfg["rate_wpm"], out, Path(t), seed=1000 + i)
            entries.append(e)
            print(f"{e['id']:<18} {e['duration_ms']:>6} ms  speech ends {e['speech_end_ms']}")
    (out / "manifest.json").write_text(json.dumps({"voice": cfg["voice"], "fixtures": entries},
                                                  ensure_ascii=False, indent=1))
    print(f"wrote {len(entries)} fixtures to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
