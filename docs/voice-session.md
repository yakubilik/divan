# Live voice: the daemon's streaming session (#149)

The daemon half of option B in [voice-quality-plan.md](voice-quality-plan.md):
`daemon/divan/voice.py`, its handlers in `server.py`, and the protocol in
[PROTOCOL.md § Voice session](PROTOCOL.md#voice-session). The phone half is
ticket 150 and the end-to-end tuning is 151; neither is done here.

## What it does

- **Turns are the daemon's.** Streamed PCM is cut into 20 ms frames on the
  session's own audio timeline; a frame at −45 dBFS for 60 ms is speech
  (−35 dBFS for 120 ms while the phone reports it is playing). The turn rule is
  the bench's `Plan`, checked to be the same numbers by the test: a reply may
  start after 700 ms of quiet (1800 ms if the words so far end on a joining
  word or a comma), and the turn commits after 2500 ms.
- **Recognition is eager.** At 300 ms of quiet what has been said so far is
  transcribed on whisper small (with the bench's vocabulary prompt), so the
  words are usually there by the 700 ms soft end. The commit's words come from
  the default model (large-v3-turbo) and are what an agent receives. That pass
  starts once the reply has its first piece out, not before: mlx-whisper's
  decoding loop is Python, and run beside the reply it held up the event loop
  that reads the model's stream. mlx-whisper keeps one model loaded and reloads
  on every switch, so `transcribe.py` now keeps each one it has loaded.
- **Answers stream.** The fast layer (`FastLayer`, the concierge's account and
  plan machinery on Haiku 4.5 with thinking off and partial messages on) is
  asked at the soft end. Its text is cut into pieces as it arrives — the first
  at the first clause of three words or more, then whole sentences — and each
  goes out as `voice.say` immediately. Two sentences' worth (32 words) is the
  cap; the rest of the stream is interrupted.
- **Cancellation.** Speech that resumes before the commit cancels the reply in
  flight (`voice.cancel {resumed}`), interrupts the model and drains its tail,
  and the turn grows under a new id. A barge-in (`voice.barge`, or the daemon's
  own detection over the echo while playing) cancels the current turn. Nothing
  of a cancelled or superseded turn is sent after the fact; every emit checks
  that its turn is still the current one.
- **Commit is the only gate to execution.** The fast layer's tools (the general
  call's four verbs from `call.build_tools`; on a chat call `forward_to_chat`,
  `answer_approval`, `stop_chat`) only record intents. After the commit they
  run through `Server._concierge_actions` — the phone's own paths, so the same
  account, permission mode and approvals — and what is said is a fixed line
  built from the result. The model's words on that turn are discarded, and
  any sentence of the fast layer that claims an action in the first person
  (done, doing or about to do: `çalıştırdım`, `bakıyorum`, `düzelteyim`, "I've
  sent") is dropped.
- **Progress is real.** A chat the call handed work to is followed through the
  server's own event stream: a `tool.use` becomes at most one line per 20 s, an
  `approval.request` is asked aloud, and the agent's reply is spoken (through
  `call.spoken_reply`) only after its `turn.done` has gone out. Nothing is said
  over the caller or over a turn of theirs still being answered. An ordinary
  question is answered meanwhile.
- **Errors are bounded.** Recognition and replies are retried once, then
  reported as `voice.error` and said aloud as a `notice`; the session goes back
  to `listening`. A dropped socket can resume the session within 30 s under a
  new turn id.

## Tests

```
cd daemon
python scripts/test_voice.py                # stand-ins, ~100 s, in CI
python scripts/test_voice.py --synthetic    # the same with level-only audio, as CI on Linux gets
PY=~/projects/divan/daemon/.venv312/bin/python
$PY scripts/test_voice.py --real --account-home ~/.divan/accounts/<claude-id> \
    [--rounds 2] [--out ../docs/voice-bench/voice-session.json]
```

All of them start a daemon of their own in the test process (`DIVAN_HOME` under a
temporary folder, a free loopback port, `demo = true` so a chat is the scripted
demo agent and never a CLI) and talk to it over a real WebSocket with
`voice.start`/`voice.audio`, releasing each fixture in 100 ms messages on the
wall clock. Fixtures are the bench's (`make_fixtures.py`, the Mac's Yelda voice,
synthetic text only); without `say` they are rebuilt as level-only audio with the
same timing. The running daemon is never touched.

The default run replaces the two models: the recogniser returns the words whose
audio lies wholly inside the clip it is handed (a perfect recogniser), and the
fast layer is a scripted stream. What it checks: one committed turn with every
word for each of the twelve speech scenarios (all run at once, one phone each);
no reply started at all on a pause after a joining word; the early reply
cancelled when speech resumes; nothing for silence; a barge-in over the echo
detected on the caller, the answer cancelled with nothing of it sent after, the
cut-in committed as the next turn; on a chat call, the corrected request
reaching that chat exactly once on its own account and permission mode while
its first half never does, one progress line from the agent's real tool call,
the approval asked aloud and still answered by `approval.respond`, a status
question answered while the chat waits on it, and the agent's reply spoken only
after `turn.done`; on the general call, one new chat in the project carrying the
instruction once; a fast-layer sentence claiming an action dropped; recogniser
and model failures reported, said and recovered from; a dropped session resumed
with nothing replayed; no receipts for fire-and-forget messages.

