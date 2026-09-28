#!/usr/bin/env python3
"""A notification body is English for every phone. No model turns, no network.

    python scripts/test_push.py

`PUSH_TEXT` (`server.py`) is keyed by the UI language a device reports at
`hello`. It used to carry a Turkish row next to the English one; the audit
removed it, which only holds if a device that asks for a language the table does
not have is *answered in English* rather than crashing or going silent. That is
the `PUSH_TEXT.get(d.lang, PUSH_TEXT["en"])` in `notify()`, and this is the
script that watches it happen for `lang="tr"`, for a language nobody has ever
sent, and for a device row old enough to carry no language at all.

Driven through the unbound `Server.notify`, like `test_pool.py` drives the pool:
constructing a real `Server` would open the daemon's own database. `send_push`
is replaced by a recorder, so nothing reaches Expo.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import remote_ai_chat.server as server_mod                      # noqa: E402
from remote_ai_chat.config import Device                         # noqa: E402
from remote_ai_chat.server import PUSH_TEXT, Server              # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


def device(did: str, lang: str | None) -> Device:
    """A paired phone that can take a push. `lang=None` is a row from before the field."""
    kw = {} if lang is None else {"lang": lang}
    return Device(id=did, name=f"phone-{did}", token_hash="x", created_at=0.0,
                  push_token=f"ExponentPushToken[{did}]", **kw)


def stub_host(devices: list[Device]):
    """The half of the server `notify` touches: the device list and the host name."""
    class Host:
        pass

    host = Host()
    host.cfg = type("Cfg", (), {"devices": {d.id: d for d in devices},
                                "host_name": "this-computer"})()
    host.notify = Server.notify.__get__(host)
    return host


async def bodies(devices: list[Device], kind: str) -> list[dict]:
    sent: list[dict] = []

    async def recorder(tokens, title, body, data=None):
        sent.append({"tokens": tokens, "title": title, "body": body, "data": data or {}})

    real, server_mod.send_push = server_mod.send_push, recorder
    try:
        await stub_host(devices).notify(kind, {"id": "c1", "title": "ledger · Fix it"})
    finally:
        server_mod.send_push = real
    return sent


async def main() -> None:
    print("the table is English and only English")
    check(list(PUSH_TEXT) == ["en"], "one row, 'en'", repr(list(PUSH_TEXT)))
    check(set(PUSH_TEXT["en"]) == {"approval", "done"}, "and it answers both kinds",
          repr(sorted(PUSH_TEXT["en"])))

    print("\na language the table does not carry is answered in English")
    english = PUSH_TEXT["en"]
    for lang, what in (("tr", "a language the table used to carry"),
                       ("de", "a language it never carried"),
                       ("en-GB", "a region tag"),
                       ("", "a phone that reported nothing"),
                       (None, "a device row from before the field existed")):
        for kind in ("approval", "done"):
            sent = await bodies([device("d1", lang)], kind)
            got = sent[0]["body"] if sent else None
            check(got == english[kind], f"lang={lang!r} · {kind} · {what}",
                  f"body={got!r} want={english[kind]!r}")

    print("\nand the rest of the notification is unchanged")
    sent = await bodies([device("d1", "tr")], "approval")
    check(len(sent) == 1, "one push", repr(sent))
    check(sent[0]["title"] == "ledger · Fix it", "the chat title is the title",
          repr(sent[0]["title"]))
    check(sent[0]["tokens"] == ["ExponentPushToken[d1]"], "to that device's token",
          repr(sent[0]["tokens"]))
    check(sent[0]["data"] == {"chat_id": "c1", "kind": "approval",
                              "device_id": "d1", "host_name": "this-computer"},
          "carrying the chat, the kind and which computer it came from",
          repr(sent[0]["data"]))

    print("\nevery phone is told, whatever language each one asked for")
    sent = await bodies([device("d1", "tr"), device("d2", "en"), device("d3", "fr")], "done")
    check([s["body"] for s in sent] == [english["done"]] * 3,
          "three phones, three English bodies", repr([s["body"] for s in sent]))

    print("\nand the switches still decide who is told at all")
    off = device("d1", "tr")
    off.push_approval = False
    check(await bodies([off], "approval") == [], "approvals off means no push")
    off.push_done = False
    check(await bodies([off], "done") == [], "done off means no push")
    no_token = device("d2", "tr")
    no_token.push_token = None
    check(await bodies([no_token], "done") == [], "no push token means no push")

    print(f"\n{'all good' if not failures else str(len(failures)) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
