#!/usr/bin/env node
/** The panel, mounted and pressed.
 *
 *     cd web && npm test
 *
 *  `test-shell.mjs` renders the shell and reads what came out. What a render
 *  cannot say is whether anything *happens*: an effect that was never run
 *  registers no key, a button whose handler is never wired still draws, and a
 *  check that reads the source of a keyboard handler passes either way. That was
 *  the hole in round one, and this is the answer to it — a real document, the
 *  whole panel mounted into it, and the three things a shell is for driven
 *  through the same events a person would produce:
 *
 *   · **the keyboard.** ⌘0 and the six keys the panel already had are dispatched
 *     at the window, and what is asserted is the page that came up — the
 *     Machine list's own selected row, by name.
 *   · **the bar.** A place is clicked and the place changes; a project chip is
 *     clicked and the address gains `?project=<key>` while the page under it
 *     comes back scoped to that product.
 *   · **the switch.** The chip at the end of the bar is clicked, the document's
 *     theme attribute moves, and the page under the bar is the same markup it
 *     was — which is the whole of what "without a reload" means.
 *
 *  The document is jsdom, which is the only dependency this check adds: it is
 *  what makes `react-dom/client` — the renderer the panel actually ships with —
 *  mount, run its effects and deliver an event. Nothing here reaches a network;
 *  the stores are seeded the way the other checks seed them, and the poll that
 *  goes out on mount finds no socket and is left to fail, which is itself one of
 *  the states the panel has to survive.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'drive');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/drive', '--rootDir', '.',
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

// ── a document ──────────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/panel',
  pretendToBeVisual: true,
});
const w = dom.window;

// Everything the panel and the renderer read off a browser is this window's.
// Copied wholesale rather than a name at a time, because what React reaches for
// is React's business and a missing constructor is an error three stacks deep.
for (const name of Object.getOwnPropertyNames(w)) {
  if (name in globalThis) continue;
  try { globalThis[name] = w[name]; } catch { /* a getter that refuses: not ours */ }
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

// The two things a browser has and jsdom does not, both of which a screen here
// asks for on mount. Neither is a stand-in for behaviour — nothing below waits
// on a resize or a frame — they are the shapes the API has, so that a screen
// that uses one is drawn rather than skipped.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = globalThis.ResizeObserver;
}
// …and the third: jsdom has no layout, so nothing can be scrolled into view. The
// palette asks for it on every keystroke, and a missing method would take the
// process down rather than fail a check.
if (!w.Element.prototype.scrollIntoView) {
  w.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = globalThis.IntersectionObserver;
}

// A screen that asks an unreachable computer something rejects, and a rejection
// nobody catches takes the whole process down on Node's default. They are
// collected instead and asserted at the end: "renders with an unreachable
// machine without throwing" is one of this ticket's constraints, so a screen
// that loses one is a failure here rather than a crash.
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e?.message ?? e)));

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered, silent } = await load('src/lib/divan.js');
const { useDock } = await load('src/lib/sessions.js');
const { themeScheme, setThemeChoice } = await load('src/lib/theme.js');
const { MACHINE_ROWS } = await load('src/lib/shell.js');
const { useThresholds, DEFAULT_THRESHOLDS } = await load('src/lib/machine.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);
const { wall: tickets } = await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
/** The fixture's computer, with its chats a minute old by this machine's clock.
 *  The fixture is set at one fixed moment and the chat list keeps only the last
 *  day, so read as it stands every chat on it would be in the archive. */
const fakeHost = () => {
  const host = fixtureHost();
  const at = Date.now() / 1000 - 60;
  return { ...host, chats: host.chats.map((c) => ({ ...c, updated_at: at })) };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
// React 18.3 carries `act` itself; older trees keep it in the test utilities.
const act = React.act ?? (await import('react-dom/test-utils')).act;

/** A store is seeded on both sides: `setState` for the live copy, and the
 *  initial state because that is what a first render is handed. */
const seed = (store, patch) => {
  Object.assign(store.getInitialState(), patch);
  store.setState(patch);
};

/** Everything the panel asked a computer for, and nothing answered by a socket:
 *  what a pressed answer actually sends is the one thing about a session that a
 *  render cannot say. */
const asked = [];
/** Every `ustabasi.run` this panel made, so a poll that asks for the same page
 *  twice — or never carries the cursor — is visible. */
const runAsks = [];
/** …and everything the panel asked the queue to *do*. */
const queueAsks = [];
let made_n = 0;
/** The pool this fake computer is set to, so that setting it actually moves. */
let pool = {
  settings: { enabled: false, threshold: 0.9, thresholds: {}, use_overage: 'account',
              overage_by_account: {}, reserve: 0.05, order: {}, max_hops: 3 },
  accounts: [{ account_id: 'a2', provider: 'claude', label: 'yakup@…', blocked: true,
               window: '5h', until: null, utilization: 1, on_overage: false, spending: false,
               step: null }],
};
/** Set while the computer is to refuse the one request a page in here makes of
 *  it: an older daemon that has never heard of it, or one that times out. */
let accountsFail = false;
seed(useFleet, {
  hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    // The board is the one thing not answered from here: the snapshots are
    // seeded below, and a socket that answered `{}` would replace a fixture with
    // an empty board. A poll that fails is one of the states the panel has to
    // survive anyway, and it is the state the groups above are read in.
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    // The one other request a page in here makes of a computer. Answered from
    // the same fixture the slot is seeded with, so what the panel does with the
    // answer is what is being read rather than what it was handed.
    if (type === 'account.list') {
      if (accountsFail) throw new Error('unknown type account.list');
      return { accounts: fakeHost().accounts };
    }
    // …and the one the command bar makes: a chat, answered the way the daemon
    // answers it, so that what the bar does with the answer is what is read.
    // The queue, and what the worker on a ticket is printing: the wall is a
    // screen in this panel now, and the run under a ticket is the thing this
    // group is about.
    if (type === 'pool.get' || type === 'pool.set') {
      pool = { ...pool, ...(type === 'pool.set' ? { settings: { ...pool.settings, ...data } } : {}) };
      return pool;
    }
    if (type === 'tool.install') return { provider: data.provider, version: '1.9.0' };
    if (type === 'daemon.status') {
      return {
        started_at: 1, uptime_s: 100, restarts: 2,
        pending: [{ chat_id: 'c2', busy: true, queued: 3 }],
        draining: null, last_restart: null,
        supervisor: { supervised: false, how: null, detail: null },
      };
    }
    if (type === 'ustabasi.list') {
      return { available: true, tickets: tickets(), queue: { last_tick: Date.now() / 1000 } };
    }
    // What the panel can now do to a ticket. The queue's own CLI owns what
    // each of them means; a fake only has to answer in the shape it answers —
    // a sentence — and record that it was asked.
    if (type.startsWith('ustabasi.') && type !== 'ustabasi.run') {
      queueAsks.push({ type, data });
      if (type === 'ustabasi.edit' && !(data.done_criteria ?? []).length) {
        throw new Error('a ticket with no done criteria cannot be verified');
      }
      return { ok: true, message: `#${data.id} ${type.split('.')[1]}d` };
    }
    if (type === 'ustabasi.run') {
      runAsks.push(data);
      return {
        available: true, reason: '', run: 'r-7',
        events: [
          { k: 'system', subtype: 'init' },
          { k: 'text', text: 'Reading the webhook handler first.' },
          { k: 'tool', id: 't1', name: 'Bash', input: { command: 'npm test -- retries' } },
          { k: 'result', id: 't1', text: '2 failing', error: true },
        ],
        cursor: 'c-1', reset: !data.cursor, live: true, caught_up: false,
        // What a ticket about a screen leaves behind: the finished state, as a
        // file on the computer that did the work.
        shots: [{ path: '/Users/x/.ustabasi/runs/7/shots/onboarding.png',
                  name: 'onboarding', at: Date.now() / 1000, size: 40_000 }],
      };
    }
    if (type === 'divan.card.create') {
      return { id: `card${++made_n}`, ...data, executor: null, agent_status: null };
    }
    if (type === 'agent.list') {
      return { agents: [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true, scope: 'account' }] };
    }
    if (type === 'chat.create') {
      // A new id every time, the way the daemon hands one out: two chats
      // started from the bar are two chats, and a fake that answered with one
      // id would have them overwrite each other in the dock.
      const made = fakeChat({ id: `told${++made_n}`, title: data.title ?? 'New chat', status: 'idle',
                              cwd: data.cwd ?? '/Users/x/projects/quire', model: data.model,
                              account_id: data.account_id ?? '' });
      // The daemon broadcasts `chat.created` beside the answer, which is what
      // puts the new chat in that computer's list. There is no socket here, so
      // the list is moved by hand — without it the panel would be reading a
      // computer that has never heard of the chat it just opened.
      const slot = useFleet.getState().hosts[key];
      useFleet.setState({ hosts: { ...useFleet.getState().hosts,
                                   [key]: { ...slot, chats: [made, ...slot.chats] } } });
      return made;
    }
    // Groups, answered the way the daemon answers them: the making of one with
    // the group, and all three with a new list broadcast beside the answer.
    // There is no socket, so the list is moved by hand — as it is for a chat.
    if (type.startsWith('group.') || (type === 'chat.update' && 'group_id' in data)) {
      const slot = useFleet.getState().hosts[key];
      const made = { id: `g-made${++made_n}`, name: data.name, sort: 99, created_at: 0 };
      const groups = type === 'group.create' ? [...slot.groups, made]
        : type === 'group.rename' ? slot.groups.map((g) => (g.id === data.group_id ? { ...g, name: data.name } : g))
        : type === 'group.delete' ? slot.groups.filter((g) => g.id !== data.group_id)
        : slot.groups;
      const chats = slot.chats.map((c) => (
        type === 'chat.update' && c.id === data.chat_id ? { ...c, group_id: data.group_id }
        : type === 'group.delete' && c.group_id === data.group_id ? { ...c, group_id: null }
        : c));
      useFleet.setState({ hosts: { ...useFleet.getState().hosts, [key]: { ...slot, groups, chats } } });
      return type === 'group.create' ? made : {};
    }
    // …and `chat.deleted` is broadcast beside this one's answer.
    if (type === 'chat.delete') {
      const slot = useFleet.getState().hosts[key];
      useFleet.setState({ hosts: { ...useFleet.getState().hosts,
        [key]: { ...slot, chats: slot.chats.filter((c) => c.id !== data.chat_id) } } });
    }
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');

let root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const text = () => doc.body.textContent ?? '';
/** The place the bar says you are in, and the Machine page its list says you
 *  are on: both are `aria-current="page"`, which is how the frames' "filled"
 *  nav item and side panel row say the same thing to a reader who cannot see
 *  the fill. */
const place = () => {
  const header = doc.querySelector('header');
  if (!header) return null;
  const cur = (header.querySelector('[aria-current="page"]')?.textContent ?? '').trim();
  if (!cur || cur === 'divan') return 'Dashboard';
  return cur.startsWith('Chats') ? 'Chat' : cur.startsWith('Machine') ? 'Machine' : cur;
};
/** On the Dashboard itself, unscoped: the page with the greeting on it. */
const home = () => !!doc.querySelector('h1.dv-greet');
/** A product's tile on the Dashboard. */
const tile = (key) => doc.querySelector(`a[data-tile="${key}"]`);
/** A place's button on the line, whatever light it carries after its name. */
const nav = (label) => [...(doc.querySelector('header')?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
// …read off the row's own name and not its whole line, which also carries the
// count of what is waiting under it.
const page = () => doc.querySelector('nav [aria-current="page"] span')?.textContent?.trim() ?? null;
/** The page under the bar, as markup: what a theme change must not touch. */
const body = () => doc.querySelector('header')?.nextElementSibling?.innerHTML ?? '';
/** Its head — the one 28 pt line on a Divan page. */
const head = () => doc.querySelector('h1[data-project-head]')?.textContent?.trim()
  ?? [...doc.querySelectorAll('span, div')]
    .find((e) => e.style.fontSize === '28px')?.textContent?.trim() ?? null;

const press = async (key) => {
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }));
  });
};
/** The button whose label is this word, anywhere on the page. */
const find = (label, within = doc) => [...within.querySelectorAll('button')]
  .find((b) => (b.textContent ?? '').trim() === label) ?? null;
