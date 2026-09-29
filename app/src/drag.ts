// Carrying a card from one column to another, decided away from the thumb that
// does it. No React, no store, no palette — `scripts/test-drag.cjs` drives the
// whole gesture through this file without a phone.
//
// This is the one place in the app where a person changes what a computer is
// doing by moving something with a finger, and it is the riskiest thing in the
// Divan plan for a reason: a drag that lands wrong starts an autonomous agent on
// the wrong piece of work, and a drag that is cancelled and half-applied leaves
// a board saying something that is not true. So the gesture is written as a
// machine whose every step is a value: an event goes in, a new state and a list
// of things to do come out, and nothing in here touches a card on a computer.
//
// Mobile3 D1-D4 are the whole specification, and they are four states of
// this machine:
//
//   * **D1 · held.** 350 ms of stillness on a card lifts it. A light tick, and
//     the column tabs pick up dashed outlines: they are where it can go, and
//     they are the only drop targets a phone has room for.
//   * **D2 · over a tab.** The tab under the thumb turns green. The card's own
//     place in the column it came from is left as an empty slot, so the board
//     still says where it is from.
//   * **D3 · the column opened.** After 300 ms on a tab the list under it
//     switches to that column, and sliding up and down picks the card's place in
//     it — which on this board is its priority.
//   * **D4 · released.** A firmer tick, and the card says what just happened to
//     it for five seconds before it calms down into an ordinary card.
//
// Three rules the machine is built on, each of which is a thing that would
// otherwise go wrong:
//
//   * **nothing happens until the finger comes up.** Hovering over In Progress
//     for a second and sliding off again starts nothing. The only step that asks
//     a computer for anything is the release, and it asks for exactly one thing.
//   * **a release that has nowhere to land is not a move.** Off the tabs, back
//     where it came from, on the column it is already in at the place it is
//     already at: no request, no haptic, nothing said. A board that redraws
//     itself after a cancelled drag is a board that cannot be trusted to have
//     left the other drags alone.
//   * **what the drop starts is the daemon's rule, read here too.** In Progress,
//     on the coding executor, not already filed — `divan.py wants_ustabasi`. The
//     screen has to know before the finger comes up, because that is what the
//     tab going green and the words "release to start" are promising.
import { COLUMN_LABEL } from './board';
import type { Said } from './dashboard';
import type { MergedCard } from './divan';
import type { Key } from './i18n';
import type { DivanColumn } from './protocol';
import type { Tone } from './tokens';

/** How long a card has to be held before it lifts (Mobile3 D1).
 *
 *  350 ms rather than the 500 a `Pressable` takes by default: this is a board
 *  being arranged one-handed and half a second per card is a screen that feels
 *  stuck. Short enough to be quick, long enough that a scroll begun on a card is
 *  a scroll. */
export const HOLD_MS = 350;

/** …and how long the thumb has to rest on a tab before the list under it
 *  switches to that column (D3). Long enough that dragging across Queued on the
 *  way to Done does not flash two columns on the way. */
export const OPEN_MS = 300;

/** How long the card that just landed says so before it calms down (D4). */
export const SETTLE_MS = 5000;

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** A tab, and where on the glass it is. The screen measures these; nothing in
 *  here knows how wide a tab is. */
export interface Target { key: DivanColumn; rect: Rect }

/** The card in the air.
 *
 *  Everything the float under the thumb draws, plus the two facts the drop turns
 *  on: which computer it has to be asked of, and whether this card is in the
 *  shape that starts a worker. */
export interface Carried {
  card: string;
  host: string;
  /** Where it came from, so that a release back into it is not a move and the
   *  empty slot is drawn in the right column. */
  from: DivanColumn;
  position: number;
  title: string;
  /** Which face the executor wears, and its name (`src/board.ts Item`). */
  face: string;
  who: Key;
  /** It would start a worker if it landed in In Progress: the coding executor,
   *  nothing filed on it yet. The same three clauses as `divan.py
   *  wants_ustabasi`, because this is the promise the green tab makes. */
  startable: boolean;
}

/** …read off a card on the board.
 *
 *  Every card can be picked up, including one on a machine that has gone quiet.
 *  A poll that failed a minute ago is not the same thing as a computer that is
 *  off, the Waiting screen already offers that card's buttons on the same
 *  reasoning, and the move either arrives or says why it did not. */
