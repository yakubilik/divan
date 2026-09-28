/** What the ustabasi wall says, and that it says it on a phone.
 *
 *      cd web && npm install && node scripts/test-wall.mjs
 *
 *  Two halves. The first checks the wall's arithmetic — the grouping, the
 *  ordering, and the four figures on a card — by importing `src/lib/ustabasi.ts`
 *  through esbuild, which is already here as vite's own bundler.
 *
 *  The second renders the real `Wall` in Chrome, once at 390 × 844 — an iPhone
 *  held upright — and once at 1280, and reads back what the layout actually did:
 *  how many columns, how wide, and whether anything can be dragged sideways.
 *  That question has no answer outside a browser. Without a Chrome to run, that
 *  half says so and is skipped.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'rac-wall-'));
const esbuild = join(web, 'node_modules', '.bin', 'esbuild');

const fails = [];
const check = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) fails.push(`${what}\n    got:  ${a}\n    want: ${b}`);
};

if (!existsSync(esbuild)) {
  console.error('no esbuild — run npm install in web/ first');
  process.exit(1);
}

// ── the arithmetic ───────────────────────────────────────────────────────────

const libjs = join(out, 'lib.mjs');
execFileSync(esbuild, ['src/lib/ustabasi.ts', '--bundle', '--format=esm', '--log-level=error',
  `--outfile=${libjs}`], { cwd: web, stdio: ['ignore', 'ignore', 'inherit'] });
const wall = await import(pathToFileURL(libjs).href);

const NOW = 1790600000;
const H = 3600;
let seq = 0;
/** A ticket as the daemon hands it over, with only what the wall reads. */
function t(over = {}) {
  seq += 1;
  return {
    id: seq, status: 'running', repo: '/Users/x/projects/ledger', project: 'ledger',
    stage: 'worker', round: 1, created_at: NOW - 15 * H - 18 * 60, updated_at: NOW - 600,
    round_started_at: NOW - 49 * 60, finished_at: null, git: null, ...over,
  };
}

// grouping
const mixed = [
  t({ id: 1, project: 'ledger', status: 'running', updated_at: NOW - 100 }),
  t({ id: 2, project: 'babysee', status: 'done', updated_at: NOW - 50 }),
  t({ id: 3, project: 'ledger', status: 'blocked', updated_at: NOW - 9000 }),
  t({ id: 4, project: 'remote-ai-chat', status: 'queued', updated_at: NOW - 10 }),
  t({ id: 5, project: 'babysee', status: 'failed', updated_at: NOW - 80 }),
  t({ id: 6, project: 'ledger', status: 'done', updated_at: NOW - 200 }),
];
const groups = wall.groupByProject(mixed);
check('one column per project, no empty ones',
  groups.map((g) => g.project), ['ledger', 'babysee', 'remote-ai-chat']);
check('the column with the blocked ticket is first', groups[0].project, 'ledger');
check('red first inside the column, then running, then done',
  groups[0].tickets.map((x) => x.id), [3, 1, 6]);
check('a failed ticket puts its column above a merely busy one',
  groups[1].project, 'babysee');
check('every ticket is in exactly one column',
  groups.reduce((n, g) => n + g.tickets.length, 0), mixed.length);
check('nothing at all is no columns', wall.groupByProject([]), []);
check('the order inside a column is the order the wall has always had',
  wall.sortTickets(mixed).map((x) => x.id), [3, 5, 1, 4, 2, 6]);
check('two columns of equal urgency go by what moved last',
  wall.groupByProject([
    t({ id: 7, project: 'a', status: 'running', updated_at: NOW - 900 }),
    t({ id: 8, project: 'b', status: 'running', updated_at: NOW - 10 }),
  ]).map((g) => g.project), ['b', 'a']);

// the project name
check('the daemon names the project', wall.projectName(t({ project: 'babysee' })), 'babysee');
check('without a name, the folder',
  wall.projectName(t({ project: null, repo: '/Users/x/work/ledger' })), 'ledger');
check('without a path either', wall.projectName(t({ project: null, repo: '' })), 'unfiled');

// the figures on a card
check('how long it has been open, first',
  wall.totalAge(t(), NOW), 'open 15h 18m');
