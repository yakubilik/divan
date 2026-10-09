"""The live voice session: a phone call that streams both ways.

The old call (`call.*`, see call.py) is half duplex: the phone decides the
caller has finished after 800 ms of quiet, sends text, waits for a whole answer
and reads it out. The measurements in docs/voice-quality-baseline.md show what
that costs: thinking pauses cut in half, a chat call silent for the length of
an agent's turn. This module is the replacement the plan
(docs/voice-quality-plan.md) chose, option B:

- The phone streams microphone PCM (`voice.audio`). **The daemon owns turns**:
  it runs the level detector and the turn rule measured as `bench.Plan`
  (reply after 700 ms of quiet, 1800 ms when the words trail off on a joining
  word, commit after 2500 ms) and it alone hands out turn ids.
- Recognition is eager. A short pause starts a transcription of what has been
  said so far on the small model, so by the time the 700 ms soft end arrives
  the words are usually already there; the default (turbo) model writes the
  words an agent will receive, inside the commit window.
- The answer is speculative: it starts at the soft end and streams out of a
  fast conversational layer (Haiku, thinking off) one clause at a time as
  `voice.say`. Speech that resumes before the commit cancels it, and the turn
  grows under a new id.
- **Commit is the only gate to execution.** The fast layer's tools only record
  an intent; nothing reaches a chat, starts work or answers an approval until
  the turn is committed, and then it goes through the server's own
  `_concierge_actions` — the same path the phone's buttons use, with the same
  accounts, permission modes and approvals. What is said about it is a fixed
  line built from what the action returned, never the model's own claim.
- Progress while an agent works comes from that agent's real events only.

Everything that needs a model is behind two small interfaces, `Recognizer`
and `Brain`, so `scripts/test_voice.py` can replay the bench fixtures through
a real socket with stand-ins and `scripts/voice_bench/voice_session.py` with
the real ones.

This module holds Turkish words for the same reason call.py does: what the
daemon says aloud is data in the language of the call.
"""
from __future__ import annotations

import array
import asyncio
import base64
import itertools
import json
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, AsyncIterator, Awaitable, Callable, Protocol

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    create_sdk_mcp_server,
    tool,
)

from . import call as callmod
from .call import Concierge, NoRoom, _is_limit, _Limited, no_room, spoken_reply, last_reply
from .errors import Err
from .providers.claude import MODEL_ALIASES

log = logging.getLogger("rac.voice")

# ── audio and the turn rule ──────────────────────────────────────────────────
RATE = 16000
FRAME_MS = 20
FRAME = RATE * FRAME_MS // 1000          # samples per detector frame

SPEECH_DB = -45.0       # a frame this loud is speech while nothing is playing
MIN_SPEECH_MS = 60      # ... once there have been this many milliseconds of it
BARGE_DB = -35.0        # while the phone plays: above the echo its canceller lets through
BARGE_MIN_MS = 120      # ... and this long, so a click is not a caller

PRE_STT_MS = 300        # quiet after which the words so far are transcribed, before anyone needs them
REPLY_MS = 700          # bench.Plan.reply_ms
UNFINISHED_MS = 1800    # bench.Plan.unfinished_ms
COMMIT_MS = 2500        # bench.Plan.commit_ms
FINAL_STT_MS = 1200     # quiet after which the commit's (slower, better) transcription starts
PREROLL_MS = 300        # audio kept before the first loud frame: a soft onset is still a word
PAD_MS = 200            # audio kept after the last loud frame, for the same reason at the end
MAX_TURN_MS = 60_000    # an utterance longer than this is committed where it stands

READY_CAP_S = 3.0       # the daemon says nothing on its own until the phone's player is live, or this long
RESUME_S = 30.0         # a dropped session can be picked up again for this long
PROGRESS_GAP_S = 20.0   # at most one progress line this often
ACK_AFTER_S = 1.2       # an action that has not answered by now gets an "OK" first
STT_TIMEOUT_S = 15.0
FIRST_TOKEN_TIMEOUT_S = 12.0
REPLY_TIMEOUT_S = 30.0
RETRIES = 1             # one more try for a recogniser or a reply that failed
SPOKEN_WORDS = callmod.SPOKEN_WORDS

# Small for the reply, the default model for what an agent receives (§5.4 of
# the plan): 7.0% and 3.9% WER on the fixtures with the vocabulary prompt.
FAST_STT_MODEL = os.environ.get("RAC_VOICE_STT_MODEL", "").strip() or "mlx-community/whisper-small-mlx"
VOCAB = "Claude, Codex, daemon, commit, build, deploy, branch, merge, TestFlight, Xcode, Expo, ticket."

# The fast layer: Haiku with thinking off, first sentence 1.17 s median against
# Sonnet's 3 s (docs/voice-bench/llm.json).
FAST_MODEL = os.environ.get("RAC_VOICE_MODEL", "").strip() or "haiku"



def frame_db(samples) -> float:
    if not samples:
        return -100.0
    ms = sum(s * s for s in samples) / len(samples)
    return 10 * math.log10(ms / (32768.0 ** 2)) if ms > 0 else -100.0


# The same words `bench.HANGING` holds (test_voice.py checks they agree): a pause
# after one of these is a breath in the middle of a Turkish sentence.
HANGING = {
    "ve", "ama", "fakat", "ancak", "yani", "şey", "şeyi", "şeyde", "için", "de", "da",
    "ki", "ile", "veya", "ya", "yoksa", "çünkü", "sonra", "önce", "peki", "hani",
    "bir", "bu", "şu", "o", "eee", "ee", "ıı", "mesela", "aslında", "galiba",
}


def _words_tr(text: str) -> list[str]:
    text = text.replace("I", "ı").replace("İ", "i").lower()
    text = re.sub(r"[’'`]", "", text)
    return re.sub(r"[^\w\s]", " ", text).split()


def sounds_unfinished(text: str) -> bool:
    stripped = text.rstrip()
    if not stripped:
        return False
    if stripped.endswith((",", ";", ":", "-", "…")):
        return True
    words = _words_tr(stripped)
    return bool(words) and words[-1] in HANGING


# ── what is said, and how it is cut ─────────────────────────────────────────
# A piece ends at a clause mark followed by a space: at the end of the text so
# far nobody knows yet whether "3," is "3,5". The first piece may be a clause
# of three words or more, which is what gets the first sound out early; later
# ones are whole sentences, which is what keeps the voice from sounding chopped.
_CLAUSE = re.compile(r"[,;:.!?…—]\s")
_SENTENCE_MARK = re.compile(r"[.!?…]\s")


