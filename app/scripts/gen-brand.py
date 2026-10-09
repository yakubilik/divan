"""Writes the app's icon, splash, adaptive icon, favicon and in-app seal from
the Divan seal artwork.

The source sheet draws the seal three times on paper - gray, black and
turquoise. The app wears the turquoise one. It is cut out at the sheet's full
resolution and the paper is keyed away, so each output is the same drawing at
its original proportions, only placed and scaled.

    uv run --no-project --with pillow python app/scripts/gen-brand.py [sheet.png]

The default sheet is ~/projects/divan/design/brand/divan-seal-gray-black-turquoise.png.
"""
from __future__ import annotations

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
SHEET = os.path.expanduser('~/projects/divan/design/brand/divan-seal-gray-black-turquoise.png')

PAPER = (248, 247, 242)        # the sheet's paper, and the icon's ground
INK = (4, 140, 153)            # the turquoise seal's ink


def seal(sheet: str) -> Image.Image:
    """The turquoise seal (the right third of the sheet), ink on transparency,
    cropped to the drawing."""
    src = Image.open(sheet).convert('RGB')
    w, h = src.size
    third = src.crop((w * 2 // 3, 0, w, h))
    d = [p - i for p, i in zip(PAPER, INK)]
    norm = sum(v * v for v in d)
    alpha = []
    raw = third.tobytes()
    for i in range(0, len(raw), 3):
        r, g, b = raw[i:i + 3]
        # how far the pixel has moved from paper towards ink
        a = ((PAPER[0] - r) * d[0] + (PAPER[1] - g) * d[1] + (PAPER[2] - b) * d[2]) / norm
        a = 0.0 if a < 0.08 else min(1.0, a)    # paper grain is not ink
        alpha.append(round(a * 255))
    mask = Image.new('L', third.size)
    mask.putdata(alpha)
    out = Image.new('RGBA', third.size, INK + (0,))
    out.putalpha(mask)
    return out.crop(mask.getbbox())


def place(mark: Image.Image, size: int, fill: float, ground=None) -> Image.Image:
    """`mark` scaled to `fill` of a `size` square, centred, aspect kept."""
    k = size * fill / max(mark.size)
    m = mark.resize((round(mark.width * k), round(mark.height * k)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (ground or PAPER) + ((255,) if ground else (0,)))
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas


def main() -> None:
    mark = seal(sys.argv[1] if len(sys.argv) > 1 else SHEET)
    out = {
        # iOS masks the icon to a rounded square and wants it opaque: the seal
        # on its paper, clear of the corners the mask cuts.
        'icon.png': place(mark, 1024, 0.80, PAPER).convert('RGB'),
        # Android keeps a circle of 66% of the layer; the seal sits inside it
        # on the adaptive background colour (app.json).
        'adaptive-icon.png': place(mark, 1024, 0.62),
        # Drawn at the splash's own width on its dark background.
        'splash-icon.png': place(mark, 1024, 0.96),
        'favicon.png': place(mark, 48, 0.94, PAPER).convert('RGB'),
        # The seal the welcome screen draws, at 3x its 96 pt.
        'divan-seal.png': place(mark, 288, 1.0),
    }
    for name, img in out.items():
        img.save(os.path.join(ASSETS, name), optimize=True)
        print(f'{name}: {img.size[0]}x{img.size[1]} {img.mode}')


if __name__ == '__main__':
    main()
