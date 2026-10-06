#!/usr/bin/env python3
"""A sound gets the shape its voice bubble is drawn with, or nothing.

    python scripts/test_peaks.py

An m4a (what the phone records) and an mp3 (what an agent tends to make) both
come back with forty loudness values, the quiet second quieter than the loud
one; a file that is not sound at all comes back with none, and nothing raises.
Needs ffmpeg to make the two sounds; the daemon itself falls back without it.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat import attachments as at                     # noqa: E402

fails: list[str] = []


def check(name: str, ok: bool) -> None:
    if not ok:
        fails.append(name)


if not shutil.which("ffmpeg"):
    print("SKIP: ffmpeg is needed to make the test sounds")
    sys.exit(0)

with tempfile.TemporaryDirectory() as d:
    tmp = Path(d)
    # one quiet second, then one loud second
    sound = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
             "-filter_complex", "[0]volume=0.1[a];[1]volume=1[b];[a][b]concat=n=2:v=0:a=1"]
    for ext in ("m4a", "mp3"):
        f = tmp / f"note.{ext}"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *sound, str(f)], check=True)
        p = at.peaks(f)
        check(f"{ext}: forty values", isinstance(p, list) and len(p) == at.PEAKS)
        check(f"{ext}: 0-100 with the loudest at 100", bool(p) and max(p) == 100 and min(p) >= 0)
        check(f"{ext}: the quiet half is quieter", bool(p) and max(p[3:17]) < 30 < min(p[23:37]))
        got = at.with_peaks([{"path": str(f), "kind": "audio", "name": f.name}])[0]
        check(f"{ext}: with_peaks attaches them", got.get("peaks") == p)

    junk = tmp / "broken.m4a"
    junk.write_bytes(b"this is not a sound at all")
    check("unreadable: no peaks", at.peaks(junk) is None)
    got = at.with_peaks([{"path": str(junk), "kind": "audio", "name": junk.name}])[0]
    check("unreadable: attachment left as it was", "peaks" not in got)
    check("missing file: no peaks", at.peaks(tmp / "gone.mp3") is None)
    pic = {"path": str(junk), "kind": "image", "name": "x.png"}
    check("a picture is not touched", at.with_peaks([pic])[0] == pic)

if fails:
    print("FAIL:\n  " + "\n  ".join(fails))
    sys.exit(1)
print("ok: peaks")
