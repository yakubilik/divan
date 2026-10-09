"""Keys pasted into a chat: found, put in the keychain, and replaced by a pointer.

A key typed into the composer used to go everywhere the message went — the
events table, the phone's timeline, the prompt and from there the provider's
own transcripts. Here it is caught on the way in: each value goes into the
login keychain as a generic password, and the message carries a placeholder
that says where it went and how to read it back.

The service name is the key's family and a fingerprint of the value, so the
same key pasted twice is the same keychain item, and the placeholder can be
rebuilt from the value alone — which is what the history scrub relies on.

Nothing in this module logs a value. The fingerprint is eight hex characters
of a SHA-256: enough to tell two keys apart, nothing to recover one from.
"""
from __future__ import annotations

import hashlib
import logging
import re
import subprocess
from dataclasses import dataclass, field

log = logging.getLogger("rac.secrets")

SERVICE_PREFIX = "rac-secret-"
ACCOUNT = "divan"

# A key does not start in the middle of a word or end in one. `-` counts as
# part of a word because most of these keys use it inside.
_L = r"(?<![A-Za-z0-9_\-])"
_R = r"(?![A-Za-z0-9_\-])"


@dataclass(frozen=True)
class Family:
    kind: str
    pattern: re.Pattern
    # A random key has letters and digits both; a long identifier usually does not.
    mixed: bool = False


