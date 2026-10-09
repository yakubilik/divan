/** The phone's half of the streaming call (#150), driven against a real daemon.
 *
 *  `src/voice-session.ts` — the code the call screen runs — talks over the app's own socket client
 *  (`src/ws.ts`) to an isolated daemon (`daemon/scripts/voice_peer.py`: its own DIVAN_HOME and loopback
 *  port, the replaying recogniser and the scripted fast layer of `test_voice.py`). The native engine is a
 *  fake that runs on the wall clock: its microphone releases the bench's Turkish fixtures (synthetic, the
 *  Mac's Yelda voice; nothing recorded from a person) in 50 ms frames, mixed with what its player is
 *  playing at −24 dB — the speaker-mode echo left after cancellation that the plan's bench used — and its
 *  player plays each item in real time and reports started/done.
 *
 *  This is simulated audio. It proves the protocol, the turn handling, the barge-in budget and the
 *  resource handling; it says nothing about how the iPhone's own canceller or speaker sound.
 *
 *  Run: node scripts/test-voice-session.cjs [--json out.json]   (also folded into test-ustabasi.cjs).
 *  Needs the daemon's Python (PY, else ~/projects/divan/daemon/.venv312/bin/python, else
 *  python3); without one the checks say SKIP, and `--require-daemon` makes that a failure.
 */
const { transform } = require('sucrase');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const VS = require(path.join(root, 'src/voice-session.ts'));
const { RacClient } = require(path.join(root, 'src/ws.ts'));

const RATE = 16000;
const FRAME = 800;                      // 50 ms microphone frames, as the native engine sends them
const ECHO_DB = -24;
const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLocaleLowerCase('tr').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
const report = {};

// ── fixtures ────────────────────────────────────────────────────────────────
function readWav(file) {
  const b = fs.readFileSync(file);
  let at = 12;
  while (at < b.length) {
    const id = b.toString('ascii', at, at + 4);
    const n = b.readUInt32LE(at + 4);
    if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + n));
    at += 8 + n;
  }
  throw new Error(`no data in ${file}`);
}

