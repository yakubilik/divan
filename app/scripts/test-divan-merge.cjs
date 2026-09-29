/** One Divan view across several computers, checked without a phone.
 *
 *  The thing being checked is a judgement, not a layout: two machines answer,
 *  one of them stops answering, and what a screen is then allowed to say. Every
 *  interesting case here is one that cannot be seen by looking at a simulator
 *  with one laptop on the same desk —
 *
 *    * a machine that has gone quiet must not vanish. Its cards were real and
 *      still are; dropping them would take five running agents off a dashboard
 *      and nobody would know;
 *    * …and it must not be presented as current either. It carries how long ago
 *      it was last heard from, and the counters built on top of it say they are
 *      incomplete;
 *    * a product checked out on two machines is one product. Two entries called
 *      isghocam, one with the site and one with the API, is the old
 *      machine-first reading of the world in a Divan screen's clothes;
 *    * and none of it depends on which computer the phone happens to hold a
 *      socket to. That is the whole point of the ticket: the machine used to be
 *      the top-level context, and now it is a detail of a running task.
 *
 *  `scripts/test-divan.cjs` is the design system's own file and is about the
 *  palette and the parts; this one is about the data behind them. Both are
 *  folded into `test-ustabasi.cjs`, so one command covers everything in the app
 *  that can be checked without a phone.
 *
 *  Run: node scripts/test-divan-merge.cjs
 */
const { transform } = require('sucrase');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function load(file, exports) {
  const js = transform(src(file), { transforms: ['typescript', 'imports'] }).code;
  const out = path.join(os.tmpdir(), 'rac-' + path.basename(file).replace(/\W/g, '-') + '.cjs');
  fs.writeFileSync(out, js + `\nmodule.exports={${exports.join(',')}};`);
  delete require.cache[out];
  return require(out);
}

const D = load('src/divan.ts', ['merge', 'entries', 'project', 'column', 'waiting', 'stuck',
                                'answered', 'silent', 'NO_DIVAN', 'DIVAN_POLL_MS',
                                'DIVAN_TIMEOUT_MS', 'STALE_AFTER_S', 'COLUMNS']);

// ── two computers, one of them asleep ───────────────────────────────────────
//
// The studio answered twelve seconds ago. The mini has not answered for two
// hours and fourteen minutes — the frame this was drawn from (Mobile5 S1) shows
// exactly that, because it is the ordinary case: a laptop with the lid shut.

const NOW = 1_700_000_000;
const QUIET = 2 * 3600 + 14 * 60;                      // 2h 14m

const branch = (kind, o = {}) => ({
  id: `${kind}-${o.on || 'x'}`, kind, name: kind, summary: o.summary || '',
  summary_at: o.summary_at ?? null, cards: o.cards || {}, open: o.open || 0,
});

const project = (name, o = {}) => ({
  id: o.id || `${name}-id`, name, slug: o.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  summary: o.summary || '', repos: o.repos || [], sort: 0, archived: false,
  created_at: 0, updated_at: o.updated_at || 0,
  branches: o.branches || [branch('engineering', { on: name })],
  counts: o.counts || {}, running: o.running || 0, waiting: o.waiting || 0,
  summary_line: o.summary_line || 'nothing running',
});

const card = (id, o = {}) => ({
  id, project_id: o.project || 'isghocam-id', branch_id: 'e', branch: 'engineering',
  column: o.column || 'in_progress', position: o.position || 0,
  title: o.title || id, summary: '', executor: o.executor ?? 'coding_agent',
  machine: o.machine ?? null, repo: o.repo ?? null, ustabasi_id: o.ticket ?? null,
  agent_status: o.status ?? null, agent_status_at: o.since ?? null, agent_detail: o.detail || '',
  created_at: 0, updated_at: 0, moved_at: null,
});

const agent = (card_id, o = {}) => ({
  card_id, project_id: o.project || 'isghocam-id', project: o.projectName || 'isghocam',
  branch: 'engineering', title: o.title || card_id, executor: 'coding_agent',
  machine: o.machine || '', status: 'running', detail: '', since: o.since ?? null,
  ustabasi_id: o.ticket ?? null,
});

