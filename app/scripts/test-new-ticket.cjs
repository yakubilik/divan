/** The fastest screen in the product, checked without a phone (Mobile8 S9): a
 *  card filed from a title alone, no agent face asked for, and the board it
 *  lands on carrying it before any machine has answered.
 *  Run: node scripts/test-new-ticket.cjs  (also folded into test-ustabasi.cjs.)
 */
const Module = require('module');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const C = require(path.join(root, 'src/compose.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const settle = () => new Promise((done) => setImmediate(done));
const NOW = Math.floor(Date.now() / 1000);
const QUIET = 2 * 3600;

// ── the fixture ─────────────────────────────────────────────────────────────
//
// One product on two computers, and the two boards give it **two different
// ids** — they are separate databases, and that is the whole reason the merged
// product carries each machine's own (`divan.ts` `MergedProject.ids`).

const ON_STUDIO = 'quire-on-studio';
const ON_MINI = 'quire-on-mini';

const branch = { id: 'b', kind: 'engineering', name: 'Engineering', summary: '', summary_at: null,
                 cards: {}, open: 1 };
const product = (id, counts) => ({
  id, name: 'Quire', slug: 'quire', summary: 'client portals for studios', kind: 'SaaS',
  repos: ['/r/quire'], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  branches: [branch], counts, running: 0, waiting: 0, summary_line: '',
});
const card = (id, project_id, o = {}) => ({
  id, project_id, branch_id: 'b', branch: 'engineering',
  column: o.column || 'ice_box', position: o.position ?? 0, title: o.title || id,
  summary: o.summary || '', executor: o.executor ?? 'coding_agent', machine: null, repo: null,
  ustabasi_id: null, agent_status: o.status ?? null, agent_status_at: null, agent_detail: '',
  created_at: 0, updated_at: 0, moved_at: null,
});
const snapshot = (machine, at, projects, cards) => ({
  machine, os: 'Darwin', at, projects, cards, agents: [], quota: null, activity: {}, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: null, old: false } });

const STUDIO = paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', NOW - 10, [product(ON_STUDIO, { ice_box: 1, in_progress: 1 })],
    [card('q1', ON_STUDIO, { column: 'in_progress', status: 'running', title: 'Bulk invite clients' }),
     card('q2', ON_STUDIO, { title: 'Zapier integration' })]) });

/** …and the laptop with the lid shut, which is the machine this screen has to
 *  keep working against. */
const MINI = paired('h2', 'mini', { reachable: false, at: NOW - QUIET,
  snapshot: snapshot('mini', NOW - QUIET, [product(ON_MINI, { ice_box: 1 })],
    [card('m1', ON_MINI, { title: 'Fix portal login on Safari 17' })]) });

const NEVER = paired('h3', 'cloud', { reachable: false, at: null, snapshot: null });

const TWO = M.merge([STUDIO, MINI], NOW);
const ONLY_QUIET = M.merge([MINI], NOW);
const NOTHING = M.merge([], NOW);
const quire = M.project(TWO, 'quire');

// ── 1 · what is enough to file ──────────────────────────────────────────────

{
  const bare = C.draft('Export client list as CSV', '');
  const long = C.draft('x', 'a'.repeat(400));
  checks.push(
    ['a title alone is enough, and the sentences are optional',
      bare.ready && bare.summary === '' && !C.draft('   ', 'sentences but no title').ready],
    ['nothing shortens a description: the count is a count',
      long.summary.length === 400 && long.used === 400],
  );
}

// ── 2 · what the machine is asked for ───────────────────────────────────────

{
  const to = C.writer(TWO, quire);
  const filing = C.filing(to, C.draft('Export client list as CSV', 'One button on the Clients page.'), 'ice_box');
  checks.push(
    ['the request is the human face and the column, and names no agent face',
      eq(Object.keys(filing).sort(), ['column', 'project_id', 'summary', 'title'])
      && filing.column === 'ice_box'],
  );
}

// ── 3 · which computer takes it, and its own name for the product ───────────

