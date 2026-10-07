"""What a chat is working on, and what came of it.

A product's page says what happened on it today, and what happened on it is
its chats. A title tells them apart; it does not say what was done. So each
chat carries two more things: one line of what it is for, written as soon as
the first message is in, and a short list of what has actually been done in
it, written again every time a turn ends.

It is asked the way a title is (`naming`): the smallest model, on the account
the chat already runs on, with nothing loaded. The list it wrote last time is
handed back to it, so a long chat's early work is not forgotten when its
middle is no longer shown.
"""
from __future__ import annotations

import re
from typing import NamedTuple

from . import naming

MAX_DONE = 6
_TASK_CHARS = 140
_DONE_CHARS = 160
_USER_CHARS = 400
_REPLY_CHARS = 900
_FIRST, _LAST = 2, 4
_REPLIES = 3

SYSTEM = f"""You keep the day's log for one conversation between a person and a coding assistant.

You are given what the person said, the assistant's latest replies, and the \
log as it stands. Answer in exactly this shape and with nothing else:

TASK: <one line: what this conversation is working on>
- <one thing that has been done>
- <another>

Rules:
- Write in the language the person writes in.
- TASK names the goal in under fifteen words. No project name, no assistant name.
- A bullet is something finished, in the past tense, concrete enough to mean \
something to the person tomorrow: what was changed, found, decided or shipped. \
Not a plan, not a question, not a step in progress.
- Keep the bullets already in the log unless they turned out untrue, add what \
is new, and merge related ones so there are at most {MAX_DONE}.
- If nothing has been finished yet, write the TASK line and no bullets.
- If the messages do not say what the conversation is for (a greeting, a \
test), answer exactly {naming.UNCLEAR}."""


class Recap(NamedTuple):
    task: str
    done: list[str]


def lines(stored: str | None) -> list[str]:
    """The list as the database holds it, a line each."""
    return [l for l in (stored or "").split("\n") if l.strip()]


def _cut(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


def brief(events: list[dict], had: Recap) -> str:
    """What the model reads: the log so far, what was asked, the latest replies."""
    said = [e["data"].get("text") or "" for e in events if e["event"] == "message.user"]
    said = [t for t in said if t.strip()]
    replies = [e["data"].get("text") or "" for e in events if e["event"] == "message.assistant"]
    replies = [t for t in replies if t.strip()]
    kept = said if len(said) <= _FIRST + _LAST else said[:_FIRST] + ["[…]"] + said[-_LAST:]
    out = ["The log as it stands:", f"TASK: {had.task or '(none yet)'}"]
    out += [f"- {d}" for d in had.done]
    out += ["", "The person said:"]
    out += [f"- {t if t == '[…]' else _cut(t, _USER_CHARS)}" for t in kept]
    if replies:
        out += ["", "The assistant's latest replies, oldest first:"]
        out += [f"> {_cut(t, _REPLY_CHARS)}" for t in replies[-_REPLIES:]]
    return "\n".join(out)


def parse(answer: str) -> Recap | None:
    """The log in the model's answer, or None where it wrote none."""
    task, done = "", []
    for line in (answer or "").splitlines():
        line = line.strip()
        if not task:
            m = re.match(r"\**TASK\**\s*:\**\s*(.+)", line, re.I)
            if m:
                task = _cut(m.group(1).strip().strip("*").rstrip("."), _TASK_CHARS)
            elif line.upper().startswith(naming.UNCLEAR):
                return None
        elif re.match(r"[-*•]\s+\S", line):
            done.append(_cut(line[1:].strip(), _DONE_CHARS))
    return Recap(task, done[:MAX_DONE]) if task else None


async def ask(text: str, env: dict[str, str]) -> Recap | None:
    answer = await naming.call(text, SYSTEM, env)
    return parse(answer) if answer is not None else None
