#!/usr/bin/env node
/** The Machine drawer's eight pages: Web15 W11–W18 and Web14 W10.
 *
 *     cd web && npm test
 *
 *  Covered here: that each page is the frame's page — its head, the frames' own
 *  table tracks and column names, the thresholds as sliders — with nothing
 *  paired and with a machine that cannot be reached; that a sign-in about to
 *  stop working is visible with what to do about it; and that the two
 *  thresholds are editable, are remembered, and change what the panel says and
 *  what it will start. Both themes and the five states of the fleet are
 *  `test-shell.mjs`, which draws every one of these pages in all of them; the
 *  drag a threshold refuses is `test-drive.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'machine');
const src = (p) => readFileSync(join(web, p), 'utf8');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/machine.ts', 'src/screens/Machine.tsx', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.',
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

// ── a browser, as far as a static render needs one ──────────────────────────

const html = { dataset: {} };
const query = { matches: false, addEventListener() {}, removeEventListener() {} };
const store = new Map();
let refuses = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem(k, v) { if (refuses) throw new Error('private mode'); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.document = {
  documentElement: html, hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelectorAll: () => [],
};
globalThis.window = {
  matchMedia: () => query, addEventListener() {}, removeEventListener() {},
  location: { pathname: '/', search: '', hash: '' },
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.location = globalThis.window.location;

const load = (p) => import(pathToFileURL(join(out, p)).href);
const K = await load('src/lib/theme.js');
const D = await load('src/lib/divan.js');
const M = await load('src/lib/machine.js');
const { useFleet } = await load('src/lib/fleet.js');
const MachineUI = await load('src/screens/Machine.js');
const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fakeHost, NOW } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const entry = (key, name, state) => ({ key, name, state });
const WORLDS = {
  alone: () => [],
  fresh: () => [
    entry('studio', 'studio', D.answered(fixture.studio(), NOW)),
    entry('mini', 'mini', D.answered(fixture.mini(), NOW)),
  ],
  unreachable: () => [
    entry('studio', 'studio', D.answered(fixture.studio(), NOW)),
    entry('mini', 'mini', D.silent(D.answered(fixture.mini(), NOW - 600), 'connection refused')),
  ],
};
const view = (world) => D.merge(WORLDS[world](), NOW);

function seed(patch) {
  Object.assign(useFleet.getInitialState(), patch);
  useFleet.setState(patch);
}
const paired = { hosts: { studio: fakeHost() }, order: ['studio'], focus: 'studio', ready: true };
const nothing = { hosts: {}, order: [], focus: null, ready: true };

/** One page of the drawer, without the drawer: the column is a `<nav>` and
 *  every page is drawn after it. */
function page(name, world = 'fresh') {
  seed(world === 'alone' ? nothing : paired);
  const markup = renderToStaticMarkup(h(MachineUI.Machine, {
    view: name, fleet: view(world), onView() {}, onOpenChat() {}, onNewChat() {},
    onNewChatIn() {}, onStartChat() {}, onPeek() {},
  }));
  const cut = markup.indexOf('</nav>');
  return { drawer: markup.slice(0, cut), body: markup.slice(cut) };
}

function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    return decl;
  });
}
const anyStyle = (markup, pred) => styles(markup).some(pred);
const v = (n) => `var(--dv-${n})`;
const words = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');
const has = (markup, ...all) => all.every((w) => words(markup).includes(w));

// ── 1 · the eight pages are the frames' pages ──────────────────────────────

