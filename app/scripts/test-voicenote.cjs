/** A voice bubble, checked without a phone: one note plays at a time, a finger
 *  on the waveform seeks where it lands, the speed chip goes round and is
 *  remembered, the time says where it is, and the waveform is drawn whether or
 *  not the daemon measured the sound.
 *  Run: node scripts/test-voicenote.cjs  (also folded into test-ustabasi.cjs.)
 */
const Module = require('module');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const V = require(path.join(root, 'src/voicenote.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A player that records what it was told. */
function fake(name) {
  const log = [];
  return {
    name, log,
    play() { log.push('play'); }, pause() { log.push('pause'); },
    seekTo(s) { log.push(['seek', s]); return Promise.resolve(); },
    setPlaybackRate(r) { log.push(['rate', r]); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── 1. one at a time ────────────────────────────────────────────────────────
{
  const a = fake('a'), b = fake('b');
  V.claim(a);
  checks.push(['the first note started pauses nobody', a.log.length === 0 && V.playingNow() === a]);
  V.claim(b);
  checks.push(['starting a second note pauses the first', eq(a.log, ['pause']) && V.playingNow() === b]);
  V.claim(b);
  checks.push(['starting the one already playing does not pause it', b.log.length === 0]);
  V.release(a);
  checks.push(['the paused one letting go does not free the slot of the one playing', V.playingNow() === b]);
  V.release(b);
  checks.push(['the one playing letting go frees the slot', V.playingNow() === null]);
}

// ── 2. a touch on the waveform ──────────────────────────────────────────────
checks.push(['left edge seeks to 0', V.seekFor(0, 200, 30) === 0]);
checks.push(['right edge seeks to the end', V.seekFor(200, 200, 30) === 30]);
checks.push(['the middle seeks to half', V.seekFor(100, 200, 30) === 15]);
checks.push(['past the left edge holds at 0', V.seekFor(-40, 200, 30) === 0]);
checks.push(['past the right edge holds at the end', V.seekFor(260, 200, 30) === 30]);
checks.push(['no width or no length yet seeks to 0', V.seekFor(50, 0, 30) === 0 && V.seekFor(50, 200, 0) === 0]);
checks.push(['bars up to the playhead are lit', V.playedBars(0, 30, 40) === 0 && V.playedBars(15, 30, 40) === 20
  && V.playedBars(30, 30, 40) === 40 && V.playedBars(0.1, 30, 40) === 1]);

// ── 3. speed ────────────────────────────────────────────────────────────────
checks.push(['the chip goes 1x, 1.5x, 2x and back to 1x',
  eq([V.nextSpeed(1), V.nextSpeed(1.5), V.nextSpeed(2)], [1.5, 2, 1]) && V.speedLabel(1.5) === '1.5x']);
checks.push(['a fresh app run plays at 1x', V.rememberedSpeed() === 1]);

// ── 4. the time under it ────────────────────────────────────────────────────
checks.push(['idle at the start shows the whole length', V.timeLabel(false, 0, 75) === '1:15' && V.phase(false, 0, 75) === 'idle']);
checks.push(['playing shows where it is', V.timeLabel(true, 12, 75) === '0:12' && V.phase(true, 12, 75) === 'playing']);
checks.push(['paused part way shows where it stopped', V.timeLabel(false, 40, 75) === '0:40' && V.phase(false, 40, 75) === 'paused']);
checks.push(['run to the end is idle again, the whole length', V.timeLabel(false, 75, 75) === '1:15' && V.phase(false, 75, 75) === 'idle']);

// ── 5. the waveform's shape ─────────────────────────────────────────────────
{
  const made = V.waveform(undefined, '/u/note.m4a');
  const real = V.waveform([0, 50, 100, 25], '/u/note.m4a');
  checks.push(['no peaks draws the made-up shape, forty bars, the same each time',
    made.length === V.BARS && eq(made, V.waveform([], '/u/note.m4a')) && eq(made, V.bars('/u/note.m4a'))]);
  checks.push(['peaks draw the measured shape, forty bars', real.length === V.BARS
    && real[0] === V.BAR_MIN && real[39] === Math.round(V.BAR_MIN + 0.25 * (V.BAR_MAX - V.BAR_MIN))
    && real[20] === V.BAR_MAX && real[10] > real[0]]);
  checks.push(['every bar fits the waveform', made.concat(real).every((x) => x >= V.BAR_MIN && x <= V.BAR_MAX)]);
}

// ── the bubble itself, with expo-audio stood in for ─────────────────────────
const RN = require('react-native');
const panPrev = RN.PanResponder.create;
let pans = [];
RN.PanResponder.create = (cfg) => { pans.push(cfg); return { panHandlers: {} }; };
let player = null;
let status = { playing: false, currentTime: 0, duration: 30, didJustFinish: false };
const modes = [];
const AUDIO = {
  useAudioPlayer: () => player,
  useAudioPlayerStatus: () => status,
  setAudioModeAsync: (m) => { modes.push(m); return Promise.resolve(); },
};
const box = { __esModule: true, default: () => null };
const MORE = {
  'expo-audio': AUDIO,
  'expo-video': { VideoView: () => null, useVideoPlayer: () => ({}) },
  'expo-video-thumbnails': { getThumbnailAsync: () => Promise.resolve({ uri: '' }) },
  'expo-file-system': { File: class {}, Paths: {} },
  'expo-status-bar': { StatusBar: () => null },
  'expo-sharing': box,
};
const loadPrev = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(MORE, request)) return MORE[request];
  return loadPrev.call(this, request, parent, isMain);
};
const media = require(path.join(root, 'src/components/media.tsx'));

const NOTE = { path: '/u/note.m4a', name: 'note.m4a', kind: 'audio', localUri: 'file:///u/note.m4a', transcript: 'hello there' };
const SILENT = { path: '/u/quiet.m4a', name: 'quiet.m4a', kind: 'audio', localUri: 'file:///u/quiet.m4a' };
const AGENT = { path: '/w/out/reply.mp3', name: 'reply.mp3', kind: 'audio', localUri: 'file:///w/out/reply.mp3', peaks: [10, 100, 40] };

function draw(item, sent, p, s) {
  player = p; pans = [];
  status = { playing: false, currentTime: 0, duration: 30, didJustFinish: false, ...s };
  const html = R.render('light', h(media.VoiceBubble, { item, sent }));
  return { html, presses: R.presses(), pan: pans[pans.length - 1] };
}
const playOf = (d) => d.presses.find((x) => x.text === '');
const bars = (html) => R.styles(html).filter((s) => s.width === 2.5);

async function bubble() {
  // 1 — through the component: the second play pauses the first.
  const a = fake('a'), b = fake('b');
  playOf(draw(NOTE, false, a)).press();
  playOf(draw(AGENT, true, b)).press();
  await tick();
  checks.push(['pressing play on one bubble pauses the one already playing',
    a.log.includes('pause') && b.log.includes('play') && !b.log.includes('pause')]);
  checks.push(['play still asks for sound with the silent switch on',
    modes.length >= 2 && modes.every((m) => m.playsInSilentMode === true)]);
  V.release(a); V.release(b);

  // 2 — a tap and a drag on the waveform call seekTo with the touch's position.
  const W = Math.round(390 * 0.72) - 10 - 14 - 38 - 10;
  const c = fake('c');
  let d = draw(NOTE, false, c);
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: W / 2 } });
  d.pan.onPanResponderRelease({}, { dx: 0, dy: 0 });
  checks.push(['a tap in the middle of the waveform seeks to half', eq(c.log.slice(-1), [['seek', 15]])]);
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: W / 4 } });
  d.pan.onPanResponderMove({}, { dx: W / 2, dy: 3 });
  checks.push(['while the finger is down nothing is seeked', !c.log.some((x) => x[0] === 'seek' && x[1] === 22.5)]);
  d.pan.onPanResponderRelease({}, { dx: W / 2, dy: 3 });
  checks.push(['a drag seeks where it was let go', eq(c.log.slice(-1), [['seek', 22.5]])]);
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: 10 } });
  d.pan.onPanResponderMove({}, { dx: W * 3, dy: 0 });
  d.pan.onPanResponderRelease({}, { dx: W * 3, dy: 0 });
  checks.push(['a drag past the right edge seeks to the end', eq(c.log.slice(-1), [['seek', 30]])]);
  const n = c.log.length;
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: 10 } });
  checks.push(['an upward drag is not claimed from the list',
    d.pan.onMoveShouldSetPanResponder({}, { dx: 2, dy: -30 }) === false && d.pan.onPanResponderTerminationRequest() === true]);
  d.pan.onPanResponderMove({}, { dx: 2, dy: -30 });
  d.pan.onPanResponderRelease({}, { dx: 2, dy: -30 });
  checks.push(['…and seeks nothing', c.log.length === n]);
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: 10 } });
  d.pan.onPanResponderMove({}, { dx: 30, dy: 2 });
  checks.push(['a sideways drag holds on to the finger', d.pan.onPanResponderTerminationRequest() === false]);
  d.pan.onPanResponderRelease({}, { dx: 30, dy: 2 });
  d = draw(NOTE, false, c, { playing: true, currentTime: 6 });
  d.pan.onPanResponderGrant({ nativeEvent: { locationX: 0 } });
  d.pan.onPanResponderRelease({}, { dx: 0, dy: 0 });
  checks.push(['scrubbing works while it plays', eq(c.log.slice(-1), [['seek', 0]]) && !c.log.slice(-2).includes('pause')]);

  // 3 — the chip, and the next bubble picking up its speed.
  const s = fake('s');
  d = draw(NOTE, false, s, { playing: true, currentTime: 6 });
  checks.push(['the chip shows while it plays', d.presses.some((x) => x.text === '1x')]);
  d.presses.find((x) => x.text === '1x').press();
  checks.push(['1x goes to 1.5x on the player', eq(s.log.slice(-1), [['rate', 1.5]]) && V.rememberedSpeed() === 1.5]);
  d = draw(NOTE, false, s, { playing: false, currentTime: 6 });
  checks.push(['the chip shows paused part way, at the speed picked', d.presses.some((x) => x.text === '1.5x')]);
  d.presses.find((x) => x.text === '1.5x').press();
  d = draw(NOTE, false, s, { playing: true, currentTime: 6 });
  d.presses.find((x) => x.text === '2x').press();
  checks.push(['…then 2x, then 1x', eq(s.log.filter((x) => x[0] === 'rate').map((x) => x[1]), [1.5, 2, 1])]);
  d = draw(NOTE, false, s, { playing: true, currentTime: 6 });
  d.presses.find((x) => x.text === '1x').press();
  d = draw(NOTE, false, s, { playing: true, currentTime: 6 });
  d.presses.find((x) => x.text === '1.5x').press();
  checks.push(['the last pick is remembered', V.rememberedSpeed() === 2]);
  const next = fake('next');
  d = draw(AGENT, true, next);
  checks.push(['an idle bubble has no chip', !d.presses.some((x) => /x$/.test(x.text))]);
  playOf(d).press();
  await tick();
  checks.push(['the next bubble started plays at the speed last picked',
    eq(next.log, [['rate', 2], 'play'])]);
  V.release(next); V.release(s);
  V.rememberSpeed(1);

  // 4 — the time under the waveform, as drawn.
  const t = fake('t');
  checks.push(['idle draws the whole length', draw(NOTE, false, t, { duration: 75 }).html.includes('>1:15<')]);
  checks.push(['playing draws where it is', draw(NOTE, false, t, { duration: 75, playing: true, currentTime: 12 }).html.includes('>0:12<')]);
  checks.push(['at the end draws the whole length again', draw(NOTE, false, t, { duration: 75, currentTime: 75 }).html.includes('>1:15<')]);

  // 5 — the waveform is always there; peaks shape it when they came.
  const plain = draw(SILENT, false, fake('p')).html;
  const shaped = draw(AGENT, true, fake('q')).html;
  const heights = (html) => bars(html).map((x) => x.height);
  checks.push(['a note without peaks draws forty bars, transcript or not',
    bars(plain).length === 40 && eq(heights(plain), V.bars(SILENT.path))]);
  checks.push(['a sound with peaks draws them', eq(heights(shaped), V.waveform(AGENT.peaks, AGENT.path))]);
  checks.push(['the bubble is 72% of the screen wide',
    R.styles(plain).some((x) => x.width === Math.round(390 * 0.72) && x.flexDirection === 'row')]);

  // 6 — what sits above and below the waveform.
  const agent = draw(AGENT, true, fake('r')).html;
  const mine = draw(NOTE, false, fake('m')).html;
  const quiet = draw(SILENT, false, fake('n')).html;
  checks.push(["the agent's sound shows its file name", agent.includes('>reply.mp3<')]);
  checks.push(["…and no 'No speech detected' line", !agent.includes('noSpeech') && !agent.includes('noTranscript')]);
  checks.push(["a person's note shows its transcript", mine.includes('“hello there”') && !mine.includes('>note.m4a<')]);
  checks.push(["a silent note still says nothing was heard", quiet.includes('>noSpeech<')]);
}

const ready = bubble().finally(() => {
  RN.PanResponder.create = panPrev;
  Module._load = loadPrev;
  R.store.reset();
});

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