function tone(ms, db = -20, hz = 180) {
  const n = Math.round((RATE * ms) / 1000);
  const amp = 32768 * 10 ** (db / 20) * 1.41;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

// ── the fake native engine ──────────────────────────────────────────────────
class FakeEngine {
  constructor({ echoDb = ECHO_DB, denied = false } = {}) {
    this.echo = 10 ** (echoDb / 20);
    this.denied = denied;
    this.ls = new Set();
    this.isRunning = false;
    this.queue = [];
    this.current = null;
    this.source = [];
    this.log = [];                         // [t, what, detail]
    this.plays = [];                       // { id, t }
    this.flushes = [];
    this.startCount = 0;
    this.stopCount = 0;
    this.rng = 7;
  }
  on(l) { this.ls.add(l); return () => this.ls.delete(l); }
  emit(e) { for (const l of [...this.ls]) l(e); }
  running() { return this.isRunning; }
  async start() {
    this.startCount++;
    if (this.denied) { const e = new Error('microphone permission denied'); e.code = 'mic_denied'; throw e; }
    this.isRunning = true;
    this.t0 = Date.now();
    this.emitted = 0;
    this.timer = setInterval(() => this.tick(), 10);
    this.log.push([Date.now(), 'start']);
  }
  stop() {
    this.stopCount++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isRunning = false;
    this.queue = [];
    this.current = null;
    this.log.push([Date.now(), 'stop']);
  }
  play(id, pcm, rate) {
    const step = rate / RATE;
    const out = step === 1 ? pcm : Int16Array.from({ length: Math.floor(pcm.length / step) }, (_, i) => pcm[Math.floor(i * step)]);
    this.plays.push({ id, t: Date.now() });
    this.queue.push({ id, pcm: out, pos: 0 });
  }
  /** What VoiceEngine.swift's rebuild() does on AVAudioEngineConfigurationChange (a headset plugged in):
   *  the old player and everything on it is gone with no done, and only a route 'rebuilt' is said. */
  rebuild(output = 'Headphones') {
    this.queue = [];
    this.current = null;
    this.rebuilds = (this.rebuilds || 0) + 1;
    this.emit({ kind: 'route', reason: 'rebuilt', flushed: true, output });
  }
  flush() {
    this.flushes.push(Date.now());
    this.queue = [];
    this.current = null;
  }
  /** Speech into the microphone, from the next frame on; resolves with the wall time it began. */
  say(samples) {
    return new Promise((resolve) => this.source.push({ samples, pos: 0, began: resolve }));
  }
  noise() {
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    return ((this.rng / 0x7fffffff) * 2 - 1) * 32768 * 10 ** (-62 / 20) * 1.7;
  }
  tick() {
    const due = Math.floor((Date.now() - this.t0) / 50);
    while (this.isRunning && this.emitted < due) {
      const t = this.t0 + this.emitted * 50;
      const frame = new Int16Array(FRAME);
      for (let i = 0; i < FRAME; i++) {
        let v = this.noise();
        const src = this.source[0];
        if (src) {
          if (src.pos === 0 && src.began) { src.began(t); src.began = null; }
          v += src.samples[src.pos++];
          if (src.pos >= src.samples.length) this.source.shift();
        }
        v += this.out(t) * this.echo;
        frame[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
      }
      this.emitted++;
      this.emit({ kind: 'frame', pcm: frame, t_ms: t });
    }
  }
  /** One output sample; started/done events on the frame they happen in. */
  out(t) {
    if (!this.current) {
      this.current = this.queue.shift() || null;
      if (this.current) this.emit({ kind: 'playback', id: this.current.id, state: 'started', t_ms: t });
    }
    const c = this.current;
    if (!c) return 0;
    const v = c.pcm[c.pos++];
    if (c.pos >= c.pcm.length) {
      this.current = null;
      this.emit({ kind: 'playback', id: c.id, state: 'done', t_ms: t });
    }
    return v;
  }
}

/** A voice that takes 40 ms to start and speaks about 0.3 s a word, at −20 dBFS. */
const fakeVoice = {
  name: 'test',
  async *synth(text, cancelled) {
    await wait(40);
    if (cancelled()) return;
    const words = text.split(/\s+/).filter(Boolean).length;
    yield { pcm: tone(Math.max(200, words * 300)), rate: RATE };
  },
};

// ── a phone ─────────────────────────────────────────────────────────────────
async function phone(peer, device, { mode = 'talk', engine = new FakeEngine(), greeting, chatId } = {}) {
  const client = new RacClient();
  client.connect('127.0.0.1', peer.port, peer.token);
  for (let i = 0; i < 100 && client.status !== 'online'; i++) await wait(20);
  await client.call('hello', { device_name: device, lang: 'tr' });
  const events = [];
  const told = [];
  client.on((ev) => { if (ev.event?.startsWith('voice.')) events.push({ ...ev, at: Date.now() }); });
  const realTell = client.tell.bind(client);
  client.tell = (type, data) => { if (type !== 'voice.audio') told.push({ type, data, at: Date.now() }); return realTell(type, data); };
  const calls = [];
  const realCall = client.call.bind(client);
  client.call = (type, data, ms) => { calls.push({ type, data, at: Date.now() }); return realCall(type, data, ms); };
  const wire = {
    call: (t, d, ms) => client.call(t, d, ms), tell: (t, d) => client.tell(t, d),
    on: (l) => client.on(l), onStatus: (l) => client.onStatus(l), online: () => client.status === 'online',
  };
  const s = new VS.VoiceSession({ wire, engine, voice: fakeVoice, log: () => {} });
  const states = [];
  s.subscribe((sn) => { if (states[states.length - 1] !== sn.state) states.push(sn.state); });
  await s.start({ chatId, lang: 'tr-TR', client: { build: 'test', device, mode }, greeting });
  const timeline = path.join(peer.timelines, `${device}.json`);
  const spans = [];
  const p = {
    client, s, engine, events, told, calls, states,
    /** Speak a fixture into the microphone: its words go on the recogniser's timeline first. */
    async say(fx, from = 0) {
      // After whatever is still going into the microphone, so the words land where the audio does.
      while (engine.source.length) await wait(5);
      const off = s.timelineMs();
      for (const sp of fx.spans) spans.push([off + sp.start_ms - from, off + sp.end_ms - from, sp.text]);
      fs.writeFileSync(timeline, JSON.stringify(spans));
      const samples = from ? fx.samples.subarray(Math.round((from * RATE) / 1000)) : fx.samples;
      const began = await engine.say(samples);
      // The first 20 ms frame that is actually voiced (a span starts at its soft consonant, ~100 ms earlier).
      let voiced = 0;
      for (let i = 0; i + 320 <= samples.length; i += 320) {
        if (VS.frameDb(samples, i, i + 320) >= -40) { voiced = (i * 1000) / RATE; break; }
      }
      return { began, onset: began + voiced, spanOnset: began + (fx.spans[0]?.start_ms ?? 0) - from, ms: (samples.length * 1000) / RATE };
    },
    async until(pred, ms = 20000) {
      for (let t = 0; t < ms; t += 20) { if (pred()) return true; await wait(20); }
      return pred();
    },
    of: (name) => events.filter((e) => e.event === name),
    async close() { await s.stop(); client.disconnect(); },
  };
  return p;
}

const turnOf = (id) => Number(String(id).split(':')[0]);

/** No piece of a turn handed to the player after that turn was cancelled or a newer turn began. */
function staleFree(p) {
  for (const pl of p.engine.plays) {
    const turn = turnOf(pl.id);
    if (turn === 0) continue;
    const cancelled = p.events.find((e) => e.event === 'voice.cancel' && e.data.turn_id === turn);
    const newer = p.events.find((e) => (e.data.turn_id ?? 0) > turn);
    const bargeAt = p.s.barges.find((b) => b.turn === turn)?.stopped;
    for (const at of [cancelled?.at, newer?.at, bargeAt]) if (at != null && pl.t > at + 5) return `${pl.id} played ${pl.t - at} ms after its turn ended`;
  }
  return null;
}

// ── the peer ────────────────────────────────────────────────────────────────
function python() {
  const cands = [process.env.PY, path.join(os.homedir(), 'projects/divan/daemon/.venv312/bin/python'), 'python3'];
  return cands.find((c) => c && (c === 'python3' || fs.existsSync(c)));
}

function startPeer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(python(), [path.join(repo, 'daemon/scripts/voice_peer.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (line) resolve({ ...JSON.parse(line), proc });
    });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('exit', (code) => reject(new Error(`voice_peer exited ${code}: ${err.slice(-800)}`)));
  });
}

