#!/usr/bin/env python3
"""A key pasted into a chat ends up in the keychain, not in the history. No network.

    python scripts/test_secrets.py

Every key here is fake, built from pieces so no real-looking one sits in the
source, and no check ever prints a value — only kinds and counts.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat import secrets                              # noqa: E402
from remote_ai_chat.config import Config                       # noqa: E402
from remote_ai_chat.db import DB                               # noqa: E402
from remote_ai_chat.providers.base import TurnResult           # noqa: E402
from remote_ai_chat.server import Server                        # noqa: E402
from remote_ai_chat.session import ChatSession                  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


A = "FAKEfake0123456789abcdefghijKLMNOPqrstuvwxyz"   # filler, letters and digits

OPENAI = "sk-proj-" + A[:32]
KEYS = {
    "anthropic": "sk-ant-api03-" + A[:30],
    "openai": OPENAI,
    "openai (classic)": "sk-" + A[:24],
    "aws": "AKIA" + "FAKE0123456789AB",
    "github (ghp_)": "ghp_" + A[:36],
    "github (github_pat_)": "github_pat_" + "11FAKE0123_" + A[:30],
    "google": "AIza" + A[:35],
    "resend": "re_" + "Fake1234_" + A[:24],
    "posthog (phc_)": "phc_" + A[:43],
    "posthog (phx_)": "phx_" + A[:40],
    "sentry (sntrys_)": "sntrys_" + "eyJpYXQiOjE3MDB9_" + A[:30],
    "sentry (sntryu_)": "sntryu_" + "0123456789abcdef" * 4,
    "slack": "xoxb-" + "123456789012-" + A[:24],
    "telegram": "123456789:" + "AA" + A[:33],
    "stripe (sk_live_)": "sk_" + "live_" + A[:24],
    "stripe (rk_live_)": "rk_" + "live_" + A[:24],
    "jwt": "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiJmYWtlIn0." + A[:20],
    "pem": "-----BEGIN RSA PRIVATE KEY-----\nMIIEfake" + A + "\n" + A + "\n-----END RSA PRIVATE KEY-----",
}
# key=value: the name stays, only the value goes.
ASSIGNMENTS = {
    "env assignment": ("DB_PASSWORD=", "hunter2" + A[:12]),
    "json field": ('"client_secret": "', A[4:24]),
    "yaml api key": ("api_key: ", A[:20]),
}

# A password said in a sentence, and an app password near the words that name it.
SAID = {
    "turkish password": ("şifrem: ", "Gizli.Sifre-2026!", "password"),
    "turkish password mid-sentence": ("mailin şifresi ", "Gizli.Sifre-2026!", "password"),
    "english password": ("the password is ", "Hunter22!", "password"),
    "app password": ("gmail app password: ", "abcd efgh ijkl mnop", "apppassword"),
}

DATA_URL = "data:image/png;base64," + base64.b64encode(bytes(range(256)) * 8).decode() \
    + "/AKIA" + "FAKE0123456789AB" + "=="
ORDINARY = {
    "git sha": "Merged 46f60d3a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e into main",
    "uuid": "chat 3f2a8c1e-9b7d-4e6f-a1b2-c3d4e5f60789 is done",
    "image data url": f"![shot]({DATA_URL})",
    "turkish prose": "Kanka şu token sayısı neden arttı, şifre ekranını da düzelt: ödeme sayfası açılmıyor.",
    "identifier": "use re_compile_everything_here and sk-learn-style naming",
    "env reference": "password: process.env.DB_PASSWORD",
    "key path": "EXPO_ASC_API_KEY_PATH=/Users/me/keys/AuthKey_AB12CD34EF.p8",
    "talk about a password": "şifreni sıfırla, parola alanını gizle, that will pass the tests",
    "four short words": "what does this mean when then",
}


class FakeKeychain:
    """Service → value, the way the keychain keeps a generic password."""

    def __init__(self):
        self.items: dict[str, str] = {}
        self.writes = 0

    def store(self, service, value):
        self.writes += 1
        self.items[service] = value


class RefusingKeychain:
    def store(self, service, value):
        raise secrets.KeychainError("security exited 45")


def detection():
    print("\nevery family is found and replaced")
    for name, key in KEYS.items():
        kind = name.split(" ")[0]
        text = f"burada anahtar var {key} bunu kullan"
        hits = secrets.find(text)
        masked = secrets.mask(text)
        check([h.kind for h in hits] == [kind] and key not in masked
              and secrets.service_for(kind, key) in masked
              and masked.startswith("burada anahtar var [secret ") and masked.endswith("] bunu kullan"),
              f"{name} is detected and masked", f"kinds={[h.kind for h in hits]}")
    for name, (prefix, value) in ASSIGNMENTS.items():
        text = f"set {prefix}{value} please"
        masked = secrets.mask(text)
        check(value not in masked and prefix in masked and "[secret secret rac-secret-secret-" in masked,
              f"{name}: the value is masked, the name stays")
    named = "OPENAI_API_KEY=" + OPENAI
    check([h.kind for h in secrets.find(named)] == ["openai"],
          "a named key in an assignment is filed under its own family")

    for name, (lead, value, kind) in SAID.items():
        masked = secrets.mask(f"{lead}{value} bunu kullan")
        check(value not in masked and masked.startswith(lead) and f"[secret {kind} " in masked,
              f"{name} is masked", masked)

    print("\nordinary text is left alone")
    for name, text in ORDINARY.items():
        check(secrets.mask(text) == text, f"{name} is unchanged",
              f"kinds={[h.kind for h in secrets.find(text)]}")

    once = secrets.mask(f"a {OPENAI} b")
    check(secrets.mask(once) == once, "a placeholder is not masked a second time")


def keychain_wrapper():
    print("\nthe real keychain wrapper")
    calls = []

    class R:
        returncode = 0

    real_run = secrets.subprocess.run
    secrets.subprocess.run = lambda args, **kw: (calls.append((args, kw.get("input", ""))), R())[1]
    try:
        kc = secrets.Keychain()
        kc.store("rac-secret-openai-00000000", OPENAI)
        kc.store("rac-secret-openai-00000000", OPENAI)
    finally:
        secrets.subprocess.run = real_run
    args, stdin = calls[0]
    check(len(calls) == 1, "the same service is written once per process", f"{len(calls)} writes")
    check(OPENAI not in " ".join(args) and OPENAI not in stdin and OPENAI.encode().hex() in stdin
          and "-U" in stdin, "the value goes over stdin, hex-encoded, as an upsert")


def capture_store():
    print("\ncapture writes each key under its placeholder's service")
    kc = FakeKeychain()
    got = secrets.capture(f"bunu kaydet {OPENAI}", kc)
    service = secrets.service_for("openai", OPENAI)
    check(kc.items.get(service) == OPENAI and service in got.text, "the key is stored under the service the placeholder names")
    secrets.capture(f"yine {OPENAI}", kc)
    check(len(kc.items) == 1, "the same key twice is one entry", f"{len(kc.items)} entries")

    print("\na keychain that refuses still masks")
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append
    logging.getLogger("rac.secrets").addHandler(handler)
    try:
        got = secrets.capture(f"x {OPENAI} y", RefusingKeychain())
    finally:
        logging.getLogger("rac.secrets").removeHandler(handler)
    logged = " ".join(r.getMessage() for r in records)
    check(OPENAI not in got.text and service in got.text and "not saved" in got.text,
          "the message is masked and says the key was not kept")
    check(service in logged and OPENAI not in logged, "the failure is logged by service, never by value")


class FakeProvider:
    def __init__(self):
        self.prompts: list[str] = []

    async def steer(self, prompt, attachments=None):
        return False

    async def run(self, prompt, attachments=None):
        self.prompts.append(prompt)
        return TurnResult(session_id="sess-1", cost_usd=None, usage=None, duration_ms=1, num_turns=1)

    def has_pending(self):
        return False

    async def interrupt(self):
        pass

    async def close(self):
        pass


async def send_path():
    print("\nthe daemon's send path")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "db.sqlite"
        db = DB(path)
        chat = db.create_chat(title="New chat", provider="claude", model="sonnet", effort=None,
                              perm_mode="ask", cwd="/tmp")

        async def nothing(*_a):
            pass

        s = ChatSession(chat, db, Config(), nothing, nothing)
        provider = FakeProvider()
        s._make_provider = lambda _c: provider
        kc = FakeKeychain()
        s.keychain = kc

        class Host:
            draining = False
        host = Host()
        host.sessions = type("S", (), {"get": staticmethod(lambda _cid: s)})()

        service = secrets.service_for("openai", OPENAI)
        for text in (f"OpenAI anahtarım bu: {OPENAI} kaydet", f"tekrar {OPENAI}"):
            await Server.h_chat_send(host, None, {"chat_id": chat["id"], "text": text})
            await s.running

        rows = sqlite3.connect(path).execute(
            "SELECT payload FROM events WHERE chat_id = ? AND type = 'message.user' ORDER BY seq",
            (chat["id"],)).fetchall()
        stored = [json.loads(r[0])["text"] for r in rows]
        raw = sqlite3.connect(path).iterdump()
        check(len(stored) == 2 and all(service in t and "security find-generic-password" in t for t in stored),
              "the stored message.user carries the keychain placeholder", f"{len(stored)} events")
        check(not any(OPENAI in line or OPENAI[8:] in line for line in raw),
              "no trace of the key anywhere in the database")
        check(len(provider.prompts) == 2 and all(service in p and OPENAI not in p for p in provider.prompts),
              "the provider is handed the placeholder, not the key")
        check(kc.items == {service: OPENAI}, "the keychain holds the key once, under that service",
              f"{len(kc.items)} entries")


async def main() -> int:
    detection()
    keychain_wrapper()
    capture_store()
    await send_path()
    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
