#!/usr/bin/env python3
"""Write the tool pool the panel's Havuz page reads (`/havuz`).

The pool is Yakup's catalog of outside tools, kept by the `shared-tool-pool`
skill (`~/.claude/skills/shared-tool-pool`). Its catalog sits under `~/.claude`,
which the daemon never serves over `/files` — rightly, that folder holds
credentials. So this script copies out what the page needs, nothing more, to a
folder the daemon does serve:

    ~/projects/.havuz/havuz.json       the tools, with their live status
    ~/projects/.havuz/thumbs/<id>.jpg  one picture per tool
    ~/projects/.havuz/gallery/<id>/    what the tool looks like in use: the
                                       demo pictures and video frames from its
                                       README, and shots of its own site

The status is the skill's own answer (`pool.py check`), worked out now rather
than copied from the catalog, so a tool installed since the last run reads as
installed. Run it after the pool changes; launchd runs it every 30 minutes.

Pictures: a GitHub repository's social card, else the page's `og:image`, else
a headless-Chrome shot of the page. A picture already on disk is kept unless
`--refresh-thumbs` is given.

Gallery: the repository card says only the name, so each tool also gets up to
six pictures of the thing itself — README images and the first frames of
README videos (badges, logos and anything small left out), then a shot of the
top of its site and one further down. A tool whose gallery folder exists is not
fetched again unless `--refresh-gallery` is given. Usage:

    python3 scripts/havuz-snapshot.py [--out DIR] [--no-thumbs] [--refresh-thumbs]
                                      [--no-gallery] [--refresh-gallery] [--only ID]
"""
from __future__ import annotations

import argparse
import html
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

SKILL = Path(os.environ.get("TOOL_POOL_SKILL", "~/.claude/skills/shared-tool-pool")).expanduser()
OUT = Path("~/projects/.havuz").expanduser()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
KEEP = ("id", "name", "aliases", "kind", "group", "purpose", "project_fit", "priority",
        "priority_reason", "platform", "cost_license", "setup", "use", "cautions",
        "canonical", "links", "researched_on")


def load_pool():
    spec = importlib.util.spec_from_file_location("tool_pool", SKILL / "scripts" / "pool.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(8_000_000)


def og_image(page_url: str) -> str | None:
    try:
        text = fetch(page_url).decode("utf-8", "replace")
    except Exception:
        return None
    for pat in (r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image',
                r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)'):
        m = re.search(pat, text, re.I)
        if m:
            return urllib.request.urljoin(page_url, html.unescape(m.group(1)))
    return None


def github_card(url: str) -> str | None:
    m = re.match(r"https?://github\.com/([^/\s]+)/([^/\s#?]+)", url or "")
    return f"https://opengraph.githubassets.com/1/{m.group(1)}/{m.group(2).removesuffix('.git')}" if m else None


def to_jpg(raw: Path, dest: Path, width: int = 1200) -> bool:
    """Any picture in, a JPEG at most `width` wide out (ffmpeg, else sips)."""
    ff = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if Path(ff).exists():
        r = subprocess.run([ff, "-nostdin", "-loglevel", "error", "-y", "-i", str(raw), "-frames:v", "1",
                            "-vf", f"scale='min({width},iw)':-2", "-q:v", "4", str(dest)], capture_output=True)
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            return True
    if shutil.which("sips"):
        r = subprocess.run(["sips", "-s", "format", "jpeg", "--resampleWidth", str(width), str(raw), "--out", str(dest)],
                           capture_output=True)
        if r.returncode == 0 and dest.exists():
            return True
    return False


# ── gallery ──────────────────────────────────────────────────────────────

SKIP_IMG = re.compile(r"shields\.io|badge|trendshift|star-history|contrib\.rocks|avatars\.|"
                      r"/logo|logo\.|icon|favicon|emoji|sponsor|buymeacoffee|ko-fi|discord|"
                      r"\.svg(\?|$)", re.I)
VIDEO = re.compile(r"\.(mp4|mov|webm)(\?|$)|github\.com/user-attachments/assets/", re.I)
GALLERY_MAX = 6


def gh_json(path: str, accept: str | None = None) -> str | None:
    gh = shutil.which("gh") or "/opt/homebrew/bin/gh"
    if not Path(gh).exists():
        return None
    cmd = [gh, "api", path] + (["-H", f"Accept: {accept}"] if accept else [])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=40)
    return r.stdout if r.returncode == 0 else None


