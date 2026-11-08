#!/usr/bin/env node
/** Machine › Terminal opens a real shell: the panel's half of `term.*`.
 *
 *     cd web && npm test
 *
 *  The whole panel mounted into jsdom, with two paired computers whose sockets
 *  are fakes standing in for the daemon — the real fleet store and the real
 *  RacClient on top of them, so what is asserted is what goes over the wire.
 *  The fake answers `term.open` the way term.py does, printing the prompt
 *  before its answer has arrived (the race the panel has to survive), echoes
 *  what is typed and answers `echo hi` with `hi`. What draws the shell is a
 *  recorder in place of xterm.js (term.ts `setViewFactory`), whose grid is the
 *  window's size, so that resizing the window is a resize of the shell.
 *
 *  Pressed, in order: the Terminal tab (a shell opens on the computer in front
 *  and its prompt is drawn), `echo hi` and Enter (term.write, and `hi` comes
 *  back), the window made wider (term.resize with the new grid), `+` (a
 *  second shell), its × (term.close for that one only), the other computer's
 *  chip (its shell opens on its own socket and not on the first), and the
 *  shell exiting on its own (the tab says it ended).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'term');

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
  '--outDir', '.test-build/term', '--rootDir', '.',
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

/** Every request any fake socket was sent: `{host, type, data}`. */
const wire = [];
const sockets = [];
let termSeq = 0;

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.host = new URL(url).hostname;
    this.readyState = FakeSocket.CONNECTING;
    this.lines = {};
    sockets.push(this);
    setTimeout(() => { this.readyState = FakeSocket.OPEN; this.onopen?.({}); }, 0);
  }
  push(m) { if (this.readyState === FakeSocket.OPEN) this.onmessage?.({ data: JSON.stringify(m) }); }
  event(event, data) { this.push({ type: 'event', event, data, chat_id: null, seq: 0, ts: Date.now() / 1000 }); }
  send(raw) {
    const { id, type, data } = JSON.parse(raw);
    wire.push({ host: this.host, type, data });
    const reply = (d) => setTimeout(() => this.push({ type: 'ok', id, data: d }), 0);
    const refuse = (code) => setTimeout(() => this.push({ type: 'error', id, data: { code, message: code } }), 0);
    switch (type) {
      case 'ping': return reply({});
      case 'hello': return reply({ host: { name: this.host === '10.0.0.1' ? 'studio' : 'mini' } });
      case 'term.open': {
        const termId = `t${++termSeq}`;
        this.lines[termId] = '';
        // term.py's reader can push the prompt before the answer is written.
        this.event('term.output', { term_id: termId, data: `${this.host} $ ` });
        return reply({ term_id: termId, pid: 100 + termSeq, cwd: '/Users/me', shell: '/bin/zsh',
                       cols: data.cols ?? 80, rows: data.rows ?? 24, created_at: 0, attached: 1 });
      }
      case 'term.write': {
        if (!(data.term_id in this.lines)) return refuse('no_term');
        let echo = '';
        for (const ch of data.data) {
          if (ch === '\r') {
            const line = this.lines[data.term_id];
            this.lines[data.term_id] = '';
            echo += '\r\n';
            const m = /^echo (.*)$/.exec(line);
            if (m) echo += `${m[1]}\r\n`;
            echo += `${this.host} $ `;
          } else { this.lines[data.term_id] += ch; echo += ch; }
        }
        setTimeout(() => this.event('term.output', { term_id: data.term_id, data: echo }), 0);
        return reply({ written: data.data.length });
      }
      case 'term.resize': return data.term_id in this.lines ? reply({ cols: data.cols, rows: data.rows }) : refuse('no_term');
      case 'term.close': {
        if (!(data.term_id in this.lines)) return refuse('no_term');
        delete this.lines[data.term_id];
        reply({ term_id: data.term_id, ended: true });
        return setTimeout(() => this.event('term.exit', { term_id: data.term_id, code: -1 }), 0);
      }
      default: return refuse('unknown_type');
    }
  }
  close() { this.readyState = FakeSocket.CLOSED; }
}
globalThis.WebSocket = FakeSocket;
w.WebSocket = FakeSocket;

localStorage.setItem('rac.hosts', JSON.stringify([
  { host: '10.0.0.1', port: 8790, token: 'tok-studio', name: 'studio' },
  { host: '10.0.0.2', port: 8790, token: 'tok-mini', name: 'mini' },
]));

// ── what draws a shell, faked: the grid is the window's size ────────────────

