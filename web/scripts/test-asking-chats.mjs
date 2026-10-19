#!/usr/bin/env node
/** The question windows on the Chat place: the Dashboard's floating chats,
 *  mounted on the Chats screen from the same store.
 *
 *     cd web && node scripts/test-asking-chats.mjs
 *
 *  The whole panel in jsdom, as `test-asking.mjs` mounts it, opened on /chats
 *  with a ticket stopped on a question. The window is there with the project,
 *  the agent and the question in it; the chat list is the same list it is with
 *  no question; an answer is one `ustabasi.note` and the window stays; and a
 *  window put away or closed on one screen is put away or closed on the other.
 *  The layout — that the window clears the composer's send button — is
 *  `test-asking-chats-ui.mjs`, in a real browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking-chats');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/asking-chats', '--rootDir', '.',
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

// ── a document, opened on the Chat place ────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/chats', pretendToBeVisual: true,
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
try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch { /* fine */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = globalThis.ResizeObserver;
}
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = globalThis.IntersectionObserver;
}
process.on('unhandledRejection', () => {});

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { useAsking, NO_ASK } = await load('src/lib/asking.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);
const { host: fixtureHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act;

const NOW = Math.floor(Date.now() / 1000);
const QUESTION = '- Should the scan run against staging as well as the live site?\n'
  + '- Do you want the findings as ticket notes or as a separate report?';

/** The studio's board with ticket 42 (card k2) either asking or not. */
let studioCard = { agent_status: 'asking', agent_status_at: NOW - 600, agent_detail: QUESTION };
const snaps = () => {
  const [studio] = boards(NOW).busy;
  const s = structuredClone(studio.snap);
  s.cards = s.cards.map((c) => (c.id === 'k2' ? { ...c, title: 'Security scan', ...studioCard } : c));
  return { studio: answered(s, NOW) };
};

const asked = [];
const host = fixtureHost();
// Chats only: no chat of its own holding a request, so every window here is
// the ticket's.
host.chats = host.chats.map((c) => ({ ...c, status: c.status === 'awaiting_approval' ? 'idle' : c.status }));
useFleet.setState({
  hosts: { studio: host }, order: ['studio'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('not in this check');
    if (type === 'chat.get') return { events: [], more: false };
    if (type.startsWith('ustabasi.')) return { ok: true, message: 'noted' };
    return {};
  },
});
setThemeChoice('dark');

const doc = w.document;
let root = createRoot(doc.getElementById('root'));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };
const mount = async () => { await act(async () => { root.render(React.createElement(App)); }); await settle(); };
const unmount = async () => { await act(async () => { root.unmount(); }); root = createRoot(doc.getElementById('root')); };
const goTo = async (path) => {
  await act(async () => {
    w.history.pushState(null, '', path);
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  });
  await settle();
};
const win = () => doc.querySelector('[data-asking-window]');
const winId = () => win()?.getAttribute('data-asking-window') ?? null;
const tab = (id) => doc.querySelector(`[data-asking-tab="${id}"]`);
const lines = () => [...(win()?.querySelectorAll('[data-asking-line]') ?? [])].map((e) => e.getAttribute('data-asking-line'));
const list = () => doc.querySelector('.dv-chatlist');
const items = () => [...(list()?.querySelectorAll('[data-chat-title]') ?? [])].map((e) => e.getAttribute('data-chat-title'));
const notes = () => asked.filter((a) => a.type === 'ustabasi.note');
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await settle(); };
const btn = (label, within = doc) => [...within.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label
  || b.getAttribute('aria-label') === label) ?? null;
