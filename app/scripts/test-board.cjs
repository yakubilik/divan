/** One product's board, checked without a phone: the four columns, the mark on a
 *  card, the machine it runs on, and what Done is allowed to draw.
 *  Run: node scripts/test-board.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const B = require(path.join(root, 'src/board.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;
const QUIET = 2 * HOUR + 14 * MIN;

const branch = (kind, name, o = {}) => ({
  id: `${kind}-id`, kind, name, summary: o.summary || '', summary_at: o.at ?? null,
  cards: o.cards || {}, open: o.open || 0,
});
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  summary: o.summary || '', kind: o.kind || '',
  repos: o.repos || [], sort: 0, archived: false, created_at: 0, updated_at: o.updated_at || NOW - 60,
  branches: o.branches || [], counts: o.counts || {},
  running: o.running || 0, waiting: o.waiting || 0, summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering',
  column: o.column || 'in_progress', position: o.position || 0, title: o.title || id,
  summary: o.summary || '', executor: o.executor ?? 'coding_agent', machine: o.machine ?? null,
  repo: null, ustabasi_id: o.ustabasi ?? null, agent_status: o.status ?? null,
  agent_status_at: o.at ?? null, agent_detail: o.detail || '', created_at: 0, updated_at: o.updated ?? 0,
  moved_at: o.moved ?? null,
});
const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: null, activity: o.activity || {}, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: null, old: false } });

const QUIRE = (o = {}) => project('Quire', {
  kind: 'SaaS', summary: 'client portals for studios', repos: ['/r/quire'],
  running: 2, waiting: 2, updated_at: o.updated_at,
  counts: o.counts || { ice_box: 11, queued: 3, in_progress: 6, done: 48 },
  branches: [branch('engineering', 'Engineering', { open: 9, cards: o.counts || { in_progress: 6 } })],
});

/** The studio, with one card in every state the board draws and two finished
 *  ones — yesterday's, and one from two hundred days ago. */
const STUDIO = paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, projects: [QUIRE()],
    cards: [
      card('q1', { status: 'asking', ustabasi: 12, title: 'Webhook retry policy',
                   summary: 'Failed Stripe webhooks are dropped after 3 tries.',
                   detail: 'Retry five times, or ten?' }),
      card('r1', { column: 'review', status: 'running', at: NOW - 8 * MIN, position: 5, ustabasi: 14,
                   title: 'Payment flow with Stripe' }),
      card('q2', { status: 'failed', at: NOW - 9 * HOUR, position: 1, ustabasi: 7,
                   title: 'Price localisation for GBP' }),
      card('q3', { status: 'running', at: NOW - 12 * MIN, position: 2, ustabasi: 9,
                   title: 'Bulk invite clients from a CSV' }),
      card('q4', { status: 'verified', position: 3, title: 'Invoice PDF redesign' }),
      card('q5', { executor: 'human', position: 4, moved: NOW - DAY,
                   title: 'Write the onboarding email' }),
      card('q6', { column: 'queued', title: 'Comparison page: Quire vs Notion' }),
      card('q7', { column: 'ice_box', title: 'Zapier integration' }),
      card('d1', { column: 'done', status: 'verified', moved: NOW - 2 * DAY, title: 'Pricing page A/B test' }),
      card('d2', { column: 'done', status: 'verified', moved: NOW - 200 * DAY, title: 'Client comments on files' }),
    ],
    agents: [] }),
});

/** …and the laptop with the lid shut, with the same product on it and a worker
 *  that was stuck when it stopped answering. */
const MINI = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [QUIRE({ updated_at: NOW - 300, counts: { in_progress: 1 } })],
    cards: [card('m1', { status: 'blocked', at: NOW - (HOUR + 12 * MIN), ustabasi: 21,
                         title: 'Fix portal login on Safari 17' })] }),
});

const NEVER = paired('h3', 'cloud', { reachable: false, at: null, snapshot: null });

/** A product whose board has never had a card on it. */
const FRESH = paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    projects: [project('Pebble', { branches: [branch('engineering', 'Engineering')] })] }) });

const ONE = M.merge([STUDIO], NOW);
const TWO = M.merge([STUDIO, MINI], NOW);
const NEW = M.merge([FRESH], NOW);
const quire = M.project(TWO, 'quire');
const alone = M.project(ONE, 'quire');
const ago = (s) => (s == null ? '' : `${Math.round(s / 3600)}h`);
const of = (col, view = TWO, p = quire) => B.items(view, p, col, ago, 'h1');
const ids = (list) => list.map((i) => i.card.id).join(',');

// ── 1 · the four columns ────────────────────────────────────────────────────

