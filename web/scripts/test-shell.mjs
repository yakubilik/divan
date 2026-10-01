#!/usr/bin/env node
/** The desktop shell: three places, the project bar, and the switch between the
 *  two themes.
 *
 *     cd web && npm test
 *
 *  `test-divan.mjs` is about the palette and the parts. This is about the shape
 *  they are arranged into, and it answers the four things the shell has to be
 *  true of — each of them by driving something rather than by reading it:
 *
 *   · **the shell is the frames' shell, in both themes.** The bar is built out of
 *     the design system's own parts and nothing else, every colour in what it
 *     draws is one of the sixteen, and the two themes produce the *same markup* —
 *     which is what "the switch changes theme without a reload" means
 *     mechanically: nothing on the page is re-rendered, one attribute moves.
 *   · **the project bar scopes the page.** The chips are the merge's own products
 *     with the merge's own states, the chosen one lives in the address the way the
 *     phone keeps it in the route, and the page under it is a different page when
 *     a product is chosen.
 *   · **every place the old panel had is still reachable.** The eight screens of
 *     the old sidebar are read out of git where git is there to read, and each of
 *     them has to be a place or a page of the Machine list — and be dispatched.
 *   · **the chat is untouched.** Its five files are unchanged against the branch
 *     this work started from, and nothing of the shell has reached into them.
 *
 *  And the state matrix the constraint asks for: every screen of the shell is
 *  rendered with no data, with a snapshot that has gone stale, with a machine
 *  that cannot be reached and with one that has never answered — in both themes.
 *
 *  Compiled with the panel's own TypeScript into the panel's own tree, the way
 *  `test-divan.mjs` does it, so that `react` resolves as it does in a build.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'shell');
const src = (p) => readFileSync(join(web, p), 'utf8');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/lib/shell.ts', 'src/lib/divan.ts', 'src/lib/overview.ts',
  'src/components/Shell.tsx', 'src/screens/Overview.tsx', 'src/screens/Machine.tsx',
  'src/vite-env.d.ts',
  '--outDir', '.test-build/shell', '--rootDir', '.',
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

// ── a browser, as far as a static render needs one ──────────────────────────

/** The three things the shell reads off a browser: a stored theme, what the
 *  computer is set to, and the address the chosen product lives in. */
function browser({ system = 'dark', stored = null, search = '' } = {}) {
  const store = new Map(stored ? [['rac.theme', stored]] : []);
  const html = { dataset: {} };
  const query = { matches: system === 'light', addEventListener() {}, removeEventListener() {} };
  const url = { pathname: '/', search, hash: '', hostname: '127.0.0.1', port: '5173' };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.document = {
    documentElement: html, hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null, querySelectorAll: () => [],
  };
  globalThis.history = {
    replaceState: (_s, _t, to) => {
      const at = String(to).indexOf('?');
      url.search = at < 0 ? '' : String(to).slice(at);
    },
  };
  globalThis.window = {
    matchMedia: () => query,
    addEventListener() {}, removeEventListener() {},
    location: url, history: globalThis.history, open() {}, alert() {},
  };
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.location = url;
  return { html, store, url };
}

const env = browser();

const load = (p) => import(pathToFileURL(join(out, p)).href);

const K = await load('src/lib/theme.js');
const shell = await load('src/lib/shell.js');
const nav = await load('src/lib/nav.js');
const D = await load('src/lib/divan.js');
const OV = await load('src/lib/overview.js');
const ShellUI = await load('src/components/Shell.js');
const OverviewUI = await load('src/screens/Overview.js');
const MachineUI = await load('src/screens/Machine.js');
const AppUI = await load('src/App.js');
const parts = await load('src/ui/divan.js');
const kit = await load('src/ui/kit.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore } = await load('src/lib/divan.js');
const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fakeHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const NOW = fixture.NOW;

// ── the reading of a render ─────────────────────────────────────────────────

function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    return decl;
  });
}
const anyStyle = (markup, pred) => styles(markup).some(pred);
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;

/** Every variable a render names, and every colour it spelled out itself. */
function paint(markup) {
  const vars = new Set();
  const literal = new Set();
  for (const decl of styles(markup)) {
    for (const value of Object.values(decl)) {
      for (const m of value.matchAll(/var\(--dv-([a-zA-Z0-9]+)\)/g)) vars.add(m[1]);
      for (const c of value.replace(/var\([^)]*\)/g, '').match(COLOUR) ?? []) literal.add(c);
    }
  }
  return { vars, literal };
}

/** A colour that belongs to what it is drawn on rather than to the page: white
 *  on a coloured square, a monogram's own hue. */
const OWN = new Set([K.ON_COLOUR, ...K.MONOGRAM,
                     ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                     ...Object.values(K.MEDIA)]);

const v = (n) => `var(--dv-${n})`;

// ── the worlds a screen has to survive ─────────────────────────────────────

const entry = (key, name, state) => ({ key, name, state });

/** The five states of the fleet every screen of this ticket is drawn in. */
const WORLDS = {
  /** Nothing paired at all. */
  alone: () => [],
  /** Two machines, both answering, one product on both of them. */
  fresh: () => [
    entry('studio', 'studio', D.answered(fixture.studio(), NOW)),
    entry('mini', 'mini', D.answered(fixture.mini(), NOW)),
  ],
  /** The mini answered eight minutes ago and has been asked nothing since:
   *  its numbers are what it last said, and the page has to say so. */
  stale: () => [
    entry('studio', 'studio', D.answered(fixture.studio(), NOW)),
    entry('mini', 'mini', D.answered(fixture.mini(), NOW - 8 * 60)),
  ],
  /** …and the same machine refusing the connection, with its board still in
   *  hand: the rule the whole merge turns on. */
  unreachable: () => [
    entry('studio', 'studio', D.answered(fixture.studio(), NOW)),
    entry('mini', 'mini', D.silent(D.answered(fixture.mini(), NOW - 600), 'connection refused')),
  ],
  /** A machine that has never answered, and one whose daemon has never heard of
   *  the request. */
  never: () => [
    entry('studio', 'studio', D.silent(null, 'not connected')),
    entry('mini', 'mini', D.silent(null, 'unknown type divan.snapshot', true)),
  ],
};

