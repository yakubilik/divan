/** What one product's page and one branch's page say, kept out of the screens
 *  that draw them so `scripts/test-overview.mjs` can hold them to a board
 *  without a browser.
 *
 *  The Dashboard answers "how is everything". This answers the two questions
 *  after it: **what is happening on this product** (Web14 W6) and **what is
 *  happening on this face of it** (Web14 W7).
 *
 *  Two rules, and they are `lib/overview.ts`'s own:
 *
 *   · **no invented numbers.** The frames put a branch's own figures on its card
 *     — open PRs, 212/214 tests, `v3.18 deployed`, clicks in 28 days — and none
 *     of those sources is connected. What exists is the board: how much is open
 *     on a branch, how much is in progress, how much is finished. A branch
 *     nobody has put a card on draws none at all rather than three zeros, and a
 *     branch with no source behind it says so in words.
 *   · **a machine that has gone quiet is said out loud**, and its numbers are
 *     kept as what they were.
 *
 *  **It is the phone's `app/src/project.ts` in the panel's own words**, the way
 *  `lib/overview.ts` is the phone's dashboard: the phone keeps its sentences in
 *  a string table and every sentence here is that table's entry for the same
 *  key, character for character (`prNowIdle: 'Nothing is running on {on}.'`,
 *  `branchNoSource: 'no source connected yet'`, …). `scripts/test-overview.mjs`
 *  compiles both and compares them on the same board.
 */
import { COLUMNS, spent, stuck, waiting } from './divan';
import type { DivanView, MergedBranch, MergedCard, MergedProject } from './divan';
import type { DivanComment, DivanMilestone, DivanOpenState } from './protocol';
import { age, clock, dormant, executorWord, latest, staleFor, type Ago } from './overview';
import type { State, Tone } from './theme';

const DAY = 24 * 3600;

/** How many number slots a branch card has, whatever it has to put in them.
 *  Mobile7 S4's own note is explicit about it, and Web14 W6 draws the same three
 *  columns: the slots stay fixed, and a branch with two numbers leaves the third
 *  empty so the card still reads as complete rather than broken. */
export const SLOTS = 3;

/** A branch whose source last spoke longer ago than this says so in amber
 *  (Web14 W6's `3 days old`). Under a day it prints the clock and nothing else
 *  (`07:02 overnight`): a source that refreshed this morning is ordinary. */
export const BRANCH_OLD_AFTER_S = DAY;

// ── the two lines at the top ────────────────────────────────────────────────

/** One of the two rows — `now` or `waiting` — as the sentence it is made of and
 *  the tone of the mono label in front of it. Several sentences rather than one,
 *  because the state of a product's agents is not always one fact: a product on
 *  two computers can have an agent at work on one and an agent stopped on the
 *  other, and a row that picked the worse of the two would say "1 agent is
 *  running" on a page whose own card reads `⏸ 1 paused`. Worst first, and all of
 *  it. */
export interface Line {
  text: string;
  /** The colour of the mono label. Null is the ordinary grey. */
  tone: Tone | null;
}

/** What is happening on this product right now (Web14 W6's `now` row).
 *
 *  Three things can be true at once and they are three different facts: some
 *  agents are at work, some were at work on a computer that has since gone
 *  quiet, and some are stopped where they stood because a machine ran out of
 *  quota. The row is every one of them that is true, worst first, in `chip()`'s
 *  own order — so the tone is the same word the product's card in the Dashboard
 *  puts in its corner, and nothing is dropped to make the two agree.
 *
 *  The machines are named in every clause: which computers a product is checked
 *  out on is the fact a person needs before any of the numbers mean anything. */
