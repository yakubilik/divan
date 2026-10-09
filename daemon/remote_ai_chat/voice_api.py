"""The live call's fast layer on the Anthropic Messages API directly (opt-in).

#151 measured the one stage of a live call that misses its budget: the fast
layer's first token through the Claude Code CLI, 1.7 s median and 6-9 s at the
tail (docs/voice-quality-results.md §3). medkit's live voice, the reference,
reaches the same model over the API on a warm HTTP connection. This module is
that arrangement behind the same `Brain` interface: the same system prompt,
the same `<state>` turn prompt, the same verbs recorded as intents (never
executed here), and the session's own commit gate, claim guard and
cancellation around it. Recognition and the voice stay on the Mac and on the
phone; only the text of the turn and the state snapshot go to the API, as they
already do through the CLI.

It is off unless two things are true: `voice_fast_layer = "anthropic-api"` in
config.toml (or RAC_VOICE_FAST_LAYER for an isolated daemon), and a key stored
for it on purpose (`python -m remote_ai_chat.voice_api set-key`, the keychain
item `divan-voice-anthropic`, or RAC_VOICE_ANTHROPIC_API_KEY). The shell's own
ANTHROPIC_API_KEY is never read: a key somebody exported for another project
is not a decision to bill Divan's calls to it. Asked for and missing, the call
does not start and says what to do (E_KEY), rather than quietly falling back.

Spending is capped per local day from the API's own usage figures
(`Budget`), and a rate-limited key is left alone for as long as the API asks
(`retry-after`), so a failing provider costs one request per turn at most.

Written against the Messages API's server-sent events directly with httpx,
which the daemon already ships, rather than the `anthropic` SDK, which it does
not: https://platform.claude.com/docs/en/build-with-claude/streaming. The wire
format is small and stable (`anthropic-version: 2023-06-01`), and unknown
events are ignored as the docs ask.
"""
from __future__ import annotations

import asyncio
import getpass
import json
import logging
import os
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

import httpx

from . import voice
from .config import CONFIG_DIR, CONFIG_PATH
from .errors import Err

log = logging.getLogger("rac.voice.api")

CLI = "cli"
API = "anthropic-api"
PROVIDERS = (CLI, API)

API_URL = "https://api.anthropic.com"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-4-5"     # the model #151 measured through the CLI
KEY_ENV = "RAC_VOICE_ANTHROPIC_API_KEY"
PROVIDER_ENV = "RAC_VOICE_FAST_LAYER"
KEYCHAIN_SERVICE = "divan-voice-anthropic"
KEYCHAIN_ACCOUNT = "remote-ai-chat"

MAX_TOKENS = 200                       # one or two spoken sentences, with room for a tool call
HISTORY_TURNS = 8                      # earlier exchanges kept, as medkit prunes its history
CONNECT_S = 5.0
READ_S = 10.0                          # the longest quiet allowed inside one stream
COOLDOWN_MAX_S = 60.0

# USD per million tokens, input and output, from
# https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-09).
# A model not listed is priced as the dearest one here, so the cap errs safe.
PRICES = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
}
_DEAREST = (2.00, 10.00)

E_KEY = "voice_api_key_missing"
E_PROVIDER = "voice_unknown_fast_layer"

SET_KEY_HINT = ("store one with `python -m remote_ai_chat.voice_api set-key`, "
                "or set voice_fast_layer = \"cli\" in config.toml to use the subscription")


# ── what was chosen ─────────────────────────────────────────────────────────
@dataclass
class Settings:
    provider: str = CLI
    model: str = DEFAULT_MODEL
    daily_usd: float = 1.0


