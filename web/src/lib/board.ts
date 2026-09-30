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
import { COLUMN_LABEL, executorWord, type Ago } from './overview';
import { executorFace, idOf } from './sessions';
import { EXECUTORS, STATE_TONE, type State, type Tone } from './theme';

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
}

export function ticket(card: MergedCard, now: number, ago: Ago): Ticket {
  const face = executorFace(card);
  const known = EXECUTORS[face];
  const branch = (card.branch || '').trim();
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
  };
}

// ── the four columns ────────────────────────────────────────────────────────

/** The mono aside at the far end of a column head. Two of the four are what
 *  the column *is* and are the frame's own words; the other two are counted,
 *  and a column with nothing to count says nothing. Web12 W2 writes `this
 *  month 12` over Done, and that is what the daemon sends of it: the cards
 *  finished in the last month, newest first. */
const SUB: Partial<Record<DivanColumn, string>> = { ice_box: 'someday', queued: 'next up' };

export interface BoardColumn {
  key: DivanColumn;
  label: string;
  /** The cards in it, in the order somebody put them in. */
  tickets: Ticket[];
  /** How many are in the column altogether, finished ones included. */
  count: number;
  sub: string;
  /** Work is happening in it. */
  live: boolean;
  /** What the count says is there and this page does not carry: `+ 45 more`,
   *  which on Done is the whole of it. Empty where the column is whole. */
  more: string;
}

export function columns(p: MergedProject, now: number, ago: Ago, moved: Moves = {}): BoardColumn[] {
  const at = (c: MergedCard) => moved[c.id] ?? c.column;
  return COLUMN_LABEL.map(({ key, label }) => {
    const cards = p.cards.filter((c) => at(c) === key)
      .sort((a, b) => key === 'done'
        ? ((b.moved_at ?? 0) - (a.moved_at ?? 0)) || a.title.localeCompare(b.title)
        : a.position - b.position || a.title.localeCompare(b.title));
    // What the machines say is in the column, against what they actually sent
    // of it — measured against where each card *was*, not where a cursor has
    // just put it, so that a card in the air does not leave a phantom behind
    // it. On Done that gap is the whole column and on the other three it is
    // normally nothing, which is one rule rather than a rule and an exception.
    const hidden = Math.max(0,
      (p.counts[key] ?? 0) - p.cards.filter((c) => c.column === key).length);
    const running = cards.filter((c) => c.agent_status === 'running').length;
    return {
      key,
      label,
      tickets: cards.map((c) => ticket(c, now, ago)),
      count: cards.length + hidden,
      sub: SUB[key] ?? (key === 'done'
        ? (cards.length ? `this month ${cards.length}` : '')
        : running ? `${running} working` : ''),
      live: running > 0,
      more: hidden ? `+ ${hidden} more` : '',
    };
  });
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
