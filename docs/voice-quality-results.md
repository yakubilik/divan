# Live voice: measured end to end, tuned, and what is still open (#151)

The integrated build of #149 (daemon) and #150 (phone client), measured on real models, then tuned
inside the agreed voice scope. The plan and its targets are in [voice-quality-plan.md](voice-quality-plan.md),
the earlier measurements in [voice-quality-baseline.md](voice-quality-baseline.md),
[voice-session.md](voice-session.md) and [voice-phone.md](voice-phone.md).

**Short version.** Turn-taking, pauses, corrections, barge-in, recognition, the bridge into a real
agent and the audio itself meet their targets in the laboratory. **Latency does not**: 3.55 s median /
7.5 s p95 from the end of speech to the first audible word, against ≤ 1.5 s / ≤ 3 s. The measured
cause is one stage, the fast layer's first token through the Claude Code CLI. **The phone was not
reachable**, so nothing here is verified on the iPhone; the signed build is kept for it.

## 1. What was run

`app/scripts/voice-e2e.cjs` (new). The phone is `src/voice-session.ts`, the code the call screen runs,
over the app's own socket client. It speaks with the app's own EMA pipeline (`src/tts/engine.ts` on
onnxruntime-node, wrapped by `emaVoice`, now the same function `live-call.ts` uses on the phone). The
daemon is isolated (`daemon/scripts/voice_peer.py --real`: its own `RAC_HOME`, a loopback port, never
the running daemon). It uses the daemon's whisper (small for the reply, large-v3-turbo at commit) and
the real fast layer: Haiku 4.5 through the Claude Code CLI, thinking off, on an existing signed-in
Claude account, answering from that daemon's own snapshot as the product does.

**Simulated: the microphone and the speaker.** `FakeEngine` releases the bench's Turkish fixtures in
50 ms frames on the wall clock. They are synthetic (macOS Yelda voice from the sanitized texts in
`scenarios.json`), with no recording of a person. It mixes whatever it plays back into the microphone
at −24 dB (the echo left after cancellation the bench assumed) and plays in real time. Every piece it
plays is kept, so each answer is written out as the WAV the caller would have heard.

`--agent` runs the long-task part. It is a chat call into a **real Claude agent** (Sonnet, `bypass`,
same account) in a throwaway project whose build script takes 30 s.

All timings were taken inside the ticket runner. macOS keeps it in the background band (efficiency
cores only, `ps -o pri` = 4) on a Mac with load ≈ 4 from other work. Compute stages are pessimistic
compared with the live daemon (normal priority), and run-to-run spread is large (§3).

## 2. Results against the targets

24 annotated Turkish utterances per run (12 speech scenarios × 2 rounds, plus silence ×2), 3 barge-ins
on real answers. "Before" is the merged #149 + #150 build, "after" is this branch. Each is one full run.

| Target | Before (`e2e-before.json`) | After (`e2e.json`) | Met? |
|---|---|---|---|
| Speech end → first audible useful word, median ≤ 1.5 s | **2.80 s** | **3.55 s** | **No** (cause §3) |
| … p95 ≤ 3 s | **8.88 s** | **7.53 s** | **No** |
| Plan's achievable bar for option B (2.5 s / 3.5 s) | no | no | **No** |
| Detected interruption → playback stopped ≤ 300 ms | 142 / 130 / 139 ms voice onset → stop; detection → stop 0 ms | 257 / 137 / 134 ms; 0–1 ms | Yes (laboratory) |
| Turkish WER ≤ 15 % (what agents receive) | 5.3 % (reply's own 8.9 %) | 5.3 % (reply's 7.3 %) | Yes |
| Long utterances / thinking pauses not truncated | 24/24 committed once and whole | 24/24 | Yes |
| Silence stays silent | 0 events | 0 events | Yes |
| Cut-in after a barge is the next turn, nothing of the old answer played | 3/3, 0 pieces after stop | 3/3, 0 | Yes |
| Clicks at piece edges (edge > 5 % FS) | 2 | **0** | Yes after the fade |
| Answers read back by whisper (`e2e-audio.json`) | pooled 12.3 %, first word 23/24, last 23/24 | pooled 10.3 %, first 24/24, last 22/24 | Yes, see §4 |
| Silences > 700 ms inside an answer | none | two (880, 780 ms) | Partly, §4 |
| Voice | EMA for every piece, no fallback | EMA for every piece | Yes |