def settings(cfg=None) -> Settings:
    """The fast layer to use for the next call: config.toml as it is on disk
    now (so a rollback needs no restart), else the loaded config, with the
    environment variable over both for an isolated test daemon."""
    raw: dict = {}
    try:
        raw = tomllib.loads(CONFIG_PATH.read_text())
    except Exception:
        pass
    pick = lambda k, d: raw.get(k, getattr(cfg, k, d))  # noqa: E731
    provider = (os.environ.get(PROVIDER_ENV) or str(pick("voice_fast_layer", CLI))).strip() or CLI
    if provider not in PROVIDERS:
        raise Err(E_PROVIDER, f"voice_fast_layer is {provider!r}; it must be one of {', '.join(PROVIDERS)}")
    try:
        daily = float(pick("voice_api_daily_usd", 1.0))
    except (TypeError, ValueError):
        daily = 1.0
    return Settings(provider, str(pick("voice_api_model", DEFAULT_MODEL)).strip() or DEFAULT_MODEL, daily)


# ── the key ─────────────────────────────────────────────────────────────────
def _security(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess | None:
    if sys.platform != "darwin":
        return None
    try:
        return subprocess.run(["/usr/bin/security", *args], input=stdin, capture_output=True,
                              text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None


def keychain_key() -> str | None:
    r = _security("find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w")
    return (r.stdout.strip() or None) if r is not None and r.returncode == 0 else None


def find_key() -> tuple[str | None, str]:
    """The key stored for Divan's voice, and where it came from. Never the
    shell's ANTHROPIC_API_KEY, never a chat account's."""
    env = os.environ.get(KEY_ENV, "").strip()
    if env:
        return env, "env"
    k = keychain_key()
    return (k, "keychain") if k else (None, "")


def require_key() -> str:
    key, _ = find_key()
    if not key:
        raise Err(E_KEY, f"The voice fast layer is set to the Anthropic API but no key is stored for it; "
                         f"{SET_KEY_HINT}.")
    return key


def profile_home(resolve_account) -> str | None:
    """The account folder whose notes give the caller's profile, as the CLI
    path uses. Only its notes are read; its credentials never are."""
    try:
        home, _ = resolve_account()
        return home
    except Exception:
        return None


# ── spending ────────────────────────────────────────────────────────────────
class BudgetSpent(Exception):
    pass


class Budget:
    """A daily cap in US dollars, kept in a small ledger beside config.toml.

    Counted from `usage` in the stream, after each request; a request is
    refused once the day's total has reached the cap, so the overshoot is one
    request (a few tenths of a cent)."""

    def __init__(self, daily_usd: float, path=None):
        self.daily_usd = daily_usd
        self.path = path or (CONFIG_DIR / "voice-api-usage.json")

    def _read(self) -> dict:
        today = time.strftime("%Y-%m-%d")
        try:
            d = json.loads(self.path.read_text())
            if d.get("day") == today:
                return d
        except Exception:
            pass
        return {"day": today, "usd": 0.0, "requests": 0, "input_tokens": 0, "output_tokens": 0}

    def spent(self) -> float:
        return float(self._read()["usd"])

    def check(self) -> None:
        if self.spent() >= self.daily_usd:
            raise BudgetSpent(f"today's voice API budget of ${self.daily_usd:.2f} is spent "
                              f"(voice_api_daily_usd in config.toml)")

    def add(self, model: str, input_tokens: int, output_tokens: int) -> float:
        pin, pout = PRICES.get(model, _DEAREST)
        usd = (input_tokens * pin + output_tokens * pout) / 1_000_000
        d = self._read()
        d["usd"] = round(d["usd"] + usd, 6)
        d["requests"] += 1
        d["input_tokens"] += input_tokens
        d["output_tokens"] += output_tokens
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(d))
            tmp.chmod(0o600)
            tmp.replace(self.path)
        except OSError as exc:
            log.warning("voice api: could not write the usage ledger: %s", exc)
        return usd


# ── errors ──────────────────────────────────────────────────────────────────
class ApiError(Exception):
    """A request that did not give an answer. `kind` is what the session and
    the report need: auth, rate_limited, overloaded, billing, bad_request,
    provider, timeout, network, budget. The message never holds the key."""

    def __init__(self, kind: str, message: str, status: int | None = None):
        super().__init__(f"Anthropic API {kind}: {message}")
        self.kind, self.status = kind, status


_KINDS = {"authentication_error": "auth", "permission_error": "auth", "rate_limit_error": "rate_limited",
          "overloaded_error": "overloaded", "billing_error": "billing", "invalid_request_error": "bad_request",
          "not_found_error": "bad_request", "request_too_large": "bad_request", "api_error": "provider"}


def _error(status: int, body: bytes) -> ApiError:
    try:
        e = json.loads(body).get("error") or {}
    except Exception:
        e = {}
    kind = _KINDS.get(e.get("type"), {401: "auth", 403: "auth", 429: "rate_limited", 529: "overloaded",
                                      402: "billing"}.get(status, "provider" if status >= 500 else "bad_request"))
    msg = str(e.get("message") or f"HTTP {status}")[:160]
    if kind == "auth":
        msg += f"; the stored key was refused, {SET_KEY_HINT}"
    return ApiError(kind, msg, status)


# ── the tools, as the API takes them ────────────────────────────────────────
_OBJ = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}  # noqa: E731
CHAT_TOOLS = [
    {"name": "forward_to_chat", "description": "Send what the caller just said to this chat, as an instruction.",
     "input_schema": _OBJ({})},
    {"name": "answer_approval", "description": "Answer the approval this chat is waiting on.",
     "input_schema": _OBJ({"allow": {"type": "boolean", "description": "true to allow, false to deny"}}, ["allow"])},
    {"name": "stop_chat", "description": "Stop what this chat is doing right now.", "input_schema": _OBJ({})},
]
_SESSION = {"type": "integer", "description": "the session's number in the snapshot"}
CALL_TOOLS = [
    {"name": "send_message", "description": "Send an instruction to a session that already exists. "
                                            "Use the number it has in the snapshot.",
     "input_schema": _OBJ({"session": _SESSION, "text": {"type": "string", "description":
                           "what to tell it to do, in the user's own words"}}, ["session", "text"])},
    {"name": "start_work", "description": "Start a new session in a project and give it its first instruction.",
     "input_schema": _OBJ({"project": {"type": "string", "description": "project folder name, e.g. 'focus'"},
                           "instruction": {"type": "string", "description": "what it should do"}},
                          ["project", "instruction"])},
    {"name": "answer_approval", "description": "Answer an approval a session is waiting on. Refused for "
                                               "anything destructive — those are done in the app.",
     "input_schema": _OBJ({"session": _SESSION, "allow": {"type": "boolean", "description":
                           "true to allow, false to deny"}}, ["session", "allow"])},
    {"name": "stop_session", "description": "Stop what a session is doing right now.",
     "input_schema": _OBJ({"session": _SESSION}, ["session"])},
]


