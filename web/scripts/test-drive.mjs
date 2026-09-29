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
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { useDock } = await load('src/lib/sessions.js');
const { themeScheme, setThemeChoice } = await load('src/lib/theme.js');
const { MACHINE_ROWS } = await load('src/lib/shell.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);
const { host: fakeHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

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
seed(useFleet, {
  hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    // The board is the one thing not answered from here: the snapshots are
    // seeded below, and a socket that answered `{}` would replace a fixture with
    // an empty board. A poll that fails is one of the states the panel has to
    // survive anyway, and it is the state the groups above are read in.
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const text = () => doc.body.textContent ?? '';
/** The place the bar says you are in, and the Machine page its list says you
 *  are on: both are `aria-current="page"`, which is how the frames' "filled"
 *  nav item and side panel row say the same thing to a reader who cannot see
 *  the fill. */
const place = () => doc.querySelector('header [aria-current="page"]')?.textContent?.trim() ?? null;
// …read off the row's own name and not its whole line, which also carries the
// count of what is waiting under it.
const page = () => doc.querySelector('nav [aria-current="page"] span')?.textContent?.trim() ?? null;
/** The page under the bar, as markup: what a theme change must not touch. */
const body = () => doc.querySelector('header')?.nextElementSibling?.innerHTML ?? '';
/** Its head — the one 28 pt line on a Divan page. */
const head = () => [...doc.querySelectorAll('span, div')]
  .find((e) => e.style.fontSize === '28px')?.textContent?.trim() ?? null;

const press = async (key) => {
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }));
  });
};
/** The button whose label is this word, anywhere on the page. */
const find = (label, within = doc) => [...within.querySelectorAll('button')]
  .find((b) => (b.textContent ?? '').trim() === label) ?? null;
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
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
  ok('it mounted, with the bar over it', text().includes('divan') && !!doc.querySelector('header'));
  ok('…on the Dashboard, which is the place it opens on',
    place() === 'Dashboard' && head() === 'Overview', `${place()} · ${head()}`);
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
  ok('⌘0 goes back to the Dashboard', place() === 'Dashboard' && head() === 'Overview',
    `${place()} · ${head()}`);
  await press('9');
  ok('…and a key nothing is bound to changes nothing', place() === 'Dashboard');
}

group('the bar');
{
  await click(find('Chat', doc.querySelector('header')));
  ok('the Chat place is one press away, and it is the chat and its list',
    place() === 'Chat' && !!doc.querySelector('input[name="chat-search"]')
    && text().includes('Webhook retry policy'), `${place()}`);

  await click(find('Machine', doc.querySelector('header')));
  ok('…and the Machine place opens on the first row of its list',
    place() === 'Machine' && page() === MACHINE_ROWS[0].label, `${place()} › ${page()}`);

  await click(find('Dashboard', doc.querySelector('header')));
  ok('…and the Dashboard comes back', place() === 'Dashboard' && head() === 'Overview');
}

group('the project bar scopes the page');
{
  const chip = (label) => find(label, doc.querySelector('header'));
  ok('the chips are All and the products, in the merge’s order',
    [...doc.querySelectorAll('header button')].map((b) => b.textContent.trim())
      .filter((t) => ['All', 'Quire', 'Hush'].includes(t)).join(' ') === 'All Quire Hush');

  const steps = w.history.length;
  await click(chip('Quire'));
  ok('pressing one writes it into the address',
    w.location.search === '?project=quire', w.location.search);
  ok('…by replacing it rather than pushing: going back is not for products',
    w.history.length === steps, `${steps} → ${w.history.length}`);
  ok('…and the page under the bar comes back scoped to it',
    head() === 'Quire' && !body().includes('Hush'), `${head()}`);
  await click(chip('All'));
  ok('pressing All takes the product out of the address rather than emptying it',
    w.location.search === '', JSON.stringify(w.location.search));
  ok('…and the page is every product again', head() === 'Overview' && body().includes('Hush'));

  // The chips are over the Dashboard and the pages under it, and nowhere else:
  // Web15's bar, over the Machine pages, ends in what the fleet is doing
  // instead. So the bar loses them on the way in and has them again on the way
  // back — which is also why a chip can only ever be pressed from the place it
  // scopes.
  await press('4');
  ok('the Machine place’s bar draws no chips', chip('Quire') === null && chip('All') === null);
  await press('0');
  ok('…and the Dashboard’s has them again', !!chip('Quire') && !!chip('All'));
}

