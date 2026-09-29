/** Divan's three places, checked without a phone.
 *
 *  The app used to be shaped like the computer it was holding a socket to:
 *  a picker at the top said which machine you were looking at, the tabs under
 *  it were that machine's chats and that machine's agents, and its ticket wall
 *  was a button in the corner. This is the check that it is now shaped like the
 *  work instead — Dashboard, Chat, Machine — and that nothing was dropped on
 *  the way.
 *
 *  Two kinds of question are asked here. The ones with one right answer are
 *  asked of `src/shell.ts` directly: which place a route is in, what the
 *  project bar says, which conversation the Chat place opens. The ones about
 *  wiring — is a place registered, does a screen stand in the shell, is the
 *  computer picker really gone from the top level — are asked of the sources,
 *  the way `test-ustabasi.cjs` asks them of the wall. And the tab bar itself is
 *  stood up for real through `render-divan.cjs`, because "three places, in this
 *  order, with the one you are in lit" is a claim about what comes out.
 *
 *  Run: node scripts/test-shell.cjs  (also folded into test-ustabasi.cjs, so
 *  one command covers everything.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const has = (file) => fs.existsSync(path.join(root, file));
const h = R.React.createElement;

// `render-divan` has already put TypeScript and the React Native stubs in front
// of `require`, so these are the app's own modules rather than copies of them.
const S = require(path.join(root, 'src/shell.ts'));
const D = require(path.join(root, 'src/divan.ts'));
const shell = require(path.join(root, 'src/components/shell.tsx'));
const icons = require(path.join(root, 'src/icons.gen.ts'));

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = [];

// The screen behind each place, by the route the shell sends you to.
const SCREEN = {
  '/dashboard': 'app/dashboard.tsx',
  '/chat': 'app/chat/index.tsx',
  '/machine': 'app/machine.tsx',
};

const layout = src('app/_layout.tsx');
const dash = src('app/dashboard.tsx');
const chatPlace = src('app/chat/index.tsx');
const machine = src('app/machine.tsx');
const conversation = src('app/chat/[id].tsx');
const agents = src('app/agents.tsx');
const hostSheet = src('app/host-sheet.tsx');
const settings = src('app/settings.tsx');
const tap = src('src/tap.ts');

// ── 1 · three places, and they are reachable ────────────────────────────────

checks.push(
  ['the app has three places', eq(S.PLACES, ['dashboard', 'chat', 'machine'])],
  ['…each of them a screen of its own',
    S.PLACES.every((p) => has(SCREEN[S.PLACE_ROUTE[p]]))],
  ['…registered in the stack like every other full screen',
    S.PLACES.every((p) => new RegExp(`<Stack\\.Screen\\s+name="${S.PLACE_ROUTE[p].slice(1)}(/index)?"`)
      .test(layout))],
  // Every screen in the stack is a file and every file is in the stack. The
  // places are three of them, and a name that is not a route is a screen
  // nobody reaches — which is how `chat/index` had to be spelt out rather
  // than guessed at (expo-router names an index file after its folder and the
  // word, and `/chat` is the path it answers on).
  ['what the stack declares and what the app folder holds are the same set',
    (() => {
      const declared = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]).sort();
      const routes = files('app').filter((f) => !/\/_layout\.tsx$/.test(f))
        .map((f) => f.replace(/^app\//, '').replace(/\.tsx?$/, '')).sort();
      return eq(declared, routes);
    })()],
  ['…and standing in the shell rather than each drawing its own tab bar',
    S.PLACES.every((p) => new RegExp(`<Shell place="${p}"`).test(src(SCREEN[S.PLACE_ROUTE[p]])))
    && !/TabBar/.test(dash) && !/TabBar/.test(chatPlace) && !/TabBar/.test(machine)],
  ['every glyph the shell names is one the app has generated',
    [...Object.values(S.PLACE_ICON), ...S.machineRows({ machines: 1, unreachable: 0 }).map((r) => r.icon)]
      .every((name) => Object.keys(icons.ICON_PATHS).some((k) => k.split(':')[0] === name))],
);

// The tab bar, stood up. Mobile1 V1: Dashboard, Chat, Machine, left to right,
// the one you are in sitting in a well of `s2` and the other two in nothing.
for (const place of S.PLACES) {
  const markup = R.render('dark', h(shell.Shell, { place }, null));
  const at = S.PLACES.map((p) => markup.indexOf(S.PLACE_LABEL[p]));
  const wells = R.styles(markup).filter((st) => st.width === 60 && st.height === 32);
  const t = R.theme.tokensFor('dark');
  checks.push(
    [`the tab bar draws all three in the frame's order, from ${place}`,
      at.every((i) => i >= 0) && at[0] < at[1] && at[2] > at[1]],
    [`…with ${place} the one that is lit, and only it`,
      wells.length === 3 && wells.filter((st) => st.backgroundColor === t.s2).length === 1
      && wells[S.PLACES.indexOf(place)].backgroundColor === t.s2],
  );
}
{
  const t = R.theme.tokensFor('dark');
  const amber = (badge) => R.styles(R.render('dark', h(shell.Shell, { place: 'chat', badge }, null)))
    .some((st) => st.backgroundColor === t.amber);
  checks.push(
    ['what needs a person is counted on the Dashboard’s icon', amber(2) === true],
    ['…and nothing is drawn there when nothing does', amber(0) === false],
  );
}

// ── 2 · the app opens on the Dashboard ──────────────────────────────────────

checks.push(
  ['the place the app opens on is the Dashboard',
    S.HOME === S.PLACE_ROUTE.dashboard && S.HOME === '/dashboard'],
  ['…and the first screen redirects there rather than to a chat list',
    /<Redirect href=\{host \? HOME : '\/welcome'\} \/>/.test(src('app/index.tsx'))],
  ['a notification pops the stack back to that same place',
    new RegExp(`follow\\(tap: Tap, nav: Nav, home = '${S.HOME}'\\)`).test(tap)],
  ['nothing anywhere still leads to the chat list, because there is not one',
    !has('app/chats.tsx') && !has('src/components/home.tsx')
    && !files().some((f) => /['"`]\/chats['"`]|router\.replace\('\/chats/.test(src(f)))],
);

/** Every source file of the app, so that "nowhere else" can be asked of all of
 *  them rather than of the handful somebody remembered. */