# Earlier wins where two would claim the same characters: sk-ant- before sk-,
# a Sentry token before the JWT inside it, any named key before key=value.
FAMILIES: list[Family] = [
    Family("pem", re.compile(
        r"-----BEGIN (?P<label>[A-Z0-9 ]*)PRIVATE KEY-----[\s\S]+?-----END (?P=label)PRIVATE KEY-----")),
    Family("anthropic", re.compile(_L + r"sk-ant-[A-Za-z0-9_\-]{20,}" + _R)),
    Family("openai", re.compile(_L + r"sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}" + _R), mixed=True),
    Family("stripe", re.compile(_L + r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}" + _R)),
    Family("aws", re.compile(_L + r"(?:AKIA|ASIA)[0-9A-Z]{16}" + _R)),
    Family("github", re.compile(_L + r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})" + _R)),
    Family("google", re.compile(_L + r"AIza[0-9A-Za-z_\-]{35}" + _R)),
    Family("resend", re.compile(_L + r"re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}" + _R), mixed=True),
    Family("posthog", re.compile(_L + r"ph[cx]_[A-Za-z0-9]{30,}" + _R), mixed=True),
    Family("sentry", re.compile(_L + r"sntry[su]_[A-Za-z0-9+/=_\-]{20,}" + _R)),
    Family("slack", re.compile(_L + r"xox[abposr]-[A-Za-z0-9\-]{10,}" + _R), mixed=True),
    Family("telegram", re.compile(_L + r"\d{8,10}:[A-Za-z0-9_\-]{35}" + _R), mixed=True),
    Family("jwt", re.compile(_L + r"eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}" + _R)),
    # `OPENAI_API_KEY=...`, `password: "..."`, `"client_secret": "..."`. Only
    # the value is taken; the name stays, so the reader still sees what it was.
    Family("secret", re.compile(
        r"(?i)(?<![A-Za-z0-9])(?P<n>[A-Za-z0-9_\-]*(?:api[_\-]?key|secret|token|passw(?:or)?d|pwd|access[_\-]?key)"
        r"[A-Za-z0-9_\-]*)['\"]?\s*[=:]\s*['\"]?(?P<v>[A-Za-z0-9_\-/+=.]{12,})"), mixed=True),
    # An app password (Google, Apple) is four groups of four letters. The shape
    # alone is four short words, so it counts only with the words that come
    # with it close by: "app password", "uygulama şifresi", "gmail", "şifre".
    Family("apppassword", re.compile(
        r"(?i)(?:app(?:lication)?[ \-]?(?:specific )?passw(?:or)?d|uygulama şifre\w*|app şifre\w*|gmail|"
        r"şifre\w*|parola\w*|passw(?:or)?d)[^\n]{0,40}?(?<![a-z])(?P<v>[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}|[a-z]{16})(?![a-z])")),
    # A password said in a sentence, in Turkish or English: "şifrem: …",
    # "mailin şifresi … bunu kullan", "password is …". The value has to have a
    # digit or a symbol in it, which keeps "şifreni sıfırla" a sentence and
    # `process.env.DB_PASSWORD` a name; a full stop or comma after it is the
    # sentence's.
    Family("password", re.compile(
        r"(?i)(?<![A-Za-zÇĞİÖŞÜçğıöşü])(?:şifre(?:m|n|si|miz|niz|leri)?|parola(?:m|n|sı|mız)?|"
        r"passw(?:or)?d|pwd|pw|pass)(?:\s*[:=]|\s+(?:is|şu|şudur|olarak)\b)?\s*['\"]?"
        r"(?P<v>(?=[^\s'\"]*[^\sA-Za-zÇĞİÖŞÜçğıöşü._'\"])[^\s'\"]{6,}?)['\"]?(?=[.,;:)]*(?:\s|$))")),
]

# Spans nothing is looked for in: an inline image is long, random, and not a
# key, and a placeholder already written must not be caught a second time.
_DATA_URL = re.compile(r"data:[\w.+\-]+/[\w.+\-]+;base64,[A-Za-z0-9+/=]+")
# `API_KEY_PATH=/Users/me/AuthKey.p8` names where a key lives, not the key.
_WHERE = re.compile(r"(?i)(?:path|file|dir)$")
_PLACEHOLDER = re.compile(r"\[secret [a-z]+ " + re.escape(SERVICE_PREFIX) + r"[^\]]*\]")


@dataclass(frozen=True)
class Hit:
    kind: str
    start: int
    end: int
    value: str

    @property
    def service(self) -> str:
        return service_for(self.kind, self.value)


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def service_for(kind: str, value: str) -> str:
    return f"{SERVICE_PREFIX}{kind}-{fingerprint(value)}"


def placeholder(kind: str, service: str, stored: bool = True) -> str:
    if stored:
        return f"[secret {kind} {service} — read with: security find-generic-password -s {service} -w]"
    return f"[secret {kind} {service} — not saved: the keychain refused it]"


#: What a person calls each family, for the places that show a placeholder as a
#: line of text: a chat's title and the preview under it in the list.
NAMES = {
    "openai": "OpenAI key", "anthropic": "Anthropic key", "github": "GitHub token",
    "aws": "AWS key", "google": "Google key", "stripe": "Stripe key", "resend": "Resend key",
    "posthog": "PostHog key", "sentry": "Sentry token", "slack": "Slack token",
    "telegram": "Telegram bot token", "jwt": "token", "pem": "private key", "secret": "secret",
    "password": "password", "apppassword": "app password",
}


def shown(text: str) -> str:
    """The text with each placeholder as `🔒 OpenAI key`: for a title or a preview,
    where the pointer the agent needs is a line of noise, and a cut at 200
    characters would leave half of one."""
    return _PLACEHOLDER.sub(lambda m: "🔒 " + NAMES.get(m.group(0).split(" ")[1], "secret"), text or "")


def _mixed(value: str) -> bool:
    return any(c.isdigit() for c in value) and any(c.isalpha() for c in value)


def find(text: str) -> list[Hit]:
    """Every key in `text`, in order, none overlapping another."""
    if not text:
        return []
    taken = [m.span() for m in _DATA_URL.finditer(text)]
    taken += [m.span() for m in _PLACEHOLDER.finditer(text)]
    hits: list[Hit] = []
    for fam in FAMILIES:
        group = "v" if "v" in fam.pattern.groupindex else 0
        for m in fam.pattern.finditer(text):
            start, end = m.span(group)
            value = m.group(group)
            if fam.mixed and not _mixed(value):
                continue
            if "n" in fam.pattern.groupindex and _WHERE.search(m.group("n")):
                continue
            if any(start < e and s < end for s, e in taken):
                continue
            taken.append((start, end))
            hits.append(Hit(fam.kind, start, end, value))
    return sorted(hits, key=lambda h: h.start)


def _replace(text: str, hits: list[Hit], render) -> str:
    out, pos = [], 0
    for h in hits:
        out.append(text[pos:h.start])
        out.append(render(h))
        pos = h.end
    out.append(text[pos:])
    return "".join(out)


def mask(text: str) -> str:
    """`text` with every key replaced by its placeholder. Stores nothing."""
    hits = find(text)
    if not hits:
        return text
    return _replace(text, hits, lambda h: placeholder(h.kind, h.service))


class KeychainError(Exception):
    """The keychain would not take a value. The message never contains it."""


class Keychain:
    """The macOS login keychain, as much of it as this needs: one upsert.

    The value is handed to `security` on stdin, hex-encoded, so it is never on
    a command line where `ps` would show it, and a PEM block's newlines need no
    quoting. `-U` updates an item that is already there, so storing the same
    key twice leaves one item.
    """

    def __init__(self, account: str = ACCOUNT, timeout: float = 10.0) -> None:
        self.account = account
        self.timeout = timeout
        self.stored: set[str] = set()   # services written by this process

    def store(self, service: str, value: str) -> None:
        if service in self.stored:
            return
        line = (f"add-generic-password -U -a {self.account} -s {service} -l {service} "
                f"-X {value.encode().hex()}\n")
        try:
            r = subprocess.run(["/usr/bin/security", "-i"], input=line, capture_output=True,
                               text=True, timeout=self.timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise KeychainError(f"security could not run: {type(exc).__name__}") from None
        if r.returncode != 0:
            # stderr is the usage text and an error line; neither repeats the input.
            raise KeychainError(f"security exited {r.returncode}")
        self.stored.add(service)


_default: Keychain | None = None


def default_keychain() -> Keychain:
    global _default
    if _default is None:
        _default = Keychain()
    return _default


@dataclass
class Captured:
    text: str
    hits: list[Hit] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)   # services the keychain refused


def capture(text: str, keychain=None) -> Captured:
    """Store every key in `text` and return the text with placeholders instead.

    A key the keychain will not take is masked all the same — losing it from
    the message is better than keeping it there — and the failure is logged
    by service name, never by value.
    """
    hits = find(text)
    if not hits:
        return Captured(text)
    keychain = keychain or default_keychain()
    failed: list[str] = []
    for h in hits:
        service = h.service
        if service in failed:
            continue
        try:
            keychain.store(service, h.value)
        except Exception as exc:
            failed.append(service)
            log.warning("could not keep %s in the keychain: %s", service,
                        exc if isinstance(exc, KeychainError) else type(exc).__name__)
    masked = _replace(text, hits, lambda h: placeholder(h.kind, h.service, h.service not in failed))
    return Captured(masked, hits, failed)