group('the switch, in a document');
{
  const chip = () => find('Light', doc.querySelector('header')) ?? find('Dark', doc.querySelector('header'));
  const before = body();
  const bar = doc.querySelector('header');
  ok('in the dark, the bar offers the light theme', !!find('Light', doc.querySelector('header')));
  await click(chip());
  ok('pressing it moves the document’s theme, and nothing else says it',
    doc.documentElement.dataset.theme === 'light' && themeScheme() === 'light');
  ok('…the page under the bar is the same markup it was',
    body() === before, `${body().length} vs ${before.length}`);
  ok('…and it is a page with colours in it, so that means something',
    before.includes('var(--dv-'));
  ok('…and the bar now offers the other one', !!find('Dark', doc.querySelector('header')));
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
  const inside = (label) => [...doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').includes(label)) ?? null;
  /** What the open windows say, and not what the page under them says — a
   *  project card carries the worst card's own line, which is this very
   *  question, so "the window is gone" has to be asked of the windows. */
  const windows = () => [...doc.querySelectorAll('section')]
    .map((e) => e.textContent ?? '').join(' · ');
  await act(async () => {
    seed(useDivanStore, { snaps: { studio: answered(board.busy[0].snap, now) } });
  });

  ok('a question that is waiting opens by itself, with nobody pressing anything',
    windows().includes('asks you') && windows().includes('Use the live ones now'),
    windows().slice(0, 300));
  ok('…in the words the worker used, over the product and the card it is about',
    windows().includes('Use the live ones now, or wait for the review?')
    && windows().includes('Quire · Stripe keys'));
  ok('…and the second thing waiting opens beside it rather than in a queue',
    windows().includes('App Review reply') && windows().includes('your call'));

  const pill = find('Use the live ones now');
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

  const shut = [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
  await click(shut);
  ok('closing one takes it off the page, tab and all',
    !windows().includes('Use the live ones now') && !inside('Stripe keys'), windows().slice(0, 300));

  // The bar across the bottom of every desktop frame, and what it opens.
  ok('the command bar is on the page', text().includes('Tell Divan anything…'));
  await click(inside('Tell Divan anything'));
  ok('…and pressing it opens what ⌘K opens', !!doc.querySelector('input[name="palette-query"]'));
  await press('k');
  ok('…which closes again', !doc.querySelector('input[name="palette-query"]'));
}

group('the board, with the asking agent’s chat beside it');
{
  const now = Math.floor(Date.now() / 1000);
  const studio = boards(now).busy[0].snap;
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(studio, now) } }); });
  const chip = (label) => find(label, doc.querySelector('header'));
  await click(chip('Quire'));
  await click(find('Board'));

  /** A column of the board, by its name: the head is a tab and the column is
   *  what catches a drop, which is the element around it. */
  const column = (name) => [...doc.querySelectorAll('[role="tab"]')]
    .find((b) => (b.textContent ?? '').startsWith(name))?.parentElement ?? null;
  /** A ticket, by the words on it. Every one of them can be picked up, which is
   *  what tells a card apart from everything else on the page. */
  const ticket = (words) => [...doc.querySelectorAll('[draggable="true"]')]
    .find((e) => (e.textContent ?? '').includes(words)) ?? null;
  const windows = () => [...doc.querySelectorAll('section')].map((e) => e.textContent ?? '').join(' · ');

  ok('the Board tab of a product is its board, four columns of the machines’ own',
    ['Ice Box', 'Queued', 'In Progress', 'Done'].every((c) => !!column(c))
    && !!ticket('Webhook retry policy') && !!ticket('CSV export'),
    [...doc.querySelectorAll('[role="tab"]')].map((b) => b.textContent).join(' | '));
  ok('…still on the Dashboard, and still the page the bar is over',
    place() === 'Dashboard' && head() === 'Quire', `${place()} · ${head()}`);

  // Every window put away, so that what opens next opened because it was
  // pressed rather than because the desktop opens two by itself.
  await act(async () => { useDock.setState({ minimised: ['studio:k2', 'studio:h1'], closed: {}, raised: [] }); });
  ok('with every question put away, nothing is open over the board', windows() === '',
    windows().slice(0, 200));

  await click(ticket('Stripe keys'));
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
    !!ticket('Stripe keys') && (ticket('Stripe keys').textContent ?? '').includes('Asking you'));
  const back = {
    ...studio,
    cards: studio.cards.map((c) => (c.id === 'k2'
      ? { ...c, agent_status: 'running', agent_detail: 'Using the live keys.' } : c)),
  };
  await act(async () => { seed(useDivanStore, { snaps: { studio: answered(back, now) } }); });
  ok('…and when it is, the mark clears on the card and the window is gone',
    (ticket('Stripe keys').textContent ?? '').includes('Running')
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
    column('Queued').querySelector('[role="tab"]').getAttribute('aria-selected') === 'true'
    && column('Ice Box').querySelector('[role="tab"]').getAttribute('aria-selected') === 'false');
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
}

group('nothing was lost on the way');
{
  ok('no screen the panel opened let a rejection go unhandled',
    unhandled.length === 0, [...new Set(unhandled)].slice(0, 5).join('\n    '));
}

await act(async () => { root.unmount(); });

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
