/** The Dashboard, checked without a phone.
 *
 *  This is the screen the product exists for — the one that is opened instead of
 *  a question being asked — so what is checked here is not a layout. It is the
 *  four things the screen promises:
 *
 *    * **every figure on it was counted.** A dashboard that rounds, guesses or
 *      fills a gap with a dash is worse than no dashboard, because it is
 *      believed. A product whose repository nobody could read has no figure on
 *      its card, and a fourth counter with nothing behind it is not a fourth
 *      counter;
 *    * **a machine that has gone quiet is said out loud.** Its cards still count
 *      towards what a person has to do; what its agents are doing is a separate
 *      counter, and the title, the system line and the products that live there
 *      all say how old they are;
 *    * **the calm morning is a designed state.** Nothing needing anybody is what
 *      Mobile1 V3 draws in so many words, not the busy screen with the numbers
 *      at zero;
 *    * **and it draws at all** with a machine unreachable, with the quota spent,
 *      and with nothing paired — the three states a screen made of other
 *      computers' answers is actually in.
 *
 *  Half the checks are put to `src/dashboard.ts`, which is the judgement with no
 *  pixels in it; the other half stand the screen up for real through
 *  `render-divan.cjs`, in both themes, because "the counters match V1" is a
 *  claim about what comes out.
 *
 *  Run: node scripts/test-dashboard.cjs  (also folded into test-ustabasi.cjs, so
 *  one command covers everything.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const h = R.React.createElement;

const D = require(path.join(root, 'src/dashboard.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the fleet the frames draw ───────────────────────────────────────────────
//
// Three computers and five products, arranged as Mobile1 V1 and Mobile5 S1
// arrange them: a studio that answers, a mini that stopped answering two hours
// and fourteen minutes ago with a product that only lives there, and a third
// machine with nothing on it. Quire has an agent that was turned down and one at
// work, Hush has a card that is nobody's but yours, The Long Walk has not been
// touched in three weeks and Pebble has no repository at all.

// The clock is this moment rather than a round number: the screen ages a quiet
// machine against the phone's own `Date.now()`, so a fixture stamped in 2023
// would have every machine on it two years silent and every state on the screen
// would be the stale one.
const NOW = Math.floor(Date.now() / 1000);
const QUIET = 2 * 3600 + 14 * 60;
const HOUR = 3600;
const DAY = 24 * HOUR;

const branch = (kind) => ({ id: kind, kind, name: kind, summary: '', summary_at: null, cards: {}, open: 0 });
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), summary: '',
  repos: o.repos || [], sort: 0, archived: false, created_at: 0, updated_at: o.updated_at || NOW - 60,
  branches: [branch('engineering')], counts: o.counts || {},
  running: o.running || 0, waiting: o.waiting || 0, summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: 'e', branch: 'engineering', column: o.column || 'in_progress',
  position: 0, title: o.title || id, summary: '', executor: o.executor ?? 'coding_agent', machine: null,
  repo: null, ustabasi_id: o.ustabasi ?? null, agent_status: o.status ?? null,
  agent_status_at: o.at ?? null, agent_detail: o.detail || '', created_at: 0, updated_at: 0, moved_at: null,
});
const agent = (id, o = {}) => ({
  card_id: id, project_id: o.project, project: o.projectName || '', branch: 'engineering',
  title: o.title || id, executor: o.executor ?? 'coding_agent', machine: '', status: 'running',
  detail: o.detail || '', since: o.since ?? NOW - 600, ustabasi_id: o.ustabasi ?? null,
});
const quota = (o) => ({ enabled: true, accounts: 2, blocked: o.blocked || 0, spent: !!o.spent,
                        left: o.left ?? null, resets_at: o.resets_at ?? null, unknown: !!o.unknown });
const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: o.quota ?? null, activity: o.activity || {}, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: null, old: false } });

const studio = (o = {}) => paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', {
    at: NOW - 10,
    quota: 'quota' in o ? o.quota : quota({ left: 0.64, resets_at: NOW + 4 * HOUR }),
    projects: [project('Quire', { running: 2, waiting: 1, repos: ['/r/quire'] }),
               project('Hush', { waiting: 1, repos: ['/r/hush'] }),
               project('The Long Walk', { repos: ['/r/walk'] }),
               project('Pebble')],
    cards: [card('c1', { project: 'Quire-id', status: 'failed', ustabasi: 12,
                         title: 'Fix portal login on Safari 17', detail: 'Coder stuck on Safari login' }),
            card('c2', { project: 'Hush-id', executor: 'human', title: 'Write the onboarding email' }),
            card('c3', { project: 'Quire-id', status: 'running', ustabasi: 9,
                         title: 'Bulk CSV invite', detail: '3 of 5 checks' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', ustabasi: 9,
                           title: 'Bulk CSV invite', detail: '3 of 5 checks' })],
    // Quire moved three hours ago, Hush two days, The Long Walk three weeks —
    // and Pebble has no repository, so there is no entry for it anywhere.
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 3 },
                '/r/hush': { at: NOW - 2 * DAY, week: 2, today: 0 },
                '/r/walk': { at: NOW - 23 * DAY, week: 0, today: 0 } },
  }),
});

/** The laptop with the lid shut, and the one product that only lives on it. */
const MINI = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Kanji Daily', { running: 2, repos: ['/r/kanji'] })],
    cards: [card('k1', { project: 'Kanji Daily-id', status: 'running', title: 'Gradle 8.7 build' }),
            card('k2', { project: 'Kanji Daily-id', status: 'running', title: 'Deck sync' })],
    agents: [agent('k1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', title: 'Gradle 8.7 build' }),
             agent('k2', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', title: 'Deck sync' })],
    activity: { '/r/kanji': { at: NOW - 6 * HOUR, week: 9, today: 1 } } }),
});

