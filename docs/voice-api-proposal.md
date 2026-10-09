# The live call's fast layer on the Anthropic Messages API: prepared, not yet measured (#160)

#151 measured live voice end to end and found one stage over budget: the fast layer's first token
through the Claude Code CLI, **1.71 s median / 6.3 s p95**. That made the audible latency **3.55 s
median / 7.5 s p95** against the target of ≤ 1.5 s / ≤ 3 s ([voice-quality-results.md](voice-quality-results.md) §3).
medkit's live voice, the reference, reaches the same kind of model directly over the API
([voice-quality-plan.md](voice-quality-plan.md) §8). This document covers the code that does the same
for Divan, how to turn it on and off, what it costs, what leaves the Mac, and the one decision that has to
come before a real measurement.

**Status in one line.** The code, the configuration, the tests and a free dry run of the bench are done.
**No request has gone to the real API**, so the real API's latency and quality are **unverified**. The
latency target is **not** claimed as met. The phone was not reachable (§8).

## 1. What was built

| Piece | Where | State |
|---|---|---|
| `ApiFastLayer`, a `Brain` on the Messages API (streaming SSE over httpx, HTTP/2, warm connection) | `daemon/remote_ai_chat/voice_api.py` | done, tested offline |
| Selection: `voice_fast_layer = "cli" \| "anthropic-api"`, model, daily cap | `config.toml`, re-read on every call | done, tested |
| Key setup: own keychain item, `status` / `set-key` / `delete-key` | `python -m remote_ai_chat.voice_api …` | done, run by hand (§5) |
| Spending ledger and cap; `retry-after` cooldown; a refused key is not retried | `voice_api.Budget`, `ApiFastLayer` | done, tested |
| Loopback stand-in for the API (real HTTP and SSE, scripted answers and timing) | `daemon/scripts/fake_anthropic.py` | test tool |
| Socket tests over the real voice session | `daemon/scripts/test_voice.py` §6 | pass |
| Bench switch: `--fast-layer anthropic-api`, cap per run, cold first turn reported | `app/scripts/voice-e2e.cjs`, `daemon/scripts/voice_peer.py` | dry run done (§6) |

What stays exactly as it was. Local whisper (small for the reply, turbo at commit). EMA on the phone.
The system prompt (`voice.voice_system`, now shared by both transports). The `<state>` turn prompt
(`voice.turn_prompt`). The guard that drops claimed actions. The rule that routes chat requests. The commit
gate. Cancellation by turn id. Execution only through `_concierge_actions`, with each chat's own account
and permission mode. The API layer's tools record **intents only**, the same verbs as the CLI's
(`intent_for` ↔ `chat_tools` / `deferred_actions`). The session executes them once, after the commit,
or never if the turn was withdrawn. The default remains the CLI path on the subscription.

Differences from the CLI layer, on purpose:

- **One HTTP request per question, no lock held across the stream.** A turn withdrawn before its commit
  (speech resumed, barge-in on an uncommitted reply) has its reply task cancelled by the session. The
  cancellation lands inside the stream's generator, which closes that request's HTTP response, so nothing
  more of it is read or said. Tested: the stand-in sees the connection dropped. The CLI had to *drain* a
  cancelled turn's tail before the next question (#149 measured that wait). Here the next question never
  waits. A **committed** turn's reply is never cut by the next turn: its stream runs on beside it, as on
  the CLI, so a tool call that arrives late is still executed at that turn's commit. That is tested too,
  with a tool call arriving 5 s late while the next turn is already answering. A first draft closed the
  previous stream on every new question and would have lost exactly that call.
- **History without old state blocks.** Only the current question carries `<state>`. Earlier exchanges
  are kept as question/answer text (8 at most, as medkit prunes), so the prompt does not grow with every
  turn. A cancelled reply leaves nothing in the history. A reply the session cut at its word limit keeps
  what was said.
- **After a tool call, no second request.** The model's text after a tool call is discarded by the
  session anyway, so the request ends at the tool call. The tool result ("noted") is sent with the next
  question, as the API requires.
- **The caller's profile notes** (`caller.md` / the account's who-is notes, ≤ 1,500 characters) go into the
  live daemon's system prompt as they do on the CLI path. The bench leaves them out (§6).

## 2. The model: not changed by this ticket