export function nowLine(view: DivanView, p: MergedProject): Line {
  const on = p.machines.join(', ');
  const stopped = spent(view);
  // The agents of this product that nothing is keeping from working.
  const live = view.agents.filter((a) => a.projectKey === p.key && !a.unknown && !stopped.has(a.host));
  // …and the machines work could be running on at all: this product's computers
  // that are answering and still have quota.
  const working = view.hosts
    .filter((h) => p.hosts.includes(h.key) && !h.stale && !stopped.has(h.key))
    .map((h) => h.machine);
  const names = (list: string[]) => [...new Set(list)].filter(Boolean).join(', ');
  const busyOn = names(live.length ? live.map((a) => a.machine) : working);
  // What was last known, minus what cannot be vouched for.
  const busy = Math.max(0, p.running - p.unknown - p.paused);
  const clauses: Line[] = [];

  if (p.unknown > 0) {
    const n = p.unknown;
    // The machines that went quiet, not every machine the product is on.
    const where = p.staleMachines.join(', ') || on;
    clauses.push({
      text: p.lastSeen == null
        ? `${count(n)} running on ${where}, and nothing has been heard from it since.`
        : `${count(n)} running on ${where}, which has not answered since ${clock(p.lastSeen)}.`,
      tone: 'amber',
    });
  }
  if (p.paused > 0) {
    const n = p.paused;
    const held = view.agents.filter((a) => a.projectKey === p.key && !a.unknown && stopped.has(a.host));
    const where = names(held.map((a) => a.machine)) || on;
    clauses.push({
      text: p.pausedUntil == null
        ? `${n === 1 ? '1 agent' : `${n} agents`} on ${where} ${n === 1 ? 'is' : 'are'} stopped`
          + ` where ${n === 1 ? 'it stood' : 'they stood'}: the quota ran out.`
        : `${n === 1 ? '1 agent' : `${n} agents`} on ${where} ${n === 1 ? 'is' : 'are'} stopped`
          + ` until ${clock(p.pausedUntil)}: the quota ran out.`,
      tone: 'red',
    });
  }
  if (busy > 0 && busyOn) {
    // One agent is named by what it is and what it is on; several are counted,
    // because five names is a paragraph. A count with no agent row behind it —
    // an older daemon sends the figure and not the rows — is said without a name
    // rather than naming whatever agent came to hand.
    const one = busy === 1 ? live[0] : undefined;
    clauses.push({
      text: one
        ? `${executorWord(one.executor)} is on ${one.title}, running on ${one.machine || busyOn}.`
        : busy === 1 ? `1 agent is running on ${busyOn}.`
        : `${busy} agents are running on ${busyOn}.`,
      tone: 'run',
    });
  } else if (busy > 0 && !clauses.length) {
    // A running count with no computer left to be running on: every machine
    // this product is on has gone quiet or run out, and the figure came off one
    // of them before it did. That is a figure nobody can vouch for, and it is
    // said as one — never as work on a machine that stopped.
    clauses.push({ text: `${count(busy)} running on ${on}, and nothing has been heard from it since.`,
                   tone: 'amber' });
  }
  if (!clauses.length) return { text: `Nothing is running on ${busyOn || on}.`, tone: null };
  return { text: clauses.map((c) => c.text).join(' '), tone: clauses[0].tone };
}

/** `1 agent was` / `3 agents were`, which is the one gap the two unknown
 *  clauses share. */
function count(n: number): string {
  return n === 1 ? '1 agent was' : `${n} agents were`;
}

/** …and what the product is waiting for (the `waiting` row).
 *
 *  One thing waiting is named: which worker, and on what. Several are counted,
 *  and the tone is the worst of them — something that fell over is red where a
 *  question is amber. Nothing waiting is a sentence too, and it is the one the
 *  frame draws: a row that says so is worth more than a row that is not there. */
