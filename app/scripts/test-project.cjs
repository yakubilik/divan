/** One product's page, checked without a phone.
 *
 *  This is the screen behind a chip in the project bar, and what it promises is
 *  not a layout. It is four things, and each of them is a state the design names
 *  rather than a variation on the busy page:
 *
 *    * **a product at work says what is happening and what it is waiting for**,
 *      in two sentences, over its board (Mobile2 V4, and Mobile7 S4 with
 *      another product's numbers in the same slots);
 *    * **its branches are not on the page.** The Branches section and a
 *      branch's own page are gone from the phone; the data is still on the
 *      wire, and a link somebody kept to a branch lands on its product;
 *    * **a product nothing has touched in weeks says so** rather than showing a
 *      page of zeros (Mobile7 S5);
 *    * **a product whose board is still empty is a designed state** with its
 *      structure still legible (Mobile7 S6).
 *
 *  Half the checks are put to `src/project.ts`, which is the judgement with no
 *  pixels in it; the other half stand the page up for real through
 *  `render-divan.cjs`, in both themes, with a machine that has gone quiet, with
 *  one that never answered and with nothing paired at all.
 *
 *  Run: node scripts/test-project.cjs  (also folded into test-ustabasi.cjs, so
 *  one command covers everything.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const h = R.React.createElement;

const P = require(path.join(root, 'src/project.ts'));
const D = require(path.join(root, 'src/dashboard.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the products the frames draw ────────────────────────────────────────────
//
// Mobile2 V4's Quire, Mobile7 S4's Kanji Daily with a different number in every
// slot, S5's Long Walk with nothing on it for three weeks, and S6's Pebble,
// created a minute ago. Two computers, because a product is not a machine: Kanji
// Daily is checked out on both.
//
// The clock is this moment rather than a round number: every age on the page is
// measured against the phone's own `Date.now()`, so a fixture stamped in 2023
// would have every branch on it three years stale.
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
  stage: o.stage || '', milestones: o.milestones || [],
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: `${o.branch || 'engineering'}-id`, branch: o.branch || 'engineering',
  column: o.column || 'in_progress', position: 0, title: o.title || id, summary: '',
  executor: o.executor ?? 'coding_agent', machine: o.machine ?? null, repo: null,
  ustabasi_id: o.ustabasi ?? null, agent_status: o.status ?? null, agent_status_at: o.at ?? null,
  agent_detail: o.detail || '', created_at: 0, updated_at: 0, moved_at: o.moved ?? null,
});
const agent = (id, o = {}) => ({
  card_id: id, project_id: o.project, project: o.projectName || '', branch: o.branch || 'engineering',
  title: o.title || id, executor: o.executor ?? 'coding_agent', machine: o.machine || '',
  status: 'running', detail: o.detail || '', since: o.since ?? NOW - 600, ustabasi_id: o.ustabasi ?? null,
});
const quota = (o) => ({ enabled: true, accounts: 2, blocked: o.blocked || 0, spent: !!o.spent,
                        left: o.left ?? null, resets_at: o.resets_at ?? null, unknown: !!o.unknown });
const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: o.quota ?? null, activity: o.activity || {},
  pulls: o.pulls || {}, queue: {} });
/** One pull request as the daemon reads it off the code host. */
const pull = (number, title, o = {}) => ({ number, title, branch: `pr/${number}`,
  draft: !!o.draft, checks: o.checks ?? null, failing: o.failing || 0, at: o.at ?? NOW - 600 });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: o.error ?? null, old: false } });

/** Mobile2 V4's product: five branches, an agent at work, a question on one
 *  branch and something that fell over on another. Its Engineering summary was
 *  written a few minutes ago, its Customers summary three days ago. */
const QUIRE = project('Quire', {
  kind: 'SaaS', summary: 'client portals for studios', repos: ['/r/quire', '/r/quire-web'],
  stage: 'live', milestones: [{ id: 'm-live', at: Date.UTC(2026, 0, 4) / 1000, title: 'Live', note: '', kind: 'live' }],
  running: 2, waiting: 2, counts: { ice_box: 11, queued: 4, in_progress: 5, done: 48 },
  branches: [
    branch('engineering', 'Engineering', { summary: 'v3.18 deployed, Safari login still red',
      at: NOW - 6 * MIN, open: 9, cards: { ice_box: 4, queued: 2, in_progress: 3, done: 31 } }),
    branch('seo', 'SEO', { summary: 'Pages 9 of 14 rewritten', at: NOW - 3 * HOUR,
      open: 4, cards: { ice_box: 3, queued: 1, done: 12 } }),
    branch('analytics', 'Analytics', { open: 1, cards: { in_progress: 1, done: 2 } }),
    branch('marketing', 'Marketing', { summary: 'Draft waits for you', at: NOW - 30 * HOUR,
      open: 2, cards: { ice_box: 2, done: 3 } }),
    branch('customers', 'Customers', { summary: 'Both answered by agent', at: NOW - 3 * DAY,
      open: 0, cards: { done: 8 } }),
  ],
});

/** Mobile7 S4's: the same page with another product's numbers, and two branches
 *  nobody has put a card on at all. */
const KANJI = project('Kanji Daily', {
  kind: 'iOS · Android', summary: 'five kanji a day', repos: ['/r/kanji'],
  running: 1, counts: { ice_box: 3, in_progress: 1, done: 19 },
  branches: [
    branch('engineering', 'Engineering', { summary: 'Android build green again on Gradle 8.6',
      at: NOW - 40 * MIN, open: 4, cards: { ice_box: 3, in_progress: 1, done: 14 } }),
    branch('analytics', 'Analytics', { summary: 'D30 retention up after the streak change',
      at: NOW - 5 * HOUR, open: 0, cards: { done: 5 } }),
    branch('marketing', 'Marketing', {}),
    branch('customers', 'Customers', {}),
  ],
});