{
  const both = C.writer(TWO, quire);
  const quiet = C.writer(ONLY_QUIET, M.project(ONLY_QUIET, 'quire'));
  checks.push(
    ['a card goes to a machine that is answering, over one that is not',
      both.host === 'h1' && both.machine === 'studio' && !both.quiet
      && both.project === ON_STUDIO],
    ['…and to a quiet one where that is the only machine that has the product',
      quiet.host === 'h2' && quiet.quiet && quiet.project === ON_MINI],
    ['…carrying that machine’s own id for it, never the other machine’s',
      eq(quire.ids, { h1: ON_STUDIO, h2: ON_MINI })],
    ['no paired computer has the product: there is nowhere to put a card',
      C.writer(NOTHING, null) === null && C.opens(NOTHING, 'quire') === null],
  );
}

// ── 4 · the board it lands on ───────────────────────────────────────────────
//
// The store is the one part of the app that cannot be stood up by importing it
// — it reaches a socket, a keychain and the notification centre — so the four
// modules that do that are answered here and the real one is driven for the
// length of this section. What is held to account is the criterion itself: the
// board has the card on it, without a refresh, on a machine whose poll has not
// come back.

const asked = [];
let releaseStale = () => {};
let releaseFresh = () => {};
const stale = new Promise((done) => { releaseStale = () => done(MINI.state.snapshot); });

const MADE = card('new-1', ON_MINI, { column: 'ice_box', title: 'Export client list as CSV',
                                      executor: null });
const REPORTED = snapshot('mini', NOW, [product(ON_MINI, { ice_box: 2 })],
                          [MADE, card('m1', ON_MINI, { title: 'Fix portal login on Safari 17' })]);
const fresh = new Promise((done) => { releaseFresh = () => done(REPORTED); });

let store = null;
{
  const client = { onStatus: () => () => {}, on: () => () => {}, poke() {}, connect() {}, disconnect() {},
                   call: async () => ({}) };
  let polled = 0;
  const callOnce = async (host, port, token, type) => {
    asked.push([host, type]);
    if (type === 'divan.card.create') return MADE;
    if (type !== 'divan.snapshot') return {};
    polled += 1;
    return polled === 1 ? await stale : await fresh;
  };
  const stand = {
    [path.join(root, 'src/ws.ts')]: { client, callOnce },
    [path.join(root, 'src/push.ts')]: { dismissChatNotifications() {} },
  };
  const packaged = {
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {},
                           deleteItemAsync: async () => {} },
    'expo-local-authentication': { hasHardwareAsync: async () => false, isEnrolledAsync: async () => false,
                                   authenticateAsync: async () => ({ success: true }) },
  };
  const under = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (packaged[request]) return packaged[request];
    if (request.startsWith('.') && parent) {
      const to = path.resolve(path.dirname(parent.filename), request);
      for (const ext of ['', '.ts', '.tsx']) if (stand[to + ext]) return stand[to + ext];
    }
    return under.call(this, request, parent, isMain);
  };
  store = require(path.join(root, 'src/store.ts')).useStore;
  Module._load = under;
}

/** The board of one product, drawn from a given set of machine answers. */
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

function board(scheme, divan, hosts, params) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({ hosts, divan, host: { id: hosts[0].id }, conn: 'online',
                loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {} });
  R.params.set({ project: 'quire', tab: 'board', col: 'ice_box', ...params });
  return R.render(scheme, h(Dashboard));
}

const MINE = [{ id: 'h2', name: 'mini', host: 'mini.ts.net', port: 8765, token: 't' }];

