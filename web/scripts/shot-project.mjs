#!/usr/bin/env node
/** A picture of a product: its page and its board, desktop and narrow.
 *
 *     node scripts/shot-project.mjs [out-dir]
 *
 *  Not a check: what it leaves is the thing to hold up beside the frame
 *  (`Project`, `Board`, `ProjectPhone` .dc.html). Needs a browser, like `test-divan-ui.mjs`. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'project');
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
  'scripts/project-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(build, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--loader:.png=dataurl', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
writeFileSync(join(build, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:auto}button,input,textarea{font:inherit;color:inherit}</style>'
  + '</head><body><div id="root"></div><script src="./harness.js"></script></body></html>');

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
  for (const [name, view, width, height, mobile] of [
    ['project', 'overview', 1440, 1800, false], ['board', 'board', 1440, 1100, false],
    ['project-narrow', 'overview', 390, 2600, true],
  ]) {
    for (const scheme of ['dark', 'light']) {
      await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await page('Page.navigate', { url: `file://${join(build, 'harness.html')}?theme=${scheme}&view=${view}` });
      await new Promise((r) => setTimeout(r, 1500));
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      const file = join(out, `${name}${scheme === 'dark' ? '' : '-light'}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(file);
    }
  }
} finally { ws.close(); browser.kill(); }
process.exit(0);
