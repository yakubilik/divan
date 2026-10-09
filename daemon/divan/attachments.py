"""Files the agent shows the person.

The phone can hand the agent a file — there is an upload button. The agent had
no way back: a screenshot it took or a PDF it built could only be described,
and a described picture is not a picture. What the agent does have is text, so
a file it wants seen is named the way Markdown already names one —
`![caption](/abs/path.png)` for a picture, `[name](/abs/path.pdf)` for anything
else — and the daemon lifts those out of each assistant message into an
`attachments` list before the phone sees it. The text is left as written: it is
the record, and a client that knows nothing of attachments still shows a path
a person can read.

Only a file the path policy would serve is lifted (inside an allowed root,
not a secret), plus anything under the uploads folder, which the phone sent
in the first place. A path that fails the policy is simply not an attachment;
the text still says it, and `/files` would refuse it anyway.

A picture also gets a copy of itself kept here (`view`), because a screenshot
belongs to the transcript and the file it was read from does not: the agent
tidies up after itself, the branch changes, the folder goes — and a bubble
whose picture is a 404 shows a file name where a picture was. The copy lives
under the uploads folder, which `/files` serves regardless of where the
original stood, so a chat scrolled back to next week still has its pictures.
"""
from __future__ import annotations

import hashlib
import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .config import UPLOAD_DIR
from .security import PathPolicy

log = logging.getLogger("rac.attachments")

# Only the media extensions need naming: an image is normalized, a video gets a
# player, audio is transcribed. Everything else is just "file".
KINDS = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".heic": "image",
    ".mp4": "video", ".mov": "video", ".m4v": "video",
    ".m4a": "audio", ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".caf": "audio", ".aac": "audio",
}

# `![alt](target)` or `[label](target)` where target is a local path: absolute
# (`/…`, `~/…`, `C:\…`), optionally `file://`, optionally wrapped in `<…>`
# (the Markdown spelling for a path with spaces). URLs are not matched.
_REF = re.compile(
    r"!?\[[^\]\n]*\]\(\s*(?:<(?P<angled>[^>\n]+)>|(?P<bare>(?:file://)?(?:~|/|[A-Za-z]:[\\/])[^)\s]*))\s*\)"
)

MAX_PER_MESSAGE = 12


def kind_of(path: str | Path) -> str:
    return KINDS.get(Path(path).suffix.lower(), "file")


