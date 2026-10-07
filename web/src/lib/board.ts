/** What a product's board says, kept out of the screen that draws it.
 *
 *  Web12 W2 and Web13 W4 are the board on the desktop — four columns abreast,
 *  a ticket in each one carrying who is on it and what that worker last did,
 *  and the question one of them stopped to ask open beside it. The two frames
 *  are the same board in the two themes and differ in nothing else.
 *
 *  Three rules it is written under, and they are the Dashboard's own:
 *
 *   · **the open board is what a merged view carries.** The daemon leaves
 *     `done` out of `snapshot.cards` — that column grows for ever — and sends
 *     the number instead. So every column says how much of itself it is not
 *     carrying, the way the frame's own columns do (`+ 45 more`): on Done that
 *     is all of it, and on the other three it is normally nothing.
 *   · **nothing on a ticket is composed here.** The words under a name are the
 *     design's (`EXECUTORS`), the mark is the state the mirror wrote, and a
 *     card with nothing to say carries no mark rather than an invented one.
 *     There is no progress figure anywhere in the protocol, so the frame's
 *     `Running 3/5` is drawn as `Running` and a fraction nobody measured is not
 *     drawn at all.
 *   · **a card that has been moved stays moved.** A drop is answered by the
 *     machine that holds the board, and the board is re-read on a slow timer;
 *     between the two the card is where the cursor put it, which is what
 *     `moved` is. The daemon's own rule, in its words: a card that springs back
 *     under a thumb is worse than one carrying a line saying why nothing
 *     started.
 *
 *  Held without a browser by `scripts/test-board.mjs`.
 */
import type { DivanColumn } from './protocol';
import type { MergedCard, MergedProject } from './divan';
import { stuck, waiting } from './divan';
import { executorWord, type Ago } from './overview';
import { executorFace, idOf } from './sessions';
import { EXECUTORS, STATE_TONE, type State, type Tone } from './theme';
import { short } from './compose';
import { day } from './project';

/** Where a card has been put but the machine has not said so yet, by card id. */
export type Moves = Record<string, DivanColumn>;

// ── the mark in a ticket's corner ───────────────────────────────────────────

/** What a ticket says about itself at the top right: `? Asking you`, `■ Stuck
 *  1h 12m`, `● Running`. */
export interface CardMark { state: State; label: string; tone: Tone }

/** Which tone that mark takes. A state's own (`STATE_TONE`), with the one
 *  exception Web12 W2 is explicit about: a card waiting on *you* is quiet on
 *  the board — `○ Waiting on you` in `ink2`, no wash — where in a summary line
 *  it is amber. A column of amber cards would say four things are asking when
 *  one is. */
const QUIET_ON_A_CARD: Partial<Record<State, Tone>> = { yours: 'ink2' };

const faced = (state: State, label: string): CardMark => (
  { state, label, tone: QUIET_ON_A_CARD[state] ?? STATE_TONE[state] });

export function cardMark(card: MergedCard, now: number, ago: Ago): CardMark | null {
  const at = card.agent_status_at;
  const since = at == null ? '' : ` ${ago(Math.max(0, now - at))}`;
  if (card.column === 'done') return faced('done', 'Done');
  if (stuck(card)) {
    return faced('stuck', `${card.agent_status === 'failed' ? 'Failed' : 'Stuck'}${since}`);
  }
  if (card.agent_status === 'asking') return faced('asking', 'Asking you');
  if (card.agent_status === 'running') return faced('running', `Running${since}`);
  if (card.agent_status === 'verified') return faced('done', 'Passed review');
  if (card.agent_status === 'cancelled') return faced('quiet', 'Cancelled');
  // Dragged into In Progress, and the queue has been told to take it next —
  // but there are only so many slots, so it is still waiting. Without this the
  // card says nothing at all, which is what made dragging one read as a drag
  // that did nothing.
  if (card.column === 'in_progress' && card.ustabasi_id != null
      && (card.agent_status ?? 'queued') === 'queued') {
    return faced('quiet', 'Next up');
  }
  // A person's own card, which is the fourth state the board's summary line
  // counts. Queued is the fifth and carries no mark: the frame's Queued column
  // is four plain cards.
  if (waiting(card)) return faced('yours', 'Waiting on you');
  return null;
}

