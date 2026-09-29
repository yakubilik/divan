/** What needs a person, as the chat sessions the desktop opens by itself.
 *
 *  This is the whole difference between the two Dashboards. The phone has a
 *  screen for it — Mobile6 S3, a grouped list you go to — because a phone has
 *  one screen at a time and a list is how you hold four questions in it. The
 *  desktop does not: Web12 W1 has a board on the page *and* the question open
 *  over it, bottom right, in the agent's own words, with the answers it is
 *  proposing under the sentence. Nothing arrives as a notification, and nothing
 *  is a row you have to go and open: **a question that is waiting on you opens
 *  itself as a conversation**, a second one opens to the left of the first, and
 *  the ones you put away stay as tabs until they are answered.
 *
 *  So what is in here is the judgement behind that, and no drawing at all:
 *  which cards are sessions, what each says and who is asking, which answers a
 *  question offers *in its own words*, and how many windows a desktop opens
 *  before the rest become tabs. `scripts/test-overview.mjs` holds every one of
 *  them without a browser, and `scripts/test-drive.mjs` presses them in one.
 *
 *  The rules are the phone's own (`app/src/waiting.ts`), because the same
 *  question asked on the same machine must be the same question on both:
 *
 *   · **the set is the daemon's.** A session is a card `waiting()` says needs a
 *     person — the rule `divan.py _waiting` counts by — and nothing else.
 *   · **nothing is invented, least of all an answer.** The pills under a
 *     question are words quoted out of the question itself; a question that
 *     offers no such words gets the reply box and no buttons rather than a
 *     guessed pair.
 *   · **a card with no ticket behind it can be read and not answered.** The
 *     note goes to a queue; a board card that is not in one has nowhere to send
 *     it, and a composer that could not deliver is worse than none.
 */
import { create } from 'zustand';
import type { DivanExecutor } from './protocol';
import type { DivanView, MergedCard } from './divan';
import { stuck, waiting } from './divan';
import { executorWord } from './overview';
import type { State } from './theme';

/** The four kinds of answer a card can be waiting for, in the order they are
 *  read in: the questions somebody is held up by, the decisions nobody is held
 *  up by, what fell over, and — last, because they are the only ones that can
 *  wait — the cards that are yours. */
export type Kind = 'question' | 'decision' | 'stuck' | 'yours';

export const KINDS: Kind[] = ['question', 'decision', 'stuck', 'yours'];

/** Which state's colour and character each kind takes. */
export const KIND_STATE: Record<Kind, State> = {
  stuck: 'stuck', question: 'asking', decision: 'yours', yours: 'quiet',
};

/** Which of the four a card waiting on a person is.
 *
 *  `stuck` is an agent that fell over or was turned down — the only one where
 *  something has gone wrong. A stopped agent with a question is a **question**
 *  when a coding agent asked it, because that worker is standing still until it
 *  is answered, and a **decision** when anything else did. A card with a person
 *  on it is **yours**, and nothing is waiting on anybody but you.
 *
 *  Null for a card that is not waiting on anybody at all, which is how the list
 *  is filtered: one rule, in one place. */
export function kindOf(card: MergedCard): Kind | null {
  if (!waiting(card)) return null;
  if (stuck(card)) return 'stuck';
  if (card.agent_status === 'asking') return card.executor === 'coding_agent' ? 'question' : 'decision';
  return 'yours';
}

/** Which face the asker wears in the panel's head (`ExecutorBadge`). A branch
 *  agent is named by its branch — that is what it is — so a card on the SEO
 *  branch gets the SEO face where the design has one, and the pending square
 *  where it does not. */
export function executorFace(card: { executor: DivanExecutor | null; branch: string }): string {
  switch (card.executor) {
    case 'coding_agent': return 'coder';
    case 'assistant': return 'research';
    case 'human': return 'you';
    case 'branch_agent': return (card.branch || '').trim().toLowerCase();
    default: return 'unassigned';
  }
}

// ── the answers a question offers, in its own words ─────────────────────────

