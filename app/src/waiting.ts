// What the Waiting-on-you screen says, decided away from the screen that draws
// it. No React, no store, no palette — `scripts/test-waiting.cjs` holds the
// screen to every judgement in here without a phone.
//
// The Dashboard answers "how is everything"; this one answers the other
// question, the one that is actually keeping somebody awake: **what is waiting
// on me, everywhere, right now.** One list across every paired computer, so
// that a question a worker asked on the mini at midnight is not something you
// find by opening the mini.
//
// Three rules run through it, and they are the ones that make it worth opening
// instead of the four boards:
//
//   * **grouped by the kind of answer it needs** (HANDOVER §4.6): an agent is
//     asking — a worker standing still for a sentence, or one that stopped —
//     a decision nobody is blocked on, and what is on your plate. Yours come
//     last, because they are the ones that can wait. Oldest first in each.
//   * **every item says where it came from.** Which product, and which
//     computer — a question is answered differently depending on whether the
//     machine holding the work is the one in front of you or the laptop that
//     has been shut since eleven.
//   * **nothing is invented, least of all an answer.** The proposed answers on
//     a card are words taken out of the question itself; a question that offers
//     no such words gets no buttons rather than a guessed pair. Which is the
//     same rule the Dashboard's figures are under, applied to language.
import { stuck, waiting, type DivanView, type MergedCard } from './divan';
import type { Key } from './i18n';
import type { DivanColumn, DivanExecutor, DivanOpenItem } from './protocol';
import type { State, Tone } from './tokens';

/** The four groups of Mobile6 S3, in the order it draws them. */
export type Kind = 'question' | 'decision' | 'stuck' | 'yours';

/** The frame's own order, top to bottom: the questions somebody is held up by,
 *  the decisions nobody is held up by, what fell over, and — last, because they
 *  are the only ones that can wait — the cards that are yours.
 *
 *  It is the order the two amber groups are read in first and the red one
 *  after, which looks backwards written down and is right on the screen: a
 *  worker standing still waiting for a sentence is a minute's work, and a
 *  ticket that fell over is not. */
export const KINDS: Kind[] = ['question', 'decision', 'stuck', 'yours'];

/** Which state's mark and colour each group takes, so the mark carries what the
 *  colour does for an eye that does not separate red from amber. `yours` has no
 *  mark in the frame — its head is the bare word, in grey — and that is the one
 *  group that is not about somebody else waiting. */
export const KIND_STATE: Record<Kind, State> = {
  stuck: 'stuck', question: 'asking', decision: 'yours', yours: 'quiet',
};

export const KIND_LABEL: Record<Kind, Key> = {
  stuck: 'wkStuck', question: 'wkQuestions', decision: 'wkDecisions', yours: 'wkYours',
};

export const KIND_TONE: Record<Kind, Tone> = {
  stuck: 'red', question: 'amber', decision: 'amber', yours: 'ink2',
};

/** Which of the four a card waiting on a person is.
 *
 *  `stuck` is an agent that fell over or was turned down — red, and the only
 *  one where something has gone wrong. A stopped agent with a question is a
 *  **question** when a coding agent asked it, because that worker is standing
 *  still until it is answered, and a **decision** when anything else did: a
 *  branch agent or a piece of research asking which way to go is not blocked
 *  work, it is a choice. A card with a person on it is **yours**, and nothing
 *  is waiting on anybody but you.
 *
 *  Null for a card that is not waiting on anybody at all, which is how the
 *  screen's list is filtered: one rule, in one place. */
export function kindOf(card: MergedCard): Kind | null {
  if (!waiting(card)) return null;
  if (stuck(card)) return 'stuck';
  if (card.agent_status === 'asking') return card.executor === 'coding_agent' ? 'question' : 'decision';
  return 'yours';
}

/** Which face the executor of a card wears (`components/divan` `ExecutorBadge`).
 *
 *  A branch agent is named by its branch — that is what it is — so a card on
 *  the SEO branch gets the SEO face where the design has one, and the pending
 *  square where it does not. Nothing here invents a face: an unknown name falls
 *  through to `unassigned`, which is what the badge draws for "nobody has
 *  picked this up". */
export function executorFace(card: { executor: DivanExecutor | null; branch: string }): string {
  switch (card.executor) {
    case 'coding_agent': return 'coder';
    case 'assistant': return 'research';
    case 'human': return 'you';
    case 'branch_agent': return (card.branch || '').trim().toLowerCase();
    default: return 'unassigned';
  }
}

/** Who is waiting, in one word — the same table the Dashboard names an
 *  executor by, so one product speaks one vocabulary. */
export function executorKey(executor: DivanExecutor | null): Key {
  return executor === 'coding_agent' ? 'exCoder'
    : executor === 'branch_agent' ? 'exBranch'
    : executor === 'assistant' ? 'exAssistant'
    : executor === 'human' ? 'exYou'
    : 'exNobody';
}