export function carry(card: MergedCard, face: string, who: Key): Carried {
  return {
    card: card.id, host: card.host, from: card.column, position: card.position,
    title: card.title, face, who,
    startable: card.executor === 'coding_agent' && card.ustabasi_id == null,
  };
}

/** Would releasing here start a worker? In Progress, and a card in the shape for
 *  it. Everything else is a move: a card the branch agent has, a card that is
 *  yours, a card filed on an earlier drag and dragged back. */
export function starts(c: Carried, column: DivanColumn | null): boolean {
  return c.startable && column === 'in_progress';
}

/** A card in the air, and where it is. */
export interface Drag {
  carried: Carried;
  /** Where the thumb is, for the float to follow. */
  at: Point;
  /** …and where it was when the card lifted, which is what says whether the card
   *  has actually left its place yet (`airborne`). */
  from: Point;
  /** The tab under it, if any. Null is an honest state and the common one: most
   *  of a drag is spent between the card and the tabs. */
  over: DivanColumn | null;
  /** When the thumb arrived on that tab, so that `OPEN_MS` can be measured
   *  without a timer of the screen's own. Null while it is over nothing. */
  since: number | null;
  /** Which column the list is showing. It starts as the one the board was open
   *  on and changes when the thumb rests on a tab (D3). */
  open: DivanColumn;
  /** Where in the open column the card would land, once the list has caught up
   *  with the thumb. Null until the two are the same column: an index into a
   *  list of other cards is meaningless against a list nobody can see. */
  slot: number | null;
}

/** What the screen has to do about a step. Every one of them is something with a
 *  side: a buzz, an address to change, a computer to ask. */
export type Effect =
  /** The three weights the frames call for: a light tick on the lift, a small
   *  one each time the card crosses onto a tab, a firmer one on the drop. The
   *  middle one is the only thing here the frames do not draw, and it is what
   *  makes the gesture possible one-handed — a thumb on a 46 pt tab is covering
   *  the thing that went green. */
  | { do: 'haptic'; weight: 'light' | 'tick' | 'firm' }
  /** Switch the list under the tabs to this column (D3). */
  | { do: 'open'; column: DivanColumn }
  /** …and the only one that asks a computer for anything. `position` is null for
   *  the bottom of the column, which is where a card dropped before the list
   *  caught up goes. The whole of what was carried comes with it: by the time
   *  this is acted on the list under the tabs may be the column the card has
   *  just left, where the card itself is no longer drawn. */
  | { do: 'move'; carried: Carried; column: DivanColumn;
      position: number | null; starts: boolean };

export type Event =
  /** 350 ms of stillness: the card is in the air. */
  | { do: 'lift'; carried: Carried; open: DivanColumn; at: Point }
  /** The thumb moved. `column` and `slot` are read off the geometry by the
   *  screen (`columnAt`, `slotAt`) rather than passed in as pixels, because
   *  where a tab is is the one thing this file cannot know. */
  | { do: 'over'; at: Point; column: DivanColumn | null; slot: number | null; now: number }
  /** Nothing moved, but time passed. The list opening after 300 ms is a fact
   *  about a still thumb, so it cannot only be decided on movement. */
  | { do: 'tick'; now: number }
  /** The finger came up. */
  | { do: 'drop' }
  /** …or the gesture was taken away: a call arrived, the app went behind, the
   *  scroll won the touch. Same outcome as a drop with nowhere to land, and it
   *  is the same code path on purpose. */
  | { do: 'cancel' };

/** One step of the gesture: what is being carried now, and what to do about it.
 *
 *  `null` in and `null` out is an ordinary thing to ask — a `tick` from a timer
 *  that outlived its drag, a `cancel` for a gesture already ended — and answers
 *  with nothing rather than throwing, because the alternative is a screen
 *  guarding every call. */