const view = (hosts) => M.merge(hosts, NOW);
const BUSY = view([studio()]);
const STALE = view([studio(), MINI]);
const ago = (s) => (s == null ? '' : `${Math.floor(s / 60)}m`);

// ── 1 · the system line, in each of its three states ────────────────────────

{
  const healthy = D.systemLine(BUSY);
  const quiet = D.systemLine(STALE);
  const out = D.systemLine(view([studio({ quota: quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR }) })]));
  const nothing = D.systemLine(view([]));
  checks.push(
    ['the system line is healthy while every machine answers and there is quota left',
      healthy.state === 'healthy' && healthy.machines === 1 && healthy.unreachable === 0],
    ['…and carries the quota it was told, not a guess',
      healthy.quota.pct === 64 && healthy.quota.resets_at === NOW + 4 * HOUR && !healthy.quota.spent],
    ['a machine that has gone quiet turns the line and names that machine',
      quiet.state === 'unreachable' && quiet.unreachable === 1 && quiet.quiet.name === 'mini'],
    ['…with how long it has been silent, measured on this end’s clock',
      quiet.quiet.age === QUIET],
    ['…and its dot is the hollow one, the others filled',
      eq(quiet.dots.map((d) => d.reachable), [true, false])],
    ['a fleet with no quota left says so, and when it comes back',
      out.state === 'spent' && out.quota.spent && out.quota.pct === 0
      && out.quota.resets_at === NOW + 4 * HOUR],
    ['out of quota outranks a quiet machine: nothing runs either way, and only one of them has a clock',
      D.systemLine(view([studio({ quota: quota({ spent: true, left: 0 }) }), MINI])).state === 'spent'],
    ['a phone paired with nothing still has a line, and it says that',
      nothing.state === 'none' && nothing.machines === 0 && nothing.dots.length === 0],
    ['a quota nobody has ever measured is absent rather than 0%',
      D.systemLine(view([studio({ quota: quota({ unknown: true }) })])).quota === null
      && D.systemLine(view([studio({ quota: null })])).quota === null],
    ['the line is amber for a silent machine and red for no quota, and plain otherwise',
      D.systemTone(quiet) === 'amber' && D.systemTone(out) === 'red' && D.systemTone(healthy) === null],
  );
}

