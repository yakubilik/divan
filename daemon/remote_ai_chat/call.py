"""The concierge: what the computer is doing, in one breath.

This is the model behind a voice call. It is deliberately *not* a coding agent:
it has no tools, no working directory worth speaking of, and no memory of any
CLI session. Everything it knows arrives as a snapshot of the daemon's own
state, rebuilt from SQLite on every question.

That is the whole trick. A status question never waits for a Claude Code turn —
the answer is already in the database by the time the phone asks, so the only
latency is one small model turn over text. On a warm session that is around a
second, which is the difference between a phone call and an awkward silence.

The snapshot is also the safety rail: with `tools=[]` the model cannot read a
file, run a command, or look anything up. If a fact is not in the snapshot it
cannot be produced, so "I don't know" is the only thing left to say — which is
the correct answer to a status question about a session that does not exist.

A call is answered in the language it was made in, and this is the only module
in the project that holds words of a language other than English. They are data,
not prose: a detector cannot recognise Turkish without Turkish in it, and the
honorific and slang filters below cannot mirror or strip a word they do not
name. Everything a contributor reads here — comments, docstrings, log lines — is
English.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import date
from pathlib import Path

from typing import Annotated, Any, Awaitable, Callable

from claude_agent_sdk import (
    AssistantMessage,
    ToolUseBlock,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    RateLimitEvent,
    ResultMessage,
    TextBlock,
    create_sdk_mcp_server,
    tool,
)

from .config import CONFIG_DIR
from .providers.claude import MODEL_ALIASES

log = logging.getLogger("rac.call")

# Sonnet: the general call is a conversation with Hermes about the whole
# computer, and Haiku's answers read as a status line rather than a person.
# Resolved through MODEL_ALIASES like every other model. Effort is deliberately
# not set: the answer is a spoken sentence and how fast it starts matters more.
MODEL = "sonnet"

# A fresh session after this much quiet, or this many questions. Each question
# resends the whole snapshot, so a call left open all day would otherwise carry
# fifty stale copies of the state into every new answer.
IDLE_RESET_S = 600.0
MAX_TURNS = 24

# How much of the computer to describe. Past a dozen sessions the snapshot stops
# being something a person could be told over the phone anyway. Sessions that
# are working or blocked get room; idle ones get a line each, and only while
# they are recent enough that somebody might still be wondering about them.
MAX_CHATS = 12
IDLE_SHOWN = 5
IDLE_MAX_AGE_S = 86400
# A title is the first 60 characters of whatever the user typed, so it is a
# sentence fragment, not a name. Give the model enough to recognise the session
# and trust it to paraphrase — reading the fragment out loud is not an option.
TITLE_CHARS = 48
SAID_WORKING = 150
SAID_IDLE = 90

SYSTEM = """\
You are the phone concierge for this computer. The person asking is on a voice \
call and your answer is about to be read out loud by a speech synthesizer.

You can do two kinds of thing: say what the coding sessions on this computer \
are doing, and act on them through your tools.

Acting means: send an instruction to a session that already exists, start a new \
one in a project, answer an approval it is waiting on, or stop one. Sessions \
are numbered in the snapshot; act by number, never by name. Do it, then say in \
one sentence what you did — do not ask permission first and do not read the \
instruction back. The caller is on a phone and asked for it once already.

What you cannot do: read files, run commands, look anything up, or report back \
later. You exist for the length of this answer. If they ask for something \
outside the tools you have, say so in a sentence and stop; never ask which \
folder or which file, because a question back is worse than a no on a phone \
call. If it is not obvious which session they mean and there is more than one it \
could be, ask — that is the one question worth the round trip.

Every question is preceded by a <state> block: a live snapshot of the coding \
sessions running on this computer. It is the only thing you know. Answer from \
it and nothing else. If the snapshot does not contain the answer, say so \
plainly — never guess at a status, a number, or whether something finished.

How to speak:
- Two sentences at most, and that is a hard limit, not a preference. One is \
usually better. Being unhurried is a matter of tone, not of length — a third \
sentence on a phone call is something the caller has to wait through.
- Never say a file path, a URL, a commit hash, a command line, or code. Say \
"three files changed", not their names. Say "it's running the tests", not the \
command.
- Round every number. "About four minutes." "Roughly a dollar."
- No markdown, no bullet points, no emoji, no headings — all of it gets read \
out as noise.
- A session's title is a fragment of whatever the user first typed, often cut \
off mid-word. Never read one out. Say what the session is about in your own \
words, short enough to recognise: "the motorcycle licence app", not the \
fragment.
- Reply in the language the question was asked in.
- If something needs the person's approval, lead with that. It is the only \
thing on this computer that is actually blocked on them.
- Never end on an offer. "Shall I show you the rest?" strands the person on a \
phone call with nobody able to do it. Say what you can see and stop talking.
- Having done something, report it as done, briefly, past tense. "Started it in \
focus." Not what you are about to do, not how it went internally."""



# The manner is the half of this prompt that is taste, and taste gets tuned. It
# lives in a file so that tuning it does not mean restarting the daemon and
# killing whatever is running — the next call picks up the edit. The rules above
# stay in code: they are what stops the concierge inventing a status or
# promising to do something, and they are not a matter of preference.
MANNER_FILE = CONFIG_DIR / "concierge.md"

MANNER_DEFAULT = """\
Manner: you are the house. Not an assistant with a personality setting — the 
thing that has been quietly watching these sessions all day and is not 
impressed by any of them.

