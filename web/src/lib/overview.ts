/** The judgements the Dashboard place makes, kept out of the screen that draws
 *  them so `scripts/test-overview.mjs` can hold them to a snapshot without a
 *  browser: how old the page is, which four numbers are across the top, what a
 *  product's card says about itself, who is at work, and whether this is a
 *  morning where nothing needs anybody.
 *
 *  The rule every one of them follows: a figure that has no source is not drawn.
 *  Nothing in here invents a number, and where there is nothing to say the answer
 *  is an empty list rather than a zero.
 *
 *  **It is the phone's `app/src/dashboard.ts` in the panel's own words.** The
 *  phone asks the same questions of the same merged snapshot and keeps its
 *  sentences in a string table; the panel has no table for the Divan screens and
 *  spells them here, so every sentence below is that table's entry for the same
 *  key, character for character (`pcAsking: '{n} asks'`, `plIdle: 'nothing
 *  running'`, …). `scripts/test-overview.mjs` compiles both files and holds them
 *  to each other on the same board: two clients that disagreed about how many
 *  things need you would be two different products.
 *
 *  Where a duration is said out loud the formatter is passed in rather than
 *  chosen here — the phone counts a minute in its own words — so the two can be
 *  compared without either one's clock getting in the way.
 */
import type { DivanColumn, DivanExecutor } from './protocol';
import type { DivanView, MergedAgent, MergedProject } from './divan';
import { stuck } from './divan';
import { STATE_MARK, type State, type Tone } from './theme';

/** How long ago, in whole words. The screen passes the panel's own
 *  (`uptime`); nothing here formats a duration itself. */
export type Ago = (seconds: number | null) => string;

/** `21:02`, the way every frame writes a time of day — 24 hours, because the
 *  frames are. Empty for a moment nobody recorded, which is the one thing this
 *  must not invent. */
