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
 *
 *  The empty composer is a chat's own box (`ChatComposer`) with no chat under
 *  it: a file attached there is held in the browser, nothing is made on the
 *  computer until the send, and the send opens the chat, uploads to it and
 *  sends — once. A draft left in it is there when New chat is pressed again.
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
const { useLogs, logKey } = await load('src/lib/timeline.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

/** The fixture's computer, its chats a minute old and the newest one first by
 *  a clear margin, so which chat the place lands on is known. */
const HOME = '/Users/x/projects/home';
const fakeHost = () => {
  const host = fixtureHost();
  const at = Date.now() / 1000 - 60;
  return { ...host, chats: host.chats.map((c, i) => ({ ...c, archived: 0, updated_at: at - i * 5 })),
    // The computer's default folder for a new chat (#299), and DevTrace-main
    // first in its list, the way a sorted ~/projects has it.
    info: { ...host.info, default_cwd: HOME, default_cwd_chosen: true },
    projects: [{ path: '/Users/x/projects/DevTrace-main', name: 'DevTrace-main', is_git: true }, ...host.projects] };
};
// A folder this browser remembered before the computer decided: not read.
w.localStorage.setItem('rac.defaults', JSON.stringify({ studio: { provider: 'claude',
  cwd: '/Users/x/projects/DevTrace-main', byProvider: {} } }));

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
    if (type === 'chat.send') {
      // What the daemon broadcasts for a message it took: the chat's log is
      // moved by hand, as the list is below, because there is no socket.
      const k = logKey(key, data.chat_id);
      const was = useLogs.getState().logs[k] ?? { items: [], seq: 0, busy: false, pending: [], loading: false, error: null, truncated: false };
      useLogs.setState({ logs: { ...useLogs.getState().logs, [k]: was } });
      useLogs.getState().feed(key, { event: 'message.user', chat_id: data.chat_id, seq: was.seq + 1,
                                     ts: Date.now() / 1000, data: { text: data.text, attachments: data.attachments ?? [] } });
      return { accepted: true, queued: false };
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

/** `/upload`, the one thing the panel asks a computer over plain HTTP. An audio
 *  file comes back with what was said in it, the way the daemon transcribes. */
const uploads = [];
globalThis.fetch = w.fetch = async (url, init) => {
  const body = init?.body;
  const file = body?.get?.('file');
  uploads.push({ url: String(url), chat: body?.get?.('chat_id'), name: file?.name });
  const audio = /^audio\//.test(file?.type ?? '');
  return { ok: true, status: 200, json: async () => ({
    path: `/up/${file?.name}`, name: file?.name, size: file?.size ?? 0, kind: audio ? 'audio' : 'file',
    ...(audio ? { transcript: 'remind me to call the bank' } : {}),
  }) };
};

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
/** The empty composer: the chat's own box, under the "No conversation yet" line. */
const firstWord = () => doc.querySelector('[data-first-word] textarea[name="composer"]');
const firstBox = () => doc.querySelector('[data-first-word]');
const sendButton = () => firstBox()?.querySelector('button[aria-label="Send"]') ?? null;
const tray = () => [...(firstBox()?.querySelectorAll('button[title="Remove"]') ?? [])]
  .map((x) => x.parentElement?.textContent ?? '');
/** Files chosen in the box's own picker, the way the attach button's dialog hands them over. */
const attach = async (files) => {
  const input = firstBox().querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new w.Event('change', { bubbles: true })); });
  await settle();
};
const chatOpen = () => !!pane()?.querySelector('.dv-chathead');
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); };
const press = async (key) => {
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true })); });
};
const type = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
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
const isEmptyHere = (s) => s.place === 'Chat' && s.path === '/chats/new' && s.sidebar && !s.selected
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
ok('stays in the Chat place: address /chats/new, sidebar there, nothing selected, empty composer focused',
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
ok('the empty composer is the chat’s own box: attach, microphone slot, multi-line field, send, keyboard hints',
  !!firstBox()?.querySelector('.dv-composer button[aria-label="Attach a file"]')
    && firstWord()?.tagName === 'TEXTAREA' && !!sendButton() && /⇧⏎ newline/.test(firstBox()?.textContent ?? '')
    && /No conversation yet/.test(firstBox()?.textContent ?? '') && !doc.getElementById('first-word')
    && !doc.querySelector('[data-first-word] input:not([type="file"])'),
  firstBox()?.innerHTML.slice(0, 300));
await type(firstWord(), 'start something new');
await click(sendButton());
await settle();
const made = asked.findIndex((a) => a.type === 'chat.create');
const said = asked.findIndex((a) => a.type === 'chat.send');
const id = asked[said]?.data?.chat_id;
ok('chat.create then chat.send with the words',
  made >= 0 && said > made && asked[said].data.text === 'start something new',
  asked.map((a) => a.type).join(','));
ok('…and the chat opens in the computer’s default folder, not DevTrace-main nor this browser’s old one',
  asked[made]?.data?.cwd === HOME, asked[made]?.data?.cwd);
ok('the new chat opens in the Chat place middle pane with the sidebar beside it',
  place() === 'Chat' && !!id && w.location.pathname === `/chats/${id}` && chatOpen() && sidebar()
    && !!selectedRow() && !firstWord(),
  `${place()} · ${w.location.pathname} · ${id} · chat ${chatOpen()} · sidebar ${sidebar()}`);
await back();
ok('Back from the new chat is the chat that was open before New chat',
  place() === 'Chat' && w.location.pathname === opened && chatOpen(),
  `${place()} · ${w.location.pathname}`);

// ── 6 · a draft is not a chat ───────────────────────────────────────────────

group('typing and attaching in the empty composer, then leaving');
await press('n');
await settle();
asked.length = 0; uploads.length = 0;
await type(firstWord(), 'the logo, smaller');
await attach([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
ok('the file is held in the tray, and nothing went to the computer',
  tray().length === 1 && /notes\.txt/.test(tray()[0]) && !uploads.length
    && !asked.some((a) => a.type === 'chat.create' || a.type === 'chat.send'),
  `${JSON.stringify(tray())} · ${uploads.length} · ${asked.map((a) => a.type).join(',')}`);
await click(nav('Dashboard'));
await settle();
await click(nav('Chats'));
await settle();
await press('n');
await settle();
s = emptyHere();
ok('leaving and coming back made no chat, and New chat shows the draft — words and file — still there',
  isEmptyHere(s) && firstWord()?.value === 'the logo, smaller' && tray().length === 1
    && !uploads.length && !asked.some((a) => a.type === 'chat.create'),
  `${JSON.stringify(s)} · ${firstWord()?.value} · ${JSON.stringify(tray())} · ${asked.map((a) => a.type).join(',')}`);

// ── 7 · a file and words, sent ──────────────────────────────────────────────

group('a file and words sent from the empty composer');
await click(sendButton());
await settle();
let creates = asked.filter((a) => a.type === 'chat.create');
let sends = asked.filter((a) => a.type === 'chat.send');
let newId = sends[0]?.data?.chat_id;
ok('exactly one chat.create, one upload to that chat, then one chat.send with the words and the file',
  creates.length === 1 && uploads.length === 1 && /\/upload$/.test(uploads[0].url) && !!newId
    && uploads[0].chat === newId && uploads[0].name === 'notes.txt'
    && sends.length === 1 && sends[0].data.text === 'the logo, smaller'
    && sends[0].data.attachments?.length === 1 && sends[0].data.attachments[0].path === '/up/notes.txt',
  `${creates.length} · ${JSON.stringify(uploads)} · ${JSON.stringify(sends.map((x) => x.data))}`);
const openText = () => pane()?.textContent ?? '';
ok('the new chat is open, and shows the message with its attachment',
  place() === 'Chat' && w.location.pathname === `/chats/${newId}` && chatOpen() && !firstWord()
    && openText().includes('the logo, smaller') && openText().includes('notes.txt'),
  `${w.location.pathname} · ${openText().slice(0, 200)}`);
await press('n');
await settle();
ok('…and the empty composer is empty again', isEmptyHere(emptyHere()) && firstWord()?.value === '' && !tray().length,
  `${firstWord()?.value} · ${JSON.stringify(tray())}`);

// ── 8 · a voice note and nothing typed ──────────────────────────────────────

group('a voice note sent on its own from the empty composer');
asked.length = 0; uploads.length = 0;
await attach([new File(['RIFF'], 'voice-note.webm', { type: 'audio/webm' })]);
ok('the voice note is held with the microphone chip, nothing uploaded',
  tray().length === 1 && /voice-note\.webm/.test(tray()[0]) && !uploads.length
    && !asked.some((a) => a.type === 'chat.create'), JSON.stringify(tray()));
await click(sendButton());
await settle();
creates = asked.filter((a) => a.type === 'chat.create');
sends = asked.filter((a) => a.type === 'chat.send');
newId = sends[0]?.data?.chat_id;
ok('one chat made, the note uploaded to it, and sent as an audio attachment captioned by its transcript',
  creates.length === 1 && uploads.length === 1 && uploads[0].chat === newId && !!newId
    && sends.length === 1 && sends[0].data.attachments?.[0]?.kind === 'audio'
    && sends[0].data.text === 'remind me to call the bank',
  `${creates.length} · ${JSON.stringify(uploads)} · ${JSON.stringify(sends.map((x) => x.data))}`);
ok('the voice note’s chat is open',
  place() === 'Chat' && w.location.pathname === `/chats/${newId}` && chatOpen()
    && openText().includes('remind me to call the bank'), w.location.pathname);

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

// ── the dialog with every option ────────────────────────────────────────────

group('New chat with every option: the folder');
const dialogStart = () => [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Start chat');
const moreOptions = () => [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'More options');
const lastCreate = () => asked.filter((a) => a.type === 'chat.create').at(-1)?.data;
await click(moreOptions());
await settle();
asked.length = 0;
await click(dialogStart());
await settle();
ok('the dialog opens on the computer’s default folder and starts the chat there', lastCreate()?.cwd === HOME,
  JSON.stringify(lastCreate()));
ok('…and starting it leaves no folder of its own behind in this browser',
  JSON.parse(w.localStorage.getItem('rac.defaults') ?? '{}').studio?.cwd !== HOME);
await click(nav('Dashboard'));
await settle();
await click(moreOptions());
await settle();
const quire = [...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('quire')
  && (b.textContent ?? '').includes('/'));
await click(quire);
await settle();
asked.length = 0;
await click(dialogStart());
await settle();
ok('a folder picked in the dialog wins', lastCreate()?.cwd === '/Users/x/projects/quire', JSON.stringify(lastCreate()));

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
