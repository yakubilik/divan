#!/usr/bin/env node
/** The head of the Chat place's list in a real browser, in both themes: the
 *  machine card alone and the whole width of the list, its name whole and
 *  without `.local`, and hiding the list a panel icon on the top line over it
 *  — which the rail's own icon undoes.
 *
 *     node scripts/test-sidebarhead-ui.mjs [out-dir]
 *
 *  Pictures (`chat-sidebar-head.png`, `chat-sidebar-head-light.png`) go to the
 *  out-dir, else $USTABASI_SHOTS, else .test-build/sidebarhead-ui/shots. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'sidebarhead-ui');
const out = resolve(process.argv[2] || process.env.USTABASI_SHOTS || join(build, 'shots'));
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
  'scripts/sidebarhead-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
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
let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
};
const run = async (js) => {
  const r = await page('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const measure = () => run(`
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const list = document.querySelector('.dv-chatlist');
  const head = document.querySelector('[data-sidebar-head]');
  const card = head?.querySelector('[data-host-card]');
  const name = head?.querySelector('[data-host-name]');
  const line = document.querySelector('.dv-topline');
  const hide = document.querySelector('button[aria-label="Hide the chat list"]');
  const theme = document.querySelector('.dv-topline .dv-icon-btn[aria-label^="Switch to"]');
  return {
    list: box(list), card: box(card?.parentElement), hide: box(hide), theme: box(theme),
    headButtons: head ? head.querySelectorAll(':scope > button, :scope > div > button:not([data-host-card])').length : -1,
    name: name?.textContent, clipped: name ? name.scrollWidth > name.clientWidth : null,
    hideInLine: !!hide && !!line?.contains(hide), hidePath: hide?.querySelector('path')?.getAttribute('d') ?? null,
    hideClass: hide?.className ?? null,
  };`);

try {
  for (const scheme of ['dark', 'light']) {
    console.log(`── the list's head, ${scheme}`);
    await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page('Page.navigate', { url: `http://127.0.0.1:${port}/chats?theme=${scheme}` });
    await sleep(2000);
    await run(`localStorage.removeItem('rac.sidebar');`);
    const m = await measure();
    ok('the card is alone in its row: no other button beside it', m.headButtons === 0, JSON.stringify(m));
    ok('the card spans the list, 8px in on each side',
      !!m.card && !!m.list && Math.abs(m.card.l - (m.list.l + 8)) < 1 && Math.abs(m.card.r - (m.list.r - 8 - 1)) < 1.5,
      JSON.stringify({ card: m.card, list: m.list }));
    ok('the name reads studio-workstation, no .local, not cut', m.name === 'studio-workstation' && m.clipped === false,
      JSON.stringify({ name: m.name, clipped: m.clipped }));
    ok('hide is on the top line, a panel icon, the size of the line’s other icons, level with them, its right edge over the card’s',
      m.hideInLine && /^M5 4h14/.test(m.hidePath ?? '') && /dv-icon-btn/.test(m.hideClass ?? '')
        && Math.abs(m.hide.w - m.theme.w) < 0.5 && Math.abs(m.hide.h - m.theme.h) < 0.5 && Math.abs(m.hide.t - m.theme.t) < 0.5
        && Math.abs(m.hide.r - m.card.r) < 2,
      JSON.stringify({ hide: m.hide, theme: m.theme, card: m.card, path: m.hidePath }));
    const file = join(out, `chat-sidebar-head${scheme === 'dark' ? '' : '-light'}.png`);
    const shot = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  ${file}`);

    // The card still opens the other computer, and picking it focuses it.
    await run(`document.querySelector('[data-host-card]').click(); await new Promise((r) => setTimeout(r, 200));`);
    ok('a press on the card lists the other computer', await run(
      `return [...document.querySelectorAll('[data-sidebar-head] button')].some((b) => b.textContent.includes('mini'));`));
    await run(`[...document.querySelectorAll('[data-sidebar-head] button')].find((b) => b.textContent.includes('mini')).click();
      await new Promise((r) => setTimeout(r, 200));`);
    ok('picking it makes it the card', (await measure()).name === 'mini');

    // Hide, then show from the rail.
    await run(`document.querySelector('button[aria-label="Hide the chat list"]').click(); await new Promise((r) => setTimeout(r, 200));`);
    const railed = await run(`const l = document.querySelector('.dv-chatlist'); const s = l?.querySelector('button[aria-label="Show the chat list"]');
      const t = document.querySelector('.dv-topline .dv-icon-btn[aria-label^="Switch to"]');
      return { w: l?.getBoundingClientRect().width, show: !!s, cls: s?.className, sw: s?.getBoundingClientRect().width, tw: t?.getBoundingClientRect().width,
               path: s?.querySelector('path')?.getAttribute('d'), hide: !!document.querySelector('button[aria-label="Hide the chat list"]') };`);
    ok('hide leaves the 48px rail, and no hide control', railed.w === 48 && !railed.hide, JSON.stringify(railed));
    ok('the rail’s show is the same quiet panel icon', railed.show && /dv-icon-btn/.test(railed.cls) && railed.sw === railed.tw
      && /^M5 4h14/.test(railed.path ?? ''), JSON.stringify(railed));
    const rail = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(build, `rail-${scheme}.png`), Buffer.from(rail.data, 'base64'));
    await run(`document.querySelector('button[aria-label="Show the chat list"]').click(); await new Promise((r) => setTimeout(r, 200));`);
    ok('show brings the list back', (await measure()).list?.w === 260);
  }
} finally { ws.close(); browser.kill(); server.close(); }
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
