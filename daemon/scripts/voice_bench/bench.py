"""The pure half of the live-voice bench: audio frames, word error rate, and the
two ways a call can decide that the caller has finished.

Nothing here loads a model or touches the network, so `scripts/test_voice_bench.py`
can check every judgement the reports rest on. The runners (`make_fixtures.py`,
`run_baseline.py`, `proof.py`) do the slow, real work and call into this.

Times are milliseconds from the start of the fixture's audio throughout.
"""
from __future__ import annotations

import array
import math
import re
import unicodedata
import wave
from dataclasses import dataclass, field
from pathlib import Path

RATE = 16000
FRAME_MS = 20


# ── audio ────────────────────────────────────────────────────────────────────
def read_wav(path: Path) -> array.array:
    """16 kHz mono signed 16-bit, which is all the fixtures ever are."""
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"{path}: want 16 kHz mono 16-bit")
        return array.array("h", w.readframes(w.getnframes()))


def write_wav(path: Path, samples: array.array) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def frame_db(samples, frame_ms: int = FRAME_MS) -> list[float]:
    """RMS level of each frame in dBFS (-100 for digital silence)."""
    n = RATE * frame_ms // 1000
    out = []
    for i in range(0, len(samples) - n + 1, n):
        chunk = samples[i:i + n]
        ms = sum(s * s for s in chunk) / n
        out.append(10 * math.log10(ms / (32768.0 ** 2)) if ms > 0 else -100.0)
    return out


def speech_spans(levels: list[float], threshold_db: float = -45.0, min_speech_ms: int = 60,
                 bridge_ms: int = 150, frame_ms: int = FRAME_MS) -> list[tuple[int, int]]:
    """Where somebody is talking, by level alone.

    `bridge_ms` joins the gaps inside a word (a stop consonant is a short
    silence); it is far below any pause that matters for turn taking, so it
    never decides a turn by itself."""
    spans: list[list[int]] = []
    for i, db in enumerate(levels):
        if db < threshold_db:
            continue
        t = i * frame_ms
        if spans and t - spans[-1][1] <= bridge_ms:
            spans[-1][1] = t + frame_ms
        else:
            spans.append([t, t + frame_ms])
    return [(a, b) for a, b in spans if b - a >= min_speech_ms]


# ── words ────────────────────────────────────────────────────────────────────
def normalize_tr(text: str) -> list[str]:
    """Words as WER compares them: Turkish lowercase, no punctuation.

    `str.lower()` turns "I" into "i" and "İ" into "i̇" (i + combining dot), both
    wrong for Turkish, so the two capitals are mapped first. Apostrophes are
    dropped rather than split on: "build'ini" is one word to a listener."""
    text = text.replace("I", "ı").replace("İ", "i").lower()
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[’'`]", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return text.split()


def edit_distance(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float | None:
    """Word error rate; None when there is no reference to be wrong about."""
    ref, hyp = normalize_tr(reference), normalize_tr(hypothesis)
    if not ref:
        return None
    return edit_distance(ref, hyp) / len(ref)


def pooled_wer(pairs: list[tuple[str, str]]) -> float | None:
    """Errors over words across a set, so a two-word line does not weigh as much as a long one."""
    errs = words = 0
    for ref, hyp in pairs:
        r = normalize_tr(ref)
        if r:
            errs += edit_distance(r, normalize_tr(hyp))
            words += len(r)
    return errs / words if words else None


# ── turn ending ──────────────────────────────────────────────────────────────
@dataclass
class Turn:
    """One question the call put on the wire."""
    sent_at: int
    text: str


@dataclass
class Outcome:
    turns: list[Turn] = field(default_factory=list)
    # Words the recogniser produced after the microphone was closed for a send:
    # in the app these are never heard by anybody.
    lost: str = ""


def current_endpointer(events: list[tuple[int, str]], silence_ms: int = 800,
                       listen_at: int = 0) -> Outcome:
    """The rule `app/app/call.tsx` runs today.

    `events` are the recogniser's results: (arrival time, the whole transcript so
    far), because continuous recognition hands back one growing string. Every
    result re-arms an 800 ms timer; when it fires with words in hand, the words
    are sent and the microphone is stopped. What the recogniser says after that
    is gone: the call is 'thinking' and listens again only after the answer has
    been read out. An empty transcript re-arms instead of sending."""
    out = Outcome()
    deadline = listen_at + silence_ms
    said = ""
    for t, text in sorted(events):
        if said.strip() and t >= deadline:
            out.turns.append(Turn(deadline, said.strip()))
            break
        said = text
        deadline = t + silence_ms
    else:
        if said.strip():
            out.turns.append(Turn(deadline, said.strip()))
        return out
    # The recogniser revises earlier words as it goes, so the words sent are not
    # always a prefix of the last transcript; what was lost is what came after
    # as many words as were sent.
    sent = normalize_tr(out.turns[-1].text)
    final = normalize_tr(sorted(events)[-1][1])
    out.lost = " ".join(final[len(sent):])
    return out


# Words a Turkish speaker trails off on when they have not finished. A pause
# after one of these is a breath in the middle of a sentence, not a turn end.
HANGING = {
    "ve", "ama", "fakat", "ancak", "yani", "şey", "şeyi", "şeyde", "için", "de", "da",
    "ki", "ile", "veya", "ya", "yoksa", "çünkü", "sonra", "önce", "peki", "hani",
    "bir", "bu", "şu", "o", "eee", "ee", "ıı", "mesela", "aslında", "galiba",
}


def sounds_unfinished(text: str) -> bool:
    """A transcript that ends on a joining word, or on a comma, is mid-sentence."""
    stripped = text.rstrip()
    if not stripped:
        return False
    if stripped.endswith((",", ";", ":", "-", "…")):
        return True
    words = normalize_tr(stripped)
    return bool(words) and words[-1] in HANGING


@dataclass
class Plan:
    """The proposed rule: speak early, commit late.

    `reply_ms`: silence after which a reply may be prepared and spoken.
    `unfinished_ms`: the same, when the words so far trail off on a joining word.
    `commit_ms`: silence after which the turn is final, and only then may it
    reach an agent as work. Speech that resumes before that belongs to the same
    turn: the reply in flight is cancelled and the turn grows, so a correction
    inside this window can never start the wrong job."""
    reply_ms: int = 700
    unfinished_ms: int = 1800
    commit_ms: int = 2500


@dataclass
class PlanOutcome:
    soft_ends: list[int] = field(default_factory=list)   # replies started
    cancelled: int = 0                                     # of those, superseded by more speech
    committed_at: int | None = None
    text: str = ""


def planned_endpointer(spans: list[tuple[int, int]], words_at, plan: Plan = Plan()) -> PlanOutcome:
    """Run the proposed rule over speech spans.

    `words_at(t)` is the transcript as known at time t (a recogniser's partial,
    or a fixture's own script), used only for the unfinished-sentence check."""
    out = PlanOutcome()
    if not spans:
        return out
    for i, (_, end) in enumerate(spans):
        nxt = spans[i + 1][0] if i + 1 < len(spans) else None
        gap = (nxt - end) if nxt is not None else None
        wait = plan.unfinished_ms if sounds_unfinished(words_at(end)) else plan.reply_ms
        if gap is not None and gap < wait:
            continue                        # a breath; nothing was started
        out.soft_ends.append(end + wait)
        if gap is not None and gap < max(wait, plan.commit_ms):
            out.cancelled += 1              # they went on talking: same turn
            continue
        out.committed_at = end + max(wait, plan.commit_ms)
        out.text = words_at(end)
        return out
    return out
