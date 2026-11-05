#!/usr/bin/env python3
"""A key an agent shares reaches the phone's clipboard on a tap, for an hour, and
nowhere else. No network, no real keychain.

    python scripts/test_secret_share.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from divan import secret_share, security  # noqa: E402
from divan.db import DB  # noqa: E402

failed: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail and not ok else ""))
    if not ok:
        failed.append(label)


def tokens() -> None:
    print("\nthe token")
    t = secret_share.token("rac-secret-openai-prod", "OpenAI key")
    check(t == "[secret-share rac-secret-openai-prod OpenAI key]", "token is service plus label", t)
    m = secret_share.TOKEN.search(f"al bunu: {t} tamam")
    check(m is not None and m.group(1) == "rac-secret-openai-prod" and m.group(2) == "OpenAI key",
          "the app's pattern reads it back")
    check(secret_share.token("rac-secret-x1", "a]b\nc") == "[secret-share rac-secret-x1 a b c]",
          "a label cannot close the token early")
    check(not secret_share.valid_service("Claude Code-credentials"), "only rac-secret- items can be shared")
    check(not secret_share.valid_service("rac-secret-NAME"), "the preamble's example is not a real token")
    try:
        secret_share.service_for("../x")
        check(False, "a name with a slash is refused")
    except ValueError:
        check(True, "a name with a slash is refused")


class FakeKeychain:
    def __init__(self):
        self.items = {}

    def store(self, service, value):
        self.items[service] = value


def put() -> None:
    print("\nputting a key")
    kc = FakeKeychain()
    s = secret_share.put("openai-prod", "sk-fake-123", kc)
    check(s == "rac-secret-openai-prod" and kc.items[s] == "sk-fake-123", "stored under rac-secret-<name>")
    try:
        secret_share.put("x1", "", kc)
        check(False, "an empty stdin is refused")
    except ValueError:
        check(True, "an empty stdin is refused")


def parse_g() -> None:
    print("\nreading the keychain's answer")
    check(secret_share._parse_g('keychain: "x"\npassword: "Hunter22!"\n') == "Hunter22!", "printable value")
    hexv = "Şifre-1".encode().hex()
    check(secret_share._parse_g(f'password: 0x{hexv.upper()}  "\\303\\236ifre-1"\n') == "Şifre-1",
          "non-ASCII value comes from the hex")
    check(secret_share._parse_g('password: "a"b"\n') == 'a"b', "a quote inside the value")
    check(secret_share._parse_g("password: <NULL>\n") is None, "no password")


def clock() -> None:
    print("\nthe hour")
    with tempfile.TemporaryDirectory() as tmp:
        db = DB(Path(tmp) / "db.sqlite")
        c = db._c
        now = time.time()

        def say(chat, text, ts, typ="message.assistant"):
            seq = (c.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0] or 0) + 1
            cols = {r["name"] for r in c.execute("PRAGMA table_info(events)")}
            row = {"seq": seq, "chat_id": chat, "type": typ, "payload": json.dumps({"text": text}), "ts": ts}
            row = {k: v for k, v in row.items() if k in cols}
            c.execute(f"INSERT INTO events ({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
            c.commit()

        tok = secret_share.token("rac-secret-openai-prod", "OpenAI key")
        say("chatA", f"İşte anahtar: {tok}", now - 600)
        say("chatA", f"tekrar: {tok}", now - 60)
        say("chatB", f"eski: {tok}", now - 7200)
        say("chatC", f"kopyala {tok}", now, typ="message.user")
        need = secret_share.needles("rac-secret-openai-prod")
        a = db.last_said("chatA", *need)
        check(a is not None and abs(a - (now - 60)) < 1, "the latest share starts the hour")
        try:
            secret_share.check("rac-secret-openai-prod", a, now)
            check(True, "inside the hour it is handed out")
        except secret_share.ShareError as e:
            check(False, "inside the hour it is handed out", e.code)
        for chat, code, label in (("chatB", "secret_expired", "after the hour it is refused"),
                                  ("chatC", "secret_not_shared", "a token the person typed is not a share"),
                                  ("chatZ", "secret_not_shared", "another chat cannot claim it")):
            try:
                secret_share.check("rac-secret-openai-prod", db.last_said(chat, *need), now)
                check(False, label)
            except secret_share.ShareError as e:
                check(e.code == code, label, e.code)
        check(db.last_said("chatA", *secret_share.needles("rac-secret-openai")) is None,
              "a shorter name is not the shared one")


def handler() -> None:
    print("\nthe daemon's answer")
    from divan import server as srv
    with tempfile.TemporaryDirectory() as tmp:
        db = DB(Path(tmp) / "db.sqlite")
        seq = 1
        db._c.execute("INSERT INTO events (seq, chat_id, type, payload, ts) VALUES (?,?,?,?,?)",
                      (seq, "chatA", "message.assistant",
                       json.dumps({"text": "[secret-share rac-secret-k9 Test]"}), time.time() - 5))
        db._c.commit()
        fake = SimpleNamespace(db=db)
        orig = secret_share.read
        secret_share.read = lambda s, timeout=10.0: "Hunter22!" if s == "rac-secret-k9" else None
        try:
            r = asyncio.run(srv.Server.h_secret_copy(fake, SimpleNamespace(name="iPhone"),
                                                     {"chat_id": "chatA", "service": "rac-secret-k9"}))
            check(r["value"] == "Hunter22!" and r["expires"] > time.time(), "a shared key comes back with its end")
            try:
                asyncio.run(srv.Server.h_secret_copy(fake, SimpleNamespace(name="iPhone"),
                                                     {"chat_id": "chatA", "service": "rac-secret-other"}))
                check(False, "an item the chat never shared is refused")
            except secret_share.ShareError as e:
                check(e.code == "secret_not_shared" and "Hunter" not in str(e), "an item the chat never shared is refused")
        finally:
            secret_share.read = orig


def guard() -> None:
    print("\nprinting a key is refused")
    cases = {
        "security find-generic-password -s rac-secret-x -w": True,
        "security find-generic-password -s x -g": True,
        "security find-generic-password -s x -w | head -c 4": True,
        "cd a && security find-generic-password -s x -w": True,
        "security find-generic-password -s x -w 2>/dev/null; ls": True,
        'KEY=$(security find-generic-password -s x -w) curl -H "a: $KEY" u': False,
        'curl -H "Authorization: Bearer $(security find-generic-password -s x -w)" u': False,
        "security find-generic-password -s x -w | pbcopy": False,
        "security find-generic-password -s x -w > key.txt": False,
        "security find-generic-password -s x": False,
        "git commit -m 'security find-generic-password -w'": False,
    }
    for cmd, want in cases.items():
        check(bool(security.prints_secret(cmd)) == want, f"{'refused' if want else 'runs'}: {cmd}")


if __name__ == "__main__":
    tokens()
    put()
    parse_g()
    clock()
    handler()
    guard()
    print("\nall checks passed" if not failed else f"\nFAILED: {', '.join(failed)}")
    sys.exit(1 if failed else 0)
