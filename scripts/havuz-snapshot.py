#!/usr/bin/env python3
"""Write the tool pool the panel's Havuz page reads (`/havuz`).

The pool is Yakup's catalog of outside tools, kept by the `shared-tool-pool`
skill (`~/.claude/skills/shared-tool-pool`). Its catalog sits under `~/.claude`,
which the daemon never serves over `/files` — rightly, that folder holds
credentials. So this script copies out what the page needs, nothing more, to a
folder the daemon does serve:

    ~/projects/.havuz/havuz.json       the tools, with their live status
    ~/projects/.havuz/thumbs/<id>.jpg  one picture per tool

The status is the skill's own answer (`pool.py check`), worked out now rather
than copied from the catalog, so a tool installed since the last run reads as
installed. Run it after the pool changes; launchd runs it every 30 minutes.

Pictures: a GitHub repository's social card, else the page's `og:image`, else
a headless-Chrome shot of the page. A picture already on disk is kept unless
`--refresh-thumbs` is given. Usage:

    python3 scripts/havuz-snapshot.py [--out DIR] [--no-thumbs] [--refresh-thumbs]
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


def to_jpg(raw: Path, dest: Path) -> bool:
    """Any picture in, an 800-wide JPEG out (ffmpeg, else sips, else as is)."""
    ff = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if Path(ff).exists():
        r = subprocess.run([ff, "-nostdin", "-loglevel", "error", "-y", "-i", str(raw), "-frames:v", "1",
                            "-vf", "scale='min(800,iw)':-2", "-q:v", "4", str(dest)], capture_output=True)
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            return True
    if shutil.which("sips"):
        r = subprocess.run(["sips", "-s", "format", "jpeg", "--resampleWidth", "800", str(raw), "--out", str(dest)],
                           capture_output=True)
        if r.returncode == 0 and dest.exists():
            return True
    return False


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
                    done[tid] = to_jpg(raw, thumbs / f"{tid}.jpg")
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
            if to_jpg(raw, dest):
                return "ok"
        finally:
            raw.unlink(missing_ok=True)
    return "shot"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--no-thumbs", action="store_true")
    ap.add_argument("--refresh-thumbs", action="store_true")
    args = ap.parse_args(argv)

    pool = load_pool()
    data = pool.load()
    out: Path = args.out.expanduser()
    thumbs = out / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)

    tools, need_shot = [], []
    for t in data.get("tools", []):
        av = pool.availability(t, Path.home())
        row = {k: t[k] for k in KEEP if t.get(k) not in (None, "", [])}
        row["group"] = t.get("group") or "other"
        row["status"] = av["status"]
        row["status_label"] = av["label"]
        row["shared"] = [{"link": p.get("link"), "on": p.get("shared_on"), "note": p.get("note")}
                         for p in t.get("provenance", []) if p.get("link")]
        if not args.no_thumbs and thumb_for(t, thumbs, args.refresh_thumbs) == "shot" and t.get("canonical"):
            need_shot.append((t["id"], t["canonical"]))
        tools.append(row)

    if need_shot:
        screenshot(need_shot, thumbs)
    for row in tools:
        pic = thumbs / f"{row['id']}.jpg"
        if pic.exists():
            row["thumb"] = str(pic)

    snap = {"generated_at": int(time.time()), "catalog_updated": data.get("updated"),
            "skipped": len(data.get("skipped", [])), "tools": tools}
    tmp = out / "havuz.json.tmp"
    tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(out / "havuz.json")
    pics = sum(1 for r in tools if "thumb" in r)
    print(f"havuz: {len(tools)} tools, {pics} with a picture -> {out / 'havuz.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