"First audible" is the first sample of the answer leaving the player, minus the fixture's own end of
speech (ground truth), on one clock. The daemon's own speech-end estimate gives the same numbers within
10 ms.

## 3. Latency: where the time goes

Stage medians after the end of speech, daemon side (turns after the first; `daemonTurns` in the JSON):

| Stage | Before | After |
|---|---|---|
| Soft end (turn rule) | 0.70 s | 0.70 s |
| Fast transcription ready | 0.92 s | 0.88 s |
| **Fast layer asked → first token (CLI)** | **1.54 s median, 7.5 s p95** | **1.71 s median, 6.3 s p95** |
| First `voice.say` | 2.67 s | 3.26 s |
| EMA first piece + player (first say → audible) | +0.11 s | +0.13 s |

Everything except one stage is within budget: the turn rule (0.7 s, fixed so Turkish pauses are not
cut), recognition (≈ 0.2 s after it), the clause cut, and EMA plus the player (≈ 0.12 s, with EMA at RTF
0.36–0.42 on one thread here). **The remaining bottleneck is the first token of Haiku through the Claude
Code CLI.** Its median alone uses the whole 1.5 s budget, and its tail of 6–9 s is what makes the p95.
The same code gave 0.6–0.9 s first tokens in one round and 1.5–7 s in the next, minutes apart. #149
found the same thing; the stall is in the CLI path, not in the session (no lock, drain or reconnect
waits in `brain` timings, except a cold CLI on a call's first turn: 6.9 s lock in the before run's warm-up
turn, which is excluded from the stats).

The "after" median is not better than "before". The one latency change made here (§5.1) removes a
measured overlap but is not visible above that spread. Neither number meets the target, and this
document does not claim an improvement there.

What would close it is outside this ticket's authority (plan §8.3, medkit's arrangement). One option is
the fast layer on the Anthropic Messages API directly (a warm HTTP connection, ≈ 0.4–0.7 s first token,
per-token billing). It is a contained change behind the `Brain` interface and needs an API key for Divan.
The other is a speech-to-speech provider (option C) with its own key and data flow. Both need the
owner's decision. No key was used or created.

## 4. Turns, interruptions, agents and audio

- **Pauses and corrections.** All 12 scenarios commit once with every word, in both rounds of both runs:
  0.5–2 s thinking pauses, two pauses, the 13 s request, an in-sentence and a cross-pause correction.
  The early reply on `pause-2000` and `correction-pause` is cancelled when speech resumes, and nothing
  of it is played.
- **Barge-in.** The caller ("Selam, nasılsın?") cut into three real answers 0.4 s into playback, over
  their −24 dB echo. The player stopped 134–257 ms after the voice began, the daemon cancelled that turn,
  and nothing of it played afterwards. The cut-in was the next turn, whole. No echo ever became a
  transcript or a turn.
- **A real long task** (`e2e-agent.json`, after the fixes in §5). The chat call was "Testleri
  çalıştır. Hayır dur, önce derlemeyi bitir." The chat received it **once, whole**, and nothing else; no
  other chat was made. "Sohbete ilettim." was heard 3.9 s after speech end. "Bir komut çalıştırıyor."
  came from the agent's real `Bash` call. "Testler bitti mi?", asked while it was `running`, was answered
  from the chat's state ("Hâlâ çalışıyor, henüz bitmedi.") 4.0 s after speech end, without being
  routed to the agent. The agent's own result was spoken only after its `turn.done` (69 s): "Build
  bitti (12 modül), arkasından testleri de çalıştırdım: 8 test geçti."
