/** A ticket, read as a conversation.
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
 *  question can be checked without a browser.
 */

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
  branch: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  goal: string;
  done_criteria: string[];
  escalation: string;
  verdict: Verdict | null;
  notes: Note[];
  note_count: number;
  last_event: Event | null;
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
export function hasDetails(t: Ticket): boolean {
  return (t.done_criteria?.length || 0) > 0 || !!t.verdict;
}
