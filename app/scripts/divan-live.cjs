/** The merged Divan view, built out of computers that are actually answering.
 *
 *  `test-divan-merge.cjs` checks the judgement against snapshots written by
 *  hand, and `daemon/scripts/test_divan.py` checks the handler against a board
 *  built in a temporary directory. Both are hermetic, which is what makes them
 *  CI, and neither has ever crossed a network.
 *
 *  This has. It asks each paired computer for the real `divan.snapshot` over a
 *  real socket — through the app's own `callOnce`, so what is exercised is the
 *  request the phone makes and the timeout it makes it with — and pushes what
 *  comes back through the app's own `answered`, `silent` and `merge`. What it
 *  prints is what a dashboard would have on it, as text.
 *
 *      node scripts/divan-live.cjs studio=127.0.0.1:8790:TOKEN mini=192.168.1.9:8790:TOKEN
 *
 *  A machine may be given with no token (`sleeping=10.255.255.1:8790`), which is
 *  how the one case that cannot be staged on a desk gets exercised: a computer
 *  that does not refuse the connection and does not answer it either. The view
 *  has to render without it, inside the timeout, and say which machine it is
 *  short of.
 *
 *      --again=20   poll every machine once more after 20 seconds
 *
 *  which is the way to watch the rule this whole ticket is built on: stop one of
 *  the daemons in between, and its projects and cards stay in the view, marked
 *  with how long ago they were last true, while everything else stays live.
 *
 *  Not in CI and it must not be: it needs computers. Nothing here writes to any
 *  of them — `divan.snapshot` is a read, and the mirror it runs on the way past
 *  writes only to the board of the machine being asked.
 */
