#!/usr/bin/env node
/** The opened ticket, clicked on.
 *
 *     CHROME=/path/to/chrome node scripts/test-ticket-ui.mjs
 *
 *  `npm test` checks the reading of a ticket and renders the view once; what
 *  it cannot see is a person typing. This drives a real browser over the
 *  DevTools protocol — no test runner, no driver library, nothing installed:
 *  Node has a WebSocket of its own and Chrome has a port.
 *
 *  It needs a browser on the machine, so it is not in CI and not in
 *  `npm test`. Point CHROME at one, or leave it and let it look in the usual
 *  places.
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
  'scripts/ticket-harness.tsx',
  // A plain script, not a module: a module loaded from a file:// page is a
  // cross-origin request, and the page comes up empty.
  '--bundle', '--format=iife', '--jsx=automatic', '--target=es2022',
  `--outfile=${join(out, 'harness.js')}`,
  '--define:process.env.NODE_ENV="development"',
  '--log-level=warning',
], { cwd: web, stdio: 'inherit' });

writeFileSync(join(out, 'harness.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Ticket harness</title><style>'
  + 'html,body,#root{height:100%;margin:0;background:#0F0E0C;color:#F1ECE3;overflow:hidden;'
  + 'font-family:-apple-system,system-ui,sans-serif}</style></head>'
  + '<body><div id="root"></div><script src="./harness.js"></script></body></html>');

// ── drive it ────────────────────────────────────────────────────────────────

const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + join(out, 'chrome-profile'),
  '--window-size=390,844', 'about:blank',
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

/** Run an expression in the page and hand back what it evaluated to. */
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

try {
  await page('Page.enable');
  // The window is asked for at 390 and a headless Chrome on macOS hands back
  // about 500 whatever it was asked; the viewport is the one thing it will
  // actually set to a phone's size.
  await page('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await page('Page.navigate', { url: `file://${join(out, 'harness.html')}` });
  // Waiting for the box rather than for a number of milliseconds: a browser
  // opening a cold profile takes a good deal longer to put a megabyte of React
  // on the screen than a warm one, and a fixed wait fails on the cold one.
  const up = await evaluate(`
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('textarea')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  `);
  if (!up) throw new Error('the harness did not come up — nothing to type into');

  console.log('── how it opens');
  const opened = await evaluate(`
    const scroller = [...document.querySelectorAll('div')].find((d) => d.style.overflowY === 'auto');
    return {
      atEnd: Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 4,
      scrollable: scroller.scrollHeight > scroller.clientHeight,
    };
  `);
  ok('there is more conversation than fits, so the end is a choice', opened.scrollable);
  ok('it opens at the end, where the question is', opened.atEnd);

  console.log('── typing in the box');
  await evaluate(`
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'Take the token from the shared vault.');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
  `);

  const afterSend = await evaluate(`
    return {
      sent: window.sent,
      box: document.querySelector('textarea').value,
      last: [...document.querySelectorAll('div')]
        .map((d) => d.textContent).filter(Boolean).at(-1),
      text: document.body.innerText,
    };
  `);
  ok('the note goes to the queue', afterSend.sent.length === 1
    && afterSend.sent[0] === 'Take the token from the shared vault.', JSON.stringify(afterSend.sent));
  ok('the box empties', afterSend.box === '');
  ok('the message lands in the conversation',
    afterSend.text.includes('Take the token from the shared vault.'));
  ok('it lands at the end, before the queue has said anything',
    afterSend.text.lastIndexOf('Take the token from the shared vault.')
    > afterSend.text.lastIndexOf('I stopped here'), afterSend.text.slice(-400));

  // The wall re-reads the queue a few seconds after a note lands, and the note
  // comes back as part of the ticket. The message shown before that must give
  // way to it rather than sit next to it.
  const settled = await evaluate(`
    await new Promise((r) => setTimeout(r, 2000));
    const text = document.body.innerText;
    return { copies: text.split('Take the token from the shared vault.').length - 1 };
  `);
  ok('once the queue has it, the message is not there twice', settled.copies === 1,
    `${settled.copies} copies`);

  console.log('── something arriving while it is being read');
  const read = await evaluate(`
    const scroller = [...document.querySelectorAll('div')].find((d) => d.style.overflowY === 'auto');
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    window.arrive('the supervisor put this on the ticket');
    await new Promise((r) => setTimeout(r, 200));
    return { top: scroller.scrollTop, text: document.body.innerText };
  `);
  ok('a note arriving does not drag the reading back down', read.top === 0, String(read.top));
  ok('but it is in the conversation', read.text.includes('the supervisor put this on the ticket'));

  console.log('── answering brings you back to the end');
  const back = await evaluate(`
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'and here is the answer');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const scroller = [...document.querySelectorAll('div')].find((d) => d.style.overflowY === 'auto');
    return Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 4;
  `);
  ok('answering scrolls to the answer', back === true);

  console.log('── a note the queue refuses');
  await evaluate(`
    window.refuse = true;
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'this one will be refused');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  `);
  const refused = await evaluate('return document.body.innerText;');
  ok('a refusal is said out loud', refused.includes('refused that note'));
  ok('a refused note is not left in the conversation',
    !refused.includes('this one will be refused'), refused.slice(-300));

  console.log('── the paperwork');
  const details = await evaluate(`
    const before = document.body.innerText;
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Details'));
    b.click();
    await new Promise((r) => setTimeout(r, 120));
    return { before, after: document.body.innerText };
  `);
  ok('the criteria start folded away', !details.before.includes('the sequence reads as a chat'));
  ok('opening Details shows them', details.after.includes('the sequence reads as a chat'));
  ok('and what the verifier said of them', details.after.includes('the long detail nobody reads'));

  console.log('── the rest of a long report');
  const more = await evaluate(`
    const before = document.body.innerText;
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('rest of this report'));
    b.click();
    await new Promise((r) => setTimeout(r, 120));
    return { before, after: document.body.innerText };
  `);
  ok('the tail of a report starts folded',
    !more.before.includes('This sentence is the end of the report.'));
  ok('it opens when asked', more.after.includes('This sentence is the end of the report.'));

  console.log('── in portrait, on a phone-sized window');
  const layout = await evaluate(`
    const de = document.documentElement;
    const r = document.querySelector('textarea').getBoundingClientRect();
    const scroller = [...document.querySelectorAll('div')].find((d) => d.style.overflowY === 'auto');
    return {
      wide: de.scrollWidth > de.clientWidth,
      scrollerWide: scroller.scrollWidth > scroller.clientWidth,
      boxOnScreen: r.bottom <= innerHeight && r.top > 0 && r.width > 200,
      width: innerWidth,
    };
  `);
  ok('the window is the phone-sized one', layout.width <= 420, String(layout.width));
  ok('nothing scrolls sideways', !layout.wide && !layout.scrollerWide);
  ok('the box is on screen, at the bottom', layout.boxOnScreen);

  console.log('── a ticket that is working, not stopped');
  await page('Page.navigate', { url: `file://${join(out, 'harness.html')}?status=running` });
  await evaluate('await new Promise((r) => setTimeout(r, 600));');
  const running = await evaluate(`
    return { text: document.body.innerText, box: !!document.querySelector('textarea') };
  `);
  ok('there is still a box to type in', running.box);
  ok('and it says when the note will be read', running.text.includes('stage boundary'));
  ok('the last thing said is one line about what it is doing',
    running.text.includes('Still on it'));
} finally {
  ws.close();
  browser.kill();
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