def cut(buf: str, first: bool) -> tuple[str | None, str]:
    for m in (_CLAUSE if first else _SENTENCE_MARK).finditer(buf):
        head = buf[:m.start() + 1].strip()
        if not first or len(head.split()) >= 3 or buf[m.start()] in ".!?…":
            return head, buf[m.end():]
    return None, buf


# The fast layer may not claim an action (plan §5): with thinking off, the
# concierge once said it had sent a message with no tool call behind it. Its
# tools only record intents, and what is said about them is built from the
# result below — so any first-person claim of having done something in its own
# text is false by construction, and is dropped rather than spoken.
_CLAIM = re.compile(
    # Turkish: an action verb in the first person, done, doing or about to do.
    r"\b(?:gönder|ilet|başlat|çalıştır|bitirt|bitir|durdur|onayla|halled|hallet|düzelt|ekle|yolla|"
    r"kontrol ed|kontrol et|incele|bak|söyle|izin ver|reddet)\w*?(?:d[ıiuü]m|t[ıiuü]m|[ıiuü]?yorum|ece[ğk]im|aca[ğk][ıi]m|y?eyim|y?ayım)\b"
    # English: the same, in the forms a model uses for it.
    r"|\bi(?:'ve| have|'ll| will|'m| am)? (?:sent|started|stopped|approved|denied|told|asked|fixed|ran|"
    r"forwarded|send|start|stop|forward|tell|ask|check|look|sending|starting|stopping|forwarding|"
    r"checking|looking|running)\b",
    re.I)


def claims_action(text: str) -> bool:
    return bool(_CLAIM.search(text))


LINES = {
    "tr": {
        "ack": ["Tamam.", "Peki, bir saniye.", "Anladım, iletiyorum."],
        "sent": "Sohbete ilettim.",
        "queued": "Sohbete ilettim, elindeki işi bitirince bakacak.",
        "started": "{where} projesinde yeni bir sohbet başlattım.",
        "allowed": "İzin verdim.",
        "denied": "Reddettim.",
        "stopped": "Durdurdum.",
        "danger": "Bu tehlikeli bir işlem, onayı uygulamadan vermen gerekiyor.",
        "failed": "Bunu yapamadım.",
        "no_chat_running": "O sohbet şu an çalışmıyor.",
        "tool": {"Bash": "Bir komut çalıştırıyor.", "Edit": "Dosyalarda değişiklik yapıyor.",
                 "Write": "Dosyalarda değişiklik yapıyor.", "Read": "Kodu inceliyor.",
                 "Grep": "Kodu inceliyor.", "Glob": "Kodu inceliyor.", "*": "Hâlâ çalışıyor."},
        "approval": "Sohbet {what} için onay bekliyor. İzin vereyim mi?",
        "approval_danger": "Sohbet tehlikeli bir işlem için onay bekliyor, onu uygulamadan vermen gerekiyor.",
        "approval_what": {"Bash": "bir komut çalıştırmak", "Edit": "bir dosyayı değiştirmek",
                          "Write": "bir dosya yazmak", "*": "bir adım"},
        "turn_error": "Sohbet bir hatayla durdu.",
        "unheard": "Seni duyamadım, tekrar söyler misin?",
        "no_reply": "Şu an cevap veremiyorum, birazdan tekrar dener misin?",
    },
    "en": {
        "ack": ["OK.", "Right, one moment.", "Got it, passing it on."],
        "sent": "Sent to the chat.",
        "queued": "Sent; it will get to it after what it is doing.",
        "started": "Started a new chat in {where}.",
        "allowed": "Allowed.",
        "denied": "Denied.",
        "stopped": "Stopped it.",
        "danger": "That one is destructive; it has to be approved in the app.",
        "failed": "I couldn't do that.",
        "no_chat_running": "That chat is not running right now.",
        "tool": {"Bash": "It is running a command.", "Edit": "It is changing files.",
                 "Write": "It is changing files.", "Read": "It is reading the code.",
                 "Grep": "It is reading the code.", "Glob": "It is reading the code.",
                 "*": "Still working."},
        "approval": "The chat is waiting for approval to {what}. Shall I allow it?",
        "approval_danger": "The chat is waiting for approval of something destructive; that one is approved in the app.",
        "approval_what": {"Bash": "run a command", "Edit": "change a file", "Write": "write a file",
                          "*": "take a step"},
        "turn_error": "The chat stopped with an error.",
        "unheard": "I couldn't make that out, could you say it again?",
        "no_reply": "I can't answer right now, try again in a moment.",
    },
}

# Error codes a voice session can report (`voice.error`); the phone looks them
# up like any other code (errors.py).
E_STT = "voice_stt_failed"
E_REPLY = "voice_reply_failed"
E_NO_SESSION = "voice_no_session"
E_BAD_AUDIO = "voice_bad_audio"
E_NO_STT = "voice_no_transcriber"


# ── the two things that need a model ─────────────────────────────────────────
@dataclass
class Clip:
    """A stretch of the session's audio, and where it sits on its timeline."""
    pcm: bytes
    start_ms: int
    end_ms: int
    final: bool          # the commit's transcription, not the reply's


class Recognizer(Protocol):
    async def __call__(self, clip: Clip) -> str: ...


class Brain(Protocol):
    """The fast conversational layer.

    `reply` streams text deltas for one utterance and records an intent through
    `intend(verb, args)` for anything it wants done; it never acts. `cancel`
    stops a reply in flight; the next `reply` waits for its tail to drain."""

    def reply(self, text: str, lang: str, intend: Callable[[str, dict], None]) -> AsyncIterator[str]: ...

    async def cancel(self) -> None: ...

    async def warm(self) -> None: ...

    async def close(self) -> None: ...


class Whisper:
    """The daemon's own whisper (transcribe.py), on the small model for the
    reply and the default one for the commit."""

    def __init__(self, lang: str):
        self.lang = lang

    async def __call__(self, clip: Clip) -> str:
        from . import transcribe
        model = None if clip.final else FAST_STT_MODEL
        r = await asyncio.wait_for(
            asyncio.to_thread(transcribe.pcm, clip.pcm, VOCAB, self.lang, model), STT_TIMEOUT_S)
        return ((r or {}).get("text") or "").strip()


