#!/usr/bin/env node
/** New chat in the Chat place stays in the Chat place.
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-drive.mjs` mounts it, and New
 *  chat pressed from inside the Chat place — the sidebar's button and ⌘N. What
 *  is asserted is where the panel is afterwards: still the Chat place, the list
 *  still down the left, nothing selected, and the empty composer in the middle
 *  with the caret in it. Then a send from that composer, Back, and the
 *  Dashboard's own ⌘N, which still leads to the Dashboard's Composer.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'newchat');

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
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/newchat', '--rootDir', '.',
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
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function scrollIntoView() {};
// Nothing here reaches a network: a poll that finds no socket is left to fail.
process.on('unhandledRejection', () => {});

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

/** The fixture's computer, its chats a minute old and the newest one first by
 *  a clear margin, so which chat the place lands on is known. */
const fakeHost = () => {
  const host = fixtureHost();
  const at = Date.now() / 1000 - 60;
  return { ...host, chats: host.chats.map((c, i) => ({ ...c, archived: 0, updated_at: at - i * 5 })) };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

const asked = [];
let made_n = 0;
seed(useFleet, {
  hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    if (type === 'agent.list') {
      return { agents: [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true, scope: 'account' }] };
    }
    if (type === 'chat.create') {
      const made = fakeChat({ id: `told${++made_n}`, title: data.title ?? 'New chat', status: 'idle',
                              cwd: data.cwd ?? '/Users/x', account_id: data.account_id ?? '',
                              updated_at: Date.now() / 1000 });
      // The daemon broadcasts `chat.created`; with no socket the list is moved by hand.
      const slot = useFleet.getState().hosts[key];
      useFleet.setState({ hosts: { ...useFleet.getState().hosts,
                                   [key]: { ...slot, chats: [made, ...slot.chats] } } });
      return made;
    }
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
const place = () => {
  const cur = (doc.querySelector('header')?.querySelector('[aria-current="page"]')?.textContent ?? '').trim();
  if (!cur || cur === 'divan') return 'Dashboard';
  return cur.startsWith('Chats') ? 'Chat' : cur.startsWith('Machine') ? 'Machine' : cur;
};
const nav = (label) => [...(doc.querySelector('header')?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
const pane = () => doc.querySelector('.dv-chatpane');
/** The sidebar's own New chat button, with ⌘N on it. */
const newChatButton = () => [...(pane()?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').replace(/\s+/g, '') === 'Newchat⌘N') ?? null;
const sidebar = () => !!newChatButton();
const selectedRow = () => pane()?.querySelector('button.dv-tinted') ?? null;
const firstWord = () => doc.getElementById('first-word');
const chatOpen = () => !!pane()?.querySelector('.dv-chathead');
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); };
const press = async (key) => {
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true })); });
};
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};
const back = async () => {
  const was = w.location.pathname;
  w.history.back();
  await act(async () => {
    for (let n = 0; n < 50 && w.location.pathname === was; n++) await new Promise((r) => setTimeout(r, 10));
  });
  await settle();
};
/** Everything that says "in the Chat place with the empty composer, focused". */
const emptyHere = () => ({
  place: place(), path: w.location.pathname, sidebar: sidebar(), selected: !!selectedRow(),
  chat: chatOpen(), composer: !!firstWord(), focused: doc.activeElement === firstWord() && !!firstWord(),
});
const isEmptyHere = (s) => s.place === 'Chat' && s.path === '/chats' && s.sidebar && !s.selected
  && !s.chat && s.composer && s.focused;

// ── into the Chat place, a chat open ────────────────────────────────────────

group('the Chat place, a chat open');
await click(nav('Chats'));
await settle();
const opened = w.location.pathname;
ok('the Chat place opens on its newest chat, list beside it',
  place() === 'Chat' && /^\/chats\/.+/.test(opened) && chatOpen() && sidebar() && !!selectedRow(),
  `${place()} · ${opened} · chat ${chatOpen()} · sidebar ${sidebar()}`);
const historyAt = w.history.length;

// ── 1 · the sidebar's button ────────────────────────────────────────────────

group('New chat, the sidebar button');
await click(newChatButton());
await settle();
let s = emptyHere();
ok('stays in the Chat place: address /chats, sidebar there, nothing selected, empty composer focused',
  isEmptyHere(s), JSON.stringify(s));
ok('the Dashboard Composer is not what came up', !doc.querySelector('h1.dv-greet'));
ok('pressing it is a step Back can undo (one entry pushed)', w.history.length === historyAt + 1,
  `${historyAt} → ${w.history.length}`);

// ── 4 · Back ────────────────────────────────────────────────────────────────

group('Back after New chat');
await back();
ok('Back returns to the chat that was open, in the Chat place',
  place() === 'Chat' && w.location.pathname === opened && chatOpen() && sidebar() && !!selectedRow(),
  `${place()} · ${w.location.pathname} · chat ${chatOpen()}`);

// ── 2 · ⌘N ──────────────────────────────────────────────────────────────────

group('New chat, ⌘N');
await press('n');
await settle();
s = emptyHere();
ok('⌘N in the Chat place does the same as the button', isEmptyHere(s), JSON.stringify(s));

// ── 3 · a send from that composer ───────────────────────────────────────────

group('a send from the empty composer');
asked.length = 0;
await type(firstWord(), 'start something new');
await act(async () => {
  doc.querySelector('form[data-first-word]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
});
await settle();
const made = asked.findIndex((a) => a.type === 'chat.create');
const said = asked.findIndex((a) => a.type === 'chat.send');
const id = asked[said]?.data?.chat_id;
ok('chat.create then chat.send with the words',
  made >= 0 && said > made && asked[said].data.text === 'start something new',
  asked.map((a) => a.type).join(','));
ok('the new chat opens in the Chat place middle pane with the sidebar beside it',
  place() === 'Chat' && !!id && w.location.pathname === `/chats/${id}` && chatOpen() && sidebar()
    && !!selectedRow() && !firstWord(),
  `${place()} · ${w.location.pathname} · ${id} · chat ${chatOpen()} · sidebar ${sidebar()}`);
await back();
ok('Back from the new chat is the chat that was open before New chat',
  place() === 'Chat' && w.location.pathname === opened && chatOpen(),
  `${place()} · ${w.location.pathname}`);

// ── 5 · the Dashboard keeps its own ─────────────────────────────────────────

group('New chat from the Dashboard');
await click(nav('Dashboard'));
await settle();
ok('on the Dashboard', place() === 'Dashboard' && w.location.pathname === '/', `${place()} · ${w.location.pathname}`);
await press('n');
await settle();
const focused = doc.activeElement;
ok('⌘N on the Dashboard focuses the Dashboard Composer, and stays there',
  place() === 'Dashboard' && w.location.pathname === '/' && focused?.tagName === 'TEXTAREA'
    && !!focused.closest('.dv-composer') && !pane(),
  `${place()} · ${w.location.pathname} · ${focused?.tagName}`);

// ── leaving the place and coming back ───────────────────────────────────────

group('the Chat place, entered again');
await click(nav('Chats'));
await settle();
ok('entering the Chat place again opens on the newest chat, not the empty composer',
  place() === 'Chat' && chatOpen() && !firstWord(), `${place()} · ${w.location.pathname}`);

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nNew chat in the Chat place: all checks passed');
process.exit(0);