/** Mobile7 S5's: three weeks without an agent, a commit or a card moving. */
const WALK = project('The Long Walk', {
  kind: 'Content site', summary: 'long-distance hiking', repos: ['/r/walk'],
  counts: { ice_box: 2, done: 212 },
  branches: [
    branch('seo', 'SEO', { summary: 'Last crawl found no errors', at: NOW - 23 * DAY,
      open: 2, cards: { ice_box: 2, done: 180 } }),
    branch('analytics', 'Analytics', { summary: 'Traffic down slightly, seasonal', at: NOW - 6 * HOUR,
      open: 0, cards: { done: 20 } }),
    branch('marketing', 'Marketing', { summary: 'Newsletter paused since August', at: NOW - 41 * DAY,
      open: 0, cards: { done: 12 } }),
  ],
});

/** Mobile7 S6's: created a minute ago, five branches made, nothing on any of
 *  them, and no repository to have a history in. */
const PEBBLE = project('Pebble', {
  branches: ['engineering', 'seo', 'analytics', 'marketing', 'customers']
    .map((k) => branch(k, k[0].toUpperCase() + k.slice(1))),
});

const STUDIO = paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    quota: quota({ left: 0.64, resets_at: NOW + 4 * HOUR }),
    projects: [QUIRE, KANJI, WALK, PEBBLE],
    cards: [
      card('q1', { project: 'Quire-id', status: 'asking', ustabasi: 12, at: NOW - 12 * MIN,
                   title: 'Webhook retry policy', detail: 'Keep 3 retries, or follow Stripe?' }),
      card('q2', { project: 'Quire-id', status: 'failed', ustabasi: 7, at: NOW - (HOUR + 12 * MIN),
                   title: 'Fix portal login on Safari 17', detail: 'Coder stuck on Safari login' }),
      card('q3', { project: 'Quire-id', status: 'running', ustabasi: 9,
                   title: 'Bulk CSV invite', detail: '3 of 5 checks' }),
      card('q4', { project: 'Quire-id', branch: 'seo', column: 'queued',
                   title: 'Comparison page: Quire vs Notion' }),
      card('q5', { project: 'Quire-id', branch: 'analytics', status: 'running',
                   title: 'Pricing test read-out' }),
      card('k1', { project: 'Kanji Daily-id', status: 'running', title: 'Gradle 8.6 bump',
                   detail: 'building' }),
      card('w1', { project: 'The Long Walk-id', branch: 'seo', column: 'ice_box',
                   title: '6 glossary pages' }),
      card('w2', { project: 'The Long Walk-id', branch: 'seo', column: 'ice_box',
                   title: 'Rewrite the gear page' }),
    ],
    agents: [
      agent('q3', { project: 'Quire-id', projectName: 'Quire', ustabasi: 9, machine: 'studio',
                    title: 'Bulk CSV invite', detail: '3 of 5 checks' }),
      agent('q5', { project: 'Quire-id', projectName: 'Quire', branch: 'analytics', machine: 'studio',
                    executor: 'branch_agent', title: 'Pricing test read-out' }),
      agent('k1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'studio',
                    title: 'Gradle 8.6 bump' }),
    ],
    // Quire moved this morning, Kanji two days ago, The Long Walk three weeks
    // ago — and Pebble has no repository, so there is no entry for it at all.
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 3 },
                '/r/kanji': { at: NOW - 2 * DAY, week: 4, today: 0 },
                '/r/walk': { at: NOW - 23 * DAY, week: 0, today: 0 } },
    // What the code host said about those repositories. Quire's two were both
    // asked: three are open on the site and nothing is open on the web one,
    // which is an answer and not a gap. Kanji Daily's is on no code host the
    // daemon could ask, so it has no entry at all.
    pulls: {
      '/r/quire': { at: NOW - 200, open: [
        pull(412, 'Bulk invite from CSV', { checks: 'pending', at: NOW - 40 * MIN }),
        pull(410, 'GBP price localisation', { checks: 'failing', failing: 2, at: NOW - 5 * MIN }),
        pull(409, 'Invoice PDF redesign', { checks: 'passing', draft: true, at: NOW - 90 * MIN })] },
      '/r/quire-web': { at: NOW - 200, open: [] },
    },
  }),
});

/** The laptop with the lid shut, two hours and fourteen minutes ago, with a
 *  second copy of Kanji Daily on it and an agent that was running when it went
 *  quiet. */
const MINI = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Kanji Daily', {
      kind: 'iOS · Android', summary: 'five kanji a day', repos: ['/r/kanji-api'],
      running: 1, updated_at: NOW - 30,
      counts: { in_progress: 1 },
      branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] })],
    cards: [card('m1', { project: 'Kanji Daily-id', status: 'running', title: 'Deck sync',
                         at: NOW - QUIET - 60, detail: 'Merging two decks' })],
    agents: [agent('m1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'mini',
                           title: 'Deck sync' })] }),
});

/** …and a computer that has never answered at all. */
const NEVER = paired('h3', 'cloud', { reachable: false, at: null, snapshot: null });

/** The studio again, out of quota: its agents are stopped where they were and
 *  pick up again on their own (Mobile5 S2, on a product's own page). */
const SPENT = paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, quota: quota({ spent: true, left: 0, resets_at: NOW + 3 * HOUR }),
    projects: [KANJI], cards: [card('k1', { project: 'Kanji Daily-id', status: 'running', title: 'Gradle 8.6 bump' })],
    agents: [agent('k1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'studio',
                           title: 'Gradle 8.6 bump' })],
    activity: { '/r/kanji': { at: NOW - 2 * DAY, week: 4, today: 0 } } }),
});

/** …and a second computer that is working, with its own checkout of the same
 *  product on it. Together with `SPENT` this is the case the page has to get
 *  right: one product, one agent stopped for want of quota and one plainly
 *  running, on two machines that are both answering. */
const ALSO = paired('h4', 'shed', {
  reachable: true, at: NOW - 8,
  snapshot: snapshot('shed', { at: NOW - 8, quota: quota({ left: 0.4, resets_at: NOW + 2 * HOUR }),
    projects: [project('Kanji Daily', {
      kind: 'iOS · Android', summary: 'five kanji a day', repos: ['/r/kanji-ios'],
      running: 1, updated_at: NOW - 20, counts: { in_progress: 1 },
      branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] })],
    cards: [card('s1', { project: 'Kanji Daily-id', status: 'running', title: 'Streak screen' })],
    agents: [agent('s1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'shed',
                           title: 'Streak screen' })] }) });

