#!/usr/bin/env node
/** The remote screen, mounted and driven: clicks, shortcuts and the clipboard.
 *
 *     cd web && npm test
 *
 *  The Screen view is mounted into jsdom the way `test-drive.mjs` mounts the
 *  panel, over a fleet of two computers — a Mac the browser dials and a
 *  Windows machine reached through that Mac's gateway (#194). What is asserted
 *  is what goes to the daemon, in order:
 *
 *   · a click on the live frame is `screen.input` with a normalised down and
 *     up, to the computer being watched — the peer included;
 *   · a paste is `screen.clipboard.set` with the pasted text, then the other
 *     computer's own paste shortcut; a copy is its copy shortcut, then
 *     `screen.clipboard.get`, and the text lands on this clipboard;
 *   · ⌘R and ⌃Space go as keys the daemon knows;
 *   · with control off or refused (Accessibility on a Mac), the view says why
 *     in words and a click is not sent into the void.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'screen');

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
  'src/screens/Screen.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/screen', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}
mkdirSync(join(out, 'src', 'assets'), { recursive: true });
for (const f of readdirSync(join(web, 'src', 'assets'))) {
  if (f.endsWith('.png')) writeFileSync(join(out, 'src', 'assets', `${f}.js`), `export default ${JSON.stringify(`/assets/${f}`)};\n`);
}

// ── a document ──────────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/', pretendToBeVisual: true,
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
// jsdom lays nothing out. The stage is given a size so the picture is drawn,
// and the picture a rectangle so a click has somewhere to land.
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 450; } });
const RECT = { left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225, x: 0, y: 0 };
w.HTMLElement.prototype.getBoundingClientRect = function rect() { return { ...RECT, toJSON() {} }; };
// The clipboard this browser writes to, recorded. A secure context, so the
// panel uses `navigator.clipboard.writeText` as it would on https or localhost.
const written = [];
Object.defineProperty(w, 'isSecureContext', { configurable: true, value: true });
Object.defineProperty(w.navigator, 'clipboard', {
  configurable: true, value: { writeText: async (t) => { written.push(t); } },
});
process.on('unhandledRejection', () => {});

// ── the view ────────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { Screen } = await load('src/screens/Screen.js');
const { useFleet } = await load('src/lib/fleet.js');
const { localIsMac } = await load('src/lib/screen.js');
const { host: fixtureHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

const ACCESSIBILITY = 'macOS has not granted this app Accessibility permission, so clicks would go nowhere — '
  + 'System Settings › Privacy & Security › Accessibility';
const CAPS = {
  studio: { view: true, control: true, enabled: true, os: 'Darwin', reason: null, displays: [] },
  peer: { view: true, control: true, enabled: true, os: 'Windows', reason: null, displays: [] },
};
const studio = fixtureHost();
const peer = { ...fixtureHost(),
  cfg: { host: '127.0.0.1', port: 8765, token: 'x'.repeat(32), name: 'Cinema PC', via: 'p1', addr: '192.168.1.20:8790' },
  info: { ...fixtureHost().info, name: 'Cinema PC', os: 'Windows' } };

const asked = [];
/** What screen.input answers: nothing, or the daemon's refusal. */
let inputRefusal = null;
seed(useFleet, {
  hosts: { studio, peer }, order: ['studio', 'peer'], focus: 'studio', ready: true,
  setFocus: (k) => useFleet.setState({ focus: k }),
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'screen.info') return { ...CAPS[key] };
    if (type === 'screen.input' && inputRefusal) throw Object.assign(new Error(inputRefusal.message), inputRefusal);
    if (type === 'screen.clipboard.get') return { text: `remote words on ${key}`, truncated: false };
    if (type === 'screen.clipboard.set') return { chars: data.text.length };
    return {};
  },
});

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(Screen)); });

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
const button = (label) => [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;
const pic = () => [...doc.querySelectorAll('div')].find((d) => d.style.cursor === 'crosshair' || d.style.cursor === 'default'
  && d.style.transform.startsWith('scale')) ?? null;
const mouse = async (el, type, x, y, extra = {}) => {
  await act(async () => {
    el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1, ...extra }));
  });
};
const mac = localIsMac();
const chord = (key, code) => ({ key, code, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac });
const key = async (init) => {
  let ev;
  await act(async () => { ev = new w.KeyboardEvent('keydown', init); w.dispatchEvent(ev); });
  return ev;
};
const paste = async (text) => {
  await act(async () => {
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: (t) => (t === 'text/plain' ? text : '') };
    doc.body.dispatchEvent(ev);
  });
};
const inputs = (k) => asked.filter((a) => a.type === 'screen.input' && (!k || a.key === k));
const text = () => doc.body.textContent ?? '';
const setPushed = async (k, screen) => {
  await act(async () => {
    const s = useFleet.getState();
    useFleet.setState({ hosts: { ...s.hosts, [k]: { ...s.hosts[k], info: { ...s.hosts[k].info, screen } } } });
  });
  await settle();
};