export function step(drag: Drag | null, e: Event): { drag: Drag | null; effects: Effect[] } {
  if (e.do === 'lift') {
    return {
      drag: { carried: e.carried, at: e.at, from: e.at, over: null, since: null, open: e.open,
              slot: null },
      effects: [{ do: 'haptic', weight: 'light' }],
    };
  }
  if (drag == null) return { drag: null, effects: [] };
  switch (e.do) {
    case 'over': {
      const crossed = e.column !== drag.over;
      const next: Drag = {
        ...drag, at: e.at, over: e.column,
        since: crossed ? (e.column == null ? null : e.now) : drag.since,
        // The slot is only an answer while the list under the thumb is the
        // column it would land in.
        slot: e.column != null && e.column === drag.open ? e.slot : null,
      };
      const effects: Effect[] = crossed && e.column != null
        ? [{ do: 'haptic', weight: 'tick' }] : [];
      return settle(next, e.now, effects);
    }
    case 'tick':
      return settle(drag, e.now, []);
    case 'drop': {
      const to = landing(drag);
      if (to == null) return { drag: null, effects: [] };
      return {
        drag: null,
        effects: [
          { do: 'haptic', weight: 'firm' },
          { do: 'move', carried: drag.carried, column: to.column,
            position: to.position, starts: starts(drag.carried, to.column) },
        ],
      };
    }
    case 'cancel':
      return { drag: null, effects: [] };
  }
}

/** The list catching up with the thumb: 300 ms on a tab that is not the open
 *  column opens it (D3). The clock is restarted rather than cleared, so resting
 *  on In Progress and then sliding to Done opens Done 300 ms later and not
 *  immediately. */
function settle(drag: Drag, now: number, effects: Effect[]): { drag: Drag; effects: Effect[] } {
  if (drag.over == null || drag.over === drag.open) return { drag, effects };
  if (drag.since == null || now - drag.since < OPEN_MS) return { drag, effects };
  return {
    drag: { ...drag, open: drag.over, since: now, slot: null },
    effects: [...effects, { do: 'open', column: drag.over }],
  };
}

/** Where a release lands, and null where it lands nowhere.
 *
 *  Three ways to land nowhere, and they are one answer: the thumb is not on a
 *  tab at all; it is on the tab the card came from and no place in it was
 *  picked; it is on that tab at the place the card already occupies. In all
 *  three the board is already correct, and the honest thing is to ask nothing
 *  and say nothing. */
export function landing(drag: Drag): { column: DivanColumn; position: number | null } | null {
  const { over, slot, carried } = drag;
  if (over == null) return null;
  if (over !== carried.from) return { column: over, position: slot };
  if (slot == null || slot === carried.position) return null;
  return { column: over, position: slot };
}

/** How far the thumb has to travel before the card is out of its place: the
 *  difference between Mobile3's D1 and D2. Under it the card is drawn lifted
 *  where it lies and the column is untouched; over it the card follows the thumb
 *  and leaves an empty slot behind. A few points, because a thumb held still on
 *  a phone is never quite still. */
export const LEAVES_AT = 8;

/** …and whether this card has. */
export function airborne(drag: Drag): boolean {
  return Math.abs(drag.at.x - drag.from.x) > LEAVES_AT
    || Math.abs(drag.at.y - drag.from.y) > LEAVES_AT;
}

// ── where the thumb is ──────────────────────────────────────────────────────

/** Which tab the thumb is over, out of the four the screen measured. Null
 *  outside every one of them, which is most of the glass and is what makes a
 *  drop into the middle of the page a cancelled drag rather than a guess at the
 *  nearest column. */
export function columnAt(p: Point, targets: Target[]): DivanColumn | null {
  for (const t of targets) {
    if (p.x >= t.rect.x && p.x <= t.rect.x + t.rect.w
        && p.y >= t.rect.y && p.y <= t.rect.y + t.rect.h) return t.key;
  }
  return null;
}

/** …and where in the open column it would sit: the index the card would take
 *  among the others, counted by which of them the thumb is past the middle of.
 *
 *  `rows` are the cards of the open column **without the one in the air**, in
 *  the order they are drawn, each with where it is on the glass. So the answer
 *  is between `0` and `rows.length`, and inserting at index `i` among `n` others
 *  is exactly the position the daemon's `move` takes.
 *
 *  On a product that lives on two computers it is an index into the *drawn*
 *  column, which is two machines' queues interleaved (`divan.ts column`), and it
 *  is sent to the one machine the card is on. There is no global order to be
 *  exact about — each daemon numbers its own board — so the honest reading is
 *  "this far down the list you are looking at", and a machine that has fewer
 *  cards than that clamps it to its own bottom. */