group('each page is the frame’s page');
{
  const machines = page('machines');
  ok('Machines is W12’s table on W12’s tracks, under its own column names',
    anyStyle(machines.body, (d) => d['grid-template-columns']
      === '34px minmax(0, 1.4fr) 120px 110px 100px 110px minmax(0, 210px)')
    && has(machines.body, 'Machines', 'machine', 'state', 'last contact', 'running',
      'quota use today', 'studio', 'mini'),
    words(machines.body).slice(0, 200));
  ok('…with the three cards the frame ends on: the quota, the pairing and the quiet machine',
    has(machines.body, 'Agent quota', 'warn 20%', 'stop 5%',
      'Pair a new machine', 'remote-ai-chat pair', 'When a machine goes quiet'));

  const executors = page('executors');
  ok('Executors is W13’s table, and everyone who can do work is on it',
    anyStyle(executors.body, (d) => d['grid-template-columns']
      === '30px 110px minmax(0, 1.3fr) 90px minmax(0, 1.2fr) 110px')
    && has(executors.body, 'executor', 'what it is for', 'doing now', 'state')
    && has(executors.body, 'Coder', 'You'),
    words(executors.body).slice(0, 240));

  const accounts = page('accounts');
  ok('Accounts & sign-ins is W16’s table',
    anyStyle(accounts.body, (d) => d['grid-template-columns']
      === '36px minmax(0, 1.2fr) 150px minmax(0, 1fr) 110px 110px')
    && has(accounts.body, 'account', 'state', 'used by', 'last used'),
    words(accounts.body).slice(0, 200));

  const quota = page('quota');
  const sliders = [...quota.body.matchAll(/role="slider"[^>]*/g)].map((m) => m[0]);
  ok('Quota thresholds is W11’s three sliders, the two that are settings settable',
    sliders.length === 3 && sliders.filter((s) => s.includes('tabindex="0"')).length === 2
    && sliders.filter((s) => s.includes('aria-disabled="true"')).length === 1
    && has(quota.body, 'Warn on the system line at', 'Stop starting new tickets at',
      'Pause running agents at'),
    sliders.join('\n    '));

  const admin = page('admin');
  ok('Admin is W17’s list: a fact, where it stands, and one button',
    has(admin.body, 'Admin', 'Update', 'Agent logs', 'Sign-ins and keys', 'Folders',
      'What an agent may open', 'What this has cost')
    && (admin.body.match(/<button/g) ?? []).length >= 6,
    words(admin.body).slice(0, 240));

  const settings = page('settings');
  ok('Settings answers the theme where W18 does, as the frame’s own choice of three',
    /role="radiogroup"/.test(settings.body)
    && has(settings.body, 'Theme', 'Auto', 'Light', 'Dark')
    && /aria-checked="true"/.test(settings.body),
    words(settings.body).slice(0, 200));
}

group('with nothing paired, and with a machine that cannot be reached');
{
  for (const name of ['machines', 'executors', 'accounts', 'admin', 'settings']) {
    const alone = page(name, 'alone');
    ok(`${name} with nothing paired says so rather than drawing an empty table`,
      !anyStyle(alone.body, (d) => !!d['grid-template-columns']?.includes('minmax'))
      && /No computer|Nobody|No sign-ins|Nothing/.test(words(alone.body)),
      words(alone.body).slice(0, 160));
  }
  const alone = page('quota', 'alone');
  ok('quota thresholds are still settable with nothing paired, and say nothing was measured',
    [...alone.body.matchAll(/role="slider"/g)].length === 3
    && has(alone.body, 'no window has been measured yet'),
    words(alone.body).slice(-160));

  const gone = page('machines', 'unreachable');
  ok('the machine that cannot be reached is washed in amber, and offered the two buttons worth pressing',
    anyStyle(gone.body, (d) => d.background === v('amberBg'))
    && has(gone.body, 'unreachable', 'Try again', 'Remove')
    && has(gone.body, 'Terminal', 'Screen', 'Folders'),
    words(gone.body).slice(0, 240));
  ok('…and its agents are what was last known rather than what is running',
    has(gone.body, 'unknown'), words(gone.body).slice(0, 240));
}

// ── 2 · a sign-in that is about to stop working ────────────────────────────

group('a sign-in is seen expiring before it expires');
{
  const acc = (over) => ({
    id: 'a', provider: 'claude', label: 'yakup@…', logged_in: true,
    detail: 'subscription', is_default: false, ...over,
  });
  const day = 86_400;
  const inDays = (s) => `${Math.floor(s / day)} days`;
  const said = (over) => M.signInWords(acc(over), NOW, inDays);

  ok('a fortnight out it is expiring, with how long is left and what to do',
    M.signInState(acc({ expires_at: NOW + 12 * day }), NOW) === 'expiring'
    && said({ expires_at: NOW + 12 * day }) === 'expires in 12 days',
    said({ expires_at: NOW + 12 * day }));
  ok('…further out than that it is simply connected',
    M.signInState(acc({ expires_at: NOW + 15 * day }), NOW) === 'connected');
  ok('…past its date, and signed out, both say what to do about it',
    said({ expires_at: NOW - day }) === 'expired · sign in again'
    && said({ logged_in: false }) === 'signed out'
    && said({ logged_in: false, detail: 'the claude CLI is not installed' })
      === 'the CLI is not installed');

  const rows = M.signIns([{
    hostKey: 'studio', machine: 'studio', online: true, chats: [], limits: {},
    accounts: [acc({ id: 'ok' }), acc({ id: 'soon', expires_at: NOW + 12 * day })],
  }], NOW, inDays, () => '');
  ok('the one that is expiring is above the one that is fine, and asks to be renewed',
    eq(rows.map((r) => [r.accountId, r.action]), [['soon', 'Renew'], ['ok', 'Manage']])
    && rows[0].tone === 'amber' && M.signInsWanting(rows) === 1,
    JSON.stringify(rows.map((r) => [r.accountId, r.says, r.action])));

  const drawn = page('accounts');
  ok('the page draws it in amber with the button on its row',
    has(drawn.body, 'expires in 12 days', 'Renew')
    && anyStyle(drawn.body, (d) => d.background === v('amberBg')),
    words(drawn.body).slice(0, 300));
  ok('…and the drawer carries how many want a person, so it is seen from the other seven pages',
    /Accounts &amp; sign-ins<\/span><span[^>]*>2</.test(drawn.drawer)
    && anyStyle(drawn.drawer, (d) => d.color === v('amber')),
    words(drawn.drawer).slice(0, 200));
}