{
  const four = B.tabs(quire, NOW);
  checks.push(
    ['the four columns are the board’s own, left to right, with its counts',
      eq(four.map((c) => c.key), ['ice_box', 'queued', 'in_progress', 'done'])
      && eq(four.map((c) => c.label), ['bdIceBox', 'bdQueued', 'bdInProgress', 'bdDone'])
      && eq(four.map((c) => c.count), [11, 3, 7, 1])],
    ['…and a column with cards in it never reads zero, whatever the counts say',
      B.tabs({ ...quire, counts: {} }, NOW).find((c) => c.key === 'in_progress').count === 7],
    ['a board opens on In Progress, and every column holds the cards a person put in it',
      B.OPENS_ON === 'in_progress'
      && ids(of('in_progress')) === 'm1,q1,q2,q3,q4,q5,r1'
      && ids(of('queued')) === 'q6' && ids(of('ice_box')) === 'q7'],
  );
}

// ── 2 · the mark on a card, and the machine under it ────────────────────────

{
  const by = Object.fromEntries(of('in_progress').map((i) => [i.card.id, i]));
  const mark = (id) => ({ ...by[id].mark, params: undefined });
  checks.push(
    ['every state the board draws is a mark of its own, in its own tone',
      eq(mark('q1'), { mark: '?', key: 'bdAsking', tone: 'amber', params: undefined })
      && eq(mark('m1'), { mark: '■', key: 'bdStuck', tone: 'red', params: undefined })
      && eq(mark('q2'), { mark: '×', key: 'bdFailed', tone: 'red', params: undefined })
      && eq(mark('q3'), { mark: '●', key: 'bdRunning', tone: 'run', params: undefined })
      && eq(mark('q4'), { mark: '✓', key: 'bdReviewed', tone: 'run', params: undefined })
      && eq(mark('q5'), { mark: '○', key: 'bdYours', tone: 'ink2', params: undefined })],
    ['…and a card nobody has picked up has none rather than a chip saying so',
      of('queued')[0].mark === null && of('ice_box')[0].mark === null],
    ['a card says which computer it runs on, and only where that is a question',
      by.q3.machine.name === 'studio' && by.m1.machine.name === 'mini'
      && by.q5.machine === null
      && of('in_progress', ONE, alone).every((i) => i.machine === null)],
    ['…and the one on the machine that has gone quiet says when it was last heard from',
      by.m1.machine.seen === NOW - QUIET && by.q3.machine.seen === null],
    ['the column says which machines it is spread over',
      eq(B.spread(quire, of('in_progress').map((i) => i.card)),
            [{ name: 'studio', n: 6 }, { name: 'mini', n: 1 }])
      && eq(B.spread(alone, of('in_progress', ONE, alone).map((i) => i.card)), [])],
  );
}

// ── 3 · a worker that failed overnight ──────────────────────────────────────

{
  const failed = of('in_progress').find((i) => i.card.id === 'q2');
  checks.push(
    ['a worker that failed overnight leaves its card where it was, marked with how long',
      failed.card.column === 'in_progress'
      && eq(failed.mark, { mark: '×', key: 'bdFailed', params: { d: '9h' }, tone: 'red' })],
    ['…and in no other column, because nothing but a person moves a card',
      ['ice_box', 'queued', 'done'].every((col) => !of(col).some((i) => i.card.id === 'q2'))],
  );
}

// ── 4 · Done ────────────────────────────────────────────────────────────────

{
  checks.push(
    ['Done draws the last month, newest first, and not the card finished in March',
      ids(of('done')) === 'd1' && B.DONE_WINDOW_S === 30 * DAY],
    ['…and says how many there are in all rather than pretending to hold them',
      eq(B.foot(quire, 'done', NOW), { key: 'bdDoneNote', params: { n: 48 } })
      && eq(B.foot({ ...quire, cards: quire.cards.filter((c) => c.column !== 'done') }, 'done', NOW),
            { key: 'bdDoneNone', params: { n: 48 } })],
    ['an empty column says so, and an empty Done with nothing behind it too',
      eq(B.foot({ ...quire, cards: [], counts: {} }, 'queued', NOW), { key: 'bdNothing' })
      && eq(B.foot({ ...quire, cards: [], counts: {} }, 'done', NOW), { key: 'bdNothing' })
      && B.foot(quire, 'in_progress', NOW) === null],
  );
}

// ── 5 · the page itself, in both themes ─────────────────────────────────────

const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

function draw(scheme, hosts, params) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  R.params.set(params);
  return R.render(scheme, h(Dashboard));
}

/** The cards' own surfaces: the corner a board card takes, with a line round it.
 *  The chip inside one wears its state's wash, and that is the point — this is
 *  about what the card does. */
const surfaces = (markup) => R.styles(markup)
  .filter((s) => s.borderRadius === K.RADIUS.md && s.borderWidth != null && s.height !== K.SIZE.columnTab
    && s.overflow === 'hidden');

