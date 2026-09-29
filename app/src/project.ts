// What one product's page says, decided away from the screen that draws it.
//
// The Dashboard answers "how is everything". This answers the question a person
// asks after tapping one chip in the project bar: **what is happening on this
// one, and what is it waiting for.** Two sentences and then its branches — the
// faces a product has beside its code (engineering, seo, analytics, marketing,
// customers, and whatever else somebody named), each as a card with a line of
// status, its numbers, and when it was last refreshed.
//
// The same two rules the Dashboard is written under hold here, and they decide
// most of this file:
//
//   * **no invented numbers.** The frames put a branch's own figures on its card
//     — open PRs, crash-free sessions, clicks in 28 days, a newsletter list —
//     and none of those sources is connected (the plan puts them after the
//     screens). What exists is the board: how much is open on a branch, how much
//     of it is in progress, how much is finished. Those are the numbers drawn,
//     and a branch nobody has put a card on draws none at all rather than three
//     zeros.
//   * **a machine that has gone quiet is said out loud.** A product checked out
//     on two computers has half its numbers from each; when one of them stops
//     answering the page says which, and how old what is on it is.
//
// Three states of the page are the ticket's own: a product at work (Mobile2 V4,
// Mobile7 S4), one nothing has touched in weeks (Mobile7 S5) and one whose board
// is still empty (Mobile7 S6). None of them is the busy page with things taken
// out of it — each is decided here, by name.
import { COLUMNS, stuck, waiting, type DivanView, type MergedBranch, type MergedCard,
         type MergedProject } from './divan';
import { age, asks, clock, dormant, executorKey, latest, staleFor,
         type Ago, type Said } from './dashboard';
import type { Key } from './i18n';
import type { State, Tone } from './tokens';

const DAY = 24 * 3600;

/** How many number slots a branch card has, whatever it has to put in them.
 *  Mobile7 S4's own note is explicit about it: the slots stay fixed at three
 *  columns, and a branch with only two numbers leaves the third empty "so the
 *  card still reads as complete rather than broken". */
export const SLOTS = 3;

/** A branch whose source last spoke longer ago than this says so in amber
 *  (Mobile7 S4's `2 days old`, S5's `23 days old`). Under a day it prints the
 *  clock and nothing else: a source that refreshed this morning is ordinary. */
export const BRANCH_OLD_AFTER_S = DAY;

/** …and one that has not been refreshed in a week is drawn faintly as well
 *  (Mobile7 S5 dims its SEO and Marketing cards and leaves Analytics, which ran
 *  overnight, at full strength). A fortnight is the product's own dormancy; a
 *  week is a branch's, because a branch is meant to be refreshed daily. */
export const BRANCH_DIM_AFTER_S = 7 * DAY;

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

// ── the two lines at the top ────────────────────────────────────────────────

/** One of them: `now` or `waiting`, in words, with the tone the label takes and
 *  — where the sentence names an executor — which one. The screen puts `who`
 *  into the gap in the reader's language, the way the Dashboard's questions do;
 *  nothing here holds a sentence. */
export interface Line {
  said: Said;
  who: Key | null;
  /** The colour of the mono label in front of it. Null is the ordinary grey. */
  tone: Tone | null;
}

/** What is happening on this product right now (Mobile7 S4's `now` row).
 *
 *  Worst-to-plainest, and every one of them counted: agents at work, agents on a
 *  machine that has gone quiet, agents stopped because the quota ran out, and
 *  nothing running at all. The machines are named in every case — a product
 *  checked out on the studio and the mini is one product on two computers, and
 *  which ones is the fact a person needs before any of the numbers mean
 *  anything.
 *
 *  A single agent is named by what it is and what it is on; several are counted,
 *  because five names is a paragraph. */