// ── 3 · the thresholds ─────────────────────────────────────────────────────

group('the thresholds are editable, remembered, and change what the panel does');
{
  const { setThreshold } = M.useThresholds.getState();
  const at = () => M.useThresholds.getState().thresholds;

  setThreshold({ warn: 0.333 });
  ok('a threshold is a whole percent', eq(at(), { warn: 0.33, stop: 0.05 }), JSON.stringify(at()));
  setThreshold({ stop: 0.5 });
  ok('…and stopping new work can never sit above warning about it',
    eq(at(), { warn: 0.5, stop: 0.5 }), JSON.stringify(at()));
  setThreshold({ warn: 0.2 });
  ok('…whichever of the two was moved being the one that wins',
    eq(at(), { warn: 0.2, stop: 0.2 }), JSON.stringify(at()));
  setThreshold({ stop: 0.05 });
  ok('…and what was set is remembered, because a setting that resets is not one',
    eq(JSON.parse(store.get('rac.quota')), { warn: 0.2, stop: 0.05 }), store.get('rac.quota'));

  refuses = true;
  setThreshold({ warn: 0.3 });
  refuses = false;
  ok('a browser that refuses to remember still moves it', at().warn === 0.3);

  // The same fleet, read against two different thresholds: the studio has 64%
  // of its window left and the mini has none.
  const fleet = view('fresh');
  const studio = fleet.hosts.find((x) => x.key === 'studio');
  ok('the fleet’s standing is read against the number that was set',
    M.quotaVerdict(fleet.quota, { warn: 0.3, stop: 0.05 }).state === 'ok'
    && M.quotaVerdict(fleet.quota, { warn: 0.7, stop: 0.05 }).state === 'warn'
    && M.quotaVerdict(fleet.quota, { warn: 0.8, stop: 0.7 }).state === 'stop',
    JSON.stringify(M.quotaVerdict(fleet.quota, { warn: 0.7, stop: 0.05 })));
  ok('…and so is whether the panel would start a ticket on a machine',
    M.startsWork(studio, { warn: 0.3, stop: 0.05 }) === true
    && M.startsWork(studio, { warn: 0.8, stop: 0.7 }) === false
    && M.refusedWords(studio, { warn: 0.8, stop: 0.7 }).includes('under the 70% you set'),
    M.refusedWords(studio, { warn: 0.8, stop: 0.7 }));
  ok('…while a machine whose answer is a memory is never refused on the strength of it',
    M.startsWork(view('unreachable').hosts.find((x) => x.key === 'mini'),
      { warn: 1, stop: 1 }) === true);

  setThreshold({ warn: 0.2, stop: 0.05 });
  const drawn = page('machines');
  ok('the machines page and the drawer read that one verdict',
    has(drawn.body, 'warn 20%', 'stop 5%'),
    words(drawn.body).slice(0, 200));
}

// ── 4 · the two the frames leave alone ─────────────────────────────────────

group('Terminals and Remote screen are the screens they were');
{
  const machine = src('src/screens/Machine.tsx');
  ok('both are still what those two rows open',
    /view === 'terminal'\) return <Terminal onPeek=\{onPeek\} onNewChat=\{onNewChat\} \/>/.test(machine)
    && /view === 'screen'\) return <Screen \/>/.test(machine));
  let diff = null;
  const files = ['src/screens/Terminal.tsx', 'src/screens/Screen.tsx'];
  try {
    diff = execFileSync('git', ['diff', '--stat', 'main', '--', ...files],
      { cwd: web, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* no git, or no main: the reading above is what is left */ }
  if (diff === null) console.log('  · no git to diff against: the dispatch was read instead');
  else ok('…and not one line of either has changed', diff === '', diff);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