/** An icon button, by the name it is read out as. */
const labelledBtn = (label) => [...doc.querySelectorAll('button')]
  .find((b) => b.getAttribute('aria-label') === label) ?? null;
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
};
/** Typing, as a controlled field sees it. React listens for `input` and reads
 *  the value off the element, so the value goes in through the prototype's own
 *  setter: assigning `el.value` on a React-managed input is the one thing it
 *  does not notice. */
const type = async (el, value) => {
  await act(async () => {
    // Whichever of the two it is: a textarea's `value` lives on its own
    // prototype, and the input's setter refuses an element that is not one.
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement : w.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};

/** jsdom has neither `DragEvent` nor `DataTransfer`, so the payload the board
 *  agrees on (`lib/dnd.ts`) is carried by this — the three methods and the type
 *  list a drop target is allowed to read during `dragover`, and nothing else. */
class Transfer {
  constructor() { this.held = new Map(); this.effectAllowed = 'none'; this.dropEffect = 'none'; }
  setData(type, value) { this.held.set(type, String(value)); }
  getData(type) { return this.held.get(type) ?? ''; }
  get types() { return [...this.held.keys()]; }
}
const drag = async (el, type, dataTransfer) => {
  await act(async () => {
    const ev = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
    el.dispatchEvent(ev);
  });
};

group('the panel comes up');
{
  ok('it mounted, with the line over it', !!doc.querySelector('header .dv-topline'));
  ok('…on the Dashboard, which is the place it opens on',
    place() === 'Dashboard' && home(), `${place()} · ${head()}`);
  ok('…with the products of the machine it was seeded with',
    text().includes('Quire') && text().includes('Hush'));
  ok('…and the theme on the document before anything was pressed',
    doc.documentElement.dataset.theme === 'dark' && themeScheme() === 'dark');
}

group('the keyboard');
{
  // Every one of these is a listener registered by an effect. If the effect
  // never ran — which is exactly what a source-reading check cannot tell — the
  // page does not move and every line below fails.
  for (const row of MACHINE_ROWS) {
    if (!row.shortcut) continue;
    await press(row.shortcut.replace('⌘', ''));
    ok(`⌘${row.shortcut.replace('⌘', '')} opens Machine › ${row.label}`,
      place() === 'Machine' && page() === row.label, `${place()} › ${page()}`);
  }
  await press('0');
  ok('⌘0 goes back to the Dashboard', place() === 'Dashboard' && home(),
    `${place()} · ${head()}`);
  await press('9');
  ok('…and a key nothing is bound to changes nothing', place() === 'Dashboard');
}

group('the bar');
{
  await click(nav('Chats'));
  ok('the Chat place is one press away, and it is the chat and its list',
    place() === 'Chat' && !!doc.querySelector('input[name="chat-search"]')
    && text().includes('Webhook retry policy'), `${place()}`);

  await click(nav('Machine'));
  ok('…and the Machine place opens on the first row of its list',
    place() === 'Machine' && page() === MACHINE_ROWS[0].label, `${place()} › ${page()}`);

  await click(find('Dashboard', doc.querySelector('header')));
  ok('…and the Dashboard comes back', place() === 'Dashboard' && home());
}

group('a project tile opens the project');
{
  ok('the tiles are the products, in the merge’s order',
    [...doc.querySelectorAll('a[data-tile]')].map((a) => a.dataset.tile).join(' ') === 'quire hush');
  const steps = w.history.length;
  await click(tile('quire'));
  ok('pressing one writes it into the address, as a path a person can read',
    w.location.pathname === '/p/quire' && w.location.search === '',
    w.location.pathname + w.location.search);
  ok('…and leaves an entry behind it, so that Back is a step and not the way out',
    w.history.length === steps + 1, `${steps} → ${w.history.length}`);
  ok('…and the page under the line comes back scoped to it',
    head() === 'Quire' && !body().includes('Hush'), `${head()}`);
  await click(find('Dashboard', doc.querySelector('header')));
  ok('the left end of the line leads back to every product',
    w.location.pathname === '/' && home() && body().includes('Hush'),
    w.location.pathname + w.location.search);
}

group('the back button steps through the panel instead of out of it');
{
  // The one that took three hours of somebody's afternoon: the panel held
  // every bit of where you were in memory, wrote one `replaceState` for the
  // product and nothing else, so the browser had a single entry in its history
  // and Back left the page — from three levels into a board.
  /** The browser's own Back. jsdom runs a traversal as a queued navigation and
   *  delivers `popstate` after it, so this waits for the event rather than for
   *  a number of ticks — a back that never arrived is a failed check below and
   *  not a hang. */
  const back = async () => {
    await act(async () => {
      const landed = new Promise((resolve) => {
        const done = () => { w.removeEventListener('popstate', done); resolve(null); };
        w.addEventListener('popstate', done);
        setTimeout(done, 500);
      });
      w.history.back();
      await landed;
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  await press('0');
  const from = w.history.length;

  await click(tile('quire'));
  await click(find('Board'));
  ok('two steps in, the address says both of them',
    w.location.pathname === '/p/quire/board', w.location.pathname);
  ok('…and each of them is its own entry in the browser’s history',
    w.history.length === from + 2, `${from} → ${w.history.length}`);

  await back();
  ok('Back undoes the last step and stays in the panel',
    head() === 'Quire' && w.location.pathname === '/p/quire'
    && place() === 'Dashboard', `${head()} · ${w.location.pathname}`);
  await back();
  ok('…and again puts the product back to every product',
    home() && w.location.pathname === '/',
    `${head()} · ${w.location.pathname}`);

  // The pages of the Machine place are steps too, and so is a chat.
  await press('4');
  await press('7');
  ok('the drawer’s pages are in the address, one word each',
    w.location.pathname === '/machine/accounts', w.location.pathname);
  await back();
  ok('…and Back walks them one at a time',
    w.location.pathname === '/machine/terminal' && page() === 'Terminals',
    `${page()} · ${w.location.pathname}`);

  await press('0');
  ok('…all the way home, where the address is the bare path again',
    w.location.pathname === '/' && w.location.search === '' && home(),
    w.location.pathname + w.location.search);
}

group('the switch, in a document');
{
  const chip = () => doc.querySelector('header button[title^="Switch to the"]');
  const before = body();
  const bar = doc.querySelector('header');
  ok('in the dark, the line offers the light theme', chip()?.title === 'Switch to the light theme');
  await click(chip());
  ok('pressing it moves the document’s theme, and nothing else says it',
    doc.documentElement.dataset.theme === 'light' && themeScheme() === 'light');
  ok('…the page under the bar is the same markup it was',
    body() === before, `${body().length} vs ${before.length}`);
  ok('…and it is a page with colours in it, so that means something',
    before.includes('class="dv-'));
  ok('…and the line now offers the other one', chip()?.title === 'Switch to the dark theme');
  await click(chip());
  ok('and back again', doc.documentElement.dataset.theme === 'dark' && body() === before);
  ok('nothing reloaded: the bar is the same element it was before the switch',
    doc.querySelector('header') === bar && bar.isConnected);
}

group('what needs a person opens itself as a conversation');
{
  // The board of `overview-fixture.js` rather than the one the groups above
  // used: a question with a choice in it, a ticket that was turned down, and a
  // card that is nobody's but yours — which is what a session is made of, and
  // what the other fixture deliberately does not carry.
  const now = Math.floor(Date.now() / 1000);
  const board = boards(now);
  /** A button the words are somewhere inside, rather than all of it: a tab
   *  carries the square of whoever is in it as well as the card's name. */
  // The last such button: the dock is drawn after the page it stands over, and
  // a product's page carries the same card names in its own rows.
  const inside = (label) => [...doc.querySelectorAll('button')].reverse()
    .find((b) => (b.textContent ?? '').includes(label)) ?? null;
  /** What the open windows say, and not what the page under them says — a
   *  project card carries the worst card's own line, which is this very
   *  question, so "the window is gone" has to be asked of the windows. */
  const windows = () => [...doc.querySelectorAll('section[data-panel]')]
    .map((e) => e.textContent ?? '').join(' · ');
  await act(async () => {
    seed(useDivanStore, { snaps: { studio: answered(board.busy[0].snap, now) } });
  });
  // The windows stand over a product's page; the Dashboard answers in its
  // Needs you cards instead.
  await click(tile('quire'));

  ok('a question that is waiting opens by itself, with nobody pressing anything',
    windows().includes('asks you') && windows().includes('Use the live ones now'),
    windows().slice(0, 300));
  ok('…in the words the worker used, over the product and the card it is about',
    windows().includes('Use the live ones now, or wait for the review?')
    && windows().includes('Quire · Stripe keys'));
  ok('…and the second thing waiting opens beside it rather than in a queue',
    windows().includes('App Review reply') && windows().includes('your call'));

  // The window's own answer: the product page carries the same question as a
  // Needs you card, which is drawn before the windows.
  const pill = [...doc.querySelectorAll('section[data-panel] button')]
    .find((b) => (b.textContent ?? '').trim() === 'Use the live ones now') ?? null;
  ok('the answers the worker proposed are pressable', !!pill);
  asked.length = 0;
  await click(pill);
  ok('pressing one sends it as a note on that ticket, to the machine that asked',
    asked.some((a) => a.key === 'studio' && a.type === 'ustabasi.note'
      && a.data.id === 42 && a.data.text === 'Use the live ones now'),
    JSON.stringify(asked.slice(0, 3)));
  ok('…and the window says what was sent, because the board will not for a minute',
    windows().includes('sent · Use the live ones now'));

  const away = [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Put this away');
  ok('a window can be put away', !!away);
  await click(away);
  ok('…and what is left of it is a tab, while the other window stays where it was',
    !windows().includes('Use the live ones now') && !!inside('Stripe keys')
    && windows().includes('App Review reply'), windows().slice(0, 300));
  await click(inside('Stripe keys'));
  ok('…which brings it back', windows().includes('Use the live ones now'));

  const named = () => [...doc.querySelectorAll('button')]
    .filter((b) => (b.textContent ?? '').includes('Stripe keys')).length;
  const had = named();
  const shut = [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
  await click(shut);
  ok('closing one takes it off the page, tab and all',
    !windows().includes('Use the live ones now') && named() === had - 1, windows().slice(0, 300));

  // The bar across the bottom of every desktop frame, and what it does with a
  // sentence. Found the way a person finds it — by what the field says it is —
  // rather than by a `name` attribute nothing on screen carries.
  const bar = () => doc.querySelector('#composer-in');
  const arrow = () => {
    const send = doc.querySelector('.dv-composer button[aria-label="Send"]');
    return send && !send.disabled ? send : null;
  };
  const palette = () => [...doc.querySelectorAll('input')]
    .some((i) => (i.getAttribute('aria-label') ?? '').startsWith('Search folders'));
  /** The chat's own window, by the words it was started with. */
  const chatWindow = () => [...doc.querySelectorAll('section[data-panel]')]
    .find((e) => (e.textContent ?? '').includes('ship the beta tonight')) ?? null;
  const labelled = (label, within) => [...within.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-label') === label) ?? null;

  ok('the Composer is at the foot of the product’s page, and it is the field it looks like', !!bar());
  ok('…whose send is not a button while there is nothing to send', arrow() === null);
  await type(bar(), 'ship the beta tonight');
  ok('…and is one the moment there is', !!arrow());
  asked.length = 0;
  await click(arrow());
  ok('pressing it opens a chat on the computer in focus, named after the words',
    asked.some((a) => a.key === 'studio' && a.type === 'chat.create'
      && a.data.title === 'ship the beta tonight'),
    JSON.stringify(asked.map((a) => a.type)));
  ok('…and says them in it, which is the first thing in that chat',
    asked.some((a) => a.type === 'chat.send' && a.data.chat_id === 'told1'
      && a.data.text === 'ship the beta tonight'),
    JSON.stringify(asked.filter((a) => a.type === 'chat.send').map((a) => a.data)));
  ok('…without leaving the page it was typed on',
    place() === 'Dashboard' && head() === 'Quire', `${place()} · ${head()}`);
  ok('…with the chat open on that page, in the corner the windows stand in',
    !!chatWindow(), windows().slice(0, 200));
  ok('…and the field empty again, because the sentence landed', bar().value === '');
  ok('…with the send back to the quiet fill of a bar with nothing in it',
    arrow() === null && !!bar() && bar().value === '');

  // What the chat is set to, and the way to change it: the same five settings
  // the chat screen puts in its head, in the room this window has.
  const chip = (label) => [...chatWindow().querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === label) ?? null;
  ok('the head says what the chat is set to: the sign-in, the model, the rest',
    ['this computer', 'Opus 5', 'high', 'default'].every((w) => !!chip(w)),
    [...chatWindow().querySelectorAll('button')].map((b) => b.textContent).join(' | '));
  await click(chip('Opus 5'));
  ok('…and pressing the model offers the models that computer has, by name and by id',
    [...doc.querySelectorAll('[role="option"]')].length === 2
    && doc.body.textContent.includes('claude-sonnet-5')
    && doc.body.textContent.includes('the quick one'));
  await click(chip('Opus 5'));
  ok('…and pressing it again puts the list away',
    [...doc.querySelectorAll('[role="option"]')].length === 0);
  await click(chip('this computer'));
  const options = () => [...doc.querySelectorAll('[role="option"]')];
  ok('…and the sign-ins come with how much of each plan is left',
    options().length === 2 && options().some((o) => (o.textContent ?? '').includes('yakup@'))
    && options().some((o) => o.getAttribute('aria-selected') === 'true')
    && options().some((o) => /\d+% used/.test(o.textContent ?? '')),
    options().map((o) => o.textContent).join(' | '));
  asked.length = 0;
  await click(options().find((o) => (o.textContent ?? '').includes('yakup@')));
  ok('…and choosing one moves the chat to it, on the computer that holds it',
    asked.some((a) => a.key === 'studio' && a.type === 'chat.update'
      && a.data.chat_id === 'told1' && a.data.account_id === 'a2'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.account_id])));
  ok('…and the list closes behind the choice', options().length === 0);

  // A window is furniture: it can be pushed out of the way and pulled bigger.
  const frame = () => chatWindow()?.parentElement ?? null;
  const box = () => ({
    right: frame().style.right, bottom: frame().style.bottom,
    width: chatWindow().style.width, height: chatWindow().style.height,
  });
  const was = box();
  const hold = async (el, from, to) => {
    await act(async () => {
      el.dispatchEvent(new w.MouseEvent('mousedown',
        { bubbles: true, button: 0, clientX: from[0], clientY: from[1] }));
      w.dispatchEvent(new w.MouseEvent('mousemove',
        { bubbles: true, clientX: to[0], clientY: to[1] }));
      w.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
    });
  };
  await hold(chatWindow().querySelector('header'), [500, 400], [460, 380]);
  ok('a window can be dragged out of the corner, by its head',
    box().right === '64px' && box().bottom === '98px', JSON.stringify(box()));
  const grip = () => [...chatWindow().querySelectorAll('[role="separator"]')]
    .find((e) => e.getAttribute('aria-label') === 'Resize this window') ?? null;
  ok('…and it has a corner to pull on', !!grip());
  await hold(grip(), [100, 100], [60, 80]);
  ok('…which makes it bigger, from the corner that is free to move',
    box().width === '390px' && box().height === '520px'
    && box().right === '64px' && box().bottom === '98px', JSON.stringify(box()));
  ok('…and none of that moved the question beside it',
    was.right === '24px' && was.width === '350px');
  // Dragged off the screen is dragged out of reach, so it is not allowed.
  await hold(chatWindow().querySelector('header'), [500, 400], [5000, 5000]);
  ok('…and it cannot be pushed off the screen',
    parseInt(box().right, 10) === 0 && parseInt(box().bottom, 10) === 0, JSON.stringify(box()));

  const windowFor = (words) => [...doc.querySelectorAll('section[data-panel]')]
    .find((e) => (e.textContent ?? '').includes(words)) ?? null;
  const boxOf = (words) => {
    const w = windowFor(words);
    const f = w?.parentElement;
    return f ? { right: f.style.right, bottom: f.style.bottom,
                 width: w.style.width, height: w.style.height } : null;
  };

  // The box in the window is the chat's own: a send disc you can see, a way to
  // attach something, and — while a turn is running — a way to stop it. It was
  // the design system's one-line field, with none of those, until this.
  const inWindow = (sel) => [...chatWindow().querySelectorAll(sel)];
  ok('the window has the chat’s own box, with a send you can press',
    inWindow('textarea[name="composer"]').length === 1
    && inWindow('button[title="Send"], button[title="Stop"]').length === 1
    && inWindow('button[title="Attach a file"]').length === 1,
    inWindow('button').map((b) => b.getAttribute('title')).join(' | '));
  queueAsks.length = 0;
  await type(inWindow('textarea[name="composer"]')[0], 'and one more thing');
  asked.length = 0;
  await click(inWindow('button[title="Send"]')[0]);
  ok('…and pressing it says it in that chat',
    asked.some((a) => a.type === 'chat.send' && a.data.text === 'and one more thing'),
    JSON.stringify(asked.map((a) => a.type)));

  // Opened out: the same window, in the middle of the screen, over a dim.
  const opener = () => [...chatWindow().querySelectorAll('button')]
    .find((b) => (b.getAttribute('title') ?? '').startsWith('Open it in the middle')) ?? null;
  ok('a window offers to be opened out', !!opener());
  const corner = boxOf('ship the beta tonight');
  await click(opener());
  const centred = () => [...doc.querySelectorAll('div')]
    .find((e) => e.style.position === 'fixed' && e.style.inset === '0px'
      && (e.textContent ?? '').includes('ship the beta tonight')) ?? null;
  ok('…and opening it stands it in the middle of the screen, over the page',
    !!centred() && chatWindow().style.width !== corner.width,
    `${corner.width} -> ${chatWindow().style.width}`);
  ok('…with the same chat in it, and its box',
    (centred().textContent ?? '').includes('ship the beta tonight')
    && centred().querySelectorAll('textarea[name="composer"]').length === 1);
  const back = () => [...chatWindow().querySelectorAll('button')]
    .find((b) => (b.getAttribute('title') ?? '').startsWith('Back to the corner')) ?? null;
  ok('…and it offers to go back rather than only to be closed', !!back());
  await click(back());
  ok('…which puts it back exactly where it was',
    !centred() && JSON.stringify(boxOf('ship the beta tonight')) === JSON.stringify(corner),
    `${JSON.stringify(corner)} -> ${JSON.stringify(boxOf('ship the beta tonight'))}`);

  // Two windows, and one of them moved. The other one is furniture too: it
  // stands where it stood, whatever happens to the one being dragged.
  await type(bar(), 'second chat');
  await click(arrow());
  ok('a second chat opens beside the first rather than on top of it',
    !!windowFor('second chat') && boxOf('second chat').right !== box().right,
    JSON.stringify([boxOf('ship the beta tonight'), boxOf('second chat')]));
  const still = boxOf('second chat');
  await hold(windowFor('ship the beta tonight').querySelector('header'), [600, 400], [520, 360]);
  ok('…and moving one leaves the other exactly where it was',
    JSON.stringify(boxOf('second chat')) === JSON.stringify(still),
    `${JSON.stringify(still)} -> ${JSON.stringify(boxOf('second chat'))}`);
  const mine = boxOf('ship the beta tonight');
  await click(labelled('Close', windowFor('second chat')));
  ok('…and closing the other does not move the one you placed',
    JSON.stringify(boxOf('ship the beta tonight')) === JSON.stringify(mine),
    `${JSON.stringify(mine)} -> ${JSON.stringify(boxOf('ship the beta tonight'))}`);

  // …and the same two windows with nothing placed by hand at all, which is how
  // a person actually meets them: open one, open another, drag one of them.
  await click(labelled('Close', windowFor('ship the beta tonight')));
  await type(bar(), 'first one');
  await click(arrow());
  await type(bar(), 'second one');
  await click(arrow());
  ok('two fresh windows stand side by side, neither of them placed by hand',
    !!windowFor('first one') && !!windowFor('second one')
    && boxOf('first one').right !== boxOf('second one').right,
    JSON.stringify([boxOf('first one'), boxOf('second one')]));
  const other = boxOf('first one');
  await hold(windowFor('second one').querySelector('header'), [700, 500], [600, 430]);
  ok('…and dragging one of them does not move the other',
    JSON.stringify(boxOf('first one')) === JSON.stringify(other),
    `${JSON.stringify(other)} -> ${JSON.stringify(boxOf('first one'))}`);
  await click(labelled('Close', windowFor('second one')));
  await click(labelled('Close', windowFor('first one')));
  await type(bar(), 'ship the beta tonight');
  await click(arrow());

  await click(labelled('Put this away', chatWindow()));
  ok('a chat can be put away, and what is left of it is a tab along the bottom',
    !chatWindow() && !!inside('ship the beta tonight'));
  await click(inside('ship the beta tonight'));
  ok('…which brings it back', !!chatWindow());
  await click(labelled('Close', chatWindow()));
  ok('closing it takes the window off the page and leaves the chat where chats are',
    !chatWindow() && !inside('ship the beta tonight')
    && !asked.some((a) => a.type === 'chat.delete'),
    windows().slice(0, 200));

  // …and the same bar, on a page about one product: the chat opens in that
  // product rather than in whatever folder this computer last used.

  /** The line over the command bar, if there is one: the bar stands in a fixed
   *  box in the middle of the bottom edge, and what is above it inside that box
   *  is the note. The bar itself carries the key on it, which is how the two
   *  are told apart when there is no note at all. */
  const overBar = () => {
    const box = [...doc.querySelectorAll('div')]
      .find((e) => e.style.position === 'fixed' && e.style.left === '50%') ?? null;
    const first = box?.firstElementChild;
    const words = (first?.textContent ?? '').trim();
    return !first || words.includes('⌘K') ? '' : words;
  };
  ok('on a product’s page the Composer says which product the chat will be about',
    (doc.querySelector('.dv-composer [data-locked]')?.textContent ?? '').includes('Quire'));
  await type(bar(), 'why is the retry policy like this');
  asked.length = 0;
  await click(arrow());
  ok('…and it opens there, on the machine that holds that product',
    asked.some((a) => a.key === 'studio' && a.type === 'chat.create'
      && a.data.cwd === '/w/quire'),
    JSON.stringify(asked.filter((a) => a.type === 'chat.create').map((a) => a.data?.cwd)));
  // …and the window it opened is put away again, so the board below is read
  // with nothing standing over it.
  const opened = [...doc.querySelectorAll('section[data-panel]')]
    .find((e) => (e.textContent ?? '').includes('why is the retry policy')) ?? null;
  if (opened) await click(labelled('Close', opened));
  await click(find('Dashboard', doc.querySelector('header')));
  ok('…and off that page the bar is not drawn: the open Composer is', overBar() === ''
    && !!doc.querySelector('#composer-in') && !doc.querySelector('.dv-composer [data-locked]'), `«${overBar()}»`);

  // The key written on the bar is still the key: the bar is a composer, and the
  // palette is what ⌘K opens.
  await press('k');
  ok('⌘K still opens the palette', palette());
  await press('k');
  ok('…which closes again', !palette());
}

group('the board, with the asking agent’s chat beside it');
{
  const now = Math.floor(Date.now() / 1000);
  const studio = boards(now).busy[0].snap;
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(studio, now) } }); });
  const chip = (label) => find(label, doc.querySelector('header'));
  await press('0');
  await click(tile('quire'));
  await click(find('Board'));

  /** A column of the board, by its name: the section that catches a drop. */
  const column = (name) => doc.querySelector(`section.dv-col[aria-label="${name}"]`);
  /** A ticket, by the words on it. Every one of them can be picked up, which is
   *  what tells a card apart from everything else on the page. */
  const ticket = (words) => [...doc.querySelectorAll('[draggable="true"]')]
    .find((e) => (e.textContent ?? '').includes(words)) ?? null;
  const windows = () => [...doc.querySelectorAll('section[data-panel]')].map((e) => e.textContent ?? '').join(' · ');

  ok('the Board tab of a product is its board, four columns of the machines’ own',
    ['Ice Box', 'Queued', 'In Progress', 'Done'].every((c) => !!column(c))
    && !!ticket('Webhook retry policy') && !!ticket('CSV export'),
    [...doc.querySelectorAll('section.dv-col')].map((b) => b.getAttribute('aria-label')).join(' | '));
  ok('…still on the Dashboard, and still the page the bar is over',
    place() === 'Dashboard' && head() === 'Quire', `${place()} · ${head()}`);

  // Every window put away, so that what opens next opened because it was
  // pressed rather than because the desktop opens two by itself.
  await act(async () => { useDock.setState({ minimised: ['studio:k2', 'studio:h1'], closed: {}, raised: [] }); });
  ok('with every question put away, nothing is open over the board', windows() === '',
    windows().slice(0, 200));

  await click(ticket('Stripe keys').querySelector('button'));
  ok('pressing the card of an agent that is asking opens its chat beside the board',
    windows().includes('asks you') && windows().includes('Use the live ones now')
    && windows().includes('Quire · Stripe keys'), windows().slice(0, 300));
  ok('…without leaving the page: the board is still under it',
    place() === 'Dashboard' && !!column('In Progress') && !!ticket('Webhook retry policy'));

  asked.length = 0;
  await click(find('Use the live ones now'));
  ok('answering it there is a note on that ticket, which is what re-opens the queue',
    asked.some((a) => a.key === 'studio' && a.type === 'ustabasi.note'
      && a.data.id === 42 && a.data.text === 'Use the live ones now'),
    JSON.stringify(asked.slice(0, 3)));
  // …and the card says it is unblocked when the board does, and not before:
  // what the window sent is kept on screen until the machine that holds the
  // board has been re-read.
  ok('…and until the board is re-read the card still says it is asking',
    !!ticket('Stripe keys') && (ticket('Stripe keys').textContent ?? '').includes('asking'));
  const back = {
    ...studio,
    cards: studio.cards.map((c) => (c.id === 'k2'
      ? { ...c, agent_status: 'running', agent_detail: 'Using the live keys.' } : c)),
  };
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(back, now) } }); });
  ok('…and when it is, the mark clears on the card and the window is gone',
    (ticket('Stripe keys').textContent ?? '').includes('running')
    && !windows().includes('Use the live ones now'),
    `${ticket('Stripe keys')?.textContent} · ${windows().slice(0, 120)}`);

  // A card carried from one column to another with a mouse.
  const dt = new Transfer();
  const moving = ticket('CSV export');
  await drag(moving, 'dragstart', dt);
  ok('picking a card up puts the board’s own payload on the drag, and nothing else’s',
    dt.types.includes('application/x-rac-card'), dt.types.join(', '));
  await drag(column('Queued'), 'dragover', dt);
  ok('…a column that would take it says so, and the one it came out of does not',
    column('Queued').dataset.dropping === 'true' && column('Queued').dataset.takes === 'true'
    && column('Ice Box').dataset.takes === undefined);
  asked.length = 0;
  await drag(column('Queued'), 'drop', dt);
  ok('dropping it asks the machine that holds the board to move it there',
    asked.some((a) => a.key === 'studio' && a.type === 'divan.card.move'
      && a.data.card_id === 'k3' && a.data.column === 'queued'),
    JSON.stringify(asked.slice(0, 3)));
  ok('…and the card is in the new column before that machine has answered',
    (column('Queued').textContent ?? '').includes('CSV export')
    && !(column('Ice Box').textContent ?? '').includes('CSV export'),
    `${column('Ice Box').textContent} → ${column('Queued').textContent}`);

  // The threshold on Machine › Quota thresholds, kept where work is actually
  // started: the studio has 64% of its window left, and dropping a card into In
  // Progress is what starts a worker on it. Its board is put back in hand first
  // — the poll the last drop set off found no socket, and a machine whose
  // answer is a memory is never refused on the strength of it.
  await act(async () => {
    seed(useDivanStore, { snaps: { studio: answered(back, now) } });
    useThresholds.setState({ thresholds: { warn: 0.8, stop: 0.7 } });
  });
  asked.length = 0;
  const held = new Transfer();
  await drag(ticket('CSV export'), 'dragstart', held);
  await drag(column('In Progress'), 'drop', held);
  ok('a card dropped where a worker would start is not started under the threshold you set',
    !asked.some((a) => a.type === 'divan.card.move')
    && !(column('In Progress').textContent ?? '').includes('CSV export')
    && (doc.body.textContent ?? '').includes('under the 70% you set'),
    `${JSON.stringify(asked.slice(0, 2))} · ${(doc.body.textContent ?? '').slice(-160)}`);

  await act(async () => { useThresholds.setState({ thresholds: DEFAULT_THRESHOLDS }); });
  asked.length = 0;
  const free = new Transfer();
  await drag(ticket('CSV export'), 'dragstart', free);
  await drag(column('In Progress'), 'drop', free);
  ok('…and started as soon as that number is back under what the machine has left',
    asked.some((a) => a.type === 'divan.card.move' && a.data.column === 'in_progress'),
    JSON.stringify(asked.slice(0, 2)));
}

