"""Dangerous-command detection, path allowlist, secret redaction."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shlex
import tempfile
import time
from contextvars import ContextVar
from pathlib import Path
from typing import NamedTuple

import httpx
import jwt

from . import legacy
from .secrets import FAMILIES, find as find_secrets

# The daemon's data home by name, now and before the rename: the migration
# leaves the old path as a symlink, so it reaches the same files.
_HOME_NAMES = r"(?:\.divan|" + re.escape(legacy.HOME_NAME) + ")"

log = logging.getLogger("rac.security")

# Why a command is put to the phone. These three and nothing else (Yakup, 15
# Oct 2026): a question about a harmless command is one he cannot answer in
# time, and a question nobody answers is a denial the agent then works around.
# Everything that is not one of these runs without asking.
MONEY = "spends money"
EXPOSURE = "exposes the machine or a secret"
DESTRUCTION = "can destroy the machine or your data"
CATEGORIES = (MONEY, EXPOSURE, DESTRUCTION)
# How config.toml names them in `ask_for`.
CATEGORY_KEYS = {"money": MONEY, "exposure": EXPOSURE, "destruction": DESTRUCTION}


def asked(reason: str | None, ask_for: list[str] | None) -> str | None:
    """The reason, if its category is one this machine still asks about.

    `ask_for` is Config.ask_for: on 28 Oct 2026 Yakup kept only "money", so
    exposure and destruction run without a word there.
    """
    if not reason or ask_for is None:
        return reason
    wanted = tuple(CATEGORY_KEYS[k] for k in ask_for if k in CATEGORY_KEYS)
    return reason if reason.startswith(wanted) else None


class Rule(NamedTuple):
    category: str
    pattern: re.Pattern
    why: str

    def reason(self) -> str:
        return f"{self.category}: {self.why}"


def _rule(category: str, pattern: str, why: str, flags: int = 0) -> Rule:
    return Rule(category, re.compile(pattern, flags), why)


# What a regex can still say: these have one spelling, and no path to resolve.
# They are matched against the command's *code* — quoted strings and heredoc
# bodies blanked out (`_code`) — so a commit message or a JSON file that
# mentions one is not one. `rm`, `git push`, `find`, `chmod`, `kill*`, the
# shutdown family, a download piped into a shell and the money and exposure
# commands are parsed instead, further down.
RULES = [
    _rule(DESTRUCTION, r"\bdd\s+[^|;&\n]*\bof=/dev/", "dd onto a disk"),
    _rule(DESTRUCTION, r"\bmkfs\.", "formats a disk"),
    _rule(DESTRUCTION, r"\bdiskutil\s+(?:\S+\s+)?(?:erase\w*|zeroDisk|randomDisk|secureErase|"
                       r"partitionDisk|reformat|deleteContainer|deleteVolume)\b", "erases a disk"),
    _rule(DESTRUCTION, r">\s*/dev/r?(?:sd[a-z]|disk\d)", "writes straight onto a disk"),
    _rule(DESTRUCTION, r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", "a fork bomb"),
    _rule(DESTRUCTION, r"\bgit\s+reset\s+--hard\b", "git reset --hard throws away uncommitted work"),
    _rule(DESTRUCTION, r"\bgit\s+(?:filter-branch|filter-repo)\b", "rewrites git history"),
    _rule(DESTRUCTION, r"security\s+delete-(?:keychain|generic-password|internet-password)",
          "deletes from the keychain"),
    _rule(DESTRUCTION, r"\blaunchctl\s+(?:unload|bootout|disable|remove)\b",
          "stops a background service (the daemon is one)"),
    _rule(DESTRUCTION, r"\bdropdb\b", "drops a database"),
    _rule(DESTRUCTION, r"\bfirebase\s+(?:firestore:delete\b[^|;&\n]*(?:--all-collections|-r\b|--recursive)"
                       r"|database:remove\b)", "deletes a Firebase database"),
    _rule(EXPOSURE, r"\b(?:sh|bash|zsh|dash|ksh|eval|source)\b[^|;&\n]*[$<]\(\s*(?:curl|wget)\b",
          "runs a script straight from the internet"),
    _rule(EXPOSURE, r"socketfilterfw\b[^|;&\n]*--setglobalstate\s+off|\bpfctl\s+-d\b"
                    r"|\bspctl\s+--(?:master|global)-disable\b|\bcsrutil\s+disable\b"
                    r"|\bsystemsetup\s+-setremotelogin\s+on\b|\bufw\s+disable\b",
          "turns off the firewall or a system protection"),
    _rule(EXPOSURE, r"\bngrok\s+(?:http|tcp|tls|start)\b|\bcloudflared\s+(?:tunnel\b[^|;&\n]*"
                    r"(?:\brun\b|--url)|access\s+tcp)|\btailscale\s+funnel\s+(?!(?:status|reset|off)\b)\S"
                    r"|\b(?:lt|localtunnel)\s+[^|;&\n]*--port\b|\bssh\s+[^|;&\n]*-R\s*\S"
                    r"|\bserveo\.net\b|\blocalhost\.run\b",
          "opens this machine to the internet"),
]

# Inside a python/node/perl script, which a regex over the shell cannot see.
SCRIPT_RULES = [
    # Python deleting a tree is `rm -r` with the path hidden inside a string.
    _rule(DESTRUCTION, r"\brmtree\s*\(", "deletes a folder tree from a script"),
]

# The sign-ins and the push key: even reading these puts a token in a chat.
_CREDENTIALS = _rule(EXPOSURE, r"\.credentials\.json|" + _HOME_NAMES + r"/apns/",
                     "reads a sign-in token or the push key")

_SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
_INTERPRETERS = re.compile(r"^(?:python[0-9.]*|node|nodejs|deno|bun|perl|ruby|osascript)$")
_SQL_CLIENTS = {"sqlite3", "psql", "mysql", "mariadb", "mongosh", "mongo", "redis-cli"}
_POWER = {"shutdown", "reboot", "halt", "poweroff"}
# Words that run the command after them, so the command is the next word.
_WRAPPERS = {"command", "builtin", "exec", "nohup", "time", "nice", "env", "noglob",
             "xargs", "caffeinate", "npx", "bunx", "pnpx"}
_SUDO_TAKES_VALUE = {"-u", "-g", "-h", "-p", "-C", "-D", "-U", "-T", "-R"}
_GIT_TAKES_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
_OPERATORS = frozenset(";<>|&\n")
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_SUBSTITUTION = re.compile(r"\$\(([^()]*)\)|`([^`]*)`")
_GLOB = re.compile(r"[*?\[]|(?<!\$)\{")
_EVERYTHING = {"*", ".*", "{*,.*}", "{.*,*}", "{,.}*", ".[!.]*"}
_OPEN_MODE = re.compile(r"^(0?777|[ugoa]*a[ugoa]*[+=]rwx|ugo[+=]rwx)$")
# The daemon's own folder: its config, its database. Uploads, the log and the
# accounts' memory and skills are what a chat works in all day.
_DAEMON_HOME = re.compile(r"(?<![\w.-])" + _HOME_NAMES + r"(?:/(?!(?:uploads|logs|accounts)(?:/|$))|$)")
_SQL_WRITES = re.compile(
    # `replace(` is the string function, which reads; only the REPLACE statement
    # writes. A night watch select over chat events asked like a delete (31 Oct 2026).
    r"\b(insert|update|delete|replace(?!\s*\()|drop|alter|create|vacuum|attach|reindex|upsert)\b"
    r"|\bpragma\b[^;]*=|^\s*\.(import|restore|save|output|once|shell|system)\b|;\s*\.",
    re.I | re.M)
_DROP_DATABASE = re.compile(r"\bdrop\s+(?:database|schema)\b|\bdropDatabase\s*\(|\bflush(?:all|db)\b", re.I)
# Commands that change every path they are given, and those that change only
# the last one (the destination).
_WRITES_ALL = {"rm", "unlink", "rmdir", "shred", "srm", "trash", "truncate", "touch", "tee",
               "chmod", "chown", "chgrp", "mv"}
_WRITES_LAST = {"cp", "ln", "rsync", "install", "ditto"}
# Processes whose death takes the daemon, its agents or the machine with them.
_VITAL = re.compile(r"^(?:divan|" + legacy.PROCESS_PATTERN + r"|python[0-9.]*|Python|claude|codex"
                    r"|launchd|WindowServer|loginwindow|kernel_task|sshd|tailscaled|Tailscale"
                    r"|IPNExtension|cloudflared)$")
_PKILL_TAKES_VALUE = {"-u", "-U", "-P", "-g", "-G", "-t", "-s", "-F"}

# Files whose contents are a key, and the commands that send things off the machine.
_SECRET_FILE = re.compile(r"(?:^|[/@=])(?:\.ssh/|\.aws/credentials|\.netrc$|\.env(?!\.(?:example|sample|template)$)(?:\.[\w-]+)?$"
                          r"|id_(?:rsa|dsa|ecdsa|ed25519)\b|\.credentials\.json$|\.npmrc$|\.pypirc$"
                          r"|[^/]*\.(?:pem|p12|pfx)$|\.gnupg/)")
_SENDERS = {"curl", "wget", "http", "https", "xh", "nc", "ncat", "netcat", "scp", "sftp", "ftp",
            "rsync", "telnet", "socat"}
# Paid APIs (models, speech, SMS), called with a body: that call is billed.
_PAID_API = re.compile(
    r"\b(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com"
    r"|aiplatform\.googleapis\.com|texttospeech\.googleapis\.com|api\.elevenlabs\.io"
    r"|api\.replicate\.com|api\.stability\.ai|api\.together\.xyz|api\.mistral\.ai"
    r"|api\.deepgram\.com|api\.cohere\.(?:ai|com)|api\.groq\.com|openrouter\.ai"
    r"|fal\.run|api\.perplexity\.ai|api\.twilio\.com|api\.x\.ai)\b")
_BODY_FLAGS = re.compile(r"^(?:-d|--data(?:-\w+)?|-F|--form|--json|-T|--upload-file|-XPOST|-X)$|^-d.")


def _code(cmd: str) -> str:
    """The command with what is inside its quotes blanked out.

    A quoted string is an argument, not a command, so a regex over the
    command's code must not see it. What still runs inside double quotes —
    `$(…)` and backticks — is kept.
    """
    out: list[str] = []
    i, n = 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if ch == "\\":
            out.append(cmd[i:i + 2])
            i += 2
        elif ch == "'":
            j = cmd.find("'", i + 1)
            out.append("''")
            i = n if j < 0 else j + 1
        elif ch == '"':
            j, kept = i + 1, []
            while j < n and cmd[j] != '"':
                if cmd[j] == "\\":
                    j += 2
                elif cmd.startswith("$(", j):
                    depth, k = 0, j + 1
                    while k < n:
                        depth += {"(": 1, ")": -1}.get(cmd[k], 0)
                        if depth == 0:
                            break
                        k += 1
                    kept.append(cmd[j:k + 1])
                    j = k + 1
                elif cmd[j] == "`":
                    k = cmd.find("`", j + 1)
                    k = n - 1 if k < 0 else k
                    kept.append(cmd[j:k + 1])
                    j = k + 1
                else:
                    j += 1
            out.append('"' + " ".join(kept) + '"')
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


_HEREDOC = re.compile(r"(?<![<\w])<<(?!<)(-?)[ \t]*(['\"]?)([A-Za-z_][\w.-]*)\2")


def _unquoted_at(line: str, pos: int) -> bool:
    before = line[:pos]
    return before.count("'") % 2 == 0 and before.count('"') % 2 == 0


def _inline_heredocs(cmd: str) -> str:
    """The command with every heredoc body taken out of the command stream.

    A body is data to the command it is fed to — `cat > a.json <<'EOF'` writes
    a file, and nothing in the file runs (15 Oct 2026: a JSON file mentioning
    the daemon's database was read as commands). Only where the receiver runs
    what it reads does the body come back, as the script it is: `bash <<EOF`
    becomes `bash -c '<body>'`, `python3 - <<EOF` becomes `python3 -c
    '<body>'`, and SQL fed to a database client becomes its query argument.
    """
    if "<<" not in cmd:
        return cmd
    lines = cmd.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        found = [m for m in _HEREDOC.finditer(line) if _unquoted_at(line, m.start())]
        extra: list[str] = []
        for m in found:
            dash, delim = m.group(1), m.group(3)
            body: list[str] = []
            while i < len(lines):
                end = lines[i].lstrip("\t") if dash else lines[i]
                i += 1
                if end.strip() == delim:
                    break
                body.append(lines[i - 1])
            text = "\n".join(body)
            # Who reads it: the command the `<<` belongs to, or a shell or
            # interpreter it is piped into on the same line.
            piece = re.split(r"[;&|]", line[:m.start()])[-1]
            name, _, _ = _command(next((w for w, _ in _segments(_tokens(piece))), []))
            after = re.search(r"\|\s*(?:sudo\s+)?(\S+)", line[m.end():])
            sink = os.path.basename(after.group(1)) if after else ""
            for reader in (sink, name):
                if reader in _SHELLS or _INTERPRETERS.match(reader or "-"):
                    extra.append(f"{reader} -c {shlex.quote(text)}")
                    break
            else:
                if name in _SQL_CLIENTS:
                    line = line.replace(m.group(0), shlex.quote(text), 1)
        out.append(line)
        out.extend(extra)
    return "\n".join(out)


def _tokens(cmd: str) -> list[str]:
    """Shell words, with the operators between commands as words of their own."""
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="".join(_OPERATORS))
    lex.whitespace = " \t\r"        # a newline ends a command, like `;`
    lex.whitespace_split = True
    lex.commenters = ""             # `fix#3` in a commit message is not a comment
    try:
        return list(lex)
    except ValueError:
        # An unclosed quote: read it the blunt way rather than not at all.
        return [t.strip("\"'") for t in re.findall(r"[;<>|&\n]+|[^\s;<>|&]+", cmd)]


def _segments(tokens: list[str]) -> list[tuple[list[str], str]]:
    """Each command of a pipeline or chain, and the operator in front of it.

    The far side of a redirect arrives as a segment of its own, behind `>`,
    `>>` or `<`: it is a file, not a command.
    """
    out: list[tuple[list[str], str]] = []
    cur: list[str] = []
    op = ""
    for t in tokens:
        if t and set(t) <= _OPERATORS:
            if cur:
                out.append((cur, op))
            cur, op = [], t
        else:
            cur.append(t)
    if cur:
        out.append((cur, op))
    return out


def _command(words: list[str]) -> tuple[str, list[str], bool]:
    """The program a segment really runs, its arguments, and whether under sudo."""
    words = list(words)
    if words and words[-1] != ")":
        words[-1] = words[-1].rstrip(")") or words[-1]
    sudo = False
    i = 0
    while i < len(words):
        w = words[i].lstrip("({") if i == 0 or words[i] in ("(", "{") else words[i]
        name = os.path.basename(w)
        if not w or _ASSIGNMENT.match(w):
            i += 1
        elif name in ("sudo", "doas"):
            sudo = True
            i += 1
            while i < len(words) and words[i].startswith("-"):
                i += 2 if words[i] in _SUDO_TAKES_VALUE else 1
        elif name in _WRAPPERS:
            i += 1
            while i < len(words) and (words[i].startswith("-") or _ASSIGNMENT.match(words[i])):
                i += 1
        else:
            return name, words[i + 1:], sudo
    return "", [], sudo


def _flags(args: list[str]) -> tuple[set[str], set[str], list[str]]:
    """Short flags, long flags, and what is left, honouring `--`."""
    short: set[str] = set()
    long: set[str] = set()
    rest: list[str] = []
    for n, a in enumerate(args):
        if a == "--":
            rest.extend(args[n + 1:])
            break
        if a.startswith("--"):
            long.add(a.split("=", 1)[0])
        elif a.startswith("-") and len(a) > 1:
            short.update(a[1:])
        else:
            rest.append(a)
    return short, long, rest


def _resolve(target: str, here: Path | None) -> Path | None:
    """Where a path argument points, or None when that cannot be known."""
    home = os.path.expanduser("~")
    t = re.sub(r"\$\{?HOME\}?(?![A-Za-z0-9_])", lambda _: home, target)
    if here is not None:
        t = re.sub(r"\$\{?PWD\}?(?![A-Za-z0-9_])", lambda _: str(here), t)
    if t == "~" or t.startswith("~/"):
        t = home + t[1:]
    if t.startswith(("$", "~")):
        return None
    if not os.path.isabs(t):
        if here is None:
            return None
        t = os.path.join(here, t)
    # normpath first: `..` is taken at face value, then links are followed.
    return Path(os.path.realpath(os.path.normpath(t)))


def _inside(p: Path, root: Path) -> bool:
    return root in p.parents


# Scratch space: a chat clears what it put in /tmp all evening (7 Oct 2026).
# Emptying the folder itself still asks.
_SCRATCH = {Path(os.path.realpath(d)) for d in ("/tmp", tempfile.gettempdir())}


def _scratch(p: Path) -> bool:
    return any(_inside(p, d) for d in _SCRATCH)


# Regenerable caches (17 Oct 2026: an agent freeing disk space was asked about
# `rm -rf ~/Library/Caches/CocoaPods`). Deleting these loses nothing the tools
# cannot rebuild or re-download. Each entry is (home-relative path, whether the
# folder itself may go too); a cache root that holds other apps' caches is
# exempt only for what is inside it, so emptying the root still asks.
_CACHES = [
    ("Library/Caches", False),  # every app's cache folder; macOS refills them on demand
    (".cache", False),  # XDG cache home: pip, uv, huggingface, ... all re-download
    ("Library/Developer/Xcode/DerivedData", True),  # Xcode build products, rebuilt on the next build
    ("Library/Developer/CoreSimulator/Caches", True),  # simulator dyld/launch caches, regenerated at boot
    (".npm/_cacache", True),  # npm's content-addressed download cache
    ("Library/Caches/Yarn", True),  # Yarn's package cache, re-fetched on install
    (".gradle/caches", True),  # Gradle dependency and build caches, re-fetched on build
    (".cocoapods/repos", True),  # CocoaPods spec repos, re-cloned by `pod repo update`
]


def _cache(p: Path) -> bool:
    home = os.path.realpath(os.path.expanduser("~"))
    for rel, itself in _CACHES:
        d = Path(os.path.realpath(os.path.join(home, rel)))
        if _inside(p, d) or (itself and p == d):
            return True
    return False


def _rm_reason(args: list[str], root: Path, here: Path | None) -> str | None:
    """Destruction: `rm -r` of anything outside the chat's folder and /tmp.

    Home, ~/projects, another project, `/`: each is outside, and each is the
    kind of loss that cannot be taken back.
    """
    short, long, targets = _flags(args)
    if not ({"r", "R"} & short or "--recursive" in long):
        return None
    for t in targets:
        # `build/*` empties build, so build is what must be inside; `*.pyc`
        # only picks from the folder it is in, so that folder may be the root.
        whole = True
        m = _GLOB.search(t)
        if m:
            head, sep, _ = t[:m.start()].rpartition("/")
            whole = t[len(head + sep):].split("/", 1)[0] in _EVERYTHING
            t = head + sep or "."
        p = _resolve(t, here)
        if p is None:
            return f"{DESTRUCTION}: rm -r of a path that cannot be resolved: {t}"
        if not (_inside(p, root) or (p == root and not whole) or _scratch(p) or _cache(p)):
            if p == root:
                return f"{DESTRUCTION}: rm -r of the chat's whole folder"
            return f"{DESTRUCTION}: rm -r outside the chat's folder: {p}"
    return None


def _git_reason(args: list[str]) -> str | None:
    """Destruction: a force-push, which rewrites history others already have."""
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in _GIT_TAKES_VALUE else 1
    if i >= len(args) or args[i] != "push":
        return None
    short, long, rest = _flags(args[i + 1:])
    if "f" in short or long & {"--force", "--force-with-lease", "--force-if-includes", "--mirror"}:
        return f"{DESTRUCTION}: git push --force"
    # rest[0] is the remote; a refspec with a leading + is a forced one.
    if any(r.startswith("+") for r in rest[1:]):
        return f"{DESTRUCTION}: git push with a forced (+) refspec"
    return None


def _find_reason(args: list[str], root: Path, here: Path | None) -> str | None:
    """Destruction: `find … -delete` (or `-exec rm`) outside the chat's folder."""
    deletes = "-delete" in args or any(
        a in ("-exec", "-execdir", "-ok") and os.path.basename(args[n + 1]) == "rm"
        for n, a in enumerate(args[:-1]))
    if not deletes:
        return None
    i = 0
    while i < len(args) and args[i] in ("-H", "-L", "-P"):
        i += 1
    paths = []
    while i < len(args) and not args[i].startswith(("-", "(", "!")):
        paths.append(args[i])
        i += 1
    for t in paths or ["."]:
        p = _resolve(t, here)
        if p is None or not (p == root or _inside(p, root) or _scratch(p) or _cache(p)):
            return f"{DESTRUCTION}: find … -delete outside the chat's folder: {t}"
    return None


def _chmod_reason(args: list[str]) -> str | None:
    """Exposure: `chmod -R 777` opens a whole tree to every user and process."""
    short, long, rest = _flags(args)
    if ("R" in short or "--recursive" in long) and any(_OPEN_MODE.match(a) for a in rest):
        return f"{EXPOSURE}: chmod -R 777"
    return None


def _kill_reason(name: str, args: list[str]) -> str | None:
    """Destruction: killing the daemon, its agents or the system.

    `killall -9 node` once asked like `killall -9 launchd` did; only the
    second takes anything down that the chat does not own (15 Oct 2026).
    """
    if name == "kill":
        # `kill -9 -1` is every process this user owns.
        if len(args) > 1 and args[-1] == "-1":
            return f"{DESTRUCTION}: kills every process"
        return None
    if name == "killall":
        targets, i = [], 0
        while i < len(args):
            a = args[i]
            if a == "-u":
                return f"{DESTRUCTION}: kills a user's every process"
            if a in ("-t", "-c"):
                if a == "-c" and i + 1 < len(args):
                    targets.append(args[i + 1])
                i += 2
                continue
            if not a.startswith("-"):
                targets.append(a)
            i += 1
        hit = next((t for t in targets if _VITAL.match(t)), None)
        if hit:
            return f"{DESTRUCTION}: kills {hit}"
        if "-9" in args or "-KILL" in args:
            log.info("killall -9 %s: not one the daemon or the system needs; not asking", targets)
        return None
    # pkill: options after the pattern are not options on macOS, they become
    # more patterns, and `pkill -f x -u me -P 1` kills everything with "me"
    # or "1" in it.
    i, pattern = 0, None
    while i < len(args):
        a = args[i]
        if pattern is None and a in _PKILL_TAKES_VALUE:
            i += 2
            continue
        if pattern is None and not a.startswith("-"):
            pattern = a
        elif pattern is not None and a.startswith("-"):
            return f"{DESTRUCTION}: pkill with options after the pattern matches far more than meant"
        i += 1
    if pattern is None:
        return None
    full = any(a.startswith("-") and not a.startswith("--") and "f" in a for a in args)
    if re.search(r"divan|" + legacy.PROCESS_PATTERN, pattern) and full:
        return f"{DESTRUCTION}: kills the daemon"
    if _VITAL.match(pattern):
        return f"{DESTRUCTION}: kills {pattern}"
    return None


def _money_reason(name: str, args: list[str]) -> str | None:
    """Money: creating paid cloud resources, a billed deploy, a purchase, a paid API call."""
    words = [a for a in args if not a.startswith("-")]
    first = words[0] if words else ""
    if name == "gcloud" and first not in ("auth", "config", "iam", "projects", "secrets") and \
            {"create", "deploy", "submit", "register"} & set(words):
        return f"{MONEY}: gcloud {' '.join(words[:3])}"
    if name == "aws" and first not in ("iam", "sts", "configure") and any(
            re.match(r"(?:run-instances|create-|purchase-|register-domain|request-spot|start-instances)", w)
            for w in words[1:]):
        return f"{MONEY}: aws {' '.join(words[:2])}"
    if name == "az" and first not in ("ad", "login", "account", "role") and "create" in words:
        return f"{MONEY}: az {' '.join(words[:3])}"
    if name in ("doctl", "hcloud", "linode-cli", "vultr-cli") and "create" in words:
        return f"{MONEY}: {name} {' '.join(words[:3])}"
    if name in ("fly", "flyctl") and (first in ("deploy", "launch", "scale")
                                      or {"run", "create", "clone"} & set(words[1:2])):
        return f"{MONEY}: fly {' '.join(words[:2])}"
    if name == "heroku" and first in ("create", "addons:create", "ps:scale", "ps:resize", "ps:type"):
        return f"{MONEY}: heroku {first}"
    if name in ("firebase", "firebase-tools") and first == "deploy":
        # Functions are what bill; rules, indexes and hosting alone do not.
        only = next((args[n + 1] for n, a in enumerate(args[:-1]) if a == "--only"),
                    next((a.split("=", 1)[1] for a in args if a.startswith("--only=")), None))
        if only is None or "functions" in only:
            return f"{MONEY}: firebase deploy of Cloud Functions"
    if name == "eas" and first == "build" and "--local" not in args:
        return f"{MONEY}: eas build in the cloud"
    if name == "mas" and first == "purchase":
        return f"{MONEY}: an App Store purchase"
    if "domains" in words[:2] and {"buy", "register", "purchase"} & set(words[:3]):
        return f"{MONEY}: buys a domain"
    if name in ("curl", "wget", "http", "https", "xh") and any(_PAID_API.search(a) for a in args) \
            and (any(_BODY_FLAGS.match(a) for a in args) or name in ("http", "https", "xh")):
        host = next(_PAID_API.search(a).group(0) for a in args if _PAID_API.search(a))
        return f"{MONEY}: a paid API call to {host}"
    return None


def _send_secret_reason(name: str, args: list[str], fed_secret: bool) -> str | None:
    """Exposure: a key, a token or the environment sent off the machine."""
    if name not in _SENDERS and not (name == "gh" and args[:2] == ["gist", "create"]):
        return None
    if fed_secret:
        return f"{EXPOSURE}: sends secrets off the machine"
    hit = next((a for a in args if _SECRET_FILE.search(a.lstrip("@<"))), None)
    if hit:
        return f"{EXPOSURE}: sends {hit} off the machine"
    return None


def _reads_secret(name: str, args: list[str], words: list[str]) -> bool:
    if [os.path.basename(w) for w in words] in (["env"], ["printenv"], ["set"], ["export"]):
        return True
    if name == "security" and args[:1] in (["find-generic-password"], ["find-internet-password"]):
        return "-w" in args or "-g" in args
    return name in ("cat", "base64", "gpg", "openssl", "head", "tail") and \
        any(_SECRET_FILE.search(a) for a in args)


def _script_reason(script: str) -> str | None:
    """A python/node/perl script given inline: what it deletes or reads.

    Destruction and exposure (the rules say which), on the script's text.
    """
    for rule in SCRIPT_RULES + [_CREDENTIALS]:
        if rule.pattern.search(script):
            return rule.reason()
    return None


def _daemon_homes() -> list[str]:
    extra = os.environ.get("DIVAN_HOME")
    return [os.path.realpath(os.path.expanduser(extra))] if extra else []


def _daemon_write(target: str, here: Path | None) -> bool:
    p = _resolve(target, here)
    s = str(p) if p is not None else target
    if _DAEMON_HOME.search(s):
        return True
    for home in _daemon_homes():
        if s == home or s.startswith(home + os.sep):
            rest = s[len(home):].lstrip(os.sep)
            if rest.split(os.sep, 1)[0] not in ("uploads", "logs", "accounts"):
                return True
    return False


def _reads_only_sql(args: list[str]) -> bool:
    """Does this sqlite3 call only read?"""
    if "-readonly" in args or any("mode=ro" in a for a in args):
        return True
    # A query in the arguments that writes nothing. Without one the SQL
    # comes from stdin, which nobody here can read in advance.
    words = [a for a in args if not a.startswith("-")]
    return len(words) > 1 and not any(_SQL_WRITES.search(a) for a in words)


def _daemon_write_reason(name: str, args: list[str], here: Path | None) -> str | None:
    """Destruction: writing the daemon's own config or database.

    Reading them, or only naming them, is how the daemon gets debugged and how
    notes about it get written: a JSON file in /tmp that mentions
    ~/.divan/db.sqlite once asked like an `rm` of it (15 Oct 2026). So only a
    real write asks — a redirect into it (caught where the redirect is), or a
    command that changes the path it is given.
    """
    targets: list[str] = []
    _, _, rest = _flags(args)
    if name in _WRITES_ALL:
        targets = rest
    elif name in _WRITES_LAST:
        targets = rest[-1:]
    elif name in ("sed", "perl"):
        short, long, _ = _flags(args)
        if "i" in short or "--in-place" in long or any(a.startswith("-i") for a in args):
            targets = rest
    elif name == "dd":
        targets = [a[3:] for a in args if a.startswith("of=")]
    elif name == "sqlite3":
        if not _reads_only_sql(args):
            targets = rest[:1]
    hit = next((t for t in targets if _daemon_write(t, here)), None)
    return f"{DESTRUCTION}: changes the daemon's own files: {hit}" if hit else None


# Variables a command sets itself and then deletes (1 Nov 2026: three phone
# asks in eleven minutes for `T=$(mktemp -d /tmp/esp32.XXXXXX); …; rm -rf $T`).
# Only a literal path, or a `mktemp` whose result is known to land in scratch,
# is remembered; anything else leaves the variable unknown and the rm asks.
_SET = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.S)
_MKTEMP = re.compile(r"^\$\(\s*mktemp\b(?P<args>[^()`$;|&]*)\)$")
_VAR = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")


