/** EMA on the phone, checked without one.
 *
 *  1. The pipeline the app runs — the TypeScript frontend, `src/tts/engine.ts`
 *     on onnxruntime-node instead of onnxruntime-react-native, the same
 *     `ortRuntime` — on every sentence of tts/vectors.json, against the PyTorch
 *     reference audio in tts/reference/. Needs tts/models/ and tts/reference/,
 *     which `tts/verify.sh` builds; without them this part says SKIP, and
 *     `--require-models` makes that a failure.
 *  2. Who speaks: Turkish with EMA ready is EMA, everything else expo-speech,
 *     and an EMA that throws or is silent for 1.5 s hands the answer over.
 *  3. stopSpeaking() mid-answer: nothing more is made or played, onDone once.
 *  4. A three-sentence answer is heard before its last sentence is made.
 *  5. A build without the model files or without onnxruntime's native module
 *     loads, says EMA is unavailable, and reads Turkish with expo-speech.
 *
 *  Run alone: node scripts/test-ema.cjs [--require-models]  — folded into test-ustabasi.cjs.
 */
const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
if (!require.extensions['.ts']) {
  require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
}
const E = require(path.join(root, 'src/tts/engine.ts'));
const F = require(path.join(root, 'src/tts/frontend.ts'));
const S = require(path.join(root, 'src/tts/speaker.ts'));

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fakes ───────────────────────────────────────────────────────────────────

/** Timers the test moves by hand. */
function clock() {
  let now = 0, next = 1;
  const pending = new Map();
  return {
    setTimeout: (f, ms) => { const h = next++; pending.set(h, { at: now + ms, f }); return h; },
    clearTimeout: (h) => { pending.delete(h); },
    now: () => now,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].f();
      }
      now = until;
    },
  };
}

/** An EMA whose pieces finish when the test says so (or at once with `auto`). Logs every step. */
function fakeEma(log, { auto = true, fail = null, ready = true } = {}) {
  const waiting = [];
  return {
    waiting,
    ready: () => ready,
    prepare: (text) => E.prepare(text),
    synthesise(spoken, o) {
      const i = o.seed;
      log.push(`synth ${i}`);
      if (fail === 'throw') return Promise.reject(new Error('boom'));
      if (fail === 'hang') return new Promise(() => {});
      return new Promise((resolve, reject) => {
        const finish = () => {
          if (o.cancelled()) { log.push(`cancelled ${i}`); reject(new E.Cancelled()); return; }
          log.push(`made ${i}`);
          resolve(new Float32Array(4800));
        };
        if (auto) setTimeout(finish, 0); else waiting.push(finish);
      });
    },
  };
}

function fakePlayer(log) {
  let n = 0;
  return {
    enqueue: () => log.push(`play ${n++}`),
    finish: (f) => { log.push('finish'); setTimeout(f, 0); },
    stop: () => log.push('player stop'),
  };
}

/** expo-speech as the speaker sees it: done a moment after it starts, or on stop. */
function fakeSystem(log) {
  let pending = null;
  return {
    speak: (text, lang, onDone) => { log.push(`system ${lang} ${text}`); pending = onDone; setTimeout(() => pending && pending(), 5); },
    stop: () => { const p = pending; pending = null; if (p) setTimeout(p, 0); },
  };
}

function speaker(log, ema, extra = {}) {
  return S.createSpeaker({
    ema: () => ema, enabled: () => true, player: () => fakePlayer(log), system: fakeSystem(log), ...extra,
  });
}

// ── loading voice.ts and ema.ts with the phone stood in for ──────────────────

const VOICE = path.join(root, 'src/voice.ts');
const EMA = path.join(root, 'src/ema.ts');

/** `file` compiled and run with a `require` of its own: what it asks for by name is
 *  `mocks[name]` (an Error is thrown, as a missing native module throws), its
 *  neighbours voice.ts and ema.ts come from the same scenario, anything else is
 *  the real module. Not Module._load: other test files swap that in and out
 *  while this one is still running, and ema.ts requires onnxruntime late, in
 *  warm(), not at import. */
