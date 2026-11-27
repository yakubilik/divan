#!/usr/bin/env python3
"""The live-voice bench judges what it reports correctly.

    python scripts/test_voice_bench.py

No model, no audio device and no network: the recogniser's results and the
speech spans are written out by hand, so each check is one judgement the
baseline and the proof rest on — WER, today's 800 ms rule cutting a thinking
pause, the proposed rule waiting through it, and silence staying silence. The
Turkish cases (casing, the joining words, the scenario set the bench speaks)
come from the language pack and are skipped without it.
"""
from __future__ import annotations

import array
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "voice_bench"))

import bench  # noqa: E402
from divan import lang  # noqa: E402

fails: list[str] = []


def check(name: str, got, want) -> None:
    if got != want:
        fails.append(f"{name}: {got!r} != {want!r}")


check("normalize", bench.normalize_tr("Hello, build's done!"), ["hello", "builds", "done"])
check("wer exact", bench.wer("Are the tests done?", "are the tests done"), 0.0)
check("wer one of three", round(bench.wer("tests are done", "tests are"), 3), 0.333)
check("wer no reference", bench.wer("", "anything"), None)
check("pooled weighs by words", bench.pooled_wer([("a b c d", "a b c d"), ("e f", "x f")]), 1 / 6)

# Today's rule: results at 300 and 900 ms, then the caller pauses 1.4 s before
# going on. The timer fires 800 ms after the last result and sends half.
events = [(300, "Give me"), (900, "Give me a summary, I mean,"),
          (2300, "Give me a summary, I mean, today"), (2700, "Give me a summary, I mean, today what happened")]
cut = bench.current_endpointer(events)
check("current sends at 900+800", [t.sent_at for t in cut.turns], [1700])
check("current sends the first half", cut.turns[0].text, "Give me a summary, I mean,")
check("current loses the rest", cut.lost, "today what happened")

whole = bench.current_endpointer([(300, "Tests"), (600, "Tests are done")])
check("current whole question", (whole.turns[0].sent_at, whole.lost), (1400, ""))
check("current silence sends nothing", bench.current_endpointer([]).turns, [])

# The proposed rule over the same shape of speech: the words before the pause
# trail off on a comma, so it waits the longer quiet and the pause is a breath.
spans = [(0, 900), (2300, 2700)]
said = lambda t: "Give me a summary, I mean," if t < 2300 else "Give me a summary, I mean, what happened today"
p = bench.planned_endpointer(spans, said)
check("plan no reply in the pause", (p.soft_ends, p.cancelled), ([2700 + 700], 0))
check("plan commits after the whole", (p.committed_at, p.text), (2700 + 2500, said(2700)))

# A finished-sounding sentence followed by a correction: the reply starts at
# 700 ms of quiet, the caller goes on, the reply is cancelled and nothing is
# committed until the corrected turn is over.
fin = lambda t: "Run the tests." if t < 1900 else "Run the tests. No wait, finish the build first."
c = bench.planned_endpointer([(0, 1000), (1900, 3500)], fin)
check("plan cancels the early reply", (c.soft_ends[0], c.cancelled), (1700, 1))
check("plan commits the correction", c.text, fin(3500))
check("plan silence", bench.planned_endpointer([], lambda t: "").soft_ends, [])

check("unfinished on comma", bench.sounds_unfinished("On the payment page,"), True)
check("finished question", bench.sounds_unfinished("Are the tests done?"), False)

# Turkish casing: dotted and dotless I are different letters, and an apostrophe
# suffix is part of the word. A pause after a Turkish joining word is a breath.
TR = lang.load("tr", "tests/daemon/test_voice_bench") if bench.HANGING else {}
if TR:
    check("normalize turkish", bench.normalize_tr(TR["normalize"][0]), TR["normalize"][1])
    check("wer exact turkish", bench.wer(*TR["wer_exact"]), 0.0)
    for text in TR["unfinished"]:
        check(f"unfinished on joining word: {text}", bench.sounds_unfinished(text), True)
    for text in TR["finished"]:
        check(f"finished: {text}", bench.sounds_unfinished(text), False)
else:
    print("skip: no language pack (the Turkish cases)")

# Speech spans: a 300 ms tone at -20 dBFS inside silence is one span where it is.
tone = array.array("h", [0] * 3200 + [3277, -3277] * 2400 + [0] * 3200)
check("spans find the tone", bench.speech_spans(bench.frame_db(tone)), [(200, 500)])

with tempfile.TemporaryDirectory() as d:
    path = Path(d) / "t.wav"
    bench.write_wav(path, tone)
    check("wav round trip", bench.read_wav(path), tone)

# The scenario sets cover what the ticket names, and nothing in them is empty by
# accident. The English set mirrors the Turkish one scenario for scenario.
sets = {"en": bench.scenarios("en"), "tr": bench.scenarios("tr")}
if sets["tr"] is None:
    print("skip: no language pack (the Turkish scenarios)")
for name, cfg in sets.items():
    if cfg is None:
        continue
    sc = cfg["scenarios"]
    kinds = {s["kind"] for s in sc}
    check(f"{name} scenario kinds", kinds >= {"short", "long", "thinking-pause", "correction", "barge-in",
                                              "technical", "silence"}, True)
    pauses = sorted(seg["pause_ms"] for s in sc for seg in s["segments"] if seg["pause_ms"])
    check(f"{name} pauses span 0.5-2 s", (pauses[0], pauses[-1]), (500, 2000))
    check(f"{name} references match segments", all(bool(s["reference"]) == bool(s["segments"]) for s in sc), True)
if sets["tr"] is not None:
    shape = lambda cfg: [(s["id"], s["kind"], [g["pause_ms"] for g in s["segments"]]) for s in cfg["scenarios"]]
    check("the English set mirrors the Turkish one", shape(sets["en"]), shape(sets["tr"]))

if fails:
    print("\n".join(fails))
    sys.exit(1)
print("voice bench: all checks passed")