group('a card can be corrected and handed to somebody');
{
  // The board could move a card and not fix one: a title with a typo in it, a
  // card written in one line that wants the sentences under it, an agent that
  // was the wrong guess. All three are writes this panel could not make.
  const ticket = (words) => [...doc.querySelectorAll('[draggable="true"]')]
    .find((e) => (e.textContent ?? '').includes(words)) ?? null;
  await click(ticket('CSV export').querySelector('button'));
  ok('a card that nobody is waiting on opens as its own page',
    head() === 'CSV export' || text().includes('CSV export'), `${head()}`);

  const writable = (label) => [...doc.querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === `Write ${label}`) ?? null;
  const field = (label) => [...doc.querySelectorAll('input, textarea')]
    .find((e) => e.getAttribute('aria-label') === label) ?? null;
  ok('its title is a field, not a heading nobody can fix', !!writable("the card's title"));
  await click(writable("the card's title"));
  ok('…which opens where the title was', !!field("the card's title"));
  await type(field("the card's title"), 'CSV export, with the header row');
  asked.length = 0;
  await act(async () => {
    field("the card's title").dispatchEvent(
      new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  ok('…and the return key writes it on the machine that holds the card',
    asked.some((a) => a.key === 'studio' && a.type === 'divan.card.update'
      && a.data.card_id === 'k3' && a.data.title === 'CSV export, with the header row'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.title])));
  ok('…and the page says the new title before that machine has answered',
    text().includes('CSV export, with the header row'));

  // …and who does it, which is a request of its own: a field writable from two
  // places is how a status update ends up dragging a card.
  const handRow = [...doc.querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === 'Hand this card to somebody else') ?? null;
  ok('the executor is a row you can press rather than a fact you are told', !!handRow);
  await click(handRow);
  const hands = () => [...doc.querySelectorAll('[role="option"]')];
  ok('…and it offers the ones a board knows, Nobody among them',
    hands().length === 4 && hands().some((o) => (o.textContent ?? '').includes('Nobody'))
    && hands().some((o) => (o.textContent ?? '').includes('Research')),
    hands().map((o) => o.textContent).join(' | '));
  asked.length = 0;
  await click(hands().find((o) => (o.textContent ?? '').includes('Research')));
  ok('…and picking one hands the card over',
    asked.some((a) => a.key === 'studio' && a.type === 'divan.card.executor'
      && a.data.card_id === 'k3' && a.data.executor === 'assistant'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.executor])));
  ok('…and the list closes behind the choice', hands().length === 0);

  // Back up to the product, the way the page offers: the card page is reached
  // from the board and goes back to it, and the group below opens on a
  // product's own head.
  const crumb = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Quire') ?? null;
  ok('a card page says where it came from, and goes back there', !!crumb);
  await click(crumb);
  ok('…which is the product, not the Dashboard',
    head() === 'Quire' && place() === 'Dashboard', `${head()} · ${place()}`);
}