/** The openers that turn an alternative into a sentence nobody can split in
 *  half. "Keep our three attempts, or follow Stripe's schedule?" has two
 *  answers in it; "Should we keep our three attempts, or follow Stripe's?" has
 *  one answer and half of another, and a button reading `follow Stripe's` under
 *  a button reading `Should we keep our three attempts` is the panel putting
 *  words in somebody's mouth. */
const OPENER = /^(should|shall|do|does|did|can|could|would|will|is|are|was|were|must|may|might|have|has)\b/i;

/** The join. Written with the comma because that is how the alternative is
 *  written when it is one — and matched without it too, because it is not
 *  always. */
const OR = /,?\s+or\s+/i;

/** An answer longer than this is a paragraph, not a pill. */
const ANSWER_CHARS = 48;

/** A question this long has more in it than a choice between two things. */
const QUESTION_CHARS = 200;

/** The answers a question offers, quoted out of the question itself.
 *
 *  Web12 W1 draws three pills under the agent's sentence and a reply box under
 *  them, and answering with one of them is the point of the whole arrangement.
 *  Nothing in the queue carries a set of options, though — a stopped ticket
 *  carries a sentence — so the only honest place for the words on those pills is
 *  the sentence itself.
 *
 *  So: the last sentence, if it ends in a question mark, if it is one
 *  alternative and not an essay, and if it is not phrased in a way that makes
 *  the two halves unequal. Everything else is a question with no buttons on it,
 *  and there are a great many of those; this is deliberately the narrow case,
 *  because a wrong button sends a wrong answer to a worker that will act on it. */
export function answers(question: string): string[] {
  const text = (question || '').replace(/\s+/g, ' ').trim();
  if (!text.endsWith('?')) return [];
  // The last sentence only: the lines before it are the worker explaining
  // itself, and the choice is the thing it ends on.
  const last = text.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? '';
  const body = last.replace(/\?+$/, '').trim();
  if (!body || body.length > QUESTION_CHARS || OPENER.test(body)) return [];
  const parts = body.split(OR);
  if (parts.length !== 2) return [];
  const two = parts.map((p) => p.trim().replace(/[,;]+$/, ''));
  if (two.some((p) => p.length < 2 || p.length > ANSWER_CHARS)) return [];
  return two.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

// ── a session ───────────────────────────────────────────────────────────────

/** One thing waiting on a person, as the conversation it is drawn as. */
export interface Session {
  /** Stable across polls and unique across machines: the same question on two
   *  computers is two questions. */
  id: string;
  card: MergedCard;
  kind: Kind;
  /** The square in the panel's head. */
  face: string;
  /** Who is asking, in one word. */
  who: string;
  /** …and what they are doing, in the frame's own words: `asks you`, `your
   *  call`, `stopped`. */
  says: string;
  /** The product this is work on, and its place in the list — which is the hue
   *  its monogram takes, so one product is one colour across the page. -1 for a
   *  card whose product is not in the list, which cannot happen and must not
   *  throw. */
  project: string;
  projectKey: string;
  index: number;
  /** The computer it came off. Never the path — the machine's own name, which
   *  is the one the answer goes back to. */
  machine: string;
  host: string;
  /** That machine has gone quiet: what is on this card is the last thing it
   *  said, and an answer to it is a request to a computer that is not
   *  answering. */
  stale: boolean;
  /** What it says, in the words it was said in. A stopped agent that said
   *  nothing leaves the card's own title standing for it — never an invented
   *  sentence, and never an empty panel. */
  said: string;
  /** `said` is a question rather than a report. */
  asked: boolean;
  /** The answers the question offers in its own words. Empty for everything
   *  that is not a question with a choice in it — which is most of them. */
  answers: string[];
  /** The queue this card is a ticket in, where it is one. Null for a board card
   *  with no ticket behind it: it can be read and not answered. */
  ticket: number | null;
  /** When it started waiting, and how long ago that is. */
  at: number | null;
  age: number | null;
}

/** When this card started waiting. A card nothing runs on has no agent status
 *  to be stamped, and `moved_at` is the honest answer for it: it has been
 *  waiting since somebody put it In Progress. */
export function stamp(card: MergedCard): number | null {
  return card.agent_status_at ?? card.moved_at ?? null;
}

/** A session's id, from the card it is drawn out of. One spelling, because the
 *  board raises a window by it: a card pressed there and the window it opens
 *  have to be the same thing. */
export const idOf = (card: { host: string; id: string }): string => `${card.host}:${card.id}`;

/** Everything waiting on a person, across every paired computer, worst first.
 *
 *  Within a kind the oldest comes first — the thing that has been waiting since
 *  last night is the thing to deal with — and a card nothing ever stamped sorts
 *  last, because not knowing when is not the same as just now. The title breaks
 *  the remaining ties so that the windows do not swap places under a cursor. */
export function sessions(view: DivanView): Session[] {
  const at = new Map(view.projects.map((p, i) => [p.key, i]));
  const out: Session[] = [];
  for (const card of view.cards) {
    const kind = kindOf(card);
    if (!kind) continue;
    const index = at.has(card.projectKey) ? at.get(card.projectKey)! : -1;
    const said = (card.agent_detail || '').trim() || card.title;
    const when = stamp(card);
    out.push({
      id: idOf(card),
      card,
      kind,
      face: executorFace(card),
      who: kind === 'yours' ? 'Divan' : executorWord(card.executor),
      says: kind === 'stuck' ? 'stopped' : kind === 'yours' ? 'your call' : 'asks you',
      project: view.projects[index]?.name ?? card.branch,
      projectKey: card.projectKey,
      index,
      machine: card.machine,
      host: card.host,
      stale: card.stale,
      said,
      asked: said.trim().endsWith('?'),
      // A card that is yours carries a title and no question: there is nobody
      // on the other end of an answer to it.
      answers: kind === 'yours' ? [] : answers(said),
      ticket: card.ustabasi_id,
      at: when,
      age: when == null ? null : Math.max(0, view.now - when),
    });
  }
  return out.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || (b.age ?? -1) - (a.age ?? -1)
    || a.card.title.localeCompare(b.card.title));
}

