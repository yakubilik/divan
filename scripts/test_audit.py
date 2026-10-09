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

And the scanner's blind spot is covered here rather than left to a person's
eyes: the three files `audit.SELF` exempts are read back and checked for a home
directory, an address or a machine name that is not one of the samples written
down below. An audit report is where such a string is most at hand and least
noticed. Run with `RAC_AUDIT_NAMES` set, the read-back checks those files for
the author's own names as well — the one identifier shape that has no shape, and
so the one the samples cannot stand in for.
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import audit                                                   # noqa: E402

# The list the release is scanning with, read once and before any reload below
# changes it. Given one, the read-back at the end checks the exempt files for
# these names too; given none, it says so and checks the four shapes only.
GIVEN_NAMES = os.environ.get("RAC_AUDIT_NAMES", "").strip()

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
    ("home-directory-slug", "/projects/-Users-somebody-projects-thing/memory"),
    ("home-directory-slug", "/projects/-home-somebody-projects-thing/memory"),
    ("personal-email", "first.last@gmail.com"),
    ("tailnet-hostname", "laptop.tail1234.ts.net"),
    ("local-hostname", "Someones-MacBook-Air.local"),
    ("personal-attribution", "# Kevin asked for that to stop (2026-09-22)"),
    ("personal-attribution", "# Dana Scully preferred a banner here"),
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
    "const REPO = 'https://github.com/yakubilik/divan';",
    "# The name arrives percent-encoded, so the escape is not read as text.",
    "    Nobody asked, so there was no turn reading the stream, and the SDK parked",
    "# The user wanted a banner, so staying silent for every open app was wrong.",
    "# Apple requested a privacy label; Tailscale asked for nothing.",
    # The slug rule's own near misses: the scrubbed form the fixture carries,
    # and two ordinary dashed words that happen to spell one of its segments.
    '"cwd": "/Users/you/.claude/projects/-Users-you-projects-thing/memory/"',
    "a link to the some-home-page-header anchor",
    "the-users-list is sorted by name",
]


# ── the hole the exemption leaves ───────────────────────────────────────────
#
# `audit.SELF` exempts the scanner, its test and the audit reports from every
# rule, because all three have to carry the shape of the thing they are about —
# a report that cannot name what it found is not a report. The exemption is also
# the one blind spot in the scan: a real home directory, a real address or a
# real machine name pasted into a report would be published without a word of
# complaint, and a report of history is exactly where such a string is at hand.
#
# So the identifier rules are run against those files here, and every string
# that is allowed to match is written down: the synthetic samples above, and
# nothing else. The placeholders the reports are written in (`/Users/<name>`,
# `<name>@gmail.com`, `<Name>-MacBook-Air.local`) do not appear below because no
# rule matches them — the angle bracket breaks every one of the shapes, which is
# the property that makes them usable as placeholders in the first place.
#
# Those four are shapes, and a shape can be sampled. The fifth identifier in the
# scan — the author's own name, and the names of the author's other projects —
# is not: `author-name` is whatever list the release supplies in
# `RAC_AUDIT_NAMES`, so it cannot be checked against samples written down here
# and it cannot be checked at all unless a list is given. When one is, every
# exempt file is read back for it too, with nothing allowed to match. That pass
# is what the private skill name quoted verbatim in the first draft of the
# report needed, and what the four shapes above would never have caught.
#
# The list is the author's *private* names. The public GitHub handle belongs in
# the repository URL and in LICENSE, so putting it in the list would only fail
# this check on the places the ticket says are fine.
IDENTIFIER_RULES = ("home-directory", "home-directory-slug", "personal-email",
                    "tailnet-hostname", "local-hostname")

# This check needs a negative control, and a negative control has to be three
# real-shaped identifiers, in this file, which is one of the files being
# checked. So it is named, and its three matches are listed with the rest.
CONTROL = "run it from /Users/ada, mail ada@icloud.com, on Adas-MacBook.local"

REDACTED = {
    "/Users/somebody",              # FIRES, home-directory
    "/home/somebody",               # FIRES, home-directory
    "-Users-somebody-",             # FIRES, home-directory-slug
    "-home-somebody-",              # FIRES, home-directory-slug
    "first.last@gmail.com",         # FIRES, personal-email
    "laptop.tail1234.ts.net",       # FIRES, tailnet-hostname
    "Someones-MacBook-Air.local",   # FIRES, local-hostname
    "/Users/ada",                   # CONTROL, home-directory
    "ada@icloud.com",               # CONTROL, personal-email
    "Adas-MacBook.local",           # CONTROL, local-hostname
}

