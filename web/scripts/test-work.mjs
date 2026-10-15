#!/usr/bin/env node
/** Work (`/work`): every ticket the queue is on, across every project, and
 *  what it finished lately.
 *
 *     cd web && npm test
 *
 *  Two halves. First `lib/work.ts` on its own: a snapshot with a ticket in
 *  every state on three projects — one on a Divan board, two on none — some
 *  finished today, yesterday, this week and weeks ago, and exactly which rows
 *  come out, in which order, under which headings, with which words and counts.
 *  Then the whole panel mounted into jsdom the way `test-nav.mjs` mounts it,
 *  its computer answering through a faked `call` (the socket's one door):
 *  the top bar's Work button, Back, a reload and the path opened cold; the
 *  Board, Project and Date choices and Show older, each in the address; a new
 *  snapshot redrawing the rows with no reload; a row opening the ticket's own
 *  page and Back returning to the same layout; and the page with nothing.
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
const { workPoll } = await load('src/screens/Work.js');
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
  escalation: '', ask: '', notes: [], note_count: 0, steps: [],
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
const dayName = (at) => new Date(at * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const ids = (list) => list.map((f) => f.ticket.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1 · which rows, in what order, in which words ───────────────────────────

group('which tickets are in flight, across three projects');
{
  const snap = { available: true, tickets: queue(), queue: { last_tick: NOW } };
  const rows = W.flights('studio', snap, NOW);
  const got = ids(rows).sort((a, b) => a - b);
  ok('running, queued, waiting and needs-you are in flight; done, failed and cancelled are not',
    same(got, [41, 42, 44, 201, 204, 301, 302, 303]), JSON.stringify(got));
  ok('…including both projects that are on no board', got.includes(201) && got.includes(303));
  const phase = Object.fromEntries(rows.map((f) => [f.ticket.id, `${f.phase}:${f.word}`]));
  ok('each says where it stands: red, running, parked for a reason, or next in line',
    phase[42] === 'red:needs you'
    && phase[41] === 'running:running' && phase[302] === 'running:running'
    && phase[201] === 'waiting:usage limit' && phase[204] === 'waiting:worker waiting'
    && phase[301] === 'waiting:waits for #302'
    && phase[44] === 'queued:queued' && phase[303] === 'queued:queued', JSON.stringify(phase));

  const r302 = rows.find((f) => f.ticket.id === 302);
  ok('a row carries its project, stage and round, this round\'s age and the ticket\'s',
    r302.meta === 'isghocam-seo · check r2 · 10m in this round · open 2h 0m', r302.meta);
  ok('…and the last event in one line, without the log\'s tag',
    rows.find((f) => f.ticket.id === 41).line === 'progress on 41'
    && rows.find((f) => f.ticket.id === 303).line === 'Write the sitemap.');

  const paused = W.flights('studio', { ...snap, queue: { paused_until: NOW + 600 } }, NOW);
  ok('a queue paused for a limit parks every queued ticket on that computer',
    paused.find((f) => f.ticket.id === 44).word === 'usage limit');
  const unmet = W.flights('studio', { available: true, tickets: [
    t(1, 'a', 'done'), t(2, 'a', 'queued', { depends_on: 1 }),
  ] }, NOW);
  ok('a dependency that is done holds nothing', unmet.find((f) => f.ticket.id === 2).phase === 'queued');
  ok('a computer with no queue adds no rows',
    W.flights('studio', { available: false, tickets: [] }, NOW).length === 0 && W.flights('studio', null, NOW).length === 0
    && W.finished('studio', null, NOW, 0).length === 0);
}

group('what finished: the last seven days, and seven more per Show older');
{
  const snap = { available: true, tickets: queue() };
  const week = W.finished('studio', snap, NOW, W.since(NOW, 0));
  ok('the last seven days: done today, failed yesterday, cancelled three days ago, done six days ago',
    same(ids(week).sort((a, b) => a - b), [43, 202, 203, 304]), JSON.stringify(ids(week)));
  ok('…and there is older to show', W.hasOlder(snap, W.since(NOW, 0)));
  const two = W.finished('studio', snap, NOW, W.since(NOW, 1));
  ok('Show older once adds the week before: the one ten days ago',
    same(ids(two).sort((a, b) => a - b), [43, 202, 203, 304, 305]), JSON.stringify(ids(two)));
  ok('…twice, the one twenty days ago, and then nothing is older',
    same(ids(W.finished('studio', snap, NOW, W.since(NOW, 2))).sort((a, b) => a - b), [43, 202, 203, 304, 305, 306])
    && !W.hasOlder(snap, W.since(NOW, 2)));
  const by = Object.fromEntries(week.map((f) => [f.ticket.id, f]));
  ok('each says how it ended', by[43].word === 'done' && by[202].word === 'failed' && by[203].word === 'cancelled'
    && by[43].ended === 'done' && by[202].phase === 'finished');
  ok('…and when', by[43].when === 'today 11:59' && by[202].when === 'yesterday 11:00'
    && by[203].when === `${new Date((NOW - 3 * D) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} 12:00`,
    `${by[43].when} · ${by[202].when} · ${by[203].when}`);
  ok('…and whether it was merged: the snapshot\'s word, or an older daemon\'s last event',
    by[43].merged && by[304].merged && !by[202].merged && !by[203].merged);
  ok('its meta line says all three', by[43].meta === 'quire · done today 11:59 · merged · worker r1', by[43].meta);
}

group('grouped by project, by date, or as a board');
{
  const snap = { available: true, tickets: queue() };
  const rows = [...W.flights('studio', snap, NOW), ...W.finished('studio', snap, NOW, W.since(NOW, 0))];

  const groups = W.groupBy('project', rows, NOW);
  const order = groups.map((g) => `${g.title}: ${ids(g.rows).join(',')}`);
  ok('by project: in flight first in each, red first, then what finished, newest first — groups by their first row',
    same(order, [
      'quire: 42,41,44,43',
      'isghocam-seo: 302,301,303,304',
      'nl-artsen: 201,204,202,203',
    ]), JSON.stringify(order));

  const days = W.groupBy('date', rows, NOW);
  const byDay = days.map((g) => `${g.title}: ${ids(g.rows).join(',')}`);
  ok('by date: Today, Yesterday, then dates — last activity in flight, finished_at when finished, newest first',
    same(byDay, [
      'Today: 201,204,301,41,42,302,43,303',
      'Yesterday: 202,44',
      `${dayName(NOW - 3 * D)}: 203`,
      `${dayName(NOW - 6 * D)}: 304`,
    ]), JSON.stringify(byDay));

  const cols = W.groupBy('board', rows, NOW);
  const board = cols.map((g) => `${g.title}: ${ids(g.rows).join(',')}`);
  ok('as a board: one column per status, in the order a ticket moves, every ticket in its own',
    same(board, [
      'Queued: 303,44',
      'Waiting: 201,204,301',
      'In progress: 41,302',
      'Needs you: 42',
      'Done: 43,304',
      'Failed: 202',
      'Cancelled: 203',
    ]), JSON.stringify(board));
  const empty = W.groupBy('board', W.flights('studio', { available: true, tickets: [t(9, 'a', 'running')] }, NOW), NOW);
  ok('…every column drawn even when it is empty', empty.length === 7 && empty.filter((c) => c.rows.length === 0).length === 6);
  const card = (id) => W.cardMeta(rows.find((f) => f.ticket.id === id), NOW);
  ok('a card says project, stage and round or how it ended, and age',
    card(302) === 'isghocam-seo · check r2 · open 2h 0m' && card(43) === 'quire · done today 11:59 · merged',
    `${card(302)} · ${card(43)}`);
}

group('the head line counts in words, finished ones too');
{
  const snap = { available: true, tickets: queue() };
  const rows = (older) => [...W.flights('studio', snap, NOW), ...W.finished('studio', snap, NOW, W.since(NOW, older))];
  ok('this week', W.headLine(rows(0), 0) === '2 running · 1 needs you · 3 waiting · 2 queued · 2 done, 1 failed and 1 cancelled this week',
    W.headLine(rows(0), 0));
  ok('…two weeks, with Show older pressed',
    W.headLine(rows(1), 1) === '2 running · 1 needs you · 3 waiting · 2 queued · 3 done, 1 failed and 1 cancelled in the last 2 weeks',
    W.headLine(rows(1), 1));
  const two = rows(0).concat(W.flights('x', { available: true, tickets: [t(50, 'a', 'blocked')] }, NOW));
  ok('…two needing you is said in the plural', W.headLine(two, 0).startsWith('2 running · 2 need you'));
  ok('…only finished ones', W.headLine(W.finished('studio', { available: true, tickets: [t(1, 'a', 'done')] }, NOW, 0), 0) === '1 done this week');
  ok('…and nothing at all is one sentence', W.nothing(0) === 'Nothing is in flight and nothing finished this week.');
}

// ── 2 · the panel ───────────────────────────────────────────────────────────

const App = (await load('src/App.js')).App;
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { setThemeChoice } = await load('src/lib/theme.js');

/** What the computer's queue says right now. Changed by the test, read by the
 *  next poll: that is the daemon sending a new snapshot. */