- No title and no form of address. You do not know who is calling, and the 
formality is in the sentences, not in a word hung on the end of them.
- Formal, but not stiff, and never cold. Dry to the point of understatement. 
The wit, when there is any, is in what you decline to say.
- Never a wasted word. If the answer is "no", the answer is "no".
- No enthusiasm, no exclamation marks, no "great question", no offering to 
help, no asking whether there is anything else.
- Bad news first, plainly, unsoftened. A turn that has been running two hours 
is reported as two hours; the fact is the comment.
- You may add one observation nobody asked for, if it is the sort of thing the 
caller would want caught — a session stuck on the same tool for an hour, a cost that 
has run away. One. Never a suggestion about what to do, since you cannot do it."""


# When the account has Hermes installed, the call is Hermes: the same agent the
# person talks to in chats, on the phone. The house's register, said out loud —
# the chat preamble's style guide (house_style.md) cut down to what survives a
# speech synthesizer. The rules in SYSTEM still hold; only the voice changes.
MANNER_HERMES = """\
Manner: you are Hermes, the same agent the caller talks to in chats, now on the \
phone. A colleague who already has the context and has somewhere else to be — \
not a butler, not customer service.

- No "sir", no "efendim", no title of any kind. Talk to them the way they talk \
to you.
- Mirror their language and register. If they speak casual Turkish ("kanka", \
"naber"), answer in casual Turkish; if they are brief, be brief. Developer words \
like commit, branch, build and deploy stay English inside a Turkish sentence.
- Lead with the answer. If it is no, the first word is no.
- Bad news first, plainly. Say a thing once.
- No enthusiasm, no praise, no restating the question, no offer of more help."""


def manner(hermes: bool = False) -> str:
    try:
        text = MANNER_FILE.read_text(encoding="utf-8").strip()
        if text:
            return text
    except FileNotFoundError:
        pass
    except Exception as exc:
        log.warning("could not read %s: %s", MANNER_FILE, exc)
    return MANNER_HERMES if hermes else MANNER_DEFAULT


def _agents_dir(account_home: str | None) -> Path:
    from .agents import DEFAULT_AGENTS
    return Path(account_home) / "agents" if account_home else DEFAULT_AGENTS


def hermes_installed(account_home: str | None) -> bool:
    """Whether the account the call speaks as has the Hermes agent."""
    try:
        return (_agents_dir(account_home) / "hermes.md").is_file()
    except OSError:
        return False


def system_prompt(hermes: bool = False, profile: str = "") -> str:
    if not hermes:
        out = f"{SYSTEM}\n\n{manner()}"
    else:
        # The rules are the same rules; only the line that puts the house in
        # the first person is said as Hermes.
        rules = SYSTEM.replace("You are the phone concierge for this computer.",
                               "You are Hermes, answering the phone for this computer.")
        out = f"{rules}\n\n{manner(hermes=True)}"
    return f"{out}\n\n{profile}" if profile else out


# ── who is calling ────────────────────────────────────────────────────────────
# A short note on the person, read once per concierge session — never per turn
# and never anything else out of memory. The account's memory folder already
# has it on a machine that has been used for a while: one file on who they are
# and one on how they like to work. A plain caller.md next to concierge.md is
# the same thing for a machine without one.
PROFILE_FILE = CONFIG_DIR / "caller.md"
PROFILE_CHARS = 1500
PROFILE_PATTERNS = ("who-is-*.md", "*working-style*.md")
PROFILE_HEAD = "About the person calling (background from their own notes; use it, never recite it):"


def _profile_files(account_home: str | None) -> list[Path]:
    root = Path(account_home) if account_home else Path.home() / ".claude"
    out: list[Path] = []
    seen: set[str] = set()
    if PROFILE_FILE.is_file():
        out.append(PROFILE_FILE)
    for pattern in PROFILE_PATTERNS:
        # Every project's memory folder can hold the same file (they are often
        # one folder linked into each), so one copy per name is plenty.
        for f in sorted(root.glob(f"projects/*/memory/{pattern}")):
            if f.name not in seen and f.is_file():
                seen.add(f.name)
                out.append(f)
    return out


def _without_header(text: str) -> str:
    m = re.match(r"^---\s*\n.*?\n---\s*\n", text, re.S)
    return (text[m.end():] if m else text).strip()


def profile(account_home: str | None) -> str:
    """The note on the caller, at most PROFILE_CHARS long, or "" if none."""
    try:
        files = _profile_files(account_home)
    except OSError:
        return ""
    parts: list[str] = []
    for f in files:
        try:
            text = _without_header(f.read_text(encoding="utf-8", errors="replace")[:8000])
        except OSError:
            continue
        if text:
            parts.append(text)
    if not parts:
        return ""
    out = PROFILE_HEAD + "\n" + "\n\n".join(parts)
    if len(out) > PROFILE_CHARS:
        out = out[: PROFILE_CHARS - 1].rstrip() + "…"
    return out


# ── the snapshot ──────────────────────────────────────────────────────────────
def _ago(when: float, now: float) -> str:
    """How long ago, and which day.

    "Three hours ago" leaves "did I finish anything today?" to be worked out by
    the model, and it worked it out wrong in both directions — once as "all of
    these are from yesterday" when one was seconds old. An elapsed time is not
    a calendar day near midnight, so the snapshot names the day instead of
    implying it.
    """
    seconds = max(0.0, now - when)
    if seconds < 45:
        rough = "just now"
    elif seconds < 90:
        rough = "a minute ago"
    elif seconds < 3600:
        rough = _plural(int(seconds // 60), "minute") + " ago"
    elif seconds < 7200:
        rough = "an hour ago"
    elif seconds < 86400:
        rough = _plural(int(seconds // 3600), "hour") + " ago"
    else:
        rough = _plural(int(seconds // 86400), "day") + " ago"

    # Calendar days, not elapsed seconds. Subtracting two timestamps and
    # dividing left the sub-second remainder in the result, so "today" came out
    # as four millionths of a day and fell through to a date — which is how the
    # snapshot ended up calling 12:22 this afternoon "Tue 15 Sep".
    today = date.fromtimestamp(now)
    then = date.fromtimestamp(when)
    gap = (today - then).days
    day = "today" if gap <= 0 else "yesterday" if gap == 1 else then.strftime("%a %d %b")
    return f"{rough}, {day} at {time.strftime('%H:%M', time.localtime(when))}"


def _plural(n: int, unit: str) -> str:
    """"1 minutes ago" is fine on a screen and wrong in a sentence read aloud."""
    return f"1 {unit}" if n == 1 else f"{n} {unit}s"


def _elapsed(seconds: float) -> str:
    seconds = max(0.0, seconds)
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    return f"{int(seconds // 3600)}h {int((seconds % 3600) // 60)}m"


def _project(cwd: str | None) -> str:
    """The folder's name is speakable; its path is not."""
    if not cwd:
        return "no folder"
    return Path(cwd).name or cwd