# The negative control for that pass, with a name list that is not anybody's:
# a private project name and a first name, in the shapes they turn up in — a
# fixture string and a line of prose.
NAME_CONTROL = ("names: project = \"lovelace-ledger\"\n"
                "# Ada wanted the banner gone\n")
NAME_CONTROL_NAMES = "ada|lovelace-ledger"
NAME_CONTROL_HITS = ["1: author-name 'lovelace-ledger'",
                     "2: author-name 'Ada'"]


# Where another language is data. Adding a file to `audit.ALLOW` is a decision,
# so it is made twice: there with its reason, and here.
ALLOWED = [
    "app/scripts/fixtures/tts-frontend.json",
    "app/scripts/test-call-chat.cjs",
    "app/scripts/test-ema.cjs",
    "app/scripts/test-waiting.cjs",
    "app/src/call-lines.ts",
    "app/src/tts/engine.ts",
    "app/src/tts/frontend.ts",
    "app/src/tts/normalizer.ts",
    "app/src/tts/values.ts",
    "app/src/tts/words.ts",
    "app/src/voice.ts",
    "app/src/waiting.ts",
    "daemon/remote_ai_chat/call.py",
    "daemon/remote_ai_chat/secrets.py",
    "daemon/remote_ai_chat/server.py",
    "daemon/remote_ai_chat/transcribe.py",
    "daemon/scripts/test_call.py",
    "daemon/scripts/test_dictation.py",
    "daemon/scripts/test_scrub.py",
    "daemon/scripts/test_secrets.py",
    "daemon/scripts/test_voice_bench.py",
    "daemon/scripts/voice_bench/bench.py",
    "daemon/scripts/voice_bench/ema_worker.py",
    "daemon/scripts/voice_bench/llm_latency.py",
    "daemon/scripts/voice_bench/scenarios.json",
    "docs/voice-bench/baseline-run2.json",
    "docs/voice-bench/baseline-run3.json",
    "docs/voice-bench/baseline.json",
    "docs/voice-bench/llm.json",
    "docs/voice-bench/proof.json",
    "docs/voice-bench/tts-roundtrip.json",
    "docs/voice-bench/whisper-small.json",
    "docs/voice-bench/whisper-turbo-q4.json",
    "tts/export.py",
    "tts/frontend_fixture.py",
    "tts/vectors.json",
    "web/scripts/test-overview.mjs",
    "web/scripts/test-refusal.mjs",
    "web/src/lib/refusal.ts",
    "web/src/lib/sessions.ts",
]


def unredacted(text: str, allowed: frozenset[str] | set[str] = REDACTED,
               rules: tuple[str, ...] = IDENTIFIER_RULES) -> list[str]:
    """Identifiers in a SELF file that are not one of the samples above."""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for rule in rules:
            for m in audit.COMPILED[rule][0].finditer(line):
                if m.group(0) not in allowed:
                    out.append(f"{i}: {rule} {m.group(0)!r}")
    return out


