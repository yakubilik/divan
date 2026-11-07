"""Teach Plane's web app to draw a project logo that is a picture.

Plane keeps a project's logo as `logo_props` = {in_use: "emoji" | "icon", ...}
and draws it in one component (the one that reads `in_use:a,emoji:o,icon:s`).
This adds one branch to it: an emoji logo with a `url` is drawn as that image.
Everything else is untouched, and a logo without a url draws as before.

Usage: patch_logo.py <built assets dir> <out dir>
Finds the chunk that holds the component, writes the patched copy into <out dir>
under the same name, and prints that name. Exits non-zero, saying why, when the
component is not where it was (a Plane upgrade moved it): then the patch needs a
look, and Plane keeps drawing its own icons meanwhile.
"""
import pathlib
import re
import sys

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
NEEDLE = re.compile(r"let\{in_use:(\w+),emoji:(\w+),icon:(\w+)\}=(\w+),(\w+)=\1===`emoji`\?\2\?\.value:\3\?\.name;"
                    r"if\(!\5\)return (\w+);if\(\1===`emoji`\)return\(0,(\w+)\.jsx\)")
hits = [p for p in src.glob("*.js") if NEEDLE.search(p.read_text(errors="ignore"))]
if len(hits) != 1:
    sys.exit(f"the logo component is in {len(hits)} chunks, expected 1: Plane changed, look at the patch")
f = hits[0]
s = f.read_text()
m = NEEDLE.search(s)
a, o, _s, _e, c, i, jsx = m.groups()
size = re.search(r"function \w+\(\{logo:\w+,size:(\w+)=16", s[:m.start()][-400:])
t = size.group(1) if size else "t"
img = (f"if({a}===`emoji`&&{o}?.url)return(0,{jsx}.jsx)(`img`,{{src:{o}.url,alt:``,"
       f"style:{{height:{t},width:{t},borderRadius:Math.round({t}/4),objectFit:`cover`,flexShrink:0}}}});")
patched = s[:m.start()] + m.group(0).replace(f"if({a}===`emoji`)return", img + f"if({a}===`emoji`)return", 1) + s[m.end():]
assert patched != s
out.mkdir(parents=True, exist_ok=True)
(out / f.name).write_text(patched)
print(f.name)