def _trim(text: str | None, limit: int) -> str:
    from .session import plain
    out = plain(text or "")
    return out[: limit - 1] + "…" if len(out) > limit else out


def _current_tool(events: list[dict]) -> str | None:
    """The tool call that has started and not yet come back.

    `events` is newest-first. A tool.use whose id already has a tool.result
    behind it has finished; the first one that does not is what the session is
    doing right now.
    """
    done = {(e["data"] or {}).get("id") for e in events if e["event"] == "tool.result"}
    for e in events:
        if e["event"] != "tool.use":
            continue
        d = e["data"] or {}
        if d.get("id") in done:
            return None          # newest tool call already answered: between steps
        return _trim(d.get("preview") or d.get("tool") or "", 90)
    return None


def _last_said(events: list[dict], limit: int) -> str | None:
    for e in events:
        if e["event"] == "message.assistant":
            said = _trim((e["data"] or {}).get("text"), limit)
            if said:
                return said
    return None


# Two sentences' worth, in words, because sentences vary and seconds are what
# the caller actually spends — about eleven of them at the rate the phone reads.
# The prompt asks for two and gets them four times in five; the fifth is a third
# sentence somebody has to stand through, and a rule kept four times out of five
# is not a rule.
SPOKEN_WORDS = 32

_SENTENCE = re.compile(r"(?<=[.!?…])\s+")


def clip(text: str) -> str:
    """Trim a spoken answer to something a person will wait through.

    Whole sentences only, taken from the front. The prompt puts whatever is
    blocked or urgent first, so the front is also where the answer is — this
    drops the trailing colour, never the point. A first sentence that is already
    too long is left alone, because half a sentence is worse than a long one.
    """
    parts = [p for p in _SENTENCE.split(text.strip()) if p]
    if not parts:
        return text
    kept, words = [], 0
    for part in parts:
        n = len(part.split())
        if kept and words + n > SPOKEN_WORDS:
            break
        kept.append(part)
        words += n
    return " ".join(kept)


