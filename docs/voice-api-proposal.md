# A direct-API fast layer for live voice: decided against (#160)

#151 measured live voice end to end. One stage misses its budget: the fast layer's first token through
the Claude Code CLI, at 1.71 s median / 6.3 s p95. That puts audible latency at 3.55 s median / 7.5 s p95,
against a target of ≤ 1.5 s / ≤ 3 s ([voice-quality-results.md](voice-quality-results.md) §3). medkit
reaches its model over the Anthropic Messages API directly, so #160 started by preparing the same for
Divan.

## The decision

**The owner ruled it out (2026-10-09): live voice runs on the local Claude subscriptions, and the API is
not to be used.**

The API layer was written and tested offline in this branch: a streaming client behind `Brain`, an
opt-in setting, a keychain key, a spending cap, and a stand-in API for tests. It was then **removed
before merge**. It is not in the code, and no setting or key turns it on. No request ever went to the
API and nothing was spent. If it is ever reconsidered, the work is in this branch's history
(commits `b635014`–`ba026de`), and the evaluation below still applies.

For the record, what the evaluation found:

- **Model.** The same Haiku 4.5 the CLI uses, to isolate the transport.
  ([models](https://platform.claude.com/docs/en/about-claude/models/overview),
  [pricing](https://platform.claude.com/docs/en/about-claude/pricing): $1 / $5 per million input /
  output tokens, read 2026-10-09.)
- **Prompt size.** About 2,000–3,000 input tokens and 40–80 output tokens per turn: system prompt
  ≈ 2.2k characters, tools ≈ 1.4k, state + question ≈ 2.1k.
- **Cost.** About $0.003 per turn, so about $0.17 for the 24-turn bench.
- **Latency gain.** About 0.4–0.7 s first token, an **estimate** taken from medkit's arrangement.
  It was never measured.
- **Data.** It would have sent the same text the CLI already sends (prompt, state snapshot,
  transcript), under API terms instead of the subscription's.

## What this ticket keeps, on the subscription path

- **The warm fast layer outlives the call** (`voice.Hub.park` / `brain_for`, `KEEP_WARM_S` = 300 s).
  #151 measured a call's first answer waiting 6.9 s for the CLI to start. Now a hung-up call's CLI
  session stays open, one per kind of call (the general call, or one per chat), and the next call of
  that kind answers on it.
  - No query is sent to keep it warm, so it costs no usage.
  - A reply cut off by the hang-up is drained before reuse.
  - A second call of the same kind running at the same time gets its own fast layer.
  - The CLI session still recycles at its own idle limit and turn count.
  - The next call keeps the previous call's exchanges as context, the same way consecutive questions
    in one call already do.
  - Checked in `test_voice.py` §6 over the voice socket.
- **Cold first turn reported separately.** `voice-e2e.cjs` now reports a run's cold first turn as
  `cold_first_turn_true_end_to_audible_ms`, kept out of the median and p95.
- **Shared prompt builders.** `voice_system` and `turn_prompt` are now separate functions. The text
  is unchanged.

## What is still open

- **Latency target not met.** The steady-state first token through the CLI (1.7 s median, 6–9 s tail)
  is unchanged by this ticket. On the subscription path the remaining levers are the CLI itself, the
  prompt size and the model. Each needs a real bench run on the subscription (`voice-e2e.cjs`,
  #151 §6) to show an effect. None is claimed here.
- **Warm reuse not yet measured.** Its effect on a second call's first answer is untested on real
  models.
- **iPhone untested.** Both phones showed `unavailable` on 2026-10-09. The #151 signed build at
  `~/projects/.ustabasi/builds/151-divan-voice/Divan.app` still matches this branch, since no app
  code changed.