VOICE_SYSTEM = """\
You are the voice of this computer on a live phone call. What you write is \
spoken aloud by a speech synthesizer clause by clause while you are still \
writing it, so the first few words have to be the answer.

Every question is preceded by a <state> block: a live snapshot of the coding \
sessions on this computer. Answer from it and nothing else; if it does not say, \
say you do not know.

When the caller asks for something to be done — an instruction for a session, \
new work, an answer to an approval, stopping something — call the tool and \
write nothing at all. The system speaks the result itself, after the action has \
really happened. Never say that you sent, started, stopped or approved anything, \
and never promise to.

How to speak:
- One or two short sentences. One is usually better.
- No file paths, URLs, commands, code, markdown, lists or emoji. Round numbers.
- A session's title is a fragment of what somebody typed: say what it is about \
in a few words of your own, never read it out.
- Reply in the language you are told to, as it is spoken, not as it is written."""

CHAT_SYSTEM_EXTRA = """\
This call was made from inside one chat, whose state is in the <state> block. \
A request for that chat to do something goes to it with forward_to_chat: the \
caller's own words are sent, not yours. A question about how it is doing is \
answered from the state, without forwarding."""


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def chat_tools(intend_ref: Callable[[], Callable[[str, dict], None]]):
    """The chat call's three verbs, as intents."""

    @tool("forward_to_chat", "Send what the caller just said to this chat, as an instruction.", {})
    async def forward(_args: dict) -> dict:
        intend_ref()("forward", {})
        return _ok("noted; it is sent once the caller has finished speaking")

    @tool("answer_approval", "Answer the approval this chat is waiting on.",
          {"allow": Annotated[bool, "true to allow, false to deny"]})
    async def approve(args: dict) -> dict:
        intend_ref()("approve_chat", {"allow": bool(args.get("allow"))})
        return _ok("noted")

    @tool("stop_chat", "Stop what this chat is doing right now.", {})
    async def stop(_args: dict) -> dict:
        intend_ref()("stop_chat", {})
        return _ok("noted")

    return [forward, approve, stop]


CHAT_TOOL_NAMES = ["mcp__rac__forward_to_chat", "mcp__rac__answer_approval", "mcp__rac__stop_chat"]


def deferred_actions(intend_ref: Callable[[], Callable[[str, dict], None]]) -> callmod.Actions:
    """The general call's four verbs (`call.build_tools`), as intents. The tool
    resolves the session number to a chat id before this is reached."""

    async def send(chat_id: str, text: str) -> bool:
        intend_ref()("send", {"chat_id": chat_id, "text": text})
        return False

    async def start(project: str, instruction: str) -> str:
        intend_ref()("start", {"project": project, "instruction": instruction})
        return project

    async def approve(chat_id: str, allow: bool) -> None:
        intend_ref()("approve", {"chat_id": chat_id, "allow": allow})

    async def stop(chat_id: str) -> None:
        intend_ref()("stop", {"chat_id": chat_id})

    return {"send": send, "start": start, "approve": approve, "stop": stop}


class FastLayer(Concierge):
    """A warm Claude session per call that streams (plan §5).

    The concierge's machinery — account choice, plan fallback, the snapshot as
    `<state>`, recycling — with Haiku, thinking off and partial messages on.
    Its tools record intents (see `deferred_actions`); the session executes
    them, and only once the turn is committed."""

    def __init__(self, snapshot_fn, resolve_account, chat_id: str | None = None, **kw):
        super().__init__(snapshot_fn, resolve_account, actions=None, **kw)
        self.chat_id = chat_id
        self._intend: Callable[[str, dict], None] = lambda verb, args: None
        self._drain: asyncio.Task | None = None
        self._inflight = False

    def _options(self) -> ClaudeAgentOptions:
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")}
        home, account_env = self._resolve()
        env.update({k: v for k, v in (account_env or {}).items()
                    if k in ("CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY")})
        if home:
            env["CLAUDE_CONFIG_DIR"] = home
        self._hermes = callmod.hermes_installed(home)
        ref = lambda: self._intend  # noqa: E731
        if self.chat_id:
            tools, names, extra = chat_tools(ref), CHAT_TOOL_NAMES, "\n\n" + CHAT_SYSTEM_EXTRA
        else:
            tools = callmod.build_tools(lambda: self._index, deferred_actions(ref))
            names, extra = callmod.TOOL_NAMES, ""
        system = f"{VOICE_SYSTEM}{extra}\n\n{callmod.manner(self._hermes)}"
        prof = callmod.profile(home)
        if prof:
            system += "\n\n" + prof
        return ClaudeAgentOptions(
            env=env, cwd=str(Path.home()), model=MODEL_ALIASES.get(FAST_MODEL, FAST_MODEL),
            system_prompt=system, tools=[],
            mcp_servers={"rac": create_sdk_mcp_server("rac", tools=tools)},
            allowed_tools=names, setting_sources=None, permission_mode="bypassPermissions",
            include_partial_messages=True, thinking={"type": "disabled"})

    async def cancel(self) -> None:
        """Interrupt the answer in flight. The CLI still sends that turn's tail,
        which must be read off before the next question or it would be taken as
        the next answer; it is drained in the background and the next reply
        waits for it (measured in the proof: this is part of the latency)."""
        if not self._inflight or self._client is None or (self._drain and not self._drain.done()):
            return
        client = self._client

        async def drain() -> None:
            try:
                async def tail():
                    await client.interrupt()
                    async for m in client.receive_response():
                        if isinstance(m, ResultMessage):
                            break
                await asyncio.wait_for(tail(), 10)
            except Exception as exc:
                log.info("voice: draining a cancelled reply failed (%s); reconnecting next time", exc)
                await self.close()
            self._inflight = False
        self._drain = asyncio.create_task(drain())

    async def reply(self, text: str, lang: str, intend: Callable[[str, dict], None]) -> AsyncIterator[str]:
        t0 = time.monotonic()
        self.timing = timing = {}
        if self._drain is not None:
            await self._drain
            self._drain = None
        timing["drain_ms"] = int((time.monotonic() - t0) * 1000)
        want = {"tr": "Answer in Turkish.", "en": "Answer in English."}.get(lang, "")
        async with self._lock:
            timing["lock_ms"] = int((time.monotonic() - t0) * 1000)
            for _ in range(3):              # the account, and at most two that replace it
                try:
                    client = await self._ensure()
                    timing["ready_ms"] = int((time.monotonic() - t0) * 1000)
                except NoRoom as exc:
                    yield no_room(exc.until, lang)
                    return
                snap, self._index = self._snapshot()
                self._intend = intend
                self._inflight = True
                refused, failed, said = False, None, False
                try:
                    await client.query(f"<state>\n{snap}\n</state>\n\n{text}\n\n({want})")
                    async for msg in client.receive_response():
                        if isinstance(msg, StreamEvent):
                            ev = msg.event
                            d = ev.get("delta") or {}
                            if ev.get("type") == "content_block_delta" and d.get("type") == "text_delta":
                                if not said:
                                    timing["first_token_ms"] = int((time.monotonic() - t0) * 1000)
                                said = True
                                yield d.get("text", "")
                            elif (ev.get("type") == "content_block_start" and said
                                  and (ev.get("content_block") or {}).get("type") == "text"):
                                yield " "           # two text blocks are two sentences
                        elif isinstance(msg, RateLimitEvent):
                            self._heard(msg.rate_limit_info)
                            refused = refused or msg.rate_limit_info.status == "rejected"
                        elif isinstance(msg, AssistantMessage):
                            refused = refused or msg.error == "rate_limit"
                        elif isinstance(msg, ResultMessage):
                            self._inflight = False
                            if msg.is_error:
                                failed = msg.result or "error"
                            break
                except (asyncio.CancelledError, GeneratorExit):
                    await self.cancel()
                    raise
                except Exception as exc:
                    self._inflight = False
                    await self.close()
                    if _is_limit(str(exc)) and self._on_limited is not None:
                        self._on_limited()
                        continue
                    raise
                finally:
                    self._intend = lambda verb, args: None
                if failed and (refused or _is_limit(failed)) and not said and self._on_limited is not None:
                    await self.close()
                    self._on_limited()
                    continue
                if failed:
                    raise RuntimeError(failed)
                self._turns += 1
                self._last = time.monotonic()
                return
            yield no_room(None, lang)


