#!/usr/bin/env node
/** The Work board's cards, dragged in a real browser — with a mouse on a desk
 *  and with a finger on a phone.
 *
 *     CHROME=/path/to/chrome node scripts/test-work-ui.mjs
 *
 *  `npm test` (test-work.mjs) checks every move against a faked socket, but in
 *  jsdom nothing is laid out, so it says where the columns are itself. This
 *  asks the browser: the harness (`work-harness.tsx`) is drawn at a desk's width
 *  and a phone's, a card is picked up where it is drawn and put down over the
 *  column the browser drew, and what the harness's queue was asked
 *  (`window.__writes`) is read back.
 *
 *  Then a move the queue takes its time over: the card is in its new column as
 *  a ghost within 200 ms of being put down, its status still the old one; the
 *  answer arriving while a poll is out is read again at once, and the card
 *  lands where the queue put it with no reload; a refusal takes the ghost away
 *  and says why; a second drop while one is out asks nothing. Last, every
 *  card's tint, and its title's contrast on it, in both themes.
 *
 *  Not in CI: it needs a browser on the machine.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(web, '.test-build', 'work-ui');
mkdirSync(build, { recursive: true });
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('no browser found — set CHROME to one'); process.exit(2); }

let failures = 0;
/** A computed colour as the browser writes it — `rgb()`, `rgba()` or
 *  `color(srgb …)` — as [r, g, b] from 0 to 1. */