function fixtures(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const out = {};
  for (const f of m.fixtures) out[f.id] = { ...f, samples: readWav(path.join(dir, `${f.id}.wav`)) };
  return { voice: m.voice, fx: out };
}

const SPEECH = ['short-greeting', 'short-status', 'long-request', 'pause-500', 'pause-1000', 'pause-1500',
  'pause-2000', 'two-pauses', 'correction', 'correction-pause', 'tech-names', 'tech-agents'];

// ── 1 · the replay set, one phone per scenario, all at once ─────────────────
async function replay(peer, fx) {
  const phones = {};
  for (const id of [...SPEECH, 'silence']) phones[id] = await phone(peer, `replay-${id}`);
  await wait(300);
  await Promise.all(Object.entries(phones).map(([id, p]) => p.say(fx[id])));
  const longest = Math.max(...Object.keys(phones).map((id) => fx[id].duration_ms));
  await wait(longest + 1500);
  await Promise.all(Object.values(phones).map((p) => p.until(() => p.s.state === 'listening' && !p.s.playingNow(), 8000)));

  const whole = [], played = [], streamed = [], stale = [], statesOk = [], measured = [];
  for (const id of SPEECH) {
    const p = phones[id];
    const want = norm(fx[id].spans.map((sp) => sp.text).join(' '));
    const turns = p.of('voice.turn').filter((e) => norm(e.data.committed_text));
    if (turns.length !== 1 || norm(turns[0].data.committed_text) !== want) whole.push(`${id}: ${JSON.stringify(turns.map((e) => e.data.committed_text))}`);
    const tid = turns[0]?.data.turn_id;
    const says = p.of('voice.say').filter((e) => e.data.turn_id === tid);
    const lastSay = says.find((e) => e.data.last);
    const first = p.engine.plays.find((pl) => turnOf(pl.id) === tid);
    const tm = p.s.timings.get(tid);
    if (!first || !tm?.firstAudible) played.push(id);
    else if (!lastSay || !(tm.firstAudible < lastSay.at)) streamed.push(`${id}: audible ${tm.firstAudible - (lastSay?.at ?? 0)} ms vs last piece`);
    if (tm?.endToAudible != null) measured.push(tm.endToAudible);
    const bad = staleFree(p);
    if (bad) stale.push(`${id}: ${bad}`);
    // The screen's state is the daemon's: every state it showed came from a voice.state, in that order.
    const daemonStates = p.of('voice.state').map((e) => e.data.state).filter((s, i, a) => s !== a[i - 1]);
    const shown = p.states.filter((s) => s !== 'idle' && s !== 'starting');
    if (JSON.stringify(shown) !== JSON.stringify(['listening', ...daemonStates.filter((s, i) => !(i === 0 && s === 'listening'))])
        || !['hearing', 'thinking', 'speaking'].every((s) => shown.includes(s))) statesOk.push(`${id}: ${shown.join('>')} vs ${daemonStates.join('>')}`);
  }
  const quiet = phones.silence;
  check(`replay: every Turkish utterance — long, corrected, with 0.5–2 s thinking pauses — commits once and whole, never clipped (${SPEECH.length}/${SPEECH.length}) ${whole.join('; ')}`, !whole.length);
  check(`replay: silence stays silence — no transcript, no turn, nothing said or played (${quiet.of('voice.transcript').length}/${quiet.of('voice.turn').length}/${quiet.of('voice.say').length}/${quiet.engine.plays.length})`,
    !quiet.of('voice.transcript').length && !quiet.of('voice.turn').length && !quiet.of('voice.say').length && !quiet.engine.plays.length);
  check(`replay: each answer is heard before its last piece has arrived — streamed, not whole ${played.concat(streamed).join('; ')}`, !played.length && !streamed.length);
  check(`replay: no chunk of a cancelled or superseded turn is played (early replies on the pause scenarios dropped) ${stale.join('; ')}`, !stale.length);
  check(`replay: the screen's states are the session's voice.state events, through listening, hearing, thinking and speaking ${statesOk.join('; ')}`, !statesOk.length);
  const sum = VS.latencySummary(SPEECH.flatMap((id) => [...phones[id].s.timings.values()]));
  check(`replay: speech end → first audible is measured on the phone's clock for every committed turn (n=${sum.n}, median ${sum.median} ms, p95 ${sum.p95} ms)`,
    sum.n === SPEECH.length && sum.median > 0);
  check('replay: the clock offset to the daemon is measured with voice.ping',
    SPEECH.every((id) => phones[id].s.clockOffset() && Math.abs(phones[id].s.clockOffset().ms) < 1000));
  report.replay = { endToAudibleMs: measured, summary: sum, note: 'stand-in recogniser and fast layer, fake 40 ms voice: protocol and phone timing only' };
  await Promise.all(Object.values(phones).map((p) => p.close()));
}