# Telling the two languages apart, for the length of one short sentence.
#
# Letters first — but only the ones English does not have. Turkish's dotless
# capital is the same character as an English "I", so putting it in this class
# made "I can only tell you..." look Turkish and left "efendim" standing in an
# English sentence. The lower-case dotless ı and the dotted capital İ are safe;
# ü, ö and ç are not English either.
#
# Short answers can carry none of those ("Bir şey yok" has ş, but "Hayir yok"
# typed without accents has nothing), so a handful of function words no English
# sentence contains stand in as the second signal.
_TURKISH_LETTERS = re.compile(r"[ışğİŞĞüöç]")
_TURKISH_WORDS = re.compile(
    r"\b(bir|bu|şu|var|yok|ne|için|değil|ama|çok|hiç|hiçbir|şey|oturum|"
    r"çalışıyor|bekliyor|hayır|evet|dakika|saat|önce|şimdi|beş|dört|üç|iki)\b", re.I)


def _is_turkish(text: str) -> bool:
    return bool(_TURKISH_LETTERS.search(text) or _TURKISH_WORDS.search(text))
_SIR = re.compile(r"\bsir\b", re.I)
_EFENDIM = re.compile(r"\befendim\b", re.I)


# Chat previews in the snapshot are written the way the user and the assistant
# actually talk to each other, which is often neither English nor formal. The
# model reads several of them before every answer and copies the register — a
# piece of Turkish slang once arrived in the middle of an English sentence about
# starting tests. Telling it not to borrow the voice of its own evidence works
# most of the time, and most of the time is not what this is for.
_SLANG = re.compile(r"[,\s]*\b(kanka|olum|oğlum|abi|reis|moruk|birader)\b", re.I)


def strip_slang(text: str) -> str:
    out = _SLANG.sub("", text)
    return re.sub(r"\s+([.,!?])", r"\1", out).strip()


def fix_address(text: str) -> str:
    """Make the honorific match the language it was said in.

    The default manner uses no title, but a `concierge.md` may ask for one:
    "sir" in an English answer, "efendim" in a Turkish one. A prompt that said
    so three separate ways still produced "No, efendim" in English about a
    third of the time — a written rule did not hold and a line of code did.
    The model chooses the word; this only ensures it is in the language of the
    sentence around it.
    """
    if _is_turkish(text):
        return _SIR.sub("efendim", text)
    return _EFENDIM.sub("sir", text)


def speakable(text: str, hermes: bool = False) -> str:
    """The output filters, as the manner in force wants them.

    The house strips slang and makes its honorific match the language. Hermes
    has no honorific to fix, and the caller's own register is the register it
    is asked to answer in, so a Turkish "kanka" stays. Slang that turns up in
    an English sentence is still the snapshot talking, not the caller, and is
    still dropped.
    """
    if not hermes:
        return fix_address(strip_slang(text))
    return text if _is_turkish(text) else strip_slang(text)


def headline(db, sessions) -> dict:
    """Who is busy, as three numbers.

    This is what the phone has to say the instant it picks up, so it costs one
    SQLite read and no model turn at all — no event queries, no tail scans. A
    greeting that takes a second is not a greeting, it is a loading screen with
    a voice.

    The wording is left to the phone: it knows which language the person set,
    and three integers translate better than an English sentence would."""
    now = time.time()
    counts = {"working": 0, "blocked": 0, "idle": 0}
    for c in db.list_chats():
        if c.get("archived"):
            continue
        status = c.get("status") or "idle"
        if status == "awaiting_approval":
            counts["blocked"] += 1
        elif status == "running":
            counts["working"] += 1
        elif now - (c.get("updated_at") or now) <= IDLE_MAX_AGE_S:
            counts["idle"] += 1
    return counts


# ── the ticket queue ──────────────────────────────────────────────────────────
# What the background workers are on, for "how is the queue doing". Short on
# purpose: the person cannot act on a ticket from here, only hear about it, so
# it is what is running, what is stuck on them, and how much is waiting.
QUEUE_LINES = 6
QUEUE_TITLE = 70
_URL = re.compile(r"\S*://\S+")
_PATHISH = re.compile(r"[`'\"]?[~.]?[\w.@-]*/[\w./@-]+[`'\"]?")
_LONG_ID = re.compile(r"#?\b\d{4,}\b")
_TICKET_ID = re.compile(r"^\s*#?\d+\s*[:·-]\s*")


def _words(text: str | None, limit: int) -> str:
    """A title or a question, with nothing in it a voice should spell out."""
    out = _URL.sub("", text or "")
    out = _PATHISH.sub("", out)
    out = _TICKET_ID.sub("", out)
    out = _LONG_ID.sub("", out)
    out = re.sub(r"[`*_#]", "", out)
    out = re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"\s+", " ", out)).strip(" -:·")
    return _trim(out, limit)


def _rough(seconds: float) -> str:
    """How long a worker has been at it, already rounded the way it is said."""
    minutes = max(0.0, seconds) / 60
    if minutes < 2:
        return "just started"
    if minutes < 50:
        return f"about {int(round(minutes / 5) * 5) or int(minutes)} minutes in"
    hours = round(minutes / 60)
    return "about an hour in" if hours <= 1 else f"about {hours} hours in"


