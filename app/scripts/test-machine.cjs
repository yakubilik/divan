/** The Machine place: the drawer, the machines and the executors (Mobile11
 *  S16, S15, S14).
 *
 *  Four promises, and each of them is checked here: the three screens are drawn
 *  in the design's own colours in both themes and against no data, stale data
 *  and a machine that cannot be reached; an unreachable machine says when it
 *  was last reached and wears it; every executor says what it is for, where it
 *  runs, what it is on and which of the three states it is in; and nothing the
 *  Machine place led to before this ticket stopped being reachable from it.
 *
 *  Run: node scripts/test-machine.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const h = R.React.createElement;

const A = require(path.join(root, 'src/machine.ts'));
const S = require(path.join(root, 'src/shell.ts'));
const D = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the fleet the frames draw ───────────────────────────────────────────────
//
// Mobile11 S15's three computers: `studio` answering with work on it, `mini`
// quiet for two hours and fourteen minutes with a worker that was running when
// it went, and a third that has never answered at all — which no frame draws
// and every phone meets the first time it pairs something.
//
// Measured against this moment, not a round number: every age on the page is
// aged off the phone's own clock.
const NOW = Math.floor(Date.now() / 1000);
const QUIET = 2 * 3600 + 14 * 60;

const branch = (kind, name) => ({ id: `${kind}-id`, kind, name, summary: '', summary_at: null,
  cards: {}, open: 0 });
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), summary: '',
  repos: [], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  branches: o.branches || [], counts: {}, running: o.running || 0, waiting: o.waiting || 0,
  summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: 'e', branch: 'engineering', column: o.column || 'in_progress',
  position: 0, title: o.title || id, summary: '', executor: o.executor ?? 'coding_agent', machine: null,
  repo: null, ustabasi_id: null, agent_status: o.status ?? null, agent_status_at: null,
  agent_detail: '', created_at: 0, updated_at: 0, moved_at: null,
});
const agent = (id, o = {}) => ({ card_id: id, project_id: o.project, project: o.project, branch: o.branch || '',
  title: o.title || id, executor: o.executor || 'coding_agent', machine: o.machine, status: 'running',
  detail: o.detail || '', since: NOW - 300, ustabasi_id: null });
const snapshot = (machine, o) => ({ machine, os: o.os ?? 'Darwin', at: o.at, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: o.quota ?? null, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: null, old: false } });

const QUOTA = { enabled: true, accounts: 2, blocked: 0, spent: false, left: 0.64,
                resets_at: NOW + 4 * 3600 + 44 * 60, unknown: false };

const STUDIO = paired('h1', 'studio', {
  reachable: true, at: NOW - 12,
  snapshot: snapshot('studio', { at: NOW - 12, quota: QUOTA,
    projects: [project('Quire', { running: 2, waiting: 1, branches: [branch('seo', 'SEO')] })],
    cards: [card('c1', { project: 'Quire-id', title: 'Onboarding email', executor: 'human' })],
    agents: [agent('c2', { project: 'Quire-id', machine: 'studio', title: 'Bulk invite from CSV' }),
             agent('c3', { project: 'Quire-id', machine: 'studio', executor: 'branch_agent',
                           branch: 'seo', title: 'Comparison pages' })] }),
});
const MINI = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Hush', { running: 1 })], cards: [],
    agents: [agent('c4', { project: 'Hush-id', machine: 'mini', title: 'Safari 17 login' })] }),
});
/** Paired a moment ago and still silent: nothing of it to draw at all. */
const CLOUD = paired('h3', 'cloud', { reachable: false });

const FLEET = [STUDIO, MINI, CLOUD];
const view = D.merge(FLEET, NOW);
const ago = (s) => (s == null ? '' : `${Math.floor(s / 60)}m`);
const lines = A.machineLines(view, ago);
const at = (name) => lines.find((m) => m.machine === name);
const groups = A.executorGroups(view);
const rows = groups.flatMap((g) => g.rows);
const words = (w) => (w.said ? w.said.key : w.text);

// ── 1 · the three screens, in both themes and in every state ────────────────
//
// "Matches S16, S15 and S14 in both themes" is a claim about what comes out, so
// the three are stood up for real — against a phone that has heard nothing,
// against the fleet above (which is stale data and an unreachable machine at
// once), and in each theme. Nothing on any of them may paint a colour the
// artboards did not name.

const SCREENS = {
  drawer: require(path.join(root, 'app/machine.tsx')).default,
  machines: require(path.join(root, 'app/machines.tsx')).default,
  executors: require(path.join(root, 'app/executors.tsx')).default,
};
const STATES = {
  'nothing paired': [],
  'a fleet with one machine silent and one that never answered': FLEET,
};

function draw(scheme, name, hosts) {
  R.store.reset();
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    loadDivan() {}, conn: 'online', switchHost() {}, removeHost() {},
    ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  return R.render(scheme, h(SCREENS[name]));
}