export function waitingLine(p: MergedProject): Line {
  // Worst first, then whichever has waited longest — the order the Dashboard
  // reads the same cards in (`lib/sessions.ts`), so the one named here is the
  // one that screen would put at the top.
  const rank = (c: MergedCard) => (stuck(c) ? 0 : c.agent_status === 'asking' ? 1 : 2);
  const list = p.cards.filter(waiting).sort((a, b) => rank(a) - rank(b)
    || (b.agent_status_at ?? 0) - (a.agent_status_at ?? 0)
    || a.title.localeCompare(b.title));
  if (!list.length) return { text: 'Nothing is waiting on you.', tone: null };
  const worst: Tone = list.some(stuck) ? 'red' : 'amber';
  if (list.length > 1) return { text: `${list.length} things are waiting on you.`, tone: worst };
  const one = list[0];
  const who = executorWord(one.executor);
  if (one.executor === 'human') return { text: `Yours to do: ${one.title}.`, tone: 'amber' };
  return stuck(one)
    ? { text: `${who} has stopped: ${one.title}.`, tone: 'red' }
    : { text: `${who} is waiting for an answer: ${one.title}.`, tone: 'amber' };
}

/** Which machine of this product's has gone quiet, and how old what is on the
 *  page therefore is. Null while every machine it lives on is answering — the
 *  ordinary case, and a page that said so every ordinary morning would be a page
 *  nobody read the top of. */
export function oldLine(p: MergedProject, now: number, ago: Ago): string | null {
  if (!p.stale) return null;
  if (p.staleMachines.length > 1) {
    return `${p.staleMachines.length} of its machines have not answered.`
      + ` What follows is as it was at ${clock(p.lastSeen)}.`;
  }
  const name = p.staleMachines[0] ?? '';
  return p.lastSeen == null
    ? `${name} has never answered, so part of this product is not on this page.`
    : `${name} has not answered for ${ago(staleFor(p, now))}.`
      + ` What follows is as it was at ${clock(p.lastSeen)}.`;
}

// ── the product nothing has touched in weeks ────────────────────────────────

/** A fortnight with no agent, nothing waiting and no commit is not an error and
 *  not an empty page — it is a state, and it says how long it has been the case.
 *  Null unless that is true, and the rule is the Dashboard's own (`dormant`)
 *  rather than a second spelling of it: the card in the project list and this
 *  block have to agree about which products are asleep. */
export function quiet(p: MergedProject, now: number, ago: Ago):
  { title: string; body: string } | null {
  if (!dormant(p, now)) return null;
  const since = age(p, now) ?? 0;
  const shelved = (p.counts.ice_box || 0) + (p.counts.queued || 0);
  return {
    title: `Quiet for ${Math.floor(since / DAY)} days.`,
    body: shelved > 0
      ? `No agents are running. ${shelved === 1 ? 'One card is' : `${shelved} cards are`} waiting`
        + ` on the board, and the last commit was ${ago(since)} ago.`
      : `No agents are running, nothing is queued, and the last commit was ${ago(since)} ago.`,
  };
}

// ── the product whose board is still empty ──────────────────────────────────

/** A product created a minute ago, with its branches made and not one card on
 *  any of them. It is not a dormant product — that one has a history and has
 *  stopped; this one has no history at all. */
export function blank(p: MergedProject): boolean {
  return p.cards.length === 0 && p.running === 0 && p.waiting === 0
    && COLUMNS.every((col) => !(p.counts[col] || 0))
    && p.branches.every((b) => !(b.open || 0) && COLUMNS.every((col) => !(b.cards[col] || 0)));
}

/** …and what it says. The branches are named in it: a product whose five faces
 *  are already made is not a blank page, and reading their names is how a person
 *  sees where the first card would go. */
export function blankBody(p: MergedProject): string {
  const names = p.branches.map((b) => b.name || b.kind).filter(Boolean);
  return names.length
    ? `Nothing is on it yet. The branches are ready — ${names.join(', ')} — and a card needs a`
      + ' title and a couple of sentences to begin.'
    : 'Nothing is on it yet. A card needs a title and a couple of sentences to begin.';
}

// ── a branch ────────────────────────────────────────────────────────────────

/** What a branch says when nothing is connected behind it, which is every
 *  branch but engineering until the sources arrive. */
export const NO_SOURCE = 'no source connected yet';

/** One number on a branch card: what it is, and what it is of. Always a count
 *  off the board. */
export interface Figure {
  value: number;
  label: string;
}

/** One card of the branch grid (Web14 W6), and the head of a branch's own page
 *  (Web14 W7). */