const views = [];
function grid() { return { cols: Math.floor(w.innerWidth / 8), rows: Math.floor(w.innerHeight / 16) }; }
function fakeView(el) {
  const v = {
    el, text: '', cols: 0, rows: 0, data: [], resized: [], disposed: false,
    write(d) { v.text += d; },
    onData(fn) { v.data.push(fn); },
    onResize(fn) { v.resized.push(fn); },
    fit() {
      const g = grid();
      if (g.cols === v.cols && g.rows === v.rows) return;
      v.cols = g.cols; v.rows = g.rows;
      for (const fn of v.resized) fn(g);
    },
    focus() {},
    dispose() { v.disposed = true; },
    type(d) { for (const fn of v.data) fn(d); },
  };
  views.push(v);
  return Promise.resolve(v);
}
function setWindow(width, height) {
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: height, configurable: true });
}
setWindow(960, 640);

// ── mount ───────────────────────────────────────────────────────────────────

const imp = (p) => import(pathToFileURL(join(out, p)).href);
const term = await imp('src/lib/term.js');
term.setViewFactory(fakeView);
const { useFleet } = await imp('src/lib/fleet.js');
const { App } = await imp('src/App.js');
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;

const doc = w.document;
const tick = (ms = 20) => act(() => new Promise((r) => setTimeout(r, ms)));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }
async function click(el) { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await settle(); }
const sent = (host, type, pred = () => true) => wire.filter((m) => m.host === host && m.type === type && pred(m.data));
const tabs = () => [...doc.querySelectorAll('[role="tab"]')];
const front = () => {
  const pane = doc.querySelector('[data-shell-pane][aria-hidden="false"]');
  return views.find((v) => v.el === pane && !v.disposed);
};
const STUDIO = '10.0.0.1';
const MINI = '10.0.0.2';

useFleet.getState().boot();
const root = createRoot(doc.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });
await settle(10);

group('two computers answering');
ok('both fake daemons were dialled and said hello',
  sent(STUDIO, 'hello').length === 1 && sent(MINI, 'hello').length === 1,
  JSON.stringify(wire.map((m) => `${m.host} ${m.type}`)));
ok('nothing opened a shell before the Terminal tab was pressed', !wire.some((m) => m.type.startsWith('term.')));

// ── 1 · clicking the Terminal tab opens a shell, and its prompt is drawn ────

group('1 · the Terminal tab opens a shell on the computer in front');
const machineTab = (label) => [...doc.querySelectorAll('[aria-label="Machine"] button')]
  .find((b) => (b.textContent ?? '').trim().startsWith(label));
ok('the Machine place is up, with its Terminal tab', !!machineTab('Terminal'));
await click(machineTab('Terminal'));
await settle(10);
const open1 = sent(STUDIO, 'term.open');
ok('term.open went to the computer in front (studio), once', open1.length === 1 && sent(MINI, 'term.open').length === 0,
  JSON.stringify(wire.filter((m) => m.type.startsWith('term.'))));
// Nothing has been drawn yet when the first one opens, so it opens at the
// default grid and is sized to the drawn one as soon as the daemon answers.
const fitted = sent(STUDIO, 'term.resize', (d) => d.term_id === 't1');
ok('…and is sized to the drawn grid once it is open', fitted.length === 1
  && fitted[0].data.cols === 120 && fitted[0].data.rows === 40,
  JSON.stringify([open1[0]?.data, ...fitted.map((m) => m.data)]));
ok('the page opens on the shell, not on the wall of chats',
  doc.querySelector('[role="radio"][aria-checked="true"]')?.textContent === 'Shell');
ok('one tab, in front, named after the shell', tabs().length === 1
  && tabs()[0].getAttribute('aria-selected') === 'true' && /zsh 1/.test(tabs()[0].textContent ?? ''),
  tabs().map((t) => t.textContent).join(' | '));
const v1 = front();
ok('the prompt the daemon printed (before its answer) is drawn in the terminal view',
  !!v1 && v1.text.includes(`${STUDIO} $ `), JSON.stringify(v1?.text));

// ── 2 · echo hi ─────────────────────────────────────────────────────────────

group('2 · typing echo hi and Enter');
await act(async () => { v1.type('echo hi'); v1.type('\r'); });
await settle();
const writes = sent(STUDIO, 'term.write', (d) => d.term_id === 't1').map((m) => m.data.data).join('');
ok('what was typed went out as term.write, Enter included', writes === 'echo hi\r', JSON.stringify(writes));
ok('…and hi came back into the terminal', v1.text.includes('echo hi\r\nhi\r\n'), JSON.stringify(v1.text));

// ── 3 · resizing the window ─────────────────────────────────────────────────

group('3 · resizing the browser window');
setWindow(1200, 800);
await act(async () => { w.dispatchEvent(new w.Event('resize')); });
await settle();
const rs = sent(STUDIO, 'term.resize', (d) => d.term_id === 't1').slice(1);
ok('term.resize went out with the new grid', rs.length === 1 && rs[0].data.cols === 150 && rs[0].data.rows === 50,
  JSON.stringify(rs.map((m) => m.data)));