const drawn = {};
{
  const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;
  for (const scheme of ['dark', 'light']) {
    const tok = K.tokensFor(scheme);
    const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR, 'transparent',
                         ...K.MONOGRAM, K.EXEC_PENDING_INK, K.EXEC_PENDING_LINE,
                         ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean)]);
    const strayed = new Set();
    let threw = null;
    for (const [name] of Object.entries(SCREENS)) {
      for (const [state, hosts] of Object.entries(STATES)) {
        let markup;
        try { markup = draw(scheme, name, hosts); }
        catch (e) { threw = `${name}, ${state}: ${e.message}`; break; }
        drawn[`${scheme}:${name}:${hosts.length ? 'fleet' : 'empty'}`] = markup;
        for (const v of R.paint(markup)) {
          const inside = v.match(COLOUR) ?? [];
          for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) if (!own.has(c)) strayed.add(c);
        }
      }
      if (threw) break;
    }
    checks.push([`${scheme}: all three screens stand up with no data, with stale data and with a machine that cannot be reached${threw ? ` (${threw})` : ''}`,
      threw === null]);
    checks.push([`${scheme}: and none of the three paints a colour the artboards did not name${strayed.size ? ` (${[...strayed].join(', ')})` : ''}`,
      strayed.size === 0]);
  }
  R.store.reset();
}

const page = (name) => drawn[`dark:${name}:fleet`];

checks.push(
  // S16: the drawer's own list, with the two pages this ticket draws at the top
  // of it and everything that was already here under them.
  ['the drawer opens on Machines and Executors, above the screens that were already here',
    eq(S.machineRows({ machines: 3, unreachable: 1, executors: 9 }).map((r) => r.route),
       ['/machines', '/executors', '/agents', '/screen', '/accounts', '/pool', '/call', '/settings'])
    && page('drawer').includes('mExecutors') && page('drawer').includes('mMachines')],
  // S15: quota over the cards, a card per computer, and the two ways in and out
  // of the list — pairing one and putting one away.
  ['the machines page is the quota, a card per computer, and the way to pair another',
    page('machines').includes('maQuota') && page('machines').includes('maQuotaLeft')
    && ['studio', 'mini', 'cloud'].every((n) => page('machines').includes(n))
    && page('machines').includes('maPair')],
  // S14: the group heading carries what that kind of worker is for, which is
  // what keeps a row one line long.
  ['the executors page groups them by kind, and the heading says what each kind is for',
    page('executors').includes('exgCoders') && page('executors').includes('exgCodersNote')
    && page('executors').includes('exgBranch') && page('executors').includes('exgBranchNote')],
  // Neither page invents a fleet it has not got.
  ['a phone with nothing paired says so on both pages rather than drawing an empty list',
    drawn['dark:machines:empty'].includes('maNone') && drawn['dark:executors:empty'].includes('exNone')],
);

// ── 2 · a machine that cannot be reached ────────────────────────────────────

checks.push(
  ['a machine that stopped answering says so, and says when it was last reached',
    at('mini').says === 'maUnreachable'
    && eq(at('mini').figures.map((f) => f.label), ['maLastContact', 'maRunning'])
    && at('mini').figures[0].value.said.params.d === ago(QUIET)],
  ['…and the staleness is worn rather than left to be inferred: an amber ring, a hollow dot, an amber number',
    at('mini').ring === 'amber' && at('mini').figures[0].tone === 'amber'
    && at('mini').state !== 'running'
    && R.styles(page('machines')).some((s) => s.borderColor === K.DARK.amberRing)
    && R.styles(page('machines')).some((s) => s.color === K.DARK.amber)],
  ['…and what it was running is not read as what it is running',
    at('mini').figures[1].value.said.key === 'maUnknownTasks'
    && at('studio').figures[1].value.said.key === 'maTasks'],
  ['a machine that has never answered has no last contact to print, and says that instead',
    at('cloud').says === 'maNever' && at('cloud').figures.length === 0
    && at('studio').says === 'maReachable'],
  ['…and both of them offer the one thing that helps, which is asking again',
    eq(at('cloud').actions, ['retry']) && eq(at('mini').actions, ['retry'])
    && eq(at('studio').actions, ['screen'])],
);

// ── 3 · what an executor says ──────────────────────────────────────────────

