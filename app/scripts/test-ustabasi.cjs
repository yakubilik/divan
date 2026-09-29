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
 *  `scripts/test-divan.cjs`, `scripts/test-divan-merge.cjs`,
 *  `scripts/test-shell.cjs` and the screens' own files are folded in at the end — the design system, the
 *  merged view across several machines and Divan's three places each have their
 *  own file — and this is the command that runs everything.
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

const T = load('src/tickets.ts', ['POLL_MS', 'RUN_POLL_MS', 'STATUS_KEY', 'VOICE_KEY', 'answerable', 'redCount', 'sortTickets',
                                  'marks', 'wall', 'oldHost', 'since', 'first', 'repoName',
                                  'bullets', 'conversation', 'question', 'stateLine', 'noteHint', 'hasDetails',
                                  'projectName', 'groupByProject', 'totalAge', 'roundAge', 'commitCount',
                                  'cardLine', 'tilde', 'stepMark', 'currentStep', 'stepLine', 'stepAge',
                                  'runStartedAt', 'around']);
// What the agent on a ticket prints, read as a chat. A page of records in, a
// run of turns out — no React in it, so the reading is checkable against a
// real recording rather than against a browser.
const X = load('src/transcript.ts', ['turns', 'attach', 'trim', 'summarise', 'silence', 'MAX_TURNS']);
// What a tapped notification opens: the reading of the payload, the holding pen
// a tap waits in while the app is still starting, and the route itself.
const P = load('src/tap.ts', ['ticketFromPush', 'tapFromPush', 'routeForTap', 'Taps', 'follow']);

// The real table, so that what the conversation says is what the screen shows
// rather than a sentence written twice.
const TR = load('src/i18n.ts', ['t']).t;
const ticket = (id, status, updated_at = 1000, extra = {}) =>
  ({ id, status, updated_at, title: `#${id}`, stage: 'worker', round: 1, notes: [], note_count: 0,
     done_criteria: [], escalation: '', verdict: null, last_event: null, goal: '', repo: '', branch: null,
     created_at: updated_at, started_at: null, finished_at: null, round_started_at: null,
     project: null, git: null, steps: [], ...extra });

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
// A card of three points and a verdict that reached the first two, word for
// word. Three so that the third stands for "the verifier said nothing about
// this one", which is a different thing from "unmet".
const CRITERIA = ['the screen exists', 'it is reachable', 'it survives a rotation'];
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

  ['a met criterion is marked met', T.marks(CRITERIA, VERDICT)[0].met === true],
  ['an unmet one carries the verifier\u2019s reason', (() => {
    const m = T.marks(CRITERIA, VERDICT)[1];
    return m.met === false && m.detail === 'nothing links to it';
  })()],
  ['a criterion the verifier did not reach has no mark', T.marks(CRITERIA, VERDICT)[2] === null],
  ['no verdict, no marks at all',
    T.marks(CRITERIA, null).every((m) => m === null)
    && T.marks(CRITERIA, {}).every((m) => m === null)],

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

  ['a ticket push names its ticket', P.ticketFromPush({ ticket_id: 5 }) === 5],
  // The queue spells it `ticket`, which is the payload that actually arrives.
  ['the queue\u2019s own payload is read',
    P.ticketFromPush({ source: 'ustabasi', ticket: 10, kind: 'blocked', screen: 'ustabasi' }) === 10],
  ['as a string too, which is how JSON arrives', P.ticketFromPush({ ticket_id: '12' }) === 12],
  ['a chat push is not a ticket', P.ticketFromPush({ chat_id: 'abc', kind: 'done' }) === null],
  ['an empty payload is not a ticket', P.ticketFromPush({}) === null && P.ticketFromPush(undefined) === null],
  ['and neither is nonsense',
    P.ticketFromPush({ ticket_id: 'five' }) === null && P.ticketFromPush({ ticket_id: 0 }) === null
    && P.ticketFromPush({ ticket_id: -3 }) === null && P.ticketFromPush({ ticket_id: 1.5 }) === null],

  ['the wall re-reads at least as often as the desktop panel', T.POLL_MS <= 8000],

  ['seconds read as seconds', T.since(42, TR) === '42s'],
  ['minutes drop the seconds', T.since(12 * 60 + 30, TR) === '12m'],
  ['hours keep the minutes', T.since(3 * 3600 + 5 * 60, TR) === '3h 5m'],
  ['a ticket stuck since yesterday says so', T.since(26 * 3600, TR) === '1d 2h'],
  ['a missing timestamp is not "NaN in this state"',
    T.since(null, TR) === '' && T.since(undefined, TR) === '' && T.since(-1, TR) === ''],

  ['a long escalation is cut on a word', T.first('the quick brown fox jumps', 17) === 'the quick brown…'],
  ['a cut that lands on a space keeps the word before it',
    T.first('the quick brown fox', 15) === 'the quick brown…'],
  ['a short one is left alone', T.first('all done', 40) === 'all done'],
  ['nothing is nothing', T.first(null, 10) === '' && T.first(undefined, 10) === ''],

  // This screen is one screenshot away from being public; a repository is named
  // by its folder and never by the path to it.
  // The paths here say /Users/you on purpose: a home directory with a name in
  // it is the one thing scripts/audit.py will not let this repository publish,
  // test fixture or not.
  ['a repository is named, not located', T.repoName('/Users/you/projects/thing') === 'thing'],
  ['a windows path too', T.repoName('C:\\Users\\you\\projects\\thing') === 'thing'],
  ['and an absent one is blank', T.repoName(null) === '' && T.repoName('') === ''],
];

// ── the opened ticket, which is a conversation ───────────────────────────────
// A ticket used to open as a report: the goal under a heading, the criteria
// under another, what it was waiting for under a third. Everything was there
// and none of it asked anything. Read as a conversation instead, the part that
// can be wrong without anybody noticing is not the drawing — it is the reading:
// which order the messages come in, who is said to have said them, and whether
// the last one is a question. All of that is a pure function of one ticket.

const REPORT = 'The verifier found two of the nine criteria unmet. '
  + 'The sequence order is built but it is not tested. '.repeat(12)
  + 'This sentence is the end of the report.';

const convo = (over = {}) => ticket(7, 'blocked', 5000, {
  title: 'open a ticket as a conversation',
  stage: 'worker', round: 2, repo: '/tmp/repo', branch: 'topic',
  created_at: 1000, started_at: 1100, finished_at: null,
  goal: 'Make a card open as a conversation instead of a report.',
  done_criteria: ['the sequence reads as a chat', 'the box sends a note'],
  escalation: '- A token with **write** access is needed\n'
    + '  and nobody has one yet\n'
    + '- Once that exists the whole ticket closes',
  verdict: { verdict: 'changes_requested', findings: [
    { criterion: 'first', status: 'met' },
    { criterion: 'second', status: 'unmet', detail: 'the long detail nobody reads' },
  ]},
  notes: [
    { ts: 3000, from: 'user', text: 'Use the staging account, not the live one.' },
    { ts: 2000, from: 'verifier', text: REPORT },
    { ts: 4000, from: 'triage', text: 'Picked this up after the crash.' },
  ],
  note_count: 3,
  last_event: { ts: 4500, kind: 'blocked', msg: 'stopped to ask about the token' },
  ...over,
});

const say = (t) => T.conversation(t, TR);
const whole = (m) => `${m.text}\n${m.more ?? ''}`;