/** The same computer with two agents at work on it. A count is not one agent,
 *  and the sentence that counts has to name the same machines the sentence that
 *  names an agent does. */
const SHED_TWO = paired('h4', 'shed', {
  reachable: true, at: NOW - 8,
  snapshot: snapshot('shed', { at: NOW - 8, quota: quota({ left: 0.4, resets_at: NOW + 2 * HOUR }),
    projects: [project('Kanji Daily', {
      kind: 'iOS · Android', summary: 'five kanji a day', repos: ['/r/kanji-ios'],
      running: 2, updated_at: NOW - 20, counts: { in_progress: 2 },
      branches: [branch('engineering', 'Engineering', { open: 2, cards: { in_progress: 2 } })] })],
    cards: [card('s1', { project: 'Kanji Daily-id', status: 'running', title: 'Streak screen' }),
            card('s2', { project: 'Kanji Daily-id', status: 'running', title: 'Deck import' })],
    agents: [agent('s1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'shed',
                           title: 'Streak screen' }),
             agent('s2', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'shed',
                           title: 'Deck import' })] }) });

/** …and a computer running a daemon older than the agent list: it says one agent
 *  is running on this product and says nothing about which. */
const old = (id, name, o) => paired(id, name, {
  reachable: !!o.reachable, at: o.at ?? NOW - 9,
  snapshot: snapshot(name, { at: o.at ?? NOW - 9,
    projects: [project('Kanji Daily', { running: 1, updated_at: NOW - 40,
      branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] })],
    cards: [card('o1', { project: 'Kanji Daily-id', status: 'running', title: 'Nightly build' })],
    agents: [] }) });

const view = (hosts) => M.merge(hosts, NOW);
const ONE = view([STUDIO]);
const TWO = view([STUDIO, MINI]);
/** The product as it is when the only computer it is on has stopped answering:
 *  every number on the page is a memory, and the page has to say so. */
const GONE = view([MINI]);
const OUT = view([SPENT]);
const MIXED = view([SPENT, ALSO]);
/** The same fleet with two agents at work on the machine that is working. */
const MIXED_TWO = view([SPENT, SHED_TWO]);
/** Two at work on a machine that answers, beside one that has gone quiet. */
const QUIET_TWO = view([SHED_TWO, MINI]);
/** …and the older daemon's count, once beside a spent machine and once on a
 *  machine that has since gone quiet itself. */
const MIXED_BARE = view([SPENT, old('h4', 'shed', { reachable: true })]);
const LOST = view([old('h2', 'mini', { reachable: false, at: NOW - QUIET })]);
const of = (v, key) => M.project(v, key);
const quire = of(ONE, 'quire');
const kanji = of(ONE, 'kanji-daily');
const walk = of(ONE, 'the-long-walk');
const pebble = of(ONE, 'pebble');
const ago = (s) => (s == null ? '' : `${Math.round(s)}s`);

// ── 1 · who the product is ──────────────────────────────────────────────────

{
  checks.push(
    ['the line under the name is what it is and what it is for, as both were written',
      P.subtitle(quire) === 'SaaS · client portals for studios'
      && P.subtitle(kanji) === 'iOS · Android · five kanji a day'],
    ['…what it is for alone where nobody said what sort of thing it is',
      P.subtitle({ ...quire, kind: '' }) === 'client portals for studios'],
    ['…and nothing at all where nobody said either, rather than a placeholder',
      P.subtitle(pebble) === ''],
    ['what sort of thing a product is survives the merge across two machines',
      of(TWO, 'kanji-daily').kind === 'iOS · Android'],
    ['…and is taken from whichever copy of it was edited last',
      of(TWO, 'kanji-daily').summary === 'five kanji a day'],
  );
}

// ── 2 · what is happening now ───────────────────────────────────────────────

