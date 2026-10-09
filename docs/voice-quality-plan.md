# Live voice: the plan

Built on the measurements in [voice-quality-baseline.md](voice-quality-baseline.md). This document
picks the architecture, defines the protocol, who owns a turn and how it is cancelled, how voice
reaches the real agents, which voice speaks, and what each of the next three tickets delivers.

## 1. Options compared

| | **A. Today's local half-duplex** | **B. Streaming cascade, daemon-owned turns** (selected) | **C. Realtime speech-to-speech** (OpenAI Realtime or Gemini Live) |
|---|---|---|---|
| How | Phone recognises, sends text after an 800 ms gap, waits for a whole answer, phone speaks | Phone streams mic PCM; daemon runs turn detection, whisper, a streaming fast Claude layer; text clauses stream back; EMA speaks on the phone | Audio streamed to a provider model that hears and speaks; the agent is reached through its function calls |
| Latency, speech end → first audio | ~7–8 s general call (estimated from measured stages); chat call waits for the agent's whole turn (median 48 s) | **Measured on the Mac: 3.57 s median, 4.37 s p95** (`proof.json`); projection after §5 work: 2.0–2.5 s median | Not measured: no credential (§6). Docs: OpenAI server VAD example 500 ms silence; Gemini default end-of-speech silence ≈ 800 ms; first audio after that is the provider's model latency |
| Turkish recognition (fixtures) | Apple on-device dictation 16.4% WER, 50–73% on names; phone server mode unmeasured | whisper turbo + vocabulary 3.9%, whisper small + vocabulary 7.0% | Not measured. Gemini's Live guide lists Turkish among its languages; the OpenAI realtime pages read for this list no languages |
| Turn taking | Cuts 5–10 of 13 speech fixtures early per pass (§3A) | 13/13 correct in each of three replay passes, silence stays silent, pause/correction cancels the early reply | Server VAD or OpenAI `semantic_vad` (eagerness low/medium/high); Gemini automatic activity detection with configurable silence |
| Interruption | None (a tap) | Phone-side detection over echo: 162 ms on the bench; daemon cancels by turn id | Built in: OpenAI cancels on `speech_started`, client truncates (`conversation.item.truncate`, automatic over WebRTC); Gemini sends `interrupted` and discards the generation |
| Voice quality | EMA (intelligible: 4.8% read-back WER) with fallback to the compact system voice mid-call | EMA only for Turkish, short first clause, no mid-call voice switch | Provider's native voices; likely the most natural, but unverified here |
| Platform | Works today | iOS: AVAudioEngine with voice processing (AEC) and a PCM stream on the existing WebSocket; Mac: mlx-whisper (already a dependency) | iOS WebRTC or WebSocket client; an ephemeral token minted by the daemon. OpenAI session cap 60 min; Gemini audio-only session cap 15 min |
| Cost | Subscription turns only | Subscription turns only (Haiku via Claude Code); $0 new spend | OpenAI `gpt-realtime-2.1`: $32 / $64 per 1M audio tokens in/out; `-mini`: $10 / $20. Gemini Live paid tier: $3 / $12 per 1M audio tokens ($0.005 / $0.018 per minute) |
| Data flow | Speech to Apple (server recognition); text to the Mac; text to Anthropic | Speech to **the owner's own Mac** over the existing socket (LAN, or the Cloudflare tunnel which terminates TLS at Cloudflare as it already does for text); text to Anthropic | Raw voice to a new third party |
| Owner conditions | — | Keeps "the voice model runs on the phone" (decided 2026-10-06) | Breaks it: the voice comes from the provider |

