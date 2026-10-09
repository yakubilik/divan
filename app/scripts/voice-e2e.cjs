/** The live call end to end, on real models, without the phone: what #151 measures.
 *
 *    node scripts/voice-e2e.cjs --account-home ~/.remote-ai-chat/accounts/<claude-id> \
 *        [--rounds 2] [--barges 3] [--agent] [--out ../docs/voice-bench/e2e.json] [--audio /tmp/divan-voice-e2e]
 *
 *  The phone is `src/voice-session.ts` — the code the call screen runs — over the app's socket client,
 *  speaking with the app's own EMA pipeline (`src/tts/engine.ts` on onnxruntime-node, wrapped by
 *  `emaVoice`, the function the call uses on the phone). The daemon is an isolated one
 *  (`daemon/scripts/voice_peer.py --real`: own RAC_HOME and loopback port) with the daemon's whisper and
 *  the real fast layer (Haiku through the Claude Code CLI on the given, already signed-in account). The
 *  running daemon is never touched.
 *
 *  What is still simulated: the microphone and speaker. The engine is `FakeEngine` from
 *  test-voice-session.cjs: it releases the bench's synthetic Turkish fixtures (the Mac's Yelda voice,
 *  no recording of a person) in 50 ms frames, mixed with what it plays at −24 dB (the echo left after
 *  cancellation that the bench assumed), and it plays in real time. Every piece it plays is kept, so each
 *  answer is written out as the WAV the caller would have heard, with its real gaps.
 *
 *  With `--agent` it runs the long-task part instead: a chat call into a real Claude agent (same account)
 *  in a throwaway project whose build takes ~30 s; a correction, a status question while it works,
 *  progress, and the finished turn spoken.
 *
 *  Needs: the daemon's Python with mlx-whisper (PY, else ~/projects/remote-ai-chat/daemon/.venv312),
 *  tts/models (TTS_MODELS, else this checkout's, else ~/projects/remote-ai-chat/tts/models), `npm ci`.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./test-voice-session.cjs');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
const VS = require(path.join(root, 'src/voice-session.ts'));
const E = require(path.join(root, 'src/tts/engine.ts'));
const { RacClient } = require(path.join(root, 'src/ws.ts'));

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const ACCOUNT_HOME = arg('--account-home');
const ROUNDS = Number(arg('--rounds', 2));
const BARGES = Number(arg('--barges', 3));
const AGENT = process.argv.includes('--agent');
const OUT = arg('--out', path.join(repo, 'docs/voice-bench', AGENT ? 'e2e-agent.json' : 'e2e.json'));
const AUDIO = arg('--audio', '/tmp/divan-voice-e2e');
const { wait, norm } = T;
const checks = [];
const check = (name, ok, detail = '') => { checks.push([name, !!ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`); };

const SPEECH = ['short-greeting', 'short-status', 'long-request', 'pause-500', 'pause-1000', 'pause-1500',
  'pause-2000', 'two-pauses', 'correction', 'correction-pause', 'tech-names', 'tech-agents'];

// ── models ──────────────────────────────────────────────────────────────────
function python() {
  return [process.env.PY, path.join(os.homedir(), 'projects/remote-ai-chat/daemon/.venv312/bin/python')]
    .find((c) => c && fs.existsSync(c)) || 'python3';
}

function models() {
  return [process.env.TTS_MODELS, path.join(repo, 'tts/models'), path.join(os.homedir(), 'projects/remote-ai-chat/tts/models')]
    .find((d) => d && E.STAGES.every((s) => fs.existsSync(path.join(d, `${s}.onnx`))));
}

async function ema() {
  const dir = models();
  if (!dir) throw new Error('no tts/models (TTS_MODELS, tts/verify.sh)');
  const ort = require('onnxruntime-node');
  const engine = new E.Engine(E.ortRuntime(ort, (s) => path.join(dir, `${s}.onnx`)));
  const t = await engine.load();
  const timings = [];
  const synth = {
    prepare: (text) => E.prepare(text),
    async synthesise(spoken, o) {
      const t0 = Date.now();
      const a = await engine.synthesise(spoken, o);
      timings.push({ spoken, ms: Date.now() - t0, audio_ms: Math.round((a.length / E.RATE) * 1000) });
      return a;
    },
  };
  return { voice: VS.emaVoice(synth, E.RATE), timings, load: t, dir };
}

function startPeer(extra) {
  return new Promise((resolve, reject) => {
    const proc = spawn(python(), [path.join(repo, 'daemon/scripts/voice_peer.py'), '--real', '--account-home', ACCOUNT_HOME, ...extra],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (line) resolve({ ...JSON.parse(line), proc, stderr: () => err });
    });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('exit', (code) => reject(new Error(`voice_peer exited ${code}: ${err.slice(-1500)}`)));
  });
}

// ── an engine that keeps what it played ─────────────────────────────────────
class RecordingEngine extends T.FakeEngine {
  constructor() {
    super();
    this.items = new Map();                      // id -> { pcm, rate, started, done }
    this.on((e) => {
      if (e.kind !== 'playback') return;
      const it = this.items.get(e.id);
      if (it) it[e.state] = e.t_ms;
    });
  }
  play(id, pcm, rate) {
    this.items.set(id, { id, pcm, rate, queued: Date.now(), started: null, done: null });
    super.play(id, pcm, rate);
  }
}

const turnOf = (id) => Number(String(id).split(':')[0]);

/** One answer as the caller heard it: every piece at the moment it started, silence where nothing played. */
function heard(engine, turn) {
  const items = [...engine.items.values()].filter((it) => turnOf(it.id) === turn && it.started != null);
  if (!items.length) return null;
  const rate = items[0].rate;
  const t0 = items[0].started;
  const end = Math.max(...items.map((it) => (it.started - t0) / 1000 * rate + it.pcm.length));
  const out = new Int16Array(Math.ceil(end));
  const gaps = [], clicks = [];
  let prev = null;
  for (const it of items) {
    const at = Math.round(((it.started - t0) / 1000) * rate);
    out.set(it.pcm.subarray(0, Math.min(it.pcm.length, out.length - at)), at);
    if (prev) {
      const gap = it.started - (prev.done ?? prev.started);
      if (gap > 60) gaps.push(gap);
    }
    // An edge that jumps from or to silence is a click; EMA's pieces should fade in and out.
    const edge = Math.max(Math.abs(it.pcm[0] || 0), Math.abs(it.pcm[it.pcm.length - 1] || 0)) / 32768;
    let jump = 0;
    for (let i = 1; i < it.pcm.length; i++) jump = Math.max(jump, Math.abs(it.pcm[i] - it.pcm[i - 1]));
    if (edge > 0.05 || jump / 32768 > 0.9) clicks.push({ id: it.id, edge: +edge.toFixed(3), jump: +(jump / 32768).toFixed(3) });
    prev = it;
  }
  return { pcm: out, rate, gaps, clicks, pieces: items.length };
}

