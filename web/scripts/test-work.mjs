#!/usr/bin/env node
/** Work (`/work`): every ticket the queue is on, across every project, as one
 *  board — narrowed by days, a search and a project — whose cards can be
 *  moved, which asks the queue.
 *
 *     cd web && npm test
 *
 *  Two halves. First `lib/work.ts` on its own: a snapshot with a ticket in
 *  every state on three projects — one on a Divan board, two on none — some
 *  finished today, yesterday, this week and weeks ago, and exactly which cards
 *  land in which column for each preset, two dates, a search and a project;
 *  which queue call each move between columns is, or why there is none; and
 *  the `ustabasi priority` calls a new place in Queued takes.
 *  Then the whole panel mounted into jsdom the way `test-nav.mjs` mounts it,
 *  its computer answering through a faked `call` (the socket's one door) that
 *  writes down every cancel, restart and priority asked of it: /work and the
 *  old `?view=` / `?group=` links opening as the Board; each filter driven and
 *  kept in the address through Back, a reload and a cold link; a card opening
 *  its ticket and Back returning to the same filters; every allowed drag —
 *  mouse and finger — making exactly its call and every refused one making
 *  none; the Move to… menu by keyboard; and a new snapshot redrawing the board.
 *
 *  The clock is set to noon today, so that "today", "yesterday" and the time
 *  a ticket finished are the same words whenever this runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'work');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

if (!process.env.WORK_REUSE) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
    'src/App.tsx', 'src/vite-env.d.ts',
    '--outDir', '.test-build/work', '--rootDir', '.',
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
  mkdirSync(join(out, 'src', 'assets'), { recursive: true });
  for (const f of readdirSync(join(web, 'src', 'assets'))) {
    if (f.endsWith('.png')) writeFileSync(join(out, 'src', 'assets', `${f}.js`), `export default ${JSON.stringify(`/assets/${f}`)};\n`);
  }
}

// ── a document ──────────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/', pretendToBeVisual: true,
});
const w = dom.window;
for (const name of Object.getOwnPropertyNames(w)) {
  if (name in globalThis) continue;
  try { globalThis[name] = w[name]; } catch { /* not ours */ }
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
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
  if (!globalThis[name]) {
    globalThis[name] = class { observe() {} unobserve() {} disconnect() {} };
    w[name] = globalThis[name];
  }
}
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function scrollIntoView() {};
w.open = () => null;
process.on('unhandledRejection', () => {});

// Noon today, moving on from there in real time.
const realNow = Date.now.bind(Date);
const noon = new Date(); noon.setHours(12, 0, 0, 0);
const started = realNow();
Date.now = () => noon.getTime() + (realNow() - started);