check('a finished ticket says how long it took',
  wall.totalAge(t({ status: 'done', finished_at: NOW - 14 * H, created_at: NOW - 18 * H }), NOW),
  'took 4h 0m');
check('a failed ticket is still open, not finished',
  wall.totalAge(t({ status: 'failed', finished_at: NOW - H }), NOW), 'open 15h 18m');
check('the round is the second figure, and labelled as itself',
  wall.roundAge(t(), NOW), '49m in this round');
check('a finished ticket has no round running', wall.roundAge(
  t({ status: 'done', finished_at: NOW - H }), NOW), null);
check('nor has one still in the queue',
  wall.roundAge(t({ status: 'queued', round_started_at: null }), NOW), null);
check('whose hands it is in', wall.stageLine(t({ stage: 'verifier', round: 3 })), 'verifier r3');
check('what is on the branch', wall.commitCount(t({ git: { commits: 7, subject: 's' } })), '7 commits');
check('one commit is one commit', wall.commitCount(t({ git: { commits: 1, subject: 's' } })), '1 commit');
check('no worktree, no commit line', wall.commitCount(t({ git: null })), null);

// ── the words on the card ────────────────────────────────────────────────────

const live = readFileSync(join(web, 'src/screens/Ustabasi.tsx'), 'utf8');
// The cards and their columns, which is everything the wall draws before the
// opened ticket — that one belongs to another ticket and is not read here.
const cards = live.slice(live.indexOf('function Tile('), live.indexOf('// ── the opened ticket'));
check('the wall was found in the file', cards.length > 500, true);
check('a card no longer says "in this state" about anything',
  /in this state/.test(cards), false);
check('a card draws no percentage and no progress bar',
  /percent|progress|toFixed|\* *100/i.test(cards), false);
check('nor counts criteria it has no answer for',
  /done_criteria|findings/.test(cards), false);
check('the total comes before the round on the card',
  cards.indexOf('totalAge(t, now)') < cards.indexOf('{round &&'), true);

// ── and that it fits a phone ─────────────────────────────────────────────────

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p));