export function nowWords(view: DivanView, p: MergedProject): Line {
  const on = p.machines.join(', ');
  const mine = view.agents.filter((a) => a.projectKey === p.key);
  // What was last known, minus what cannot be vouched for: an agent on a silent
  // machine and one stopped on a spent machine are both still in `running`.
  const busy = Math.max(0, p.running - p.unknown - p.paused);
  if (busy > 0) {
    const one = mine.find((a) => !a.unknown);
    if (busy === 1 && one) {
      const who = executorKey(one.executor);
      return { said: { key: 'prNowOne', params: { who, title: one.title, machine: one.machine || on } },
               who, tone: 'run' };
    }
    return { said: busy === 1 ? { key: 'prNowOneBare', params: { on } }
                              : { key: 'prNowMany', params: { n: busy, on } },
             who: null, tone: 'run' };
  }
  if (p.unknown > 0) {
    const n = p.unknown;
    return {
      said: p.lastSeen == null
        ? { key: n === 1 ? 'prNowUnknownBareOne' : 'prNowUnknownBare', params: { n, on } }
        : { key: n === 1 ? 'prNowUnknownOne' : 'prNowUnknown',
            params: { n, on, time: clock(p.lastSeen) } },
      who: null, tone: 'amber',
    };
  }
  if (p.paused > 0) {
    const n = p.paused;
    return {
      said: p.pausedUntil == null
        ? { key: n === 1 ? 'prNowPausedBareOne' : 'prNowPausedBare', params: { n } }
        : { key: n === 1 ? 'prNowPausedOne' : 'prNowPaused', params: { n, time: clock(p.pausedUntil) } },
      who: null, tone: 'red',
    };
  }
  return { said: { key: 'prNowIdle', params: { on } }, who: null, tone: null };
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
  if (!list.length) return { said: { key: 'prWaitNothing' }, who: null, tone: null };
  const worst: Tone = list.some((a) => a.state === 'stuck') ? 'red' : 'amber';
  if (list.length > 1) {
    return { said: { key: 'prWaitMany', params: { n: list.length } }, who: null, tone: worst };
  }
  const first = list[0];
  if (first.state === 'yours') {
    return { said: { key: 'prWaitYours', params: { title: first.card.title } }, who: null, tone: 'amber' };
  }
  return {
    said: { key: first.state === 'stuck' ? 'prWaitStuck' : 'prWaitAsking',
            params: { who: first.who, title: first.card.title } },
    who: first.who,
    tone: first.state === 'stuck' ? 'red' : 'amber',
  };
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

/** …and what it says. The branches are named in it, because the frames' rule for
 *  an empty screen is that the structure stays visible: a product whose five
 *  faces are already made is not a blank page, and reading their names is how a
 *  person sees where the first card would go. */
export function blankBody(p: MergedProject): Said {
  const names = p.branches.map((b) => b.name || b.kind).filter(Boolean);
  return names.length
    ? { key: 'prNewBody', params: { branches: names.join(', ') } }
    : { key: 'prNewBodyBare' };
}

// ── a branch card ───────────────────────────────────────────────────────────

/** One number on a branch card: what it is, and what it is of. Always a count
 *  off the board — the frames' own figures (`99.2% crash-free`, `6,412 clicks
 *  28d`) come from sources nothing is connected to yet, and a made-up one is
 *  worse than a missing one. */
export interface Figure {
  value: number;
  label: Key;
}

/** One card of the branch grid (Mobile2 V4, Mobile7 S4 and S5). */
export interface BranchCard {
  key: string;
  name: string;
  /** The 7 pt dot in front of the name: the worst thing true of its cards. */
  state: State;
  /** The line of status. `text` is words somebody or something else wrote — the
   *  branch's own summary, or the line off the card that needs attention — and
   *  `said` is ours, for a branch that has nothing to say. Exactly one of them. */
  said: Said | null;
  text: string;
  /** Two or three numbers, left to right, in three fixed slots. */
  figures: Figure[];
  /** When its source last refreshed, and whether that is long enough ago to be
   *  worth an amber word. Null where nothing has ever refreshed it. */
  refreshed: { said: Said; tone: Tone | null } | null;
  /** …and long enough to draw the whole card faintly. */
  dim: boolean;
}

/** The branches of a product, in the order the computer keeps them, each as a
 *  card. The order is deliberately not by urgency: five branches are a fixed set
 *  of faces a person learns the position of, and a grid that reshuffles itself
 *  every time a card moves is one nobody can read at a glance. */
export function branchCards(p: MergedProject, now: number): BranchCard[] {
  return p.branches.map((b) => {
    const mine = p.cards.filter((c) => c.branch === b.kind);
    const wrote = (b.summary || '').trim();
    const said = wrote ? '' : latest(mine);
    return {
      key: b.id || b.kind,
      name: b.name || b.kind,
      state: branchState(mine),
      said: wrote || said ? null : { key: 'branchNoSource' as Key },
      text: wrote || said,
      figures: figures(b),
      refreshed: refreshed(b, now),
      dim: dim(b, now),
    };
  });
}

/** The dot in front of a branch's name: the worst thing true of the cards on it.
 *  The same vocabulary the project chips use, read off the cards themselves
 *  through the merge's own two rules (`stuck`, `waiting`) rather than a second
 *  spelling of them. */
export function branchState(cards: MergedCard[]): State {
  if (cards.some(stuck)) return 'stuck';
  if (cards.some(waiting)) return 'asking';
  if (cards.some((c) => c.agent_status === 'running')) return 'running';
  return 'quiet';
}

/** A branch's numbers: what is open on it, what is in progress, what is done.
 *
 *  `open` and `done` are always drawn, zero included — a branch with nothing
 *  open and eleven done is finished, and saying so in two honest zeros beats
 *  leaving the slot empty. `in progress` is drawn only when something is, which
 *  is the frames' two-number card (Mobile7 S4's App Store and Customers): the
 *  third slot stays empty and the card still reads as complete.
 *
 *  A branch nobody has ever put a card on has no numbers at all. Three zeros
 *  there would be a measurement of nothing. */
export function figures(b: MergedBranch): Figure[] {
  const held = COLUMNS.reduce((n, col) => n + (b.cards[col] || 0), 0);
  if (!held && !(b.open || 0)) return [];
  const progress = b.cards.in_progress || 0;
  return [
    { value: b.open || 0, label: 'bnOpen' as Key },
    ...(progress > 0 ? [{ value: progress, label: 'bnProgress' as Key }] : []),
    { value: b.cards.done || 0, label: 'bnDone' as Key },
  ];
}

/** When a branch's source last said anything, in the corner of its card: the
 *  clock while it is today's (Mobile7 S4's `07:02`, `06:15`), and the age in
 *  amber once it is older than a day (`2 days old`, S5's `23 days old`).
 *
 *  Null where nothing has ever written a summary for that branch, which is most
 *  of them until the sources are connected — the card then says "no source
 *  connected yet" on its status line, and an invented `live` in the corner would
 *  contradict it. */
export function refreshed(b: MergedBranch, now: number): { said: Said; tone: Tone | null } | null {
  if (b.summary_at == null) return null;
  const since = Math.max(0, now - b.summary_at);
  if (since < BRANCH_OLD_AFTER_S) return { said: { key: 'bnAt', params: { time: clock(b.summary_at) } }, tone: null };
  const days = Math.floor(since / DAY);
  return {
    said: days <= 1 ? { key: 'bnYesterday' } : { key: 'bnDaysOld', params: { n: days } },
    tone: 'amber',
  };
}

/** …and whether the card is drawn faintly with it (Mobile7 S5). */
export function dim(b: MergedBranch, now: number): boolean {
  return b.summary_at != null && now - b.summary_at > BRANCH_DIM_AFTER_S;
}