def names_in(text: str, names: str) -> list[str]:
    """The same read-back for `author-name`, with `names` supplied as at scan time.

    That rule exists only while `RAC_AUDIT_NAMES` is set, so the module is
    reloaded around the call and reloaded back afterwards. Nothing is allowed to
    match: a private name has no synthetic sample to be confused with, which is
    the whole reason it needs its own pass.
    """
    before = os.environ.get("RAC_AUDIT_NAMES")
    os.environ["RAC_AUDIT_NAMES"] = names
    try:
        importlib.reload(audit)
        return unredacted(text, allowed=frozenset(), rules=("author-name",))
    finally:
        if before is None:
            os.environ.pop("RAC_AUDIT_NAMES", None)
        else:
            os.environ["RAC_AUDIT_NAMES"] = before
        importlib.reload(audit)


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

    print("\nso the exempt files are read for identifiers here instead")
    exempt = [p for p in audit.git("ls-files").split("\n")
              if p and p.startswith(audit.SELF)]
    check("every exempt file is tracked and was found",
          len(exempt) >= 3 and "scripts/audit.py" in exempt, repr(exempt))
    for path in exempt:
        hits = unredacted(Path(path).read_text(encoding="utf-8"))
        check(f"{path} carries no unredacted identifier", not hits, "; ".join(hits))
    check("and the check would notice one",
          unredacted(CONTROL, allowed=frozenset())
          == ["1: home-directory '/Users/ada'",
              "1: personal-email 'ada@icloud.com'",
              "1: local-hostname 'Adas-MacBook.local'"])
    check("the placeholders the reports are written in are not identifiers",
          not unredacted("/Users/<name>, <name>@gmail.com, <Name>-MacBook-Air.local,"
                         " com.<name>.remoteaichat", allowed=frozenset()))

    # ── the fixture, by name ────────────────────────────────────────────────
    #
    # `app/scripts/fixtures/run.log` is a recording of a real run, and a run log
    # is nothing but absolute paths: it is the one tracked file in this tree
    # whose whole content is other people's home directories, copied in. It is
    # scanned like anything else, and it still went out carrying the author's
    # username — in the slug form, which neither the scrubber that made it nor
    # the rule above knew about at the time. So it is also checked here by name,
    # because the file that regressed is worth a line that says so.
    print("\nthe captured run fixture carries nobody's home directory")
    fixture = Path("app/scripts/fixtures/run.log")
    check("the fixture is where both readers look for it", fixture.exists(), str(fixture))
    if fixture.exists():
        hits = unredacted(fixture.read_text(encoding="utf-8", errors="replace"),
                          allowed=frozenset())
        check("no identifier in any of its forms", not hits, "; ".join(hits[:4]))
        check("and the scan reaches it — it is not exempt",
              not fixture.as_posix().startswith(audit.SELF))

    print("\nand for the author's own names, which have no shape to sample")
    control = names_in(NAME_CONTROL, NAME_CONTROL_NAMES)
    check("the read-back finds a name the release named",
          control == NAME_CONTROL_HITS, repr(control))
    check("which the scan itself would not, in an exempt file",
          not audit.scan_text("docs/audit/report.md", NAME_CONTROL, "test"))
    check("and not on the redaction that replaced one",
          not names_in('| `"<name>-projects"` — the author\'s own skill, as a fixture |',
                       NAME_CONTROL_NAMES))
    if GIVEN_NAMES:
        for path in exempt:
            hits = names_in(Path(path).read_text(encoding="utf-8"), GIVEN_NAMES)
            check(f"{path} names none of them", not hits, "; ".join(hits))
    else:
        print("  skip  RAC_AUDIT_NAMES is unset, so there is no list to read back"
              " for;\n        the release runs this with one, and records that it did")

    print("\nthe language allowlist covers exactly these files")
    allowed = sorted(audit.ALLOW)
    check("the list is the one written down here", allowed == ALLOWED, repr(allowed))
    check("and every entry says why", all(len(why.split()) >= 5 for why in audit.ALLOW.values()))
    turkish = "onay bekliyor için değil"
    check("a Turkish word there is data, not a finding",
          not audit.scan_text("daemon/remote_ai_chat/call.py", turkish, "test"))
    check("the same word anywhere else is a finding",
          bool(audit.scan_text("daemon/remote_ai_chat/config.py", turkish, "test")))
    check("the allowlist does not also excuse a secret",
          any(h["rule"] == "aws-access-key" for h in
              audit.scan_text("daemon/remote_ai_chat/call.py", "AKIAIOSFODNN7EXAMPLE", "test")))

    print("\nno client file is left pending")
    check("the pending list is empty", audit.PENDING == (), repr(audit.PENDING))
    check("so a Turkish word in a client file fails the scan",
          [h["pending"] for h in audit.scan_text("web/src/lib/inbox.ts", "onay", "test")] == [False])

    print("\nthe author's own names are given at scan time, not written down here")
    # This section is about what the scanner carries when no list is given, so a
    # list the release did give is taken away again for the length of it.
    supplied = os.environ.pop("RAC_AUDIT_NAMES", None)
    importlib.reload(audit)
    try:
        check("no name list in the scanner by default", "author-name" not in audit.PERSONAL,
              repr(sorted(audit.PERSONAL)))
        os.environ["RAC_AUDIT_NAMES"] = NAME_CONTROL_NAMES
        try:
            importlib.reload(audit)
            check("RAC_AUDIT_NAMES adds the rule", "author-name" in audit.PERSONAL)
            check("a name given at scan time is found",
                  any(h["rule"] == "author-name" for h in
                      audit.scan_text("t.py", 'project = "lovelace-ledger"', "test")))
            check("and it is case-blind, like a name in prose",
                  any(h["rule"] == "author-name" for h in
                      audit.scan_text("t.py", "# Ada wrote this one", "test")))
            check("a word that merely contains one is not a name",
                  not audit.scan_text("t.py", "# adapters and ledgers are fine", "test"))
        finally:
            os.environ.pop("RAC_AUDIT_NAMES", None)
            importlib.reload(audit)
        check("and the rule is gone again once it is not given",
              "author-name" not in audit.PERSONAL)
    finally:
        if supplied is not None:
            os.environ["RAC_AUDIT_NAMES"] = supplied
        importlib.reload(audit)

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