function loadWith(file, mocks, loaded = new Map()) {
  if (loaded.has(file)) return loaded.get(file).exports;
  const code = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code;
  const mod = { exports: {} };
  loaded.set(file, mod);
  const req = (request) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      const m = mocks[request];
      if (m instanceof Error) throw m;
      return m;
    }
    if (request.startsWith('.')) {
      const target = path.resolve(path.dirname(file), request);
      if (target + '.ts' === VOICE || target + '.ts' === EMA) return loadWith(target + '.ts', mocks, loaded);
      return require(fs.existsSync(target + '.ts') ? target + '.ts' : target);
    }
    return require(request);
  };
  // their own console too: what voice.ts logs about timings is for a phone's log, not this one's
  const quiet = { ...console, log() {}, warn() {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', 'console', code)(mod.exports, req, mod, file, path.dirname(file), quiet);
  return mod.exports;
}

const loadVoice = (mocks) => loadWith(VOICE, mocks);

function phone(log, { files = true, ort = null, ema = undefined } = {}) {
  const spoken = [];
  const next = {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-speech': {
      speak: (text, o) => { spoken.push(text); log.push(`expo-speech ${o.language} ${text}`); setTimeout(() => o.onDone && o.onDone(), 5); },
      stop: () => log.push('expo-speech stop'),
      getAvailableVoicesAsync: async () => [],
      VoiceQuality: { Enhanced: 'Enhanced', Default: 'Default' },
    },
    'expo-audio': { createAudioPlayer: () => ({ play() {}, pause() {}, remove() {}, addListener() {} }) },
    '@jamsch/expo-speech-recognition': {
      ExpoSpeechRecognitionModule: { setCategoryIOS: (o) => log.push(`session ${o.category} ${o.mode}`), start() {}, stop() {}, abort() {} },
    },
    'expo-localization': { getLocales: () => [{ languageTag: 'tr-TR' }] },
    'expo-file-system': {
      Paths: { bundle: { uri: 'file:///App.app/' }, cache: {} },
      File: class { constructor(dir, name) { this.uri = 'file:///App.app/' + name; this.exists = files; } write() {} delete() {} },
    },
    'onnxruntime-react-native': ort ?? new TypeError("Cannot read property 'install' of undefined"),
  };
  if (ema !== undefined) next['./ema'] = ema;
  return { voice: loadVoice(next), spoken };
}

/** The native glue as voice.ts sees it, with EMA loaded (or not) and a fake player. */
function emaModule(log, emaFake) {
  return {
    available: () => !!emaFake, ready: () => !!emaFake, status: () => ({}),
    warm: async () => !!emaFake, voice: () => emaFake, player: (session) => { session(); return fakePlayer(log); },
  };
}

const THREE = 'Derleme bitti. İki test kırmızı. Yarın sabah tekrar bakarım.';

// ── 1. the pipeline against the reference ───────────────────────────────────

function npy(file) {
  const b = fs.readFileSync(file);
  const header = b.readUInt16LE(8);
  const body = b.subarray(10 + header);
  return new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length));
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return ab / Math.sqrt(aa * bb + 1e-30);
}

const MODELS = path.join(repo, 'tts/models');
const REFERENCE = path.join(repo, 'tts/reference');
const requireModels = process.argv.includes('--require-models');