function files(dir = '') {
  const out = [];
  for (const base of ['app', 'src']) {
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(entry.name)) out.push(next);
      }
    };
    walk(base);
  }
  return dir ? out.filter((f) => f.startsWith(dir)) : out;
}

// ── 3 · the project bar ─────────────────────────────────────────────────────
//
// Four products on two machines: one with a worker that stopped to ask, one
// with a worker that was turned down, one only on a machine that has gone
// quiet, and one nobody has touched in weeks.

const NOW = 1_700_000_000;
const branch = (kind, o = {}) => ({ id: `${kind}-${o.on || 'x'}`, kind, name: kind,
  summary: o.summary || '', summary_at: o.summary_at ?? null, cards: o.cards || {}, open: o.open || 0 });
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), summary: '',
  repos: [], sort: 0, archived: false, created_at: 0, updated_at: o.updated_at || NOW - 60,
  branches: o.branches || [branch('engineering', { on: name })], counts: o.counts || {},
  running: o.running || 0, waiting: o.waiting || 0, summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: 'e', branch: 'engineering', column: o.column || 'in_progress',
  position: 0, title: id, summary: '', executor: o.executor ?? 'coding_agent', machine: null,
  repo: null, ustabasi_id: null, agent_status: o.status ?? null, agent_status_at: null,
  agent_detail: '', created_at: 0, updated_at: 0, moved_at: null,
});
const agent = (id, o = {}) => ({ card_id: id, project_id: o.project, project: o.projectName || '',
  branch: 'engineering', title: id, executor: 'coding_agent', machine: '', status: 'running',
  detail: '', since: null, ustabasi_id: null });
const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: null, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: null, old: false } });

