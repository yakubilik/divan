#!/usr/bin/env python3
"""Keys already in chat history are found, kept in the keychain, and masked. No network.

    python scripts/test_scrub.py

A temp HOME stands in for the real one: the daemon's database, a Claude
transcript, a Codex rollout, a tool-result file and a session log in a folder
config.toml names, each with fake keys planted in it. The keychain is a dict.
No check prints a value.
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

from divan import scrub, secrets                       # noqa: E402
from divan.db import DB                               # noqa: E402

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
    "claude-pem": ("pem", "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEfake" + A + "\n-----END RSA PRIVATE KEY-----"),
    "codex-msg": ("google", "AIza" + A[:35]),
    "codex-env": ("secret", "hunter2" + A[:12]),                       # DB_PASSWORD=… in a command
    "tool-result": ("stripe", "sk_" + "live_" + A[:24]),
    "home-claude": ("posthog", "phc_" + A[:43]),
    "session-log": ("jwt", "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiJmYWtlIn0." + A[:20]),
}
LIVE = ("slack", "xoxb-" + "123456789012-" + A[:24])
V = {name: value for name, (_kind, value) in PLANTED.items()}
OLD = time.time() - 3600
NOTES = "notes/sessions"      # where this machine keeps its session logs, under the home


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


def plant(home: Path, configured: bool = True) -> tuple[DB, Path]:
    rac = home / ".divan"
    db = DB(rac / "db.sqlite")
    if configured:
        (rac / "config.toml").write_text(f'scrub_extra_paths = ["~/{NOTES}"]\n')
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
    log = home / NOTES / "2026-09-11.md"
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


# Ids the finder takes for a key. The one that bricked a chat (13 Oct 2026) was
# `toolu_01CWK4PWD…`: `PWD` after a digit read as a password. Since 5 Nov 2026
# the password rule wants a `:` or `=` and never starts inside a word, so an id
# of that shape is no longer caught at all; these are whole key shapes instead,
# which an id can still happen to have, to keep the safety net tested.
TOOL_ID = "ghp_" + "01CWK4PWD7xQ2mN9vB3kL8sR5tY1aB2cD3eF"
MSG_ID = "AKIA" + "PWD7XQ2MN9VB3KL8"
UUID = "sk-ant-" + "4f1c9e2a7b3d4PWD9e1f0a2b"
PARENT = "AIza" + "9a8b7c6d5e4f4PWD8a1b2c3d4e5f6a7b8c9"
SESSION = "sk-proj-" + "30c84f237b634PWDa1b2c3d4"
CALL_ID = "xoxb-" + "PWD9xQ2mN7vB3kL8sR5tY1"


def ids() -> None:
    print("\nids in a transcript")
    looks = [i for i in (TOOL_ID, MSG_ID, UUID, PARENT, SESSION, CALL_ID) if not secrets.find(f"id: {i}")]
    check(not looks, "each test id is one the finder takes for a key", f"{looks}")
    gh, pw, inner = "ghp_" + A[:36], "password: hunter2" + A[:10], "sk-proj-" + A[1:33]
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        path = home / "s.jsonl"
        rows = [
            {"type": "assistant", "uuid": UUID, "parentUuid": PARENT, "sessionId": SESSION,
             "requestId": "req_011PWD7xQ2mN9vB3kL8", "timestamp": "2026-10-01T10:00:00.000Z",
             "message": {"id": MSG_ID, "role": "assistant", "content": [
                 {"type": "text", "text": f"export GH={gh}"},
                 {"type": "tool_use", "id": TOOL_ID, "name": "Bash",
                  "input": {"command": f"echo {pw}", "id": inner}}]}},
            {"type": "user", "uuid": PARENT, "parentUuid": UUID, "sessionId": SESSION,
             "message": {"role": "user", "content": [
                 {"type": "tool_result", "tool_use_id": TOOL_ID, "content": f"ok {gh}"}]}},
        ]
        jsonl(path, rows)
        codex = home / "rollout.jsonl"
        jsonl(codex, [{"type": "response_item", "payload": {
            "type": "function_call", "name": "shell", "call_id": CALL_ID,
            "arguments": json.dumps({"command": ["bash", "-lc", f"DB_PASSWORD=hunter2{A[:12]} ./run"]})}}])
        os.utime(path, (OLD, OLD))
        os.utime(codex, (OLD, OLD))
        r = scrub.Run(True, FakeKeychain())
        scrub.scrub_file(r, path, time.time())
        scrub.scrub_file(r, codex, time.time())
        out = [json.loads(line) for line in path.read_text().splitlines()]
        a, u = out[0], out[1]
        block = a["message"]["content"][1]
        check(block["id"] == TOOL_ID and u["message"]["content"][0]["tool_use_id"] == TOOL_ID
              and f'"id":"{TOOL_ID}"'.encode() in path.read_bytes()
              and f'"tool_use_id":"{TOOL_ID}"'.encode() in path.read_bytes(),
              "tool_use.id and tool_result.tool_use_id come out byte-identical")
        check(a["message"]["id"] == MSG_ID and a["uuid"] == UUID and a["parentUuid"] == PARENT
              and a["sessionId"] == SESSION and u["uuid"] == PARENT and u["parentUuid"] == UUID
              and u["sessionId"] == SESSION and a["requestId"] == "req_011PWD7xQ2mN9vB3kL8",
              "message.id, uuid, parentUuid, sessionId and requestId are never rewritten")
        text = path.read_text()
        check(gh not in text and "hunter2" not in text and inner not in text
              and secrets.service_for("github", gh) in a["message"]["content"][0]["text"]
              and secrets.service_for("github", gh) in u["message"]["content"][0]["content"]
              and secrets.SERVICE_PREFIX in block["input"]["command"]
              and secrets.service_for("openai", inner) in block["input"]["id"],
              "a key in the text, tool input (an `id` there too) and tool output is still masked")
        call = json.loads(codex.read_text())["payload"]
        check(call["call_id"] == CALL_ID and "hunter2" not in call["arguments"],
              "a Codex call_id is kept and the key in its arguments masked")

        print("\nthe safety net")
        line = {"type": "assistant", "message": {"id": "msg_x", "content": [
            {"type": "text", "text": f"export GH={gh}"},
            {"type": "tool_use", "id": TOOL_ID, "name": "Bash", "input": {}}]}}
        net = home / "net.jsonl"
        jsonl(net, [line, {"type": "user", "message": {"content": f"only text {gh}"}}])
        os.utime(net, (OLD, OLD))
        keys, scrub._ID_KEYS = scrub._ID_KEYS, set()      # as if the id were not known to be one
        try:
            r = scrub.Run(True, FakeKeychain())
            scrub.scrub_file(r, net, time.time())
        finally:
            scrub._ID_KEYS = keys
        first, second = net.read_text().splitlines()
        check(first == json.dumps(line, separators=(",", ":")),
              "a line whose id masking would break is left exactly as it was")
        check(gh not in second and any("would break an id" in e for e in r.errors),
              "the other lines are still masked, and the skip is reported")

        db = DB(home / ".divan" / "db.sqlite")
        chat = db.create_chat(title="t", provider="claude", model="sonnet", effort=None,
                              perm_mode="ask", cwd="/tmp")
        payload = {"blocks": [{"type": "tool_result", "tool_use_id": TOOL_ID, "content": f"ok {gh}"}]}
        db.append_event(chat["id"], "tool.result", payload)
        db.append_event(chat["id"], "tool.result", {"tool_use_id": TOOL_ID, "output": f"ok {gh}"})
        db._c.close()
        keys, scrub._ID_KEYS = scrub._ID_KEYS, set()
        try:
            scrub.scrub_db(scrub.Run(True, FakeKeychain()), home / ".divan" / "db.sqlite")
        finally:
            scrub._ID_KEYS = keys
        con = sqlite3.connect(home / ".divan" / "db.sqlite")
        rows = [json.loads(p) for (p,) in con.execute("SELECT payload FROM events ORDER BY seq")]
        con.close()
        check(rows[0] == payload and rows[1]["tool_use_id"] == TOOL_ID, "a database event whose id masking would break is left as it was")
        scrub.scrub_db(scrub.Run(True, FakeKeychain()), home / ".divan" / "db.sqlite")
        con = sqlite3.connect(home / ".divan" / "db.sqlite")
        rows = [json.loads(p) for (p,) in con.execute("SELECT payload FROM events ORDER BY seq")]
        con.close()
        check(rows[0]["blocks"][0]["tool_use_id"] == TOOL_ID and rows[1]["tool_use_id"] == TOOL_ID
              and gh not in json.dumps(rows), "in the database the ids are kept and the keys masked")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        db, live = plant(home)
        report = home / ".divan" / scrub.REPORT
        services = {name: secrets.service_for(kind, value) for name, (kind, value) in PLANTED.items()}

        print("\ndry run")
        before = snapshot(home)
        code = quiet(scrub.main, ["--home", str(home)])
        text = report.read_text()
        check(code == 0 and snapshot(home) == before, "no file in the tree changes")
        missing = [n for n, s in services.items() if s not in text]
        check(not missing, "every planted key is in the report", f"missing {missing}")
        check(not (home / ".divan" / scrub.STATE).exists(), "a dry run keeps no state")

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
        check(sqlite3.connect(home / ".divan" / "db.sqlite").execute(
            "PRAGMA integrity_check").fetchone()[0] == "ok", "the database passes integrity_check")
        rows = [json.loads(r[0]) for r in sqlite3.connect(home / ".divan" / "db.sqlite").execute(
            "SELECT payload FROM events ORDER BY seq")]
        inner = json.loads(rows[1]["output"])
        check(services["db-user"] in rows[0]["text"] and services["db-tool"] in inner["config"]["api_key"]
              and inner["config"]["region"] == "eu" and rows[2]["text"] == "tamam, bir şey yok burada",
              "the events say where each key went and keep everything else")
        check(db.list_chats()[0]["title"] == "New chat", "the daemon's own connection still reads the database")
        claude = [json.loads(line) for line in
                  (home / ".divan/accounts/claude-abc123/projects/-Users-x-proj/s1.jsonl").read_text().splitlines()]
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
        db, _live = plant(home)
        # Closed first: a connection left to the garbage collector checkpoints
        # the WAL whenever it goes, and that is a change nobody here made.
        db._c.close()
        before = snapshot(home)
        code = quiet(scrub.main, ["--apply", "--home", str(home)], keychain=RefusingKeychain())
        text = (home / ".divan" / scrub.REPORT).read_text()
        check(code == 1 and snapshot(home) == before, "nothing is masked that is not kept")
        check("keychain refused" in text and not any(V[n] in text for n in PLANTED),
              "the report says so, by service")

    print("\nno location configured")
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        db, _live = plant(home, configured=False)
        log = home / NOTES / "2026-09-11.md"
        before = log.read_bytes()
        kc = FakeKeychain()
        quiet(scrub.main, ["--apply", "--home", str(home)], keychain=kc)
        check(log.read_bytes() == before and secrets.service_for(*PLANTED["session-log"]) not in kc.items,
              "a folder config.toml does not name is not read")
        roots = (home / ".divan", home / ".claude" / "projects", home / ".codex" / "sessions")
        stray = [str(p) for p in scrub.targets(home) if not any(p.is_relative_to(r) for r in roots)]
        check(not stray, "only the daemon's and the CLIs' own folders are walked", f"{stray}")
        db._c.close()

    ids()

    print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