function writeWav(file, pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(b, 44);
  fs.writeFileSync(file, b);
}

// ── a phone ─────────────────────────────────────────────────────────────────
async function phone(peer, device, voice, { chatId } = {}) {
  const client = new RacClient();
  client.connect('127.0.0.1', peer.port, peer.token);
  for (let i = 0; i < 100 && client.status !== 'online'; i++) await wait(20);
  await client.call('hello', { device_name: device, lang: 'tr' });
  const events = [], all = [];
  client.on((ev) => { all.push({ ...ev, at: Date.now() }); if (ev.event?.startsWith('voice.')) events.push({ ...ev, at: Date.now() }); });
  const engine = new RecordingEngine();
  const wire = {
    call: (t, d, ms) => client.call(t, d, ms), tell: (t, d) => client.tell(t, d),
    on: (l) => client.on(l), onStatus: (l) => client.onStatus(l), online: () => client.status === 'online',
  };
  const lines = [];
  const s = new VS.VoiceSession({ wire, engine, voice, log: (l) => lines.push(l) });
  await s.start({ chatId, lang: 'tr-TR', client: { build: 'e2e', device } });
  return {
    client, s, engine, events, all, lines,
    of: (name) => events.filter((e) => e.event === name),
    async say(fx) {
      while (engine.source.length) await wait(5);
      const began = await engine.say(fx.samples);
      return { began, speechEnd: fx.speech_end_ms != null ? began + fx.speech_end_ms : null, ms: fx.duration_ms };
    },
    async until(pred, ms) { for (let t = 0; t < ms; t += 25) { if (pred()) return true; await wait(25); } return pred(); },
    async close() { await s.stop(); client.disconnect(); },
  };
}