def intent_for(name: str, args: dict, index: list[str], chat_call: bool) -> tuple[tuple[str, dict] | None, str]:
    """A tool call as the intent the session will execute at its commit (the
    same verbs `voice.chat_tools` and `voice.deferred_actions` record), and the
    tool result to give the model next turn. Nothing is done here."""
    if chat_call:
        if name == "forward_to_chat":
            return ("forward", {}), "noted; it is sent once the caller has finished speaking"
        if name == "answer_approval":
            return ("approve_chat", {"allow": bool(args.get("allow"))}), "noted"
        if name == "stop_chat":
            return ("stop_chat", {}), "noted"
        return None, f"there is no tool {name}"
    if name == "start_work":
        return ("start", {"project": str(args.get("project", "")),
                          "instruction": str(args.get("instruction", ""))}), "noted"
    try:
        n = int(args.get("session"))
        if n < 1 or n > len(index):
            raise ValueError
        cid = index[n - 1]
    except (TypeError, ValueError):
        return None, f"there is no session {args.get('session')}; the snapshot lists {len(index)}"
    if name == "send_message":
        return ("send", {"chat_id": cid, "text": str(args.get("text", ""))}), "noted"
    if name == "answer_approval":
        return ("approve", {"chat_id": cid, "allow": bool(args.get("allow"))}), "noted"
    if name == "stop_session":
        return ("stop", {"chat_id": cid}), "noted"
    return None, f"there is no tool {name}"