- **Before the fix** the same scenario failed three runs out of three (§5.3): Haiku said "Derlemesi
  devam ediyor" about an idle chat and never forwarded the request.
- **Acknowledgements and backchannels.** The one acknowledgement is the short line said when an
  action has not answered within 1.2 s after the commit. `test_voice.py` now checks it in context: it
  is said once, before the bridge's own line; the next one is a different line; none is said once the
  caller is talking again. **No backchannels are said while the caller speaks.** An "mm-hm" at the
  0.7 s soft end would land inside the thinking pauses the bench is built on (0.5–2 s), which is exactly
  the talking over the caller the ticket rules out. None were added.
- **Audio.** Every answer's audio was read back by whisper turbo: 10.3 % pooled. The misses are English
  product names read by a Turkish voice ("Babise", "Iskocam") and whisper's own spelling ("ne haber"
  for "naber", the two "last word" misses). One "missing first word" in the before run turned out to be
  whisper skipping it in the whole clip; the first two seconds alone read "bilmiyorum". EMA spoke
  every piece of every answer, with no fallback voice. Two answers have a 0.8–0.9 s silence between
  sentences. That is the player waiting for the model's next sentence, not a dropout. Naturalness of
  prosody needs a listener: the WAVs are in `/tmp/divan-voice-e2e/final/` (not committed).
- **What the fast layer says.** Truthful, but not yet good conversation. On this empty test machine
  it often answers with a clarifying question ("Hangi proje?") and lists the owner's projects from the
  account profile. It still mixes English words into Turkish ("session", "approval", "scope"). It
  sometimes offers to act in a question ("Derle, sonra test mi yapayım?"), which is not a claim and
  was left. These are prompt and model limits; see §7.

## 5. What was changed

1. **The commit's transcription no longer races a slow answer** (`voice.py`
   `_final_after_reply`). #149 already held the large model back until the reply's first words. The
   commit at 2.5 s bypassed that rule: in the before run every answer slower than the commit had turbo
   decoding beside the fast layer's stream. Now it also waits for the first piece, an intent, or the
   first-token timeout. Checked by `test_voice.py` ("not raced").
