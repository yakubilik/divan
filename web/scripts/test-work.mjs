#!/usr/bin/env node
/** Work in flight (`/work`): every ticket the queue is on, across every project.
 *
 *     cd web && npm test
 *
 *  Two halves. First `lib/work.ts` on its own: a snapshot with a ticket in
 *  every state on three projects — one on a Divan board, two on none — and
 *  exactly which rows come out, in which order, with which words and counts.
 *  Then the whole panel mounted into jsdom the way `test-nav.mjs` mounts it,
 *  its computer answering through a faked `call` (the socket's one door):
 *  the top bar's Work button, Back, a reload and the path opened cold; a new
 *  snapshot redrawing the rows with no reload; a row opening the ticket's own
 *  page and Back returning; and the page with nothing in flight.
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

const load = (p) => import(pathToFileURL(join(out, p)).href);
const W = await load('src/lib/work.js');
const { workPoll } = await load('src/screens/Work.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { ticket: base } = await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);
const { host: fixtureHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

// ── the queue ───────────────────────────────────────────────────────────────

const NOW = Date.now() / 1000;
/** A ticket in a project, `ago` seconds since it last moved. */
const t = (id, project, status, over = {}) => base({
  id, project, status, title: `${project} ticket ${id}`, repo: `/Users/x/projects/${project}`,
  stage: 'worker', round: 1, created_at: NOW - 7200, updated_at: NOW - id, started_at: NOW - 3600,
  round_started_at: NOW - 600, finished_at: status === 'done' || status === 'cancelled' ? NOW - 60 : null,
  escalation: '', ask: '', notes: [], note_count: 0, steps: [],
  last_event: { ts: NOW - 30, kind: 'report', msg: `[worker] progress on ${id}` },
  ...over,
});

/** Three projects, a ticket in each state. Quire is on a Divan board (#41 is
 *  card k1 on it); nl-artsen and isghocam-seo are on none. */
const queue = () => [
  t(41, 'quire', 'running'),
  t(42, 'quire', 'blocked', { escalation: '- which key?' }),
  t(43, 'quire', 'done'),
  t(44, 'quire', 'queued', { started_at: null, round_started_at: null, last_event: { ts: NOW - 40, kind: 'created', msg: 'quire ticket 44' } }),
  t(201, 'nl-artsen', 'queued', { last_event: { ts: NOW - 20, kind: 'limit', msg: 'account main limited until 17:05; waiting it out' } }),
  t(202, 'nl-artsen', 'failed', { last_event: { ts: NOW - 20, kind: 'failed', msg: 'check failed three times' } }),
  t(203, 'nl-artsen', 'cancelled'),
  t(204, 'nl-artsen', 'queued', { last_event: { ts: NOW - 20, kind: 'waiting', msg: 'worker is waiting 30m (until 18:00): CI' } }),
  t(301, 'isghocam-seo', 'queued', { depends_on: 302, started_at: null, round_started_at: null,
    last_event: { ts: NOW - 20, kind: 'depends', msg: 'waits for #302' } }),
  t(302, 'isghocam-seo', 'running', { stage: 'check', round: 2 }),
  t(303, 'isghocam-seo', 'queued', { started_at: null, round_started_at: null, last_event: null, goal: 'Write the sitemap.' }),
  t(304, 'isghocam-seo', 'done'),
];

// ── 1 · which rows, in what order, in which words ───────────────────────────