const load = (p) => import(pathToFileURL(join(out, p)).href);
const W = await load('src/lib/work.js');
const { workPoll, workHold } = await load('src/screens/Work.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { ticket: base } = await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);
const { host: fixtureHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

// ── the queue ───────────────────────────────────────────────────────────────

const NOW = Date.now() / 1000;
const H = 3600;
const D = 86400;
/** A ticket in a project, `ago` seconds since it last moved. */
const t = (id, project, status, over = {}) => base({
  id, project, status, title: `${project} ticket ${id}`, repo: `/Users/x/projects/${project}`,
  stage: 'worker', round: 1, created_at: NOW - 7200, updated_at: NOW - id, started_at: NOW - 3600,
  round_started_at: NOW - 600,
  finished_at: ['done', 'cancelled', 'failed'].includes(status) ? NOW - 60 : null,
  escalation: '', ask: '', notes: [], note_count: 0, steps: [], priority: 5,
  last_event: { ts: NOW - 30, kind: 'report', msg: `[worker] progress on ${id}` },
  ...over,
});

/** Three projects, a ticket in each state, and finished ones of every age.
 *  Quire is on a Divan board (#41 is card k1 on it); nl-artsen and
 *  isghocam-seo are on none. */
const queue = () => [
  t(41, 'quire', 'running'),
  t(42, 'quire', 'blocked', { escalation: '- which key?' }),
  t(43, 'quire', 'done', { merged: 'merged into main (abc1234)',
    last_event: { ts: NOW - 50, kind: 'clean', msg: 'worktree removed (auto)' } }),
  t(44, 'quire', 'queued', { started_at: null, round_started_at: null, updated_at: NOW - 26 * H,
    last_event: { ts: NOW - 26 * H, kind: 'created', msg: 'quire ticket 44' } }),
  t(305, 'quire', 'done', { finished_at: NOW - 10 * D, merged: null }),
  t(46, 'nl-artsen', 'queued', { started_at: null, round_started_at: null, updated_at: NOW - H,
    last_event: { ts: NOW - H, kind: 'created', msg: 'nl-artsen ticket 46' } }),
  t(201, 'nl-artsen', 'queued', { last_event: { ts: NOW - 20, kind: 'limit', msg: 'account main limited until 17:05; waiting it out' } }),
  t(202, 'nl-artsen', 'failed', { finished_at: NOW - 25 * H,
    last_event: { ts: NOW - 25 * H, kind: 'failed', msg: 'check failed three times' } }),
  t(203, 'nl-artsen', 'cancelled', { finished_at: NOW - 3 * D }),
  t(204, 'nl-artsen', 'queued', { last_event: { ts: NOW - 20, kind: 'waiting', msg: 'worker is waiting 30m (until 18:00): CI' } }),
  t(306, 'nl-artsen', 'done', { finished_at: NOW - 20 * D }),
  t(301, 'isghocam-seo', 'queued', { depends_on: 302, started_at: null, round_started_at: null,
    last_event: { ts: NOW - 20, kind: 'depends', msg: 'waits for #302' } }),
  t(302, 'isghocam-seo', 'running', { stage: 'check', round: 2 }),
  t(303, 'isghocam-seo', 'queued', { started_at: null, round_started_at: null, last_event: null, goal: 'Write the sitemap.' }),
  // From a daemon too old to say `merged`: its last event says it instead.
  t(304, 'isghocam-seo', 'done', { finished_at: NOW - 6 * D,
    last_event: { ts: NOW - 6 * D, kind: 'merge', msg: 'merged into main (def5678)' } }),
];
const ids = (list) => list.map((f) => f.ticket.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...list].sort((a, b) => a - b);

// ── 1 · which cards, in what order, in which words ──────────────────────────

group('which tickets are in flight, across three projects');
{
  const snap = { available: true, tickets: queue(), queue: { last_tick: NOW } };
  const rows = W.flights('studio', snap, NOW);
  const got = sorted(ids(rows));
  ok('running, queued, waiting and needs-you are in flight; done, failed and cancelled are not',
    same(got, [41, 42, 44, 46, 201, 204, 301, 302, 303]), JSON.stringify(got));
  const phase = Object.fromEntries(rows.map((f) => [f.ticket.id, `${f.phase}:${f.word}`]));
  ok('each says where it stands: red, running, parked for a reason, or next in line',
    phase[42] === 'red:needs you'
    && phase[41] === 'running:running' && phase[302] === 'running:running'
    && phase[201] === 'waiting:usage limit' && phase[204] === 'waiting:worker waiting'
    && phase[301] === 'waiting:waits for #302'
    && phase[44] === 'queued:queued' && phase[303] === 'queued:queued', JSON.stringify(phase));
  const r302 = rows.find((f) => f.ticket.id === 302);
  ok('a card carries its project, stage and round, this round\'s age and the ticket\'s',
    r302.meta === 'isghocam-seo · check r2 · 10m in this round · open 2h 0m', r302.meta);
  ok('…and the last event in one line, without the log\'s tag',
    rows.find((f) => f.ticket.id === 41).line === 'progress on 41'
    && rows.find((f) => f.ticket.id === 303).line === 'Write the sitemap.');
  const paused = W.flights('studio', { ...snap, queue: { paused_until: NOW + 600 } }, NOW);
  ok('a queue paused for a limit parks every queued ticket on that computer',
    paused.find((f) => f.ticket.id === 44).word === 'usage limit');
  ok('a computer with no queue adds no cards',
    W.flights('studio', { available: false, tickets: [] }, NOW).length === 0 && W.flights('studio', null, NOW).length === 0
    && W.finished('studio', null, NOW).length === 0);
}

group('what finished: how, when, and whether it was merged');
{
  const snap = { available: true, tickets: queue() };
  const all = W.finished('studio', snap, NOW);
  ok('every finished ticket, whatever its age — the date picker narrows them',
    same(sorted(ids(all)), [43, 202, 203, 304, 305, 306]), JSON.stringify(ids(all)));
  const by = Object.fromEntries(all.map((f) => [f.ticket.id, f]));
  ok('each says how it ended', by[43].word === 'done' && by[202].word === 'failed' && by[203].word === 'cancelled');
  ok('…and when', by[43].when === 'today 11:59' && by[202].when === 'yesterday 11:00', `${by[43].when} · ${by[202].when}`);
  ok('…and whether it was merged: the snapshot\'s word, or an older daemon\'s last event',
    by[43].merged && by[304].merged && !by[202].merged && !by[203].merged);
}

const everything = (tickets = queue()) => {
  const snap = { available: true, tickets };
  return [...W.flights('studio', snap, NOW), ...W.finished('studio', snap, NOW)];
};
const board = (rows) => W.boardColumns(rows).map((g) => `${g.title}: ${ids(g.rows).join(',')}`);
const narrow = (range, q = '', project = null) => {
  const span = W.spanOf(range, NOW);
  return everything().filter((f) => W.within(f, span) && W.matches(f, q) && (!project || f.project === project));
};
const BOARD7 = [
  'Queued: 44,46,303', 'Waiting: 201,204,301', 'In progress: 41,302', 'Needs you: 42',
  'Done: 43,304', 'Failed: 202', 'Cancelled: 203',
];

group('the board: a column per status, Queued in the queue\'s own order');
{
  ok('one column per status, in the order a ticket moves, every ticket in its own',
    same(board(narrow(null)), BOARD7), JSON.stringify(board(narrow(null))));
  const reordered = everything(queue().map((x) => (x.id === 303 ? { ...x, priority: 1 } : x.id === 44 ? { ...x, priority: 9 } : x)));
  ok('Queued is `ORDER BY priority, id`, which is what the queue picks next',
    board(reordered)[0] === 'Queued: 303,46,44', board(reordered)[0]);
  ok('…a ticket from a daemon that sends no priority counts as 5',
    board(everything(queue().map((x) => (x.id === 46 ? { ...x, priority: undefined } : x.id === 44 ? { ...x, priority: 6 } : x))))[0]
      === 'Queued: 46,303,44');
  const empty = W.boardColumns(W.flights('studio', { available: true, tickets: [t(9, 'a', 'running')] }, NOW));
  ok('…every column drawn even when it is empty', empty.length === 7 && empty.filter((c) => c.rows.length === 0).length === 6);
  const card = (id) => W.cardMeta(everything().find((f) => f.ticket.id === id), NOW);
  ok('a card says project, stage and round or how it ended, and age',
    card(302) === 'isghocam-seo · check r2 · open 2h 0m' && card(43) === 'quire · done today 11:59 · merged',
    `${card(302)} · ${card(43)}`);
}

const today = W.dayKey(NOW);
const daysAgo = (n) => W.dayKey(NOW - n * D);
group('the date picker: finished by finished_at, in flight by last activity');
{
  const s7 = W.spanOf(null, NOW);
  ok('the default is the last seven days, today the last of them',
    s7.first === daysAgo(6) && s7.last === today, `${s7.first}..${s7.last}`);
  ok('…and it holds exactly these cards', same(board(narrow(null)), BOARD7));
  ok('Today: what moved or finished since midnight — #44 last moved yesterday, #202 failed yesterday',
    same(board(narrow('today')), [
      'Queued: 46,303', 'Waiting: 201,204,301', 'In progress: 41,302', 'Needs you: 42',
      'Done: 43', 'Failed: ', 'Cancelled: ',
    ]), JSON.stringify(board(narrow('today'))));
  ok('30 days: the ones ten and twenty days old join Done',
    board(narrow('30d'))[4] === 'Done: 43,304,305,306', board(narrow('30d'))[4]);
  const custom = `${daysAgo(3)}..${daysAgo(1)}`;
  ok('two dates, both whole days: three days ago to yesterday',
    same(board(narrow(custom)), [
      'Queued: 44', 'Waiting: ', 'In progress: ', 'Needs you: ', 'Done: ', 'Failed: 202', 'Cancelled: 203',
    ]), JSON.stringify(board(narrow(custom))));
  ok('…the span says its own days', W.spanOf(custom, NOW).first === daysAgo(3) && W.spanOf(custom, NOW).last === daysAgo(1));
  ok('in words', W.rangeWords(null) === 'in the last 7 days' && W.rangeWords('today') === 'today'
    && W.rangeWords('30d') === 'in the last 30 days' && /^between \d+ \w+ and \d+ \w+$/.test(W.rangeWords(custom)),
    W.rangeWords(custom));
}

group('the search box: #id, title, project and last event, as you type');
{
  const hit = (q) => sorted(ids(narrow(null, q)));
  ok('#302 is that ticket and no other — not #301, whose last event says "waits for #302"',
    same(hit('#302'), [302]), JSON.stringify(hit('#302')));
  ok('…#30 while it is being typed is every number that starts so', same(hit('#30'), [301, 302, 303, 304]), JSON.stringify(hit('#30')));
  ok('a title', same(hit('ticket 46'), [46]), JSON.stringify(hit('ticket 46')));
  ok('a project', same(hit('NL-ARTSEN'), [46, 201, 202, 203, 204]), JSON.stringify(hit('NL-ARTSEN')));
  ok('the last event', same(hit('limited'), [201]) && same(hit('sitemap'), [303]), `${hit('limited')} · ${hit('sitemap')}`);
  ok('every word has to be there', same(hit('quire progress'), [41, 42]), JSON.stringify(hit('quire progress')));
  ok('…and an empty box is everything', hit('  ').length === 13);
}

group('the project picker: every project in the snapshot, with counts');
{
  const all = everything();
  const counts = (q) => W.projectCounts(all, narrow(null, q)).map((c) => `${c.name} ${c.count}`);
  ok('A to Z, each counted as the days and the search stand',
    same(counts(''), ['isghocam-seo 4', 'nl-artsen 5', 'quire 4']), JSON.stringify(counts('')));
  ok('…and one with nothing to show is still in the list', same(counts('sitemap'), ['isghocam-seo 1', 'nl-artsen 0', 'quire 0']),
    JSON.stringify(counts('sitemap')));
}

group('every card is tinted by where it stands');
{
  const tints = Object.fromEntries(W.boardColumns(narrow(null)).map((g) => [g.key, [...new Set(g.rows.map(W.tintOf))].join(',')]));
  ok('done green, needs you amber, failed red, running the accent; queued, waiting and cancelled grey',
    same(tints, { queued: 'grey', waiting: 'grey', running: 'running', blocked: 'ask', done: 'done', failed: 'failed', cancelled: 'grey' }),
    JSON.stringify(tints));
}

group('the head line counts in words');
{
  ok('the last seven days', W.headLine(narrow(null), null)
    === '2 running · 1 needs you · 3 waiting · 3 queued · 2 done, 1 failed and 1 cancelled in the last 7 days',
  W.headLine(narrow(null), null));
  ok('…thirty', W.headLine(narrow('30d'), '30d').endsWith('4 done, 1 failed and 1 cancelled in the last 30 days'));
  ok('…and nothing at all is one sentence', W.nothing(null) === 'Nothing moved and nothing finished in the last 7 days.');
}

group('a card moved to another column: which queue call, or why none');
{
  const f = Object.fromEntries(everything().map((x) => [x.ticket.id, x]));
  const say = (m) => (m.kind === 'refuse' ? 'refuse' : m.kind === 'cancel' ? `cancel${m.confirm ? '?' : ''}` : m.kind);
  const to = (id) => Object.fromEntries(W.COLUMNS.map((c) => [c.key, say(W.moveOf(f[id], c.key))]));
  ok('a queued one: start, cancel, or a new place in Queued; nowhere else',
    same(to(44), { queued: 'priority', waiting: 'refuse', running: 'start', blocked: 'refuse', done: 'refuse', failed: 'refuse', cancelled: 'cancel' }),
    JSON.stringify(to(44)));
  ok('a running one: cancel, after asking; not back to Queued',
    same(to(41), { queued: 'refuse', waiting: 'refuse', running: 'stay', blocked: 'refuse', done: 'refuse', failed: 'refuse', cancelled: 'cancel?' }),
    JSON.stringify(to(41)));
  ok('needs you, failed, cancelled and done go back to Queued: restart',
    [42, 202, 203, 43].every((id) => W.moveOf(f[id], 'queued').kind === 'restart'));
  ok('a waiting one is queued already: refused, with the reason it waits',
    W.moveOf(f[201], 'queued').reason === '#201 is queued already; the queue is holding it back (usage limit).');
  ok('a done one has nothing to cancel', W.moveOf(f[43], 'cancelled').kind === 'refuse');
  ok('a waiting one can be started: it is queued, only held', W.moveOf(f[301], 'running').kind === 'start');
  ok('…but one waiting on you, or finished, cannot',
    W.moveOf(f[42], 'running').reason === '#42 is waiting on you: answer it, or drag it to Queued to run it again.'
    && W.moveOf(f[202], 'running').reason === '#202 is failed; drag it to Queued to run it again.');
}

group('started: first in line, or exactly what holds it');
{
  const f = Object.fromEntries(everything().map((x) => [x.ticket.id, x]));
  const block = (id, tickets = queue(), q = {}) => W.startBlock(tickets.find((x) => x.id === id), { available: true, tickets, queue: q }, NOW);
  ok('nothing holds a plain queued ticket with slots free: the next pass starts it', block(44) === null && block(46) === null);
  ok('a dependency', block(301) === 'waits for #302', block(301));
  ok('a usage limit, until when the queue said', block(201) === 'usage limit until 17:05', block(201));
  ok('…or until the pause the queue is in ends', block(44, queue(), { paused_until: NOW + 3600 })
    === `usage limit until ${new Date((NOW + 3600) * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
  ok('a worker that asked to wait', block(204) === 'the worker asked to wait until 18:00', block(204));
  const lanes = queue().map((x) => (x.id === 44 || x.id === 41 ? { ...x, lane: 'web' } : x));
  ok('a lane another ticket is running in', block(44, lanes) === 'waits for #41 (lane web)', block(44, lanes));
  ok('the disk gate', block(44, queue(), { disk_low_since: NOW - 60 }) === 'the disk is nearly full, so the queue starts nothing');
  ok('every slot busy: it starts next', block(44, queue(), { slots: 2 }) === 'all 2 slots are busy; it starts next'
    && block(44, queue(), {}) === null, block(44, queue(), { slots: 2 }));
  ok('…and the card carries it', everything().find((x) => x.ticket.id === 301).startBlock === 'waits for #302');
  ok('every refusal is one line', W.COLUMNS.every((c) => {
    const m = W.moveOf(f[44], c.key);
    return m.kind !== 'refuse' || (m.reason.length > 10 && !m.reason.includes('\n'));
  }));
}

group('a new place in Queued: the ustabasi priority calls it takes');
{
  const rows = everything();
  const col = W.boardColumns(rows)[0].rows;   // 44, 46, 303 — all priority 5
  const card = (id) => col.find((x) => x.ticket.id === id);
  ok('to the top: one call, one less than the first', same(W.reorder(col, card(303), 0), [{ id: 303, priority: 4 }]),
    JSON.stringify(W.reorder(col, card(303), 0)));
  ok('to the bottom: one call, one more than the last', same(W.reorder(col, card(44), 2), [{ id: 44, priority: 6 }]),
    JSON.stringify(W.reorder(col, card(44), 2)));
  ok('…where it already is: none', W.reorder(col, card(44), 0).length === 0 && W.reorder(col, card(46), 1).length === 0);
  ok('between two of the same priority, the lower number below: it and the one under it move, in that order',
    same(W.reorder(col, card(303), 1), [{ id: 303, priority: 5 }, { id: 46, priority: 6 }]),
    JSON.stringify(W.reorder(col, card(303), 1)));
  const other = { ...card(46), host: 'cinema', key: 'cinema:46' };
  const mixed = [card(44), other, card(303)];
  ok('a card on another computer is in another queue: it is no neighbour',
    W.reorder(mixed, card(303), 1).length === 0 && same(W.reorder(mixed, card(303), 0), [{ id: 303, priority: 4 }]));
}

// ── 2 · the panel ───────────────────────────────────────────────────────────

const App = (await load('src/App.js')).App;
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { setThemeChoice } = await load('src/lib/theme.js');

/** What the computer's queue says right now. Changed by the test and by the
 *  three writes below, read by the next poll: that is the daemon sending a
 *  new snapshot. */
let tickets = queue();
/** Every write the page asked of the queue, in order. */
let writes = [];
/** The queue's answer to the next write, where it refuses. */
let refuseNext = null;
/** The queue's own line: its pause, its disk gate, its slots. */
let queueMeta = {};
/** While set, a write waits for it to open: `open()` answers, `open(why)` refuses. */
let gate = null;
const holdWrites = () => { let open; const promise = new Promise((r) => { open = r; }); gate = { promise, open }; return gate; };
/** While set, the next read of the queue is held, with the snapshot it read
 *  before it was held — a poll in flight across a move. */
let listGate = null;
let listHeld = false;
let lists = 0;
const holdNextList = () => { let open; const promise = new Promise((r) => { open = r; }); listGate = { promise, open }; listHeld = false; return listGate; };
const write = (id, patch) => { tickets = tickets.map((x) => (x.id === id ? { ...x, ...patch, updated_at: Date.now() / 1000 } : x)); };
const call = async (key, type, data = {}) => {
  if (type === 'divan.snapshot') throw new Error('That computer did not answer');
  if (type === 'ustabasi.list') {
    lists++;
    const snap = { available: true, tickets, queue: { last_tick: Date.now() / 1000, ...queueMeta } };
    if (listGate) { const g = listGate; listGate = null; listHeld = true; await g.promise; listHeld = false; }
    return snap;
  }
  if (type === 'ustabasi.cancel' || type === 'ustabasi.restart' || type === 'ustabasi.priority') {
    writes.push(type === 'ustabasi.priority' ? `${key} priority ${data.id} ${data.priority}` : `${key} ${type.slice(9)} ${data.id}`);
    if (gate) { const g = gate; const why = await g.promise; gate = null; if (why) throw new Error(why); }
    if (refuseNext) { const why = refuseNext; refuseNext = null; throw new Error(why); }
    if (type === 'ustabasi.cancel') { write(data.id, { status: 'cancelled', finished_at: Date.now() / 1000 }); return { ok: true, message: `#${data.id} cancelled` }; }
    if (type === 'ustabasi.restart') { write(data.id, { status: 'queued', finished_at: null, escalation: '' }); return { ok: true, message: `#${data.id} back in the queue` }; }
    write(data.id, { priority: data.priority });
    return { ok: true, message: `#${data.id} priority ${data.priority}` };
  }
  if (type === 'ustabasi.notifications') return { available: true, last: 0, items: [] };
  if (type === 'ustabasi.run') return { available: false, reason: 'no run', events: [], cursor: null };
  if (type === 'ustabasi.report') return { id: 0, title: '', status: '', summary: '', verdict: '', verdict_summary: '', files: [] };
  if (type === 'account.list') return { accounts: [] };
  return {};
};
const host = () => {
  const h = fixtureHost();
  return { ...h, chats: h.chats.map((c, i) => ({ ...c, archived: 0, status: 'idle', updated_at: NOW - 60 - i * 5 })) };
};
const studio = () => {
  const snap = fixture.studio();
  return { ...snap, cards: snap.cards.map((c) => (c.id === 'k2' ? { ...c, ustabasi_id: 99 } : c)) };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };
seed(useFleet, { hosts: { studio: host() }, order: ['studio'], focus: 'studio', ready: true, call });
seed(useDivanStore, { snaps: { studio: answered(studio(), NOW) } });
setThemeChoice('dark');
// The page reads every queue again on this clock; shortened so a new snapshot
// lands within the test rather than eight seconds later.
workPoll.ms = 60;
workHold.ms = 120;

// jsdom has no pointer events: a mouse event that says which pointer it was.
class PointerEvent extends w.MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    Object.defineProperty(this, 'pointerId', { value: init.pointerId ?? 1 });
    Object.defineProperty(this, 'pointerType', { value: init.pointerType ?? 'mouse' });
  }
}
w.PointerEvent = PointerEvent;
globalThis.PointerEvent = PointerEvent;

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
let root = createRoot(doc.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });
await settle();