# ── the session ──────────────────────────────────────────────────────────────
@dataclass
class Turn:
    """One generation of output. A caller's utterance gets one; so does speech
    that resumes after its reply had started (the turn grows, under a new id);
    so does each announcement the daemon makes on its own."""
    id: int
    start: int = 0                       # first sample of the utterance (session timeline)
    kind: str = "user"                   # "user" | "note"
    end: int | None = None               # last speech sample when the reply started
    wait_ms: int = REPLY_MS
    text: str = ""                       # the reply's transcript
    final: str = ""                      # the commit's transcript
    reply: asyncio.Task | None = None
    commit: asyncio.Task | None = None
    committed: bool = False
    asked: bool = False                  # the fast layer has been asked for a reply
    withdrawn: bool = False              # cancelled before its commit: its intents are void
    intents: list[tuple[str, dict]] = field(default_factory=list)
    pieces: int = 0
    closed: bool = False                 # the last piece is out, or it was cancelled
    cancelled: bool = False
    marks: dict = field(default_factory=dict)


class VoiceSession:
    def __init__(self, hub: "Hub", dev_id: str, ws, data: dict):
        self.hub = hub
        self.id = uuid.uuid4().hex[:16]
        self.dev_id = dev_id
        self.ws = ws
        self.chat_id: str | None = data.get("chat_id") or None
        self.lang = (str(data.get("lang") or "tr-TR").split("-")[0].lower() or "tr")
        if self.lang not in LINES:
            self.lang = "en"
        self.client = data.get("client") or {}
        self.recognize: Recognizer = hub.recognizer_factory(self, data)
        self.brain: Brain = hub.brain_factory(self, data)
        # The audio timeline: every sample since voice.start, in order.
        self.audio = bytearray()
        self.base = 0                    # sample index of audio[0]
        self.total = 0                   # samples received
        self.seq: int | None = None      # next expected voice.audio seq
        self.gaps = 0
        self.run = 0                     # consecutive loud frames
        self.utt: int | None = None      # first sample of the open utterance
        self.last_speech = 0             # end sample of the last loud frame
        self.speech_wall = 0.0           # wall clock when that frame arrived
        self.turn: Turn | None = None
        self.ids = itertools.count(1)
        self.turn_id = 0
        self.playing = False             # the phone says it is playing the current turn
        self.state = ""
        self.watch: set[str] = {self.chat_id} if self.chat_id else set()
        self.notes: list[tuple[str, str]] = []      # (kind, text) waiting for a quiet moment
        self.last_progress = 0.0
        self.last_line = ""
        self.acks = itertools.cycle(LINES[self.lang]["ack"])
        self.partials: dict[int, asyncio.Task] = {}  # end sample -> fast transcription
        self.finals: dict[int, asyncio.Task] = {}    # end sample -> commit transcription
        self.deadlines: list[tuple[int, asyncio.Future]] = []
        self.detached_at: float | None = None
        self.metrics: list[dict] = []
        self.tasks: set[asyncio.Task] = set()
        self.closed = False
        # medkit's `client_ready`: a line produced before the phone's player is
        # running is heard late or squeezed. Announcements wait for `voice.ready`.
        self.ready_at = time.time() + READY_CAP_S

    def ready(self) -> None:
        self.ready_at = min(self.ready_at, time.time())
        self.flush_notes()

    # ── wire ─────────────────────────────────────────────────────────────────
    def emit(self, event: str, data: dict, turn_id: int | None = None) -> None:
        if self.ws is None:
            return                       # reconnecting: nothing of a turn is replayed
        payload = {"session_id": self.id, "turn_id": self.turn_id if turn_id is None else turn_id,
                   **data}
        msg = json.dumps({"type": "event", "event": event, "chat_id": self.chat_id, "seq": None,
                          "data": payload, "ts": time.time()}, ensure_ascii=False)
        self.hub.server._enqueue(self.ws, msg)

    def set_state(self, state: str) -> None:
        if state != self.state:
            self.state = state
            self.emit("voice.state", {"state": state, "t_server_ms": int(time.time() * 1000)})

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)
        return t

    def ms(self, sample: int) -> int:
        return sample * 1000 // RATE

    def clip(self, start: int, end: int, final: bool) -> Clip:
        a = max(start, self.base)
        b = min(end + RATE * PAD_MS // 1000, self.total)
        pcm = bytes(self.audio[(a - self.base) * 2:(b - self.base) * 2])
        return Clip(pcm, self.ms(a), self.ms(b), final)

    # ── turns ────────────────────────────────────────────────────────────────
    def new_turn(self, start: int, kind: str = "user") -> Turn:
        self.turn_id = next(self.ids)
        self.turn = Turn(self.turn_id, start=start, kind=kind)
        return self.turn

    def live(self, turn: Turn) -> bool:
        return turn is self.turn and not turn.cancelled and not self.closed

    def cancel(self, turn: Turn | None, reason: str) -> None:
        """Stop a turn's words for good.

        Before its commit the turn is withdrawn as well: the reply is stopped
        and whatever it meant to do never happens. After the commit the turn is
        final, so its reply runs on in silence — what the caller asked for still
        reaches the agent; only what would have been said about it is dropped."""
        if turn is None or turn.cancelled:
            return
        if turn.closed and not self.playing and reason != "barge":
            return
        turn.cancelled = True
        turn.closed = True
        streaming = turn.reply is not None and not turn.reply.done()
        if not turn.committed:
            turn.withdrawn = True
            if streaming:
                turn.reply.cancel()
                self._spawn(self.brain.cancel())
        # A reply still waiting for its words, or for the longer quiet after a
        # joining word, was never visible to the phone: nothing to cancel there.
        if turn.asked or turn.pieces or reason == "barge":
            self.emit("voice.cancel", {"reason": reason}, turn.id)
        self.playing = False
        turn.marks["cancelled"] = reason

    def say(self, turn: Turn, text: str, kind: str, last: bool) -> bool:
        if not self.live(turn) or turn.closed:
            return False
        if turn.pieces == 0:
            turn.marks.setdefault("first_say_wall", time.time())
            if self.state != "hearing":
                self.set_state("speaking")
        self.emit("voice.say", {"piece": turn.pieces, "text": text, "last": last, "kind": kind}, turn.id)
        turn.pieces += 1
        if last:
            turn.closed = True
        if text:
            self.last_line = text
        return True

    def close_turn(self, turn: Turn) -> None:
        """A turn that has said everything it is going to. An empty last piece
        only closes it; a turn that said nothing at all says nothing now."""
        if turn.pieces and not turn.closed:
            self.say(turn, "", "reply", True)
        turn.closed = True

    # ── audio in ─────────────────────────────────────────────────────────────
    def feed(self, seq: int | None, pcm: bytes) -> None:
        if seq is not None:
            if self.seq is not None and seq < self.seq:
                return                   # a duplicate, or late after a gap was filled
            if self.seq is not None and seq > self.seq:
                # Lost messages: their time still passed, so they are silence.
                missing = min(seq - self.seq, 10)
                self.gaps += seq - self.seq
                log.info("voice %s: %d audio message(s) missing", self.id, seq - self.seq)
                self._frames(bytes(len(pcm) * missing))
            self.seq = seq + 1
        self._frames(pcm)

    def _frames(self, pcm: bytes) -> None:
        start = self.total
        self.audio += pcm[:len(pcm) // 2 * 2]
        self.total = self.base + len(self.audio) // 2
        # Frames are cut on the session timeline, not per message, so a phone
        # that sends 64 ms or 100 ms at a time is judged the same way.
        first = (start // FRAME) * FRAME
        for f0 in range(first, self.total - FRAME + 1, FRAME):
            if f0 + FRAME <= start:
                continue
            a = (f0 - self.base) * 2
            if a < 0:
                continue
            frame = array.array("h", bytes(self.audio[a:a + FRAME * 2]))
            self._frame(f0 + FRAME, frame_db(frame))
        self._trim()

    def _trim(self) -> None:
        keep = RATE * PREROLL_MS // 1000 + FRAME
        if self.utt is None and not self._audio_needed():
            drop = len(self.audio) // 2 - keep
            if drop > RATE:              # trim in whole seconds, not every message
                del self.audio[:drop * 2]
                self.base += drop

    def _audio_needed(self) -> bool:
        t = self.turn
        return t is not None and t.kind == "user" and not t.committed

    def _frame(self, t: int, db: float) -> None:
        threshold, need = (BARGE_DB, BARGE_MIN_MS) if self.playing else (SPEECH_DB, MIN_SPEECH_MS)
        loud = db >= threshold
        for at, fut in [d for d in self.deadlines if d[0] <= t]:
            self.deadlines.remove((at, fut))
            if not fut.done():
                fut.set_result(None)
        if loud:
            self.run += 1
            if self.run * FRAME_MS >= need:
                self._speech(t)
            return
        self.run = 0
        if self.utt is None:
            return
        quiet = self.ms(t - self.last_speech)
        turn = self.turn
        if quiet >= PRE_STT_MS:
            self._partial(self.last_speech)
        if turn.reply is None and quiet >= REPLY_MS:
            turn.end = self.last_speech
            turn.marks["speech_end_wall"] = self.speech_wall
            turn.marks["soft_end_wall"] = time.time()
            turn.reply = self._spawn(self._reply(turn))
        # The commit's transcription waits until the reply has its first words
        # out: whisper's decoding loop is Python, and run next to the reply it
        # slowed the event loop that reads the model's stream by about a second.
        if quiet >= FINAL_STT_MS and (turn.reply is None or turn.reply.done() or turn.pieces):
            self._final(self.last_speech)
        if quiet >= max(turn.wait_ms, COMMIT_MS) or self.ms(t - self.utt) > MAX_TURN_MS:
            self._commit(turn)

    def _speech(self, t: int) -> None:
        turn = self.turn
        if self.utt is None:
            # A new utterance. Whatever the daemon was saying is over: if the
            # phone was playing it this is a barge-in the phone has not reported
            # yet; otherwise the caller simply spoke over the end of it.
            if turn is not None and not turn.closed:
                self.cancel(turn, "barge" if self.playing else "superseded")
            onset = t - self.run * FRAME - RATE * PREROLL_MS // 1000
            self.utt = max(self.base, onset)
            self.new_turn(self.utt)
            self.set_state("hearing")
        elif turn.reply is not None:
            # Speech resumed after a reply had started but before the commit:
            # the reply in flight is stale and the turn grows under a new id.
            self.cancel(turn, "resumed")
            self.new_turn(self.utt)
            self.set_state("hearing")
        elif self.state != "hearing":
            self.set_state("hearing")
        self.last_speech = t
        self.speech_wall = time.time()

    # ── recognition ──────────────────────────────────────────────────────────
    async def _recognize(self, clip: Clip) -> str | None:
        """Words, "" for none, None when the recogniser failed twice."""
        for attempt in range(RETRIES + 1):
            try:
                return await self.recognize(clip)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("voice %s: recognition failed (%r, try %d)", self.id, exc, attempt + 1)
        self.emit("voice.error", {"code": E_STT, "message": "speech recognition failed"})
        return None

    def _partial(self, end: int) -> None:
        # Queued even behind one still running (the recogniser takes them in
        # turn): at the soft end this one is then already started.
        if end in self.partials or sum(not t.done() for t in self.partials.values()) >= 2:
            return
        self.partials = {k: v for k, v in self.partials.items() if k >= self.utt}
        self.partials[end] = self._spawn(self._recognize(self.clip(self.utt, end, False)))

    def _final(self, end: int) -> None:
        if end not in self.finals:
            self.finals = {end: self._spawn(self._recognize(self.clip(self.utt, end, True)))}

    async def _fast_text(self, start: int, end: int) -> str | None:
        task = self.partials.get(end)
        if task is None:
            running = [t for t in self.partials.values() if not t.done()]
            if running:
                await asyncio.wait(running)
            task = self.partials.get(end)
            if task is None:
                task = self.partials[end] = self._spawn(self._recognize(self.clip(start, end, False)))
        return await task

    def until(self, sample: int) -> Awaitable[None]:
        fut = asyncio.get_running_loop().create_future()
        if sample <= self.total:
            fut.set_result(None)
        else:
            self.deadlines.append((sample, fut))
        return fut

    # ── the speculative reply ────────────────────────────────────────────────
    async def _reply(self, turn: Turn, text: str | None = None) -> None:
        if text is None:
            text = await self._fast_text(turn.start, turn.end)
            turn.marks["fast_stt_wall"] = time.time()
            if turn.withdrawn:
                return
            if not text:
                return                   # nothing was said; the commit decides what to do
            turn.text = text
            self.emit("voice.transcript", {"text": text, "final": False}, turn.id)
            if sounds_unfinished(text):
                # Mid-sentence: wait for the longer quiet before saying anything.
                turn.wait_ms = UNFINISHED_MS
                await self.until(turn.end + RATE * UNFINISHED_MS // 1000)
                if turn.withdrawn:
                    return
        if self.live(turn):
            self.set_state("thinking")
        await self._speak_reply(turn, text)

    async def _speak_reply(self, turn: Turn, text: str) -> None:
        def intend(verb: str, args: dict) -> None:
            if not turn.withdrawn:
                turn.intents.append((verb, args))
        buf, words, first = "", 0, True
        turn.asked = True
        stream = self.brain.reply(text, self.lang, intend)
        try:
            for attempt in range(RETRIES + 1):
                try:
                    timeout = FIRST_TOKEN_TIMEOUT_S
                    while True:
                        try:
                            delta = await asyncio.wait_for(stream.__anext__(), timeout)
                        except StopAsyncIteration:
                            break
                        timeout = REPLY_TIMEOUT_S
                        turn.marks.setdefault("first_token_wall", time.time())
                        if turn.withdrawn:
                            return
                        if turn.intents or not self.live(turn):
                            continue     # an action turn: its words are discarded
                        buf += delta
                        while True:
                            piece, buf = cut(buf, first)
                            if piece is None:
                                break
                            if not self._speak_piece(turn, piece):
                                continue
                            first = False
                            words += len(piece.split())
                            if words >= SPOKEN_WORDS:
                                # Long enough for a phone; the rest stays unsaid.
                                await stream.aclose()
                                self.close_turn(turn)
                                return
                    break
                except Exception as exc:
                    log.warning("voice %s: reply failed (%r, try %d)", self.id, exc, attempt + 1)
                    await stream.aclose()
                    await self.brain.cancel()
                    if attempt >= RETRIES or turn.pieces or turn.withdrawn:
                        self.emit("voice.error", {"code": E_REPLY, "message": str(exc)[:200],
                                                  "retry_in_ms": 0}, turn.id)
                        if not turn.pieces:
                            self.say(turn, LINES[self.lang]["no_reply"], "notice", True)
                        else:
                            self.close_turn(turn)
                        return
                    buf, first = "", True
                    stream = self.brain.reply(text, self.lang, intend)
            if not turn.intents and buf.strip():
                self._speak_piece(turn, buf.strip())
            if not turn.intents:
                self.close_turn(turn)
        finally:
            turn.marks["reply_done_wall"] = time.time()
            turn.marks["brain"] = dict(getattr(self.brain, "timing", None) or {})

    def _speak_piece(self, turn: Turn, piece: str) -> bool:
        from .session import plain
        text = callmod.speakable(plain(piece), getattr(self.brain, "_hermes", False))
        if not re.search(r"\w", text):
            return False
        if claims_action(text):
            log.info("voice %s: dropped a claimed action: %r", self.id, text)
            turn.marks["claims_dropped"] = turn.marks.get("claims_dropped", 0) + 1
            return False
        return self.say(turn, text, "reply", False)

    # ── commit: the only gate to execution ───────────────────────────────────
    def _commit(self, turn: Turn) -> None:
        if turn.committed:
            return
        turn.committed = True
        end = self.last_speech
        turn.marks.setdefault("speech_end_wall", self.speech_wall)
        turn.marks["commit_wall"] = time.time()
        task = self.finals.get(end)
        if task is None:
            task = self._spawn(self._recognize(self.clip(turn.start, end, True)))
        self.finals = {}
        self.partials = {}
        self.utt = None
        turn.commit = self._spawn(self._finish(turn, task, end))

    async def _finish(self, turn: Turn, final_task: asyncio.Task, end: int) -> None:
        final = await final_task
        turn.marks["final_stt_wall"] = time.time()
        if final is None:
            # The recogniser failed: say so rather than go quiet.
            if self.live(turn) and not turn.pieces:
                self.say(turn, LINES[self.lang]["unheard"], "notice", True)
            self.close_turn(turn)
            self._settle()
            return
        if not final:
            # Silence, or noise the recogniser had nothing for: no transcript is
            # made up, and anything that was started on a guess is withdrawn.
            if turn.pieces:
                self.cancel(turn, "error")
            turn.closed = True
            turn.marks["empty"] = True
            self._record(turn, end, "")
            self._settle()
            return
        turn.final = final
        self.emit("voice.transcript", {"text": final, "final": True}, turn.id)
        if turn.reply is None or (turn.reply.done() and not turn.text and self.live(turn)):
            # The fast transcription heard nothing but the commit's did: answer now.
            turn.text = final
            turn.reply = self._spawn(self._reply(turn, final))
        if turn.reply is not None:
            try:
                await asyncio.wait_for(asyncio.shield(turn.reply), REPLY_TIMEOUT_S + FIRST_TOKEN_TIMEOUT_S)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        routed = "conversation"
        if turn.intents and not turn.withdrawn:
            routed = await self._execute(turn)
        self.emit("voice.turn", {"committed_text": final, "routed": routed,
                                 "t_speech_end_ms": self.ms(end)}, turn.id)
        self._record(turn, end, routed)
        self._settle()

    async def _execute(self, turn: Turn) -> str:
        """Run what the turn asked for, through the server's own actions, once."""
        actions = self.hub.actions()
        lines = LINES[self.lang]
        routed = "conversation"
        said: list[str] = []
        ack = None
        if self.live(turn):
            ack = asyncio.get_running_loop().call_later(
                ACK_AFTER_S, lambda: self.say(turn, next(self.acks), "ack", False))
        try:
            for verb, args in turn.intents[:3]:
                try:
                    if verb in ("forward", "send"):
                        cid = self.chat_id if verb == "forward" else args["chat_id"]
                        text = turn.final if verb == "forward" else args["text"]
                        queued = await actions["send"](cid, text)
                        said.append(lines["queued" if queued else "sent"])
                        routed = f"chat:{cid}"
                        self.watch.add(cid)
                    elif verb == "start":
                        where, cid = await self.hub.start_work(args["project"], args["instruction"])
                        said.append(lines["started"].format(where=where))
                        routed = f"new:{cid}" if cid else "new"
                        if cid:
                            self.watch.add(cid)
                    elif verb in ("approve", "approve_chat"):
                        cid = self.chat_id if verb == "approve_chat" else args["chat_id"]
                        await actions["approve"](cid, bool(args["allow"]))
                        said.append(lines["allowed" if args["allow"] else "denied"])
                        routed = f"chat:{cid}"
                    elif verb in ("stop", "stop_chat"):
                        cid = self.chat_id if verb == "stop_chat" else args["chat_id"]
                        await actions["stop"](cid)
                        said.append(lines["stopped"])
                        routed = f"chat:{cid}"
                except PermissionError:
                    said.append(lines["danger"])
                except Err as exc:
                    said.append(lines["no_chat_running"] if exc.code == "no_pending_approval" else lines["failed"])
                except Exception as exc:
                    log.warning("voice %s: %s failed: %s", self.id, verb, exc)
                    said.append(lines["failed"])
        finally:
            if ack is not None:
                ack.cancel()
        turn.marks["executed_wall"] = time.time()
        for i, line in enumerate(said):
            self.say(turn, line, "reply", i == len(said) - 1)
        self.close_turn(turn)
        return routed

    def _settle(self) -> None:
        """After a turn: back to listening, and say whatever was held back."""
        if self.utt is not None:
            return
        self.flush_notes()
        if self.turn is not None and self.turn.pieces and not self.turn.cancelled and self.playing:
            return
        self.set_state(self._resting())

    def _resting(self) -> str:
        if self.ws is None:
            return "reconnecting"
        sessions = self.hub.server.sessions
        for cid in self.watch:
            s = sessions.peek(cid)
            if s is not None and getattr(s, "running", None) is not None and not s.running.done():
                return "working"
        return "listening"

    def _record(self, turn: Turn, end: int, routed: str) -> None:
        m = turn.marks
        # The wall clock when the frame holding the last speech arrived: the
        # daemon's own view of "speech ended", a network hop after the phone's.
        base = m["speech_end_wall"]
        rel = lambda k: None if k not in m else int((m[k] - base) * 1000)  # noqa: E731
        self.metrics.append({
            "turn_id": turn.id, "t_speech_end_ms": self.ms(end), "text": turn.final, "routed": routed,
            "cancelled": m.get("cancelled"), "empty": bool(m.get("empty")), "brain": m.get("brain"),
            "after_speech_end_ms": {k[:-5]: rel(k) for k in ("soft_end_wall", "fast_stt_wall",
                                    "first_token_wall", "first_say_wall", "commit_wall",
                                    "final_stt_wall", "executed_wall")}})

    # ── what the agents are doing ────────────────────────────────────────────
    def observe(self, event: dict) -> None:
        cid = event.get("chat_id")
        if cid not in self.watch:
            return
        name = event.get("event")
        data = event.get("data") or {}
        lines = LINES[self.lang]
        if name == "tool.use":
            now = time.time()
            line = lines["tool"].get(data.get("tool"), lines["tool"]["*"])
            if now - self.last_progress < PROGRESS_GAP_S or line == self.last_line:
                return
            self.last_progress = now
            self.note("progress", line)
        elif name == "approval.request":
            what = lines["approval_what"].get(data.get("tool"), lines["approval_what"]["*"])
            self.note("question", lines["approval_danger"] if data.get("danger")
                      else lines["approval"].format(what=what))
        elif name == "turn.done":
            said = spoken_reply(last_reply(self.hub.server.db, cid), self.lang)
            if said:
                self.note("reply", said)
        elif name == "turn.error":
            self.note("progress", lines["turn_error"])
        elif name == "chat.updated" and self.utt is None and self.turn_quiet():
            self.set_state(self._resting())

    def turn_quiet(self) -> bool:
        t = self.turn
        return t is None or (t.closed and (t.commit is None or t.commit.done()))

    def note(self, kind: str, text: str) -> None:
        # A progress line that is out of date by the time it could be said is
        # not worth saying; the newer one replaces it.
        if kind == "progress":
            self.notes = [n for n in self.notes if n[0] != "progress"]
        self.notes.append((kind, text))
        self.flush_notes()

    def flush_notes(self) -> None:
        """Say what is waiting, unless the caller is talking or a turn of
        theirs is still being answered."""
        if not self.notes or self.utt is not None or not self.turn_quiet() or self.ws is None:
            return
        wait = self.ready_at - time.time()
        if wait > 0:
            asyncio.get_running_loop().call_later(wait + 0.01, self.flush_notes)
            return
        notes, self.notes = self.notes, []
        turn = self.new_turn(self.total, kind="note")
        turn.committed = True
        for i, (kind, text) in enumerate(notes):
            self.say(turn, text, kind, i == len(notes) - 1)

    # ── phone reports ────────────────────────────────────────────────────────
    def playback(self, d: dict) -> None:
        if int(d.get("turn_id") or -1) != self.turn_id:
            return
        state = d.get("state")
        if state == "started":
            self.playing = True
        elif state in ("done", "stopped"):
            t = self.turn
            if state == "stopped" or (t is not None and t.closed and d.get("piece") == t.pieces - 1):
                self.playing = False
                if self.utt is None and self.turn_quiet():
                    self.set_state(self._resting())

    def barge(self, d: dict) -> None:
        """The phone heard the caller over playback and has stopped its player."""
        turn = self.turn
        if turn is None or int(d.get("turn_id") or -1) != turn.id:
            return
        self.cancel(turn, "barge")
        turn.closed = True
        self.playing = False
        self.set_state("hearing")

    async def close(self) -> None:
        self.closed = True
        for t in list(self.tasks):
            t.cancel()
        try:
            await self.brain.close()
        except Exception:
            pass


class Hub:
    """Every voice session on this daemon, and the doors into the server."""

    def __init__(self, server, recognizer_factory=None, brain_factory=None):
        self.server = server
        self.sessions: dict[str, VoiceSession] = {}
        self._whisper = recognizer_factory is None
        self.recognizer_factory = recognizer_factory or (lambda s, d: Whisper(s.lang))
        self.brain_factory = brain_factory or self._fast_layer

    def _fast_layer(self, s: VoiceSession, d: dict) -> Brain:
        srv = self.server
        snap = (lambda: chat_state(srv.db, srv.sessions, s.chat_id)) if s.chat_id else srv.call_snapshot
        return FastLayer(snap, srv._concierge_account, chat_id=s.chat_id,
                         on_limits=srv._concierge_limits, on_limited=srv._concierge_limited)

    def actions(self) -> callmod.Actions:
        return self.server._concierge_actions()

    async def start_work(self, project: str, instruction: str) -> tuple[str, str | None]:
        """`start` from `_concierge_actions`, and the chat it made."""
        before = {c["id"] for c in self.server.db.list_chats()}
        where = await self.actions()["start"](project, instruction)
        new = [c["id"] for c in self.server.db.list_chats() if c["id"] not in before]
        return where, (new[0] if new else None)

    def _reap(self) -> None:
        now = time.time()
        for sid, s in list(self.sessions.items()):
            if s.detached_at is not None and now - s.detached_at > RESUME_S:
                self.sessions.pop(sid, None)
                asyncio.create_task(s.close())

    async def start(self, dev, ws, d: dict) -> dict:
        from . import transcribe
        self._reap()
        old = self.sessions.get(str(d.get("session_id") or ""))
        if old is not None and old.dev_id == dev.id and old.detached_at is not None:
            # A dropped socket, back within the window: same session, and a new
            # turn id so nothing of the interrupted turn is played.
            old.ws, old.detached_at = ws, None
            old.cancel(old.turn, "error")
            old.utt = None
            old.new_turn(old.total, kind="note").closed = True
            old.state = ""
            old.set_state(old._resting())
            return {"session_id": old.id, "turn_id": old.turn_id, "resumed": True}
        for s in [s for s in self.sessions.values() if s.ws is ws]:
            await self.stop_session(s)
        if d.get("chat_id") and self.server.db.get_chat(d["chat_id"]) is None:
            raise Err("no_chat", "no such chat")
        if int(d.get("sample_rate") or RATE) != RATE:
            raise Err(E_BAD_AUDIO, f"audio must be {RATE} Hz mono 16-bit PCM")
        if self._whisper and not transcribe.available():
            raise Err(E_NO_STT, "no speech recogniser on this computer")
        s = VoiceSession(self, dev.id, ws, d)
        self.sessions[s.id] = s
        s.set_state("listening")
        s._spawn(s.brain.warm())
        if isinstance(s.recognize, Whisper):
            # Both models, loaded while the caller is still being greeted.
            s._spawn(asyncio.to_thread(transcribe.pcm, bytes(RATE // 5 * 2), None, s.lang, FAST_STT_MODEL))
            transcribe.warm()
        return {"session_id": s.id, "turn_id": s.turn_id}

    def get(self, dev, d: dict) -> VoiceSession:
        s = self.sessions.get(str(d.get("session_id") or ""))
        if s is None or s.dev_id != dev.id or s.closed:
            raise Err(E_NO_SESSION, "no such voice session")
        return s

    async def stop_session(self, s: VoiceSession) -> None:
        self.sessions.pop(s.id, None)
        s.cancel(s.turn, "superseded")
        await s.close()

    def observe(self, event: dict) -> None:
        if not event.get("chat_id"):
            return
        for s in list(self.sessions.values()):
            try:
                s.observe(event)
            except Exception as exc:
                log.warning("voice %s: could not follow an event: %s", s.id, exc)

    def detach(self, ws) -> None:
        for s in self.sessions.values():
            if s.ws is ws:
                s.cancel(s.turn, "error")
                s.ws = None
                s.detached_at = time.time()
                s.state = "reconnecting"
                s.utt = None
                s.playing = False


def decode_audio(d: dict) -> bytes:
    try:
        return base64.b64decode(d.get("pcm_b64") or "", validate=False)
    except Exception as exc:
        raise Err(E_BAD_AUDIO, f"audio is not base64: {exc}") from exc


# ── a chat call's state ──────────────────────────────────────────────────────
def chat_state(db, sessions, chat_id: str) -> tuple[str, list[str]]:
    """The one chat a chat call is about, in the snapshot's style."""
    c = db.get_chat(chat_id) or {}
    live = sessions.peek(chat_id)
    status = c.get("status") or "idle"
    tail = db.tail_events(chat_id, ("message.assistant", "tool.use", "tool.result", "approval.request",
                                    "message.user"), limit=16)
    lines = [f'This chat: "{callmod._trim(c.get("title") or "untitled", callmod.TITLE_CHARS)}" '
             f'in {callmod._project(c.get("cwd"))}, status {status}.']
    if status == "awaiting_approval" and live is not None and getattr(live, "pending", None):
        for e in tail:
            if e["event"] == "approval.request" and (e["data"] or {}).get("request_id") in live.pending:
                lines.append(f"It is waiting for permission to: {callmod._trim((e['data'] or {}).get('preview'), 110)}")
                break
    doing = callmod._current_tool(tail)
    if status == "running" and doing:
        lines.append(f"Right now: {doing}.")
    said = callmod._last_said(tail, callmod.SAID_WORKING)
    if said:
        lines.append(f'Last thing it said: "{said}"')
    return "\n".join(lines), [chat_id]