// ── 2 · barge-in over a long answer, speaker-mode echo, then a route change ──
async function barge(peer, fx) {
  const p = await phone(peer, 'barge', { mode: 'slow' });
  try {
    await p.say(fx['short-status']);
    await p.until(() => p.engine.plays.length >= 3 && p.s.playingNow(), 15000);
    await wait(1200);                                  // well into the answer, echo going into the microphone
    const before = { barges: p.s.barges.length, hearing: p.of('voice.state').filter((e) => e.data.state === 'hearing').length };
    const answered = turnOf(p.engine.plays[p.engine.plays.length - 1].id);
    const cut = await p.say(fx['short-greeting']);     // "Merhaba…" over the answer
    await p.until(() => p.s.barges.length > before.barges, 3000);
    const b = p.s.barges[before.barges];
    const flushAt = p.engine.flushes.find((t) => t >= cut.onset - 50);
    const budget = flushAt != null ? flushAt - cut.onset : null;
    await p.until(() => p.of('voice.turn').some((e) => norm(e.data.committed_text) === norm(fx['short-greeting'].spans[0].text)), 12000);
    await p.until(() => p.s.state === 'listening' && !p.s.playingNow(), 10000);
    check(`barge-in: no barge and no new turn from the reply's own echo at ${ECHO_DB} dB before the caller spoke`,
      before.barges === 0 && before.hearing === 1);
    check(`barge-in: the player stops ${budget} ms after the caller's voice starts (≤ 300 ms; ${flushAt - cut.spanOnset} ms from the start of the word's span; detection → stop ${b ? b.stopped - b.detected : '–'} ms)`,
      b && budget != null && budget <= 300 && b.turn === answered);
    const told = p.told.find((t) => t.type === 'voice.barge');
    check(`barge-in: voice.barge carries the turn and what was heard of it (${told ? told.data.played_ms : '–'} ms), the daemon cancels that turn`,
      told && told.data.turn_id === answered && told.data.played_ms > 0
      && p.events.some((e) => e.event === 'voice.cancel' && e.data.turn_id === answered && e.data.reason === 'barge'));
    const turns = p.of('voice.turn').map((e) => norm(e.data.committed_text));
    check(`barge-in: the cut-in is captured whole as the next turn and the reply's echo never becomes one — ${JSON.stringify(turns)}`,
      turns.length === 2 && turns[1] === norm(fx['short-greeting'].spans[0].text));
    const bad = staleFree(p);
    check(`barge-in: nothing of the interrupted answer is played after the stop ${bad || ''}`, !bad
      && !p.told.some((t) => t.type === 'voice.playback' && t.data.turn_id === answered && t.data.state === 'started' && t.at > b.stopped));
    report.barge = { onsetToStopMs: budget, spanOnsetToStopMs: flushAt - cut.spanOnset, detectToStopMs: b ? b.stopped - b.detected : null, playedMs: told?.data.played_ms };

    // A headset goes in while an answer is playing. The engine rebuilds itself the way VoiceEngine.swift
    // does: the player is emptied with no done, and all that is said is route 'rebuilt'.
    const starts = p.s.starts.length;
    const stops = p.engine.stopCount;
    await p.say(fx['short-status']);
    await p.until(() => p.s.playingNow(), 12000);
    const playing = p.s.playingNow();
    const routeTurn = turnOf(p.engine.plays[p.engine.plays.length - 1].id);
    const rebuiltAt = Date.now();
    p.engine.rebuild();
    const quietNow = !p.s.playingNow();
    const stoppedTold = p.told.some((t) => t.type === 'voice.playback' && t.data.turn_id === routeTurn
      && t.data.state === 'stopped' && t.at >= rebuiltAt);
    await p.until(() => p.s.state === 'listening', 8000);
    const settled = p.s.state;
    const turnsBefore = p.of('voice.turn').length;
    await wait(300);
    await p.say(fx['short-greeting']);
    await p.until(() => p.of('voice.turn').length > turnsBefore, 12000);
    const last = p.of('voice.turn').slice(-1)[0];
    check(`route change (engine rebuilt mid-answer, no done from the player): the piece is reported stopped, nothing counts as playing, the daemon leaves "speaking" (${settled}), the same session hears the next utterance, no second voice.start (${p.s.starts.length - starts} new)`,
      playing && quietNow && stoppedTold && settled === 'listening' && p.s.starts.length === starts
      && p.engine.stopCount === stops && p.engine.running()
      && norm(last?.data.committed_text) === norm(fx['short-greeting'].spans[0].text));
    // The engine dying outright (media services reset) is taken back by the phone itself.
    p.engine.emit({ kind: 'failed', reason: 'media services were reset' });
    await p.until(() => p.engine.running() && p.engine.stopCount > stops, 2000);
    check('engine failure: released and started again in the same session, no second voice.start',
      p.engine.running() && p.engine.stopCount > stops && p.s.starts.length === starts);
  } finally { await p.close(); }
}