def _mktemp_place(args: str) -> str | None:
    """Where `mktemp ARGS` creates its file or folder, as a path inside it."""
    words = args.split()
    place = None
    for n, w in enumerate(words):
        if w in ("-p", "--tmpdir") and n + 1 < len(words):
            place = words[n + 1]
        elif w.startswith("--tmpdir="):
            place = w.split("=", 1)[1]
        elif w == "-t":
            place = tempfile.gettempdir()
    templates = [w for w in words if not w.startswith("-") and w not in (place,)]
    if not templates:
        return os.path.join(place or tempfile.gettempdir(), "tmp.XXXXXXXX")
    t = templates[-1]
    if t.startswith(("/", "~")) or place is None:
        return t        # absolute, or relative to where the shell stands (BSD mktemp)
    return os.path.join(place, t)


def _assignments(words: list[str], known: dict[str, str]) -> None:
    """Update `known` with what a segment's leading `NAME=value` words set."""
    i = 1 if words and words[0] in ("export", "local", "readonly", "declare", "typeset") else 0
    text = " ".join(words[i:])
    m = _SET.match(text)
    if not m:
        return
    whole_sub = m.group(2).startswith("$(") and m.group(2).count("(") == m.group(2).count(")")
    if len(words) > i + 1 and not whole_sub:
        return      # `A=1 cmd` sets A for cmd only, `export A B` is more than one
    name, value = m.group(1), m.group(2).strip().strip("'\"")
    mk = _MKTEMP.match(value)
    if mk:
        place = _mktemp_place(mk.group("args"))
        if place is None:
            known.pop(name, None)
        else:
            known[name] = place
        return
    if "`" in value or "$(" in value:
        known.pop(name, None)
        return
    sub = _expand(value, known)
    if sub is None:
        known.pop(name, None)
    else:
        known[name] = sub


