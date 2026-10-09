/** The whole panel over a made-up computer, built once and served at real
 *  paths, with a headless browser on the end of a DevTools socket.
 *
 *  Shared by `test-walk-ui.mjs` and `test-audit-ui.mjs`. Any path that is not a
 *  file is answered with the panel's page, the way the daemon serves it
 *  (`server.py`, `_mount_panel`), so a reload of `/p/quire/board` is a reload. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function launch(name) {
  const build = join(web, '.test-build', name);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  const chrome = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p));
  if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

  execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
    'scripts/walk-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
    `--outfile=${join(build, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
    '--define:import.meta.env.DEV=false', '--loader:.svg=dataurl', '--loader:.png=dataurl', '--log-level=warning',
  ], { cwd: web, stdio: 'inherit' });
  const head = readFileSync(join(web, 'index.html'), 'utf8').match(/<head>([\s\S]*?)<\/head>/)[1];
  writeFileSync(join(build, 'index.html'),
    `<!doctype html><html lang="en"><head>${head}<link rel="stylesheet" href="/harness.css"></head>`
    + '<body><div id="root" class="dv-root dv-ambient" data-theme="dark"></div><script src="/harness.js"></script></body></html>');

  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/__blank.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html>'); return; }
    const local = join(build, pathname);
    const pub = join(web, 'public', pathname);
    const file = extname(pathname) && existsSync(local) ? local
      : extname(pathname) && existsSync(pub) ? pub : join(build, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${join(build, 'profile')}`, '--window-size=1440,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method) { for (const l of listeners) l(msg); return; }
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

  /** Every console error and uncaught exception since the last `drain()`. */
  let problems = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error'
               && !/fonts\.(googleapis|gstatic)\.com/.test(msg.params.entry.url ?? '')) {
      problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
  });
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Log.enable');

  async function evaluate(expression) {
    const r = await page('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
    return r.result.value;
  }
  /** Until the panel has painted something of its own and stopped moving. */
  async function settle() {
    await evaluate(`
      for (let i = 0; i < 100; i++) {
        if (document.querySelector('#root > *') && document.querySelector('.dv-topline, header')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 450));
    `);
  }
  async function size(width, mobile) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
  }
  /** A fresh tab's worth of state: the theme, the fixture, nothing else. */
  async function cold(path, { theme = 'dark', fixture = 'busy' } = {}) {
    await page('Page.navigate', { url: `${origin}/__blank.html` });
    await evaluate(`localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('rac.theme', ${JSON.stringify(theme)});
      sessionStorage.setItem('walk.fixture', ${JSON.stringify(fixture)});`);
    await page('Page.navigate', { url: origin + path });
    await settle();
  }
  async function reload() { await page('Page.reload', {}); await settle(); }
  /** The whole page, not the window: the panel scrolls inside its own column,
   *  so the window is made as tall as the tallest scroller for the picture. */
  async function shot(file, width, mobile) {
    const tall = await evaluate(`
      let h = document.documentElement.clientHeight;
      for (const el of document.querySelectorAll('#root *')) {
        if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
          h = Math.max(h, el.scrollHeight + el.getBoundingClientRect().top + 24);
        }
      }
      return Math.min(5000, Math.ceil(h));`);
    const height = mobile ? 844 : 900;
    if (tall > height) {
      await page('Emulation.setDeviceMetricsOverride', { width, height: tall, deviceScaleFactor: 1, mobile });
      await new Promise((r) => setTimeout(r, 250));
    }
    const s = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
    if (tall > height) await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }
  const drain = () => { const p = problems; problems = []; return p; };
  const close = () => { ws.close(); browser.kill(); server.close(); };
  return { page, evaluate, settle, size, cold, reload, shot, drain, close, origin, build };
}

export function checker() {
  let failures = 0;
  const ok = (name, cond, detail) => {
    if (cond) { console.log(`  · ${name}`); return; }
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
  };
  const done = () => { console.log(failures ? `\n${failures} failed` : '\nall good'); return failures ? 1 : 0; };
  return { ok, done };
}
