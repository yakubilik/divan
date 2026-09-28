// The ustabasi wall's judgements, kept away from the screens that draw them so
// they can be checked without a phone (scripts/test-ustabasi.cjs). Nothing in
// here touches React, the store or the palette.
import type { Key } from './i18n';
import type { Ticket, TicketStatus, TicketStep, TicketVerdict, UstabasiSnapshot } from './protocol';

/** How often the wall re-reads the queue while it is open. The supervisor ticks
 *  every few minutes, so a second would be pointless; a minute would mean
 *  answering a ticket and watching a stale card insist it is still red. The
 *  desktop panel polls at the same rate. */
export const POLL_MS = 8000;

/** How often the chat page asks for what the agent has printed since. Faster
 *  than the wall by a lot: a line arriving four seconds after it was written is
 *  a screen you can watch, and a line arriving eight is one you refresh. The
 *  answer to a poll that finds nothing is a couple of hundred bytes, which is
 *  what makes that affordable. */
export const RUN_POLL_MS = 3000;

/** How often the chats screen re-reads the queue for its badge. Slower than the
 *  wall by a lot: nobody is reading the tickets there, and the one thing the
 *  number has to do is stop being wrong for hours at a time. */
export const BADGE_POLL_MS = 60_000;

/** The supervisor stamps a heartbeat at the start of every tick. Older than
 *  this and the queue is not running, whatever the cards say — a supervisor
 *  that died leaves every ticket exactly as it was. */
export const TICK_STALE_S = 10 * 60;

/** Every status, in the words the app shows for it. */
export const STATUS_KEY: Record<TicketStatus, Key> = {
  running: 'tsRunning', blocked: 'tsBlocked', failed: 'tsFailed',
  done: 'tsDone', queued: 'tsQueued', cancelled: 'tsCancelled',
};

/** Red first, then whatever is moving, then the rest. An id order would put the
 *  ticket that has been waiting since last night below three that are merrily
 *  working, which is exactly backwards. The same order the panel uses. */
const RANK: Record<TicketStatus, number> = {
  blocked: 0, failed: 1, running: 2, queued: 3, done: 4, cancelled: 5,
};

/** A ticket you can talk to. The queue re-opens a blocked or failed ticket the
 *  moment a note lands; a running one takes the note at its next stage
 *  boundary, which is useful but not urgent, so the box is offered only where
 *  the ticket is actually stopped waiting for it. */
export function answerable(status: TicketStatus | string): boolean {
  return status === 'blocked' || status === 'failed';
}

/** The ones that need a person. This is the number the chats screen badges. */
export function redCount(tickets: Ticket[]): number {
  return tickets.filter((t) => answerable(t.status)).length;
}

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const r = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    return r !== 0 ? r : b.updated_at - a.updated_at;
  });
}

/** The verifier's mark against the card's nth criterion, or null where it has
 *  not judged this one. Positional: it answers them in order but writes its own
 *  wording for each, so the card's text stays and only the mark comes from it. */
export function mark(verdict: TicketVerdict | null | undefined, i: number): { met: boolean; detail?: string } | null {
  const f = verdict?.findings?.[i];
  if (!f) return null;
  return { met: f.status === 'met', detail: f.detail };
}

// ── the verifier's marks, matched to the criteria they are about ─────────────
//
// The card lists what "done" means; the verifier answers those points and
// writes its own wording for each — "1. Wall grouped by project, readable name"
// against a criterion three lines long. Lined up by position the two agree only
// while the verifier answers every point, in order, every time. A verdict that
// answers four of nine puts the fourth mark on the ninth criterion, and a
// screen showing a red cross against the wrong sentence is worse than showing
// nothing: it is a wrong answer to the only question the page exists to
// answer.
//
// So the matching is on the text. Three readings of "is this that", strongest
// first, and a finding is spent once:
//
//   * the same sentence, ignoring case, punctuation and any numbering
//   * the number the verifier gave itself — "3." is the card's third point,
//     which is the verifier naming a criterion rather than a list naming it
//   * enough of the same words. The two are written by different hands about
//     the same thing, so the overlap is high where they match at all.