const styleOf = (markup, word) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)]
  .filter((m) => m[2] === word)
  .map((m) => JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")))[0];

/** Every state this board can be in, which the last check of the loop renders. */
const BOARDS = {
  'the open column of a product on two machines': [[STUDIO, MINI], { project: 'quire', tab: 'board' }],
  'its Ice Box': [[STUDIO, MINI], { project: 'quire', tab: 'board', col: 'ice_box' }],
  'its Queued': [[STUDIO, MINI], { project: 'quire', tab: 'board', col: 'queued' }],
  'its Done': [[STUDIO, MINI], { project: 'quire', tab: 'board', col: 'done' }],
  'a product on one machine': [[STUDIO], { project: 'quire', tab: 'board' }],
  'a product whose only machine has gone quiet': [[MINI], { project: 'quire', tab: 'board' }],
  'a machine that has never answered': [[STUDIO, NEVER], { project: 'quire', tab: 'board' }],
  'a board with no card on it': [[FRESH], { project: 'pebble', tab: 'board' }],
  'a column that does not exist': [[STUDIO], { project: 'quire', tab: 'board', col: 'nowhere' }],
  'a project that is no longer in the view': [[STUDIO], { project: 'gone', tab: 'board' }],
  'nothing paired at all': [[], { project: 'quire', tab: 'board' }],
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const board = draw(scheme, [STUDIO, MINI], { project: 'quire', tab: 'board' });
  const done = draw(scheme, [STUDIO, MINI], { project: 'quire', tab: 'board', col: 'done' });
  const fresh = draw(scheme, [FRESH], { project: 'pebble', tab: 'board' });

  checks.push(
    [`${scheme}: the four columns are four tabs on the page, each with its count`,
      ['bdIceBox', 'bdQueued', 'bdInProgress', 'bdDone'].every((k) => board.includes(`>${k}<`))
      && board.includes('>11<') && board.includes('>7<')],
    [`${scheme}: every card carries its real status word, review folded in as testing`,
      ['stAsking', 'stFailed', 'stStuck', 'stRunning', 'stPassed', 'stYours', 'stTesting']
        .every((w) => board.includes(`>${w}<`))
      && styleOf(board, 'stAsking').color === t.amber],
    [`${scheme}: the asking card has an amber-toned edge, the only one`,
      surfaces(board).filter((s) => s.borderColor === t.amberRing).length === 1
      && board.includes('Retry five times, or ten?')],
    [`${scheme}: the card nothing runs on is drawn as an outline`,
      surfaces(board).filter((s) => s.borderStyle === 'dashed' && s.borderColor === t.line2
                                    && s.backgroundColor === 'transparent').length === 1],
    [`${scheme}: the corner says the machine and how long, and a quiet machine says when it was heard from`,
      board.includes('studio · ') && board.includes('mini · pfLastSeen')],
    [`${scheme}: Done draws this month and not the card from March`,
      done.includes('Pricing page A/B test') && !done.includes('Client comments on files')],
    [`${scheme}: the line over the cards says how a card is moved`,
      board.includes('>bdHint<')],
    [`${scheme}: a board with no card on it keeps its four tabs and says what to do`,
      fresh.includes('>bdInProgress<') && fresh.includes('>prNewTitle<') && fresh.includes('prNewFoot')],
    [`${scheme}: the segment is Overview, Board and Chats, with no coloured mark riding on it`,
      board.includes('>overview<') && board.includes('>bdBoard<') && board.includes('>pjChats<')
      && !styleOf(board, '■')],
    [`${scheme}: every state of the board renders`,
      Object.values(BOARDS).every(([hosts, params]) => /tabDashboard|>divan</.test(draw(scheme, hosts, params)))],
  );
}

// ── 6 · the way in ──────────────────────────────────────────────────────────

{
  draw('dark', [STUDIO, MINI], { project: 'quire', tab: 'board' });
  const cards = R.presses().filter((p) => p.text.includes('Bulk invite clients'));
  cards[0].press();
  const here = R.nav.pushed();
  // A fresh page, because the guard against a double tap lets one navigation
  // out of a screen and no more (`src/nav.ts`).
  draw('dark', [STUDIO, MINI], { project: 'quire', tab: 'board' });
  const elsewhere = R.presses().filter((p) => p.text.includes('Fix portal login'));
  elsewhere[0].press();
  checks.push(
    ['tapping a card opens the card itself, on the machine it is on',
      cards.length === 1 && eq(here, ['/card/q3?host=h1'])],
    ['…including one on a machine this phone is not holding a socket to',
      elsewhere.length === 1 && eq(R.nav.pushed(), ['/card/m1?host=h2'])],
  );
  const face = draw('dark', [STUDIO], { project: 'quire' });
  R.presses().filter((p) => p.text.includes('bdBoard'))[0].press();
  checks.push(
    ['the Overview is what a product opens on, and the Board is one tap away',
      !face.includes('>bdHint<')
      && draw('dark', [STUDIO], { project: 'quire', tab: 'board' }).includes('>bdHint<')]);
}

R.store.reset();
R.params.reset();
R.nav.reset();

/** The fixture, for the drag that is checked against the same board
 *  (`scripts/test-drag.cjs`): the studio, and the laptop with the lid shut. */
module.exports = { checks, HOSTS: [STUDIO, MINI] };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