// ── 2 · the counters ────────────────────────────────────────────────────────

{
  const busy = D.counters(BUSY);
  const stale = D.counters(STALE);
  const spent = view([studio({ quota: quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR }) })]);
  const noGit = view([paired('h1', 'studio', { reachable: true, at: NOW,
    snapshot: snapshot('studio', { projects: [project('Pebble')], quota: quota({ left: 0.5 }) }) })]);
  checks.push(
    ['the first three counters are the frame’s own, in its order',
      eq(busy.slice(0, 3).map((c) => c.key), ['cNeedsYou', 'cStuck', 'cRunning'])],
    ['…counted, not guessed: two things need a person, one of them fell over',
      busy[0].value === 2 && busy[1].value === 1 && busy[2].value === 1],
    ['the fourth is what was finished today, out of git',
      busy[3].key === 'cDoneToday' && busy[3].value === 3],
    ['…and becomes the agents nobody can vouch for the moment a machine goes quiet',
      stale[3].key === 'cUnknown' && stale[3].value === 2 && stale[3].tone === 'amber' && stale[3].ring === true],
    ['…or the agents the quota stopped, when that is what happened',
      D.counters(spent)[3].key === 'cPaused' && D.counters(spent)[3].value === 1
      && D.counters(spent)[3].tone === 'red'],
    ['a machine that has gone quiet does not take its questions with it',
      STALE.totals.needsYou === BUSY.totals.needsYou],
    ['…but it does take what its agents were doing: they are unknown, not running',
      STALE.totals.running === 1 && STALE.totals.unknown === 2],
    ['with nothing to count and nothing wrong there are three tiles, not a fourth reading zero',
      D.counters(noGit).length === 3 && noGit.totals.doneToday === null],
  );
}

// ── 3 · what needs a person ─────────────────────────────────────────────────

{
  const list = D.asks(BUSY);
  checks.push(
    ['the questions are every card waiting on a person and nothing else',
      list.length === 2 && list.every((a) => M.waiting(a.card))],
    ['…worst first: the one that fell over before the one that is merely yours',
      eq(list.map((a) => a.state), ['stuck', 'yours'])],
    ['a stopped agent is quoted in the words it stopped in',
      list[0].question === 'Coder stuck on Safari login'],
    ['…and one that said nothing leaves the card’s own line standing, never a blank card',
      list[1].question === 'Write the onboarding email'],
    ['who is waiting is who the card is on',
      list[0].who === 'exCoder' && list[1].who === 'exYou'],
  );
}

// ── 4 · a project card carries the two figures that exist ───────────────────

