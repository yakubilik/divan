/** Work: every ticket the queue is on right now, on every computer, across
 *  every project — the project page's "In progress now" said once for all of
 *  them — and under it what finished lately.
 *
 *  The wall (`screens/Ustabasi.tsx`) is every ticket the queue has ever held on
 *  one computer, as tiles. This is the other question: what is going on at this
 *  moment, which of it is stuck, and what came of the rest this week. So a
 *  queued ticket that cannot start yet — the account is out of quota, the
 *  worker asked to be woken later, it waits for another ticket — is told apart
 *  from one that is simply next in line, and a finished one says how it ended,
 *  when, and whether its work reached the base.
 *
 *  Nothing here draws anything; `scripts/test-work.mjs` holds it to the order
 *  and the words without a browser. The ages, the stage and the line about the
 *  last event are the wall's own (`lib/ustabasi.ts`).
 */
import {
  cardLine, projectName, rank, roundAge, stageLine, totalAge, type Ticket,
} from './ustabasi';

/** Where a ticket stands, in the order the page puts them: the ones that want
 *  a person first, then what is moving, then what is parked, then what is
 *  simply next — and last, what is over. */
export type Phase = 'red' | 'running' | 'waiting' | 'queued' | 'finished';

export const PHASES: Phase[] = ['red', 'running', 'waiting', 'queued', 'finished'];

/** How a finished ticket ended. */
export type Ending = 'done' | 'failed' | 'cancelled';

const ENDINGS: Ending[] = ['done', 'failed', 'cancelled'];

/** How the page is laid out: a column per status (`board`), or a list grouped
 *  by project or by the day things last moved. */
export type Grouping = 'board' | 'project' | 'date';

export const GROUPINGS: { key: Grouping; label: string }[] = [
  { key: 'board', label: 'Board' }, { key: 'project', label: 'Project' }, { key: 'date', label: 'Date' },
];

/** How far back finished tickets are shown, before Show older is pressed. */
export const RANGE_DAYS = 7;

const DAY = 86400;

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
  /** How it ended, for a finished one; null while it is in flight. */
  ended: Ending | null;
  /** The status as a word: `needs you`, `running`, `usage limit`, `done`… */
  word: string;
  /** The design system's pill for it (`dv-status--*`). */
  tone: 'ask' | 'stuck' | 'run' | 'idle' | 'done';
  /** When it last moved: the newest of its own update and its last event, or
   *  for a finished one when it finished. What the Date grouping files it by. */
  at: number;
  /** `today 16:19`, for a finished one: when it ended. Empty in flight. */
  when: string;
  /** Its work reached the base, as the queue's events say. */
  merged: boolean;
  /** `worker r2 · 12m in this round · open 3h` */
  meta: string;
  /** The last thing that happened to it, on one line. */
  line: string;
}

/** A heading and its rows: a project, or a day. */
export interface FlightGroup { key: string; title: string; rows: Flight[] }

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

/** In flight: anything the queue has not finished with. A ticket that failed
 *  is finished — the queue will not touch it again until somebody does. */
export function inFlight(t: Ticket): boolean {
  return !ENDINGS.includes(t.status as Ending);
}

/** Its work is in the base: the snapshot says so, or — from a daemon too old
 *  to say — its last event is the merge. */
export function wasMerged(t: Ticket): boolean {
  if (t.merged !== undefined) return !!t.merged;
  const ev = t.last_event;
  return ev?.kind === 'merge' && /^merged /.test(ev.msg || '');
}

const RANK: Record<Phase, number> = { red: 0, running: 1, waiting: 2, queued: 3, finished: 4 };

