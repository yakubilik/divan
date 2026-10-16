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
 *  Then a card pressed where a person presses: its chat opens at the bottom
 *  right over a board that has not moved — the question and Evet for a card
 *  that needs you, answered from there with `ustabasi.note` — another card
 *  switches it, Enter opens it, and every card's project is a heading larger
 *  and bolder than the line under it that opens the ticket's page, Back
 *  landing on the board as it was.
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
    // Drawn when the cards are, not after a fixed wait: a busy machine takes longer.
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      if (i >= 10 && await run(`document.querySelectorAll('[data-work-row]').length > 0`)) break;
    }
    await sleep(300);
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
  ok('…and the press that was a drag opened nothing: no page, no chat', (await run('location.href')).endsWith('harness.html')
    && !(await run(`!!document.querySelector('[data-work-chat]')`)));

  console.log('── a card pressed opens its chat over the board; its heading opens its page');
  await open(1280, 800, false, '?range=30d');
  /** A press where a person presses: down and up on the same point, no move. */
  const press = async (sel) => {
    const a = await box(sel);
    if (!a) throw new Error(`nothing drawn for ${sel}`);
    await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
    await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  /** Where the page is: its address, the board's scroll, the filters, the history. */
  const place = () => run(`JSON.stringify({ href: location.href, side: document.querySelector('[data-work-board]')?.scrollLeft ?? null,
    top: document.querySelector('[data-work]')?.parentElement?.scrollTop ?? null, days: document.querySelector('[data-work-preset][aria-pressed="true"]')?.getAttribute('data-work-preset') ?? null,
    board: !!document.querySelector('[data-work-board]'), history: history.length })`);
  const chatNow = () => run(`(() => { const el = document.querySelector('[data-work-chat]'); if (!el) return null; const r = el.getBoundingClientRect();
    return { key: el.getAttribute('data-work-chat'), head: el.querySelector('header')?.textContent ?? '', right: innerWidth - r.right, bottom: innerHeight - r.bottom,
      left: r.left, question: el.querySelector('[data-work-question]')?.textContent ?? null,
      answers: [...el.querySelectorAll('[data-work-answers] button')].map((b) => b.textContent),
      reply: el.querySelector('input')?.getAttribute('placeholder') ?? null, sent: el.querySelector('[data-work-sent]')?.textContent ?? null }; })()`);
  // Somewhere other than the top left, so that "the same scroll" means something.
  await run(`document.querySelector('[data-work-board]').scrollLeft = 120`);
  await sleep(100);
  const was = await place();
  await press('[data-work-row="studio:259"] .dv-card-title');
  let ch = await chatNow();
  ok('a needs-you card pressed: the address, the scroll, the days and the history are what they were', (await place()) === was, `${was} → ${await place()}`);
  ok('…and its chat is open at the bottom right: Coder asks you, the question, Evet, a box to reply in',
    ch?.key === 'studio:259' && /Coder\s*asks you/.test(ch.head) && ch.right >= 0 && ch.right < 40 && ch.bottom >= 0 && ch.bottom < 40 && ch.left > 640
    && ch.question?.includes('kişisel Apple takımını kullanayım mı?') && JSON.stringify(ch.answers) === '["Evet"]' && ch.reply === 'Reply to Coder…',
    JSON.stringify(ch));
  await run('window.__writes.length = 0');
  await press('[data-work-chat] [data-work-answers] button');
  ch = await chatNow();
  ok('Evet pressed: ustabasi.note on #259 with Evet, and the board stays where it was',
    (await writes()) === '["note 259 Evet"]' && (await place()) === was, `${await writes()} · ${await place()}`);
  ok('…the window keeps the conversation, with the answer in it',
    ch?.key === 'studio:259' && await waitFor(`[...document.querySelectorAll('[data-work-chat] [data-work-line="you"]')].some((el) => el.textContent.includes('Evet'))`, 3000),
    JSON.stringify(await chatNow()));
  await press('[data-work-row="studio:258"] .dv-card-title');
  ch = await chatNow();
  ok('a running card pressed switches the window to it: working, no question, board unmoved',
    ch?.key === 'studio:258' && /Coder\s*working/.test(ch.head) && ch.question === null && !ch.answers.length && (await place()) === was,
    `${JSON.stringify(ch)} · ${await place()}`);
  await run(`document.querySelector('[data-work-board]').scrollLeft = 99999`);
  await sleep(100);
  const end = await place();
  await press('[data-work-row="studio:257"] .dv-card-title');
  ch = await chatNow();
  ok('…a done card too', ch?.key === 'studio:257' && /Coder\s*done/.test(ch.head) && (await place()) === end, `${JSON.stringify(ch)} · ${await place()}`);
  // The keyboard: Enter on a card opens its chat.
  await run(`document.querySelector('[data-work-row="studio:71"] [data-work-open]').focus()`);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  ok('Enter on a focused card opens its chat', (await chatNow())?.key === 'studio:71', JSON.stringify(await chatNow()));

  const heads = await run(`[...document.querySelectorAll('[data-work-row]')].map((el) => {
    const h = el.firstElementChild; const m = el.querySelector('[data-work-meta]'); const hb = h?.querySelector('[data-work-heading]');
    const hs = hb ? getComputedStyle(hb) : null; const ms = getComputedStyle(m);
    return { key: el.getAttribute('data-work-row'), tag: h?.tagName, text: hb?.textContent ?? null, above: !!hb && hb.getBoundingClientRect().bottom <= el.querySelector('.dv-card-title').getBoundingClientRect().top,
      size: hs ? parseFloat(hs.fontSize) : 0, weight: hs ? Number(hs.fontWeight) : 0, metaSize: parseFloat(ms.fontSize), metaWeight: Number(ms.fontWeight),
      meta: m.textContent }; })`);
  const bad = heads.filter((x) => x.tag !== 'H4' || !x.text || !x.above || !(x.size > x.metaSize) || !(x.weight > x.metaWeight) || x.meta.startsWith(x.text));
  ok(`every card's first line is its project, as a heading over the title, larger and bolder than the line under it (${heads.length} cards; ${heads[0]?.size}px ${heads[0]?.weight} over ${heads[0]?.metaSize}px ${heads[0]?.metaWeight})`,
    heads.length > 10 && !bad.length, JSON.stringify(bad.slice(0, 3)));
  await run(`document.querySelector('[data-work-board]').scrollLeft = 120`);
  await sleep(100);
  const left = await place();
  await press('[data-work-row="studio:258"] [data-work-heading]');
  ok('a heading pressed opens the ticket\'s page, one entry in the history',
    (await run(`!!document.querySelector('[data-ticket-page="studio:258"]')`)) && (await run('location.hash')) === '#ticket/studio/258'
    && (await run('history.length')) === JSON.parse(left).history + 1, await run('location.href'));
  await run('history.back()');
  await waitFor(`document.querySelectorAll('[data-work-row]').length > 0 && document.querySelector('[data-work-board]').scrollLeft > 0`, 3000);
  const after = JSON.parse(await place());
  ok('Back is the Work board as it was: the same address, the same days, the same scroll',
    after.board && after.href === JSON.parse(left).href && after.days === '30d' && after.side === JSON.parse(left).side,
    `${left} → ${JSON.stringify(after)}`);

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
        bg: cs.backgroundColor, edge: cs.borderTopColor, ink: getComputedStyle(title).color,
        meta: getComputedStyle(el.querySelector('[data-work-meta]')).color };
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
    const meta = Math.min(...cards.map((x) => contrast(x.meta, x.bg)));
    ok(`${theme}: …and so is the grey line under it (lowest ${meta.toFixed(2)}:1)`, meta >= 4.5,
      JSON.stringify(Object.fromEntries(Object.entries(byTint).map(([k, v]) => [k, contrast(v.meta, v.bg).toFixed(2)]))));
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