{
  const of = (name) => BUSY.projects.find((p) => p.name === name);
  const quire = of('Quire');
  const walk = of('The Long Walk');
  const pebble = of('Pebble');
  const kanji = STALE.projects.find((p) => p.name === 'Kanji Daily');
  checks.push(
    ['a product’s figure is git’s: what landed in seven days, and when it last moved',
      quire.activity.week === 14 && quire.activity.at === NOW - 3 * HOUR],
    ['…summed across every repository it owns, on every machine it is on',
      (() => {
        const two = view([paired('h1', 'a', { reachable: true, at: NOW, snapshot: snapshot('a', {
                            projects: [project('isghocam', { repos: ['/r/site'] })],
                            activity: { '/r/site': { at: NOW - HOUR, week: 3, today: 1 } } }) }),
                          paired('h2', 'b', { reachable: true, at: NOW, snapshot: snapshot('b', {
                            projects: [project('isghocam', { repos: ['/r/api'] })],
                            activity: { '/r/api': { at: NOW - 2 * HOUR, week: 4, today: 2 } } }) })]);
        const p = two.projects[0];
        return p.repos.length === 2 && p.activity.week === 7 && p.activity.at === NOW - HOUR;
      })()],
    ['…and the same checkout on two machines is counted once, not twice',
      (() => {
        const same = view([paired('h1', 'a', { reachable: true, at: NOW, snapshot: snapshot('a', {
                             projects: [project('isghocam', { repos: ['/r/site'] })],
                             activity: { '/r/site': { at: NOW - HOUR, week: 5, today: 2 } } }) }),
                           paired('h2', 'b', { reachable: true, at: NOW, snapshot: snapshot('b', {
                             projects: [project('isghocam', { repos: ['/r/site'] })],
                             activity: { '/r/site': { at: NOW - HOUR, week: 5, today: 2 } } }) })]);
        return same.projects[0].activity.week === 5 && same.totals.doneToday === 2;
      })()],
    ['a product with no repository has no figure at all — not a zero one',
      pebble.activity === null && pebble.repos.length === 0],
    ['…and a daemon too old to send one leaves every product without it',
      view([paired('h1', 'old', { reachable: true, at: NOW,
        snapshot: snapshot('old', { projects: [project('Quire', { repos: ['/r/quire'] })] }) })])
        .projects[0].activity === null],
    ['the other figure is the board’s: what is running or waiting on it',
      quire.running === 2 && quire.waiting === 1
      && eq(D.marks(quire), [{ mark: 'stuck', n: 1 }, { mark: 'running', n: 1 }])],

    // The corner, worst first.
    ['a product whose agent was turned down says so, in red and with its mark',
      eq(D.chip(quire, NOW, ago), { mark: '■', key: 'pcStuck', params: { n: 1 }, tone: 'red' })],
    ['one that is nobody’s but yours is amber', D.chip(of('Hush'), NOW, ago).key === 'pcYours'],
    ['one on a machine that has gone quiet says how old it is, whatever it was running',
      D.chip(kanji, NOW, ago).key === 'pcStale' && D.chip(kanji, NOW, ago).mark === '◌'
      && D.chip(kanji, NOW, ago).params.d === ago(QUIET)],
    ['one that is simply running says how many', D.chip(of('Quire'), ago).tone === 'red'
      && D.chip({ ...quire, cards: [], waiting: 0, running: 2 }, NOW, ago).key === 'pcRunning'],
    ['and one nobody has touched in three weeks is quiet, with the weeks in its line',
      D.chip(walk, NOW, ago).key === 'pcQuiet' && D.dormant(walk, NOW)
      && eq(D.line(walk, NOW), { key: 'plDormant', params: { d: 23 } })],
    ['a product with no repository is never called dormant: not knowing is not knowing nothing happened',
      !D.dormant(pebble, NOW) && D.line(pebble, NOW).key === 'plIdle'],
    ['a product at work says where its agents are',
      eq(D.line(quire, NOW), { key: 'plRunning', params: { on: 'studio', n: 2 } })],
    ['…and one on a quiet machine says the state of them is a memory',
      D.line(kanji, NOW).key === 'plUnknown'],
    ['one whose agents the quota stopped says so, and when they pick up again',
      (() => {
        const c = D.chip({ ...quire, cards: [], waiting: 0, running: 3, paused: 3 }, NOW, ago);
        return c.key === 'pcPaused' && c.mark === '⏸' && c.tone === 'red' && c.params.n === 3;
      })()],
    ['a card off a quiet machine says when that machine last answered',
      eq(D.freshness(kanji, null), { key: 'pfLastSeen', params: { time: D.clock(kanji.lastSeen) } })],
    ['…one whose agents the quota stopped says when they pick up again',
      eq(D.freshness({ ...quire, stale: false, paused: 3 }, NOW + 4 * HOUR),
         { key: 'pfResume', params: { time: D.clock(NOW + 4 * HOUR) } })],
    ['…and one with nothing to say says nothing, rather than "live" on every card every morning',
      D.freshness(quire, NOW + 4 * HOUR) === null],
    ['a machine that has never answered at all has no clock to print, and prints none',
      D.freshness({ ...kanji, lastSeen: null }, null) === null],
    ['the line worth reading on a card is the worst card’s own',
      D.latest(quire) === 'Coder stuck on Safari login' && D.latest(walk) === ''],
  );
}