// ── one ticket ──────────────────────────────────────────────────────────────

/** A card as the board draws it. */
export interface Ticket {
  card: MergedCard;
  /** The square, and the two lines beside it. */
  face: string;
  who: string;
  kind: string;
  mark: CardMark | null;
  /** It needs a person before anything else happens to it — the daemon's own
   *  rule — so pressing it opens that conversation. */
  waiting: boolean;
  /** Nothing runs on it: Web12 W2 draws it as an outline rather than a
   *  surface. */
  hollow: boolean;
  /** The window this card is, where the reader asks for it. */
  session: string;
  /** The `dv-status` word: what is actually happening to it. */
  status: Status | null;
  /** The one sentence under the title, where there is one worth a line: what
   *  the agent asked, or why it stopped. Empty otherwise. */
  line: string;
  /** The mono corner: machine · how long, or the day it was finished. */
  meta: string;
}

// ── the status word ─────────────────────────────────────────────────────────

/** The `dv-status` modifier a word is drawn with (HANDOVER §3). */
export type StatusKind = 'run' | 'ask' | 'stuck' | 'review' | 'idle' | 'done';

export interface Status { kind: StatusKind; word: string }

/** What is actually happening to a card, in one word, and only what the board
 *  knows: no fraction is drawn after `testing`, because nothing on the wire
 *  counts a verifier's checks. A card in Ice Box carries none. */
export function status(card: MergedCard): Status | null {
  if (card.column === 'done') {
    if (card.agent_status === 'cancelled') return { kind: 'idle', word: 'cancelled' };
    return { kind: 'done', word: 'done' };
  }
  if (card.agent_status === 'failed') return { kind: 'stuck', word: 'failed' };
  if (card.agent_status === 'blocked') return { kind: 'stuck', word: 'stuck' };
  if (card.agent_status === 'asking') return { kind: 'ask', word: 'asking' };
  if (card.column === 'review') return { kind: 'review', word: 'testing' };
  if (card.agent_status === 'running') return { kind: 'run', word: 'running' };
  if (card.agent_status === 'verified') return { kind: 'done', word: 'passed' };
  if (card.agent_status === 'cancelled') return { kind: 'idle', word: 'cancelled' };
  if (card.column === 'in_progress' && card.executor === 'human') return { kind: 'idle', word: 'yours' };
  if (card.column === 'in_progress') return { kind: 'idle', word: 'next up' };
  if (card.column === 'queued') return { kind: 'idle', word: 'waiting' };
  return null;
}

export function ticket(card: MergedCard, now: number, ago: Ago): Ticket {
  const face = executorFace(card);
  const known = EXECUTORS[face];
  const branch = (card.branch || '').trim();
  const st = status(card);
  const stamp = card.agent_status_at ?? card.moved_at ?? null;
  return {
    card,
    face,
    // A branch agent is named by its branch — that is what it is — and falls
    // back to the word for the kind where the card carries no branch.
    who: card.executor === 'branch_agent' && branch ? branch : executorWord(card.executor),
    kind: card.executor === 'branch_agent' && !known && branch
      ? `branch agent · ${branch}`
      : (known ?? EXECUTORS.unassigned).kind,
    mark: cardMark(card, now, ago),
    waiting: waiting(card),
    hollow: card.executor === 'human',
    session: idOf(card),
    status: st,
    line: st && (st.kind === 'ask' || st.kind === 'stuck') ? (card.agent_detail || '').trim() : '',
    meta: card.column === 'done'
      ? day(card.moved_at ?? card.updated_at)
      : card.column === 'ice_box' || card.column === 'queued'
        ? [card.column === 'queued' ? executorWord(card.executor) : '', card.created_at ? short(now - card.created_at) : '']
          .filter(Boolean).join(' · ')
        : [card.machine || card.hostName, stamp != null ? short(now - stamp) : ''].filter(Boolean).join(' · '),
  };
}

// ── the four columns ────────────────────────────────────────────────────────

/** The four columns a person sees (HANDOVER §4.3), with the aside each head
 *  carries. Review is the queue's own word for a ticket a second agent is
 *  checking; to a person that card is still In Progress, and its status says
 *  `testing` — the column is the intent and the status is what is true. */