// ── 1 · a click on the Mac ──────────────────────────────────────────────────

group('a click on the live frame');
await settle();
ok('opening the view asks the computer what it allows', asked.some((a) => a.type === 'screen.info' && a.key === 'studio'));
await act(async () => { button('Connect').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
await settle();
ok('Connect draws the picture, with a pointer that means control', !!pic() && pic().style.cursor === 'crosshair',
  pic()?.getAttribute('style') ?? 'no picture');
asked.length = 0;
await mouse(pic(), 'mousedown', 100, 56.25);
await mouse(pic(), 'mouseup', 100, 56.25);
await settle();
const [down, up] = inputs('studio').map((a) => a.data.actions[0]);
ok('a press and release go to the Mac as screen.input down then up, at 0..1',
  down?.kind === 'down' && up?.kind === 'up' && down.button === 'left' && down.x === 0.25 && down.y === 0.25
    && up.x === 0.25 && down.clicks === 1,
  JSON.stringify(inputs()));
asked.length = 0;
await mouse(pic(), 'mousedown', 200, 112.5, { detail: 2 });
await mouse(pic(), 'mouseup', 200, 112.5, { detail: 2 });
await act(async () => { pic().dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, clientX: 200, clientY: 112.5 })); });
await settle();
ok('the second press of a double-click carries clicks=2 and no extra "double" is sent on top',
  inputs().length === 2 && inputs().every((a) => a.data.actions[0].clicks === 2),
  JSON.stringify(inputs().map((a) => a.data.actions)));

// ── 2 · shortcuts ───────────────────────────────────────────────────────────

group('shortcuts');
asked.length = 0;
await key({ key: 'r', code: 'KeyR', metaKey: true, bubbles: true, cancelable: true });
await key({ key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true });
await key({ key: '®', code: 'KeyR', altKey: true, metaKey: true, bubbles: true, cancelable: true });
await settle();
const keys = inputs().map((a) => a.data.actions[0]);
ok('⌘R goes as key r with cmd', keys[0]?.kind === 'key' && keys[0].key === 'r' && keys[0].mods.includes('cmd'), JSON.stringify(keys));
ok('⌃Space goes as key space, not a literal space', keys[1]?.key === 'space' && keys[1].mods.includes('ctrl'), JSON.stringify(keys));
ok('⌥⌘R goes as the key r, not as the ® the browser typed', keys[2]?.key === 'r' && keys[2].mods.includes('alt'), JSON.stringify(keys));

// ── 3 · paste and copy ──────────────────────────────────────────────────────

group('paste');
asked.length = 0;
const pv = await key(chord('v', 'KeyV'));
ok('the paste shortcut is left to the browser, so its paste event can carry the text', !pv.defaultPrevented);
// audit: language-data — a letter outside ASCII the pasted text must carry intact
await paste('hello from here · ş');
// audit: end-language-data
await settle();
await tick(500);
const order = asked.map((a) => a.type);
const setAt = order.indexOf('screen.clipboard.set');
const vAt = asked.findIndex((a) => a.type === 'screen.input' && a.data.actions[0].key === 'v');
ok('a paste sets the remote clipboard to the local text, then sends the Mac\'s ⌘V',
  // audit: language-data — a letter outside ASCII the pasted text must carry intact
  setAt >= 0 && asked[setAt].data.text === 'hello from here · ş' && asked[setAt].key === 'studio'
  // audit: end-language-data
    && vAt > setAt && JSON.stringify(asked[vAt].data.actions[0].mods) === '["cmd"]',
  JSON.stringify(asked));
ok('and only one paste reaches the Mac (the fallback stood down)',
  asked.filter((a) => a.type === 'screen.input' && a.data.actions[0].key === 'v').length === 1, JSON.stringify(order));

