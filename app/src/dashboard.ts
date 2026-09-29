// What the Dashboard says, decided away from the screen that draws it.
//
// This is the place the product exists for: the one screen that is opened
// instead of a question being asked. Everything on it is a judgement about
// several computers' answers — which of four counters the fourth one is, which
// card is the one that needs a person first, whether a product is alive at all,
// and which of the system line's three states the fleet is in — and every one of
// those judgements has exactly one right answer. So they are here, with no
// React, no store and no palette in them, and `scripts/test-dashboard.cjs` holds
// the screen to them without a phone.
//
// Two rules run through all of it, and they are the ones that make the screen
// worth opening at all:
//
//   * **no invented numbers.** A figure with no source is absent, never a
//     zero and never a dash standing in for one. The frames put a product's MRR
//     at the top of its card; nothing measures it yet, so the card has no such
//     line and is drawn to look finished without it. What the board holds and
//     what git holds are the two figures that exist, and they are the two that
//     are drawn.
//   * **a machine that has gone quiet is said out loud.** Its cards still count
//     for what a person has to do — a ticket that stopped to ask does not answer
//     itself while a laptop is shut — but what an *agent* is doing there cannot
//     be known, so that is a counter of its own and every line built on it says
//     how old it is.
import { stuck, waiting, type DivanView, type MergedAgent, type MergedCard,
         type MergedProject } from './divan';
import { LOCALE, type Key } from './i18n';
import type { DivanExecutor } from './protocol';
import { STATE_MARK, type State, type Tone } from './tokens';

/** A product with nothing running and no commit for this long is not between
 *  two pieces of work, it is dormant — Mobile7 S5, "no activity in weeks", and
 *  Mobile5 S1's "quiet for 23 days". Two weeks: one week is a holiday. */
export const DORMANT_AFTER_S = 14 * 24 * 3600;

/** A line of the screen, as the string table's name for it and what goes in the
 *  gaps. Nothing in this file holds a sentence: the words are in `src/i18n.ts`
 *  and the screen is the only thing that has the table. */
export interface Said {
  key: Key;
  params?: Record<string, string | number>;
}

/** How long ago, in whole words. The screen passes the app's own
 *  (`since(seconds, T)`); nothing here formats a duration itself, because the
 *  units are strings in the table and the table is not this file's business. */
export type Ago = (seconds: number | null) => string;

/** `21:02`, the way every frame writes a time of day — the app's own locale, and
 *  24 hours because the frames are. Null in, empty out: a clock for a moment
 *  nobody recorded is the one thing this must not invent. */