// ── 4b · the calm morning is a judgement, not an absence ──────────────────

{
  const still = view([studio({ quota: quota({ left: 0.6 }) })]);
  const out = view([studio({ quota: quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR }) })]);
  const easy = view([paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
    quota: quota({ left: 0.6 }), projects: [project('Quire', { running: 1, repos: ['/r/quire'] })],
    cards: [card('c3', { project: 'Quire-id', status: 'running', title: 'Bulk CSV invite' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire' })],
    activity: { '/r/quire': { at: NOW - HOUR, week: 14, today: 14 } } }) })]);
  checks.push(
    ['nothing needing anybody is the calm state', D.calm(easy) === true],
    ['…and something needing somebody is not', D.calm(still) === false],
    ['"all clear" is not said over agents nobody can vouch for', D.calm(STALE) === false],
    ['…nor over a fleet that ran out of quota an hour ago', D.calm(out) === false],
    ['…nor by a phone that is not paired with anything, which has its own words',
      D.calm(view([])) === false],
  );
}

// ── 5 · who is on what, where ───────────────────────────────────────────────

{
  const rows = D.agentRows(STALE);
  const spent = D.agentRows(view([studio({ quota: quota({ spent: true, left: 0 }) })]));
  checks.push(
    ['the roster is the agents at work, one line each', rows.length === 3],
    ['…the ones nobody can vouch for first, and marked as such',
      rows[0].mark === '◌' && rows[0].tone === 'amber' && rows[2].mark === '●'],
    ['…and an agent the quota stopped is neither running nor unknown',
      spent[0].mark === '⏸' && spent[0].tone === 'red'],
    ['each row knows which product’s colour it takes, so one product is one hue',
      rows.every((r) => r.index === STALE.projects.findIndex((p) => p.key === r.agent.projectKey))],
    ['tapping one opens what it is doing, when its queue is the one this phone holds',
      eq(D.target({ ustabasi_id: 9, host: 'h1', projectKey: 'quire' }, 'h1'), { ticket: 9 })],
    ['…and its product when the ticket belongs to another computer’s queue',
      eq(D.target({ ustabasi_id: 9, host: 'h2', projectKey: 'kanji-daily' }, 'h1'), { project: 'kanji-daily' })],
    ['…or when there is no ticket behind it at all',
      eq(D.target({ ustabasi_id: null, host: 'h1', projectKey: 'hush' }, 'h1'), { project: 'hush' })],
  );
}

// ── 6 · the screen itself, in both themes ───────────────────────────────────
//
// Everything above is the judgement. This is what comes out of it — and the
// states that cannot be seen by looking at a simulator with one laptop on the
// same desk are exactly the ones that are rendered here.

const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

/** The screen, against a given fleet, in a given theme. */
function draw(scheme, hosts, o = {}) {
  R.store.reset();
  R.params.reset();
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    loadDivan() {}, conn: 'online', ustabasi: o.ustabasi ?? null, ustabasiOld: false, loadUstabasi() {},
  });
  return R.render(scheme, h(Dashboard));
}

const CALM = [paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, quota: quota({ left: 0.64, resets_at: NOW + 4 * HOUR }),
    projects: [project('Quire', { running: 2, repos: ['/r/quire'] })],
    cards: [card('c3', { project: 'Quire-id', status: 'running', title: 'Bulk CSV invite' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', title: 'Bulk CSV invite' })],
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 14 } } }) })];

const SPENT = [paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    quota: quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR, blocked: 2 }),
    projects: [project('Quire', { running: 3, waiting: 1, repos: ['/r/quire'] })],
    cards: [card('c2', { project: 'Quire-id', executor: 'human', title: 'Write the onboarding email' }),
            card('c3', { project: 'Quire-id', status: 'running', title: 'Bulk CSV invite' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', title: 'Bulk CSV invite' })],
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 3 } } }) })];