group('which tickets are in flight, across three projects');
{
  const snap = { available: true, tickets: queue(), queue: { last_tick: NOW } };
  const rows = W.flights('studio', snap, NOW);
  const ids = rows.map((f) => f.ticket.id).sort((a, b) => a - b);
  ok('running, queued, waiting and red are in; done and cancelled are not',
    JSON.stringify(ids) === JSON.stringify([41, 42, 44, 201, 202, 204, 301, 302, 303]), JSON.stringify(ids));
  ok('…including both projects that are on no board', ids.includes(201) && ids.includes(303));
  const phase = Object.fromEntries(rows.map((f) => [f.ticket.id, `${f.phase}:${f.word}`]));
  ok('each says where it stands: red, running, parked for a reason, or next in line',
    phase[42] === 'red:needs you' && phase[202] === 'red:failed'
    && phase[41] === 'running:running' && phase[302] === 'running:running'
    && phase[201] === 'waiting:usage limit' && phase[204] === 'waiting:worker waiting'
    && phase[301] === 'waiting:waits for #302'
    && phase[44] === 'queued:queued' && phase[303] === 'queued:queued', JSON.stringify(phase));

  const groups = W.groupFlights(rows);
  const order = groups.map((g) => `${g.project}: ${g.rows.map((f) => f.ticket.id).join(',')}`);
  ok('grouped by project; red first, then running, then waiting, then queued — groups by their first row',
    JSON.stringify(order) === JSON.stringify([
      'quire: 42,41,44',
      'nl-artsen: 202,201,204',
      'isghocam-seo: 302,301,303',
    ]), JSON.stringify(order));
  ok('the head line counts them in words', W.headLine(rows) === '2 running · 2 need you · 3 waiting · 2 queued',
    W.headLine(rows));
  ok('…one needing you is said in the singular',
    W.headLine(rows.filter((f) => f.ticket.id !== 42)) === '2 running · 1 needs you · 3 waiting · 2 queued');

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
    W.flights('studio', { available: false, tickets: [] }, NOW).length === 0 && W.flights('studio', null, NOW).length === 0);
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
const reload = async (path) => {
  await act(async () => { root.unmount(); });
  w.history.pushState(null, '', path);
  root = createRoot(doc.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  await settle();
};
const page = () => doc.querySelector('[data-work]');
const rows = () => [...doc.querySelectorAll('[data-work-row]')].map((r) => r.getAttribute('data-work-row'));
const rowOf = (id) => doc.querySelector(`[data-work-row="studio:${id}"]`);
const head = () => (doc.querySelector('[data-work-head]')?.textContent ?? '').trim();
const projects = () => [...doc.querySelectorAll('[data-work-project]')].map((s) => s.getAttribute('data-work-project'));
const drawn = () => !!page() && rows().length > 0;

group('a page of its own: one click from the top bar, Back, reload, cold');
{
  await click(btn('Chats', header()));
  const from = where();
  const n = w.history.length;
  await click(btn('Work', header()));
  ok('the top bar\'s Work button opens /work in one click, one entry',
    where() === '/work' && w.history.length === n + 1 && drawn(), `${from} → ${where()} · ${n} → ${w.history.length}`);
  ok('…and the button says it is the page you are on',
    btn('Work', header())?.getAttribute('aria-current') === 'page');
  ok('it draws every ticket in flight, grouped by project, red first',
    JSON.stringify(rows()) === JSON.stringify([
      'studio:42', 'studio:41', 'studio:44',
      'studio:202', 'studio:201', 'studio:204',
      'studio:302', 'studio:301', 'studio:303',
    ]) && JSON.stringify(projects()) === JSON.stringify(['quire', 'nl-artsen', 'isghocam-seo']),
    `${rows().join(' ')} · ${projects().join(' ')}`);
  ok('the head counts them in words', head() === '2 running · 2 need you · 3 waiting · 2 queued', head());
  const r = rowOf(302);
  ok('a row says project, #id and title, stage and round, both ages and the last event',
    !!r && r.textContent.includes('#302 isghocam-seo ticket 302')
    && r.querySelector('[data-work-meta]')?.textContent === 'isghocam-seo · check r2 · 10m in this round · open 2h 0m'
    && r.querySelector('[data-work-line]')?.textContent.trim() === 'progress on 302',
    r?.textContent);
  ok('…its status in words', (rowOf(42)?.querySelector('.dv-status')?.textContent ?? '') === 'needs you'
    && (rowOf(201)?.querySelector('.dv-status')?.textContent ?? '') === 'usage limit');

  await pop(-1);
  ok('Back returns to where you were', where() === from && !page(), where());
  await pop(1);
  ok('…and Forward is the page again', where() === '/work' && drawn());

  await reload('/work');
  ok('a reload stays on it and draws it', where() === '/work' && drawn() && head().includes('running'));
  await act(async () => { root.unmount(); });
  w.history.replaceState(null, '', '/work');
  root = createRoot(doc.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await settle(); await settle();
  ok('the path opened cold draws it', where() === '/work' && drawn() && rows().length === 9, rows().join(' '));
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
  ok('…the head counted it', head() === '3 running · 2 need you · 3 waiting · 2 queued', head());
  ok('…and it was the same page, not a reload', page() === mountedPage && where() === '/work');
  tickets = queue();
  for (let i = 0; i < 40 && rowOf(45); i++) await tick(25);
  ok('…and a ticket that is gone from the snapshot is gone from the page', !rowOf(45));
}

group('a row opens the ticket\'s own page, and Back returns');
{
  const n = w.history.length;
  await click(rowOf(41));
  ok('a ticket with a card on a board opens that card\'s page',
    where() === '/p/quire/c/k1' && w.history.length === n + 1 && !page(), where());
  await pop(-1);
  ok('Back is the live page again', where() === '/work' && drawn(), where());

  await click(rowOf(202));
  ok('a ticket on no board opens the queue\'s wall with it open',
    where() === '/machine/terminal/ustabasi/202' && !!doc.querySelector('[aria-label="Back to the wall"]'), where());
  const back = header().querySelector('button.dv-back');
  ok('…whose way back says where it came from', back?.getAttribute('aria-label') === 'Back to Work',
    back?.getAttribute('aria-label'));
  await pop(-1);
  ok('Back is the live page again', where() === '/work' && drawn(), where());
}

group('nothing in flight: one sentence');
{
  tickets = queue().filter((x) => x.status === 'done' || x.status === 'cancelled');
  for (let i = 0; i < 40 && rows().length; i++) await tick(25);
  ok('no sections, no rows', rows().length === 0 && projects().length === 0
    && !page()?.querySelector('.dv-sec'));
  ok('…and the page says so in one sentence', head() === W.NOTHING, head());
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
