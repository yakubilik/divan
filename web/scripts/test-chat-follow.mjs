#!/usr/bin/env node
/** A chat followed to its end keeps the rows that come without an item in
 *  view (23 Nov 2026).
 *
 *  The "Thinking…" row appears when the chat turns busy, a moment after the
 *  message that started it; the view only scrolled when the items changed, so
 *  the row sat under the composer until the chat was scrolled by hand. jsdom
 *  has no layout: the column's growth is played by the observer it watches. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'chat-follow');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules/.bin/tsc'), ['src/components/ChatView.tsx', 'src/vite-env.d.ts', '--outDir', out, '--rootDir', '.', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck'], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => spec.endsWith('.js') ? m : `${a}${spec}.js${z}`));
}
mkdirSync(join(out, 'src', 'assets'), { recursive: true });
for (const f of readdirSync(join(web, 'src', 'assets'))) {
  if (f.endsWith('.png')) writeFileSync(join(out, 'src', 'assets', `${f}.js`), `export default ${JSON.stringify(`/assets/${f}`)};\n`);
}
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
const observers = [];
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; this.els = []; observers.push(this); }
  observe(el) { this.els.push(el); }
  disconnect() { this.els = []; }
}
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, getComputedStyle: dom.window.getComputedStyle,
  ResizeObserver: FakeResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.ResizeObserver = FakeResizeObserver;
// The scroller's content is as tall as the test says; where it was scrolled to is kept.
let tall = 1000;
const at = new WeakMap();
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return tall; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollTop', {
  configurable: true, get() { return at.get(this) ?? 0; }, set(v) { at.set(this, v); },
});
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ChatView } = await import(pathToFileURL(join(out, 'src/components/ChatView.js')));
const { chat: makeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
const root = createRoot(document.getElementById('root'));

const items = [{ kind: 'user', id: 's1', ts: Date.now() / 1000, text: 'bak', attachments: [], queued: false }];
const props = (status, busy) => ({
  chat: { ...makeChat(), status }, hostKey: 'studio', log: { items, busy, pending: [] }, sending: false,
  groups: [], groupName: null, accountLabel: null, accountUsage: null, liveTokens: null,
  onSend: async () => {}, onUpload: async () => ({}), onInterrupt() {}, onRespond() {},
  onEdit() {}, onUpdate() {}, onDelete() {}, onPopOut() {},
});
await act(async () => root.render(h(ChatView, props('idle', false))));
const scroller = [...document.querySelectorAll('div')].find((d) => d.style.overflowY === 'auto');
assert.ok(scroller, 'the chat scroller');
assert.equal(scroller.scrollTop, 1000, 'opened at the end');

// The chat turns busy with the same items: the "Thinking…" row adds height.
tall = 1040;
await act(async () => root.render(h(ChatView, props('running', true))));
assert.ok(document.querySelector('[data-waiting]'), 'the Thinking row is drawn');
await act(async () => { for (const o of observers) if (o.els.length) o.cb([]); });
assert.equal(scroller.scrollTop, 1040, 'the row that came without an item is scrolled into view');

await act(async () => root.unmount());
rmSync(out, { recursive: true, force: true });
console.log('ok: a followed chat keeps the Thinking row in view');
