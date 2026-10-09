/** The wall, the (i) page and the chat, drawn from the queue that is running.
 *
 *  `test-ustabasi.cjs` checks the judgements against tickets written by hand,
 *  and `daemon/scripts/test_ustabasi_run.py` checks the handler against logs
 *  written by hand and one recording. Both are hermetic, which is what makes
 *  them CI, and neither of them has ever seen the queue.
 *
 *  This has. It asks the real daemon for the real snapshot, asks the real
 *  `ustabasi.run` for a real run's log, and pushes both through the same pure
 *  modules the three screens draw from — `groupByProject`, `cardLine`,
 *  `stepMark`, `marks`, `turns`. What comes out is what the phone would have
 *  on it, as text. It is the check behind the screenshots: a screenshot says
 *  the page drew, this says the page drew the right thing, and it can be run
 *  again tomorrow when the queue holds something else.
 *
 *      node scripts/ustabasi-live.cjs
 *
 *  It is not in CI and must not be: there is no queue on a build machine. With
 *  no queue on this machine either it says so and exits 0 — the absence of a
 *  queue is not a failing check, it is the reason this one is not CI.
 *
 *  Nothing here writes. The daemon opens the queue's database read-only and the
 *  run directories are only read, which is the rule the whole feature is built
 *  under: the queue is somebody else's program.
 */
const { execFileSync } = require('child_process');
const { transform } = require('sucrase');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');

function load(file, exports) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const js = transform(src, { transforms: ['typescript', 'imports'] }).code;
  const out = path.join(os.tmpdir(), 'rac-live-' + path.basename(file).replace(/\W/g, '-') + '.cjs');
  fs.writeFileSync(out, js + `\nmodule.exports={${exports.join(',')}};`);
  delete require.cache[out];
  return require(out);
}

const T = load('src/tickets.ts', ['STATUS_KEY', 'groupByProject', 'projectName', 'cardLine',
                                  'totalAge', 'roundAge', 'commitCount', 'marks', 'stepMark',
                                  'stepLine', 'stepAge', 'currentStep', 'answerable']);
const X = load('src/transcript.ts', ['turns', 'attach', 'trim', 'MAX_TURNS']);
const t = load('src/i18n.ts', ['t']).t;
const TR = (k, v) => t(k, v);

// ── the daemon, asked the two things the screens ask it ─────────────────────
//
// Out of process and by name, so that what is exercised is the handler the
// phone reaches, not a copy of its reasoning written here.
const PY = `
import json, sys, time
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(path.join(repo, 'daemon'))})
from divan import ustabasi as u
from divan.security import PathPolicy
out = {"caps": {"events": u.MAX_RUN_EVENTS, "bytes": u.MAX_RUN_BYTES, "tail": u.RUN_TAIL_BYTES}}

# The same argument the server hands it (server.py, h_ustabasi_list). Without
# it every project falls back to its folder name and a ticket in
# 'babysee/app' comes out under a heading called 'app' — which is the thing
# the heading exists not to be. Faithful or it is not a demonstration.
#
# The config module pulls in dependencies a bare interpreter may not have, and
# this script is worth running from one, so the roots fall back to the default
# the config itself uses. Which root list was used is reported, because a
# different one is a different set of headings.
try:
    from divan.config import Config
    cfg = Config.load()
    roots, denied = cfg.allowed_roots, cfg.denied_paths
    out["roots_from"] = "config"
except Exception:
    roots, denied = [str(Path.home() / "projects")], []
    out["roots_from"] = "default"
out["roots"] = [str(r) for r in roots]
policy = PathPolicy(roots, denied)

try:
    out["snapshot"] = u.snapshot(policy.project_for)
except Exception as e:
    out["error"] = f"{type(e).__name__}: {e}"
    print(json.dumps(out)); raise SystemExit(0)

runs = {}
for t in out["snapshot"]["tickets"]:
    if t["status"] != "running":
        continue
    tid = t["id"]
    t0 = time.perf_counter()
    first = u.run(tid)
    t1 = time.perf_counter()
    second = u.run(tid, first["cursor"])
    t2 = time.perf_counter()
    runs[str(tid)] = {"first": first, "second": second,
                      "ms_first": 1000 * (t1 - t0), "ms_second": 1000 * (t2 - t1)}
    if len(runs) >= 3:
        break
out["runs"] = runs
print(json.dumps(out))
`;