{
  /** The row, as the keys it is made of. Several where several things are true. */
  const keys = (v, p) => P.nowWords(v, p).clauses.map((c) => c.said.key);
  const first = (v, p) => P.nowWords(v, p).clauses[0];
  const kanjiTwo = of(TWO, 'kanji-daily');
  const mixed = of(MIXED, 'kanji-daily');
  checks.push(
    ['one agent at work is named, by what it is and what it is on',
      eq(first(ONE, kanji).said,
         { key: 'prNowOne', params: { who: 'exCoder', title: 'Gradle 8.6 bump', machine: 'studio' } })
      && first(ONE, kanji).who === 'exCoder' && P.nowWords(ONE, kanji).tone === 'run'],
    ['several are counted, and the computers they are on are named',
      eq(first(ONE, quire).said, { key: 'prNowMany', params: { n: 2, on: 'studio' } })],
    ['…on every one of the machines the product is checked out on',
      of(TWO, 'kanji-daily').machines.join(', ') === 'studio, mini'],
    ['nothing running says so, and still says where the product lives',
      eq(first(ONE, walk).said, { key: 'prNowIdle', params: { on: 'studio' } })
      && P.nowWords(ONE, walk).tone === null && keys(ONE, walk).length === 1],
    ['an agent on a machine that has gone quiet is a different sentence, with the clock on it',
      (() => {
        const p = of(GONE, 'kanji-daily');
        const said = P.nowWords(GONE, p);
        return said.clauses[0].said.key === 'prNowUnknownOne' && said.clauses[0].said.params.on === 'mini'
          && /^\d{2}:\d{2}$/.test(said.clauses[0].said.params.time) && said.tone === 'amber';
      })()],
    ['…and so is one stopped because the quota ran out, with the hour it starts again',
      eq(keys(OUT, of(OUT, 'kanji-daily')), ['prNowPausedOne'])
      && P.nowWords(OUT, of(OUT, 'kanji-daily')).tone === 'red'],
    ['a quiet machine that never said when it was heard from has no clock to print',
      first(GONE, { ...of(GONE, 'kanji-daily'), lastSeen: null }).said.key === 'prNowUnknownBareOne'],
    ['…and neither does a spent machine that never said when it comes back',
      first(OUT, { ...of(OUT, 'kanji-daily'), pausedUntil: null }).said.key === 'prNowPausedBareOne'],
    ['an agent still at work on the machine that is answering is not hidden by the one that is not',
      // Kanji Daily is checked out on both: the mini's agent cannot be vouched
      // for, the studio's is plainly running, and the row says both — the quiet
      // machine first, because that is the order the project card ranks them in.
      kanjiTwo.running === 2 && kanjiTwo.unknown === 1
      && eq(keys(TWO, kanjiTwo), ['prNowUnknownOne', 'prNowOne'])],

    // ── one machine spent, another working, one product ───────────────────
    // The case that had the page calling a stopped worker a running one. Both
    // machines answer; the studio has nothing left to run on and its agent is
    // stopped where it stood, the shed is working.
    ['a product with one machine out of quota and another working says both, worst first',
      mixed.running === 2 && mixed.paused === 1 && mixed.unknown === 0
      && eq(keys(MIXED, mixed), ['prNowPausedOne', 'prNowOne'])
      && P.nowWords(MIXED, mixed).tone === 'red'],
    ['…naming the agent on the machine that is working, and never the one that is stopped',
      (() => {
        const said = P.nowWords(MIXED, mixed);
        const running = said.clauses.find((c) => c.said.key === 'prNowOne');
        return eq(running.said.params,
                  { who: 'exCoder', title: 'Streak screen', machine: 'shed' })
          // The stopped agent is on the studio and is called `Gradle 8.6 bump`.
          // No clause that says work is running may name either: not the title,
          // and not the computer it is stopped on.
          && said.clauses.filter((c) => /^prNow(One|OneBare|Many)$/.test(c.said.key))
            .every((c) => !`${c.said.params.machine || ''} ${c.said.params.on || ''}`.includes('studio'))
          && said.clauses.every((c) => (c.said.params || {}).title !== 'Gradle 8.6 bump')
          // …while the clause about what is stopped names the computer it is
          // stopped on, which is the studio and only the studio.
          && said.clauses[0].said.params.on === 'studio';
      })()],
    ['…and the label takes the same word the product\u2019s card in the list puts in its corner',
      D.chip(mixed, NOW, ago).key === 'pcPaused' && P.nowWords(MIXED, mixed).tone === 'red'],
    ['…and "this machine has nothing left to run on" is the merge\u2019s own reading of it',
      (() => {
        // One exported rule (`divan.ts outOfQuota`), three readers: the merge's
        // own paused count, the Dashboard's agent roster and this row. A second
        // spelling of it is what let the row call a stopped worker a running one.
        const stopped = M.spent(MIXED);
        const held = MIXED.agents.filter((a) => !a.unknown && stopped.has(a.host));
        return stopped.size === 1 && stopped.has('h1') && held.length === mixed.paused
          && D.agentRows(MIXED).filter((r) => r.mark === '⏸').length === mixed.paused;
      })()],
    ['the two readings cannot disagree, on any of the fleets here',
      // `chip()` ranks a quiet machine over stopped agents over running work;
      // this row is ordered by the same rule, so where the corner is about
      // agents at all the tone is the corner's own colour.
      [[MIXED, 'kanji-daily'], [OUT, 'kanji-daily'], [GONE, 'kanji-daily'],
       [TWO, 'kanji-daily'], [ONE, 'kanji-daily'], [ONE, 'the-long-walk'], [ONE, 'pebble']]
        .every(([v, key]) => {
          const p = of(v, key);
          const corner = D.chip(p, NOW, ago).key;
          const tone = P.nowWords(v, p).tone;
          if (corner === 'pcStale') return tone === 'amber';
          if (corner === 'pcPaused') return tone === 'red';
          if (corner === 'pcRunning') return tone === 'run';
          // A corner about cards rather than agents (stuck, asking, yours) says
          // nothing about this row, and a quiet product's row is quiet too.
          return corner !== 'pcQuiet' || tone === null;
        })],

    // ── the same fleet, counted rather than named ─────────────────────────
    // One agent is named and several are counted, and the counting sentence has
    // to name the same machines the naming one does: "2 agents are running on
    // studio, shed" over a studio whose agents are stopped is the round-1 defect
    // wearing a plural.
    ['two agents at work beside one stopped agent are counted on the machine they are on',
      (() => {
        const p = of(MIXED_TWO, 'kanji-daily');
        const said = P.nowWords(MIXED_TWO, p);
        return p.running === 3 && p.paused === 1 && p.unknown === 0
          && eq(said.clauses.map((c) => c.said.key), ['prNowPausedOne', 'prNowMany'])
          && eq(said.clauses[1].said.params, { n: 2, on: 'shed' })
          && said.clauses[0].said.params.on === 'studio';
      })()],
    ['…and never on the machine that has nothing left to run on',
      (() => {
        const said = P.nowWords(MIXED_TWO, of(MIXED_TWO, 'kanji-daily'));
        return said.clauses.filter((c) => /^prNow(One|OneBare|Many)$/.test(c.said.key))
          .every((c) => !`${c.said.params.machine || ''} ${c.said.params.on || ''}`.includes('studio'));
      })()],
    ['two agents at work beside a machine that has gone quiet are counted on the one that answers',
      (() => {
        const p = of(QUIET_TWO, 'kanji-daily');
        const said = P.nowWords(QUIET_TWO, p);
        return p.machines.join(', ') === 'shed, mini' && p.unknown === 1
          && eq(said.clauses.map((c) => c.said.key), ['prNowUnknownOne', 'prNowMany'])
          // The clause before it has just said the mini has not answered; this
          // one must not put work on it.
          && said.clauses[0].said.params.on === 'mini'
          && eq(said.clauses[1].said.params, { n: 2, on: 'shed' });
      })()],
    ['a count with no agent behind it is placed on the machine that answers, not on the fleet',
      (() => {
        // A daemon older than the agent list sends the figure and no rows, so
        // there is no agent to name: the sentence says how many and where, and
        // "where" is still not the computer that has stopped.
        const said = P.nowWords(MIXED_BARE, of(MIXED_BARE, 'kanji-daily'));
        return eq(said.clauses.map((c) => c.said.key), ['prNowPausedOne', 'prNowOneBare'])
          && eq(said.clauses[1].said.params, { on: 'shed' });
      })()],
    ['…and with no machine left to run on it is a figure nobody can vouch for, not work',
      (() => {
        // The same older daemon on a machine that has since gone quiet: there is
        // nowhere the work could be happening, so the row does not say it is.
        const said = P.nowWords(LOST, of(LOST, 'kanji-daily'));
        return eq(said.clauses.map((c) => c.said.key), ['prNowUnknownBareOne'])
          && eq(said.clauses[0].said.params, { n: 1, on: 'mini' })
          && said.tone === 'amber';
      })()],
    ['…and a product running nothing names the computers that are answering',
      (() => {
        // "Nothing is running on cloud" about a computer that has not answered is
        // a claim about now that nobody can make either. Hush has a card on its
        // board, a commit this week and no agent: neither asleep nor new, so this
        // row is the one its page draws.
        const board = (o) => project('Hush', { kind: 'iOS', summary: 'private notes',
          repos: [o.repo], updated_at: o.updated_at, counts: { ice_box: 1 },
          branches: [branch('engineering', 'Engineering', { open: 1, cards: { ice_box: 1 } })] });
        const spread = view([
          paired('h1', 'studio', { reachable: true, at: NOW - 10,
            snapshot: snapshot('studio', { at: NOW - 10,
              projects: [board({ repo: '/r/hush', updated_at: NOW - 60 })],
              cards: [card('hc', { project: 'Hush-id', column: 'ice_box', title: 'Widget' })],
              activity: { '/r/hush': { at: NOW - 2 * DAY, week: 3, today: 0 } } }) }),
          paired('h9', 'cloud', { reachable: false, at: NOW - QUIET,
            snapshot: snapshot('cloud', { at: NOW - QUIET,
              projects: [board({ repo: '/r/hush-api', updated_at: NOW - 300 })] }) }),
        ]);
        const p = of(spread, 'hush');
        return p.machines.join(', ') === 'studio, cloud' && p.stale
          && !P.blank(p) && !D.dormant(p, NOW)
          && eq(P.nowWords(spread, p).clauses[0].said, { key: 'prNowIdle', params: { on: 'studio' } });
      })()],

    ['…and every state of the row is a sentence the table has, not a joined fragment',
      [[MIXED, 'kanji-daily'], [OUT, 'kanji-daily'], [GONE, 'kanji-daily'], [TWO, 'kanji-daily'],
       [ONE, 'kanji-daily'], [ONE, 'quire'], [ONE, 'the-long-walk'], [ONE, 'pebble']]
        .every(([v, key]) => P.nowWords(v, of(v, key)).clauses
          .every((c) => /^pr(Now|Wait)/.test(c.said.key)))],
  );
}

