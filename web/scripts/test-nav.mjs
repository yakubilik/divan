#!/usr/bin/env node
/** Back, Forward, reload and the address, for every way between pages.
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-drive.mjs` mounts it, and moved
 *  through by the same presses a person makes. What is asserted is the
 *  browser's own record of it:
 *
 *   · **the walk.** Dashboard → Chats → chat A → New chat → chat B → Settings
 *     → Machines (the count) → Terminal → Dashboard → a product → its board →
 *     a card → an Inbox item. Each step pushes exactly one entry; Back from the
 *     end lands on every earlier page in turn, drawn the way it was (the same
 *     chat, card, tab), and never past the first; Forward replays it.
 *   · **reload.** Every address the walk wrote, opened cold, draws the same
 *     page — and the place each entry carries reads back from its own address.
 *   · **every other way.** Each top-bar button, sidebar control, Machine tab and
 *     page, Terminal wall, settings section, product page, ticket and palette
 *     entry: the address it lands on, one entry pushed, Back undoing it.
 *   · **nothing for what is not a page.** The palette, the Inbox, the machines
 *     popover and the New-chat-with-options dialog push nothing.
 *   · **the address is readable.** No `?view=`, `?tab=`, `?project=` and no
 *     `host:port` anywhere; an old link is read and written back the new way.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'nav');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

// NAV_REUSE=1 runs against the last build, for working on this file alone.
if (!process.env.NAV_REUSE) {
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/nav', '--rootDir', '.',
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
// A popped-out window is not opened here; that it would be asked for is enough.
const windows = [];
w.open = (url) => { windows.push(url); return null; };
// Nothing here reaches a network: a poll that finds no socket is left to fail.
process.on('unhandledRejection', () => {});

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const nav = await load('src/lib/nav.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { useInbox } = await load('src/lib/inbox.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const { MACHINE_ROWS, MACHINE_ASIDE, MACHINE_TABS } = await load('src/lib/shell.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { wall: queueWall } = await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

/** The fixture's computer, its chats a minute old and the newest one first by
 *  a clear margin, so which chat the Chat place lands on is known (c1). */
const fakeHost = (over = {}) => {
  const host = fixtureHost();
  const at = Date.now() / 1000 - 60;
  return { ...host, ...over,
           // c1 is filed under Quire, so it is in that product's own list too.
           chats: host.chats.map((c, i) => ({ ...c, archived: 0, status: 'idle', updated_at: at - i * 5,
                                              ...(c.id === 'c1' ? { project_id: 'p-quire' } : {}) })) };
};
/** The queue's wall, each ticket under a title of its own. */
const tickets = () => queueWall().map((t) => ({ ...t, title: `${t.title} #${t.id}` }));
/** The board, with the Inbox's ticket (42) on a card of its own (k2). */
const studioSnap = () => {
  const snap = fixture.studio();
  return { ...snap, cards: snap.cards.map((c) => (c.id === 'k2' ? { ...c, ustabasi_id: 42 } : c)) };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

let made_n = 0;
const call = async (key, type, data) => {
  if (type === 'divan.snapshot') throw new Error('That computer did not answer');
  if (type === 'ustabasi.notifications') {
    return { available: true, last: 9, items: [{ id: 9, ticket: 42, ts: Date.now() / 1000 - 60,
      kind: 'done', headline: '', body: 'Live keys are in.', title: 'Stripe keys', status: 'done', project: 'Quire' }] };
  }
  if (type === 'ustabasi.list') return { available: true, tickets: tickets(), queue: { last_tick: Date.now() / 1000 } };
  if (type === 'ustabasi.report') return { id: data.id, title: '', status: '', summary: '', verdict: '', verdict_summary: '', files: [] };
  if (type === 'ustabasi.run') return { available: false, reason: 'no run', events: [], cursor: null };
  if (type === 'account.list') return { accounts: fakeHost().accounts };
  if (type === 'agent.list') {
    return { agents: [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true, scope: 'account' }] };
  }
  if (type === 'chat.create') {
    const made = fakeChat({ id: `told${++made_n}`, title: data.title ?? 'New chat', status: 'idle',
                            cwd: data.cwd ?? '/Users/x', account_id: data.account_id ?? '',
                            updated_at: Date.now() / 1000 });
    const slot = useFleet.getState().hosts[key];
    useFleet.setState({ hosts: { ...useFleet.getState().hosts, [key]: { ...slot, chats: [made, ...slot.chats] } } });
    return made;
  }
  return {};
};
seed(useFleet, { hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true, call });
seed(useDivanStore, { snaps: { studio: answered(studioSnap(), Date.now() / 1000) } });
setThemeChoice('dark');