/** Which interpreter to ask. `DIVAN_PYTHON` first, then the daemon's own
 *  virtualenv if this checkout has one, then whatever `python3` is — the
 *  snapshot itself needs nothing but the standard library, and the fallback
 *  above covers the one import that does not. */
function interpreter() {
  const tried = [process.env.DIVAN_PYTHON,
                 path.join(repo, 'daemon', '.venv312', 'bin', 'python3'),
                 path.join(repo, 'daemon', '.venv', 'bin', 'python3')];
  for (const p of tried) if (p && fs.existsSync(p)) return p;
  return 'python3';
}

let data;
try {
  const raw = execFileSync(interpreter(), ['-c', PY], { maxBuffer: 64 * 1024 * 1024 }).toString();
  data = JSON.parse(raw);
} catch (e) {
  console.log('no queue to read: ' + (e.message || e).toString().split('\n')[0]);
  console.log('(this check needs the ustabasi queue on this machine; it is not a CI check)');
  process.exit(0);
}

if (data.error || !data.snapshot || !data.snapshot.available) {
  console.log('no queue to read: ' + (data.error || (data.snapshot || {}).reason || 'unavailable'));
  process.exit(0);
}

const tickets = data.snapshot.tickets || [];
const now = Date.now() / 1000;
let bad = 0;
const fail = (why) => { bad++; console.log('  FAIL  ' + why); };

console.log(`the queue on this machine: ${tickets.length} tickets, read at ${new Date().toISOString()}`);
console.log(`the handler's caps: ${data.caps.events} records or ${data.caps.bytes.toLocaleString()} bytes`
            + ` a page, ${data.caps.tail.toLocaleString()} bytes of tail on a first open`);
console.log(`project names from the ${data.roots_from} roots: ${(data.roots || []).join(', ')}`);

// ── 1 · the wall ────────────────────────────────────────────────────────────
console.log('\n══ the wall, grouped by project ══\n');
const groups = T.groupByProject(tickets);
for (const g of groups) {
  console.log(`  ${g.project.toUpperCase()}`);
  for (const k of g.tickets) {
    const word = TR(T.STATUS_KEY[k.status] || 'tsQueued');
    const ages = [T.totalAge(k, now, TR), T.roundAge(k, now, TR), T.commitCount(k, TR)]
      .filter(Boolean).join(' · ');
    console.log(`    #${String(k.id).padStart(2)}  ${word.padEnd(14)} ${k.title.slice(0, 44)}`);
    console.log(`         ${T.cardLine(k).slice(0, 72)}`);
    console.log(`         ${ages}`);
  }
  console.log('');
}

