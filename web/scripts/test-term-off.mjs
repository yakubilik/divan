#!/usr/bin/env node
/** Machine › Terminal on a computer whose terminal is turned off.
 *
 *     cd web && npm test
 *
 *  `terminal = false` in a daemon's config.toml makes every `term.*` answer
 *  `terminal_disabled`, and its host.status says `terminal: false`. The whole
 *  panel mounted into jsdom, as in test-term.mjs, against two fake daemons:
 *
 *    studio  says `terminal: false` in hello's host. Opening the Terminal page
 *            and pressing "Open a shell" (the page's new-terminal button) and
 *            `+` shows the sentence for `terminal_disabled`, sends no `term.*`
 *            at all and leaves no tab or pane behind.
 *    mini    says nothing about it (a daemon from before the switch) and then
 *            answers `term.open` with `terminal_disabled`. The page asks once,
 *            shows the same sentence, leaves no tab, and asks nothing more
 *            when the button is pressed again.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'term-off');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/lib/term.ts', 'src/vite-env.d.ts',
  '--outDir', '.test-build/term-off', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    ))
    // What vite would have defined: this is not the dev server.
    .replace(/import\.meta\.env\.DEV/g, 'false'));
}
mkdirSync(join(out, 'src', 'assets'), { recursive: true });
for (const f of readdirSync(join(web, 'src', 'assets'))) {
  if (f.endsWith('.png')) writeFileSync(join(out, 'src', 'assets', `${f}.js`), `export default ${JSON.stringify(`/assets/${f}`)};\n`);
}

// ── a document ──────────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/machine/machines', pretendToBeVisual: true,
});
const w = dom.window;
for (const name of Object.getOwnPropertyNames(w)) {
  if (name in globalThis) continue;
  try { globalThis[name] = w[name]; } catch { /* not ours */ }
}
for (const name of ['window', 'document', 'location', 'history', 'localStorage',
                    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
                    'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  try { globalThis[name] = w[name]; } catch { /* as above */ }
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
} catch { /* node's own is good enough */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
  if (!globalThis[name]) {
    globalThis[name] = class { observe() {} unobserve() {} disconnect() {} };
    w[name] = globalThis[name];
  }
}
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function scrollIntoView() {};
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
globalThis.matchMedia = w.matchMedia;
globalThis.fetch = async () => { throw new Error('no network in this check'); };
w.fetch = globalThis.fetch;

// ── the daemon, faked at the socket ─────────────────────────────────────────

const wire = [];
const sockets = [];
const STUDIO = '10.0.0.1';
const MINI = '10.0.0.2';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.host = new URL(url).hostname;
    this.readyState = FakeSocket.CONNECTING;
    sockets.push(this);
    setTimeout(() => { this.readyState = FakeSocket.OPEN; this.onopen?.({}); }, 0);
  }
  push(m) { if (this.readyState === FakeSocket.OPEN) this.onmessage?.({ data: JSON.stringify(m) }); }
  send(raw) {
    const { id, type } = JSON.parse(raw);
    wire.push({ host: this.host, type });
    const reply = (d) => setTimeout(() => this.push({ type: 'ok', id, data: d }), 0);
    const refuse = (code, message) => setTimeout(() => this.push({ type: 'error', id, data: { code, message } }), 0);
    if (type === 'ping') return reply({});
    if (type === 'hello') {
      return reply({ host: this.host === STUDIO ? { name: 'studio', terminal: false } : { name: 'mini' } });
    }
    // What server.py `_terminal_gate` answers, for every term.* alike.
    if (type.startsWith('term.')) return refuse('terminal_disabled', 'the terminal is turned off on this computer');
    return refuse('unknown_type', type);
  }
  close() { this.readyState = FakeSocket.CLOSED; }
}
globalThis.WebSocket = FakeSocket;
w.WebSocket = FakeSocket;

localStorage.setItem('rac.hosts', JSON.stringify([
  { host: STUDIO, port: 8790, token: 'tok-studio', name: 'studio' },
  { host: MINI, port: 8790, token: 'tok-mini', name: 'mini' },
]));