const header = () => doc.querySelector('header');
const where = () => w.location.pathname;
const address = () => w.location.pathname + w.location.search;
const click = async (el) => {
  if (!el) throw new Error('nothing to press');
  await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await settle();
};
const btn = (label, within = doc) => [...(within?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label) ?? null;
const pop = async (dir) => {
  await act(async () => {
    const landed = new Promise((r) => { const d = () => { w.removeEventListener('popstate', d); r(null); }; w.addEventListener('popstate', d); setTimeout(d, 300); });
    if (dir < 0) w.history.back(); else w.history.forward();
    await landed;
  });
  await settle();
};
const mount = async () => {
  root = createRoot(doc.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  await settle();
};
const reload = async (path) => {
  await act(async () => { root.unmount(); });
  w.history.pushState(null, '', path);
  await mount();
};
const cold = async (path) => {
  await act(async () => { root.unmount(); });
  w.history.replaceState(null, '', path);
  await mount();
};
const page = () => doc.querySelector('[data-work]');
const rows = () => [...doc.querySelectorAll('[data-work-row]')].map((r) => r.getAttribute('data-work-row'));
const rowIds = () => rows().map((k) => Number(k.split(':')[1]));
const rowOf = (id) => doc.querySelector(`[data-work-row="studio:${id}"]`);
const openOf = (id) => rowOf(id)?.querySelector('[data-work-open]');
const saidOn = (id) => rowOf(id)?.querySelector('[data-work-said]');
const head = () => (doc.querySelector('[data-work-head]')?.textContent ?? '').trim();
const columns = () => [...doc.querySelectorAll('[data-work-column]')].map((s) => {
  const title = s.querySelector('h3')?.textContent ?? '';
  const inIt = [...s.querySelectorAll('[data-work-row]')].map((r) => r.getAttribute('data-work-row').split(':')[1]);
  return `${title}: ${inIt.join(',')}`;
});
const columnOf = (id) => rowOf(id)?.closest('[data-work-column]')?.getAttribute('data-work-column') ?? null;
const isBoard = () => !!doc.querySelector('[data-work-board]') && doc.querySelectorAll('[data-work-column]').length === 7
  && page()?.getAttribute('data-grouping') === 'board';
const noLayoutButtons = () => !doc.querySelector('[data-work-grouping]') && !btn('Project', page()) && !btn('Date', page())
  && !btn('Board', page()) && !doc.querySelector('[data-work-older]');
const preset = (key) => doc.querySelector(`[data-work-preset="${key}"]`);
const pressedPreset = () => [...doc.querySelectorAll('[data-work-preset]')]
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-work-preset'));
const searchBox = () => doc.querySelector('[data-work-search]');
const picker = () => doc.querySelector('[data-work-project-picker]');
const options = () => [...doc.querySelectorAll('[data-work-project-option]')]
  .map((b) => `${b.querySelector('span')?.textContent} ${b.querySelector('.dv-meta')?.textContent}`);
/** Type into a field the way a person does: React reads the native setter. */
const type = async (el, value) => {
  if (!el) throw new Error('no field');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await settle();
};
/** Wait for the next snapshots to say something. */
const until = async (cond) => { for (let i = 0; i < 60 && !cond(); i++) await tick(25); return cond(); };
const fresh = async () => {
  tickets = queue();
  writes = [];
  await until(() => same(columns(), BOARD_SHOWN));
};
const BOARD_SHOWN = BOARD7;

group('/work opens as the Board, with no view buttons; old links still open');
{
  await click(btn('Chats', header()));
  const n = w.history.length;
  await click(btn('Work', header()));
  ok('the top bar\'s Work button opens /work in one click, one entry',
    address() === '/work' && w.history.length === n + 1, `${address()} · ${n} → ${w.history.length}`);
  ok('…as the Board, every column in order, every card in its own', isBoard() && same(columns(), BOARD7),
    JSON.stringify(columns()));
  ok('…with no Board / Project / Date buttons and no Show older', noLayoutButtons());
  ok('the head counts it in words',
    head() === '2 running · 1 needs you · 3 waiting · 3 queued · 2 done, 1 failed and 1 cancelled in the last 7 days', head());
  const c = rowOf(302);
  ok('a card says #id, title, status, project, stage and round, and age',
    !!c && c.textContent.includes('#302 isghocam-seo ticket 302') && c.querySelector('.dv-status')?.textContent === 'running'
    && c.querySelector('[data-work-meta]')?.textContent === 'isghocam-seo · check r2 · open 2h 0m', c?.textContent);

  await cold('/work');
  ok('cold-opened, /work is the Board', where() === '/work' && isBoard() && same(columns(), BOARD7) && noLayoutButtons());
  await reload('/work');
  ok('…and a reload too', where() === '/work' && isBoard() && same(columns(), BOARD7));

  for (const [old, now] of [
    ['/work?view=board', '/work'], ['/work?group=date', '/work'], ['/work?group=project', '/work'],
  ]) {
    await cold(old);
    ok(`an old link ${old} opens the Board, written back as ${now}`,
      address() === now && isBoard() && same(columns(), BOARD7) && noLayoutButtons(), `${address()} · ${JSON.stringify(columns())}`);
  }
  await cold('/work?group=date&older=1');
  ok('…and one that reached two weeks back keeps reaching two weeks back',
    address() === '/work?range=14d' && isBoard() && columns()[4] === 'Done: 43,304,305',
    `${address()} · ${columns()[4]}`);
  await cold('/work');
}

group('the date picker: presets and two dates, in the address');
{
  ok('the last 7 days is pressed, the two dates say them',
    same(pressedPreset(), ['7d']) && doc.querySelector('[data-work-from]')?.value === daysAgo(6)
    && doc.querySelector('[data-work-to]')?.value === today,
    `${pressedPreset()} · ${doc.querySelector('[data-work-from]')?.value}..${doc.querySelector('[data-work-to]')?.value}`);
  const n = w.history.length;
  await click(preset('today'));
  ok('Today: exactly what moved or finished since midnight',
    address() === '/work?range=today' && w.history.length === n + 1 && same(columns(), [
      'Queued: 46,303', 'Waiting: 201,204,301', 'In progress: 41,302', 'Needs you: 42',
      'Done: 43', 'Failed: ', 'Cancelled: ',
    ]) && same(pressedPreset(), ['today']), `${address()} · ${JSON.stringify(columns())}`);
  await click(preset('30d'));
  ok('30 days: Done reaches the ones ten and twenty days old',
    address() === '/work?range=30d' && columns()[4] === 'Done: 43,304,305,306' && head().endsWith('in the last 30 days'),
    `${address()} · ${columns()[4]} · ${head()}`);
  await type(doc.querySelector('[data-work-from]'), daysAgo(3));
  await type(doc.querySelector('[data-work-to]'), daysAgo(1));
  ok('two dates: three days ago to yesterday, both in the address',
    address() === `/work?from=${daysAgo(3)}&to=${daysAgo(1)}` && same(columns(), [
      'Queued: 44', 'Waiting: ', 'In progress: ', 'Needs you: ', 'Done: ', 'Failed: 202', 'Cancelled: 203',
    ]) && same(pressedPreset(), []), `${address()} · ${JSON.stringify(columns())}`);
  await reload(address());
  ok('a reload keeps the two dates', address() === `/work?from=${daysAgo(3)}&to=${daysAgo(1)}`
    && same(columns().map((c) => c.split(': ')[1]), ['44', '', '', '', '', '202', '203']));
  await pop(-1);
  await pop(-1);
  await pop(-1);
  ok('Back walks the days back: 30 days', address() === '/work?range=30d' && columns()[4] === 'Done: 43,304,305,306', address());
  await pop(-1);
  ok('…Today', address() === '/work?range=today' && columns()[0] === 'Queued: 46,303', address());
  await pop(-1);
  ok('…and the last seven days', address() === '/work' && same(columns(), BOARD7), address());
  await cold('/work?range=today');
  ok('a cold link keeps it', address() === '/work?range=today' && columns()[0] === 'Queued: 46,303' && same(pressedPreset(), ['today']));
  await cold('/work');
}

group('the search box filters as you type, in the address');
{
  const n = w.history.length;
  await type(searchBox(), '#30');
  ok('#30: the tickets whose number starts so', address() === '/work?q=%2330' && same(sorted(rowIds()), [301, 302, 303, 304]),
    `${address()} · ${rowIds()}`);
  await type(searchBox(), '#302');
  ok('#302: that one and no other', same(rowIds(), [302]) && address() === '/work?q=%23302', `${address()} · ${rowIds()}`);
  ok('…and the letters typed took the entry over rather than adding one each', w.history.length === n,
    `${n} → ${w.history.length}`);
  await type(searchBox(), 'limited');
  ok('the last event', same(rowIds(), [201]));
  await type(searchBox(), 'quire progress');
  ok('every word: a project and the last event', same(sorted(rowIds()), [41, 42]), JSON.stringify(rowIds()));
  await reload(address());
  ok('a reload keeps what was typed', searchBox()?.value === 'quire progress' && same(sorted(rowIds()), [41, 42]));
  await type(searchBox(), 'nothing like this');
  ok('nothing matching says so', rowIds().length === 0 && head() === 'Nothing here matches.' && isBoard(), head());
  await type(searchBox(), '');
  ok('an empty box is everything again, with nothing in the address', address() === '/work' && same(columns(), BOARD7), address());
}

group('the project picker opens a list and shows only the one chosen');
{
  ok('All projects to begin with', picker()?.textContent.includes('All projects') && !doc.querySelector('[data-work-projects]'));
  await click(picker());
  ok('it opens a list of every project in the snapshot, with counts',
    picker()?.getAttribute('aria-expanded') === 'true'
    && same(options(), ['All projects 13', 'isghocam-seo 4', 'nl-artsen 5', 'quire 4']), JSON.stringify(options()));
  const n = w.history.length;
  await click(doc.querySelector('[data-work-project-option="nl-artsen"]'));
  ok('nl-artsen: only its cards, the list closed, the address says so',
    address() === '/work?project=nl-artsen' && w.history.length === n + 1 && !doc.querySelector('[data-work-projects]')
    && same(columns(), [
      'Queued: 46', 'Waiting: 201,204', 'In progress: ', 'Needs you: ', 'Done: ', 'Failed: 202', 'Cancelled: 203',
    ]) && picker()?.textContent.includes('nl-artsen'), `${address()} · ${JSON.stringify(columns())}`);
  await type(searchBox(), 'sitemap');
  await click(picker());
  ok('…the list counts what the days and the search leave, and keeps every project',
    same(options(), ['All projects 1', 'isghocam-seo 1', 'nl-artsen 0', 'quire 0']) && rowIds().length === 0,
    JSON.stringify(options()));
  await click(doc.querySelector('[data-work-project-option=""]'));
  ok('All projects is every project again', address() === '/work?q=sitemap' && same(rowIds(), [303]), address());
  await type(searchBox(), '');
  await click(preset('30d'));
  await click(picker());
  await click(doc.querySelector('[data-work-project-option="quire"]'));
  await type(searchBox(), 'ticket');
  ok('all three at once, in one address', address() === '/work?range=30d&project=quire&q=ticket'
    && same(columns(), ['Queued: 44', 'Waiting: ', 'In progress: 41', 'Needs you: 42', 'Done: 43,305', 'Failed: ', 'Cancelled: ']),
  `${address()} · ${JSON.stringify(columns())}`);
  await cold(address());
  ok('…and a cold link to it draws the same board',
    same(columns(), ['Queued: 44', 'Waiting: ', 'In progress: 41', 'Needs you: 42', 'Done: 43,305', 'Failed: ', 'Cancelled: '])
    && searchBox()?.value === 'ticket' && same(pressedPreset(), ['30d']) && picker()?.textContent.includes('quire'));
}

group('a card opens the ticket\'s page, and Back returns to the same filters');
{
  const here = address();
  const n = w.history.length;
  await click(openOf(41));
  ok('a ticket with a card on a board opens that card\'s page',
    where() === '/p/quire/c/k1' && w.history.length === n + 1 && !page(), where());
  await pop(-1);
  ok('Back is the board with the same days, project and search', address() === here
    && searchBox()?.value === 'ticket' && same(pressedPreset(), ['30d']) && columns()[4] === 'Done: 43,305', address());
  await click(openOf(305));
  ok('a finished ticket on no board opens the queue\'s wall with it open',
    where() === '/machine/terminal/ustabasi/305' && !!doc.querySelector('[aria-label="Back to the wall"]'), where());
  ok('…whose way back says where it came from',
    header().querySelector('button.dv-back')?.getAttribute('aria-label') === 'Back to Work');
  await pop(-1);
  ok('…and Back returns to the same filters', address() === here && columns()[0] === 'Queued: 44', address());
  await cold('/work');
}

// ── dragging ────────────────────────────────────────────────────────────────

/** Where things are drawn. jsdom lays nothing out, so the columns are put side
 *  by side, 200px apart, and the cards down each, 100px apart. */
const layout = () => {
  const rect = (left, top, width, height) => () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {},
  });
  [...doc.querySelectorAll('[data-work-column]')].forEach((col, i) => {
    col.getBoundingClientRect = rect(i * 200, 0, 180, 2000);
    [...col.querySelectorAll('[data-work-row]')].forEach((card, j) => {
      card.getBoundingClientRect = rect(i * 200, 100 + j * 100, 180, 80);
    });
  });
};
const KEYS = ['queued', 'waiting', 'running', 'blocked', 'done', 'failed', 'cancelled'];
const pe = (type, x, y, pointerType) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, pointerType });
/** Pick a card up and put it down over a column (`null`: off the board), at a
 *  height in it; then the click a browser sends after a press. */
