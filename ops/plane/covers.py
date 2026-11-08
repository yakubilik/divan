"""A cover for each product's Plane project: its logo's own colour (or the
brand's, where the logo has none), deepened into a soft gradient. The card
already shows the logo, so the cover does not repeat it.

Usage: covers.py <logos dir (slug.png)> <out dir>   — writes <slug>.jpg, 1200x400.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 400
# Logos drawn in black or grey say nothing about the brand's colour.
BRAND = {"isghocam": (79, 70, 229), "skolalabs": (124, 58, 237)}


def tone(img: Image.Image) -> tuple[int, int, int]:
    """The logo's colour: the most saturated common colour, not its background."""
    small = img.convert("RGBA").resize((48, 48))
    best, score = (90, 100, 120), -1.0
    for count, (r, g, b, a) in small.getcolors(48 * 48) or []:
        if a < 128:
            continue
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / mx if mx else 0
        if mx < 40 or (sat < 0.25 and mx > 200):
            continue  # black, white, grey: not a colour
        s = count * (0.3 + sat)
        if s > score:
            best, score = (r, g, b), s
    return best


def mix(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def cover(logo: Path, out: Path) -> None:
    c = BRAND.get(logo.stem) or tone(Image.open(logo))
    dark, light = mix(c, (12, 14, 20), 0.6), mix(c, (255, 255, 255), 0.12)
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    for x in range(W):
        d.line([(x, 0), (x, H)], fill=mix(dark, light, (x / W) ** 1.3))
    shade = Image.new("L", (W, H))
    ImageDraw.Draw(shade).rectangle([0, int(H * 0.6), W, H], fill=70)
    bg = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), bg, shade.filter(ImageFilter.GaussianBlur(70)))
    bg.save(out, quality=88)


src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for p in sorted(src.glob("*.png")):
    cover(p, dst / f"{p.stem}.jpg")
    print(p.stem)
