"""A captcha, handed to the phone to solve.

An agent driving a browser gets stopped by a captcha it is not meant to solve —
the box exists to ask whether a person is there, and the honest answer is to
fetch one. Until now that meant a screenshot in the chat and "which number on
the ruler is the gap at?" typed back. This is the proper version of that.

The agent runs `divan captcha` and waits. The daemon attaches to the browser
over the DevTools protocol, finds the captcha box on the page, and the phone is
told. What the phone sees is that box alone, cut out of the page and drawn big,
a few frames a second; what the person touches inside it goes back to the
browser as the same touch at the same spot. When the box is gone or the page
has its token, the agent's command returns and it carries on.

Everything goes through the browser, not the screen: frames are
Page.captureScreenshot with a clip, input is Input.dispatchMouseEvent. So it
works for a headless browser and a window behind other windows alike, and needs
neither the remote-control switch nor Accessibility.

Two things that matter and are easy to undo by accident:

* Runtime.enable is never sent. It is the classic tell that a page is being
  automated, and the box we are here for is the thing looking for tells.
  Runtime.evaluate works without it.
* A touch can only land inside the box being shown. The phone is handed a
  captcha, not a browser.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import secrets as _secrets
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

log = logging.getLogger("rac.captcha")

# The boxes we know by name. The first group are the widgets themselves (an
# iframe each); the second are the in-page sliders and puzzles some sites draw
# without one. A site nobody listed is what `selector` on the command is for.
FRAME_SELECTORS = [
    'iframe[src*="recaptcha/api2"]', 'iframe[src*="recaptcha/enterprise"]',
    'iframe[src*="hcaptcha.com"]', 'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="arkoselabs"]', 'iframe[src*="funcaptcha"]',
    'iframe[src*="captcha-delivery.com"]', 'iframe[src*="geo.captcha"]',
    'iframe[title*="captcha" i]', 'iframe[title*="challenge" i]',
]
PAGE_SELECTORS = [
    '.geetest_panel_box', '.geetest_box', '.geetest_holder', '#captcha-container',
    'awswaf-captcha', '.nc-container', '#nc_1_wrapper', '.tcaptcha-transform',
    '.captcha_verify_container', '[id*="captcha" i][class*="slider" i]',
]
# The token a solved widget leaves in the page. Seeing one is the surest sign
# the work is done, before the box has had time to go away.
TOKEN_JS = """(() => [...document.querySelectorAll(
  'textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],'
  + 'input[name="cf-turnstile-response"],input[name="g-recaptcha-response"]')]
  .some(e => (e.value || '').length > 20))()"""

#: How long a captcha is held open before the agent is told nobody came.
DEFAULT_TIMEOUT_S = 10 * 60
#: How often the page is looked at for the box going away.
WATCH_EVERY_S = 1.5
#: Looks in a row with no box before it counts as gone (a challenge reloads).
GONE_AFTER = 3
#: Room left around the box, in CSS pixels, so its edge can be touched.
PAD = 6
#: How long a box found on the page is trusted before it is looked for again.
BOX_FRESH_S = 0.6
#: Width of a frame the phone is sent, in image pixels.
FRAME_W = 900
QUALITY = 70


class CaptchaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ── finding the browser ──────────────────────────────────────────────────────

def debug_ports() -> list[int]:
    """Every DevTools port a browser on this machine is listening on.

    Read off the command lines of running browsers. A browser started with
    `--remote-debugging-port=0` picked its own port and wrote it in its
    profile's DevToolsActivePort, so that file is read for those."""
    try:
        out = subprocess.run(["ps", "-Ao", "args"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return []
    ports: list[int] = []
    for line in out.splitlines():
        m = re.search(r"--remote-debugging-port=(\d+)", line)
        if not m or "--type=" in line:
            continue
        port = int(m.group(1))
        if port == 0:
            d = re.search(r"--user-data-dir=(\S+)", line)
            try:
                port = int(Path(d.group(1)).joinpath("DevToolsActivePort").read_text().split()[0]) if d else 0
            except Exception:
                port = 0
        if port and port not in ports:
            ports.append(port)
    return ports


def pages(port: int) -> list[dict]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as r:
        return [t for t in json.load(r) if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]


# ── one page, over CDP ───────────────────────────────────────────────────────

class Page:
    """A DevTools connection to one tab. Only DOM, Page, Input and a bare
    Runtime.evaluate are ever sent."""

    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self.ws = None
        self.n = 0
        self.wait: dict[int, asyncio.Future] = {}
        self.pump_task: asyncio.Task | None = None
        self.lock = asyncio.Lock()          # one screenshot at a time

    async def connect(self) -> None:
        import websockets
        self.ws = await websockets.connect(self.ws_url, max_size=64 * 1024 * 1024, open_timeout=5)
        self.pump_task = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        try:
            async for raw in self.ws:
                m = json.loads(raw)
                f = self.wait.pop(m.get("id"), None)
                if f and not f.done():
                    f.set_result(m)
        except Exception:
            pass
        finally:
            for f in self.wait.values():
                if not f.done():
                    f.set_exception(CaptchaError("browser_gone", "the browser tab went away"))
            self.wait.clear()

    async def __call__(self, method: str, timeout: float = 15, **params) -> dict:
        if self.ws is None:
            raise CaptchaError("browser_gone", "not connected to the browser")
        self.n += 1
        f = asyncio.get_running_loop().create_future()
        self.wait[self.n] = f
        try:
            await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        except Exception:
            self.wait.pop(self.n, None)
            raise CaptchaError("browser_gone", "the browser tab went away")
        m = await asyncio.wait_for(f, timeout)
        if "error" in m:
            raise CaptchaError("cdp", f"{method}: {m['error'].get('message')}")
        return m["result"]

    async def close(self) -> None:
        if self.pump_task:
            self.pump_task.cancel()
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                pass
        self.ws = None

    async def viewport(self) -> dict:
        m = await self("Page.getLayoutMetrics")
        css = m.get("cssVisualViewport") or m.get("visualViewport") or {}
        dev = m.get("visualViewport") or css
        dpr = (dev.get("clientWidth") or 1) / (css.get("clientWidth") or 1)
        return {"w": css.get("clientWidth", 0), "h": css.get("clientHeight", 0),
                "px": css.get("pageX", 0), "py": css.get("pageY", 0), "dpr": max(1.0, dpr)}

    async def boxes(self, extra: str | None = None) -> list[dict]:
        """The captcha boxes on this page that can be seen right now, in
        viewport coordinates, the largest first. A challenge parked off-screen
        (reCAPTCHA keeps its picture grid at top:-9999 between rounds) is not
        one of them."""
        # One query for every known box, so a frame costs a handful of calls
        # rather than one per selector; a person's own selector goes on its
        # own, where a typo in it cannot take the known ones down with it.
        sels = ([extra] if extra else []) + [", ".join(FRAME_SELECTORS + PAGE_SELECTORS)]
        doc = await self("DOM.getDocument", depth=-1, pierce=True)
        root = doc["root"]["nodeId"]
        vp = await self.viewport()
        seen: set[int] = set()
        out: list[dict] = []
        for sel in sels:
            try:
                ids = (await self("DOM.querySelectorAll", nodeId=root, selector=sel))["nodeIds"]
            except CaptchaError:
                continue
            for nid in ids:
                if nid in seen:
                    continue
                seen.add(nid)
                try:
                    q = (await self("DOM.getBoxModel", nodeId=nid))["model"]["border"]
                except CaptchaError:
                    continue
                x, y = min(q[0::2]), min(q[1::2])
                w, h = max(q[0::2]) - x, max(q[1::2]) - y
                if w < 20 or h < 20:
                    continue
                if x + w <= 0 or y + h <= 0 or x >= vp["w"] or y >= vp["h"]:
                    continue
                out.append({"node": nid, "x": x, "y": y, "w": w, "h": h, "sel": sel})
        out.sort(key=lambda b: b["w"] * b["h"], reverse=True)
        return out

    async def solved_token(self) -> bool:
        try:
            r = await self("Runtime.evaluate", expression=TOKEN_JS, returnByValue=True, timeout=5)
            return bool((r.get("result") or {}).get("value"))
        except Exception:
            return False


# ── one captcha ──────────────────────────────────────────────────────────────

@dataclass
class Case:
    id: str
    chat_id: str | None
    port: int
    url: str
    title: str
    selector: str | None
    whole: bool
    page: Page
    box: dict | None = None          # what the last frame showed, viewport CSS px
    shown: dict[int, dict] = field(default_factory=dict)   # frame number -> its box
    seq: int = 0
    box_at: float = 0.0
    state: str = "open"              # open | solved | gone | cancelled | timeout
    created: float = field(default_factory=time.time)
    deadline: float = 0.0
    done: asyncio.Event = field(default_factory=asyncio.Event)
    watcher: asyncio.Task | None = None

    def public(self) -> dict:
        return {"id": self.id, "chat_id": self.chat_id, "url": self.url, "title": self.title,
                "state": self.state, "created": self.created, "deadline": self.deadline}


class Desk:
    """The captchas waiting for a person, and the hands that reach them."""

    def __init__(self, tell: Callable[[str, Case], Awaitable[None]]):
        self.cases: dict[str, Case] = {}
        self._tell = tell

    def get(self, cid: str) -> Case:
        c = self.cases.get(str(cid or ""))
        if c is None:
            raise CaptchaError("no_captcha", "that captcha is no longer waiting")
        return c

    def open_cases(self) -> list[dict]:
        return [c.public() for c in self.cases.values() if c.state == "open"]

    async def open(self, *, port: int | None = None, chat_id: str | None = None,
                   selector: str | None = None, url_match: str | None = None,
                   whole: bool = False, timeout_s: float = DEFAULT_TIMEOUT_S) -> Case:
        """Find the tab with the captcha and hold it for the phone."""
        ports = [port] if port else await asyncio.to_thread(debug_ports)
        if not ports:
            raise CaptchaError("no_browser", "no browser on this computer has a DevTools port open"
                               " (start it with --remote-debugging-port)")
        tried: list[str] = []
        for p in ports:
            try:
                tabs = await asyncio.to_thread(pages, p)
            except Exception as exc:
                tried.append(f"{p}: {exc}")
                continue
            if url_match:
                tabs = [t for t in tabs if url_match in (t.get("url") or "")]
            for t in tabs:
                pg = Page(t["webSocketDebuggerUrl"])
                try:
                    await pg.connect()
                    found = [] if whole else await pg.boxes(selector)
                except Exception as exc:
                    await pg.close()
                    tried.append(f"{p} {t.get('url', '')[:60]}: {exc}")
                    continue
                if not found and not (whole and (url_match or len(tabs) == 1)):
                    await pg.close()
                    continue
                c = Case(id=_secrets.token_hex(4), chat_id=chat_id, port=p, url=t.get("url", ""),
                         title=t.get("title", ""), selector=selector, whole=whole, page=pg,
                         deadline=time.time() + timeout_s)
                # A hidden tab answers everything but a screenshot, which hangs.
                try:
                    await pg("Page.bringToFront")
                    if found:
                        await pg("DOM.scrollIntoViewIfNeeded", nodeId=found[0]["node"])
                except CaptchaError:
                    pass
                self.cases[c.id] = c
                c.watcher = asyncio.create_task(self._watch(c))
                log.info("captcha %s opened on :%s %s (%s)", c.id, p, c.url[:80],
                         found[0]["sel"] if found else "whole page")
                await self._tell("open", c)
                return c
        detail = f" ({'; '.join(tried[:3])})" if tried else ""
        raise CaptchaError("no_captcha", f"no captcha box found on any open tab{detail}")

    async def _watch(self, c: Case) -> None:
        empty = 0
        try:
            while c.state == "open":
                await asyncio.sleep(WATCH_EVERY_S)
                if time.time() > c.deadline:
                    await self.finish(c.id, "timeout")
                    return
                if c.page.ws is None:
                    await self.finish(c.id, "gone")
                    return
                if await c.page.solved_token():
                    await self.finish(c.id, "solved")
                    return
                if c.whole:
                    continue
                try:
                    found = await c.page.boxes(c.selector)
                except CaptchaError as exc:
                    if exc.code == "browser_gone":
                        await self.finish(c.id, "gone")
                        return
                    found = []
                except Exception:
                    found = []
                empty = 0 if found else empty + 1
                if empty >= GONE_AFTER:
                    await self.finish(c.id, "solved")
                    return
        except asyncio.CancelledError:
            pass

    async def finish(self, cid: str, state: str) -> dict:
        c = self.cases.get(cid)
        if c is None or c.state != "open":
            return {"id": cid, "state": c.state if c else "unknown"}
        c.state = state
        c.done.set()
        if c.watcher and c.watcher is not asyncio.current_task():
            c.watcher.cancel()
        await c.page.close()
        log.info("captcha %s %s after %.0fs", c.id, state, time.time() - c.created)
        await self._tell("closed", c)
        # Kept a while so a late frame request is told why, then forgotten.
        asyncio.get_running_loop().call_later(120, self.cases.pop, cid, None)
        return c.public()

    async def wait(self, cid: str) -> dict:
        c = self.get(cid)
        await c.done.wait()
        return c.public()

    async def frame(self, cid: str, width: int = FRAME_W) -> dict:
        """The box as it is now, as a JPEG, and the box it was cut from."""
        c = self.get(cid)
        if c.state != "open":
            return {"state": c.state}
        async with c.page.lock:
            vp = await c.page.viewport()
            if c.whole:
                box = {"x": 0, "y": 0, "w": vp["w"], "h": vp["h"]}
            elif c.box and time.monotonic() - c.box_at < BOX_FRESH_S:
                box = c.box     # walking the whole DOM every frame halves the rate
            else:
                found = await c.page.boxes(c.selector)
                if found:
                    b = found[0]
                    x0, y0 = max(0, b["x"] - PAD), max(0, b["y"] - PAD)
                    x1, y1 = min(vp["w"], b["x"] + b["w"] + PAD), min(vp["h"], b["y"] + b["h"] + PAD)
                    box = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
                else:
                    box = c.box     # between rounds: the last place it was
                c.box_at = time.monotonic()
            if not box:
                return {"state": c.state, "waiting": True}
            scale = max(0.25, min(3.0, width / (box["w"] * vp["dpr"])))
            r = await c.page("Page.captureScreenshot", format="jpeg", quality=QUALITY,
                             clip={"x": box["x"] + vp["px"], "y": box["y"] + vp["py"],
                                   "width": box["w"], "height": box["h"], "scale": scale})
            c.box = box
            c.seq += 1
            c.shown[c.seq] = box
            c.shown.pop(c.seq - 12, None)
        return {"state": c.state, "jpeg": r["data"], "w": box["w"], "h": box["h"], "frame": c.seq}

    async def input(self, cid: str, actions: list[dict], frame: int | None = None) -> None:
        """Touches, in 0..1 across the box of the frame the person was looking
        at (the challenge can replace the checkbox between two frames, and a
        tap belongs to the picture it was made on). Nothing can land outside it."""
        c = self.get(cid)
        if c.state != "open":
            raise CaptchaError("closed", "that captcha is already done")
        box = c.shown.get(int(frame)) if frame else None
        box = box or c.box
        if not box:
            raise CaptchaError("no_frame", "no frame has been shown yet")

        def at(p) -> tuple[float, float]:
            nx = min(1.0, max(0.0, float(p[0])))
            ny = min(1.0, max(0.0, float(p[1])))
            return box["x"] + nx * box["w"], box["y"] + ny * box["h"]

        pg = c.page
        for a in actions[:20]:
            kind = a.get("type")
            if kind == "tap":
                x, y = at((a.get("x", 0), a.get("y", 0)))
                # A pointer that arrives from somewhere, the way a hand's does.
                for i in range(4):
                    await pg("Input.dispatchMouseEvent", type="mouseMoved",
                             x=x - 18 + i * 6, y=y - 8 + i * 2)
                    await asyncio.sleep(0.02)
                await pg("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
                         button="left", buttons=1, clickCount=1)
                await asyncio.sleep(0.07)
                await pg("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
                         button="left", buttons=0, clickCount=1)
            elif kind == "drag":
                pts = [p for p in (a.get("points") or []) if isinstance(p, (list, tuple)) and len(p) >= 2][:400]
                if len(pts) < 2:
                    continue
                x, y = at(pts[0])
                await pg("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
                await pg("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
                         button="left", buttons=1, clickCount=1)
                last_t = float(pts[0][2]) if len(pts[0]) > 2 else 0.0
                for p in pts[1:]:
                    t = float(p[2]) if len(p) > 2 else last_t + 16
                    await asyncio.sleep(min(0.2, max(0.0, (t - last_t) / 1000)))
                    last_t = t
                    x, y = at(p)
                    await pg("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y,
                             button="left", buttons=1)
                await pg("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
                         button="left", buttons=0, clickCount=1)
            elif kind == "text":
                text = str(a.get("text") or "")[:200]
                if text:
                    await pg("Input.insertText", text=text)
            elif kind == "key" and a.get("key") in ("Enter", "Backspace", "Tab"):
                k = a["key"]
                code = {"Enter": 13, "Backspace": 8, "Tab": 9}[k]
                for t in ("keyDown", "keyUp"):
                    await pg("Input.dispatchKeyEvent", type=t, key=k, code=k,
                             windowsVirtualKeyCode=code, nativeVirtualKeyCode=code,
                             **({"text": "\r"} if k == "Enter" and t == "keyDown" else {}))
            await asyncio.sleep(0.03)

    async def close_all(self) -> None:
        for cid in list(self.cases):
            await self.finish(cid, "cancelled")