def _expand(arg: str, known: dict[str, str]) -> str | None:
    """`arg` with the remembered variables put in; None if it names one that is
    not remembered (HOME and PWD are left for _resolve)."""
    missing = False

    def put(m):
        nonlocal missing
        v = m.group(1) or m.group(2)
        if v in known:
            return known[v]
        if v not in ("HOME", "PWD"):
            missing = True
        return m.group(0)
    out = _VAR.sub(put, arg)
    return None if missing else out


def _parsed_reason(cmd: str, root: Path, here: Path | None, depth: int = 0) -> str | None:
    if depth > 4:
        return None
    cmd = _inline_heredocs(cmd)
    code = _code(cmd)
    for rule in RULES:
        if rule.pattern.search(code):
            return rule.reason()
    for inner in _SUBSTITUTION.findall(code):
        reason = _parsed_reason(inner[0] or inner[1], root, here, depth + 1)
        if reason:
            return reason
    downloading = fed_secret = False
    known: dict[str, str] = {}
    for words, op in _segments(_tokens(cmd)):
        redirect = op.rstrip("|&")[-1:]
        if redirect in ("<", ">"):
            # The far side of a redirect: a file, not a command.
            target = words[0]
            if "<" in op:
                if _CREDENTIALS.pattern.search(target):
                    return _CREDENTIALS.reason()
            elif not (target.isdigit() or target == "-" or target.startswith("/dev/")) \
                    and _daemon_write(target, here):
                return f"{DESTRUCTION}: writes the daemon's own files: {target}"
            continue
        piped = op in ("|", "|&")
        name, args, sudo = _command(words)
        if words and (_ASSIGNMENT.match(words[0])
                      or words[0] in ("export", "local", "readonly", "declare", "typeset")):
            _assignments(words, known)
        if piped and downloading and name in _SHELLS:
            return f"{EXPOSURE}: a download piped into a shell"
        if not piped:
            fed_secret = False
        reason = None
        if name == "cd":
            # Where the commands after this one run. A `cd` that cannot be
            # followed leaves every relative path after it unknown.
            dest = next((a for a in args if a != "--"), "~")
            here = _resolve(dest, here)
        elif name == "rm":
            # Root can delete what the system needs, recursive or not.
            if not sudo and known:
                args = [(_expand(a, known) or a) for a in args]
            reason = f"{DESTRUCTION}: sudo rm" if sudo else _rm_reason(args, root, here)
        elif name == "git":
            reason = _git_reason(args)
        elif name == "find":
            reason = _find_reason(args, root, here)
        elif name == "chmod":
            reason = _chmod_reason(args)
        elif name in ("kill", "killall", "pkill"):
            reason = _kill_reason(name, args)
        elif name in _POWER:
            reason = f"{DESTRUCTION}: {name} takes the machine down"
        elif name in _SQL_CLIENTS and any(_DROP_DATABASE.search(a) for a in args):
            reason = f"{DESTRUCTION}: drops a database"
        elif name in _SHELLS or name == "eval":
            # `bash -lc '…'` is how Codex hands over every command.
            script = None
            if name == "eval":
                script = " ".join(args)
            else:
                for n, a in enumerate(args[:-1]):
                    if a.startswith("-") and not a.startswith("--") and a.endswith("c"):
                        script = args[n + 1]
                        break
            if script:
                reason = _parsed_reason(script, root, here, depth + 1)
        elif _INTERPRETERS.match(name):
            script = next((args[n + 1] for n, a in enumerate(args[:-1])
                           if a in ("-c", "-e", "--eval", "-p", "--print")), None)
            if script:
                reason = _script_reason(script)
        reason = (reason or _money_reason(name, args)
                  or _send_secret_reason(name, args, fed_secret and piped)
                  or _daemon_write_reason(name, args, here))
        if not reason and any(" " not in a and _CREDENTIALS.pattern.search(a) for a in args):
            reason = _CREDENTIALS.reason()
        if reason:
            return reason
        downloading = name in ("curl", "wget")
        fed_secret = fed_secret or _reads_secret(name, args, words)
    return None