// ── 3 · …and what it is waiting for ─────────────────────────────────────────

{
  const wait = (p) => P.waitingWords(ONE, p);
  const hush = view([paired('h1', 'studio', { reachable: true, at: NOW,
    snapshot: snapshot('studio', { projects: [project('Hush', { waiting: 1,
      branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] })],
      cards: [card('s1', { project: 'Hush-id', executor: 'human', moved: NOW - DAY,
                           title: 'Write the onboarding email' })] }) })]);
  checks.push(
    ['nothing waiting is a sentence of its own, not a row that is missing',
      eq(wait(kanji).clauses, [{ said: { key: 'prWaitNothing' }, who: null }])
      && wait(kanji).tone === null],
    ['two things waiting are counted, in the colour of the worst of them',
      eq(wait(quire).clauses[0].said, { key: 'prWaitMany', params: { n: 2 } })
      && wait(quire).clauses.length === 1 && wait(quire).tone === 'red'],
    ['one thing that fell over is named, and is red',
      (() => {
        const one = { ...quire, cards: quire.cards.filter((c) => c.id === 'q2') };
        const said = P.waitingWords(view([STUDIO]), one);
        return said.tone === 'red';
      })()],
    ['one question is named, and is amber',
      (() => {
        const only = view([paired('h1', 'studio', { reachable: true, at: NOW,
          snapshot: snapshot('studio', { projects: [project('Quire', { waiting: 1,
            branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] })],
            cards: [card('q1', { project: 'Quire-id', status: 'asking', title: 'Webhook retry policy',
                                 detail: 'Keep 3 retries, or follow Stripe?' })] }) })]);
        const said = P.waitingWords(only, of(only, 'quire'));
        return eq(said.clauses[0].said,
                  { key: 'prWaitAsking', params: { who: 'exCoder', title: 'Webhook retry policy' } })
          && said.clauses[0].who === 'exCoder' && said.tone === 'amber';
      })()],
    ['a card that is nobody’s but yours names nobody: the reader is the one waiting',
      eq(P.waitingWords(hush, of(hush, 'hush')).clauses[0].said,
         { key: 'prWaitYours', params: { title: 'Write the onboarding email' } })
      && P.waitingWords(hush, of(hush, 'hush')).clauses[0].who === null],
    ['the one named is the one the Waiting screen would put at the top',
      (() => {
        const first = D.asks(ONE).filter((a) => a.card.projectKey === 'quire')[0];
        return first.card.id === 'q2';
      })()],
  );
}

// ── 4 · a machine of this product’s has gone quiet ─────────────────────────