export function clock(at: number | null | undefined): string {
  if (at == null || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleTimeString('en-GB',
    { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** `4 products`, `1 machine`. */
export function count(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

// ── how old the page is ─────────────────────────────────────────────────────

/** How old the page is, or null while every machine is answering. `asOf` is the
 *  oldest answer any of it was built out of, which is what "partly as of 21:02"
 *  means, and `machines` is the ones that have gone quiet with how long each has
 *  been quiet for. A machine that has never answered is not in here: there is
 *  nothing of it on the page to be old. */
export interface Staleness {
  asOf: number | null;
  machines: { machine: string; age: number }[];
}

export function staleness(view: DivanView): Staleness | null {
  const quiet = view.hosts.filter((h) => h.stale && h.at != null);
  if (!quiet.length) return null;
  return {
    asOf: view.totals.asOf,
    machines: quiet.map((h) => ({ machine: h.machine, age: Math.max(0, view.now - (h.at as number)) })),
  };
}

/** What a page built partly out of a quiet machine says about itself, in whole
 *  words: which machines have gone quiet, how long each has been quiet for, and
 *  that what is below is what they last said. One machine and several are
 *  different sentences, because "it" and "they" are. */
export function staleWords(old: Staleness, ago: Ago): string {
  const list = old.machines.map((m) => `${m.machine} for ${ago(m.age)}`).join(' · ');
  return old.machines.length === 1
    ? `${old.machines[0].machine} has been quiet for ${ago(old.machines[0].age)}.`
      + ' What it last said is still below.'
    : `${old.machines.length} machines have been quiet — ${list}.`
      + ' What they last said is still below.';
}

// ── the four counters ───────────────────────────────────────────────────────

/** One tile of the row across the top (Web12 W1). `ring` is the outlined tile:
 *  "2 agents whose state nobody knows" is not the same kind of fact as "2 things
 *  need you", and two amber washes side by side would say it was. */
export interface CounterSpec {
  label: string;
  value: number;
  tone?: Tone;
  ring?: boolean;
}

/** The three that are always there, and the fourth that says what the day is
 *  like.
 *
 *  Needs you, Stuck and Running are counted off the cards and the agents. The
 *  fourth is whichever of three truths applies, worst first: agents on a machine
 *  that has gone quiet, agents stopped because the quota ran out, or what was
 *  finished today (which is what Web12 W1 draws). With none of the three
 *  measurable — no machine could read a repository and everything is answering —
 *  there are three tiles rather than four, because a fourth reading `0` or `—`
 *  would be a number nobody counted. */
export function counters(view: DivanView): CounterSpec[] {
  const { totals } = view;
  const four: CounterSpec[] = [
    { label: 'Needs you', value: totals.needsYou, tone: 'amber' },
    { label: 'Stuck', value: totals.stuck, tone: 'red' },
    { label: 'Running', value: totals.running },
  ];
  if (totals.unknown > 0) four.push({ label: 'Unknown', value: totals.unknown, tone: 'amber', ring: true });
  else if (totals.paused > 0) four.push({ label: 'Paused', value: totals.paused, tone: 'red' });
  else if (totals.doneToday != null) four.push({ label: 'Done today', value: totals.doneToday });
  return four;
}

/** Is this a morning where nothing needs anybody?
 *
 *  Nothing needs a person, and nothing is being kept from them: a page that said
 *  "all clear" over two agents whose machine has gone quiet, or over work that
 *  stopped mid-task when a window closed, would be the one sentence on it that
 *  was not true. Each of those has its own way of saying so, and that is what
 *  the reader should meet.
 *
 *  A panel paired with nothing is not calm either — it has nothing to be calm
 *  about, and the empty state says so instead. */
export function calm(view: DivanView): boolean {
  return view.hosts.length > 0
    && view.totals.needsYou === 0 && view.totals.stuck === 0
    && view.totals.unknown === 0 && view.totals.paused === 0
    && !view.quota.spent;
}

/** …and what the calm page says, which is a designed state and not an absence:
 *  that nothing needs you, and — where anything can be counted — what happened
 *  while nobody was looking. */
export function calmWords(view: DivanView): { title: string; foot: string | null } {
  const done = view.totals.doneToday;
  return {
    title: 'All clear. Nothing needs you.',
    foot: done ? `${done} finished today` : null,
  };
}

// ── a project card ──────────────────────────────────────────────────────────

/** Who does the work, in one word — the same table the phone names an executor
 *  by, so one product speaks one vocabulary. */
export function executorWord(executor: DivanExecutor | null): string {
  return executor === 'coding_agent' ? 'Coder'
    : executor === 'branch_agent' ? 'Branch'
    : executor === 'assistant' ? 'Research'
    : executor === 'human' ? 'You'
    : 'Nobody';
}

/** The mark and words in the corner of a project card: the worst true thing
 *  about that product, with the character that carries it when the colour does
 *  not. */
export interface Chip {
  mark: string;
  text: string;
  tone: Tone;
}

/** Worst first, and the order is the order the question is asked in at three in
 *  the morning: something fell over, something is asking me, something is mine
 *  to do, these numbers are old, the agents are stopped, work is running,
 *  nothing is happening. */
export function chip(p: MergedProject, now: number, ago: Ago): Chip {
  const fell = p.cards.filter(stuck).length;
  const asking = p.cards.filter((c) => c.agent_status === 'asking').length;
  if (fell) return { mark: STATE_MARK.stuck, text: `${fell} stuck`, tone: 'red' };
  if (asking) return { mark: STATE_MARK.asking, text: `${asking} asks`, tone: 'amber' };
  if (p.waiting > 0) return { mark: STATE_MARK.yours, text: 'yours', tone: 'amber' };
  if (p.stale) return { mark: '◌', text: `stale ${ago(staleFor(p, now))}`, tone: 'amber' };
  if (p.paused > 0) return { mark: '⏸', text: `${p.paused} paused`, tone: 'red' };
  if (p.running > 0) return { mark: STATE_MARK.running, text: `${p.running} running`, tone: 'run' };
  return { mark: '', text: 'quiet', tone: 'ink3' };
}

/** How long the quiet machine under a product has been quiet — measured from
 *  this end's clock, which is the only one that can be. Null where it has never
 *  answered at all, and the line then says so without inventing a duration. */
export function staleFor(p: MergedProject, now: number): number | null {
  if (p.lastSeen == null) return null;
  return Math.max(0, now - p.lastSeen);
}

/** The grey mono line under a product's name: where its work is and how much of
 *  it, or — with nothing running at all — how long it has been like that. */
export function line(p: MergedProject, now: number): string {
  if (p.running > 0) {
    const on = p.machines.join(', ');
    const one = p.running === 1;
    const agents = one ? '1 agent' : `${p.running} agents`;
    return p.unknown >= p.running
      ? `on ${on} · ${agents}, state unknown`
      : `on ${on} · ${agents}`;
  }
  if (dormant(p, now)) return `quiet for ${Math.floor(age(p, now)! / 86400)} days`;
  return 'nothing running';
}

/** The small mono line under a project card's corner, where there is one: when
 *  the machine its numbers came from last answered, or when its own stopped
 *  agents pick up again.
 *
 *  Null while everything about the product is current — the frames draw `live`
 *  there and this does not, because a line that says so on every card on every
 *  ordinary morning is a line nobody reads. */
export function freshness(p: MergedProject): string | null {
  if (p.stale) return p.lastSeen == null ? null : `last seen ${clock(p.lastSeen)}`;
  // The product's own clock and not the fleet's: on a fleet where one computer
  // is spent and another still has room, the fleet's figure belongs to the
  // machine that never stopped.
  if (p.paused > 0 && p.pausedUntil != null) return `resume ${clock(p.pausedUntil)}`;
  return null;
}

/** What git says about a product: how much landed in seven days, and when it
 *  last moved. Null where no repository of it could be read — absent rather than
 *  zero, because nobody measured it. (Web12 W1 draws a sparkline beside this
 *  figure; nothing carries a day-by-day history, so the panel draws the two
 *  numbers that exist and no chart of numbers that do not.) */
export function figure(p: MergedProject, now: number, ago: Ago):
  { value: number; label: string; moved: string } | null {
  if (!p.activity) return null;
  return {
    value: p.activity.week,
    label: 'finished · 7d',
    moved: p.activity.at == null ? 'no commits yet'
      : `moved ${ago(Math.max(0, now - p.activity.at))} ago`,
  };
}

/** Nothing running, and nothing committed for a fortnight. A product with no
 *  repository to read is never called dormant: not knowing is not the same as
 *  knowing nothing happened. */
export const DORMANT_AFTER_S = 14 * 24 * 3600;

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

/** The footer of a project card: the numbers the board's own marks stand for,
 *  counted off the cards in hand. A state nothing is in is left out. */
export function cardMarks(p: MergedProject): { mark: State; n: number }[] {
  const of = (test: (c: MergedProject['cards'][number]) => boolean) => p.cards.filter(test).length;
  return [
    { mark: 'stuck' as State, n: of(stuck) },
    { mark: 'asking' as State, n: of((c) => c.agent_status === 'asking') },
    { mark: 'yours' as State, n: of((c) => c.executor === 'human' && c.column === 'in_progress') },
    { mark: 'running' as State, n: of((c) => c.agent_status === 'running') },
  ].filter((m) => m.n > 0);
}

/** The one thing worth saying about a product in the corner of its card: the
 *  worst card's own line. Written by the mirror, so it is what the queue said
 *  rather than a sentence composed here — and empty where nothing has been
 *  said, in which case the card says nothing there. */
export function latest(p: MergedProject): string {
  const worst = p.cards.filter(stuck)[0]
    ?? p.cards.find((c) => c.agent_status === 'asking')
    ?? p.cards.find((c) => c.agent_status === 'running')
    ?? null;
  if (!worst) return '';
  return (worst.agent_detail || '').trim() || worst.title;
}

// ── the agent roster ────────────────────────────────────────────────────────

/** One line of "who is on what, where" (Web12 W1's right-hand column). */
export interface AgentRow {
  agent: MergedAgent;
  /** `●` at work, `◌` on a machine that has gone quiet, `⏸` stopped because the
   *  quota ran out. */
  mark: string;
  tone: Tone;
  who: string;
  /** Which project card's colour its monogram takes, so that one product is one
   *  hue down the whole page. -1 for an agent whose product is not in the list,
   *  which cannot happen and must not throw. */
  index: number;
}

export function agentRows(view: DivanView): AgentRow[] {
  const at = new Map(view.projects.map((p, i) => [p.key, i]));
  const spent = new Set(view.hosts.filter((h) => !h.stale && h.quota?.spent).map((h) => h.key));
  const rank = (r: AgentRow) => (r.mark === '◌' ? 0 : r.mark === '⏸' ? 1 : 2);
  return view.agents.map((agent) => ({
    agent,
    mark: agent.unknown ? '◌' : spent.has(agent.host) ? '⏸' : STATE_MARK.running,
    tone: (agent.unknown ? 'amber' : spent.has(agent.host) ? 'red' : 'run') as Tone,
    who: executorWord(agent.executor),
    index: at.has(agent.projectKey) ? at.get(agent.projectKey)! : -1,
  })).sort((a, b) => rank(a) - rank(b) || (b.agent.since ?? 0) - (a.agent.since ?? 0));
}

/** What one line of the roster says it is doing: its ticket, and either what it
 *  last said or how long it has been at it. A machine that has gone quiet says
 *  when it was last heard from instead of a duration that would go on growing. */
export function agentLine(row: AgentRow, now: number, ago: Ago): string {
  const detail = (row.agent.detail || '').trim();
  const when = row.agent.unknown
    ? `last seen ${clock(row.agent.since_contact)}`
    : row.agent.since == null ? '' : ago(Math.max(0, now - row.agent.since));
  return [row.agent.title, detail || when].filter(Boolean).join(' · ');
}

// ── one product, scoped to by the bar ───────────────────────────────────────

/** The states a product is in, as the board's own summary line reads them:
 *  `? 1 asking · ■ 1 stuck · ● 2 running`. Worst first, and a state nothing is
 *  in is left out — a calm product is quiet rather than three zeroes.
 *
 *  `asking` is what needs a person and is not stuck, so the two do not count the
 *  same card twice: a ticket that was turned down is red, and a ticket with a
 *  question on it is amber. */
export function marks(p: MergedProject): { state: State; label: string }[] {
  const out: { state: State; label: string }[] = [];
  const asking = Math.max(0, p.waiting - p.stuck);
  if (p.stuck > 0) out.push({ state: 'stuck', label: `${p.stuck} stuck` });
  if (asking > 0) out.push({ state: 'asking', label: `${asking} asking` });
  if (p.running > 0) out.push({ state: 'running', label: `${p.running} running` });
  return out;
}

/** The four columns, left to right, under the names the frames give them. */
export const COLUMN_LABEL: { key: DivanColumn; label: string }[] = [
  { key: 'ice_box', label: 'Ice Box' },
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

/** What a product's board adds up to. Read off the counts the machines sent and
 *  not counted off the cards in hand: the cards are the *open* board — the
 *  daemon leaves `done` out of them, because that column grows for ever — so
 *  counting them would say a product that shipped forty-eight things has
 *  shipped none. */
export function columnCounts(p: MergedProject): Record<DivanColumn, number> {
  const out: Record<DivanColumn, number> = { ice_box: 0, queued: 0, in_progress: 0, done: 0 };
  for (const c of COLUMN_LABEL) out[c.key] = p.counts[c.key] ?? 0;
  return out;
}

/** The one grey line under a product's name on the scoped page. Its own
 *  description where somebody wrote one; otherwise what can be said without
 *  inventing anything — what sort of thing it is, and how much work is on it. */
export function summaryOf(p: MergedProject): string {
  if (p.summary.trim()) return p.summary.trim();
  const bits: string[] = [];
  if (p.kind.trim()) bits.push(p.kind.trim());
  // Every card in hand is an open one; the finished ones are a number.
  const open = p.cards.length;
  if (open) bits.push(`${open} open card${open === 1 ? '' : 's'}`);
  else if (p.counts.done) bits.push('nothing open');
  return bits.length ? bits.join(' · ') : 'no description yet';
}