/** Midnight before `at`, where the person is. */
function midnight(at: number): number {
  const d = new Date(at * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

/** How many whole days `at` is before the day `now` is in: 0 today, 1 yesterday. */
function daysBefore(at: number, now: number): number {
  return Math.round((midnight(now) - midnight(at)) / DAY);
}

const hm = (at: number) => new Date(at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** `today 16:19`, `yesterday 09:02`, `12 Oct 16:19`. */
export function whenLine(at: number, now: number): string {
  const n = daysBefore(at, now);
  if (n <= 0) return `today ${hm(at)}`;
  if (n === 1) return `yesterday ${hm(at)}`;
  const date = new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${date} ${hm(at)}`;
}

/** A day's heading on the Date grouping: `Today`, `Yesterday`, `Mon 12 Oct`. */
export function dayTitle(at: number, now: number): string {
  const n = daysBefore(at, now);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return new Date(at * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The oldest finish time still shown: the last seven days, and seven more for
 *  every press of Show older. */
export function since(now: number, older: number): number {
  return now - RANGE_DAYS * DAY * (1 + Math.max(0, older));
}

function lastMoved(t: Ticket): number {
  return Math.max(t.updated_at || 0, t.last_event?.ts || 0);
}

function finishedAt(t: Ticket): number {
  return t.finished_at || lastMoved(t);
}

/** One computer's queue, as the in-flight rows this page draws. */
export function flights(host: string, snap: QueueSnap | null | undefined, now: number): Flight[] {
  if (!snap?.available) return [];
  return (snap.tickets || []).filter(inFlight).map((t) => {
    const hold = parked(t, snap, now);
    const phase: Phase = t.status === 'blocked' ? 'red' : t.status === 'running' ? 'running' : hold ? 'waiting' : 'queued';
    const word = t.status === 'blocked' ? 'needs you'
      : phase === 'running' ? 'running'
      : hold ?? 'queued';
    const tone = t.status === 'blocked' ? 'ask' : phase === 'running' ? 'run' : 'idle';
    const round = roundAge(t, now);
    const project = projectName(t);
    return {
      host, key: `${host}:${t.id}`, ticket: t, project, phase, ended: null, word, tone,
      at: lastMoved(t), when: '', merged: false,
      meta: [project, stageLine(t), round, totalAge(t, now)].filter(Boolean).join(' · '),
      line: cardLine(t) || 'nothing has happened yet',
    };
  });
}

/** …and the ones it finished since `from`: done, failed or cancelled, each
 *  saying how and when, and whether its work was merged. */
export function finished(host: string, snap: QueueSnap | null | undefined, now: number, from: number): Flight[] {
  if (!snap?.available) return [];
  return (snap.tickets || []).filter((t) => !inFlight(t) && finishedAt(t) >= from).map((t) => {
    const ended = t.status as Ending;
    const at = finishedAt(t);
    const when = whenLine(at, now);
    const merged = wasMerged(t);
    const project = projectName(t);
    return {
      host, key: `${host}:${t.id}`, ticket: t, project, phase: 'finished' as Phase, ended,
      word: ended, tone: ended === 'done' ? 'done' : ended === 'failed' ? 'stuck' : 'idle',
      at, when, merged,
      meta: [project, `${ended} ${when}`, merged ? 'merged' : '', stageLine(t)].filter(Boolean).join(' · '),
      line: cardLine(t) || 'nothing happened',
    };
  });
}

/** Are there finished tickets older than what is shown, for Show older to add? */
export function hasOlder(snap: QueueSnap | null | undefined, from: number): boolean {
  return !!snap?.available && (snap.tickets || []).some((t) => !inFlight(t) && finishedAt(t) < from);
}

function byPhase(a: Flight, b: Flight): number {
  // Within a phase the wall's own order: one asking before one that fell over.
  const r = RANK[a.phase] - RANK[b.phase] || rank(a.ticket.status) - rank(b.ticket.status);
  if (r !== 0) return r;
  const moved = a.phase === 'finished' ? b.at - a.at : (b.ticket.updated_at || 0) - (a.ticket.updated_at || 0);
  return moved !== 0 ? moved : a.ticket.id - b.ticket.id;
}

function byTime(a: Flight, b: Flight): number {
  return b.at - a.at || a.ticket.id - b.ticket.id;
}

/** One group per project, the rows in it red first, then running, then
 *  waiting, then queued, then what finished, newest first — and the groups in
 *  the order of their first row, so one red ticket pulls its whole project to
 *  the top. */
export function groupFlights(rows: Flight[]): FlightGroup[] {
  const by = new Map<string, Flight[]>();
  for (const f of rows) {
    const list = by.get(f.project);
    if (list) list.push(f);
    else by.set(f.project, [f]);
  }
  return [...by.entries()]
    .map(([project, list]) => ({ key: project, title: project, rows: [...list].sort(byPhase) }))
    .sort((a, b) => byPhase(a.rows[0], b.rows[0]) || a.key.localeCompare(b.key));
}

/** One group per day — Today, Yesterday, then dates — by when each ticket last
 *  moved (finished, for a finished one), the newest day first and the newest
 *  row first in it. */
export function groupByDate(rows: Flight[], now: number): FlightGroup[] {
  const by = new Map<number, Flight[]>();
  for (const f of rows) {
    const d = midnight(f.at);
    const list = by.get(d);
    if (list) list.push(f);
    else by.set(d, [f]);
  }
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([d, list]) => ({ key: `day-${new Date(d * 1000).toISOString().slice(0, 10)}`, title: dayTitle(d, now), rows: [...list].sort(byTime) }));
}

/** The Board's columns, in the order a ticket moves through them. Every one
 *  is drawn, empty or not: an empty Needs you column is news too. */
export const COLUMNS: { key: string; title: string; holds: (f: Flight) => boolean }[] = [
  { key: 'queued', title: 'Queued', holds: (f) => f.phase === 'queued' },
  { key: 'waiting', title: 'Waiting', holds: (f) => f.phase === 'waiting' },
  { key: 'running', title: 'In progress', holds: (f) => f.phase === 'running' },
  { key: 'blocked', title: 'Needs you', holds: (f) => f.phase === 'red' },
  { key: 'done', title: 'Done', holds: (f) => f.ended === 'done' },
  { key: 'failed', title: 'Failed', holds: (f) => f.ended === 'failed' },
  { key: 'cancelled', title: 'Cancelled', holds: (f) => f.ended === 'cancelled' },
];

/** One column per status, every column drawn; the newest card first in each. */
export function boardColumns(rows: Flight[]): FlightGroup[] {
  return COLUMNS.map((c) => ({ key: c.key, title: c.title, rows: rows.filter(c.holds).sort(byTime) }));
}

/** What a card on the Board says under its title: the project, where it is or
 *  how it ended, and its age. `quire · worker r2 · open 3h`,
 *  `quire · done today 16:19 · merged`. */
export function cardMeta(f: Flight, now: number): string {
  if (f.ended) return [f.project, `${f.ended} ${f.when}`, f.merged ? 'merged' : ''].filter(Boolean).join(' · ');
  return [f.project, stageLine(f.ticket), totalAge(f.ticket, now)].join(' · ');
}

export function groupBy(grouping: Grouping, rows: Flight[], now: number): FlightGroup[] {
  return grouping === 'board' ? boardColumns(rows)
    : grouping === 'date' ? groupByDate(rows, now) : groupFlights(rows);
}

/** The span finished tickets are counted over, in words. */
export function rangeWords(older: number): string {
  return older > 0 ? `in the last ${older + 1} weeks` : 'this week';
}

/** The head line, in words: `3 running · 1 needs you · 2 waiting · 2 queued ·
 *  5 done, 1 failed this week`. A count of nothing is left out; with nothing
 *  at all it is empty. */
export function headLine(rows: Flight[], older = 0): string {
  const n = (p: Phase) => rows.filter((f) => f.phase === p).length;
  const said: string[] = [];
  if (n('running')) said.push(`${n('running')} running`);
  if (n('red')) said.push(`${n('red')} ${n('red') === 1 ? 'needs' : 'need'} you`);
  if (n('waiting')) said.push(`${n('waiting')} waiting`);
  if (n('queued')) said.push(`${n('queued')} queued`);
  const ends = ENDINGS
    .map((e) => [e, rows.filter((f) => f.ended === e).length] as const)
    .filter(([, c]) => c > 0)
    .map(([e, c]) => `${c} ${e}`);
  if (ends.length) {
    const list = ends.length === 1 ? ends[0] : `${ends.slice(0, -1).join(', ')} and ${ends[ends.length - 1]}`;
    said.push(`${list} ${rangeWords(older)}`);
  }
  return said.join(' · ');
}

/** The page with nothing on it, in one sentence. */
export function nothing(older = 0): string {
  return `Nothing is in flight and nothing finished ${rangeWords(older)}.`;
}
