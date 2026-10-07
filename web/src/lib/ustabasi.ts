/** A ticket: as a card on the wall, and as a conversation when it is opened.
 *
 *  The queue keeps a ticket as a card, a pile of notes, a report and a verdict
 *  — four shapes, each with its own heading. Read under those headings it is a
 *  status report, and a status report is a thing you file, not a thing you
 *  answer. But everything in it happened in an order and was said by somebody:
 *  the card is the sentence that opened the ticket, the notes are what people
 *  said back, the report is where the worker got to. Laid out that way it is a
 *  conversation with a question at the end of it, which is what it always was.
 *
 *  Nothing here draws anything. It turns one ticket into the list of messages
 *  the panel shows, so that the order, the voices and the wording of the
 *  question can be checked without a browser. The wall's own arithmetic — which
 *  project a ticket belongs under, what order the columns and the cards come in,
 *  and what a card says about where it has got to — is at the bottom of this file, and is
 *  checkable the same way.
 */

import { uptime } from './format';

export type Status = 'queued' | 'running' | 'done' | 'blocked' | 'failed' | 'cancelled';

export interface Criterion { criterion: string; status: string; detail?: string }
export interface Verdict { verdict?: string; findings?: Criterion[] }
export interface Note { ts: number; from: string; text: string }
export interface Event { ts: number; kind: string; msg: string }

export interface Ticket {
  id: number;
  title: string;
  status: Status;
  stage: string;
  round: number;
  repo: string;
  /** the project this is work on, by name: a ticket in quire/app is quire */
  project: string | null;
  branch: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  /** when the round it is in began, which the queue's tickets table does not hold */
  round_started_at: number | null;
  finished_at: number | null;
  /** what the worker has committed on the branch; null when there is nothing to say */
  git: { commits: number; subject: string } | null;
  goal: string;
  done_criteria: string[];
  /** The command that proves the criteria. Empty where the ticket has none. */
  verify_cmd?: string;
  escalation: string;
  /** The question in plain words, when the queue kept it apart from the
   *  escalation; the escalation is then the technical record behind it. Empty
   *  (or absent, from an older daemon) means the escalation is the question. */
  ask?: string;
  verdict: Verdict | null;
  notes: Note[];
  note_count: number;
  last_event: Event | null;
  /** Every run of every stage this ticket has been through, oldest first: what
   *  the queue's own events add up to (`daemon/remote_ai_chat/ustabasi.py`).
   *  What a ticket *is* on a board is this — the steps, ticking off. */
  steps?: {
    stage: string; round: number; at: number; ended_at?: number | null;
    outcome?: string | null; model?: string | null; account?: string | null;
  }[];
}

/** Who said a thing. `you` is whoever is holding the panel — the tickets are
 *  opened from here, so the card's own goal is in that voice too. */
export type Voice = 'you' | 'worker' | 'verifier' | 'triage' | 'supervisor';

