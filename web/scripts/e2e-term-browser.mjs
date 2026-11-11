#!/usr/bin/env node
/** The Terminal tab against a real daemon, in a real browser, with xterm.js.
 *
 *     node scripts/e2e-term-browser.mjs '<panel url from `divan web --no-open`>' [shot-dir]
 *
 *  Not part of `npm test` — it needs a running daemon and a Chrome. A
 *  throwaway daemon does: build the panel (`npm run build`), then
 *
 *     cd daemon && DIVAN_HOME=/tmp/d DIVAN_PORT=8911 .venv/bin/python -m divan serve --bind 127.0.0.1
 *     DIVAN_HOME=/tmp/d DIVAN_PORT=8911 .venv/bin/python -m divan web --no-open
 *
 *  and set `terminal = true` in /tmp/d/config.toml: a new install starts with
 *  the terminal off, and every `term.*` would answer `terminal_disabled`.
 *
 *  Pressed: Machine › Terminal (a shell opens, the prompt is drawn), `echo hi`
 *  and Enter (`hi` comes back), the window made smaller (`stty size` in the
 *  shell reports the new grid), `+` and the new tab's × (the daemon's log then
 *  says `term … killed: closed`). Leaves `terminal.png` in the shot dir. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panel = process.argv[2];
if (!panel) { console.error('usage: e2e-term-browser.mjs <panel url> [shot-dir]'); process.exit(2); }
const shots = resolve(process.argv[3] || join(web, '.test-build', 'e2e-term'));
const profile = join(web, '.test-build', 'e2e-term', 'profile');
mkdirSync(shots, { recursive: true });
mkdirSync(profile, { recursive: true });
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done) => {
  let buf = '';
  browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) done(m[0]); });
});
const ws = new WebSocket(endpoint);
await new Promise((done) => { ws.onopen = done; });
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m.result ?? m.error); } };
const cdp = (method, params = {}, sessionId) => new Promise((done) => {
  const n = ++id; waiting.set(n, done); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});
const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => cdp(m, p, sessionId);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (expr) => (await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;
async function until(expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await js(expr)) return true; await sleep(200); }
  return false;
}
/** What the shell in front shows, row by row, read off xterm's own buffer. */
const screenText = () => js(`(() => {
  const rows = document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-rows');
  return rows ? [...rows.children].map((r) => r.textContent.replace(/\\u00a0/g, ' ')).join('\\n') : '';
})()`);
async function typeLine(text) {
  await js(`document.querySelector('[data-shell-pane][aria-hidden="false"] textarea')?.focus()`);
  await page('Input.insertText', { text });
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
const setSize = (width, height) => page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

try {
  await setSize(1440, 900);
  const u = new URL(panel);
  await page('Page.navigate', { url: `${u.origin}/machine/machines${u.hash}` });
  ok('the panel came up on Machine', await until(`!!document.querySelector('[aria-label="Machine"]')`));
  await until(`[...document.querySelectorAll('.dv-dot')].length >= 0 && document.body.textContent.length > 100`);
  await sleep(1500);

  await js(`[...document.querySelectorAll('[aria-label="Machine"] button')].find((b) => b.textContent.trim().startsWith('Terminal')).click()`);
  ok('clicking Terminal draws an xterm', await until(`!!document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-rows')`));
  ok('…and the shell’s prompt appears in it', await until(`(() => {
    const r = document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-rows');
    return r && r.textContent.replace(/\\u00a0/g, ' ').trim().length > 0;
  })()`), await screenText());
  await sleep(1500);

  await typeLine('echo hi');
  ok('echo hi + Enter prints hi back', await until(`(() => {
    const r = document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-rows');
    return r && [...r.children].some((l) => l.textContent.replace(/\\u00a0/g, ' ').trim() === 'hi');
  })()`), await screenText());

  await typeLine('clear; stty size');
  await sleep(800);
  const before = (await screenText()).match(/^(\d+) (\d+)\s*$/m);
  await setSize(1000, 700);
  await sleep(800);
  await typeLine('clear; stty size');
  await sleep(800);
  const after = (await screenText()).match(/^(\d+) (\d+)\s*$/m);
  ok('resizing the window resizes the shell’s pty (stty size moves)',
    before && after && (before[1] !== after[1] || before[2] !== after[2]),
    `${before?.[0]} → ${after?.[0]}`);
  const grid = await js(`(() => { const t = document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-screen'); return t ? t.getBoundingClientRect().width : 0; })()`);
  ok('…to the grid xterm drew', !!after && Number(after[2]) > 20, `${after?.[0]} in ${grid}px`);
  await setSize(1440, 900);
  await sleep(800);

  await js(`document.querySelector('button[aria-label="Open another shell"]').click()`);
  ok('+ opens a second tab', await until(`document.querySelectorAll('[role="tab"]').length === 2`));
  ok('…with its own prompt', await until(`(() => {
    const r = document.querySelector('[data-shell-pane][aria-hidden="false"] .xterm-rows');
    return r && r.textContent.replace(/\\u00a0/g, ' ').trim().length > 0;
  })()`));
  await js(`document.querySelectorAll('[role="tab"]')[1].parentElement.querySelector('button[aria-label^="Close"]').click()`);
  ok('× closes it', await until(`document.querySelectorAll('[role="tab"]').length === 1`));

  await typeLine('clear; echo hi; ls -d /usr/bin');
  await sleep(1000);
  const shot = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, 'terminal.png'), Buffer.from(shot.data, 'base64'));
  console.log(`  · ${join(shots, 'terminal.png')}`);
} finally {
  browser.kill();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