const STUDIO = paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    projects: [project('Quire', { waiting: 1, running: 1 }),
               project('Hush', { waiting: 1 }),
               project('The Long Walk')],
    cards: [card('c1', { project: 'Quire-id', status: 'failed' }),
            card('c2', { project: 'Hush-id', status: 'asking' })],
    agents: [agent('c3', { project: 'Quire-id' })] }),
});
// Quiet for two hours and fourteen minutes: the ordinary case, a laptop with
// the lid shut.
const MINI = paired('h2', 'mini', {
  at: NOW - (2 * 3600 + 14 * 60), reachable: false,
  snapshot: snapshot('mini', { at: NOW - (2 * 3600 + 14 * 60),
    projects: [project('Kanji Daily', { running: 2 })], cards: [], agents: [] }),
});

const view = D.merge([STUDIO, MINI], NOW);
const bar = S.chips(view, null, 'All');
const named = (key) => view.projects.find((p) => p.key === key);

checks.push(
  ['the project bar names All and then every product',
    bar[0].key === null && bar[0].label === 'All'
    && eq(bar.slice(1).map((c) => c.label).sort(), ['Hush', 'Kanji Daily', 'Quire', 'The Long Walk'])],
  ['…and a product on two machines is one chip, not two',
    bar.length === view.projects.length + 1],
  ['nothing selected means All is the one that is lit',
    bar[0].selected && bar.slice(1).every((c) => !c.selected)],
  ['selecting a product lights that one and puts All out',
    (() => { const b = S.chips(view, 'quire', 'All'); return !b[0].selected && b.find((c) => c.key === 'quire').selected; })()],
  ['a product that is no longer there leaves the bar on All',
    S.chips(view, 'a-machine-that-was-unpaired', 'All')[0].selected === true],

  // The dot in front of the name, which is the whole of what a chip says.
  ['a product whose agent was turned down is red', S.projectState(named('quire')) === 'stuck'],
  ['one that stopped to ask is amber', S.projectState(named('hush')) === 'asking'],
  ['one on a machine that has gone quiet is grey, whatever it was running',
    named('kanji-daily').running === 2 && S.projectState(named('kanji-daily')) === 'quiet'],
  ['one nobody has touched is grey too', S.projectState(named('the-long-walk')) === 'quiet'],
  // Mobile1 V1 draws All amber while two of the projects under it are red:
  // "two of these need you" is what that chip is for.
  ['All is amber the moment anything needs a person, red or not',
    view.totals.stuck > 0 && S.allState(view) === 'asking'],
  ['…green when work is running and nothing needs anybody',
    S.allState({ totals: { needsYou: 0, running: 3 } }) === 'running'],
  ['…and grey on a quiet morning', S.allState({ totals: { needsYou: 0, running: 0 } }) === 'quiet'],
);

{
  // The bar as it comes out: the selected chip filled with ink, the rest on the
  // card colour, each with its dot.
  const t = R.theme.tokensFor('dark');
  const markup = R.render('dark', h(shell.ProjectBar, { chips: S.chips(view, 'quire', 'All'), onSelect() {} }));
  const pills = R.styles(markup).filter((st) => st.height === 34);
  const dots = R.styles(markup).filter((st) => st.width === 7 && st.height === 7);
  checks.push(
    ['the bar draws a chip per product, one of them filled',
      pills.length === view.projects.length + 1
      && pills.filter((st) => st.backgroundColor === t.ink).length === 1],
    ['…and every one of them carries its dot', dots.length === pills.length],
    ['…including the red one, so a chip says how its product is doing',
      dots.some((st) => st.backgroundColor === t.red)],
  );
}

checks.push(
  ['the bar belongs to the shell rather than to the Dashboard alone',
    /export function ProjectBar/.test(src('src/components/shell.tsx')) && /<ProjectBar/.test(dash)],
  ['selecting a project enters it: the Dashboard is then that project',
    /onSelect=\{setSelected\}/.test(dash) && /projectIn\(view, selected\)/.test(dash)
    && /picked \? picked\.name/.test(dash)],
);

// ── 4 · everything about a computer is under Machine ────────────────────────

const rows = S.machineRows({ machines: 3, unreachable: 0 });
const routes = rows.map((r) => r.route);