export const VOICE: Record<Voice, string> = {
  you: 'You',
  worker: 'Worker',
  verifier: 'Verifier',
  triage: 'Triage',
  supervisor: 'Supervisor',
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

/** A ticket the queue re-opens the moment a note lands. Anything else takes
 *  the note too, but takes it at the next stage boundary. */
export function answerable(s: Status): boolean {
  return s === 'blocked' || s === 'failed';
}

/** The one line under the box, saying what sending will actually do. The three
 *  answers are the queue's own three answers to `note`. */
export function noteHint(s: Status): string {
  if (answerable(s)) return 'This goes back in the queue with your answer, straight away.';
  if (s === 'done' || s === 'cancelled') return 'This ticket is closed — the note is kept on it.';
  return 'It is working; the note is picked up at the next stage boundary.';
}

/** The queue writes `user` for a note typed by a person. Everything it does not
 *  name is the worker, which is where a report would come from. */
export function voiceOf(from: string): Voice {
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
export function bullets(text: string): string[] {
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
function firstLine(text: string): string {
  return (text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

/** The last thing the queue wrote about a ticket, as a line about the ticket.
 *
 *  Events are logged for a log: a note is recorded as `[user] …` and the whole
 *  note copied in after it. Said out loud at the end of a conversation that
 *  already has the note in it, that is the panel reading somebody their own
 *  message back — so an event about a note is not news, and the tag in front
 *  of the others is filing, not language. */
function eventLine(ev: Event | null): string {
  if (!ev || ev.kind === 'note') return '';
  return firstLine(ev.msg).replace(/^\[[a-z]+\]\s*/i, '');
}

/** What a stopped ticket is asking, as one paragraph addressed to the person
 *  who can answer it.
 *
 *  The escalation is a list of what the worker could not decide for itself.
 *  A list is a form to fill in; the same points run together and pointed at
 *  somebody are a question, and a question is answerable in a sentence. */
export function question(t: Ticket): string {
  // Written for a person already: said as it was written.
  if ((t.ask || '').trim()) return (t.ask || '').trim();
  const failed = t.status === 'failed';
  const items = bullets(t.escalation);
  if (!items.length) {
    return failed
      ? 'This one fell over and it left nothing behind saying why. Do you want me to run it again?'
      : 'I have stopped and I am waiting on you, but I left no note saying what for. Can you tell me how to carry on?';
  }
  const body = items.map(sentence).join(' ');
  const lead = failed
    ? 'This one fell over and I could not get myself past it.'
    : 'I stopped here, because there is something I need from you.';
  const close = /\?$/.test(body) ? ''
    : failed ? ' What do you want me to do with it?'
    : ' Can you sort that out, or tell me another way round it?';
  return `${lead} ${body}${close}`;
}

/** Where a ticket that is not asking anything has got to: one line. */
export function stateLine(t: Ticket): string {
  const ev = eventLine(t.last_event);
  switch (t.status) {
    case 'running':
      return ev ? `Still on it — ${ev}` : `Still on it: ${t.stage}, round ${t.round}.`;
    case 'queued':
      return ev ? `Waiting for a free slot — ${ev}` : 'Waiting for a free slot. Nothing has started yet.';
    case 'done':
      return ev ? `Finished — ${ev}` : 'Finished.';
    case 'cancelled':
      return ev ? `Cancelled — ${ev}` : 'Cancelled.';
    default:
      return ev || 'Nothing has happened here yet.';
  }
}

/** Nobody has picked a queued ticket up, and nobody is holding a cancelled
 *  one, so the line about where those two stand is the queue's own. */
function tailVoice(t: Ticket): Voice {
  return t.status === 'queued' || t.status === 'cancelled' ? 'supervisor' : 'worker';
}

/** How much of a report is a message, before the rest becomes a disclosure.
 *  A verifier writes thousands of characters; read as a bubble that is not a
 *  message, it is a wall, and the next thing under it is the question. */
const REPORT_CHARS = 420;

/** Cut a long report at the last break before the limit, so that what is left
 *  showing ends where a thought does. */
function clip(text: string): { text: string; more?: string } {
  if (text.length <= REPORT_CHARS) return { text };
  const head = text.slice(0, REPORT_CHARS);
  const at = Math.max(
    head.lastIndexOf('\n\n'),
    head.lastIndexOf('\n'),
    head.lastIndexOf('. '),
  );
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
 *  question, if it is stopped on one.
 */
export function conversation(t: Ticket): Msg[] {
  const out: Msg[] = [];

  const opening = (t.goal || '').trim() || (t.title || '').trim();
  if (opening) out.push({ id: `t${t.id}-goal`, ts: t.created_at, from: 'you', text: opening });

  const notes = [...(t.notes || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  notes.forEach((n, i) => {
    const body = (n.text || '').trim();
    if (!body) return;
    const from = voiceOf(n.from);
    // What a person typed is theirs and stays whole; a report is cut down to
    // its opening, with the rest a click away.
    out.push({ id: `t${t.id}-n${i}`, ts: n.ts, from, ...(from === 'you' ? { text: body } : clip(body)) });
  });

  const last = out.length ? out[out.length - 1].ts : 0;
  out.push({
    id: `t${t.id}-now`,
    // Never behind the message above it: a clock that goes backwards in a
    // conversation reads as two conversations.
    ts: Math.max(t.updated_at || 0, t.last_event?.ts || 0, last),
    from: tailVoice(t),
    text: answerable(t.status) ? question(t) : stateLine(t),
    tail: true,
  });

  return out;
}

/** Whether the ticket has anything to put behind the details disclosure: the
 *  card's criteria and what the verifier made of them. Neither is part of the
 *  conversation — they are the paperwork behind it. */
/** When the run that is being watched began.
 *
 *  The phone reads it off the ticket's last step (`app/src/tickets.ts`); the
 *  wall's tickets carry the round's own clock instead, which is the same
 *  moment said another way — a round is a run. Null on a ticket that has never
 *  been picked up, which is what puts the whole conversation before the log.
 */
export function runStartedAt(t: Ticket): number | null {
  return t.round_started_at ?? t.started_at ?? null;
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

export function hasDetails(t: Ticket): boolean {
  return (t.done_criteria?.length || 0) > 0 || !!t.verdict;
}

// ── the wall ────────────────────────────────────────────────────────────────

/** There is no percentage here and there will not be one. Nothing in the queue
 *  knows how far along a ticket is — the criteria are answered once, at the end,
 *  by the verifier — so a bar would be a drawn guess. What can be counted is
 *  counted: how long it has been open, how long this round has been going, whose
 *  hands it is in, and what has landed on the branch. */

/** Red first, then whatever is moving, then the rest. An id order would put the
 *  ticket that has been waiting since last night below three that are merrily
 *  working, which is exactly backwards. */
const RANK: Record<string, number> = {
  blocked: 0, failed: 1, running: 2, queued: 3, done: 4, cancelled: 5,
};

export function rank(status: string): number {
  return RANK[status] ?? 9;
}

/** A ticket nobody is going to touch again. `failed` is not one of these: it is
 *  stopped waiting for a person, which is the most open a ticket gets. */
const CLOSED = ['done', 'cancelled'];

function closedAt(t: Ticket): number | null {
  return CLOSED.includes(t.status) && t.finished_at ? t.finished_at : null;
}

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    return r !== 0 ? r : b.updated_at - a.updated_at;
  });
}

/** The project a ticket is work on. The daemon names it — `quire/app` is
 *  quire — and the folder name is the fallback for a repository its path
 *  policy has nothing to say about. */
export function projectName(t: Ticket): string {
  const named = (t.project || '').trim();
  if (named) return named;
  const parts = (t.repo || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unfiled';
}

export interface Group { project: string; tickets: Ticket[] }

/** One column per project, the reddest column first.
 *
 *  Twenty cards in one grid is a wall you have to read twice: the two tickets on
 *  the same repository are three columns apart and look unrelated. Grouped, the
 *  question "what is happening in Quire" is answered by looking at one column.
 *  A project with nothing in it is not a column — the grouping comes out of the
 *  tickets, so there is nothing to leave out.
 */
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
      // The column's rank is its best ticket's: one red card pulls the whole
      // project to the front, which is the only sort order that matters at 3am.
      const r = rank(a.tickets[0].status) - rank(b.tickets[0].status);
      if (r !== 0) return r;
      const moved = b.tickets[0].updated_at - a.tickets[0].updated_at;
      return moved !== 0 ? moved : a.project.localeCompare(b.project);
    });
}

/** "12s", "49m", "15h 18m", "2d 3h" — the same shape the rest of the panel uses
 *  for an age, with seconds only while there is nothing else to say. */
function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : uptime(s);
}

/** How long this has been a ticket — the figure a person means by "how long has
 *  it been running". Once it is finished, how long it took. */
export function totalAge(t: Ticket, now: number): string {
  const end = closedAt(t);
  return end
    ? `took ${span(end - t.created_at)}`
    : `open ${span(now - t.created_at)}`;
}

/** How long the current round has been going, which is the smaller figure and
 *  is drawn as the smaller figure. Null where there is no round in progress: a
 *  finished ticket's last round does not go on getting longer, and a ticket
 *  still in the queue has not had one. */
export function roundAge(t: Ticket, now: number): string | null {
  if (closedAt(t) || !t.round_started_at) return null;
  return `${span(now - t.round_started_at)} in this round`;
}

/** Whose hands it is in, and for the how-many-th time. */
export function stageLine(t: Ticket): string {
  return `${t.stage} r${t.round}`;
}

/** What has landed on the branch. Nothing committed yet, or no worktree to
 *  look in, and the card says nothing rather than N/A. */
export function commitCount(t: Ticket): string | null {
  const n = t.git?.commits;
  if (!n) return null;
  return `${n} ${n === 1 ? 'commit' : 'commits'}`;
}

/** The line under the title: what last happened here, in words.
 *
 *  Usually the newest event — "merged into main (4dd999f)", "all accounts
 *  limited, queue paused until 17:05". Not a `start`, though. That one reads
 *  `worker round 1 pid 74155 model claude-opus-5 account main`, which is the
 *  queue talking to its own log: the card says whose hands the ticket is in and
 *  which round by itself, and a pid on a card is something to look past. With
 *  nothing worth repeating, the card says what the ticket is for instead. */
export function cardLine(t: Ticket): string {
  const ev = t.last_event;
  const said = ev && ev.kind !== 'start'
    ? firstLine(ev.msg).replace(/^\[[a-z]+\]\s*/i, '')
    : '';
  return said || firstLine(t.goal || '');
}
