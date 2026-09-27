#!/usr/bin/env python3
"""The audit scanner finds what it claims to find.

    python scripts/test_audit.py

A scanner that reports "none" is only worth something if it would have said
something else. Every rule in `scripts/audit.py` is fired here against a string
of the shape it exists for, and against a string it must *not* fire on — the
placeholders this repository does use on purpose (`/Users/you/…`,
`you@example.com`) were the first false positives the scan produced.

The allowlist is checked too: a Turkish word in `remote_ai_chat/call.py` is data
the language detector cannot work without, and anywhere else it is a bug.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import audit                                                   # noqa: E402

# One string per rule, in the shape the rule is for. None of these is real: the
# key-shaped ones are the documented prefix plus filler of the right length.
FIRES = [
    ("anthropic-key", "sk-ant-api03-" + "A" * 40),
    ("openai-key", "sk-" + "B" * 40),
    ("github-token", "ghp_" + "c" * 36),
    ("github-token", "github_pat_" + "d" * 30),
    ("gitlab-token", "glpat-" + "e" * 20),
    ("slack-token", "xoxb-1234567890-abcdefghij"),
    ("slack-webhook", "https://hooks.slack.com/services/T00/B00/XXXXXXXX"),
    ("aws-access-key", "AKIAIOSFODNN7EXAMPLE"),
    ("google-api-key", "AIza" + "f" * 35),
    ("google-oauth", "ya29." + "g" * 30),
    ("npm-token", "npm_" + "h" * 36),
    ("stripe-live-key", "sk_live_" + "i" * 24),
    ("sendgrid-key", "SG." + "j" * 22 + "." + "k" * 22),
    ("twilio-sid", "AC" + "0" * 32),
    ("telegram-bot-token", "123456789:" + "l" * 35),
    ("private-key-block", "-----BEGIN EC PRIVATE KEY-----"),
    ("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u"),
    ("apns-key-file", "AuthKey_ABCD123456.p8"),
    ("credential-assignment", 'password = "hunter2hunter2hunter2"'),
    ("bare-token-literal", "token: 'abcdefghijklmnopqrstuvwxyz0123'"),
    ("home-directory", "/Users/somebody/projects/thing"),
    ("home-directory", "/home/somebody/projects/thing"),
    ("personal-email", "first.last@gmail.com"),
    ("tailnet-hostname", "laptop.tail1234.ts.net"),
    ("local-hostname", "Someones-MacBook-Air.local"),
    ("turkish-letter", "Bir şey yok"),
    ("turkish-word", "onay bekliyor"),
]

# Strings that look like a finding and are not. Each one is in the repository.
QUIET = [
    "/** `/Users/you/projects/some-app` -> `~/projects/some-app`. */",
    "loginEmail: 'you@example.com',",
    'cfg.allowed_roots = ["/Users/test/projects"]',
    'uses: actions/checkout@v4   # /home/runner/work is the checkout',
    're.compile(r"github_pat_[A-Za-z0-9_]{20,}"),',
    "const REPO = 'https://github.com/yakubilik/remote-ai-chat';",
    "# The name arrives percent-encoded, so the escape is not read as text.",
]


def main() -> int:
    fails = 0

    def check(name: str, ok: bool, extra: str = "") -> None:
        nonlocal fails
        print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {extra}" if not ok and extra else ""))
        fails += 0 if ok else 1

    print("every rule fires on the shape it is for")
    for rule, sample in FIRES:
        hits = audit.scan_text("some/file.txt", sample, "test")
        rules = {h["rule"] for h in hits}
        check(f"{rule} <- {sample[:32]!r}", rule in rules, f"got {sorted(rules)}")

    print("\nand not on the placeholders this repository uses on purpose")
    for sample in QUIET:
        hits = audit.scan_text("some/file.txt", sample, "test")
        check(f"{sample[:52]!r}", not hits, f"got {[h['rule'] for h in hits]}")

    print("\nthe scan does not scan itself, and nothing else gets that")
    check("three entries, and these three",
          audit.SELF == ("scripts/audit.py", "scripts/test_audit.py", "docs/audit/"),
          repr(audit.SELF))
    for path in ("scripts/audit.py", "scripts/test_audit.py",
                 "docs/audit/2026-09-27-security-audit.md"):
        check(f"{path} is exempt",
              not audit.scan_text(path, "AKIAIOSFODNN7EXAMPLE onay bekliyor", "test"))
    for path in ("scripts/release.py", "docs/PROTOCOL.md", "daemon/remote_ai_chat/push.py"):
        check(f"{path} is not",
              bool(audit.scan_text(path, "AKIAIOSFODNN7EXAMPLE", "test")))

    print("\nthe language allowlist covers exactly one file")
    allowed = sorted(audit.ALLOW)
    check("call.py is the only entry", allowed == ["daemon/remote_ai_chat/call.py"], repr(allowed))
    turkish = "onay bekliyor için değil"
    check("a Turkish word there is data, not a finding",
          not audit.scan_text("daemon/remote_ai_chat/call.py", turkish, "test"))
    check("the same word anywhere else is a finding",
          bool(audit.scan_text("daemon/remote_ai_chat/server.py", turkish, "test")))
    check("the allowlist does not also excuse a secret",
          any(h["rule"] == "aws-access-key" for h in
              audit.scan_text("daemon/remote_ai_chat/call.py", "AKIAIOSFODNN7EXAMPLE", "test")))

    print("\nthe forbidden-name list covers what the release checklist forbids")
    for path in (".env", "app/.env.local", "daemon/AuthKey_ABCD123456.p8", "certs/apns.p12",
                 "certs/server.pem", "release.jks", "uploads/photo.png", "db.sqlite",
                 "chats.db", "app/identity.local.json"):
        check(f"{path} would be refused", bool(audit.FORBIDDEN_NAMES.search(path)))
    for path in ("README.md", "daemon/remote_ai_chat/server.py", "web/src/App.tsx",
                 "app/assets/icon.png"):
        check(f"{path} is fine", not audit.FORBIDDEN_NAMES.search(path))

    print(f"\n{'all good' if not fails else str(fails) + ' failed'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
