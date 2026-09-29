// One product's board, decided away from the screen that draws it. No React, no
// store, no palette — `scripts/test-board.cjs` holds the screen to every
// judgement in here without a phone.
//
// The Overview answers "how is this product". The board answers the other
// question: **where is each piece of work, and what is actually happening to
// it.** Those are two facts and not one, and the whole screen turns on keeping
// them apart:
//
//   * **the column is intent.** Ice Box, Queued, In Progress, Done is where a
//     person put a card. Nothing else moves it — not a worker picking it up, not
//     a verifier passing it, not a run that fell over at four in the morning
//     (`daemon/remote_ai_chat/divan.py`, which mirrors a status onto a card and
//     never touches its column).
//   * **the status is reality**, and it is the small mark on the card: running,
//     asking, stuck, failed, passed review. A card that failed overnight is
//     still exactly where it was, with a red mark and how long it has been like
//     that — which is the only way a board can be read at seven in the morning
//     without reading it twice.
//
// Two more things come out of there being several computers:
//
//   * **a card says which machine it runs on**, and only where that is a
//     question: one machine and the badge is noise (Mobile8 S7's own rule). When
//     that machine goes quiet the badge turns amber and says when it was last
//     heard from, because the mark beside it is then a memory.
//   * **the card itself stays quiet.** The state lives in a 11 pt mono chip and
//     nowhere else: no red card, no amber wash, no ring. Five cards in a column
//     each shouting their own colour is a column nobody can read, and the frames
//     draw every one of them on the same surface.
//
// And one thing about Done. That column grows for ever, and the phone is given
// the open board rather than the archive: the daemon leaves finished cards out
// of its snapshot altogether, and the count beside the column is what says how
// many there are. So what arrives here is normally nothing, and what this file
// guarantees is the other half — a finished card that *does* arrive is drawn
// only while it is recent, and the column says how many it is not holding.
import { COLUMNS, column, stuck, waiting, type DivanView, type MergedCard,
         type MergedProject } from './divan';
import { executorKey, type Ago, type Said } from './dashboard';
import { executorFace } from './waiting';
import type { Key } from './i18n';
import type { DivanColumn } from './protocol';
import { STATE_MARK, type Tone } from './tokens';

const DAY = 24 * 3600;

/** What each column is called, left to right (Mobile2 V5, Mobile8 S7). */
export const COLUMN_LABEL: Record<DivanColumn, Key> = {
  ice_box: 'bdIceBox', queued: 'bdQueued', in_progress: 'bdInProgress', done: 'bdDone',
};

/** Which column a board opens on. In Progress in both frames, and it is the
 *  right one: a board is opened to see what is happening, not to browse a
 *  someday list. */
export const OPENS_ON: DivanColumn = 'in_progress';

/** How far back the Done column reaches. A month, which is the window the web
 *  board's own column head counts in ("this month 12", Web12 W2).
 *
 *  It is a rule about what is *drawn*, not about what is true: everything
 *  finished is in the count on the tab, and the column says so under it. What it
 *  refuses is a phone scrolling through work finished last March. */
export const DONE_WINDOW_S = 30 * DAY;

/** One of the four tabs: the column, its name and how many cards are in it.
 *
 *  The count is the board's own — `counts` is what the machine counted, all of
 *  Done included — and never the length of the list under it. The two differ on
 *  Done by design and can differ on any column for a moment after a card moves;
 *  a tab that reads `0` over three cards is the one thing worse than a number
 *  that is a little behind, which is why the drawn cards raise it. */
export function tabs(p: MergedProject, now: number): { key: DivanColumn; label: Key; count: number }[] {
  return COLUMNS.map((col) => ({
    key: col,
    label: COLUMN_LABEL[col],
    count: Math.max(p.counts[col] || 0, cards(p, col, now).length),
  }));
}

/** When a card was finished: the moment somebody moved it into Done, and
 *  otherwise the last time anything was written to it. A card nobody has ever
 *  stamped has no such moment and is not recent — that is the only reading that
 *  cannot put an undated card from 2024 at the top of a column. */
function finishedAt(c: MergedCard): number | null {
  return c.moved_at || c.updated_at || null;
}

/** The cards of one column, in the order they are read in.
 *
 *  Position for the three open columns, which is a person's own arrangement and
 *  is priority in Queued (`divan.ts column`). Done is the exception twice over:
 *  it is the newest first, because the only question about finished work is what
 *  was finished last, and it reaches back one month and no further. */
export function cards(p: MergedProject, col: DivanColumn, now: number): MergedCard[] {
  const list = column(p, col);
  if (col !== 'done') return list;
  return list
    .filter((c) => { const at = finishedAt(c); return at != null && now - at <= DONE_WINDOW_S; })
    .sort((a, b) => (finishedAt(b) ?? 0) - (finishedAt(a) ?? 0));
}