checks.push(
  ['the Machine list holds the screens that were about a computer',
    eq(routes, ['/host-sheet', '/agents', '/screen', '/accounts', '/pool', '/call', '/settings'])],
  ['…in the frame’s shape: a name, a grey line, and a chevron one level deeper',
    rows.every((r) => r.title && r.note) && /ListRow/.test(machine)],
  ['…and the machines row says how many answered',
    rows[0].meta === 'mAllReachable' && rows[0].tone === 'run'
    && S.machineRows({ machines: 3, unreachable: 1 })[0].meta === 'mUnreachable'],
  ['nothing is coloured unless a machine is actually unreachable',
    S.machineRows({ machines: 3, unreachable: 1 })[0].tone === 'red'
    && rows.slice(1).every((r) => !r.tone)],
  ['the Machine screen opens exactly those rows',
    /machineRows\(/.test(machine) && /router\.push\(row\.route\)/.test(machine)],
  ['…and no other place leads to one of them',
    routes.every((route) => !new RegExp(`'${route}'`).test(dash) && !new RegExp(`'${route}'`).test(chatPlace))],
  ['pairing is inside it too, behind the machines it adds one to',
    /'\/pair'|pathname: '\/pair'/.test(hostSheet) && /pathname: '\/pair'/.test(settings)],

  // Moved, not rewritten. Every one of these is a feature the old top level
  // had, asked for where it now lives.
  ['the agents screen kept its grid, its account picker and the store',
    /<AgentCard/.test(agents) && /pickAccount/.test(agents) && /'\/agent-store'/.test(agents)],
  ['…and lost the computer picker and the chats tab that sat over it',
    !/HomeTop/.test(agents) && !/<Tabs /.test(agents) && /<BackBar/.test(agents)],
  ['the computer picker still switches, unpairs, adds and shows a screen',
    /switchHost\(/.test(hostSheet) && /removeHost\(/.test(hostSheet)
    && /'\/screen'/.test(hostSheet) && /'\/pair'/.test(hostSheet)],
  ['Settings still leads to the accounts, the pool and the parts gallery',
    /'\/accounts'/.test(settings) && /'\/pool'/.test(settings) && /\/divan-gallery/.test(settings)],
  ['the ticket wall is work rather than infrastructure, so it is not in here',
    !routes.includes('/ustabasi') && /'\/ustabasi'/.test(dash)],
  ['the old top level is gone: nothing draws the computer picker any more',
    !files().some((f) => /HomeTop/.test(src(f)))],
);

// ── 5 · the chat is one place, entered directly ─────────────────────────────

const chat = (id, o = {}) => ({ id, title: id, updated_at: o.updated_at ?? 0, archived: o.archived ?? 0 });
const store = (...list) => Object.fromEntries(list.map((c) => [c.id, c]));

checks.push(
  ['the conversation is the newest one', S.theChat(store(chat('a', { updated_at: 10 }), chat('b', { updated_at: 20 }))) === 'b'],
  ['an archived one is not it', S.theChat(store(chat('a', { updated_at: 10 }), chat('b', { updated_at: 20, archived: 1 }))) === 'a'],
  ['a phone with none has none to open', S.theChat({}) === null],
  ['the one being read stays the one being read, whatever arrives elsewhere',
    S.theChat(store(chat('a', { updated_at: 10 }), chat('b', { updated_at: 99 })), 'a') === 'a'],
  ['…until it is archived or deleted, and then it is the newest again',
    S.theChat(store(chat('a', { updated_at: 10, archived: 1 }), chat('b', { updated_at: 20 })), 'a') === 'b'
    && S.theChat(store(chat('b', { updated_at: 20 })), 'gone') === 'b'],
  ['two chats saved in the same second do not take turns being the one',
    S.theChat(store(chat('b', { updated_at: 20 }), chat('a', { updated_at: 20 }))) === 'a'],

  ['the Chat place is the conversation itself', /<Conversation id=\{id\}/.test(chatPlace)],
  ['…and a notification about a chat opens the same screen',
    /export function Conversation\(\{ id \}/.test(conversation)
    && /<Conversation id=\{id!\} \/>/.test(conversation)],
  ['…with no thread list in front of it',
    !/SectionList|FlatList|searchChats/.test(chatPlace) && !/\/chat\/\$\{/.test(chatPlace)],
  ['…and no computer picker over it',
    !/host-sheet|HomeTop/.test(chatPlace) && !/host-sheet|HomeTop/.test(conversation)],
  ['a phone with no conversation is given one rather than an empty list',
    /createChat\(/.test(chatPlace)],
  ['the chat screen itself is untouched: it still draws its own everything',
    /KeyboardAvoidingView/.test(conversation) && /LimitsRing/.test(conversation)
    && !/components\/divan/.test(conversation) && !/components\/shell/.test(conversation)],
  ['…and the place gives it back the room the tab bar took, so it is drawn where it was',
    /SafeAreaInsetsContext\.Provider value=\{\{ \.\.\.insets, bottom: 0 \}\}/.test(chatPlace)],
  ['Back out of the conversation leaves for the Dashboard when nothing is under it',
    /if \(router\.canGoBack\(\)\) router\.back\(\); else router\.replace\(HOME\);/.test(conversation)],
);

// ── 5b · the two places that are made of data, standing up ─────────────────
//
// Both of them are drawn out of what the machines answered, and the first state
// either will ever be in is "nothing has answered yet" — which is exactly the
// state that throws if a screen assumes a project, a machine or a queue. So
// they are rendered for real, twice: once against a phone that has heard
// nothing and once against the fixture above.

{
  R.store.reset();
  R.store.set({ hosts: [], divan: {}, loadDivan() {}, conn: 'online', ustabasi: null,
                ustabasiOld: false, loadUstabasi() {} });
  const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
  const Machine = require(path.join(root, 'app/machine.tsx')).default;
  const empty = R.render('dark', h(Dashboard));
  const machineScreen = R.render('light', h(Machine));
  checks.push(
    ['a phone that has heard nothing still draws the Dashboard, and says so',
      empty.includes('dashEmpty') && empty.includes('tabDashboard')],
    ['\u2026with the project bar over it either way', empty.includes('allProjects')],
    ['\u2026and no ticket queue on it, because no computer said it had one',
      !empty.includes('dashQueueNote')],
    ['the Machine list draws every row it names, under the frame\u2019s own two lines',
      machineScreen.includes('mTitle') && machineScreen.includes('mSubtitle')
      && rows.every((r) => machineScreen.includes(r.title))],
  );

  // …and the same two screens against four products on two machines, one of
  // which has been quiet for two hours, with a red ticket in the queue.
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }, { id: 'h2', name: 'mini' }],
    divan: { h1: STUDIO.state, h2: MINI.state },
    ustabasi: { available: true, tickets: [{ status: 'blocked' }, { status: 'running' }] },
  });
  const full = R.render('dark', h(Dashboard));
  const machineFull = R.render('light', h(Machine));
  checks.push(
    ['the Dashboard names every product once the machines have answered',
      ['Quire', 'Hush', 'Kanji Daily', 'The Long Walk'].every((n) => full.includes(n))],
    ['\u2026and carries the queue with the count that needs a person',
      full.includes('dashQueueNote') && full.includes('queueRed')],
    ['\u2026and a machine that has gone quiet is not drawn as a machine that is working',
      full.includes('dashQuiet')],
    ['the Machine list counts the machines it is a list of',
      machineFull.includes('mMachinesNote')],
  );
  R.store.reset();
}

// ── 6 · which place a route is in ───────────────────────────────────────────

checks.push(
  ['a place knows itself', S.PLACES.every((p) => S.placeOf(S.PLACE_ROUTE[p]) === p)],
  ['one conversation by name is still the Chat place', S.placeOf('/chat/abc123') === 'chat'],
  ['a trailing slash or a query does not lose it',
    S.placeOf('/machine/') === 'machine' && S.placeOf('/dashboard?project=quire') === 'dashboard'],
  ['a screen pushed over a place is not one', S.placeOf('/settings') === null && S.placeOf('/ustabasi') === null],
  ['…nor is nothing at all', S.placeOf(null) === null && S.placeOf('') === null],
);

module.exports = { checks };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