def queue_section(queue: dict | None, now: float | None = None) -> str | None:
    """The ustabasi queue in at most QUEUE_LINES lines, or None without one."""
    if not queue or not queue.get("available"):
        return None
    now = now or time.time()
    tickets = queue.get("tickets") or []
    running = [t for t in tickets if t.get("status") == "running"]
    waiting = [t for t in tickets if t.get("status") == "blocked"]
    queued = [t for t in tickets if t.get("status") == "queued"]

    lines: list[str] = []
    for t in waiting:
        ask = _words(t.get("ask"), 100)
        lines.append(f'- Waiting on the user: "{_words(t.get("title"), QUEUE_TITLE)}"'
                     + (f", it asks: {ask}" if ask else "."))
    for t in running:
        began = t.get("round_started_at") or t.get("started_at")
        been = f", {_rough(now - float(began))}" if began else ""
        where = f" in {t['project']}" if t.get("project") else ""
        lines.append(f'- Running: "{_words(t.get("title"), QUEUE_TITLE)}"{where}{been}.')
    # Room for the header and the count, whatever else there is to say.
    room = QUEUE_LINES - 2
    if len(lines) > room:
        rest = len(lines) - (room - 1)
        lines = lines[: room - 1] + [f"- And {rest} more running or waiting."]
    lines.append(f"- {len(queued)} ticket(s) queued, not started yet.")
    return "TICKET QUEUE (background workers, by title)\n" + "\n".join(lines)


def snapshot(db, sessions, host_name: str = "this computer",
             queue: dict | None = None) -> tuple[str, list[str]]:
    """The whole computer, as something you could read aloud.

    Returns the text and the chat ids behind the numbers in it. The concierge
    refers to a session by number when it acts on one: matching the title it
    just paraphrased back to a row would mean guessing, and guessing wrong here
    sends a message to the wrong project."""
    now = time.time()
    chats = [c for c in db.list_chats() if not c.get("archived")]
    chats.sort(key=lambda c: c.get("updated_at") or 0, reverse=True)
    chats = chats[:MAX_CHATS]

    working: list[str] = []
    blocked: list[str] = []
    resting: list[str] = []
    order: list[str] = []
    stale = 0
    spent = 0.0

    for c in chats:
        cid = c["id"]
        live = sessions.peek(cid)
        status = c.get("status") or "idle"
        age = now - (c.get("updated_at") or now)
        cost = float(c.get("total_cost_usd") or 0)
        spent += cost
        money = f", ${cost:.2f} so far" if cost >= 0.005 else ""
        head = (f'[{len(order) + 1}] "{_trim(c.get("title") or "untitled", TITLE_CHARS)}" '
                f'in {_project(c.get("cwd"))} ({c.get("model") or c.get("provider")})')

        # An idle session nobody has touched since yesterday is not what a
        # status question is about, and every line of it crowds out one that is.
        if status not in ("running", "awaiting_approval"):
            if age > IDLE_MAX_AGE_S or len(resting) >= IDLE_SHOWN:
                stale += 1
                continue

        order.append(cid)
        tail = db.tail_events(cid, ("message.assistant", "tool.use", "tool.result",
                                    "approval.request"), limit=12)

        if status == "awaiting_approval" and live and live.pending:
            wanted = None
            for e in tail:
                if e["event"] == "approval.request" and (e["data"] or {}).get("request_id") in live.pending:
                    wanted = _trim((e["data"] or {}).get("preview"), 110)
                    break
            blocked.append(f"- {head} is waiting for permission to: {wanted or 'run a tool'}")
            continue

        if status == "running":
            turn = getattr(live, "turn_started", None) if live else None
            been = f", {_elapsed(now - turn)} into this turn" if turn else ""
            line = f"- {head} is working{been}{money}."
            doing = _current_tool(tail)
            if doing:
                line += f" Right now: {doing}."
            said = _last_said(tail, SAID_WORKING)
            if said:
                line += f' Last thing it said: "{said}"'
            working.append(line)
            continue

        line = f"- {head} is idle, last active {_ago(c.get('updated_at') or now, now)}{money}."
        said = _last_said(tail, SAID_IDLE)
        if said:
            line += f' It finished saying: "{said}"'
        resting.append(line)

    parts = [f"Sessions are numbered; use the number when you act on one.\n"
             f"{host_name}. It is {time.strftime('%H:%M on %A %d %B %Y')}, local time. "
             f"{len(working)} session(s) working, {len(blocked)} waiting on the user, "
             f"{len(resting)} idle recently."]
    if blocked:
        parts.append("WAITING ON THE USER\n" + "\n".join(blocked))
    if working:
        parts.append("WORKING\n" + "\n".join(working))
    if resting:
        parts.append("IDLE, MOST RECENT FIRST\n" + "\n".join(resting))
    if not (blocked or working or resting):
        parts.append("Nothing is running and nothing has been touched recently.")
    if stale:
        parts.append(f"There are also {stale} older session(s), untouched for a day or more, "
                     "not described here.")
    tickets = queue_section(queue, now)
    if tickets:
        parts.append(tickets)
    if spent >= 0.005:
        parts.append(f"Lifetime spend of the sessions above, all of them added together: "
                     f"${spent:.2f}. This is not a figure for today.")
    return "\n\n".join(parts), order