const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The modules are loaded where they live rather than copied to a temporary
// file: `ws.ts` imports the string table at runtime, and a copy in /tmp cannot
// see its own neighbours. Same hook `render-divan.cjs` uses.
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    mod._compile(transform(fs.readFileSync(filename, 'utf8'),
      { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
  };
}
const load = (file) => require(path.join(root, file));

const D = load('src/divan.ts');
// The app's own request, not a copy of it written here: the socket it opens, the
// one message it sends, and the timeout that covers the whole round trip.
const { callOnce } = load('src/ws.ts');
const { since } = load('src/tickets.ts');
const { t } = load('src/i18n.ts');
const UNIT = (k) => t(k);

// ── what was asked for ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const again = Number((args.find((a) => a.startsWith('--again=')) || '').split('=')[1] || 0);
const machines = [];
for (const a of args) {
  if (a.startsWith('--')) continue;
  const [name, rest] = a.split('=');
  const [host, port, token] = (rest || '').split(':');
  if (!name || !host || !port) {
    console.error(`cannot read "${a}" — expected name=host:port:token`);
    process.exit(2);
  }
  machines.push({ id: `h-${name}`, name, host, port: Number(port), token: token || '' });
}
if (!machines.length) {
  console.log('nothing to ask. Usage: node scripts/divan-live.cjs name=host:port:token …');
  process.exit(0);
}

const fails = [];
const holds = (what, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : `  — ${detail}`}`);
  if (!ok) fails.push(what);
};

/** One round of asking every machine, exactly as the store does it: all of them
 *  at once, each on its own timeout, and a failure keeps whatever that machine
 *  last said. */
async function poll(kept) {
  const started = Date.now();
  const next = { ...kept };
  await Promise.all(machines.map(async (m) => {
    try {
      const snap = await callOnce(m.host, m.port, m.token, 'divan.snapshot', {}, D.DIVAN_TIMEOUT_MS);
      next[m.id] = D.answered(snap, Date.now() / 1000);
    } catch (e) {
      next[m.id] = D.silent(kept[m.id], e && e.message ? e.message : String(e));
    }
  }));
  return { kept: next, took: Date.now() - started };
}

function draw(view, now) {
  const age = (s) => (s == null ? 'never' : since(Math.max(0, now - s), UNIT));
  console.log('\nmachines');
  for (const h of view.hosts) {
    const state = h.missing ? 'no answer yet' : h.reachable ? 'reachable' : 'unreachable';
    const q = h.quota
      ? h.quota.spent ? `quota spent, back in ${age(2 * now - (h.quota.resets_at || now))}`
        : h.quota.left == null ? 'quota unknown'
        : `quota ${Math.round(h.quota.left * 100)}% left`
      : 'no quota';
    console.log(`  ${h.machine.padEnd(14)} ${state.padEnd(14)} last contact ${age(h.at).padEnd(8)}` +
                `  ${h.cards} cards · ${h.running} running · ${h.waiting} waiting · ${q}` +
                (h.error && !h.reachable ? `\n    ${h.error}` : ''));
  }
  const T = view.totals;
  console.log(`\n${T.needsYou} needs you · ${T.stuck} stuck · ${T.running} running · ` +
              `${T.unknown} unknown · ${T.paused} paused · ${T.queued} queued`);
  console.log(T.complete ? 'all of it live'
    : `partly as of ${T.asOf ? new Date(T.asOf * 1000).toLocaleTimeString() : 'never'}`);
  console.log('\nprojects');
  for (const p of view.projects) {
    console.log(`  ${p.name.padEnd(20)} on ${p.machines.join(', ').padEnd(20)}` +
                ` ${p.running} running · ${p.waiting} waiting · ${p.cards.length} open cards` +
                (p.stale ? `  (stale: ${p.staleMachines.join(', ')}, last seen ${age(p.lastSeen)})` : ''));
    for (const col of D.COLUMNS) {
      const cards = D.column(p, col);
      if (cards.length) {
        console.log(`      ${col}: ${cards.map((c) => `${c.title} [${c.machine}` +
          `${c.agent_status ? ' · ' + c.agent_status : ''}${c.stale ? ' · stale' : ''}]`).join(', ')}`);
      }
    }
  }
}

(async () => {
  let { kept, took } = await poll({});
  let now = Date.now() / 1000;
  let view = D.merge(D.entries(machines, kept), now);
  draw(view, now);

  console.log('');
  const answering = view.hosts.filter((h) => h.reachable);
  holds('every machine that answered says when it did',
        answering.every((h) => h.at != null && h.age != null), JSON.stringify(view.hosts));
  holds('every machine that answered says which computer it is',
        answering.every((h) => h.machine), JSON.stringify(answering.map((h) => h.machine)));
  holds('a machine that did not answer does not take the view down with it',
        view.hosts.some((h) => h.reachable) || machines.length === 0);
  holds(`the whole round finished inside one timeout (${took} ms)`,
        took <= D.DIVAN_TIMEOUT_MS + 2000, `${took} ms`);
  holds('the totals admit it when a machine is missing',
        view.totals.complete === (view.hosts.length > 0 && view.hosts.every((h) => h.reachable && !h.missing)));
  holds('no product appears twice', (() => {
    const keys = view.projects.map((p) => p.key);
    return new Set(keys).size === keys.length;
  })(), JSON.stringify(view.projects.map((p) => p.key)));
  holds('every card is attributed to a machine',
        view.cards.every((c) => c.machine && c.host));
  holds('every agent at work says where it is running',
        view.agents.every((a) => a.machine && a.status === 'running'));

  if (again > 0) {
    console.log(`\nasking again in ${again}s — stop one of the daemons now to watch its work go stale`);
    await new Promise((r) => setTimeout(r, again * 1000));
    const before = kept;
    ({ kept, took } = await poll(kept));
    now = Date.now() / 1000;
    const after = D.merge(D.entries(machines, kept), now);
    draw(after, now);
    console.log('');
    const lost = view.hosts.filter((h) => h.reachable)
      .filter((h) => !after.hosts.find((x) => x.id === h.id).reachable);
    holds('a machine that has stopped answering keeps everything it had',
          lost.every((h) => kept[h.id].snapshot === before[h.id].snapshot
                         && kept[h.id].at === before[h.id].at),
          JSON.stringify(lost.map((h) => h.machine)));
    if (lost.length) {
      holds('…and its work is still in the view, marked stale',
            lost.every((h) => after.cards.some((c) => c.host === h.id && c.stale)
                           || after.hosts.find((x) => x.id === h.id).cards === 0),
            JSON.stringify(after.cards.filter((c) => c.stale).map((c) => c.title)));
      holds('…and the totals stop claiming to be complete', after.totals.complete === false);
    }
  }

  console.log(fails.length ? `\n${fails.length} failed` : '\nok');
  process.exit(fails.length ? 1 : 0);
})();
