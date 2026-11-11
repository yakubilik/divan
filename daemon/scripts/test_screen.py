#!/usr/bin/env python3
"""The remote screen's keyboard, clipboard and control gate (divan/screen.py).

    python scripts/test_screen.py

A real `Server` over a temporary `DIVAN_HOME`, driven through a test client.
No network and no model turns. Nothing is clicked or typed for real: the
platform's event poster is swapped for a recorder. The clipboard is the one
real thing — on a Mac it is the actual pasteboard, saved first and put back
after.

The promises:

  1. Every letter, digit and common punctuation key is in both key tables,
     and ' ' is the space bar; ⌘R and ⌃Space no longer fail.
  2. screen.clipboard.set then screen.clipboard.get round-trips text; both are
     refused while remote control is off, for an unknown token, and when the
     text is too big.
  3. screen.input carries a click to the platform when control is on, and
     says why in words when the machine cannot take it.
  4. The gateway to a peer passes screen.input and the clipboard calls
     through untouched.
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import string
import sys
import tempfile
import time
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-screen-")
os.environ["DIVAN_HOME"] = HOME
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient                        # noqa: E402
from starlette.websockets import WebSocketDisconnect             # noqa: E402

from divan import fleet                                          # noqa: E402
from divan import screen                                         # noqa: E402
from divan.config import Config                                  # noqa: E402
from divan.server import Server                                  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def ws_call(client: TestClient, token: str, typ: str, data: dict | None = None) -> dict:
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_text(json.dumps({"id": 7, "type": typ, "data": data or {}}))
        while True:
            msg = json.loads(ws.receive_text())
            if msg.get("id") == 7:
                return msg


def ws_refusal(client: TestClient, token: str, typ: str, data: dict) -> object:
    """How a socket with this token fares asking for `typ`: its close code, or
    the answer if it was let in."""
    try:
        return ws_call(client, token, typ, data)
    except WebSocketDisconnect as exc:
        return exc.code


# ── 1 · the key tables ──────────────────────────────────────────────────────

def keys() -> None:
    print("── the key tables")
    wanted = list(string.ascii_lowercase) + list(string.digits) + list(screen.PUNCTUATION) + [" ", "space"]
    check(set(screen.PUNCTUATION) >= set("-=[]\\;',./`"), "the punctuation set is the US layout's eleven",
          repr(screen.PUNCTUATION))
    for name, table in (("Windows", screen.VK_WIN), ("macOS", screen.VK_MAC)):
        missing = [k for k in wanted if k not in table]
        check(not missing, f"{name}: every letter, digit, punctuation key and space is mapped", repr(missing))
        typed = [table[k] for k in wanted if k in table and k != "space"]
        check(len(set(typed)) == len(typed), f"{name}: no two of them share a key code",
              str(sorted(typed)))
        check(table[" "] == table["space"], f"{name}: ' ' is the space bar")
    check(screen.VK_WIN["r"] == 0x52 and screen.VK_WIN["0"] == 0x30 and screen.VK_WIN["/"] == 0xBF,
          "Windows codes are the VK_* values (r=0x52, 0=0x30, /=VK_OEM_2)")
    check(screen.VK_MAC["r"] == 0x0F and screen.VK_MAC["space"] == 0x31 and screen.VK_MAC["1"] == 0x12,
          "macOS codes are the kVK_ANSI_* values (r=0x0F, space=0x31, 1=0x12)")
    check(all(m in screen.VK_WIN for m in ("ctrl", "alt", "shift", "cmd", "win")),
          "Windows knows every modifier name a client sends, cmd included")
    check(screen.key_name(" ") == " " and screen.key_name("R") == "r" and screen.key_name("Slash") == "/",
          "key_name keeps a lone space, lowers letters and spells out punctuation",
          f"{screen.key_name(' ')!r} {screen.key_name('R')!r} {screen.key_name('Slash')!r}")

    # The actual action, through this platform's own code path, with the poster
    # swapped out: nothing is pressed on this machine.
    if sys.platform not in ("darwin", "win32"):
        print("  (skipping the live action check: no input backend on this platform)")
        return
    posted: list[object] = []
    if sys.platform == "darwin":
        real = screen._post

        def record(ev):
            posted.append(ev)
            screen._CF.CFRelease(ev)
        screen._post = record
    else:                                                        # pragma: no cover
        real = screen._send
        screen._send = lambda *evs: posted.extend(evs)
    try:
        for action, label in (({"kind": "key", "key": "r", "mods": ["cmd"]}, "⌘R"),
                              ({"kind": "key", "key": " ", "mods": ["ctrl"]}, "⌃Space"),
                              ({"kind": "key", "key": " "}, "a bare space"),
                              ({"kind": "key", "key": "/", "mods": ["cmd"]}, "⌘/"),
                              ({"kind": "key", "key": "7", "mods": ["shift"]}, "⇧7")):
            posted.clear()
            try:
                screen._do(action)
                check(len(posted) >= 2, f"{label} goes through as a key down and up", str(len(posted)))
            except screen.ScreenError as exc:
                check(False, f"{label} goes through as a key down and up", str(exc))
        try:
            screen._do({"kind": "key", "key": "nope"})
            check(False, "a key nobody has heard of is still refused")
        except screen.ScreenError as exc:
            check("unknown key" in str(exc), "a key nobody has heard of is still refused", str(exc))
    finally:
        if sys.platform == "darwin":
            screen._post = real
        else:                                                    # pragma: no cover
            screen._send = real


# ── 2 · the clipboard ───────────────────────────────────────────────────────

def clipboard(srv: Server, client: TestClient, tok: str) -> None:
    print("── the clipboard")
    srv.cfg.remote_control = False
    ans = ws_call(client, tok, "screen.clipboard.set", {"text": "hello"})
    check(ans["type"] == "error" and ans["data"]["code"] == "control_disabled",
          "set is refused while remote control is off", str(ans))
    ans = ws_call(client, tok, "screen.clipboard.get")
    check(ans["type"] == "error" and ans["data"]["code"] == "control_disabled",
          "get is refused while remote control is off", str(ans))

    srv.cfg.remote_control = True
    for typ in ("screen.clipboard.set", "screen.clipboard.get"):
        got = ws_refusal(client, "not-a-device-token", typ, {"text": "hello"})
        check(got == 4401, f"{typ} cannot be reached without an authenticated device", str(got))

    ans = ws_call(client, tok, "screen.clipboard.set", {"text": "x" * (screen.CLIPBOARD_MAX + 1)})
    check(ans["type"] == "error" and ans["data"]["code"] == "too_large", "too much text is refused", str(ans))
    ans = ws_call(client, tok, "screen.clipboard.set", {"text": {"file": "/etc/passwd"}})
    check(ans["type"] == "error" and ans["data"]["code"] == "bad_request", "only text is taken", str(ans))

    if sys.platform not in ("darwin", "win32"):
        print("  (skipping the round trip: no clipboard backend on this platform)")
        return
    saved = screen._clip_get_sync()
    try:
        # audit: language-data — letters outside ASCII the clipboard must carry intact
        text = f"divan clipboard · şğüİ 🌍\nline two {time.time()}"
        # audit: end-language-data
        ans = ws_call(client, tok, "screen.clipboard.set", {"text": text})
        check(ans["type"] == "ok" and ans["data"].get("chars") == len(text), "set takes the text", str(ans))
        ans = ws_call(client, tok, "screen.clipboard.get")
        got = (ans.get("data") or {}).get("text", "").replace("\r\n", "\n")
        check(ans["type"] == "ok" and got == text and ans["data"].get("truncated") is False,
              "get hands the same text back, non-ASCII and newlines included", repr(ans)[:200])
    finally:
        screen._clip_set_sync(saved)


# ── 3 · screen.input and the gate ───────────────────────────────────────────

def input_gate(srv: Server, client: TestClient, tok: str) -> None:
    print("── screen.input")
    acted: list[tuple[dict, object]] = []
    real_do, real_state = screen._do, screen._control_state
    screen._do = lambda action, d=None: acted.append((action, d))
    try:
        srv.cfg.remote_control = False
        ans = ws_call(client, tok, "screen.input", {"actions": [{"kind": "click", "x": 0.5, "y": 0.5}]})
        check(ans["type"] == "error" and ans["data"]["code"] == "control_disabled" and not acted,
              "a click with control off is refused, in words, and nothing is pressed", str(ans))

        srv.cfg.remote_control = True
        screen._control_state = lambda: (True, None)
        ans = ws_call(client, tok, "screen.input", {"actions": [
            {"kind": "down", "button": "left", "x": 0.25, "y": 0.75, "clicks": 1},
            {"kind": "up", "button": "left", "x": 0.25, "y": 0.75, "clicks": 1}]})
        check(ans["type"] == "ok" and [a["kind"] for a, _ in acted] == ["down", "up"]
              and acted[0][0]["x"] == 0.25, "a click with control on reaches the platform as down, up", str(acted))

        acted.clear()
        why = ("macOS has not granted this app Accessibility permission, so clicks would go "
               "nowhere — System Settings › Privacy & Security › Accessibility")
        screen._control_state = lambda: (False, why)
        ans = ws_call(client, tok, "screen.input", {"actions": [{"kind": "click", "x": 0.5, "y": 0.5}]})
        check(ans["type"] == "error" and ans["data"]["code"] == "control_unavailable"
              and "Accessibility" in ans["data"]["message"] and not acted,
              "a machine that cannot take a click says why instead of dropping it", str(ans))
        info = ws_call(client, tok, "screen.info")
        check(info["data"].get("control") is False and "Accessibility" in (info["data"].get("reason") or ""),
              "screen.info carries the same reason for the client to show", str(info)[:200])
    finally:
        screen._do, screen._control_state = real_do, real_state


# ── 4 · through the gateway ─────────────────────────────────────────────────

def gateway() -> None:
    print("── the gateway to a peer")
    for typ, data in (("screen.input", {"actions": [{"kind": "click", "x": 0.1, "y": 0.2}], "display": ""}),
                      ("screen.clipboard.set", {"text": "hello"}),
                      ("screen.clipboard.get", {}),
                      ("screen.info", {})):
        raw = json.dumps({"id": 3, "type": typ, "data": data})
        fwd, answer = fleet.filter_request(raw)
        check(fwd == raw and answer is None, f"{typ} is forwarded to the peer unchanged", f"{fwd} {answer}")


def main() -> None:
    keys()
    cfg = Config.load()
    _, tok = cfg.add_device("Yakup browser")
    srv = Server(Config.load())
    client = TestClient(srv.app)
    try:
        clipboard(srv, client, tok)
        input_gate(srv, client, tok)
    finally:
        client.close()
    gateway()
    print()
    if failures:
        print(f"{len(failures)} failed")
        sys.exit(1)
    print("all ok")


if __name__ == "__main__":
    main()