/** The mono line under the head: which product, which card, and — where the
 *  question was stamped — when it was asked. Web12 W1 writes it `Quire ·
 *  Webhook retry policy · 23:02`. */
export function source(s: Session, clock: (at: number | null) => string): string {
  return [s.project, s.card.title, s.at == null ? '' : clock(s.at)].filter(Boolean).join(' · ');
}

// ── how many windows a desktop opens ────────────────────────────────────────

/** Two, which is what Web12 W1 draws: one at the bottom right and the second to
 *  the left of it. A third window would be over the board it is meant to be
 *  read beside. */
export const PANELS = 2;

/** …and three tabs beside them, the fourth of which is `+1`. */
export const TABS = 3;

/** What the reader has done with the sessions on the page: the ones put away,
 *  and the ones answered or dismissed — those by the stamp they were dismissed
 *  at, so that a *new* question on the same card opens again rather than being
 *  silently swallowed by a decision about the old one. */
export interface DockState {
  minimised: string[];
  closed: Record<string, number>;
  /** …and the ones asked for by name: a card pressed on the board. Newest
   *  first. The desktop opens two windows by itself and picks them off the top
   *  of the list, so pressing the fourth thing waiting has to be able to put it
   *  in one of the two — otherwise the press does nothing and the reader is
   *  told to go and find a tab. */
  raised?: string[];
}

export const NO_DOCK: DockState = { minimised: [], closed: {}, raised: [] };

/** A session's stamp as the dock remembers it. `0` for a card nothing ever
 *  stamped: it is still one value per card, and a card that gains a stamp later
 *  reads as a new question, which it is. */
export const at = (s: Session): number => s.at ?? 0;

/** Whether this session has been dealt with and should not open itself again. */
export function dismissed(s: Session, dock: DockState): boolean {
  const was = dock.closed[s.id];
  return was !== undefined && was === at(s);
}

