"""The host side of the ONNX pipeline, in numpy only: the parts the phone has to do itself.

Everything here is small and written so that it ports line by line to Swift:

- `noise`: the portable Gaussian noise the four flow steps start from (torch's generator cannot be
  reproduced off torch, so the reference uses this one too).
- `words`: each letter's word and the first letter of that word.
- `plan`: letter durations from text.onnx to the frame timeline sound.onnx takes.
- `windows` / `decode`: the decoder runs window by window with 8 frames of context, as EMA does.
"""
import hashlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
REFERENCE = HERE / "reference"
VECTORS = HERE / "vectors.json"

RATE = 48000
HOP = 1920  # audio samples per latent frame (25 Hz)
LATENT = 64
STEPS = 4
WINDOW = 100  # frames per decoded window, as say() decodes
CONTEXT = 8  # frames decoded on each side of a window
MAX_WORD_FRAMES = 250
MAX_FRAMES = 3000

_GOLDEN = np.uint64(0x9E3779B97F4A7C15)
_M1 = np.uint64(0xBF58476D1CE4E5B9)
_M2 = np.uint64(0x94D049BB133111EB)


def _splitmix(index, seed):
    """splitmix64 of counter `index` (uint64 array) under `seed`; wraps mod 2**64."""
    with np.errstate(over="ignore"):
        z = np.uint64(seed) + (index + np.uint64(1)) * _GOLDEN
        z = (z ^ (z >> np.uint64(30))) * _M1
        z = (z ^ (z >> np.uint64(27))) * _M2
    return z ^ (z >> np.uint64(31))


def noise(seed, frames):
    """float32 [STEPS, frames, LATENT]: element k (C order) is Box-Muller of draws 2k and 2k+1.

    u = ((draw >> 11) + 1) / 2**53 lies in (0, 1]; n = sqrt(-2 ln u1) * cos(2 pi u2), in float64, then float32.
    """
    count = STEPS * frames * LATENT
    k = np.arange(count, dtype=np.uint64)
    u1 = ((_splitmix(2 * k, seed) >> np.uint64(11)) + np.uint64(1)).astype(np.float64) / 2.0**53
    u2 = ((_splitmix(2 * k + np.uint64(1), seed) >> np.uint64(11)) + np.uint64(1)).astype(np.float64) / 2.0**53
    n = np.sqrt(-2.0 * np.log(u1)) * np.cos(2.0 * np.pi * u2)
    return n.astype(np.float32).reshape(STEPS, frames, LATENT)


def words(text):
    """(cw, wstart): each letter's word index and the index of its word's first letter.

    A word starts at a non-space letter that opens the text or follows a space; the space before a word
    belongs to the word before it. Same rule as ema_lightning.engine.Engine.piece.
    """
    starts = [i for i, ch in enumerate(text) if ch != " " and (i == 0 or text[i - 1] == " ")] or [0]
    bounds = [0] + starts[1:] + [len(text)]
    cw, wstart = [], []
    for w in range(len(bounds) - 1):
        a, b = bounds[w], bounds[w + 1]
        cw += [w] * (b - a)
        wstart += [a] * (b - a)
    return np.array(cw, np.int64), np.array(wstart, np.int64)


def plan(dur, cw, speed=1.0):
    """Letter durations [L] to (word_frames, fw, fp): frames per word, each frame's word and its position.

    Per word: sum the letters' frames, round half to even, clamp to 1..MAX_WORD_FRAMES. The timeline is
    cut at MAX_FRAMES. fp is (frame - first frame of its word) / frames of that word, computed in float64.
    """
    dur = dur.astype(np.float32) / np.float32(speed)
    n = np.zeros(int(cw[-1]) + 1, np.float32)
    np.add.at(n, cw, dur)
    n = np.clip(np.round(n), 1, MAX_WORD_FRAMES).astype(np.int64)
    frames = min(int(n.sum()), MAX_FRAMES)
    fw = np.repeat(np.arange(n.size), n)[:frames]
    first = np.cumsum(n) - n
    fp = ((np.arange(frames) - first[fw]).astype(np.float64) / n[fw].astype(np.float64)).astype(np.float32)
    return n, fw.astype(np.int64), fp


def windows(frames, first=WINDOW):
    spans, s = [], 0
    while s < frames:
        e = min(frames, s + (first if s == 0 else WINDOW))
        spans.append((s, e))
        s = e
    return spans


def decode(run, latents):
    """Audio for latents [T, LATENT]: each window decoded with its context, then cut back to itself.

    `run` maps z [1, n, LATENT] to audio [1, n * HOP].
    """
    T, out = latents.shape[0], []
    for s, e in windows(T):
        a, b = max(0, s - CONTEXT), min(T, e + CONTEXT)
        audio = run(np.ascontiguousarray(latents[None, a:b]))
        out.append(audio[0, (s - a) * HOP:(e - a) * HOP])
    return np.concatenate(out).astype(np.float32)


def sha256(array):
    return hashlib.sha256(np.ascontiguousarray(array, dtype="<f4").tobytes()).hexdigest()


def rms(audio):
    """RMS per latent frame (HOP samples): a small fingerprint of the waveform's loudness shape."""
    frames = audio.size // HOP
    return np.sqrt((audio[:frames * HOP].reshape(frames, HOP).astype(np.float64) ** 2).mean(1))


def correlation(a, b):
    n = min(a.size, b.size)
    a, b = a[:n].astype(np.float64), b[:n].astype(np.float64)
    a, b = a - a.mean(), b - b.mean()
    return float((a @ b) / np.sqrt((a @ a) * (b @ b) + 1e-30))
