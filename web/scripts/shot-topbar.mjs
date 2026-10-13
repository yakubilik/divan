#!/usr/bin/env node
/** Pictures of the top line's two boxes open: the machines and the Inbox.
 *
 *     node scripts/shot-topbar.mjs [out-dir]
 *
 *  Not a check; `test-topbar.mjs` is. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'topbar-shot');
const out = resolve(process.argv[2] || build);
mkdirSync(build, { recursive: true });
mkdirSync(out, { recursive: true });
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/topbar-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(build, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--loader:.png=dataurl', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}button,input,textarea{font:inherit;color:inherit}</style>'
  + '</head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
// Every path is the panel, the way the daemon serves it; the two files are files.
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/harness.js' || path === '/harness.css') {
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' });
    res.end(existsSync(join(build, path)) ? readFileSync(join(build, path)) : '');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${join(build, 'profile')}`, '--window-size=1440,900', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((done) => {
  let buf = '';
  browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) done(m[0]); });
});
const ws = new WebSocket(endpoint);
await new Promise((done) => { ws.onopen = done; });
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m.result); } };
const cdp = (method, params = {}, sessionId) => new Promise((done) => {
  const n = ++id; waiting.set(n, done); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});
const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => cdp(m, p, sessionId);
try {
  for (const open of ['machines', 'inbox']) {
    await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
    await page('Page.navigate', { url: `http://127.0.0.1:${port}/?theme=dark&open=${open}` });
    await new Promise((r) => setTimeout(r, 1500));
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    const file = join(out, `topbar-${open}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(file);
  }
} finally { ws.close(); browser.kill(); server.close(); }
