#!/usr/bin/env node
/** The wall, looked at — on a phone held upright, and on a desk.
 *
 *     CHROME=/path/to/chrome node scripts/test-wall-ui.mjs
 *
 *  `npm test` checks what a card says. What it cannot check is whether the wall
 *  is readable: how many columns there are at a given width, whether a column
 *  takes the whole width when there is only room for one, and whether a long
 *  commit subject pushes the page wider than the phone. Those are the browser's
 *  answers, so this asks the browser — over the DevTools protocol, the way
 *  test-ticket-ui.mjs does, with nothing installed.
 *
 *  Not in CI: it needs a browser on the machine. Point CHROME at one, or leave
 *  it and let it look in the usual places.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build');

const CHROMES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  console.error('no browser found — set CHROME to one');
  process.exit(2);
}

// ── build the page ──────────────────────────────────────────────────────────

mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'scripts/wall-harness.tsx',
  // A plain script, not a module: a module loaded from a file:// page is a
  // cross-origin request, and the page comes up empty.
  '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'wall.js')}`,
  '--define:process.env.NODE_ENV="development"',
  '--log-level=error',
], { cwd: web, stdio: 'inherit' });

writeFileSync(join(out, 'wall.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Wall harness</title><style>'
  + 'html,body{margin:0;background:#0F0E0C;color:#F1ECE3;'
  + 'font-family:-apple-system,system-ui,sans-serif}#root{padding:24px}'
  + '</style></head><body><div id="root"></div>'
  + '<script src="./wall.js"></script></body></html>');

// ── drive it ────────────────────────────────────────────────────────────────

const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'chrome-profile'),
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const endpoint = await new Promise((done, fail) => {
  let buf = '';
  const timer = setTimeout(() => fail(new Error('the browser never said where it was listening')), 20000);
  browser.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); done(m[0]); }
  });
  browser.on('exit', (code) => { clearTimeout(timer); fail(new Error(`the browser stopped (${code})`)); });
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
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'threw');
  return r.result.value;
}

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

/** The wall as the browser has it: the columns, their width, whether anything
 *  at all sticks out past the right edge of the page, and where on the card the
 *  two figures about time are drawn — the whole point of the card being that the
 *  total is the one you read first, which is a matter of position and size and
 *  so is only true in a browser. */
const READ = `
  const root = document.getElementById('root');
  // The innermost element that says it, so a size is the size of the words and
  // not of some box four levels up that happens to contain them.
  const saying = (re) => [...root.querySelectorAll('*')].find((e) =>
    re.test(e.textContent || '')
    && ![...e.children].some((c) => re.test(c.textContent || ''))) || null;
  const drawn = (re) => {
    const e = saying(re);
    if (!e) return null;
    const box = e.getBoundingClientRect();
    return { size: parseFloat(getComputedStyle(e).fontSize), top: Math.round(box.top) };
  };
  const grid = root.firstElementChild;
  const cols = [...grid.children];
  const de = document.documentElement;
  return {
    width: innerWidth,
    room: Math.round(grid.getBoundingClientRect().width),
    columns: cols.length,
    widths: cols.map((c) => Math.round(c.getBoundingClientRect().width)),
    headings: cols.map((c) => c.firstElementChild.textContent),
    sideways: de.scrollWidth - de.clientWidth,
    past: [...root.querySelectorAll('*')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5)
      .map((e) => e.tagName + '@' + Math.round(e.getBoundingClientRect().right)
        + ' ' + (e.textContent || '').slice(0, 40)),
    total: drawn(/^open 15h 18m$/),
    round: drawn(/in this round/),
    text: root.innerText,
  };
`;

/** Lay the same wall out at a given size and read it back. */
async function at(width, height) {
  await page('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 500,
  });
  await evaluate('await new Promise((r) => setTimeout(r, 250));');
  return evaluate(READ);
}

try {
  await page('Page.enable');
  await page('Page.navigate', { url: `file://${join(out, 'wall.html')}` });
  // Waiting for the wall rather than for a number of milliseconds: a browser
  // opening a cold profile takes a good deal longer to put a megabyte of React
  // on the screen than a warm one, and a fixed wait fails on the cold one.
  await evaluate(`
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('#root section')) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the wall never came up');
  `);

  console.log('── a phone, held upright');
  const phone = await at(390, 844);
  ok('the window is the phone-sized one', phone.width === 390, String(phone.width));
  ok('three projects, three columns', phone.columns === 3, String(phone.columns));
  ok('each column is titled with its project',
    phone.headings.map((h) => h.replace(/\d+$/, '')).join('|') === 'remote-ai-chat|babysee|ustabasi',
    phone.headings.join('|'));
  ok('the columns are stacked, one across',
    phone.widths.every((w) => w >= phone.room - 8), JSON.stringify(phone.widths));
  ok('nothing to drag sideways', phone.sideways === 0, String(phone.sideways));
  ok('nothing drawn past the right edge', phone.past.length === 0, JSON.stringify(phone.past));

  console.log('── what a card says, in the order it says it');
  ok('the total time comes first, and is labelled as the ticket being open',
    /open 15h 18m/.test(phone.text), phone.text.slice(0, 300));
  ok('the round comes after it, labelled as the round',
    phone.text.indexOf('open 15h 18m') < phone.text.indexOf('49m in this round'));
  ok('and is drawn under it, not beside it',
    phone.total && phone.round && phone.total.top < phone.round.top,
    JSON.stringify([phone.total, phone.round]));
  ok('and smaller than it, so the total is the figure read first',
    phone.total.size > phone.round.size,
    JSON.stringify([phone.total, phone.round]));
  ok('no card says "in this state"', !phone.text.includes('in this state'));
  ok('where the work is: whose hands, which round', /worker r2/.test(phone.text),
    phone.text.slice(0, 300));
  ok('how many commits are on the branch', /12 commits/.test(phone.text));
  ok('and the last one of them', phone.text.includes('The wall is a column per project'));
  ok('a card with nothing committed says nothing about commits',
    (phone.text.match(/commits/g) || []).length === 3, phone.text);
  ok('a finished card says how long it took', /took 13h 18m/.test(phone.text));
  ok('no percentage anywhere on the wall', !/\d\s?%/.test(phone.text), phone.text);
  ok('no pid and no model name: the card says whose hands it is in, not which process',
    !/\bpid\b|\bmodel\b/.test(phone.text), phone.text);
  ok('a card with nothing said about it yet says what the ticket is for',
    phone.text.includes('Make a tile open as a conversation'), phone.text);

  console.log('── a desk');
  const desk = await at(1280, 900);
  ok('the same three are side by side', desk.columns === 3, String(desk.columns));
  ok('side by side means each is a fraction of the width',
    desk.widths.every((w) => w < desk.room / 2), JSON.stringify(desk.widths));
  ok('and still nothing to drag sideways', desk.sideways === 0, String(desk.sideways));

  console.log('── a narrow phone');
  const small = await at(320, 568);
  ok('still one column across', small.widths.every((w) => w >= small.room - 8),
    JSON.stringify(small.widths));
  ok('and still nothing to drag sideways', small.sideways === 0, String(small.sideways));
  ok('nor anything past the edge', small.past.length === 0, JSON.stringify(small.past));
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
