#!/usr/bin/env node
/** The Dashboard's floating chat, measured in a real browser.
 *
 *     CHROME=/path/to/chrome node scripts/test-asking-ui.mjs
 *
 *  jsdom has no layout, so `test-asking.mjs` cannot say whether the window fits
 *  a phone, whether its conversation scrolls or whether the box at its foot can
 *  be reached. This opens the Dashboard with a question open in it, at a phone's
 *  width and a desktop's, and reads that off the page. With USTABASI_SHOTS set
 *  it leaves `dashboard-asking.png` and `dashboard-asking-narrow.png` there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking-ui');
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/asking-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
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

const measure = () => evaluate(`
  const win = document.querySelector('[data-asking-window] [data-panel]');
  if (!win) return null;
  const vw = innerWidth, vh = innerHeight;
  const r = win.getBoundingClientRect();
  const input = win.querySelector('input[type="text"]');
  const ir = input.getBoundingClientRect();
  const atInput = document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
  const scroller = win.querySelector('[data-panel-body]');
  const before = scroller.scrollTop;
  scroller.scrollTop = 0;
  const top = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  const bottom = scroller.scrollTop;
  const q = win.querySelector('[data-asking-line="agent"] li');
  const scroll = { h: scroller.scrollHeight, c: scroller.clientHeight, top, bottom, before };
  const font = q ? parseFloat(getComputedStyle(q).fontSize) : 0;
  const tabs = [...document.querySelectorAll('[data-asking-tab]')].map((t) => t.getBoundingClientRect());
  const firstTab = document.querySelector('[data-asking-tab]');
  firstTab.querySelector('[role="button"], button, div').click();
  await new Promise((r) => setTimeout(r, 150));
  const awayGone = !document.querySelector('[data-asking-window="studio:k2"]');
  document.querySelector('[data-asking-tab="studio:k2"]').firstElementChild.click();
  await new Promise((r) => setTimeout(r, 150));
  const back = !!document.querySelector('[data-asking-window="studio:k2"]');
  return {
    vw, vh, win: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
    input: { l: ir.left, r: ir.right, t: ir.top, b: ir.bottom, reachable: atInput === input || input.contains(atInput) },
    scroll, font,
    tabs: tabs.map((t) => ({ l: t.left, r: t.right, t: t.top, b: t.bottom })),
    overlap: tabs.some((t) => t.top < r.bottom - 1 && t.bottom > r.top && t.left < r.right && t.right > r.left),
    awayGone, back,
  };
`);

try {
  for (const [name, width, height, mobile] of [['dashboard-asking', 1440, 900, false], ['dashboard-asking-narrow', 390, 844, true]]) {
    console.log(`── ${name} (${width}×${height})`);
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    await page('Page.navigate', { url: `file://${join(out, 'harness.html')}` });
    const up = await evaluate(`
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('[data-asking-window] [data-panel]')) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;`);
    ok('the floating chat is open on the Dashboard by itself', up);
    if (!up) continue;
    const m = await measure();
    ok('the window is wholly on screen', m.win.l >= 0 && m.win.t >= 0 && m.win.r <= m.vw && m.win.b <= m.vh, JSON.stringify(m.win));
    ok(mobile ? 'on a phone it takes the width of the screen, less its margins' : 'on a desktop it stands in the corner at a chat window’s width',
      mobile ? m.win.w >= m.vw - 20 : m.win.w >= 340 && m.win.w <= 420 && m.win.r > m.vw - 40, JSON.stringify(m.win));
    ok('the answer box is on screen and nothing covers it', m.input.reachable && m.input.b <= m.vh && m.input.l >= 0 && m.input.r <= m.vw,
      JSON.stringify(m.input));
    ok('the conversation scrolls inside the window, and starts at its end',
      m.scroll.h > m.scroll.c && m.scroll.top === 0 && m.scroll.bottom > 0 && m.scroll.before > 0, JSON.stringify(m.scroll));
    ok('the question is at a reading size', m.font >= 13, String(m.font));
    ok('the tabs are on screen under the window, not over it',
      m.tabs.length >= 2 && !m.overlap && m.tabs.every((t) => t.b <= m.vh && t.t >= 0), JSON.stringify(m.tabs));
    ok('its tab puts it away and brings it back', m.awayGone && m.back);
    if (process.env.USTABASI_SHOTS) {
      await evaluate('await new Promise((r) => setTimeout(r, 200));');
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.USTABASI_SHOTS, `${name}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`  · picture in ${process.env.USTABASI_SHOTS}/${name}.png`);
    }
  }
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
