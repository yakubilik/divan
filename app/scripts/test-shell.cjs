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

const PLACES_SRC = Object.values(SCREEN);

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
    [...Object.values(S.PLACE_ICON), ...S.machineRows({ machines: 1, unreachable: 0, executors: 1 }).map((r) => r.icon)]
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
  ['the computer picker the old top level was built around is gone',
    !has('src/components/home.tsx') && !files().some((f) => /HomeTop/.test(src(f)))],
  ['\u2026and nothing enters the app on a list of chats any more',
    !/['"`]\/chats['"`]/.test(src('app/index.tsx'))
    && !PLACES_SRC.some((f) => /replace\(['"`]\/chats['"`]\)/.test(src(f)))],
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

// This moment, not a round number: the Dashboard ages a quiet machine against
// the phone's own clock, and a fixture stamped two years ago would render as
// three machines that have all been silent since.
const NOW = Math.floor(Date.now() / 1000);
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
);

// Selecting a project enters it — pressed rather than read off the source.
// The chip's own handler is called, which is a `router.setParams`, which is
// what puts the project in the address; the screen is then drawn again and
// asked what it is showing.
{
  const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
  /** The words of every `Text` that came out, with the style it came out in. */
  const texts = (markup) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)].map((m) => ({
    style: JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")),
    text: m[2],
  }));
  /** The 26 pt semibold at the top of the page — Mobile1 V1's `Overview`, which
   *  becomes the product's name when one is being read. The 15 pt semibolds
   *  under it are the section headings, and there are several. */
  const title = (markup) => (texts(markup).find((t) => t.style.fontSize === 26
    && t.style.fontFamily === 'Geist-SemiBold') ?? {}).text;

  const machines = () => {
    R.store.reset();
    R.params.reset();
    R.store.set({ hosts: [{ id: 'h1', name: 'studio' }, { id: 'h2', name: 'mini' }],
                  divan: { h1: STUDIO.state, h2: MINI.state }, loadDivan() {},
                  conn: 'online', ustabasi: null, ustabasiOld: false, loadUstabasi() {} });
    return R.render('dark', h(Dashboard));
  };

  const all = machines();
  R.pressOn('Quire');                                   // the chip
  const scoped = R.render('dark', h(Dashboard));
  const chips = R.styles(scoped).filter((st) => st.height === 34);
  const t = R.theme.tokensFor('dark');
  R.pressOn('allProjects');                             // …and back out of it
  const back = R.render('dark', h(Dashboard));

  checks.push(
    ['nothing selected, the Dashboard is every project', title(all) === 'overview'
      && all.includes('dashSorted') && ['Quire', 'Hush', 'Kanji Daily'].every((n) => all.includes(n))],
    ['pressing a chip enters that project: the title is its name',
      title(scoped) === 'Quire'],
    ['…the body is that project and not the list of them',
      scoped.includes('branches') && scoped.includes('engineering') && !scoped.includes('dashSorted')],
    ['…and the bar says which one you are in',
      chips.filter((st) => st.backgroundColor === t.ink).length === 1],
    ['pressing All comes back out to every project',
      title(back) === 'overview' && back.includes('dashSorted')],
  );

  // A card in the body enters the same project the chip does. Not the chip:
  // that one's words are the name and nothing else, and a project card carries
  // its monogram, its line and its state around the same name.
  const row = R.presses().find((press) => press.text.includes('Kanji Daily')
    && press.text !== 'Kanji Daily');
  row.press();
  checks.push(['a project in the body enters it too',
    title(R.render('dark', h(Dashboard))) === 'Kanji Daily']);
  R.store.reset();
  R.params.reset();
}

// ── 4 · everything about a computer is under Machine ────────────────────────

const rows = S.machineRows({ machines: 3, unreachable: 0, executors: 9 });
const routes = rows.map((r) => r.route);

checks.push(
  ['the Machine list holds the screens that were about a computer',
    eq(routes, ['/machines', '/executors', '/agents', '/screen', '/accounts', '/pool', '/call', '/settings'])],
  ['…in the frame’s shape: a name, a grey line, and a chevron one level deeper',
    rows.every((r) => r.title && r.note) && /ListRow/.test(machine)],
  ['…and the machines row says how many answered',
    rows[0].meta === 'mAllReachable' && rows[0].tone === 'run'
    && S.machineRows({ machines: 3, unreachable: 1, executors: 9 })[0].meta === 'mUnreachable'],
  ['nothing is coloured unless a machine is actually unreachable',
    S.machineRows({ machines: 3, unreachable: 1, executors: 9 })[0].tone === 'red'
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

// ── 5 · the chat place is the conversations, and the list is back in front ──
//
// It was briefly one conversation with no list: the newest chat, opened
// directly. A phone that holds a dozen of them could then reach exactly one, so
// the tab opens the list again and a row opens the conversation. What the
// redesign took off the top of it stays off.

checks.push(
  ['the Chat place is the list of every conversation',
    /SectionList/.test(chatPlace) && /searchChats/.test(chatPlace)],
  ['…and a row of it opens one conversation',
    /router\.push\(`\/chat\/\$\{chat\.id\}`\)/.test(chatPlace)],
  ['…which is the same screen a notification about a chat opens',
    /export function Conversation\(\{ id \}/.test(conversation)
    && /<Conversation id=\{id!\} \/>/.test(conversation)],
  ['the list stands in the shell, so the three places are still under it',
    /<Shell place="chat">/.test(chatPlace)],
  ['…and it is the tab that lands on it, not a push off the Dashboard',
    S.placeOf('/chat') === 'chat' && !/BackBar/.test(chatPlace)],
  ['no computer picker over it, and Agents is not beside it any more',
    !/host-sheet|HomeTop/.test(chatPlace) && !/host-sheet|HomeTop/.test(conversation)
    && !/'\/agents'/.test(chatPlace)],
  ['a second conversation is started from the list itself',
    /quickNew/.test(chatPlace) && /createChat\(/.test(chatPlace)
    && /router\.push\('\/new-chat'\)/.test(chatPlace)],
  ['a conversation that was put away can be found again',
    /setShowArchived\(/.test(chatPlace) && /T\('unarchive'\)/.test(chatPlace)],
  ['the chat screen itself is untouched: it still draws its own everything',
    /KeyboardAvoidingView/.test(conversation) && /LimitsRing/.test(conversation)
    && !/components\/divan/.test(conversation) && !/components\/shell/.test(conversation)],
  ['Back out of the conversation leaves for the Dashboard when nothing is under it',
    /if \(router\.canGoBack\(\)\) router\.back\(\); else router\.replace\(HOME\);/.test(conversation)],
);

// ── 5b · the three places that are made of data, standing up ───────────────
//
// Each is drawn out of what the machines answered, and the first state any of
// them will ever be in is "nothing has answered yet" — which is exactly the
// state that throws if a screen assumes a project, a machine or a queue. So
// they are rendered for real, twice: once against a phone that has heard
// nothing and once against the fixture above.
//
// The Chat place is here for a different reason. Reading its source says it
// contains a list; it cannot say that the list came out with anything in it,
// and "one chat and eleven you cannot reach" is precisely a claim about what
// came out. So it is stood up against a phone holding two conversations, and
// one of them is pressed.

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
      full.includes('pcStale') && full.includes('dashPartly')],
    ['the Machine list counts the machines it is a list of',
      machineFull.includes('mMachinesNote')],
  );
  R.store.reset();
}

{
  const conversation = (id, title, updated_at) => ({
    id, title, updated_at, archived: 0, pinned: 0, last_preview: 'hello', status: 'idle',
    provider: 'claude', group_id: null, cwd: '/Users/x/projects/a',
    model: 'opus', effort: 'high', perm_mode: 'safe',
  });
  R.store.reset();
  R.store.set({
    chats: { a: conversation('a', 'Babysee build', 1000), b: conversation('b', 'isghocam SEO', 900) },
    groups: [], conn: 'online', chatsLoaded: true, switching: false, showArchived: false,
    prefs: { chatView: 'flat' }, hostInfo: { name: 'studio' }, host: { name: 'studio' },
    defaults: { provider: 'claude', cwd: '/Users/x/projects/a', byProvider: {} }, projects: [],
    refresh: async () => {}, loadProjects: async () => {}, createChat: async () => ({ id: 'n' }),
    updateChat: async () => {}, deleteChat: async () => {}, renameGroup: async () => {},
    deleteGroup: async () => {}, createGroup: async () => ({ id: 'g' }),
    setShowArchived: () => {}, setPrefs: async () => {},
  });
  const ChatPlace = require(path.join(root, 'app/chat/index.tsx')).default;
  const list = R.render('dark', h(ChatPlace));
  R.nav.reset();
  const row = R.presses().find((press) => press.text.includes('Babysee build'));
  if (row) row.press();
  checks.push(
    ['the Chat place comes out with every conversation on it, not just the newest',
      list.includes('Babysee build') && list.includes('isghocam SEO')],
    ['…a row of it opens that conversation', eq(R.nav.pushed(), ['/chat/a'])],
    ['…and the three places are still under it', list.includes('tabChat') && list.includes('tabMachine')],
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

// ── 7 · what can be reached from a place, and what cannot ──────────────────
//
// "Reachable inside Machine and nowhere else in the top level" is a question
// about walking, not about one file, and so is "there is still a way to start a
// second conversation". So the screens' own pushes are read into a graph and
// walked from each of the three places.

/** The routes one screen leads to. Read off what it pushes: a literal, a
 *  `pathname:` in an object, or a template with an id in it. */
function leadsTo(file) {
  const code = src(file);
  const out = new Set();
  for (const m of code.matchAll(/router\.(?:push|replace)\(\s*['"`](\/[\w\-/[\]]+)['"`]/g)) out.add(m[1]);
  for (const m of code.matchAll(/pathname:\s*['"`](\/[\w\-/[\]]+)['"`]/g)) out.add(m[1]);
  for (const m of code.matchAll(/router\.(?:push|replace)\(\s*`(\/[\w-]+)\/\$\{/g)) out.add(`${m[1]}/[id]`);
  // The Machine list pushes `row.route`, which is the list itself; that it
  // does is checked above, and this is what the rows are.
  if (file === 'app/machine.tsx') for (const route of routes) out.add(route);
  return [...out];
}

const ROUTE_OF = (f) => '/' + f.replace(/^app\//, '').replace(/\/index\.tsx$/, '').replace(/\.tsx?$/, '');
const GRAPH = new Map(files('app')
  .filter((f) => !/_layout\.tsx$|^app\/index\.tsx$/.test(f))
  .map((f) => [ROUTE_OF(f), leadsTo(f)]));

/** Everything you can get to from a place, however many presses it takes. */
function reachable(from) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    for (const next of GRAPH.get(queue.shift()) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

const fromDashboard = reachable(S.PLACE_ROUTE.dashboard);
const fromChat = reachable(S.PLACE_ROUTE.chat);
const fromMachine = reachable(S.PLACE_ROUTE.machine);

checks.push(
  ['every screen about a computer is reachable from Machine',
    routes.every((route) => fromMachine.has(route))],
  ['…and pairing with it, one level further in',
    fromMachine.has('/pair')],
  ['…and from neither of the other two places',
    routes.every((route) => !fromDashboard.has(route) && !fromChat.has(route))],

  // Everything a conversation needs is inside its own place: the list, the
  // ones put away, and the form that starts a new one. None of it is a screen
  // you have to come back to the Dashboard for.
  ['a second conversation can be started without deleting the one you are in',
    fromChat.has('/new-chat')],
  ['…and the pen on the list makes one outright, so it is not only a form',
    /quickNew/.test(chatPlace) && /createChat\(/.test(chatPlace)],
  ['a conversation that was put away can be found again',
    /setShowArchived\(/.test(chatPlace) && /unarchive/.test(chatPlace)
    && fromChat.has('/chat/[id]')],

  // …and the list is that place rather than a fourth one beside it.
  ['there is no second list off the Dashboard', !has('app/chats.tsx')
    && !files().some((f) => /['"`]\/chats['"`]/.test(src(f)))],
  ['the ticket queue is reachable from the Dashboard', fromDashboard.has('/ustabasi')],
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
