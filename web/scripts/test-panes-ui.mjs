#!/usr/bin/env node
/** The Panes screen in a real browser, at 1440×900.
 *
 *     CHROME=/path/to/chrome node scripts/test-panes-ui.mjs
 *
 *  The whole panel, served over http, opened on /chats with eight chats on one
 *  computer. The Panes button on the top line is pressed, and four chats are
 *  dragged off the sidebar onto pane edges into a 2×2 split; the dividers are
 *  dragged with the real mouse, every move measured; a pane is maximised and
 *  restored; a fifth chat makes the grid shift and shrink, eased; a pane is
 *  carried by its head to the screen's edge; words typed in one pane are sent
 *  to its chat; a reload draws the same layout and Back is the Chats screen.
 *  With USTABASI_SHOTS set it leaves `panes.png` (the 2×2 split),
 *  `panes-resized.png` and `panes-maximized.png` there. The browser is closed
 *  and the server stopped on the way out, failing or not.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'panes-ui');
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
  'scripts/panes-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--loader:.png=dataurl', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}button,input,textarea{font:inherit;color:inherit}</style>'
  + '</head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/harness.js' || path === '/harness.css') {
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/css' });
    res.end(existsSync(join(out, path)) ? readFileSync(join(out, path)) : '');
    return;
  }
  const pic = join(web, 'public', path);
  if (path.endsWith('.png') && existsSync(pic)) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(readFileSync(pic)); return; }
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
    const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 30000);
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
  const wait = (ms) => evaluate(`await new Promise((r) => setTimeout(r, ${ms}));`);
  const shot = async (name) => {
    if (!process.env.USTABASI_SHOTS) return;
    await wait(400);
    const s = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.USTABASI_SHOTS, name), Buffer.from(s.data, 'base64'));
    console.log(`  · picture in ${process.env.USTABASI_SHOTS}/${name}`);
  };
  /** Every pane's chat and rectangle on screen, in CSS pixels. */
  const layout = () => evaluate(`await Promise.all(document.getAnimations().map((x) => x.finished.catch(() => {})));
    return [...document.querySelectorAll('[data-pane]')].map((p) => {
    const r = p.getBoundingClientRect();
    return { id: p.getAttribute('data-pane-chat'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             hidden: getComputedStyle(p).visibility === 'hidden' };
  });`);
  const areaBox = () => evaluate(`const r = document.querySelector('[data-panes]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };`);
  /** A chat row dragged off the sidebar and let go at (x, y), with the
   *  browser's own DragEvent and DataTransfer. */
  const dragRow = (title, x, y) => evaluate(`
    const row = [...document.querySelectorAll('.dv-chatlist button[draggable="true"]')].find((b) => b.textContent.includes(${JSON.stringify(title)}));
    if (!row) return { error: 'no row' };
    const dt = new DataTransfer();
    const fire = (el, type, at) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at?.[0] ?? 0, clientY: at?.[1] ?? 0 }); el.dispatchEvent(ev); return ev; };
    fire(row, 'dragstart');
    const over = document.elementFromPoint(${x}, ${y});
    const taken = fire(over, 'dragover', [${x}, ${y}]).defaultPrevented;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const hint = !!document.querySelector('[data-pane-hint]');
    fire(document.elementFromPoint(${x}, ${y}), 'drop', [${x}, ${y}]);
    fire(row, 'dragend');
    await new Promise((r) => setTimeout(r, 260));
    return { taken, hint };`);
  const mouse = (type, x, y) => page('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });

  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await page('Page.navigate', { url: `http://127.0.0.1:${port}/chats` });
  console.log('── to Panes at 1440×900');
  ok('the Chats screen is drawn', await until(`document.querySelector('.dv-chatlist') && document.querySelector('button[aria-label="Panes"]')`));
  await evaluate(`document.querySelector('button[aria-label="Panes"]').click();`);
  ok('the Panes button opens /panes with the chat list beside it',
    await until(`location.pathname === '/panes' && document.querySelector('[data-panes]') && document.querySelector('[data-panes-screen] .dv-chatlist')`));

  console.log('── four chats dragged in, a 2×2 split');
  let a = await areaBox();
  const at = (fx, fy) => [Math.round(a.x + fx * a.w), Math.round(a.y + fy * a.h)];
  const first = await dragRow('Webhook retry policy', ...at(0.5, 0.5));
  ok('a row dragged over the empty screen is taken, with a hint where it lands', first.taken && first.hint, JSON.stringify(first));
  await dragRow('Safari login', ...at(0.92, 0.5));
  await dragRow('Invoice PDF', ...at(0.25, 0.94));
  await dragRow('Paywall copy', ...at(0.75, 0.94));
  let l = await layout();
  const by = (list, chatId) => list.find((p) => p.id === chatId);
  const grid = (list) => {
    const [p1, p2, p3, p4] = ['c1', 'c2', 'c3', 'c4'].map((c) => by(list, c));
    return !!(p1 && p2 && p3 && p4) && p1.x < p2.x && p1.y === p2.y && p3.x === p1.x && p3.y > p1.y && p4.x === p2.x && p4.y === p3.y
      && Math.abs(p1.w - p2.w) <= 1 && Math.abs(p1.h - p3.h) <= 1;
  };
  ok('four panes in a 2×2 split, like the terminal reference', l.length === 4 && grid(l), JSON.stringify(l));
  ok('…each the floating chat window with its conversation and a composer', await evaluate(`
    return [...document.querySelectorAll('[data-pane]')].every((p) => p.querySelector('section[data-panel] header')
      && p.querySelector('textarea[name="composer"]') && p.textContent.length > 80);`));
  await evaluate(`window.__feed('c2', 11, 'text.delta', { segment: 1, text: 'Staging is green on Safari 18 now.' });`);
  ok('a live message for one chat streams into its pane', await until(`document.querySelector('[data-pane="studio:c2"]').textContent.includes('Staging is green')`));
  await evaluate(`window.__feed('c2', 12, 'turn.done', {});`);
  await shot('panes.png');

  console.log('── dividers dragged with the mouse');
  // A quarter of the way along, clear of where another divider crosses it.
  const lineAt = (key) => evaluate(`const r = document.querySelector('[data-pane-divider="${key}"]').getBoundingClientRect();
    return { x: r.left + r.width / (r.width > r.height ? 4 : 2), y: r.top + r.height / (r.height > r.width ? 4 : 2) };`);
  const renders0 = await evaluate(`return Object.fromEntries(window.__renders);`);
  const mid = await lineAt(':0');
  await mouse('mouseMoved', mid.x, mid.y);
  await mouse('mousePressed', mid.x, mid.y);
  const followed = [];
  for (let i = 1; i <= 12; i++) {
    await mouse('mouseMoved', mid.x + i * 12, mid.y);
    const s = await layout();
    followed.push(by(s, 'c1').w);
  }
  await mouse('mouseReleased', mid.x + 144, mid.y);
  const renders1 = await evaluate(`return Object.fromEntries(window.__renders);`);
  l = await layout();
  ok('the left column follows the pointer on every move, 12 px at a time',
    followed.every((wd, i) => i === 0 || Math.abs(wd - followed[i - 1] - 12) <= 1), JSON.stringify(followed));
  ok('…and not one pane’s chat was drawn again for it', JSON.stringify(renders0) === JSON.stringify(renders1),
    `${JSON.stringify(renders0)} → ${JSON.stringify(renders1)}`);
  const left = await lineAt('0:0');
  await mouse('mouseMoved', left.x, left.y);
  await mouse('mousePressed', left.x, left.y);
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', left.x, left.y + i * 15);
  await mouse('mouseReleased', left.x, left.y + 120);
  l = await layout();
  ok('the left column’s own divider moved down 120 px', Math.abs(by(l, 'c3').y - by(l, 'c2').y - (by(l, 'c4').y - by(l, 'c2').y) - 120) <= 2
    || by(l, 'c3').y > by(l, 'c4').y + 100, JSON.stringify(l));
  await mouse('mouseMoved', mid.x + 144, mid.y);
  await mouse('mousePressed', mid.x + 144, mid.y);
  await mouse('mouseMoved', 5000, mid.y);
  await mouse('mouseReleased', 5000, mid.y);
  l = await layout();
  ok('pulled past the end, the right column keeps its minimum width', l.every((p) => p.w >= 239), JSON.stringify(l));
  // Back to a readable split for the picture.
  const back = await lineAt(':0');
  await mouse('mouseMoved', back.x, back.y);
  await mouse('mousePressed', back.x, back.y);
  await mouse('mouseMoved', a.x + a.w * 0.6, back.y);
  await mouse('mouseReleased', a.x + a.w * 0.6, back.y);
  const resized = await layout();
  await shot('panes-resized.png');

  console.log('── maximise and restore');
  await evaluate(`document.querySelector('[data-pane="studio:c1"] button[aria-label="Fill the Panes screen"]').click();`);
  await wait(300);
  a = await areaBox();
  l = await layout();
  const big = by(l, 'c1');
  ok('maximised, the pane fills the Panes area and the others are hidden',
    Math.abs(big.x - a.x) <= 1 && Math.abs(big.w - a.w) <= 1 && Math.abs(big.h - a.h) <= 1 && l.filter((p) => p.id !== 'c1').every((p) => p.hidden),
    JSON.stringify({ big, a }));
  await shot('panes-maximized.png');
  await evaluate(`document.querySelector('[data-pane="studio:c1"] button[aria-label="Restore the layout"]').click();`);
  await wait(300);
  l = await layout();
  ok('restored, the layout is exactly what it was', JSON.stringify(l) === JSON.stringify(resized), `${JSON.stringify(l)}\n    ${JSON.stringify(resized)}`);

  console.log('── a fifth chat on the full grid, and a pane carried by its head');
  const before = await layout();
  // Pressed in the list, and the open panes watched on every frame after.
  const frames = await evaluate(`
    [...document.querySelectorAll('.dv-chatlist button[draggable="true"]')].find((b) => b.textContent.includes('Onboarding flow')).click();
    const seen = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 600) {
      await new Promise((r) => requestAnimationFrame(r));
      seen.push(Object.fromEntries([...document.querySelectorAll('[data-pane]')].map((p) => [p.getAttribute('data-pane-chat'), Math.round(p.getBoundingClientRect().width)])));
    }
    return seen;`);
  await wait(200);
  const after = await layout();
  const changed = before.filter((p) => JSON.stringify(p) !== JSON.stringify(by(after, p.id)));
  const between = changed.some((p) => { const z = by(after, p.id); return frames.some((f) => Math.min(p.w, z.w) + 2 < f[p.id] && f[p.id] < Math.max(p.w, z.w) - 2); });
  const rs = after;
  const overlap = rs.some((p, i) => rs.some((q, j) => j > i && Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1));
  ok('the open panes shift and shrink by themselves to make room, and none overlaps', after.length === 5 && changed.length >= 1 && !overlap,
    JSON.stringify(after));
  ok('…eased there rather than jumping: caught midway through', between, JSON.stringify({ before, frames: frames.slice(0, 12), after }));
  const head = await evaluate(`const r = document.querySelector('[data-pane="studio:c4"] header').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 };`);
  await mouse('mouseMoved', head.x, head.y);
  await mouse('mousePressed', head.x, head.y);
  for (let i = 1; i <= 10; i++) await mouse('mouseMoved', head.x + (a.x + 10 - head.x) * i / 10, head.y + (a.y + a.h / 2 - head.y) * i / 10);
  const hinted = await evaluate(`return !!document.querySelector('[data-pane-hint]');`);
  await mouse('mouseReleased', a.x + 10, a.y + a.h / 2);
  await wait(400);
  l = await layout();
  const c4 = by(l, 'c4');
  ok('a pane carried by its head to the screen’s left edge is a column down the whole left, the others beside it',
    hinted && Math.abs(c4.x - a.x) <= 1 && Math.abs(c4.h - a.h) <= 1 && l.filter((p) => p.id !== 'c4').every((p) => p.x >= c4.x + c4.w - 1),
    JSON.stringify(l));

  console.log('── each composer sends to its own chat');
  for (const [chatId, words] of [['c2', 'Ship the Safari fix'], ['c3', 'Check Letter size too']]) {
    await evaluate(`document.querySelector('[data-pane="studio:${chatId}"] textarea[name="composer"]').focus();`);
    await page('Input.insertText', { text: words });
    await wait(100);
    await evaluate(`document.querySelector('[data-pane="studio:${chatId}"] button[title="Send"]').click();`);
    await wait(200);
  }
  const sent = await evaluate(`return window.__sent;`);
  ok('typed in two panes, each went to that pane’s chat and nowhere else',
    sent.length === 2 && sent[0].chat_id === 'c2' && sent[0].text === 'Ship the Safari fix' && sent[1].chat_id === 'c3' && sent[1].text === 'Check Letter size too',
    JSON.stringify(sent));

  console.log('── a reload, and Back');
  const kept = await layout();
  await page('Page.reload', {});
  ok('reloaded, /panes draws the same layout', await until(`document.querySelectorAll('[data-pane]').length === 5`)
    && (await wait(400), JSON.stringify(await layout()) === JSON.stringify(kept)), JSON.stringify(await layout()));
  await evaluate(`history.back(); await new Promise((r) => setTimeout(r, 500));`);
  ok('Back from Panes is the Chats screen it was opened from', await until(`location.pathname.startsWith('/chats') && !document.querySelector('[data-panes]')`),
    await evaluate(`return location.pathname;`));
} finally {
  try { ws?.close(); } catch { /* fine */ }
  browser.kill();
  server.close();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