export interface BranchCard {
  key: string;
  /** The kind, which is what a card carries and what a branch is addressed by. */
  kind: string;
  name: string;
  /** The 8 pt dot in front of the name: the worst thing true of its cards. */
  state: State;
  /** The line of status: the branch's own summary, or the line off the card that
   *  needs attention, or — with neither — that nothing is connected to it. */
  line: string;
  /** …and whether that line is ours rather than something somebody wrote, which
   *  is what a screen needs to know before it quotes it. */
  sourceless: boolean;
  /** Two or three numbers, left to right, in three fixed slots. */
  figures: Figure[];
  /** When its source last refreshed, and whether that is long enough ago to be
   *  worth an amber word. Null where nothing has ever refreshed it.
   *
   *  The phone draws a card whose source has been silent for a week at four
   *  fifths as well (Mobile7 S5); no desktop frame draws a faded card, and the
   *  panel's own rule is grey rather than faint — a fade is the one thing the
   *  palette cannot make legible — so the age is said in the amber word and
   *  nowhere else. */
  refreshed: { text: string; tone: Tone | null } | null;
}

/** The branches of a product, in the order the computer keeps them, each as a
 *  card. The order is deliberately not by urgency: five branches are a fixed set
 *  of faces a person learns the position of, and a grid that reshuffles itself
 *  every time a card moves is one nobody can read at a glance. */
export function branchCards(p: MergedProject, now: number): BranchCard[] {
  return p.branches.map((b) => {
    const mine = cardsOn(p, b.kind);
    const wrote = (b.summary || '').trim();
    const said = wrote ? '' : latest(mine);
    return {
      key: b.id || b.kind,
      kind: b.kind,
      name: b.name || b.kind,
      state: branchState(mine),
      line: wrote || said || NO_SOURCE,
      sourceless: !wrote && !said,
      figures: figures(b),
      refreshed: refreshed(b, now),
    };
  });
}

/** The cards of a product that are on one of its faces. The card carries the
 *  branch's kind and not its id — two machines give one face two ids — so this
 *  is the one join between the two. */
export function cardsOn(p: MergedProject, kind: string): MergedCard[] {
  return p.cards.filter((c) => c.branch === kind);
}

/** One branch of a product by the kind a screen is holding, or null where the
 *  product no longer has that face — a machine that has been unpaired. */
export function branchOf(p: MergedProject, kind: string | null): MergedBranch | null {
  if (!kind) return null;
  return p.branches.find((b) => b.kind === kind || b.id === kind) ?? null;
}

/** The dot in front of a branch's name: the worst thing true of the cards on it.
 *  The same vocabulary the project chips use, read off the cards through the
 *  merge's own two rules (`stuck`, `waiting`) rather than a second spelling. */
export function branchState(cards: MergedCard[]): State {
  if (cards.some(stuck)) return 'stuck';
  if (cards.some(waiting)) return 'asking';
  if (cards.some((c) => c.agent_status === 'running')) return 'running';
  return 'quiet';
}

/** A branch's numbers: what is open on it, what is in progress, what is done.
 *
 *  `open` and `done` are always drawn, zero included — a branch with nothing
 *  open and eleven done is finished, and saying so in two honest zeros beats an
 *  empty slot. `in progress` is drawn only when something is, which is the
 *  frames' two-number card: the third slot stays empty and the card still reads
 *  as complete. A branch nobody has ever put a card on has no numbers at all;
 *  three zeros there would be a measurement of nothing. */
export function figures(b: MergedBranch): Figure[] {
  const held = COLUMNS.reduce((n, col) => n + (b.cards[col] || 0), 0);
  if (!held && !(b.open || 0)) return [];
  const progress = b.cards.in_progress || 0;
  return [
    { value: b.open || 0, label: 'open' },
    ...(progress > 0 ? [{ value: progress, label: 'in progress' }] : []),
    { value: b.cards.done || 0, label: 'done' },
  ];
}