// ── the answers a question offers, in its own words ─────────────────────────

/** The openers that turn an alternative into a sentence nobody can split in
 *  half. "Keep our three attempts, or follow Stripe's schedule?" has two
 *  answers in it; "Should we keep our three attempts, or follow Stripe's?" has
 *  one answer and half of another, and a button reading `follow Stripe's` under
 *  a button reading `Should we keep our three attempts` is the screen putting
 *  words in somebody's mouth. So a question that opens with one of these offers
 *  no buttons and gets the reply box instead. */
const OPENER = /^(should|shall|do|does|did|can|could|would|will|is|are|was|were|must|may|might|have|has)\b/i;

/** The join. Written with the comma because that is how the alternative is
 *  written when it is one — and matched without it too, because it is not
 *  always. */
const OR = /,?\s+or\s+/i;

/** An answer longer than this is a paragraph, not a button. Mobile6 S3's own
 *  pills are twelve and eight characters; this is generous, and its job is to
 *  refuse the sentence that happens to contain an "or" rather than to trim. */
const ANSWER_CHARS = 48;

/** A question this long has more in it than a choice between two things. */
const QUESTION_CHARS = 200;

/** The Turkish question particle closing a sentence — `mı`, `mi`, `mu`, `mü`,
 *  with the person endings it takes (`miyim`, `mısın`, `mıyız`). */
const YES_NO = /\sm[ıiuü](y[ıiuü]m|s[ıiuü]n(ız|iz|uz|üz)?|y[ıiuü]z|d[ıiuü]r)?$/i;

/** The answers a question offers, quoted out of the question itself.
 *
 *  Mobile6 S3 draws two pills and a `Reply…` on the card of an agent that
 *  stopped to ask, and answering with one of them is the whole point of the
 *  screen: a tap instead of a laptop. Nothing in the queue carries a set of
 *  options, though — a stopped ticket carries a sentence — so the only honest
 *  place for the words on those pills is the sentence itself.
 *
 *  So: the last sentence, if it ends in a question mark, if it is one
 *  alternative and not an essay, and if it is not phrased in a way that makes
 *  the two halves unequal. Everything else is a question with no buttons on it,
 *  and there are a great many of those; this is deliberately the narrow case,
 *  because a wrong button sends a wrong answer to a worker that will act on it.
 *
 *  Empty for anything that does not fit, which is the screen's signal to offer
 *  the reply box instead. */
export function answers(question: string): string[] {
  const text = (question || '').replace(/\s+/g, ' ').trim();
  if (!text.endsWith('?')) return [];
  // The last sentence only: the lines before it are the worker explaining
  // itself, and the choice is the thing it ends on.
  const last = text.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? '';
  const body = last.replace(/\?+$/, '').trim();
  if (!body || body.length > QUESTION_CHARS) return [];
  // Turkish asks the way the queue now writes its questions (6 Oct 2026). "A mı,
  // B mi?" is the alternative, and its two halves are the answers. A plain
  // yes-or-no ("Ben ekleyeyim mi?") offers only Evet: it is the one answer safe
  // to put on a button, since a no is rarely just a no — "not yet", "not like
  // that" — and the box under the pill is where that gets said.
  const alt = body.match(/^(.+?)\s+m[ıiuü],\s*(.+?)\s+m[ıiuü]$/i);
  if (alt) {
    const pair = [alt[1].trim(), alt[2].trim()];
    return pair.some((p) => p.length < 2 || p.length > ANSWER_CHARS) ? [] : pair.map(capital);
  }
  if (YES_NO.test(body) && !/\s(veya|ya da|yoksa)\s/i.test(body)) return ['Evet'];
  if (OPENER.test(body)) return [];
  const parts = body.split(OR);
  if (parts.length !== 2) return [];
  const two = parts.map((p) => p.trim().replace(/[,;]+$/, ''));
  if (two.some((p) => p.length < 2 || p.length > ANSWER_CHARS)) return [];
  return two.map(capital);
}

/** An answer as it is written on a pill and sent as a note — the same string in
 *  both places, so that what was tapped and what the worker reads are one
 *  thing. The only liberty taken with the question's own words is the capital
 *  the second half lost by being the second half. */
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── an item ─────────────────────────────────────────────────────────────────