{
  const kanjiTwo = of(GONE, 'kanji-daily');
  checks.push(
    ['a product every machine of which is answering says nothing about staleness',
      P.oldWords(quire, NOW, ago) === null],
    ['…and one with a quiet machine under it names it, and how old what follows is',
      P.oldWords(kanjiTwo, NOW, ago).key === 'prStale'
      && P.oldWords(kanjiTwo, NOW, ago).params.name === 'mini'
      && /^\d{2}:\d{2}$/.test(P.oldWords(kanjiTwo, NOW, ago).params.time)],
    ['…measured against the view’s own clock and not a second one',
      P.oldWords(kanjiTwo, NOW, ago).params.d === ago(D.staleFor(kanjiTwo, NOW))],
    ['…counting them where there is more than one to name',
      P.oldWords({ ...kanjiTwo, staleMachines: ['mini', 'cloud'] }, NOW, ago).key === 'prStaleMany'],
    ['…and saying so without a duration where the machine has never answered',
      P.oldWords({ ...kanjiTwo, lastSeen: null }, NOW, ago).key === 'prStaleBare'],
  );
}

// ── 5 · the product nothing has touched in weeks ────────────────────────────

{
  const said = P.quiet(walk, NOW, ago);
  checks.push(
    ['a product with nothing running and no commit for three weeks says how long',
      !!said && eq(said.title, { key: 'prQuietTitle', params: { n: 23 } })],
    ['…and what is still on its board, which is the thing a page of zeros hides',
      said.body.key === 'prQuietBodyCards' && said.body.params.n === 2],
    ['…with the board empty as well, it says only what it can',
      P.quiet({ ...walk, counts: {} }, NOW, ago).body.key === 'prQuietBody'],
    ['…and one card is one card, not "1 cards"',
      P.quiet({ ...walk, counts: { ice_box: 1 } }, NOW, ago).body.key === 'prQuietBodyOne'],
    ['a busy product is never called quiet',
      P.quiet(quire, NOW, ago) === null && P.quiet(kanji, NOW, ago) === null],
    ['…and the rule for it is the Dashboard’s own, so the card and the page agree',
      [quire, kanji, walk, pebble].every((p) => (P.quiet(p, NOW, ago) !== null) === D.dormant(p, NOW))],
    ['a product with no repository is not called quiet either: not knowing is not knowing',
      P.quiet(pebble, NOW, ago) === null && pebble.activity === null],
  );
}

// ── 6 · the product whose board is still empty ──────────────────────────────

{
  checks.push(
    ['a product with no card anywhere on it is the new-board state',
      P.blank(pebble) === true],
    ['…and a product with one card is not, wherever that card is',
      !P.blank(quire) && !P.blank(kanji) && !P.blank(walk)
      && !P.blank({ ...pebble, counts: { done: 1 } })
      && !P.blank({ ...pebble, branches: [branch('seo', 'SEO', { open: 1 })] })],
    ['…nor is a product that has stopped: that one has a history',
      !P.blank(walk) && P.quiet(walk, NOW, ago) !== null],
    ['what it says is how a first card is begun, and names no branch',
      eq(P.blankBody(), { key: 'prNewBodyBare' })],
  );
}

// ── 8 · the page itself, in both themes ─────────────────────────────────────

const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

function draw(scheme, hosts, key) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  if (key) R.params.set({ project: key });
  return R.render(scheme, h(Dashboard));
}

/** Every state this page can be in, which is what the last check of the theme
 *  loop renders all of. */
const PAGES = {
  'a product at work': [[STUDIO], 'quire'],
  'another product’s numbers in the same slots': [[STUDIO], 'kanji-daily'],
  'a product on a machine that has gone quiet': [[MINI], 'kanji-daily'],
  'a product spread over an answering machine and a quiet one': [[STUDIO, MINI], 'kanji-daily'],
  'a product out of quota': [[SPENT], 'kanji-daily'],
  'a product with one machine out of quota and another working': [[SPENT, ALSO], 'kanji-daily'],
  'two agents at work beside a stopped one': [[SPENT, SHED_TWO], 'kanji-daily'],
  'two agents at work beside a machine that has gone quiet': [[SHED_TWO, MINI], 'kanji-daily'],
  'a daemon that sends a count and no agent rows': [[SPENT, old('h4', 'shed', { reachable: true })], 'kanji-daily'],
  'a product nothing has touched in weeks': [[STUDIO], 'the-long-walk'],
  'a brand-new product': [[STUDIO], 'pebble'],
  'a product whose only machine never answered': [[STUDIO, NEVER], 'quire'],
  'a project that is no longer in the view': [[STUDIO], 'gone'],
  'nothing paired at all': [[], 'quire'],
};

const Branch = require(path.join(root, 'app/branch/[id].tsx')).default;

/** …and a link somebody kept to one branch of one of those products, which
 *  used to be a page and is now the way to the product. Returns where it led. */
function openBranch(hosts, key, kind, o = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    ready: o.ready !== false,
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  R.params.set({ ...(key ? { project: key } : {}), id: kind });
  R.render('dark', h(Branch));
  return R.nav.replaced();
}

/** The style the given word came out in, where a check is about a colour on one
 *  particular word rather than a colour being on the page at all. */