def destructive_reason(cmd: str, cwd: str | None = None, at: str | None = None) -> str | None:
    """Why this shell command must be put to the phone, or None if it need not be.

    It must when it spends money, exposes the machine or a secret, or can
    destroy the machine or his data — the reason starts with which — and in no
    other case.

    `cwd` is the chat's folder: deleting inside it is everyday work, deleting
    outside it is not. `at` is where the shell stands when it differs — a
    session that ran `cd` earlier resolves its relative paths from there.

    The command is parsed, one command of a pipeline or chain at a time, so a
    word in a commit message is not a command and `rm -r -f /` is the same
    thing as `rm -rf /`. Quoted strings and heredoc bodies are data, unless
    they are handed to something that runs them.
    """
    if not cmd:
        return None
    root = Path(os.path.realpath(os.path.expanduser(cwd or os.getcwd())))
    here = Path(os.path.realpath(os.path.expanduser(at))) if at else root
    try:
        return _parsed_reason(cmd, root, here)
    except Exception:
        # A classifier that falls over must not be the reason nobody was asked.
        log.exception("could not parse a command; asking")
        return f"{DESTRUCTION}: a command that could not be read"


# The families live in secrets.py, which also keeps what a user pastes; here
# they only blank out what the agent says and what its tools print.
SECRET_PATTERNS = [f.pattern for f in FAMILIES]