# ── the fast layer ──────────────────────────────────────────────────────────
class ApiFastLayer:
    """`Brain` over the Messages API: one streaming request per question.

    No lock is held across the stream: every reply and every `cancel` bumps a
    generation number, and a stream whose number is no longer current stops
    giving text at once — a late chunk of a cancelled turn is dropped here,
    before the session's own turn-id rule would drop it again. The history
    keeps only finished exchanges, without their state blocks, so a cancelled
    reply leaves nothing behind and the prompt stays small."""

    def __init__(self, snapshot_fn, key: str, model: str = DEFAULT_MODEL, chat_id: str | None = None,
                 home: str | None = None, budget: Budget | None = None,
                 transport: httpx.AsyncBaseTransport | None = None, base_url: str | None = None):
        self._snapshot = snapshot_fn
        self._key = key
        self.model = model
        self.chat_id = chat_id
        self.system, self._hermes = voice.voice_system(home, bool(chat_id))
        self.tools = CHAT_TOOLS if chat_id else CALL_TOOLS
        self.budget = budget
        self._transport = transport
        self._base_url = base_url or API_URL
        self._client: httpx.AsyncClient | None = None
        self._index: list[str] = []
        self.history: list[dict] = []
        self._results: list[dict] = []      # tool results owed to the model, sent with the next question
        self._gen = 0
        self._response: httpx.Response | None = None
        self._cooldown_until = 0.0
        self._refused: ApiError | None = None   # the key was refused: no more requests this call
        self.timing: dict = {}
        self.requests = 0                    # paid requests sent (warm-up is not one)
        self.usage = {"input_tokens": 0, "output_tokens": 0, "usd": 0.0}

    def __repr__(self) -> str:               # never the key
        return f"ApiFastLayer(model={self.model!r}, chat={bool(self.chat_id)})"

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            kw: dict[str, Any] = {"transport": self._transport} if self._transport else {"http2": True}
            self._client = httpx.AsyncClient(
                base_url=self._base_url, timeout=httpx.Timeout(READ_S, connect=CONNECT_S),
                headers={"x-api-key": self._key, "anthropic-version": API_VERSION,
                         "content-type": "application/json"}, **kw)
        return self._client

    async def warm(self) -> None:
        """Open the connection (TLS, HTTP/2) and check the key while the phone
        greets the caller, with a model lookup: the Models API is not billed."""
        try:
            r = await self._http().get(f"/v1/models/{self.model}")
            if r.status_code != 200:
                log.warning("voice api: warm-up got %s", _error(r.status_code, r.content))
        except Exception as exc:
            log.warning("voice api: could not warm up: %s", type(exc).__name__)

    async def cancel(self) -> None:
        self._gen += 1
        r, self._response = self._response, None
        if r is not None:
            try:
                await r.aclose()
            except Exception:
                pass

    async def close(self) -> None:
        await self.cancel()
        c, self._client = self._client, None
        if c is not None:
            await c.aclose()

    def _prune(self) -> None:
        keep = self.history[-2 * HISTORY_TURNS:]
        if keep and keep[0]["role"] == "user" and isinstance(keep[0]["content"], list):
            # Its tool results answer a tool call that was pruned away.
            content = [b for b in keep[0]["content"] if b.get("type") != "tool_result"]
            keep[0] = {"role": "user", "content": content}
        self.history = keep

    def body(self, prompt: str) -> dict:
        question = {"role": "user", "content": [*self._results, {"type": "text", "text": prompt}]}
        return {"model": self.model, "max_tokens": MAX_TOKENS, "stream": True, "system": self.system,
                "tools": self.tools, "thinking": {"type": "disabled"},
                "messages": [*self.history, question]}

    async def reply(self, text: str, lang: str, intend: Callable[[str, dict], None]) -> AsyncIterator[str]:
        t0 = time.monotonic()
        self.timing = timing = {}
        await self.cancel()                  # a previous stream still open is stale now
        self._gen += 1
        gen = self._gen
        if self._refused is not None:
            raise self._refused
        now = time.monotonic()
        if now < self._cooldown_until:
            raise ApiError("rate_limited", f"waiting {self._cooldown_until - now:.0f} s more as the API asked")
        if self.budget is not None:
            try:
                self.budget.check()
            except BudgetSpent as exc:
                raise ApiError("budget", str(exc)) from None
        snap, self._index = self._snapshot()
        chat_call = bool(self.chat_id)
        body = self.body(voice.turn_prompt(snap, text, lang, chat_call))
        history_q = {"role": "user", "content": [*self._results,
                                                 {"type": "text", "text": voice.turn_prompt(None, text, lang, chat_call)}]}
        said: list[str] = []
        blocks: list[dict] = []
        results: list[dict] = []
        tool: dict | None = None
        usage = {"input_tokens": 0, "output_tokens": 0}
        finished = False
        self.requests += 1
        try:
            async with self._http().stream("POST", "/v1/messages", json=body) as r:
                self._response = r
                timing["status_ms"] = int((time.monotonic() - t0) * 1000)
                if r.status_code != 200:
                    err = _error(r.status_code, await r.aread())
                    if err.kind in ("auth", "billing"):
                        self._refused = err
                    if err.kind == "rate_limited":
                        try:
                            wait = float(r.headers.get("retry-after") or 10)
                        except ValueError:
                            wait = 10.0
                        self._cooldown_until = time.monotonic() + min(max(wait, 1.0), COOLDOWN_MAX_S)
                    raise err
                async for line in r.aiter_lines():
                    if gen != self._gen:
                        return               # cancelled: whatever is still on its way is dropped
                    if not line.startswith("data:"):
                        continue
                    try:
                        ev = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    kind = ev.get("type")
                    if kind == "message_start":
                        u = (ev.get("message") or {}).get("usage") or {}
                        usage["input_tokens"] = sum(int(u.get(k) or 0) for k in
                                                    ("input_tokens", "cache_creation_input_tokens",
                                                     "cache_read_input_tokens"))
                        usage["output_tokens"] = int(u.get("output_tokens") or 0)
                    elif kind == "content_block_start":
                        cb = ev.get("content_block") or {}
                        if cb.get("type") == "tool_use":
                            tool = {"id": cb.get("id"), "name": cb.get("name"), "json": ""}
                        elif cb.get("type") == "text" and said:
                            said.append(" ")
                            yield " "        # two text blocks are two sentences
                    elif kind == "content_block_delta":
                        d = ev.get("delta") or {}
                        if d.get("type") == "text_delta" and d.get("text"):
                            timing.setdefault("first_token_ms", int((time.monotonic() - t0) * 1000))
                            said.append(d["text"])
                            yield d["text"]
                        elif d.get("type") == "input_json_delta" and tool is not None:
                            tool["json"] += d.get("partial_json") or ""
                    elif kind == "content_block_stop" and tool is not None:
                        try:
                            args = json.loads(tool["json"]) if tool["json"].strip() else {}
                        except ValueError:
                            args = {}
                        intent, result = intent_for(tool["name"], args, self._index, chat_call)
                        timing.setdefault("first_token_ms", int((time.monotonic() - t0) * 1000))
                        if intent is not None:
                            intend(*intent)
                        blocks.append({"type": "tool_use", "id": tool["id"], "name": tool["name"], "input": args})
                        results.append({"type": "tool_result", "tool_use_id": tool["id"], "content": result})
                        tool = None
                    elif kind == "message_delta":
                        u = ev.get("usage") or {}
                        if u.get("output_tokens") is not None:
                            usage["output_tokens"] = int(u["output_tokens"])    # cumulative
                    elif kind == "message_stop":
                        finished = True
                        break
                    elif kind == "error":
                        e = ev.get("error") or {}
                        raise ApiError(_KINDS.get(e.get("type"), "provider"), str(e.get("message") or "")[:160])
                if not finished and gen == self._gen:
                    raise ApiError("provider", "the stream ended before message_stop")
        except httpx.TimeoutException:
            raise ApiError("timeout", f"no data for {READ_S:.0f} s") from None
        except httpx.StreamClosed:
            return                           # closed by cancel()
        except httpx.TransportError as exc:
            if gen != self._gen:
                return
            raise ApiError("network", type(exc).__name__) from None
        except GeneratorExit:
            # The session has heard enough and closed the stream: what was said
            # stands, so the exchange is kept as far as it went.
            finished = True
            raise
        finally:
            if self._response is not None and gen == self._gen:
                self._response = None
            if usage["input_tokens"] or usage["output_tokens"]:
                self._count(usage)
            timing["total_ms"] = int((time.monotonic() - t0) * 1000)
            if finished and gen == self._gen:
                text_out = "".join(said).strip()
                answer = ([{"type": "text", "text": text_out}] if text_out else []) + blocks
                if answer:
                    self.history += [history_q, {"role": "assistant", "content": answer}]
                    self._results = results
                    self._prune()

    def _count(self, usage: dict) -> None:
        self.usage["input_tokens"] += usage["input_tokens"]
        self.usage["output_tokens"] += usage["output_tokens"]
        if self.budget is not None:
            self.usage["usd"] += self.budget.add(self.model, usage["input_tokens"], usage["output_tokens"])
        else:
            pin, pout = PRICES.get(self.model, _DEAREST)
            self.usage["usd"] += (usage["input_tokens"] * pin + usage["output_tokens"] * pout) / 1_000_000


