"""Keys already sitting in chat history: found, put in the keychain, masked.

`secrets.capture` stops a key on its way into a chat. This is the same thing
for everything written before that existed, and for what the CLIs keep writing
on their own: the daemon's events table, and the transcripts and logs Claude
Code and Codex leave on disk.

    python -m remote_ai_chat.scrub            # dry run: report only
    python -m remote_ai_chat.scrub --apply    # keychain first, then rewrite

A file is rewritten only after every key in it is in the keychain, through a
temp file and a rename, so a reader sees the old file or the new one and never
half of each; a JSONL line that changes is parsed and dumped again, so it is
still one JSON object. A file touched in the last ten minutes belongs to a live
session and is left for the next run. The database is changed in one
transaction with secure_delete on, then checkpointed, so the old payloads are
not left in free pages or the WAL.

What comes out is `secret-report.md`: per key its kind, fingerprint, keychain
service, how many files held it and when it was first and last seen — the list
of keys to rotate. No value is ever printed, logged or written outside the
keychain; `secret-scrub.json` beside it remembers what was found and which
files are already clean, by service name and size only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import secrets

LIVE_SECONDS = 600
REPORT = "secret-report.md"
STATE = "secret-scrub.json"


# ── where to look ─────────────────────────────────────────────────────────────

def _rac(home: Path) -> Path:
    return home / ".remote-ai-chat"


def _transcript(path: Path) -> bool:
    """A file a CLI or the daemon wrote as a record of what was said or done."""
    if path.suffix in (".jsonl", ".log"):
        return True
    return path.suffix == ".txt" and path.parent.name == "tool-results"


def targets(home: Path) -> list[Path]:
    """Every transcript and log, once each, symlinks not followed."""
    roots = [
        (_rac(home), _transcript, {"uploads", "agent-store"}),
        (home / ".claude" / "projects", _transcript, set()),
        (home / ".codex" / "sessions", lambda p: p.suffix == ".jsonl", set()),
        (home / ".claude" / "memory" / "yakup" / "sessions", lambda p: p.suffix == ".md", set()),
    ]
    seen: set[str] = set()
    out: list[Path] = []
    for root, wanted, skip_dirs in roots:
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            if Path(dirpath) == root:
                dirnames[:] = [d for d in dirnames if d not in skip_dirs]
            for name in sorted(filenames):
                p = Path(dirpath) / name
                if name.startswith(".") or p.is_symlink() or not wanted(p):
                    continue
                real = os.path.realpath(p)
                if real not in seen:
                    seen.add(real)
                    out.append(p)
    return out


# ── finding, fast ─────────────────────────────────────────────────────────────
#
# `secrets.find` runs fourteen regexes, most of them starting with a lookbehind
# that keeps re from skipping ahead: about a microsecond a byte, too slow for
# gigabytes of transcripts. Each family has a fixed piece of text it cannot
# match without, and `in` finds those at memory speed, so `find` only runs on
# a string that has one of them, and a long string is handed to it a line at
# a time — every family but a PEM block fits on one line.

_LITERALS = ("sk-", "_live_", "_test_", "AKIA", "ASIA", "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
             "github_pat_", "AIza", "re_", "phc_", "phx_", "sntry", "xox", "eyJ", "PRIVATE KEY")
_NAMES = ("apikey", "api_key", "api-key", "secret", "token", "passw", "pwd",
          "accesskey", "access_key", "access-key")
_TELEGRAM = re.compile(r":[A-Za-z0-9_\-]{35}")
_LONG = 8192
# Values that are long and random by nature and never a key in plain text.
_OPAQUE_KEYS = {"encrypted_content", "signature"}


def _maybe(s: str) -> bool:
    """False only when no family can match anywhere in `s`."""
    if any(x in s for x in _LITERALS):
        return True
    low = s.lower()
    if any(x in low for x in _NAMES):
        return True
    return ":" in s and _TELEGRAM.search(s) is not None


def _find(s: str) -> list[secrets.Hit]:
    if not _maybe(s) or (s.startswith("data:") and secrets._DATA_URL.fullmatch(s)):
        return []
    if len(s) <= _LONG or "PRIVATE KEY" in s:
        return secrets.find(s)
    hits, pos = [], 0
    for line in s.splitlines(keepends=True):
        if _maybe(line):
            hits += [secrets.Hit(h.kind, h.start + pos, h.end + pos, h.value) for h in secrets.find(line)]
        pos += len(line)
    return hits


# ── what was found ────────────────────────────────────────────────────────────

@dataclass
class Found:
    kind: str
    fingerprint: str
    files: set[str] = field(default_factory=set)
    first: float = 0.0
    last: float = 0.0
    status: str = "found"   # found (dry run) · stored · refused

    def saw(self, where: str, at: float) -> None:
        self.files.add(where)
        self.first = min(self.first, at) if self.first else at
        self.last = max(self.last, at)


@dataclass
class Run:
    apply: bool
    keychain: object = None
    found: dict[str, Found] = field(default_factory=dict)
    stored: set[str] = field(default_factory=set)
    refused: set[str] = field(default_factory=set)
    skipped: list[str] = field(default_factory=list)
    changed: list[str] = field(default_factory=list)
    scanned: int = 0
    db_seq: int = 0           # the last event read; events are never rewritten by the daemon
    errors: list[str] = field(default_factory=list)

    def hit(self, h: secrets.Hit, where: str, at: float) -> str | None:
        """The placeholder that replaces `h`, or None to leave it where it is."""
        service = h.service
        f = self.found.setdefault(service, Found(h.kind, secrets.fingerprint(h.value)))
        f.saw(where, at)
        if not self.apply:
            return None
        if service not in self.stored and service not in self.refused:
            try:
                self.keychain.store(service, h.value)
                self.stored.add(service)
            except Exception as exc:
                self.refused.add(service)
                self.errors.append(f"keychain refused {service}: "
                                   f"{exc if isinstance(exc, secrets.KeychainError) else type(exc).__name__}")
        if service in self.refused:
            f.status = "refused"
            return None
        f.status = "stored"
        return secrets.placeholder(h.kind, service)


class _Cursor:
    """One file or row being read: where it is and how recent this part is."""

    def __init__(self, run: Run, where: str, at: float):
        self.run, self.where, self.at = run, where, at
        self.changed = False

    def text(self, s: str, skip: int = 0) -> str:
        hits = [h for h in _find(s) if h.start >= skip]
        if not hits:
            return s[skip:]
        out, pos = [], skip
        for h in hits:
            out.append(s[pos:h.start])
            r = self.run.hit(h, self.where, self.at)
            if r is None:
                out.append(h.value)
            else:
                out.append(r)
                self.changed = True
            pos = h.end
        out.append(s[pos:])
        return "".join(out)

    def json(self, v, key: str | None = None):
        if isinstance(v, str):
            if v.startswith("data:") and secrets._DATA_URL.fullmatch(v):
                return v
            if key is None:
                return self.text(v)
            # `"api_key": "…"` is two strings once parsed; put the name back in
            # front so the key=value family still sees it, then take it off.
            prefix = f"{key}: "
            return self.text(prefix + v, len(prefix))
        if isinstance(v, list):
            return [self.json(x) for x in v]
        if isinstance(v, dict):
            # An inline image or document is long and random, and not a key;
            # neither is a reasoning block the provider encrypted.
            raw = v.get("type") == "base64"
            return {k: x if (raw and k == "data") or k in _OPAQUE_KEYS else self.json(x, k)
                    for k, x in v.items()}
        return v


def _when(obj, fallback: float) -> float:
    if isinstance(obj, dict):
        ts = obj.get("timestamp") or obj.get("ts")
        if isinstance(ts, (int, float)):
            return float(ts) / (1000 if ts > 1e11 else 1)
        if isinstance(ts, str):
            try:
                return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
    return fallback


# ── files ─────────────────────────────────────────────────────────────────────

def _scrub_jsonl(run: Run, where: str, text: str, mtime: float) -> tuple[str, bool]:
    lines = text.split("\n")
    changed = False
    for i, line in enumerate(lines):
        if not line.strip() or not _maybe(line):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            # A torn last line, or not JSON after all: mask it as text.
            c = _Cursor(run, where, mtime)
            new = c.text(line)
        else:
            c = _Cursor(run, where, _when(obj, mtime))
            masked = c.json(obj)
            new = json.dumps(masked, ensure_ascii=False, separators=(",", ":")) if c.changed else line
        if c.changed:
            lines[i] = new
            changed = True
    return "\n".join(lines), changed


def _write(path: Path, data: bytes, before: os.stat_result) -> bool:
    """Replace `path` with `data` atomically, unless it changed since `before`."""
    tmp = path.with_name(f".{path.name}.scrub-{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, before.st_mode & 0o777)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        now = os.stat(path)
        if (now.st_size, now.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            tmp.unlink()
            return False
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    # Keep the time it was last written: session lists sort by it.
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    return True


def scrub_file(run: Run, path: Path, now: float) -> os.stat_result | None:
    """Scan (and with --apply, rewrite) one file. Its stat after, or None if left."""
    st = path.stat()
    if now - st.st_mtime < LIVE_SECONDS:
        run.skipped.append(str(path))
        return None
    run.scanned += 1
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="surrogateescape")
    where = str(path)
    if path.suffix == ".jsonl":
        new, changed = _scrub_jsonl(run, where, text, st.st_mtime)
    else:
        c = _Cursor(run, where, st.st_mtime)
        new = c.text(text)
        changed = c.changed
    if not changed:
        return st
    if not _write(path, new.encode("utf-8", errors="surrogateescape"), st):
        run.skipped.append(str(path))
        return None
    run.changed.append(where)
    return path.stat()


# ── the database ──────────────────────────────────────────────────────────────

def scrub_db(run: Run, path: Path, after_seq: int = 0) -> None:
    run.db_seq = after_seq
    if not path.exists():
        return
    where = str(path)
    if run.apply:
        con = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    else:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30, isolation_level=None)
    try:
        con.execute("PRAGMA busy_timeout=30000")
        if run.apply:
            # Overwritten payloads are zeroed, not left in free space.
            con.execute("PRAGMA secure_delete=ON")
            con.execute("BEGIN IMMEDIATE")
        updates: list[tuple[str, str, str, object]] = []   # table, column, new, key
        refused = set(run.refused)
        if con.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0] < after_seq:
            after_seq = run.db_seq = 0      # a new database: start over
        for seq, payload, ts in con.execute(
                "SELECT seq, payload, ts FROM events WHERE seq > ? ORDER BY seq", (after_seq,)):
            run.scanned += 1
            run.db_seq = seq
            if not _maybe(payload):
                continue
            try:
                obj = json.loads(payload)
            except ValueError:
                c = _Cursor(run, where, ts)
                new = c.text(payload)
            else:
                c = _Cursor(run, where, ts)
                masked = c.json(obj)
                new = json.dumps(masked, ensure_ascii=False) if c.changed else payload
            if c.changed:
                updates.append(("events", "payload", new, seq))
        for cid, title, preview, at in con.execute(
                "SELECT id, title, last_preview, updated_at FROM chats"):
            for column, value in (("title", title), ("last_preview", preview)):
                c = _Cursor(run, where, at or 0.0)
                new = c.text(value or "")
                if c.changed:
                    updates.append(("chats", column, new, cid))
        if not run.apply:
            return
        key = {"events": "seq", "chats": "id"}
        for table, column, new, k in updates:
            con.execute(f"UPDATE {table} SET {column} = ? WHERE {key[table]} = ?", (new, k))
        con.execute("COMMIT")
        if run.refused - refused:
            run.db_seq = after_seq      # a key still in there: read it all again next time
        if updates:
            run.changed.append(where)
            # Move the new pages into the file and empty the WAL that still
            # holds the old ones. A reader in the daemon can hold it up; then
            # the next run finishes it.
            for _ in range(10):
                busy, _log, _done = con.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                if not busy:
                    break
                time.sleep(1)
            else:
                run.errors.append(f"{where}: the WAL could not be emptied yet; the next run retries")
    except sqlite3.Error as exc:
        run.db_seq = after_seq
        if con.in_transaction:
            con.execute("ROLLBACK")
        run.errors.append(f"{where}: {type(exc).__name__}: {exc}")
    finally:
        con.close()


# ── state and report ──────────────────────────────────────────────────────────

def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {"files": {}, "secrets": {}}


def _merge(state: dict, found: dict[str, Found]) -> dict[str, Found]:
    """What earlier runs kept, joined with what this one saw."""
    out: dict[str, Found] = {}
    for service, s in state.get("secrets", {}).items():
        out[service] = Found(s["kind"], s["fingerprint"], set(s["files"]), s["first"], s["last"], s["status"])
    for service, f in found.items():
        old = out.get(service)
        if old is None:
            out[service] = Found(f.kind, f.fingerprint, set(f.files), f.first, f.last, f.status)
            continue
        old.files |= f.files
        old.first = min(old.first, f.first)
        old.last = max(old.last, f.last)
        if f.status != "found" and old.status != "stored":
            old.status = f.status
    return out


def _day(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M") if t else "?"


def render(all_found: dict[str, Found], run: Run) -> str:
    status = {"stored": "in keychain", "refused": "keychain refused — still in the files",
              "found": "dry run — not stored yet"}
    lines = [
        "# Keys found in chat history",
        "",
        f"Last run {_day(time.time())} ({'apply' if run.apply else 'dry run'}). "
        "Every key below was in a transcript, log or the chat database. Rotate it at its "
        "provider. The old value, until you delete it, is in the login keychain: "
        "`security find-generic-password -s <service> -w`.",
        "",
        "| kind | fingerprint | keychain service | files | first seen | last seen | keychain |",
        "|---|---|---|---|---|---|---|",
    ]
    for service, f in sorted(all_found.items(), key=lambda kv: (kv[1].kind, -kv[1].last)):
        lines.append(f"| {f.kind} | {f.fingerprint} | {service} | {len(f.files)} | "
                     f"{_day(f.first)} | {_day(f.last)} | {status[f.status]} |")
    if not all_found:
        lines.append("| — | — | — | 0 | — | — | — |")
    lines += ["", f"Scanned {run.scanned} files and rows, changed {len(run.changed)} files."]
    if run.skipped:
        lines += ["", f"## Skipped ({len(run.skipped)}) — written in the last {LIVE_SECONDS // 60} minutes, "
                  "next run takes them", ""]
        lines += [f"- {p}" for p in run.skipped]
    if run.errors:
        lines += ["", "## Problems", ""] + [f"- {e}" for e in run.errors]
    return "\n".join(lines) + "\n"


# ── the run ───────────────────────────────────────────────────────────────────

def run(home: Path, apply: bool, keychain=None, now: float | None = None) -> Run:
    rac = _rac(home)
    state_path = rac / STATE
    state = _load(state_path)
    done: dict[str, list[int]] = state.get("files", {})
    r = Run(apply, keychain or (secrets.default_keychain() if apply else None))
    now = time.time() if now is None else now

    scrub_db(r, rac / "db.sqlite", state.get("db_seq", 0))
    for path in targets(home):
        key = str(path)
        try:
            st = path.stat()
            if done.get(key) == [st.st_size, st.st_mtime_ns]:
                continue
            after = scrub_file(r, path, now)
        except OSError as exc:
            r.errors.append(f"{key}: {type(exc).__name__}")
            continue
        # A file is clean once every key in it is masked; one the keychain
        # refused is read again next time.
        if apply and after is not None and not any(
                key in r.found[s].files for s in r.refused):
            done[key] = [after.st_size, after.st_mtime_ns]

    all_found = _merge(state, r.found)
    rac.mkdir(parents=True, exist_ok=True)
    report = rac / REPORT
    report.write_text(render(all_found, r))
    os.chmod(report, 0o600)
    if apply:
        state = {
            "files": done,
            "db_seq": r.db_seq,
            "secrets": {s: {"kind": f.kind, "fingerprint": f.fingerprint, "files": sorted(f.files),
                            "first": f.first, "last": f.last, "status": f.status}
                        for s, f in all_found.items()},
        }
        tmp = state_path.with_name(f".{STATE}.tmp")
        tmp.write_text(json.dumps(state, indent=1))
        os.chmod(tmp, 0o600)
        os.replace(tmp, state_path)
    return r


def main(argv: list[str] | None = None, keychain=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m remote_ai_chat.scrub",
                                 description="Find keys in chat history; with --apply, keep them "
                                             "in the keychain and mask them.")
    ap.add_argument("--apply", action="store_true", help="store and rewrite (default: dry run)")
    ap.add_argument("--home", type=Path, default=Path.home(), help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    r = run(a.home, a.apply, keychain)
    kinds: dict[str, int] = {}
    for f in r.found.values():
        kinds[f.kind] = kinds.get(f.kind, 0) + 1
    print(f"{'apply' if a.apply else 'dry run'}: scanned {r.scanned}, keys {len(r.found)} "
          f"({', '.join(f'{k} {n}' for k, n in sorted(kinds.items())) or 'none'}), "
          f"changed {len(r.changed)} files, skipped {len(r.skipped)} live, "
          f"keychain refused {len(r.refused)}")
    for e in r.errors:
        print("  " + e, file=sys.stderr)
    print(f"report: {_rac(a.home) / REPORT}")
    return 1 if r.refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