# What the first bytes of a file say it is, when its name will not say. A
# screenshot dragged in from another app arrives with the extension stripped or
# mangled, and deciding by name alone filed it as "file" — so the composer
# showed a grey chip with a broken name instead of the picture.
_MAGIC: list[tuple[bytes, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image", ".png"),
    (b"\xff\xd8\xff", "image", ".jpg"),
    (b"GIF87a", "image", ".gif"),
    (b"GIF89a", "image", ".gif"),
    (b"ID3", "audio", ".mp3"),
    (b"OggS", "audio", ".ogg"),
    (b"caff", "audio", ".caf"),
]
# ISO base media: the brand at bytes 8..12 separates a HEIF picture from a
# video from an audio-only track, all of which carry "ftyp" at byte 4.
_FTYP = {
    "heic": ("image", ".heic"), "heix": ("image", ".heic"), "heim": ("image", ".heic"),
    "heis": ("image", ".heic"), "hevc": ("image", ".heic"), "hevm": ("image", ".heic"),
    "hevs": ("image", ".heic"), "mif1": ("image", ".heic"), "msf1": ("image", ".heic"),
    "avif": ("image", ".avif"),
    "M4A ": ("audio", ".m4a"), "M4B ": ("audio", ".m4a"),
    "qt  ": ("video", ".mov"), "M4V ": ("video", ".m4v"),
}


def sniff(data: bytes) -> tuple[str, str] | None:
    """(kind, extension) read off the content, or None when it is not media."""
    if len(data) < 12:
        return None
    for magic, kind, ext in _MAGIC:
        if data.startswith(magic):
            return kind, ext
    if data[:4] == b"RIFF":
        if data[8:12] == b"WEBP":
            return "image", ".webp"
        if data[8:12] == b"WAVE":
            return "audio", ".wav"
    if data[4:8] == b"ftyp":
        brand = data[8:12].decode("ascii", "replace")
        if brand in _FTYP:
            return _FTYP[brand]
        return "video", ".mp4"          # isom, mp42 and the rest of the family
    return None


def _candidates(text: str) -> list[str]:
    out: list[str] = []
    for m in _REF.finditer(text):
        raw = (m.group("angled") or m.group("bare") or "").strip()
        if raw.startswith("file://"):
            raw = raw[7:]
        if raw and raw not in out:
            out.append(raw)
    return out


def extract(text: str, policy: PathPolicy) -> list[dict]:
    """The attachments named in one assistant message, in order of mention."""
    if not text or "](" not in text:
        return []
    out: list[dict] = []
    uploads = UPLOAD_DIR.resolve()
    for raw in _candidates(text):
        try:
            p = Path(raw).expanduser().resolve(strict=True)
        except Exception:
            continue
        if not p.is_file():
            continue
        if not (uploads in p.parents or policy.is_servable(p)):
            continue
        out.append({"path": str(p), "name": p.name, "size": p.stat().st_size,
                    "kind": kind_of(p), "url": f"/files?path={p}"})
        if len(out) >= MAX_PER_MESSAGE:
            break
    return out


# ── the copy a bubble is drawn from ──────────────────────────────────────────

VIEW_DIR = UPLOAD_DIR / "shown"


def keep_views(atts: list[dict]) -> list[dict]:
    """Give every picture a `view`: a copy under the uploads folder for the
    bubble to draw. `path` is left alone — it is what the message says, what
    the download link opens, and what the clients match the text against."""
    out = []
    for a in atts:
        if a.get("kind") != "image" or a.get("view"):
            out.append(a)
            continue
        view = _keep(Path(a["path"]))
        out.append({**a, "view": str(view)} if view else a)
    return out


# Past this a picture is re-encoded on the way into the copy; under it the file
# is copied as it is. A screenshot of an interface is mostly text, and text is
# the one thing JPEG is bad at — it is not worth blurring a 200 KB PNG.
KEEP_AS_IS = 800 * 1024


def _keep(src: Path) -> Path | None:
    """The kept copy of one picture, made once. None if it cannot be made —
    a bubble then draws from the original, which is what it did before."""
    try:
        if UPLOAD_DIR.resolve() in src.resolve().parents:
            return None                      # already somewhere /files will find it
        digest = hashlib.sha1(str(src.resolve()).encode()).hexdigest()[:10]
        stem = "".join(c for c in src.stem if c.isalnum() or c in "-_")[:40] or "image"
        VIEW_DIR.mkdir(parents=True, exist_ok=True)
        plain = VIEW_DIR / f"{stem}-{digest}{src.suffix.lower()}"
        shrunk = VIEW_DIR / f"{stem}-{digest}.jpg"
        for out in (plain, shrunk):
            if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
                return out
        if src.stat().st_size <= KEEP_AS_IS:
            shutil.copy2(src, plain)
            return plain
        if _shrink(src, shrunk):
            return shrunk
        shutil.copy2(src, plain)
        return plain
    except Exception as exc:
        log.warning("keeping a copy of %s failed: %s", src.name, exc)
        return None


def normalize_image(path: Path) -> Path:
    """HEIC or oversized photos → JPEG ≤ 1600 px so Claude Code's Read (256 KB cap for
    text, image previews OK up to a few MB) can actually look at them.

    macOS has `sips` built in; elsewhere Pillow does the same job. Without either
    the file is passed through untouched and the model may not be able to read it."""
    try:
        heic = path.suffix.lower() in (".heic", ".heif")
        big = path.stat().st_size > 600 * 1024
        if not (heic or big):
            return path
        out = path.with_suffix(".jpg") if heic else path.with_name(path.stem + "-web.jpg")
        if _shrink(path, out):
            if out != path:
                path.unlink(missing_ok=True)
            return out
        log.warning("no image converter available (install Pillow) — sending %s as is", path.name)
    except Exception as exc:
        log.warning("image normalize failed: %s", exc)
    return path


def _shrink(src: Path, dst: Path) -> bool:
    """One picture, re-encoded as a JPEG no wider than 1600 px. macOS has `sips`;
    everywhere else Pillow does it."""
    if shutil.which("sips"):
        try:
            r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "1600",
                                str(src), "--out", str(dst)], capture_output=True, text=True, timeout=60)
            if r.returncode == 0 and dst.exists():
                return True
            log.warning("sips failed: %s", r.stderr.strip()[:200])
        except Exception as exc:
            log.warning("sips failed: %s", exc)
    return _pillow_resize(src, dst)