// What the wall is for, checked rather than eyeballed.
if (!groups.length) fail('the wall drew no groups at all');
if (groups.some((g) => !g.tickets.length)) fail('an empty group was drawn');
if (groups.some((g) => /\//.test(g.project))) fail('a group heading is a path, not a project name');
{
  const red = groups.findIndex((g) => g.tickets.some((k) => T.answerable(k.status)));
  if (red > 0) fail(`the project with a ticket waiting on a person is group ${red + 1}, not the first`);
}
{
  const seen = new Set();
  for (const g of groups) for (const k of g.tickets) {
    if (seen.has(k.id)) fail(`#${k.id} is on the wall twice`);
    seen.add(k.id);
  }
  if (seen.size !== tickets.length) fail('the grouping lost or invented a ticket');
}
{
  const leaked = tickets.filter((k) => /\bpid\b|\/Users\/|claude-[0-9a-f]{6}/.test(T.cardLine(k)));
  if (leaked.length) fail(`a card line carries a pid, a home directory or an account: #${leaked[0].id}`);
}

// ── 2 · the (i) page, on whatever is running ────────────────────────────────
const running = tickets.filter((k) => k.status === 'running');
console.log(`══ the (i) page, on ${running.length} running ticket(s) ══\n`);
const GLYPH = { done: '[x]', crossed: '[/]', now: '[>]', stopped: '[-]' };
for (const k of running) {
  console.log(`  #${k.id} ${k.title.slice(0, 56)}`);
  const steps = k.steps || [];
  for (const s of steps) {
    const m = T.stepMark(s);
    const tail = m === 'now'
      ? `  <- running now, ${T.stepAge(s, now, TR)}, ${s.model || '?'} / ${s.account || '?'}`
      : `  ${T.stepAge(s, now, TR)}${s.outcome ? ' ' + s.outcome : ''}`;
    console.log(`    ${GLYPH[m]} ${T.stepLine(s, TR).padEnd(20)}${tail}`);
  }
  const cur = T.currentStep(k);
  if (!cur) fail(`#${k.id} is running and the page marks no step as the one running now`);
  else {
    if (cur.stage !== k.stage) fail(`#${k.id}: the page marks ${cur.stage}, the queue says ${k.stage}`);
    if (cur.round !== k.round) fail(`#${k.id}: the page marks round ${cur.round}, the queue says ${k.round}`);
    if (!cur.model || !cur.account) fail(`#${k.id}: the running step names no model or no account`);
    console.log(`    -> the page and the queue agree: ${cur.stage} round ${cur.round}`);
  }
  if (steps.filter((s) => T.stepMark(s) === 'now').length > 1) {
    fail(`#${k.id}: two steps are marked as the one running now`);
  }
  // The criteria, marked by the finding's own text.
  const judged = T.marks(k.done_criteria || [], k.verdict);
  const n = judged.filter(Boolean).length;
  console.log(`    criteria: ${(k.done_criteria || []).length}, marked by the latest verdict: ${n}`);
  if (!k.verdict && n) fail(`#${k.id}: marks drawn with no verdict to draw them from`);
  console.log('');
}

// ── 3 · the chat page, filling ──────────────────────────────────────────────
console.log('══ the chat page: the run, a page at a time ══\n');
const ids = Object.keys(data.runs || {});
if (!ids.length) console.log('  nothing is running, so there is no live log to read\n');
for (const id of ids) {
  const r = data.runs[id];
  const bytes = (o) => JSON.stringify(o).length;

  // The hook's own loop (`useRun`), by hand: a page, its cursor, the next page.
  let list = [];
  let next = 0;
  const one = X.turns(r.first.events || [], next);
  next = one.next;
  list = X.trim(X.attach([...list, ...one.turns], one.answers));
  const two = X.turns(r.second.events || [], next);
  next = two.next;
  list = X.trim(X.attach([...list, ...two.turns], two.answers));

  console.log(`  #${id}: first open ${bytes(r.first).toLocaleString()} bytes`
              + ` / ${(r.first.events || []).length} records / ${r.ms_first.toFixed(0)} ms`
              + `  ->  ${one.turns.length} turns`);
  console.log(`       next poll  ${bytes(r.second).toLocaleString()} bytes`
              + ` / ${(r.second.events || []).length} records / ${r.ms_second.toFixed(0)} ms`
              + `  ->  ${two.turns.length} turns`);
  console.log(`       live=${r.first.live}  on screen: ${list.length} turns`);

  const kinds = {};
  for (const x of list) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  console.log(`       ${JSON.stringify(kinds)}`);

  const last = list.slice(-4);
  for (const x of last) {
    const say = x.kind === 'did' ? `${x.tool}: ${x.summary}` : (x.text || '').replace(/\s+/g, ' ');
    console.log(`       ${x.kind.padEnd(8)} ${say.slice(0, 84)}`);
  }

  if (bytes(r.first) > data.caps.bytes + 4000) fail(`#${id}: a first open is over the byte cap`);
  if (r.second.events && r.second.events.length === 0 && bytes(r.second) > 400) {
    fail(`#${id}: a poll with nothing in it cost ${bytes(r.second)} bytes`);
  }
  {
    const keys = list.map((x) => x.id);
    if (new Set(keys).size !== keys.length) fail(`#${id}: two turns on screen share a key`);
  }
  if (list.some((x) => /\/Users\/[a-z]/i.test(x.text || '') || /\/Users\/[a-z]/i.test(x.summary || ''))) {
    fail(`#${id}: a home directory reached a turn`);
  }
  if (list.length > X.MAX_TURNS) fail(`#${id}: the list is over MAX_TURNS`);
  console.log('');
}

// ── 4 · the same page, a few seconds later ─────────────────────────────────
//
// The section above proves a first open is small and a poll that finds nothing
// is smaller. What it cannot show is the thing the chat page exists for: that
// a turn written while somebody is looking at the page turns up on it. So this
// holds one cursor open and polls it the way the hook does, for as long as it
// takes to see something — and says plainly when a quiet run gave it nothing,
// rather than calling silence a pass.
//
//     node scripts/ustabasi-live.cjs --watch[=seconds]
const watch = (process.argv.find((a) => a.startsWith('--watch')) || '').split('=')[1];
if (process.argv.some((a) => a.startsWith('--watch')) && ids.length) {
  const secs = Math.max(5, Math.min(120, Number(watch) || 30));
  const id = ids[0];
  console.log(`══ the same run, watched for ${secs}s (#${id}) ══\n`);

  const poll = (cursor) => {
    const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(repo, 'daemon'))})
from divan import ustabasi as u
print(json.dumps(u.run(${Number(id)}, ${cursor == null ? 'None' : JSON.stringify(cursor)})))
`;
    return JSON.parse(execFileSync(interpreter(), ['-c', py], { maxBuffer: 64 * 1024 * 1024 }).toString());
  };

  const sleep = (ms) => execFileSync('sleep', [String(ms / 1000)]);
  let page = poll(null);
  let cursor = page.cursor;
  let list = [];
  let next = 0;
  {
    const r = X.turns(page.events || [], next);
    next = r.next;
    list = X.trim(X.attach([...list, ...r.turns], r.answers));
  }
  console.log(`  t+0s    ${list.length} turns on screen, live=${page.live}`);

  const RUN_POLL_MS = 3000;   // the hook's own interval
  let arrived = 0;
  const until = Date.now() + secs * 1000;
  while (Date.now() < until) {
    sleep(RUN_POLL_MS);
    const at = ((Date.now() - (until - secs * 1000)) / 1000).toFixed(0);
    page = poll(cursor);
    cursor = page.cursor;
    const r = X.turns(page.events || [], next);
    next = r.next;
    const before = list.length;
    list = X.trim(X.attach([...list, ...r.turns], r.answers));
    if (r.turns.length) {
      arrived += r.turns.length;
      console.log(`  t+${at}s${' '.repeat(Math.max(1, 4 - at.length))}+${r.turns.length} turn(s)`
                  + ` (${JSON.stringify(page).length} bytes) -> ${list.length} on screen`);
      for (const x of r.turns.slice(-2)) {
        const say = x.kind === 'did' ? `${x.tool}: ${x.summary}` : (x.text || '').replace(/\s+/g, ' ');
        console.log(`           ${x.kind.padEnd(8)} ${say.slice(0, 76)}`);
      }
    }
    if (list.length < before) fail('the list shrank without being trimmed');
    const keys = list.map((x) => x.id);
    if (new Set(keys).size !== keys.length) fail('two turns on screen share a key while appending');
  }
  console.log(arrived
    ? `\n  ${arrived} turn(s) arrived while the page was open, every key distinct`
    : `\n  nothing was written in ${secs}s — the run was quiet, so this proves nothing either way`);
  console.log('');
}

console.log(bad ? `${bad} failed` : 'all good — the live queue draws the way the screens expect');
process.exit(bad ? 1 : 0);