async function pipeline() {
  const vectors = JSON.parse(fs.readFileSync(path.join(repo, 'tts/vectors.json'), 'utf8'));
  let ort = null;
  try { ort = require('onnxruntime-node'); } catch {}
  const have = ort && E.STAGES.every((s) => fs.existsSync(path.join(MODELS, `${s}.onnx`)))
    && fs.existsSync(path.join(REFERENCE, '00.npy'));
  if (!have) {
    const why = !ort ? 'onnxruntime-node is not installed' : 'tts/models or tts/reference missing (run tts/verify.sh)';
    console.log(`  SKIP  ema pipeline vs reference: ${why}`);
    if (requireModels) check(`ema pipeline vs reference: ${why}`, false);
    return null;
  }
  const engine = new E.Engine(E.ortRuntime(ort, (s) => path.join(MODELS, `${s}.onnx`)));
  await engine.load();
  const worst = { corr: 1, frames: 0 };
  let made = 0, spent = 0;
  for (const [i, s] of vectors.sentences.entries()) {
    const pieces = E.prepare(s.text);
    const t = Date.now();
    const audio = await engine.synthesise(pieces[0].text, { seed: s.seed });
    spent += Date.now() - t;
    made += audio.length / E.RATE;
    const ref = npy(path.join(REFERENCE, `${String(i).padStart(2, '0')}.npy`));
    const frames = Math.abs(audio.length / E.HOP - ref.length / E.HOP);
    const corr = correlation(audio, ref);
    worst.corr = Math.min(worst.corr, corr);
    worst.frames = Math.max(worst.frames, frames);
    check(`ema pipeline: "${s.text.slice(0, 40)}" is one piece, read as the vectors read it`,
      pieces.length === 1 && pieces[0].text === s.spoken);
    check(`ema pipeline: #${i} ${audio.length / E.HOP} frames vs ${ref.length / E.HOP}, correlation ${corr.toFixed(4)} (> 0.98, within 1 frame)`,
      frames <= 1 && corr > 0.98);
  }
  console.log(`  ema: ${vectors.sentences.length} sentences, worst correlation ${worst.corr.toFixed(4)}, ` +
    `load ${engine.timings.loadMs} ms + warm ${engine.timings.warmMs} ms, RTF ${(spent / 1000 / made).toFixed(3)} on this machine`);
  return engine;
}

// ── the rest ────────────────────────────────────────────────────────────────