group('New ticket: Title, the sentences, where it goes, Create (HANDOVER §4.5)');
{
  const field = (label) => {
    const l = [...doc.querySelectorAll('label')].find((e) => (e.textContent ?? '').trim() === label);
    return l ? doc.getElementById(l.htmlFor) : null;
  };
  const create = () => find('Create');
  const segment = (label) => [...(doc.querySelector('[aria-label="Put it in"]')?.querySelectorAll('button') ?? [])]
    .find((b) => (b.textContent ?? '').trim() === label) ?? null;
  const filed = () => asked.filter((a) => a.type === 'divan.card.create');
  /** Open the form from the product's head, write a card, pick where, Create. */
  const write = async (title, sentences, where) => {
    await click(find('+ New ticket'));
    await type(field('Title'), title);
    if (sentences) await type(field('Two or three sentences'), sentences);
    if (where) await click(segment(where));
    asked.length = 0;
    await click(create());
  };

  await click(find('Overview'));
  await click(find('+ New ticket'));
  ok('+ New ticket opens one form: the product, Title, the sentences, the segment and Create, nothing else to fill',
    !!field('Title') && !!field('Two or three sentences') && !!create()
    && segment('Ice Box')?.getAttribute('aria-pressed') === 'true'
    && w.location.pathname === '/p/quire/new'
    && doc.querySelectorAll('form[aria-label="New ticket"] input, form[aria-label="New ticket"] textarea, form[aria-label="New ticket"] select').length === 2,
    w.location.pathname);
  await click(labelledBtn('Close'));

  await write('Export client list as CSV', 'Studios keep asking to download their client list.');
  const ice = filed()[0]?.data;
  await write('Invite by CSV', '', 'Queued');
  const queued = filed()[0]?.data;
  await write('Fix the webhook retries', 'They retry forever.', 'Start now');
  const now = filed()[0]?.data;
  ok('Create files divan.card.create into Ice Box by default, Queued or In Progress when chosen, with only a title required',
    ice?.column === 'ice_box' && ice.project_id === 'p-quire' && ice.title === 'Export client list as CSV'
    && ice.summary === 'Studios keep asking to download their client list.'
    && queued?.column === 'queued' && queued.title === 'Invite by CSV' && queued.summary === ''
    && now?.column === 'in_progress' && !('executor' in now) && !('agent' in now)
    && w.location.pathname === '/p/quire/board',
    JSON.stringify([ice, queued, now]));

  // When the machine cannot be reached the form keeps what was typed and says why.
  const call = useFleet.getState().call;
  await act(async () => {
    seed(useFleet, { call: async () => { throw new Error('That computer did not answer'); } });
  });
  await write('Invite by CSV', '', null);
  ok('…and one that cannot be reached keeps what was typed and says why',
    field('Title')?.value === 'Invite by CSV' && text().includes('That computer did not answer'));
  await act(async () => { seed(useFleet, { call }); });
  await click(labelledBtn('Close'));
}