const styleOf = (markup, word) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)]
  .filter((m) => m[2] === word)
  .map((m) => JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")))[0];

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const page = draw(scheme, [STUDIO], 'quire');
  const four = draw(scheme, [STUDIO], 'kanji-daily');
  const asleep = draw(scheme, [STUDIO], 'the-long-walk');
  const fresh = draw(scheme, [STUDIO], 'pebble');
  const quiet = draw(scheme, [MINI], 'kanji-daily');
  const mixed = draw(scheme, [SPENT, ALSO], 'kanji-daily');
  const inked = (m, colour) => R.styles(m).some((s) => s.color === colour);

  checks.push(
    [`${scheme}: the head is the monogram, the name, the stage as a word in the meta line and the one sentence under it`,
      page.includes('>Quire<') && page.includes('SaaS · client portals for studios')
      && page.includes('pjSince') && page.includes('pjRunsOn')
      && R.styles(page).some((s) => s.width === 44 && s.height === 44)],
    [`${scheme}: …inside the place it is a page of, with the way back to every project on the line over it`,
      page.includes('tabDashboard') && page.includes('cmBackTo')],
    [`${scheme}: the segment is Overview, Board and Chats`,
      page.includes('>overview<') && page.includes('>bdBoard<') && page.includes('>pjChats<')],
    [`${scheme}: the board is four numbers off the columns, with In progress now under them in status words`,
      ['>bdIceBox<', '>bdQueued<', '>bdInProgress<', '>bdDone<'].every((w) => page.includes(w))
      && page.includes('>stRunning<')],
    [`${scheme}: a product with five branches of data draws no Branches section and no row for any of them`,
      quire.branches.length === 5
      && [page, four, asleep, fresh].every((m) => !/>branches<|>Branches<|pjNotConnected/.test(m))
      && ['Engineering', 'SEO', 'Analytics', 'Marketing', 'Customers'].every((name) => !page.includes(`>${name}<`))],
    [`${scheme}: another product draws the same page with its own numbers`,
      four.includes('>Kanji Daily<') && four.includes('iOS · Android · five kanji a day')],
    [`${scheme}: a product nothing has touched in weeks says so`,
      asleep.includes('prQuietTitle') && asleep.includes('prQuietBodyCards')],
    [`${scheme}: a brand-new product is a designed state and not an empty page, with no number in place of the cards`,
      fresh.includes('>prNewTitle<') && fresh.includes('>prNewBodyBare<')],
    [`${scheme}: a product with a quiet machine under it says which, and how old this is`,
      quiet.includes('prStale')],
    [`${scheme}: the colour on the page is a state with its word beside it`,
      inked(mixed, t.ink) && !/backdropFilter/.test(src('app/dashboard.tsx'))],
    [`${scheme}: every state this page can be in renders`,
      Object.entries(PAGES).every(([, [hosts, key]]) => {
        const markup = draw(scheme, hosts, key);
        return /tabDashboard|>divan</.test(markup);
      })],
  );
}

// ── 8b · not one colour of its own ──────────────────────────────────────────
//
// The page is built out of the design system's parts, and the check for that is
// not what it imports: it is what comes out. Every colour on it, in either theme
// and in every state, has to be one the artboards named.

{
  const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;
  for (const scheme of ['dark', 'light']) {
    const tok = K.tokensFor(scheme);
    const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR,
                         ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                         K.EXEC_PENDING_INK, K.EXEC_PENDING_LINE, 'transparent']);
    const strayed = new Set();
    const every = Object.values(PAGES).map(([hosts, key]) => () => draw(scheme, hosts, key));
    for (const page of every) {
      for (const v of R.paint(page())) {
        const inside = v.match(COLOUR) ?? [];
        for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) {
          if (!own.has(c)) strayed.add(c);
        }
      }
    }
    checks.push([`${scheme}: the whole page is drawn in the design's own colours${
      strayed.size ? ` (${[...strayed].join(', ')})` : ''}`, strayed.size === 0]);
  }
}

// ── 10 · the way in, and the way back out ───────────────────────────────────

{
  /** Press something on the Dashboard and draw what the address now says. The
   *  page is not a route of its own — the project being read is a parameter — so
   *  "tapping a chip opens the product" is a claim about a redraw and not about a
   *  push, and this is the only way to make it. */
  const enter = (find) => {
    draw('dark', [STUDIO], null);
    const found = R.presses().filter(find);
    if (found.length !== 1) throw new Error(`enter: ${found.length} of them`);
    found[0].press();
    return R.render('dark', h(Dashboard));
  };
  const viaTile = enter((p) => p.label === 'Quire');
  checks.push(
    ['tapping a product’s tile opens its page, and nothing is pushed',
      viaTile.includes('>Quire<') && viaTile.includes('>bdBoard<') && eq(R.nav.pushed(), [])],
    ['…and the way back out is the line’s left end, which is on the page',
      R.presses().some((p) => p.label === 'cmBackTo')],
    ['nothing on the page leads to a screen that is about a computer',
      !/'\/host-sheet'|'\/pool'|'\/accounts'|'\/screen'|'\/agents'/.test(src('app/dashboard.tsx'))],
  );
}

// ── 11 · the rules the page is written under ────────────────────────────────

