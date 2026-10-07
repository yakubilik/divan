"""A chat is named after what it turned out to be about.

The first message is a poor name. Often it is a greeting, or "test", or the
name of the agent the chat was opened with; the thing the chat is for arrives
two or three messages in. A list of chats named after their first lines is a
list nobody can find anything in.

So the title is asked for again as the chat goes on: after the first turn,
and at a few later points in case the purpose only showed up then, or moved.
Not every turn — a name that keeps changing is as hard to find as one that
says nothing. A title a person typed is theirs and is never touched.

The asking is one short call to the smallest model, on the account the chat
already runs on, with nothing loaded: no settings, no hooks, no tools.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import tempfile

from . import tools

log = logging.getLogger("rac.naming")

# How many messages the person has sent when the name is looked at again.
CHECKPOINTS = (1, 3, 6, 12, 25)
MODEL = "haiku"
TIMEOUT_S = 45
TITLE_WORDS = 8
UNCLEAR = "UNCLEAR"

# What the model is shown of each message. A title needs the gist of what was
# asked, not the stack trace pasted under it.
_USER_CHARS = 400
_REPLY_CHARS = 500
_FIRST, _LAST = 3, 5

SYSTEM = f"""You name conversations for the sidebar of a chat app.

You are given what a person said to a coding assistant, oldest first, and the \
title the conversation has now. Answer with one line and nothing else: a title \
of three to six words that says what this conversation is for — the task or \
the subject — concretely enough to tell it apart from the same person's other \
conversations about the same project.

Rules:
- Write the title in the language the person writes in.
- No project name, no assistant or agent name, no quotes, no full stop, no emoji.
- Name the goal, not the first step and not the latest small request.
- If the current title already says it, answer with the current title unchanged.
- If the messages do not yet say what the conversation is for (a greeting, a \
test, "continue"), answer exactly {UNCLEAR}."""


def due(said: int, named_at: int) -> bool:
    """Whether a checkpoint was passed since the name was last looked at."""
    return any(named_at < c <= said for c in CHECKPOINTS)


def _cut(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


def brief(events: list[dict], current: str, project: str | None = None) -> str:
    """What the model reads: how the chat began, where it is now, its title.

    `events` are the chat's `message.user` and `message.assistant` events,
    oldest first. The opening messages are where a purpose is usually stated
    and the latest ones are where it has moved to, so the middle of a long
    chat is left out.
    """
    said = [e["data"].get("text") or "" for e in events if e["event"] == "message.user"]
    said = [t for t in said if t.strip()]
    replies = [e["data"].get("text") or "" for e in events if e["event"] == "message.assistant"]
    kept = said if len(said) <= _FIRST + _LAST else said[:_FIRST] + ["[…]"] + said[-_LAST:]
    lines = [f"Current title: {current}"]
    if project:
        # It is drawn in front of the title already; said twice it is the
        # half of the row that gets read.
        lines.append(f"Project, to be left out of the title: {project}")
    lines += ["", "The person said:"]
    lines += [f"- {t if t == '[…]' else _cut(t, _USER_CHARS)}" for t in kept]
    if replies:
        lines += ["", "The assistant's latest reply:", _cut(replies[-1], _REPLY_CHARS)]
    return "\n".join(lines)


def parse(answer: str) -> str | None:
    """The title in the model's answer, or None where it gave none worth using."""
    for line in (answer or "").splitlines():
        line = line.strip().strip("\"'“”‘’`*#").strip().rstrip(".").strip()
        if not line:
            continue
        if line.upper().startswith(UNCLEAR) or len(line.split()) > TITLE_WORDS:
            return None
        return line
    return None


async def ask(text: str, env: dict[str, str]) -> str | None:
    """Ask the model for a title. None on any failure: a chat keeps the name
    it has, and nothing about a turn depends on this."""
    answer = await call(text, SYSTEM, env)
    return parse(answer) if answer is not None else None


async def call(text: str, system: str, env: dict[str, str]) -> str | None:
    """One short question to the smallest model with nothing loaded, and what
    it said. None on any failure. `recap` asks through here too."""
    cli = tools.find_cli("claude")
    if not cli:
        return None
    # An empty folder to run in: a project's CLAUDE.md is no part of the question.
    with tempfile.TemporaryDirectory(prefix="rac-name-") as cwd:
        try:
            proc = await asyncio.create_subprocess_exec(
                cli, "-p", text, "--model", MODEL, "--output-format", "json",
                "--system-prompt", system, "--setting-sources", "", "--strict-mcp-config",
                "--tools", "", "--disable-slash-commands", "--no-session-persistence",
                # No thinking: it is a one-line answer, and thought about it
                # takes eighteen seconds instead of two.
                cwd=cwd, env={**env, "MAX_THINKING_TOKENS": "0"},
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        except OSError as exc:
            log.info("naming: could not start the CLI: %s", exc)
            return None
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT_S)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return None
    try:
        reply = json.loads(out.decode("utf-8", "replace"))
    except ValueError:
        return None
    if not isinstance(reply, dict) or reply.get("is_error"):
        return None
    return str(reply.get("result") or "")
