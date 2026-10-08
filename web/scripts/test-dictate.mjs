#!/usr/bin/env node
/** Dictation, above the engines: `src/lib/dictate.ts`.
 *
 *     cd web && npm test
 *
 *  Where a spoken chunk lands in the box, which words the engine is told to
 *  expect, where a stream of samples is cut into phrases, and which engine a
 *  browser gets. The microphone and whisper themselves are not here — they
 *  need a browser and a daemon.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'dictate');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/dictate.ts', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem(k, v) { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const D = await import(pathToFileURL(join(out, 'src/lib/dictate.js')).href);

// ── sound, as far as a segmenter needs it ───────────────────────────────────

/** `seconds` of noise at `level`, in the 128-sample blocks a worklet hands over. */
function blocks(seconds, level, rate = D.RATE) {
  const list = [];
  for (let left = Math.round(seconds * rate); left > 0; left -= 128) {
    const b = new Float32Array(Math.min(128, left));
    for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 2 - 1) * level;
    list.push(b);
  }
  return list;
}
const voice = (s) => blocks(s, 0.2);
const room = (s) => blocks(s, 0.002);

/** Push a take through and return the length of each phrase, in seconds. */
function cut(take, flush = true) {
  const p = new D.Phrases();
  const lens = [];
  for (const b of take) { const ph = p.push(b); if (ph) lens.push(ph.length / D.RATE); }
  if (flush) { const ph = p.flush(); if (ph) lens.push(ph.length / D.RATE); }
  return lens;
}

// ── the checks ──────────────────────────────────────────────────────────────

group('a chunk of speech lands in the sentence');
ok('a phrase takes a space, its punctuation does not',
  D.appendSpeech('Open a branch', 'and push') === 'Open a branch and push'
  && D.appendSpeech('Open a branch', ', then push.') === 'Open a branch, then push.');
ok('a newline somebody typed stays a newline',
  D.appendSpeech('first\n', ' second ') === 'first\nsecond');

group('the engine is told the names on the board');
{
  const words = D.phrasesFor(['isghocam', 'divan']);
  ok('a dashed name is offered whole and as it is said',
    ['isghocam', 'divan', 'remote', 'chat', 'commit'].every((w) => words.includes(w)),
    words.join(' '));
}

group('speech is cut where the speaker pauses');
{
  const lens = cut([...room(1), ...voice(2), ...room(1), ...voice(3), ...room(0.3)], false);
  ok('the pause closes the first phrase while the second is still being said',
    lens.length === 1 && lens[0] > 2 && lens[0] < 2.8, lens.join(' '));
  const all = cut([...room(1), ...voice(2), ...room(1), ...voice(3), ...room(0.3)]);
  ok('stopping hands over the phrase that was open',
    all.length === 2 && all[1] > 3 && all[1] < 3.8, all.join(' '));
}
ok('silence is never sent', cut([...room(5), ...voice(0.05), ...room(3)]).length === 0);
{
  const lens = cut(voice(60));
  ok('somebody who does not pause is still cut inside whisper’s thirty seconds',
    lens.length === 3 && lens.every((l) => l <= 28.01), lens.join(' '));
}
{
  // A fan: the room is as loud as the quiet threshold, and the voice is over it.
  const lens = cut([...blocks(2, 0.02), ...blocks(2, 0.25), ...blocks(1.5, 0.02), ...blocks(2, 0.25)]);
  ok('a noisy room still has pauses in it', lens.length === 2, lens.join(' '));
}

group('a microphone at another rate');
{
  const down = D.resampler(48000);
  const p = new D.Phrases();
  let got = null;
  for (const b of [...blocks(2, 0.2, 48000), ...blocks(1, 0.002, 48000)]) got = p.push(down(b)) ?? got;
  ok('two seconds at 48 kHz are two seconds at 16',
    got && Math.abs(got.length / D.RATE - 2.2) < 0.3, got && String(got.length / D.RATE));
}

group('which engine a browser gets');
{
  const browser = (speech) => {
    globalThis.isSecureContext = true;
    globalThis.AudioWorkletNode = class {};
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia() {} } }, configurable: true,
    });
    globalThis.window = speech ? { SpeechRecognition: class {} } : {};
  };
  browser(true);
  ok('the computer, when it has a transcriber', await D.availability('tr-TR', true) === 'whisper');
  ok('the browser, when the computer has none', await D.availability('tr-TR', false) === 'cloud');
  D.setDictateEngine('browser');
  ok('the browser, when that was the choice', await D.availability('tr-TR', true) === 'cloud');
  browser(false);
  ok('…unless this browser cannot do speech at all', await D.availability('tr-TR', true) === 'whisper');
  ok('a failure that is the browser’s moves the engine, a blocked microphone does not',
    D.fallsBackToWhisper('network') && !D.fallsBackToWhisper('not-allowed'));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
