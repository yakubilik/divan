// What one product's page says, decided away from the screen that draws it.
//
// The Dashboard answers "how is everything". This answers the question a person
// asks after tapping one chip in the project bar: **what is happening on this
// one, and what is it waiting for.** Two sentences, over its board.
//
// The same two rules the Dashboard is written under hold here, and they decide
// most of this file:
//
//   * **a machine that has gone quiet is said out loud.** A product checked out
//     on two computers has half its numbers from each; when one of them stops
//     answering the page says which, and how old what is on it is.
//
// Three states of the page are the ticket's own: a product at work (Mobile2 V4,
// Mobile7 S4), one nothing has touched in weeks (Mobile7 S5) and one whose board
// is still empty (Mobile7 S6). None of them is the busy page with things taken
// out of it — each is decided here, by name.
import { COLUMNS, spent, stuck, waiting, type DivanView, type MergedProject } from './divan';
import { age, asks, clock, dormant, executorKey, latest, staleFor,
         type Ago, type Said } from './dashboard';
import type { Key } from './i18n';
import type { State, Tone } from './tokens';

const DAY = 24 * 3600;

/** The mono line under a product's name: what sort of thing it is and what it is
 *  for, as the two were written down (Mobile2 V4's `SaaS · client portals for
 *  studios`, Mobile7 S4's `iOS · Android · five kanji a day`).
 *
 *  Content rather than words of ours, so it is not in the string table and it is
 *  not composed: both halves are what somebody typed, and a product that has
 *  neither has no line rather than a placeholder. */
export function subtitle(p: MergedProject): string {
  return [(p.kind || '').trim(), (p.summary || '').trim()].filter(Boolean).join(' · ');
}

/** What the meta line under a product's name is made of (HANDOVER §4.2):
 *  its stage as one word, the day it got there where somebody wrote that day
 *  down, and the machines it runs on — `live since 4 Jan 2026 · runs on
 *  mac-studio`. The stage is the person's word and goes in as written. */
export function meta(p: MergedProject): { stage: string; since: string | null; machines: string[] } {
  const stage = (p.stage || '').trim().toLowerCase();
  const reached = stage ? p.milestones.filter((m) => m.kind === stage).pop() : undefined;
  return { stage, since: reached ? day(reached.at) : null, machines: p.machines };
}

