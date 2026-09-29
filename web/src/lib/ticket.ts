/** A ticket's three faces, decided away from the screen that lays them out.
 *
 *  Web14 W8 draws all three at once, which is what the desktop is for: the human
 *  face in its fixed box, the agent brief open under it, and the live log with
 *  its one-line input down the right-hand side.
 *
 *  **The rule the whole file is written under is the daemon's** (`docs/PROTOCOL.md`,
 *  "A card has two faces"): the human face is `title` — one line — and `summary`,
 *  two or three sentences, and *text an agent produced never lands on it*. So
 *  `human()` reads those two fields and nothing else: not the goal, not the
 *  criteria, not what the mirror last wrote on the card. A summary nobody typed
 *  leaves the box empty and says so, because a box filled with the agent's goal
 *  is the one failure this page can have that nobody would notice — it reads
 *  perfectly well, and it is the wrong text.
 *
 *  The wire keeps the two apart as well: the board's cards carry the human face
 *  and the marks, and `divan.card.get` is the one answer that has both. What
 *  arrives from it is a `DivanCardFull`; everything below takes one.
 */
import type { AgentStatus, DivanAgentFace, DivanCardFull } from './protocol';
import type { MergedCard, MergedProject } from './divan';
import { clock, executorWord, type Ago } from './overview';
import { conversation, type Msg, type Ticket } from './ustabasi';
import { STATE_TONE, type State, type Tone } from './theme';

// ── 1 · the human face ──────────────────────────────────────────────────────

/** How long the summary is allowed to be. Web14 W8 counts `148 / 220` under the
 *  box and W9 counts `108/220` in the card being written: the same limit, in the
 *  two places a person meets it. */
export const SUMMARY_MAX = 220;

/** What a person wrote, and what the box under it says about itself. */
export interface Human {
  title: string;
  summary: string;
  /** `What to do · title + 3 sentences`, which is the frame's own label for the
   *  box — it says what belongs in it rather than what is in it. */
  label: string;
  /** `148 / 220`. */
  count: string;
  /** Nobody has written the two or three sentences yet. The box stays and says
   *  so: the agent's goal is not allowed to stand in for them. */
  bare: boolean;
}

export function human(card: { title: string; summary: string }): Human {
  const summary = (card.summary || '').trim();
  return {
    title: (card.title || '').trim(),
    summary,
    label: 'What to do · title + 3 sentences',
    count: `${summary.length} / ${SUMMARY_MAX}`,
    bare: !summary,
  };
}

// ── 2 · the agent face ──────────────────────────────────────────────────────

/** One criterion of the brief, with what the verifier made of it where that can
 *  be known. `met` is null where nothing has been said about this one — which is
 *  every criterion of a ticket nobody has verified yet, and all of them on a
 *  verdict that answers a different number of points than the card has. */
export interface Criterion {
  text: string;
  met: boolean | null;
}

/** The brief, in the four blocks Web14 W8 draws it in. */
export interface Brief {
  goal: string;
  criteria: Criterion[];
  /** `3/5`, and null where none of them is marked: a fraction of nothing is a
   *  number nobody counted. */
  passed: string | null;
  verify: string;
  constraints: string[];
  paths: string[];
  notes: string;
  /** How much of it there is, which is what the head says beside the word
   *  (`46 lines`). */
  lines: number;
  /** Nothing has ever been written on this face. A card that was a line in a
   *  conversation is the ordinary case, not an error. */
  empty: boolean;
}

/** The verifier answers the card's criteria in order and writes its own wording
 *  for each. Lined up by position the two agree **only while it answers every
 *  point** — a verdict that answers four of nine puts the fourth mark on the
 *  ninth criterion, and a red cross against the wrong sentence is worse than no
 *  cross at all: it is a wrong answer to the question the page exists to answer.
 *
 *  So a mark is read by position only where the two lists are the same length,
 *  and otherwise nothing is marked. (The phone matches the two on their text,
 *  `app/src/tickets.ts marks` — a better answer, and the one to reach for when
 *  this page grows a verdict of its own to show.) */
export function brief(card: DivanCardFull | null, ticket: Ticket | null): Brief {
  const a: Partial<DivanAgentFace> = card?.agent ?? {};
  const goal = (a.goal || '').trim();
  const list = (a.done_criteria || []).map((t) => (t || '').trim()).filter(Boolean);
  const verify = (a.verify_cmd || '').trim();
  const constraints = (a.constraints || []).filter(Boolean);
  const paths = (a.paths || []).filter(Boolean);
  const notes = (a.notes || '').trim();
  const findings = ticket?.verdict?.findings ?? [];
  const lined = findings.length > 0 && findings.length === list.length;
  const criteria = list.map((text, i) => ({
    text,
    met: lined ? findings[i].status === 'met' : null,
  }));
  const met = criteria.filter((c) => c.met).length;
  return {
    goal,
    criteria,
    passed: lined ? `${met}/${criteria.length}` : null,
    verify,
    constraints,
    paths,
    notes,
    lines: [goal, ...list, verify, ...constraints, ...paths, notes]
      .filter(Boolean).join('\n').split('\n').filter((l) => l.trim()).length,
    empty: !goal && !list.length && !verify && !constraints.length && !paths.length && !notes,
  };
}