/** When a branch's source last said anything, in the corner of its card: the
 *  clock while it is today's (`07:02`), and the age in amber once it is older
 *  than a day (`3 days old`).
 *
 *  Null where nothing has ever written a summary for that branch, which is most
 *  of them until the sources are connected — the card then says so on its status
 *  line, and an invented `live` in the corner would contradict it. */
export function refreshed(b: MergedBranch, now: number): { text: string; tone: Tone | null } | null {
  if (b.summary_at == null) return null;
  const since = Math.max(0, now - b.summary_at);
  if (since < BRANCH_OLD_AFTER_S) return { text: clock(b.summary_at), tone: null };
  const days = Math.floor(since / DAY);
  return { text: days <= 1 ? 'yesterday' : `${days} days old`, tone: 'amber' };
}

// ── a branch's own page ─────────────────────────────────────────────────────

/** The repositories a branch's work happens in (Web14 W7's first block).
 *
 *  A card names the repository it runs in and the machine it runs on; the
 *  product's own list is what is left where no card on this face names one. Git
 *  is read per repository by the daemon and folded per *product* by the merge,
 *  so there is no per-repository figure to put at the end of these rows and none
 *  is drawn — the frame's `✓ checks` and `× 2 failing` have no source. */
export interface RepoRow {
  path: string;
  /** The last segment, which is what a screen shows: this page is a screenshot
   *  away from being public. */
  name: string;
  machines: string[];
}

export function repoRows(p: MergedProject, kind: string): RepoRow[] {
  const mine = cardsOn(p, kind);
  const paths = new Set(mine.map((c) => (c.repo || '').trim()).filter(Boolean));
  const list = paths.size ? [...paths] : p.repos.filter(Boolean);
  return list.sort().map((path) => ({
    path,
    name: path.split(/[/\\]/).filter(Boolean).pop() || path,
    machines: [...new Set(mine.filter((c) => c.repo === path).map((c) => c.machine))]
      .filter(Boolean).sort(),
  }));
}

/** What has been said on a branch lately, newest first: the line the mirror
 *  wrote on each of its cards, with the moment it wrote it. A card nothing has
 *  been said about is not a line — the point of the list is what happened, not
 *  which cards exist. `kind` null is the whole product, which is the same
 *  question asked of every face at once. */
export interface Happened {
  at: number | null;
  text: string;
  card: MergedCard;
}

export function happened(p: MergedProject, kind: string | null): Happened[] {
  return (kind == null ? p.cards : cardsOn(p, kind))
    .filter((c) => (c.agent_detail || '').trim())
    .sort((a, b) => (b.agent_status_at ?? 0) - (a.agent_status_at ?? 0))
    .map((c) => ({ at: c.agent_status_at, text: (c.agent_detail || '').trim(), card: c }));
}

// ── where a product is in its life ──────────────────────────────────────────

/** The rail across the top of a product's page, in the order it is drawn. The
 *  five are fixed and they are the daemon's own (`divan.py STAGES`): a rail with
 *  a sixth step would be a rail nobody could read at a glance, and a product
 *  that is none of them is a product nobody has said, which draws no rail. */
export const STAGES = ['idea', 'build', 'beta', 'live', 'growth'] as const;

export type Stage = typeof STAGES[number];

export interface Step {
  key: Stage;
  label: string;
  /** Behind it, or the one it is on: the rail is filled up to here. */
  passed: boolean;
  here: boolean;
}

/** The rail, or null on a product whose stage nobody has written. Null and not
 *  five empty steps: a rail with nothing filled reads as "this product has got
 *  nowhere", which is a claim, and the honest answer is that nobody has said. */
export function rail(p: MergedProject): Step[] | null {
  const at = STAGES.indexOf((p.stage || '') as Stage);
  if (at < 0) return null;
  return STAGES.map((key, i) => ({
    key,
    label: key[0].toUpperCase() + key.slice(1),
    passed: i <= at,
    here: i === at,
  }));
}