/** `4 Jan 2026`. */
export function day(at: number): string {
  return new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── the two lines at the top ────────────────────────────────────────────────

/** One sentence of a line. `who` is the executor it names, where it names one:
 *  the screen puts it into the gap in the reader's language, the way the
 *  Dashboard's questions do. Nothing here holds a sentence. */
export interface Clause {
  said: Said;
  who: Key | null;
}

/** One of the two rows — `now` or `waiting` — as the sentences it is made of and
 *  the tone of the mono label in front of them.
 *
 *  Several sentences rather than one, because the state of a product's agents is
 *  not always one fact: a product checked out on two computers can have an agent
 *  at work on one of them and an agent stopped on the other, and a row that
 *  picked the worse of the two and dropped the other would be the row that says
 *  "1 agent is running" on a page whose own project card reads `⏸ 1 paused`.
 *  Worst first, and all of it. */
export interface Line {
  clauses: Clause[];
  /** The colour of the mono label in front of it. Null is the ordinary grey. */
  tone: Tone | null;
}

/** What is happening on this product right now (Mobile7 S4's `now` row).
 *
 *  Three things can be true of a product's agents at once, and they are three
 *  different facts: some are at work, some were at work on a computer that has
 *  since gone quiet, and some are stopped where they stood because a machine ran
 *  out of quota. A product on two computers can be in all three states at the
 *  same moment.
 *
 *  So the row is every one of them that is true, worst first, and the order is
 *  `chip()`'s own (`src/dashboard.ts`): a machine that has gone quiet, then
 *  agents stopped for want of quota, then work actually running. The tone is the
 *  worst of them, which is the same word the product's card in the Dashboard's
 *  list puts in its corner — the two cannot disagree, because they are sorted by
 *  the same rule, and nothing is dropped to make them agree.
 *
 *  A single agent at work is named by what it is and what it is on; several are
 *  counted, because five names is a paragraph. The one named is picked from the
 *  agents that are *actually running* — not on a quiet machine and not on a spent
 *  one — so the sentence can never put "running on studio" against the title of
 *  a worker that is stopped there.
 *
 *  The machines are named in every clause: a product checked out on the studio
 *  and the mini is one product on two computers, and which ones is the fact a
 *  person needs before any of the numbers mean anything. */
export function nowWords(view: DivanView, p: MergedProject): Line {
  const on = p.machines.join(', ');
  const stopped = spent(view);
  // The agents of this product that nothing is keeping from working: not on a
  // machine that has gone quiet, and not on one with no quota left. `paused` and
  // `unknown` are the merge's counts of the other two, off the same two rules.
  const live = view.agents.filter((a) => a.projectKey === p.key && !a.unknown && !stopped.has(a.host));
  // …and the machines work could be running on at all: this product's computers
  // that are answering and still have quota. Every clause names the machines it
  // is actually about, and this is the running clause's set — one agent or five,
  // the sentence must not put work on a computer that has gone quiet or stopped.
  const working = view.hosts
    .filter((h) => p.hosts.includes(h.id) && !h.stale && !stopped.has(h.id))
    .map((h) => h.machine);
  const names = (list: string[]) => [...new Set(list)].filter(Boolean).join(', ');
  // The agents' own machines where there are agent rows to read them off, and the
  // answering computers otherwise — a daemon older than the agent list sends a
  // count and no rows.
  const busyOn = names(live.length ? live.map((a) => a.machine) : working);
  // What was last known, minus what cannot be vouched for: an agent on a silent
  // machine and one stopped on a spent machine are both still in `running`.
  const busy = Math.max(0, p.running - p.unknown - p.paused);
  const clauses: { said: Said; who: Key | null; tone: Tone }[] = [];

  if (p.unknown > 0) {
    const n = p.unknown;
    // The machines that went quiet, not every machine the product is on: an
    // agent that was running on the mini was not running on the studio, which is
    // answering and has its own clause below.
    const where = p.staleMachines.join(', ') || on;
    clauses.push({
      said: p.lastSeen == null
        ? { key: n === 1 ? 'prNowUnknownBareOne' : 'prNowUnknownBare', params: { n, on: where } }
        : { key: n === 1 ? 'prNowUnknownOne' : 'prNowUnknown',
            params: { n, on: where, time: clock(p.lastSeen) } },
      who: null, tone: 'amber',
    });
  }
  if (p.paused > 0) {
    const n = p.paused;
    // …and likewise the machines its stopped agents are stopped on, read off
    // those agents rather than off the fleet: on a product checked out on a spent
    // computer and a working one, only one of them stopped anything.
    const held = view.agents.filter((a) => a.projectKey === p.key && !a.unknown && stopped.has(a.host));
    const where = [...new Set(held.map((a) => a.machine))].filter(Boolean).join(', ') || on;
    clauses.push({
      said: p.pausedUntil == null
        ? { key: n === 1 ? 'prNowPausedBareOne' : 'prNowPausedBare', params: { n, on: where } }
        : { key: n === 1 ? 'prNowPausedOne' : 'prNowPaused',
            params: { n, on: where, time: clock(p.pausedUntil) } },
      who: null, tone: 'red',
    });
  }
  if (busy > 0 && busyOn) {
    // One agent is named by what it is and what it is on. A count with no agent
    // row behind it — an older daemon sends the figure and not the rows — is said
    // without a name rather than naming whatever agent came to hand, and in both
    // cases the machines are the ones the work could actually be on.
    const one = busy === 1 ? live[0] : undefined;
    const who = one ? executorKey(one.executor) : null;
    clauses.push({
      said: one && who
        ? { key: 'prNowOne', params: { who, title: one.title, machine: one.machine || busyOn } }
        : busy === 1 ? { key: 'prNowOneBare', params: { on: busyOn } }
        : { key: 'prNowMany', params: { n: busy, on: busyOn } },
      who, tone: 'run',
    });
  } else if (busy > 0 && !clauses.length) {
    // A running count with no computer left to be running on: every machine this
    // product is on has gone quiet or run out, and the figure came off one of
    // them before it did. That is not work in progress, it is a figure nobody can
    // vouch for, and it is said as one — never as work on a machine that stopped.
    clauses.push({
      said: { key: busy === 1 ? 'prNowUnknownBareOne' : 'prNowUnknownBare', params: { n: busy, on } },
      who: null, tone: 'amber',
    });
  }
  if (!clauses.length) {
    // Where it is running nothing, name the computers that are answering: a
    // product also checked out on a machine that has gone quiet cannot be said to
    // be running nothing there, and the sentence above this row says so.
    return { clauses: [{ said: { key: 'prNowIdle', params: { on: busyOn || on } }, who: null }], tone: null };
  }
  return { clauses: clauses.map(({ said, who }) => ({ said, who })), tone: clauses[0].tone };
}

/** …and what it is waiting for (the `waiting` row).
 *
 *  One thing waiting is named: which worker, and on what. Several are counted,
 *  and the tone is the worst of them — something that fell over is red where a
 *  question is amber, which is the same order the Dashboard reads its cards in.
 *  The order is `asks()`'s own, so the one named here is the one that screen
 *  would put at the top.
 *
 *  Nothing waiting is a sentence too, and it is the one the frame draws: a row
 *  that says so is worth more than a row that is not there. */
export function waitingWords(view: DivanView, p: MergedProject): Line {
  const list = asks(view).filter((a) => a.card.projectKey === p.key);
  const one = (said: Said, who: Key | null, tone: Tone | null): Line => ({ clauses: [{ said, who }], tone });
  if (!list.length) return one({ key: 'prWaitNothing' }, null, null);
  const worst: Tone = list.some((a) => a.state === 'stuck') ? 'red' : 'amber';
  if (list.length > 1) return one({ key: 'prWaitMany', params: { n: list.length } }, null, worst);
  const first = list[0];
  if (first.state === 'yours') {
    return one({ key: 'prWaitYours', params: { title: first.card.title } }, null, 'amber');
  }
  return one({ key: first.state === 'stuck' ? 'prWaitStuck' : 'prWaitAsking',
               params: { who: first.who, title: first.card.title } },
             first.who, first.state === 'stuck' ? 'red' : 'amber');
}

/** Which machine of this product's has gone quiet, and how old what is on the
 *  page therefore is (Mobile5 S1's sentence, scoped to one product).
 *
 *  Null while every machine it lives on is answering — which is the ordinary
 *  case, and a page that said so on every ordinary morning would be a page
 *  nobody read the top of. */
export function oldWords(p: MergedProject, now: number, ago: Ago): Said | null {
  if (!p.stale) return null;
  const d = ago(staleFor(p, now));
  if (p.staleMachines.length > 1) {
    return { key: 'prStaleMany', params: { n: p.staleMachines.length, time: clock(p.lastSeen) } };
  }
  const name = p.staleMachines[0] ?? '';
  return p.lastSeen == null
    ? { key: 'prStaleBare', params: { name } }
    : { key: 'prStale', params: { name, d, time: clock(p.lastSeen) } };
}

// ── the product nothing has touched in weeks ────────────────────────────────

/** Mobile7 S5: a fortnight with no agent, nothing waiting and no commit is not
 *  an error and not an empty page — it is a state, and it says how long it has
 *  been the case and what happened last.
 *
 *  Null unless that is true, and `dormant` is the Dashboard's own rule rather
 *  than a second spelling of it: the card in the project list and this block
 *  have to agree about which products are asleep.
 *
 *  The frame offers two ways out — open the board, ask Divan what is worth doing
 *  — and neither screen exists yet, so the block is the words alone. A button
 *  that leads nowhere is worse than no button. */
export function quiet(p: MergedProject, now: number, ago: Ago): { title: Said; body: Said } | null {
  if (!dormant(p, now)) return null;
  const since = age(p, now) ?? 0;
  const days = Math.floor(since / DAY);
  const shelved = (p.counts.ice_box || 0) + (p.counts.queued || 0);
  return {
    title: { key: 'prQuietTitle', params: { n: days } },
    body: shelved > 0
      ? { key: shelved === 1 ? 'prQuietBodyOne' : 'prQuietBodyCards',
          params: { n: shelved, d: ago(since) } }
      : { key: 'prQuietBody', params: { d: ago(since) } },
  };
}

// ── the product whose board is still empty ──────────────────────────────────

/** Mobile7 S6: a product created a minute ago, with its branches made and not
 *  one card on any of them. The frames make this a designed screen rather than
 *  an empty one, and this is the rule for when it is drawn: no card anywhere on
 *  the board, and nothing running or waiting to contradict that.
 *
 *  It is not the same thing as a dormant product, which has a history and has
 *  stopped. This one has no history at all. */
export function blank(p: MergedProject): boolean {
  return p.cards.length === 0 && p.running === 0 && p.waiting === 0
    && COLUMNS.every((col) => !(p.counts[col] || 0))
    && p.branches.every((b) => !(b.open || 0) && COLUMNS.every((col) => !(b.cards[col] || 0)));
}

/** …and what it says: how a first card is begun. */
export function blankBody(): Said {
  return { key: 'prNewBodyBare' };
}