/** The grey line under a column that has something to say about itself: an
 *  empty column, and what Done is not holding.
 *
 *  Null for the ordinary case, which is a column with cards in it. The three
 *  sentences it can be are the three states a column can be in that a list of
 *  cards does not show by itself, and none of them claims anything about the
 *  cards that are not here: "finished longer ago than a month" is a thing this
 *  phone cannot know, and what it says instead is which month it holds. */
export function foot(p: MergedProject, col: DivanColumn, now: number): Said | null {
  const drawn = cards(p, col, now).length;
  if (col !== 'done') return drawn === 0 ? { key: 'bdNothing' } : null;
  const all = Math.max(p.counts.done || 0, drawn);
  if (all === 0) return { key: 'bdNothing' };
  if (drawn === 0) return { key: 'bdDoneNone', params: { n: all } };
  return all > drawn ? { key: 'bdDoneNote', params: { n: all } } : null;
}

// ── what the mark on a card says ────────────────────────────────────────────

/** The one character in the board's vocabulary that the design system's five
 *  states do not carry: a run that was turned down rather than one that stopped
 *  and is waiting (Mobile8 S7 draws `■` and `×` side by side, both red, and they
 *  are not the same news). */
export const MARK_FAILED = '×';

/** The mono chip in the corner of a card: what the agent on it is actually
 *  doing. The character carries the state as well as the colour, the way every
 *  mark in this design does. */
export interface Mark {
  mark: string;
  key: Key;
  params?: Record<string, string | number>;
  tone: Tone;
}

/** …and which one a card gets (Mobile2 V5, Mobile8 S7).
 *
 *  Five of these are the frames' own set: running, asking, stuck, failed and
 *  passed review. Two more are states the queue has and the frames never drew —
 *  a card that was cancelled, and a card that is a person's own — and they take
 *  the quietest thing in the vocabulary rather than a colour of their own.
 *
 *  Null where there is nothing to say: a card nobody has picked up yet, and a
 *  ticket waiting its turn in a queue. The column it is in already says that,
 *  and a chip reading "queued" inside the Queued column is furniture.
 *
 *  S7 draws a sixth, `◐ Under review` — a second agent checking the work — and
 *  it is deliberately not here. Reviewing is a stage of a run and a card carries
 *  a status; nothing on the wire says a verifier is reading, and a grey chip
 *  guessed off `running` would be the one mark on the board that is not a fact. */
export function mark(card: MergedCard, now: number, ago: Ago): Mark | null {
  // A card a person owns, waiting for the person: nothing runs on it, and the
  // rule for "waiting" is the merge's own rather than a second spelling of it.
  if (card.executor === 'human') {
    return waiting(card) ? { mark: STATE_MARK.yours, key: 'bdYours', tone: 'ink2' } : null;
  }
  const d = card.agent_status_at == null ? null : ago(Math.max(0, now - card.agent_status_at));
  const since = (key: Key, bare: Key, tone: Tone, glyph: string): Mark =>
    (d ? { mark: glyph, key, params: { d }, tone } : { mark: glyph, key: bare, tone });
  switch (card.agent_status) {
    case 'asking': return { mark: STATE_MARK.asking, key: 'bdAsking', tone: 'amber' };
    case 'blocked': return since('bdStuck', 'bdStuckBare', 'red', STATE_MARK.stuck);
    case 'failed': return since('bdFailed', 'bdFailedBare', 'red', MARK_FAILED);
    case 'running': return since('bdRunning', 'bdRunningBare', 'run', STATE_MARK.running);
    case 'verified': return { mark: STATE_MARK.done, key: 'bdReviewed', tone: 'run' };
    case 'cancelled': return { mark: STATE_MARK.quiet, key: 'bdCancelled', tone: 'ink3' };
    default: return null;
  }
}

/** The marks of a column, counted — the mono line above the cards (V5's
 *  `? 1 asking · ■ 1 stuck · ● 2 running`, S7's tighter `? 1 · ■ 1 · × 1`).
 *
 *  Worst first, and only the states that are actually in the column: a legend
 *  listing every state a card could be in would be a legend rather than a
 *  reading of this column. */
export function tally(list: MergedCard[], now: number, ago: Ago): { mark: string; n: number; tone: Tone }[] {
  const order = [STATE_MARK.asking, STATE_MARK.stuck, MARK_FAILED, STATE_MARK.running,
                 STATE_MARK.done, STATE_MARK.yours, STATE_MARK.quiet];
  const seen = new Map<string, { mark: string; n: number; tone: Tone }>();
  for (const card of list) {
    const m = mark(card, now, ago);
    if (!m) continue;
    const had = seen.get(m.mark);
    if (had) had.n += 1;
    else seen.set(m.mark, { mark: m.mark, n: 1, tone: m.tone });
  }
  return [...seen.values()].sort((a, b) => order.indexOf(a.mark) - order.indexOf(b.mark));
}