export function slotAt(y: number, rows: Rect[]): number {
  let n = 0;
  for (const r of rows) if (y > r.y + r.h / 2) n += 1;
  return n;
}

// ── what the board says while a card is in the air ───────────────────────────

/** The mono line above the cards, which the frames put exactly where the
 *  column's own tally sits: while a card is in the air it says what the gesture
 *  will do instead of what the column holds (D1–D3).
 *
 *  Its three sentences are the gesture's three states, and the last one is the
 *  one that matters: it names the position the card is about to take, and says
 *  "to start" only where the release actually starts a worker. `col` is a
 *  column's name and is translated by the screen, the way every other
 *  executor-or-column word in this app is.
 *
 *  `others` is how many cards the open column holds apart from the one in the
 *  air, so the column it is read against is the one on screen and the counting
 *  is not done twice. */
export function hint(drag: Drag, others: number): { said: Said; col?: Key; tone: Tone } {
  if (drag.over == null) return { said: { key: 'dgHold' }, tone: 'ink3' };
  if (drag.over !== drag.open) {
    return { said: { key: 'dgOpen' }, col: COLUMN_LABEL[drag.over], tone: 'run' };
  }
  const to = landing(drag);
  if (to == null) return { said: { key: 'dgBack' }, tone: 'ink3' };
  return {
    said: { key: starts(drag.carried, to.column) ? 'dgStart' : 'dgDrop',
            params: { n: (to.position ?? others) + 1, of: others + 1 } },
    tone: 'run',
  };
}

// ── and what the card that landed says ──────────────────────────────────────

/** A card that has just been put down, for the five seconds it says so (D4).
 *
 *  It is kept by the screen rather than read off the board because it is not on
 *  the board: what a machine says about a card is its status, and "somebody
 *  moved me a moment ago" is a fact about this phone.
 *
 *  Two things can go wrong and they are not the same thing, which is why there
 *  are two flags. A computer that did not answer means nothing moved and the
 *  board is exactly as it was. A queue that would not take the ticket means the
 *  card *did* move and nothing started — the daemon moves first and files second
 *  on purpose, so that a card does not spring back under a thumb
 *  (`server.py h_divan_card_move`). */
export interface Landed {
  carried: Carried;
  column: DivanColumn;
  /** The computer took the move. */
  moved: boolean;
  /** …and a worker was asked for, and the queue took it. */
  started: boolean;
  /** …and why one of those did not happen. Empty where both did. */
  error: string;
}

/** What that card says, and whether it offers a way back.
 *
 *  The frame draws `Started · Coder` with an `Undo` beside it, and the Undo is
 *  deliberately not offered on the one card that started a worker: this daemon
 *  can file a ticket and cannot cancel one (`ustabasi.py`'s own first
 *  paragraph). Moving the card back to Queued would leave a worktree churning
 *  behind a board that says nothing is running, which is the worst thing this
 *  screen could do. So a started card says what it started, and the way to stop
 *  it is the ticket behind it; every other move — into Ice Box, into Done, a
 *  re-ordering, a start the queue declined — can be taken back and says so.
 *
 *  A move that never arrived is the fourth sentence, and it belongs above the
 *  cards rather than on one: the card it is about did not move, and on a board
 *  showing the column it was aimed at there is no card to put it on. */
export function foot(l: Landed): { said: Said; col?: Key; who?: Key; tone: Tone; undo: boolean } {
  if (!l.moved) return { said: { key: 'dgNoMove', params: { why: l.error } }, tone: 'amber', undo: false };
  if (l.error) return { said: { key: 'dgNoStart', params: { why: l.error } }, tone: 'amber', undo: true };
  if (l.started) return { said: { key: 'dgStarted' }, who: l.carried.who, tone: 'run', undo: false };
  return { said: { key: 'dgMoved' }, col: COLUMN_LABEL[l.column], tone: 'ink2', undo: true };
}

/** …and where a card that was taken back goes: exactly the column and the place
 *  it was lifted from. */
export function back(l: Landed): { card: string; host: string; column: DivanColumn; position: number } {
  return { card: l.carried.card, host: l.carried.host,
           column: l.carried.from, position: l.carried.position };
}
