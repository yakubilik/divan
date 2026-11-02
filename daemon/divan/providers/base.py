"""Provider interface: one instance per chat, drives one CLI session."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

# emit(event_type, payload, persist) -> None
EmitFn = Callable[[str, dict, bool], Awaitable[None]]
# approval(tool_name, tool_input, reason) -> "allow" | "allow_session" | "deny"
#   | "expired" (nobody answered in time: not approved, and not a "no" either)
ApprovalFn = Callable[[str, dict, str | None], Awaitable[str | dict]]

# An approval nobody answered. The decision the timeline records, the line it
# shows under the request, and what the agent is told instead of "denied".
EXPIRED = "expired"
EXPIRED_NOTE = "Permission timed out, so it was not run."
CANCELLED_NOTE = "The agent stopped waiting for this answer, so it was not approved."
DROPPED_NOTE = "The daemon restarted while this was waiting, so the request was dropped and it was not run."
EXPIRED_TO_AGENT = ("Nobody answered the permission request on the phone in time, so it was NOT "
                    "approved and did not run. Do not run it, or anything that does the same, "
                    "another way; tell the user it is waiting for their approval.")


@dataclass
class ProviderConfig:
    model: str
    effort: str | None
    perm_mode: str          # ask | accept-edits | plan | bypass
    cwd: str
    session_id: str | None  # resume
    max_turns: int | None = None
    max_budget_usd: float | None = None
    # Absolute CLI config home for the chosen account (CLAUDE_CONFIG_DIR /
    # CODEX_HOME). None means the machine's own login.
    account_home: str | None = None
    account_id: str | None = None
    # the account's full environment: config-dir pointers and, for an account
    # signed in with a key, the key itself
    account_env: dict[str, str] = field(default_factory=dict)
    # the chat talks to one of the computer's agents: its definition becomes
    # the system prompt, which is what makes the chat that agent
    agent_prompt: str | None = None
    agent_name: str | None = None
    # where this session is and how it is expected to sound. Built per session
    # by preamble.build, because the daemon is the only party that knows.
    preamble: str | None = None
    # The chat this session belongs to, handed to the CLI as DIVAN_CHAT_ID so
    # what it runs — `ustabasi add` — can say which chat asked for it.
    chat_id: str | None = None
    # Config.bypass_asks, carried to the provider that enforces it.
    bypass_asks: bool = True
    # Config.ask_for: the categories of the destructive list still asked about.
    ask_for: list[str] | None = None
    # Config.approval_timeout_s: a hook has to outlive it (`ClaudeProvider._options`).
    approval_timeout_s: int = 900


@dataclass
class TurnResult:
    session_id: str | None
    cost_usd: float | None
    usage: dict[str, Any] | None
    duration_ms: int | None
    num_turns: int | None
    is_error: bool = False
    error: str | None = None
    stop_reason: str | None = None
    # The CLI was killed by a signal from outside while the turn ran. Not the
    # turn's own failure: the session is intact and can be picked up again.
    killed: bool = False
    # The tool could not authenticate: "OAuth session expired and could not
    # be refreshed". Usually two CLI processes on one sign-in racing to renew
    # its single-use refresh token — a fresh process reads the renewed one —
    # and sometimes a sign-in that is really gone. The session decides which.
    auth_failed: bool = False


AUTH_FAILED_MARKERS = ("failed to authenticate", "oauth session expired",
                       "oauth token has expired", "invalid authentication credentials")


def is_auth_failure(text: str | None) -> bool:
    t = (text or "").lower()
    return any(m in t for m in AUTH_FAILED_MARKERS)


class Provider(ABC):
    name: str = "base"

    def __init__(self, cfg: ProviderConfig, emit: EmitFn, approval: ApprovalFn):
        self.cfg = cfg
        self.emit = emit
        self.approval = approval
        # Called with no turn in flight, when the model has spoken anyway. The
        # session fills this in; it opens a turn for what was said. A provider
        # that cannot be spoken to unasked simply never calls it.
        self.on_idle_output: Callable[[], Awaitable[None]] | None = None

    @abstractmethod
    async def run(self, prompt: str, attachments: list[dict] | None = None) -> TurnResult: ...

    async def run_continuation(self) -> TurnResult:
        """Drain a turn the model started on its own. Only providers that call
        `on_idle_output` are ever asked for one."""
        raise NotImplementedError

    def has_pending(self) -> bool:
        """True when the model has said something no turn has claimed yet."""
        return False

    async def steer(self, prompt: str, attachments: list[dict] | None = None) -> bool:
        """Hand the model a message while a turn is in flight.

        The model reads it at its next step — after the tool it is running
        returns — and the turn carries on with it, the way typing into a
        running Claude Code session works. Returns False when the provider
        cannot do that (no turn in flight, or a tool that only takes input
        between turns); the session then queues the message instead.
        """
        return False

    @abstractmethod
    async def interrupt(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @staticmethod
    @abstractmethod
    def catalog() -> dict: ...