def readme_media(owner: str, repo: str) -> tuple[list[tuple[str, str, str]], str | None]:
    """(url, kind, alt) for the README's pictures and videos, in reading
    order, and the repository's homepage if it names one."""
    meta = gh_json(f"repos/{owner}/{repo}")
    home, branch = None, "HEAD"
    if meta:
        try:
            m = json.loads(meta)
            home = (m.get("homepage") or "").strip() or None
            branch = m.get("default_branch") or "HEAD"
        except Exception:
            pass
    page = gh_json(f"repos/{owner}/{repo}/readme", "application/vnd.github.html") or ""
    raw = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/"
    found: list[tuple[str, str, str]] = []
    for tag in re.finditer(r"<(img|video|source|a)\b([^>]*)>", page, re.I):
        attrs = tag.group(2)
        def attr(n):
            m = re.search(rf'\b{n}="([^"]*)"', attrs)
            return html.unescape(m.group(1)) if m else ""
        name = tag.group(1).lower()
        src = attr("data-canonical-src") or attr("src") or (attr("href") if name == "a" else "")
        if not src or src.startswith("#") or src.startswith("mailto:"):
            continue
        if not src.startswith("http"):
            src = raw + src.lstrip("./")
        if name == "a" and not VIDEO.search(src):
            continue
        kind = "video" if name in ("video", "source", "a") or VIDEO.search(src) else "image"
        if kind == "image" and SKIP_IMG.search(src + " " + attr("alt")):
            continue
        w = attr("width")
        if w.isdigit() and int(w) < 200:
            continue
        if (src, kind) not in [(u, k) for u, k, _ in found]:
            found.append((src, kind, attr("alt")))
    return found, home


