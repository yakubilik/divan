"""Writes src/icons.gen.ts: every Material Symbols Rounded glyph the app draws,
as an SVG path, at the weight and optical size it is drawn at.

The design renders these as a variable web font, where the browser picks the
optical size from the font size (clamped to the font's 20-48 range). React
Native cannot drive a variable font's axes, so each glyph is cut out of the
font at the instance the design would have used, and drawn as a path. That
keeps a 16 px chevron the same shape it is in the design, instead of a scaled
copy of the 24 px one.

    python app/scripts/gen-icons.py

Needs fontTools and brotli (`pip install fonttools brotli`). The font is
fetched from Google Fonts once and cached next to this script (gitignored).
Add an entry to USED and run it again to get a new icon.
"""
from __future__ import annotations

import os
import re
import urllib.request

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'icons.gen.ts')
CACHE = os.path.join(HERE, '.material-symbols-rounded.woff2')
CSS = ('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:'
       'opsz,wght,FILL,GRAD@20..48,200..500,0..1,0&display=block')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

# (name, font size in px, weight) - as the design draws them.
USED = [
    ('add', 18, 300), ('add', 18, 500), ('add', 20, 300), ('add', 20, 400), ('add', 22, 400),
    ('arrow_downward', 17, 300), ('arrow_outward', 18, 300), ('arrow_upward', 17, 300),
    ('arrow_upward', 20, 400), ('arrow_upward', 20, 500), ('attach_money', 17, 300),
    ('block', 16, 300), ('broken_image', 22, 300), ('call', 22, 300), ('cancel', 18, 300),
    ('chat_bubble', 30, 300), ('check', 14, 300), ('check', 16, 300), ('check', 16, 400),
    ('check', 18, 300), ('check', 18, 400), ('check', 20, 300), ('check', 20, 400),
    ('check', 22, 500), ('check', 30, 400), ('check_circle', 20, 300), ('chevron_left', 18, 300),
    ('chevron_left', 26, 300), ('chevron_right', 16, 400), ('chevron_right', 18, 300),
    ('chevron_right', 18, 400), ('close', 14, 400), ('close', 16, 300), ('close', 22, 400),
    ('close', 24, 300), ('close', 26, 300), ('close', 30, 400), ('cloud_off', 30, 300),
    ('content_copy', 14, 300), ('content_copy', 16, 400), ('content_copy', 18, 300),
    ('delete', 18, 300), ('description', 16, 300), ('description', 16, 400),
    ('download', 44, 300), ('draft', 20, 400), ('draft', 26, 300), ('edit', 18, 300),
    ('edit_square', 22, 300), ('error', 16, 300), ('expand_less', 16, 300),
    ('expand_more', 14, 300), ('expand_more', 14, 400), ('expand_more', 16, 300),
    ('expand_more', 16, 400), ('expand_more', 16, 600), ('expand_more', 18, 300),
    ('expand_more', 18, 400), ('face', 15, 300), ('folder_open', 18, 300), ('info', 16, 300),
    ('inventory_2', 14, 300), ('inventory_2', 16, 300), ('inventory_2', 16, 500),
    ('inventory_2', 18, 300), ('ios_share', 22, 400), ('keep', 14, 300), ('keep', 14, 400),
    ('keep', 18, 300), ('keep_off', 18, 300), ('key_off', 30, 300), ('lock', 14, 300),
    ('lock', 15, 300), ('lock', 15, 400), ('lock', 38, 300), ('logout', 18, 300),
    ('mic', 22, 300), ('mic', 22, 400), ('money_off', 17, 300), ('more_horiz', 24, 300),
    ('more_vert', 20, 300), ('more_vert', 20, 400), ('move_down', 18, 400),
    ('no_photography', 20, 300), ('open_in_new', 16, 300), ('pause', 18, 400),
    ('pause', 24, 400), ('photo_camera', 26, 300), ('photo_library', 26, 300),
    ('play_arrow', 18, 400), ('play_arrow', 24, 400), ('radio_button_checked', 18, 300),
    ('radio_button_unchecked', 18, 300), ('refresh', 22, 300), ('reorder', 16, 300),
    ('search', 16, 300), ('search', 18, 300), ('search', 18, 400), ('settings', 22, 300),
    ('swap_horiz', 16, 300), ('terminal', 16, 400), ('tune', 18, 300), ('unarchive', 18, 300),
    ('unfold_more', 16, 300), ('verified', 16, 300), ('videocam', 26, 300),
    ('view_agenda', 16, 300), ('view_agenda', 16, 500), ('visibility', 20, 300),
    ('visibility_off', 20, 300), ('warning', 16, 300), ('warning', 18, 400),
    # Divan's mobile design system (design/divan/TOKENS.md). The frames draw
    # Lucide; these are the Material Symbols the app already speaks, at the
    # sizes the frames draw them: 22 in the tab bar, 17 in a list row's well.
    ('grid_view', 22, 300), ('chat_bubble', 22, 300), ('dns', 22, 300),
    ('monitor', 17, 300), ('group', 17, 300), ('terminal', 17, 300),
    ('screen_share', 17, 300), ('key', 17, 300), ('speed', 17, 300),
    ('shield', 17, 300), ('settings', 17, 300),
]