`--real` uses the daemon's whisper and a real fast layer on the given account,
with the proof's synthetic `<state>` so the timings compare with `proof.json`,
and writes `docs/voice-bench/voice-session.json`.

### Provider, cost, data flow

- Recognition: mlx-whisper on this Mac (models already in the Hugging Face
  cache: `whisper-small-mlx`, `whisper-large-v3-turbo`). No audio leaves the Mac.
- Fast layer: Claude Code CLI on an existing signed-in Claude account
  (subscription), Haiku 4.5. Text only: the transcript and a synthetic state
  block. No API key, no new provider, no new spend. A two-round measured run is
  about 25 Haiku turns (a warm-up, 22 answers, a few follow-ups the model's tool
  calls cause); the SDK's notional price of a Haiku turn this size is well under
  a cent, and on a subscription it is plan usage, not money. Nine real runs of one
  or two rounds were made for this ticket, on the same account.
- The private recording attached to the ticket was not used anywhere.

## Measured

Same fixtures and the same synthetic `<state>` as `proof.json`, real whisper and
real Haiku, on this Mac (M1), 2026-10-09. "First say" is speech end → the first
`voice.say` arriving on the loopback socket: the daemon's share of "first audio".
The phone adds EMA's first clause and its player (ticket 150).

| | proof.json (#148) | this session, committed run (2 rounds, `voice-bench/voice-session.json`) | best of three one-round runs the same morning |
|---|---|---|---|
| Speech turns committed once, whole | 13/13 by the replay rule | **22/22** | 11/11 each |
| Silence | no reply | **no transcript, no turn, nothing said** | same |
| WER, words agents receive | 3.9% (turbo, offline) | **2.7%** (turbo, at commit) | — |
| WER, words the reply is built on | 7.0% (small, offline) | **4.9%** (small, eager) | — |
| Recognition done, after speech end | 1.31 s | **≈ 0.9–1.2 s** (0.7 s of it is the soft end itself) | 0.88 s |
| Model asked → first token | 0.70 s | 2.03 s median, 6.0 s p95 | **0.72 s** (others: 1.35, 1.38 s) |
| First text piece out, after speech end | 2.23 s (first clause ready) | 3.45 s median, 7.7 s p95 | **1.90 s** median, 2.28 s p95 |
| Errors | — | 0 | 0 |

### Against the budget

The plan's achievable target for B is 2.5 s median / 3.5 s p95 from speech end
to *audible* first clause on the phone. Taking off EMA's first clause (≈ 0.5 s
once ticket 150 makes it a clause, plan §6) and the hop and player (≈ 0.1 s)
leaves the daemon **≈ 1.9 s median / 2.9 s p95**. Its parts:

- the soft end: **0.70 s**, fixed by the turn rule (shorter cuts Turkish
  speakers off, baseline §3A);
- recognition after it: **0.2–0.5 s**;
- the clause: **0.2 s** from first token to first piece;
- **the fast layer's first token: 0.72 s in the best run, 1.35–2.03 s median and
  up to 6 s p95 in the others** — from the same code, the same account and the
  same questions within one morning.

Met in the best run (1.90 s / 2.28 s), not met in the committed one. **The
exact remaining bottleneck is the first token of the fast layer through the
Claude Code CLI**, and it is the CLI path, not the session: the phase timings
show no wait on a lock, a drain or a reconnect (`brain` in every turn of
`voice-session.json`), the recogniser no longer runs beside it (the commit's
pass starts after the first piece), and the same layer asked back to back
outside the session answers in 0.6–0.7 s while after 8 s of quiet it takes
1.3–2.8 s. A keep-alive turn sent when the caller starts speaking fixed that in
isolation (0.6 s) and did nothing measurable in the session (1.38 s with it,
1.35 s without, same window), so it was taken out again. What would fix it is
not on the CLI: see plan §8. It is assigned to ticket 151, which measures the
integrated build and needs the owner's decision recorded there.

### What else the real runs showed

- Haiku with thinking off does call tools on requests, and sometimes with a
  wrong session number; the bridge then says truthfully that it could not do it.
- It also writes Turkish first-person promises ("kontrol edeyim", "check
  edeyim"). The guard drops the Turkish verb forms; an English verb with a
  Turkish suffix still passes and is for 151's listening pass.
- Its answers mix English chat titles into Turkish sentences, as the plan
  predicted; a spoken title per chat in the snapshot is still open (plan §6).