| | `claude-haiku-4-5` (**selected default**) | `claude-haiku-5-5` (candidate) |
|---|---|---|
| Why | The model #151 measured through the CLI. The same model on a new transport isolates the transport's gain | Listed as "fastest" in the current lineup, a newer model |
| Price (input / output per MTok) | $1.00 / $5.00 | $0.10 / $0.50 (prompts ≤ 100k tokens) |
| Thinking | off (`thinking: {type: "disabled"}`) | adaptive by default; whether `disabled` is accepted has to be checked (Models API `capabilities.thinking.types.disabled`) |
| Suitability evidence for Divan | #149/#151: Turkish answers, tool routing (after the routing rule), guard behaviour known | **none**: Turkish voice style, tool calls on intent and false action claims untested |

So the default stays Haiku 4.5. Haiku 5.5 is a second bench run (`--api-model claude-haiku-5-5`), judged
on the same checks and on listening, before anyone changes the default. Sources:
[models overview](https://platform.claude.com/docs/en/about-claude/models/overview) and
[pricing](https://platform.claude.com/docs/en/about-claude/pricing), both read on 2026-10-09.

## 3. Latency: measured vs estimated

| What | Value | Kind |
|---|---|---|
| CLI first token (#151, Haiku 4.5) | 1.71 s median, 6.3 s p95 | **measured** (#151) |
| Audible latency on the CLI path (#151) | 3.55 s median, 7.53 s p95; cold first turn 6.9 s lock | **measured** (#151) |
| Rest of the pipeline with a near-instant fast layer (stand-in API, 0.12–0.22 s first token) | 1.37 s median, 3.41 s p95 audible (n = 7 simple turns), cold first turn 3.71 s | **measured with a stand-in**: the pipeline floor on this Mac, *not* the API (`e2e-api-dryrun.json`) |
| Real API first token, Haiku 4.5 on a warm connection | ≈ 0.4–0.7 s | **estimate** (plan §8.3, medkit's arrangement). Not measured here |
| Audible latency with the real API | ≈ 1.6–1.9 s median | **estimate**: floor + estimated first token. Would beat the plan's option-B bar (2.5 s), likely not 1.5 s |

The estimate is arithmetic, not evidence. The p95 depends on the API's tail, which nothing here
measures. Only the bench in §6 with a real key answers either.

## 4. Cost

Prices (USD per million tokens, [pricing](https://platform.claude.com/docs/en/about-claude/pricing),
2026-10-09): Haiku 4.5 $1 in / $5 out; Haiku 5.5 $0.10 / $0.50. A tool definition also adds the
tool-use system prompt (Haiku 4.5: 496 tokens).

Representative synthetic request (the bench's state, `llm_latency.STATE`; character counts measured from
the request body, tokens estimated at ≈ 3.5–4 characters per token; the exact count needs the
token-counting endpoint, which needs a key):

| Part | Characters | ≈ Tokens |
|---|---|---|
| System prompt (general call; chat call 2,486) | 2,209 | 550–630 |
| Tools JSON (general; chat call 576) + tool-use system prompt | 1,409 | 400 + 496 |
| State + question (`<state>` turn) | 2,061 | 550–600 |
| History (up to 8 question/answer pairs) | — | 0–600 |
| **Input per request** | | **≈ 2,000–2,700 (3,000 assumed)** |
| Output (one or two Turkish sentences, or a tool call) | | **≈ 40–80 (80 assumed)** |

Per request at the assumed 3,000 in / 80 out: Haiku 4.5 **$0.0034**, Haiku 5.5 **$0.00034**.

The bench (`--rounds 2 --barges 3`, 24 measured utterances + the cold turn + silence): its requests are the
24 turns, the early replies cancelled when speech resumes, the cold first turn and the 3 barge-ins with
their cut-ins. The dry run made 20 requests at `--rounds 1`, so a full run is ≈ 40–50. The `--agent` run is
≈ 5 more, plus its Sonnet agent turn on the subscription, as in #151.

| Run | Requests | Haiku 4.5 | Haiku 5.5 |
|---|---|---|---|
| 24-turn bench | ≈ 50 | **≈ $0.17** | ≈ $0.02 |
| agent bench | ≈ 5 | ≈ $0.02 | < $0.01 |
| both models, both benches | | **≈ $0.22 total** | |

**Spending cap proposal.** (1) Per bench run: `--api-cap-usd 0.50` (the default), so a run stops paying at
$0.50 whatever goes wrong. (2) In the live daemon: `voice_api_daily_usd = 1.0` (the default), ≈ 300
turns a day on Haiku 4.5. When it is reached the call says its "can't answer right now" line and the
error names the setting. (3) In the Anthropic Console: a monthly spend limit of **$5** on the
workspace that owns the key. That limit is the provider's own and holds even if the daemon's ledger is
lost. The ledger counts from the API's `usage` figures after each request, so it overshoots by at most one
request. Authorizing **$1** covers the whole comparison above with room for one re-run.

## 5. Configuration, key, rollback

Off by default. Nothing paid happens until **both** of these are true:

```sh
cd ~/projects/remote-ai-chat/daemon
.venv312/bin/python -m remote_ai_chat.voice_api set-key     # paste the key; not echoed, not printed back
# then in ~/.remote-ai-chat/config.toml:
#   voice_fast_layer = "anthropic-api"
#   voice_api_model = "claude-haiku-4-5"
#   voice_api_daily_usd = 1.0
.venv312/bin/python -m remote_ai_chat.voice_api status      # provider, model, cap, spent today, key stored or not
```

- **Where the key lives.** The login keychain, generic password `divan-voice-anthropic` (account
  `remote-ai-chat`). It is handed to `security` on stdin, never on a command line. On another OS use
  the daemon's environment variable `RAC_VOICE_ANTHROPIC_API_KEY`. It is sent only as the `x-api-key`
  header to `api.anthropic.com`, never logged, never in an error, never in `repr`. The test checks the
  socket events do not contain it.
- **What is never used:** the shell's `ANTHROPIC_API_KEY`, chat accounts' credentials, medkit's or any
  other project's keys, keys pasted into chats. A key stored without `voice_fast_layer = "anthropic-api"`
  does nothing (tested).
- **Errors.** API chosen but no key: the call does not start, with error `voice_api_key_missing`: *"…store one
  with `python -m remote_ai_chat.voice_api set-key`, or set voice_fast_layer = "cli" in config.toml to use
  the subscription."* No silent fallback, so nobody believes they are on the API when they are not. An
  unknown provider gives `voice_unknown_fast_layer`. A refused key (401/403) or a billing error: one request,
  then none for the rest of the call, and the message says how to store another. Rate limited (429):
  one request, then it waits as long as `retry-after` says (≤ 60 s). Overloaded, a mid-stream error
  event, or a stall of more than 10 s with no data: one retry, as the CLI path has. Each failing turn is said
  aloud ("Şu an cevap veremiyorum…") and the call goes back to listening. The phone shows the daemon's
  English message for these two new codes (no app translation was added; that needs an app build).
- **Warm-up** is a `GET /v1/models/<model>` while the phone greets. It opens the TLS/HTTP-2 connection and checks
  the key. The Models API is not billed.
- **Rollback**, no restart needed (re-read at every call): `voice_fast_layer = "cli"`, or remove the line.
  Then `python -m remote_ai_chat.voice_api delete-key`, and revoke the key in the Console.

## 6. The benchmark: same fixtures, same clock, and the command that is waiting

`app/scripts/voice-e2e.cjs` is #151's bench, unchanged in what it measures. It uses the same synthetic
Turkish fixtures (Yelda voice, no person's recording), the same full clock from the fixture's true speech
end to the first audible sample out of EMA, a cold first turn (now reported as
`cold_first_turn_true_end_to_audible_ms`), turn-taking across pauses and corrections, silence, 3 barge-ins
on real answers and, with `--agent`, the real task bridge. Its daemon is isolated (own `RAC_HOME`,
loopback port). It answers from that daemon's own synthetic snapshot and **leaves the caller's profile
notes out of the API prompt**. The live daemon is not touched.

**Dry run, free (done).** The whole harness with real whisper and real EMA, the fast layer pointed at the
stand-in: `e2e-api-dryrun.json` (`--rounds 1`, run before the cancellation correction in §1, which
`test_voice.py` covers). 12/12 utterances committed once and whole. Silence was silent.
Committed WER was 4.9 %, with no clicks. Every cut-in became the next turn and nothing played after the stop.
There were 20 stand-in requests, all counted in the run's ledger. One barge-in stop took 1,029 ms from voice
onset (the other two took 137 and 131 ms). The phone-side detector fired late on that one, which is code
this ticket does not touch. It is noted here and not investigated. The "20 utterances" check fails by
design at one round. **This run shows the plumbing. It is not evidence about the API.**

**Real comparison: blocked on one decision.** Once a key for Divan is stored and the spend authorized:

```sh
cd ~/projects/remote-ai-chat/app && npm ci
PY=../daemon/.venv312/bin/python
ACC=~/.remote-ai-chat/accounts/claude-759b47       # only for the --agent run's real agent and the CLI baseline
PY=$PY node scripts/voice-e2e.cjs --fast-layer anthropic-api --api-model claude-haiku-4-5 --api-cap-usd 0.50 \
    --rounds 2 --barges 3 --out ../docs/voice-bench/e2e-api.json --audio /tmp/divan-voice-e2e/api      # ~8 min, ≈ $0.17
PY=$PY node scripts/voice-e2e.cjs --fast-layer anthropic-api --account-home $ACC --agent --api-cap-usd 0.20 \
    --out ../docs/voice-bench/e2e-api-agent.json --audio /tmp/divan-voice-e2e/api-agent               # ~2 min
# optional, the candidate model, judged by the same checks and by listening:
PY=$PY node scripts/voice-e2e.cjs --fast-layer anthropic-api --api-model claude-haiku-5-5 --api-cap-usd 0.10 \
    --rounds 2 --barges 3 --out ../docs/voice-bench/e2e-api-haiku55.json --audio /tmp/divan-voice-e2e/api55
cd .. && $PY daemon/scripts/voice_bench/e2e_audio.py --run docs/voice-bench/e2e-api.json --out docs/voice-bench/e2e-api-audio.json
```

`e2e.json` from #151 is the CLI baseline to compare against: same fixtures, same clock. The run's JSON
carries `fast_layer` (provider, model, URL) and `api_usage` (requests, tokens, dollars) from its ledger.

**The single owner decision:** an Anthropic API key created for Divan's voice (its own Console workspace with a
$5 monthly limit), stored with `set-key`, and authorization to spend up to **$1** on the synthetic benchmark
above. Until then, real API latency and answer quality are **unverified**.

## 7. What leaves the Mac

Per request, to `api.anthropic.com` (Anthropic, as the CLI path already sends today, but under the API's
commercial terms rather than the subscription's):

- the system prompt, including, on the live daemon, the caller's profile notes (≤ 1,500 characters)
- the state snapshot: chat titles (trimmed), project names, statuses, the current tool, the last thing a
  chat said (≤ 150 characters), the ticket queue's titles. On a chat call, that chat's equivalent
- the fast transcript of what the caller said (text), and up to 8 earlier questions and answers of the same
  call
- the tool definitions, and the tool calls/results of the previous turn

Never sent: audio (whisper and EMA are local), chat histories beyond the snapshot lines, files, any
credential other than the key in its header. The history lives in memory for one call and is gone when
the call ends. The ledger (`~/.remote-ai-chat/voice-api-usage.json`, mode 600) holds only dates, counts,
tokens and dollars.

## 8. Where things stand

| Layer | State |
|---|---|
| Prepared code | Done: `voice_api.py`, config, key commands, bench switch |
| Offline tests | Pass: `test_voice.py` (and `--synthetic`) §6, against the loopback stand-in. Also the free e2e dry run (§6) |
| Real-provider measurements | **None.** No key is authorized for Divan; the real API's latency and quality are unverified |
| Live daemon | Not restarted. After the merge the updater brings the code, and it stays inert: the default is still `cli` |
| iPhone | **Not tested.** `xcrun devicectl list devices` showed both phones `unavailable` on 2026-10-09. This ticket changes no app source. The #151 signed build is still at `~/projects/.ustabasi/builds/151-divan-voice/Divan.app` (`build.sh` beside it) and speaks the same protocol. Install: `xcrun devicectl device install app --device 4A493A86-2B04-52F2-9B9C-64C93E275180 <path>/Divan.app` |

The voice-quality objective stays **open**: the latency target is not shown to be met, and the device
acceptance (echo on a real speaker, Bluetooth, the real network hop, how it sounds) is still missing.

Follow-ups (each its own ticket, beyond this run's bounds): the real benchmark above once authorized. A Haiku
5.5 comparison and a prompt pass for its Turkish. App translations for the two new error codes. A
speech-to-speech provider (option C) only if the measured API path still misses 1.5 s and that target
matters more than the cost of a second provider.
