"""Voice-note transcription.

Two backends behind one interface (``available()`` / ``transcribe()``):

* macOS / Apple silicon: ``mlx-whisper``. Audio is decoded with the built-in
  ``afconvert`` (or ffmpeg) into 16 kHz mono PCM and handed over as numpy.
* Windows / Linux: ``faster-whisper`` (CTranslate2 on the CPU). It decodes the
  audio itself through PyAV, so no ffmpeg binary is needed.

Both load their model on first use and keep it for the life of the process; the
first voice note therefore takes a while (~500 MB model download). ``warm()``
is how the panel pays that cost before anybody is waiting on it: pressing the
microphone warms the model while the person is still drawing breath.

``RAC_WHISPER_MODEL`` overrides which model that is — an ``mlx-community`` repo
on Apple silicon, a faster-whisper size or path everywhere else. On Apple
silicon the default is ``whisper-large-v3-turbo-q4``: it is the same half
gigabyte on disk as the small model it replaced, six times real time on an M1
instead of eleven, and the difference in what comes back is not subtle — a
Turkish sentence with "branch" and "commit at" in it came back from the small
one as "brand charge" and "John Mitat". Dictation is read by the person who
said it, so the words being right is the whole feature. faster-whisper stays on
``small``, because there the model runs on a CPU and turbo is not fast on one."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import threading
import wave
from pathlib import Path

log = logging.getLogger("rac.transcribe")
_OVERRIDE = os.environ.get("RAC_WHISPER_MODEL", "").strip()
MODEL = _OVERRIDE or "mlx-community/whisper-large-v3-turbo-q4"   # mlx backend
FW_MODEL = _OVERRIDE or "small"                 # faster-whisper backend (Systran/faster-whisper-small)

_fw_model = None
_fw_lock = threading.Lock()
# One transcription at a time. Both backends hold a model that is not meant to
# be entered twice, and dictation asks far more often than a voice note does:
# the panel sends a segment every time the speaker pauses, so two can easily be
# in the air at once. Queueing them is both correct and faster than letting
# them fight over the GPU.
_run_lock = threading.Lock()


def _backend() -> str | None:
    try:
        import mlx_whisper  # noqa: F401
        import numpy  # noqa: F401
        if shutil.which("afconvert") is not None or shutil.which("ffmpeg") is not None:
            return "mlx"
    except Exception:
        pass
    try:
        import faster_whisper  # noqa: F401
        return "faster"
    except Exception:
        return None


def available() -> bool:
    return _backend() is not None


# ── mlx-whisper (macOS) ────────────────────────────────────────────────────
def _decode(src: Path):
    """→ float32 numpy array at 16 kHz mono."""
    import numpy as np
    wav = src.with_suffix(".16k.wav")
    if shutil.which("afconvert"):
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(src), str(wav)],
                       check=True, timeout=120, capture_output=True)
    else:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(wav)],
                       check=True, timeout=120)
    with wave.open(str(wav), "rb") as w:
        frames = w.readframes(w.getnframes())
    wav.unlink(missing_ok=True)
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def _mlx(audio, prompt: str | None, language: str | None = None) -> dict | None:
    import mlx_whisper
    # A voice note passes no `language`: whisper detects it, and forcing one
    # makes it *translate* a note spoken in another language instead of
    # transcribing it. Dictation does pass one — see `pcm`.
    out = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL,
                                 **({"initial_prompt": prompt} if prompt else {}),
                                 **({"language": language} if language else {}))
    text = (out.get("text") or "").strip()
    return {"text": text, "language": out.get("language")} if text else None


def _transcribe_mlx(path: Path, prompt: str | None = None) -> dict | None:
    return _mlx(_decode(path), prompt)


# ── faster-whisper (Windows / Linux) ───────────────────────────────────────
def _fw():
    global _fw_model
    with _fw_lock:
        if _fw_model is None:
            from faster_whisper import WhisperModel
            log.info("loading faster-whisper %s (first use downloads the model)", FW_MODEL)
            _fw_model = WhisperModel(FW_MODEL, device="cpu", compute_type="int8")
    return _fw_model


def _transcribe_faster(path: Path, prompt: str | None = None) -> dict | None:
    model = _fw()
    # Same reasoning as the mlx path: detection on real speech is reliable
    # (see smoke.py), and forcing a language turns transcription into
    # translation.
    segments, info = model.transcribe(str(path), language=None, beam_size=5,
                                      initial_prompt=prompt or None)
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": getattr(info, "language", None)} if text else None


def _transcribe_sync(path: Path, prompt: str | None = None) -> dict | None:
    backend = _backend()
    with _run_lock:
        if backend == "mlx":
            return _transcribe_mlx(path, prompt)
        if backend == "faster":
            return _transcribe_faster(path, prompt)
    return None


async def transcribe(path: Path, prompt: str | None = None) -> dict | None:
    if not available():
        return None
    # The very first call may have to download the model; give it longer.
    timeout = 240 if (_backend() == "mlx" or _fw_model is not None) else 900
    try:
        return await asyncio.wait_for(asyncio.to_thread(_transcribe_sync, path, prompt),
                                      timeout=timeout)
    except Exception as exc:
        log.warning("transcription failed: %s", exc)
        return None


# ── dictation ────────────────────────────────────────────────────────────────
#
# A voice note is a file somebody recorded and sent; dictation is somebody
# talking into the box with the cursor in it, and the two want different things
# of this module. A note can take its time and has to be decoded from whatever
# the phone recorded. Dictation arrives as the one thing whisper actually wants
# — 16 kHz mono signed 16-bit PCM, which the browser can make on its own — so
# there is no file to write, no `afconvert` to spawn and nothing left on disk
# afterwards. What is left is the model load, and that is what `warm()` is for.

SAMPLE_RATE = 16000


def pcm(data: bytes, prompt: str | None = None, language: str | None = None) -> dict | None:
    """One stretch of 16 kHz mono s16le PCM, as words. Runs on a thread.

    `language` is the one the panel was set to dictate in. A voice note is left
    to detection; a phrase cut out of somebody talking is two seconds long, and
    detection on two seconds is a guess — "tamam, commit at" was heard as
    English often enough to matter. Being told also skips the detection pass,
    which on a short phrase is a third of the time."""
    import numpy as np
    if len(data) < SAMPLE_RATE // 5:                 # under a tenth of a second
        return None
    audio = np.frombuffer(data[:len(data) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    backend = _backend()
    with _run_lock:
        if backend == "mlx":
            return _mlx(audio, prompt, language)
        if backend == "faster":
            return _transcribe_faster_array(audio, prompt, language)
    return None


def _transcribe_faster_array(audio, prompt: str | None, language: str | None = None) -> dict | None:
    """faster-whisper takes a numpy array as happily as a path."""
    segments, info = _fw().transcribe(audio, language=language or None, beam_size=5,
                                      initial_prompt=prompt or None)
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": getattr(info, "language", None)} if text else None


async def dictate(data: bytes, prompt: str | None = None, language: str | None = None) -> dict | None:
    if not available():
        return None
    try:
        return await asyncio.wait_for(asyncio.to_thread(pcm, data, prompt, language), timeout=300)
    except Exception as exc:
        log.warning("dictation failed: %s", exc)
        return None


_warming = threading.Event()


def warm() -> None:
    """Load the model now, on a thread, and say nothing about it.

    Called when a microphone opens rather than when audio arrives: the load is
    seconds (and the first one is a download) and the speaker is not waiting
    yet. Safe to call as often as the panel likes — the second call finds the
    model already in hand and returns, and the flag keeps two from racing into
    the loader at once.
    """
    if not available() or _warming.is_set():
        return
    _warming.set()

    def run() -> None:
        try:
            # A fifth of a second of silence is the cheapest thing that makes a
            # backend fetch and build its model. The words it comes back with,
            # if any, are nobody's business.
            pcm(b"\x00" * (SAMPLE_RATE // 5 * 2))
        except Exception as exc:
            log.warning("warming the transcriber failed: %s", exc)
        finally:
            _warming.clear()

    threading.Thread(target=run, name="rac-warm-whisper", daemon=True).start()