function rgbOf(css) {
  let m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(css);
  if (m) return m.slice(1, 4).map(Number);
  m = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)/.exec(css);
  if (m) return m.slice(1, 4).map((v) => Number(v) / 255);
  throw new Error(`unreadable colour ${css}`);
}
/** WCAG contrast of two opaque colours. */
function contrast(a, b) {
  const lum = (c) => { const [r, g, b2] = rgbOf(c).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/work-harness.tsx', '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(build, 'harness.js')}`, '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.env.DEV=false', '--loader:.png=dataurl', '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
writeFileSync(join(build, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./harness.css">'
  + '<style>html,body,#root{height:100%;margin:0}body{overflow:hidden}</style>'
  + '</head><body><div id="root"></div><script src="./harness.js"></script></body></html>');

const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${join(build, 'profile')}`, '--window-size=1720,1000', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
try {
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (expr) => (await page('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  /** Where the browser drew a thing, scrolled into view first. */
  const box = (sel) => run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(24, r.height / 2), cx: r.left + r.width / 2, top: r.top }; })()`);
  const open = async (width, height, mobile, query = '') => {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await page('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
    await page('Page.navigate', { url: `file://${join(build, 'harness.html')}${query}` });
    await sleep(2500);
  };
  const writes = () => run('JSON.stringify(window.__writes)');
  const said = (n) => run(`document.querySelector('[data-work-row="studio:${n}"] [data-work-said]')?.textContent ?? null`);

  const waitFor = async (expr, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await run(expr)) return true; await sleep(20); }
    return false;
  };
  /** How a card is drawn right now: its column, whether it is a ghost and
   *  saying what, its status pill and what was said on it. */
  const card = (n) => run(`(() => { const el = document.querySelector('[data-work-row="studio:${n}"]'); if (!el) return null;
    return { col: el.closest('[data-work-column]')?.getAttribute('data-work-column'), ghost: el.getAttribute('data-work-pending'),
      badge: el.querySelector('[data-work-badge]')?.textContent ?? null, pill: el.querySelector('.dv-status')?.textContent ?? null,
      said: el.querySelector('[data-work-said]')?.textContent ?? null, tone: el.querySelector('[data-work-said]')?.getAttribute('data-work-said') ?? null,
      tint: el.getAttribute('data-tint') }; })()`);
  /** From now on, how long after the next press is let go (or the next click)
   *  card #n is first drawn in \`column\` as a ghost with a badge. */
  const timeGhost = (n, column) => run(`(() => { window.__ghostMs = null; window.__upAt = null;
    const mark = () => { window.__upAt = performance.now(); };
    window.addEventListener('pointerup', mark, { capture: true, once: true });
    window.addEventListener('click', mark, { capture: true, once: true });
    const seen = () => document.querySelector('[data-work-column="${column}"] [data-work-row="studio:${n}"][data-work-pending] [data-work-badge]');
    const mo = new MutationObserver(() => { if (window.__upAt != null && seen()) { window.__ghostMs = performance.now() - window.__upAt; mo.disconnect(); } });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true }); return true; })()`);

  const mouse = async (card, column) => {
    const a = await box(`[data-work-row="studio:${card}"] .dv-card-title`);
    const b = await box(`[data-work-column="${column}"] h3`);
    await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.cx - a.x) * i / 8, y: a.y + (b.y + 60 - a.y) * i / 8, button: 'left', buttons: 1 });
    }
    await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.cx, y: b.y + 60, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
  };
  const finger = async (card, column) => {
    const a = await box(`[data-work-row="studio:${card}"] .dv-card-title`);
    const b = await box(`[data-work-column="${column}"] h3`);
    if (!a || !b) throw new Error(`nothing drawn for #${card} → ${column}`);
    await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    await sleep(500);
    for (let i = 1; i <= 8; i++) {
      await page('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.cx - a.x) * i / 8, y: a.y + (b.y + 40 - a.y) * i / 8 }] });
      await sleep(20);
    }
    await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
  };

  console.log('── a mouse, on a desk');
  await open(1720, 1000, false);
  await mouse(260, 'cancelled');
  ok('Queued → Cancelled: ustabasi cancel', (await writes()) === '["cancel 260"]', await writes());
  ok('…and the card says what the queue said', (await said(260)) === '#260 cancelled', await said(260));
  await mouse(31, 'queued');
  ok('Failed → Queued: ustabasi restart', (await writes()) === '["cancel 260","restart 31"]', await writes());
  await mouse(261, 'running');
  ok('Queued → In progress: ustabasi priority 0, and the card says it is starting',
    (await writes()) === '["cancel 260","restart 31","priority 261 0"]' && (await said(261)) === 'Starting…', `${await writes()} · ${await said(261)}`);
  await mouse(259, 'running');
  ok('Needs you → In progress: refused, no call', (await writes()) === '["cancel 260","restart 31","priority 261 0"]'
    && /^#259 is waiting on you/.test((await said(259)) || ''), await said(259));
  ok('…and the press that was a drag opened nothing', (await run('location.href')).endsWith('harness.html'));

  console.log('── a move the queue takes its time over');
  await open(1720, 1000, false, '?poll=1500');
  const loaded = await run('window.__loaded');
  await run('window.__holdWrites(true); window.__startNow = true');
  await timeGhost(72, 'running');
  await mouse(72, 'running');
  let c = await card(72);
  const ms72 = await run('window.__ghostMs');
  console.log(`  · ghost drawn ${ms72?.toFixed?.(0)} ms after the drop`);
  ok('Waiting → In progress: within 200 ms it is in In progress as a ghost saying Starting…, its status still the old one',
    ms72 != null && ms72 < 200 && c?.col === 'running' && c.ghost === 'running' && c.badge === 'Starting…' && c.pill === 'usage limit'
    && (await writes()) === '["priority 72 0"]', `${ms72?.toFixed?.(0)} ms · ${JSON.stringify(c)} · ${await writes()}`);
  // A poll goes out and is held across the answer: it read the queue before the move.
  await run('window.__holdNextList()');
  ok('…a poll is in flight', await waitFor('window.__listHeld', 4000));
  const before = await run('window.__lists');
  await run('window.__answer()');
  ok('…answered: the queue is read again at once, past the poll, and the card lands in In progress, running',
    await waitFor(`(() => { const el = document.querySelector('[data-work-column="running"] [data-work-row="studio:72"]');
      return !!el && !el.hasAttribute('data-work-pending') && el.querySelector('.dv-status')?.textContent === 'running'; })()`, 1000)
    && (await run('window.__lists')) > before && (await run('window.__listHeld')), JSON.stringify(await card(72)));
  ok('…with no reload of the page', (await run('window.__loaded')) === loaded && (await run('location.href')).endsWith('?poll=1500'));
  await run('window.__releaseList()');
  await sleep(100);
  ok('…and the poll that read before the move, answering last, is not drawn over it', (await card(72))?.col === 'running', JSON.stringify(await card(72)));

  // The same move from the Move to… menu.
  await run(`document.querySelector('[data-work-row="studio:260"] [data-work-move]').click()`);
  await timeGhost(260, 'running');
  await run(`[...document.querySelectorAll('[data-work-menu] [role="menuitem"]')].find((b) => b.textContent === 'In progress — start it').click()`);
  await sleep(50);
  c = await card(260);
  const ms260 = await run('window.__ghostMs');
  console.log(`  · ghost drawn ${ms260?.toFixed?.(0)} ms after the click`);
  ok('Move to… In progress: within 200 ms a ghost in In progress saying Starting…, still queued',
    ms260 != null && ms260 < 200 && c?.col === 'running' && c.ghost === 'running' && c.badge === 'Starting…' && c.pill === 'queued',
    `${ms260?.toFixed?.(0)} ms · ${JSON.stringify(c)}`);
  await run('window.__answer()');
  ok('…answered: it lands in In progress', await waitFor(`(() => { const el = document.querySelector('[data-work-column="running"] [data-work-row="studio:260"]');
    return !!el && !el.hasAttribute('data-work-pending'); })()`, 1000), JSON.stringify(await card(260)));

  // Refused, and dropped twice.
  await run('window.__writes.length = 0');
  await mouse(261, 'cancelled');
  c = await card(261);
  ok('Queued → Cancelled, held: a ghost in Cancelled saying Cancelling…', c?.col === 'cancelled' && c.badge === 'Cancelling…' && c.pill === 'queued', JSON.stringify(c));
  await mouse(261, 'running');
  ok('…dropped again while the first is out: no second call', (await writes()) === '["cancel 261"]' && (await card(261))?.col === 'cancelled', await writes());
  await run(`window.__answer('#261 is held by the supervisor; cancel refused')`);
  await sleep(200);
  c = await card(261);
  ok('…refused: the ghost goes, the card is back in Queued with the reason on it',
    c?.col === 'queued' && !c.ghost && !c.badge && c.tone === 'error' && c.said === '#261 is held by the supervisor; cancel refused', JSON.stringify(c));
  await run('window.__holdWrites(false)');

  console.log('── every card tinted by its status, readable in both themes');
  const TINT = { queued: 'grey', waiting: 'grey', running: 'running', blocked: 'ask', done: 'done', failed: 'failed', cancelled: 'grey' };
  for (const theme of ['dark', 'light']) {
    await open(1720, 1000, false, `?theme=${theme}&range=30d`);
    const cards = await run(`[...document.querySelectorAll('[data-work-row]')].map((el) => {
      const cs = getComputedStyle(el); const title = el.querySelector('.dv-card-title');
      return { key: el.getAttribute('data-work-row'), col: el.closest('[data-work-column]').getAttribute('data-work-column'), tint: el.getAttribute('data-tint'),
        bg: cs.backgroundColor, edge: cs.borderTopColor, ink: getComputedStyle(title).color };
    })`);
    const wrong = cards.filter((x) => x.tint !== TINT[x.col]);
    ok(`${theme}: every card's tint is its column's status (${cards.length} cards)`, cards.length > 10 && !wrong.length, JSON.stringify(wrong));
    const byTint = Object.fromEntries(cards.map((x) => [x.tint, x]));
    const bgs = new Set(Object.values(byTint).map((x) => x.bg));
    const edges = new Set(Object.values(byTint).map((x) => x.edge));
    ok(`${theme}: the five tints are five different surfaces and five different edges`, bgs.size === 5 && edges.size === 5,
      JSON.stringify(Object.fromEntries(Object.entries(byTint).map(([k, v]) => [k, `${v.bg} / ${v.edge}`]))));
    const worst = Math.min(...cards.map((x) => contrast(x.ink, x.bg)));
    ok(`${theme}: the title is at least 4.5:1 on every tint (lowest ${worst.toFixed(2)}:1)`, worst >= 4.5,
      JSON.stringify(Object.fromEntries(Object.entries(byTint).map(([k, v]) => [k, contrast(v.ink, v.bg).toFixed(2)]))));
  }

  console.log('── a finger, on a phone');
  await open(390, 844, true);
  await finger(260, 'waiting');
  ok('held, then moved to the column beside it: refused, no call', (await writes()) === '[]'
    && /^Waiting is the queue/.test((await said(260)) || ''), `${await writes()} · ${await said(260)}`);
  await finger(261, 'queued');
  ok('…to the top of Queued: ustabasi priority, ahead of #260', (await writes()) === '["priority 261 4"]', await writes());
  // The board is wider than a phone: put Cancelled on screen, then drag from
  // Done into it — both drawn together once scrolled to the end.
  await run(`document.querySelector('[data-work-board]').scrollLeft = 99999`);
  await sleep(200);
  await finger(70, 'cancelled');
  ok('Failed → Cancelled by finger: ustabasi cancel', (await writes()) === '["priority 261 4","cancel 70"]', await writes());
  ws.close();
} finally {
  browser.kill();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