const drag = async (id, to, { y = 1500, touch = false, wobble = false } = {}) => {
  layout();
  const card = rowOf(id);
  if (!card) throw new Error(`no card #${id}`);
  const r = card.getBoundingClientRect();
  const [x0, y0] = [r.left + 20, r.top + 20];
  const x1 = to == null ? 5000 : KEYS.indexOf(to) * 200 + 60;
  const kind = touch ? 'touch' : 'mouse';
  // The wobble goes in with the press, in one act: on a loaded machine a
  // second act can take longer than the hold, and the card would be up first.
  await act(async () => {
    card.querySelector('[data-work-open] .dv-card-title').dispatchEvent(pe('pointerdown', x0, y0, kind));
    if (wobble) doc.body.dispatchEvent(pe('pointermove', x0 + 30, y0 + 30, kind));
  });
  if (touch) await tick(200);
  await act(async () => { doc.body.dispatchEvent(pe('pointermove', x0 + 10, y0 + 10, kind)); });
  await act(async () => { doc.body.dispatchEvent(pe('pointermove', x1, y, kind)); });
  await act(async () => {
    doc.body.dispatchEvent(pe('pointerup', x1, y, kind));
    // A finger that scrolled sends no click; a press that was a drag does.
    if (!wobble) card.querySelector('[data-work-open]')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

group('dragging a card to Cancelled, Queued, or a new place in Queued calls the queue');
{
  await fresh();
  const n = w.history.length;
  await drag(46, 'cancelled');
  ok('a queued card to Cancelled: ustabasi cancel, nothing else', same(writes, ['studio cancel 46']), JSON.stringify(writes));
  ok('…and the press that ended the drag opened nothing', address() === '/work' && w.history.length === n);
  await until(() => columnOf(46) === 'cancelled');
  ok('…the board shows the next snapshot: it is in Cancelled, saying what the queue said',
    columnOf(46) === 'cancelled' && saidOn(46)?.textContent === '#46 cancelled' && saidOn(46)?.getAttribute('data-work-said') === 'ok',
    `${columnOf(46)} · ${saidOn(46)?.textContent}`);

  await fresh();
  await drag(41, 'cancelled');
  ok('a running card to Cancelled asks first, and calls nothing yet',
    writes.length === 0 && !!rowOf(41)?.querySelector('[data-work-confirm]') && columnOf(41) === 'running',
    JSON.stringify(writes));
  await click(btn('Keep it running', rowOf(41)));
  ok('…Keep it running: still nothing, and the card is where it was', writes.length === 0 && columnOf(41) === 'running'
    && !rowOf(41)?.querySelector('[data-work-confirm]'));
  await drag(41, 'cancelled');
  await click(btn('Cancel it', rowOf(41)));
  ok('…Cancel it: ustabasi cancel', same(writes, ['studio cancel 41']), JSON.stringify(writes));
  await until(() => columnOf(41) === 'cancelled');
  ok('…and it lands in Cancelled', columnOf(41) === 'cancelled');

  for (const [id, from] of [[202, 'failed'], [203, 'cancelled'], [43, 'done'], [42, 'blocked']]) {
    await fresh();
    await drag(id, 'queued');
    ok(`from ${from} to Queued: ustabasi restart`, same(writes, [`studio restart ${id}`]), JSON.stringify(writes));
    await until(() => columnOf(id) === 'queued');
    ok(`…and #${id} is in Queued, saying so`, columnOf(id) === 'queued' && saidOn(id)?.textContent === `#${id} back in the queue`,
      `${columnOf(id)} · ${saidOn(id)?.textContent}`);
  }

  await fresh();
  await drag(303, 'queued', { y: 50 });
  ok('to the top of Queued: ustabasi priority, one less than the first', same(writes, ['studio priority 303 4']), JSON.stringify(writes));
  await until(() => columns()[0] === 'Queued: 303,44,46');
  ok('…and Queued is drawn in the queue\'s new order', columns()[0] === 'Queued: 303,44,46', columns()[0]);
  writes = [];
  await drag(44, 'queued', { y: 1500 });
  ok('to the bottom: one more than the last', same(writes, ['studio priority 44 6']), JSON.stringify(writes));
  await until(() => columns()[0] === 'Queued: 303,46,44');
  ok('…and it is at the bottom', columns()[0] === 'Queued: 303,46,44', columns()[0]);
}

group('dragged to In progress, a queued ticket is started: first in line');
{
  await fresh();
  await drag(44, 'running');
  ok('Queued → In progress: ustabasi priority 44 0', same(writes, ['studio priority 44 0']), JSON.stringify(writes));
  ok('…the card says Starting… while the snapshot does not show it running',
    saidOn(44)?.getAttribute('data-work-said') === 'starting' && saidOn(44)?.textContent === 'Starting…' && columnOf(44) === 'queued',
    `${saidOn(44)?.textContent} · ${columnOf(44)}`);
  write(44, { status: 'running', started_at: Date.now() / 1000 });
  await until(() => columnOf(44) === 'running');
  ok('…and Started. once the next snapshot has it in In progress', columnOf(44) === 'running' && saidOn(44)?.textContent === 'Started.',
    `${columnOf(44)} · ${saidOn(44)?.textContent}`);

  await fresh();
  await drag(301, 'running');
  ok('a ticket waiting on another: still first in line, and the card says what it waits for',
    same(writes, ['studio priority 301 0']) && saidOn(301)?.textContent === "First in line, but it can't start yet: waits for #302."
    && columnOf(301) === 'waiting', `${JSON.stringify(writes)} · ${saidOn(301)?.textContent}`);

  await fresh();
  queueMeta = { slots: 2 };
  await until(() => false);
  await drag(46, 'running');
  ok('every slot busy: it says it starts next', same(writes, ['studio priority 46 0'])
    && saidOn(46)?.textContent === "First in line, but it can't start yet: all 2 slots are busy; it starts next.", saidOn(46)?.textContent);
  queueMeta = { disk_low_since: NOW - 60 };
  await until(() => saidOn(46)?.textContent.includes('disk'));
  ok('…and the word follows the snapshot: the disk gate shut', saidOn(46)?.textContent
    === "First in line, but it can't start yet: the disk is nearly full, so the queue starts nothing.", saidOn(46)?.textContent);
  queueMeta = {};
}

group('moves the queue cannot make are refused on drop, with no call');
{
  for (const [id, to] of [
    [42, 'running'], [44, 'done'], [44, 'blocked'], [44, 'waiting'], [44, 'failed'],
    [41, 'queued'], [201, 'queued'], [43, 'cancelled'], [202, 'done'],
  ]) {
    await fresh();
    const from = columnOf(id);
    await drag(id, to);
    const said = saidOn(id);
    ok(`#${id} into ${to}: refused, one line, and it snaps back to ${from}`,
      writes.length === 0 && columnOf(id) === from && said?.getAttribute('data-work-said') === 'refused'
      && !!said.textContent && !said.textContent.includes('\n') && !rowOf(id)?.hasAttribute('data-lifted'),
      `${JSON.stringify(writes)} · ${columnOf(id)} · ${said?.textContent}`);
  }
  ok('…in words that say why', saidOn(202)?.textContent === 'Only the queue marks a ticket done, once its work has passed and been merged.');
  await fresh();
  await drag(44, null);
  ok('put down off the board: no call, no word, back where it was', writes.length === 0 && columnOf(44) === 'queued' && !saidOn(44));
  await drag(202, 'failed');
  ok('put down on its own column: nothing', writes.length === 0 && !saidOn(202));
  await drag(44, 'queued', { y: 50 });
  ok('…or in its own place in Queued: nothing', writes.length === 0 && !saidOn(44));
}

group('the queue saying no is said on the card');
{
  await fresh();
  refuseNext = '#203 has a branch nobody merged; restart refused';
  await drag(203, 'queued');
  ok('the call was made, and its error is on the card', same(writes, ['studio restart 203'])
    && saidOn(203)?.getAttribute('data-work-said') === 'error'
    && saidOn(203)?.textContent === '#203 has a branch nobody merged; restart refused', saidOn(203)?.textContent);
  ok('…and the card is where the snapshot says it is', columnOf(203) === 'cancelled');
}

group('a card put down waits in its new column as a ghost until the queue answers');
{
  const pill = (id) => rowOf(id)?.querySelector('.dv-status')?.textContent ?? null;
  const badge = (id) => rowOf(id)?.querySelector('[data-work-badge]')?.textContent ?? null;
  const ghost = (id) => rowOf(id)?.getAttribute('data-work-pending') ?? null;
  await fresh();
  const g = holdWrites();
  await drag(44, 'running');
  ok('Queued → In progress: at once in In progress, saying Starting…, its status still queued',
    columnOf(44) === 'running' && ghost(44) === 'running' && badge(44) === 'Starting…' && pill(44) === 'queued'
    && same(writes, ['studio priority 44 0']), `${columnOf(44)} · ${ghost(44)} · ${badge(44)} · ${pill(44)} · ${JSON.stringify(writes)}`);
  ok('…and no longer in Queued', !doc.querySelector('[data-work-column="queued"] [data-work-row="studio:44"]'));
  await drag(44, 'cancelled');
  await click(rowOf(44)?.querySelector('[data-work-move]'));
  ok('a second drop while the first is out asks nothing, and Move to… is shut',
    same(writes, ['studio priority 44 0']) && columnOf(44) === 'running' && rowOf(44)?.querySelector('[data-work-move]')?.disabled
    && !doc.querySelector('[data-work-menu]'), JSON.stringify(writes));
  // A poll goes out and is held — it read the queue before the move landed.
  const poll = holdNextList();
  await until(() => listHeld);
  write(44, { status: 'running', started_at: Date.now() / 1000 });
  const before = lists;
  g.open();
  await until(() => !ghost(44) && columnOf(44) === 'running');
  ok('answered while a poll was in flight: the queue is read again at once, and it lands in In progress',
    lists > before && listHeld && !ghost(44) && columnOf(44) === 'running' && pill(44) === 'running',
    `${lists - before} reads · held ${listHeld} · ${ghost(44)} · ${columnOf(44)} · ${pill(44)}`);
  poll.open();
  await tick(0);
  ok('…and the poll that read before the move, answering last, is not drawn over it', columnOf(44) === 'running', columnOf(44));

  await fresh();
  const r = holdWrites();
  await drag(203, 'queued');
  ok('Cancelled → Queued: a ghost in Queued, saying Back to queue…', columnOf(203) === 'queued' && badge(203) === 'Back to queue…'
    && pill(203) === 'cancelled', `${columnOf(203)} · ${badge(203)}`);
  r.open('#203 has a branch nobody merged; restart refused');
  await settle();
  ok('…refused: the ghost goes, the card is back in Cancelled, saying why',
    columnOf(203) === 'cancelled' && !ghost(203) && !badge(203) && saidOn(203)?.getAttribute('data-work-said') === 'error'
    && saidOn(203)?.textContent === '#203 has a branch nobody merged; restart refused', `${columnOf(203)} · ${saidOn(203)?.textContent}`);
  await drag(203, 'queued');
  ok('…and it can be moved again', same(writes, ['studio restart 203', 'studio restart 203']), JSON.stringify(writes));
}

group('a finger drags too: held for a moment, then moved');
{
  await fresh();
  await drag(46, 'cancelled', { touch: true });
  ok('touch: ustabasi cancel', same(writes, ['studio cancel 46']), JSON.stringify(writes));
  await fresh();
  await drag(202, 'queued', { touch: true });
  ok('touch: ustabasi restart', same(writes, ['studio restart 202']), JSON.stringify(writes));
  await fresh();
  await drag(44, 'done', { touch: true });
  ok('touch: refused the same way', writes.length === 0 && saidOn(44)?.getAttribute('data-work-said') === 'refused');
  await fresh();
  await drag(46, 'cancelled', { touch: true, wobble: true });
  ok('a finger that moves before it has rested is scrolling: no drag, no call', writes.length === 0 && columnOf(46) === 'queued');
  ok('a card left alone still lets a finger scroll the board, either way',
    rowOf(46)?.style.touchAction === 'manipulation');
}

group('Move to…: the same moves from a menu, by keyboard');
{
  await fresh();
  const menuBtn = (id) => rowOf(id)?.querySelector('[data-work-move]');
  const items = () => [...doc.querySelectorAll('[data-work-menu] [role="menuitem"]')].map((b) => b.textContent);
  await click(menuBtn(46));
  ok('a queued card offers the top of Queued, one down, In progress and Cancelled',
    same(items(), ['Top of Queued', 'Down one', 'In progress — start it', 'Cancelled — stop it'])
    && menuBtn(46)?.getAttribute('aria-expanded') === 'true',
    JSON.stringify(items()));
  ok('…the first is focused, for the keyboard', doc.activeElement?.textContent === 'Top of Queued', doc.activeElement?.textContent);
  await act(async () => { doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  ok('…the arrow keys move through it', doc.activeElement?.textContent === 'Down one', doc.activeElement?.textContent);
  await act(async () => { doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  ok('…Escape closes it, having called nothing', !doc.querySelector('[data-work-menu]') && writes.length === 0);
  await click(menuBtn(46));
  await click(btn('Top of Queued', doc.querySelector('[data-work-menu]')));
  ok('Top of Queued: ustabasi priority', same(writes, ['studio priority 46 4']), JSON.stringify(writes));
  await fresh();
  await click(menuBtn(46));
  await click(btn('Down one', doc.querySelector('[data-work-menu]')));
  ok('Down one: below #303, which takes the next number', same(writes, ['studio priority 46 6']), JSON.stringify(writes));
  await fresh();
  await click(menuBtn(46));
  await click(btn('Cancelled — stop it', doc.querySelector('[data-work-menu]')));
  ok('Cancelled: ustabasi cancel', same(writes, ['studio cancel 46']), JSON.stringify(writes));

  await fresh();
  await click(menuBtn(202));
  ok('a failed card offers Queued and Cancelled', same(items(), ['Queued — run it again', 'Cancelled — stop it']), JSON.stringify(items()));
  await click(btn('Queued — run it again', doc.querySelector('[data-work-menu]')));
  ok('…Queued: ustabasi restart', same(writes, ['studio restart 202']), JSON.stringify(writes));

  await fresh();
  await click(menuBtn(41));
  ok('a running card offers only Cancelled', same(items(), ['Cancelled — stop it']), JSON.stringify(items()));
  await click(btn('Cancelled — stop it', doc.querySelector('[data-work-menu]')));
  ok('…which asks first, as a drag does', writes.length === 0 && !!rowOf(41)?.querySelector('[data-work-confirm]'));
  await click(btn('Cancel it', rowOf(41)));
  ok('…and then cancels', same(writes, ['studio cancel 41']), JSON.stringify(writes));

  await fresh();
  await click(menuBtn(43));
  ok('a done card offers only Queued', same(items(), ['Queued — run it again']), JSON.stringify(items()));
  await click(menuBtn(201));
  ok('a waiting one In progress and Cancelled', same(items(), ['In progress — start it', 'Cancelled — stop it']), JSON.stringify(items()));
  await click(btn('In progress — start it', doc.querySelector('[data-work-menu]')));
  ok('…In progress: ustabasi priority 0, and why it cannot start yet',
    same(writes, ['studio priority 201 0']) && saidOn(201)?.textContent === "First in line, but it can't start yet: usage limit until 17:05.",
    `${JSON.stringify(writes)} · ${saidOn(201)?.textContent}`);
  await click(menuBtn(201));
  await click(menuBtn(201));
  ok('pressing Move to… again closes it, calling nothing more', !doc.querySelector('[data-work-menu]') && writes.length === 1);
}

group('live: a new snapshot redraws the cards, no reload');
{
  await fresh();
  const mountedPage = page();
  tickets = queue().map((x) => (x.id === 41 ? { ...x, stage: 'check', updated_at: Date.now() / 1000 } : x))
    .concat([t(45, 'quire', 'running', { title: 'a new one', stage: 'worker' })]);
  await until(() => !!rowOf(45) && (rowOf(41)?.querySelector('[data-work-meta]')?.textContent ?? '').includes('check r1'));
  ok('#41 moved worker → check on its card', (rowOf(41)?.querySelector('[data-work-meta]')?.textContent ?? '').includes('check r1'));
  ok('…a ticket that started appeared', !!rowOf(45) && rowOf(45).textContent.includes('#45 a new one'));
  ok('…and it was the same page, not a reload', page() === mountedPage && where() === '/work');
}

group('nothing moved and nothing finished: one sentence, every column still drawn');
{
  tickets = queue().filter((x) => x.id === 305 || x.id === 306);
  await until(() => rows().length === 0);
  ok('no cards', rows().length === 0);
  ok('…and the page says so in one sentence', head() === W.nothing(null), head());
  ok('…every column still drawn, empty',
    same(columns(), ['Queued: ', 'Waiting: ', 'In progress: ', 'Needs you: ', 'Done: ', 'Failed: ', 'Cancelled: ']));
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