def font() -> TTFont:
    if not os.path.exists(CACHE):
        css = urllib.request.urlopen(urllib.request.Request(CSS, headers={'User-Agent': UA})).read().decode()
        url = re.findall(r'url\(([^)]+)\)', css)[0]
        with open(CACHE, 'wb') as f:
            f.write(urllib.request.urlopen(url).read())
    return TTFont(CACHE)


def ligatures(f: TTFont) -> dict[str, str]:
    """Icon name as typed -> glyph. Most glyphs are named after their icon,
    but an alias (`draft` is `description`'s older sibling) only exists as a
    ligature, which is how the web font finds it too."""
    cmap = f.getBestCmap()
    char = {g: chr(c) for c, g in cmap.items()}
    out: dict[str, str] = {}
    for lookup in f['GSUB'].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if lookup.LookupType == 7:            # extension wrapper
                sub = sub.ExtSubTable
            if getattr(sub, 'LookupType', lookup.LookupType) != 4:
                continue
            for first, ligs in sub.ligatures.items():
                for lig in ligs:
                    text = ''.join(char.get(g, '?') for g in [first, *lig.Component])
                    out.setdefault(text, lig.LigGlyph)
    return out


def main() -> None:
    f = font()
    upm = f['head'].unitsPerEm                    # 960; a glyph is one em square
    names = set(f.getGlyphOrder())
    lig = ligatures(f)
    out: dict[str, str] = {}
    sets: dict[tuple[int, int], object] = {}
    for name, size, weight in sorted(set(USED)):
        glyph = lig.get(name) or (name if name in names else None)
        if glyph is None:
            raise SystemExit(f'{name}: not in the font')
        opsz = max(20, min(48, size))
        key = (weight, opsz)
        if key not in sets:
            sets[key] = f.getGlyphSet(location={'wght': weight, 'opsz': opsz, 'FILL': 0})
        pen = SVGPathPen(sets[key], ntos=lambda v: str(round(v)))
        # font units are y-up from the baseline; the em box sits on it
        sets[key][glyph].draw(TransformPen(pen, (1, 0, 0, -1, 0, upm)))
        out[f'{name}:{weight}:{opsz}'] = pen.getCommands()

    lines = [
        '// Generated by scripts/gen-icons.py - do not edit.',
        '// Material Symbols Rounded (Apache License 2.0), cut at the weight and',
        '// optical size each icon is drawn at. Paths are on a 0 0 960 960 box.',
        '/* eslint-disable */',
        'export const ICON_BOX = 960;',
        'export const ICON_PATHS: Record<string, string> = {',
    ]
    lines += [f"  '{k}': '{v}'," for k, v in out.items()]
    lines.append('};')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f'{len(out)} icons -> {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