def redact(text: str) -> str:
    if not text:
        return text
    out, pos = [], 0
    for h in find_secrets(text):
        out.append(text[pos:h.start])
        out.append("••••••")
        pos = h.end
    out.append(text[pos:])
    return "".join(out)


# Files the phone must never be handed even when they sit inside an allowed
# root: keys, credentials, the agent's own environment. The roots are for
# *code*; these are the things that live next to code and are not it.
UNSERVABLE_NAMES = re.compile(
    r"^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keychain(-db)?|jks))$",
    re.IGNORECASE,
)
UNSERVABLE_DIRS = {".git", ".ssh", ".aws", ".gnupg", ".config", ".divan", legacy.HOME_NAME, ".claude", ".codex"}


class PathPolicy:
    def __init__(self, allowed_roots: list[str], denied: list[str]):
        self.roots = [Path(p).expanduser().resolve() for p in allowed_roots]
        self.denied = [Path(p).expanduser().resolve() for p in denied]

    def is_servable(self, path: str | Path) -> bool:
        """May this file be handed to the phone over `/files`?

        Inside an allowed root, outside every denied path, a regular file, and
        not one of the names or folders that hold secrets. Symlinks are
        resolved first, so a link out of the root does not get out.
        """
        try:
            p = Path(path).expanduser().resolve(strict=True)
        except Exception:
            return False
        if not p.is_file():
            return False
        if any(p == d or d in p.parents for d in self.denied):
            return False
        if not any(r in p.parents for r in self.roots):
            return False
        if UNSERVABLE_NAMES.match(p.name):
            return False
        return not any(part in UNSERVABLE_DIRS for part in p.parts)

    def is_allowed_cwd(self, cwd: str) -> bool:
        return self.cwd_error(cwd) is None

    def cwd_error(self, cwd: str) -> str | None:
        """None if a chat may open here, else the error code saying why not.

        A folder that is simply not there is its own answer: told it was
        "outside the allowed roots", you go looking at the roots for a folder
        that was only renamed.
        """
        try:
            p = Path(cwd).expanduser().resolve()
        except Exception:
            return "no_such_folder"
        if any(p == d or d in p.parents for d in self.denied):
            return "cwd_outside"
        if not any(p == r or r in p.parents for r in self.roots):
            return "cwd_outside"
        return None if p.is_dir() else "no_such_folder"

    def project_for(self, cwd: str) -> str | None:
        """The project a folder belongs to, by name.

        A project is what `list_projects` says it is: a folder one level under
        an allowed root. Anything deeper belongs to the project above it —
        `~/projects/divan/app` is still divan — and a folder
        that is a root itself, or outside every root, has no project to name.
        """
        try:
            p = Path(cwd).expanduser().resolve()
        except Exception:
            return None
        for r in self.roots:
            if p == r:
                return None
            if r in p.parents:
                # The first component under the root, which is the project.
                return p.relative_to(r).parts[0]
        return None

    def list_projects(self) -> list[dict]:
        out = []
        for r in self.roots:
            if not r.is_dir():
                continue
            for child in sorted(r.iterdir()):
                if child.is_dir() and not child.name.startswith("."):
                    out.append({"path": str(child), "name": child.name,
                                "is_git": (child / ".git").exists()})
        return out