2. **No silent turns.** When every sentence of a reply was dropped as a false action claim ("Hemen
   bakıyorum."), the turn used to say nothing (r0 `pause-1500` in the first after run). It now says an
   offer: "Bunu bir sohbete vermemi ister misin?" The guard also catches English verbs made Turkish
   with *etmek* ("deploy edeyim", "check edeyim"), which #149 left open. Both are checked.
3. **Chat call routing by rule** (`is_request`). On a chat call, a plain Turkish request is forwarded
   to that chat at the commit without asking the model. That is an action verb as a command ("bitir",
   "kontrol et", "düzeltin") or as a polite question ("bakar mısın"). Execution is unchanged: the same
   commit gate, the chat's own account and permission mode, the bridge's fixed line. Questions ("Testler
   bitti mi?") still go to the fast layer. Checked on phrase sets.
4. **The fast layer may not describe work the state does not show**, nor mention its state block (it
   had said "state'te yok"). On a chat call, the routing rule is repeated with every question.
5. **4 ms fades at the edges of every EMA piece** (`fadeEdges` in `voice-session.ts`): the two clicks
   (edge steps of 5.4–5.5 % FS) are gone.
6. `emaVoice` moved from `live-call.ts` into `voice-session.ts`, unchanged, so the bench runs the
   phone's code.

## 6. Reproduce

```sh
cd app && npm ci
PY=~/projects/remote-ai-chat/daemon/.venv312/bin/python      # daemon venv with mlx-whisper
ACC=~/.remote-ai-chat/accounts/<claude-account>              # an existing signed-in Claude account
# tts/models from tts/verify.sh (or TTS_MODELS=...); fixtures are made on first use
PY=$PY node scripts/voice-e2e.cjs --account-home $ACC --rounds 2 --barges 3 \
    --out ../docs/voice-bench/e2e.json --audio /tmp/divan-voice-e2e/final       # ~8 min
PY=$PY node scripts/voice-e2e.cjs --account-home $ACC --agent \
    --out ../docs/voice-bench/e2e-agent.json --audio /tmp/divan-voice-e2e/agent  # ~2 min
cd .. && $PY daemon/scripts/voice_bench/e2e_audio.py --run docs/voice-bench/e2e.json \
    --out docs/voice-bench/e2e-audio.json
# the checks that run without models (CI):
$PY daemon/scripts/test_voice.py && $PY daemon/scripts/test_voice.py --synthetic
cd app && npm test
```

Artifacts: `docs/voice-bench/e2e-before.json`, `e2e-before-audio.json` (before), `e2e.json`,
`e2e-audio.json`, `e2e-agent.json` (after). Every row carries the committed and fast transcripts, the
cancels, what was said, per-stage timings and the path of its WAV. The WAVs (synthetic voice in, EMA
out) stay in `/tmp/divan-voice-e2e/` and are not committed.

## 7. Configuration, cost, data flow

- **Recognition:** mlx-whisper on the Mac. `whisper-small-mlx` for the reply,
  `whisper-large-v3-turbo` at commit, with the vocabulary lead-in. No audio leaves the Mac.
- **Fast layer:** `claude-haiku-4-5` via the Claude Code CLI (agent SDK), thinking off, partial messages,
  on the existing account `claude-759b47` (subscription). Text only: the transcript and the isolated
  daemon's snapshot.
- **Agent (long-task run):** Claude Sonnet via the CLI on the same account, `bypass`, in a temp folder
  with a stand-in build script.
- **Voice:** EMA Lightning, the app's ONNX models, one CPU thread here, 48 kHz.
- **Cost:** no new provider, account, key or spend. Subscription usage, roughly: 3 conversation
  runs × ~31 Haiku turns, 3 agent runs (~3 Haiku turns and one short Sonnet agent turn each), and a
  3-question probe. That is ≈ 110 short Haiku turns and 3 agent turns.
- **Private recording:** the ticket's attached recording was not used, read or sent anywhere.

## 8. The phone, and what remains

- **iPhone: not verified.** `xcrun devicectl list devices` showed both phones `unavailable` throughout
  this run, so there was no device test and no install. The signed Release build of this branch is kept
  at `~/projects/.ustabasi/builds/151-divan-voice/Divan.app` (`build.sh` beside it). Install with the
  existing runbook once the phone is on the network:
  `xcrun devicectl device install app --device 4A493A86-2B04-52F2-9B9C-64C93E275180 <path>/Divan.app`.
  The running daemon gets this branch's daemon half only through its own updater after the merge. It
  was not restarted.
- **Open on the device:** Apple's echo canceller on a real speaker, headset and Bluetooth (false
  barges, stop time). EMA's speed on the phone's CPU. The real network hop. How the voice sounds to the
  owner.
- **Latency (unmet):** the fast layer's first token through the CLI (§3). Bounded follow-up: put
  `FastLayer` on the Messages API behind `Brain`, the same prompt, guard and commit gate, then rerun this
  bench. It needs an Anthropic API key for Divan, which is an owner decision.
- **Cold first turn:** a call's first answer waits for the CLI to start (6.9 s measured). Bounded
  follow-up: keep one warm fast layer per account in the `Hub` between calls.
- **Spoken language:** the fast layer's English words and its listing of projects from the profile
  (§4). A per-chat spoken title in the snapshot (plan §6) and a prompt pass are a small follow-up,
  judged by listening on the phone.
- **medkit reference (read-only, plan §8).** What it gets right that Divan now matches: local-VAD
  interruption, never playing a cancelled turn, `client_ready` before the first line, bounded reconnect,
  per-stage timing. Where it is still ahead is response time: its LLM is on the API directly and its
  STT/TTS are cloud streaming. Divan's laboratory numbers on pauses, interruption and partial audio are
  at least as good. Its responsiveness is not, for the reason in §3. Similarity to medkit is not proof
  of latency, and none is claimed.