async function run() {
  // what the phone says itself on a call: the call's language, never a butler
  {
    const L = require(path.join(root, 'src/call-lines.ts'));
    const all = (lang) => {
      const l = L.callLines(lang);
      return [l.greeting, l.quiet, l.working(2), l.blocked(1), L.headline(lang, { working: 2, blocked: 1 }), L.headline(lang, { working: 0, blocked: 0 })];
    };
    check('call lines: tr-TR answers Alo and says the headline in Turkish', JSON.stringify(all('tr-TR')) === JSON.stringify(
      ['Alo.', 'Her şey sakin.', '2 iş çalışıyor.', '1 iş seni bekliyor.', '1 iş seni bekliyor. 2 iş çalışıyor.', 'Her şey sakin.']));
    check('call lines: en-US answers Hello and says the headline in English', JSON.stringify(all('en-US')) === JSON.stringify(
      ['Hello.', 'All quiet here.', '2 running.', '1 waiting on you.', '1 waiting on you. 2 running.', 'All quiet here.']));
    check('call lines: no line in any language is a butler\'s (service, sir, efendim)',
      ['tr-TR', 'en-US', 'en-GB', 'de-DE'].flatMap(all).every((t) => !/service|\bsir\b|efendim/i.test(t)));
  }

  // host steps against the Python, exactly
  {
    const vectors = JSON.parse(fs.readFileSync(path.join(repo, 'tts/vectors.json'), 'utf8'));
    const crypto = require('crypto');
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('ema host: the noise is common.noise to the bit (sha256 of every sentence’s)', vectors.sentences.every((s) =>
      crypto.createHash('sha256').update(Buffer.from(E.noise(s.seed, s.frames).buffer)).digest('hex') === s.noise_sha256));
    check('ema host: words() and plan() give the vectors’ cw, wstart and frames per word', vectors.sentences.every((s) => {
      const w = E.words(s.spoken);
      return same(w.cw, s.cw) && same(w.wstart, s.wstart) && same(E.plan(s.dur, s.cw).wordFrames, s.word_frames);
    }));
    const p = E.prepare(THREE);
    check('ema: a three-sentence answer is three pieces, a sentence pause between them, none after',
      p.length === 3 && p[0].pause === 0.25 && p[1].pause === 0.25 && p[2].pause === 0);
  }

  const engine = await pipeline();

  // ── 2. who speaks ─────────────────────────────────────────────────────────
  {
    const log = [];
    const sp = speaker(log, fakeEma(log));
    let done = 0;
    sp.speak('Merhaba.', 'tr-TR', () => done++);
    // Until it is done rather than a fixed 20 ms: the whole suite runs other
    // screens beside this, and a busy loop can hold a 0 ms timer past 20 ms.
    for (let i = 0; i < 100 && !done; i++) await wait(20);
    check('who speaks: Turkish with EMA ready is EMA, not expo-speech',
      log.includes('synth 0') && log.includes('play 0') && !log.some((l) => l.startsWith('system')) && done === 1);
  }
  for (const [name, lang, ema, enabled] of [
    ['Turkish with EMA missing', 'tr-TR', null, true],
    ['Turkish with EMA not loaded yet', 'tr-TR', 'notready', true],
    ['Turkish with EMA switched off', 'tr-TR', 'ok', false],
    ['English', 'en-GB', 'ok', true],
    ['German', 'de-DE', 'ok', true],
  ]) {
    const log = [];
    const e = ema === null ? null : fakeEma(log, { ready: ema === 'ok' });
    const sp = speaker(log, e, { enabled: () => enabled });
    let done = 0;
    sp.speak('Merhaba.', lang, () => done++);
    for (let i = 0; i < 100 && !done; i++) await wait(20);
    check(`who speaks: ${name} is expo-speech`, log[0] === `system ${lang} Merhaba.` && !log.some((l) => l.startsWith('synth')) && done === 1);
  }
  {
    const log = [];
    const sp = speaker(log, fakeEma(log, { fail: 'throw' }));
    let done = 0;
    sp.speak(THREE, 'tr-TR', () => done++);
    await wait(30);
    check('who speaks: EMA throwing on the first piece hands the whole answer to expo-speech, onDone once',
      log.includes(`system tr-TR ${THREE}`) && !log.some((l) => /^play \d/.test(l)) && done === 1);
  }
  {
    const log = [];
    const t = clock();
    const ema = fakeEma(log, { fail: 'hang' });
    const sp = speaker(log, ema, { timers: t });
    let done = 0;
    sp.speak('Merhaba.', 'tr-TR', () => done++);
    await tick();
    t.advance(1499);
    const before = log.some((l) => l.startsWith('system'));
    t.advance(1);
    await wait(20);
    check('who speaks: no audio from EMA in 1.5 s (and not before) is expo-speech, onDone once',
      !before && log.includes('system tr-TR Merhaba.') && log.includes('player stop') && done === 1
      && sp.stats().fellBack === 'no audio in 1500 ms');
  }
  {
    // slow, not stuck: the piece arrives after the system voice took over and must not be played
    const log = [];
    const t = clock();
    const ema = fakeEma(log, { auto: false });
    const sp = speaker(log, ema, { timers: t });
    let done = 0;
    sp.speak('Merhaba.', 'tr-TR', () => done++);
    await tick();
    t.advance(1500);
    ema.waiting.forEach((f) => f());
    await wait(20);
    check('who speaks: a piece finished after the 1.5 s fallback is thrown away, not played over expo-speech',
      log.includes('system tr-TR Merhaba.') && !log.some((l) => /^play \d/.test(l)) && done === 1);
  }
  {
    // the wiring in voice.ts: the same choice through speak()
    const log = [];
    const { voice, spoken } = phone(log, { ema: emaModule(log, fakeEma(log)) });
    let a = 0, b = 0;
    voice.speak('Merhaba.', 'tr-TR', () => a++);
    await wait(20);
    voice.speak('Hello there.', 'en-GB', () => b++);
    await wait(20);
    check('voice.speak: Turkish goes to EMA in the call’s session (playAndRecord, voiceChat)',
      log.includes('session playAndRecord voiceChat') && log.includes('play 0') && !spoken.includes('Merhaba.') && a === 1);
    check('voice.speak: English goes to expo-speech', spoken.includes('Hello there.') && b === 1);
    check('voice.voiceName: the Turkish voice is called EMA when it is there', voice.voiceName('tr-TR') === 'EMA');
    voice.setEmaEnabled(false);
    check('voice.voiceName: and not when it is switched off', voice.voiceName('tr-TR') !== 'EMA');
  }

  // ── 3. stop mid-answer ───────────────────────────────────────────────────
  {
    const log = [];
    const ema = fakeEma(log, { auto: false });
    const { voice } = phone(log, { ema: emaModule(log, ema) });
    let done = 0;
    voice.speak(THREE, 'tr-TR', () => done++);
    await tick();
    ema.waiting.shift()();           // piece 0 made and played
    await tick();
    const playing = log.includes('play 0') && log.includes('synth 1');
    voice.stopSpeaking();
    const at = log.length;
    ema.waiting.forEach((f) => f()); // piece 1 finishes after the stop
    await wait(30);
    voice.stopSpeaking();            // a second stop (hang-up after cut-in) changes nothing
    await wait(10);
    const after = log.slice(at);
    check('stopSpeaking mid-answer: the player is stopped at once',
      playing && log.slice(0, at).includes('player stop'));
    check('stopSpeaking mid-answer: no piece is played and no new piece is started after it',
      !after.some((l) => /^(play|synth) \d/.test(l)) && !log.includes('made 1'));
    check('stopSpeaking mid-answer: onDone is called once, and not by the stop call itself', done === 1);
    check('stopSpeaking mid-answer: expo-speech is not called to finish it', !log.some((l) => l.startsWith('expo-speech tr')));
  }
  {
    // the call's tap: stop, then straight into listening — onDone must land after that, not inside stop
    const log = [];
    const { voice } = phone(log, { ema: emaModule(log, fakeEma(log, { auto: false })) });
    let done = 0;
    voice.speak(THREE, 'tr-TR', () => done++);
    voice.stopSpeaking();
    const sync = done;
    await wait(10);
    check('stopSpeaking: onDone comes after the caller has moved on, as expo-speech’s onStopped does', sync === 0 && done === 1);
  }

  // ── 4. heard before it is all made ───────────────────────────────────────
  {
    const log = [];
    const sp = speaker(log, fakeEma(log));
    let done = 0;
    sp.speak(THREE, 'tr-TR', () => done++);
    await wait(30);
    const at = (s) => log.indexOf(s);
    check(`three sentences: the first is handed to the player before the last is made (${log.join(', ')})`,
      at('play 0') >= 0 && at('play 0') < at('synth 2') && at('play 0') < at('made 2') && at('play 2') < at('finish') && done === 1);
  }
  if (engine) {
    // the same with the real engine on onnxruntime-node
    const log = [];
    const real = {
      ready: () => true,
      prepare: (t) => E.prepare(t),
      synthesise: async (spoken, o) => { log.push(`synth ${o.seed}`); const a = await engine.synthesise(spoken, o); log.push(`made ${o.seed}`); return a; },
    };
    let done = 0;
    const sp = speaker(log, real);
    sp.speak(THREE, 'tr-TR', () => done++);
    for (let i = 0; i < 300 && !done; i++) await wait(20);
    check('three sentences, real engine: the first piece is played before the last is made',
      log.indexOf('play 0') >= 0 && log.indexOf('play 0') < log.indexOf('synth 2') && log.includes('play 2') && done === 1);
  }

  // ── 5. a build without the model ─────────────────────────────────────────
  {
    const log = [];
    let voice, threw = null;
    try { ({ voice } = phone(log, { files: false })); } catch (e) { threw = e; }
    check('no model files: voice.ts and ema.ts load without throwing', !threw);
    if (voice) {
      const warmed = await voice.warmEma();
      let done = 0;
      voice.speak('Merhaba.', 'tr-TR', () => done++);
      await wait(20);
      check('no model files: EMA reports unavailable and warming says no',
        voice.emaAvailable() === false && warmed === false && voice.emaStats().ready === false);
      check('no model files: Turkish is read by expo-speech', log.some((l) => l === 'expo-speech tr-TR Merhaba.') && done === 1);
      check('no model files: the Turkish voice is not called EMA', voice.voiceName('tr-TR') !== 'EMA');
    }
  }
  {
    const log = [];
    const { voice } = phone(log, { files: true });   // files, but onnxruntime's native module is missing
    const before = voice.emaAvailable();
    const warmed = await voice.warmEma();
    let done = 0;
    voice.speak('Merhaba.', 'tr-TR', () => done++);
    await wait(20);
    check('no native onnxruntime: warming fails quietly, EMA turns unavailable, Turkish is expo-speech',
      before === true && warmed === false && voice.emaAvailable() === false && /install/.test(voice.emaStats().failure || '')
      && log.includes('expo-speech tr-TR Merhaba.') && done === 1);
  }

  // the player: pieces in order, one drain, nothing left behind
  {
    const created = [], removed = [], deleted = [];
    const mods = {
      'react-native': { Platform: { OS: 'ios' } },
      'expo-file-system': {
        Paths: { bundle: {}, cache: {} },
        File: class { constructor(d, n) { this.uri = 'file:///c/' + n; } write(b) { this.size = b.length; } delete() { deleted.push(this.uri); } },
      },
      'expo-audio': {
        createAudioPlayer: (src) => {
          const p = { src, playedAt: null, listener: null, play() { p.playedAt = Date.now(); }, pause() {}, remove() { removed.push(src.uri); }, addListener(_, f) { p.listener = f; } };
          created.push(p);
          return p;
        },
      },
    };
    const M = loadWith(EMA, mods);
    let sessions = 0, drained = 0;
    const pl = M.player(() => sessions++);
    pl.enqueue(new Float32Array(480), 0.25);    // 10 ms + 250 ms of pause
    pl.enqueue(new Float32Array(480), 0);
    pl.finish(() => drained++);
    await wait(60);
    const startedSecondEarly = created[1].playedAt === null;
    await wait(200);
    const secondStarted = created[1].playedAt !== null;
    created[0].listener({ didJustFinish: true });
    created[1].listener({ didJustFinish: true });
    await wait(10);
    const w = M.wav(new Float32Array([0, 1, -1]), 0.001);
    check('player: the second piece starts inside the first one’s pause, not before',
      startedSecondEarly && secondStarted && created[1].playedAt - created[0].playedAt < 260);
    check('player: the session is set once, it drains once, every player and file is removed',
      sessions === 1 && drained === 1 && removed.length === 2 && deleted.length === 2);
    check('player: a piece is a 16-bit 48 kHz mono WAV with its pause in it',
      String.fromCharCode(...w.slice(0, 4)) === 'RIFF' && new DataView(w.buffer).getUint32(24, true) === 48000
      && w.length === 44 + 2 * (3 + 48) && new DataView(w.buffer).getInt16(46, true) === 32767);
    const p2 = M.player(() => {});
    pl.stop();
    p2.enqueue(new Float32Array(480), 0);
    p2.stop();
    p2.enqueue(new Float32Array(480), 0);
    check('player: stop removes what it had and takes nothing after', created.length === 3 && removed.length === 3);
  }
}

const ready = run().catch((e) => { check(`ema tests ran to the end: ${e && e.stack}`, false); });

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