/** Word error rate pooled over (reference, hypothesis) pairs, on the same normalisation as the checks. */
function pooledWer(pairs) {
  let errs = 0, words = 0;
  for (const [ref, hyp] of pairs) {
    const r = norm(ref).split(' ').filter(Boolean), h = norm(hyp).split(' ').filter(Boolean);
    const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
    for (let j = 1; j <= h.length; j++) d[0][j] = j;
    for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    errs += d[r.length][h.length];
    words += r.length;
  }
  return words ? +(errs / words).toFixed(4) : null;
}

const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))] : null; };
const median = (xs) => pct(xs, 0.5);

// ── 1 · the scenario set, in one call, as a person would make it ────────────
async function conversation(peer, fx, v) {
  const p = await phone(peer, 'e2e', v.voice);
  await wait(6000);                                // the call's greeting: models load, the CLI warms
  const warm = await p.say(fx['short-greeting']);   // the call's cold first turn: kept apart from the stats
  await p.until(() => p.of('voice.turn').length >= 1, 20000);
  const coldTid = p.of('voice.turn')[0]?.data.turn_id;
  const coldPlay = [...p.engine.items.values()].find((it) => turnOf(it.id) === coldTid && it.started != null);
  const cold = { turn_id: coldTid, true_end_to_audible_ms: coldPlay && warm.speechEnd ? Math.round(coldPlay.started - warm.speechEnd) : null,
    timings: coldTid != null ? (p.s.timings.get(coldTid) ?? null) : null };
  await p.until(() => p.s.state === 'listening' && !p.s.playingNow(), 20000);
  await wait(1500);
  const rows = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (const id of [...SPEECH, 'silence']) {
      const n0 = p.events.length;
      const turnsBefore = p.of('voice.turn').length;
      const info = await p.say(fx[id]);
      if (fx[id].reference) await p.until(() => p.of('voice.turn').length > turnsBefore, 25000);
      else await wait(4000);
      await p.until(() => ['listening', 'working'].includes(p.s.state) && !p.s.playingNow(), 25000);
      await wait(1000);
      const ev = p.events.slice(n0);
      const turns = ev.filter((e) => e.event === 'voice.turn');
      const turn = turns[turns.length - 1];
      const tid = turn?.data.turn_id;
      const says = ev.filter((e) => e.event === 'voice.say' && e.data.turn_id === tid && e.data.text);
      const partial = ev.filter((e) => e.event === 'voice.transcript' && !e.data.final && e.data.turn_id === tid);
      const tm = tid != null ? p.s.timings.get(tid) : null;
      const firstPlay = [...p.engine.items.values()].find((it) => turnOf(it.id) === tid && it.started != null);
      const h = tid != null ? heard(p.engine, tid) : null;
      const wav = h ? path.join(AUDIO, `r${r}-${id}.wav`) : null;
      if (h) writeWav(wav, h.pcm, h.rate);
      const row = {
        id, round: r, reference: fx[id].reference,
        turns: turns.length, committed: turn?.data.committed_text ?? '', routed: turn?.data.routed ?? null,
        fast_transcript: partial.length ? partial[partial.length - 1].data.text : '',
        cancels: ev.filter((e) => e.event === 'voice.cancel').map((e) => e.data.reason),
        said: says.map((e) => e.data.text).join(' '), kinds: [...new Set(says.map((e) => e.data.kind))],
        // On the phone's clock: the daemon's speech end (from the turn's timeline position) → first
        // audible, and the fixture's own speech end (ground truth) → the same audible start.
        end_to_audible_ms: tm?.endToAudible ?? null,
        true_end_to_audible_ms: firstPlay && info.speechEnd ? Math.round(firstPlay.started - info.speechEnd) : null,
        first_say_ms: says.length && info.speechEnd ? says[0].at - info.speechEnd : null,
        errors: ev.filter((e) => e.event === 'voice.error').map((e) => e.data),
        audio: h ? { wav, gaps_ms: h.gaps, clicks: h.clicks, pieces: h.pieces } : null,
      };
      rows.push(row);
      console.log(`  r${r} ${id.padEnd(17)} audible ${String(row.true_end_to_audible_ms).padStart(5)} ms  turns ${row.turns}  ` +
        `cancels ${JSON.stringify(row.cancels)}  routed ${row.routed}  said: ${row.said.slice(0, 70)}`);
    }
  }
  const report = p.s.timingReport();
  const stop = await p.s.stop();
  p.client.disconnect();
  return { rows, report, daemonTurns: stop?.turns ?? [], warm, cold };
}

