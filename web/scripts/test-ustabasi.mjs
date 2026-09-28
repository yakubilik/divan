#!/usr/bin/env node
/** What a ticket reads like when it is opened.
 *
 *     cd web && npm test
 *
 *  The panel has no test runner and does not need one: the part of this that
 *  can be wrong without anyone noticing is not the drawing, it is the reading —
 *  which order the messages come in, who is said to have said them, and whether
 *  the question at the end is a question. All of that is a pure function of one
 *  ticket, so it is checked here against tickets made up for the purpose.
 *
 *  The view itself is rendered once, to static markup, for the two claims that
 *  are structural rather than visual: there is a box to type in, and the
 *  paperwork starts folded away. The same render is written to
 *  `.test-build/preview.html`, which opens in a phone browser with no daemon
 *  and no pairing — that is the check for how it reads in portrait.
 *
 *  Compiled with the panel's own TypeScript, into the panel's own tree, so that
 *  `react` resolves the way it does in the build.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOW, REPORT, card, ticket, wall } from './ticket-fixture.js';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/ustabasi.ts', 'src/components/TicketChat.tsx',
  '--outDir', '.test-build',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

// The panel is bundled, so its imports are written the way a bundler reads
// them: `./theme`, not `./theme.js`. Node only takes the second, and a loader
// to teach it the first is more machinery than a regular expression.
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

const {
  answerable, bullets, cardLine, commitCount, conversation, groupByProject, hasDetails,
  noteHint, projectName, question, roundAge, sortTickets, stageLine, stateLine, totalAge,
} = await import(pathToFileURL(join(out, 'lib', 'ustabasi.js')));
const { TicketChat } = await import(pathToFileURL(join(out, 'components', 'TicketChat.js')));

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

const all = (m) => `${m.text}\n${m.more ?? ''}`;

// ── 1 · it is a conversation, not a report ──────────────────────────────────

group('the sequence is a conversation');
{
  const t = ticket();
  const msgs = conversation(t);
  const text = msgs.map(all).join('\n');

  for (const heading of ['GOAL', 'DONE WHEN', 'WHAT IT IS WAITING FOR', 'NOTES', 'LAST REPORT']) {
    ok(`no "${heading}" heading`, !text.includes(heading));
  }
  ok('every message has a voice and a time',
    msgs.every((m) => m.from && Number.isFinite(m.ts) && m.ts > 0));
  ok('every message is from a voice the panel can name',
    msgs.every((m) => ['you', 'worker', 'verifier', 'triage', 'supervisor'].includes(m.from)));
}

// ── 2 · the order is the order it happened in ───────────────────────────────

group('the order is time order');
{
  const msgs = conversation(ticket());

  ok('the goal opens it, in the voice of whoever opened the ticket',
    msgs[0].from === 'you' && msgs[0].text === 'Make a tile open as a conversation instead of a report.');
  ok('the opening carries the time the ticket was opened', msgs[0].ts === 1000);

  const stamps = msgs.map((m) => m.ts);
  ok('no message is older than the one above it',
    stamps.every((ts, i) => i === 0 || ts >= stamps[i - 1]), stamps.join(', '));

  const notes = msgs.slice(1, -1);
  ok('the notes are in the order they were written',
    notes.map((m) => m.ts).join(',') === '2000,3000,4000', notes.map((m) => m.ts).join(','));
  ok('a note says who wrote it',
    notes.map((m) => m.from).join(',') === 'verifier,you,triage', notes.map((m) => m.from).join(','));

  ok('the last message is the only tail',
    msgs.filter((m) => m.tail).length === 1 && msgs[msgs.length - 1].tail === true);
  ok('the tail is not older than the ticket', msgs[msgs.length - 1].ts >= 4500);
}

// ── 3 · the last message is the question ────────────────────────────────────

group('a stopped ticket ends on a question');
for (const status of ['blocked', 'failed']) {
  const t = ticket({ status });
  const tail = conversation(t).at(-1);

  ok(`${status}: one paragraph`, !tail.text.includes('\n'), JSON.stringify(tail.text));
  ok(`${status}: no bullet left in it`, !/(^|\s)[-*•]\s/.test(tail.text), tail.text);
  ok(`${status}: it asks`, tail.text.trim().endsWith('?'), tail.text);
  ok(`${status}: it is addressed to a person`, /\byou\b/i.test(tail.text));
  ok(`${status}: the points of the escalation survived`,
    tail.text.includes('token with **write** access') && tail.text.includes('the whole ticket closes'));
  ok(`${status}: a wrapped bullet stayed with its bullet`,
    tail.text.includes('is needed and nobody has one yet'), tail.text);
  ok(`${status}: nothing is clipped away`, tail.more === undefined);
}
{
  const empty = conversation(ticket({ escalation: '' })).at(-1);
  ok('a stopped ticket with no report still asks something', empty.text.trim().endsWith('?'));

  const prose = question(ticket({ escalation: 'The API key is missing and I cannot make one.' }));
  ok('an escalation written as prose becomes one paragraph', !prose.includes('\n'));
  ok('an escalation written as prose is kept whole',
    prose.includes('The API key is missing and I cannot make one.'));
}

// ── 4 · a working ticket ends on one line ───────────────────────────────────

group('a working ticket ends on one line');
{
  const tail = conversation(ticket({ status: 'running' })).at(-1);
  ok('one line', !tail.text.includes('\n'), tail.text);
  ok('it says what is happening', tail.text.includes('stopped to ask about the token'));
  ok('it comes from the worker', tail.from === 'worker');

  ok('a queued ticket is the queue talking',
    conversation(ticket({ status: 'queued', last_event: null })).at(-1).from === 'supervisor');
  ok('a queued ticket says it has not started',
    stateLine(ticket({ status: 'queued', last_event: null })).includes('Waiting for a free slot'));
  ok('a done ticket says so', stateLine(ticket({ status: 'done', last_event: null })) === 'Finished.');

  // The queue files an event for every note, with the note copied into it. The
  // note is already a message a few lines up; saying it again as the state of
  // the ticket reads as the panel talking to itself.
  const echoed = ticket({
    status: 'queued',
    last_event: { ts: 4600, kind: 'note', msg: '[user] Use the staging account, not the live one.' },
  });
  ok('a note is not read back as the state of the ticket',
    !stateLine(echoed).includes('staging account'), stateLine(echoed));
  ok('the filing tag in front of an event is not language',
    stateLine(ticket({ status: 'done', last_event: { ts: 4600, kind: 'merge', msg: '[worker] merged into main' } }))
      === 'Finished — merged into main');
}

// ── 5 · what does not belong in a conversation ──────────────────────────────

group('the paperwork stays out of it');
{
  const t = ticket();
  const msgs = conversation(t);
  const shown = msgs.map((m) => m.text).join('\n');
  const everything = msgs.map(all).join('\n');

  for (const c of t.done_criteria) {
    ok('a criterion is not a message', !everything.includes(c), c);
  }
  ok('the verifier detail is not a message',
    !everything.includes('the long detail nobody reads'));

  const report = msgs.find((m) => m.from === 'verifier');
  ok('a long report is cut down to its opening', report.text.length < 500, String(report.text.length));
  ok('the rest of it is kept, folded', typeof report.more === 'string' && report.more.length > 100);
  ok('nothing of the report is lost',
    (report.text + ' ' + report.more).replace(/\s+/g, ' ').trim()
      === REPORT.replace(/\s+/g, ' ').trim());
  ok('the folded part is not shown by default',
    !shown.includes('This sentence is the end of the report.')
    && report.more.includes('This sentence is the end of the report.'));

  const own = msgs.find((m) => m.from === 'you' && m.ts === 3000);
  ok('what a person typed is never cut', own.more === undefined);

  ok('there is paperwork to fold away', hasDetails(t) === true);
  ok('a ticket with neither criteria nor verdict has no details',
    hasDetails(ticket({ done_criteria: [], verdict: null })) === false);
}

// ── 6 · the box says what sending will do ───────────────────────────────────

group('the box, and what it says');
{
  ok('a stopped ticket is answered', answerable('blocked') && answerable('failed'));
  ok('a working one is not stopped', !answerable('running') && !answerable('queued'));

  ok('a stopped ticket goes straight back', noteHint('blocked').includes('straight away'));
  ok('a working one waits for the stage boundary', noteHint('running').includes('stage boundary'));
  ok('a queued one waits for the stage boundary', noteHint('queued').includes('stage boundary'));
  ok('a closed one keeps the note', noteHint('done').includes('kept'));
}

// ── 7 · the shapes an escalation is written in ──────────────────────────────

group('reading an escalation');
{
  ok('dashes', bullets('- one\n- two').join('|') === 'one|two');
  ok('stars', bullets('* one\n* two').join('|') === 'one|two');
  ok('numbers', bullets('1. one\n2) two').join('|') === 'one|two');
  ok('blank lines', bullets('- one\n\n- two').join('|') === 'one|two');
  ok('a wrapped bullet is one point',
    bullets('- one\n  still one\n- two').join('|') === 'one still one|two');
  ok('prose is one point', bullets('just the one thing').join('|') === 'just the one thing');
  ok('nothing is no points', bullets('').length === 0);
}

// ── 8 · the view itself ─────────────────────────────────────────────────────

group('the view');
{
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const t = ticket();
  const html = renderToStaticMarkup(createElement(TicketChat, {
    t,
    tone: { label: 'needs an answer', color: '#D8A657', rgb: '216,166,87' },
    onClose: () => {},
    onNote: async () => 'note added',
  }));

  ok('the goal is in it', html.includes('Make a tile open as a conversation instead of a report.'));
  ok('the question is in it', html.includes('Can you sort that out'));
  ok('there is a box to type in', html.includes('<textarea'));
  ok('the box says what sending does', html.includes('back in the queue'));
  ok('the voices are named', html.includes('Verifier') && html.includes('Triage') && html.includes('You'));
  for (const heading of ['GOAL', 'DONE WHEN', 'WHAT IT IS WAITING FOR']) {
    ok(`no "${heading}" heading on screen`, !html.includes(heading));
  }
  ok('the paperwork is offered', html.includes('Details'));
  for (const c of t.done_criteria) {
    ok('the paperwork starts folded', !html.includes(c), c);
  }
  ok('the rest of a long report starts folded', html.includes('The rest of this report'));

  // Something to hold a phone up to. No daemon, no pairing, no build.
  writeFileSync(join(out, 'preview.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Ticket preview</title><style>'
    + 'html,body{height:100%;margin:0;background:#0F0E0C;color:#F1ECE3;overflow:hidden;'
    + 'font-family:-apple-system,"SF Pro Text",system-ui,sans-serif}'
    + '</style></head><body>' + html
    // A static render runs no effects, so it opens at the top; the panel opens
    // at the end, which is where the question is.
    + '<script>for(const d of document.querySelectorAll("div"))'
    + 'if(d.style.overflowY==="auto")d.scrollTop=d.scrollHeight;</scr' + 'ipt>'
    + '</body></html>');
}

// ── 9 · the wall is a column per project ────────────────────────────────────

group('the columns');
{
  const groups = groupByProject(wall());

  ok('one column per project, and none for a project with nothing in it',
    groups.map((g) => g.project).join('|') === 'remote-ai-chat|babysee|ustabasi',
    groups.map((g) => g.project).join('|'));
  ok('the column holding the stopped ticket is first', groups[0].project === 'remote-ai-chat');
  ok('a column is titled with the project the daemon named, not the folder',
    projectName(card({ project: 'babysee', repo: '/Users/x/projects/babysee/app' })) === 'babysee');
  ok('a daemon too old to name it leaves the folder to stand in',
    projectName(card({ project: null, repo: '/Users/x/projects/babysee' })) === 'babysee');
  ok('and with no path either, nothing is filed under nothing',
    projectName(card({ project: null, repo: '' })) === 'unfiled');
  ok('every ticket is in exactly one column',
    groups.reduce((n, g) => n + g.tickets.length, 0) === wall().length);
  ok('an empty wall is no columns', groupByProject([]).length === 0);

  ok('the stopped one is at the top of its column',
    groups[0].tickets.map((t) => t.id).join(',') === '2,1', groups[0].tickets.map((t) => t.id).join(','));
  ok('and a finished one is at the bottom of its',
    groups[1].tickets.map((t) => t.id).join(',') === '3,5', groups[1].tickets.map((t) => t.id).join(','));

  const order = sortTickets([
    card({ id: 1, status: 'done' }), card({ id: 2, status: 'queued' }),
    card({ id: 3, status: 'running' }), card({ id: 4, status: 'failed' }),
    card({ id: 5, status: 'blocked' }), card({ id: 6, status: 'cancelled' }),
  ]).map((t) => t.id).join(',');
  ok('the order inside a column is the one the wall has always had',
    order === '5,4,3,2,1,6', order);

  const byMovement = groupByProject([
    card({ id: 1, project: 'a', updated_at: NOW - 900 }),
    card({ id: 2, project: 'b', updated_at: NOW - 10 }),
  ]).map((g) => g.project).join('|');
  ok('two columns of equal urgency go by what moved last', byMovement === 'b|a', byMovement);
}

// ── 10 · what a card says about time and place ──────────────────────────────

group('the figures on a card');
{
  ok('how long it has been open, in words a clock can be held to',
    totalAge(card(), NOW) === 'open 15h 18m', totalAge(card(), NOW));
  ok('the round is its own figure, and says so',
    roundAge(card(), NOW) === '49m in this round', roundAge(card(), NOW));
  ok('a finished ticket says how long it took',
    totalAge(card({ status: 'done', finished_at: NOW - 3600 }), NOW) === 'took 14h 18m',
    totalAge(card({ status: 'done', finished_at: NOW - 3600 }), NOW));
  ok('and has no round still running',
    roundAge(card({ status: 'done', finished_at: NOW - 3600 }), NOW) === null);
  ok('a ticket that has stopped to ask is still open, not finished',
    totalAge(card({ status: 'blocked', finished_at: NOW - 3600 }), NOW) === 'open 15h 18m');
  ok('a ticket still in the queue has no round to time',
    roundAge(card({ status: 'queued', round_started_at: null }), NOW) === null);
  ok('a young ticket is counted in seconds',
    totalAge(card({ created_at: NOW - 12 }), NOW) === 'open 12s');

  ok('whose hands it is in, and which round',
    stageLine(card({ stage: 'verifier', round: 3 })) === 'verifier r3');
  ok('what is on the branch', commitCount(card({ git: { commits: 7, subject: 's' } })) === '7 commits');
  ok('one commit is one commit', commitCount(card({ git: { commits: 1, subject: 's' } })) === '1 commit');
  ok('nothing committed, and the card says nothing', commitCount(card()) === null);

  const at = (kind, msg) => card({ last_event: { ts: NOW, kind, msg } });
  ok('the line under the title is the last thing that happened',
    cardLine(at('merge', 'merged into main (4dd999f)')) === 'merged into main (4dd999f)');
  ok('a hand-over is the queue talking to its own log, so the card says what the ticket is for',
    cardLine(at('start', 'worker round 1 pid 74155 model m account a'))
      === 'Make a tile open as a conversation instead of a report.',
    cardLine(at('start', 'worker round 1 pid 74155 model m account a')));
  ok('who wrote a note is not read out on a card',
    cardLine(at('note', '[user] have another go')) === 'have another go');
  ok('a report is cut to its first line',
    cardLine(at('report', 'the first line\nand a second one')) === 'the first line',
    cardLine(at('report', 'the first line\nand a second one')));
  ok('nothing said and nothing asked for is nothing',
    cardLine(card({ goal: '', last_event: null })) === '');
}

// ── 11 · what a card does not say ───────────────────────────────────────────

group('nothing invented on a card');
{
  // The cards and their columns, which is everything the wall draws before it
  // hands a clicked ticket over to the conversation view.
  const screen = readFileSync(join(web, 'src', 'screens', 'Ustabasi.tsx'), 'utf8');
  const cards = screen.slice(screen.indexOf('function Tile('), screen.indexOf('// ── the wall ─'));

  ok('the wall was found in the file', cards.length > 500);
  ok('no card says "in this state" about anything', !/in this state/.test(cards));
  ok('no percentage and no bar', !/percent|progress|toFixed|\* *100/i.test(cards));
  ok('no count of criteria nobody has answered yet', !/done_criteria|findings/.test(cards));
  ok('the total is drawn above the round',
    cards.indexOf('totalAge(t, now)') < cards.indexOf('{round &&'));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