/** The label a finding opens with, where it opens with one. Verifiers write
 *  these half a dozen ways — `3.`, `4)`, `2 — `, `DoD 6 — `, `criterion 1:` —
 *  and every one of them is the verifier naming which point it is answering,
 *  which is a better answer than the position in a list. */
const LABEL = /^\s*(?:[A-Za-z]{1,12}\s+)?(\d{1,2})\s*[.)\-:\u2013\u2014]+\s/;

/** A criterion, as a thing to compare: no numbering, no punctuation, no case. */
function bare(text: string): string {
  return (text || '')
    .replace(LABEL, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The number a finding gave itself, 1-based, or 0. */
function numbered(text: string): number {
  const m = LABEL.exec(text || '');
  return m ? Number(m[1]) : 0;
}

/** Words long enough to mean something. `the` and `a` match everything. */
function words(text: string): Set<string> {
  return new Set(bare(text).split(' ').filter((w) => w.length >= 4));
}

/** How much two sentences are about the same thing, 0 to 1. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** Below this the two sentences are about different things and the safe answer
 *  is no mark at all. Set where it is because the card and the verdict are two
 *  hands writing about one point and share most of the words that carry it. */
const SAME_ENOUGH = 0.6;

export interface Mark { met: boolean; detail?: string; said?: string }

/** The verifier's marks against the card's criteria, one slot per criterion and
 *  null where this verdict says nothing about that one. */
export function marks(criteria: string[], verdict: TicketVerdict | null | undefined): (Mark | null)[] {
  const out: (Mark | null)[] = criteria.map(() => null);
  const findings = verdict?.findings || [];
  const spent = findings.map(() => false);
  const put = (i: number, f: number) => {
    if (i < 0 || i >= out.length || out[i] || spent[f]) return false;
    spent[f] = true;
    out[i] = { met: findings[f].status === 'met', detail: findings[f].detail,
               said: findings[f].criterion };
    return true;
  };

  const flat = criteria.map(bare);
  findings.forEach((f, i) => { if (flat.indexOf(bare(f.criterion)) >= 0) put(flat.indexOf(bare(f.criterion)), i); });
  findings.forEach((f, i) => { if (!spent[i]) put(numbered(f.criterion) - 1, i); });

  const cardWords = criteria.map(words);
  findings.forEach((f, i) => {
    if (spent[i]) return;
    const mine = words(f.criterion);
    let best = -1;
    let score = SAME_ENOUGH;
    cardWords.forEach((w, j) => {
      if (out[j]) return;
      const s = overlap(mine, w);
      if (s >= score) { score = s; best = j; }
    });
    if (best >= 0) put(best, i);
  });
  return out;
}

/** Which of the wall's six faces to draw. Every one of these has been a blank
 *  screen or a spinner that never stopped at some point: a computer that is not
 *  connected, one whose daemon predates the two requests, one that simply has
 *  no queue, and one whose queue is empty. */
export type Wall = 'offline' | 'oldHost' | 'error' | 'loading' | 'noQueue' | 'empty' | 'tickets';

export function wall(s: { online: boolean; snapshot: UstabasiSnapshot | null; error: string | null; oldHost: boolean }): Wall {
  if (!s.online) return 'offline';
  if (s.oldHost) return 'oldHost';
  // A snapshot already in hand outlives a failed poll: the queue is still
  // whatever it was eight seconds ago, which beats replacing it with an error.
  if (s.error && !s.snapshot) return 'error';
  if (!s.snapshot) return 'loading';
  if (!s.snapshot.available) return 'noQueue';
  if (s.snapshot.tickets.length === 0) return 'empty';
  return 'tickets';
}

/** "This computer has never heard of that request" — an older daemon, which is
 *  a thing to say once, not to retry or to dress up as a failure. The daemon
 *  answers an unknown request in words rather than with a code. A connection
 *  that dropped mid-request is not this. */
export function oldHost(e: { message?: string; code?: string | null } | null | undefined): boolean {
  if (!e || e.code === 'offline') return false;
  return /unknown (type|request)/i.test(e.message || '');
}

/** A gap in seconds, as short as it can be read at a glance. */
export function since(seconds: number | null | undefined, unit: (k: 'unitSec' | 'unitMin' | 'unitHour' | 'unitDay') => string): string {
  if (seconds == null) return '';
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 60) return `${Math.round(n)}${unit('unitSec')}`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}${unit('unitMin')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${unit('unitHour')} ${m % 60}${unit('unitMin')}`;
  return `${Math.floor(h / 24)}${unit('unitDay')} ${h % 24}${unit('unitHour')}`;
}

/** The opening of a longer text, cut on a word. A card has two lines for what
 *  a worker wrote as twenty. */
export function first(text: string | null | undefined, n: number): string {
  const t = (text || '').trim();
  if (t.length <= n) return t;
  // Only back up to the previous space when the cut landed inside a word —
  // a cut that already fell on one has no half word to throw away.
  const cut = t.slice(0, n);
  return (/\s/.test(t[n]) ? cut : cut.replace(/\s+\S*$/, '')) + '…';
}

/** A home directory, out of a line that is about to be drawn.
 *
 *  The queue writes its events for its own log, on the machine they happened
 *  on, so they are full of absolute paths — "merge skipped: /Users/you/x has
 *  uncommitted work", with a real name where that one says `you`. On a card
 *  that is the widest thing on it, on a screen that is a screenshot away from
 *  being public.
 *  Display only — nothing of the queue is rewritten. The chat does the same to
 *  a tool line (src/transcript.ts), for the same reason. */
const HOME = /\/Users\/[^/\s'"]+|\/home\/[^/\s'"]+|C:\\Users\\[^\\\s'"]+/gi;

export function tilde(text: string): string {
  return text.replace(HOME, '~');
}

/** The repository a ticket works in, named the way the rest of the app names a
 *  folder: the last segment, never the path — this screen is a screenshot away
 *  from being public. */
export function repoName(repo: string | null | undefined): string {
  const parts = (repo || '').split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// ── a ticket, read as a conversation ─────────────────────────────────────────
// The queue keeps a ticket as a card, a pile of notes, a report and a verdict —
// four shapes, each with its own heading. Read under those headings it is a
// status report, and a status report is a thing you file, not a thing you
// answer. But everything in it happened in an order and was said by somebody:
// the card is the sentence that opened the ticket, the notes are what came
// back, the last thing that happened is where the worker got to. Laid out that
// way it is a conversation with a question at the end of it, which is what it
// always was. The desktop panel reads a ticket the same way, out of the same
// four fields — see web/src/lib/ustabasi.ts.

/** A translator, as `useT()` hands one over. Passed in rather than imported so
 *  that everything below stays a pure function of a ticket and a table. */
export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** Who said a thing. `you` is whoever is holding the phone — the tickets are
 *  opened by him, so the card's own goal is in that voice too. */
export type Voice = 'you' | 'worker' | 'verifier' | 'triage' | 'supervisor';

export const VOICE_KEY: Record<Voice, Key> = {
  you: 'voiceYou', worker: 'voiceWorker', verifier: 'voiceVerifier',
  triage: 'voiceTriage', supervisor: 'voiceSupervisor',
};

export interface Msg {
  id: string;
  ts: number;
  from: Voice;
  /** what the message says, in full unless it is a long report */
  text: string;
  /** the rest of a long report, kept behind a disclosure that starts closed */
  more?: string;
  /** the last message: where the ticket has got to, or what it is asking */
  tail?: boolean;
}

/** The queue writes `user` for a note typed by a person. Everything it does not
 *  name is the worker, which is where a report would come from. */
function voiceOf(from: string): Voice {
  const f = (from || '').trim().toLowerCase();
  if (f === 'user' || f === 'you') return 'you';
  if (f === 'verifier' || f === 'triage' || f === 'supervisor') return f;
  return 'worker';
}

/** Ends a fragment so it can be joined into a paragraph without running into
 *  the next one. Bullets are written without full stops; sentences are not. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?:;]$/.test(t) ? t : `${t}.`;
}

/** The lines of an escalation, as the points it is making.
 *
 *  Escalations are written as a bullet list, and a bullet that ran long wraps
 *  onto lines of its own — those belong to the bullet above them, not to a
 *  point nobody made. */
export function bullets(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line.replace(/^(?:[-*•‣]|\d+[.)])\s+/, '');
    if (stripped !== line || !out.length) out.push(stripped.trim());
    else out[out.length - 1] = `${out[out.length - 1]} ${line}`;
  }
  return out.filter(Boolean);
}

/** The first line of a message, for somewhere that has room for one line. */
function firstLine(text: string | null | undefined): string {
  return (text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

/** The last thing the queue wrote about a ticket, as a line about the ticket.
 *
 *  Events are logged for a log: a note is recorded as `[user] …` with the whole
 *  note copied in after it. Said out loud at the end of a conversation that
 *  already has the note in it, that is the screen reading somebody their own
 *  message back — so an event about a note is not news, and the tag in front of
 *  the others is filing, not language. */
function eventLine(ev: { kind: string; msg: string } | null | undefined): string {
  if (!ev || ev.kind === 'note') return '';
  return firstLine(ev.msg).replace(/^\[[a-z]+\]\s*/i, '');
}

/** What a stopped ticket is asking, as one paragraph addressed to the person
 *  who can answer it.
 *
 *  The escalation is a list of what the worker could not decide for itself. A
 *  list is a form to fill in; the same points run together and pointed at
 *  somebody are a question, and a question is answerable in a sentence. */
export function question(t: Ticket, T: Translate): string {
  const failed = t.status === 'failed';
  const items = bullets(t.escalation);
  if (!items.length) return T(failed ? 'askSilentFailed' : 'askSilentStopped');
  const body = items.map(sentence).join(' ');
  const lead = T(failed ? 'askFailed' : 'askStopped');
  // A body that already ends on a question mark has asked for itself; a second
  // question after it is the screen talking over the worker.
  const close = /\?$/.test(body) ? '' : ` ${T(failed ? 'askCloseFailed' : 'askCloseStopped')}`;
  return `${lead} ${body}${close}`;
}

/** Where a ticket that is not asking anything has got to: one line. */
export function stateLine(t: Ticket, T: Translate): string {
  const ev = eventLine(t.last_event);
  switch (t.status) {
    case 'running': return ev ? T('stateRunning', { ev }) : T('stateRunningBare', { stage: t.stage, round: t.round });
    case 'queued': return ev ? T('stateQueued', { ev }) : T('stateQueuedBare');
    case 'done': return ev ? T('stateDone', { ev }) : T('stateDoneBare');
    case 'cancelled': return ev ? T('stateCancelled', { ev }) : T('stateCancelledBare');
    default: return ev || T('stateNothing');
  }
}

/** The one line under the box, saying what sending will actually do. The three
 *  answers are the queue's own three answers to `note`. */
export function noteHint(status: TicketStatus | string): Key {
  if (answerable(status)) return 'noteHintStopped';
  if (status === 'done' || status === 'cancelled') return 'noteHintClosed';
  return 'noteHintWorking';
}

/** Nobody has picked a queued ticket up, and nobody is holding a cancelled one,
 *  so the line about where those two stand is the queue's own. */
function tailVoice(t: Ticket): Voice {
  return t.status === 'queued' || t.status === 'cancelled' ? 'supervisor' : 'worker';
}

/** How much of a report is a message, before the rest becomes a disclosure. A
 *  verifier writes thousands of characters; read as a bubble that is not a
 *  message, it is a wall, and the next thing under it is the question. */
const REPORT_CHARS = 420;

/** Cut a long report at the last break before the limit, so that what is left
 *  showing ends where a thought does. */
function clip(text: string): { text: string; more?: string } {
  if (text.length <= REPORT_CHARS) return { text };
  const head = text.slice(0, REPORT_CHARS);
  const at = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'), head.lastIndexOf('. '));
  const cut = at > REPORT_CHARS / 3 ? at + 1 : REPORT_CHARS;
  const rest = text.slice(cut).trim();
  if (!rest) return { text };
  return { text: text.slice(0, cut).trim(), more: rest };
}

/** The ticket as a run of messages, oldest first.
 *
 *  The opening is the card's own goal: it is what was asked for, and it was
 *  asked for by whoever opened the ticket. Then everything that was said back,
 *  in the order it was said. Last is where the ticket stands right now — the
 *  question, if it is stopped on one. */
export function conversation(t: Ticket, T: Translate): Msg[] {
  const out: Msg[] = [];

  const opening = (t.goal || '').trim() || (t.title || '').trim();
  if (opening) out.push({ id: `t${t.id}-goal`, ts: t.created_at, from: 'you', text: opening });

  const notes = [...(t.notes || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  notes.forEach((n, i) => {
    const body = (n.text || '').trim();
    if (!body) return;
    const from = voiceOf(n.from);
    // What a person typed is theirs and stays whole; a report is cut down to
    // its opening, with the rest a tap away.
    out.push({ id: `t${t.id}-n${i}`, ts: n.ts, from, ...(from === 'you' ? { text: body } : clip(body)) });
  });

  const last = out.length ? out[out.length - 1].ts : 0;
  out.push({
    id: `t${t.id}-now`,
    // Never behind the message above it: a clock that goes backwards in a
    // conversation reads as two conversations.
    ts: Math.max(t.updated_at || 0, t.last_event?.ts || 0, last),
    from: tailVoice(t),
    text: answerable(t.status) ? question(t, T) : stateLine(t, T),
    tail: true,
  });

  return out;
}

/** Whether the ticket has anything to put behind the details disclosure: the
 *  card's criteria and what the verifier made of them. Neither is part of the
 *  conversation — they are the paperwork behind it. */
export function hasDetails(t: Ticket): boolean {
  return (t.done_criteria?.length || 0) > 0 || !!t.verdict;
}

// ── the wall, grouped by project ─────────────────────────────────────────────
//
// Twenty cards in one list is a pile you have to read twice: the two tickets on
// the same repository are eight cards apart and look unrelated. Grouped, "what
// is happening in babysee" is answered by looking at one heading. The panel
// settled on this in ticket #13 (web/src/lib/ustabasi.ts); this is the same
// reading in the app's own words, so a change to one is a change owed to the
// other.
//
// There is no percentage here and there will not be one. Nothing in the queue
// knows how far along a ticket is — the criteria are answered once, at the end,
// by the verifier — so a bar would be a drawn guess. What can be counted is
// counted: how long it has been open, how long this round has been going, which
// step it is on, and what has landed on the branch.

/** The project a ticket is work on, by name. The daemon names it — a ticket in
 *  `babysee/app` is babysee — and the folder name is the fallback for a
 *  repository its path policy has nothing to say about. Never the path: this
 *  screen is a screenshot away from being public. */
export function projectName(t: Ticket): string {
  return (t.project || '').trim() || repoName(t.repo) || 'unfiled';
}

export interface Group { project: string; tickets: Ticket[] }

/** One group per project, the one holding a ticket that is waiting on a person
 *  first. A project with nothing in it is not a group — the grouping comes out
 *  of the tickets, so there is nothing to leave out. */
export function groupByProject(tickets: Ticket[]): Group[] {
  const by = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const name = projectName(t);
    const list = by.get(name);
    if (list) list.push(t);
    else by.set(name, [t]);
  }
  return [...by.entries()]
    .map(([project, list]) => ({ project, tickets: sortTickets(list) }))
    .sort((a, b) => {
      // The group's rank is its best ticket's: one red card pulls the whole
      // project to the front, which is the only order that matters at 3am.
      const r = (RANK[a.tickets[0].status] ?? 9) - (RANK[b.tickets[0].status] ?? 9);
      if (r !== 0) return r;
      const moved = b.tickets[0].updated_at - a.tickets[0].updated_at;
      return moved !== 0 ? moved : a.project.localeCompare(b.project);
    });
}

/** A ticket nobody is going to touch again. `failed` is not one of these: it is
 *  stopped waiting for a person, which is the most open a ticket gets. */
const CLOSED = ['done', 'cancelled'];

function closedAt(t: Ticket): number | null {
  return CLOSED.includes(t.status) && t.finished_at ? t.finished_at : null;
}

/** How long this has been a ticket — the figure anybody means by "how long has
 *  it been going". Once it is finished, how long it took. First on the card and
 *  on its own, because the smaller figure under it was being read as this one. */
export function totalAge(t: Ticket, now: number, T: Translate): string {
  const end = closedAt(t);
  return end ? T('ticketTook', { d: since(end - t.created_at, T) })
             : T('ticketOpen', { d: since(now - t.created_at, T) });
}

/** How long the current round has been going, which is the smaller figure and
 *  is drawn as the smaller one. Null where there is no round in progress: a
 *  finished ticket's last round does not go on getting longer, and a ticket
 *  still in the queue has not had one. */
export function roundAge(t: Ticket, now: number, T: Translate): string | null {
  if (closedAt(t) || !t.round_started_at) return null;
  return T('ticketThisRound', { d: since(now - t.round_started_at, T) });
}

/** What has landed on the branch. Nothing committed yet, or no worktree to look
 *  in, and the card says nothing rather than N/A. */
export function commitCount(t: Ticket, T: Translate): string | null {
  const n = t.git?.commits;
  if (!n) return null;
  return n === 1 ? T('ticketOneCommit') : T('ticketCommits', { n });
}

/** The line under the title: what last happened here, in words.
 *
 *  Usually the newest event — "merged into main (4dd999f)", "all accounts
 *  limited, queue paused until 17:05". Not a `start`, though. That one reads
 *  `worker round 1 pid 74155 model claude-opus-5 account yakup`, which is the
 *  queue talking to its own log, and a pid on a card is something to look past.
 *  With nothing worth repeating, the card says what the ticket is for instead. */
export function cardLine(t: Ticket): string {
  const ev = t.last_event;
  const said = ev && ev.kind !== 'start' && ev.kind !== 'note'
    ? (ev.msg || '').split('\n').map((l) => l.trim()).find(Boolean)?.replace(/^\[[a-z]+\]\s*/i, '') || ''
    : '';
  return tilde(said || (t.goal || '').split('\n').map((l) => l.trim()).find(Boolean) || '');
}

// ── the steps a ticket has been through ──────────────────────────────────────

/** How a step is marked on the checklist. `now` is the one being worked on,
 *  which is the whole question a glance at this page is asking. */
export type StepMark = 'done' | 'crossed' | 'now' | 'stopped';

export function stepMark(s: TicketStep): StepMark {
  if (s.ended_at == null && s.outcome == null) return 'now';
  switch (s.outcome) {
    case 'ok': return 'done';
    case 'rejected': case 'failed': case 'cancelled': return 'crossed';
    default: return 'stopped';
  }
}

/** The step the ticket is on right now, or null where nobody is holding it. */
export function currentStep(t: Ticket): TicketStep | null {
  const last = (t.steps || [])[(t.steps || []).length - 1];
  return last && stepMark(last) === 'now' ? last : null;
}

/** Every step's own heading: whose hands, and which round. */
export function stepLine(s: TicketStep, T: Translate): string {
  return T('ticketRound', { stage: s.stage, round: s.round });
}

/** A step that has been going for a while, or has been and gone. `now` is a
 *  clock in seconds; a step still running is timed against it. */
export function stepAge(s: TicketStep, now: number, T: Translate): string {
  const end = s.ended_at ?? now;
  return since(Math.max(0, end - s.at), T);
}

/** When the run the chat page is reading began.
 *
 *  The log records what the agent printed and not when — the file is a stream
 *  of blocks, and the queue writes the clock beside it in the events table
 *  instead. What that gives is one honest fact: everything in the log happened
 *  after the step that started it. Which is enough to put the log in the
 *  sequence, because the sequence is a conversation and the log is its last
 *  turn. */
export function runStartedAt(t: Ticket): number | null {
  const steps = t.steps || [];
  return steps.length ? steps[steps.length - 1].at : null;
}

/** The conversation, split where the run begins: what was said before it, and
 *  what has been said since. The log goes between the two, which is where it
 *  happened.
 *
 *  A ticket that has never run puts everything before, so the page reads
 *  exactly as it did before there was a log to read. */
export function around(msgs: Msg[], at: number | null): { before: Msg[]; after: Msg[] } {
  if (at == null) return { before: msgs, after: [] };
  const before: Msg[] = [];
  const after: Msg[] = [];
  // The last message is where the ticket stands now, whatever its clock says:
  // it is written from the ticket's own state, not from a moment.
  for (const m of msgs) (m.ts < at && !m.tail ? before : after).push(m);
  return { before, after };
}