Prices and capabilities were read from the providers' own pages on 2026-10-09:
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[OpenAI turn detection](https://developers.openai.com/api/docs/guides/realtime-vad),
[OpenAI realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations),
[Gemini Live API](https://ai.google.dev/gemini-api/docs/live),
[Gemini Live guide](https://ai.google.dev/gemini-api/docs/live-guide),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Apple's `SpeechTranscriber` (the
new iOS/macOS 26 speech API) does not list `tr_TR`. `DictationTranscriber` does, and that is the
engine measured as "Apple on-device dictation" (`apple_stt.swift` prints both lists).

**Decision: B.** It is the only option that can be built and verified with what is already
authorised: the Claude subscription, the Mac's whisper, EMA on the phone. On the bench it fixes the
failure classes that matter most: segmentation (A), the chat call's minute of silence (C), and
recognition through whisper with the vocabulary (B). It keeps the owner's on-phone voice condition. C stays
a drop-in for the "listen + converse + speak" stages behind the same session protocol (§3), so it can
be measured against B the day an API key exists. It is not built speculatively.

## 2. Targets, and the one that is not reachable on B

| Target (ticket) | On B | Evidence |
|---|---|---|
| Median first audible useful response ≤ 1.5 s after the actual end of speech, simple non-tool turns | **Not reachable on the existing stack** | The warm Claude Code CLI alone needs a median of 0.86 s to the first token (p95 1.39 s) and 1.17 s to a first sentence on Haiku with thinking off (`llm.json`). Add a 700 ms turn-end decision, which cannot go lower without cutting Turkish speakers off (§3A of the baseline; providers themselves default to 500–800 ms), and the floor is ≈ 1.9 s before any speech synthesis. Overlapping work (§5) can hide some of it but not 0.4 s plus TTS plus the network. |
| p95 ≤ 3 s | Reachable only with the §5 work, unproven | proof p95 4.37 s before that work |
| **Achievable alternative for B** | **median ≤ 2.5 s, p95 ≤ 3.5 s** from speech end to audible first clause, on the phone, simple non-tool turns | proof stage medians: endpoint 0.70 + STT 0.61 + first token 0.70 + clause 0.21 + EMA 1.15 (E-core); §5 removes most of STT and halves EMA |
| 1.5 s / 3 s | Kept as **the acceptance bar for option C**, if the owner provides a realtime key and accepts its data flow and voice | — |
| Interruption: playback stops ≤ 300 ms after detected speech | Reachable | 162 ms detection over −24 dB echo; sink stop < 1 ms; the phone player's stop must be measured in ticket 150 |
| No cut-off in scripted mid-sentence pauses | Reachable | 13/13 on the replay, 10 early replies correctly cancelled in the proof |
| Turkish WER ≤ 15% on the fixture set | Reachable with whisper on the Mac | 3.9% (turbo) / 7.0% (small) with vocabulary. **Not** with Apple on-device dictation (16.4%), so speech is recognised on the Mac |

Nothing here weakens a target silently. The 1.5 s median is infeasible on B, and the reason is the
CLI's measured first-token time. The achievable number replaces it for B and 151 measures it. The
original number stays the bar for C.

## 3. Protocol: one voice session on the existing WebSocket

The envelope is the app's existing one (`{"id","type","data"}` requests, `{"type":"event",...}`
events). The socket is text-only today (`server.py` uses `receive_text`), so audio travels as
base64 in JSON: 100 ms of 16 kHz mono PCM16 is 3.2 kB raw and about 4.3 kB encoded, ten messages a
second. Binary frames are an optimisation for later, not a requirement.

Requests (phone → daemon):

| type | data | answer |
|---|---|---|
| `voice.start` | `{chat_id?: str, lang: "tr-TR", sample_rate: 16000, client: {build, device}}` | `{session_id, turn_id: 0, greeting?: str}`; a chat call carries `chat_id`, the general call does not |
| `voice.audio` | `{session_id, seq, t_client_ms, pcm_b64}` (100 ms per message; `seq` contiguous) | none (fire and forget); a gap in `seq` is logged and counted |
| `voice.playback` | `{session_id, turn_id, piece, state: "started"\|"done"\|"stopped", played_ms, t_client_ms}` | none |
| `voice.barge` | `{session_id, turn_id, played_ms, t_client_ms}` (phone heard the caller over playback and has already stopped its player) | none |
| `voice.ping` | `{t_client_ms}` | `{t_client_ms, t_server_ms}` (clock offset for the timing report) |
| `voice.stop` | `{session_id}` | `{ok}` |

Events (daemon → phone), every one with `session_id` and `turn_id`:

| event | data |
|---|---|
| `voice.state` | `{state: "listening"\|"hearing"\|"thinking"\|"speaking"\|"working"\|"reconnecting", t_server_ms}` |
| `voice.transcript` | `{text, final: bool}` (partials while hearing; final at commit) |
| `voice.say` | `{piece, text, last: bool, kind: "reply"\|"ack"\|"progress"\|"question"}`: one clause to synthesise and play, in order |
| `voice.cancel` | `{reason: "barge"\|"resumed"\|"superseded"\|"error"}`: drop every queued and playing piece of this `turn_id` |
| `voice.turn` | `{committed_text, routed: "conversation"\|"chat:<id>"\|"new:<id>", t_speech_end_ms}` (the turn is final; this is what went to an agent, if anything) |
| `voice.error` | `{code, retry_in_ms?}`: codes go into `errors.py` and both clients' `ERR_KEYS` as usual |

`PROTOCOL.md` gets a "Voice session" section in the same commit that adds these. The old `call.*`
requests stay until the phone no longer sends them, and they get documented there too.

## 4. Turn ownership and cancellation

- **The daemon owns turns.** It assigns `turn_id`s, runs the rule measured as `bench.Plan`: may
  reply after 700 ms of quiet, 1800 ms if the words trail off on a joining word or a comma, commit at
  2500 ms. It is the only side that decides a turn has ended. The phone never sends a "send now".
- **The phone owns playback.** It plays `voice.say` pieces of the current `turn_id` in order and drops
  any piece whose `turn_id` is older than the newest it has seen. It reports `started` / `done` /
  `stopped` with `played_ms`.
- **Speech that resumes before commit** (`resumed`): the daemon cancels the reply in flight
  (`voice.cancel`), interrupts the Claude turn (measured in the proof: interrupt, then drain that
  turn's tail before the next query) and keeps the same turn growing.
- **Barge-in**: detection is on the phone, because that is where the 300 ms budget can be met. It
  uses the voice-processing input (echo cancelled) with a level threshold above the echo and at least
  120 ms of speech. The phone stops its player first, then sends `voice.barge`. The daemon answers
  `voice.cancel{barge}`, interrupts the model and starts hearing the new turn. Whatever was not played is
  never spoken. If the barge was work-related, the agent sees only the committed new turn.
- **Commit is the only gate to execution.** Nothing reaches an agent (`chat.send`, `start_work`,
  an approval) before commit. A correction inside the commit window ("run the tests, no wait, finish
  the build first") therefore never starts the wrong work. This is the rule the bench's
  `correction-pause` scenario checks.
- **Reconnect**: a dropped socket puts the session in `reconnecting`. The phone resends `voice.start`
  with the old `session_id`, and the daemon resumes it if it is under 30 s old, otherwise it starts
  fresh. Pieces of an unfinished turn are not replayed.

## 5. The conversational layer and the agent bridge

The voice is answered by a **fast conversational layer**. Execution stays with the **real
agents**, exactly as today.

- **Conversational layer**: a warm Claude Code session per call, the concierge's machinery
  (`call.py`'s `Concierge`: account choice, plan fallback, snapshot as `<state>`) with
  `include_partial_messages=True`, Haiku 4.5 and thinking disabled. Text streams out and is cut into
  clauses (`proof.first_clause` rule). Each clause becomes a `voice.say` as soon as it is complete.
  Measured: first token 0.86 s, first sentence 1.17 s median. Sonnet stays the choice for nothing in
  the voice loop: its first sentence is 3 s.
- **It may not claim an action.** `call.py` records why thinking is on today: without it the model
  said "I've sent it a message" with no tool call behind it. On the fast layer the guard moves into
  code. The model's text on a turn that calls an action verb is **discarded**. What is spoken is a
  fixed, truthful line built from the bridge's own result ("Sent to the login screen chat." / "That
  chat isn't running; should I start it?"), and only once the action returned. Completion is only ever
  spoken from a `turn.done` event.
- **Agent bridge**: the existing `Actions` verbs (`send_message`, `start_work`, `answer_approval`,
  `stop_session`) and, on a chat call, `chat.send` into that chat. Same account, same permission
  mode, same approvals: nothing new is given execution authority. On a chat call every committed
  utterance that is a request goes to the chat. An utterance the fast layer can answer from state
  ("is it still running?") does not, so the call no longer waits on the agent to answer a question
  about the agent.
- **Progress while an agent works**: real events only (`tool.use` summarised, `approval.request`
  asked aloud as today, `turn.done` → the spoken form of the reply). At most one progress line per
  20 s, never while the caller is speaking, never the same line twice in a row. The caller can keep
  talking to the fast layer meanwhile.
- **Acknowledgements**: one short, varied line ("OK, looking.") at commit **only** when the answer
  will take longer than ~1.5 s, which in practice means a turn that goes to an agent. No backchannels
  while the caller is talking in this round. On a speaker that needs echo-cancelled full duplex
  to be trustworthy first. Ticket 151 decides whether to add them, with recordings.
- **Latency work the bench points at** (ticket 149):
  1. *Incremental recognition*: transcribe each pause-closed chunk while the caller is still talking,
     so at the end only the tail is left (removes most of the 0.61 s; long utterances took up to
     2.5 s in one pass).
  2. *Speculative reply*: start the conversational query at the 700 ms soft end (already the case) and
     cancel on resumed speech. Do not wait for the commit.
  3. *Short first piece*: the first `voice.say` is the first clause of three or more words, which is
     what the proof did. EMA makes a ~1 s clause in ~0.4 s on one core.
  4. *Whisper small* for the live reply, *turbo* for the committed text an agent receives. Turbo runs
     inside the 2.5 s commit window, so agents get the 3.9% transcript without anyone waiting for it.

## 6. Voice

- **Turkish: EMA on the phone**, as the owner decided on 2026-10-06. It is intelligible (4.8% WER read
  back by whisper over 22 synthesised clauses). Two changes in ticket 150: the first piece is a
  clause, not a sentence, and **no mid-call switch to the system voice**. If EMA cannot run, the whole
  call uses the system voice and the screen says so. Naturalness has to be judged by ear in ticket 151;
  the WAVs from the proof are the first sample.
- **Spoken Turkish, not translated English**: the fast layer's prompt asks for spoken Turkish and the
  product's own names as they are said aloud. The measured answers mix English chat titles into
  Turkish sentences ("login screen error testi"), which reads badly. The snapshot can carry a spoken
  title per chat.
- **English**: the system voice, as today.
- **Option C's voices** would replace EMA. That needs the owner's yes on two things: a provider key
  (no OpenAI or Gemini API key is configured; the Codex and Claude subscriptions do not include
  realtime APIs; keys that were pasted into chats and scrubbed into the keychain are not authorised
  for this and were not used), and sending raw voice to that provider. Estimated cost at the listed
  prices: Gemini Live ≈ $0.023 per call minute (in + out); OpenAI mini roughly $0.02–0.05 per minute,
  flagship 3× that (third-party estimates; OpenAI lists per-token prices only).

## 7. Delivery: the next three tickets

Each is about three hours. Each ends with its own tests passing and leaves the live daemon running.
Updates reach the Macs only through the merge and the daemon's own updater (`updater.py` pulls
`origin/main` and asks launchd to restart it); no worker restarts a daemon by hand.

**#149: daemon: streaming voice session** — done; results in [voice-session.md](voice-session.md), the medkit comparison in §8 (`daemon/divan/voice.py`, `server.py` handlers,
`PROTOCOL.md`)
- `VoiceSession`: audio ring buffer, energy VAD (the bench's `speech_spans` thresholds), the `Plan`
  rule, incremental whisper (small for replies, turbo at commit), turn ids, the events of §3.
- Conversational layer as §5 (Concierge with streaming, Haiku, thinking off), clause streaming,
  `interrupt` + drain on cancel, the action guard.
- Bridge: commit-gated `Actions` / `chat.send`; progress from real events; one ack at commit for agent
  turns.
- Tests: replay `scenarios.json` fixtures through a real `voice.start`/`voice.audio` socket on an
  isolated daemon (`DIVAN_HOME=/tmp/... DIVAN_PORT=8791`). Assert one committed turn per speech scenario,
  none for silence, no `voice.say` of an old `turn_id` after `voice.barge` or resumed speech, a task
  request reaching the right chat exactly once, and an approval still answerable. Use a fake model for
  CI and one real run with timings written next to `proof.json`.
- Out of scope: the phone, binary frames, option C.

**#150: iPhone: full-duplex call screen** — built; what it does, its tests and what is not yet
verified on a device are in [voice-phone.md](voice-phone.md) (`app/modules/call` Swift,
`app/src/voice-session.ts`, `app/src/live-call.ts`, `app/app/call.tsx`)
- Native: an `AVAudioEngine` input with voice processing (echo cancellation) on the existing
  `playAndRecord` / `voiceChat` session, 16 kHz PCM out to JS (or straight to the socket) every
  100 ms; a local barge detector (threshold above the echo, 120 ms); an EMA player that stops and
  flushes on command and reports `played_ms`.
- JS: the `voice.*` client, playback by `turn_id`, states from `voice.state`, `voice.ping` clock
  offset, playback timestamps. The SFSpeechRecognizer loop, `SILENCE_MS`, `AFTER_SPEECH_MS` and
  `BARGE_IN` go away for the call. Dictation elsewhere is untouched.
- Tests: the existing `app/scripts/test-call-chat.cjs` / `test-ema.cjs` style for the state machine,
  with fakes for the socket and player; a device run if the phone is reachable.
- Build and install through the existing runbook (local Release build, `xcrun devicectl device install
  app`), only if the phone is reachable; otherwise the build stays at a stable path.

**#151: measure and tune end to end** — done in the laboratory; results, the remaining gap and the
phone's open half are in [voice-quality-results.md](voice-quality-results.md)
- Rerun the bench against the integrated build with at least 20 Turkish utterances. Report median and
  p95 speech-end → audible first clause (from `voice.playback started` and the clock offset), barge
  stop time on the device, WER, and cut-offs on the pause scenarios. Compare against
  `baseline.json` / `proof.json` and against §2's targets (B's achievable 2.5 s / 3.5 s; 300 ms;
  ≤ 15%; zero cut-offs).
- Tune `Plan` thresholds, clause length, ack wording and frequency by listening to recordings; add
  backchannels only if they never land on the caller's speech.
- `docs/voice-quality-results.md` with before/after numbers and artifact paths.
- If the owner has provided a realtime key by then, a bounded C spike behind the same protocol is
  a separate ticket, not part of 151.

## 8. After #149: the daemon measured, and medkit's live voice as the reference

#149 built the daemon half (`docs/voice-session.md`). On the bench fixtures with
real whisper and real Haiku it commits every Turkish utterance once and whole
across thinking pauses (22/22), stays silent on silence, cancels a reply when
speech resumes, recognises at 2.7% WER for agents and 4.9% for the reply, and
gets its first text piece out **1.90 s** after speech end in the best run and
**3.45 s** in the committed one. Every stage except one is inside the budget.
The one outside it is the fast layer's first token through the Claude Code CLI:
0.72 s in the best run and 1.35–2.03 s median (6 s p95) in others, from the same
code on the same morning.

The owner pointed at medkit's live voice as the quality reference. It was read
on 2026-10-09 (read-only: `apps/voice-worker/voice_agent.py`, `providers.py`,
`apps/frontend/src/voice/conversation.ts`, `apps/backend/server.py`'s
`/voice/token`, `docker-compose.yml`). The entry skill still describes the stack
correctly, with one addition: the worker's LLM can now go through a LiteLLM
gateway and falls back to the Anthropic plugin directly.

### 8.1 Side by side

| | medkit (working, high quality) | Divan after #149 |
|---|---|---|
| Transport | **WebRTC** through a self-hosted LiveKit server (Docker, plus egress for recordings); the browser joins a room with `livekit-client` (`adaptiveStream`, `dynacast`); the API mints a short-lived room token (`/voice/token`) | The daemon's existing authenticated **WebSocket**, PCM16 base64 in JSON, 100 ms messages; pairing token, LAN/Tailscale or the Cloudflare tunnel |
| Echo | The browser's WebRTC capture (echo cancellation in the audio stack) | The phone's voice-processing input (#150), the same kind of canceller |
| Endpointing / VAD | `livekit-agents` `AgentSession` with Silero VAD; its turn detector decides | Level detector + the measured `Plan` rule (0.7 s / 1.8 s after a joining word / 2.5 s commit), in the daemon |
| Turn ownership | The worker's `AgentSession` | The daemon's `VoiceSession`, by turn id |
| Recognition | Deepgram Nova-3 streaming (cloud, `tr`), partials while speaking; faster-whisper behind a Silero `StreamAdapter` in the local profile | whisper small eagerly at 0.3 s pauses, turbo at commit, on the Mac; partials at pauses |
| LLM | **Haiku 4.5 through the Anthropic Messages API directly** (the `livekit.plugins.anthropic` streaming plugin, an API key), temperature 0.8; history pruned to a fixed number of items | Haiku 4.5 through the **Claude Code CLI** on a subscription account (no API key), via the SDK, thinking off, streaming partial messages |
| TTS | Cartesia sonic-3 for Turkish, a **fallback chain** to ElevenLabs (a sunset model once silenced every patient), Piper locally; per-locale voice tables | EMA on the phone; whole call on the system voice if EMA cannot run |
| Interruption | `turn_handling={"interruption": {"mode": "vad"}}` — local VAD, because LiveKit's adaptive interruption is a cloud service unavailable in some regions; `session.interrupt()` | Phone-side barge detection → `voice.barge` → `voice.cancel{barge}`; the daemon also detects over the echo while the phone reports playing |
| Interrupted answer | `commitInterruptedAgentTurn`: the part of the patient's line that was spoken is saved into the thread before the next reply overwrites it | The unplayed rest is never spoken; the fast layer's own history still holds the whole reply (the CLI has no truncate) |
| First line | **`client_ready` RPC**: the worker waits (3 s cap) until the browser's audio element is actually playing, because a line produced into an unsubscribed track is later played back time-compressed | No greeting is spoken by the daemon yet |
| Goodbye | `farewell` RPC: interrupt, say a fixed line non-interruptibly, resolve when played out, then tear down | `voice.stop` |
| Reconnect | On an unexpected disconnect, re-init with **three retries, then text-only mode**; duplicate finals de-duplicated by segment id | `voice.start {session_id}` resumes within 30 s under a new turn id; nothing replayed |
| Observability | Per-stage latency (STT/LLM/TTS) per locale into Prometheus; usage per turn | Per-turn stage timings in `voice.stop`, the bench report |

### 8.2 What medkit's quality actually rests on, and what is reusable

The speed medkit has comes from two things Divan does not have today: an LLM
reached **directly over the API** (no CLI process, warm HTTP connection; this is
exactly the stage #149 found over budget) and **cloud streaming STT/TTS** (Deepgram
and Cartesia keys belong to medkit's own accounts and are not authorised for
Divan). The WebRTC transport is the third difference; it matters on bad networks
(jitter buffer, Opus, packet loss) more than on the LAN the bench ran on.

Reused now, as protocol and state patterns (no medkit code or secret is copied;
its stack is Python + browser and Divan's is Python + Swift):

1. **`voice.ready` before the first spoken line (from `client_ready`)** — in the protocol since #149; #150
   sends it once its EMA player has produced audible output (or after a 3 s cap);
   the daemon must not speak a greeting before it. Until then the protocol's
   `voice.playback started` serves as the same signal for every later piece.
2. **Local VAD interruption, not a cloud service** — already the design; medkit
   took the same turn for availability, and it is what keeps barge-in inside 300 ms.
3. **Save what was actually spoken of an interrupted answer** — `voice.barge`
   already carries `played_ms`; #150 reports it and #151 decides whether the
   fast layer is told what the caller heard (on the CLI that is one line in the
   next prompt, since there is no truncate).
4. **Three reconnect attempts, then fall back to the chat as text** — #150's
   client policy on top of the daemon's 30 s resume.
5. **A voice fallback chain** — EMA → the system voice for the whole call, as
   §6 says; never silence because one engine failed.
6. **Per-stage latency per call** — `voice.stop` returns it; #151 reports it.
7. **A non-interruptible goodbye** — `voice.stop` gets an optional spoken
   farewell in #150 if the screen needs one.

Not reused now, and why:

- **LiveKit/WebRTC transport.** The self-hosted server runs free on the Mac and
  has an iOS SDK, but a WebRTC media path needs UDP: it works over Tailscale and
  on the LAN, not through the Cloudflare tunnel that is Divan's remote door
  without adding a TURN server. It would also add a second auth (room tokens)
  next to pairing. The WebSocket session keeps one door and one auth; the
  protocol is transport-independent above `voice.audio`, so if #151 measures
  jitter or loss on a phone network, a LiveKit transport behind the same turn
  logic is a bounded follow-up ticket (Tailscale only).
- **Deepgram / Cartesia / ElevenLabs.** New paid accounts for Divan; not
  authorised. Local whisper already beats the WER target.

### 8.3 The quality goal stays, and what reaching it needs

The original targets (1.5 s median / 3 s p95 to audible first clause) are not
dropped. On #149's numbers the floor of the current path is 0.7 s (turn rule) +
0.2 s (recognition) + **first token** + 0.2 s (clause) + EMA + playback. With the
first token at medkit's direct-API level (≈ 0.4–0.7 s) the daemon share is
≈ 1.5–1.8 s and the B target (2.5 s / 3.5 s audible) is met with margin; 1.5 s
audible still needs speech-to-speech (option C) or a turn rule that commits
earlier, which the baseline says Turkish pauses do not allow.

The fast layer is one class behind the `Brain` interface in `voice.py`, so
putting it on the Messages API directly (medkit's arrangement) is a contained
change: the same prompt, tools-as-intents, guard and commit gate; execution
still only through Divan's Claude/Codex chats and their permission modes. It
needs **one owner decision**: an Anthropic API key for Divan's voice layer
(Haiku 4.5, a few hundred tokens per turn; billed per token, unlike the
subscription), or a realtime provider key for option C. medkit's key is not
used for this: it is medkit's, and the ticket forbids moving credentials.
Without that decision #151 measures the CLI path as it is and reports the
first-token spread above as the remaining gap.