checks.push(
  ['every executor says who it is, which machine it is on, what it is doing and which of the three states it is in',
    rows.length > 0 && rows.every((r) => words(r.who) && words(r.machine) && words(r.doing)
      && ['busy', 'idle', 'unavailable'].includes(r.state))],
  ['a worker on a machine that has gone quiet is unavailable, and the row names the machine',
    (() => { const r = rows.find((x) => x.doing.said?.key === 'exSilent');
             return !!r && r.state === 'unavailable' && r.doing.said.params.machine === 'mini'
               && r.doing.said.params.what === 'Safari 17 login'; })()],
  ['a branch agent is named by its branch and grouped with the others of its kind',
    (() => { const g = groups.find((x) => x.title === 'exgBranch');
             // `SEO` and not `seo`: the kind is how the merge folds a branch, the
             // name is what anybody calls it, and the branch page says the same.
             return !!g && g.rows.length === 1 && g.rows[0].who.text === 'SEO'
               && words(g.rows[0].machine) === 'studio' && g.rows[0].state === 'busy'; })()],
  ['a computer with nothing running on it is the row that says it could take the next ticket',
    (() => {
      const spare = paired('h4', 'spare', { reachable: true, at: NOW, snapshot: snapshot('spare', { at: NOW }) });
      const r = A.executorGroups(D.merge([spare], NOW)).flatMap((g) => g.rows).find((x) => x.key === 'h4:free');
      return !!r && r.state === 'idle' && r.doing.said.key === 'exNothing' && words(r.machine) === 'spare';
    })()],
  ['…and a computer that has never answered is in neither list, because nothing is known about it',
    rows.every((r) => !r.key.startsWith('h3:')) && words(rows.find((r) => r.key === 'h2:c4').machine) === 'mini'],
  ['…and one whose quota has run out cannot, and says that instead of being left out',
    (() => {
      const out = paired('h5', 'dry', { reachable: true, at: NOW,
        snapshot: snapshot('dry', { at: NOW, quota: { ...QUOTA, spent: true, left: 0 } }) });
      const r = A.executorGroups(D.merge([out], NOW)).flatMap((g) => g.rows).find((x) => x.key === 'h5:free');
      return !!r && r.state === 'unavailable' && r.doing.said.key === 'exNoQuotaBare';
    })()],
  ['the one worker on no machine says so, and his state is how much is waiting on him',
    (() => { const you = rows.find((r) => r.key === 'you');
             return !!you && you.machine.said.key === 'exNoMachine'
               && you.says.key === 'exNWaiting' && you.says.params.n === 1
               && you.doing.text === 'Onboarding email'; })()],
  ['…and with nothing waiting he is idle, which is one of the three',
    (() => { const you = A.executorGroups(D.merge([CLOUD], NOW)).flatMap((g) => g.rows)
               .find((r) => r.key === 'you');
             return !!you && you.state === 'idle' && you.says.key === 'exIdle'; })()],
  ['the drawer counts the same workers the page lists',
    A.executorCount(view) === rows.length],
);

// ── 4 · nothing that was reachable stopped being reachable ─────────────────
//
// The Machine place is where everything about a computer lives, and this ticket
// moves two of those screens behind new pages. The list below is every route
// reachable from `/machine` before it did — walked out of the sources the way
// `test-shell.cjs` walks them — and every one of them has to still be there.

const BEFORE = ['/account-login', '/accounts', '/agent-install', '/agent-store', '/agents', '/call',
                '/chat-settings', '/chat/[id]', '/divan-gallery', '/host-sheet', '/login-method',
                '/login-web', '/model-sheet', '/move-signin', '/pair', '/pool', '/screen', '/settings'];

function files() {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) out.push(next);
    }
  };
  walk('app');
  return out;
}

function leadsTo(file) {
  const code = src(file);
  const out = new Set();
  for (const m of code.matchAll(/router\.(?:push|replace)\(\s*['"`](\/[\w\-/[\]]+)['"`]/g)) out.add(m[1]);
  for (const m of code.matchAll(/pathname:\s*['"`](\/[\w\-/[\]]+)['"`]/g)) out.add(m[1]);
  for (const m of code.matchAll(/router\.(?:push|replace)\(\s*`(\/[\w-]+)\/\$\{/g)) out.add(`${m[1]}/[id]`);
  if (file === 'app/machine.tsx') for (const r of S.MACHINE_ROUTES) out.add(r);
  return [...out];
}

const ROUTE_OF = (f) => '/' + f.replace(/^app\//, '').replace(/\/index\.tsx$/, '').replace(/\.tsx?$/, '');
const GRAPH = new Map(files().filter((f) => !/_layout\.tsx$|^app\/index\.tsx$/.test(f))
  .map((f) => [ROUTE_OF(f), leadsTo(f)]));

const reachable = (() => {
  const seen = new Set(['/machine']);
  const queue = ['/machine'];
  while (queue.length) {
    for (const next of GRAPH.get(queue.shift()) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
})();

checks.push(['every screen the Machine place led to before this ticket still leads there',
  (() => { const lost = BEFORE.filter((r) => !reachable.has(r));
           return lost.length === 0 || `lost ${lost.join(', ')}`; })() === true],
  ['…and the two new pages are in it', reachable.has('/machines') && reachable.has('/executors')]);

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
