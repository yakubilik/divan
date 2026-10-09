#!/usr/bin/env python3
"""The live-voice bench judges what it reports correctly.

    python scripts/test_voice_bench.py

No model, no audio device and no network: the recogniser's results and the
speech spans are written out by hand, so each check is one judgement the
baseline and the proof rest on — Turkish WER, today's 800 ms rule cutting a
thinking pause, the proposed rule waiting through it, and silence staying silence.
"""
from __future__ import annotations

import array
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "voice_bench"))

import bench  # noqa: E402

fails: list[str] = []


def check(name: str, got, want) -> None:
    if got != want:
        fails.append(f"{name}: {got!r} != {want!r}")


# Turkish casing: dotted and dotless I are different letters, and an apostrophe
# suffix is part of the word.
check("normalize", bench.normalize_tr("İstanbul'da IŞIK, build'ini!"), ["istanbulda", "ışık", "buildini"])
check("wer exact", bench.wer("Testler bitti mi?", "testler bitti mi"), 0.0)
check("wer one of three", round(bench.wer("testler bitti mi", "testler bitti"), 3), 0.333)
check("wer no reference", bench.wer("", "anything"), None)
check("pooled weighs by words", bench.pooled_wer([("a b c d", "a b c d"), ("e f", "x f")]), 1 / 6)

# Today's rule: results at 300 and 900 ms, then the caller pauses 1.4 s before
# going on. The timer fires 800 ms after the last result and sends half.
events = [(300, "Bana bir"), (900, "Bana bir özet çıkar yani"),
          (2300, "Bana bir özet çıkar yani bugün"), (2700, "Bana bir özet çıkar yani bugün ne oldu")]
cut = bench.current_endpointer(events)
check("current sends at 900+800", [t.sent_at for t in cut.turns], [1700])
check("current sends the first half", cut.turns[0].text, "Bana bir özet çıkar yani")
check("current loses the rest", cut.lost, "bugün ne oldu")

whole = bench.current_endpointer([(300, "Testler"), (600, "Testler bitti mi")])
check("current whole question", (whole.turns[0].sent_at, whole.lost), (1400, ""))
check("current silence sends nothing", bench.current_endpointer([]).turns, [])

# The proposed rule over the same shape of speech: the words before the pause
# trail off on "yani", so it waits the longer quiet and the pause is a breath.
spans = [(0, 900), (2300, 2700)]
said = lambda t: "Bana bir özet çıkar yani" if t < 2300 else "Bana bir özet çıkar yani bugün ne oldu"
p = bench.planned_endpointer(spans, said)
check("plan no reply in the pause", (p.soft_ends, p.cancelled), ([2700 + 700], 0))
check("plan commits after the whole", (p.committed_at, p.text), (2700 + 2500, said(2700)))

# A finished-sounding sentence followed by a correction: the reply starts at
# 700 ms of quiet, the caller goes on, the reply is cancelled and nothing is
# committed until the corrected turn is over.
fin = lambda t: "Testleri çalıştır." if t < 1900 else "Testleri çalıştır. Hayır dur, önce derlemeyi bitir."
c = bench.planned_endpointer([(0, 1000), (1900, 3500)], fin)
check("plan cancels the early reply", (c.soft_ends[0], c.cancelled), (1700, 1))
check("plan commits the correction", c.text, fin(3500))
check("plan silence", bench.planned_endpointer([], lambda t: "").soft_ends, [])

check("unfinished on joining word", bench.sounds_unfinished("bir özet çıkar, yani"), True)
check("unfinished on comma", bench.sounds_unfinished("Ödeme sayfasında,"), True)
check("finished question", bench.sounds_unfinished("Testler bitti mi?"), False)

# Speech spans: a 300 ms tone at -20 dBFS inside silence is one span where it is.
tone = array.array("h", [0] * 3200 + [3277, -3277] * 2400 + [0] * 3200)
check("spans find the tone", bench.speech_spans(bench.frame_db(tone)), [(200, 500)])

with tempfile.TemporaryDirectory() as d:
    path = Path(d) / "t.wav"
    bench.write_wav(path, tone)
    check("wav round trip", bench.read_wav(path), tone)

# The scenario set covers what the ticket names, and nothing in it is empty by accident.
sc = json.loads((Path(__file__).resolve().parent / "voice_bench" / "scenarios.json").read_text())["scenarios"]
kinds = {s["kind"] for s in sc}
check("scenario kinds", kinds >= {"short", "long", "thinking-pause", "correction", "barge-in", "technical", "silence"}, True)
pauses = sorted(seg["pause_ms"] for s in sc for seg in s["segments"] if seg["pause_ms"])
check("pauses span 0.5-2 s", (pauses[0], pauses[-1]), (500, 2000))
check("references match segments", all(bool(s["reference"]) == bool(s["segments"]) for s in sc), True)

if fails:
    print("\n".join(fails))
    sys.exit(1)
print("voice bench: all checks passed")