export function clock(at: number | null | undefined, locale = LOCALE): string {
  if (at == null || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleTimeString(locale,
    { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── the system line ─────────────────────────────────────────────────────────

/** The thin line under the project bar, and the only infrastructure on this
 *  screen: which computers are reachable, and whether there is any agent quota
 *  left. Two facts, because they are the two that stop work happening.
 *
 *  Mobile1 V1 draws it healthy, Mobile5 S1 with a machine unreachable and
 *  Mobile5 S2 out of quota, and the three are one line in three tones rather
 *  than three widgets. */
export interface SystemLine {
  /** `none` is a phone that has not been paired with anything yet, which no
   *  frame draws and which is the first state every phone is in. */
  state: 'healthy' | 'unreachable' | 'spent' | 'none';
  /** One dot per paired computer, in the order they were paired. Hollow where
   *  that machine is not answering (Web15 W12). */
  dots: { id: string; reachable: boolean }[];
  machines: number;
  unreachable: number;
  /** The machine that has been quiet longest, and for how long — the line names
   *  one rather than counting them, because with one machine down its name is
   *  what a person needs and with three the count is. */
  quiet: { name: string; age: number | null } | null;
  /** What the fleet has left to start an agent on, as a percentage, with the
   *  clock it goes back up on. Null where no machine has ever measured one:
   *  the line then says nothing about quota rather than drawing an empty bar. */
  quota: { pct: number; resets_at: number | null; spent: boolean } | null;
}

export function systemLine(view: DivanView): SystemLine {
  const { hosts, totals, quota } = view;
  const unreachable = hosts.filter((h) => !h.reachable);
  // Longest quiet first, and a machine that has never answered at all before a
  // machine that answered an hour ago: it is the one with nothing behind it.
  const quiet = [...unreachable].sort((a, b) => (b.age ?? Infinity) - (a.age ?? Infinity))[0];
  const state = hosts.length === 0 ? 'none'
    : quota.spent ? 'spent'
    : unreachable.length > 0 ? 'unreachable'
    : 'healthy';
  return {
    state,
    dots: hosts.map((h) => ({ id: h.id, reachable: h.reachable })),
    machines: totals.machines,
    unreachable: unreachable.length,
    quiet: quiet ? { name: quiet.machine, age: quiet.age } : null,
    quota: quota.unknown || (quota.left == null && !quota.spent) ? null
      : { pct: Math.round((quota.spent ? 0 : quota.left ?? 0) * 100),
          resets_at: quota.resets_at, spent: quota.spent },
  };
}

/** Which tone the line takes. Amber for a machine that has gone quiet, red for
 *  a fleet that has run out of quota, and nothing at all when both are well —
 *  a healthy line is `s1` with grey mono on it and says so by being unremarkable
 *  (Mobile1 V1 against Mobile5 S1 and S2). */
export function systemTone(line: SystemLine): Tone | null {
  return line.state === 'spent' ? 'red' : line.state === 'unreachable' ? 'amber' : null;
}

/** The left half of the line, in words: which computers answered.
 *
 *  With one machine down its name is what a person needs (`mini unreachable ·
 *  2h 14m`) and with three the count is; a machine that has never answered at
 *  all has no duration to print and says so rather than printing `0s`. */
export function machineWords(line: SystemLine, ago: Ago): Said {
  if (line.state === 'none') return { key: 'sysNoMachines' };
  if (line.state === 'unreachable' && line.unreachable > 1) {
    return { key: 'sysUnreachableMany', params: { n: line.unreachable } };
  }
  if (line.state === 'unreachable' && line.quiet) {
    return line.quiet.age == null
      ? { key: 'sysUnreachableNever', params: { name: line.quiet.name } }
      : { key: 'sysUnreachable', params: { name: line.quiet.name, d: ago(line.quiet.age) } };
  }
  return line.machines === 1 ? { key: 'sysOneMachine' } : { key: 'sysMachines', params: { n: line.machines } };
}

/** …and the right half: what is left to start an agent on. Null where no machine
 *  has ever measured a quota, and the line then says nothing about one. */
export function quotaWords(line: SystemLine): Said | null {
  const q = line.quota;
  if (!q) return null;
  if (q.spent) {
    return q.resets_at ? { key: 'sysQuotaSpent', params: { time: clock(q.resets_at) } } : { key: 'sysQuotaOut' };
  }
  // A silent machine has spent the left half on a sentence; the figure then says
  // "quota" itself instead of being labelled (Mobile5 S1 against Mobile1 V1).
  if (line.state === 'unreachable') return { key: 'sysQuotaShort', params: { p: q.pct } };
  return q.resets_at
    ? { key: 'sysQuotaLeft', params: { p: q.pct, time: clock(q.resets_at) } }
    : { key: 'sysQuotaBare', params: { p: q.pct } };
}

/** What the red block says when the quota has run out (Mobile5 S2): what
 *  stopped, that nothing was lost, and exactly when work resumes.
 *
 *  Null while there is quota left anywhere — this is the one block on the screen
 *  that is drawn by an absence of something rather than by the presence of it,
 *  so the rule for whether it appears at all belongs with the words.
 *
 *  A pool that says it is spent but not when it comes back is an ordinary thing
 *  (nothing has measured a window yet, or every reading was of a window with no
 *  reset on it), and the block then says what stopped without promising an hour
 *  it does not know — and drops its footer, which is two clocks. */
export function pausedWords(view: DivanView, ago: Ago):
  { title: Said; body: Said; foot: Said[] } | null {
  const q = view.quota;
  if (!q.spent) return null;
  const back = q.resets_at;
  const n = view.totals.paused;
  return {
    title: back ? { key: 'pausedTitle', params: { time: clock(back) } } : { key: 'pausedTitleBare' },
    // Nothing was running when the last window closed: there is nobody to pick
    // up again, and what the block is really saying is that nothing new starts.
    body: n === 0 ? { key: 'pausedBodyNone' }
      : { key: n === 1 ? 'pausedBodyOne' : 'pausedBody',
          params: { n, d: ago(back == null ? null : Math.max(0, back - view.now)) } },
    foot: back ? [{ key: 'pausedUsed' }, { key: 'pausedResets', params: { time: clock(back) } }] : [],
  };
}

// ── how old the whole screen is ─────────────────────────────────────────────

/** What a machine going quiet costs this screen: which machines, which products
 *  depend on them, and the oldest answer any of the numbers is built out of.
 *
 *  Mobile5 S1 turns this into one sentence — "mini hasn't answered for 2h 14m.
 *  Kanji Daily runs there, so its numbers and agent states are from 21:02.
 *  Everything else is live." — and into the amber aside beside the title. The
 *  aside is the load-bearing half: a counter built out of one live machine and
 *  one that has been asleep for two hours is not a count unless it says so. */
export interface Staleness {
  machines: string[];
  /** The products whose numbers came, wholly or partly, off a quiet machine. */
  projects: string[];
  /** The oldest answer in the view. */
  asOf: number | null;
  /** …and how long ago that was, on the longest-quiet machine. */
  age: number | null;
}

/** The amber sentence under the title, in words: which machine went quiet, what
 *  ran there, and that everything else on the screen is live (Mobile5 S1). With
 *  more than one machine down, naming them all is a paragraph and the count is
 *  the fact; with nothing running on the one that went quiet, there is no
 *  product to name and the sentence says only what it can. */
export function staleWords(old: Staleness, ago: Ago): Said {
  if (old.machines.length > 1) {
    return { key: 'dashStaleMany', params: { n: old.machines.length, time: clock(old.asOf) } };
  }
  return old.projects.length
    ? { key: 'dashStale',
        params: { name: old.machines[0], d: ago(old.age),
                  projects: old.projects.join(', '), time: clock(old.asOf) } }
    : { key: 'dashStaleBare', params: { name: old.machines[0], d: ago(old.age) } };
}

export function staleness(view: DivanView): Staleness | null {
  const quiet = view.hosts.filter((h) => h.stale);
  if (!quiet.length) return null;
  const oldest = [...quiet].sort((a, b) => (b.age ?? Infinity) - (a.age ?? Infinity))[0];
  return {
    machines: quiet.map((h) => h.machine),
    projects: view.projects.filter((p) => p.stale).map((p) => p.name),
    asOf: view.totals.asOf,
    age: oldest.age,
  };
}

// ── the four counters ───────────────────────────────────────────────────────

/** One tile of the row across the top (Mobile1 V1). `ring` is Mobile5 S1's
 *  fourth tile: outlined in its own colour instead of washed with it, because
 *  "2 agents whose state nobody knows" is not the same kind of fact as "2
 *  things need you" and two amber washes side by side would say it was. */
export interface CounterSpec {
  key: Key;
  value: number;
  tone?: Tone;
  ring?: boolean;
}

/** The three that are always there, and the fourth that says what the day is
 *  like.
 *
 *  Needs you, Stuck and Running are counted off the cards and the agents. The
 *  fourth is whichever of three truths applies, worst first: agents on a machine
 *  that has gone quiet (Mobile5 S1), agents stopped because the quota ran out
 *  (Mobile5 S2), or what was finished today (Mobile1 V1 and V3). With none of
 *  the three measurable — no machine could read a repository and everything is
 *  answering — there are three tiles rather than four, because a fourth reading
 *  `0` or `—` would be a number nobody counted. */
export function counters(view: DivanView): CounterSpec[] {
  const { totals } = view;
  const four: CounterSpec[] = [
    { key: 'cNeedsYou', value: totals.needsYou, tone: 'amber' },
    { key: 'cStuck', value: totals.stuck, tone: 'red' },
    { key: 'cRunning', value: totals.running },
  ];
  if (totals.unknown > 0) four.push({ key: 'cUnknown', value: totals.unknown, tone: 'amber', ring: true });
  else if (totals.paused > 0) four.push({ key: 'cPaused', value: totals.paused, tone: 'red' });
  else if (totals.doneToday != null) four.push({ key: 'cDoneToday', value: totals.doneToday });
  return four;
}

/** Is this the calm morning of Mobile1 V3?
 *
 *  Nothing needs a person, and nothing is being kept from them: a screen that
 *  said "all clear" over two agents whose machine has gone quiet, or over work
 *  that stopped mid-task when a window closed, would be the one sentence on it
 *  that was not true. Each of those has its own way of saying so — the amber
 *  sentence, the outlined counter, a card's own corner — and that is what the
 *  reader should meet.
 *
 *  Paused counts as well as spent, and it has to: on a fleet where one computer
 *  is out of quota and another still has room the fleet is *not* spent, no red
 *  block is drawn, and without this clause the screen would print "All clear"
 *  directly above a card reading `⏸ 1 paused`.
 *
 *  A phone paired with nothing is not calm either — it has nothing to be calm
 *  about, and the empty state says so instead. */
export function calm(view: DivanView): boolean {
  return view.hosts.length > 0
    && view.totals.needsYou === 0 && view.totals.stuck === 0
    && view.totals.unknown === 0 && view.totals.paused === 0
    && !view.quota.spent;
}

// ── what needs a person ─────────────────────────────────────────────────────

/** Who is on a card, in one word. The frames write "Coder asks", "Your call",
 *  "SEO"; a branch agent is named by its branch, because that is what it is. */
export function executorKey(executor: DivanExecutor | null): Key {
  return executor === 'coding_agent' ? 'exCoder'
    : executor === 'branch_agent' ? 'exBranch'
    : executor === 'assistant' ? 'exAssistant'
    : executor === 'human' ? 'exYou'
    : 'exNobody';
}

/** One of the cards at the top of the Dashboard: a question only a person can
 *  answer, or a card that is his to do. Mobile1 V1 draws two of them. */
export interface Ask {
  card: MergedCard;
  /** `stuck` an agent that fell over or was turned down, `asking` one that
   *  stopped with a question, `yours` a card nothing runs on. */
  state: State;
  /** The question, in the words it was asked in. A stopped agent that said
   *  nothing leaves the card's own line standing for it — never an invented
   *  sentence, and never an empty card. */
  question: string;
  who: Key;
  /** The mono line in the corner of the card — `? Coder asks`, `■ Coder
   *  stopped`, `○ Your call` — with `who` in the gap where it has one. Three
   *  states, three sentences: "it fell over" and "it wants an answer" are not
   *  the same thing to the person about to deal with them. */
  says: Said;
}

export function asks(view: DivanView): Ask[] {
  const rank = (a: Ask) => (a.state === 'stuck' ? 0 : a.state === 'asking' ? 1 : 2);
  return view.cards.filter(waiting).map((card) => {
    const state: State = stuck(card) ? 'stuck' : card.agent_status === 'asking' ? 'asking' : 'yours';
    const who = executorKey(card.executor);
    return {
      card,
      state,
      question: (card.agent_detail || '').trim() || card.title,
      who,
      // "Your call" names nobody: the card is a person's and the person is the
      // one reading it.
      says: state === 'yours' ? { key: 'whoYours' as Key }
        : { key: (state === 'stuck' ? 'whoStopped' : 'whoAsks') as Key, params: { who } },
    } as Ask;
  }).sort((a, b) => rank(a) - rank(b)
    || (b.card.agent_status_at ?? 0) - (a.card.agent_status_at ?? 0)
    || a.card.title.localeCompare(b.card.title));
}

// ── a project card ──────────────────────────────────────────────────────────

/** The mark and words in the corner of a project card: the worst true thing
 *  about that product, with the character that carries it when the colour does
 *  not (Mobile1 V2's `■ 1 stuck`, Mobile5 S1's `◌ stale 2h 14m`, S2's
 *  `⏸ 3 paused`). */
export interface Chip {
  mark: string;
  key: Key;
  params?: Record<string, string | number>;
  tone: Tone;
}

/** Worst first, and the order is the order the question is asked in at three in
 *  the morning: something fell over, something is asking me, something is mine
 *  to do, these numbers are old, the agents are stopped, work is running,
 *  nothing is happening. */
export function chip(p: MergedProject, now: number, ago: Ago): Chip {
  const fell = p.cards.filter(stuck).length;
  const asking = p.cards.filter((c) => c.agent_status === 'asking').length;
  if (fell) return { mark: STATE_MARK.stuck, key: 'pcStuck', params: { n: fell }, tone: 'red' };
  if (asking) return { mark: STATE_MARK.asking, key: 'pcAsking', params: { n: asking }, tone: 'amber' };
  if (p.waiting > 0) return { mark: STATE_MARK.yours, key: 'pcYours', tone: 'amber' };
  if (p.stale) return { mark: '◌', key: 'pcStale', params: { d: ago(staleFor(p, now)) }, tone: 'amber' };
  if (p.paused > 0) return { mark: '⏸', key: 'pcPaused', params: { n: p.paused }, tone: 'red' };
  if (p.running > 0) return { mark: STATE_MARK.running, key: 'pcRunning', params: { n: p.running }, tone: 'run' };
  return { mark: '', key: 'pcQuiet', tone: 'ink3' };
}

/** How long the quiet machine under a product has been quiet — measured from
 *  this end's clock, which is the only one that can be. Null where it has never
 *  answered at all, and the line then says unreachable without a duration
 *  rather than inventing one. */
export function staleFor(p: MergedProject, now: number): number | null {
  if (p.lastSeen == null) return null;
  return Math.max(0, now - p.lastSeen);
}

/** The grey mono line under a product's name: where its work is and how much of
 *  it, or — with nothing running at all — how long it has been like that.
 *  Mobile5 S1: "on studio, cloud · 4 agents", "nothing running", "quiet for 23
 *  days". */
export function line(p: MergedProject, now: number): { key: Key; params?: Record<string, string | number> } {
  if (p.running > 0) {
    const on = p.machines.join(', ');
    const one = p.running === 1;
    return p.unknown >= p.running
      ? { key: one ? 'plOneUnknown' : 'plUnknown', params: { on, n: p.running } }
      : { key: one ? 'plOneRunning' : 'plRunning', params: { on, n: p.running } };
  }
  if (dormant(p, now)) return { key: 'plDormant', params: { d: Math.floor(age(p, now)! / 86400) } };
  return { key: 'plIdle' };
}

/** The small mono line under a project card's corner, where there is one: when
 *  the machine its numbers came from last answered (Mobile5 S1's `last seen
 *  21:02`), or when its own stopped agents pick up again (S2's `resume 04:00`).
 *
 *  Both clocks are the product's — `lastSeen` is the oldest machine it lives on
 *  and `pausedUntil` the first its stopped agents wait on — and neither is
 *  passed in, so there is no clock this can be handed that does not belong to
 *  the card being drawn.
 *
 *  Null while everything about the product is current — the frames draw `live`
 *  there and this does not, because a line that says so on every card on every
 *  ordinary morning is a line nobody reads. It appears when there is something
 *  to say, which is the only time it means anything.
 *
 *  A quiet machine that has never answered at all has no clock to print and gets
 *  nothing rather than a guess; the corner still says it is stale. */
export function freshness(p: MergedProject): Said | null {
  if (p.stale) {
    return p.lastSeen == null ? null : { key: 'pfLastSeen', params: { time: clock(p.lastSeen) } };
  }
  // The product's own clock and not the fleet's. On a fleet where one computer
  // is spent and another still has room, the fleet's figure is the *live*
  // machine's window: printing it here would tell somebody their stopped work
  // resumes at an hour measured on the computer that never stopped.
  if (p.paused > 0 && p.pausedUntil != null) {
    return { key: 'pfResume', params: { time: clock(p.pausedUntil) } };
  }
  return null;
}

/** Nothing running, and nothing committed for a fortnight. A product with no
 *  repository to read is never called dormant: not knowing is not the same as
 *  knowing nothing happened. */
export function dormant(p: MergedProject, now: number): boolean {
  const since = age(p, now);
  return p.running === 0 && p.waiting === 0 && since != null && since > DORMANT_AFTER_S;
}

/** How long since this product's newest commit, in seconds. Null where no
 *  repository of it could be read. */
export function age(p: MergedProject, now: number): number | null {
  const at = p.activity?.at;
  return at == null ? null : Math.max(0, now - at);
}

/** The second line of a project card, where there is one: the numbers the
 *  board's own marks stand for. `no agents` where none of them is anything,
 *  which is Mobile1 V2's own words for the quiet product. */
export function marks(p: MergedProject): { mark: State; n: number }[] {
  const of = (test: (c: MergedCard) => boolean) => p.cards.filter(test).length;
  const found: { mark: State; n: number }[] = [
    { mark: 'stuck', n: of(stuck) },
    { mark: 'asking', n: of((c) => c.agent_status === 'asking') },
    { mark: 'yours', n: of((c) => c.executor === 'human' && c.column === 'in_progress') },
    { mark: 'running', n: of((c) => c.agent_status === 'running') },
  ];
  return found.filter((m) => m.n > 0);
}

/** The one thing worth saying about a run of cards in the corner of whatever
 *  they are on: the worst card's own line. Written by the mirror, so it is what
 *  the queue said rather than a sentence composed here — and empty where nothing
 *  has been said, in which case the corner says nothing.
 *
 *  Takes the cards and not the product, because a branch card asks the same
 *  question of its own share of them (`src/project.ts`) and two spellings of
 *  "the worst card" would drift apart. */
export function latest(cards: MergedCard[]): string {
  const worst = cards.filter(stuck)[0]
    ?? cards.find((c) => c.agent_status === 'asking')
    ?? cards.find((c) => c.agent_status === 'running')
    ?? cards.find(waiting)
    ?? null;
  if (!worst) return '';
  return (worst.agent_detail || '').trim() || worst.title;
}

// ── the agent roster ────────────────────────────────────────────────────────

/** One line of "who is on what, where" (Mobile1 V2). */
export interface AgentRow {
  agent: MergedAgent;
  /** `●` at work, `◌` on a machine that has gone quiet, `⏸` stopped because the
   *  quota ran out. */
  mark: string;
  tone: Tone;
  who: Key;
  /** Which project card's colour its monogram takes, so that one product is one
   *  hue down the whole screen. -1 for an agent whose product is not in the
   *  list, which cannot happen and must not throw. */
  index: number;
}

export function agentRows(view: DivanView): AgentRow[] {
  const at = new Map(view.projects.map((p, i) => [p.key, i]));
  const spent = new Set(view.hosts.filter((h) => !h.stale && h.quota?.spent).map((h) => h.id));
  const rank = (r: AgentRow) => (r.mark === '◌' ? 0 : r.mark === '⏸' ? 1 : 2);
  return view.agents.map((agent) => ({
    agent,
    mark: agent.unknown ? '◌' : spent.has(agent.host) ? '⏸' : STATE_MARK.running,
    tone: (agent.unknown ? 'amber' : spent.has(agent.host) ? 'red' : 'run') as Tone,
    who: executorKey(agent.executor),
    index: at.has(agent.projectKey) ? at.get(agent.projectKey)! : -1,
  })).sort((a, b) => rank(a) - rank(b) || (b.agent.since ?? 0) - (a.agent.since ?? 0));
}

// ── where a tap lands ───────────────────────────────────────────────────────

/** What a tapped agent row — or a tapped question — opens: the thing it is
 *  about.
 *
 *  A coding agent's ticket is the run itself, what the model is printing as it
 *  is printed, and that screen reads the queue of whichever computer the phone
 *  holds a socket to. So it is only opened for work running *on* that computer;
 *  a ticket number from another machine's queue would open a different queue's
 *  ticket, which is a wrong answer rather than a missing one. Everything else
 *  enters its product, which is as deep as the app goes until the card has a
 *  page of its own. */
export function target(what: { ustabasi_id: number | null; host: string; projectKey: string },
                       activeHost: string | null | undefined): { ticket: number } | { project: string } {
  if (what.ustabasi_id != null && what.host === activeHost) return { ticket: what.ustabasi_id };
  return { project: what.projectKey };
}