async function landed() {
  store.setState({ hosts: MINE, activeHostId: null, conn: 'idle', divan: { h2: MINI.state } });

  const poll = store.getState().loadDivan('h2');
  await settle();
  const once = asked.length;
  void store.getState().loadDivan('h2');
  await settle();
  checks.push(['a machine with a poll already out is not asked again', asked.length === once]);

  await store.getState().createCard({ host: 'h2', card: {
    project_id: ON_MINI, title: 'Export client list as CSV', summary: '', column: 'ice_box' } });
  await settle();

  const held = store.getState().divan;
  const drawn = board('dark', held, [{ id: 'h2', name: 'mini' }]);
  checks.push(
    ['the board has the card on it before any machine has answered',
      held.h2.snapshot.cards.some((c) => c.id === 'new-1')
      && drawn.includes('Export client list as CSV')],
    ['…and the column it went into counts one more',
      held.h2.snapshot.projects[0].counts.ice_box === 2],
  );

  releaseStale();
  await settle();
  checks.push(
    ['a poll that went out before the card came back without it and did not take it off',
      store.getState().divan.h2.snapshot.cards.some((c) => c.id === 'new-1')],
  );

  releaseFresh();
  await poll;
  await settle();
  checks.push(
    ['…and the machine’s own answer, when it comes, is what the board is drawn from',
      store.getState().divan.h2.reachable
      && store.getState().divan.h2.snapshot.at === NOW],
  );
}

// ── 5 · the screen itself, in both themes ───────────────────────────────────

const NewTicket = require(path.join(root, 'app/new-ticket.tsx')).default;

/** Every filing the screen asked for since the last `draw`. */
let filed = [];

function draw(scheme, hosts, params, props) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  filed = [];
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {},
    createCard: async (what) => { filed.push(what); },
  });
  R.params.set(params);
  return R.render(scheme, h(NewTicket, props));
}

