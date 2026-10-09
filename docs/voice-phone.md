# Live voice: the phone's half (#150)

The iPhone side of option B in [voice-quality-plan.md](voice-quality-plan.md), on top of the daemon
session of [voice-session.md](voice-session.md) and the protocol in
[PROTOCOL.md § Voice session](PROTOCOL.md#voice-session).

## What changed on the phone

- **One engine, both directions** (`app/modules/call/ios/VoiceEngine.swift`). An `AVAudioEngine` with
  voice processing switched on (Apple's echo canceller, noise suppression and gain) on the call's
  `playAndRecord` / `voiceChat` session. The microphone leaves it as 16 kHz mono PCM16 in 50 ms frames;
  the reply plays through a player node on the same engine, so the canceller knows what the speaker is
  saying. That is what makes listening during playback possible at all; it is the same kind of
  canceller medkit gets from the browser's WebRTC capture.
- **The session client** (`app/src/voice-session.ts`, no React, no native code). It streams the
  microphone as `voice.audio` (100 ms, `seq` contiguous, kept across a dropped socket), plays
  `voice.say` pieces of the newest turn in order and drops anything of an older or cancelled one, and
  reports `voice.playback` started / done / stopped with `played_ms`. It never decides a turn has ended:
  the old `SILENCE_MS`, `AFTER_SPEECH_MS` and `BARGE_IN` rules are not used by the streaming call, so a
  Turkish thinking pause is the daemon's measured rule (0.7 s / 1.8 s / 2.5 s commit), not the phone's.
- **Barge-in on the phone.** Over the echo-cancelled input, 120 ms of frames at least −35 dBFS and at
  least 12 dB above the echo the detector learns while the reply plays (a weak canceller raises the bar
  instead of answering itself; a route change forgets it). It stops the player first, then sends
  `voice.barge`; the turn is dead locally at once, so a chunk still being synthesised is thrown away.
- **Streamed playback.** Each piece is synthesised and handed to the player as soon as it is made; EMA
  hands over sentence by sentence. The first piece plays while the rest of the answer is still arriving.
- **One voice for the whole call** (`app/src/live-call.ts`). Turkish with EMA on uses EMA if it loads;
  otherwise the whole call uses the system voice, synthesised into the same player
  (`AVSpeechSynthesizer.write`) so it is echo-cancelled and measured too, and the screen says so. No
  switch half way through a call.
- **medkit's patterns, adapted** (plan §8.2): `voice.ready` once the greeting is audible (or after 3 s);
  three resume attempts within the daemon's 30 s window, then the call ends and the chat goes on as text;
  local VAD barge-in; per-turn timing. medkit's LiveKit/WebRTC transport is not copied: the control and
  audio stay on the one authenticated WebSocket (see plan §8.2 for why).
- **Resources.** Permission is asked before anything opens; a refusal starts no session. An audio
  interruption (a phone call, Siri) or a dead engine releases the microphone and player and takes them
  back afterwards in the same session; a route change rebuilds the engine in place. In the background
  the call keeps its microphone (the app has the `audio` background mode, as a phone call does); if iOS
  stopped the engine, it is restarted when the app comes back. Hang-up silences and releases at once,
  then sends `voice.stop`. A call screen opened while a call is up joins it rather than placing a second.
- **The screen** (`app/app/call.tsx`) shows the daemon's own states — listening, hearing you, asking,
  speaking, working on it, reconnecting — provisional words dimmed in place, and after each answer how
  long the caller waited. A build without the engine, or a computer without `voice.start`, keeps the older
  half-duplex call unchanged.

## Instrumentation

Every playback `started` carries the native time the buffer reaches the speaker (now plus the route's
output latency). The session maps the daemon's `t_speech_end_ms` (audio timeline) back to the capture time
of that audio on the phone, so **speech end → first audible** is measured on one clock, and `voice.ping`
gives the offset to the daemon's clock. `VoiceSession.timingReport()` holds per-turn timings, every
barge-in's detection → stop, and the resumes; it is logged (`voice: report …`) at hang-up, and the
screen shows the last turn's wait.

## Tests

```
cd app
node scripts/test-voice-session.cjs [--json out.json]   # the session against an isolated daemon
node scripts/test-call-live.cjs [--shot <dir>]           # the call screen on it, buttons pressed
node scripts/test-ustabasi.cjs                           # everything, both of the above included
```

Both start `daemon/scripts/voice_peer.py`: the daemon of `test_voice.py` (own `RAC_HOME`, free loopback
port, demo chats, the replaying recogniser and the scripted fast layer), never the running one. The
phone is the real `voice-session.ts` over the app's real socket client. The native engine is a fake on
the wall clock: its microphone releases the bench's Turkish fixtures (`/tmp/divan-voice-bench/fixtures`,
the Mac's Yelda voice from synthetic text; level-only audio without `say`) in 50 ms frames, mixed with
whatever its player is playing at −24 dB, the speaker-mode echo left after cancellation that the bench
used. What they check: every one of the twelve speech scenarios (long, corrected, 0.5–2 s thinking pauses)
commits once and whole, silence stays silent, every answer is audible before its last piece has arrived,
nothing of a cancelled turn is played, the screen's states are the daemon's `voice.state` events in order;
the reply's echo never becomes a turn or a barge-in; talking over a long answer stops the player within
300 ms of the voice starting and the cut-in is committed whole as the next turn; route change, engine
failure, interruption, foreground, socket drop and resume, hang-up, a refused microphone and a second
start each end with one session and nothing held.

Measured in that run (simulated audio, stand-in recogniser and fast layer, a fake voice that starts in
40 ms; it is the phone's share and the protocol, not a voice-quality number): speech end → first audible
median 970 ms / p95 1030 ms over 12 turns (the daemon's 700 ms soft end is most of it); barge-in, voiced
onset → player stopped 139 ms (259 ms from the start of the word's span), detection → stop under 1 ms.

**Not verified on an iPhone.** Nothing here measures Apple's canceller on a real speaker, the
`AVAudioPlayerNode` stop time on the device, EMA's speed in a live call, or how it sounds. That is #151's
device run, with the build below.

## Build and delivery

`~/projects/.ustabasi/builds/150-divan-voice/build.sh` prebuilds this worktree's app and builds it
signed (team from `identity.local.json`, automatic signing) for `generic/platform=iOS`, keeping
`Divan.app` there. Installing is the existing runbook:
`xcrun devicectl device install app --device 4A493A86-2B04-52F2-9B9C-64C93E275180 <path>/Divan.app`.

Built 2026-10-09 from this branch: `** BUILD SUCCEEDED **`, signed `Apple Development` for team
23N6H4HW39, its provisioning profile includes the iPhone 17 Pro Max (`00008150-000139622E68C01C`), and
the bundle carries the EMA models and the final JS. Not installed: `devicectl` lists the phone as
`unavailable` and the install fails with "unable to locate a device". The build stays at
`~/projects/.ustabasi/builds/150-divan-voice/Divan.app` until the phone is on the network.

## Provider, cost, data flow

No new provider, account or spend. Microphone audio goes from the phone to the owner's own Mac over the
existing paired socket (LAN, Tailscale, or the Cloudflare tunnel, which terminates TLS at Cloudflare as
it already does for text); recognition and the fast layer are #149's (mlx-whisper on the Mac, Haiku
through the Claude Code CLI on the subscription). The voice is made on the phone. The tests contact
nothing outside the Mac. The private recording attached to the ticket was not used.

## Follow-ups (bounded)

- **#151, on the device**: barge-in stop time and false barges with the phone's real canceller on
  speaker, headset and Bluetooth; speech end → audible with EMA; the 300 ms budget and the 2.5 s / 3.5 s
  targets on the phone.
- An incoming call (CallKit, `onCallAnswered`) opens the call screen as before; starting the streaming
  session on answer without a tap, on CallKit's session, is a small follow-up.
- Binary WebSocket frames instead of base64 (about a third less on the wire).
- The fast layer's first token (plan §8.3) still needs the owner's decision on an API key.
