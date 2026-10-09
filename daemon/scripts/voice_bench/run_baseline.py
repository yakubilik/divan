#!/usr/bin/env python3
"""Replay the bench fixtures through today's turn-taking and two recognisers.

    PY=~/projects/divan/daemon/.venv312/bin/python    # any venv with mlx-whisper + numpy
    $PY daemon/scripts/voice_bench/run_baseline.py [--fixtures DIR] [--out FILE] [--only ID]

Needs the fixtures (`make_fixtures.py`) and the Swift helper built once:
    swiftc -O daemon/scripts/voice_bench/apple_stt.swift -o /tmp/divan-voice-bench/apple_stt

For each fixture:
  * Apple on-device Turkish dictation, fed at real-time speed. Its results go
    through `current_endpointer` — the 800 ms rule `app/app/call.tsx` runs — and
    through the proposed rule, so both are judged on the same recogniser output.
  * whisper-large-v3-turbo through the daemon's own `transcribe.pcm` (the code
    voice notes and dictation already use), once per utterance, timed.

Nothing leaves the Mac: both recognisers run on it. Writes a JSON report
(default docs/voice-bench/baseline.json) with every result event, the
sends, the transcripts and the timings; prints the summary the doc quotes.
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "daemon"))
import bench  # noqa: E402

APPLE = Path("/tmp/divan-voice-bench/apple_stt")
# The words the app already hands the phone's recogniser as contextual strings,
# given to whisper as its lead-in the way dictation gives it the chat's topic.
VOCAB = "Claude, Codex, daemon, commit, build, deploy, branch, merge, TestFlight, Xcode, Expo, ticket."


def apple(wav: Path) -> list[dict]:
    out = subprocess.run([str(APPLE), str(wav)], capture_output=True, text=True, timeout=180)
    return [json.loads(line) for line in out.stdout.splitlines() if line.startswith("{")]


def whisper(wav: Path, start_ms: int, end_ms: int, prompt: str | None) -> dict:
    from divan import transcribe
    s = bench.read_wav(wav)
    a = max(0, (start_ms - 200) * bench.RATE // 1000)
    b = min(len(s), (end_ms + 300) * bench.RATE // 1000)
    t0 = time.perf_counter()
    r = transcribe.pcm(s[a:b].tobytes(), prompt, "tr")
    return {"text": (r or {}).get("text", ""), "compute_ms": int((time.perf_counter() - t0) * 1000),
            "audio_ms": (b - a) * 1000 // bench.RATE}


def judge(fx: dict, events: list[dict]) -> dict:
    """Both endpointers over one recogniser run."""
    res = [(e["t_ms"], e["text"]) for e in events if "t_ms" in e]
    end = fx["speech_end_ms"]
    cur = bench.current_endpointer(res)
    sent = cur.turns[0] if cur.turns else None
    final = next((e["text"] for e in reversed(events) if e.get("final")), res[-1][1] if res else "")
    partial_lags = []
    for sp in fx["spans"]:
        after = [t for t, _ in res if t >= sp["end_ms"]]
        if after:
            partial_lags.append(after[0] - sp["end_ms"])

    levels = bench.frame_db(bench.read_wav(Path(fx["_wav"])))
    spans = bench.speech_spans(levels)
    words_at = lambda t: next((x for tt, x in reversed(res) if tt <= t + 300), "")
    plan = bench.planned_endpointer(spans, words_at)
    want_turns = 0 if fx["kind"] == "silence" else 1
    return {
        "final_text": final,
        "final_wer": bench.wer(fx["reference"], final),
        "current": {
            "turns": [{"sent_ms": t.sent_at, "text": t.text} for t in cur.turns],
            # Only a send before the speech ended loses words; after it, a longer
            # final transcript is the recogniser revising, not the caller unheard.
            "lost": cur.lost if (sent and end and sent.sent_at < end) else "",
            "sent_wer": bench.wer(fx["reference"], sent.text) if sent else None,
            "speech_end_to_send_ms": (sent.sent_at - end) if (sent and end) else None,
            "cut_early": bool(sent and end and sent.sent_at < end),
            "segmentation_ok": (len(cur.turns) == want_turns) and not (sent and end and sent.sent_at < end),
        },
        "planned": {
            "vad_spans": spans,
            "soft_ends_ms": plan.soft_ends, "cancelled": plan.cancelled,
            "committed_ms": plan.committed_at,
            "first_reply_after_end_ms": (plan.soft_ends[-1] - end) if (plan.soft_ends and end) else None,
            "segmentation_ok": (want_turns == 0 and not plan.soft_ends) or
                               (want_turns == 1 and plan.committed_at is not None and
                                plan.committed_at >= (end or 0)),
        },
        "partial_lag_ms": partial_lags,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default="/tmp/divan-voice-bench/fixtures")
    ap.add_argument("--out", default=str(ROOT / "docs" / "voice-bench" / "baseline.json"))
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--no-whisper", action="store_true")
    ap.add_argument("--rejudge", metavar="JSON",
                    help="recompute the judgements of an earlier run from its recorded events, no audio")
    ap.add_argument("--whisper-only", action="store_true",
                    help="skip Apple and the endpointers; compare whisper models via DIVAN_WHISPER_MODEL")
    a = ap.parse_args()
    fdir = Path(a.fixtures)
    manifest = json.loads((fdir / "manifest.json").read_text())
    if a.rejudge:
        old = json.loads(Path(a.rejudge).read_text())
        fx = {f["id"]: f for f in manifest["fixtures"]}
        for r in old["rows"]:
            f = dict(fx[r["id"]], _wav=str(fdir / f"{r['id']}.wav"))
            r.update(judge(f, r["apple_events"]))
        old["summary"] = summarise(old["rows"])
        Path(a.rejudge).write_text(json.dumps(old, ensure_ascii=False, indent=1))
        print(json.dumps(old["summary"], indent=1))
        return 0
    if not APPLE.exists() and not a.whisper_only:
        sys.exit(f"build the Swift helper first: swiftc -O {HERE / 'apple_stt.swift'} -o {APPLE}")

    if not a.no_whisper:
        from divan import transcribe
        transcribe.pcm(bench.read_wav(fdir / "short-status.wav").tobytes(), None, "tr")   # load once, untimed

    rows = []
    for fx in manifest["fixtures"]:
        if a.only and fx["id"] not in a.only:
            continue
        wav = fdir / f"{fx['id']}.wav"
        fx["_wav"] = str(wav)
        row = {"id": fx["id"], "kind": fx["kind"], "reference": fx["reference"],
               "spans": fx["spans"], "speech_end_ms": fx["speech_end_ms"]}
        if a.whisper_only:
            if not fx["spans"]:
                continue
            s0, s1 = fx["spans"][0]["start_ms"], fx["spans"][-1]["end_ms"]
            w = whisper(wav, s0, s1, VOCAB)
            w["wer"] = bench.wer(fx["reference"], w["text"])
            rows.append({**row, "whisper_vocab": w})
            print(f"{fx['id']:<17} WER {fmt(w['wer'])} {w['compute_ms']}ms  {w['text']}")
            continue
        events = apple(wav)
        row["apple_events"] = events
        row.update(judge(fx, events))
        if not a.no_whisper and fx["spans"]:
            s0, s1 = fx["spans"][0]["start_ms"], fx["spans"][-1]["end_ms"]
            for key, prompt in (("whisper", None), ("whisper_vocab", VOCAB)):
                w = whisper(wav, s0, s1, prompt)
                w["wer"] = bench.wer(fx["reference"], w["text"])
                row[key] = w
        rows.append(row)
        c = row["current"]
        print(f"{fx['id']:<17} apple WER {fmt(row['final_wer'])}  now: {len(c['turns'])} turn(s)"
              f"{' CUT' if c['cut_early'] else ''}{' lost=' + repr(c['lost']) if c['lost'] else ''}"
              f"  plan ok={row['planned']['segmentation_ok']}"
              + (f"  whisper WER {fmt(row['whisper']['wer'])}/{fmt(row['whisper_vocab']['wer'])}"
                 f" {row['whisper']['compute_ms']}ms" if "whisper" in row else ""))

    if a.whisper_only:
        from divan import transcribe
        wc = [r["whisper_vocab"]["compute_ms"] for r in rows]
        summary = {"model": transcribe.MODEL, "fixtures": len(rows),
                   "whisper_vocab_pooled_wer": bench.pooled_wer(
                       [(r["reference"], r["whisper_vocab"]["text"]) for r in rows]),
                   "whisper_compute_ms_median": statistics.median(wc), "whisper_compute_ms_max": max(wc)}
    else:
        summary = summarise(rows)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "voice": manifest["voice"],
                               "summary": summary, "rows": rows}, ensure_ascii=False, indent=1))
    print(json.dumps(summary, indent=1))
    print(f"wrote {out}")
    return 0


def fmt(x):
    return "  -  " if x is None else f"{x * 100:4.0f}%"


def summarise(rows: list[dict]) -> dict:
    speech = [r for r in rows if r["reference"]]
    pairs = lambda key: [(r["reference"], r[key]["text"]) for r in speech if key in r]
    lags = [x for r in rows for x in r["partial_lag_ms"]]
    sends = [r["current"]["speech_end_to_send_ms"] for r in speech
             if r["current"]["speech_end_to_send_ms"] is not None and not r["current"]["cut_early"]]
    wc = [r["whisper"]["compute_ms"] for r in speech if "whisper" in r]
    return {
        "fixtures": len(rows),
        "apple_pooled_wer": bench.pooled_wer([(r["reference"], r["final_text"]) for r in speech]),
        "whisper_pooled_wer": bench.pooled_wer(pairs("whisper")),
        "whisper_vocab_pooled_wer": bench.pooled_wer(pairs("whisper_vocab")),
        "current_segmentation_ok": sum(r["current"]["segmentation_ok"] for r in rows),
        "current_cut_early": [r["id"] for r in rows if r["current"]["cut_early"]],
        "planned_segmentation_ok": sum(r["planned"]["segmentation_ok"] for r in rows),
        "planned_failures": [r["id"] for r in rows if not r["planned"]["segmentation_ok"]],
        "apple_partial_lag_ms_median": statistics.median(lags) if lags else None,
        "current_end_to_send_ms_median": statistics.median(sends) if sends else None,
        "whisper_compute_ms_median": statistics.median(wc) if wc else None,
        "whisper_compute_ms_max": max(wc) if wc else None,
    }


if __name__ == "__main__":
    sys.exit(main())