await act(async () => { w.dispatchEvent(new w.Event('resize')); });
await settle();
ok('…and a resize that changes nothing sends nothing', sent(STUDIO, 'term.resize').length === 2);

// ── 4 · another shell, closed; another computer ─────────────────────────────

group('4 · + opens another, × closes it, another computer is another computer');
const plus = doc.querySelector('button[aria-label="Open another shell"]');
await click(plus);
ok('+ opened a second shell on studio, at the size the first one is drawn at',
  sent(STUDIO, 'term.open').length === 2 && sent(STUDIO, 'term.open')[1].data.cols === 150 && tabs().length === 2
  && tabs()[1].getAttribute('aria-selected') === 'true', tabs().map((t) => t.textContent).join(' | '));
const v2 = front();
ok('…drawn in a view of its own, with its own prompt', !!v2 && v2 !== v1 && v2.text.startsWith(`${STUDIO} $ `));
await click(doc.querySelector('button[aria-label="Close zsh 2"]'));
const closes = sent(STUDIO, 'term.close');
ok('× sent term.close for that shell only', closes.length === 1 && closes[0].data.term_id === 't2',
  JSON.stringify(closes.map((m) => m.data)));
ok('…its tab is gone and the first is in front again', tabs().length === 1
  && tabs()[0].getAttribute('aria-selected') === 'true' && front() === v1);

// Which computer is chosen by the picker beside the Machine tabs, which is
// the fleet's focus (7 Nov 2026); the shell page has no second row of names.
ok('the shell page has no second computer picker of its own',
  ![...doc.querySelectorAll('button')].some((b) => b.getAttribute('title') === 'Open shells on this computer instead'));
const studioOpens = sent(STUDIO, 'term.open').length;
const studioWrites = sent(STUDIO, 'term.write').length;
const pickComputer = async (name) => {
  await act(async () => {
    const f = useFleet.getState();
    f.setFocus(f.order.find((x) => (f.hosts[x]?.info?.name || f.hosts[x]?.cfg.name) === name));
  });
  await settle();
};
await pickComputer('mini');
await settle(10);
const miniOpen = sent(MINI, 'term.open');
ok('switching to mini opened a shell on mini’s socket', miniOpen.length === 1, JSON.stringify(wire.filter((m) => m.type === 'term.open')));
ok('…and not another one on studio', sent(STUDIO, 'term.open').length === studioOpens);
const v3 = front();
ok('…and what is drawn is mini’s prompt', !!v3 && v3.text.includes(`${MINI} $ `) && !v3.text.includes(STUDIO),
  JSON.stringify(v3?.text));
await act(async () => { v3.type('echo hi\r'); });
await settle();
ok('typing there writes to mini’s shell, on mini', sent(MINI, 'term.write').length === 1
  && sent(STUDIO, 'term.write').length === studioWrites && v3.text.includes('hi\r\n'));
ok('…and studio’s shell is still there, one tab, behind', useFleet.getState().focus !== null
  && term.useShells.getState().shells.filter((s) => s.hostKey.startsWith(STUDIO)).length === 1);

await pickComputer('studio');
ok('back on studio: its shell is in front again, nothing new opened',
  front() === v1 && sent(STUDIO, 'term.open').length === studioOpens);

// ── the shell ending on its own ─────────────────────────────────────────────

group('a shell that exits');
const studioSock = sockets.find((s) => s.host === STUDIO);
await act(async () => { studioSock.event('term.exit', { term_id: 't1', code: 0 }); });
await settle();
ok('the tab says it ended, and the view says so too', /ended/.test(tabs()[0]?.textContent ?? '')
  && /shell ended with 0/.test(v1.text), tabs()[0]?.textContent);
const before = sent(STUDIO, 'term.write').length;
await act(async () => { v1.type('ls\r'); });
await settle();
ok('…and typing into an ended shell sends nothing', sent(STUDIO, 'term.write').length === before);
const closesBefore = sent(STUDIO, 'term.close').length;
await click(doc.querySelector('button[aria-label="Close zsh 1"]'));
ok('closing an ended shell does not ask the daemon to close it again',
  sent(STUDIO, 'term.close').length === closesBefore && tabs().length === 0);
ok('…and the empty page offers to open one', [...doc.querySelectorAll('button')]
  .some((b) => (b.textContent ?? '').includes('Open a shell')));

// ── the walls are still there ───────────────────────────────────────────────

group('the walls are one press away');
const chats = [...doc.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Chats');
await click(chats);
ok('Chats shows the wall of chat tiles', /The wall is empty|No chat has been started/.test(doc.body.textContent ?? ''),
  (doc.body.textContent ?? '').slice(0, 300));

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
