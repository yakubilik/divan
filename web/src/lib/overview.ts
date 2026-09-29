/** The judgements the Dashboard place makes, kept out of the screen that draws
 *  them so `scripts/test-shell.mjs` can hold them to a snapshot without a
 *  browser: how old the page is, which states a product is in, what its board
 *  adds up to, and what it says about itself when nobody wrote a description.
 *
 *  The rule every one of them follows: a figure that has no source is not drawn.
 *  Nothing in here invents a number, and where there is nothing to say the answer
 *  is an empty list rather than a zero.
 */
import type { DivanColumn } from './protocol';
import type { DivanView, MergedProject } from './divan';
import type { State } from './theme';

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
export function staleWords(old: Staleness, ago: (seconds: number) => string): string {
  const list = old.machines.map((m) => `${m.machine} for ${ago(m.age)}`).join(' · ');
  return old.machines.length === 1
    ? `${old.machines[0].machine} has been quiet for ${ago(old.machines[0].age)}.`
      + ' What it last said is still below.'
    : `${old.machines.length} machines have been quiet — ${list}.`
      + ' What they last said is still below.';
}

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

/** The one grey line under a product's name. Its own description where somebody
 *  wrote one; otherwise what can be said without inventing anything — what sort
 *  of thing it is, and how much work is on it. */
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
