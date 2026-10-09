/** What a project card on the Dashboard says about one product: where it is in
 *  its life, what it is for, which tickets are open on it right now and at what
 *  stage each one is, and what it is blocked on.
 *
 *  Everything is read off the merged board (`lib/divan.ts`) — the product's
 *  own stage and summary as a person wrote them, the cards the queue mirrors,
 *  and the open items — and nothing is composed to fill a gap: a product whose
 *  stage nobody wrote says so, and one with nothing open says that instead of
 *  a progress it does not have.
 *
 *  No React in here, so `scripts/test-overview.mjs` holds it without a browser.
 */
import type { MergedCard, MergedProject } from './divan';
import { stuck } from './divan';
import type { DivanOpenItem } from './protocol';
import type { State } from './theme';
import { short } from './compose';

/** Where one open ticket is, worst first. */
export type TicketStage = 'stuck' | 'asking' | 'yours' | 'running' | 'review' | 'started' | 'queued';

/** The word a card's corner says for each, and the status pill it is drawn in.
 *  `asking` is only the word: the question itself is read in the floating chat
 *  and the Needs you row, never repeated on a project card. */
export const STAGE_WORD: Record<TicketStage, { word: string; pill: string; state: State | null }> = {
  stuck: { word: 'stopped', pill: 'dv-status--stuck', state: 'stuck' },
  asking: { word: 'asks you', pill: 'dv-status--ask', state: 'asking' },
  yours: { word: 'your call', pill: 'dv-status--ask', state: 'yours' },
  running: { word: 'working', pill: 'dv-status--run', state: 'running' },
  review: { word: 'in review', pill: 'dv-status--review', state: null },
  started: { word: 'in progress', pill: '', state: null },
  queued: { word: 'queued', pill: 'dv-status--idle', state: null },
};

const RANK: TicketStage[] = ['stuck', 'asking', 'yours', 'running', 'review', 'started', 'queued'];

/** One open ticket on a card. */
export interface ActiveTicket {
  card: MergedCard;
  stage: TicketStage;
  word: string;
  /** `#179`, or empty on a card no queue ticket was filed for. */
  number: string;
  /** Its machine has gone quiet: the stage is the last one heard, not now. */
  stale: boolean;
  /** How long it has been at this stage, in seconds; null where nobody said. */
  since: number | null;
}

/** Which stage a card is at, or null where it is not open work: the ice box is
 *  an idea and `done` is history. */
export function ticketStage(c: MergedCard): TicketStage | null {
  if (c.column === 'done' || c.column === 'ice_box') return null;
  if (stuck(c)) return 'stuck';
  if (c.agent_status === 'asking') return 'asking';
  if (c.executor === 'human' && c.column === 'in_progress') return 'yours';
  if (c.agent_status === 'verified' || c.agent_status === 'cancelled') return null;
  if (c.column === 'review') return 'review';
  if (c.column === 'queued' || c.agent_status === 'queued') return 'queued';
  if (c.agent_status === 'running') return 'running';
  return 'started';
}

export function activeTickets(p: MergedProject, now: number): ActiveTicket[] {
  const out: ActiveTicket[] = [];
  for (const card of p.cards) {
    const stage = ticketStage(card);
    if (!stage) continue;
    const at = card.agent_status_at ?? card.moved_at;
    out.push({
      card, stage,
      word: card.stale && (stage === 'running' || stage === 'review') ? 'last seen working' : STAGE_WORD[stage].word,
      number: card.ustabasi_id == null ? '' : `#${card.ustabasi_id}`,
      stale: card.stale,
      since: at == null || !at ? null : Math.max(0, now - at),
    });
  }
  return out.sort((a, b) => RANK.indexOf(a.stage) - RANK.indexOf(b.stage)
    || (a.card.ustabasi_id ?? Infinity) - (b.card.ustabasi_id ?? Infinity));
}

/** What a project card draws. */
export interface Progress {
  /** `Live`, or null where nobody has written the stage — drawn as such. */
  stage: string | null;
  /** What it is for, as written; null where nobody wrote it. */
  summary: string | null;
  tickets: ActiveTicket[];
  /** Working on it now: running or being reviewed. */
  working: number;
  /** Waiting to start. */
  queued: number;
  /** Needs a person: stopped, asking or yours. */
  needs: number;
  /** What it is blocked on or waiting for outside the queue, worst first. */
  blockers: DivanOpenItem[];
  /** One honest line on how it stands. */
  status: string;
  /** Some of this came from a machine that has gone quiet. */
  stale: boolean;
}

export function progress(p: MergedProject, now: number): Progress {
  const tickets = activeTickets(p, now);
  const working = tickets.filter((t) => t.stage === 'running' || t.stage === 'review').length;
  const queued = tickets.filter((t) => t.stage === 'queued').length;
  const needs = tickets.filter((t) => t.stage === 'stuck' || t.stage === 'asking' || t.stage === 'yours').length;
  const blockers = p.open
    .filter((o) => o.state === 'blocked' || o.state === 'waiting')
    .sort((a, b) => (a.state === b.state ? a.sort - b.sort : a.state === 'blocked' ? -1 : 1));
  return {
    stage: p.stage.trim() ? p.stage.trim()[0].toUpperCase() + p.stage.trim().slice(1) : null,
    summary: p.summary.trim() || null,
    tickets, working, queued, needs, blockers,
    status: statusLine(p, now, { working, queued, needs, open: tickets.length }),
    stale: p.stale,
  };
}

/** `2 working · 1 queued`, or — with nothing open — what was last known: when
 *  the code last moved, or that nobody could read it. Never a zero with
 *  nothing behind it. */
function statusLine(p: MergedProject, now: number,
                    n: { working: number; queued: number; needs: number; open: number }): string {
  if (n.open) {
    const bits: string[] = [];
    if (n.needs) bits.push(`${n.needs} need${n.needs === 1 ? 's' : ''} you`);
    if (n.working) bits.push(`${n.working} working`);
    if (n.queued) bits.push(`${n.queued} queued`);
    const rest = n.open - n.needs - n.working - n.queued;
    if (rest) bits.push(`${rest} in progress`);
    return bits.join(' · ');
  }
  const bits = ['No active work'];
  const at = p.activity?.at;
  if (at != null) bits.push(`last commit ${short(now - at)} ago`);
  else if (p.activity) bits.push('no commits yet');
  if (p.counts.ice_box) bits.push(`${p.counts.ice_box} in ice box`);
  return bits.join(' · ');
}

/** How many tickets a card lists before the rest go behind "+N more". */
export const SHOWN = 3;