const typeAndSend = async (text) => {
  const input = win().querySelector('input[type="text"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
};

// The list as it is with nothing asking: what it must still be with a question.
studioCard = { agent_status: 'running', agent_status_at: NOW - 600, agent_detail: '' };
useDivanStore.setState({ snaps: snaps() });
await mount();
const quiet = items();
const quietText = list()?.textContent ?? '';
ok('(the Chat place is drawn with its list, and nothing is asking)',
  w.location.pathname.startsWith('/chats') && quiet.length > 0 && !win(), `${w.location.pathname} ${quiet}`);
await unmount();
useAsking.setState(NO_ASK);
w.localStorage.removeItem('rac.asking');

// ── 1 ───────────────────────────────────────────────────────────────────────

group('a ticket stopped on a question opens its floating window on the Chat place');
studioCard = { agent_status: 'asking', agent_status_at: NOW - 600, agent_detail: QUESTION };
useDivanStore.setState({ snaps: snaps() });
await mount();
{
  const said = win()?.textContent ?? '';
  const pts = [...(win()?.querySelectorAll('[data-asking-line="agent"] li') ?? [])].map((li) => li.textContent);
  ok('the window is open over the Chats screen, with no navigation',
    winId() === 'studio:k2' && w.location.pathname.startsWith('/chats') && !!list(), `${winId()} ${w.location.pathname}`);
  ok('…the project and the agent in its head',
    said.includes('Quire · Engineering') && said.includes('Coder') && said.includes('asking'), said.slice(0, 200));
  ok('…and the question whole', pts.length === 2 && pts[0].startsWith('Should the scan') && pts[1].startsWith('Do you want'),
    JSON.stringify(pts));
  ok('its tab is docked under it', !!tab('studio:k2'));
}

// ── 2 ───────────────────────────────────────────────────────────────────────

group('the question is not an entry in the Chats list');
{
  ok('the list holds the same chats, in the same order, as with nothing asking',
    JSON.stringify(items()) === JSON.stringify(quiet), `${items()} vs ${quiet}`);
  ok('…and says nothing of the ticket or its question',
    !/Security scan|Should the scan/.test(list().textContent) && list().textContent === quietText,
    list().textContent.slice(0, 200));
}

// ── 3 ───────────────────────────────────────────────────────────────────────

group('an answer from the Chats screen is a note on the ticket, and the window stays');
{
  asked.length = 0;
  await typeAndSend('Staging too, and notes on the ticket');
  const sent = notes();
  ok('one ustabasi.note, to the studio, on ticket 42, with the words typed',
    sent.length === 1 && sent[0].key === 'studio' && sent[0].data.id === 42
      && sent[0].data.text === 'Staging too, and notes on the ticket', JSON.stringify(sent));
  ok('the window is still open, the answer under the question',
    winId() === 'studio:k2' && lines().join(',') === 'agent,you', `${winId()} ${lines()}`);
  ok('nothing was sent to a chat', !asked.some((a) => a.type === 'chat.send'), JSON.stringify(asked.map((a) => a.type)));
}

// ── 4 ───────────────────────────────────────────────────────────────────────

group('one store: what is done on one screen is so on the other');
{
  await goTo('/');
  ok('on the Dashboard it is the same window, with the answer sent from the Chats screen in it',
    !!doc.querySelector('h1.dv-greet') && winId() === 'studio:k2' && lines().join(',') === 'agent,you',
    `${w.location.pathname} ${winId()} ${lines()}`);
  await click(btn('Put this away', win()));
  ok('(put away on the Dashboard)', !win() && !!tab('studio:k2'));
  await goTo('/chats');
  ok('…and on the Chats screen it is put away too: its tab, no window',
    !!list() && !win() && !!tab('studio:k2'), `${winId()} ${!!tab('studio:k2')}`);
  await click(tab('studio:k2').firstElementChild);
  ok('its tab there brings it back', winId() === 'studio:k2');
  await click(btn('Close', win()));
  ok('(closed on the Chats screen)', !win() && !tab('studio:k2'));
  await goTo('/');
  ok('…and on the Dashboard it is closed too: no window, no tab, the row under Needs you',
    !win() && !tab('studio:k2') && !!doc.querySelector('[data-asking-row="studio:k2"]'),
    `${winId()} ${!!tab('studio:k2')}`);
  await click(btn('Reply', doc.querySelector('[data-asking-row="studio:k2"]')));
  await goTo('/chats');
  ok('reopened from the Dashboard, it is open on the Chats screen', winId() === 'studio:k2', winId());
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
