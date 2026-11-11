#!/usr/bin/env node
/** A ticket in the holding place that stops on a question, in a real browser.
 *
 *     CHROME=/path/to/chrome node scripts/test-asking-unfiled-ui.mjs
 *
 *  The Dashboard on the daemon's own snapshot (`fixtures/unfiled-ask-snapshot.json`)
 *  with nothing seeded into the floating chat: the window must open by itself
 *  with the question whole in it, and an answer typed and sent must be one
 *  `ustabasi.note` on that ticket, with the window still open after it. With
 *  USTABASI_SHOTS set it leaves `dashboard-asking-unfiled.png` there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking-unfiled-ui');
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

// A fresh profile: the floating chat is kept in localStorage, and a thread left
// by the last run would be read back before the page could clear it.
rmSync(join(out, 'profile'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/asking-unfiled-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
writeFileSync(join(out, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}button,input,textarea{font:inherit;color:inherit}</style>'
  + '</head><body><div id="root"></div><script src="./harness.js"></script></body></html>');

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(out, 'profile')}`, '--window-size=1440,900', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
  browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(timer); done(m[0]); } });
});
const ws = new WebSocket(endpoint);
await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  m.error ? w.fail(new Error(m.error.message)) : w.done(m.result);
};
const cdp = (method, params = {}, sessionId) => new Promise((done, fail) => {
  const n = ++id; waiting.set(n, { done, fail }); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});
const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => cdp(m, p, sessionId);
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

const SNAP = JSON.parse(readFileSync(join(web, 'scripts', 'fixtures', 'unfiled-ask-snapshot.json'), 'utf8'));
const ASKING = SNAP.unfiled.find((c) => c.agent_status === 'asking');
const THREAD = `studio:${ASKING.id}`;
const ANSWER = 'example.dev olsun';

try {
  console.log('── dashboard-asking-unfiled (1440×900)');
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await page('Page.navigate', { url: `file://${join(out, 'harness.html')}` });
  const up = await evaluate(`
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('[data-asking-window] [data-panel]')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;`);
  ok('the floating chat opens on the Dashboard by itself', up);
  if (up) {
    const seen = await evaluate(`
      const win = document.querySelector('[data-asking-window]');
      const r = win.querySelector('[data-panel]').getBoundingClientRect();
      return { id: win.getAttribute('data-asking-window'), text: win.textContent,
               onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
               dashboard: !!document.querySelector('h1.dv-greet') };`);
    ok('…on that ticket, wholly on screen, over the Dashboard',
      seen.id === THREAD && seen.onScreen && seen.dashboard, JSON.stringify({ ...seen, text: undefined }));
    ok('the headline counts it: one thing needs you', (await evaluate(`return document.querySelector('[data-summary] [data-said="needs"]').textContent;`)) === '1 thing needs you');
    ok('…with the question whole in it', seen.text.includes(ASKING.agent_detail), seen.text.slice(0, 300));
    if (process.env.USTABASI_SHOTS) {
      await evaluate('await new Promise((r) => setTimeout(r, 200));');
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.USTABASI_SHOTS, 'dashboard-asking-unfiled.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  · picture in ${process.env.USTABASI_SHOTS}/dashboard-asking-unfiled.png`);
    }
    // Typed the way a person types — focus, then the text — and sent the way
    // the box sends: its Enter key (the composer has no button of its own).
    await evaluate(`document.querySelector('[data-asking-window] input[type="text"]').focus();`);
    await page('Input.insertText', { text: ANSWER });
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    const sent = await evaluate(`
      await new Promise((r) => setTimeout(r, 400));
      return { notes: window.__asked.filter((a) => a.type === 'ustabasi.note'),
               open: document.querySelector('[data-asking-window]')?.getAttribute('data-asking-window') ?? null,
               lines: [...document.querySelectorAll('[data-asking-window] [data-asking-line]')].map((e) => e.getAttribute('data-asking-line')) };`);
    ok('pressing send is one ustabasi.note on ticket 348, with the words typed',
      sent.notes.length === 1 && sent.notes[0].key === 'studio' && sent.notes[0].data.id === 348
        && sent.notes[0].data.text === ANSWER, JSON.stringify(sent));
    ok('…and the window stays open, the answer under the question',
      sent.open === THREAD && (sent.lines || []).join(',') === 'agent,you', JSON.stringify(sent));
  }
} finally {
  ws.close();
  // Waited for, so nothing of it is left running when this exits.
  const gone = new Promise((done) => { browser.once('exit', done); setTimeout(done, 5000); });
  browser.kill();
  await gone;
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