group('copy');
asked.length = 0;
written.length = 0;
const cv = await key(chord('c', 'KeyC'));
await tick(300);
await settle();
const cAt = asked.findIndex((a) => a.type === 'screen.input' && a.data.actions[0].key === 'c');
const getAt = asked.findIndex((a) => a.type === 'screen.clipboard.get');
ok('the copy shortcut is kept from this browser', cv.defaultPrevented);
ok('a copy sends the Mac\'s ⌘C, then reads its clipboard',
  cAt >= 0 && JSON.stringify(asked[cAt].data.actions[0].mods) === '["cmd"]' && getAt > cAt,
  JSON.stringify(asked));
ok('and the remote text is written to the local clipboard', written[0] === 'remote words on studio', JSON.stringify(written));
ok('the view says it was copied', /Copied 22 characters from studio/.test(text()), text().slice(-300));

// ── 4 · when control is unavailable ─────────────────────────────────────────

group('control off, and refused');
await setPushed('studio', { ...CAPS.studio, enabled: false });
asked.length = 0;
await mouse(pic(), 'mousedown', 100, 56.25);
await mouse(pic(), 'mouseup', 100, 56.25);
await settle();
ok('with control turned off elsewhere, the view follows host.status and says so in words',
  /Remote control is off on this computer/.test(doc.querySelector('[data-screen-blocker]')?.textContent ?? ''),
  doc.querySelector('[data-screen-blocker]')?.textContent ?? 'no blocker line');
ok('and the click is not sent', inputs().length === 0, JSON.stringify(inputs()));
asked.length = 0;
await paste('should not go');
await key(chord('c', 'KeyC'));
await tick(300);
ok('nor is a paste or a copy', !asked.some((a) => a.type.startsWith('screen.clipboard') || a.type === 'screen.input'),
  JSON.stringify(asked));

await setPushed('studio', { ...CAPS.studio, control: false, reason: ACCESSIBILITY });
ok('a Mac without Accessibility says exactly that, on the view',
  (doc.querySelector('[data-screen-blocker]')?.textContent ?? '').includes('Accessibility'),
  doc.querySelector('[data-screen-blocker]')?.textContent ?? 'no blocker line');

// The daemon says no after the view thought it could: the reason is shown and
// the view asks again what is allowed.
await setPushed('studio', { ...CAPS.studio });
inputRefusal = { code: 'control_unavailable', message: ACCESSIBILITY };
CAPS.studio = { ...CAPS.studio, control: false, reason: ACCESSIBILITY };
asked.length = 0;
await mouse(pic(), 'mousedown', 100, 56.25);
await settle();
ok('a click the daemon refuses shows its reason in words and the view asks again',
  text().includes('Accessibility') && asked.some((a) => a.type === 'screen.info'),
  JSON.stringify(asked.map((a) => a.type)));
inputRefusal = null;
CAPS.studio = { ...CAPS.studio, control: true, reason: null };

// ── 5 · the peer, through the gateway ───────────────────────────────────────

group('a peer reached through the gateway');
await act(async () => { useFleet.setState({ focus: 'peer' }); });
await settle();
ok('watching the peer asks the peer what it allows', asked.some((a) => a.type === 'screen.info' && a.key === 'peer'));
await act(async () => { button('Connect').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
await settle();
asked.length = 0;
await mouse(pic(), 'mousedown', 300, 168.75);
await mouse(pic(), 'mouseup', 300, 168.75);
await settle();
const peerActs = inputs('peer').map((a) => a.data.actions[0]);
ok('a click on the peer\'s frame goes to the peer as screen.input down then up',
  peerActs[0]?.kind === 'down' && peerActs[1]?.kind === 'up' && peerActs[0].x === 0.75 && peerActs[0].y === 0.75
    && inputs('studio').length === 0,
  JSON.stringify(asked));
asked.length = 0;
await key(chord('v', 'KeyV'));
await paste('to windows');
await settle();
const pset = asked.find((a) => a.type === 'screen.clipboard.set');
const pv2 = asked.find((a) => a.type === 'screen.input');
ok('a paste onto the Windows peer sets its clipboard and sends Ctrl+V',
  pset?.key === 'peer' && pset.data.text === 'to windows' && pv2?.key === 'peer'
    && JSON.stringify(pv2.data.actions[0].mods) === '["ctrl"]',
  JSON.stringify(asked));

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nRemote screen: all checks passed');
process.exit(0);