{
  const t = convo();
  const msgs = say(t);
  const everything = msgs.map(whole).join('\n');
  const shown = msgs.map((m) => m.text).join('\n');
  const notes = msgs.slice(1, -1);
  const tail = msgs[msgs.length - 1];
  const stamps = msgs.map((m) => m.ts);

  checks.push(
    // 1 · it is a conversation, not a report
    ['every message has a voice and a time',
      msgs.every((m) => m.from && Number.isFinite(m.ts) && m.ts > 0)],
    ['every message is from a voice the app can name',
      msgs.every((m) => !!T.VOICE_KEY[m.from])],

    // 2 · the order is the order it happened in
    ['the goal opens it, in the voice of whoever opened the ticket',
      msgs[0].from === 'you' && msgs[0].text === t.goal],
    ['the opening carries the time the ticket was opened', msgs[0].ts === 1000],
    ['no message is older than the one above it',
      stamps.every((ts, i) => i === 0 || ts >= stamps[i - 1])],
    ['the notes are in the order they were written',
      notes.map((m) => m.ts).join(',') === '2000,3000,4000'],
    ['a note says who wrote it', notes.map((m) => m.from).join(',') === 'verifier,you,triage'],
    ['the last message is the only tail',
      msgs.filter((m) => m.tail).length === 1 && tail.tail === true],
    ['the tail is not older than the ticket', tail.ts >= 5000],

    // 3 · the paperwork is not in the conversation
    ['a criterion is not a message', t.done_criteria.every((c) => !everything.includes(c))],
    ['the verifier’s per-criterion detail is not a message',
      !everything.includes('the long detail nobody reads')],
    ['a long report is cut down to its opening',
      msgs.find((m) => m.from === 'verifier').text.length < 500],
    ['the rest of it is kept, folded',
      (msgs.find((m) => m.from === 'verifier').more || '').length > 100],
    ['nothing of the report is lost', (() => {
      const r = msgs.find((m) => m.from === 'verifier');
      return `${r.text} ${r.more}`.replace(/\s+/g, ' ').trim() === REPORT.replace(/\s+/g, ' ').trim();
    })()],
    ['the folded part is not shown by default',
      !shown.includes('This sentence is the end of the report.')],
    ['what a person typed is never cut',
      msgs.find((m) => m.from === 'you' && m.ts === 3000).more === undefined],
    ['there is paperwork to fold away', T.hasDetails(t) === true],
    ['a ticket with neither criteria nor verdict has no details',
      T.hasDetails(convo({ done_criteria: [], verdict: null })) === false],
  );
}

// 4 · a stopped ticket ends on a question
for (const status of ['blocked', 'failed']) {
  const tail = say(convo({ status })).at(-1);
  checks.push(
    [`${status}: the last message is one paragraph`, !tail.text.includes('\n')],
    [`${status}: no bullet is left in it`, !/(^|\s)[-*•]\s/.test(tail.text)],
    [`${status}: it asks`, tail.text.trim().endsWith('?')],
    [`${status}: it is addressed to a person`, /\byou\b/i.test(tail.text)],
    [`${status}: the points of the escalation survived`,
      tail.text.includes('token with **write** access') && tail.text.includes('the whole ticket closes')],
    [`${status}: a wrapped bullet stayed with its bullet`,
      tail.text.includes('is needed and nobody has one yet')],
    [`${status}: nothing of the question is clipped away`, tail.more === undefined],
  );
}
checks.push(
  ['a stopped ticket with no report still asks something',
    say(convo({ escalation: '' })).at(-1).text.trim().endsWith('?')],
  ['an escalation written as prose becomes one paragraph',
    !T.question(convo({ escalation: 'The API key is missing and I cannot make one.' }), TR).includes('\n')],
  ['…and is kept whole',
    T.question(convo({ escalation: 'The API key is missing and I cannot make one.' }), TR)
      .includes('The API key is missing and I cannot make one.')],
  ['a question the worker already asked is not asked twice',
    (T.question(convo({ escalation: 'Which account should I use?' }), TR).match(/\?/g) || []).length === 1],
);

// 5 · a ticket that is not asking ends on one line about where it stands
{
  const running = say(convo({ status: 'running' })).at(-1);
  checks.push(
    ['a working ticket ends on one line', !running.text.includes('\n')],
    ['…which says what is happening', running.text.includes('stopped to ask about the token')],
    ['…in the worker’s voice', running.from === 'worker'],
    ['a queued ticket is the queue talking',
      say(convo({ status: 'queued', last_event: null })).at(-1).from === 'supervisor'],
    ['…saying it has not started',
      T.stateLine(convo({ status: 'queued', last_event: null }), TR) === TR('stateQueuedBare')],
    ['a finished ticket says so',
      T.stateLine(convo({ status: 'done', last_event: null }), TR) === TR('stateDoneBare')],
    // The queue files an event for every note, with the note copied into it.
    // The note is already a message a few lines up; saying it again as the
    // state of the ticket reads as the screen talking to itself.
    ['a note is not read back as the state of the ticket',
      !T.stateLine(convo({ status: 'queued',
        last_event: { ts: 4600, kind: 'note', msg: '[user] Use the staging account.' } }), TR)
        .includes('staging account')],
    ['the filing tag in front of an event is not language',
      T.stateLine(convo({ status: 'done',
        last_event: { ts: 4600, kind: 'merge', msg: '[worker] merged into main' } }), TR)
        === TR('stateDone', { ev: 'merged into main' })],
  );
}

// 6 · the box, and the line that says what sending will do
checks.push(
  ['a stopped ticket goes straight back', T.noteHint('blocked') === 'noteHintStopped'],
  ['…and a failed one too', T.noteHint('failed') === 'noteHintStopped'],
  ['a working one waits for the stage boundary', T.noteHint('running') === 'noteHintWorking'],
  ['a queued one waits for it too', T.noteHint('queued') === 'noteHintWorking'],
  ['a closed one keeps the note',
    T.noteHint('done') === 'noteHintClosed' && T.noteHint('cancelled') === 'noteHintClosed'],
);

// 7 · the shapes an escalation is written in
checks.push(
  ['dashes are points', T.bullets('- one\n- two').join('|') === 'one|two'],
  ['stars are points', T.bullets('* one\n* two').join('|') === 'one|two'],
  ['numbers are points', T.bullets('1. one\n2) two').join('|') === 'one|two'],
  ['blank lines are not points', T.bullets('- one\n\n- two').join('|') === 'one|two'],
  ['a wrapped bullet is one point',
    T.bullets('- one\n  still one\n- two').join('|') === 'one still one|two'],
  ['prose is one point', T.bullets('just the one thing').join('|') === 'just the one thing'],
  ['nothing is no points', T.bullets('').length === 0 && T.bullets(null).length === 0],
);

