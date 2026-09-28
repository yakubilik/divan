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

const T = load('src/tickets.ts', ['POLL_MS', 'STATUS_KEY', 'VOICE_KEY', 'answerable', 'redCount', 'sortTickets',
                                  'mark', 'wall', 'oldHost', 'since', 'first', 'repoName',
                                  'bullets', 'conversation', 'question', 'stateLine', 'noteHint', 'hasDetails']);
// What a tapped notification opens: the reading of the payload, the holding pen
// a tap waits in while the app is still starting, and the route itself.
const P = load('src/tap.ts', ['ticketFromPush', 'tapFromPush', 'routeForTap', 'Taps', 'follow']);

// The real table, so that what the conversation says is what the screen shows
// rather than a sentence written twice.
const TR = load('src/i18n.ts', ['t']).t;
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
const screens = ['app/ustabasi.tsx', 'app/ticket/[id].tsx', 'src/components/ticket.tsx', 'src/components/home.tsx'];
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
      n.calls.join(' | ') === 'dismissTo /chats | push /ustabasi | push /ticket/7'],
    ['\u2026and the stack is popped back to the list first, not pushed on top of',
      n.calls[0] === 'dismissTo /chats'],
  );
}

{
  // (b) the chat push, which this must not have changed
  const taps = new P.Taps();
  taps.offer({ chat_id: 'abc', kind: 'approval' });
  const n = nav();
  P.follow(taps.take(AWAKE), n);
  checks.push(['a chat push still opens its chat, and no wall',
    n.calls.join(' | ') === 'dismissTo /chats | push /chat/abc']);
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
    ['\u2026landing on the ticket rather than on the chat list',
      n.calls.join(' | ') === 'dismissTo /chats | push /ustabasi | push /ticket/7'],
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

// The wiring the judgements above cannot see. Every one of these is a line
// somewhere else in the app, and every one of them has exactly one right
// answer: a screen nothing registers is a screen nobody reaches, a notification
// nothing routes lands on the chat list, and a wall with a second way to write
// to the queue is a wall that can do more than look and answer.
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const layout = src('app/_layout.tsx');
const home = src('src/components/home.tsx');
const wallScreen = src('app/ustabasi.tsx');
const detail = src('app/ticket/[id].tsx');
const queueHook = src('src/queue.ts');
const store = src('src/store.ts');

checks.push(
  ['both screens are registered like the other full ones',
    /<Stack\.Screen\s+name="ustabasi"/.test(layout) && /<Stack\.Screen\s+name="ticket\/\[id\]"/.test(layout)],
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
  ['the chats screen leads to the wall', /router\.push\('\/ustabasi'\)/.test(home)],
  ['…and badges it with the count that needs a person', /badge=\{red\}/.test(home) && /redCount\(/.test(home)],
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

// Two requests and no more. `ustabasi.list` reads, `ustabasi.note` answers;
// anything else the queue's CLI can do — start, cancel, rewrite a card — is not
// this app's to offer, and would be a third string here.
const calls = new Set();
for (const f of ['src/store.ts', 'src/queue.ts', 'app/ustabasi.tsx', 'app/ticket/[id].tsx',
                 'src/components/ticket.tsx', 'src/components/home.tsx']) {
  for (const m of src(f).matchAll(/'(ustabasi\.[a-z.]+)'/g)) calls.add(m[1]);
}
checks.push([`the screens ask the computer for two things and no more (${[...calls].sort().join(', ')})`,
  calls.size === 2 && calls.has('ustabasi.list') && calls.has('ustabasi.note')]);

let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name);
  if (!ok) bad++;
}
console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