const styleOf = (markup, word) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)]
  .filter((m) => m[2] === word)
  .map((m) => JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")))[0];

/** The two boxes, title first: S9's 24 pt line and the fixed three-line space. */
const boxes = (markup) => R.styles(markup).filter((s) => s.fontSize === 24 || s.height === 72);

/** Every state this screen can be in, which the last check of the loop draws. */
const STATES = {
  'a product on two machines': [[STUDIO, MINI], { project: 'quire' }, {}],
  'opened with the card already written': [[STUDIO, MINI], { project: 'quire' },
    { opening: 'Export client list as CSV', sentences: 'Studios keep asking.' }],
  'a product whose only machine has gone quiet': [[MINI], { project: 'quire' }, {}],
  'a machine that has never answered': [[STUDIO, NEVER], { project: 'quire' }, {}],
  'no such product in the view': [[STUDIO], { project: 'gone' }, {}],
  'nothing paired at all': [[], { project: 'quire' }, {}],
  'opened with no product named': [[STUDIO], {}, {}],
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const page = draw(scheme, [STUDIO, MINI], { project: 'quire' }, {});
  const empty = draw(scheme, [], { project: 'quire' }, {});

  checks.push(
    [`${scheme}: the form is the way out, the product, Title, the sentences, Ice Box · Queued · Start now and Create`,
      styleOf(page, 'cancel').color === t.ink2 && page.includes('>Quire<')
      && boxes(page).length === 2
      && page.includes('data-label="ntTitle"') && page.includes('data-label="ntSentences"')
      && ['>bdIceBox<', '>bdQueued<', '>ntStartNow<', '>ntCreate<'].every((w) => page.includes(w))],
    [`${scheme}: …and the boxes are set in the app's own type, not the phone's`,
      eq(boxes(page).map((s) => s.fontFamily), ['Geist-SemiBold', 'Geist-Regular'])
      && !boxes(page).some((s) => s.fontWeight)],
    [`${scheme}: the line under the box says what is not being asked for, and counts`,
      styleOf(page, 'ntLater').color === t.ink3 && styleOf(page, 'ntLater').fontFamily.includes('Mono')
      && page.includes('>ntCount<')],
    [`${scheme}: nothing on the page is a field for an agent face`,
      !/caGoal|caDoneWhen|caTest|caConstraints|caNotes|caExecutor|ntExecutor/.test(page)
      && (page.match(/data-placeholder=/g) ?? []).length === 2],
    [`${scheme}: with no product anywhere it says so instead of offering a card`,
      empty.includes('>ntNowhere<') && !empty.includes('>ntCreate<')],
    [`${scheme}: every state of this screen renders`,
      Object.values(STATES).every(([hosts, params, props]) => {
        const markup = draw(scheme, hosts, params, props);
        return markup.includes('>cancel<');
      })],
  );
}

// ── 6 · pressing the buttons ────────────────────────────────────────────────
//
// Filing is a request, so what the button does is not finished in the tick it
// was pressed. `ready` is exported and awaited before anything is printed, by
// the runner below and by test-ustabasi.cjs.

const LONG = 'These are the sentences somebody actually typed. '.repeat(9);

async function pressed() {
  await landed();

  draw('dark', [STUDIO, MINI], { project: 'quire' },
       { opening: 'Export client list as CSV', sentences: 'Studios keep asking to download their list.' });
  R.pressOn('ntCreate');
  await settle();
  const ice = filed.slice();
  const where = R.nav.replaced();

  // Choosing a segment writes it into the address; the form drawn from that
  // address files there.
  draw('dark', [STUDIO, MINI], { project: 'quire' }, { opening: 'Export client list as CSV' });
  R.pressOn('bdQueued');
  const chosen = { ...R.params.get() };
  draw('dark', [STUDIO, MINI], chosen, { opening: 'Export client list as CSV' });
  R.pressOn('ntCreate');
  await settle();
  const queued = filed.slice();

  draw('dark', [STUDIO, MINI], { project: 'quire', into: 'in_progress' }, { opening: 'Start the webhook retries' });
  R.pressOn('ntCreate');
  await settle();
  const started = filed.slice();
  const landedOn = R.nav.replaced();

  draw('dark', [STUDIO, MINI], { project: 'quire' }, {});
  R.pressOn('ntCreate');
  await settle();
  const nothing = filed.slice();

  draw('dark', [STUDIO, MINI], { project: 'quire' }, { opening: 'Long one', sentences: LONG });
  R.pressOn('ntCreate');
  await settle();
  const over = filed.slice();

  checks.push(
    ['Create files divan.card.create into Ice Box by default, on the machine that has the product, with only the human face',
      eq(ice, [{ host: 'h1', card: { project_id: ON_STUDIO, title: 'Export client list as CSV',
                                     summary: 'Studios keep asking to download their list.',
                                     column: 'ice_box' } }])
      && eq(where, ['/dashboard?project=quire&tab=board&col=ice_box'])],
    ['…into Queued when that segment is chosen, and straight into In Progress on Start now',
      chosen.into === 'queued' && queued.length === 1 && queued[0].card.column === 'queued'
      && queued[0].card.summary === ''
      && started.length === 1 && started[0].card.column === 'in_progress'
      && eq(landedOn, ['/dashboard?project=quire&tab=board&col=in_progress'])],
    ['a card with no title is not filed',
      nothing.length === 0],
    ['what is in the box is what is filed, past the limit the line counts against',
      LONG.length > C.SUMMARY_MAX && over.length === 1 && over[0].card.summary === LONG.trim()],
  );

  // ── 7 · a machine that would not take it ──────────────────────────────────
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }],
    divan: { h1: STUDIO.state },
    host: { id: 'h1' }, conn: 'online', loadDivan() {},
    createCard: async () => { throw new Error('studio did not answer'); },
  });
  R.params.set({ project: 'quire' });
  R.render('dark', h(NewTicket, { opening: 'Export client list as CSV' }));
  R.pressOn('ntCreate');
  await settle();
  checks.push(
    ['a machine that would not take the card leaves the phone on the page it was written on',
      R.nav.replaced().length === 0],
  );

  R.store.reset();
  R.params.reset();
  R.nav.reset();
}

/** A section that never finished would otherwise read as a pass: nothing is
 *  printed, the loop drains and node leaves with 0. */
const ready = (async () => {
  let timer = null;
  const late = new Promise((_, no) => {
    timer = setTimeout(() => no(new Error('a section never finished')), 20000);
  });
  try {
    await Promise.race([pressed(), late]);
  } catch (e) {
    checks.push([`every section of this file ran to the end (${e.message})`, false]);
  } finally {
    if (timer) clearTimeout(timer);
  }
})();

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