const views = [];
function fakeView(el) {
  const v = {
    el, text: '', cols: 120, rows: 40, disposed: false,
    write(d) { v.text += d; }, onData() {}, onResize() {}, fit() {}, focus() {},
    dispose() { v.disposed = true; },
  };
  views.push(v);
  return Promise.resolve(v);
}

// ── mount ───────────────────────────────────────────────────────────────────

const imp = (p) => import(pathToFileURL(join(out, p)).href);
const term = await imp('src/lib/term.js');
term.setViewFactory(fakeView);
const { useFleet } = await imp('src/lib/fleet.js');
const { errText } = await imp('src/lib/i18n.js');
const { App } = await imp('src/App.js');
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;

const doc = w.document;
const tick = (ms = 20) => act(() => new Promise((r) => setTimeout(r, ms)));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }
async function click(el) { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await settle(); }
const termSent = (host) => wire.filter((m) => m.host === host && m.type.startsWith('term.'));
const tabs = () => [...doc.querySelectorAll('[role="tab"]')];
const panes = () => [...doc.querySelectorAll('[data-shell-pane]')];
const openButton = () => [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Open a shell'));
const plus = () => doc.querySelector('button[aria-label="Open another shell"]');
const SENTENCE = errText('terminal_disabled');
const said = () => [...doc.querySelectorAll('[role="alert"]')].some((el) => el.textContent === SENTENCE);

useFleet.getState().boot();
const root = createRoot(doc.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });
await settle(10);

group('the sentence');
ok('terminal_disabled has a sentence of its own, not the generic error',
  SENTENCE !== errText(null) && /terminal is turned off/i.test(SENTENCE), SENTENCE);

group('studio says terminal: false');
ok('studio’s host.status was taken in', useFleet.getState().hosts[Object.keys(useFleet.getState().hosts)
  .find((k) => k.startsWith(STUDIO))]?.info?.terminal === false);
const machineTab = (label) => [...doc.querySelectorAll('[aria-label="Machine"] button')]
  .find((b) => (b.textContent ?? '').trim().startsWith(label));
await click(machineTab('Terminal'));
await settle(10);
ok('opening the Terminal page sends no term.* to it', termSent(STUDIO).length === 0, JSON.stringify(termSent(STUDIO)));
ok('…and says why, in that sentence', said(), (doc.body.textContent ?? '').slice(0, 400));
ok('…and leaves no tab and no pane', tabs().length === 0 && panes().length === 0 && views.length === 0);
const btn = openButton();
ok('the new-terminal button is there', !!btn);
await click(btn);
await settle();
ok('pressing it sends no term.*', termSent(STUDIO).length === 0, JSON.stringify(termSent(STUDIO)));
ok('…shows the sentence', said());
ok('…and leaves no empty tile', tabs().length === 0 && panes().length === 0 && views.length === 0
  && term.useShells.getState().shells.length === 0);
await click(plus());
ok('+ sends nothing and makes no tab either', termSent(STUDIO).length === 0 && tabs().length === 0 && said());

group('mini says nothing, and answers terminal_disabled');
await act(async () => {
  const f = useFleet.getState();
  f.setFocus(f.order.find((x) => x.startsWith(MINI)));
});
await settle(10);
ok('the page asked mini once (term.open)', termSent(MINI).length === 1 && termSent(MINI)[0].type === 'term.open',
  JSON.stringify(termSent(MINI)));
ok('…showed the sentence', said(), (doc.body.textContent ?? '').slice(0, 400));
ok('…and left no tab and no pane', tabs().length === 0 && panes().length === 0
  && term.useShells.getState().shells.length === 0);
await click(openButton());
await click(plus());
ok('pressing the button again sends no further term.*', termSent(MINI).length === 1, JSON.stringify(termSent(MINI)));
ok('…still says why and still has no tab', said() && tabs().length === 0 && panes().length === 0);
ok('studio was never sent a term.* at all', termSent(STUDIO).length === 0);

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