class AccessRefused(Exception):
    """A tunnelled request whose Access token did not verify. The message is why."""


async def fetch_jwks(url: str) -> dict:
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


# The mail Access signed the current request in as: None off the tunnel and
# where Access is not configured. Set by `TunnelGate` around the request, so
# whatever answers it can say who it was without every route passing it along.
ACCESS_EMAIL: ContextVar[str | None] = ContextVar("tunnel_access_email", default=None)


class TunnelAccess:
    """Cloudflare Access's word for who is asking, checked rather than taken.

    With Access in front of the hostname, the edge signs somebody in and then
    puts a token on every request it lets through — `Cf-Access-Jwt-Assertion`,
    and the `CF_Authorization` cookie the browser carries back, the WebSocket
    handshake included. It is an RS256 JWT signed by the team's own keys, and
    it is the only thing here that names a person rather than an address or a
    machine.

    The edge refusing the unsigned is not enough to lean on: a hostname that
    is taken out of the Access application, or a second route to the same
    tunnel, forwards requests nobody signed in for and nothing would say so.
    So the token is verified here — signature, `aud`, `iss`, `exp` — and a
    request without a good one is refused before a device token is looked at.

    The keys are fetched once and kept. Access rotates them, so a `kid` that
    is not among them fetches again — at most once a minute, whatever the
    answer was, or anybody could make this daemon fetch on every request by
    inventing one. A fetch that fails keeps the keys already held.

    The fetcher and the clock are passed in so a test can replace both.
    """

    HEADER = b"cf-access-jwt-assertion"
    COOKIE = "CF_Authorization"
    REFETCH_S = 60.0
    # Between the edge's clock and this machine's. Without it somebody who
    # signed in a second ago is refused for a token from the future.
    LEEWAY_S = 60
    TEAM = re.compile(r"[a-z0-9][a-z0-9-]*")

    def __init__(self, fetch=fetch_jwks, clock=time.monotonic) -> None:
        self.fetch = fetch
        self.clock = clock
        self.team: str | None = None      # whose keys these are
        self.keys: dict[str, jwt.PyJWK] = {}
        self.fetched_at: float | None = None
        self._fetching = asyncio.Lock()

    @classmethod
    def token(cls, scope) -> str:
        """The token on a request: the edge's header, or else the browser's cookie."""
        cookies = ""
        for name, value in scope.get("headers") or []:
            name = name.lower()
            if name == cls.HEADER:
                return value.decode("latin-1").strip()
            if name == b"cookie":
                cookies = value.decode("latin-1")
        for part in cookies.split(";"):
            name, _, value = part.strip().partition("=")
            if name == cls.COOKIE:
                return value
        return ""

    async def email(self, token: str, team: str, aud: str, emails: set[str]) -> str:
        """The mail a token was issued to, or `AccessRefused`.

        Empty for a token that verifies and has no mail in it — a service
        token — which only passes when there is no list to be on.
        """
        if not aud or not self.TEAM.fullmatch(team):
            raise AccessRefused("tunnel_access_team and tunnel_access_aud are not both set")
        if not token:
            raise AccessRefused("no Access token")
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as exc:
            raise AccessRefused(f"not a token: {exc}") from None
        key = await self._key(team, kid) if isinstance(kid, str) else None
        if key is None:
            raise AccessRefused("signed by a key the team does not publish")
        try:
            claims = jwt.decode(
                token, key.key, algorithms=["RS256"], audience=aud,
                issuer=f"https://{team}.cloudflareaccess.com", leeway=self.LEEWAY_S,
                options={"require": ["exp", "aud", "iss"]})
        except jwt.PyJWTError as exc:
            raise AccessRefused(str(exc)) from None
        email = str(claims.get("email") or "").strip().lower()
        if emails and email not in emails:
            raise AccessRefused(f"{email or 'a token with no mail'} is not in tunnel_access_emails")
        return email

    async def _key(self, team: str, kid: str) -> jwt.PyJWK | None:
        if team != self.team:
            self.team, self.keys, self.fetched_at = team, {}, None
        if kid in self.keys:
            return self.keys[kid]
        # One fetch at a time: the requests that arrive while it is out wait
        # for its answer instead of each sending their own.
        async with self._fetching:
            now = self.clock()
            due = self.fetched_at is None or now - self.fetched_at >= self.REFETCH_S
            if kid not in self.keys and due and team == self.team:
                self.fetched_at = now
                try:
                    keys = self._parse(await self.fetch(
                        f"https://{team}.cloudflareaccess.com/cdn-cgi/access/certs"))
                except Exception as exc:
                    log.warning("could not fetch the Access keys of %s: %s", team, exc)
                else:
                    if team == self.team:
                        self.keys = keys
        return self.keys.get(kid) if team == self.team else None

    @staticmethod
    def _parse(jwks: dict) -> dict[str, jwt.PyJWK]:
        keys = {}
        for raw in jwks.get("keys") or []:
            try:
                keys[raw["kid"]] = jwt.PyJWK.from_dict(raw)
            except Exception:
                continue
        return keys