// ── 3 · interruption, background and foreground, hang-up, permission ────────
async function resources(peer, fx) {
  const p = await phone(peer, 'resources', { greeting: 'Alo, dinliyorum.' });
  try {
    await p.until(() => p.told.some((t) => t.type === 'voice.playback' && t.data.turn_id === 0 && t.data.state === 'done'), 5000);
    check('greeting: said by the phone on the call\'s own player, reported as turn 0, and voice.ready sent once it was audible',
      p.engine.plays.some((pl) => pl.id.startsWith('0:')) && p.told.filter((t) => t.type === 'voice.ready').length === 1
      && p.told.find((t) => t.type === 'voice.ready').at <= p.told.find((t) => t.type === 'voice.playback' && t.data.state === 'started').at + 5);
    await wait(500);
    check('greeting: its echo is not heard as a turn', !p.of('voice.turn').length && !p.of('voice.state').some((e) => e.data.state === 'hearing'));

    // A phone call takes the audio session; it comes back.
    p.engine.emit({ kind: 'interruption', began: true });
    const releasedOnInterrupt = !p.engine.running();
    p.engine.emit({ kind: 'interruption', began: false });
    await p.until(() => p.engine.running(), 2000);
    // In the background iOS stopped the engine; the app comes to the front.
    p.engine.stop();
    await p.s.foreground();
    const back = p.engine.running();
    await p.say(fx['short-greeting']);
    await p.until(() => p.of('voice.turn').length === 1, 12000);
    check(`interruption and foreground: the microphone is let go and taken back, the same session hears the next utterance, one voice.start (${p.calls.filter((c) => c.type === 'voice.start').length})`,
      releasedOnInterrupt && back && p.calls.filter((c) => c.type === 'voice.start').length === 1
      && norm(p.of('voice.turn')[0].data.committed_text) === norm(fx['short-greeting'].spans[0].text));

    // The socket drops in the middle of an answer and comes back.
    await p.until(() => p.s.playingNow(), 8000);
    const sid = p.s.sessionId;
    const dropTurn = p.s.snapshot().turn;
    p.client.ws.close();
    await p.until(() => p.s.state === 'reconnecting', 2000);
    const playsAtDrop = p.engine.plays.length;
    const flushedAtDrop = p.engine.flushes.length > 0;
    await p.until(() => p.s.starts.length === 2 && p.s.state !== 'reconnecting', 8000);
    await wait(600);
    check(`reconnect: "reconnecting" while the socket is down, the session resumed by id (${JSON.stringify(p.s.starts.map((s) => s.resumed))}), nothing of the interrupted answer replayed`,
      flushedAtDrop && p.s.sessionId === sid && p.s.starts[1]?.resumed === true
      && p.engine.plays.slice(playsAtDrop).every((pl) => turnOf(pl.id) > dropTurn) && p.states.includes('reconnecting'));

    // Hang up.
    const stopped = await p.s.stop();
    const sent = p.told.length;
    await wait(300);
    check(`hang-up: microphone and player released at once, voice.stop answered with the session's timings (${stopped?.turns?.length} turns), a second hang-up does nothing`,
      !p.engine.running() && stopped?.ok && Array.isArray(stopped.turns) && (await p.s.stop()) === null && p.told.length === sent
      && p.s.state === 'ended');
  } finally { p.client.disconnect(); }

  // Permission denied: nothing is opened on the daemon and nothing is held on the phone.
  const denied = new FakeEngine({ denied: true });
  const q = await phone(peer, 'denied', { engine: denied });
  check(`permission denied: the call ends as "denied" without a voice.start and holds no microphone (${q.calls.filter((c) => c.type === 'voice.start').length} starts)`,
    q.s.snapshot().ended === 'denied' && !q.calls.some((c) => c.type === 'voice.start') && !denied.running());
  q.client.disconnect();

  // Starting twice is one session.
  const r = await phone(peer, 'twice');
  await r.s.start({ lang: 'tr-TR', client: { build: 'test', device: 'twice' } });
  check('a second start on a call that is up does not open a second session',
    r.calls.filter((c) => c.type === 'voice.start').length === 1);
  await r.close();
}

