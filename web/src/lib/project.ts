/** What one product's page says, kept out of the screen that draws it so
 *  `scripts/test-overview.mjs` can hold it to a board without a browser.
 *
 *  The Dashboard answers "how is everything". This answers the question after
 *  it: **what is happening on this product** (Web14 W6). A product's branches
 *  are not drawn in the panel any more, so nothing here judges one.
 *
 *  Two rules, and they are `lib/overview.ts`'s own:
 *
 *   · **no invented numbers.** Every figure is a count off the board.
 *   · **a machine that has gone quiet is said out loud**, and its numbers are
 *     kept as what they were.
 *
 *  **It is the phone's `app/src/project.ts` in the panel's own words**, the way
 *  `lib/overview.ts` is the phone's dashboard: the phone keeps its sentences in
 *  a string table and every sentence here is that table's entry for the same
 *  key, character for character (`prNowIdle: 'Nothing is running on {on}.'`,
 *  …). `scripts/test-overview.mjs` compiles both and compares them on the same
 *  board.
 */
import { COLUMNS, spent, stuck, waiting } from './divan';
import type { DivanView, MergedCard, MergedProject } from './divan';
import type { DivanComment, DivanMilestone, DivanOpenState } from './protocol';
import { age, clock, dormant, executorWord, staleFor, type Ago } from './overview';
import type { Tone } from './theme';

const DAY = 24 * 3600;

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

/** …and what it says. The branches used to be named in it; with no branch
 *  drawn anywhere, naming them would point at something the page does not show. */
export function blankBody(): string {
  return 'Nothing is on it yet. A card needs a title and a couple of sentences to begin.';
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

/** What each step means in the words people use for it: `build` is the product
 *  in development and `beta` is it being tried by people before it is live.
 *  Said under the rail so that the daemon's one-word stages read without a
 *  glossary — and kept off the ticket words (`running`, `testing`, `review`),
 *  which are where one card is, not where the product is. */
export const STAGE_MEANS: Record<Stage, string> = {
  idea: 'Not built yet',
  build: 'In development',
  beta: 'In beta, tried by people before launch',
  live: 'Live for its users',
  growth: 'Live and growing',
};

/** Where a product stands, as the stage card draws it: on the rail, with
 *  nobody having said, or with a word the rail does not have. The last two draw
 *  no bars at all — five empty steps would claim the product has got nowhere,
 *  and a guessed step would be a stage nobody gave it. */
export type Standing =
  | { kind: 'set'; stage: Stage; label: string; means: string; steps: Step[];
      /** `3 of 5`: which step, not how complete the product is. */
      position: string }
  | { kind: 'unset' }
  | { kind: 'unknown'; word: string };

export function standing(p: MergedProject): Standing {
  const word = (p.stage || '').trim().toLowerCase();
  if (!word) return { kind: 'unset' };
  const steps = rail({ ...p, stage: word });
  const here = steps?.find((s) => s.here);
  if (!steps || !here) return { kind: 'unknown', word };
  return {
    kind: 'set', stage: here.key, label: here.label, means: STAGE_MEANS[here.key], steps,
    position: `step ${STAGES.indexOf(here.key) + 1} of ${STAGES.length}`,
  };
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