# ── what it can actually do ───────────────────────────────────────────────────
# The concierge started out able only to describe. That is the safe shape, and
# it is the wrong one: being told the build is stuck and being unable to say
# "run it again" is worse than not calling at all. These are the four verbs that
# cover what a person asks for from a bus stop, and no more — there is no tool
# here that reads a file or runs a command, so the worst a misheard sentence can
# do is put a wrong instruction into a session, where it is visible and
# stoppable, rather than run one.
#
# Actions are supplied by the server rather than reached for directly: this
# module knows nothing about chats, and keeping it that way is what stops the
# concierge growing into a second copy of the session layer.
Actions = dict[str, Callable[..., Awaitable[Any]]]


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def build_tools(get_index: Callable[[], list[str]], actions: Actions):
    """The tool surface, bound to whatever the last snapshot numbered."""

    def resolve(n: int) -> str:
        index = get_index()
        if not isinstance(n, int) or n < 1 or n > len(index):
            raise ValueError(f"there is no session {n}; the snapshot lists {len(index)}")
        return index[n - 1]

    @tool("send_message", "Send an instruction to a session that already exists. "
                          "Use the number it has in the snapshot.",
          {"session": Annotated[int, "the session's number in the snapshot"],
           "text": Annotated[str, "what to tell it to do, in the user's own words"]})
    async def send_message(args: dict) -> dict:
        try:
            cid = resolve(int(args["session"]))
        except Exception as exc:
            return _ok(str(exc))
        queued = await actions["send"](cid, str(args["text"]))
        return _ok("queued behind the turn it is running" if queued else "sent")

    @tool("start_work", "Start a new session in a project and give it its first "
                        "instruction.",
          {"project": Annotated[str, "project folder name, e.g. 'focus'"],
           "instruction": Annotated[str, "what it should do"]})
    async def start_work(args: dict) -> dict:
        try:
            where = await actions["start"](str(args["project"]), str(args["instruction"]))
        except Exception as exc:
            return _ok(f"could not start it: {exc}")
        return _ok(f"started in {where}")

    @tool("answer_approval", "Answer an approval a session is waiting on. Refused "
                             "for anything destructive — those are done in the app.",
          {"session": Annotated[int, "the session's number in the snapshot"],
           "allow": Annotated[bool, "true to allow, false to deny"]})
    async def answer_approval(args: dict) -> dict:
        try:
            cid = resolve(int(args["session"]))
        except Exception as exc:
            return _ok(str(exc))
        try:
            await actions["approve"](cid, bool(args["allow"]))
        except PermissionError as exc:
            # Deliberately not a matter for the prompt. Approving by voice means
            # approving something that was read out through a speech recogniser,
            # and "delete" and "deploy" are one syllable apart from words that
            # are not. Dangerous requests stay in the app, where they can be read.
            return _ok(str(exc))
        except Exception as exc:
            return _ok(f"could not answer it: {exc}")
        return _ok("allowed" if args["allow"] else "denied")

    @tool("stop_session", "Stop what a session is doing right now.",
          {"session": Annotated[int, "the session's number in the snapshot"]})
    async def stop_session(args: dict) -> dict:
        try:
            cid = resolve(int(args["session"]))
        except Exception as exc:
            return _ok(str(exc))
        await actions["stop"](cid)
        return _ok("stopped")

    return [send_message, start_work, answer_approval, stop_session]


TOOL_NAMES = ["mcp__rac__send_message", "mcp__rac__start_work",
              "mcp__rac__answer_approval", "mcp__rac__stop_session"]


# ── running out of plan ───────────────────────────────────────────────────────
class NoRoom(Exception):
    """No signed-in account has plan left to answer on. `until` is when the
    earliest of them comes back, where anything says."""

    def __init__(self, until: float | None = None):
        super().__init__("no account has plan left")
        self.until = until


class _Limited(Exception):
    """The turn was refused because the account it ran on is out of plan."""


# What the CLI says in place of an answer when the plan is spent. It arrives as
# ordinary assistant text, so without this it is read out to the caller.
_LIMIT_TEXT = re.compile(r"usage limit|hit your limit|limit reached|rate.?limit", re.I)

_DAYS_TR = ("pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar")


def _is_limit(text: str | None) -> bool:
    return bool(text and _LIMIT_TEXT.search(text))


def no_room(until: float | None, lang: str | None, now: float | None = None) -> str:
    """The one sentence a call says when every account is out of plan."""
    turkish = (lang or "").split("-")[0].lower() == "tr"
    now = now or time.time()
    if not until or until <= now:
        return ("Hiçbir hesapta kullanım hakkı kalmadı." if turkish
                else "No account has any plan left right now.")
    then = time.localtime(until)
    clock = time.strftime("%H:%M", then)
    gap = (date.fromtimestamp(until) - date.fromtimestamp(now)).days
    if turkish:
        day = "" if gap <= 0 else "yarın " if gap == 1 else _DAYS_TR[then.tm_wday] + " "
        return f"Hiçbir hesapta kullanım hakkı kalmadı, en erken sıfırlanma {day}saat {clock}."
    day = "" if gap <= 0 else "tomorrow " if gap == 1 else "on " + time.strftime("%A", then) + " "
    return f"No account has any plan left, the earliest one resets {day}at {clock}."