// Every word the new screens show comes out of the i18n table. A missing key
// renders as its own name, which is the sort of thing that ships.
const table = fs.readFileSync(path.join(root, 'src/i18n.ts'), 'utf8');
// Entries share lines, so this matches every `key: '…'` rather than one a line.
const known = new Set([...table.matchAll(/([A-Za-z0-9_]+):\s*['"]/g)].map((m) => m[1]));
const screens = ['app/ustabasi.tsx', 'app/ticket/[id].tsx', 'app/ticket-about/[id].tsx',
                 'src/components/ticket.tsx', 'app/dashboard.tsx'];
const used = new Set();
for (const f of screens) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of src.matchAll(/\bT\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
}
// The words the model itself reaches for — the voices, the question, the line
// about where a ticket stands — are named in `tickets.ts` rather than on a
// screen, either as a key it hands back or as one it looks up.
const model = fs.readFileSync(path.join(root, 'src/tickets.ts'), 'utf8');
for (const m of model.matchAll(/\bT\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
for (const m of model.matchAll(/'(ts[A-Z]|unit[A-Z]|voice[A-Z]|ask[A-Z]|state[A-Z]|noteHint[A-Z])([A-Za-z]+)'/g)) used.add(m[1] + m[2]);
const missing = [...used].filter((k) => !known.has(k));
checks.push([`every string the wall shows is in the i18n table (${used.size} keys)`, missing.length === 0]);
if (missing.length) console.log('  missing keys:', missing.join(', '));

// The model is where a sentence would hide from that check: it builds the
// question and the line about where a ticket stands out of the table, and a
// word written into it instead would never be missed. Asked with a translator
// that answers in markers, everything it hands back is a marker or came off
// the ticket — there is no third thing, which is to say no English of its own.
{
  const mark = (k) => `\u00ab${k}\u00bb`;
  const left = (text, ...fromTicket) => {
    let rest = text.replace(/\u00ab[A-Za-z0-9_]+\u00bb/g, '');
    for (const w of fromTicket) rest = rest.split(w).join('');
    return rest;
  };
  const asked = T.question(convo({ escalation: '- alpha\n- beta' }), mark);
  const stood = T.stateLine(convo({ status: 'running' }), mark);
  checks.push(
    ['the question is the table\u2019s words and the ticket\u2019s, nothing else',
      !/[A-Za-z]/.test(left(asked, 'alpha', 'beta'))],
    ['so is the line about where a ticket stands',
      !/[A-Za-z]/.test(left(stood, 'stopped to ask about the token'))],
  );
}

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

// ── a tapped notification, driven rather than read ───────────────────────────
// This is the one part of the screen nobody can check by looking: the phone is
// asleep, the banner is tapped, and where the app lands is decided in the three
// hundred milliseconds before there is anything on screen to see. So the
// decision is a function of a payload and a state, and the router is an
// interface with three calls in it — a fake one here records what it was asked
// to open, in order.

const nav = () => {
  const calls = [];
  return {
    calls,
    canDismiss: () => true,
    dismissTo: (p) => calls.push(`dismissTo ${p}`),
    push: (p) => calls.push(`push ${p}`),
  };
};
/** The app, as the holding pen sees it: started, and Face ID answered. */
const AWAKE = { ready: true, locked: false };
/** The queue's own payload, as it actually arrives. */
const TICKET_PUSH = { source: 'ustabasi', ticket: 7, kind: 'blocked', screen: 'ustabasi' };

checks.push(
  ['a payload about neither a chat nor a ticket is not a tap',
    P.tapFromPush({ kind: 'limits' }) === null && P.tapFromPush({}) === null],
  ['a ticket payload is a tap on that ticket', P.tapFromPush(TICKET_PUSH).ticket === 7],
  ['a chat payload is a tap on that chat', P.tapFromPush({ chat_id: 'abc' }).chat === 'abc'],
  ['a tap carries the computer it was sent to',
    P.tapFromPush({ chat_id: 'abc', device_id: 'dev1' }).device === 'dev1'],

  ['a ticket tap opens the wall and then the ticket',
    P.routeForTap({ ticket: 7 }).join(' ') === '/ustabasi /ticket/7'],
  ['a chat tap opens the chat and nothing else',
    P.routeForTap({ chat: 'abc' }).join(' ') === '/chat/abc'],
  ['a tap with neither opens nothing', P.routeForTap({}).length === 0 && P.routeForTap(null).length === 0],
);

{
  // (a) the ticket push, followed all the way to the screen it opens
  const taps = new P.Taps();
  taps.offer(TICKET_PUSH);
  const tap = taps.take(AWAKE);
  const n = nav();
  P.follow(tap, n);
  checks.push(
    ['the queue\u2019s push is followed to its ticket, with the wall under it',
      n.calls.join(' | ') === 'dismissTo /dashboard | push /ustabasi | push /ticket/7'],
    ['\u2026and the stack is popped back to the place the app opens on, not pushed on top of',
      n.calls[0] === 'dismissTo /dashboard'],
  );
}

{
  // (b) the chat push, which this must not have changed
  const taps = new P.Taps();
  taps.offer({ chat_id: 'abc', kind: 'approval' });
  const n = nav();
  P.follow(taps.take(AWAKE), n);
  checks.push(['a chat push still opens its chat, and no wall',
    n.calls.join(' | ') === 'dismissTo /dashboard | push /chat/abc']);
}

{
  // (c) the cold start: tapped on a sleeping phone, delivered before the
  // keychain is open and before Face ID has been answered.
  const taps = new P.Taps();
  taps.offer(TICKET_PUSH);
  const early = taps.take({ ready: false, locked: false });
  const lockedStill = taps.take({ ready: true, locked: true });
  const held = taps.held;
  const late = taps.take(AWAKE);
  const n = nav();
  P.follow(late, n);
  checks.push(
    ['a tap on an app that has not started yet is not spent', early === null],
    ['nor is one on a locked app', lockedStill === null],
    ['\u2026it is held', held === true],
    ['\u2026and delivered once the app is ready and unlocked', late && late.ticket === 7],
    ['\u2026landing on the ticket rather than on the Dashboard it was popped back to',
      n.calls.join(' | ') === 'dismissTo /dashboard | push /ustabasi | push /ticket/7'],
    ['\u2026and only once', taps.take(AWAKE) === null && taps.held === false],
  );
}

{
  // The launch response and the listener both report the tap that launched the
  // app. Two reports, one opening.
  let clock = 1_000_000;
  const taps = new P.Taps(() => clock);
  taps.offer(TICKET_PUSH);
  const first = taps.take(AWAKE);
  taps.offer(TICKET_PUSH);
  const twice = taps.take(AWAKE);
  clock += 4000;
  taps.offer(TICKET_PUSH);
  const later = taps.take(AWAKE);
  checks.push(
    ['the same tap reported twice opens once', first.ticket === 7 && twice === null],
    ['\u2026but the same ticket tapped again later does open',
      later !== null && later.ticket === 7],
  );
  // Two different notifications arriving together are two taps, not one.
  const both = new P.Taps(() => clock);
  both.offer(TICKET_PUSH);
  both.take(AWAKE);
  both.offer({ chat_id: 'abc' });
  checks.push(['a different tap is not swallowed by the last one',
    (both.take(AWAKE) || {}).chat === 'abc']);
}

{
  // The wall under a ticket is a courtesy; a courtesy that throws must not cost
  // the tap its ticket.
  const calls = [];
  const brittle = {
    canDismiss: () => { throw new Error('nothing to dismiss'); },
    dismissTo: () => calls.push('dismissTo'),
    push: (p) => { if (p === '/ustabasi') throw new Error('no wall'); calls.push(`push ${p}`); },
  };
  let threw = false;
  try { P.follow({ ticket: 7 }, brittle); } catch { threw = true; }
  checks.push(
    ['a router that cannot pop does not lose the tap', threw === false],
    ['\u2026and a wall that will not open does not either', calls.join(' | ') === 'push /ticket/7'],
  );
}

// ── 8 · the wall, grouped by project ─────────────────────────────────────────
//
// One undifferentiated pile of twenty cards is a wall you have to read twice:
// the two tickets on the same repository are eight cards apart and look
// unrelated. Grouped by project, "what is happening in babysee" is one heading.

{
  const p = (id, project, status, updated_at = 1000, extra = {}) =>
    ticket(id, status, updated_at, { project, repo: `/x/${project}`, ...extra });
  const wall = [
    p(1, 'babysee', 'running', 900),
    p(2, 'ustabasi', 'done', 800),
    p(3, 'babysee', 'queued', 700),
    p(4, 'remote-ai-chat', 'blocked', 100),
    p(5, 'ustabasi', 'running', 600),
    p(6, 'remote-ai-chat', 'done', 500),
  ];
  const groups = T.groupByProject(wall);
  const names = groups.map((g) => g.project);

  checks.push(
    ['a group per project and no more', names.length === 3],
    ['the group holding the ticket that is waiting on you comes first',
      names[0] === 'remote-ai-chat'],
    ['the rest follow their own best ticket', names.join(',') === 'remote-ai-chat,babysee,ustabasi'],
    ['every ticket is in exactly one group',
      groups.reduce((n, g) => n + g.tickets.length, 0) === wall.length
      && new Set(groups.flatMap((g) => g.tickets.map((t) => t.id))).size === wall.length],
    ['the order inside a group is the order it always was',
      groups.find((g) => g.project === 'remote-ai-chat').tickets.map((t) => t.id).join(',') === '4,6'
      && groups.find((g) => g.project === 'babysee').tickets.map((t) => t.id).join(',') === '1,3'],
    ['a group with nothing in it cannot be drawn, because it is not made',
      groups.every((g) => g.tickets.length > 0)],
    ['an empty wall is no groups at all', T.groupByProject([]).length === 0],
    ['grouping does not reorder the caller’s array', (() => {
      const given = [p(1, 'b', 'done'), p(2, 'a', 'blocked')];
      T.groupByProject(given);
      return given.map((t) => t.id).join(',') === '1,2';
    })()],

    // The name is the daemon's, which is a project and not a folder: a ticket
    // in babysee/app is babysee. The folder name is the fallback, and never the
    // path — this screen is a screenshot away from being public.
    ['the project is the name the computer gave it',
      T.projectName(ticket(1, 'done', 1, { project: 'babysee', repo: '/Users/x/projects/babysee/app' })) === 'babysee'],
    ['…and the folder name where it gave none',
      T.projectName(ticket(1, 'done', 1, { project: null, repo: '/Users/x/projects/skolalabs' })) === 'skolalabs'],
    ['no path reaches the heading',
      !T.projectName(ticket(1, 'done', 1, { project: null, repo: '/Users/x/projects/skolalabs' })).includes('/')],
    ['a ticket with neither is still under a heading',
      T.projectName(ticket(1, 'done', 1, { project: null, repo: '' })) === 'unfiled'],
    ['two names that differ only by their path are one group',
      T.groupByProject([p(1, 'babysee', 'done', 9, { repo: '/a/babysee' }),
                        p(2, 'babysee', 'done', 8, { repo: '/b/babysee/app' })]).length === 1],
  );
}

// ── 9 · what a card says, and what it no longer says ─────────────────────────

{
  const NOW = 100_000;
  const open = ticket(1, 'running', NOW - 60, {
    created_at: NOW - 54_000, started_at: NOW - 53_000, round_started_at: NOW - 2940,
    goal: 'Make the wall readable.', git: { commits: 3, subject: 'the newest thing done' },
    last_event: { ts: NOW - 60, kind: 'start', msg: 'worker round 2 pid 74155 model claude-opus-5 account yakup' },
  });

  checks.push(
    // Every status is a word a person would say, with its own colour; blocked
    // and failed say the same word because they are the same thing to the
    // person reading — the ticket is not moving until he answers.
    ['every status has a word', Object.keys(T.STATUS_KEY).every((k) => !!TR(T.STATUS_KEY[k]))],
    ['a running ticket is working', TR(T.STATUS_KEY.running) === 'working'],
    ['a blocked one is waiting on you', TR(T.STATUS_KEY.blocked) === 'waiting on you'],
    ['…and so is a failed one', TR(T.STATUS_KEY.failed) === 'waiting on you'],
    ['a queued one is queued', TR(T.STATUS_KEY.queued) === 'queued'],
    ['a finished one is done, and a dropped one cancelled',
      TR(T.STATUS_KEY.done) === 'done' && TR(T.STATUS_KEY.cancelled) === 'cancelled'],
    ['no status word is a machine token',
      Object.values(T.STATUS_KEY).every((k) => !/[_.]/.test(TR(k)))],

    // The total comes first because it is the figure anybody means by "how long
    // has this been going", and the smaller one under it was being read as it.
    ['the first figure is the whole age of the ticket',
      T.totalAge(open, NOW, TR) === 'open 15h 0m'],
    ['…and says so in a word', /^open /.test(T.totalAge(open, NOW, TR))],
    ['a finished ticket says how long it took, not how long it is',
      T.totalAge(ticket(1, 'done', 1, { created_at: NOW - 7200, finished_at: NOW - 3600 }), NOW, TR)
        === 'took 1h 0m'],
    ['the second figure is the round, and says which it is',
      T.roundAge(open, NOW, TR) === '49m in this round'],
    ['a ticket with no round in progress is not given one',
      T.roundAge(ticket(1, 'queued', 1, { round_started_at: null }), NOW, TR) === null],
    ['a finished ticket’s last round does not go on getting longer',
      T.roundAge(ticket(1, 'done', 1, { created_at: 1, finished_at: NOW - 10, round_started_at: NOW - 900 }), NOW, TR) === null],
    ['the two figures are not the same figure',
      T.totalAge(open, NOW, TR) !== T.roundAge(open, NOW, TR)],
    ['no card says "in this state" any more', !/in this state/.test(T.totalAge(open, NOW, TR) + T.roundAge(open, NOW, TR))],

    // The pid, the model and the account were the widest thing on a card and
    // the only thing on it nobody could act on. They are on the other page now.
    ['a hand-over is not what the card says happened',
      !T.cardLine(open).includes('pid') && !T.cardLine(open).includes('claude-opus-5')],
    ['…so it says what the ticket is for instead', T.cardLine(open) === 'Make the wall readable.'],
    ['what did happen is what it says',
      T.cardLine(ticket(1, 'done', 1, { last_event: { ts: 1, kind: 'merge', msg: 'merged into main (7c715c7)' } }))
        === 'merged into main (7c715c7)'],
    ['the filing tag in front of it is not language',
      T.cardLine(ticket(1, 'done', 1, { last_event: { ts: 1, kind: 'limit', msg: '[worker] all accounts limited' } }))
        === 'all accounts limited'],
    // The queue writes its events on the machine they happened on, so they are
    // full of absolute paths. A card is the widest place one of them could sit.
    ['no home directory reaches a card',
      T.cardLine(ticket(1, 'done', 1, { last_event: { ts: 1, kind: 'merge', msg: 'merge skipped: /Users/you/projects/x is dirty' } }))
        === 'merge skipped: ~/projects/x is dirty'],
    ['\u2026nor out of the goal, where there is no event',
      T.cardLine(ticket(1, 'queued', 1, { goal: 'fix /Users/you/projects/x' })) === 'fix ~/projects/x'],
    ['a line with no home directory in it is left alone',
      T.tilde('merged into main (7c715c7)') === 'merged into main (7c715c7)'],
    ['a note is not read back as what happened, because it is already a message',
      T.cardLine(ticket(1, 'running', 1, { goal: 'the goal', last_event: { ts: 1, kind: 'note', msg: '[user] use staging' } }))
        === 'the goal'],

    ['what is on the branch is counted where there is something to count',
      T.commitCount(open, TR) === '3 commits'],
    ['…and once is once', T.commitCount(ticket(1, 'running', 1, { git: { commits: 1, subject: 'x' } }), TR) === '1 commit'],
    ['no worktree, no commit line', T.commitCount(ticket(1, 'running', 1, { git: null }), TR) === null],

    // The one thing the queue cannot answer and this must never invent.
    ['nothing on a card is a percentage or an N-of-M',
      ![T.totalAge(open, NOW, TR), T.roundAge(open, NOW, TR), T.commitCount(open, TR), T.cardLine(open)]
        .some((line) => /%|\d+\s*(?:of|\/)\s*\d+/.test(line || ''))],
  );
}

// ── 10 · the steps a ticket has been through ─────────────────────────────────
//
// "What step is it on" was a question you could only answer by reading two
// thousand words of the last verifier report. The queue has known all along —
// it writes an event every time it hands a ticket to somebody — and this is
// that history as a checklist.

{
  const NOW = 100_000;
  const step = (stage, round, at, over) => ({ stage, round, at, ...over });
  const run = ticket(7, 'running', NOW, { stage: 'verifier', round: 2, steps: [
    step('worker', 1, NOW - 9000, { ended_at: NOW - 8000, outcome: 'stopped', note: 'account limited' }),
    step('worker', 1, NOW - 7000, { ended_at: NOW - 5000, outcome: 'ok' }),
    step('check', 1, NOW - 5000, { ended_at: NOW - 5000, outcome: 'ok' }),
    step('verifier', 1, NOW - 4900, { ended_at: NOW - 4000, outcome: 'rejected', note: '-> worker round 2' }),
    step('worker', 2, NOW - 3900, { ended_at: NOW - 900, outcome: 'ok' }),
    step('verifier', 2, NOW - 880, { pid: 1495, model: 'claude-opus-5', account: 'bedriyan' }),
  ]});
  const marks = run.steps.map(T.stepMark);
  const now = T.currentStep(run);

  checks.push(
    ['a step that did what it was for is ticked', marks[1] === 'done' && marks[4] === 'done'],
    ['a step the verifier sent back is crossed', marks[3] === 'crossed'],
    ['a step that did not get to finish is neither', marks[0] === 'stopped'],
    ['exactly one step is the one running now',
      marks.filter((m) => m === 'now').length === 1 && marks[marks.length - 1] === 'now'],
    ['…and it is the one the page points at', now === run.steps[5]],
    ['it says which stage and which round', T.stepLine(now, TR) === 'verifier r2'],
    ['…how long it has been going', T.stepAge(now, NOW, TR) === '14m'],
    ['…and on whose machine', now.model === 'claude-opus-5' && now.account === 'bedriyan' && now.pid === 1495],
    ['a finished step is timed by when it ended, not by the clock',
      T.stepAge(run.steps[1], NOW, TR) === T.stepAge(run.steps[1], NOW + 10_000, TR)],
    ['a ticket nobody is holding has no step running',
      T.currentStep(ticket(1, 'blocked', 1, { steps: [step('worker', 1, 1, { ended_at: 2, outcome: 'blocked' })] })) === null],
    ['a ticket that has never run has no steps at all',
      T.currentStep(ticket(1, 'queued', 1, { steps: [] })) === null],
    ['the rounds are in the order they happened',
      run.steps.map((s) => s.round).every((r, i, all) => i === 0 || r >= all[i - 1])],
  );
}

// ── 11 · the verifier's marks, against the criteria they are about ───────────
//
// The card lists what done means; the verifier answers those points in its own
// words — "1. Wall grouped by project, readable name" against a criterion three
// lines long. Lined up by position the two agree only while the verifier
// answers every point, in order, every time.

{
  const CARD = [
    'The wall groups by project and no empty group is drawn.',
    'Every card says its status in a plain word.',
    'A new handler streams a run incrementally.',
    'Tapping a card opens the chat page.',
  ];

  const verbatim = { findings: CARD.map((c, i) => ({ criterion: c, status: i === 1 ? 'unmet' : 'met' })) };
  // The half-dozen ways a verifier opens a finding, all of them the verifier
  // saying which point it is answering.
  const numbered = { findings: [
    { criterion: '4. Tapping opens the chat', status: 'met' },
    { criterion: '2. Status in a plain word', status: 'unmet', detail: 'it is still a token' },
  ]};
  const labelled = { findings: [
    { criterion: '3 \u2014 the handler pages a run', status: 'met' },
    { criterion: 'DoD 1 \u2014 the wall is grouped', status: 'unmet' },
  ]};
  const reworded = { findings: [
    { criterion: 'A new handler streams a run incrementally, capped', status: 'met' },
  ]};
  const unrelated = { findings: [{ criterion: 'The icon is the right shade of blue', status: 'unmet' }] };

  const got = (v) => T.marks(CARD, v).map((m) => (m ? (m.met ? 'y' : 'n') : '-')).join('');

  checks.push(
    ['a verdict that answers every point, word for word', got(verbatim) === 'ynyy'],
    ['a verdict that answers two of four, by its own numbering', got(numbered) === '-n-y'],
    ['…and does not put the second answer on the second criterion',
      T.marks(CARD, numbered)[1].detail === 'it is still a token'],
    ['a finding labelled the way a verifier labels one', got(labelled) === 'n-y-'],
    ['a point reworded is still the point it is about', got(reworded) === '--y-'],
    ['a finding about nothing on the card marks nothing', got(unrelated) === '----'],
    ['no verdict at all marks nothing', got(null) === '----'],
    ['an empty verdict marks nothing', got({ findings: [] }) === '----'],
    ['one finding cannot mark two criteria, however alike they are', (() => {
      const alike = ['the wall groups by project', 'the wall groups by project too'];
      return T.marks(alike, { findings: [{ criterion: 'the wall groups by project', status: 'met' }] })
        .filter(Boolean).length === 1;
    })()],
    ['\u2026and two findings that say the same thing mark it once', (() => {
      const twice = { findings: [{ criterion: CARD[0], status: 'met' }, { criterion: CARD[0], status: 'unmet' }] };
      const got = T.marks(CARD, twice);
      return got.filter(Boolean).length === 1 && got[0].met === true;
    })()],
    ['a card with no criteria has no marks', T.marks([], verbatim).length === 0],
    ['the mark carries the verifier’s own wording, so the two can be compared',
      T.marks(CARD, numbered)[3].said === '4. Tapping opens the chat'],
    // ── both screens that draw a cross, and the reading they share ──────────
    //
    // The fold at the bottom of the chat page used to read the verdict by
    // position, on the grounds that it was only a summary. It is not: it draws
    // a cross against a sentence, which is the one thing a wrong reading gets
    // wrong. Six points, two of them answered, and the marks have to land on
    // the two that were answered — under a positional reading they land on the
    // first two instead, which is the bug, in the shape it took.
    ['a verdict answering two of six marks those two and no others', (() => {
      const six = [
        'The wall groups by project.',
        'Every card says its status in a plain word.',
        'A daemon handler streams a run incrementally.',
        'Tapping a card opens the chat page.',
        'Each card carries a small information button.',
        'It stays cheap and degrades honestly.',
      ];
      const two = { findings: [
        { criterion: 'Every card says its status in a plain word', status: 'unmet',
          detail: 'it is still a token in the corner' },
        { criterion: 'Tapping a card opens the chat page', status: 'met' },
      ]};
      const got = T.marks(six, two);
      return got.map((m) => (m ? (m.met ? 'y' : 'n') : '-')).join('') === '-n-y--'
        && got[1].detail === 'it is still a token in the corner';
    })()],
    // …and the reading that got it wrong is gone rather than merely unused: a
    // function that is right on one screen and wrong on the next is a function
    // that gets called from the wrong one.
    ['there is no positional reading left to call',
      !/export function mark\b/.test(fs.readFileSync(path.join(root, 'src/tickets.ts'), 'utf8'))],
    ['and both screens draw their crosses through the one that is left', (() => {
      const pages = ['app/ticket/[id].tsx', 'app/ticket-about/[id].tsx']
        .map((p) => fs.readFileSync(path.join(root, p), 'utf8'));
      return pages.every((s) => /\bmarks\(/.test(s) && !/\bmark\(\s*t\.verdict/.test(s));
    })()],
  );
}

// ── 12 · a run's log, read as a chat ─────────────────────────────────────────
//
// The daemon hands out the model's stream a page at a time without deciding
// what is worth showing. This is that decision: a sentence is a sentence, a
// tool call is its name and the one thing it was called on, what the tool
// answered is folded behind it, and the several hundred lines of hook firings
// and token counters are dropped.
//
// Checked against a recording rather than a log written by hand, because a log
// written by hand agrees with its reader by construction — and the shapes that
// break a reader are the ones nobody would think to write: a thinking block
// with no words in it, a tool result the size of a file, a line that is not
// JSON at all. app/scripts/fixtures/README.md says where it came from.

{
  const raw = fs.readFileSync(path.join(root, 'scripts/fixtures/run.log'), 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  // The daemon's own reading of a line, in the shape it puts on the wire. Kept
  // to what this side has to draw; `daemon/scripts/test_ustabasi_run.py` is
  // where the shape itself is checked.
  const CUT = 2000;
  const records = [];
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { records.push({ k: 'other', type: 'unparsable' }); continue; }
    if (d.type === 'assistant' || d.type === 'user') {
      for (const b of (d.message || {}).content || []) {
        if (b.type === 'text') records.push({ k: 'text', text: b.text });
        else if (b.type === 'thinking') records.push({ k: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') records.push({ k: 'tool', id: b.id, name: b.name, input: b.input });
        else if (b.type === 'tool_result') {
          const body = typeof b.content === 'string' ? b.content
            : (b.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
          records.push({ k: 'result', id: b.tool_use_id, text: body.slice(0, CUT),
                         error: !!b.is_error, ...(body.length > CUT ? { clipped: true } : {}) });
        }
      }
    } else if (d.type === 'system') records.push({ k: 'system', subtype: d.subtype });
    else if (d.type === 'result') records.push({ k: 'done', error: !!d.is_error, cost: d.total_cost_usd });
    else records.push({ k: 'other', type: d.type });
  }

  const read = X.turns(records);
  const kinds = read.turns.map((t) => t.kind);
  const noise = records.filter((r) => r.k === 'system' || r.k === 'other');
  const calls = read.turns.filter((t) => t.kind === 'did');

  checks.push(
    ['the recording is a real run, not three lines', lines.length > 90],
    ['…with every shape in it that a reader has to survive',
      new Set(records.map((r) => r.k)).size >= 6],
    ['there is noise in it to drop', noise.length > 20],

    ['nothing the run printed for its own log is a turn',
      !read.turns.some((t) => t.kind === 'say' && /thinking_tokens|hook_/.test(t.text))],
    ['the count comes out right: every record is a turn or was dropped',
      records.filter((r) => r.k === 'text' && r.text.trim()).length
      + records.filter((r) => r.k === 'thinking' && (r.thinking || r.text || '').trim()).length
      + records.filter((r) => r.k === 'tool').length
      + records.filter((r) => r.k === 'done').length === read.turns.length],
    ['what it said is what it said',
      read.turns.find((t) => t.kind === 'say').text.length > 10],
    ['a thinking block with no words in it is not a blank turn',
      records.some((r) => r.k === 'thinking' && !(r.text || '').trim())
      && !read.turns.some((t) => t.kind === 'thought' && !t.text.trim())],

    ['every tool call kept its name', calls.length > 5 && calls.every((t) => !!t.tool)],
    ['…and all but the odd one say in a line what they were called on',
      calls.filter((t) => t.summary).length >= calls.length - 1],
    ['a summary is one line, whatever it is about',
      calls.every((t) => !t.summary.includes('\n'))],
    ['…and is never the whole argument list',
      calls.every((t) => t.summary.length <= 121)],
    ['what a call answered is attached to the call, not left loose',
      calls.filter((t) => t.output != null).length >= 5],
    ['…and nothing is drawn twice',
      !read.turns.some((t) => t.kind === 'say' && calls.some((c) => c.output === t.text))],
    ['the run’s own last line is the last turn',
      kinds[kinds.length - 1] === 'ended'],
    ['every turn has a key of its own',
      new Set(read.turns.map((t) => t.id)).size === read.turns.length],

    // The reading itself, on the arguments each tool happens to use.
    ['a command is the command', X.summarise('Bash', { command: 'npm test', description: 'run it' }) === 'npm test'],
    ['a file is the tail of its path, not its path',
      X.summarise('Read', { file_path: '/Users/you/projects/app/src/deep/file.ts' }) === '~/…/deep/file.ts'],
    ['nobody’s home directory reaches a screen',
      X.summarise('Bash', { command: 'cat /Users/you/.env' }) === 'cat ~/.env'],
    ['a pattern is the pattern', X.summarise('Grep', { pattern: 'useQueue', output_mode: 'content' }) === 'useQueue'],
    ['an address is the address', X.summarise('WebFetch', { url: 'https://example.com/x', prompt: 'read it' }) === 'https://example.com/x'],
    ['a call with nothing worth naming says nothing, rather than printing JSON',
      X.summarise('StructuredOutput', { verdict: 'approved', findings: [] }) === ''],
    ['a command of four lines is one line', !X.summarise('Bash', { command: 'a\nb\nc\nd' }).includes('\n')],
    ['…and a very long one is cut', X.summarise('Bash', { command: 'x'.repeat(400) }).endsWith('…')],
  );

  // A page at a time is how it actually arrives: the answer to a call usually
  // comes in the page after the call itself.
  {
    const half = records.findIndex((r) => r.k === 'result') + 1;
    const one = X.turns(records.slice(0, half - 1), 0);
    const two = X.turns(records.slice(half - 1), one.next);
    const joined = X.attach([...one.turns, ...two.turns], two.answers);
    const whole = X.turns(records);
    checks.push(
      ['read in two pages it is the same run',
        joined.filter((t) => t.kind !== 'ended').length === whole.turns.filter((t) => t.kind !== 'ended').length],
      ['…and the answer found its call across the gap',
        joined.filter((t) => t.kind === 'did' && t.output != null).length
          === whole.turns.filter((t) => t.kind === 'did' && t.output != null).length],
      ['two pages never give two turns the same key',
        new Set(joined.map((t) => t.id)).size === joined.length],
      ['a page with nothing in it changes nothing',
        X.attach(joined, {}) === joined],
    );
  }

  // ── the page boundary, in the shape that broke it ─────────────────────────
  //
  // The split above lands where it happens to land, and for a long while it
  // landed somewhere the numbering could not go wrong. The shape that breaks it
  // is a page that spends a number without drawing anything — a tool result
  // belongs to the card already on screen, an empty thinking block is not a
  // thought — so the page draws fewer turns than it numbered. Number the next
  // page from what is drawn and it starts on a number already used, and React
  // is handed two children with one key.
  //
  // This is the hook's own loop (`useRun` in src/queue.ts) done by hand: a page,
  // its `next`, the page after it, appended, trimmed.
  {
    const page1 = [
      { k: 'text', text: 'Reading the wall.' },
      { k: 'tool', id: 'toolu_a', name: 'Read', input: { file_path: '/Users/you/p/a.ts' } },
      { k: 'result', id: 'toolu_a', text: 'the file' },
      { k: 'text', text: 'Now the other one.' },
    ];
    const page2 = [{ k: 'text', text: 'Done.' }];

    const a = X.turns(page1, 0);
    const b = X.turns(page2, a.next);
    const ids = [...a.turns, ...b.turns].map((t) => t.id);

    // The count the old caller would have passed, and the one it should.
    const wrong = X.turns(page2, a.turns.length);

    checks.push(
      ['a page draws fewer turns than it numbers, when a result is in it',
        a.turns.length === 3 && a.next === 4],
      ['appending by the cursor gives every turn a key of its own',
        new Set(ids).size === ids.length],
      ['…which appending by the turn count would not have',
        wrong.turns[0].id === a.turns[a.turns.length - 1].id],
      ['an empty thinking block spends its number too, and draws nothing', (() => {
        const p = [{ k: 'thinking', text: '   ' }, { k: 'text', text: 'after it' }];
        const r = X.turns(p, 0);
        return r.turns.length === 1 && r.next === 2 && r.turns[0].id === 'r1';
      })()],
      ['a call keeps the id the CLI gave it and spends a number as well',
        a.turns[1].id === 'toolu_a'],

      // `trim` drops turns off the front of a long read, so the list gets
      // shorter while the run goes on. A cursor does not care; a count would
      // start reissuing keys from the front of the file.
      ['trim and the numbering agree: a read past the cap repeats no key', (() => {
        let list = [];
        let next = 0;
        // Enough pages to push the list well past the cap, each of them the
        // shape above so that every page numbers more than it draws.
        for (let i = 0; i < 90; i++) {
          const r = X.turns(page1.map((e, j) => (j === 1
            ? { ...e, id: `toolu_${i}` }
            : e.k === 'result' ? { ...e, id: `toolu_${i}` } : e)), next);
          next = r.next;
          list = X.trim(X.attach([...list, ...r.turns], r.answers));
        }
        return list.length === X.MAX_TURNS
          && new Set(list.map((t) => t.id)).size === list.length;
      })()],
    );
  }

  checks.push(
    ['a long read is held to a length a phone can draw',
      X.trim(new Array(X.MAX_TURNS + 50).fill(read.turns[0])).length === X.MAX_TURNS],
    ['…and it is the end that is kept', (() => {
      const many = new Array(X.MAX_TURNS + 3).fill(0).map((_, i) => ({ kind: 'say', id: `x${i}`, text: `${i}` }));
      return X.trim(many)[X.MAX_TURNS - 1].text === `${X.MAX_TURNS + 2}`;
    })()],
    ['a short one is left exactly as it is', X.trim(read.turns) === read.turns],

    // Every silence a run can be, each with its own word. Each of these was a
    // spinner that never stopped somewhere.
    ['a ticket nobody has started says so', X.silence('never_run') === 'neverRun'],
    ['a run whose log is gone says so', X.silence('no_log') === 'noLog'],
    ['a computer with no queue says so', X.silence('no_queue') === 'noQueue'],
    ['a ticket the queue does not have says so', X.silence('no_ticket') === 'noTicket'],
    ['a run that is simply quiet is not a silence', X.silence('') === null && X.silence(undefined) === null],
  );
}

// ── 13 · where the log goes in the sequence ──────────────────────────────────
//
// The log has no clock in it — it is a stream of blocks, and the queue writes
// the time beside it in its events instead. What that gives is the one fact
// that puts it in order: everything in it happened after the step that started
// it. So the reports and the notes from before that moment come first, the log
// next, and whatever has been said since after it.

{
  const NOW = 100_000;
  const t = ticket(7, 'running', NOW, {
    created_at: NOW - 9000, goal: 'do the thing', note_count: 3,
    notes: [
      { ts: NOW - 8000, from: 'user', text: 'before the run' },
      { ts: NOW - 500, from: 'supervisor', text: 'during the run' },
    ],
    steps: [{ stage: 'worker', round: 1, at: NOW - 7000, ended_at: NOW - 6000, outcome: 'ok' },
            { stage: 'worker', round: 2, at: NOW - 3000 }],
    last_event: { ts: NOW, kind: 'report', msg: 'still going' },
  });
  const msgs = T.conversation(t, TR);
  const split = T.around(msgs, T.runStartedAt(t));

  checks.push(
    ['the run being read is the one that started last',
      T.runStartedAt(t) === NOW - 3000],
    ['a ticket that has never run has no run to place',
      T.runStartedAt(ticket(1, 'queued', 1, { steps: [] })) === null],
    ['what was said before the run is above it',
      split.before.map((m) => m.text).join('|').includes('before the run')],
    ['what was said after it is below it',
      split.after.map((m) => m.text).join('|').includes('during the run')],
    ['the opening of the ticket is above it', split.before[0].text === 'do the thing'],
    ['where the ticket stands now is the last thing on the page',
      split.after[split.after.length - 1].tail === true],
    ['nothing is lost in the splitting',
      split.before.length + split.after.length === msgs.length],
    ['…and nothing is said twice',
      new Set([...split.before, ...split.after].map((m) => m.id)).size === msgs.length],
    ['a ticket with no run reads exactly as it did before there was a log',
      T.around(msgs, null).before.length === msgs.length && T.around(msgs, null).after.length === 0],
  );
}

// The wiring the judgements above cannot see. Every one of these is a line
// somewhere else in the app, and every one of them has exactly one right
// answer: a screen nothing registers is a screen nobody reaches, a notification
// nothing routes lands on the chat list, and a wall with a second way to write
// to the queue is a wall that can do more than look and answer.
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
/** A file with its comments taken out. "The pid is not on the card" is a thing
 *  to check of the card and not of the paragraph above it explaining why. */
const code = (f) => src(f).split('\n')
  .filter((l) => !/^\s*(?:\/\/|\/?\*)/.test(l)).join('\n');
const layout = src('app/_layout.tsx');
const dash = src('app/dashboard.tsx');
const wallScreen = src('app/ustabasi.tsx');
const detail = src('app/ticket/[id].tsx');
const about = src('app/ticket-about/[id].tsx');
const card = src('src/components/ticket.tsx');
const cardCode = code('src/components/ticket.tsx');
const queueHook = src('src/queue.ts');
const store = src('src/store.ts');

checks.push(
  ['all three screens are registered like the other full ones',
    /<Stack\.Screen\s+name="ustabasi"/.test(layout) && /<Stack\.Screen\s+name="ticket\/\[id\]"/.test(layout)
    && /<Stack\.Screen\s+name="ticket-about\/\[id\]"/.test(layout)],
  // The routing itself is driven above. What is left here is that the layout
  // goes through it rather than keeping a second copy: a tap is offered to the
  // holding pen, taken from it, and followed.
  ['a tapped notification goes into the holding pen',
    /taps\.current\.offer\(/.test(layout)],
  ['…is taken out of it with the app\u2019s own state',
    /taps\.current\.take\(st\)/.test(layout)],
  ['…and followed to whatever it opens', /follow\(tap, router\)/.test(layout)],
  ['…and asked for again the moment the app is ready or unlocked',
    /useEffect\(\(\) => \{ void deliverTap\(\); \}, \[ready, locked, deliverTap\]\)/.test(layout)],
  ['nothing routes a notification on its own words',
    !/router\.push\(`\/ticket/.test(layout) && !/router\.push\('\/ustabasi'\)/.test(layout)],
  // The wall used to hang off the chat list's top bar. It is work rather than
  // infrastructure, so in Divan it hangs off the Dashboard.
  ['the Dashboard leads to the wall', /router\.push\('\/ustabasi'\)/.test(dash)],
  ['…and says how many of its tickets need a person',
    /queue\.red/.test(dash) && /redCount\(/.test(queueHook)],
  ['…on a number that is re-read slowly rather than once on connect',
    /setInterval\(\(\) => void loadUstabasi\(\), BADGE_POLL_MS\)/.test(queueHook)],
  ['a card on the wall opens its ticket', /router\.push\(`\/ticket\/\$\{t\.id\}`\)/.test(wallScreen)],
  ['the opened ticket is the only thing that writes', /noteTicket\(/.test(detail)],
  ['and the wall itself writes nothing', !/noteTicket\(/.test(wallScreen)],
  ['the queue is re-read on a timer while a screen is looking',
    /setInterval\(reload, POLL_MS\)/.test(queueHook)],
  ['…and again on the way back to the foreground',
    /AppState\.addEventListener\('change'[\s\S]{0,80}'active'[\s\S]{0,20}reload/.test(queueHook)],
  ['answering a ticket re-reads the queue rather than guessing at it',
    /noteTicket: async[\s\S]{0,400}await get\(\)\.loadUstabasi\(\)/.test(store)],
  // The opened ticket is a conversation, which is a claim about how it is
  // built: it draws the run of messages the model hands it, in the app's own
  // two halves, with a box under it — and not the headings it used to have.
  ['the opened ticket is drawn from the conversation, not from the fields',
    /conversation\(t, T\)/.test(detail)],
  ['what a person said is the app\u2019s own bubble', /<UserBubble\b/.test(detail)],
  ['\u2026and what came back is drawn the way an answer in a chat is',
    /<AssistantText\b/.test(detail)],
  ['there is a box at the bottom of it, whatever the ticket is doing',
    /<TextInput\b/.test(detail) && !/wants &&[\s\S]{0,40}<TextInput/.test(detail)],
  ['\u2026and a line saying what sending will do', /T\(noteHint\(t\.status\)\)/.test(detail)],
  ['the paperwork is behind a disclosure that starts closed',
    /hasDetails\(t\) && <Details/.test(detail) && /useState\(false\)/.test(detail)],
  ['none of the old headings is on it',
    !/ticketGoal|ticketDoneWhen|ticketWaiting|ticketLastReport|ticketNotes\b/.test(detail)],
  ['\u2026nor left in the table behind it',
    !/\b(ticketGoal|ticketDoneWhen|ticketWaiting|ticketLastReport|ticketNotes):/.test(table)],
  ['a message sent shows up before the queue confirms it',
    /setPending\(\(p\) => \[\.\.\.p, local\]\)/.test(detail)],
  ['\u2026and gives way to the note when it comes back',
    /said\.has\(p\.text\)/.test(detail)],
  ['\u2026and is taken back off if the queue refuses it',
    /setPending\(\(p\) => p\.filter\(\(x\) => x\.id !== local\.id\)\)/.test(detail)],
  ['a note arriving while a report is being read does not drag it down',
    /stick\.current = /.test(detail) && /if \(stick\.current\)/.test(detail)],
);

// The wall, the card and the two pages, as they are wired. Every one of these
// is a line in a screen with exactly one right answer, and none of them can be
// seen by looking at a pure function.

checks.push(
  // 1 · the wall groups, and the grouping is not a second copy of the reading
  ['the wall draws groups, not one pile', /groupByProject\(/.test(wallScreen)],
  ['…with the project as the heading', /\{g\.project\}/.test(wallScreen)],
  ['…and the cards of that project under it', /g\.tickets\.map/.test(wallScreen)],
  ['the wall does not sort tickets a second way of its own',
    !/sortTickets\(/.test(wallScreen)],

  // 2 · the card: a word for the status, and the pid gone from it
  ['the card says the status in the app’s own word', /T\(STATUS_KEY\[t\.status\]/.test(card)],
  ['…in the colour of the status', /color: ph\.color/.test(card)],
  ['the whole age is on the card', /totalAge\(t, now, T\)/.test(card)],
  ['…and the round under it', /roundAge\(t, now, T\)/.test(card)],
  ['the pid, the model and the account are not on the card',
    !/\bpid\b/.test(cardCode) && !/\bmodel\b/.test(cardCode) && !/\baccount\b/.test(cardCode)],
  ['nor is a percentage or an N-of-M', !/%|\bof\b\s*\{?\s*n\b/.test(cardCode)],

  // 3 · the (i): its own target, far enough from the card’s
  ['the card carries an (i)', /name="info"/.test(card)],
  ['…which is a button in its own right', /accessibilityRole="button"/.test(card)],
  ['…named so a thumb can find it', /accessibilityLabel=\{T\('ticketAbout'\)\}/.test(card)],
  ['…the size of a thumb', /width: 40, height: 40/.test(card) && /hitSlop=\{8\}/.test(card)],
  ['a tap on the card opens the chat', /router\.push\(`\/ticket\/\$\{t\.id\}`\)/.test(wallScreen)],
  ['…and a tap on the (i) opens the other page',
    /router\.push\(`\/ticket-about\/\$\{t\.id\}`\)/.test(wallScreen)],
  ['the two are different handlers, so one cannot open the other',
    /onPress=\{\(\) => go\(\(\) => router\.push\(`\/ticket\//.test(wallScreen)
    && /onAbout=\{\(\) => go\(\(\) => router\.push\(`\/ticket-about\//.test(wallScreen)],

  // 4 · the chat page: the run, in the sequence, appending
  ['the chat page reads the run', /useRun\(ticketId\)/.test(detail)],
  ['…and puts it between what was said before it and after it',
    /shown\.before\.map[\s\S]{0,200}<Run[\s\S]{0,200}shown\.after\.map/.test(detail)],
  ['…which is the reading, not a second copy of it',
    /around\(msgs, t \? runStartedAt\(t\) : null\)/.test(detail)],
  ['the run is drawn in the chat’s own language and no other',
    /<AssistantText\b/.test(detail) && /<ToolCard\b/.test(detail)],
  ['a new turn only scrolls a reader who is already at the bottom',
    /stick\.current = /.test(detail) && /if \(stick\.current\)/.test(detail)],
  ['the box is still at the bottom of it', /<TextInput\b/.test(detail)],
  ['the run appends rather than being re-read whole',
    /cursor\.current/.test(queueHook) && /\.\.\.more\], answers\)/.test(queueHook)],
  // The numbering is a cursor the hook carries, not the length of what is on
  // screen. Those two are different numbers — a record can spend a number
  // without drawing anything, and `trim` drops turns off the front — and while
  // the hook counted turns, the second page reissued keys the first had used.
  ['…and the turn numbering is carried, not counted off the list',
    /numbered\.current = next/.test(queueHook) && !/turns\([^)]*\.length\)/.test(queueHook)],
  ['…and a page that is not continuous with the last starts again',
    /const fresh = !!page\.reset;/.test(queueHook)],
  ['…and a finished run stops being asked about',
    /over\.current = true/.test(queueHook)],
  ['the log is asked for faster than the wall', T.RUN_POLL_MS < T.POLL_MS],
  ['a long read is held to a length a phone can draw', /trim\(/.test(queueHook)],
  ['nothing of the log is kept in the store',
    !/ustabasiRun|runTurns|setRun\b/.test(store)],

  // 5 · the detail page: the steps, the marks, the way back
  ['the detail page draws the steps in order', /steps\.map/.test(about)],
  ['…each ticked, crossed or marked as the one running now', /stepMark\(/.test(about)],
  ['…and the running one says which stage and round', /stepLine\(s, T\)/.test(about)],
  ['…how long it has been going', /stepAge\(s, now, T\)/.test(about)],
  ['…and on which model and account',
    /detailStepOn', \{ model: s\.model, account: s\.account \}/.test(about)],
  ['…and which process it is', /detailStepPid', \{ pid: s\.pid \}/.test(about)],
  ['the criteria are marked by their own text, not by their position',
    /marks\(t\.done_criteria \|\| \[\], t\.verdict\)/.test(about) && !/\bmark\(t\.verdict, i\)/.test(about)],
  ['a criterion the verifier said nothing about says so rather than nothing',
    /detailUnjudged/.test(about)],
  ['the goal, what it is waiting for and the notes are all on it',
    /detailAsked/.test(about) && /detailAsking/.test(about) && /detailNotes/.test(about)],
  ['the detail page has a way to the chat',
    /router\.replace\(`\/ticket\/\$\{t\.id\}`\)/.test(about)],
  ['…and the chat page a way back to it',
    /router\.replace\(`\/ticket-about\/\$\{t\.id\}`\)/.test(detail)],
  ['neither page pushes the other, so Back leads to the wall from both',
    !/router\.push\(`\/ticket/.test(about) && !/router\.push\(`\/ticket/.test(detail)],
  ['both pages have a back', /router\.back\(\)/.test(about) && /router\.back\(\)/.test(detail)],
  ['the detail page writes nothing', !/noteTicket/.test(about)],

  // 6 · every silence has a sentence, and none of them is a spinner
  ['a ticket that has never run says so', /runNothing/.test(detail)],
  ['a run whose log is gone says so', /runNoLog/.test(detail)],
  ['a computer too old for the request says so', /runOldHost/.test(detail)],
  ['a computer with no queue says so', /runNoQueueBody/.test(detail)],
  ['a ticket that is not in the queue says so on the detail page too',
    /ticketGone/.test(about)],
  ['…and so does a computer with no queue', /queueNoneBody/.test(about)],
  ['nothing spins for ever: every silence is drawn instead of the spinner',
    /if \(run\.silence\) return <RunSilent/.test(detail)],
);

// Three requests and no more. `ustabasi.list` reads the wall, `ustabasi.run`
// reads one ticket's log, `ustabasi.note` answers a ticket; anything else the
// queue's CLI can do — start, cancel, rewrite a card — is not this app's to
// offer, and would be a fourth string here.
const calls = new Set();
for (const f of ['src/store.ts', 'src/queue.ts', 'app/ustabasi.tsx', 'app/ticket/[id].tsx',
                 'app/ticket-about/[id].tsx', 'src/components/ticket.tsx', 'app/dashboard.tsx']) {
  for (const m of src(f).matchAll(/'(ustabasi\.[a-z.]+)'/g)) calls.add(m[1]);
}
checks.push([`the screens ask the computer for three things and no more (${[...calls].sort().join(', ')})`,
  calls.size === 3 && calls.has('ustabasi.list') && calls.has('ustabasi.note') && calls.has('ustabasi.run')]);

// The Divan design system is checked next door, where its subject is — the
// palette read off the artboards, and the parts the new screens are made of —
// and so is the reading behind those screens: several computers' boards merged
// into one view, with a machine that has gone quiet still in it. Folded in here
// so that one command still covers everything in the app that can be checked
// without a phone.
checks.push(...require('./test-divan.cjs').checks);
checks.push(...require('./test-divan-merge.cjs').checks);
// …and the shell those screens stand in: the three places, the project bar,
// and everything about a computer having moved under the third one.
checks.push(...require('./test-shell.cjs').checks);
// …and the first of the screens: the Dashboard, which is the reason for all of
// it — every counter counted, a quiet machine said out loud, and a morning with
// nothing on it drawn as the state it is.
checks.push(...require('./test-dashboard.cjs').checks);
// …and the screen its first counter opens: everything that needs a person,
// across every project and every machine, grouped by the kind of answer it
// needs — and answered in one tap where the question offered the words for it.
checks.push(...require('./test-waiting.cjs').checks);
// …and the page behind one chip in the project bar: one product alone, what is
// happening on it and what it is waiting for, its branches as cards — and the
// two states that are not that, a product asleep for weeks and one whose board
// has never had a card on it.
checks.push(...require('./test-project.cjs').checks);
// …and its other face: the board, four columns of it, where the column is what a
// person intended and the mark on a card is what is actually happening to it —
// including a worker that failed at four in the morning and a machine that has
// stopped answering since.
checks.push(...require('./test-board.cjs').checks);
// …and the one gesture on that board that changes what a computer is doing:
// press and hold, the column tabs as the drop targets, what is felt at each
// step, the worker a drop into In Progress starts — and the drag that is
// cancelled or dropped nowhere, which asks nothing of anybody.
checks.push(...require('./test-drag.cjs').checks);
// …and one card of that board, opened: what it is, what the machine was told to
// do with it, and what the worker on it is printing right now — three faces over
// one head, with the rule that nothing an agent wrote reaches the first of them.
checks.push(...require('./test-card.cjs').checks);
// …and the screen a card is written on: a title, two or three sentences and
// nothing else — no executor, no brief, no approval. Its own checks are pushed
// after its `ready`, because filing is a request and the page it lands on is
// chosen when that request comes back.
const newTicket = require('./test-new-ticket.cjs');

void newTicket.ready.then(() => {
  checks.push(...newTicket.checks);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
});
