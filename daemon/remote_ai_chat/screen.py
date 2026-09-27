"""Seeing the computer's screen, and clicking on it.

The agent can already run anything on this machine, but there are things no
agent can do for you: a dialog that wants a real click, a browser sign-in, an
installer that asks a question no tool has an answer for. Until now the only way
through was to walk to the machine. This is the other way.

It is not AnyDesk and is not trying to be. There is no audio, no clipboard sync,
no file transfer and no second monitor. It is a few frames a second and a
pointer — enough to press Allow and get out, and deliberately not enough to
tempt anyone into working this way.

Why it is written here instead of installed: every VNC server on Windows wants
an administrator to install it, and this daemon runs on machines where nobody
has one. Capture is Pillow (already a dependency) and input is the Win32 API
through ctypes, so nothing new has to be installed for this to work at all.

The permission model is the one thing worth reading twice. Control is off until
somebody turns it on, the switch lives in config.toml so it survives nothing
being connected, and while it is on every connected device is told so — a
machine that can be driven remotely should never be quiet about it.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import platform
import sys
import time

log = logging.getLogger("rac.screen")

# Frames are re-encoded on every grab, so the cost is paid per frame and the
# defaults matter. 1280 is legible on a phone held in two hands; JPEG 55 is
# where a screenshot of text stops looking chewed.
MAX_W = 1280
QUALITY = 55
# A floor under the interval between grabs. Capturing is the expensive half and
# it happens on a worker thread, but there is one screen and no point in two
# clients fighting over it faster than either can draw.
MIN_INTERVAL_S = 0.08


class ScreenError(RuntimeError):
    """Something this platform or this machine cannot do."""


# ── capture ──────────────────────────────────────────────────────────────────

_last_grab: tuple[float, bytes, dict] | None = None
_grab_lock = asyncio.Lock()


def _grab_sync(max_w: int, quality: int) -> tuple[bytes, dict]:
    try:
        from PIL import ImageGrab
    except Exception as exc:                                    # pragma: no cover
        raise ScreenError(f"Pillow is not available: {exc}") from exc
    try:
        img = ImageGrab.grab()
    except Exception as exc:
        # Headless Linux, a locked Windows session, a Mac that has not been
        # given Screen Recording permission: all land here, and all of them
        # mean the same thing to whoever is holding the phone.
        raise ScreenError(f"the screen could not be captured: {exc}") from exc

    full_w, full_h = img.size
    if max_w and full_w > max_w:
        img = img.convert("RGB").resize((max_w, round(full_h * max_w / full_w)))
    elif img.mode != "RGB":
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=False)
    # `width`/`height` are the frame; `screen_w`/`screen_h` are the desktop it
    # was taken from. A click arrives normalised, so only the second pair is
    # ever used to place it — but the first is what the client lays out with.
    meta = {"width": img.size[0], "height": img.size[1],
            "screen_w": full_w, "screen_h": full_h, "ts": time.time()}
    return buf.getvalue(), meta


async def grab(max_w: int = MAX_W, quality: int = QUALITY) -> tuple[bytes, dict]:
    """One frame, as JPEG bytes plus what it is a picture of.

    Two clients asking at once get the same frame rather than two captures:
    the screen does not change between them, and grabbing is the part that
    costs something.
    """
    global _last_grab
    async with _grab_lock:
        now = time.time()
        if _last_grab and now - _last_grab[0] < MIN_INTERVAL_S:
            _, data, meta = _last_grab
            return data, meta
        data, meta = await asyncio.to_thread(_grab_sync, max_w, quality)
        _last_grab = (now, data, meta)
        return data, meta


async def grab_b64(max_w: int = MAX_W, quality: int = QUALITY) -> dict:
    """A frame shaped for the websocket, where bytes cannot travel as bytes."""
    data, meta = await grab(max_w, quality)
    return {**meta, "jpeg_b64": base64.b64encode(data).decode("ascii"), "bytes": len(data)}


# ── input ────────────────────────────────────────────────────────────────────
# Windows only for now. The rest of the file works anywhere Pillow can grab a
# screen, so looking is cross-platform even where touching is not — which is
# the right way round: a read-only view is the half people actually need.

def available() -> dict:
    """What this machine can actually do, so a client can say so up front."""
    can_see = True
    why: str | None = None
    try:
        from PIL import ImageGrab       # noqa: F401
    except Exception:
        can_see, why = False, "Pillow is not installed"
    return {
        "view": can_see,
        "control": sys.platform == "win32",
        "os": platform.system(),
        "reason": why or (None if sys.platform == "win32"
                          else "clicking is only implemented on Windows so far"),
    }


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.WinDLL("user32", use_last_error=True)

    # SendInput's structures. Written out rather than pulled from a package
    # because a package for this is three hundred lines of someone else's
    # abstraction over the forty below.
    INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
    MOUSEEVENTF = {
        "move": 0x0001, "absolute": 0x8000,
        "ldown": 0x0002, "lup": 0x0004,
        "rdown": 0x0008, "rup": 0x0010,
        "mdown": 0x0020, "mup": 0x0040,
        "wheel": 0x0800, "hwheel": 0x1000,
    }
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004

    class _MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                    ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG))]

    class _KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                    ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG))]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("mi", _MOUSEINPUT), ("ki", _KEYBDINPUT)]

    class _INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    def _send(*events: _INPUT) -> None:
        n = len(events)
        arr = (_INPUT * n)(*events)
        sent = _user32.SendInput(n, arr, ctypes.sizeof(_INPUT))
        if sent != n:
            raise ScreenError(f"SendInput was refused (error {ctypes.get_last_error()})")

    def _mouse(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> _INPUT:
        return _INPUT(type=INPUT_MOUSE,
                      u=_INPUTUNION(mi=_MOUSEINPUT(dx, dy, data & 0xFFFFFFFF, flags, 0, None)))

    def _key(vk: int, up: bool = False) -> _INPUT:
        return _INPUT(type=INPUT_KEYBOARD,
                      u=_INPUTUNION(ki=_KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP if up else 0, 0, None)))

    def _char(ch: str, up: bool = False) -> _INPUT:
        flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
        return _INPUT(type=INPUT_KEYBOARD,
                      u=_INPUTUNION(ki=_KEYBDINPUT(0, ord(ch), flags, 0, None)))

    def _move_to(nx: float, ny: float) -> _INPUT:
        # Absolute mouse coordinates are 0..65535 across the *virtual* desktop,
        # not across one monitor. Normalised input maps onto it directly, which
        # is also why the client never needs to know the resolution.
        x = max(0, min(65535, round(nx * 65535)))
        y = max(0, min(65535, round(ny * 65535)))
        return _mouse(MOUSEEVENTF["move"] | MOUSEEVENTF["absolute"], x, y)

    # The keys worth naming. Anything not here is sent as text, which is what
    # a phone keyboard produces anyway.
    VK = {
        "enter": 0x0D, "return": 0x0D, "tab": 0x09, "escape": 0x1B, "esc": 0x1B,
        "backspace": 0x08, "delete": 0x2E, "space": 0x20,
        "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
        "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
        "ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B,
        "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f5": 0x74, "f6": 0x75,
        "f7": 0x76, "f8": 0x77, "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
        "a": 0x41, "c": 0x43, "v": 0x56, "x": 0x58, "z": 0x5A, "s": 0x53, "w": 0x57,
    }

    BUTTONS = {"left": ("ldown", "lup"), "right": ("rdown", "rup"), "middle": ("mdown", "mup")}

    def _do(action: dict) -> None:
        kind = action.get("kind")

        if kind == "move":
            _send(_move_to(float(action["x"]), float(action["y"])))

        elif kind in ("down", "up", "click", "double"):
            down, up = BUTTONS.get(action.get("button", "left"), BUTTONS["left"])
            events = [_move_to(float(action["x"]), float(action["y"]))] if "x" in action else []
            if kind == "down":
                events.append(_mouse(MOUSEEVENTF[down]))
            elif kind == "up":
                events.append(_mouse(MOUSEEVENTF[up]))
            else:
                events += [_mouse(MOUSEEVENTF[down]), _mouse(MOUSEEVENTF[up])]
                if kind == "double":
                    events += [_mouse(MOUSEEVENTF[down]), _mouse(MOUSEEVENTF[up])]
            _send(*events)

        elif kind == "scroll":
            events = [_move_to(float(action["x"]), float(action["y"]))] if "x" in action else []
            dy = int(action.get("dy") or 0)
            dx = int(action.get("dx") or 0)
            if dy:
                events.append(_mouse(MOUSEEVENTF["wheel"], data=dy))
            if dx:
                events.append(_mouse(MOUSEEVENTF["hwheel"], data=dx))
            if events:
                _send(*events)

        elif kind == "key":
            name = str(action.get("key", "")).lower()
            vk = VK.get(name)
            if vk is None:
                raise ScreenError(f"unknown key: {name}")
            mods = [VK[m] for m in (action.get("mods") or []) if m in VK]
            events = [_key(m) for m in mods] + [_key(vk), _key(vk, up=True)]
            events += [_key(m, up=True) for m in reversed(mods)]
            _send(*events)

        elif kind == "text":
            text = str(action.get("text", ""))[:4096]
            if not text:
                return
            # One SendInput per character pair: a single call with a few
            # thousand events is refused, and the failure is silent.
            for ch in text:
                _send(_char(ch), _char(ch, up=True))

        else:
            raise ScreenError(f"unknown action: {kind}")

else:                                                            # pragma: no cover
    def _do(action: dict) -> None:
        raise ScreenError("clicking is only implemented on Windows so far")


async def act(action: dict) -> None:
    """Perform one pointer or keyboard action. Blocking, so it goes to a thread."""
    await asyncio.to_thread(_do, action)