/** `14 Mar 2026`, the way the frame writes a date: short month, no comma. */
export function day(at: number | null | undefined): string {
  if (at == null || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `Mar 2026`, for the head of the timeline. */
export function month(at: number | null | undefined): string {
  if (at == null || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** How long ago, in the units a product's life is measured in: `1 yr 6 mo`,
 *  `4 mo`, `12 days`, `today`. Not `uptime`, which counts in days and hours
 *  because it is for machines that have been up since Tuesday. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / DAY);
  if (days < 1) return 'today';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

/** One of the three things said beside the rail: what it is, what it says, and
 *  the small line under it. */
export interface Fact {
  key: string;
  label: string;
  value: string;
  /** The grey line under the value — how long ago, what version, how far off.
   *  Null where there is nothing more to say than the date. */
  note: string | null;
  tone: Tone | null;
}

/** `Started`, `Live since` and `Next milestone`, and only the ones that are
 *  true. A product nobody has given a start date has no Started tile — an
 *  invented one would be the one number on this page nobody could check — and a
 *  product with nothing promised has no Next tile rather than an empty one.
 *
 *  `Live since` is read off the milestone marked `live` and off nothing else:
 *  the stage rail says a product is live, and the *day* it became so is a fact
 *  somebody wrote down. A product in `live` with no such milestone says so with
 *  its stage and leaves the tile out. */
export function facts(p: MergedProject, now: number): Fact[] {
  const out: Fact[] = [];
  const history = milestones(p);
  if (p.started_at != null) {
    out.push({
      key: 'started', label: 'Started', value: day(p.started_at),
      note: `${span(now - p.started_at)} ago`, tone: null,
    });
  }
  const live = history.find((m) => m.kind === 'live');
  if (live) {
    out.push({
      key: 'live', label: 'Live since', value: day(live.at), note: live.title, tone: null,
    });
  }
  const next = history.find((m) => m.at > now);
  if (next) {
    const away = span(next.at - now);
    out.push({
      key: 'next', label: 'Next milestone', value: day(next.at),
      note: `${next.title} · ${away === 'today' ? 'today' : `in ${away}`}`,
      tone: next.at - now < 7 * DAY ? 'amber' : null,
    });
  }
  return out;
}

/** A product's history, oldest first, as the daemon keeps it — sorted here too,
 *  because two machines' copies of one product arrive in whichever order they
 *  were written. */
export function milestones(p: MergedProject): DivanMilestone[] {
  return [...(p.milestones || [])].sort((a, b) => a.at - b.at);
}

// ── what is happening on it right now ───────────────────────────────────────

/** One line of the `Right now` panel: a thing that is actually happening on
 *  this product, with the word for what kind of happening it is. */
export interface Process {
  key: string;
  /** The mono label in front: `Running`, `Waiting for you`, `Stopped`… */
  label: string;
  tone: Tone;
  title: string;
  /** The two lines under it: what the agent last said, or what the card is. */
  body: string;
  /** The right-hand corner: how long it has been this way. Empty where nothing
   *  ever stamped it — a card nobody has touched has no clock. */
  since: string;
  /** The card it is, so a press can open it. */
  card: MergedCard;
}

/** Everything happening on a product, worst first.
 *
 *  It is the board read as *events* rather than as columns, which is the whole
 *  of the difference between this panel and the Board tab: a card sitting in
 *  Queued is not happening and is not in here, and a card whose agent stopped
 *  at four in the morning is, however tidy the column it sits in looks.
 *
 *  Three things count as happening, and nothing else does: an agent is working
 *  on it, it is waiting for a person, or a person has it in progress. The order
 *  is the one the Dashboard reads the same cards in — stopped, then asking, then
 *  running, then a person's own work — so the line at the top of this panel is
 *  the line that screen would have put at the top. */
export function processes(p: MergedProject, now: number, ago: Ago): Process[] {
  const rank = (c: MergedCard) => (stuck(c) ? 0
    : c.agent_status === 'asking' ? 1
    : c.agent_status === 'running' ? 2 : 3);
  const mine = p.cards.filter((c) => stuck(c) || waiting(c)
    || c.agent_status === 'running'
    || (c.column === 'in_progress' && c.executor === 'human'));
  return mine
    .sort((a, b) => rank(a) - rank(b)
      || (b.agent_status_at ?? 0) - (a.agent_status_at ?? 0)
      || a.title.localeCompare(b.title))
    .map((c) => {
      const said = (c.agent_detail || '').trim();
      const stamp = c.agent_status_at ?? c.moved_at ?? null;
      return {
        key: c.id,
        ...word(c),
        title: c.title,
        body: said || (c.summary || '').trim() || NOTHING_SAID,
        since: stamp == null ? '' : ago(Math.max(0, now - stamp)),
        card: c,
      };
    });
}

/** What a card with nothing written on it says under its title. */
export const NOTHING_SAID = 'nothing has been said about it yet';

/** The label and its colour: what kind of happening this card is. The words are
 *  the ones the rest of the product already uses for these states — a card that
 *  reads `asking` on the board does not become `question` here. */
function word(c: MergedCard): { label: string; tone: Tone } {
  if (stuck(c)) return { label: 'Stopped', tone: 'red' };
  if (c.agent_status === 'asking') return { label: 'Waiting for you', tone: 'amber' };
  if (c.executor === 'human' && c.agent_status !== 'running') {
    return { label: 'Yours to do', tone: 'amber' };
  }
  return { label: 'Running', tone: 'run' };
}

// ── …and what it has been through ───────────────────────────────────────────

/** One line of the timeline: a date, a thing, and whether it has happened. */
export interface Moment {
  key: string;
  at: number;
  /** `30 Sep 2026`, or `Today` for the line that marks now. */
  date: string;
  title: string;
  note: string;
  kind: string;
  /** It has not happened yet: drawn as a ring and in grey. */
  future: boolean;
  /** The one line that is not a milestone at all: where now sits. */
  today: boolean;
}

/** A product's history as the page reads it: newest first, with today in its
 *  place among the entries.
 *
 *  Newest first because the question the page is for is "what is going on",
 *  and the answer to that is at the top. Today is a line of its own rather than
 *  a marker on the nearest entry: what a person is looking for on this list is
 *  the gap between the last thing that happened and the next thing promised,
 *  and that gap is only visible when now has a place in the list.
 *
 *  Empty on a product whose history nobody has written: the panel then says so
 *  in words rather than drawing a line with one dot on it. */
export function timeline(p: MergedProject, now: number): Moment[] {
  const history = milestones(p);
  if (!history.length) return [];
  const rows: Moment[] = history.map((m) => ({
    key: m.id, at: m.at, date: day(m.at), title: m.title, note: m.note,
    kind: m.kind, future: m.at > now, today: false,
  }));
  rows.push({ key: 'today', at: now, date: day(now), title: 'Today', note: '',
              kind: '', future: false, today: true });
  return rows.sort((a, b) => b.at - a.at || (a.today ? 1 : -1));
}

/** `since Mar 2026` — the head of the panel, which is the oldest thing on it.
 *  Null where there is no history to be since. */
export function since(p: MergedProject): string | null {
  const first = milestones(p)[0];
  return first ? `since ${month(first.at)}` : null;
}

/** The meta line under a product's name (HANDOVER §4.2): its stage as one
 *  word — with the day it got there, where somebody wrote that day down — and
 *  the machines it runs on. `live since 4 Jan 2026 · runs on mac-studio`. A
 *  product nobody has given a stage says only where it runs. */
export function metaLine(p: MergedProject): string {
  const stage = (p.stage || '').trim().toLowerCase();
  const reached = stage ? milestones(p).filter((m) => m.kind === stage).pop() : undefined;
  return [
    stage ? (reached ? `${stage} since ${day(reached.at)}` : stage) : '',
    p.machines.length ? `runs on ${p.machines.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

/** The sentence a branch with no source behind it says instead of a number. */
export const NOT_CONNECTED = 'Source not connected yet.';

/** Whether anything feeds a branch: something has written its summary, or —
 *  for engineering — the product has a repository to read. */
export function connected(p: MergedProject, b: MergedBranch): boolean {
  return !!(b.summary || '').trim() || b.summary_at != null
    || (b.kind.toLowerCase() === 'engineering' && p.repos.length > 0);
}

// ── …and what it has not done yet ───────────────────────────────────────────

/** What a product is still waiting on, as the page draws it.
 *
 *  This is the half of a product nothing on this computer used to write down.
 *  The board holds work an agent can be handed; these are the things that
 *  cannot be — a token somebody has to make in a browser, a registrar sitting
 *  on a domain, a decision nobody has taken — and without them a product could
 *  read `closed beta` with nobody able to say what the beta was waiting for.
 */
export interface OpenRow {
  key: string;
  id: string;
  title: string;
  body: string;
  state: DivanOpenState;
  /** `Blocked`, `Waiting on Sam`, `To do`, `Done`. */
  label: string;
  tone: Tone;
  /** The small word for what it is about: `payments`. Empty where none. */
  area: string;
  comments: DivanComment[];
  /** `3 notes`, or empty where nobody has said anything. */
  thread: string;
  /** How long it has been open, or when it closed. */
  since: string;
  done: boolean;
}

const OPEN_LABEL: Record<DivanOpenState, string> = {
  blocked: 'Blocked', waiting: 'Waiting', todo: 'To do', done: 'Done',
};

const OPEN_TONE: Record<DivanOpenState, Tone> = {
  blocked: 'red', waiting: 'amber', todo: 'ink2', done: 'run',
};

export function openRows(p: MergedProject, now: number, ago: Ago): OpenRow[] {
  return (p.open ?? []).map((o) => {
    const state = (OPEN_LABEL[o.state] ? o.state : 'todo') as DivanOpenState;
    // Who it is on belongs in the label rather than beside it: "Waiting" alone
    // is the fact nobody can act on, and "Waiting on Sam" is the one that
    // tells you whether to go and ask.
    const label = state === 'waiting' && o.owner ? `Waiting on ${o.owner}`
      : state === 'todo' && o.owner ? `${o.owner} to do`
      : OPEN_LABEL[state];
    const at = state === 'done' ? (o.closed_at ?? o.updated_at) : o.created_at;
    return {
      key: o.id,
      id: o.id,
      title: o.title,
      body: o.body,
      state,
      label,
      tone: OPEN_TONE[state],
      area: o.area,
      comments: o.comments ?? [],
      thread: o.comments?.length
        ? `${o.comments.length} note${o.comments.length === 1 ? '' : 's'}` : '',
      since: at ? `${state === 'done' ? 'closed' : 'open'} ${forDays(now - at, ago)}` : '',
      done: state === 'done',
    };
  });
}

/** How long, in the unit that matters. These are measured in days and weeks —
 *  a key nobody has made is a fortnight, not `9d 0h` — and the hours are only
 *  worth saying on the first day. */
function forDays(seconds: number, ago: Ago): string {
  const days = Math.floor(Math.max(0, seconds) / 86_400);
  return days ? `${days} day${days === 1 ? '' : 's'}` : ago(Math.max(0, seconds));
}

/** The line beside the heading: what is stopping work, and what is merely
 *  waiting. Nothing where a product has none of either — a count of zero is a
 *  number nobody wanted. */
export function openLine(rows: OpenRow[]): string {
  const n = (state: DivanOpenState) => rows.filter((r) => r.state === state).length;
  const parts = [
    n('blocked') ? `${n('blocked')} blocked` : '',
    n('waiting') ? `${n('waiting')} waiting` : '',
    n('todo') ? `${n('todo')} to do` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** What a product with an empty list says. Not "nothing to do": nobody has
 *  written anything down, which on a product with eight months behind it is
 *  almost certainly not the same thing. */
export const NOTHING_OPEN =
  'Nothing is written down here yet. This is where the things an agent cannot do go —'
  + ' a token to make, an approval to chase, a decision nobody has taken.';
