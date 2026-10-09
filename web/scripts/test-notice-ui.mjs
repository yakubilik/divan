#!/usr/bin/env node
/** Ticket notices, opened from the keyboard in a real browser.
 *
 *     CHROME=/path/to/chrome node scripts/test-notice-ui.mjs
 *
 *  `npm test` (`test-notice.mjs`) mounts the timeline in jsdom and clicks the
 *  rows; jsdom does not turn a key into a button press, a browser does. Same
 *  approach as `test-ticket-ui.mjs`: headless Chrome over DevTools. With
 *  USTABASI_SHOTS set it leaves `ticket-notices.png` there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'notice-ui');

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
  'scripts/notice-harness.tsx',
  '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`,
  '--define:process.env.NODE_ENV="development"',
  // timeline.ts reaches fleet.ts, whose dev-only branch reads import.meta.env.
  '--define:import.meta.env={"DEV":false}',
  '--log-level=warning',
], { cwd: web, stdio: 'inherit' });

writeFileSync(join(out, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<title>Notice harness</title><style>'
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

const state = (n) => evaluate(`
  const n = document.querySelector('[data-notice="${n}"]');
  const b = n.querySelector('button[aria-expanded]');
  const t = n.querySelector('[data-notice-title]');
  return {
    expanded: b.getAttribute('aria-expanded'), text: n.innerText, row: b.innerText,
    rowHeight: b.getBoundingClientRect().height, titleHeight: t.getBoundingClientRect().height,
    focused: document.activeElement === b, page: document.body.innerText,
  };
`);

try {
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 2, mobile: false });
  await page('Page.navigate', { url: `file://${join(out, 'harness.html')}` });
  const up = await evaluate(`
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('[data-notice]')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  `);
  if (!up) throw new Error('the harness did not come up');

  console.log('── closed, it is one line');
  let s = await state(157);
  ok('#157 is one visual line', s.rowHeight <= 40 && s.titleHeight <= 22, `${s.rowHeight}/${s.titleHeight}`);
  ok('with its state, number and title', /Done/.test(s.row) && s.row.includes('#157')
    && s.row.includes('Match mobile chat grouping to the web'), s.row);
  ok('and nothing else of it', s.text.trim() === s.row.trim(), s.text);
  ok('the agent instruction is nowhere on the page', !s.page.includes('You filed this ticket'));

  console.log('── the keyboard');
  await evaluate(`document.querySelector('[data-notice="157"] button').focus();`);
  await press('Enter');
  s = await state(157);
  ok('Enter opens it', s.expanded === 'true' && s.focused);
  ok('the report says the phone did not get it', s.text.includes('delivered but not installed because the phone was unreachable'));
  ok('and that the build is older than the voice work', s.text.includes('does not contain the #150 voice work'));
  ok('and the merge', s.text.includes('merged into main (1664073)'));
  ok('the agent instruction is not in it', !s.text.includes('You filed this ticket') && !s.text.includes('ustabasi show'));
  await press('Enter');
  s = await state(157);
  ok('Enter again closes it', s.expanded === 'false' && s.text.trim() === s.row.trim());
  await press(' ');
  s = await state(157);
  ok('Space opens it too', s.expanded === 'true');

  console.log('── a long title');
  const long = await evaluate(`
    const t = document.querySelector('[data-notice="139"] [data-notice-title]');
    t.textContent = t.textContent.repeat(6);
    await new Promise((r) => setTimeout(r, 50));
    const r = t.getBoundingClientRect();
    return { h: r.height, cut: t.scrollWidth > t.clientWidth };
  `);
  ok('stays one line and is cut with an ellipsis', long.h <= 22 && long.cut, JSON.stringify(long));
  await evaluate(`location.reload();`);
  await evaluate('await new Promise((r) => setTimeout(r, 800));');

  // The finished state, as it sits in a chat: one opened, the rest closed.
  await evaluate(`document.querySelector('[data-notice="157"] button').click(); await new Promise((r) => setTimeout(r, 100));`);
  if (process.env.USTABASI_SHOTS) {
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.USTABASI_SHOTS, 'ticket-notices.png'), Buffer.from(shot.data, 'base64'));
    console.log(`  · picture in ${process.env.USTABASI_SHOTS}/ticket-notices.png`);
  }
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