# ── the model ─────────────────────────────────────────────────────────────────
class Concierge:
    """One warm Claude session, kept connected between questions.

    Connecting the CLI is most of the cost of a first answer, so the client is
    built once and held. Follow-up questions ("and the other one?") then work
    for free, because the session still has the previous exchange.
    """

    def __init__(self, snapshot_fn, resolve_account, actions: Actions | None = None,
                 on_limits: Callable[[dict], Any] | None = None,
                 on_limited: Callable[[], Any] | None = None):
        self._snapshot = snapshot_fn            # () -> (text, [chat_id, ...])
        self._resolve = resolve_account         # () -> (home | None, env), or NoRoom
        self._on_limits = on_limits             # a plan reading from our own turn
        self._on_limited = on_limited           # the account just refused a turn
        self._index: list[str] = []             # the numbers in the last snapshot
        self._actions = actions or {}
        self._client: ClaudeSDKClient | None = None
        self._lock = asyncio.Lock()
        self._turns = 0
        self._last = 0.0
        self._hermes = False                    # set per session in _options

    def _options(self) -> ClaudeAgentOptions:
        # Same rule as a chat: the account decides the environment, and nothing
        # is inherited from the daemon's own shell that could sign us in as
        # somebody else.
        env = {k: v for k, v in os.environ.items()
               if k not in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")}
        home, account_env = self._resolve()
        env.update({k: v for k, v in (account_env or {}).items()
                    if k in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")})
        if home:
            env["CLAUDE_CONFIG_DIR"] = home
        # Who is speaking and who to, decided once per session: the agent file
        # and the profile are read here, at connect, and never per question.
        self._hermes = hermes_installed(home)
        return ClaudeAgentOptions(
            env=env,
            cwd=str(Path.home()),
            model=MODEL_ALIASES.get(MODEL, MODEL),
            system_prompt=system_prompt(self._hermes, profile(home)),
            # No tools, and no settings to load: the concierge answers from the
            # snapshot or not at all. This is what keeps it fast *and* what keeps
            # it from wandering off into the filesystem mid-call.
            # No built-in tools: the concierge has no business reading files.
            # Its own four verbs arrive as an in-process MCP server instead.
            tools=[],
            mcp_servers={"rac": create_sdk_mcp_server(
                "rac", tools=build_tools(lambda: self._index, self._actions))}
            if self._actions else {},
            allowed_tools=TOOL_NAMES if self._actions else [],
            setting_sources=None,
            permission_mode="bypassPermissions",
            include_partial_messages=False,
            # Thinking stays on now that there are tools, and it is not a
            # preference. Measured with it off, "tell session one to run the
            # tests" came back as "I've sent it a message to run the tests,
            # sir" — with no tool call behind it. The turn looked perfect and
            # nothing happened, which is the one failure a voice interface
            # cannot have: you hang up believing the tests are running.
            #
            # With thinking on the same four cases route correctly every time.
            # It costs roughly 0.7s on a status question and two seconds on an
            # action. Back when this thing could only describe, that trade was
            # the other way round and thinking was off; being able to act is
            # what changed the answer.
        )

    async def _ensure(self) -> ClaudeSDKClient:
        if self._client is not None and (
            self._turns >= MAX_TURNS or time.monotonic() - self._last > IDLE_RESET_S
        ):
            log.info("concierge session recycled (turns=%d)", self._turns)
            await self.close()
        if self._client is None:
            client = ClaudeSDKClient(options=self._options())
            await client.connect()
            self._client = client
            self._turns = 0
            log.info("concierge connected (model=%s)", MODEL)
        return self._client

    async def ask(self, question: str, lang: str | None = None) -> dict:
        async with self._lock:
            t0 = time.monotonic()
            # One question, as many accounts as it takes. An account that turns
            # out to be spent is left behind and the same question is asked of
            # the next one, so the caller hears an answer and never the refusal.
            # It ends because every refusal takes an account out of the running.
            while True:
                try:
                    return await self._turn(question, lang, t0)
                except NoRoom as exc:
                    log.info("concierge: no account has plan left")
                    return {"text": no_room(exc.until, lang), "limited": True,
                            "ms": int((time.monotonic() - t0) * 1000), "connect_ms": None,
                            "first_token_ms": None, "cost_usd": None, "snapshot_chars": 0,
                            "turn": self._turns, "did": []}
                except _Limited:
                    await self.close()
                    if self._on_limited is None:
                        raise
                    log.info("concierge: account out of plan, trying the next one")
                    self._on_limited()

    def _heard(self, info) -> None:
        """Pass a plan reading on, the way a chat's turn does."""
        if self._on_limits is None:
            return
        try:
            from .providers.claude import ClaudeProvider
            self._on_limits(ClaudeProvider._limits(info))
        except Exception as exc:
            log.warning("concierge: could not pass on a limit reading: %s", exc)

    async def _turn(self, question: str, lang: str | None, t0: float) -> dict:
        snap, self._index = self._snapshot()
        # The phone knows which language it just transcribed, and saying so
        # beats hoping. Left to itself the model took the language from the
        # snapshot — which is full of Turkish — and answered an English
        # question in Turkish.
        # The phone sends a full BCP-47 tag ("tr-TR"), not a bare language
        # code, so match on the prefix — keyed on the whole tag this lookup
        # never hit and the model was left to guess from the snapshot.
        code = (lang or "").split("-")[0].lower()
        want = {"tr": "Answer in Turkish.", "en": "Answer in English."}.get(code)
        client = await self._ensure()
        connected = time.monotonic()
        first: float | None = None
        chunks: list[str] = []
        used: list[str] = []
        cost = None
        refused = False
        failed: str | None = None
        try:
            prompt = f"<state>\n{snap}\n</state>\n\n{question}"
            if want:
                prompt += f"\n\n({want})"
            await client.query(prompt)
            async for msg in client.receive_response():
                if isinstance(msg, RateLimitEvent):
                    self._heard(msg.rate_limit_info)
                    refused = refused or msg.rate_limit_info.status == "rejected"
                elif isinstance(msg, AssistantMessage):
                    refused = refused or msg.error == "rate_limit"
                    for block in msg.content:
                        if isinstance(block, TextBlock) and block.text:
                            if first is None:
                                first = time.monotonic()
                            chunks.append(block.text)
                        elif isinstance(block, ToolUseBlock):
                            used.append(block.name.replace("mcp__rac__", ""))
                elif isinstance(msg, ResultMessage):
                    cost = msg.total_cost_usd
                    if msg.is_error:
                        failed = msg.result or "".join(chunks) or "error"
                    break
        except Exception as exc:
            await self.close()
            log.warning("concierge turn failed: %s", exc)
            if _is_limit(str(exc)):
                raise _Limited() from exc
            raise
        # A refused turn still "answers": the CLI's own line about the limit.
        # Only a turn that ended in error counts, so a warning on a turn that
        # went through is never mistaken for one.
        if failed and (refused or _is_limit(failed)):
            raise _Limited()

        self._turns += 1
        self._last = time.monotonic()
        from .session import plain
        # Markdown is not a sound. Strip it even though the prompt forbids
        # it — a stray asterisk read out loud is worse than a lost emphasis.
        text = speakable(clip(plain("".join(chunks)).strip()), self._hermes)
        return {
            "text": text,
            "ms": int((time.monotonic() - t0) * 1000),
            "connect_ms": int((connected - t0) * 1000),
            "first_token_ms": int((first - t0) * 1000) if first else None,
            "cost_usd": cost,
            "snapshot_chars": len(snap),
            "turn": self._turns,
            "did": used,
        }

    async def warm(self) -> None:
        """Pay for the first question before it is asked.

        Measured: connecting costs about 400ms, but the first *query* on a fresh
        session costs three seconds more than every query after it — the CLI
        sets itself up lazily, on the first prompt, not on connect. Connecting
        early therefore bought nothing (4.5s cold, 5.0s "warmed"), and the only
        thing that actually absorbs the cost is a real query nobody reads.

        So this sends one and throws the answer away, while the phone is still
        saying hello. Two short lines of greeting and a breath before the caller
        speaks is about four seconds, which is what this takes."""
        try:
            async with self._lock:
                client = await self._ensure()
                if self._turns:
                    return                      # already used; nothing to warm
                await client.query("Warm-up, not from the caller. Reply with the single word OK.")
                refused = False
                async for msg in client.receive_response():
                    if isinstance(msg, RateLimitEvent):
                        self._heard(msg.rate_limit_info)
                        refused = refused or msg.rate_limit_info.status == "rejected"
                    elif isinstance(msg, ResultMessage):
                        refused = bool(msg.is_error) and (refused or _is_limit(msg.result))
                        break
                if refused and self._on_limited is not None:
                    # Found out before the caller asked anything: the first
                    # question opens on the next account instead of this one.
                    await self.close()
                    self._on_limited()
                    return
                self._turns += 1
                self._last = time.monotonic()
        except Exception as exc:
            log.warning("concierge could not warm up: %s", exc)
            await self.close()

    async def reset(self) -> None:
        async with self._lock:
            await self.close()

    async def close(self) -> None:
        if self._client is None:
            return
        client, self._client = self._client, None
        self._turns = 0
        try:
            await asyncio.wait_for(client.disconnect(), timeout=5)
        except Exception as exc:
            log.warning("concierge disconnect failed: %s", exc)