let tickets = queue();
const call = async (key, type) => {
  if (type === 'divan.snapshot') throw new Error('That computer did not answer');
  if (type === 'ustabasi.list') return { available: true, tickets, queue: { last_tick: Date.now() / 1000 } };
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
const head = () => (doc.querySelector('[data-work-head]')?.textContent ?? '').trim();
const projects = () => [...doc.querySelectorAll('[data-work-project]')].map((s) => s.getAttribute('data-work-project'));
const days = () => [...doc.querySelectorAll('[data-work-day]')].map((s) => s.getAttribute('data-work-day'));
const columns = () => [...doc.querySelectorAll('[data-work-column]')].map((s) => {
  const title = s.querySelector('h3')?.textContent ?? '';
  const n = s.querySelector('[data-work-count]')?.textContent ?? '';
  const inIt = [...s.querySelectorAll('[data-work-row]')].map((r) => r.getAttribute('data-work-row').split(':')[1]);
  return `${title} ${n}: ${inIt.join(',')}`;
});
const grouping = () => page()?.getAttribute('data-grouping');
const choice = (label) => btn(label, doc.querySelector('[data-work-grouping]'));
const pressed = () => [...(doc.querySelector('[data-work-grouping]')?.querySelectorAll('button') ?? [])]
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
const older = () => doc.querySelector('[data-work-older]');
const drawn = () => !!page() && rows().length > 0;
const BY_PROJECT = [42, 41, 44, 43, 302, 301, 303, 304, 201, 204, 202, 203];
const BY_DATE = [201, 204, 301, 41, 42, 302, 43, 303, 202, 44, 203, 304];
const DAYS = ['Today', 'Yesterday', dayName(NOW - 3 * D), dayName(NOW - 6 * D)];
const BOARD = ['Queued 2: 303,44', 'Waiting 3: 201,204,301', 'In progress 2: 41,302', 'Needs you 1: 42',
  'Done 2: 43,304', 'Failed 1: 202', 'Cancelled 1: 203'];

group('a page of its own: one click from the top bar, Back, reload, cold');
{
  await click(btn('Chats', header()));
  const from = where();
  const n = w.history.length;
  await click(btn('Work', header()));
  ok('the top bar\'s Work button opens /work in one click, one entry',
    address() === '/work' && w.history.length === n + 1 && drawn(), `${from} → ${address()} · ${n} → ${w.history.length}`);
  ok('…and the button says it is the page you are on',
    btn('Work', header())?.getAttribute('aria-current') === 'page');
  ok('it draws in-flight and this week\'s finished tickets, grouped by project, in flight first, red first',
    same(rowIds(), BY_PROJECT) && same(projects(), ['quire', 'isghocam-seo', 'nl-artsen'])
    && grouping() === 'project' && same(pressed(), ['Project']),
    `${rowIds().join(' ')} · ${projects().join(' ')}`);
  ok('the head counts them in words, finished ones too',
    head() === '2 running · 1 needs you · 3 waiting · 2 queued · 2 done, 1 failed and 1 cancelled this week', head());
  const r = rowOf(302);
  ok('a row says project, #id and title, stage and round, both ages and the last event',
    !!r && r.textContent.includes('#302 isghocam-seo ticket 302')
    && r.querySelector('[data-work-meta]')?.textContent === 'isghocam-seo · check r2 · 10m in this round · open 2h 0m'
    && r.querySelector('[data-work-line]')?.textContent.trim() === 'progress on 302',
    r?.textContent);
  ok('…its status in words', (rowOf(42)?.querySelector('.dv-status')?.textContent ?? '') === 'needs you'
    && (rowOf(201)?.querySelector('.dv-status')?.textContent ?? '') === 'usage limit');
  ok('a finished row says how it ended, when, and that it was merged',
    rowOf(43)?.querySelector('.dv-status')?.textContent === 'done'
    && rowOf(43)?.querySelector('[data-work-meta]')?.textContent === 'quire · done today 11:59 · merged · worker r1'
    && rowOf(202)?.querySelector('.dv-status')?.textContent === 'failed'
    && rowOf(202)?.querySelector('[data-work-meta]')?.textContent.includes('failed yesterday 11:00')
    && !rowOf(202)?.hasAttribute('data-merged')
    && rowOf(203)?.querySelector('.dv-status')?.textContent === 'cancelled',
    `${rowOf(43)?.querySelector('[data-work-meta]')?.textContent} · ${rowOf(202)?.querySelector('[data-work-meta]')?.textContent}`);

  await pop(-1);
  ok('Back returns to where you were', where() === from && !page(), where());
  await pop(1);
  ok('…and Forward is the page again', where() === '/work' && drawn());

  await reload('/work');
  ok('a reload stays on it and draws it', where() === '/work' && drawn() && head().includes('running'));
  await cold('/work');
  ok('the path opened cold draws it', where() === '/work' && same(rowIds(), BY_PROJECT), rows().join(' '));
}

group('Show older adds the week before, in the address');
{
  const n = w.history.length;
  ok('before: nothing finished more than seven days ago', !rowOf(305) && !rowOf(306) && !!older());
  await click(older());
  ok('pressed once: the one ten days ago joins its project, and the address says so',
    address() === '/work?older=1' && w.history.length === n + 1
    && same(rowIds(), [42, 41, 44, 43, 305, 302, 301, 303, 304, 201, 204, 202, 203]),
    `${address()} · ${rowIds().join(' ')}`);
  ok('…the head counts two weeks', head().endsWith('3 done, 1 failed and 1 cancelled in the last 2 weeks'), head());
  await click(older());
  ok('pressed twice: the one twenty days ago too, and nothing older is left to show',
    address() === '/work?older=2' && rowIds().includes(306) && !older(), `${address()} · ${rowIds().join(' ')}`);
  await pop(-1);
  await pop(-1);
  ok('Back twice is the last seven days again', address() === '/work' && same(rowIds(), BY_PROJECT) && !!older(), address());
}

group('Board, Project and Date: each in the address, Back undoes a switch');
{
  await click(choice('Date'));
  ok('Date groups by day, Today, Yesterday, then dates, newest first',
    address() === '/work?group=date'
    && same(days(), DAYS) && same(rowIds(), BY_DATE) && same(pressed(), ['Date']) && projects().length === 0,
    `${address()} · ${days().join(' | ')} · ${rowIds().join(' ')}`);
  await click(choice('Board'));
  ok('Board draws a column per status, in order, each ticket in its own, with its count',
    address() === '/work?view=board' && same(columns(), BOARD) && same(pressed(), ['Board']),
    `${address()} · ${JSON.stringify(columns())}`);
  const c = rowOf(302);
  ok('…a card says #id, title, project, stage and round, and age',
    !!c && c.textContent.includes('#302 isghocam-seo ticket 302')
    && c.querySelector('[data-work-meta]')?.textContent === 'isghocam-seo · check r2 · open 2h 0m'
    && rowOf(43)?.querySelector('[data-work-meta]')?.textContent === 'quire · done today 11:59 · merged',
    c?.textContent);
  ok('…and it is read-only: nothing on it can be dragged',
    !doc.querySelector('[data-work-board] [draggable="true"]'));
  await click(choice('Project'));
  ok('Project is the default again, with nothing in the address',
    address() === '/work' && same(rowIds(), BY_PROJECT) && same(pressed(), ['Project']), address());

  await pop(-1);
  ok('Back undoes the switch: the board', address() === '/work?view=board' && grouping() === 'board'
    && same(columns(), BOARD), address());
  await pop(-1);
  ok('…Back again: by date', address() === '/work?group=date' && same(days(), DAYS), address());
  await pop(-1);
  ok('…and again: by project', address() === '/work' && same(projects(), ['quire', 'isghocam-seo', 'nl-artsen']), address());
  await pop(1);
  ok('Forward redoes it', address() === '/work?group=date' && grouping() === 'date');

  await reload('/work?group=date');
  ok('a reload keeps the date grouping', address() === '/work?group=date' && same(days(), DAYS) && same(rowIds(), BY_DATE),
    `${address()} · ${days().join(' | ')}`);
  await reload('/work?view=board');
  ok('a reload keeps the board', address() === '/work?view=board' && same(columns(), BOARD), address());
  await cold('/work?group=date&older=1');
  ok('a URL opened cold draws its grouping and its range',
    address() === '/work?group=date&older=1' && grouping() === 'date' && rowIds().includes(305)
    && days().includes(dayName(NOW - 10 * D)) && same(pressed(), ['Date']),
    `${address()} · ${days().join(' | ')}`);
  await cold('/work?view=board&older=1');
  ok('…and a board opened cold, its Done column reaching the same range',
    grouping() === 'board' && columns()[4] === 'Done 3: 43,304,305', JSON.stringify(columns()));
  await cold('/work');
}

group('live: a new snapshot redraws the rows, no reload');
{
  const before = rowOf(41)?.querySelector('[data-work-meta]')?.textContent ?? '';
  const mountedPage = page();
  tickets = queue().map((x) => (x.id === 41 ? { ...x, stage: 'check', updated_at: Date.now() / 1000 } : x))
    .concat([t(45, 'quire', 'running', { title: 'a new one', stage: 'worker' })]);
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    await tick(25);
    moved = !!rowOf(45) && (rowOf(41)?.querySelector('[data-work-meta]')?.textContent ?? '').includes('check r1');
  }
  ok('#41 moved worker → check on its row', before.includes('worker r1')
    && (rowOf(41)?.querySelector('[data-work-meta]')?.textContent ?? '').includes('check r1'),
    `${before} → ${rowOf(41)?.querySelector('[data-work-meta]')?.textContent}`);
  ok('…a ticket that started appeared', !!rowOf(45) && rowOf(45).textContent.includes('#45 a new one'));
  ok('…the head counted it', head().startsWith('3 running · 1 needs you · 3 waiting · 2 queued'), head());
  ok('…and it was the same page, not a reload', page() === mountedPage && where() === '/work');
  tickets = queue();
  for (let i = 0; i < 40 && rowOf(45); i++) await tick(25);
  ok('…and a ticket that is gone from the snapshot is gone from the page', !rowOf(45));
}