// ── 2 · barge-in on real answers ────────────────────────────────────────────
async function barges(peer, fx, v) {
  const p = await phone(peer, 'e2e-barge', v.voice);
  await wait(5000);
  const out = [];
  const asks = ['tech-agents', 'two-pauses', 'short-status', 'pause-2000'];
  for (let i = 0; i < BARGES; i++) {
    const ask = asks[i % asks.length];
    const before = { barges: p.s.barges.length, turns: p.of('voice.turn').length };
    await p.say(fx[ask]);
    const playing = await p.until(() => p.s.playingNow(), 25000);
    if (!playing) { out.push({ ask, error: 'no answer played' }); continue; }
    await wait(400);                                // into the answer, its echo in the microphone
    const answered = p.s.snapshot().turn;
    const cut = await p.say(fx['short-greeting']);   // "selam nasılsın", over the answer
    await p.until(() => p.s.barges.length > before.barges, 3000);
    const b = p.s.barges[before.barges];
    // Voiced onset of the cut-in: the first 20 ms frame of the fixture at −40 dBFS or more.
    let voiced = 0;
    const smp = fx['short-greeting'].samples;
    for (let k = 0; k + 320 <= smp.length; k += 320) if (VS.frameDb(smp, k, k + 320) >= -40) { voiced = (k * 1000) / VS.RATE; break; }
    const flushAt = p.engine.flushes.find((t) => t >= cut.began + voiced - 50);
    await p.until(() => p.of('voice.turn').length >= before.turns + 2, 25000);
    await p.until(() => p.s.state === 'listening' && !p.s.playingNow(), 25000);
    await wait(800);
    const turns = p.of('voice.turn').slice(before.turns);
    const late = [...p.engine.items.values()].filter((it) => turnOf(it.id) === answered && it.started != null && b && it.started > b.stopped + 5);
    out.push({
      ask, answered_turn: answered, barged: !!b,
      onset_to_stop_ms: flushAt != null ? Math.round(flushAt - (cut.began + voiced)) : null,
      detect_to_stop_ms: b ? b.stopped - b.detected : null, played_ms: b?.playedMs ?? null,
      committed: turns.map((e) => e.data.committed_text), played_after_stop: late.length,
    });
    console.log(`  barge ${i}: ${JSON.stringify(out[out.length - 1])}`);
  }
  await p.close();
  return out;
}

// ── 3 · a real agent doing a long task, on a chat call ──────────────────────
const BUILD_SH = `#!/bin/sh
# A stand-in build for the voice bench: slow on purpose, harmless.
echo "compiling..."; sleep 30; echo "build ok: 12 modules"
`;
const TEST_SH = `#!/bin/sh
echo "running tests..."; sleep 5; echo "tests ok: 8 passed"
`;

