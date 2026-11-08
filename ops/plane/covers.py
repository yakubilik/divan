"""A cover for each product's Plane project: its logo's own colour (or the
brand's, where the logo has none), deepened into a soft gradient, a faint
field of the logo across it, and the logo itself, large, as an app tile on
the right. The bottom-left stays quiet: Plane writes the name there.

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


def tile(img: Image.Image, size: int) -> Image.Image:
    """The logo as an app tile: square, rounded, whatever its own background."""
    t = img.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    a = Image.composite(t.getchannel("A"), Image.new("L", (size, size), 0), mask)
    t.putalpha(a)
    return t


def faded(t: Image.Image, k: float) -> Image.Image:
    t = t.copy()
    t.putalpha(t.getchannel("A").point(lambda v: int(v * k)))
    return t


def cover(logo: Path, out: Path) -> None:
    img = Image.open(logo)
    c = BRAND.get(logo.stem) or tone(img)
    dark, light = mix(c, (12, 14, 20), 0.6), mix(c, (255, 255, 255), 0.12)
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    for x in range(W):
        d.line([(x, 0), (x, H)], fill=mix(dark, light, (x / W) ** 1.3))
    canvas = bg.convert("RGBA")
    # A field of small tiles, faint, thinning out towards the left.
    small = tile(img, 64)
    for row, y in enumerate(range(-30, H, 96)):
        for x in range(W - 60 - (row % 2) * 48, int(W * 0.30), -96):
            k = 0.06 + 0.10 * (x / W) ** 2
            canvas.alpha_composite(faded(small, k).rotate(-12, resample=Image.BICUBIC, expand=True), (x, y))
    # The logo itself, with a soft shadow under it.
    big = tile(img, 230)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bx, by = W - 230 - 110, (H - 230) // 2 - 10
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle([bx + 6, by + 16, bx + 236, by + 246], radius=50, fill=150)
    shadow.putalpha(sh.filter(ImageFilter.GaussianBlur(22)))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(big, (bx, by))
    bg = canvas.convert("RGB")
    shade = Image.new("L", (W, H))
    ImageDraw.Draw(shade).rectangle([0, int(H * 0.6), int(W * 0.6), H], fill=80)
    bg = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), bg, shade.filter(ImageFilter.GaussianBlur(80)))
    bg.save(out, quality=90)


src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for p in sorted(src.glob("*.png")):
    cover(p, dst / f"{p.stem}.jpg")
    print(p.stem)
