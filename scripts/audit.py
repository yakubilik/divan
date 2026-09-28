#!/usr/bin/env python3
"""Scan the repository for anything that must not be public.

    python scripts/audit.py                  # tracked files only
    python scripts/audit.py --history        # tracked files and every blob in git
    python scripts/audit.py --json

Exits non-zero when it finds something, so it can be a CI step or a pre-release
gate. It needs nothing but git and a Python interpreter, which is the point:
gitleaks and trufflehog are better at this, and neither is installed on every
machine this project is released from.

Three kinds of finding, because three different things went wrong before:

  *secret*    a key-shaped string. The prefixes are the ones the daemon's own
              redactor knows (`remote_ai_chat/security.py`) plus the rest of the
              usual set, so a token this repository would scrub out of a chat
              cannot sit in the repository itself.
  *personal*  an author's home directory, e-mail address or tailnet hostname.
              None of these is dangerous; all of them are somebody's, and a
              public repository is not the place to keep them.
  *language*  Turkish. The project is written in English and read in English,
              and a string in another language is a thing a contributor cannot
              fix. ALLOW below is the list of places where such a string is data
              rather than prose — a language detector needs the language in it.

History is scanned but never rewritten: `--history` reports the commit a blob
belongs to and stops there. Rewriting published history is a decision for a
person, not a script.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

# ── patterns ────────────────────────────────────────────────────────────────

SECRET = {
    "anthropic-key": r"sk-ant-[A-Za-z0-9_-]{16,}",
    "openai-key": r"\bsk-[A-Za-z0-9]{32,}",
    "github-token": r"\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{22,}",
    "gitlab-token": r"\bglpat-[0-9A-Za-z_-]{20,}",
    "slack-token": r"\bxox[baprs]-[A-Za-z0-9-]{10,}",
    "slack-webhook": r"https://hooks\.slack\.com/services/[A-Za-z0-9/]+",
    "aws-access-key": r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
    "google-api-key": r"\bAIza[0-9A-Za-z_-]{35}\b",
    "google-oauth": r"\bya29\.[0-9A-Za-z_-]{20,}",
    "npm-token": r"\bnpm_[A-Za-z0-9]{36}\b",
    "stripe-live-key": r"\b(?:sk|rk)_live_[0-9A-Za-z]{20,}",
    "sendgrid-key": r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}",
    "twilio-sid": r"\bAC[0-9a-f]{32}\b",
    "telegram-bot-token": r"\b\d{9,10}:[A-Za-z0-9_-]{35}\b",
    "private-key-block": r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----",
    "jwt": r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    "apns-key-file": r"\bAuthKey_[A-Z0-9]{10}\.p8\b",
    "credential-assignment":
        r"(?i)\b(?:api[_-]?key|secret|passwd|password|auth[_-]?token|access[_-]?token"
        r"|client[_-]?secret)\b\s*[:=]\s*[\"'][A-Za-z0-9_\-/+=.]{16,}[\"']",
    "bare-token-literal": r"(?i)\btoken\b\s*[:=]\s*[\"'][A-Za-z0-9_-]{24,}[\"']",
}

# Subjects that are not a person, so that naming one before an attribution verb
# is prose rather than a note to the author.
NOT_A_PERSON = (
    "Nobody|Somebody|Someone|Anybody|Anyone|Everyone|Everybody|Nothing|Something|"
    "Anything|Neither|Either|Each|The|This|That|These|Those|They|What|Whoever|"
    "Users|User|People|Contributors|Reviewers|Apple|Anthropic|Tailscale|Github|GitHub"
)

PERSONAL = {
    "home-directory": r"/(?:Users|home)/(?!you\b|test\b|runner\b|user\b)[a-z][a-z0-9._-]{2,}",
    "personal-email":
        r"[A-Za-z0-9._%+-]+@(?:gmail|googlemail|icloud|me|hotmail|outlook|live|yahoo|proton|protonmail)\.[A-Za-z.]{2,}",
    "tailnet-hostname": r"\b[a-z0-9][a-z0-9-]*\.[a-z0-9-]+\.ts\.net\b",
    "local-hostname": r"\b[A-Za-z0-9][A-Za-z0-9-]*-(?:MacBook|Macbook|iMac|Mac)(?:-[A-Za-z0-9]+)*\.local\b",
    # Prose that credits a decision to somebody by name. "X asked for that to
    # stop (2026-09-22)" is a note the author wrote to the author: a contributor
    # reading it learns only that they were not in the room, and the name is
    # somebody's. A shape, not a list of names — see AUTHOR_NAMES below for why
    # there is no list.
    "personal-attribution":
        rf"\b(?!(?:{NOT_A_PERSON})\b)[A-Z][a-z]{{2,}}(?:\s+[A-Z][a-z]+)?\s+"
        r"(?:asked|wanted|requested|complained|insisted|prefers|preferred)\b",
}

# The author's own name, and the names of the author's other projects, are the
# one class of finding this file cannot carry: a denylist of private names is
# itself the thing it guards. So they are supplied at scan time, as a regular
# expression, and the release audit records which list was used:
#
#     RAC_AUDIT_NAMES='ada|lovelace|some-other-project' python scripts/audit.py
#
# Without the variable the rule is absent — which is why the shape-based
# "personal-attribution" rule above exists as well.
AUTHOR_NAMES = os.environ.get("RAC_AUDIT_NAMES", "").strip()
if AUTHOR_NAMES:
    PERSONAL["author-name"] = rf"(?i)\b(?:{AUTHOR_NAMES})\b"

# Turkish letters English does not have, plus function words no English sentence
# contains. Both are needed: a short string can carry neither a letter nor a
# word on its own.
TURKISH_LETTERS = r"[şğıİöçüŞĞÖÇÜ]"
TURKISH_WORDS = (
    r"(?i)\b(?:acildi|aciklama|adres|arka|ayar|ayarlar|baglan|baglandi|baglanti|"
    r"basarili|basarisiz|basladi|baslat|bekleniyor|bekleyen|bekliyor|bilgisayar|"
    r"bilinmeyen|birader|bitti|cevap|cihaz|cikis|dakika|degil|degistir|dene|deposu|"
    r"devam|dosya|durum|duzenle|efendim|ekran|eksik|gecersiz|gez|gonder|gonderildi|"
    r"goster|guncelle|hata|hayir|hazir|hicbir|icin|iptal|izin|kac|kanka|kapali|"
    r"kapandi|kapat|kaydet|kaydedildi|klasor|kopyala|kopyalandi|kullanici|kur|"
    r"kuyrukta|lutfen|mesaj|modu|moruk|nasil|neden|oglum|oluyor|onay|oturum|panele|"
    r"parola|reddet|reddedildi|saniye|secim|secildi|sifre|simdi|sistem|silindi|"
    r"sohbet|sonuc|soru|sunucu|tamam|tamamlandi|tekrar|telefon|temiz|uyari|verildi|"
    r"yardim|yeni|yeniden|yokla|yukle|yukleniyor)\b"
)
LANGUAGE = {"turkish-letter": TURKISH_LETTERS, "turkish-word": TURKISH_WORDS}

# Where a word of another language is data the code cannot do without. Each
# entry is a path and the reason, and the reason is the whole justification for
# the exception — see docs/audit/ for the audit that granted it.
ALLOW = {
    "daemon/remote_ai_chat/call.py":
        "the concierge answers in the language it was asked in; the detector, the "
        "honorific mirror and the slang filter all have to name the words",
}

# The scan cannot scan itself. These three hold the patterns, the samples the
# patterns are tested against, and the report of what was found — every one of
# which has to contain the shape of the thing it is about. They are exempt from
# every rule, not just the language ones, so read them with your eyes: a real
# secret pasted into an audit report is the one thing this script cannot catch.
# Nothing else may be added here.
SELF = (
    "scripts/audit.py",
    "scripts/test_audit.py",
    "docs/audit/",
)

# Files whose bytes are not text. Scanned for names, not contents.
BINARY = (".png", ".jpg", ".jpeg", ".ico", ".ttf", ".otf", ".woff", ".woff2",
          ".wav", ".mp3", ".mp4", ".zip", ".pdf", ".icns")
# Generated, enormous, and not written by a person.
GENERATED = ("package-lock.json", "uv.lock", "OFL-Inter.txt", "OFL-JetBrainsMono.txt")

# Names that must never be tracked at all, whatever is in them.
FORBIDDEN_NAMES = re.compile(
    r"(?:^|/)\.env(\..*)?$|\.(p8|p12|pfx|pem|key|jks|keystore|mobileprovision|cer)$"
    r"|(?:^|/)uploads/|\.sqlite|\.db$|(?:^|/)identity\.local\.json$",
    re.IGNORECASE,
)

COMPILED = {**{k: (re.compile(v), "secret") for k, v in SECRET.items()},
            **{k: (re.compile(v), "personal") for k, v in PERSONAL.items()},
            **{k: (re.compile(v), "language") for k, v in LANGUAGE.items()}}


# ── plumbing ────────────────────────────────────────────────────────────────

def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def skip(path: str) -> bool:
    return path.lower().endswith(BINARY) or any(g in path for g in GENERATED)


def scan_text(path: str, text: str, where: str) -> list[dict]:
    out: list[dict] = []
    if path.startswith(SELF):
        return out
    allowed = ALLOW.get(path)
    for i, line in enumerate(text.splitlines(), 1):
        for name, (rx, kind) in COMPILED.items():
            m = rx.search(line)
            if not m:
                continue
            if kind == "language" and allowed:
                continue
            out.append({"kind": kind, "rule": name, "where": where, "path": path,
                        "line": i, "match": m.group(0)[:80]})
    return out


def scan_tracked() -> list[dict]:
    findings: list[dict] = []
    for path in git("ls-files").split("\n"):
        if not path:
            continue
        if FORBIDDEN_NAMES.search(path):
            findings.append({"kind": "tracked-file", "rule": "forbidden-name",
                             "where": "worktree", "path": path, "line": 0, "match": path})
        if skip(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        findings += scan_text(path, text, "worktree")
    return findings


def scan_history() -> list[dict]:
    """Every blob any commit ever pointed at, named by a path it appeared under."""
    paths: dict[str, str] = {}
    for line in git("rev-list", "--all", "--objects").split("\n"):
        oid, _, path = line.partition(" ")
        if path and oid not in paths:
            paths[oid] = path
    blobs = [l.split()[0] for l in git("cat-file", "--batch-check", "--batch-all-objects").split("\n")
             if len(l.split()) > 1 and l.split()[1] == "blob"]
    findings: list[dict] = []
    for oid in blobs:
        path = paths.get(oid, "<unreachable blob>")
        if skip(path):
            continue
        raw = subprocess.run(["git", "cat-file", "blob", oid], capture_output=True).stdout
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for f in scan_text(path, text, "history"):
            f["blob"] = oid
            findings.append(f)
    # Author identities live in the commits, not in any blob.
    seen: dict[str, int] = defaultdict(int)
    for line in git("log", "--all", "--format=%ae%n%ce").split("\n"):
        if line:
            seen[line] += 1
    for addr, n in seen.items():
        for name, (rx, kind) in COMPILED.items():
            if kind == "personal" and rx.search(addr):
                findings.append({"kind": "personal", "rule": f"{name}-in-commit-metadata",
                                 "where": "history", "path": "<commit author/committer>",
                                 "line": n, "match": addr})
                break
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--history", action="store_true",
                    help="also scan every blob and commit identity in git")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    a = ap.parse_args()

    findings = scan_tracked()
    worktree = len(findings)
    if a.history:
        findings += scan_history()

    if a.json:
        print(json.dumps(findings, indent=2))
    else:
        by_kind: dict[str, list[dict]] = defaultdict(list)
        for f in findings:
            by_kind[f["kind"]].append(f)
        for kind in ("tracked-file", "secret", "personal", "language"):
            hits = by_kind.get(kind, [])
            print(f"\n── {kind}: {len(hits)}")
            for f in hits:
                blob = f" blob {f['blob'][:12]}" if f.get("blob") else ""
                print(f"   [{f['where']}]{blob} {f['path']}:{f['line']}  {f['rule']}  {f['match']!r}")
        print(f"\n{worktree} finding(s) in tracked files"
              + (f", {len(findings) - worktree} in history" if a.history else ""))
        if a.history and len(findings) > worktree:
            print("History is not rewritten by this script. See docs/audit/ for the remedy.")

    # Only the worktree gates: history is a report, not a failure to fix here.
    return 1 if worktree else 0


if __name__ == "__main__":
    sys.exit(main())
