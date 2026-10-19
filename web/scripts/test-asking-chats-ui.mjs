#!/usr/bin/env node
/** The question windows on the Chat place, measured in a real browser.
 *
 *     CHROME=/path/to/chrome node scripts/test-asking-chats-ui.mjs
 *
 *  The whole panel, served over http, opened on /chats with a ticket stopped on
 *  a question. Reads off the page that the Dashboard's floating window is there
 *  with the project, the agent and the question whole; that the chat list has
 *  no entry for it; that it clears the chat composer's send button at a desktop
 *  size; that an answer goes out as the ticket's note with the window staying;
 *  and that putting it away on one screen has it put away on the other. With
 *  USTABASI_SHOTS set it leaves `chats-asking.png` there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking-chats-ui');
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

rmSync(join(out, 'profile'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/asking-chats-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--loader:.png=dataurl', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}button,input,textarea{font:inherit;color:inherit}</style>'
  + '</head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
// Every path is the panel, the way the daemon serves it.
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/harness.js' || path === '/harness.css') {
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' });
    res.end(existsSync(join(out, path)) ? readFileSync(join(out, path)) : '');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(out, 'profile')}`, '--window-size=1440,900', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

let ws;
try {
  const endpoint = await new Promise((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
    browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(timer); done(m[0]); } });
  });
  ws = new WebSocket(endpoint);
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
  const evaluate = async (expression) => {
    const r = await page('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
    return r.result.value;
  };
  const until = (cond) => evaluate(`
    for (let i = 0; i < 150; i++) { if (${cond}) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;`);
  const goTo = (path) => evaluate(`
    history.pushState(null, '', ${JSON.stringify(path)});
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await new Promise((r) => setTimeout(r, 300));`);

  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${port}/chats` });
  console.log('── the Chats screen at 1440×900');
  const up = await until(`document.querySelector('[data-asking-window] [data-panel]') && document.querySelector('.dv-chatlist') && document.querySelector('button[aria-label="Send"]')`);
  ok('the Chats screen is drawn with the question’s floating window open over it', up);
  if (up) {
    const m = await evaluate(`
      const win = document.querySelector('[data-asking-window] [data-panel]');
      const r = win.getBoundingClientRect();
      const send = document.querySelector('[data-chat-column] button[aria-label="Send"]');
      const s = send.getBoundingClientRect();
      const at = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
      const tabs = [...document.querySelectorAll('[data-asking-tab]')].map((t) => t.getBoundingClientRect());
      const hit = (a) => a.left < s.right && a.right > s.left && a.top < s.bottom && a.bottom > s.top;
      return {
        path: location.pathname, id: win.closest('[data-asking-window]').getAttribute('data-asking-window'),
        text: win.textContent, points: [...win.querySelectorAll('[data-asking-line="agent"] li')].map((l) => l.textContent),
        win: { l: r.left, t: r.top, r: r.right, b: r.bottom }, vw: innerWidth, vh: innerHeight,
        send: { l: s.left, t: s.top, r: s.right, b: s.bottom, reachable: at === send || send.contains(at) },
        covered: hit(r) || tabs.some(hit),
        list: document.querySelector('.dv-chatlist').textContent,
        rows: document.querySelectorAll('.dv-chatlist [data-chat-title]').length,
      };`);
    ok('…on /chats, the ticket’s window', m.path.startsWith('/chats') && m.id === 'studio:k2', `${m.path} ${m.id}`);
    ok('…with the project and the agent in its head', m.text.includes('Quire · Engineering') && m.text.includes('Coder'), m.text.slice(0, 160));
    ok('…and the question whole, each point', m.points.length === 2 && m.points[0].startsWith('Strix taraması')
      && m.points[1].includes('hangisi olsun?'), JSON.stringify(m.points));
    ok('the window is wholly on screen, docked at the bottom right',
      m.win.l >= 0 && m.win.t >= 0 && m.win.r <= m.vw && m.win.b <= m.vh && m.win.r > m.vw - 40, JSON.stringify(m.win));
    ok('the chat list has no entry for the ticket or its question',
      m.rows > 0 && !/Strix/.test(m.list), m.list.slice(0, 200));
    ok('neither the window nor its tab covers the composer’s send button, and the button takes a press',
      !m.covered && m.send.reachable, `${JSON.stringify(m.send)} win ${JSON.stringify(m.win)}`);
    if (process.env.USTABASI_SHOTS) {
      await evaluate('await new Promise((r) => setTimeout(r, 300));');
      const shot = await page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.USTABASI_SHOTS, 'chats-asking.png'), Buffer.from(shot.data, 'base64'));
      console.log(`  · picture in ${process.env.USTABASI_SHOTS}/chats-asking.png`);
    }

    console.log('── answered there, and one store with the Dashboard');
    const sent = await evaluate(`
      const input = document.querySelector('[data-asking-window] input[type="text"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Girişi ben yaparım');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      return { notes: window.__notes, id: document.querySelector('[data-asking-window]')?.getAttribute('data-asking-window'),
               lines: [...document.querySelectorAll('[data-asking-window] [data-asking-line]')].map((e) => e.getAttribute('data-asking-line')) };`);
    ok('the answer is one ustabasi.note on ticket 42, and the window stays with it under the question',
      sent.notes.length === 1 && sent.notes[0].key === 'studio' && sent.notes[0].data.id === 42
        && sent.notes[0].data.text === 'Girişi ben yaparım' && sent.id === 'studio:k2' && sent.lines.join(',') === 'agent,you',
      JSON.stringify(sent));
    await evaluate(`document.querySelector('[data-asking-window] button[aria-label="Put this away"]').click();
      await new Promise((r) => setTimeout(r, 200));`);
    await goTo('/');
    const dash = await evaluate(`return { greet: !!document.querySelector('h1.dv-greet'),
      win: !!document.querySelector('[data-asking-window]'), tab: !!document.querySelector('[data-asking-tab="studio:k2"]') };`);
    ok('put away on the Chats screen, it is put away on the Dashboard: its tab, no window',
      dash.greet && !dash.win && dash.tab, JSON.stringify(dash));
    await evaluate(`document.querySelector('[data-asking-tab="studio:k2"]').firstElementChild.click();
      await new Promise((r) => setTimeout(r, 200));`);
    const both = await evaluate(`const w = document.querySelector('[data-asking-window]');
      return { id: w?.getAttribute('data-asking-window'),
               lines: [...(w?.querySelectorAll('[data-asking-line]') ?? [])].map((e) => e.getAttribute('data-asking-line')) };`);
    ok('opened on the Dashboard, it is the same conversation, the answer from the Chats screen in it',
      both.id === 'studio:k2' && both.lines.join(',') === 'agent,you', JSON.stringify(both));
    await evaluate(`document.querySelector('[data-asking-window] button[aria-label="Close"]').click();
      await new Promise((r) => setTimeout(r, 200));`);
    await goTo('/chats');
    const gone = await evaluate(`return { list: !!document.querySelector('.dv-chatlist'),
      win: !!document.querySelector('[data-asking-window]'), tab: !!document.querySelector('[data-asking-tab]') };`);
    ok('closed on the Dashboard, it is closed on the Chats screen', gone.list && !gone.win && !gone.tab, JSON.stringify(gone));
  }
} finally {
  try { ws?.close(); } catch { /* fine */ }
  browser.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