// ── pure parts ──────────────────────────────────────────────────────────────
function units() {
  const d = new VS.BargeDetector();
  let fired = false;
  for (let i = 0; i < 100; i++) fired = d.feed(-38 + (i % 3)) || fired;     // a loud echo, a long one
  const bar = d.threshold();
  let n = 0;
  while (!d.feed(-18) && n < 50) n++;
  check(`barge detector: a −38 dBFS echo raises its bar to ${bar.toFixed(1)} dB and never fires; the caller at −18 dBFS fires after ${(n + 1) * VS.FRAME_MS} ms`,
    !fired && bar > -30 && (n + 1) * VS.FRAME_MS === VS.BARGE_MS);
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
  check('base64 both ways matches Node\'s', VS.toBase64(bytes) === Buffer.from(bytes).toString('base64')
    && Buffer.compare(Buffer.from(VS.fromBase64(Buffer.from(bytes).toString('base64'))), Buffer.from(bytes)) === 0);
}

/** The whole run; `test-ustabasi.cjs` and `test-call-live.cjs` share the harness above without it. */
const run = () => (async () => {
  units();
  const py = python();
  let peer;
  try {
    peer = await startPeer();
  } catch (e) {
    const name = `voice session: SKIP, no daemon to drive (${String(e.message).slice(0, 160)})`;
    checks.push([name, !process.argv.includes('--require-daemon')]);
    return;
  }
  try {
    const { voice, fx } = fixtures(peer.fixtures);
    report.fixtures = { dir: peer.fixtures, voice, python: py };
    await replay(peer, fx);
    await barge(peer, fx);
    await resources(peer, fx);
  } catch (e) {
    checks.push([`voice session: ${e.stack || e}`, false]);
  } finally {
    peer.proc.stdin.end();
    await new Promise((r) => { peer.proc.on('exit', r); setTimeout(r, 5000); });
  }
  const at = process.argv.indexOf('--json');
  if (at > 0) fs.writeFileSync(process.argv[at + 1], JSON.stringify({ ...report, simulated_audio: true }, null, 1));
})();

module.exports = { checks, run, FakeEngine, fakeVoice, startPeer, fixtures, wait, norm };

if (require.main === module) {
  void run().then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