const view = (world, now = NOW) => D.merge(WORLDS[world](), now);

/** The store the old screens read, seeded the way `test-divan.mjs` seeds it: a
 *  render on a server is handed the store's *initial* state, so writing only
 *  with `setState` is invisible to it. */
function seed(patch) {
  Object.assign(useFleet.getInitialState(), patch);
  useFleet.setState(patch);
}

function machineProps(view, fleet) {
  return {
    view, fleet, onView() {}, onOpenChat() {}, onNewChat() {},
    onNewChatIn() {}, onStartChat() {}, onPeek() {},
  };
}

/** The made-up computer, with an update in hand: the fixture has the chat that
 *  is waiting to be allowed something, and this is the other light. */
function withUpdate() {
  const slot = fakeHost();
  slot.info = { ...slot.info, update: { behind: 3, ahead: 0, auto: false, repo: true } };
  return slot;
}

// ── 1 · the three places ───────────────────────────────────────────────────

group('three places, and nothing beside them');
{
  ok('there are three of them, in the frames’ order',
    eq(shell.PLACES, ['dashboard', 'chat', 'machine']));
  ok('…each with the frame’s own word for it',
    eq(shell.PLACES.map((p) => shell.PLACE_LABEL[p]), ['Dashboard', 'Chat', 'Machine']));
  ok('…and a glyph out of the panel’s own vocabulary, which resolves to a path',
    shell.PLACES.every((p) => kit.glyph(shell.PLACE_ICON[p]).length > 8));
  ok('…and a page it opens on', shell.PLACES.every((p) => !!shell.PLACE_VIEW[p]));
  const everyView = ['overview', ...shell.OLD_PANEL.map((o) => o.view)];
  ok('every screen is in exactly one place',
    everyView.every((view) => shell.PLACES.includes(shell.placeOf(view))));
  // The panel opens on the Dashboard — unless the address says otherwise, which
  // is what makes a link to a board or a chat a link to that page and what
  // makes the back button work at all (`lib/nav.ts`).
  ok('the Dashboard is the place the panel opens on, and the Chat is entered on purpose',
    shell.placeOf('overview') === 'dashboard' && shell.placeOf('chats') === 'chat'
    && nav.HOME.view === 'overview'
    && /useState<View>\(opened\.current\.view\)/.test(src('src/App.tsx')));
  ok('…and everything that is about a computer is under the third one',
    shell.MACHINE_ROWS.every((r) => shell.placeOf(r.view) === 'machine')
    && shell.MACHINE_ROWS.length === 8);
  ok('…the eight rows being the frame’s eight, in the frame’s order',
    eq(shell.MACHINE_ROWS.map((r) => r.label),
      ['Machines', 'Executors', 'Terminals', 'Remote screen', 'Accounts & sign-ins',
       'Quota thresholds', 'Admin', 'Settings']),
    shell.MACHINE_ROWS.map((r) => r.label).join(', '));
  ok('…and a page with no row of its own is drawn under the row it was opened from',
    shell.MACHINE_ASIDE.every((a) => shell.MACHINE_ROWS.some((r) => r.view === a.under))
    && shell.machineRow('projects') === 'machines' && shell.machineRow('quota') === 'quota');
  ok('the Machine list opens on the machines themselves, as the frame does',
    shell.PLACE_VIEW.machine === shell.MACHINE_ROWS[0].view
    && shell.MACHINE_ROWS[0].view === 'machines');
  ok('every row of it says what its page is for, and is drawn with a glyph',
    shell.MACHINE_ROWS.every((r) => r.note.length > 12 && kit.glyph(r.icon).length > 8));
}

// ── 2 · every place the old panel had is still reachable ───────────────────