/** A quiet machine and nothing waiting on a person. The state that caught the
 *  calm block out: every counter a person reads is zero, and two agents on the
 *  silent laptop are anything but clear. */
const QUIET_CALM = [paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, quota: quota({ left: 0.64, resets_at: NOW + 4 * HOUR }),
    projects: [project('Quire', { running: 1, repos: ['/r/quire'] })],
    cards: [card('c3', { project: 'Quire-id', status: 'running', ustabasi: 9, title: 'Bulk CSV invite' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', ustabasi: 9, title: 'Bulk CSV invite' })],
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 14 } } }) }), MINI];

/** …and the other one: the quota is gone and nothing is waiting on a person
 *  either, so the red block and the green block are both eligible. */
const SPENT_ONLY = [paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    quota: quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR, blocked: 2 }),
    projects: [project('Quire', { running: 1, repos: ['/r/quire'] })],
    cards: [card('c3', { project: 'Quire-id', status: 'running', title: 'Bulk CSV invite' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', title: 'Bulk CSV invite' })],
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 3 } } }) })];

/** Every fleet the screen is rendered against, by what it is a case of. */
const FLEETS = {
  busy: [studio()],
  'a machine gone quiet': [studio(), MINI],
  'quiet, and nothing waiting on a person': QUIET_CALM,
  'out of quota': SPENT,
  'out of quota, and nothing waiting on a person': SPENT_ONLY,
  calm: CALM,
  'nothing paired at all': [],
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const busy = draw(scheme, [studio()]);
  const stale = draw(scheme, [studio(), MINI]);
  const calm = draw(scheme, CALM);
  const spent = draw(scheme, SPENT);
  const empty = draw(scheme, []);
  const styles = (m) => R.styles(m);
  const painted = (m, colour) => styles(m).some((s) => s.backgroundColor === colour);
  const inked = (m, colour) => styles(m).some((s) => s.color === colour);

  checks.push(
    // V1 · the busy top
    [`${scheme}: the busy screen draws the counters, the questions and the projects`,
      ['cNeedsYou', 'cStuck', 'cRunning', 'cDoneToday', 'needsYou', 'projects', 'Quire', 'Hush']
        .every((word) => busy.includes(word))],
    [`${scheme}: …with the counters that are about a person in their own colours`,
      painted(busy, t.amberBg) && painted(busy, t.redBg)],
    // V2 · the cards and the roster
    [`${scheme}: every product has a card, and every agent at work a line`,
      busy.includes('agents') && busy.includes('exCoder') && busy.includes('Bulk CSV invite · 3 of 5 checks')],
    [`${scheme}: …each card carrying what git said and what the board says`,
      busy.includes('pfFinished') && busy.includes('14') && busy.includes('pcStuck')],
    [`${scheme}: …and a product with no repository is drawn without that figure rather than with an empty one`,
      busy.includes('Pebble') && (busy.match(/pfFinished/g) ?? []).length === 3
      && BUSY.projects.filter((p) => p.activity).length === 3],
    [`${scheme}: \u2026and that card is still a finished card: a name, a state, and no hole where the figure was`,
      (() => {
        const one = draw(scheme, [paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
          quota: quota({ left: 0.5 }), projects: [project('Pebble')] }) })]);
        return one.includes('Pebble') && one.includes('pcQuiet') && one.includes('plIdle')
          && !one.includes('pfFinished') && !one.includes('cDoneToday');
      })()],
    // V3 · the calm morning
    [`${scheme}: with nothing waiting the screen says so, in the frame's own words`,
      calm.includes('calmTitle') && painted(calm, t.runBg)],
    [`${scheme}: …and the busy screen does not say it`,
      !busy.includes('calmTitle') && !stale.includes('calmTitle')],
    // Mobile5 S1 · a machine unreachable
    [`${scheme}: a quiet machine turns the system line and explains itself above the counters`,
      stale.includes('sysUnreachable') && stale.includes('dashStale') && stale.includes('dashPartly')
      && painted(stale, t.amberBg)],
    [`${scheme}: …the fourth counter becomes the agents nobody can vouch for`,
      stale.includes('cUnknown') && !stale.includes('cDoneToday')],
    [`${scheme}: …and the product that lives there says when it was last seen`,
      stale.includes('pcStale') && stale.includes('pfLastSeen')],
    // Mobile5 S2 · out of quota
    [`${scheme}: no quota left is red, and says what stopped and when it starts again`,
      spent.includes('pausedTitle') && spent.includes('pausedBody') && spent.includes('sysQuotaSpent')
      && painted(spent, t.redBg)],
    [`${scheme}: …and the counter is what was paused, not what is running`,
      spent.includes('cPaused') && !spent.includes('cDoneToday')],
    // …and the two the calm block was drawn over. Both are "nothing needs you"
    // as far as the three counters a person reads are concerned, and in neither
    // of them is the screen entitled to say so.
    [`${scheme}: "all clear" is not said over a machine that has gone quiet with agents on it`,
      (() => {
        const m = draw(scheme, QUIET_CALM);
        return !m.includes('calmTitle') && m.includes('cUnknown') && m.includes('dashStale');
      })()],
    [`${scheme}: \u2026nor over a fleet that has run out of quota`,
      (() => {
        const m = draw(scheme, SPENT_ONLY);
        return m.includes('pausedTitle') && !m.includes('calmTitle')
          // …and the product whose agents were stopped says when they resume.
          && m.includes('pcPaused') && m.includes('pfResume');
      })()],
    // The screen and the rule are one thing, checked as one: `calm()` decides,
    // and this is every fleet above put through the screen to see that what it
    // decided is what came out. A guard written out a second time in the screen
    // is exactly how the block came to be drawn over a quiet machine's own
    // sentence, and it is this check that would have caught it.
    [`${scheme}: the calm block is drawn exactly when the rule says it is, in every state`,
      Object.entries(FLEETS).every(([, hosts]) =>
        draw(scheme, hosts).includes('calmTitle') === D.calm(view(hosts)))],

    // …and the states a screen made of other computers' answers is really in
    [`${scheme}: a phone paired with nothing draws the whole screen without throwing`,
      empty.includes('sysNoMachines') && empty.includes('dashEmpty') && empty.includes('tabDashboard')],
    [`${scheme}: …with no counters standing on numbers nobody counted`,
      !empty.includes('cDoneToday')],
    [`${scheme}: the system line is plain while all is well and coloured when it is not`,
      !painted(busy, t.amberBg + 'x') && inked(stale, t.amber) && inked(spent, t.red)],
  );
}

