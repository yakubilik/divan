#!/usr/bin/env node
/** An approval nobody answered says so (15 Oct 2026).
 *
 *  A request that timed out, or that a daemon restart dropped, reads as what
 *  happened and that it did not run; an Allow pressed on one says why it went
 *  nowhere instead of "Could not send. Please try again." — which could
 *  never work. A send that really did not arrive still offers to try again. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'approval-expired');
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

// The timeline keeps why an expired request expired.
const ev = (event, data, seq) => ({ seq, chat_id: 'c', event, data, ts: seq });
const request = (rid) => ev('approval.request', { request_id: rid, tool: 'Bash', input: { command: 'rm -rf ~/x' }, preview: 'rm -rf ~/x', danger: true, reason: 'can destroy the machine or your data: rm -r' }, 1);
let items = apply(apply([], request('t')), ev('approval.resolved', { request_id: 't', decision: 'expired', why: 'timeout', note: 'Permission timed out, so it was not run.' }, 2));
assert.equal(items[0].decision, 'expired');
assert.equal(items[0].why, 'timeout');
const dropped = apply(apply([], request('d')), ev('approval.resolved', { request_id: 'd', decision: 'expired', why: 'restart' }, 2));
assert.equal(dropped[0].why, 'restart');

const text = () => document.getElementById('root').textContent;
await act(async () => root.render(h(Timeline, { hostKey: 'test', items, onRespond: async () => {} })));
assert.match(text(), /timed out, not run/);
await act(async () => root.render(h(Timeline, { hostKey: 'test', items: dropped, onRespond: async () => {} })));
assert.match(text(), /dropped when the daemon restarted, not run/);

// An Allow pressed on a request the daemon no longer holds.
const pending = apply([], request('p'));
let failure = null;
const err = (code, message) => Object.assign(new Error(message), { code });
await act(async () => root.render(h(Timeline, { hostKey: 'test', items: pending, onRespond: async () => { throw failure; } })));
const allow = async () => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Allow');
  assert.ok(el, 'Allow button');
  await act(async () => el.click());
  return document.querySelector('[role="alert"]').textContent;
};
failure = err('approval_expired', 'x');
let said = await allow();
assert.match(said, /timed out before your answer arrived, so it was not run/);
assert.doesNotMatch(said, /Could not send/);
failure = err('approval_dropped', 'x');
assert.match(await allow(), /dropped when the daemon restarted, so it was not run/);
failure = err('no_pending_approval', 'x');
assert.match(await allow(), /no longer waiting, so nothing was run/);
// Not reaching the computer at all is still worth another press.
failure = err('offline', 'offline');
assert.match(await allow(), /Could not send\. Please try again\./);

await act(async () => root.unmount());
dom.window.close();
console.log('Expired approvals: all good');