{
  const screen = src('app/dashboard.tsx');
  const parts = src('src/components/project.tsx');
  const judgement = src('src/project.ts');
  const table = src('src/i18n.ts');
  const known = new Set([...table.matchAll(/([A-Za-z0-9_]+):\s*['"]/g)].map((m) => m[1]));
  const used = new Set([...judgement.matchAll(/'(pr[A-Za-z0-9]+)'/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !known.has(k));
  checks.push(
    ['the page is built out of the design system and nothing else',
      /from '\.\/divan'/.test(parts)
      && !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(parts)],
    ['…and its blocks take their colour from the token table rather than being handed one',
      /useTokens\(\)/.test(parts) && /toneColours\(/.test(parts)],
    ['what the page says is decided where a check can reach it, with no React in it',
      !/\brequire\(|from 'react/.test(judgement)
      && /export function nowWords/.test(judgement) && /export function waitingWords/.test(judgement)],
    [`every string it names is in the i18n table${missing.length ? ` (${missing.join(', ')})` : ''}`,
      used.size >= 20 && missing.length === 0],
    ['…and none of it was typed into the block that draws it',
      !/>[A-Z][a-z]+ [^<>{}]{3,}</.test(parts)],
    ['the chat is not touched by any of it',
      !/components\/chat|chat\//.test(parts) && !/chat/.test(judgement)],
  );

  // A judgement nothing calls is worse than no judgement: it is a rule that
  // reads as settled, has checks of its own, and is not the rule the product
  // follows.
  const exported = [...judgement.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const orphans = exported.filter((name) => {
    if (new RegExp(`\\b${name}\\b`).test(screen) || new RegExp(`\\b${name}\\b`).test(parts)) return false;
    return (judgement.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length <= 1;
  });
  checks.push([`every rule the module states is a rule the page follows${
    orphans.length ? ` (orphaned: ${orphans.join(', ')})` : ''}`, orphans.length === 0]);

  // The frames are outside the repository, so a citation cannot be followed by
  // a machine. These three files may cite the frames of this page and its board
  // (Mobile8 S7 since the Board tab, Mobile3 D1-D4 since the drag, Mobile8 S9
  // since the board's head has the way into it), and nothing else.
  const FRAMES = { V4: 'Mobile2', V5: 'Mobile2', S1: 'Mobile5', S2: 'Mobile5', S4: 'Mobile7',
                   S5: 'Mobile7', S6: 'Mobile7', S7: 'Mobile8', S9: 'Mobile8', S10: 'Mobile9',
                   S11: 'Mobile9', V1: 'Mobile1', V2: 'Mobile1', V3: 'Mobile1', S3: 'Mobile6',
                   D1: 'Mobile3', D2: 'Mobile3', D3: 'Mobile3', D4: 'Mobile3' };
  const bad = [];
  for (const [file, text] of [['src/project.ts', judgement], ['src/components/project.tsx', parts],
                              ['app/dashboard.tsx', screen]]) {
    const groups = [...text.matchAll(/\b(Mobile|Web)(\d+)\b/g)];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i][0];
      const from = groups[i].index + group.length;
      const until = Math.min(from + 90, i + 1 < groups.length ? groups[i + 1].index : text.length);
      const ids = [...text.slice(from, until).matchAll(/\b([DVTCSW]\d{1,2})\b/g)].map((m) => m[1]);
      if (!ids.length) bad.push(`${file}: ${group} names no frame`);
      for (const id of ids) {
        if (!FRAMES[id]) bad.push(`${file}: ${id} is not a frame this work may cite`);
        else if (FRAMES[id] !== group) bad.push(`${file}: ${group} ${id} is in ${FRAMES[id]}`);
      }
    }
  }
  checks.push([`every frame this page cites is a frame of the group it names${bad.length ? ` (${bad.join('; ')})` : ''}`,
    bad.length === 0]);
}

// ── 12 · the branches are gone from the phone ───────────────────────────────
//
// The Branches section and a branch's own page were taken off the phone. What
// is held here is that nothing on a product's page leads to one any more, that
// what was there beside them still works, and that a link somebody kept to a
// branch lands somewhere real: the product it named, or the Dashboard.

{
  const layout = src('app/_layout.tsx');
  const every = fs.readdirSync(path.join(root, 'app'), { recursive: true })
    .filter((f) => /\.tsx$/.test(f) && !/^branch[\\/]/.test(f))
    .map((f) => src(path.join('app', f)));
  const components = fs.readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((f) => /\.tsx?$/.test(f)).map((f) => src(path.join('src', f)));

  checks.push(
    ['no screen and no part of one pushes, replaces or links to a branch route',
      [...every, ...components].every((text) => !/['"`]\/branch\b/.test(text))],
    ['…and nothing pressable on any face of a product leads to one',
      ['', 'board', 'chats'].every((tab) => {
        draw('dark', [STUDIO], 'quire');
        if (tab) R.params.set({ tab });
        R.render('dark', h(Dashboard));
        const labels = R.presses().map((x) => `${x.label ?? ''} ${x.text ?? ''}`);
        return labels.length > 0 && labels.every((l) => !/branches|pjNotConnected/.test(l));
      })],
    ['what was beside the branches is still there to press: the board, a card at work and the segment',
      (() => {
        const page = draw('dark', [STUDIO], 'quire');
        const pressed = (find) => {
          draw('dark', [STUDIO], 'quire');
          const found = R.presses().filter(find);
          if (!found.length) throw new Error('nothing to press');
          found[0].press();
          return { pushed: R.nav.pushed(), params: R.params.get() };
        };
        const row = quire.cards.find((c) => page.includes(`>${c.title}<`));
        return !!row
          && pressed((x) => x.text === 'pjOpen').params.tab === 'board'
          && pressed((x) => x.text === 'pjChats').params.tab === 'chats'
          && eq(pressed((x) => x.text.includes(row.title)).pushed, [`/card/${row.id}?host=h1&from=project`]);
      })()],
    ['a link somebody kept to a branch lands on the product it named',
      eq(openBranch([STUDIO], 'quire', 'seo'), ['/dashboard?project=quire'])
      && eq(openBranch([STUDIO, MINI], 'kanji-daily', 'engineering'), ['/dashboard?project=kanji-daily'])],
    ['…whether or not the product still has a branch by that name',
      eq(openBranch([STUDIO], 'quire', 'design'), ['/dashboard?project=quire'])],
    ['…on the Dashboard where it named no product',
      eq(openBranch([STUDIO], null, 'seo'), ['/dashboard'])],
    ['…and a product that is no longer on this phone is the Dashboard as well, not a crash',
      (() => {
        const to = openBranch([STUDIO], 'gone', 'engineering');
        const landed = draw('dark', [STUDIO], 'gone');
        return eq(to, ['/dashboard?project=gone']) && landed.includes('>projects<') && landed.includes('>Quire<');
      })()],
    ['a phone with nothing paired is sent to pair, and one still reading its settings waits',
      eq(openBranch([], 'quire', 'engineering'), ['/welcome'])
      && eq(openBranch([STUDIO], 'quire', 'engineering', { ready: false }), [])],
    ['from the product a link led to, the line\u2019s left end is the Dashboard',
      (() => {
        const [to] = openBranch([STUDIO], 'quire', 'seo');
        draw('dark', [STUDIO], new URL(to, 'divan://x').searchParams.get('project'));
        const back = R.presses().filter((x) => x.label === 'cmBackTo');
        if (back.length !== 1) throw new Error(`${back.length} ways back`);
        back[0].press();
        const out = R.render('dark', h(Dashboard));
        return !R.params.get().project && out.includes('>projects<') && eq(R.nav.pushed(), []);
      })()],
    ['the route is still registered, so the link is not an unmatched one',
      /name="branch\/\[id\]"/.test(layout)],
    ['the branch page\u2019s own judgements and parts went with it',
      !fs.existsSync(path.join(root, 'src/branch.ts')) && !fs.existsSync(path.join(root, 'src/components/branch.tsx'))],
  );
}

R.store.reset();
R.params.reset();
R.nav.reset();

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