// ── 6b · not one colour of its own ────────────────────────────────
//
// The screen is built out of the design system's parts, and the check for that
// is not what it imports: it is what comes out. Every colour on the whole page,
// in either theme and in every state, has to be one the artboards named — the
// sixteen tokens, the two derived values, the monogram ramp and the white that
// sits on it. A single hand-picked grey would show up here.

{
  const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;
  for (const scheme of ['dark', 'light']) {
    const tok = K.tokensFor(scheme);
    const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR,
                         ...K.MONOGRAM, 'transparent']);
    const strayed = new Set();
    for (const markup of [draw(scheme, [studio()]), draw(scheme, [studio(), MINI]),
                          draw(scheme, CALM), draw(scheme, SPENT), draw(scheme, [])]) {
      for (const v of R.paint(markup)) {
        const inside = v.match(COLOUR) ?? [];
        for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) {
          if (!own.has(c)) strayed.add(c);
        }
      }
    }
    checks.push([`${scheme}: the whole screen is drawn in the design's own colours${
      strayed.size ? ` (${[...strayed].join(', ')})` : ''}`, strayed.size === 0]);
  }
}

// ── 7 · where a tap lands ───────────────────────────────────────────────────
//
// Pressed rather than read off the source: "tapping a project enters it" is a
// claim about a finger.