group('the sign-in that is expiring is counted before that page is opened');
{
  const header = doc.querySelector('header');
  /** A row of the drawer, by the name on it. */
  const row = (label) => [...doc.querySelectorAll('nav button')]
    .find((b) => (b.querySelector('span')?.textContent ?? '').trim() === label) ?? null;

  await click(find('Dashboard', header));
  // A computer that has answered nothing about its sign-ins, which is every
  // computer on a panel that has just been loaded.
  await act(async () => {
    seed(useFleet, { hosts: { studio: { ...fakeHost(), accounts: [], loading: {} } } });
  });
  asked.length = 0;
  await click(find('Machine', header));
  await act(async () => {});
  ok('entering the Machine place asks the computer which sign-ins it has',
    asked.some((a) => a.key === 'studio' && a.type === 'account.list'),
    JSON.stringify(asked.map((a) => a.type)));
  ok('…and the drawer counts the ones that want a person, on the page it opens on',
    page() === 'Machines' && (row('Accounts & sign-ins')?.textContent ?? '').includes('2')
    && (row('Accounts & sign-ins')?.innerHTML ?? '').includes('var(--dv-amber)'),
    `${page()} · ${row('Accounts & sign-ins')?.textContent}`);
  await press('6');
  ok('…and Admin says the same thing about them, on a page nobody asked twice',
    page() === 'Admin' && text().includes('2 want you')
    && asked.filter((a) => a.type === 'account.list').length === 1,
    `${page()} · ${asked.filter((a) => a.type === 'account.list').length} asks`);

  accountsFail = true;
  await click(find('Dashboard', header));
  await act(async () => {
    seed(useFleet, { hosts: { studio: { ...fakeHost(), accounts: [], loading: {} } } });
  });
  asked.length = 0;
  await click(find('Machine', header));
  for (let i = 0; i < 4; i++) await act(async () => {});
  ok('a computer that refuses the question is asked once and not again',
    asked.filter((a) => a.type === 'account.list').length === 1,
    `${asked.filter((a) => a.type === 'account.list').length} asks`);
  await press('6');
  for (let i = 0; i < 4; i++) await act(async () => {});
  ok('…and the place goes on being used, saying nothing about sign-ins rather than none of them',
    page() === 'Admin' && text().includes('not read yet') && !text().includes('0 connected')
    && asked.filter((a) => a.type === 'account.list').length === 1,
    `${page()} · ${asked.filter((a) => a.type === 'account.list').length} asks`);
  accountsFail = false;
}

group('a ticket shows what the worker is doing right now');
{
  await press('4');
  ok('the terminal place is one key away', page() === 'Terminals', `${page()}`);
  const toggle = [...doc.querySelectorAll('[role="radio"]')]
    .find((b) => (b.textContent ?? '').trim() === 'Ustabasi') ?? null;
  ok('…with the queue as one of the two things the wall shows', !!toggle);
  await click(toggle);
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('…and the queue’s tickets are on it',
    text().includes('Webhook retry policy') || text().includes('#1'),
    text().slice(0, 200));

  const tile = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').includes('#2')) ?? null;
  ok('a ticket can be opened from the wall', !!tile);
  runAsks.length = 0;
  await click(tile);
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('opening it asks that computer what the worker has printed',
    runAsks.length >= 1 && !runAsks[0].cursor, JSON.stringify(runAsks));
  ok('…and what it printed is on the page: the sentence and the tool call',
    text().includes('Reading the webhook handler first.')
    && text().includes('npm test -- retries') && text().includes('Bash'),
    text().slice(-400));
  ok('…with the run said to be still going, rather than a page that just stops',
    text().includes('working…'));
  ok('…and the noise the run wrote for its own log is not on screen',
    !text().includes('init'));
  // A ticket about a screen is finished when the screen is right, and nothing
  // on this page could say whether it was.
  const shot = [...doc.querySelectorAll('img')]
    .find((i) => (i.getAttribute('alt') ?? '') === 'onboarding') ?? null;
  ok('a picture the run left is on the page, asked of the computer that holds it',
    !!shot && shot.getAttribute('src').includes('/files?')
    && shot.getAttribute('src').includes('onboarding.png'),
    shot?.getAttribute('src'));
  ok('…under a line saying what it is', text().includes('what it looks like'));

  // Watching was all the panel could do: a worker going the wrong way could be
  // read at length and not stopped, and a ticket written by mistake sat on the
  // wall for ever. #2 is blocked, so what it offers is restart, edit, delete.
  const button = (label) => [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === label) ?? null;
  ok('a ticket that is not running offers to be put back, rewritten or deleted',
    !!button('Restart') && !!button('Edit') && !!button('Delete') && !button('Stop'),
    [...doc.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12).join(' | '));
  queueAsks.length = 0;
  await click(button('Restart'));
  ok('…and restarting it asks that computer’s queue, and says what it answered',
    queueAsks.some((a) => a.type === 'ustabasi.restart' && a.data.id === 2)
    && text().includes('#2 restartd'), JSON.stringify(queueAsks));

  await click(button('Edit'));
  const field = (label) => [...doc.querySelectorAll('input, textarea')]
    .find((e) => e.getAttribute('aria-label') === label) ?? null;
  ok('the card opens for rewriting, with what it says in it',
    !!field('Goal') && field('Goal').value.length > 0
    && field('Done criteria').value.includes('\n'),
    JSON.stringify(field('Done criteria')?.value));
  await type(field('Goal'), 'make the retries survive a restart');
  await type(field('Done criteria'), 'retries survive a restart\nnpm test passes');
  queueAsks.length = 0;
  await click(button('Save'));
  ok('…and saving sends the card as the queue takes it, one criterion a line',
    queueAsks.some((a) => a.type === 'ustabasi.edit'
      && a.data.goal === 'make the retries survive a restart'
      && JSON.stringify(a.data.done_criteria) === '["retries survive a restart","npm test passes"]'),
    JSON.stringify(queueAsks));
  ok('…and the editor closes behind it', !field('Goal'));

  // Deleting asks first, in the window, and takes the answer from the queue's
  // own words — no dialog the browser draws.
  await click(button('Delete'));
  ok('deleting asks before it does it, on the page rather than in a browser dialog',
    text().includes('Delete #2') && !!button('Keep it') && !!button('Delete it'));
  await click(button('Keep it'));
  ok('…and saying no leaves the ticket alone', !button('Delete it'));
  queueAsks.length = 0;
  await click(button('Delete'));
  await click(button('Delete it'));
  ok('…while saying yes deletes it and closes the window',
    queueAsks.some((a) => a.type === 'ustabasi.delete' && a.data.id === 2)
    && !text().includes('Delete #2'), JSON.stringify(queueAsks));

  // A running ticket is the one case where stopping is the thing on offer.
  const running = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').includes('#1')) ?? null;
  await click(running);
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('a ticket that is running offers to be stopped, and not to be rewritten',
    !!button('Stop') && !button('Edit') && !button('Restart'),
    [...doc.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12).join(' | '));
  queueAsks.length = 0;
  await click(button('Stop'));
  ok('…and stopping it goes to the queue that holds it',
    queueAsks.some((a) => a.type === 'ustabasi.cancel' && a.data.id === 1),
    JSON.stringify(queueAsks));
}

