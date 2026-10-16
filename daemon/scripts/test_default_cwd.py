#!/usr/bin/env python3
"""One folder for every new chat nobody gave one: the computer decides it.

    python scripts/test_default_cwd.py

A real `Server` over a temporary `DIVAN_HOME` and a temporary root with
`DevTrace-main` first in it; two paired devices, a phone and the web panel. No
network and no model turns. The promises:

  1. With nothing set, the default folder is the first root: `host.info` says
     so (`default_cwd`, `default_cwd_chosen: false`) and `chat.create` without
     a cwd opens there — never the first folder of a sorted list.
  2. `host.default_cwd` from one device sets it: written to config.toml, told
     to every client as `host.status`, read back by the other device's
     `host.info`, and `chat.create` without a cwd from either device opens
     there. A demo machine's chat.create uses it too.
  3. An explicit cwd still wins — what an old phone build that sends its own
     folder relies on.
  4. A folder outside the roots, or not there, is refused and changes nothing;
     an empty cwd goes back to the first root; existing chats are not moved.
  5. A chosen folder that later disappears falls back to the first root rather
     than failing every new chat.
"""
from __future__ import annotations

import asyncio
import atexit
import os
import shutil
import sys
import tempfile
import tomllib
from pathlib import Path

HOME = tempfile.mkdtemp(prefix="divan-default-cwd-")
os.environ["DIVAN_HOME"] = str(Path(HOME) / "home")
os.environ["USTABASI_STATE_DIR"] = str(Path(HOME) / "nowhere")
atexit.register(shutil.rmtree, HOME, ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import config as configmod                            # noqa: E402
from divan.config import Config                                  # noqa: E402
from divan.server import Server                                  # noqa: E402

failures: list[str] = []
ROOT = (Path(HOME) / "projects").resolve()
DEVTRACE, QUIRE, ZETA = (str(ROOT / n) for n in ("DevTrace-main", "quire", "zeta"))


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


async def refused(coro) -> str | None:
    try:
        await coro
    except Exception as exc:                       # noqa: BLE001
        return getattr(exc, "code", None) or str(exc)
    return None


def stored() -> str:
    return tomllib.loads(configmod.CONFIG_PATH.read_text()).get("default_cwd", "")


async def main() -> None:
    for p in (DEVTRACE, QUIRE, ZETA):
        Path(p).mkdir(parents=True, exist_ok=True)
    cfg = Config.load()
    cfg.allowed_roots = [str(ROOT)]
    cfg.auto_update = False
    phone, _ = cfg.add_device("phone")
    web, _ = cfg.add_device("web panel")
    cfg.save()
    srv = Server(Config.load())
    phone, web = srv.cfg.devices[phone.id], srv.cfg.devices[web.id]
    heard: list[dict] = []
    real = srv.broadcast

    async def broadcast(ev: dict) -> None:
        heard.append(ev)
        await real(ev)
    srv.broadcast = broadcast
    srv.sessions.broadcast = broadcast

    print("\nnothing set")
    info = await srv.h_host_info(phone, {})
    check(info["default_cwd"] == str(ROOT) and info["default_cwd_chosen"] is False,
          "host.info names the first root as the default, not chosen", repr(info.get("default_cwd")))
    chat = await srv.h_chat_create(phone, {"provider": "claude"})
    check(chat["cwd"] == str(ROOT), "chat.create without a cwd opens in the first root, not DevTrace-main",
          chat["cwd"])
    first = chat["id"]

    print("\nset from the phone, read by the web")
    heard.clear()
    r = await srv.h_host_default_cwd(phone, {"cwd": QUIRE})
    check(r == {"cwd": QUIRE, "chosen": True}, "host.default_cwd answers the folder it set", repr(r))
    check(stored() == QUIRE, "written to config.toml", stored())
    told = [e for e in heard if e["event"] == "host.status"]
    check(len(told) == 1 and told[0]["data"]["default_cwd"] == QUIRE
          and told[0]["data"]["default_cwd_chosen"] is True,
          "every client is told as host.status carrying the new default", repr(told))
    info = await srv.h_host_info(web, {})
    check(info["default_cwd"] == QUIRE, "the web's host.info reads the phone's choice", info["default_cwd"])
    a = await srv.h_chat_create(phone, {"provider": "claude"})
    b = await srv.h_chat_create(web, {"provider": "claude"})
    check(a["cwd"] == b["cwd"] == QUIRE, "chat.create without a cwd from either device opens there",
          f"{a['cwd']} / {b['cwd']}")
    check(await srv.h_host_default_cwd(web, {}) == {"cwd": QUIRE, "chosen": True},
          "host.default_cwd with no cwd only reads")

    print("\nset from the web, read by the phone")
    await srv.h_host_default_cwd(web, {"cwd": ZETA})
    info = await srv.h_host_info(phone, {})
    check(info["default_cwd"] == ZETA, "the phone's host.info reads the web's choice", info["default_cwd"])
    c = await srv.h_chat_create(phone, {"provider": "claude"})
    check(c["cwd"] == ZETA, "the phone's next chat without a cwd opens there", c["cwd"])

    print("\nan explicit folder wins")
    d = await srv.h_chat_create(phone, {"provider": "claude", "cwd": DEVTRACE})
    check(d["cwd"] == DEVTRACE, "an explicit cwd (an old phone build, a picked folder) still wins", d["cwd"])

    print("\nrefusals")
    outside = tempfile.mkdtemp(prefix="divan-outside-")
    try:
        heard.clear()
        code = await refused(srv.h_host_default_cwd(phone, {"cwd": outside}))
        check(code == "cwd_outside", "a folder outside the roots is refused", repr(code))
        code = await refused(srv.h_host_default_cwd(phone, {"cwd": str(ROOT / "gone")}))
        check(code == "no_such_folder", "a folder that is not there is refused", repr(code))
        check(srv.cfg.default_cwd == ZETA and stored() == ZETA and not heard,
              "a refusal changes nothing and tells nobody", srv.cfg.default_cwd)
    finally:
        shutil.rmtree(outside, ignore_errors=True)
    r = await srv.h_host_default_cwd(phone, {"cwd": None})
    check(r == {"cwd": str(ROOT), "chosen": False} and stored() == "",
          "an empty cwd goes back to the first root", repr(r))
    check(srv.db.get_chat(first)["cwd"] == str(ROOT) and srv.db.get_chat(c["id"])["cwd"] == ZETA,
          "existing chats are not moved by a new default")

    print("\na chosen folder that disappears")
    gone = ROOT / "temporary"
    gone.mkdir()
    await srv.h_host_default_cwd(phone, {"cwd": str(gone)})
    gone.rmdir()
    info = await srv.h_host_info(phone, {})
    e = await srv.h_chat_create(web, {"provider": "claude"})
    check(info["default_cwd"] == str(ROOT) and e["cwd"] == str(ROOT),
          "falls back to the first root instead of failing", f"{info['default_cwd']} / {e['cwd']}")

    print("\na demo machine")
    await srv.h_host_default_cwd(phone, {"cwd": QUIRE})
    srv.cfg.demo = True
    try:
        f = await srv.h_chat_create(web, {"provider": "claude"})
        check(f["cwd"] == QUIRE, "a demo chat without a cwd opens in the same default", f["cwd"])
    finally:
        srv.cfg.demo = False
    await srv.sessions.close_all()


if __name__ == "__main__":
    asyncio.run(main())
    print()
    if failures:
        print(f"{len(failures)} failed")
        sys.exit(1)
    print("all passed")