async function agentCall(peer, fx, v) {
  const proj = path.join(peer.projects, 'app');
  fs.writeFileSync(path.join(proj, 'README.md'),
    '# Sample app\n\nBuild with `sh build.sh` (takes about half a minute). Run the tests with `sh test.sh`.\n');
  fs.writeFileSync(path.join(proj, 'build.sh'), BUILD_SH);
  fs.writeFileSync(path.join(proj, 'test.sh'), TEST_SH);
  const admin = new RacClient();
  admin.connect('127.0.0.1', peer.port, peer.token);
  for (let i = 0; i < 100 && admin.status !== 'online'; i++) await wait(20);
  await admin.call('hello', { device_name: 'e2e-admin', lang: 'tr' });
  let chat;
  try {
    chat = await admin.call('chat.create', { provider: 'claude', cwd: proj, account_id: peer.account, model: 'sonnet' });
  } catch {
    chat = await admin.call('chat.create', { provider: 'claude', cwd: proj, account_id: peer.account });
  }
  const chatsBefore = (await admin.call('chat.list', {})).chats.length;
  const p = await phone(peer, 'e2e-agent', v.voice, { chatId: chat.id });
  await wait(5000);
  const t0 = Date.now();
  const req = await p.say(fx['correction-pause']);   // "testleri çalıştır, hayır dur, önce derlemeyi bitir"
  await p.until(() => p.of('voice.turn').length >= 1, 25000);
  const routedTurn = p.of('voice.turn')[0];
  const firstAudible = [...p.engine.items.values()].find((it) => turnOf(it.id) === routedTurn?.data.turn_id && it.started);
  const forwarded = routedTurn?.data.routed === `chat:${chat.id}`;
  if (forwarded) await p.until(() => p.all.some((e) => e.event === 'tool.use' && e.chat_id === chat.id), 60000);
  await wait(4000);
  // While it builds: a question about it, answered from the chat's state without waiting for the agent.
  const turnsBefore = p.of('voice.turn').length;
  const q = await p.say(fx['short-status']);          // "testler bitti mi"
  await p.until(() => p.of('voice.turn').length > turnsBefore, 25000);
  await p.until(() => !p.s.playingNow() && p.s.state !== 'speaking', 20000);
  const qTurn = p.of('voice.turn')[turnsBefore];
  const qSays = p.of('voice.say').filter((e) => e.data.turn_id === qTurn?.data.turn_id && e.data.text);
  const qPlay = [...p.engine.items.values()].find((it) => turnOf(it.id) === qTurn?.data.turn_id && it.started);
  const statusDuring = (await admin.call('chat.get', { chat_id: chat.id })).chat.status;
  const done = forwarded && await p.until(() => p.all.some((e) => e.event === 'turn.done' && e.chat_id === chat.id), 240000);
  const doneAt = p.all.find((e) => e.event === 'turn.done' && e.chat_id === chat.id)?.at;
  await p.until(() => p.of('voice.say').some((e) => e.at >= (doneAt ?? Infinity) && e.data.kind === 'reply'), 15000);
  await p.until(() => !p.s.playingNow(), 30000);
  await wait(1000);
  const got = await admin.call('chat.get', { chat_id: chat.id });
  const users = got.events.filter((e) => e.event === 'message.user').map((e) => e.data.text);
  const tools = got.events.filter((e) => e.event === 'tool.use').map((e) => ({ tool: e.data.tool, input: JSON.stringify(e.data.input ?? e.data.preview ?? '').slice(0, 120) }));
  const spoken = p.of('voice.say').filter((e) => e.data.text).map((e) => ({ at_s: +((e.at - t0) / 1000).toFixed(1), kind: e.data.kind, turn: e.data.turn_id, text: e.data.text }));
  const chatsAfter = (await admin.call('chat.list', {})).chats.length;
  const h = heard(p.engine, p.of('voice.say').filter((e) => e.at >= (doneAt ?? Infinity)).map((e) => e.data.turn_id)[0]);
  if (h) writeWav(path.join(AUDIO, 'agent-done.wav'), h.pcm, h.rate);
  const result = {
    chat: { id: chat.id, model: chat.model, perm_mode: chat.perm_mode, account: chat.account_id },
    request: { committed: routedTurn?.data.committed_text, routed: routedTurn?.data.routed,
      audible_after_speech_end_ms: firstAudible && req.speechEnd ? Math.round(firstAudible.started - req.speechEnd) : null },
    status_question: { committed: qTurn?.data.committed_text, routed: qTurn?.data.routed, said: qSays.map((e) => e.data.text).join(' '),
      audible_after_speech_end_ms: qPlay && q.speechEnd ? Math.round(qPlay.started - q.speechEnd) : null, chat_status_then: statusDuring },
    finished: !!done, turn_done_after_request_s: doneAt ? +((doneAt - t0) / 1000).toFixed(1) : null,
    users, tools, spoken, chats_made: chatsAfter - chatsBefore,
  };
  console.log(JSON.stringify(result, null, 1));
  await p.close();
  admin.disconnect();
  return result;
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  if (!ACCOUNT_HOME) { console.error('--account-home is required'); process.exit(2); }
  fs.mkdirSync(AUDIO, { recursive: true });
  const v = await ema();
  console.log(`ema: ${v.dir}, loaded ${v.load.loadMs} ms, warmed ${v.load.warmMs} ms`);
  const peer = await startPeer(AGENT ? ['--agent'] : []);
  const { fx } = T.fixtures(peer.fixtures);
  const result = { generated: new Date().toISOString(), simulated: 'microphone and speaker (FakeEngine, −24 dB echo); everything else real' };
  try {
    if (AGENT) {
      result.agent = await agentCall(peer, fx, v);
      const a = result.agent;
      check(`agent: the corrected request reached the chat once and whole (${JSON.stringify(a.users)})`,
        a.users.length === 1 && norm(a.users[0]) === norm(fx['correction-pause'].reference), JSON.stringify(a.users));
      check('agent: no other chat was made', a.chats_made === 0);
      check(`agent: the status question was answered while the chat was ${a.status_question.chat_status_then}, ` +
        `${a.status_question.audible_after_speech_end_ms} ms after speech end, not routed to the chat`,
        a.status_question.routed === 'conversation' && a.status_question.said && a.status_question.audible_after_speech_end_ms < 5000);
      check('agent: the finished turn was spoken after turn.done', a.finished && a.spoken.some((s) => s.kind === 'reply' && s.at_s >= a.turn_done_after_request_s - 0.05));
    } else {
      result.conversation = await conversation(peer, fx, v);
      result.barges = await barges(peer, fx, v);
      const rows = result.conversation.rows;
      const speech = rows.filter((x) => x.reference);
      const simple = speech.filter((x) => x.routed === 'conversation');
      const lat = (xs, k) => xs.map((x) => x[k]).filter((n) => n != null);
      result.summary = {
        utterances: speech.length,
        simple_turns: simple.length,
        true_end_to_audible_ms: { median: median(lat(simple, 'true_end_to_audible_ms')), p95: pct(lat(simple, 'true_end_to_audible_ms'), 0.95), n: lat(simple, 'true_end_to_audible_ms').length },
        daemon_end_to_audible_ms: { median: median(lat(simple, 'end_to_audible_ms')), p95: pct(lat(simple, 'end_to_audible_ms'), 0.95) },
        first_say_ms: { median: median(lat(simple, 'first_say_ms')), p95: pct(lat(simple, 'first_say_ms'), 0.95) },
        action_turns_end_to_audible_ms: lat(speech.filter((x) => x.routed !== 'conversation'), 'true_end_to_audible_ms'),
        wer_committed: pooledWer(speech.map((x) => [x.reference, x.committed])),
        wer_fast: pooledWer(speech.map((x) => [x.reference, x.fast_transcript])),
        segmentation_ok: speech.filter((x) => x.turns === 1).length,
        silence_events: rows.filter((x) => !x.reference && (x.turns || x.said)).length,
        errors: rows.reduce((n, x) => n + x.errors.length, 0),
        gaps: speech.flatMap((x) => x.audio?.gaps_ms ?? []),
        clicks: speech.flatMap((x) => x.audio?.clicks ?? []),
        barge_onset_to_stop_ms: result.barges.map((b) => b.onset_to_stop_ms),
        ema_synth: { pieces: v.timings.length, median_ms: median(v.timings.map((t) => t.ms)),
          rtf: +(v.timings.reduce((a, t) => a + t.ms, 0) / Math.max(1, v.timings.reduce((a, t) => a + t.audio_ms, 0))).toFixed(3) },
        voice: v.voice.name,
        cold_first_turn_true_end_to_audible_ms: result.conversation.cold?.true_end_to_audible_ms ?? null,
      };
      result.ema_timings = v.timings;
      const s = result.summary;
      console.log(JSON.stringify(s, null, 1));
      check(`${s.utterances} Turkish utterances, every one committed once and whole (${s.segmentation_ok}/${s.utterances})`, s.utterances >= 20 && s.segmentation_ok === s.utterances);
      check('silence makes no turn and says nothing', s.silence_events === 0);
      check(`barge-in: the player stops within 300 ms of the voice starting (${JSON.stringify(s.barge_onset_to_stop_ms)})`,
        result.barges.length && result.barges.every((b) => b.onset_to_stop_ms != null && b.onset_to_stop_ms <= 300 && b.played_after_stop === 0));
      check(`barge-in: each cut-in is the next turn, whole (${JSON.stringify(result.barges.map((b) => b.committed))})`,
        result.barges.every((b) => b.committed.length === 2 && norm(b.committed[1]) === norm(fx['short-greeting'].reference)));
      check(`Turkish WER of what agents receive ≤ 15% (${(s.wer_committed * 100).toFixed(1)}%)`, s.wer_committed <= 0.15);
      check(`no clicks at piece edges (${s.clicks.length})`, s.clicks.length === 0, JSON.stringify(s.clicks.slice(0, 3)));
    }
  } catch (e) {
    check(`e2e: ${e.stack || e}`, false);
    console.error(peer.stderr().slice(-3000));
  } finally {
    peer.proc.stdin.end();
    await new Promise((r) => { peer.proc.on('exit', r); setTimeout(r, 8000); });
  }
  fs.writeFileSync(OUT, JSON.stringify({ ...result, checks }, null, 1));
  const bad = checks.filter(([, ok]) => !ok).length;
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
})();