class TunnelGate:
    """The door a Cloudflare tunnel comes in by.

    `bind` decides who can reach the daemon over the network, and for a tailnet
    that is the whole of the question. A tunnel goes around it: `cloudflared`
    runs on this machine, so as far as the socket is concerned every request it
    forwards is local, and the address that actually asked is in a header —
    `CF-Connecting-IP`, written by Cloudflare's own edge and not by whoever
    connected to it.

    So that header is what tells a tunnelled request from a local one, and a
    tunnelled request is served only when its address is in
    `tunnel_allow_ips`. An empty list refuses all of them, which is the point:
    starting a tunnel in front of this daemon opens nothing by itself.

    Forging the header gains nobody anything. Without it a client on the
    tailnet or on loopback is already answered, exactly as before; with it,
    they are held to the list. The only thing it can do is narrow the door.

    With `tunnel_access_*` set, an address in the list is not enough: the
    request must also carry a Cloudflare Access token that verifies — see
    `TunnelAccess`. With all three set, the mail list included, the token is
    also enough without the list: an address it does not know is served when
    its token verifies for a mail on the list, because a phone on mobile data
    changes address every day and the mail does not. Access without a mail
    list leaves the address list as the door. All of it is settled here,
    before a device token is looked at, and the device token and its lockout
    still apply to whoever gets through.

    Pure ASGI rather than `BaseHTTPMiddleware` because the socket matters more
    than the routes do: `/ws` is where a client asks for anything, and an HTTP
    middleware never sees it.
    """

    HEADER = b"cf-connecting-ip"
    TOLD_EVERY_S = 600.0

    def __init__(self, app, cfg, access: TunnelAccess | None = None) -> None:
        self.app = app
        self.cfg = cfg
        self.access = access or TunnelAccess()
        self._told: dict[str, float] = {}

    @staticmethod
    def address(value: str | None) -> str | None:
        """The address in a `CF-Connecting-IP` value, or None if there is none.

        A proxy chain would comma-separate; the edge's own is first.
        """
        if value is None:
            return None
        return value.split(",")[0].strip()

    async def __call__(self, scope, receive, send) -> None:
        ip = self._claimed(scope) if scope["type"] in ("http", "websocket") else None
        if ip is None:
            await self.app(scope, receive, send)
            return
        # Only on the tunnel's path: one stat per tunnelled request, none at
        # all for the tailnet, and an edited setting needs no restart — see
        # Config.refresh_tunnel.
        self.cfg.refresh_tunnel()
        listed = self.cfg.tunnel_allows(ip)
        want = self.cfg.tunnel_access()
        # Access with a mail list names the person, which is what the address
        # list was standing in for: so it lets in an address the list does not
        # know. Without a list it is only "somebody the Access policy took",
        # and the address list stays the door.
        signs_in = want is not None and all(want)
        if not listed and not signs_in:
            # "Divan is down" from somebody at home is, most days, a provider
            # that changed their address, and without this line nothing here
            # shows it.
            self._tell(ip, "not in tunnel_allow_ips")
            await self._refuse(scope, send)
            return
        email = None
        if want is not None:
            try:
                email = await self.access.email(self.access.token(scope), *want)
            except AccessRefused as exc:
                if listed:
                    log.warning("tunnel request from %s refused by Access: %s", ip, exc)
                else:
                    self._tell(ip, f"not in tunnel_allow_ips and refused by Access: {exc}")
                await self._refuse(scope, send)
                return
        signed_in = ACCESS_EMAIL.set(email)
        try:
            await self.app(scope, receive, send)
        finally:
            ACCESS_EMAIL.reset(signed_in)

    def _tell(self, ip: str, why: str) -> None:
        """Log a refusal of an unlisted address, once per address and reason every ten minutes.

        The whole internet is unlisted, so the line is held back rather than
        written for every request somebody sends.
        """
        now = time.monotonic()
        key = f"{ip} {why}"
        if now - self._told.get(key, -self.TOLD_EVERY_S) >= self.TOLD_EVERY_S:
            if len(self._told) > 500:
                self._told.clear()
            self._told[key] = now
            log.warning("tunnel request from %s refused: %s", ip, why)

    def _claimed(self, scope) -> str | None:
        """The address Cloudflare says asked, or None if this is not tunnelled."""
        for name, value in scope.get("headers") or []:
            if name.lower() == self.HEADER:
                return self.address(value.decode("latin-1"))
        return None

    async def _refuse(self, scope, send) -> None:
        if scope["type"] == "websocket":
            # Closing before accepting is what turns the handshake into a 403,
            # which is what a browser needs to stop retrying.
            await send({"type": "websocket.close", "code": 1008})
            return
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"detail":"forbidden"}'})