/** …and which machines the column's work is spread over, at the far end of the
 *  same line (S7's `studio 3 · cloud 2 · mini 1`). Empty on a product that lives
 *  on one computer, where naming it on every line would be saying nothing. */
export function spread(p: MergedProject, list: MergedCard[]): { name: string; n: number }[] {
  if (p.machines.length < 2) return [];
  const seen = new Map<string, number>();
  for (const c of list) if (c.machine) seen.set(c.machine, (seen.get(c.machine) || 0) + 1);
  return [...seen.entries()].map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

// ── a card ──────────────────────────────────────────────────────────────────

/** One card on the board, as everything the screen draws about it. */
export interface Item {
  card: MergedCard;
  /** Which face the executor wears (`components/divan` `ExecutorBadge`), and its
   *  name — the same two the Waiting screen reads off a card, so a Coder is a
   *  Coder on every screen in the app. */
  face: string;
  who: Key;
  /** What the agent on it is doing, where anything is. */
  mark: Mark | null;
  /** The computer it runs on, where the product is on more than one. `seen` is
   *  when that computer last answered, and is only there when it has gone quiet:
   *  the mark above is then the last thing it said. */
  machine: { name: string; seen: number | null } | null;
  /** Nothing runs on this one — it is a person's. Drawn as the frames draw it,
   *  with no surface and a dashed outline, and it never carries a machine. */
  mine: boolean;
  /** The card's own two or three sentences, as somebody wrote them. Empty where
   *  nobody did, and the card is then its title alone. */
  summary: string;
  /** The run behind it, where this phone can open one: a ticket on the computer
   *  it holds a socket to. Null otherwise, and the card is then not a press —
   *  another machine's ticket number would open this machine's queue. */
  ticket: number | null;
}

/** The cards of one column, ready to draw. */
export function items(view: DivanView, p: MergedProject, col: DivanColumn,
                      ago: Ago, activeHost: string | null | undefined): Item[] {
  const seenAt = new Map(view.hosts.map((h) => [h.id, h.at]));
  const several = p.machines.length > 1;
  return cards(p, col, view.now).map((card) => ({
    card,
    face: executorFace(card),
    who: executorKey(card.executor),
    mark: mark(card, view.now, ago),
    machine: several && card.executor !== 'human'
      ? { name: card.machine, seen: card.stale ? seenAt.get(card.host) ?? null : null }
      : null,
    mine: card.executor === 'human',
    summary: (card.summary || '').trim(),
    ticket: card.ustabasi_id != null && card.host === activeHost ? card.ustabasi_id : null,
  }));
}

// ── the switch between the two faces of a product's page ────────────────────

/** Which of the product's pages is open. The frames put three tabs over it —
 *  Overview, Board, Chats — and the chats a product owns are not filed yet, so
 *  there are two (Mobile2 V4). */
export type Face = 'overview' | 'board';

export const FACES: Face[] = ['overview', 'board'];

export const FACE_LABEL: Record<Face, Key> = { overview: 'overview', board: 'bdBoard' };

/** One of the two tabs, as the segmented control draws it. */
export function faces(p: MergedProject): { key: Face; label: Key; mark: string; tone: Tone | null }[] {
  const worst = boardMark(p);
  return FACES.map((face) => ({
    key: face,
    label: FACE_LABEL[face],
    mark: face === 'board' && worst ? worst.mark : '',
    tone: face === 'board' && worst ? worst.tone : null,
  }));
}

/** The mark on the Board tab: the worst thing on the board, in one character
 *  (Mobile2 V4 draws a red `■` there over a product with something stuck).
 *
 *  Null where nothing on the board needs saying, which is most products most of
 *  the time — a tab wearing a grey dot on every ordinary morning is a tab with a
 *  dot on it rather than a warning. */
export function boardMark(p: MergedProject): { mark: string; tone: Tone } | null {
  const of = (test: (c: MergedCard) => boolean) => p.cards.some(test);
  if (of(stuck)) return { mark: STATE_MARK.stuck, tone: 'red' };
  if (of((c) => c.agent_status === 'asking')) return { mark: STATE_MARK.asking, tone: 'amber' };
  if (of(waiting)) return { mark: STATE_MARK.yours, tone: 'amber' };
  if (of((c) => c.agent_status === 'running')) return { mark: STATE_MARK.running, tone: 'run' };
  return null;
}
