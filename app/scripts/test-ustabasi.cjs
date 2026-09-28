/** The ustabasi wall's judgements, checked without a phone.
 *
 *  Everything here has exactly one right answer and no pixels in it: which
 *  tickets sort to the top, which one may be answered, which of the wall's faces
 *  a given snapshot deserves, and which screen a notification opens. The last
 *  two are the ones that cannot be seen by looking: an older computer that has
 *  never heard of `ustabasi.list` has to read as an explanation rather than as a
 *  spinner that never stops, and a push about a red ticket has to land on the
 *  ticket rather than on the chat list.
 *
 *  Run: node scripts/test-ustabasi.cjs
 */
const { transform } = require('sucrase');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

function load(file, exports) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const js = transform(src, { transforms: ['typescript', 'imports'] }).code;
  const out = path.join(os.tmpdir(), 'rac-' + path.basename(file).replace(/\W/g, '-') + '.cjs');
  fs.writeFileSync(out, js + `\nmodule.exports={${exports.join(',')}};`);
  delete require.cache[out];
  return require(out);
}

const T = load('src/tickets.ts', ['POLL_MS', 'STATUS_KEY', 'answerable', 'redCount', 'sortTickets',
                                  'mark', 'wall', 'oldHost', 'ticketFromPush', 'since', 'first', 'repoName']);

const unit = (k) => ({ unitSec: 's', unitMin: 'm', unitHour: 'h', unitDay: 'd' }[k]);
const ticket = (id, status, updated_at = 1000, extra = {}) =>
  ({ id, status, updated_at, title: `#${id}`, stage: 'worker', round: 1, notes: [], note_count: 0,
     done_criteria: [], escalation: '', verdict: null, last_event: null, goal: '', repo: '', branch: null, ...extra });

const snap = (tickets, available = true, queue = {}) => ({ available, tickets, queue });
const ids = (list) => T.sortTickets(list).map((t) => t.id).join(',');

// The wall as the queue actually looks: two that stopped to ask, one working,
// one waiting its turn, one finished — deliberately numbered so that any
// id order would get it wrong.
const WALL = [
  ticket(1, 'done', 500), ticket(2, 'running', 400), ticket(3, 'queued', 300),
  ticket(4, 'failed', 200), ticket(5, 'blocked', 100), ticket(6, 'cancelled', 600),
];

const NOW = 10_000;
const VERDICT = { verdict: 'rejected', findings: [
  { criterion: 'the screen exists', status: 'met' },
  { criterion: 'it is reachable', status: 'unmet', detail: 'nothing links to it' },
]};