// ── 3 · the live half ───────────────────────────────────────────────────────

/** One line of the log in the corner of Web14 W8: when, what, and in whose
 *  colour. */
export interface LiveLine {
  at: string;
  text: string;
  tone: Tone | null;
}

/** How many of them there is room for. The frame draws four and the box is a
 *  fixed height; the whole run is the wall's, and it is read there. */
export const LIVE_LINES = 4;

/** Which state a queue status is, so the log is coloured by the one table the
 *  rest of the panel is. */
const STATUS_STATE: Record<string, State> = {
  running: 'running', queued: 'quiet', blocked: 'asking', failed: 'stuck',
  done: 'done', cancelled: 'quiet',
};

/** The last few things said about this ticket, oldest of them first.
 *
 *  It is `conversation()`'s reading and not a second one: the ticket is the card
 *  that opened it, the notes that came back and where it has got to, and that is
 *  already the panel's answer to "what is happening on this ticket". What this
 *  adds is the two things a log in a corner needs — a clock on each line, and a
 *  colour: what a person said is amber (the frame's `you: "batch the commit"`),
 *  where the ticket stands now takes its status's own colour, and the rest is
 *  the reading grey. */
export function live(ticket: Ticket | null): LiveLine[] {
  if (!ticket) return [];
  const msgs = conversation(ticket);
  return msgs.slice(Math.max(0, msgs.length - LIVE_LINES)).map((m: Msg) => ({
    at: clock(m.ts),
    text: m.text,
    tone: m.from === 'you' ? ('amber' as Tone)
      : m.tail ? (STATE_TONE[STATUS_STATE[ticket.status] ?? 'quiet'] ?? null)
      : ('ink2' as Tone),
  }));
}

/** The head of that box: `Live`, and how long the thing in it has been going.
 *  A ticket nobody is holding says where it stands instead of a duration that
 *  would go on growing. */
export function liveHead(ticket: Ticket | null, now: number, ago: Ago):
  { state: State; note: string } {
  if (!ticket) return { state: 'quiet', note: 'no ticket' };
  const state = STATUS_STATE[ticket.status] ?? 'quiet';
  const since = ticket.round_started_at ?? ticket.started_at;
  return {
    state,
    note: ticket.status === 'running' && since != null
      ? `running ${ago(Math.max(0, now - since))}`
      : ticket.status,
  };
}

/** What the one-line box at the bottom is addressed to, and null where there is
 *  nothing to send to: a card with no ticket behind it has no worker listening,
 *  and a box that pretended otherwise would swallow an answer. */
export function sayTo(card: MergedCard): string | null {
  if (card.ustabasi_id == null) return null;
  return `Say one sentence to the ${executorWord(card.executor)}…`;
}

// ── 4 · the details beside it ───────────────────────────────────────────────

/** One row of the panel down the right of Web14 W8: what it is, and what it
 *  says. `mark` is a value set in mono — a machine's name, a clock. */
export interface Detail {
  label: string;
  value: string;
  note?: string;
}

/** Executor and machine, who created it, when, which branch, which repository.
 *  Every one of them is read off the card; a field the card has nothing for is
 *  left out rather than drawn as a dash — which is why this is a list and not a
 *  fixed six rows. */
export function details(card: MergedCard, project: MergedProject | null,
                        now: number, ago: Ago): Detail[] {
  const out: Detail[] = [];
  out.push({
    label: 'Executor',
    value: executorWord(card.executor),
    note: card.machine || undefined,
  });
  if (card.ustabasi_id != null) out.push({ label: 'Ticket', value: `#${card.ustabasi_id}` });
  out.push({ label: 'Created', value: stamp(card.created_at, now, ago) });
  if (card.updated_at) {
    out.push({ label: 'Updated', value: stamp(card.updated_at, now, ago) });
  }
  out.push({ label: 'Branch', value: card.branch || 'engineering' });
  if (card.repo) {
    out.push({ label: 'Repository', value: card.repo.split(/[/\\]/).filter(Boolean).pop() || '' });
  }
  if (project) out.push({ label: 'Product', value: project.name });
  return out;
}

/** A moment, as a person reads one: the clock for something today, the age for
 *  anything older. Empty for a moment nobody recorded. */
function stamp(at: number | null, now: number, ago: Ago): string {
  if (at == null || !at) return '';
  const since = Math.max(0, now - at);
  return since < 12 * 3600 ? clock(at) : `${ago(since)} ago`;
}

/** The mark in the corner of the page head: what the mirror says is happening to
 *  this card, in the words the board uses for it. Null where nothing is. */
export function nowMark(status: AgentStatus | null): { state: State; label: string } | null {
  if (!status) return null;
  const state = STATUS_STATE[status] ?? null;
  if (status === 'asking') return { state: 'asking', label: 'Asking you' };
  if (status === 'verified') return { state: 'done', label: 'Passed review' };
  if (!state) return null;
  return { state, label: status[0].toUpperCase() + status.slice(1) };
}
