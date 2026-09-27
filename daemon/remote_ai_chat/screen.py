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
import os
import platform
import subprocess
import tempfile
import shutil
import sys
import time

log = logging.getLogger("rac.screen")

if sys.platform == "darwin" and shutil.which("screencapture") is None:
    # Pillow grabs a Mac screen by shelling out to `screencapture`, which lives
    # in /usr/sbin — on PATH in a terminal and not on PATH under launchd. A
    # daemon that starts at login would otherwise report "the screen could not
    # be captured: [Errno 2]" forever, which is a true sentence about the wrong
    # problem.
    os.environ["PATH"] = (os.environ.get("PATH", "") + ":/usr/sbin").lstrip(":")

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


def _grab_mac() -> "Image.Image":                               # noqa: F821
    """A Mac frame, with the pointer in it.

    Pillow shells out to `screencapture` too, but without -C — so every frame
    it returns has no cursor, and a screen you cannot see the pointer on is a
    screen you cannot aim at. Worth the twenty lines on its own; asking for
    JPEG instead of PNG on the way out then turns out to cut the whole grab
    from about 0.35s to about 0.14s, which is the difference between three
    frames a second and seven.
    """
    from PIL import Image
    fd, path = tempfile.mkstemp(".jpg")
    os.close(fd)
    try:
        rc = subprocess.call(["screencapture", "-x", "-C", "-t", "jpg", path])
        if rc != 0:
            raise ScreenError(f"screencapture refused to take a picture (exit {rc})")
        img = Image.open(path)
        img.load()
        return img
    except FileNotFoundError as exc:
        raise ScreenError(f"screencapture is not on PATH: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _grab_sync(max_w: int, quality: int) -> tuple[bytes, dict]:
    try:
        from PIL import ImageGrab
    except Exception as exc:                                    # pragma: no cover
        raise ScreenError(f"Pillow is not available: {exc}") from exc
    try:
        img = _grab_mac() if sys.platform == "darwin" else ImageGrab.grab()
    except ScreenError:
        raise
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
# Windows and macOS. The rest of the file works anywhere Pillow can grab a
# screen, so looking is cross-platform even where touching is not — which is
# the right way round: a read-only view is the half people actually need.
#
# Both platforms are reached through ctypes rather than a package, for the
# reason at the top of the file: this daemon has to work on a machine where
# nobody can install anything. Windows is SendInput, macOS is Quartz, and
# neither needs a wheel of someone else's abstraction over forty lines.

def available() -> dict:
    """What this machine can actually do, so a client can say so up front.

    Looking and touching are asked separately because on most machines the
    answers differ, and a client that knows which half it has can say
    "view only" rather than letting somebody tap at a picture.
    """
    can_see, why = True, None
    try:
        from PIL import ImageGrab       # noqa: F401
    except Exception:
        can_see, why = False, "Pillow is not installed"

    can_touch, refusal = _control_state()
    return {
        "view": can_see,
        "control": can_touch,
        "os": platform.system(),
        # Whichever half is missing is the half worth explaining, and capture
        # comes first: a screen nobody can see cannot be driven either.
        "reason": why or refusal,
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


    def _control_state() -> tuple[bool, str | None]:
        return True, None


elif sys.platform == "darwin":
    import ctypes

    # Quartz, through the umbrella framework that exports it. Loading this
    # costs nothing on a Mac and the symbols below are the whole of what a
    # pointer and a keyboard need.
    try:
        _AS = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
        _CF = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    except OSError as _exc:                                      # pragma: no cover
        _AS = _CF = None
        log.warning("Quartz could not be loaded, so this Mac is view-only: %s", _exc)

    class _CGPoint(ctypes.Structure):
        _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

    class _CGSize(ctypes.Structure):
        _fields_ = [("width", ctypes.c_double), ("height", ctypes.c_double)]

    class _CGRect(ctypes.Structure):
        _fields_ = [("origin", _CGPoint), ("size", _CGSize)]

    if _AS is not None:
        _AS.CGMainDisplayID.restype = ctypes.c_uint32
        _AS.CGDisplayBounds.restype = _CGRect
        _AS.CGDisplayBounds.argtypes = [ctypes.c_uint32]
        _AS.CGEventCreate.restype = ctypes.c_void_p
        _AS.CGEventCreate.argtypes = [ctypes.c_void_p]
        _AS.CGEventGetLocation.restype = _CGPoint
        _AS.CGEventGetLocation.argtypes = [ctypes.c_void_p]
        _AS.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        _AS.CGEventCreateMouseEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, _CGPoint, ctypes.c_uint32]
        _AS.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        _AS.CGEventCreateKeyboardEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
        _AS.CGEventKeyboardSetUnicodeString.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_uint16)]
        _AS.CGEventSetType.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        _AS.CGEventSetFlags.argtypes = [ctypes.c_void_p, ctypes.c_uint64]
        _AS.CGEventSetIntegerValueField.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int64]
        _AS.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        _AS.AXIsProcessTrusted.restype = ctypes.c_bool
        _CF.CFRelease.argtypes = [ctypes.c_void_p]

    # The constants, named rather than pasted at the call sites.
    _TAP_HID = 0                        # kCGHIDEventTap: in front of everything
    _EV = {"move": 5, "scroll": 22, "keydown": 10, "keyup": 11}
    # Per button: the down, up and dragged event a Mac expects. A drag that
    # posts MouseMoved instead of LeftMouseDragged does nothing at all in most
    # apps, which is why the pressed set below exists.
    _BTN = {"left": (0, 1, 2, 6), "right": (1, 3, 4, 7), "middle": (2, 25, 26, 27)}
    _F_CLICK_STATE = 1                  # kCGMouseEventClickState
    _F_SCROLL_AXIS1 = 11                # vertical, in lines
    _F_SCROLL_AXIS2 = 12                # horizontal, in lines
    _F_SCROLL_CONTINUOUS = 88           # 0 = wheel notches, not a trackpad

    # Modifier masks. `ctrl` stays Control and does not quietly become Command:
    # ^C in a terminal is the reason somebody reaches for their phone in the
    # first place, and a copy they did not ask for is no substitute.
    FLAGS = {
        "shift": 0x00020000,
        "ctrl": 0x00040000, "control": 0x00040000,
        "alt": 0x00080000, "option": 0x00080000,
        "cmd": 0x00100000, "command": 0x00100000, "win": 0x00100000,
    }

    # Virtual keycodes (kVK_*). Same names as the Windows table above, so a
    # client never has to know which machine it is driving.
    VK = {
        "enter": 0x24, "return": 0x24, "tab": 0x30, "escape": 0x35, "esc": 0x35,
        "backspace": 0x33, "delete": 0x75, "space": 0x31,
        "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
        "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
        "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
        "a": 0x00, "c": 0x08, "v": 0x09, "x": 0x07, "z": 0x06, "s": 0x01, "w": 0x0D,
    }

    # Which buttons a client is currently holding down, so a move in between
    # becomes a drag. One screen, one pointer, so one set for the process.
    _pressed: set[str] = set()

    def _control_state() -> tuple[bool, str | None]:
        """macOS asks twice: once to see the screen, once to touch it.

        Accessibility is checked on every call rather than cached, because the
        answer changes the moment somebody ticks the box in System Settings and
        nobody should have to restart a daemon to be believed.
        """
        if _AS is None:                                           # pragma: no cover
            return False, "Quartz could not be loaded on this Mac"
        if not _AS.AXIsProcessTrusted():
            return False, ("macOS has not granted this app Accessibility permission, "
                           "so clicks would go nowhere — System Settings › Privacy & "
                           "Security › Accessibility")
        return True, None

    def _post(ev: int | None) -> None:
        """Send one event and let go of it."""
        if not ev:
            raise ScreenError("the event could not be created")
        try:
            _AS.CGEventPost(_TAP_HID, ev)
        finally:
            _CF.CFRelease(ev)

    def _point(nx: float, ny: float) -> _CGPoint:
        """Normalised 0..1 onto the main display, in points.

        Read fresh every time instead of cached: the bounds change when the
        resolution does, and this is one C call. Points, not pixels — Quartz
        places a pointer in the global display space, so a Retina screen
        captured at 2880 wide is still driven at 1440, and no client has to
        know which of those numbers is real.
        """
        b = _AS.CGDisplayBounds(_AS.CGMainDisplayID())
        x = b.origin.x + max(0.0, min(1.0, nx)) * max(0.0, b.size.width - 1)
        y = b.origin.y + max(0.0, min(1.0, ny)) * max(0.0, b.size.height - 1)
        return _CGPoint(x, y)

    def _cursor() -> _CGPoint:
        """Where the pointer is now — for an action that arrived without one."""
        ev = _AS.CGEventCreate(None)
        try:
            return _AS.CGEventGetLocation(ev)
        finally:
            if ev:
                _CF.CFRelease(ev)

    def _at(action: dict) -> _CGPoint:
        if "x" in action and "y" in action:
            return _point(float(action["x"]), float(action["y"]))
        return _cursor()

    def _mouse(etype: int, at: _CGPoint, button: int, clicks: int = 0) -> int | None:
        ev = _AS.CGEventCreateMouseEvent(None, etype, at, button)
        if ev and clicks:
            # Without this a Mac sees two separate clicks where a double-click
            # was meant, and nothing opens.
            _AS.CGEventSetIntegerValueField(ev, _F_CLICK_STATE, clicks)
        return ev

    def _type_text(text: str) -> None:
        """Type a string as text rather than as keys.

        One event per character: a single event carrying a long string is
        dropped by some apps without saying so, and what arrives here is a
        phone keyboard — a word at a time at the very most.
        """
        for ch in text:
            units = ch.encode("utf-16-le")
            buf = (ctypes.c_uint16 * (len(units) // 2)).from_buffer_copy(units)
            for down in (True, False):
                ev = _AS.CGEventCreateKeyboardEvent(None, 0, down)
                if not ev:
                    raise ScreenError("the keyboard event could not be created")
                _AS.CGEventKeyboardSetUnicodeString(ev, len(buf), buf)
                _post(ev)

    def _do(action: dict) -> None:
        if _AS is None:                                           # pragma: no cover
            raise ScreenError("Quartz could not be loaded on this Mac")
        kind = action.get("kind")
        name = str(action.get("button", "left"))
        button, down_ev, up_ev, drag_ev = _BTN.get(name, _BTN["left"])

        if kind == "move":
            # A move while a button is held is a drag, and has to be posted as
            # one. Whichever button went down first wins; there is one pointer.
            held = next((b for b in ("left", "right", "middle") if b in _pressed), None)
            if held:
                b, _, _, drag = _BTN[held]
                _post(_mouse(drag, _at(action), b))
            else:
                _post(_mouse(_EV["move"], _at(action), 0))

        elif kind == "down":
            _pressed.add(name)
            _post(_mouse(down_ev, _at(action), button, clicks=1))

        elif kind == "up":
            _pressed.discard(name)
            _post(_mouse(up_ev, _at(action), button, clicks=1))

        elif kind in ("click", "double"):
            at = _at(action)
            _post(_mouse(down_ev, at, button, clicks=1))
            _post(_mouse(up_ev, at, button, clicks=1))
            if kind == "double":
                _post(_mouse(down_ev, at, button, clicks=2))
                _post(_mouse(up_ev, at, button, clicks=2))

        elif kind == "scroll":
            # Deltas arrive in Windows wheel notches, 120 to the notch, because
            # that is what a wheel produces and the client banks them into whole
            # ones. A Mac counts in lines, and three is what one notch scrolls
            # everywhere else.
            lines_y = round(int(action.get("dy") or 0) / 120) * 3
            lines_x = round(int(action.get("dx") or 0) / 120) * 3
            if not (lines_y or lines_x):
                return
            if "x" in action:
                _post(_mouse(_EV["move"], _at(action), 0))
            ev = _AS.CGEventCreate(None)
            if not ev:
                raise ScreenError("the scroll event could not be created")
            # Built by hand rather than with CGEventCreateScrollWheelEvent,
            # which is variadic — and a variadic call through ctypes is a
            # different thing on Apple silicon than it is anywhere else.
            _AS.CGEventSetType(ev, _EV["scroll"])
            _AS.CGEventSetIntegerValueField(ev, _F_SCROLL_CONTINUOUS, 0)
            _AS.CGEventSetIntegerValueField(ev, _F_SCROLL_AXIS1, lines_y)
            # Axis 2 counts the other way round from a Windows wheel: positive
            # there scrolls the view right, positive here scrolls it left.
            _AS.CGEventSetIntegerValueField(ev, _F_SCROLL_AXIS2, -lines_x)
            _post(ev)

        elif kind == "key":
            key = str(action.get("key", "")).lower()
            code = VK.get(key)
            if code is None:
                raise ScreenError(f"unknown key: {key}")
            flags = 0
            for mod in (action.get("mods") or []):
                flags |= FLAGS.get(str(mod).lower(), 0)
            for pressed in (True, False):
                ev = _AS.CGEventCreateKeyboardEvent(None, code, pressed)
                if not ev:
                    raise ScreenError("the keyboard event could not be created")
                if flags:
                    # Set on the event rather than posted as separate modifier
                    # presses: the app reads the flags off the keystroke, and
                    # a modifier left hanging by a dropped event is worse than
                    # a keystroke that never lands.
                    _AS.CGEventSetFlags(ev, flags)
                _post(ev)

        elif kind == "text":
            _type_text(str(action.get("text", ""))[:4096])

        else:
            raise ScreenError(f"unknown action: {kind}")

else:                                                            # pragma: no cover
    def _control_state() -> tuple[bool, str | None]:
        return False, "clicking is only implemented on Windows and macOS so far"

    def _do(action: dict) -> None:
        raise ScreenError("clicking is only implemented on Windows and macOS so far")


async def act(action: dict) -> None:
    """Perform one pointer or keyboard action. Blocking, so it goes to a thread."""
    await asyncio.to_thread(_do, action)
