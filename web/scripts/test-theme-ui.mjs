#!/usr/bin/env node
/** The built panel in a real browser: the app root, the Night/Day switch, and
 *  the two typefaces.
 *
 *     CHROME=/path/to/chrome node scripts/test-theme-ui.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'panel');

const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) {
  console.error('no browser found — set CHROME to one');
  process.exit(2);
}

execFileSync(join(web, 'node_modules', '.bin', 'vite'), [
  'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn',
], { cwd: web, stdio: 'inherit' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = existsSync(path) && extname(path) ? path : join(out, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = join(web, '.test-build', 'theme-profile');
rmSync(profile, { recursive: true, force: true });
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
  browser.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); done(m[0]); }
  });
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
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}
async function open() {
  await page('Page.navigate', { url });
  return evaluate(`
    for (let i = 0; i < 100; i++) {
      const b = document.querySelector('button[title^="Switch to the"]');
      if (b) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  `);
}
const root = () => evaluate(`
  const r = document.getElementById('root');
  return { cls: [...r.classList], theme: r.dataset.theme, html: document.documentElement.dataset.theme,
           canvas: getComputedStyle(r).getPropertyValue('--canvas').trim(), stored: localStorage.getItem('rac.theme') };
`);
const press = () => evaluate(`
  document.querySelector('button[title^="Switch to the"]').click();
  await new Promise((r) => setTimeout(r, 100));
`);

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

try {
  await page('Page.enable');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page('Page.navigate', { url });
  await evaluate(`localStorage.clear();
    localStorage.setItem('rac.hosts', JSON.stringify([{ host: '127.0.0.1', port: 9, token: 't', name: 'studio' }]));`);

  console.log('── the app root and the switch');
  ok('the panel came up with its theme switch', await open());
  const first = await root();
  ok('the app root carries dv-root dv-ambient, and opens in Night with nothing stored on a light computer',
    first.cls.includes('dv-root') && first.cls.includes('dv-ambient')
    && first.theme === 'dark' && first.canvas === '#18191c' && first.stored === null, JSON.stringify(first));
  await press();
  const flipped = await root();
  ok('pressing the switch flips data-theme to light', flipped.theme === 'light' && flipped.html === 'light'
    && flipped.canvas === '#f1f1ef', JSON.stringify(flipped));
  await open();
  const reloaded = await root();
  ok('…and the choice survives a reload', reloaded.theme === 'light' && reloaded.stored === 'light',
    JSON.stringify(reloaded));
  await press();
  const back = await root();
  ok('…and pressing it again flips back to dark', back.theme === 'dark', JSON.stringify(back));

  console.log('── the typefaces');
  const type = await evaluate(`
    await document.fonts.load('16px "Geist"');
    await document.fonts.load('12px "Geist Mono"');
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
    const mono = [...document.querySelectorAll('#root *')]
      .map((el) => getComputedStyle(el).fontFamily).find((f) => /Geist Mono/.test(f)) ?? null;
    return {
      body: getComputedStyle(document.body).fontFamily,
      loaded: [...new Set(loaded)],
      requested: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /fonts\\.(googleapis|gstatic)\\.com/.test(n)).length,
      mono,
    };
  `);
  ok('Geist and Geist Mono are requested and loaded, Geist is on body and Geist Mono on the data',
    /^"?Geist"?,/.test(type.body) && type.loaded.includes('Geist') && type.loaded.includes('Geist Mono')
    && type.requested >= 2 && /^"?Geist Mono"?,/.test(type.mono ?? ''), JSON.stringify(type));

  for (const scheme of ['dark', 'light']) {
    await evaluate(`localStorage.setItem('rac.theme', '${scheme}');`);
    await open();
    await evaluate('await document.fonts.ready; await new Promise((r) => setTimeout(r, 300));');
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(web, '.test-build', `panel-${scheme}.png`), Buffer.from(shot.data, 'base64'));
  }
} finally {
  ws.close();
  browser.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
