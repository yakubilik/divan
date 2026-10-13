/** Work in flight: every ticket the queue is on right now, on every computer,
 *  across every project — the project page's "In progress now" said once for
 *  all of them.
 *
 *  The wall (`screens/Ustabasi.tsx`) is every ticket the queue has ever held on
 *  one computer, as tiles. This is the other question: what is going on at this
 *  moment, and which of it is stuck. So what is closed is not on it at all, and
 *  a queued ticket that cannot start yet — the account is out of quota, the
 *  worker asked to be woken later, it waits for another ticket — is told apart
 *  from one that is simply next in line.
 *
 *  Nothing here draws anything; `scripts/test-work.mjs` holds it to the order
 *  and the words without a browser. The ages, the stage and the line about the
 *  last event are the wall's own (`lib/ustabasi.ts`).
 */
import {
  cardLine, projectName, rank, roundAge, stageLine, totalAge, type Ticket,
} from './ustabasi';

/** Where a ticket in flight stands, in the order the page puts them: the ones
 *  that want a person first, then what is moving, then what is parked, then
 *  what is simply next. */
export type Phase = 'red' | 'running' | 'waiting' | 'queued';

export const PHASES: Phase[] = ['red', 'running', 'waiting', 'queued'];

/** What one computer's `ustabasi.list` answered. */
export interface QueueSnap {
  available: boolean;
  tickets: Ticket[];
  queue?: { last_tick?: number | null; paused_until?: number | null };
}

/** A ticket as this page holds it: with the computer it is on, because a
 *  ticket's number is only unique on its own machine. */
export interface Flight {
  host: string;
  key: string;
  ticket: Ticket;
  project: string;
  phase: Phase;
  /** The status as a word: `needs you`, `failed`, `running`, `usage limit`… */
  word: string;
  /** The design system's pill for it (`dv-status--*`). */
  tone: 'ask' | 'stuck' | 'run' | 'idle';
  /** `worker r2 · 12m in this round · open 3h` */
  meta: string;
  /** The last thing that happened to it, on one line. */
  line: string;
}

export interface FlightGroup { project: string; rows: Flight[] }

/** The columns this page reads that the queue keeps and an older daemon may
 *  not send. Read when they are there; the last event says the same thing
 *  when they are not. */
type Extra = { depends_on?: number | null; wake_at?: number | null };

/** Why a queued ticket is not starting, in a word or two — or null when it is
 *  only waiting for a free slot.
 *
 *  The queue passes a ticket over without blocking it for three reasons
 *  (`hold_reason` in ustabasi's supervisor), and each leaves an event: a
 *  worker that asked to wait (`waiting`), an account out of quota (`limit`),
 *  a ticket filed to wait for another (`depends`). A queue paused until a
 *  limit resets holds every queued ticket on that computer. */
export function parked(t: Ticket, snap: QueueSnap, now: number): string | null {
  if (t.status !== 'queued') return null;
  const x = t as Ticket & Extra;
  const kind = t.last_event?.kind;
  if ((x.wake_at && x.wake_at > now) || kind === 'waiting') return 'worker waiting';
  if (kind === 'limit' || (snap.queue?.paused_until && snap.queue.paused_until > now)) return 'usage limit';
  if (x.depends_on) {
    const dep = snap.tickets.find((o) => o.id === x.depends_on);
    if (!dep || dep.status !== 'done') return `waits for #${x.depends_on}`;
  } else if (kind === 'depends') {
    const n = /#(\d+)/.exec(t.last_event?.msg || '')?.[1];
    return n ? `waits for #${n}` : 'waits for another ticket';
  }
  return null;
}

/** In flight: anything not finished. `failed` is in — it is stopped waiting
 *  for a person, which is the most open a ticket gets. */
export function inFlight(t: Ticket): boolean {
  return t.status !== 'done' && t.status !== 'cancelled';
}

const RANK: Record<Phase, number> = { red: 0, running: 1, waiting: 2, queued: 3 };

/** One computer's queue, as the rows this page draws. */
export function flights(host: string, snap: QueueSnap | null | undefined, now: number): Flight[] {
  if (!snap?.available) return [];
  return (snap.tickets || []).filter(inFlight).map((t) => {
    const hold = parked(t, snap, now);
    const red = t.status === 'blocked' || t.status === 'failed';
    const phase: Phase = red ? 'red' : t.status === 'running' ? 'running' : hold ? 'waiting' : 'queued';
    const word = t.status === 'blocked' ? 'needs you'
      : t.status === 'failed' ? 'failed'
      : phase === 'running' ? 'running'
      : hold ?? 'queued';
    const tone = t.status === 'blocked' ? 'ask' : t.status === 'failed' ? 'stuck'
      : phase === 'running' ? 'run' : 'idle';
    const round = roundAge(t, now);
    const project = projectName(t);
    return {
      host, key: `${host}:${t.id}`, ticket: t, project, phase, word, tone,
      meta: [project, stageLine(t), round, totalAge(t, now)].filter(Boolean).join(' · '),
      line: cardLine(t) || 'nothing has happened yet',
    };
  });
}

function byPhase(a: Flight, b: Flight): number {
  // Within a phase the wall's own order: one asking before one that fell over.
  const r = RANK[a.phase] - RANK[b.phase] || rank(a.ticket.status) - rank(b.ticket.status);
  if (r !== 0) return r;
  const moved = (b.ticket.updated_at || 0) - (a.ticket.updated_at || 0);
  return moved !== 0 ? moved : a.ticket.id - b.ticket.id;
}

/** One group per project, the rows in it red first, then running, then
 *  waiting, then queued — and the groups in the order of their first row, so
 *  one red ticket pulls its whole project to the top. */
export function groupFlights(rows: Flight[]): FlightGroup[] {
  const by = new Map<string, Flight[]>();
  for (const f of rows) {
    const list = by.get(f.project);
    if (list) list.push(f);
    else by.set(f.project, [f]);
  }
  return [...by.entries()]
    .map(([project, list]) => ({ project, rows: [...list].sort(byPhase) }))
    .sort((a, b) => byPhase(a.rows[0], b.rows[0]) || a.project.localeCompare(b.project));
}

/** The head line, in words: `3 running · 1 needs you · 2 waiting · 2 queued`.
 *  A count of nothing is left out; with nothing at all it is empty. */
export function headLine(rows: Flight[]): string {
  const n = (p: Phase) => rows.filter((f) => f.phase === p).length;
  const said: string[] = [];
  if (n('running')) said.push(`${n('running')} running`);
  if (n('red')) said.push(`${n('red')} ${n('red') === 1 ? 'needs' : 'need'} you`);
  if (n('waiting')) said.push(`${n('waiting')} waiting`);
  if (n('queued')) said.push(`${n('queued')} queued`);
  return said.join(' · ');
}

/** The page with nothing on it, in one sentence. */
export const NOTHING = 'Nothing is in flight: no ticket is running, waiting or queued on any computer.';