/** The windows, the tabs and what is left over.
 *
 *  The first two sessions that have not been put away are open windows, and
 *  every one of those has a tab that says so. Beyond three tabs the rest are a
 *  count — `+1` — because a row of tabs as wide as the screen is a second list,
 *  and a list is the thing this replaces.
 *
 *  **An open window is never in that count.** With five things waiting and the
 *  first three put away, the two windows on screen are the fourth and fifth in
 *  the list; a dock that drew the first three as tabs and said `+2` would be
 *  counting, as "more", the two windows the reader is looking at. So the tabs
 *  are the open ones plus as many of the rest as there is room for, and the
 *  count is what has no tab — which means the row can run one or two past three
 *  in exactly the case where those extra tabs are the windows themselves. */
export interface Dock {
  /** Nearest the corner first, which is the order they are drawn in. */
  panels: Session[];
  tabs: { session: Session; open: boolean }[];
  more: number;
  /** Everything still waiting, dismissed ones aside: what the tabs are drawn
   *  out of and what the amber count over them counts. */
  live: Session[];
}

export function arrange(list: Session[], dock: DockState = NO_DOCK): Dock {
  const live = list.filter((s) => !dismissed(s, dock));
  const away = new Set(dock.minimised);
  const up = (dock.raised ?? []).filter((id) => live.some((s) => s.id === id) && !away.has(id));
  const open = live.filter((s) => !away.has(s.id));
  const panels = [...up.map((id) => open.find((s) => s.id === id)!).filter(Boolean),
                  ...open.filter((s) => !up.includes(s.id))].slice(0, PANELS);
  const shown = new Set(panels.map((s) => s.id));
  // Room for the ones that are not on screen, after the windows have their own.
  const room = Math.max(0, TABS - panels.length);
  const also = new Set(live.filter((s) => !shown.has(s.id)).slice(0, room).map((s) => s.id));
  // Drawn in the order the list is in and not windows-first: the tabs are the
  // queue of what is waiting, and a tab that moved when its window opened would
  // be a row that reshuffles itself under a cursor.
  const tabs = live.filter((s) => shown.has(s.id) || also.has(s.id))
    .map((s) => ({ session: s, open: shown.has(s.id) }));
  return { panels, tabs, more: Math.max(0, live.length - tabs.length), live };
}

// ── what the reader has done with them ──────────────────────────────────────

interface DockStore extends DockState {
  raised: string[];
  /** Put a window away: it stays in the dock, and stays waiting. */
  minimise: (id: string) => void;
  /** …and take it out again. */
  restore: (id: string) => void;
  /** Open this one, wherever it sits in the queue: a card pressed on the board
   *  takes a window even when two others already have one, and one that had
   *  been put away or closed comes back. */
  raise: (id: string) => void;
  /** Close one: it does not open itself again until the card changes, which is
   *  what makes "I have dealt with this" different from "I have not looked". */
  close: (id: string, at: number) => void;
}

/** A store rather than a screen's state: putting a question away and then
 *  looking at a machine for a minute must not bring the question back, and the
 *  Dashboard is unmounted while you are on another page. */
export const useDock = create<DockStore>((set) => ({
  minimised: [],
  closed: {},
  raised: [],
  minimise: (id) => set((s) => (
    s.minimised.includes(id) ? s : { minimised: [...s.minimised, id] })),
  restore: (id) => set((s) => ({ minimised: s.minimised.filter((x) => x !== id) })),
  raise: (id) => set((s) => ({
    raised: [id, ...s.raised.filter((x) => x !== id)],
    minimised: s.minimised.filter((x) => x !== id),
    // A question that was closed and is then gone looking for is a question
    // again: "I have dealt with this" is undone by the asking, not by a clock.
    closed: Object.fromEntries(Object.entries(s.closed).filter(([k]) => k !== id)),
  })),
  close: (id, at) => set((s) => ({
    closed: { ...s.closed, [id]: at },
    minimised: s.minimised.filter((x) => x !== id),
    raised: s.raised.filter((x) => x !== id),
  })),
}));
