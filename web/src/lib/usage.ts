/** What a ticket has used — time, tokens, cost — as the rows its page draws.
 *
 *  The figures are the daemon's (`ustabasi.telemetry`, sent as `usage` on
 *  `divan.card.get`): one entry per run the ticket has had, read off that run's
 *  own directory, and the sums of them. Nothing is counted here; this decides
 *  what each figure is *called*, because a number on this page is only as good
 *  as its label:
 *
 *    * a duration is one run's, start to end, or the sum of the runs. Never the
 *      ticket's age: a ticket waits in a queue and waits on a person, and that
 *      is nobody running.
 *    * tokens and cost are the whole ticket's — every round, every stage — and
 *      say so.
 *    * a figure nobody reported is `unavailable`. Zero is a figure, and is
 *      drawn as one only where a run said zero.
 *    * a cost with no API key behind it is what the tokens would have cost at
 *      list price. A subscription ran it and nobody was charged that, so it is
 *      called an estimate wherever it is drawn.
 */
import { cost, duration, tokens } from './format';

export interface UsageTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/** One run of one stage: `r2-verifier-1791561066`. */
export interface UsageRun {
  run: string;
  stage: string;
  round: number;
  started_at: number;
  /** Null while it is running, and on a run nobody saw end. */
  ended_at: number | null;
  live: boolean;
  /** False for a check: a shell, which takes time and uses no tokens. */
  model: boolean;
  /** Null where the run left no figures — not the same as zeros. */
  tokens: UsageTokens | null;
  cost_usd: number | null;
}

export interface TicketUsage {
  runs: UsageRun[];
  /** Finished runs only; the one still going is added by whoever has a clock. */
  active_seconds: number;
  tokens: UsageTokens | null;
  cost_usd: number | null;
  cost_basis: 'estimate' | 'api' | 'mixed' | null;
  /** Finished model runs whose use is in nobody's total. */
  unreported: number;
}

export const UNAVAILABLE = 'unavailable';

/** One row of the box: what it is, whose it is, and the figure. */
export interface UsageRow {
  key: 'run' | 'active' | 'tokens' | 'cost';
  label: string;
  /** Which run, or `whole ticket`: the scope the figure is true of. */
  scope: string;
  value: string;
  /** Nobody reported this one. */
  missing: boolean;
  /** A word after the value that changes how it is read: `estimate`. */
  tag?: string;
  /** The line under the row: the breakdown, or what the tag means. */
  fine?: string;
}

/** One run, as a line of the breakdown under the box. */
export interface UsageLine {
  id: string;
  what: string;
  time: string;
  tokens: string;
  cost: string;
  live: boolean;
}

export interface UsageFace {
  rows: UsageRow[];
  /** What the totals leave out, where they leave something out. */
  caveat: string | null;
  lines: UsageLine[];
  /** A run is going, so the first two rows are still moving. */
  live: boolean;
}

function total(t: UsageTokens): number {
  return t.input + t.output + t.cache_read + t.cache_write;
}

/** How long a run took, or has taken so far. Null where nobody saw it end. */
export function runSeconds(r: UsageRun, now: number): number | null {
  const end = r.live ? now : r.ended_at;
  return end == null ? null : Math.max(0, end - r.started_at);
}

const span = (seconds: number) => duration(seconds * 1000);

const BASIS: Record<string, { tag: string; fine: string }> = {
  estimate: { tag: 'estimate', fine: 'API list-price equivalent. This ran on a subscription, so nothing was charged.' },
  api: { tag: 'API usage', fine: 'What the provider reported for API-key usage.' },
  mixed: { tag: 'partly estimate', fine: 'Some runs used an API key; the rest ran on a subscription and are list-price estimates, not charges.' },
};

/** The box. `now` is the daemon's clock, so a run that is going is timed
 *  against the machine that started it. Null where there is nothing to say at
 *  all — a ticket that has never run, or a daemon that does not send this. */
export function usageFace(usage: TicketUsage | null | undefined, now: number): UsageFace | null {
  if (!usage || !usage.runs?.length) return null;
  const runs = usage.runs;
  const last = runs[runs.length - 1];
  const going = runs.find((r) => r.live) ?? null;
  const shown = going ?? last;
  const took = runSeconds(shown, now);
  const active = usage.active_seconds + (going ? Math.max(0, now - going.started_at) : 0);
  const basis = usage.cost_basis ? BASIS[usage.cost_basis] : null;
  const t = usage.tokens;

  const rows: UsageRow[] = [
    {
      key: 'run', label: going ? 'Current run' : 'Last run',
      scope: `${shown.stage} · round ${shown.round}`,
      value: took == null ? UNAVAILABLE : span(took), missing: took == null,
      tag: going ? 'running' : undefined,
    },
    {
      key: 'active', label: 'Time running',
      scope: `whole ticket · ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`,
      value: span(active), missing: false,
    },
    {
      key: 'tokens', label: 'Tokens', scope: 'whole ticket',
      value: t ? tokens(total(t)) : UNAVAILABLE, missing: !t,
      fine: t
        ? `input ${tokens(t.input)} · cached input ${tokens(t.cache_read)} · cache write ${tokens(t.cache_write)} · output ${tokens(t.output)}`
        : undefined,
    },
    {
      key: 'cost', label: 'Cost', scope: 'whole ticket',
      value: usage.cost_usd == null ? UNAVAILABLE : cost(usage.cost_usd), missing: usage.cost_usd == null,
      tag: usage.cost_usd == null ? undefined : basis?.tag ?? 'as reported',
      fine: usage.cost_usd == null ? undefined
        : basis?.fine ?? 'What the provider reported, in US dollars. Whether it was charged is not known.',
    },
  ];

  const left: string[] = [];
  if (going && going.model && !going.tokens) left.push('the current run reports its tokens and cost when it ends');
  if (usage.unreported > 0) {
    left.push(`${usage.unreported} finished ${usage.unreported === 1 ? 'run' : 'runs'} left no figures`);
  }

  return {
    rows,
    caveat: left.length ? `Not in these totals: ${left.join('; ')}.` : null,
    live: !!going,
    lines: runs.map((r) => {
      const s = runSeconds(r, now);
      return {
        id: r.run,
        what: `${r.stage} · round ${r.round}`,
        time: s == null ? UNAVAILABLE : span(s),
        // A check is a shell: it has no tokens to report, which is not a gap.
        tokens: !r.model ? '' : r.tokens ? tokens(total(r.tokens)) : r.live ? 'pending' : UNAVAILABLE,
        cost: !r.model ? '' : r.cost_usd != null ? cost(r.cost_usd) : r.live ? '' : UNAVAILABLE,
        live: r.live,
      };
    }),
  };
}
