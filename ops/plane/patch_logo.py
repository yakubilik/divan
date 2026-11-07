"""Teach Plane's web app to draw a project logo that is a picture.

Plane keeps a project's logo as `logo_props` = {in_use: "emoji" | "icon", ...}
and draws it in one component (the one that reads `in_use:a,emoji:o,icon:s`).
This adds one branch to it: an emoji logo with a `url` is drawn as that image.
Everything else is untouched, and a logo without a url draws as before.

Usage: patch_logo.py <Plane's built site> <out dir>
Copies the whole built site (index.html and assets/) into <out dir>, patches the
chunk that holds the component, and moves assets/ to a new folder named after
the patch, rewriting every reference to it. The new folder is what makes it
reach a browser: Plane's files carry no Cache-Control, so a browser that has
the old chunk keeps using it for days under its old name; under a new one it
cannot. Prints the folder's name. Exits non-zero, saying why, when the
component is not where it was (a Plane upgrade moved it): then the patch needs a
look, and Plane keeps drawing emoji meanwhile.
"""
import pathlib
import re
import sys

import hashlib
import shutil

site, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
src = site / "assets"
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

if out.exists():
    shutil.rmtree(out)
shutil.copytree(site, out)
(out / "assets" / f.name).write_text(patched)
folder = "dv-" + hashlib.sha256(patched.encode()).hexdigest()[:10]
(out / "assets").rename(out / folder)
# Every way the build names a file in assets/: "/assets/x" (and `/assets/x`,
# (/assets/x in CSS) and the preload list's bare "assets/x". Never /api/assets/.
ref = re.compile(r"""(["'`(])/?assets/""")
for p in out.rglob("*"):
    if p.is_file() and p.suffix in (".js", ".css", ".html", ".json", ".webmanifest"):
        text = p.read_text(errors="ignore")
        new = ref.sub(lambda mm: mm.group(1) + ("/" if mm.group(0)[1] == "/" else "") + folder + "/", text)
        if new != text:
            p.write_text(new)
print(folder)
