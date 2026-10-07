#!/usr/bin/env python3
"""Keys already in chat history are found, kept in the keychain, and masked. No network.

    python scripts/test_scrub.py

A temp HOME stands in for the real one: the daemon's database, a Claude
transcript, a Codex rollout, a tool-result file and a session log, each with
fake keys planted in it. The keychain is a dict. No check prints a value.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remote_ai_chat import scrub, secrets                       # noqa: E402
from remote_ai_chat.db import DB                               # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  — {detail}'}")
    if not ok:
        failures.append(label)


A = "FAKEfake0123456789abcdefghijKLMNOPqrstuvwxyz"

# kind → value; each is planted once, somewhere below.
PLANTED = {
    "db-user": ("openai", "sk-proj-" + A[:32]),
    "db-tool": ("secret", "Vx7Lm2Qp9Rt4Wy6Bn3Kd"),                 # "api_key": "…" inside a tool's JSON
    "db-preview": ("aws", "AKIA" + "FAKE0123456789AB"),
    "claude-text": ("anthropic", "sk-ant-api03-" + A[:30]),
    "claude-tool": ("github", "ghp_" + A[:36]),
    "claude-pem": ("pem", "-----BEGIN RSA PRIVATE KEY-----\nMIIEfake" + A + "\n-----END RSA PRIVATE KEY-----"),
    "codex-msg": ("google", "AIza" + A[:35]),
    "codex-env": ("secret", "hunter2" + A[:12]),                       # DB_PASSWORD=… in a command
    "tool-result": ("stripe", "sk_" + "live_" + A[:24]),
    "home-claude": ("posthog", "phc_" + A[:43]),
    "session-log": ("jwt", "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiJmYWtlIn0." + A[:20]),
}
LIVE = ("slack", "xoxb-" + "123456789012-" + A[:24])
V = {name: value for name, (_kind, value) in PLANTED.items()}
OLD = time.time() - 3600


class FakeKeychain:
    def __init__(self):
        self.items: dict[str, str] = {}

    def store(self, service, value):
        self.items[service] = value


class RefusingKeychain:
    def store(self, service, value):
        raise secrets.KeychainError("security exited 45")


def jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows))


def plant(home: Path) -> tuple[DB, Path]:
    rac = home / ".remote-ai-chat"
    db = DB(rac / "db.sqlite")
    chat = db.create_chat(title="New chat", provider="claude", model="sonnet", effort=None,
                          perm_mode="ask", cwd="/tmp")
    db.append_event(chat["id"], "message.user", {"text": f"anahtarım {V['db-user']} bunu kullan"})
    db.append_event(chat["id"], "tool.result", {
        "output": json.dumps({"config": {"api_key": V["db-tool"], "region": "eu"}}, indent=2)})
    db.append_event(chat["id"], "message.assistant", {"text": "tamam, bir şey yok burada"})
    db._c.execute("UPDATE chats SET last_preview = ? WHERE id = ?", (f"key {V['db-preview']}", chat["id"]))
    db._c.commit()

    account = rac / "accounts" / "claude-abc123" / "projects" / "-Users-x-proj"
    jsonl(account / "s1.jsonl", [
        {"type": "user", "timestamp": "2026-09-01T10:00:00.000Z",
         "message": {"role": "user", "content": f"bu da benim key: {V['claude-text']}"}},
        {"type": "user", "timestamp": "2026-09-02T10:00:00.000Z",
         "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": "t1",
              "content": f"export GH={V['claude-tool']}\n{V['claude-pem']}\n"},
             {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                          "data": "iVBORw0KGgo" + A * 40}}]}},
        {"type": "assistant", "timestamp": "2026-09-03T10:00:00.000Z",
         "message": {"role": "assistant", "content": [{"type": "text", "text": "Türkçe, sorun yok ✓"}]}},
    ])
    tool = account / "s1" / "tool-results" / "out.txt"
    tool.parent.mkdir(parents=True)
    tool.write_text(f"STRIPE_KEY {V['tool-result']}\nsatır iki\n")
    jsonl(account / "live.jsonl", [{"type": "user", "message": {"content": f"canlı {LIVE[1]}"}}])

    jsonl(home / ".codex" / "sessions" / "2026" / "09" / "05" / "rollout-1.jsonl", [
        {"timestamp": "2026-09-05T08:00:00.000Z", "type": "session_meta", "payload": {"cwd": "/tmp"}},
        {"timestamp": "2026-09-05T08:01:00.000Z", "type": "response_item",
         "payload": {"type": "message", "role": "user",
                     "content": [{"type": "input_text", "text": f"Google anahtarı {V['codex-msg']}"}]}},
        {"timestamp": "2026-09-05T08:02:00.000Z", "type": "response_item",
         "payload": {"type": "function_call", "name": "shell",
                     "arguments": json.dumps({"command": ["bash", "-lc", f"DB_PASSWORD={V['codex-env']} ./run"]})}},
        {"timestamp": "2026-09-05T08:03:00.000Z", "type": "response_item",
         "payload": {"type": "reasoning", "encrypted_content": "gAAAAB" + A * 20}},
    ])
    jsonl(home / ".claude" / "projects" / "-Users-x" / "s2.jsonl", [
        {"type": "user", "timestamp": "2026-09-10T10:00:00.000Z",
         "message": {"role": "user", "content": f"posthog {V['home-claude']}"}}])
    log = home / ".claude" / "memory" / "yakup" / "sessions" / "2026-09-11.md"
    log.parent.mkdir(parents=True)
    log.write_text(f"# 11 Eylül\n\n- token yapıştırdı: {V['session-log']}\n")

    for p in home.rglob("*"):
        if p.is_file() and p.name != "live.jsonl":
            os.utime(p, (OLD, OLD))
    return db, account / "live.jsonl"


def snapshot(home: Path) -> dict[str, str]:
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(home.rglob("*"))
            if p.is_file() and p.name not in (scrub.REPORT, scrub.STATE) and not p.name.endswith("-shm")}


def tree_bytes(home: Path) -> list[tuple[Path, bytes]]:
    return [(p, p.read_bytes()) for p in home.rglob("*") if p.is_file()]


def quiet(fn, *a, **kw):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*a, **kw)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        db, live = plant(home)
        report = home / ".remote-ai-chat" / scrub.REPORT
        services = {name: secrets.service_for(kind, value) for name, (kind, value) in PLANTED.items()}

        print("\ndry run")
        before = snapshot(home)
        code = quiet(scrub.main, ["--home", str(home)])
        text = report.read_text()
        check(code == 0 and snapshot(home) == before, "no file in the tree changes")
        missing = [n for n, s in services.items() if s not in text]
        check(not missing, "every planted key is in the report", f"missing {missing}")
        check(not (home / ".remote-ai-chat" / scrub.STATE).exists(), "a dry run keeps no state")

        print("\na file written in the last ten minutes")
        check(str(live) in text.split("## Skipped")[-1], "it is listed as skipped")

        print("\n--apply")
        kc = FakeKeychain()
        live_before = live.read_bytes()
        code = quiet(scrub.main, ["--apply", "--home", str(home)], keychain=kc)
        check(code == 0, "the run succeeds", f"exit {code}")
        check(all(kc.items.get(services[n]) == V[n] for n in PLANTED),
              "every key is in the keychain under its service", f"{len(kc.items)} items")
        found = sorted({f"{n} in {p.name}" for n in PLANTED for p, b in tree_bytes(home)
                        if V[n].encode() in b})
        check(not found, "no planted value is left anywhere in the tree, database and WAL included",
              f"still there: {found}")
        bad = []
        for p in home.rglob("*.jsonl"):
            for i, line in enumerate(p.read_text().splitlines()):
                try:
                    json.loads(line)
                except ValueError:
                    bad.append(f"{p.name}:{i + 1}")
        check(not bad, "every JSONL line still parses", f"{bad}")
        check(sqlite3.connect(home / ".remote-ai-chat" / "db.sqlite").execute(
            "PRAGMA integrity_check").fetchone()[0] == "ok", "the database passes integrity_check")
        rows = [json.loads(r[0]) for r in sqlite3.connect(home / ".remote-ai-chat" / "db.sqlite").execute(
            "SELECT payload FROM events ORDER BY seq")]
        inner = json.loads(rows[1]["output"])
        check(services["db-user"] in rows[0]["text"] and services["db-tool"] in inner["config"]["api_key"]
              and inner["config"]["region"] == "eu" and rows[2]["text"] == "tamam, bir şey yok burada",
              "the events say where each key went and keep everything else")
        check(db.list_chats()[0]["title"] == "New chat", "the daemon's own connection still reads the database")
        claude = [json.loads(line) for line in
                  (home / ".remote-ai-chat/accounts/claude-abc123/projects/-Users-x-proj/s1.jsonl").read_text().splitlines()]
        check(claude[1]["message"]["content"][1]["source"]["data"].startswith("iVBORw0KGgo")
              and claude[2]["message"]["content"][0]["text"] == "Türkçe, sorun yok ✓",
              "an inline image and plain text come back as they were")
        check(live.read_bytes() == live_before and LIVE[1].encode() in live_before,
              "the live file is left untouched")
        check(os.stat(home / ".codex/sessions/2026/09/05/rollout-1.jsonl").st_mtime == OLD,
              "a rewritten file keeps its modification time")

        print("\nthe report")
        text = report.read_text()
        rows = {line.split("|")[3].strip(): line for line in text.splitlines()
                if line.startswith("| ") and secrets.SERVICE_PREFIX in line}
        ok = all(s in rows and f"| {PLANTED[n][0]} | {secrets.fingerprint(V[n])} | {s} |" in rows[s]
                 for n, s in services.items())
        check(ok, "each key has its kind, fingerprint and keychain service on one row")
        check("| 2026-09-05 " in rows[services["codex-msg"]], "first seen comes from the line's own timestamp")
        leaked = [n for n in PLANTED if V[n] in text] + ([LIVE[0]] if LIVE[1] in text else [])
        check(not leaked, "no value is in the report", f"{leaked}")

        print("\nthe next run")
        kc2 = FakeKeychain()
        before = snapshot(home)
        quiet(scrub.main, ["--apply", "--home", str(home)], keychain=kc2)
        text = report.read_text()
        check(snapshot(home) == before and not kc2.items, "a clean tree is left alone")
        check(all(s in text for s in services.values()), "the report still lists what earlier runs found")
        later = "re_" + "Late1234_" + A[:24]
        db.append_event(db.list_chats()[0]["id"], "message.user", {"text": f"yeni {later}"})
        os.utime(live, (OLD, OLD))
        quiet(scrub.main, ["--apply", "--home", str(home)], keychain=kc2)
        check(later.encode() not in b"".join(b for _p, b in tree_bytes(home)) and kc2.items.get(
            secrets.service_for("resend", later)) == later, "an event written after a run is caught by the next")
        check(LIVE[1].encode() not in live.read_bytes() and secrets.service_for(*LIVE) in report.read_text(),
              "once the live file goes quiet it is masked too")
        db._c.close()

    print("\na keychain that refuses")
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        plant(home)
        before = snapshot(home)
        code = quiet(scrub.main, ["--apply", "--home", str(home)], keychain=RefusingKeychain())
        text = (home / ".remote-ai-chat" / scrub.REPORT).read_text()
        check(code == 1 and snapshot(home) == before, "nothing is masked that is not kept")
        check("keychain refused" in text and not any(V[n] in text for n in PLANTED),
              "the report says so, by service")

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