# ── setting it up ───────────────────────────────────────────────────────────
def _status() -> int:
    s = settings()
    key, where = find_key()
    print(f"fast layer: {s.provider}" + (" (subscription, no API calls)" if s.provider == CLI else ""))
    print(f"api model:  {s.model}")
    print(f"daily cap:  ${s.daily_usd:.2f}, spent today ${Budget(s.daily_usd).spent():.4f}")
    print(f"api key:    {'stored (' + where + ')' if key else 'none'}")
    if s.provider == API and not key:
        print(f"the call will refuse to start: {SET_KEY_HINT}")
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    """`python -m remote_ai_chat.voice_api status | set-key | delete-key`.

    set-key reads the key from the terminal without echoing it (or from stdin
    when piped) and writes it to the login keychain, handed to `security` on
    stdin so it is never on a command line. Nothing is printed back."""
    args = argv if argv is not None else sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "status":
        return _status()
    if cmd == "set-key":
        key = (getpass.getpass("Anthropic API key for Divan's voice: ") if sys.stdin.isatty()
               else sys.stdin.readline()).strip()
        if not key.startswith("sk-ant-"):
            print("that does not look like an Anthropic API key (sk-ant-...); nothing stored")
            return 2
        line = (f"add-generic-password -U -a {KEYCHAIN_ACCOUNT} -s {KEYCHAIN_SERVICE} "
                f"-l {KEYCHAIN_SERVICE} -X {key.encode().hex()}\n")
        r = _security("-i", stdin=line)
        if r is None or r.returncode != 0:
            print(f"the keychain did not take it; on other systems set {KEY_ENV} for the daemon")
            return 1
        print(f"stored in the keychain as {KEYCHAIN_SERVICE}. To use it set voice_fast_layer = \"{API}\" "
              f"in {CONFIG_PATH}")
        return 0
    if cmd == "delete-key":
        r = _security("delete-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE)
        print("deleted" if r is not None and r.returncode == 0 else "there was none")
        return 0
    print(main.__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
