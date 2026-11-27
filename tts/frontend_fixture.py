"""Write app/scripts/fixtures/tts-frontend.json: EMA's own frontend and chunker on a fixed set of inputs.

    .venv/bin/python frontend_fixture.py

The app's TypeScript port (app/src/tts/) is checked against this file by `npm test`, which has no Python;
so this script is not run by the tests and its output is committed. Re-run it after changing INPUTS or
upgrading ema-lightning / normalizer-tr, and commit the result. The inputs are Turkish and come from the
language pack (`tr/tts/frontend_fixture.json`, see common.lang_dir); without it nothing is written.
"""
import json
from importlib.metadata import version
from pathlib import Path

from ema_lightning.chunker import chunk
from ema_lightning.frontend import Frontend

import common

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "app" / "scripts" / "fixtures" / "tts-frontend.json"
PACK = common.pack("frontend_fixture")

# (category, text). Categories with a fixed bar in the ticket: number, date, time, money, percent.
INPUTS = [tuple(x) for x in PACK.get("inputs") or ()]
# (text, speed): what the chunker cuts, from a long paragraph to the empty string.
CHUNKS = [tuple(x) for x in PACK.get("chunks") or ()]


def main():
    if not INPUTS or not common.VECTORS.exists():
        print("skip: no language pack")
        return
    vocab = json.loads(common.VECTORS.read_text())["vocab"]
    frontend = Frontend(vocab)
    stoi = {ch: i for i, ch in enumerate(vocab)}
    cases = []
    for category, text in INPUTS:
        spoken = frontend(text)
        cases.append({"category": category, "text": text, "spoken": spoken,
                      "ids": [stoi.get(ch, 1) for ch in spoken]})
    chunks = []
    for text, speed in CHUNKS:
        spoken = frontend(text)
        chunks.append({"text": text, "speed": speed, "spoken": spoken,
                       "pieces": [[piece, pause] for piece, pause in chunk(spoken, speed)]})
    data = {
        "about": "EMA Lightning frontend (normalizer-tr, fallback policy) and chunker output: regenerate with "
                 "tts/frontend_fixture.py. Checked by app/scripts/test-tts.cjs.",
        "versions": {"ema-lightning": version("ema-lightning"), "normalizer-tr": version("normalizer-tr")},
        "cases": cases,
        "chunks": chunks,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(cases)} cases, {len(chunks)} chunk inputs -> {OUT}")


if __name__ == "__main__":
    main()