let root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
await settle();

const header = () => doc.querySelector('header');
const where = () => w.location.pathname + w.location.search;
const click = async (el) => {
  if (!el) throw new Error('nothing to press');
  await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await settle();
};
const press = async (key) => {
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true })); });
  await settle();
};
const btn = (label, within = doc) => [...(within?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) ?? null;
const startsBtn = (label, within = doc) => [...(within?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
const link = (label, within = doc) => [...within.querySelectorAll('a')]
  .find((a) => (a.textContent ?? '').trim() === label) ?? null;
const pane = () => doc.querySelector('.dv-chatpane');
/** The list's own New chat button, whichever way the list is drawn. */
const newChatBtn = () => [...(pane()?.querySelectorAll('button') ?? [])]
  .find((b) => /^Newchat/.test((b.textContent ?? '').replace(/\s+/g, '')) || b.getAttribute('aria-label') === 'New chat') ?? null;
/** A chat's row in whichever list is down the left, by its title. */
const row = (title) => [...((pane()?.querySelector('.dv-chatlist') ?? pane())?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').includes(title) && !b.getAttribute('aria-label')) ?? null;
const machineTab = (label) => [...doc.querySelectorAll('[aria-label="Machine"] button')]
  .find((b) => (b.firstChild?.textContent ?? '').trim() === label) ?? null;
const subLink = (view) => doc.querySelector(`nav a[href="/machine/${view}"]`);
const wordBtn = () => header()?.querySelector('a.dv-word');
const go = {
  // The left end of the line: the word on the Dashboard, and "Dashboard" with
  // a back arrow on every page of the other two places.
  word: () => click(wordBtn() ?? header()?.querySelector('button.dv-back[aria-label="Back to Dashboard"]')),
  chats: () => click(btn('Chats', header())),
  settings: () => click(btn('Settings', header())),
  // The count opens the machines box; its foot, All machines, is the page.
  machines: async () => {
    await click(header()?.querySelector('button[data-sys="machines"]'));
    await click(doc.querySelector('[role="dialog"][aria-label="Machines"] button[data-all-machines]'));
  },
};

/** What is drawn, in the words that tell one page from another: the place,
 *  the Machine page, the chat that is open, the heads on the page, the board,
 *  the empty composer, the Terminal wall and the ticket open on it. */
const screen = () => {
  const cur = (header()?.querySelector('[aria-current="page"]')?.textContent ?? '').trim();
  const head = doc.querySelector('.dv-chathead:not([data-draft-head]) [title]')?.getAttribute('title') ?? null;
  return JSON.stringify({
    place: !cur || cur === 'divan' ? 'Dashboard' : cur.replace(/\s+/g, ' '),
    page: doc.querySelector('nav[aria-label^="Under"] [aria-current="page"] span')?.textContent?.trim()
      ?? doc.querySelector('[aria-label="Machine"] [aria-pressed="true"]')?.firstChild?.textContent?.trim() ?? null,
    section: doc.querySelector('[data-panel] [aria-current="page"], [data-machine-page] button[aria-current="page"]')
      ?.textContent?.trim().replace(/\d+$/, '') ?? null,
    wall: doc.querySelector('[aria-label="What the page shows"] [aria-pressed="true"], [aria-label="What the page shows"] [aria-checked="true"]')
      ?.textContent?.trim() ?? null,
    ticket: doc.querySelector('[aria-label="Back to the wall"]') ? doc.querySelector('[aria-label="Ticket title"], h2, h3')?.textContent?.trim().slice(0, 40) ?? 'open' : null,
    chat: head,
    selected: pane()?.querySelector('button.dv-tinted [title]')?.getAttribute('title')
      ?? (pane()?.querySelector('button.dv-tinted')?.textContent ?? '').trim().slice(0, 24) ?? null,
    empty: !!doc.querySelector('[data-first-word] textarea[name="composer"]'),
    h1: [...doc.querySelectorAll('h1')].map((h) => (h.textContent ?? '').trim()).filter((t) => !/^Good /.test(t)),
    greet: !!doc.querySelector('h1.dv-greet'),
    board: !!doc.querySelector('section.dv-col'),
  });
};
/** A dialog: the panel's `Modal`, which is the scrim over everything. */
const modal = () => [...doc.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.zIndex === '50') ?? null;
const escape = async () => {
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await settle();
};
/** A palette entry, run: ⌘K, then the row whose words start with these. */
const paletteRun = async (label, has = false) => {
  await press('k');
  const hit = [...doc.querySelectorAll('[data-i]')]
    .find((e) => (has ? (e.textContent ?? '').includes(label) : (e.textContent ?? '').trim().startsWith(label)));
  if (!hit) throw new Error(`no palette entry ${label}`);
  await click(hit.querySelector('button') ?? hit.firstElementChild ?? hit);
};
const back = async () => {
  await act(async () => {
    const landed = new Promise((r) => { const d = () => { w.removeEventListener('popstate', d); r(null); }; w.addEventListener('popstate', d); setTimeout(d, 300); });
    w.history.back();
    await landed;
  });
  await settle();
};
const forward = async () => {
  await act(async () => {
    const landed = new Promise((r) => { const d = () => { w.removeEventListener('popstate', d); r(null); }; w.addEventListener('popstate', d); setTimeout(d, 300); });
    w.history.forward();
    await landed;
  });
  await settle();
};
/** A reload of an address, as a fresh entry at the end of the history — so
 *  that one entry pushed after it is one more in `history.length`, which a
 *  push from the middle of the history (after a Back) would not be. */
const reload = async (path) => {
  await act(async () => { root.unmount(); });
  w.history.pushState(null, '', path);
  root = createRoot(w.document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  await settle();
};
/** Whether an address says only what a person reading it needs. */
const BAD = /[?&](view|tab|project|card)=|(\d{1,3}\.){3}\d{1,3}|:\d{2,5}|%3A\d/i;
const clean = (url) => !BAD.test(url);

// ── 1 · the walk ────────────────────────────────────────────────────────────

group('the walk: one entry a step, Back through every one, Forward again');
const walk = [
  { name: 'Dashboard', path: '/', act: null },
  { name: 'Chats (the line)', path: '/chats/c1', act: go.chats },
  { name: 'chat A (a row)', path: '/chats/c2', act: () => click(row('Safari login')) },
  { name: 'New chat (the sidebar)', path: '/chats/new', act: () => click(newChatBtn()) },
  { name: 'chat B (a row)', path: '/chats/c3', act: () => click(row('Invoice PDF')) },
  { name: 'Settings (the line)', path: '/machine/settings', act: go.settings },
  { name: 'Machines (the count)', path: '/machine/machines', act: go.machines },
  { name: 'Terminal (a tab)', path: '/machine/terminal', act: () => click(machineTab('Terminal')) },
  { name: 'Dashboard (the line\'s left end)', path: '/', act: go.word },
  { name: 'a product (its tile)', path: '/p/quire', act: () => click(doc.querySelector('a[data-tile="quire"]')) },
  // The board is Plane now, and holds no card of ours to press: a card is
  // reached from In progress now on the product page.
  { name: 'a card', path: '/p/quire/c/k1', act: () => click(doc.querySelector('[data-in-progress] [data-row="k1"]')) },
  { name: 'an Inbox item', path: '/p/quire/c/k2', act: async () => {
    await act(async () => { await useInbox.getState().poll(); });
    await click(header().querySelector('[data-inbox]'));
    const notice = [...doc.querySelectorAll('[role="dialog"][aria-label="Inbox"] button')]
      .find((b) => (b.textContent ?? '').includes('Stripe keys'));
    await click(notice);
  } },
];
const base = w.history.length;
const steps = [];
for (const [i, step] of walk.entries()) {
  const before = w.history.length;
  if (step.act) await step.act();
  steps.push({ ...step, url: where(), state: w.history.state, screen: screen(), length: w.history.length });
  ok(`${i} · ${step.name} → ${step.path}${i ? ', one entry' : ''}`,
    where() === step.path && (!i || w.history.length === before + 1),
    `${where()} · ${before} → ${w.history.length}`);
}
ok('the walk is one entry a step: no more, no fewer', w.history.length === base + walk.length - 1,
  `${base} → ${w.history.length} for ${walk.length - 1} steps`);
ok('the chat steps drew the chat they named, and New chat the empty composer',
  (JSON.parse(steps[2].screen).chat ?? '').startsWith('Safari login') && (JSON.parse(steps[4].screen).chat ?? '').startsWith('Invoice PDF')
  && JSON.parse(steps[3].screen).empty && !JSON.parse(steps[3].screen).chat,
  [steps[2].screen, steps[3].screen, steps[4].screen].join('\n    '));
ok('the card steps drew the card they named',
  JSON.parse(steps[10].screen).h1.join() !== JSON.parse(steps[11].screen).h1.join(),
  `${steps[10].screen}\n    ${steps[11].screen}`);

for (let i = walk.length - 2; i >= 0; i--) {
  await back();
  ok(`Back → ${steps[i].name} (${steps[i].path}), drawn as it was`,
    where() === steps[i].path && screen() === steps[i].screen,
    `${where()}\n    was ${steps[i].screen}\n    now ${screen()}`);
}
// The first entry is the first: one more Back has nowhere in the panel to go,
// and the panel did not put one there.
ok('Back from the first page leaves nothing of the walk behind it', w.history.length === base + walk.length - 1
  && where() === '/');
for (let i = 1; i < walk.length; i++) {
  await forward();
  ok(`Forward → ${steps[i].name} (${steps[i].path})`,
    where() === steps[i].path && screen() === steps[i].screen,
    `${where()}\n    was ${steps[i].screen}\n    now ${screen()}`);
}
ok('Forward pushed nothing either', w.history.length === base + walk.length - 1, `${w.history.length}`);

group('the walk, reloaded at every step');
for (const s of steps) {
  const p = s.state && typeof s.state === 'object' && 'view' in s.state ? nav.placeOfState(s.state) : null;
  ok(`${s.path}: the entry's place reads back from its own address`,
    !!p && nav.samePlace(nav.readPlace(nav.pathOf(p), nav.searchOf(p)), p) && nav.pathOf(p) + nav.searchOf(p) === s.url,
    JSON.stringify(p));
}
for (const s of steps) {
  await reload(s.url);
  ok(`${s.path}: a reload draws the same page at the same address`,
    where() === s.url && screen() === s.screen, `${where()}\n    was ${s.screen}\n    now ${screen()}`);
}
ok('no address the walk wrote has ?view=, ?tab=, ?project= or a host:port in it',
  steps.every((s) => clean(s.url)), steps.map((s) => s.url).join(' '));

// ── 2 · what is not a page ──────────────────────────────────────────────────

group('dialogs, popovers and the palette push nothing');
{
  await reload('/chats/c2');
  const still = async (name, open, close) => {
    const at = where(); const n = w.history.length;
    await open();
    const opened = where() === at && w.history.length === n;
    await close();
    ok(`${name}: opened and closed, no entry and the same address`,
      opened && where() === at && w.history.length === n, `${at} → ${where()} · ${n} → ${w.history.length}`);
  };
  await still('the palette (⌘K)', () => press('k'), () => press('k'));
  await still('the Inbox', async () => {
    await act(async () => { await useInbox.getState().poll(); });
    await click(header().querySelector('[data-inbox]'));
    if (!doc.querySelector('[role="dialog"][aria-label="Inbox"]')) throw new Error('no Inbox');
  }, () => click(header().querySelector('[data-inbox]')));
  await still('the machines box on the line', async () => {
    await click(header().querySelector('button[data-sys="machines"]'));
    if (!doc.querySelector('[role="dialog"][aria-label="Machines"]')) throw new Error('no machines box');
  }, () => click(header().querySelector('button[data-sys="machines"]')));
  await still('New chat with every option (the palette)', async () => {
    await paletteRun('New chat with every option');
    if (!modal()) throw new Error('no dialog');
  }, escape);
  await still('a section\'s + (New chat in…)', async () => {
    const plus = [...pane().querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('New chat in'));
    await click(plus);
    if (!modal()) throw new Error('no dialog');
  }, escape);
  await reload('/');
  await still('the Dashboard Composer\'s options (New chat with options)', async () => {
    await click(btn('More options'));
    if (!modal()) throw new Error('no dialog');
  }, escape);
  ok('…and none of them left a dialog open', !modal() && !doc.querySelector('[role="dialog"]'));
}

// ── 3 · every other way between pages ───────────────────────────────────────

group('every way between pages: where it lands, one entry, Back undoes it');
/** A move, from the page at `from`: it lands on `to`, pushes one entry, Back
 *  is `from` again drawn as it was, and a reload of `to` is `to`. */
const way = async (name, from, to, act_) => {
  await reload(from);
  const was = screen(); const at = where(); const n = w.history.length;
  try { await act_(); } catch (e) { ok(name, false, String(e?.message ?? e)); return; }
  const landed = where(); const drawn = screen(); const pushed = w.history.length - n;
  await back();
  const undone = where() === at && screen() === was;
  await reload(to);
  const cold = where() === to && screen() === drawn;
  ok(`${name}: ${at} → ${to}`, landed === to && pushed === 1 && undone && cold && clean(landed),
    JSON.stringify({ landed, pushed, undone, back: where(), cold, drawn, now: screen() }));
};

// The line.
await way('Dashboard (the line\'s left end, off the Dashboard)', '/machine/accounts', '/', go.word);
await way('Dashboard (the line\'s left end, from the Chat place)', '/chats/c2', '/', go.word);
{
  await reload('/');
  const n = w.history.length;
  await click(wordBtn());
  ok('the word divan, on the Dashboard, is where you are: no entry', where() === '/' && w.history.length === n);
}
await way('Chats', '/p/quire', '/chats/c1', go.chats);
await way('Settings', '/chats/c1', '/machine/settings', go.settings);
await way('the machines count › All machines', '/', '/machine/machines', go.machines);
await way('the Dashboard\'s See all (waiting on you)', '/', '/waiting', () => click(link('See all')));
await way('Back from waiting on you', '/waiting', '/', () => click(header().querySelector('button.dv-back')));
await way('an Inbox item', '/chats/c1', '/p/quire/c/k2', async () => {
  await act(async () => { await useInbox.getState().poll(); });
  await click(header().querySelector('[data-inbox]'));
  await click([...doc.querySelectorAll('[role="dialog"][aria-label="Inbox"] button')]
    .find((b) => (b.textContent ?? '').includes('Stripe keys')));
});

// The sidebar.
await way('a chat row', '/chats/c1', '/chats/c3', () => click(row('Invoice PDF')));
await way('New chat (the sidebar)', '/chats/c1', '/chats/new', () => click(newChatBtn()));
await way('New chat (⌘N, in the Chat place)', '/chats/c1', '/chats/new', () => press('n'));
await way('a section\'s + and the dialog\'s Start', '/chats/c1', '/chats/told1', async () => {
  await click([...pane().querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('New chat in')));
  await click([...modal().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Start chat'));
  await settle();
});
// The chat that made is not the newest any more for what follows.
await act(async () => { useFleet.setState({ hosts: { studio: fakeHost() } }); });

// The Machine place: four tabs, and every page under one.
for (const t of MACHINE_TABS) {
  const from = t.key === 'machines' ? '/machine/executors' : '/machine/machines';
  await way(`Machine tab ${t.label}`, from, `/machine/${t.pages[0]}`, () => click(machineTab(t.label)));
  for (const v of t.pages.slice(1)) {
    await way(`Machine › ${t.label} › ${v}`, `/machine/${t.pages[0]}`, `/machine/${v}`, () => click(subLink(v)));
  }
}
// The sections of one computer's settings, at the old address with its side
// menu: Settings › General is New chats itself since 7 Nov 2026, with no row
// leading into it, and the side menu is still how a kept link moves.
await way('This computer › Tools', '/machine/preferences', '/machine/preferences/tools',
  () => click(startsBtn('Tools', doc.querySelector('[data-machine-page]'))));
await way('This computer › Appearance → Accounts', '/machine/preferences/appearance', '/machine/preferences',
  () => click(startsBtn('Accounts', doc.querySelector('[data-machine-page]'))));
// The Terminal's walls, and a ticket on the queue's.
const wallBtn = (label) => [...doc.querySelectorAll('[aria-label="What the page shows"] button')]
  .find((b) => (b.textContent ?? '').trim() === label);
await way('Terminal › Chats wall', '/machine/terminal', '/machine/terminal/chats', () => click(wallBtn('Chats')));
await way('Terminal › Ustabasi wall', '/machine/terminal', '/machine/terminal/ustabasi', () => click(wallBtn('Ustabasi')));
await way('Terminal › Ustabasi › Shell', '/machine/terminal/ustabasi', '/machine/terminal', () => click(wallBtn('Shell')));
const firstTicket = tickets()[0];
await way('a ticket on the queue\'s wall', '/machine/terminal/ustabasi', `/machine/terminal/ustabasi/${firstTicket.id}`,
  () => click(doc.querySelector(`[title="${firstTicket.title}"]`)));
await way('the ticket\'s Back to the wall', `/machine/terminal/ustabasi/${firstTicket.id}`, '/machine/terminal/ustabasi',
  () => click(doc.querySelector('[aria-label="Back to the wall"]')));

// A product.
await way('a product tile', '/', '/p/quire', () => click(doc.querySelector('a[data-tile="quire"]')));
await way('the product\'s board', '/p/quire', '/p/quire/board', () => click(link('Open board')));
await way('a card in progress on the product page', '/p/quire', '/p/quire/c/k1',
  () => click(doc.querySelector('[data-in-progress] [data-row="k1"]')));
await way('a card\'s way back (cold: its board)', '/p/quire/c/k1', '/p/quire/board',
  () => click(header().querySelector('button.dv-back')));
await way('a product\'s chat', '/p/quire', '/p/quire/chat/c1', () => click(row('Webhook retry policy')));
await way('the product\'s New chat', '/p/quire/chat/c1', '/p/quire', () => click(newChatBtn()));
await way('the product\'s way back to the Dashboard', '/p/quire', '/',
  () => click(header().querySelector('button.dv-back')));

// The palette: the three places, Settings, and every Machine page by name.
await way('palette › Dashboard', '/machine/accounts', '/', () => paletteRun('Dashboard'));
await way('palette › Chat', '/', '/chats/c1', () => paletteRun('Chat'));
await way('palette › Machine', '/', '/machine/machines', () => paletteRun('Machine'));
await way('palette › Settings', '/', '/machine/settings', () => paletteRun('Settings'));
for (const r of [...MACHINE_ROWS, ...MACHINE_ASIDE]) {
  const from = r.view === 'terminal' ? '/machine/machines' : '/machine/terminal';
  await way(`palette › Machine › ${r.label}`, from, `/machine/${r.view}`, () => paletteRun(`Machine › ${r.label}`));
}
await way('palette › a chat', '/', '/chats/c3', () => paletteRun('Invoice PDF', true));
await way('⌘, (Settings)', '/', '/machine/settings', () => press(','));

// ── 4 · a page about one computer, of two ───────────────────────────────────

group('the computer a page is about, where there are two');
{
  const cinema = fakeHost({ cfg: { ...fixtureHost().cfg, host: '10.0.0.9', port: 8790, name: 'cinema' },
                            info: { ...fixtureHost().info, name: 'cinema' } });
  await act(async () => {
    useFleet.setState({ hosts: { studio: fakeHost(), '10.0.0.9:8790': cinema }, order: ['studio', '10.0.0.9:8790'], focus: 'studio' });
  });
  await reload('/machine/screen');
  ok('a page about one computer names it by name, with no host:port', where() === '/machine/on/studio/screen', where());
  const n = w.history.length;
  await act(async () => { useFleet.getState().setFocus('10.0.0.9:8790'); });
  await settle();
  ok('picking the other one is the same page: the entry is taken over, not added to',
    where() === '/machine/on/cinema/screen' && w.history.length === n, `${where()} · ${n} → ${w.history.length}`);
  await act(async () => { useFleet.getState().setFocus('studio'); });
  await settle();
  await reload('/machine/on/cinema/preferences/tools');
  ok('an address naming one opens on that one, at that section',
    useFleet.getState().focus === '10.0.0.9:8790' && where() === '/machine/on/cinema/preferences/tools'
    && JSON.parse(screen()).section === 'Tools', `${useFleet.getState().focus} · ${where()} · ${screen()}`);
  await reload('/chats/c1');
  ok('a page not about one computer does not name one', where() === '/chats/c1', where());
  // The chat list's computer is a filter of the list, not a page.
  const at = where(); const len = w.history.length;
  const card = [...pane().querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('studio') && (b.textContent ?? '').length < 80);
  await click(card);
  const pop = !!doc.querySelector('.dv-chatpane [role="menu"], .dv-chatpane [role="listbox"]')
    || [...pane().querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('cinema'));
  const other = [...pane().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('cinema'));
  if (other) await click(other);
  ok('the sidebar\'s machines popover, and a machine picked in it, push nothing',
    pop && where() === at && w.history.length === len, `${pop} · ${where()} · ${len} → ${w.history.length}`);
  await act(async () => {
    useFleet.setState({ hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio' });
  });
}

// ── 5 · the address, read ───────────────────────────────────────────────────

group('every place reads back from its own address; old links are rewritten');
{
  const places = [
    nav.HOME, { ...nav.HOME, tab: 'waiting' },
    { ...nav.HOME, view: 'chats' }, { ...nav.HOME, view: 'chats', sub: 'new' }, { ...nav.HOME, view: 'chats', chat: 'c1' },
    { ...nav.HOME, view: 'chats', chat: 'c1', host: '127.0.0.1:8765' },
    ...[...MACHINE_ROWS, ...MACHINE_ASIDE].map((r) => ({ ...nav.HOME, view: r.view })),
    { ...nav.HOME, view: 'terminal', sub: 'chats' }, { ...nav.HOME, view: 'terminal', sub: 'ustabasi' },
    { ...nav.HOME, view: 'terminal', sub: 'ustabasi', ticket: 42 },
    { ...nav.HOME, view: 'terminal', sub: 'ustabasi', ticket: 42, machine: 'cinema' },
    { ...nav.HOME, view: 'preferences', sub: 'tools', machine: 'Someone’s Mac' },
    { ...nav.HOME, view: 'screen', machine: 'studio' },
    { ...nav.HOME, view: 'projects', machine: 'studio.local' },
    { ...nav.HOME, project: 'quire' }, { ...nav.HOME, project: 'quire', tab: 'board' },
    { ...nav.HOME, project: 'quire', tab: 'board', card: 'k1' },
    { ...nav.HOME, project: 'quire', tab: 'chat', chat: 'c1' },
  ];
  const bad = places.filter((p) => {
    const c = nav.canonical(p);
    return !nav.samePlace(c, p) || !nav.samePlace(nav.readPlace(nav.pathOf(c), nav.searchOf(c)), c);
  });
  ok('canonical places read back as themselves', !bad.length, JSON.stringify(bad));
  ok('only a popped-out window carries a computer, and only in ?host=',
    places.every((p) => clean(nav.pathOf(p))));
  // The daemon serves a path whose last segment has no dot in it as the panel
  // (server.py, `Deep`); a dotted host name must not end an address.
  ok('no address ends on a segment with a dot in it',
    places.every((p) => !nav.pathOf(p).split('/').pop().includes('.')),
    places.map((p) => nav.pathOf(p)).filter((u) => u.split('/').pop().includes('.')).join(' '));
  // A card opened from the product's own page is the card's page all the same.
  ok('a card over any tab is one address, read back as the board\'s card',
    nav.samePlace(nav.readPlace(nav.pathOf({ ...nav.HOME, project: 'quire', card: 'k1' })),
      nav.canonical({ ...nav.HOME, project: 'quire', card: 'k1' })));
  for (const [old, now] of [
    ['/?project=quire&tab=board', '/p/quire/board'],
    ['/?project=quire&card=127.0.0.1%3A8765%3Ak1', '/p/quire/c/k1'],
    ['/?view=accounts', '/machine/accounts'],
    ['/?view=chats&chat=c3', '/chats/c3'],
  ]) {
    await reload(old);
    ok(`an old link ${old} is read and written back as ${now}`, where() === now, where());
  }
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