group('a row opens the ticket\'s own page, and Back returns to the same layout');
{
  const n = w.history.length;
  await click(rowOf(41));
  ok('a ticket with a card on a board opens that card\'s page',
    where() === '/p/quire/c/k1' && w.history.length === n + 1 && !page(), where());
  await pop(-1);
  ok('Back is the live page again', where() === '/work' && drawn(), where());

  await click(rowOf(202));
  ok('a finished ticket on no board opens the queue\'s wall with it open',
    where() === '/machine/terminal/ustabasi/202' && !!doc.querySelector('[aria-label="Back to the wall"]'), where());
  const back = header().querySelector('button.dv-back');
  ok('…whose way back says where it came from', back?.getAttribute('aria-label') === 'Back to Work',
    back?.getAttribute('aria-label'));
  await pop(-1);
  ok('Back is the live page again', where() === '/work' && drawn(), where());

  await click(choice('Date'));
  await click(rowOf(203));
  ok('from the date grouping, a cancelled ticket opens too', where() === '/machine/terminal/ustabasi/203', where());
  await pop(-1);
  ok('…and Back returns to the date grouping', address() === '/work?group=date' && same(days(), DAYS), address());

  await click(choice('Board'));
  await click(rowOf(43));
  ok('from the board, a done card opens its ticket', where() === '/machine/terminal/ustabasi/43', where());
  await pop(-1);
  ok('…and Back returns to the board', address() === '/work?view=board' && same(columns(), BOARD), address());
  await click(rowOf(41));
  ok('…a running card on a Divan board opens its card\'s page', where() === '/p/quire/c/k1', where());
  await pop(-1);
  ok('…and Back is the board again', address() === '/work?view=board' && grouping() === 'board', address());
}

group('nothing in flight and nothing finished this week: one sentence');
{
  await cold('/work');
  tickets = queue().filter((x) => x.id === 305 || x.id === 306);
  for (let i = 0; i < 40 && rows().length; i++) await tick(25);
  ok('no sections, no rows', rows().length === 0 && projects().length === 0
    && !page()?.querySelector('.dv-sec'));
  ok('…and the page says so in one sentence', head() === W.nothing(0), head());
  ok('…with Show older there for what is older', !!older());
  await click(choice('Board'));
  ok('the board still draws every column, each saying 0',
    same(columns(), ['Queued 0: ', 'Waiting 0: ', 'In progress 0: ', 'Needs you 0: ', 'Done 0: ', 'Failed 0: ', 'Cancelled 0: ']),
    JSON.stringify(columns()));
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