{
  const texts = (markup) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)].map((m) => ({
    style: JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")),
    text: m[2],
  }));
  const title = (markup) => (texts(markup).find((x) => x.style.fontSize === 26
    && x.style.fontFamily === 'Inter-SemiBold') ?? {}).text;

  draw('dark', [studio(), MINI]);
  const cardPress = R.presses().find((p) => p.text.includes('Quire') && p.text !== 'Quire'
    && p.text.includes('pfFinished'));
  cardPress.press();
  checks.push(['tapping a project card enters that project',
    title(R.render('dark', h(Dashboard))) === 'Quire']);

  // …and an agent row opens what that agent is doing. The one on this phone's
  // own computer has a ticket behind it — the run itself, as the model prints
  // it — and that is a route rather than anything visible in the markup it left,
  // so the push is recorded. The one on the machine that has gone quiet has a
  // queue this phone cannot read, and enters its product instead.
  R.params.reset();
  R.nav.reset();
  draw('dark', [studio(), MINI]);
  const rows = R.presses().filter((p) => p.text.startsWith('◌') || p.text.startsWith('●'));
  checks.push(['there is a line for every agent at work, and every one of them is pressable',
    rows.length === 3]);
  rows.find((p) => p.text.startsWith('●')).press();
  checks.push(['an agent on this phone’s own computer opens the run it is printing',
    eq(R.nav.pushed(), ['/ticket/9'])]);

  R.nav.reset();
  R.params.reset();
  draw('dark', [studio(), MINI]);
  R.presses().filter((p) => p.text.startsWith('◌'))[0].press();
  checks.push(['an agent on a machine that has gone quiet enters its product instead',
    title(R.render('dark', h(Dashboard))) === 'Kanji Daily' && eq(R.nav.pushed(), [])]);
  R.store.reset();
  R.params.reset();
  R.nav.reset();
}

// ── 8 · the rules the screen is written under ───────────────────────────────

{
  const screen = src('app/dashboard.tsx');
  const parts = src('src/components/dashboard.tsx');
  const judgement = src('src/dashboard.ts');
  checks.push(
    ['the Dashboard is built out of the design system and nothing else',
      /from '\.\.\/src\/components\/divan'/.test(screen)
      && /from '\.\/divan'/.test(parts)
      && !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(parts) && !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(screen)],
    ['…and its blocks take their colour from the token table rather than being handed one',
      /useTokens\(\)/.test(parts) && /toneColours\(/.test(parts)],
    ['what the screen says is decided where a check can reach it, with no React in it',
      !/\brequire\(|from 'react/.test(judgement) && /export function systemLine/.test(judgement)
      && /export function counters/.test(judgement)],
    ['the chat is not touched by any of it',
      !/components\/chat|chat\//.test(screen) && !/components\/chat/.test(parts)],
    ['nothing on the Dashboard leads to a screen that is about a computer',
      !/'\/host-sheet'|'\/pool'|'\/accounts'|'\/screen'|'\/agents'/.test(screen)],
  );

  // A judgement nothing calls is worse than no judgement: it is a rule that
  // reads as settled, has checks of its own, and is not the rule the product
  // follows. `calm()` was exactly that for a round — written, tested and never
  // imported, while the screen kept a shorter copy of it beside the block. So
  // every judgement this module exports has to be reached: called by the screen
  // or by one of its blocks, or called by another judgement in here.
  const exported = [...judgement.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const orphans = exported.filter((name) => {
    if (new RegExp(`\\b${name}\\b`).test(screen) || new RegExp(`\\b${name}\\b`).test(parts)) return false;
    // …or something else in here calls it, which is more than its own definition.
    return (judgement.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length <= 1;
  });
  checks.push(
    [`every rule the module states is a rule the screen follows${
      orphans.length ? ` (orphaned: ${orphans.join(', ')})` : ''}`, orphans.length === 0],
    ['…and there are enough of them in it to be worth saying', exported.length >= 12],
  );
}

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