let phone = 'skipped (no Chrome)';
if (CHROME) {
  // A harness that renders the real component, then writes what the layout did
  // where --dump-dom will show it.
  const cache = join(web, 'node_modules', '.cache', 'rac-wall');
  mkdirSync(cache, { recursive: true });
  const entry = join(cache, 'harness.tsx');
  writeFileSync(entry, `
import { createRoot } from 'react-dom/client';
import { Wall } from ${JSON.stringify(join(web, 'src/screens/Ustabasi.tsx'))};
import { groupByProject } from ${JSON.stringify(join(web, 'src/lib/ustabasi.ts'))};
const LONG = 'a-very-long-subject-with-no-spaces-in-it-at-all-'.repeat(4);
const mk = (id, project, status, git) => ({
  id, title: 'ustabasi duvari: projeye gore grupla, kartta gercek sure ve ne yaptigi yazsin',
  status, stage: 'worker', round: 2, repo: '/Users/x/projects/' + project, project,
  branch: 'ustabasi/13-ustabasi-duvari-projeye-gore-grupla-kart-with-a-long-tail',
  created_at: ${NOW} - 54000, updated_at: ${NOW} - 600, started_at: ${NOW} - 53000,
  round_started_at: ${NOW} - 2940, finished_at: null, goal: LONG, done_criteria: [],
  escalation: status === 'blocked' ? LONG : '', verdict: null, notes: [], note_count: 2,
  last_event: { ts: ${NOW} - 600, kind: 'report', msg: LONG }, git,
});
const tickets = [
  mk(1, 'remote-ai-chat', 'running', { commits: 12, subject: LONG }),
  mk(2, 'remote-ai-chat', 'blocked', { commits: 3, subject: 'a short one' }),
  mk(3, 'babysee', 'running', null),
  mk(4, 'ustabasi', 'queued', null),
];
const phone = document.getElementById('phone');
const root = document.getElementById('root');
createRoot(root).render(<Wall groups={groupByProject(tickets)} now={${NOW}} onOpen={() => {}} />);
setTimeout(() => {
  const grid = root.firstElementChild;
  const cols = [...grid.children];
  const edge = phone.getBoundingClientRect().right;
  document.title = JSON.stringify({
    phoneWidth: phone.clientWidth, columnRoom: Math.round(grid.getBoundingClientRect().width),
    columns: cols.length,
    // One column per row means every column takes the whole row it is on.
    widths: cols.map((c) => Math.round(c.getBoundingClientRect().width)),
    // What a finger would find to drag sideways, inside the phone's width.
    sideways: phone.scrollWidth - phone.clientWidth,
    past: [...root.querySelectorAll('*')]
      .filter((e) => e.getBoundingClientRect().right > edge + 0.5)
      .map((e) => e.tagName + '@' + Math.round(e.getBoundingClientRect().right)
        + ' ' + (e.textContent || '').slice(0, 40)),
    headings: cols.map((c) => c.firstElementChild.textContent),
  });
}, 0);
`);
  const bundle = join(out, 'harness.js');
  execFileSync(esbuild, [entry, '--bundle', `--outfile=${bundle}`, '--jsx=automatic',
    '--log-level=error', '--define:process.env.NODE_ENV="production"'],
    { cwd: web, stdio: ['ignore', 'ignore', 'inherit'] });
  // The screen is the box, not the window: headless Chrome will not make a
  // window narrower than about 500px, and everything the wall sizes is relative.
  async function measure(w, h) {
    const html = join(out, `w${w}.html`);
    writeFileSync(html, '<!doctype html><meta name=viewport content="width=device-width">'
      + '<style>html,body{margin:0;background:#0F0E0C;color:#fff;'
      + 'font-family:-apple-system,system-ui,sans-serif}'
      + `#phone{width:${w}px;height:${h}px;overflow-x:hidden;overflow-y:auto}`
      + '#root{padding:24px}</style>'
      + `<div id=phone><div id=root></div></div><script src="${bundle}"></script>`);
    // Chrome on a temporary profile prints the DOM and then does not come back,
    // so the dump is read as it lands and the browser is put down afterwards.
    const dump = join(out, `dump-${w}.html`);
    const child = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
      `--user-data-dir=${join(out, 'chrome')}`, '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-sync', '--disable-component-update',
      '--disable-background-networking', '--window-size=1400,900',
      '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(html).href],
      { stdio: ['ignore', openSync(dump, 'w'), 'ignore'] });
    let dom = '';
    for (const deadline = Date.now() + 120000; Date.now() < deadline;) {
      await new Promise((r) => setTimeout(r, 250));
      dom = readFileSync(dump, 'utf8');
      if (/<\/html>/.test(dom)) break;
    }
    child.kill('SIGKILL');
    const m = dom.match(/<title>(.*?)<\/title>/s);
    if (!m) {
      fails.push(`the harness did not render in Chrome at ${w}px\n    ` + dom.slice(0, 400));
      return null;
    }
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }

  const r = await measure(390, 844);
  if (r) {
    check('the phone is 390 wide', r.phoneWidth, 390);
    check('three projects, three columns', r.columns, 3);
    check(`at 390px they are stacked one across ${JSON.stringify(r.widths)}`,
      r.widths.every((w) => w >= r.columnRoom - 8), true);
    check('nothing to drag sideways', r.sideways, 0);
    check(`nothing drawn past the right edge ${JSON.stringify(r.past)}`, r.past.length, 0);
    check('each column is titled with its project', r.headings.map((h) => h.replace(/\d+$/, '')),
      ['remote-ai-chat', 'babysee', 'ustabasi']);
    phone = `390 × 844, ${r.columns} columns ${r.widths.join('/')}px wide in `
      + `${r.columnRoom}px of room, ${r.sideways}px to drag sideways`;
  }

  // And on a desk, where the whole point is columns beside each other.
  const d = await measure(1280, 900);
  if (d) {
    check('on a desk the same three are side by side', d.columns, 3);
    check('side by side means narrower than the room they are in',
      d.widths.every((w) => w < d.columnRoom / 2), true);
    check('and still nothing to drag sideways', d.sideways, 0);
  }
  rmSync(cache, { recursive: true, force: true });
}

if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(' ', f);
  console.log(`  the bundles and the dumps are in ${out}`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
console.log(`ok — ustabasi wall; phone: ${phone}`);
