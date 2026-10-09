#!/usr/bin/env node
/** A ticket a chat filed, opened in the chat from the keyboard, in a real browser.
 *
 *     CHROME=/path/to/chrome node scripts/test-filed-ui.mjs
 *
 *  `npm test` (`test-drive.mjs`) presses the entry inside the whole panel in
 *  jsdom; jsdom does not turn a key into a button press, and it has no layout,
 *  so the keyboard and the narrow chat are checked here. With USTABASI_SHOTS set
 *  it leaves `filed-ticket-card.png` there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'filed-ui');

const CHROMES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  console.error('no browser found — set CHROME to one');
  process.exit(2);
}

// ── build the page ──────────────────────────────────────────────────────────

mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/filed-harness.tsx',
  '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`, '--loader:.css=css',
  '--define:process.env.NODE_ENV="development"',
  // timeline.ts reaches fleet.ts, whose dev-only branch reads import.meta.env.
  '--define:import.meta.env={"DEV":false}',
  '--log-level=warning',
], { cwd: web, stdio: 'inherit' });

writeFileSync(join(out, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<title>Filed harness</title><link rel="stylesheet" href="./harness.css"><style>'
  + 'html,body,#root{height:100%;margin:0;'
  + 'font-family:-apple-system,system-ui,sans-serif}</style></head>'
  + '<body><div id="root"></div><script src="./harness.js"></script></body></html>');

// ── drive it ────────────────────────────────────────────────────────────────

const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'chrome-profile'),
  '--window-size=1000,760', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const endpoint = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
  browser.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); done(m[0]); }
  });
  browser.on('exit', (code) => { clearTimeout(timer); fail(new Error(`the browser stopped (${code})`)); });
});

const ws = new WebSocket(endpoint);
await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });

let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  const w = waiting.get(msg.id);
  if (!w) return;
  waiting.delete(msg.id);
  msg.error ? w.fail(new Error(msg.error.message)) : w.done(msg.result);
};
const cdp = (method, params = {}, sessionId) => new Promise((done, fail) => {
  const n = ++id;
  waiting.set(n, { done, fail });
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => cdp(method, params, sessionId);

/** Run an expression in the page and hand back what it evaluated to. */
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

/** One key, pressed and let go, at whatever has focus. */
async function press(key) {
  const k = key === 'Enter'
    ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }
    : { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' };
  await page('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', ...k, text: undefined });
  await evaluate('await new Promise((r) => setTimeout(r, 80));');
}

const state = () => evaluate(`
  const entry = document.querySelector('.dv-cardlink[data-ticket="177"]');
  const card = document.querySelector('[data-ticket-card="177"]');
  const go = card && card.querySelector('button[data-go-details="177"]');
  const chat = document.querySelector('[data-chat]').getBoundingClientRect();
  const box = card && card.getBoundingClientRect();
  return {
    entries: document.querySelectorAll('.dv-cardlink[data-ticket="177"]').length,
    expanded: entry.getAttribute('aria-expanded'), card: card ? card.innerText : null,
    go: go ? go.innerText : null, entryFocused: document.activeElement === entry,
    goFocused: !!go && document.activeElement === go, opened: window.opened.slice(), at: location.href,
    fits: !box || (box.left >= chat.left - 0.5 && box.right <= chat.right + 0.5),
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
`);

async function load(width) {
  await page('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 2, mobile: false });
  await page('Page.navigate', { url: `file://${join(out, 'harness.html')}` });
  const up = await evaluate(`
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('.dv-cardlink')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  `);
  if (!up) throw new Error('the harness did not come up');
}

try {
  await page('Page.enable');
  await load(1000);
  const start = await evaluate('return location.href;');

  console.log('── closed, it is one entry');
  let s = await state();
  ok('#177 is drawn once, closed', s.entries === 1 && s.expanded === 'false' && s.card === null, JSON.stringify(s));

  console.log('── the keyboard');
  await evaluate(`document.querySelector('.dv-cardlink[data-ticket="177"]').focus();`);
  await press('Enter');
  s = await state();
  ok('Enter opens the card in the chat and leaves the page where it was',
    s.expanded === 'true' && s.entryFocused && s.at === start && s.opened.length === 0, JSON.stringify(s));
  ok('the card names #177 and its title',
    s.card.includes('#177') && s.card.includes('Show pending agent questions as a floating chat on the dashboard'), s.card);
  ok('…and nothing the agent was told', !s.card.includes('worker opus') && !s.card.includes('ustabasi'), s.card);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  s = await state();
  ok('Tab reaches Go details', s.goFocused && s.go === 'Go details', JSON.stringify(s));
  await press('Enter');
  s = await state();
  ok('Enter on Go details asks for #177 and nothing else', JSON.stringify(s.opened) === '[177]', JSON.stringify(s.opened));
  await evaluate(`document.querySelector('.dv-cardlink[data-ticket="177"]').focus();`);
  await press(' ');
  s = await state();
  ok('Space on the entry folds the card away', s.expanded === 'false' && s.card === null, JSON.stringify(s));
  await press(' ');
  s = await state();
  ok('and Space opens it again', s.expanded === 'true' && !!s.card);

  console.log('── an ordinary link');
  const plain = await evaluate(`
    const a = [...document.querySelectorAll('a')].find((x) => x.textContent === 'here');
    return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null;
  `);
  ok('a link in the answer is still a link that opens its page',
    plain?.href === 'https://example.com/notes' && plain?.target === '_blank', JSON.stringify(plain));

  console.log('── a narrow chat');
  await load(340);
  await evaluate(`document.querySelector('.dv-cardlink[data-ticket="177"]').click(); await new Promise((r) => setTimeout(r, 100));`);
  s = await state();
  ok('the card sits inside a 340px chat without scrolling it sideways', !!s.card && s.fits && !s.sideways, JSON.stringify(s));
  if (process.env.USTABASI_SHOTS) {
    await load(560);
    await evaluate(`document.querySelector('.dv-cardlink[data-ticket="177"]').click(); await new Promise((r) => setTimeout(r, 150));`);
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.USTABASI_SHOTS, 'filed-ticket-card.png'), Buffer.from(shot.data, 'base64'));
    console.log(`  · picture in ${process.env.USTABASI_SHOTS}/filed-ticket-card.png`);
  }
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