/** One thing waiting on a person, wherever it is. */
export interface Item {
  card: MergedCard;
  kind: Kind;
  /** The product this is work on, by the name the merge folded it under, and
   *  its place in the view's list — which is the hue its monogram takes, so
   *  that one product is one colour across every Divan screen. -1 for a card
   *  whose product is not in the list, which cannot happen and must not throw. */
  project: string;
  projectKey: string;
  index: number;
  /** …and the computer it came off. Never the path, never the host:port — the
   *  machine's own name, which is what the frames show. */
  machine: string;
  /** That machine has gone quiet: what is on this card is the last thing it
   *  said, and a tap on it is a request to a computer that is not answering. */
  stale: boolean;
  who: Key;
  /** What it says, in the words it was said in. A stopped agent that said
   *  nothing leaves the card's own title standing for it — never an invented
   *  sentence, and never an empty card. */
  said: string;
  /** How long it has been like this, in seconds. The mirror's stamp on a card
   *  an agent is on; on a card that is a person's, the moment it was moved into
   *  In Progress, which is when it started being theirs. Null where neither was
   *  ever written, in which case the card prints no duration rather than `0s`. */
  age: number | null;
  /** `said` is a question rather than a report. Mobile6 S3 draws the two
   *  differently and it is the right difference: a question is the loud line on
   *  the card because it is the thing being asked of you, and an agent
   *  explaining where it got stuck is the quiet one under it. */
  asked: boolean;
  /** The answers the question offers in its own words. Empty for everything
   *  that is not a question with a choice in it — which is most of them. */
  answers: string[];
}

/** Everything waiting on a person, across every paired computer.
 *
 *  Oldest first within each kind, which is the frame's own line under the
 *  title: the thing that has been waiting since last night is the thing to deal
 *  with, and a list that reshuffled itself every time a worker stopped would be
 *  unreadable. A card nothing ever stamped sorts last — not knowing when is not
 *  the same as just now — and the title breaks the remaining ties so the list
 *  does not move under a thumb. */
export function items(view: DivanView): Item[] {
  const at = new Map(view.projects.map((p, i) => [p.key, i]));
  const out: Item[] = [];
  for (const card of view.cards) {
    const kind = kindOf(card);
    if (!kind) continue;
    const index = at.has(card.projectKey) ? at.get(card.projectKey)! : -1;
    const said = (card.agent_detail || '').trim() || card.title;
    out.push({
      card,
      kind,
      project: view.projects[index]?.name ?? card.branch,
      projectKey: card.projectKey,
      index,
      machine: card.machine,
      stale: card.stale,
      who: executorKey(card.executor),
      said,
      age: stamp(card) == null ? null : Math.max(0, view.now - stamp(card)!),
      asked: said.trim().endsWith('?'),
      // A card that is yours carries a title and no question: there is nobody
      // on the other end of an answer to it.
      answers: kind === 'yours' ? [] : answers(said),
    });
  }
  return out.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || (b.age ?? -1) - (a.age ?? -1)
    || a.card.title.localeCompare(b.card.title));
}

/** When this card started waiting. A card nothing runs on has no agent status
 *  to be stamped, and `moved_at` is the honest answer for it: it has been
 *  waiting since somebody put it In Progress. */
function stamp(card: MergedCard): number | null {
  return card.agent_status_at ?? card.moved_at ?? null;
}

/** The mono line under who is waiting: which product this is work on, which
 *  card it is, and which computer it came off.
 *
 *  Mobile6 S3 writes it `Quire · Safari 17 login · on studio`, and it is the
 *  load-bearing line on the whole screen rather than a caption. A list gathered
 *  off four machines cannot be read without it — the same question asked on two
 *  computers is two questions — and the machine named here is the one the
 *  answer is sent back to.
 *
 *  Composed here rather than in the screen so that a check can read the three
 *  things that went into it, which a rendered string cannot be held to. */
export function source(item: Item): { key: Key; params: Record<string, string | number> } {
  return { key: 'waitFrom',
           params: { project: item.project, title: item.card.title, machine: item.machine } };
}

// ── what a tap does ─────────────────────────────────────────────────────────

/** The one thing an action actually does. Two writes and a way in, and no more
 *  than that: everything else a queue or a board can do stays where it is —
 *  this screen exists to get out of somebody's way, not to edit cards. */
export type Doing =
  | { do: 'note'; ticket: number; host: string; text: string }
  | { do: 'move'; card: string; host: string; column: DivanColumn }
  | { do: 'open'; card: string; host: string };

/** A button on a card: what it says, how it is drawn, and what it does. */
export interface Action {
  key: Key;
  /** The words on an answer are the question's own and are not in the string
   *  table. Everything else says something the app is saying. */
  label?: string;
  face: 'amber' | 'ink' | 'outline';
  /** A pill (Mobile6 S3's answers) rather than a button (its two half-width
   *  ones). The shape carries the difference: an answer written in the
   *  question's words, against a thing the app does. */
  pill?: boolean;
  doing: Doing;
}

/** What is offered on one item (HANDOVER §4.6): one press answers it.
 *
 *  A question's answers, in its own words, first one amber: each is a note to
 *  the queue that asked, which re-opens the ticket and takes the card off this
 *  screen. A card with no ticket behind it has nothing to send a note to. A
 *  card that is yours is `Mark done`, which moves it to Done. Every item can be
 *  opened — the ticket page, with its question and the box to say anything
 *  else — and the card's own page reaches any machine, so the opening is not
 *  limited to the computer this phone holds a socket to.
 *
 *  `activeHost` is kept for the callers that still pass it. */