const quota = (o = {}) => ({
  enabled: true, accounts: o.accounts ?? 2, blocked: o.blocked ?? 0,
  spent: !!o.spent, left: o.left ?? null, resets_at: o.resets_at ?? null,
  unknown: !!o.unknown,
});

/** One machine's answer. */
const snapshot = (machine, o = {}) => ({
  machine, os: 'Darwin', os_version: '15.3', daemon_version: '0.4.0',
  at: o.at ?? NOW, projects: o.projects || [], cards: o.cards || [],
  agents: o.agents || [], quota: o.quota ?? quota(), queue: o.queue || { available: true },
});

/** A paired computer, as the store keeps it: the last answer, when it arrived,
 *  and whether the last attempt to get one worked. */
const paired = (id, name, o = {}) => ({
  id, name,
  state: { snapshot: o.snapshot ?? null, at: o.at ?? null, reachable: !!o.reachable,
           error: o.error ?? null, old: !!o.old },
});

// isghocam is one product on two machines: the site is checked out on the studio
// and the API on the mini. Kanji Daily is only on the mini, babysee only on the
// studio.
const STUDIO = paired('h-studio', 'studio', {
  reachable: true, at: NOW - 12,
  snapshot: snapshot('studio', {
    at: NOW - 12,
    quota: quota({ left: 0.64, resets_at: NOW + 4 * 3600 + 44 * 60 }),
    projects: [
      project('isghocam', { repos: ['/p/isghocam'], updated_at: NOW - 600, running: 1, waiting: 1,
                            counts: { in_progress: 2, done: 3 },
                            branches: [branch('engineering', { on: 'studio', open: 2, cards: { in_progress: 2 } }),
                                       branch('seo', { on: 'studio' })] }),
      project('babysee', { repos: ['/p/babysee'], updated_at: NOW - 90, counts: { ice_box: 1 } }),
    ],
    cards: [
      card('c-site', { title: 'the header collapses on iPad', status: 'running', ticket: 41 }),
      card('c-ask', { title: 'which account should the beta use?', status: 'asking',
                      detail: 'Which account should the beta use?' }),
      card('c-idea', { project: 'babysee-id', column: 'ice_box', executor: null }),
    ],
    agents: [agent('c-site', { title: 'the header collapses on iPad', ticket: 41 })],
  }),
});

const MINI = paired('h-mini', 'mini', {
  reachable: false, at: NOW - QUIET, error: 'the computer is not reachable right now',
  snapshot: snapshot('mini', {
    at: NOW - QUIET,
    quota: quota({ left: 0.0, spent: true, blocked: 2, resets_at: NOW + 4 * 3600 }),
    projects: [
      project('isghocam', { id: 'isghocam-mini', repos: ['/w/isghocam-api'], updated_at: NOW - QUIET,
                            running: 1, counts: { in_progress: 1, queued: 1 },
                            branches: [branch('engineering', { on: 'mini', open: 2, cards: { in_progress: 1, queued: 1 } }),
                                       branch('seo', { on: 'mini', summary: 'rank 4 of 12', summary_at: NOW - QUIET })] }),
      project('Kanji Daily', { id: 'kanji-mini', updated_at: NOW - QUIET, running: 1,
                               counts: { in_progress: 1 } }),
    ],
    cards: [
      card('m-api', { project: 'isghocam-mini', title: 'the webhook retries for ever',
                      status: 'running', ticket: 77 }),
      card('m-next', { project: 'isghocam-mini', column: 'queued', position: 0 }),
      card('m-kanji', { project: 'kanji-mini', title: 'stroke order is wrong for 熊',
                        status: 'running', machine: 'mini', ticket: 78 }),
    ],
    agents: [
      agent('m-api', { project: 'isghocam-mini', title: 'the webhook retries for ever', ticket: 77 }),
      agent('m-kanji', { project: 'kanji-mini', projectName: 'Kanji Daily', machine: 'mini',
                         title: 'stroke order is wrong for 熊', ticket: 78 }),
    ],
  }),
});

