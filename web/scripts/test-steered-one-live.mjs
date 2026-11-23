#!/usr/bin/env node
/** A message steered into a running turn does not start a second live row
 *  (23 Nov 2026).
 *
 *  The daemon hands a message typed mid-turn to the turn in flight
 *  (session.py `send`, provider.steer), so it lands in the timeline after a
 *  tool that is still running and is not `queued`. The steps row above it is
 *  the one turn's live row; "Thinking…" under the message as well made it look
 *  like two things were running at once. Once the tool is done, the row under
 *  the message is the one that says the turn is alive. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'steered-one-live');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules/.bin/tsc'), ['src/components/Timeline.tsx', 'src/lib/timeline.ts', 'src/vite-env.d.ts', '--outDir', out, '--rootDir', '.', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck'], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => spec.endsWith('.js') ? m : `${a}${spec}.js${z}`));
}
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Timeline } = await import(pathToFileURL(join(out, 'src/components/Timeline.js')));
const { apply } = await import(pathToFileURL(join(out, 'src/lib/timeline.js')));
const root = createRoot(document.getElementById('root'));
const now = Date.now() / 1000;
const ev = (event, data, seq) => ({ seq, chat_id: 'c', event, data, ts: now - 60 + seq });
const fold = (evs) => evs.reduce(apply, []);
const live = () => document.querySelectorAll('.dv-loader').length;
const waiting = () => document.querySelectorAll('[data-waiting]').length;
const show = (items, busy) => act(async () => root.render(h(Timeline, { hostKey: 'test', items, busy, onRespond: async () => {} })));

const start = [
  ev('message.user', { text: 'dur kanka' }, 1),
  ev('tool.use', { id: 'a', tool: 'Bash', input: { command: 'python3 post.py' } }, 2),
];
const steered = ev('message.user', { text: 'tüm referans videolarını atar mısın' }, 3);

// The tool is still running when the message lands: one live row, the tool's.
await show(fold([...start, steered]), true);
assert.equal(live(), 1, 'one live row while the tool runs');
assert.equal(waiting(), 0, 'no "Thinking…" under a steered message while a tool above it runs');

// The tool is done: the turn is now reading the message, and says so.
await show(fold([...start, steered, ev('tool.result', { id: 'a', output: 'ok' }, 4)]), true);
assert.equal(live(), 1, 'one live row once the tool is done');
assert.equal(waiting(), 1, 'the row under the message takes over');

// A tool left "running" by a turn that already ended does not hold the next
// turn's row back.
await show(fold([...start, ev('turn.done', {}, 4), ev('message.user', { text: 'aloo' }, 5)]), true);
assert.equal(waiting(), 1, 'a dead turn does not stop the new turn showing it is alive');

await act(async () => root.unmount());
rmSync(out, { recursive: true, force: true });
console.log('ok: a steered message shows one live row');