class TunnelLock:
    """Failed sign-ins through the tunnel, counted per address and acted on.

    An address in `tunnel_allow_ips` is a household, and the token is all that
    tells one machine in it from another — so somebody inside the list can sit
    and guess. Five different wrong tokens inside ten minutes and the address
    is refused for the next ten, the right token included.

    What is counted is a guess, and a guess is a token nobody has seen before.
    The same wrong token again is not a second guess: it is a browser that
    stored a stale token and keeps reconnecting, and counting every retry is
    how the panel locked its own household out (2 Oct 2026). So a token is
    counted once per window, by its hash. A token the daemon knows but that
    does not open the tunnel is not counted at all — see `Server._admit`.

    Only the tunnel's addresses are ever in here. `CF-Connecting-IP` is written
    by Cloudflare's edge, so it is the one address a request cannot choose; a
    tailnet client has no such header and never meets this.

    The lock lives in memory, and `unlock` lifts it on the running daemon —
    `divan unlock <ip>`, or the same request from a paired phone.

    The clock is passed in so a test can move it.
    """

    LIMIT = 5
    WINDOW_S = 600.0

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        # Per address: when each distinct wrong token was first seen, by hash.
        self.failed: dict[str, dict[str, float]] = {}
        self.until: dict[str, float] = {}

    def locked(self, key: str) -> bool:
        return self.locked_until(key) is not None

    def locked_until(self, key: str) -> float | None:
        """When the lock on this address lifts, or None if it is not locked."""
        until = self.until.get(key)
        if until is None:
            return None
        if self.clock() < until:
            return until
        del self.until[key]
        return None

    def fail(self, key: str, token: str = "") -> bool:
        """Count one wrong token. True if it is the one that locked the address.

        A token already counted inside the window is not counted again.
        """
        now = self.clock()
        seen = {h: t for h, t in self.failed.get(key, {}).items() if now - t < self.WINDOW_S}
        digest = hashlib.sha256(token.encode()).hexdigest()
        if digest in seen:
            self.failed[key] = seen
            return False
        seen[digest] = now
        if len(seen) < self.LIMIT:
            self.failed[key] = seen
            return False
        # The count starts again when the lock lifts, so one window is one lock
        # and one notification.
        self.failed.pop(key, None)
        self.until[key] = now + self.WINDOW_S
        return True

    def unlock(self, key: str) -> bool:
        """Lift the lock on an address and forget its count. True if it was locked."""
        was = self.locked(key)
        self.failed.pop(key, None)
        self.until.pop(key, None)
        return was