const view = D.merge([STUDIO, MINI], NOW);
const host = (name) => view.hosts.find((h) => h.machine === name);
const isghocam = D.project(view, 'isghocam');

const checks = [
  // 1 · a snapshot per machine, merged into one view
  ['every paired machine is in the view', view.hosts.length === 2],
  ['the projects of both are in it',
    view.projects.map((p) => p.name).sort().join(',') === 'Kanji Daily,babysee,isghocam'],
  ['so are the cards of both', view.cards.length === 6],
  ['every card says which machine it came from',
    view.cards.every((c) => c.host && c.hostName) && view.cards.filter((c) => c.host === 'h-mini').length === 3],
  ['a card nobody assigned is attributed to the computer that carried it',
    view.cards.find((c) => c.id === 'm-api').machine === 'mini'
    && view.cards.find((c) => c.id === 'c-site').machine === 'studio'],
  ['a card that names its own machine keeps it',
    view.cards.find((c) => c.id === 'm-kanji').machine === 'mini'],
  ['every agent says which machine it is running on',
    view.agents.length === 3 && view.agents.every((a) => a.machine && a.host)],
  ['and every project which machines it lives on',
    view.projects.every((p) => p.machines.length > 0 && p.hosts.length > 0)],

  // 2 · freshness, per machine
  ['a machine that answered is reachable', host('studio').reachable === true],
  ['…and says how long ago that was', host('studio').age === 12],
  ['a machine that did not is not', host('mini').reachable === false],
  ['…and says how long it has been silent', host('mini').age === QUIET],
  ['…in words of its own rather than a bare flag',
    host('mini').error === 'the computer is not reachable right now'],
  ['a machine that has never answered is missing rather than unreachable', (() => {
    const v = D.merge([STUDIO, paired('h-new', 'cloud')], NOW);
    const h = v.hosts.find((x) => x.id === 'h-new');
    return h.missing === true && h.age === null && h.at === null && h.stale === false;
  })()],
  ['a machine the app pairs under one name still answers with its own', (() => {
    const v = D.merge([paired('h1', 'the laptop', { reachable: true, at: NOW, snapshot: snapshot('mini') })], NOW);
    return v.hosts[0].name === 'the laptop' && v.hosts[0].machine === 'mini';
  })()],
  ['an answer nobody has refreshed goes stale on its own', (() => {
    // Nothing failed: the app was in the background and the timer with it. Data
    // older than three polls is old whether or not anybody was told so.
    const old = paired('h1', 'studio', { reachable: true, at: NOW - D.STALE_AFTER_S - 1,
                                         snapshot: snapshot('studio') });
    const h = D.merge([old], NOW).hosts[0];
    return h.stale === true && h.reachable === false;
  })()],
  ['…but a fresh one does not', (() => {
    const h = D.merge([paired('h1', 'studio', { reachable: true, at: NOW - 12, snapshot: snapshot('studio') })], NOW).hosts[0];
    return h.stale === false && h.reachable === true;
  })()],
  ['a daemon too old for the request says so rather than reading as a dead machine', (() => {
    const h = D.merge([paired('h1', 'studio', { old: true, error: 'unknown request' })], NOW).hosts[0];
    return h.old === true && h.missing === true;
  })()],

  // 3 · a silent machine does not disappear, and nothing pretends it is current
  ['an unreachable machine keeps the projects it had',
    view.projects.some((p) => p.name === 'Kanji Daily')],
  ['…and the cards it had', view.cards.filter((c) => c.host === 'h-mini').length === 3],
  ['every one of them marked stale', view.cards.filter((c) => c.host === 'h-mini').every((c) => c.stale)],
  ['…and nothing of the live machine marked with it',
    view.cards.filter((c) => c.host === 'h-studio').every((c) => !c.stale)],
  ['a project that lives only on the silent machine says how old its numbers are',
    D.project(view, 'kanji-daily').stale === true
    && D.project(view, 'kanji-daily').lastSeen === NOW - QUIET],
  ['the totals say they are incomplete', view.totals.complete === false],
  ['…and how old the oldest of them is', view.totals.asOf === NOW - QUIET],
  ['an agent on a silent machine is not counted as running',
    view.totals.running === 1],
  ['…it is counted as unknown, which is the fourth tile on the frame',
    view.totals.unknown === 2 && view.agents.filter((a) => a.unknown).length === 2],
  ['…and it carries when it was last seen running',
    view.agents.filter((a) => a.unknown).every((a) => a.since_contact === NOW - QUIET)],
  ['a card waiting on a person still counts while its machine is quiet', (() => {
    // Nothing but a person answers a question, so a silent machine cannot have
    // answered it. This is the one figure that does carry across.
    const v = D.merge([MINI], NOW);
    return v.totals.needsYou === D.merge([MINI], NOW).cards.filter(D.waiting).length;
  })()],
  ['everything reachable is a complete view', (() => {
    const v = D.merge([STUDIO], NOW);
    return v.totals.complete === true && v.totals.unknown === 0;
  })()],
  ['no machines paired at all is not a complete view either',
    D.merge([], NOW).totals.complete === false],

  // 4 · one product, two machines
  ['a product checked out on two machines appears once',
    view.projects.filter((p) => p.name === 'isghocam').length === 1],
  ['…named once, and matched by the name both computers were given',
    isghocam.key === 'isghocam' && isghocam.hosts.length === 2],
  ['…carrying the repositories of both',
    isghocam.repos.join(',') === '/p/isghocam,/w/isghocam-api'],
  ['…and the machines it is on, in the order they were asked',
    isghocam.machines.join(',') === 'studio,mini'],
  ['its cards are all there, each attributed to the machine it runs on',
    isghocam.cards.length === 4
    && isghocam.cards.filter((c) => c.machine === 'studio').length === 2
    && isghocam.cards.filter((c) => c.machine === 'mini').length === 2],
  ['its counts are the two boards added up',
    isghocam.counts.in_progress === 3 && isghocam.counts.queued === 1 && isghocam.counts.done === 3],
  ['so are its agents and what it is waiting on',
    isghocam.running === 2 && isghocam.waiting === 1],
  ['a branch of it counts the work on both machines', (() => {
    const e = isghocam.branches.find((b) => b.kind === 'engineering');
    return e.cards.in_progress === 3 && e.cards.queued === 1 && e.open === 4;
  })()],
  ['…and says which machines that work is on', (() => {
    const e = isghocam.branches.find((b) => b.kind === 'engineering');
    return e.machines.join(',') === 'studio,mini';
  })()],
  ['a branch only one machine has anything to say about keeps what it said', (() => {
    const seo = isghocam.branches.find((b) => b.kind === 'seo');
    return seo.summary === 'rank 4 of 12';
  })()],
  ['the product is stale because one of its machines is, and names which',
    isghocam.stale === true && isghocam.staleMachines.join(',') === 'mini'],
  ['…and says how many of its agents are a memory rather than a state',
    isghocam.running === 2 && isghocam.unknown === 1],
  ['a product on a machine that has gone quiet altogether is all memory',
    D.project(view, 'kanji-daily').unknown === 1],
  ['every card and agent says which product it is work on, across both machines',
    view.cards.every((c) => c.projectKey) && view.agents.every((a) => a.projectKey)
    && view.cards.filter((c) => c.projectKey === 'isghocam').length === 4],
  ['…and says when that half of it was last true', isghocam.lastSeen === NOW - QUIET],
  ['a product on one machine only is not stale because another machine is',
    D.project(view, 'babysee').stale === false],
  ['a product can be found by the name a screen was opened on',
    D.project(view, 'isghocam') === D.project(view, 'ISGHOCAM')],
  ['two machines’ columns interleave by the position each person chose', (() => {
    // Position is per machine, so two people arranged two lists and there is no
    // true answer to "who is third". Position first, then the machine's name:
    // arbitrary, stable, and it does not shuffle under a thumb.
    const q = D.column(isghocam, 'in_progress').map((c) => c.id);
    return q.length === 3 && q.join(',') === 'm-api,c-site,c-ask';
  })()],

  // 5 · the quota of each machine, and of the fleet
  ['every machine carries its own quota', host('studio').quota.left === 0.64 && host('mini').quota.spent === true],
  ['…with the time it comes back', host('studio').quota.resets_at === NOW + 4 * 3600 + 44 * 60],
  ['the fleet has what its roomiest answering machine has', view.quota.left === 0.64],
  ['…and that machine’s own clock beside it',
    view.quota.resets_at === NOW + 4 * 3600 + 44 * 60],
  ['one machine out of quota is not a fleet out of quota', view.quota.spent === false],
  ['a machine that is out is named', (() => {
    // The mini's quota is two hours old, so it is not read at all: a reading
    // from a machine that has gone quiet says nothing about now.
    const v = D.merge([{ ...MINI, state: { ...MINI.state, reachable: true, at: NOW } }], NOW);
    return v.quota.spent === true && v.quota.spentMachines.join(',') === 'mini';
  })()],
  ['every machine out of quota is a fleet with a time and not a figure', (() => {
    const spent = (id, name, resets) => paired(id, name, {
      reachable: true, at: NOW,
      snapshot: snapshot(name, { quota: quota({ spent: true, left: 0, blocked: 2, resets_at: resets }) }),
    });
    const v = D.merge([spent('a', 'studio', NOW + 5 * 3600), spent('b', 'mini', NOW + 4 * 3600)], NOW);
    return v.quota.spent === true && v.quota.left === 0 && v.quota.resets_at === NOW + 4 * 3600;
  })()],
  ['an agent on a machine that is out of quota is paused, not running', (() => {
    const out = paired('h1', 'mini', {
      reachable: true, at: NOW,
      snapshot: snapshot('mini', { quota: quota({ spent: true, left: 0, resets_at: NOW + 3600 }),
                                   cards: [card('x', { status: 'running' })],
                                   agents: [agent('x')] }),
    });
    const t = D.merge([out], NOW).totals;
    return t.paused === 1 && t.running === 0;
  })()],
  ['a machine nothing has ever been measured on is not a machine at 0%', (() => {
    const v = D.merge([paired('h1', 'studio', { reachable: true, at: NOW,
      snapshot: snapshot('studio', { quota: quota({ left: null, unknown: true }) }) })], NOW);
    return v.quota.left === null && v.quota.unknown === true && v.quota.spent === false;
  })()],

  // 6 · nothing here is scoped to the computer the phone is holding
  ['the merge is a function of the paired machines and a clock, and nothing else',
    D.merge.length === 2],
  ['the same machines in the other order are the same view', (() => {
    const a = D.merge([STUDIO, MINI], NOW);
    const b = D.merge([MINI, STUDIO], NOW);
    return JSON.stringify(a.totals) === JSON.stringify(b.totals)
      && a.projects.map((p) => p.key).sort().join(',') === b.projects.map((p) => p.key).sort().join(',')
      && a.cards.length === b.cards.length;
  })()],
  ['a machine that is not the one the phone is connected to still shows its work',
    view.cards.some((c) => c.host === 'h-mini') && view.agents.some((a) => a.host === 'h-mini')],
  ['the view module never reads the active computer',
    !/activeHostId|switchHost|conn\b/.test(src('src/divan.ts'))],
  ['…and does not import the store or React to find one',
    !/from '\.\/store'|from 'react/.test(src('src/divan.ts'))],

  // 7 · the counters, and the rules under them
  ['a card that stopped to ask needs a person',
    D.waiting({ column: 'in_progress', agent_status: 'asking', executor: 'coding_agent' }) === true],
  ['so does one that was turned down',
    D.waiting({ column: 'in_progress', agent_status: 'failed', executor: 'coding_agent' }) === true],
  ['so does a card nothing runs on that somebody started',
    D.waiting({ column: 'in_progress', agent_status: null, executor: 'human' }) === true],
  ['a card in the Ice Box needs nobody yet',
    D.waiting({ column: 'ice_box', agent_status: null, executor: 'human' }) === false],
  ['a card somebody is finished with needs nobody',
    D.waiting({ column: 'done', agent_status: 'failed', executor: 'coding_agent' }) === false],
  ['a running card needs nobody',
    D.waiting({ column: 'in_progress', agent_status: 'running', executor: 'coding_agent' }) === false],
  ['stuck is the half of that which went wrong, not the half that asked',
    D.stuck({ agent_status: 'failed' }) === true && D.stuck({ agent_status: 'asking' }) === false],
  ['the counters are counted, not carried: one asking card is one needs-you',
    view.totals.needsYou === 1 && view.totals.stuck === 0],
  ['…and a queued card is counted once, wherever it is queued',
    view.totals.queued === 1],
  ['…and the machines are counted too',
    view.totals.machines === 2 && view.totals.reachable === 1],

  // 8 · what a poll does to a machine's entry, answered or not
  ['an answer is stamped with this end\u2019s clock, not the other end\u2019s', (() => {
    // Two computers' clocks are not the same clock, and "silent for 2h 14m" is
    // time this phone waited — the only figure it can measure honestly.
    const e = D.answered(snapshot('studio', { at: 5 }), NOW);
    return e.at === NOW && e.snapshot.at === 5 && e.reachable === true && e.error === null;
  })()],
  ['a daemon that answers with half the shape does not take a dashboard down', (() => {
    const e = D.answered({ machine: 'studio' }, NOW);
    return e.snapshot.projects.length === 0 && e.snapshot.cards.length === 0
      && e.snapshot.agents.length === 0 && e.snapshot.quota === null;
  })()],
  ['nothing at all is still a machine that answered', D.answered(null, NOW).reachable === true],
  ['a poll that failed keeps every card the last one brought', (() => {
    const was = D.answered(snapshot('mini', { cards: [card('m-api')] }), NOW - QUIET);
    const now = D.silent(was, 'the computer is not reachable right now');
    return now.snapshot === was.snapshot && now.at === NOW - QUIET
      && now.reachable === false && now.error === 'the computer is not reachable right now';
  })()],
  ['…and a machine that has never answered stays empty rather than becoming so', (() => {
    const e = D.silent(undefined, 'the computer is not reachable right now');
    return e.snapshot === null && e.at === null;
  })()],
  ['…and an old daemon is remembered as old, not as down',
    D.silent(null, 'unknown request', true).old === true],

  // 9 · worst first
  ['a product with something waiting on a person is first', view.projects[0].name === 'isghocam'],
  ['…then one whose numbers cannot be trusted, then the merely busy, then the rest', (() => {
    const p = (name, o) => paired(`h-${name}`, name, {
      reachable: o.stale !== true, at: o.stale ? NOW - QUIET : NOW,
      snapshot: snapshot(name, { at: NOW, projects: [project(o.project, { waiting: o.waiting || 0, running: o.running || 0, updated_at: NOW })] }),
    });
    const v = D.merge([p('a', { project: 'quiet' }), p('b', { project: 'busy', running: 2 }),
                       p('c', { project: 'old', stale: true }), p('d', { project: 'asked', waiting: 1 })], NOW);
    return v.projects.map((x) => x.name).join(',') === 'asked,old,busy,quiet';
  })()],
];

// ── the store keeps the snapshots, and keeps them across a switch ───────────
//
// The merged view is only honest if the thing it merges survives. Everything
// that belongs to one computer is wiped when the phone switches to another one
// (`perHost`), and a Divan snapshot in there would mean a dashboard that goes
// blank because somebody opened a terminal on the other machine.
const store = src('src/store.ts');
const perHost = store.slice(store.indexOf('const perHost = ()'), store.indexOf('function settleSwitch'));
const switching = store.slice(store.indexOf('function connectTo'), store.indexOf('async function persistHosts'));
const removeHost = store.slice(store.indexOf('removeHost: async'), store.indexOf('setDefaults: async'));

checks.push(
  ['the snapshots are kept per paired machine, not for the active one',
    /divan: Record<string, HostDivan>/.test(store)],
  ['switching computers does not wipe them', !/divan/.test(perHost) && !/divan/.test(switching)],
  ['unpairing a machine does drop its board', /delete divan\[id\]/.test(removeHost)],
  ['one snapshot per machine when a connection comes up',
    /void get\(\)\.loadDivan\(\);/.test(store)],
  ['the computer the phone is on is asked over the socket it already has',
    /client\.call<DivanSnapshot>\('divan\.snapshot'/.test(store)],
  ['…and every other machine on a socket of its own',
    /callOnce<DivanSnapshot>\(h\.host, h\.port, h\.token, 'divan\.snapshot'/.test(store)],
  ['every one of those requests is timed out',
    (store.match(/'divan\.snapshot', \{\}, DIVAN_TIMEOUT_MS\)/g) || []).length === 2],
  ['a machine with a poll already out is not asked twice',
    /if \(divanPolls\.has\(h\.id\)\) return;/.test(store)],
  ['nothing waits for one machine before asking the next',
    /await Promise\.all\(targets\.map/.test(store)],
  ['an answer is taken through the same reading the merge is checked against',
    /put\(answered\(snap, Date\.now\(\) \/ 1000\)\);/.test(store)],
  ['…and a failed poll through the one that keeps the last answer',
    /put\(silent\(get\(\)\.divan\[h\.id\], e\?\.message \?\? null, oldHost\(e\)\)\);/.test(store)],
  ['the board asks the computer for one thing and no more',
    [...store.matchAll(/'(divan\.[a-z.]+)'/g)].map((m) => m[1]).join(',') === 'divan.snapshot,divan.snapshot'],
);

// ── and the rule every Divan screen after this one is held to ──────────────
//
// Six of the eleven screens are still to be written, and the way this gets lost
// is one of them reaching for `activeHostId` because that is how every screen
// before Divan worked. So the rule is a check rather than a paragraph: a file
// that draws the merged view does not read which computer the phone is
// connected to. The store may, and only to decide which socket carries a
// request — the active machine is a transport, not a scope.
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const readers = [...walk('app'), ...walk('src')]
  .filter((f) => /\.tsx?$/.test(f))
  // `src/components/divan.tsx` is the design system and a different module; the
  // merged view is `src/divan.ts` and is imported as a path ending in `/divan`.
  .filter((f) => /from '(?:\.{1,2}\/)+(?:src\/)?divan'/.test(src(f)))
  .filter((f) => f !== path.join('src', 'store.ts'));
checks.push(
  ['something in the app draws from the merged view', readers.length > 0],
  [`no screen that draws it reads the active computer (${readers.join(', ')})`,
    readers.every((f) => !/activeHostId/.test(src(f)))],
);

const hook = src('src/queue.ts');
const ws = src('src/ws.ts');
checks.push(
  ['a screen that is open re-asks on a slow timer',
    /setInterval\(reload, DIVAN_POLL_MS\)/.test(hook) && D.DIVAN_POLL_MS >= 30_000],
  ['…and when the phone comes back to the foreground',
    /AppState\.addEventListener\('change', \(st\) => \{ if \(st === 'active'\) reload\(\); \}\)/.test(hook)],
  ['…while it is the screen being looked at, and not while it is buried',
    /useFocusEffect/.test(hook)],
  ['the poll is gentler than the ticket wall’s, which is one computer and one screen',
    D.DIVAN_POLL_MS > 8000],
  ['a request to a sleeping computer gives up in seconds, not in half a minute',
    D.DIVAN_TIMEOUT_MS <= 10_000 && /timeoutMs: number = DEFAULT_TIMEOUT_MS/.test(ws)],
  ['…and the timeout covers the whole round trip, handshake included',
    /const timer = setTimeout\(\(\) => finish\(\(\) => reject\(connError\('wsTimeout'\)\)\), timeoutMs\);/.test(ws)],
  ['the hook reads the paired list and the snapshots, and no active computer',
    /merge\(entries\(hosts, divan\), now\)/.test(hook)
    && !/activeHostId/.test(hook.slice(hook.indexOf('export function useDivan')))],
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