export function actions(item: Item, _activeHost?: string | null): Action[] {
  const { card } = item;
  const open: Action = { key: 'waitOpenTicket', face: 'outline',
                         doing: { do: 'open', card: card.id, host: card.host } };
  if (item.kind === 'yours') {
    return [{ key: 'waitDone', face: 'ink',
              doing: { do: 'move', card: card.id, host: card.host, column: 'done' } }, open];
  }
  const ticket = card.ustabasi_id;
  const out: Action[] = ticket == null ? [] : item.answers.map((text, i) => ({
    key: 'waitAnswer' as Key, label: text, face: (i === 0 ? 'amber' : 'outline') as Action['face'],
    pill: true, doing: { do: 'note', ticket, host: card.host, text } as Doing,
  }));
  return [...out, open];
}

// ── the three groups (HANDOVER §4.6) ────────────────────────────────────────

/** An agent is asking · A decision · On your plate. A stopped agent is in the
 *  first: it needs a sentence from you to go on, the same as a question. */
export type Bucket = 'asking' | 'decision' | 'plate';

export const BUCKETS: Bucket[] = ['asking', 'decision', 'plate'];

export const BUCKET_LABEL: Record<Bucket, Key> = {
  asking: 'wgAsking', decision: 'wgDecision', plate: 'wgPlate',
};

export function bucketOf(kind: Kind): Bucket {
  return kind === 'decision' ? 'decision' : kind === 'yours' ? 'plate' : 'asking';
}

/** A product's Still open item that is yours to do. */
export interface OpenEntry {
  id: string;
  host: string;
  /** That machine's own id for the product, which is what a write names. */
  projectId: string;
  project: string;
  index: number;
  item: DivanOpenItem;
  age: number | null;
}

/** Whose a Still open item is: done is nobody's; one with a person named on it
 *  is that person's, and on this page only when that person is you; one with
 *  nobody named is yours unless it is waiting on somebody. */
export function mine(item: DivanOpenItem): boolean {
  if (item.state === 'done') return false;
  const owner = (item.owner || '').trim();
  if (owner) return /^(yakup|you|me)$/i.test(owner);
  return item.state !== 'waiting';
}

export type Entry =
  | { kind: 'card'; id: string; item: Item; age: number | null }
  | { kind: 'open'; id: string; open: OpenEntry; age: number | null };

export interface Bucketed {
  bucket: Bucket;
  label: Key;
  entries: Entry[];
}

/** The three groups, oldest first in each, a group with nothing in it left
 *  out. On your plate is the cards that are yours and the Still open items
 *  nobody else has been named for. */
export function buckets(view: DivanView): Bucketed[] {
  const oldest = (a: Entry, b: Entry) => (b.age ?? -1) - (a.age ?? -1);
  const cards: Entry[] = items(view).map((item) => ({ kind: 'card', id: `${item.card.host}:${item.card.id}`, item, age: item.age }));
  const open: Entry[] = view.projects.flatMap((p, index) => p.open.filter((o) => mine(o)).map((item) => ({
    kind: 'open' as const, id: `${item.host}:${item.id}`, age: item.created_at ? Math.max(0, view.now - item.created_at) : null,
    open: { id: item.id, host: item.host, projectId: p.ids[item.host] ?? item.project_id, project: p.name, index,
            item, age: item.created_at ? Math.max(0, view.now - item.created_at) : null },
  })));
  return BUCKETS.map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    entries: [...cards.filter((e) => e.kind === 'card' && bucketOf(e.item.kind) === bucket),
              ...(bucket === 'plate' ? open : [])].sort(oldest),
  })).filter((g) => g.entries.length > 0);
}

/** The title, as the parts of a sentence: `2 answers, 1 task.` — or the one
 *  sentence the page is when nothing waits. */
export function headline(groups: Bucketed[]): { key: Key; params?: Record<string, number> }[] {
  const answers = groups.filter((g) => g.bucket !== 'plate').reduce((n, g) => n + g.entries.length, 0);
  const tasks = groups.filter((g) => g.bucket === 'plate').reduce((n, g) => n + g.entries.length, 0);
  if (!answers && !tasks) return [{ key: 'waitNothing' }];
  return [
    ...(answers ? [answers === 1 ? { key: 'waitAnswerOne' as Key } : { key: 'waitAnswers' as Key, params: { n: answers } }] : []),
    ...(tasks ? [tasks === 1 ? { key: 'waitTaskOne' as Key } : { key: 'waitTasks' as Key, params: { n: tasks } }] : []),
  ];
}