export const BOARD: { key: DivanColumn; label: string; sub: string }[] = [
  { key: 'ice_box', label: 'Ice Box', sub: 'someday' },
  { key: 'queued', label: 'Queued', sub: 'top = next' },
  { key: 'in_progress', label: 'In Progress', sub: 'drop here = start' },
  { key: 'done', label: 'Done', sub: 'this month' },
];

/** The column a card is drawn in: review folds into In Progress. */
export const shown = (column: DivanColumn): DivanColumn => (column === 'review' ? 'in_progress' : column);

/** How many finished cards Done draws before `Show N more`. */
export const DONE_SHOWN = 3;

export interface BoardColumn {
  key: DivanColumn;
  label: string;
  /** The cards in it, in the order somebody put them in; Done newest first. */
  tickets: Ticket[];
  /** How many there are. Done is this month's cards, which is all of Done a
   *  machine sends (`DONE_WINDOW_S`): the number is never a total of work
   *  finished last March sitting over a list of this month's. The other three
   *  are the machines' own counts, which a machine sends whole. */
  count: number;
  sub: string;
  /** Work is happening in it. */
  live: boolean;
  /** Cards a machine counted and did not send: `+ 3 more`. Empty normally. */
  more: string;
}

export function columns(p: MergedProject, now: number, ago: Ago, moved: Moves = {}): BoardColumn[] {
  const at = (c: MergedCard) => shown(moved[c.id] ?? c.column);
  return BOARD.map(({ key, label, sub }) => {
    const cards = p.cards.filter((c) => at(c) === key)
      .sort((a, b) => key === 'done'
        ? ((b.moved_at ?? 0) - (a.moved_at ?? 0)) || a.title.localeCompare(b.title)
        // Review after the cards still being written, each in its own order.
        : (a.column === 'review' ? 1 : 0) - (b.column === 'review' ? 1 : 0)
          || a.position - b.position || a.title.localeCompare(b.title));
    const said = key === 'done' ? 0
      : (p.counts[key] ?? 0) + (key === 'in_progress' ? p.counts.review ?? 0 : 0);
    const hidden = Math.max(0, said - p.cards.filter((c) => shown(c.column) === key).length);
    return {
      key,
      label,
      tickets: cards.map((c) => ticket(c, now, ago)),
      count: cards.length + hidden,
      sub,
      live: cards.some((c) => c.agent_status === 'running'),
      more: hidden ? `+ ${hidden} more` : '',
    };
  });
}

/** The four numbers of the project page's board summary, off the same columns
 *  the board draws — one reading of the board, not two. */
export function counts(p: MergedProject, now: number, ago: Ago): { key: DivanColumn; label: string; n: number; sub: string }[] {
  const subs: Partial<Record<DivanColumn, string>> = { queued: 'next up', in_progress: 'agents working' };
  return columns(p, now, ago).map((c) => ({ key: c.key, label: c.label, n: c.count, sub: subs[c.key] ?? c.sub }));
}

/** `In progress now`: the In Progress column's cards with their real status,
 *  worst first, at most five. */
export const NOW_MAX = 5;

export function inProgress(p: MergedProject, now: number, ago: Ago): Ticket[] {
  const rank = (t: Ticket) => ({ stuck: 0, ask: 1, review: 2, run: 3 } as Record<string, number>)[t.status?.kind ?? ''] ?? 4;
  return columns(p, now, ago)[2].tickets
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .slice(0, NOW_MAX)
    .map((x) => x.t);
}

/** Whether this column would take the card in the air. Its own will not: the
 *  daemon reads a move into the column a card is already in as no move at all,
 *  so an outline offering one would be an affordance that cannot land. */
export function takes(column: DivanColumn, from: DivanColumn | null): boolean {
  return from != null && from !== column;
}

/** The moves still waiting on a machine, with the ones it has agreed to — or
 *  has lost the card of — dropped. Kept as a function so that the screen holds
 *  one rule about when an overlay stops being true rather than two. */
export function settled(moved: Moves, cards: MergedCard[]): Moves {
  const out: Moves = {};
  for (const [id, column] of Object.entries(moved)) {
    const card = cards.find((c) => c.id === id);
    if (card && card.column !== column) out[id] = column;
  }
  return out;
}