group('chats are filed into groups from the panel');
{
  // Three more chats than the fixture has: two the computer filed under a
  // product — one of them a product a group is already named after — and one
  // that last moved two days ago.
  const at = Date.now() / 1000;
  const host = fakeHost();
  await act(async () => {
    seed(useFleet, { hosts: { studio: { ...host, chats: [...host.chats,
      fakeChat({ id: 'c4', title: 'Hush pricing', project_id: 'p-hush', project: 'Hush', updated_at: at - 90 }),
      fakeChat({ id: 'c5', title: 'Quire audit', project_id: 'p-quire', project: 'Quire', updated_at: at - 90 }),
      fakeChat({ id: 'c6', title: 'Old thread', project_id: 'p-hush', project: 'Hush', updated_at: at - 2 * 86400 }),
    ] } } });
  });
  await click(nav('Chats'));
  const shown = (words) => [...doc.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(words));
  ok('a chat is under the product the computer filed it as, or the group of that name',
    !!find('Hush1') && doc.querySelector('button[aria-label="Group menu: Quire"]')
      ?.previousElementSibling?.lastElementChild?.textContent === '1',
    [...doc.querySelectorAll('button')].map((b) => b.textContent).join(' | ').slice(0, 400));
  ok('a chat that has not moved for a day is out of the list, in an archive that starts shut',
    !!find('Archive1') && !shown('Old thread'));
  await click(find('Archive1'));
  ok('…and is one press away', shown('Old thread'));

  // A heading is dragged above another, and the list is still in that order
  // after it has been taken off the screen and put back.
  const order = () => [...doc.querySelectorAll('[data-section]')].map((e) => e.dataset.section);
  const was = order();
  const held = new Transfer();
  await drag(find('Hush1'), 'dragstart', held);
  await drag(doc.querySelector('[data-section="g1"]'), 'dragover', held);
  await drag(doc.querySelector('[data-section="g1"]'), 'drop', held);
  const now = order();
  await click(nav('Machine'));
  await click(nav('Chats'));
  ok('a heading dragged above another stays there, and the archive stays last',
    was[0] === 'g1' && now[0] === 'project:Hush' && now[1] === 'g1'
      && now.at(-1) === '__archive' && order().join() === now.join(),
    `${was.join()} → ${now.join()} → ${order().join()}`);
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => {}); };
  const menuOf = (name) => doc.querySelector(`button[aria-label="Group menu: ${name}"]`);
  /** The count on a group's heading, which is the last thing in it. */
  const countOf = (name) => menuOf(name)?.previousElementSibling?.lastElementChild?.textContent ?? null;
  const name = async (value, confirm) => {
    await type(doc.querySelector('input[name="group-name"]'), value);
    await click(find(confirm));
    await settle();
  };

  asked.length = 0;
  await click(doc.querySelector('button[aria-label="New group"]'));
  await name('Billing', 'Create');
  ok('the list makes a group on that computer',
    asked.some((a) => a.key === 'studio' && a.type === 'group.create' && a.data.name === 'Billing'),
    JSON.stringify(asked.map((a) => [a.type, a.data])));
  ok('…and shows it while it is still empty', countOf('Billing') === '0', `${countOf('Billing')}`);

  await click(menuOf('Billing'));
  await click(find('Rename'));
  await name('Invoices', 'Save');
  const renamed = asked.find((a) => a.type === 'group.rename');
  ok('a group is renamed from its heading',
    renamed?.data.name === 'Invoices' && !!menuOf('Invoices') && !menuOf('Billing'),
    JSON.stringify(renamed?.data));

  // From a chat's own menu the group is made for that chat.
  await click([...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Invoice PDF')));
  asked.length = 0;
  await click(doc.querySelector('button[title="Chat menu"]'));
  await click(find('Move to group…'));
  await click(find('New group…'));
  await name('Later', 'Create');
  const made = asked.findIndex((a) => a.type === 'group.create' && a.data.name === 'Later');
  const moved = asked.findIndex((a) => a.type === 'chat.update' && a.data.chat_id === 'c3'
    && String(a.data.group_id).startsWith('g-made'));
  ok('a chat’s menu makes a group and moves the chat into it',
    made >= 0 && moved > made && countOf('Later') === '1',
    JSON.stringify(asked.map((a) => [a.type, a.data])));

  // …and so does dropping it on a heading. `Safari login` is picked up and
  // put down on the group, then on the list of what nobody has filed.
  const row = (words) => [...doc.querySelectorAll('button[draggable="true"]')]
    .find((b) => (b.textContent ?? '').includes(words));
  const carry = async (words, onto) => {
    const held = new Transfer();
    await drag(row(words), 'dragstart', held);
    await drag(onto, 'dragover', held);
    await drag(onto, 'drop', held);
    await settle();
  };
  asked.length = 0;
  await carry('Safari login', menuOf('Invoices'));
  const filed = asked.find((a) => a.type === 'chat.update')?.data;
  await carry('Safari login', row('Webhook retry policy'));
  const unfiled = asked.filter((a) => a.type === 'chat.update')[1]?.data;
  ok('a chat dragged onto a group is filed in it, and dragged back out is unfiled',
    filed?.chat_id === 'c2' && String(filed?.group_id).startsWith('g-made')
      && unfiled?.chat_id === 'c2' && unfiled?.group_id === null && countOf('Invoices') === '0',
    JSON.stringify(asked.map((a) => [a.type, a.data])));

  asked.length = 0;
  await click(menuOf('Later'));
  await click(find('Delete group'));
  await click(find('Delete'));
  await settle();
  ok('deleting a group takes the heading and leaves its chat in the list',
    asked.some((a) => a.type === 'group.delete') && !menuOf('Later')
      && [...doc.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('Invoice PDF')),
    JSON.stringify(asked.map((a) => [a.type, a.data])));

  // A heading's own + starts a chat in that folder, and the dialog opens on
  // the agent — Hermes, until somebody has chosen otherwise.
  asked.length = 0;
  await click(doc.querySelector('button[aria-label="New chat in Hush"]'));
  await settle();
  await click(find('Start chat'));
  await settle();
  const started = asked.find((a) => a.type === 'chat.create')?.data;
  ok('a heading’s + opens a chat in that folder, already on Hermes',
    started?.agent_id === 'hermes' && !!started?.cwd, JSON.stringify(started));

  // A chat's row has its own bin, and the bin asks before it deletes.
  asked.length = 0;
  await act(async () => {
    row('Safari login').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  });
  await click(doc.querySelector('button[aria-label="Delete chat: Safari login"]'));
  const asksFirst = !asked.some((a) => a.type === 'chat.delete') && text().includes('whole history');
  await click(find('Delete'));
  await settle();
  ok('a chat’s row deletes it, after asking',
    asksFirst && asked.find((a) => a.type === 'chat.delete')?.data.chat_id === 'c2' && !row('Safari login'),
    JSON.stringify(asked.map((a) => [a.type, a.data])));
}

group('a product has its own chats');
{
  const header = doc.querySelector('header');
  const at = Date.now() / 1000;
  const host = fakeHost();
  await act(async () => {
    seed(useFleet, { hosts: { studio: { ...host, chats: [...host.chats,
      fakeChat({ id: 'q1', title: 'Quire invoices', project_id: 'p-quire', project: 'Quire', updated_at: at - 30 }),
      fakeChat({ id: 'h1', title: 'Hush pricing', project_id: 'p-hush', project: 'Hush', updated_at: at - 20 }),
    ] } } });
  });
  await click(find('Dashboard', header));
  await click(tile('quire'));
  const tab = find('Chats', doc.querySelector('[aria-label="View"]'));
  await click(tab);
  const shown = (words) => [...doc.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(words));
  ok('the product’s Chat tab lists the chats filed under it and no others, with the newest open',
    shown('Quire invoices') && !shown('Hush pricing') && !shown('Safari login')
      && w.location.pathname === '/p/quire/chat/q1',
    `${w.location.pathname} · tab ${!!tab}`);

  asked.length = 0;
  await click([...doc.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('New chat')));
  await click(find('Start chat'));
  for (let i = 0; i < 3; i++) await act(async () => {});
  const made = asked.find((a) => a.type === 'chat.create');
  ok('a chat started there starts in the product’s repository, and is read on the product’s page',
    // Whichever folder the board seeded above says Quire is checked out in.
    made?.key === 'studio' && /\/quire$/.test(made?.data.cwd ?? '')
      && place() === 'Dashboard' && w.location.pathname.startsWith('/p/quire/chat/told'),
    `${JSON.stringify(made?.data?.cwd)} · ${place()} · ${w.location.pathname}`);
  await press('0');
}

group('the four things the panel could not do to a computer');
{
  const header = doc.querySelector('header');
  // The group above emptied this computer's accounts on purpose; this one is
  // about what the page does with a computer that has them, codex among them —
  // the tool the fixture deliberately does not have installed.
  await act(async () => { seed(useFleet, { hosts: { studio: fakeHost() } }); });
  await click(nav('Machine'));
  await press('7');
  ok('Accounts is a page of the Machine place', page() === 'Accounts & sign-ins', `${page()}`);

  // 1 · a tool that is not installed is installed from here, rather than being
  // a row that tells you to go and do it yourself.
  const install = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Install') ?? null;
  ok('a sign-in whose CLI is missing offers to install it', !!install,
    [...doc.querySelectorAll('button')].map((b) => b.textContent).join(' | ').slice(0, 200));
  asked.length = 0;
  await click(install);
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('…and pressing it runs the installer on that computer, for that tool',
    asked.some((a) => a.key === 'studio' && a.type === 'tool.install' && a.data.provider === 'codex'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.provider])));
  ok('…and says what came back rather than leaving the button spinning',
    text().includes('installed 1.9.0'), text().slice(-200));

  // 2 · what the computer does when a sign-in runs out, which was a phone-only
  // setting and the one thing this page could not say.
  ok('the page says what happens at the limit',
    text().includes('When a sign-in runs out') && text().includes('the turn stops'),
    text().slice(-300));
  const choice = (label) => [...doc.querySelectorAll('[role="radio"]')]
    .find((b) => (b.textContent ?? '').trim() === label) ?? null;
  asked.length = 0;
  await click(choice('On'));
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('…and turning the pool on is a write to that computer, not a switch in a browser',
    asked.some((a) => a.type === 'pool.set' && a.data.enabled === true),
    JSON.stringify(asked.map((a) => [a.type, a.data])));
  ok('…which the page then says out loud',
    text().includes('the next sign-in takes over'), text().slice(-300));
  asked.length = 0;
  await click(choice('80%'));
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('…as is how much of a window to spend first',
    asked.some((a) => a.type === 'pool.set' && a.data.threshold === 0.8),
    JSON.stringify(asked.map((a) => [a.type, a.data])));

  // 3 · what a restart would cost, before it is pressed rather than after.
  // Update sits under Admin, which is the page ⌘6 opens.
  asked.length = 0;
  await press('6');
  // The row about the update, by what it is about: its button says `Open`,
  // like three others on that page.
  const updateRow = [...doc.querySelectorAll('div')]
    .filter((e) => /update/i.test(e.textContent ?? '') && !!e.querySelector('button'))
    .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0] ?? null;
  const toUpdate = updateRow?.querySelector('button') ?? null;
  ok('the update page is reached from Admin, where the drawer files it', !!toUpdate,
    (updateRow?.textContent ?? '').slice(0, 120));
  await click(toUpdate);
  for (let i = 0; i < 4; i++) await act(async () => {});
  ok('the update page asks what a restart would cost',
    asked.some((a) => a.type === 'daemon.status'),
    JSON.stringify(asked.map((a) => a.type)));
  ok('…and says it beside the button: the work in flight, and that nothing would bring it back',
    text().includes('1 chat running') && text().includes('3 messages queued')
    && text().includes('nothing would restart it'),
    text().slice(0, 400));

  // 4 · unpairing. It used to be local only — the panel forgot the computer
  // and the computer went on trusting the token in it forever.
  // Settings is ⌘, and the computers are one press further in — that page is
  // the panel's own, and a computer is removed from it.
  await press(',');
  // Settings holds what this browser decides; what belongs to one computer is
  // one press further in, behind any of the `Change` rows under its name.
  const change = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Change') ?? null;
  ok('settings has a way in to the computer’s own page', !!change);
  await click(change);
  const computers = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim().startsWith('Computers')) ?? null;
  ok('…and that page keeps the paired computers under a section of their own', !!computers);
  await click(computers);
  const remove = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Remove') ?? null;
  ok('the computer can be removed from the panel’s own settings', !!remove);
  asked.length = 0;
  await click(remove);
  const confirm = [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Remove' && b !== remove) ?? null;
  ok('…which asks first, and says what it will do', !!confirm
    && /revoked/.test(text()), text().slice(-300));
  await click(confirm);
  for (let i = 0; i < 3; i++) await act(async () => {});
  ok('…and removing it revokes this browser’s pairing on that computer',
    asked.some((a) => a.key === 'studio' && a.type === 'device.revoke_self'),
    JSON.stringify(asked.map((a) => a.type)));
  ok('…and the computer is gone from the panel',
    !Object.keys(useFleet.getState().hosts).length,
    Object.keys(useFleet.getState().hosts).join(', '));
}