const checks = [
  ['red sorts above everything, whatever the ids say', ids(WALL) === '5,4,2,3,1,6'],
  ['a failed ticket sorts under a blocked one', ids([ticket(9, 'failed'), ticket(1, 'blocked')]) === '1,9'],
  ['within one status the freshest is first',
    ids([ticket(1, 'running', 100), ticket(2, 'running', 900)]) === '2,1'],
  ['sorting does not reorder the caller\u2019s array', (() => {
    const given = [ticket(1, 'done'), ticket(2, 'blocked')];
    T.sortTickets(given);
    return given.map((t) => t.id).join(',') === '1,2';
  })()],
  ['a status nothing knows about sorts last',
    ids([ticket(1, 'sideways'), ticket(2, 'cancelled')]) === '2,1'],

  ['blocked can be answered', T.answerable('blocked') === true],
  ['so can failed', T.answerable('failed') === true],
  ['a running ticket cannot', T.answerable('running') === false],
  ['nor can a queued, done or cancelled one',
    !T.answerable('queued') && !T.answerable('done') && !T.answerable('cancelled')],
  ['the badge counts exactly the two that need a person', T.redCount(WALL) === 2],
  ['and nothing on a quiet wall', T.redCount([ticket(1, 'running'), ticket(2, 'done')]) === 0],

  ['every status has words of its own',
    ['queued', 'running', 'done', 'blocked', 'failed', 'cancelled'].every((s) => !!T.STATUS_KEY[s])],

  ['a met criterion is marked met', T.mark(VERDICT, 0).met === true],
  ['an unmet one carries the verifier\u2019s reason',
    T.mark(VERDICT, 1).met === false && T.mark(VERDICT, 1).detail === 'nothing links to it'],
  ['a criterion the verifier did not reach has no mark', T.mark(VERDICT, 2) === null],
  ['no verdict, no marks at all', T.mark(null, 0) === null && T.mark({}, 0) === null],

  ['a computer that is not connected says so, not "no queue"',
    T.wall({ online: false, snapshot: null, error: null, oldHost: false }) === 'offline'],
  ['a daemon that never heard of the request gets an explanation',
    T.wall({ online: true, snapshot: null, error: 'unknown type: ustabasi.list', oldHost: true }) === 'oldHost'],
  ['an unasked computer is a spinner, not an empty wall',
    T.wall({ online: true, snapshot: null, error: null, oldHost: false }) === 'loading'],
  ['a computer with no queue says there is no queue',
    T.wall({ online: true, snapshot: snap([], false), error: null, oldHost: false }) === 'noQueue'],
  ['a queue with no tickets is not the same answer',
    T.wall({ online: true, snapshot: snap([]), error: null, oldHost: false }) === 'empty'],
  ['tickets in hand, tickets on screen',
    T.wall({ online: true, snapshot: snap(WALL), error: null, oldHost: false }) === 'tickets'],
  ['a failed poll does not blank a wall that is already up',
    T.wall({ online: true, snapshot: snap(WALL), error: 'database is locked', oldHost: false }) === 'tickets'],
  ['with nothing to fall back on, the failure is the screen',
    T.wall({ online: true, snapshot: null, error: 'database is locked', oldHost: false }) === 'error'],

  ['"unknown type" is an old computer', T.oldHost({ message: 'unknown type: ustabasi.list' }) === true],
  ['a dropped connection is not', T.oldHost({ message: 'connection lost', code: 'offline' }) === false],
  ['neither is a refusal from a computer that understood us',
    T.oldHost({ message: 'ustabasi is not installed on this machine', code: 'ustabasi_refused' }) === false],
  ['nor is nothing at all', T.oldHost(null) === false],

  ['a ticket push names its ticket', T.ticketFromPush({ ticket_id: 5 }) === 5],
  ['as a string too, which is how JSON arrives', T.ticketFromPush({ ticket_id: '12' }) === 12],
  ['a chat push is not a ticket', T.ticketFromPush({ chat_id: 'abc', kind: 'done' }) === null],
  ['an empty payload is not a ticket', T.ticketFromPush({}) === null && T.ticketFromPush(undefined) === null],
  ['and neither is nonsense',
    T.ticketFromPush({ ticket_id: 'five' }) === null && T.ticketFromPush({ ticket_id: 0 }) === null
    && T.ticketFromPush({ ticket_id: -3 }) === null && T.ticketFromPush({ ticket_id: 1.5 }) === null],

  ['the wall re-reads at least as often as the desktop panel', T.POLL_MS <= 8000],

  ['seconds read as seconds', T.since(42, unit) === '42s'],
  ['minutes drop the seconds', T.since(12 * 60 + 30, unit) === '12m'],
  ['hours keep the minutes', T.since(3 * 3600 + 5 * 60, unit) === '3h 5m'],
  ['a ticket stuck since yesterday says so', T.since(26 * 3600, unit) === '1d 2h'],
  ['a missing timestamp is not "NaN in this state"',
    T.since(null, unit) === '' && T.since(undefined, unit) === '' && T.since(-1, unit) === ''],

  ['a long escalation is cut on a word', T.first('the quick brown fox jumps', 17) === 'the quick brown…'],
  ['a cut that lands on a space keeps the word before it',
    T.first('the quick brown fox', 15) === 'the quick brown…'],
  ['a short one is left alone', T.first('all done', 40) === 'all done'],
  ['nothing is nothing', T.first(null, 10) === '' && T.first(undefined, 10) === ''],

  // This screen is one screenshot away from being public; a repository is named
  // by its folder and never by the path to it.
  ['a repository is named, not located', T.repoName('/Users/someone/projects/thing') === 'thing'],
  ['a windows path too', T.repoName('C:\\Users\\someone\\projects\\thing') === 'thing'],
  ['and an absent one is blank', T.repoName(null) === '' && T.repoName('') === ''],
];

// Every word the new screens show comes out of the i18n table. A missing key
// renders as its own name, which is the sort of thing that ships.
const table = fs.readFileSync(path.join(root, 'src/i18n.ts'), 'utf8');
// Entries share lines, so this matches every `key: '…'` rather than one a line.
const known = new Set([...table.matchAll(/([A-Za-z0-9_]+):\s*['"]/g)].map((m) => m[1]));
const screens = ['app/ustabasi.tsx', 'app/ticket/[id].tsx', 'src/components/ticket.tsx', 'src/components/home.tsx'];
const used = new Set();
for (const f of screens) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(/\bT\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
}
for (const m of fs.readFileSync(path.join(root, 'src/tickets.ts'), 'utf8').matchAll(/'(ts[A-Z][A-Za-z]+|unit[A-Z][a-z]+)'/g)) used.add(m[1]);
const missing = [...used].filter((k) => !known.has(k));
checks.push([`every string the wall shows is in the i18n table (${used.size} keys)`, missing.length === 0]);
if (missing.length) console.log('  missing keys:', missing.join(', '));

// …and nothing on them is a sentence typed straight into the JSX, which is how
// a screen ends up half-translatable: the table cannot be a second language if
// half the words are not in it. Text between tags, and the props that carry
// words rather than names.
const hardcoded = [];
for (const f of screens) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;                       // a comment is prose on purpose
    const text = line.match(/>[A-Z][a-z]+ [^<>{}]{3,}</);
    const prop = line.match(/\b(title|body|placeholder|label|hint)=["'][^"']{3,}["']/);
    if (text || prop) hardcoded.push(`${f}:${i + 1} ${(text || prop)[0].trim()}`);
  });
}
checks.push(['and none of it was typed into the screen instead', hardcoded.length === 0]);
if (hardcoded.length) console.log('  hardcoded:', hardcoded.join(' | '));

let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name);
  if (!ok) bad++;
}
console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