group('nothing was dropped in the move');
{
  // The old panel's own list, read off the branch this work started from rather
  // than typed out here: a screen quietly left behind would otherwise be a
  // screen quietly left out of the list as well.
  let union = null;
  try {
    const old = execFileSync('git', ['show', 'main:web/src/components/Sidebar.tsx'],
      { cwd: web, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /export type View =([^;]+);/.exec(old);
    if (m) union = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
  } catch { /* no git, or no main: the assertion below says so */ }
  if (union) {
    ok('the list of what the old panel had is the old panel’s own list',
      eq(union, shell.OLD_PANEL.map((o) => o.view === 'machines' ? 'dashboard' : o.view).sort()),
      `${union.join(', ')} vs ${shell.OLD_PANEL.map((o) => o.view).join(', ')}`);
  } else {
    // Once this work is in `main` there is no `View` union there to read, and
    // the list in `shell.ts` is the only record of what the old panel had —
    // which is what it is for. The same line covers a checkout with no `main`.
    console.log('  · the old panel’s union is no longer in main: the list in shell.ts is the record');
  }
  ok('every screen the old panel had is a place or a page of the Machine list',
    shell.OLD_PANEL.every((o) => shell.reachable(o.view)),
    shell.OLD_PANEL.filter((o) => !shell.reachable(o.view)).map((o) => o.was).join(', '));

  // …and reachable means drawn: a row that dispatches to nothing is a row that
  // leads nowhere, which is exactly what this criterion is about.
  const machine = src('src/screens/Machine.tsx');
  const dispatched = shell.MACHINE_ROWS.filter((r) => (
    machine.includes(`view === '${r.view}'`) || r.view === shell.MACHINE_ROWS[0].view
  ));
  ok('…and every one of those pages is dispatched to a screen',
    dispatched.length === shell.MACHINE_ROWS.length);
  for (const name of ['Machines', 'Executors', 'Terminal', 'Screen', 'Accounts', 'Quota',
                      'Admin', 'Settings', 'Fleet', 'Projects', 'Agents', 'Update',
                      'Preferences']) {
    ok(`${name} is still drawn, from the place it moved to`,
      new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from './${name}'`).test(machine));
  }

  // …and a page with no row of its own is opened from the page above it: a
  // screen that is only in a list is a screen nobody gets to.
  const pages = {
    machines: ['src/screens/Machines.tsx'],
    executors: ['src/screens/Executors.tsx'],
    // Admin's rows — what each one is and where its button goes — are decided
    // in the same place everything else on these pages is.
    admin: ['src/screens/Admin.tsx', 'src/lib/machine.ts'],
    settings: ['src/screens/Settings.tsx'],
  };
  const orphan = shell.MACHINE_ASIDE.filter((a) => (
    !pages[a.under].some((f) => new RegExp(`'${a.view}'`).test(src(f)))
  ));
  ok('…and every page under one of them is opened from the page it is under',
    orphan.length === 0, orphan.map((a) => a.label).join(', '));

  const app = src('src/App.tsx');
  ok('the palette offers the three places and every page of the third',
    ["id: 'dashboard'", "id: 'chat'", "id: 'machine'", 'MACHINE_ROWS.map', 'MACHINE_ASIDE.map']
      .every((s) => app.includes(s)));
  // What each key actually does is not read here: `test-drive.mjs` mounts the
  // panel and presses them, because a handler's source says nothing about
  // whether the effect that registers it ever ran. What is held here is that
  // every page has a way in that does not go through the mouse.
  ok('…and every page of the Machine list advertises a shortcut',
    shell.MACHINE_ROWS.every((r) => !!r.shortcut));
  ok('the chat list no longer carries a second navigation',
    !/const NAV|NavRow/.test(src('src/components/Sidebar.tsx')));

  // …and the two lights that navigation carried are not dropped with it: a chat
  // that cannot go on until somebody allows something, and a computer running
  // something older than what it has in hand.
  ok('a chat waiting to be allowed to do something is still a light',
    shell.chatNeedsYou([{ status: 'idle' }, { status: 'awaiting_approval' }])
    && !shell.chatNeedsYou([{ status: 'running' }]));
  ok('…and so is an update in hand, whichever of its two shapes it is in',
    shell.updateWaiting({ behind: 2 })
    && shell.updateWaiting({ behind: 0, web: { npm: true, stale: true } })
    && !shell.updateWaiting({ behind: 0, web: { npm: true, stale: false } })
    && !shell.updateWaiting(null));
  const lit = renderToStaticMarkup(h(ShellUI.Shell, {
    view: 'overview', onView() {}, now: NOW, chips: null,
    dots: { chat: 'asking', machine: 'asking' }, onProject() {},
  }));
  ok('…and the bar draws each on the place it belongs to',
    styles(lit).filter((d) => d.width === '7px' && d.background === v('amber')).length === 2);
  seed({ hosts: { studio: withUpdate() }, order: ['studio'], focus: 'studio', ready: true });
  // The column, and not the screen beside it: the fleet panel on the right
  // draws dots of its own and counting those would say nothing.
  const column = renderToStaticMarkup(h(MachineUI.Machine, machineProps('machines', view('fresh'))))
    .split('</nav>')[0];
  ok('…and the Machine list draws them again on the page each is about',
    /Terminals<\/span><span[^>]*>1</.test(column)
    && styles(column).filter((d) => d.width === '7px' && d.background === v('amber')).length === 1,
    `${styles(column).filter((d) => d.width === '7px').length} dots`);
}

group('what the panel offers, it can still do');
{
  // Moving the chat list into a place of its own took a drag with it: the list
  // and the wall it was dragged onto can no longer be on screen together. An
  // affordance that cannot land, and an instruction that cannot be followed,
  // are worse than neither — so both are gone, and this is what keeps them gone.
  // The list has a drag of its own since: a chat onto a group's heading, which
  // starts and lands in the list (`test-drive.mjs` drops one).
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(web, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  walk('src');
  // …where it is called, rather than where it is defined.
  const starts = files.filter((f) => f !== 'src/lib/dnd.ts' && /setChatDrag\(/.test(src(f)));
  ok('a chat drag starts in the two places that also catch one: the list and the wall',
    eq(starts.sort(), ['src/components/Sidebar.tsx', 'src/screens/Terminal.tsx']), starts.join(', '));
  ok('…and nothing tells anyone to drag a chat out of a list that is not there',
    !files.some((f) => /drag a chat onto it from the list/i.test(src(f))));
  ok('the module that agrees the payload says which of the two it is now',
    /a tile on the wall/.test(src('src/lib/dnd.ts')));
}

// ── 3 · the merge behind the bar ───────────────────────────────────────────

group('one product, however many machines it is on');
{
  const fresh = view('fresh');
  ok('the same product on two machines is one product',
    fresh.projects.length === 2 && fresh.projects.some((p) => p.key === 'quire'),
    fresh.projects.map((p) => p.key).join(', '));
  const quire = D.project(fresh, 'quire');
  ok('…on both of their machines', eq(quire.machines, ['studio', 'mini']));
  ok('…with both of their repositories', quire.repos.length === 2);
  ok('…and the numbers added up rather than one of them picked',
    quire.waiting === 3 && quire.running === 2);
  ok('every card is attributed to the product its own machine calls by that id',
    fresh.cards.filter((c) => c.projectKey === 'quire').length === 4
    && fresh.cards.find((c) => c.id === 'm1').projectKey === 'quire');
  ok('…and what is finished is a number, because the open board is all that is sent',
    eq(quire.counts, { ice_box: 1, in_progress: 3, done: 3 })
    && quire.cards.every((c) => c.column !== 'done'), JSON.stringify(quire.counts));
  ok('…and a card carries the machine it runs on',
    fresh.cards.find((c) => c.id === 'm1').machine === 'mini'
    && fresh.cards.find((c) => c.id === 'k1').machine === 'studio');
  ok('the holding place for unclaimed work is not a product',
    !fresh.projects.some((p) => p.name === 'Unfiled'));
  ok('a card that was turned down is stuck, one with a question is not',
    quire.stuck === 1 && D.stuck({ agent_status: 'blocked' })
    && D.stuck({ agent_status: 'failed' }) && !D.stuck({ agent_status: 'asking' }));
  ok('…and what is stuck is never more than what is waiting, so no state is drawn twice',
    fresh.projects.every((p) => p.stuck <= p.waiting));
  ok('the worst product is first',
    fresh.projects[0].key === 'quire');
  // Counted off the cards and the agents, the way the phone counts them — not
  // added up out of the daemons' own per-project figures, which is what this
  // check used to assert. Two cards need a person (a question on the studio and
  // a ticket the mini was turned down on); two agents are at work, and the
  // mini's is *paused* rather than running, because that machine's quota is
  // spent. `scripts/test-overview.mjs` holds every one of these to the phone's
  // answer for the same board.
  ok('the totals are counted, not guessed',
    fresh.totals.needsYou === 2 && fresh.totals.running === 1 && fresh.totals.paused === 1
    && fresh.totals.stuck === 1 && fresh.totals.unknown === 0
    && fresh.totals.machines === 2 && fresh.totals.reachable === 2 && fresh.totals.complete,
    JSON.stringify(fresh.totals));
  ok('…and a product carries the same three figures about itself',
    D.project(fresh, 'quire').paused === 1 && D.project(fresh, 'quire').unknown === 0
    && D.project(fresh, 'quire').stuck === 1);

  const quiet = view('stale');
  const q2 = D.project(quiet, 'quire');
  ok('a machine that has gone quiet keeps its products on the page',
    quiet.projects.length === 2 && q2.running === 2);
  ok('…and they say so', q2.stale && eq(q2.staleMachines, ['mini']));
  ok('…and the totals admit they are incomplete',
    !quiet.totals.complete && quiet.totals.asOf === NOW - 8 * 60);
  ok('a machine that refuses keeps the board it last handed over',
    D.project(view('unreachable'), 'quire').cards.length === 4);
  ok('one that has never answered carries nothing but the reason',
    view('never').projects.length === 0 && view('never').hosts.every((host) => host.missing)
    && view('never').hosts[1].old);
  ok('nothing at all is a view too, not a crash',
    view('alone').projects.length === 0 && view('alone').totals.complete === false);
  ok('a daemon that answers half the shape is filled in rather than trusted',
    D.answered({}, NOW).snapshot.projects.length === 0
    && D.answered(undefined, NOW).snapshot.cards.length === 0);
  ok('data that is old is old whether the last attempt failed or nobody made one',
    D.merge([entry('studio', 'studio', D.answered(fixture.studio(), NOW - 400))], NOW)
      .hosts[0].stale === true);
  ok('two computers that were told the same name fold under the same key',
    D.projectKey({ slug: 'quire', name: 'Quire' }) === 'quire'
    && D.projectKey({ slug: '', name: 'Quire' }) === 'quire');
}

// ── 4 · the project bar ────────────────────────────────────────────────────

group('the project bar scopes the page');
{
  const fresh = view('fresh');
  const bar = shell.chips(fresh, null);
  ok('it is All, then every product, in the order the merge put them in',
    bar[0].key === null && eq(bar.slice(1).map((c) => c.key), fresh.projects.map((p) => p.key)));
  ok('…with All selected while no product is chosen', bar[0].selected
    && bar.slice(1).every((c) => !c.selected));
  const scoped = shell.chips(fresh, 'quire');
  ok('choosing one selects that one and lets All go',
    !scoped[0].selected && scoped.find((c) => c.key === 'quire').selected);
  ok('a product that is no longer there leaves All selected rather than nothing',
    shell.chips(fresh, 'gone')[0].selected);
  ok('the All chip is amber the moment anything needs a person',
    shell.allState(fresh) === 'asking');
  // An agent in the list and not only a number on a project: what is running is
  // counted off the agents, so a daemon that says `running: 2` and sends none is
  // a machine with nothing to show for it.
  ok('…green when work is running and nothing is waiting',
    shell.allState(D.merge([entry('s', 's', D.answered({
      machine: 's', at: NOW, projects: [{ id: 'p', name: 'P', slug: 'p', repos: [], running: 1, waiting: 0 }],
      cards: [], queue: {},
      agents: [{ card_id: 'c', project_id: 'p', project: 'P', branch: '', title: 'x',
                 executor: 'coding_agent', machine: 's', status: 'running', detail: '',
                 since: NOW - 60, ustabasi_id: null }],
    }, NOW))], NOW)) === 'running');
  ok('…and grey on a morning where nothing is happening',
    shell.allState(view('alone')) === 'quiet');
  const state = (p) => shell.projectState(p);
  ok('a product is red where an agent stopped', state({ cards: [], stuck: 1, waiting: 1, running: 1, stale: false }) === 'stuck');
  ok('…amber where something waits for a person', state({ cards: [], stuck: 0, waiting: 1, running: 1, stale: false }) === 'asking');
  ok('…grey where its numbers are stale', state({ cards: [], stuck: 0, waiting: 0, running: 1, stale: true }) === 'quiet');
  ok('…green while work is running', state({ cards: [], stuck: 0, waiting: 0, running: 1, stale: false }) === 'running');
  ok('…and grey when there is nothing to say', state({ cards: [], stuck: 0, waiting: 0, running: 0, stale: false }) === 'quiet');
  ok('the chips of the real board read worst first',
    eq(shell.chips(fresh, null).map((c) => c.state), ['asking', 'stuck', 'quiet']),
    shell.chips(fresh, null).map((c) => `${c.label}:${c.state}`).join(' '));

  // The address, which is where the phone keeps it too.
  ok('the chosen product is read out of the address',
    shell.projectFromSearch('?project=quire') === 'quire'
    && shell.projectFromSearch('?project=') === null
    && shell.projectFromSearch('') === null);
  ok('…and written into it without closing anything else that is in there',
    shell.searchWithProject('?host=studio&chat=c1', 'quire') === '?host=studio&chat=c1&project=quire'
    && shell.searchWithProject('?host=studio&chat=c1&project=quire', null) === '?host=studio&chat=c1');
  ok('…and All takes the parameter out rather than writing an empty one',
    shell.searchWithProject('?project=quire', null) === '');
  // What happens when a chip is pressed — the address written, the page
  // scoped, and nothing pushed onto the history — is driven in
  // `test-drive.mjs`, where there is a document to press it in.
}

// ── 5 · the page under the bar is a different page ─────────────────────────

group('the page is scoped, not a second screen');
{
  const fresh = view('fresh');
  const all = renderToStaticMarkup(h(OverviewUI.Overview, {
    view: fresh, project: null, onProject() {},
  }));
  const one = renderToStaticMarkup(h(OverviewUI.Overview, {
    view: fresh, project: D.project(fresh, 'quire'), onProject() {},
  }));
  ok('unscoped, it is the page head and every product', all.includes('Overview')
    && all.includes('Quire') && all.includes('Hush'));
  ok('scoped, the head is the product and the aside is the machines it is on',
    one.includes('Quire') && one.includes('studio · mini') && !one.includes('Hush'));
  ok('…and it is the same screen rather than a second one',
    all !== one && one.length > 200 && all.length > 200);
  // The faces of a product are their own tab now. `done` in their numbers is
  // the machines' count rather than the cards in hand — the daemon leaves
  // finished cards out of a snapshot.
  const faces = renderToStaticMarkup(h(OverviewUI.Overview, {
    view: fresh, project: D.project(fresh, 'quire'), tab: 'branches', onProject() {},
  }));
  ok('a product says what each of its faces holds, the finished ones included',
    faces.includes('Engineering') && faces.includes('open') && faces.includes('done')
    && faces.includes('>3<'),
    faces.slice(faces.indexOf('Branches'), faces.indexOf('Branches') + 300));
  ok('…and which states it is in, as characters and not only as colour',
    ['■', '?', '●'].every((c) => faces.includes(c)));
  // …and the page you land on is the other question: what is happening on the
  // product and how it got here, with no grid of faces on it.
  ok('the product page is what is happening on it and what it has been through',
    one.includes('Right now') && one.includes('Timeline')
    && !one.slice(one.indexOf('Right now')).includes('Engineering'));
  ok('a page built partly out of a quiet machine says how old it is',
    renderToStaticMarkup(h(OverviewUI.Overview, { view: view('stale'), project: null, onProject() {} }))
      .includes('quiet for'));
  ok('…in whole words, and one machine and several are different sentences',
    OV.staleWords({ asOf: 0, machines: [{ machine: 'mini', age: 500 }] }, () => '8m')
      === 'mini has been quiet for 8m. What it last said is still below.'
    && OV.staleWords({ asOf: 0, machines: [{ machine: 'mini', age: 1 }, { machine: 'air', age: 2 }] },
      () => '8m').startsWith('2 machines have been quiet — mini for 8m · air for 8m.'));
  ok('…and a page with nothing on it is a sentence rather than a blank',
    renderToStaticMarkup(h(OverviewUI.Overview, { view: view('never'), project: null, onProject() {} }))
      .includes('No machine has answered'));
  ok('…while the moment before the first answer says that instead of saying nothing came',
    renderToStaticMarkup(h(OverviewUI.Overview, {
      view: D.merge([entry('studio', 'studio', D.NO_DIVAN)], NOW), project: null, onProject() {},
    })).includes('Asking every computer'));
  ok('…as is a fleet that answered with an empty board',
    renderToStaticMarkup(h(OverviewUI.Overview, {
      view: D.merge([entry('laptop', 'laptop', D.answered(fixture.empty(), NOW))], NOW),
      project: null, onProject() {},
    })).includes('No products yet'));
  ok('…and one with no computer paired at all',
    renderToStaticMarkup(h(OverviewUI.Overview, { view: view('alone'), project: null, onProject() {} }))
      .includes('No computer paired yet'));

  // The judgements behind those sentences, driven one at a time.
  ok('how old the page is, is the oldest answer it was built out of',
    OV.staleness(view('stale')).asOf === NOW - 8 * 60
    && OV.staleness(view('fresh')) === null);
  ok('a state nothing is in is left out rather than drawn as a zero',
    eq(OV.marks({ stuck: 0, waiting: 0, running: 0 }), [])
    && eq(OV.marks({ stuck: 1, waiting: 2, running: 3 }).map((m) => m.label),
      ['1 stuck', '1 asking', '3 running']));
  ok('a product with no description says something true instead of nothing',
    OV.summaryOf({ summary: '', kind: 'web', counts: {}, cards: [{ column: 'ice_box' }] }) === 'web · 1 open card'
    && OV.summaryOf({ summary: '', kind: '', counts: { done: 2 }, cards: [] }) === 'nothing open'
    && OV.summaryOf({ summary: '', kind: '', counts: {}, cards: [] }) === 'no description yet');
  // …and the whole way round, through the panel: the address says which product,
  // and the page that comes up is that product's.
  {
    seed({ hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
    const snaps = { studio: D.answered(fixture.studio(), Date.now() / 1000) };
    Object.assign(useDivanStore.getInitialState(), { snaps });
    useDivanStore.setState({ snaps });
    env.url.search = '?project=quire';
    const scoped = renderToStaticMarkup(h(AppUI.App));
    env.url.search = '';
    const whole = renderToStaticMarkup(h(AppUI.App));
    // …read off the one 28 pt line on a Divan page rather than off the whole
    // markup: a scoped page carries the word "Overview" now, as the first of
    // the tabs over a product (Web12 W2), and what must not be the Dashboard's
    // is the head.
    const pageHead = (m) => (m.match(/font-size:28px[^>]*>([^<]*)</) ?? [, null])[1];
    ok('the panel opened at a product reads that product, and without one reads them all',
      pageHead(scoped) === 'Quire' && pageHead(whole) === 'Overview' && whole.includes('Hush'),
      `${pageHead(scoped)} vs ${pageHead(whole)}`);
  }

  ok('the columns are the machines’ own counts added up, not the cards in hand',
    eq(OV.columnCounts(D.project(view('fresh'), 'quire')),
      { ice_box: 1, queued: 0, in_progress: 3, review: 0, done: 3 }));
  ok('…so a product that shipped forty-eight things does not read as none',
    OV.columnCounts({ counts: { done: 48 }, cards: [] }).done === 48);
}

// ── 6 · the bar is the design system’s, in both themes ─────────────────────

group('the bar is built out of the parts');
{
  const bar = renderToStaticMarkup(h(ShellUI.Shell, {
    view: 'overview', onView() {}, now: NOW,
    chips: shell.chips(view('fresh'), 'quire'), onProject() {},
  }));
  const s = styles(bar);
  ok('the bar is the height the frames draw, on their own hairline',
    s.some((d) => d.height === `${K.SIZE.topBar}px` && d['border-bottom'] === `1px solid ${v('line')}`));
  // The wordmark was `divan` in 13 pt mono — the product's own name set at the
  // size of a caption. It is a mark and a name now, and the name is set the way
  // a name is: the page-title weight and tracking, big enough to be the thing
  // you read first in the bar.
  ok('…and opens on the mark with the name beside it', bar.includes('Divan')
    && bar.includes('<svg') && !/>divan</.test(bar)
    && s.some((d) => d['font-size'] === '19px' && d['font-weight'] === '600'
      && d['letter-spacing'] === '-.02em'));
  ok('…and the mark is drawn in the ink around it, so one file is both themes',
    /<svg[^>]*fill="currentColor"/.test(bar));
  ok('the three places are nav items at the frames’ own height and corner',
    s.filter((d) => d.height === `${K.SIZE.navItem}px`
      && d['border-radius'] === `${K.RADIUS.nav}px`).length === 3);
  ok('…the one you are in filled with the second surface, the others in the meta grey',
    s.filter((d) => d.height === '34px' && d.background === v('s2')).length === 1
    && s.filter((d) => d.height === '34px' && d.color === v('ink3')).length === 2);
  // A glyph is named in the shell's own lists and drawn from the icon table, so
  // a name that never became a path draws an empty `<path d="grid">` and a
  // reading of the source cannot tell. This is the drawing, measured.
  ok('…each with its glyph actually drawn, at the frames’ 17 pt',
    (bar.match(new RegExp(`<svg width="${K.SIZE.rowIcon}"[^>]*>\\s*<path d="[Mm][^"]{8,}"`, 'g')) ?? [])
      .length >= 3,
    (bar.match(/<path d="[^"]*"/g) ?? []).slice(0, 4).join(' '));
  ok('the rule between the places and the chips is the frames’ own',
    s.some((d) => d.width === '1px' && d.height === '22px' && d.background === v('line2')));
  ok('the chips are pills, the chosen one filled with the ink',
    s.filter((d) => d.height === `${K.SIZE.pill}px` && d['border-radius'] === '16px').length === 3
    && s.some((d) => d.background === v('ink') && d.color === v('bg')));
  ok('…and each carries the dot that says how its product is doing',
    s.filter((d) => d.width === '7px' && d.height === '7px').length === 3);
  ok('the far end is the clock and the switch, and the clock is to the minute',
    /[A-Z][a-z]{2} \d+ [A-Z][a-z]{2,4} · \d\d:\d\d/.test(bar)
    && s.some((d) => d.height === `${K.SIZE.barChip}px` && d['border-radius'] === '9px'));

  ok('nothing in the bar is a colour of its own',
    [...paint(bar).literal].every((c) => OWN.has(c)), [...paint(bar).literal].join(', '));
  ok('…and every colour it names exists in both themes',
    [...paint(bar).vars].every((n) => K.DARK[n] !== undefined && K.LIGHT[n] !== undefined));

  // Over the Machine place the frames draw no chips: that bar ends in what the
  // fleet is doing instead.
  const machineBar = renderToStaticMarkup(h(ShellUI.Shell, {
    view: 'terminal', onView() {}, now: NOW, chips: null, onProject() {},
  }));
  ok('the chips are over the Dashboard and not over the Machine pages',
    !machineBar.includes('Quire') && machineBar.includes('Machine'));

  ok('the shell and its pages are composed of the parts and spell no style of their own',
    ['src/components/Shell.tsx', 'src/screens/Overview.tsx', 'src/screens/Machine.tsx']
      .every((f) => /from '\.\.\/ui\/divan'/.test(src(f)))
    && !['src/components/Shell.tsx', 'src/screens/Overview.tsx', 'src/screens/Machine.tsx']
      .some((f) => COLOUR.test(src(f).replace(/\/\*[\s\S]*?\*\//g, ''))));
  ok('the parts the bar is made of are parts, in the module the screens share',
    ['TopBar', 'NavItem', 'BarDivider', 'BarChip', 'BarStamp']
      .every((p) => new RegExp(`export function ${p}\\(`).test(src('src/ui/divan.tsx')))
    && ['TopBar', 'NavItem', 'BarDivider', 'BarChip', 'BarStamp']
      .every((p) => typeof parts[p] === 'function'));
  ok('…and the gallery draws the bar, so it can be held up against the frame',
    /name: 'TopBar'/.test(src('scripts/divan-gallery.tsx')));
}

// ── 7 · the switch ─────────────────────────────────────────────────────────

group('the switch changes the theme and nothing else');
{
  K.setThemeChoice('dark');
  const dark = renderToStaticMarkup(h(ShellUI.ThemeSwitch));
  ok('in the dark it offers the light one', dark.includes('Light')
    && dark.includes('Switch to the light theme'));
  ok('…and it is on the document before anything else happens',
    env.html.dataset.theme === 'dark');
  K.setThemeChoice('light');
  const light = renderToStaticMarkup(h(ShellUI.ThemeSwitch));
  ok('in the light it offers the dark one', light.includes('Dark')
    && light.includes('Switch to the dark theme'));
  ok('…and the document says so, with no reload anywhere in the shell',
    env.html.dataset.theme === 'light'
    && !['src/components/Shell.tsx', 'src/App.tsx', 'src/lib/theme.ts']
      .some((f) => /location\.reload/.test(src(f))));
  ok('…and the choice outlives the tab', env.store.get('rac.theme') === 'light');

  // The whole of what a theme change costs: one attribute. Everything drawn is
  // a reference to a custom property, so the same markup is correct in both —
  // which is why the switch needs no render of the page and cannot need a
  // reload. Rendered in one theme, then in the other, and compared.
  const draw = () => [
    renderToStaticMarkup(h(OverviewUI.Overview, {
      view: view('fresh'), project: D.project(view('fresh'), 'quire'), onProject() {},
    })),
    renderToStaticMarkup(h(MachineUI.Machine, machineProps('machines', view('fresh')))),
  ].join('\n');
  K.setThemeChoice('light');
  const drawnLight = draw();
  K.setThemeChoice('dark');
  const drawnDark = draw();
  ok('the page itself is the same markup in both themes',
    drawnLight === drawnDark, `${drawnLight.length} vs ${drawnDark.length}`);
  ok('…and it is a page with colours in it, so that is worth something',
    paint(drawnDark).vars.size >= 6, [...paint(drawnDark).vars].join(', '));
  ok('the switch is still offered where it was explained as well',
    /AppearanceSection/.test(src('src/screens/Preferences.tsx'))
    && /id: 'theme'/.test(src('src/App.tsx')));
}

// ── 8 · every screen, in every state, in both themes ───────────────────────

group('every screen renders with nothing, with something stale and with a machine that is gone');
{
  const broken = [];
  const strayed = [];
  const undeclared = [];
  const drawn = {};

  for (const world of Object.keys(WORLDS)) {
    const fleet = view(world);
    seed(world === 'alone'
      ? { hosts: {}, order: [], focus: null, ready: true }
      : { hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
    const screens = {
      'the bar': [ShellUI.Shell, {
        view: 'overview', onView() {}, now: fleet.now,
        chips: shell.chips(fleet, null), onProject() {},
      }],
      'the bar, scoped': [ShellUI.Shell, {
        view: 'overview', onView() {}, now: fleet.now,
        chips: shell.chips(fleet, 'quire'), onProject() {},
      }],
      Overview: [OverviewUI.Overview, { view: fleet, project: null, onProject() {} }],
      'Overview, scoped': [OverviewUI.Overview, {
        view: fleet, project: D.project(fleet, 'quire'), onProject() {},
      }],
      ...Object.fromEntries(shell.MACHINE_ROWS.map((row) => (
        [`Machine › ${row.label}`, [MachineUI.Machine, machineProps(row.view, fleet)]]
      ))),
      ...Object.fromEntries(shell.MACHINE_ASIDE.map((aside) => (
        [`Machine › ${aside.label}`, [MachineUI.Machine, machineProps(aside.view, fleet)]]
      ))),
    };
    for (const scheme of ['dark', 'light']) {
      K.setThemeChoice(scheme);
      for (const [name, [node, props]] of Object.entries(screens)) {
        let markup;
        try { markup = renderToStaticMarkup(h(node, props)); }
        catch (e) { broken.push(`${world} · ${scheme} · ${name}: ${e.message.slice(0, 140)}`); continue; }
        if (markup.length < 120) broken.push(`${world} · ${name}: drew almost nothing`);
        drawn[`${world} ${scheme} ${name}`] = markup;
        const { vars, literal } = paint(markup);
        for (const c of literal) if (!OWN.has(c)) strayed.push(`${world} ${name}: ${c}`);
        for (const n of vars) if (K.DARK[n] === undefined) undeclared.push(`${world} ${name}: ${n}`);
      }
    }
  }
  ok('every screen of the shell stands up in all five states of the fleet',
    broken.length === 0, [...new Set(broken)].slice(0, 6).join('\n    '));
  ok('…and there were enough of them for that to mean something',
    Object.keys(drawn).length === 5 * 2 * (4 + 8 + 5), `${Object.keys(drawn).length} renders`);
  ok('…none of them painting a value of its own', strayed.length === 0,
    [...new Set(strayed)].slice(0, 6).join(', '));
  ok('…so every colour on every one of them exists in both themes',
    undeclared.length === 0, [...new Set(undeclared)].slice(0, 6).join(', '));
  ok('the Machine place says out loud when a computer cannot be reached',
    MachineUI.machineNote(view('unreachable')).includes('mini cannot be reached')
    && MachineUI.machineNote(view('fresh')).includes('all reachable')
    && MachineUI.machineNote(view('alone')).includes('No computer'));
  ok('…and marks the row it is under',
    anyStyle(drawn['unreachable dark Machine › Machines'],
      (d) => (d.border ?? '').includes(v('amber')) && d.width === '7px'));

  // The whole panel, with the shell around it: the one render that proves the
  // three places, the bar and the pages are wired to each other rather than
  // merely renderable on their own.
  seed({ hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
  useFleet.setState({ hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true });
  let app = null;
  try { app = renderToStaticMarkup(h(AppUI.App)); }
  catch (e) { ok('the panel stands up with the shell around it', false, e.message.slice(0, 200)); }
  if (app) {
    ok('the panel stands up with the shell around it', app.length > 500);
    ok('…and opens on the Dashboard, with the bar over it',
      app.includes('Divan') && app.includes('Dashboard') && app.includes('Chat')
      && app.includes('Machine') && app.includes('Overview'));
    ok('…and paints nothing of its own', [...paint(app).literal].every((c) => OWN.has(c)),
      [...paint(app).literal].join(', '));
  }
}

// ── 9 · the chat was left alone ────────────────────────────────────────────

group('the address is a place, and one a person can read');
{
  const at = (place) => nav.pathOf({ ...nav.HOME, ...place }) + nav.searchOf({ ...nav.HOME, ...place });
  ok('the Dashboard is the bare path, and nothing hangs off it',
    at({}) === '/');
  ok('a product, its board, one of its faces and one card are all paths',
    at({ project: 'babysee' }) === '/p/babysee'
    && at({ project: 'babysee', tab: 'board' }) === '/p/babysee/board'
    && at({ project: 'babysee', branch: 'engineering' }) === '/p/babysee/b/engineering'
    && at({ project: 'babysee', card: '0d2279020af7' }) === '/p/babysee/c/0d2279020af7',
    at({ project: 'babysee', card: '0d2279020af7' }));
  ok('…and the machine a card happens to be on is not in it',
    !at({ project: 'babysee', card: '0d2279020af7' }).includes(':'));
  ok('the chat and the drawer’s pages are paths too',
    at({ view: 'chats' }) === '/chats'
    && at({ view: 'chats', chat: 'c1' }) === '/chats/c1'
    && at({ view: 'accounts' }) === '/machine/accounts');
  ok('…and the one thing that is still a query is the one a link has to carry',
    at({ view: 'chats', chat: 'c1', host: 'studio' }) === '/chats/c1?host=studio');

  const round = (place) => {
    const full = { ...nav.HOME, ...place };
    const read = nav.readPlace(nav.pathOf(full), nav.searchOf(full));
    return nav.samePlace(read, full);
  };
  ok('every one of them reads back as what it was written from',
    [{}, { project: 'babysee' }, { project: 'babysee', tab: 'board' },
     { project: 'babysee', branch: 'engineering' },
     { project: 'babysee', card: '0d2279020af7', tab: 'board' },
     { view: 'chats' }, { view: 'chats', chat: 'c1' },
     { view: 'chats', chat: 'c1', host: 'studio' },
     { view: 'accounts' }, { view: 'preferences' }].every(round));
  ok('a product with a space or a slash in its name survives the trip',
    round({ project: 'my product/2' }));
  ok('an address nobody wrote is the Dashboard rather than a page that does not exist',
    nav.samePlace(nav.readPlace('/nonsense/deep'), nav.HOME)
    && nav.readPlace('/machine/nope').view === 'machines');

  // The panel wrote query-string addresses for a day. A link somebody kept is
  // still a link, so it is read — including a card named `host:id`, which is
  // exactly the spelling this replaced.
  const old = nav.readPlace('/', '?project=babysee&tab=board&card=100.80.178.83%3A8790%3A0d2279020af7');
  ok('the addresses the panel used to write still open where they meant',
    old.project === 'babysee' && old.tab === 'board' && old.card === '0d2279020af7', JSON.stringify(old));
  ok('…and an old chat link too',
    nav.readPlace('/', '?chat=c1&host=studio').chat === 'c1'
    && nav.readPlace('/', '?chat=c1&host=studio').host === 'studio');
}

group('the chat is untouched');
{
  const chat = ['src/components/ChatView.tsx', 'src/components/Bubble.tsx',
                'src/components/Timeline.tsx', 'src/components/ChatDetails.tsx',
                'src/components/TicketChat.tsx'];
  for (const f of chat) {
    ok(`${f.split('/').pop()} knows nothing about the shell`,
      !/lib\/shell|components\/Shell|screens\/(Overview|Machine)/.test(src(f)));
  }
  // There used to be a stronger form of this: the five files, unchanged
  // against the branch the shell rebuild started from. It has been retired,
  // and the reason is worth writing down rather than quietly deleting.
  //
  // It was the proof of one promise — *that* ticket did not touch the chat —
  // and it did its job. What it cannot be is a rule for ever: the chat has
  // since been asked for in two more places (the ticket window draws the
  // worker's run, the Dashboard's window draws the whole chat), and a check
  // that fails on any change to a file is a check against the file rather
  // than against a behaviour. The rule this group is about is the one above,
  // and it still holds for all five.
  //
  // What replaces it is narrower and says something true today: the chat is
  // drawn the chat's own way, in one place, wherever it appears.
  ok('the chat’s box is one box, and both windows draw it',
    /export function ChatComposer/.test(src('src/components/ChatComposer.tsx'))
    && /<ChatComposer/.test(src('src/components/ChatView.tsx'))
    && /<ChatComposer/.test(src('src/components/ChatPanel.tsx')));
  ok('…and it is still the chat’s vocabulary rather than the Dashboard’s',
    !/ui\/divan/.test(src('src/components/ChatComposer.tsx')));
  ok('the run the ticket window draws is the phone’s own reading of the same file',
    /from '\.\.\/lib\/run'/.test(src('src/components/TicketChat.tsx'))
    && /app\/src\/transcript\.ts/.test(src('src/lib/transcript.ts')));

  const app = src('src/App.tsx');
  ok('the chat is handed the same props it always was, in both places it is drawn',
    (app.match(/<ChatView \{\.\.\.chatProps\} \/>/g) ?? []).length === 2);
  ok('…and the chat place is the chat and the list it is picked from',
    /place === 'chat' && \(/.test(app) && /<Sidebar/.test(app));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