group('the Dashboard and its Composer (HANDOVER §4.1, §5)');
{
  const now = Math.floor(Date.now() / 1000);
  // Every board on the one computer this panel is paired with.
  const board = (name) => ({ studio: answered(boards(now)[name][0].snap, now) });
  await act(async () => {
    seed(useFleet, { hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
    seed(useDivanStore, { snaps: board('busy') });
  });
  await press('0');
  for (let i = 0; i < 3; i++) await act(async () => {});
  const field = () => doc.querySelector('#composer-in');
  const send = () => doc.querySelector('button.dv-send');
  const mode = (label) => [...doc.querySelectorAll('.dv-seg button')].find((b) => b.textContent.trim() === label);
  const picker = (name) => doc.querySelector(`[data-picker="${name}"]`);
  const value = (name) => picker(name)?.querySelector('.val')?.textContent ?? null;
  const option = (label) => [...doc.querySelectorAll('[role="menu"] [role="menuitemradio"]')]
    .find((b) => b.firstElementChild?.textContent === label) ?? null;
  const dialogs = () => doc.querySelectorAll('[role="dialog"], [aria-modal="true"]').length
    + (find('Start chat') ? 1 : 0);
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };

  // 1 · Ask
  asked.length = 0;
  await type(field(), 'ship the beta tonight');
  await click(send());
  await settle();
  const made = asked.findIndex((a) => a.type === 'chat.create');
  const said = asked.findIndex((a) => a.type === 'chat.send');
  const id = asked[made]?.data && asked[said]?.data?.chat_id;
  ok('Ask: one press sends chat.create then chat.send with the words, and lands in that chat, with no dialog',
    made >= 0 && said > made && asked[said].data.text === 'ship the beta tonight'
      && place() === 'Chat' && w.location.pathname === `/chats/${id}` && dialogs() === 0,
    `${asked.map((a) => a.type).join(',')} · ${place()} · ${w.location.pathname} · ${dialogs()}`);

  // 2 · Ice Box and Start now
  const cards = [];
  for (const [label, column] of [['Ice Box', 'ice_box'], ['Start now', 'in_progress']]) {
    await press('0');
    await click(mode(label));
    asked.length = 0;
    await type(field(), '@quire write the retry doc');
    await click(send());
    await settle();
    cards.push({ column, asked: asked.map((a) => ({ type: a.type, data: a.data })), dialogs: dialogs(),
                 home: home() });
  }
  ok('Ice Box writes the card into Ice Box and Start now into In Progress, starting no chat and asking nothing',
    cards.every((c) => c.asked.some((a) => a.type === 'divan.card.create' && a.data.column === c.column
        && a.data.project_id === 'p-quire' && a.data.title === 'write the retry doc')
      && !c.asked.some((a) => a.type === 'chat.create' || a.type === 'divan.card.move'
        || a.type.startsWith('ustabasi.'))
      && c.dialogs === 0 && c.home),
    JSON.stringify(cards));

  // 3 · the four chips
  await press('0');
  await click(mode('Ask'));
  const defaults = ['Project', 'Agent', 'Account', 'Model'].map((n) => value(n));
  await click(picker('Model').querySelector('button'));
  const listed = [...doc.querySelectorAll('[role="menu"] [role="menuitemradio"]')].map((b) => b.firstElementChild.textContent);
  await click(option('Sonnet 5'));
  await click(picker('Account').querySelector('button'));
  await click(option('yakup@…'));
  const changed = ['Model', 'Account'].every((n) => picker(n).querySelector('[data-changed="true"]')
    && picker(n).querySelector('.dv-picker-x'));
  asked.length = 0;
  await type(field(), 'which plan am I on');
  await click(send());
  await settle();
  const create = asked.find((a) => a.type === 'chat.create')?.data ?? {};
  await press('0');
  const reset = value('Model');
  ok('four chips show the defaults, list what the computer reports, mark a changed one with an ×, and that is what chat.create carries',
    JSON.stringify(defaults) === JSON.stringify(['auto', 'Hermes', "This computer's account", 'Opus 5'])
      && JSON.stringify(listed) === JSON.stringify(['Opus 5', 'Sonnet 5'])
      && changed && create.model === 'claude-sonnet-5' && create.account_id === 'a2'
      && create.agent_id === 'hermes' && reset === 'Opus 5',
    `${JSON.stringify(defaults)} ${JSON.stringify(listed)} ${changed} ${JSON.stringify(create)} ${reset}`);

  // 4 · @project is the scope chip
  await type(field(), '@quire why is the retry policy like this ');
  const typedChip = doc.querySelector('.dv-scope .dv-chip[aria-pressed="true"]')?.textContent ?? null;
  const left = field().value;
  await click(doc.querySelector('.dv-scope .dv-chip'));
  await click(doc.querySelector('.dv-scope .dv-chip--add'));
  await click(option('Quire'));
  const pressedChip = doc.querySelector('.dv-scope .dv-chip[aria-pressed="true"]')?.textContent ?? null;
  asked.length = 0;
  await click(send());
  await settle();
  const scoped = asked.find((a) => a.type === 'chat.create')?.data ?? {};
  ok('typing @quire makes the same scope chip as pressing it, and the call opens in that project',
    typedChip === pressedChip && /Quire/.test(typedChip ?? '') && left === 'why is the retry policy like this '
      && scoped.cwd === '/w/quire',
    `${typedChip} vs ${pressedChip} · «${left}» · ${scoped.cwd}`);

  // 5 · Needs you
  await press('0');
  const amber = doc.querySelector('[data-wait="studio:k2"] .dv-btn--amber');
  asked.length = 0;
  await click(amber);
  await settle();
  const note = asked.find((a) => a.type === 'ustabasi.note');
  await click([...doc.querySelectorAll('[data-wait="studio:k2"] button')].find((b) => b.textContent === 'Open'));
  const opened = w.location.pathname;
  await act(async () => { seed(useDivanStore, { snaps: board('calm') }); });
  await press('0');
  ok('Needs you answers in one press with the same note the question window sent, Open goes to the ticket, and with nothing waiting the section is not in the DOM',
    amber?.textContent === 'Use the live ones now' && note?.key === 'studio' && note?.data.id === 42
      && note?.data.text === 'Use the live ones now' && opened === '/p/quire/c/k2'
      && !doc.querySelector('#needs-you') && !text().includes('Needs you'),
    `${amber?.textContent} ${JSON.stringify(note)} ${opened}`);

  // 6 · tiles and the summary line
  const calmLine = doc.querySelector('[data-summary]')?.textContent ?? '';
  await act(async () => { seed(useDivanStore, { snaps: board('slow') }); });
  const tiles = [...doc.querySelectorAll('a[data-tile]')];
  const order = tiles.map((a) => `${a.dataset.tile}${a.classList.contains('dv-tile--dormant') ? '*' : ''}`);
  await act(async () => { seed(useDivanStore, { snaps: board('busy') }); });
  const busyLine = doc.querySelector('[data-summary]')?.textContent ?? '';
  const totals = (await import(pathToFileURL(join(out, 'src/lib/divan.js')).href))
    .merge([{ key: 'studio', name: 'studio', state: board('busy').studio }], now).totals;
  await click(tile('quire'));
  const tileWent = w.location.pathname;
  ok('tiles open the project, dormant ones come last and dimmed, and the line counts off the boards and says nothing is stuck at zero',
    tileWent === '/p/quire' && order.join(' ') === 'pebble the-long-walk*'
      && /nothing needs you/.test(calmLine) && /nothing is stuck/.test(calmLine)
      && busyLine.includes(`${totals.needsYou} things need you`) && busyLine.includes(`${totals.running} working`)
      && (totals.stuck ? busyLine.includes(`${totals.stuck} stuck`) : busyLine.includes('nothing is stuck')),
    `${tileWent} · ${order.join(' ')} · «${calmLine}» · «${busyLine}» · ${JSON.stringify(totals)}`);

  // 7 · Back, reload, and every old destination
  await act(async () => {
    const landed = new Promise((r) => { const d = () => { w.removeEventListener('popstate', d); r(null); }; w.addEventListener('popstate', d); setTimeout(d, 500); });
    w.history.back();
    await landed;
    await new Promise((r) => setTimeout(r, 0));
  });
  const backHome = home() && w.location.pathname === '/';
  const reloads = [];
  for (const path of ['/p/quire', '/machine/accounts', '/chats', '/']) {
    await act(async () => { root.unmount(); });
    w.history.replaceState(null, '', path);
    root = createRoot(w.document.getElementById('root'));
    await act(async () => { root.render(React.createElement(App)); });
    await settle();
    reloads.push(path === '/p/quire' ? head() === 'Quire' : path === '/' ? home()
      : path === '/chats' ? place() === 'Chat' : page() === 'Accounts & sign-ins');
  }
  await press('k');
  const offered = [...doc.querySelectorAll('[data-i]')].map((e) => e.textContent ?? '').join(' | ');
  await press('k');
  const wanted = ['New chat', 'Dashboard', 'Chat', 'Machine',
    ...MACHINE_ROWS.map((r) => `Machine › ${r.label}`), 'Machine › Folders', 'Machine › Agents on this computer',
    'Machine › Update', 'Machine › This computer', 'Machine › Sessions and plan limits', 'Light theme'];
  ok('Back from a project is the Dashboard, a reload redraws the page it was on, and every old destination is offered',
    backHome && reloads.every(Boolean) && wanted.every((x) => offered.includes(x))
      && !!nav('Chats') && !!nav('Machine'),
    `${backHome} ${JSON.stringify(reloads)} ${wanted.filter((x) => !offered.includes(x))}`);

  // 8 · low quota on the account in use, and still nothing asked
  const account = picker('Account').querySelector('button');
  asked.length = 0;
  await type(field(), 'is the plan nearly spent');
  await click(send());
  await settle();
  ok('the account in use is under the line: its chip carries an amber dot and the words, and the send still asks nothing',
    /low quota/.test(account.getAttribute('aria-label') ?? '') && !!account.querySelector('.dv-dot--ask')
      && account.textContent.includes('low quota')
      && asked.some((a) => a.type === 'chat.create') && dialogs() === 0,
    `${account.getAttribute('aria-label')} · ${asked.map((a) => a.type)}`);
}

group('the project page, its board and its Composer (HANDOVER §4.2, §4.3)');
{
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };
  const now = Math.floor(Date.now() / 1000);
  const base = boards(now).busy[0].snap;
  const c = (id, over) => ({ ...base.cards[0], id, ustabasi_id: null, agent_status: null,
    agent_status_at: null, agent_detail: '', summary: '', ...over });
  const snap = { ...base, cards: [...base.cards,
    c('q1', { column: 'queued', position: 0, title: 'Bulk invite' }),
    c('q2', { column: 'queued', position: 1, title: 'Zapier hook' }),
    c('q3', { column: 'queued', position: 2, title: 'Audit log' }),
    c('r1', { column: 'review', title: 'Payment flow', agent_status: 'running', agent_status_at: now - 480 }),
    c('i3', { column: 'in_progress', position: 2, title: 'Lesson search', agent_status: 'running', agent_status_at: now - 360 }),
    c('i4', { column: 'in_progress', position: 3, title: 'Certificate PDF', agent_status: 'running', agent_status_at: now - 2460 }),
    c('i5', { column: 'in_progress', position: 4, title: 'Exam timer', agent_status: 'blocked', agent_status_at: now - 4300,
              agent_detail: 'Test fails on Safari 17.' }),
    ...[1, 2, 3, 4, 5].map((n) => c(`d${n}`, { column: 'done', title: `Shipped ${n}`, moved_at: now - n * 86400 })),
  ] };
  await act(async () => {
    seed(useDivanStore, { snaps: { studio: answered(snap, now) } });
    useThresholds.setState({ thresholds: DEFAULT_THRESHOLDS });
    useDock.setState({ minimised: ['studio:k2', 'studio:h1', 'studio:i5'], closed: {}, raised: [] });
  });
  await press('0');
  await click(tile('quire'));
  const seg = (label) => find(label, doc.querySelector('[aria-label="View"]'));
  const pressed = () => doc.querySelector('[aria-label="View"] [aria-pressed="true"]')?.textContent ?? null;
  const reload = async (path) => {
    await act(async () => { root.unmount(); });
    w.history.replaceState(null, '', path);
    root = createRoot(w.document.getElementById('root'));
    await act(async () => { root.render(React.createElement(App)); });
    await settle();
  };
  const goBack = async () => {
    await act(async () => {
      const landed = new Promise((r) => { const d = () => { w.removeEventListener('popstate', d); r(null); }; w.addEventListener('popstate', d); setTimeout(d, 500); });
      w.history.back();
      await landed;
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  // 2 · the head and the segment
  const meta = doc.querySelector('.dv-phead [data-meta]')?.textContent ?? '';
  const headOk = !!doc.querySelector('.dv-phead .dv-mono') && head() === 'Quire'
    && doc.querySelector('.dv-phead [data-description]')?.textContent === 'client portals for studios'
    && meta.startsWith('live since') && !doc.querySelector('.dv-stage')
    && !/\bIdea\b[\s\S]*\bGrowth\b/.test(text());
  await click(seg('Board'));
  const onBoard = w.location.pathname === '/p/quire/board' && !!doc.querySelector('section.dv-col');
  await click(seg('Chats'));
  const onChats = w.location.pathname.startsWith('/p/quire/chat') && pressed() === 'Chats';
  await click(seg('Overview'));
  const onOverview = w.location.pathname === '/p/quire' && !!doc.querySelector('[data-counts]');
  await click(seg('Board'));
  await goBack();
  const backed = w.location.pathname === '/p/quire' && pressed() === 'Overview';
  const reloads = [];
  for (const [path, word] of [['/p/quire/board', 'Board'], ['/p/quire/chat', 'Chats'], ['/p/quire', 'Overview']]) {
    await reload(path);
    reloads.push(pressed() === word && w.location.pathname.startsWith(path));
  }
  ok('the head is monogram, name, one sentence and a meta line with the stage as a word, no stage bar; the segment switches the view and each path survives reload and Back',
    headOk && onBoard && onChats && onOverview && backed && reloads.every(Boolean),
    JSON.stringify({ headOk, meta, onBoard, onChats, onOverview, backed, reloads }));

  // 3 · the board summary
  const counted = Object.fromEntries([...doc.querySelectorAll('[data-count]')]
    .map((a) => [a.dataset.count, Number(a.querySelector('.n')?.textContent)]));
  const rows = [...doc.querySelectorAll('[data-in-progress] [data-row]')]
    .map((r) => [r.querySelector('.dv-status')?.textContent, r.querySelector('.t')?.textContent]);
  await click(seg('Board'));
  const columnCount = (name) => Number(doc.querySelector(`section.dv-col[aria-label="${name}"] .dv-sec .dv-meta`)?.textContent);
  const fromColumns = { ice_box: columnCount('Ice Box'), queued: columnCount('Queued'),
    in_progress: columnCount('In Progress'), done: columnCount('Done') };
  ok('the board summary counts the four real columns, and In progress now lists five In Progress cards with their status words',
    JSON.stringify(counted) === JSON.stringify(fromColumns)
    && JSON.stringify(counted) === JSON.stringify({ ice_box: 1, queued: 3, in_progress: 6, done: 5 })
    && rows.length === 5 && ['stuck', 'asking', 'testing', 'running'].every((w2) => rows.some((r) => r[0] === w2)),
    JSON.stringify({ counted, fromColumns, rows }));

  // 6 · asking edge, and Done this month
  const card = (words) => [...doc.querySelectorAll('article.dv-card')].find((e) => (e.textContent ?? '').includes(words)) ?? null;
  const doneCards = () => doc.querySelectorAll('section.dv-col[aria-label="Done"] article').length;
  const css = readFileSync(join(web, 'src', 'styles', 'divan-app.css'), 'utf8');
  const asking = card('Stripe keys');
  const shownBefore = doneCards();
  const more = find('Show 2 more');
  if (more) await click(more);
  ok('an asking card carries the amber edge and the word asking; Done shows this month with Show N more revealing the rest',
    asking?.dataset.status === 'ask' && (asking.querySelector('.dv-status')?.textContent === 'asking')
    && /\.dv-card\[data-status="ask"\]\{border-color:color-mix\(in srgb,var\(--amber\)/.test(css)
    && shownBefore === 3 && !!more && doneCards() === 5 && !find('Show 2 more'),
    `${asking?.dataset.status} · ${shownBefore} → ${doneCards()}`);

  // 8 · Queued is the priority order
  const column = (name) => doc.querySelector(`section.dv-col[aria-label="${name}"]`);
  asked.length = 0;
  const lift = new Transfer();
  await drag(card('Audit log'), 'dragstart', lift);
  await drag(card('Bulk invite'), 'dragover', lift);
  await drag(card('Bulk invite'), 'drop', lift);
  const reordered = asked.find((a) => a.type === 'divan.card.move');
  ok('a Queued card dropped on another Queued card takes its place, which is the priority',
    reordered?.data.card_id === 'q3' && reordered.data.column === 'queued' && reordered.data.position === 0,
    JSON.stringify(reordered));

  // 1 · Queued → In Progress starts it, asking nothing
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(snap, now) } }); });
  asked.length = 0;
  const start = new Transfer();
  await drag(card('Bulk invite'), 'dragstart', start);
  await drag(column('In Progress'), 'dragover', start);
  await drag(column('In Progress'), 'drop', start);
  await settle();
  ok('dragging a card from Queued into In Progress issues divan.card.move with In Progress, and no confirmation appears',
    asked.some((a) => a.type === 'divan.card.move' && a.data.card_id === 'q1' && a.data.column === 'in_progress')
    && doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]').length === 0
    && (column('In Progress').textContent ?? '').includes('Bulk invite'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.column])));

  // 4 · branches
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(snap, now) } }); });
  await click(seg('Overview'));
  const seo = doc.querySelector('[data-branch="SEO"]');
  const eng = doc.querySelector('[data-branch="Engineering"]');
  const seoOk = seo?.dataset.connected === 'false'
    && (seo.textContent ?? '').includes('Source not connected yet.') && !/\d/.test(seo.textContent ?? '');
  await click(eng);
  ok('a branch with no source says Source not connected yet. and no number; a connected one opens the branch page',
    seoOk && eng?.dataset.connected === 'true' && w.location.pathname === '/p/quire/b/Engineering',
    `${seo?.textContent} · ${w.location.pathname}`);
  await goBack();

  // 7 · the Composer at the foot is locked
  const scope = doc.querySelector('.dv-composer .dv-scope');
  const locked = scope?.querySelector('[data-locked]');
  const removable = [...(scope?.querySelectorAll('button') ?? [])].length
    + doc.querySelectorAll('.dv-composer [data-picker="Project"]').length;
  await click(find('Ice Box', doc.querySelector('.dv-composer [aria-label="Mode"]')));
  await type(doc.querySelector('#composer-in'), '@hush Write the changelog ');
  asked.length = 0;
  await click(doc.querySelector('.dv-composer button[aria-label="Send"]'));
  await settle();
  const sent = asked.find((a) => a.type === 'divan.card.create');
  // 8 · what the old page could do: Still open's thread, from the side column
  const post = [...doc.querySelectorAll('aside [role="button"]')]
    .find((e) => (e.textContent ?? '').includes('Payment provider keys')) ?? null;
  if (post) await click(post);
  const say = [...doc.querySelectorAll('aside input')]
    .find((i) => (i.getAttribute('placeholder') ?? '').startsWith('Say something')) ?? null;
  if (say) await type(say, 'Bedirhan has the account');
  asked.length = 0;
  if (say) await act(async () => { say.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  ok('Still open sits in the side column and its thread still takes a comment',
    !!post && asked.some((a) => a.type === 'divan.project.open' && a.data.comment === 'Bedirhan has the account'),
    JSON.stringify(asked.map((a) => [a.type, a.data?.comment])));

  ok('the Composer at the foot of a project carries that project, and its chip cannot be removed',
    (locked?.textContent ?? '').includes('Quire') && removable === 0
    && sent?.data.project_id === 'p-quire' && sent.data.column === 'ice_box',
    `${removable} · ${JSON.stringify(sent?.data)}`);
}

group('nothing was lost on the way');
{
  ok('no screen the panel opened let a rejection go unhandled',
    unhandled.length === 0, [...new Set(unhandled)].slice(0, 5).join('\n    '));
}

await act(async () => { root.unmount(); });

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
