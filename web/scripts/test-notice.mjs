#!/usr/bin/env node
/** A ticket's end, told to the chat that filed it, is one line until opened.
 *
 *     cd web && npm test
 *
 *  The messages here are the ones the daemon stored: #157 (done, merged, with
 *  the phone and voice-build limits), #139 (asking, the older "Tell him"
 *  wording) and #152 (a note the person steered into the same message). They
 *  go through the same fold a reconnect replays and a live event takes, and
 *  the timeline is mounted and clicked. Keyboard activation in a real browser
 *  is `scripts/test-notice-ui.mjs`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { DONE_157, BLOCKED_139, FAILED, STEERED_152, CONTROL, QUOTED } from './notice-fixture.js';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'notice');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules/.bin/tsc'), [
  'src/components/Timeline.tsx', 'src/lib/timeline.ts', 'src/lib/notice.ts', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.', '--target', 'ES2022', '--module', 'ESNext',
  '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]*?)(['"])/g,
    (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`)));
}
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
});
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Timeline } = await import(pathToFileURL(join(out, 'src/components/Timeline.js')));
const { apply } = await import(pathToFileURL(join(out, 'src/lib/timeline.js')));
const { ticketNotice } = await import(pathToFileURL(join(out, 'src/lib/notice.js')));

const INSTRUCTION = 'You filed this ticket from this chat';
let seq = 0;
/** The events a reconnect replays, folded the way the panel folds them. */
const fold = (events) => events.reduce((items, e) => apply(items, { seq: ++seq, ts: 1000 + seq, ...e }), []);
const user = (text, more = {}) => ({ event: 'message.user', data: { text, attachments: [], ...more } });

const root = createRoot(document.getElementById('root'));
const show = (items) => act(async () => root.render(h(Timeline, { items, hostKey: 'test', onRespond: () => {} })));
const notices = () => [...document.querySelectorAll('[data-notice]')];
const toggle = (n) => n.querySelector('button[aria-expanded]');
const click = (el) => act(async () => el.click());

// ── reading the message ──
{
  const n = ticketNotice(DONE_157);
  assert.deepEqual([n.ticket, n.state, n.title], [157, 'done', 'Match mobile chat grouping to the web']);
  assert.match(n.report, /delivered but not installed because the phone was unreachable/);
  assert.deepEqual(n.facts, [
    '🔀 merged into main (1664073)',
    'branch ustabasi/157-match-mobile-chat-grouping-to-the-web · 1 commit · worktree silindi, dal duruyor',
  ]);
  assert.ok(!n.report.includes(INSTRUCTION) && n.after === '');
  assert.equal(ticketNotice(BLOCKED_139).state, 'blocked');
  assert.equal(ticketNotice(FAILED).state, 'failed');
  assert.equal(ticketNotice(STEERED_152).after, 'bunun senle ne alakası var');
  for (const text of [CONTROL, QUOTED, DONE_157.replace('ustabasi show 157', 'ustabasi show 158'), DONE_157.replace('🔔 ', '')]) {
    assert.equal(ticketNotice(text), null, text.slice(0, 60));
  }
}

// ── #157, from history: one line, then the report, then one line again ──
await show(fold([user(CONTROL), user(DONE_157)]));
{
  const [n] = notices();
  assert.ok(n, 'the #157 message is drawn as a notice');
  assert.equal(notices().length, 1, 'the control message is not a notice');
  const row = toggle(n);
  assert.equal(row.type, 'button', 'the row is a real button: Enter and Space open it');
  assert.equal(row.getAttribute('aria-expanded'), 'false');
  assert.match(row.textContent, /Done\s*#157\s*Match mobile chat grouping to the web/);
  assert.equal(n.querySelector('[data-notice-title]').style.textOverflow, 'ellipsis');
  assert.equal(n.querySelector('[data-notice-title]').style.whiteSpace, 'nowrap');
  assert.equal(n.textContent, row.textContent, 'closed, nothing but the line is drawn');
  assert.ok(!document.body.textContent.includes(INSTRUCTION));
  assert.ok(!document.body.textContent.includes('the phone was unreachable'));

  await click(row);
  assert.equal(row.getAttribute('aria-expanded'), 'true');
  const detail = document.getElementById(row.getAttribute('aria-controls'));
  assert.ok(detail && n.contains(detail), 'the report opens inline, under its own line');
  assert.match(detail.textContent, /delivered but not installed because the phone was unreachable/);
  assert.match(detail.textContent, /does not contain the #150 voice work/);
  assert.match(detail.textContent, /merged into main \(1664073\)/);
  assert.ok(!detail.textContent.includes(INSTRUCTION) && !detail.textContent.includes('ustabasi show'));
  assert.ok(!document.body.textContent.includes(INSTRUCTION));

  await click(row);
  assert.equal(row.getAttribute('aria-expanded'), 'false');
  assert.equal(n.textContent, row.textContent);
}

// ── the control keeps its bubble, its words and its attachment ──
{
  await show(fold([user(CONTROL, { attachments: [{ path: '/tmp/notes.txt', name: 'notes.txt', mime: 'text/plain' }] })]));
  assert.equal(notices().length, 0);
  assert.ok(document.body.textContent.includes(CONTROL));
  assert.ok([...document.querySelectorAll('a')].some((a) => a.textContent === 'notes.txt'), 'the attachment is still drawn');
  await show(fold([user(QUOTED)]));
  assert.equal(notices().length, 0, 'a person quoting a notice head is still a person talking');
  assert.ok(document.body.textContent.includes(QUOTED.split('\n')[0]));
}

// ── asking and failed: their own state, and what they say behind it ──
await show(fold([user(BLOCKED_139), user(FAILED)]));
{
  const [b, f] = notices();
  assert.equal(b.dataset.state, 'blocked');
  assert.match(toggle(b).textContent, /Needs an answer\s*#139/);
  assert.equal(f.dataset.state, 'failed');
  assert.match(toggle(f).textContent, /Failed\s*#161/);
  await click(toggle(b));
  await click(toggle(f));
  assert.match(b.textContent, /Ben ekleyeyim mi\?/);
  assert.match(f.textContent, /npm test exited 1: 3 failing/);
  assert.ok(!document.body.textContent.includes(INSTRUCTION));
}

// ── live: a notice steered into a running turn arrives queued, and draws the same ──
{
  const items = fold([user(CONTROL)]);
  await show(apply(items, { seq: ++seq, ts: 2000, ...user(STEERED_152, { queued: true }) }));
  const [n] = notices();
  assert.ok(n);
  assert.match(toggle(n).textContent, /Done\s*#152.*queued/);
  assert.ok(!document.body.textContent.includes(INSTRUCTION));
  assert.ok(document.body.textContent.includes('bunun senle ne alakası var'), 'what the person added is still theirs to see');
}

await act(async () => root.unmount());
dom.window.close();
console.log('Ticket notices: all good');