def _pillow_resize(src: Path, dst: Path) -> bool:
    """Pillow path, used on Windows and Linux. HEIC needs pillow-heif."""
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        try:
            import pillow_heif                      # noqa: F401
            pillow_heif.register_heif_opener()
        except Exception:
            pass
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((1600, 1600))
            im.save(dst, "JPEG", quality=82, optimize=True)
        return dst.exists()
    except Exception as exc:
        log.warning("pillow convert failed: %s", exc)
        return False


# ── the shape a voice bubble is drawn with ───────────────────────────────────

PEAKS = 40


def with_peaks(atts: list[dict]) -> list[dict]:
    """Give every sound a `peaks` list, so its bubble draws how loud it was
    rather than a made-up shape. One that cannot be read is left without; the
    phone falls back to the made-up shape, which is what it always drew."""
    out = []
    for a in atts:
        if a.get("kind") != "audio" or a.get("peaks"):
            out.append(a)
            continue
        p = peaks(Path(a["path"]))
        out.append({**a, "peaks": p} if p else a)
    return out


def peaks(src: Path, n: int = PEAKS) -> list[int] | None:
    """`n` loudness values, 0-100, the loudest part of the sound at 100. None
    when the file cannot be decoded — this never raises."""
    try:
        samples = _pcm(src)
        if not samples:
            return None
        step = max(1, len(samples) // n)
        buckets = [samples[i * step:(i + 1) * step] for i in range(n)]
        levels = [max((abs(s) for s in b), default=0) for b in buckets]
        top = max(levels)
        if not top:
            return [0] * n
        return [round(100 * v / top) for v in levels]
    except Exception as exc:
        log.warning("reading the loudness of %s failed: %s", src.name, exc)
        return None


def _pcm(src: Path) -> list[int] | None:
    """The sound as 8 kHz mono signed 16-bit samples. ffmpeg reads everything;
    without it macOS's afconvert does, and a plain WAV needs neither."""
    import array
    import tempfile
    import wave

    def unpack(raw: bytes) -> list[int]:
        a = array.array("h")
        a.frombytes(raw[: len(raw) // 2 * 2])
        if sys.byteorder == "big":
            a.byteswap()
        return a.tolist()

    if shutil.which("ffmpeg"):
        r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(src),
                            "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True, timeout=30)
        return unpack(r.stdout) if r.returncode == 0 else None
    if shutil.which("afconvert"):
        with tempfile.TemporaryDirectory() as d:
            wav = Path(d) / "peaks.wav"
            r = subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@8000", "-c", "1", str(src), str(wav)],
                               capture_output=True, timeout=30)
            if r.returncode != 0:
                return None
            with wave.open(str(wav), "rb") as w:
                return unpack(w.readframes(w.getnframes()))
    with wave.open(str(src), "rb") as w:
        if w.getsampwidth() != 2:
            return None
        frames = w.readframes(w.getnframes())
        return unpack(frames)[:: w.getnchannels()]
