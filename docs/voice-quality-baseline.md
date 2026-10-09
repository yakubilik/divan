# Live voice: where the call is today, measured

The complaint, from the owner's own description: the phone conversation **cuts off while he is still
speaking**, **misses words**, and **takes about a minute to answer**. The voice should feel like a
person on a live line, with short acknowledgements where they fit and good Turkish speech.

This document maps the live call as it is on `main` (commit `f4c385d`), separates it from voice
notes, and puts a number or a bounded hypothesis on each failure class. The measurements come from
the replayable bench in [`daemon/scripts/voice_bench/`](../daemon/scripts/voice_bench/), and the raw
results are under [`docs/voice-bench/`](voice-bench/). How to rerun all of it is at the end. What to
build next is in [voice-quality-plan.md](voice-quality-plan.md).

## 1. Two different voice paths

| | **Live call** (this ticket) | **Voice note / dictation** (not this ticket) |
|---|---|---|
| Entry | `app/app/call.tsx` (call button on the chat list = general call; call button inside a chat = chat call). Incoming rings through CallKit (`app/modules/call`, `app/src/incoming-call.ts`, `daemon/remote_ai_chat/voip.py`). | Record button in `app/app/chat/[id].tsx` (`expo-audio` recorder), or panel dictation |
| Speech to text | **On the phone**: `@jamsch/expo-speech-recognition` → iOS `SFSpeechRecognizer`, `continuous`, `interimResults`, `requiresOnDeviceRecognition: false` (Apple's servers), `contextualStrings` with 11 product words (`app/src/voice.ts`) | **On the Mac**: `POST /upload` stores the m4a, then `transcribe.transcribe()` runs mlx-whisper large-v3-turbo (`daemon/remote_ai_chat/transcribe.py`); dictation is `POST /dictate` with 16 kHz PCM → `transcribe.pcm()` |
| What crosses the network | Text only, on the app's existing WebSocket | The whole recording, uploaded after it ends |
| Turn end | App timer: 800 ms after the last recogniser result (`SILENCE_MS`) | The person presses stop |
| Answer | General call: `call.ask` → `Concierge` (`daemon/remote_ai_chat/call.py`), a warm Claude Code session (Sonnet, no built-in tools, four action verbs over in-process MCP), **not streamed** (`include_partial_messages=False`). Chat call: `chat.send` into that chat's real agent, wait for `chat.updated status=idle`, then `call.reply` returns the trimmed last reply (`spoken_reply`, 260 chars) | The transcript becomes a normal chat message |
| Speech out | On the phone: EMA Lightning ONNX for Turkish (`app/src/ema.ts`, `app/src/tts/*`), first piece must sound within 1.5 s or the system voice (`expo-speech`) reads that answer | — |
| Duplex | **Half duplex**: `BARGE_IN = false`; the mic is stopped before speaking and reopened `AFTER_SPEECH_MS = 600` ms after playback ends; cutting in is a tap | — |

Wire messages a call uses today: `call.hello` (headline from SQLite, starts `Concierge.warm()`),
`call.ask {text, lang}`, `call.reply {chat_id, lang}`, `call.digest`, plus the ordinary `chat.send`,
`approval.respond` and chat events (`tool.use`, `approval.request`, `chat.updated`). None of the
`call.*` requests is documented in [PROTOCOL.md](PROTOCOL.md). That is a gap the daemon ticket
closes when it defines the new protocol.

One utterance on the general call, as the code runs it:

```
ring 2 s + pickup + greeting (phone, offline)  ─ call.hello warms the Claude CLI behind it
listen: SFSpeechRecognizer streams the whole growing transcript as `result` events
  each result re-arms an 800 ms timer → timer fires → stop mic → call.ask
daemon: snapshot from SQLite → Claude turn (Sonnet, thinking at default) → whole text → clip/speakable
phone: speak(answer) → EMA makes sentence 1, plays it, makes the next … → onDone
wait 600 ms → reopen the recogniser → listen
```

A chat call replaces the daemon step with *the agent's whole turn*.

## 2. Bench: scenarios, fixtures, what is and is not measured

`scenarios.json` holds 14 sanitized Turkish scenarios, synthetic text only: two short questions, one
13-second request, thinking pauses of 500, 1000, 1500 and 2000 ms plus one with two pauses (800 +
1200 ms), a self-correction inside one sentence and one across a 900 ms pause, two
technical-vocabulary requests (product and tool names), a barge-in (the caller cuts into an answer
2.5 s in, with that answer's echo at −24 dB under the voice), and 5 s of silence. Each scenario carries
its reference transcript. `make_fixtures.py` speaks them with the Mac's Turkish voice (`say`), trims
each segment and lays the pauses out exactly, so every word-end time is known. The annotated
transcripts, segment times and every recogniser event are in
[`voice-bench/baseline.json`](voice-bench/baseline.json).

| Measured on this Mac | Unavailable here, and why |
|---|---|
| Recogniser result arrival times on the audio clock (Apple on-device Turkish dictation, `DictationTranscriber`, fed in real time) | **The phone's own recogniser** (`SFSpeechRecognizer`, server mode, with `contextualStrings`): a command-line process cannot get Speech Recognition authorisation unattended. The on-device engine is the closest stand-in. |
| Today's turn-end rule replayed over those events (`bench.current_endpointer`) | — |
| WER of Apple dictation and whisper (turbo, turbo-q4, small; with and without the app's vocabulary list) | WER on the owner's real voice. The private recording was used only on-device for pause statistics, never as a fixture. |
| Claude first token / first sentence / whole answer, warm, via the Claude Code CLI on the call's account (`llm_latency.py`) | — |
| EMA synthesis time per piece (one CPU thread) and intelligibility read back by whisper | EMA timing **on the iPhone**, and **audible playback** start. There is no phone in the loop. |
| Real chat-agent turn durations from the daemon's event table (`turn_durations.py`, read-only) | Per-call logs: the daemon logs no call timings. |

Caveats that apply to every number below. The fixtures are synthetic speech, which is cleaner than a
person on a phone. All CPU timings were taken inside the ticket runner, which macOS keeps in the
background band (`ps -o pri` = 4, efficiency cores only), while the live daemon runs at normal
priority (20). Compute-bound stages (EMA, whisper) are therefore upper bounds for the Mac.

## 3. Failure classes

### A. Premature turn end ("it cuts me off", "it misses words")

**Reproduced.** Today's rule ends the turn 800 ms after the last *result event*, not after the last
word. Results arrive in bursts: after a pause the recogniser often sends nothing for well over 800 ms,
even mid-sentence or across an ordinary comma. Once the timer fires, the mic is stopped and the words
that follow are never heard by anyone.

| Run (same fixtures, Apple dictation in real time) | Speech scenarios sent before the speech ended |
|---|---|
| A (first pass, before the bookkeeping fix; JSON not kept) | 9 of 13: long-request, pause-1000/1500/2000, two-pauses, correction, correction-pause, tech-agents, barge-in |
| B ([baseline.json](voice-bench/baseline.json)) | 5 of 13: long-request, pause-1500, pause-2000, two-pauses, barge-in |
| C ([baseline-run2.json](voice-bench/baseline-run2.json)) | 9 of 13: long-request, pause-500/1000/1500/2000, two-pauses, correction-pause, tech-agents, barge-in |
| D ([baseline-run3.json](voice-bench/baseline-run3.json)) | 10 of 13: long-request, pause-500/1000/1500/2000, two-pauses, correction, correction-pause, tech-names, tech-agents |

**Between 5 and 10 of 13 speech scenarios** are cut off in each pass. Every pass cut the long request
and every pause of 1.5 s or more. Speech end to send, when the turn did survive: median 1.2–1.9 s.

Examples from run B: the 13 s request was sent after its first clause, at 4.8 s, because results
stopped for more than 800 ms at a comma, so 21 words were lost. Every pause of 1.5 s or more split the sentence and
dropped its second half. Results trail a word's end by a median of 155–320 ms (`apple_partial_lag_ms`),
but after a pause the first new result arrived up to 4.7 s later. In run B even a two-word
question waited 3.3 s for its first result. The 800 ms timer cannot tell that
silence from the end of a turn.

The owner's own recording shows the pauses this has to survive. A local, on-device whisper pass over
its segment boundaries put most gaps between consecutive phrases at 0.5–1.0 s. Each of those is a cut-off
under the current rule whenever the recogniser is late with the next word. Only the gap statistics
were taken. The audio and its words stay out of the repository.

Two more losses are bounded but not replayed. After every answer the mic stays closed for 600 ms plus
the recogniser's start-up. A caller who answers immediately loses their first word or two, at most
about 0.6 s plus start-up. And because the call is half duplex, anything said while the answer plays is
discarded.

**The proposed rule** (`bench.Plan`: may reply after 700 ms of quiet, waits 1800 ms when the words
trail off on a joining word or comma, commits after 2500 ms, and speech that resumes before the commit
cancels the reply in flight and extends the turn) segments **all 13 speech scenarios as one turn and
the silence as none in all three recorded passes**, on the same recogniser output (`planned` in every
baseline JSON). The barge-in
row is judged by the proof (§4), not here.

### B. Turkish recognition errors

| Recogniser (fixtures, pooled over all speech) | WER | Technical scenarios | Time to text after the utterance |
|---|---|---|---|
| Apple on-device dictation (`DictationTranscriber`, tr_TR) | **16.4%** | 73% and 50% ("TestFlight", "commit" and "Claude" came back as unrelated Turkish words and English names) | streaming; ~0.15–0.3 s behind speech |
| whisper large-v3-turbo, no vocabulary | 7.8% | 27% / 60% | 2.2 s median (M1, background band) |
| whisper large-v3-turbo, app vocabulary as lead-in | **3.9%** | 18% / 20% | 2.2 s |
| whisper large-v3-turbo q4, vocabulary | 5.5% | — | 1.7 s |
| whisper small, vocabulary | 7.0% | — | **0.57 s** median, 1.1 s max |

The phone's recogniser in server mode with the same vocabulary list is **not measured** (see §2). The
bounded hypothesis is that it sits between the two Apple/whisper extremes above. It has the
vocabulary list, but the on-device engine with the same language model family missed exactly those
words. The barge-in fixture shows the other recognition failure: with echo in the mic, Apple dictation
transcribed the answer itself (100% WER against the caller's words). That is the loop
`BARGE_IN = false` was introduced to prevent.

Turkish WER ≤ 15% on this fixture set is met today only by whisper with the vocabulary lead-in. Apple
on-device dictation misses it (16.4%), and badly on names.

### C. Slow response

| Path | What the caller waits through | Measured |
|---|---|---|
| General call | endpoint (800 ms after the last result; run B median **1.9 s** after the speech ended) + Claude turn, not streamed + EMA's first sentence | Sonnet via the CLI, warm, full answer: **3.5 s** median, p95 4.3 s (`llm.json`, `sonnet-default-thinking`). Sonnet with thinking off: 3.1 s. Haiku with thinking off: 1.4 s whole, **1.17 s** to the first sentence. EMA: a 4.4 s sentence takes 2.3 s to make before any of it plays (first-piece RTF ≈ 0.5 on one M1 E-core). **Estimated sum ≈ 7–8 s** from speech end to first audio. |
| Chat call | endpoint + **the agent's entire turn** + `call.reply` + EMA | Real turns, last 14 days, 1355 turns: **median 47.7 s**, p75 134 s, p95 616 s. Turns with no tool: median 9.8 s. (`turn-durations.json`) |

The "about a minute" is the chat call: it is silent until the agent finishes, by design
(`askChat` waits for `chat.updated idle`), and the median agent turn is 48 s. It says "looking"
once at the first tool call and nothing after that. The general call is 7–8 s, mostly because the
answer is neither streamed nor spoken until it is complete, and Sonnet's first sentence via the CLI
takes 3 s.

### D. Low-quality output

Measured or reproduced:

- **Fallback voice.** EMA must make its first sound within 1.5 s (`FIRST_AUDIO_MS`) or the system
  voice reads that answer. On one M1 core a first sentence of 3 s or more already misses that, so long
  first sentences switch voice mid-call. The compact system voice is the "robotic" one.
- **Intelligibility of EMA is good.** 22 first pieces from the proof, read back by whisper turbo:
  pooled WER **4.8%** (`tts-roundtrip.json`). The misses are English product names and digits.
  Naturalness (prosody, warmth) is not something a WER can show, and no listener rating was possible
  here. The WAVs are left in `/tmp/divan-voice-bench/ema/` for listening.
- **The reply is cut, not composed.** The chat call reads `spoken_reply`, the agent's last message
  trimmed to 260 characters, so it can stop mid-thought. The general call clips to about 32 words.

Bounded hypotheses: there are no acknowledgements or backchannels anywhere in the pipeline, so long
waits are dead air. The butler manner and English product names inside Turkish sentences (visible
in the measured answers in `llm.json`) make answers sound unnatural when read by a Turkish voice.

## 4. The proof of the proposed path, measured

`proof.py` runs the selected approach (see the plan) end to end on this Mac against the same fixtures.
Audio is released in 20 ms frames on the wall clock. The online endpointer applies the proposed rule,
whisper small transcribes through the daemon's own `transcribe.pcm` with the vocabulary lead-in, a warm
Claude Haiku session (thinking off, streaming, the call's account) answers, and EMA makes the first
clause as soon as it exists. 22 replies over 11 speech scenarios × 2 rounds, plus silence
([`proof.json`](voice-bench/proof.json)):

| Median after the end of speech | ms |
|---|---|
| reply allowed (endpoint) | 700 |
| transcript ready | 1314 |
| first Claude token | 2013 |
| first clause complete | 2225 |
| **first audio exists on the Mac** | **3566** (p95 4367) |
| first audio audible on the phone | unavailable (no phone): add network and player start |

- Segmentation: every thinking pause and the cross-pause correction **cancelled the early reply and
  answered the whole turn** (10 turns with a cancelled reply). Silence produced **no reply** in either
  round. Pooled WER 4.5%.
- Barge-in: the caller was detected **162 ms** after speaking over a −24 dB echo with a level
  detector set above the echo, with no false trigger before onset, and the playback sink stopped in
  under 1 ms after detection. The phone's own player stop is not measured.
- Cancelling a Claude answer in flight costs nothing in the voice loop itself. The `interrupt` and
  the reading of that turn's tail run in the background, but the next query has to wait for them. That
  wait is inside the measured numbers above and is not separately timed.

It meets none of the latency targets as it stands. It does fix segmentation, silence and barge-in
detection on the bench. The per-stage numbers show where the remaining time goes, and the plan uses
them.

## 5. Reproduce

All commands run from the repository root. `PY` is a venv with the daemon installed plus mlx-whisper
(the daemon's own `.venv312` on this Mac). `TTS_PY` is `tts/.venv` with the exported EMA models
(`tts/verify.sh`). Nothing here talks to the running daemon.

```sh
python3 daemon/scripts/test_voice_bench.py                       # the judgements, no models (also in CI)
python3 daemon/scripts/voice_bench/make_fixtures.py              # → /tmp/divan-voice-bench/fixtures
swiftc -O daemon/scripts/voice_bench/apple_stt.swift -o /tmp/divan-voice-bench/apple_stt
$PY daemon/scripts/voice_bench/run_baseline.py                   # → docs/voice-bench/baseline.json (~3 min)
$PY daemon/scripts/voice_bench/run_baseline.py --no-whisper --out docs/voice-bench/baseline-run2.json
RAC_WHISPER_MODEL=mlx-community/whisper-small-mlx $PY daemon/scripts/voice_bench/run_baseline.py \
    --whisper-only --out docs/voice-bench/whisper-small.json
RAC_WHISPER_MODEL=mlx-community/whisper-large-v3-turbo-q4 $PY daemon/scripts/voice_bench/run_baseline.py \
    --whisper-only --out docs/voice-bench/whisper-turbo-q4.json
$PY daemon/scripts/voice_bench/llm_latency.py --account-home ~/.remote-ai-chat/accounts/<claude-account>
python3 daemon/scripts/voice_bench/turn_durations.py > docs/voice-bench/turn-durations.json
RAC_WHISPER_MODEL=mlx-community/whisper-small-mlx $PY daemon/scripts/voice_bench/proof.py \
    --account-home ~/.remote-ai-chat/accounts/<claude-account>  # ~6 min, → docs/voice-bench/proof.json
$PY daemon/scripts/voice_bench/tts_roundtrip.py                  # → docs/voice-bench/tts-roundtrip.json
```

The Claude runs use the account's subscription through the Claude Code CLI, like the concierge does.
There is no API key and no per-token bill. The baseline and proof runs together spent about 60 short
turns. Recogniser timings vary run to run (§3A), which is why the baseline is kept as several passes.