def probe_width(path: Path) -> int:
    ff = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    r = subprocess.run([ff, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    try:
        return int(r.stdout.strip().split("\n")[0])
    except Exception:
        return 0


# A 1200-wide JPEG smaller than this is a flat field: a logo on a plain ground,
# a black title card. It says nothing about the tool, so it is left out.
FLAT_BYTES = 8000


def frame_of(src: str, dest: Path, at: float) -> bool:
    """One frame of a video or animated picture, 1200 wide. Local or https."""
    ff = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    for t in (at, 0):
        r = subprocess.run([ff, "-nostdin", "-loglevel", "error", "-y", "-ss", str(t), "-i", src,
                            "-frames:v", "1", "-vf", "scale='min(1200,iw)':-2", "-q:v", "4", str(dest)],
                           capture_output=True, timeout=90)
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > FLAT_BYTES:
            return True
        dest.unlink(missing_ok=True)
    return False


def gallery_for(tool: dict, out: Path, refresh: bool, shots: list) -> None:
    """Fill gallery/<id>/ with README media; queue site shots for the browser."""
    gdir = out / "gallery" / tool["id"]
    if gdir.exists() and not refresh:
        return
    shutil.rmtree(gdir, ignore_errors=True)
    gdir.mkdir(parents=True)
    items: list[dict] = []
    m = re.match(r"https?://github\.com/([^/\s]+)/([^/\s#?]+)", tool.get("canonical", ""))
    home = None
    if m:
        media, home = readme_media(m.group(1), m.group(2).removesuffix(".git"))
        for url, kind, alt in media:
            if len(items) >= GALLERY_MAX - 2:
                break
            dest = gdir / f"{len(items):02d}.jpg"
            if kind == "video":
                if frame_of(url, dest, 3):
                    items.append({"file": dest.name, "from": "README video", "alt": alt})
                continue
            try:
                data = fetch(url)
            except Exception:
                continue
            if len(data) < 8000:
                continue
            raw = gdir / ".raw"
            raw.write_bytes(data)
            try:
                if probe_width(raw) < 400:
                    continue
                gif = data[:3] == b"GIF" or url.lower().split("?")[0].endswith((".gif", ".webp"))
                if frame_of(str(raw), dest, 1.5 if gif else 0):
                    items.append({"file": dest.name, "from": "README", "alt": alt})
            finally:
                raw.unlink(missing_ok=True)
    site = home or (tool.get("canonical") if "github.com" not in tool.get("canonical", "") else None)
    if not site:
        site = next((l for l in tool.get("links") or [] if l.startswith("http") and "github.com" not in l), None)
    (gdir / "items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    if site:
        shots.append((tool["id"], site, gdir))


def site_shots(jobs: list) -> None:
    """Two shots of each tool's site — the top, and a screen further down —
    appended to its gallery. The browser is closed whatever happens."""
    if not jobs:
        return
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome")
        except Exception:
            b = p.chromium.launch()
        try:
            ctx = b.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA)
            for tid, url, gdir in jobs:
                items = json.loads((gdir / "items.json").read_text(encoding="utf-8"))
                page = ctx.new_page()
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=35000)
                    time.sleep(4)
                    for i, label in enumerate(("site", "site, further down")):
                        if len(items) >= GALLERY_MAX:
                            break
                        if i:
                            page.mouse.wheel(0, 1000)
                            time.sleep(2.5)
                        raw = gdir / f".shot{i}.png"
                        page.screenshot(path=str(raw))
                        dest = gdir / f"{len(items):02d}.jpg"
                        if to_jpg(raw, dest):
                            items.append({"file": dest.name, "from": label, "alt": url})
                        raw.unlink(missing_ok=True)
                except Exception:
                    pass
                finally:
                    page.close()
                (gdir / "items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        finally:
            b.close()


def screenshot(urls: list[str], thumbs: Path) -> dict[str, bool]:
    """Headless-Chrome shots for the tools nothing else gave a picture for.
    The browser is closed whatever happens."""
    done: dict[str, bool] = {}
    if not urls:
        return done
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return done
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="chrome")
        except Exception:
            b = p.chromium.launch()
        try:
            for tid, url in urls:
                page = b.new_page(viewport={"width": 1280, "height": 800}, user_agent=UA)
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(3)
                    raw = thumbs / f".{tid}.png"
                    page.screenshot(path=str(raw))
                    done[tid] = to_jpg(raw, thumbs / f"{tid}.jpg", 800)
                    raw.unlink(missing_ok=True)
                except Exception:
                    done[tid] = False
                finally:
                    page.close()
        finally:
            b.close()
    return done


def thumb_for(tool: dict, thumbs: Path, refresh: bool) -> str:
    """'ok' if a picture is on disk afterwards, 'shot' if it needs a screenshot."""
    dest = thumbs / f"{tool['id']}.jpg"
    if dest.exists() and not refresh:
        return "ok"
    pages = [tool.get("canonical", "")] + list(tool.get("links") or [])
    candidates = [c for c in [github_card(tool.get("canonical", ""))] if c]
    for page in pages:
        if page and page.startswith("http") and "github.com" not in page:
            img = og_image(page)
            if img:
                candidates.append(img)
                break
    for img in candidates:
        try:
            data = fetch(img)
        except Exception:
            continue
        if len(data) < 2000:
            continue
        with tempfile.NamedTemporaryFile(dir=thumbs, prefix=".", suffix=".img", delete=False) as f:
            f.write(data)
            raw = Path(f.name)
        try:
            if to_jpg(raw, dest, 800):
                return "ok"
        finally:
            raw.unlink(missing_ok=True)
    return "shot"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--no-thumbs", action="store_true")
    ap.add_argument("--refresh-thumbs", action="store_true")
    ap.add_argument("--no-gallery", action="store_true")
    ap.add_argument("--refresh-gallery", action="store_true")
    ap.add_argument("--only", help="build the pictures of this tool only")
    args = ap.parse_args(argv)

    pool = load_pool()
    data = pool.load()
    out: Path = args.out.expanduser()
    thumbs = out / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)

    tools, need_shot, gallery_shots = [], [], []
    for t in data.get("tools", []):
        mine = not args.only or t["id"] == args.only
        av = pool.availability(t, Path.home())
        row = {k: t[k] for k in KEEP if t.get(k) not in (None, "", [])}
        row["group"] = t.get("group") or "other"
        row["status"] = av["status"]
        row["status_label"] = av["label"]
        row["shared"] = [{"link": p.get("link"), "on": p.get("shared_on"), "note": p.get("note")}
                         for p in t.get("provenance", []) if p.get("link")]
        if mine and not args.no_thumbs and thumb_for(t, thumbs, args.refresh_thumbs) == "shot" and t.get("canonical"):
            need_shot.append((t["id"], t["canonical"]))
        if mine and not args.no_gallery:
            try:
                gallery_for(t, out, args.refresh_gallery, gallery_shots)
            except Exception as exc:
                print(f"  gallery {t['id']}: {exc}", file=sys.stderr)
        tools.append(row)

    if need_shot:
        screenshot(need_shot, thumbs)
    site_shots(gallery_shots)
    for row in tools:
        pic = thumbs / f"{row['id']}.jpg"
        if pic.exists():
            row["thumb"] = str(pic)
        gdir = out / "gallery" / row["id"]
        try:
            items = json.loads((gdir / "items.json").read_text(encoding="utf-8"))
        except Exception:
            items = []
        row["gallery"] = [{"path": str(gdir / i["file"]), "from": i.get("from", ""), "alt": i.get("alt", "")}
                          for i in items if (gdir / i["file"]).exists()]

    snap = {"generated_at": int(time.time()), "catalog_updated": data.get("updated"),
            "skipped": len(data.get("skipped", [])), "tools": tools}
    tmp = out / "havuz.json.tmp"
    tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(out / "havuz.json")
    pics = sum(1 for r in tools if "thumb" in r)
    shown = sum(1 for r in tools if r["gallery"])
    print(f"havuz: {len(tools)} tools, {pics} with a picture, {shown} with a gallery "
          f"({sum(len(r['gallery']) for r in tools)} pictures) -> {out / 'havuz.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
