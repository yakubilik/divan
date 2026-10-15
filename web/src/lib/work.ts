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
 *  It is a board: a column per status. Above it, three ways to narrow it —
 *  which days (`spanOf`), what is typed in the search box (`matches`) and one
 *  project (`projectCounts`) — and a card dragged to another column asks the
 *  queue to do what that move means (`moveOf`, `reorder`); the page never
 *  writes state of its own.
 *
 *  Nothing here draws anything; `scripts/test-work.mjs` holds it to the order
 *  and the words without a browser. The ages, the stage and the line about the
 *  last event are the wall's own (`lib/ustabasi.ts`).
 */
import {
  cardLine, projectName, roundAge, stageLine, totalAge, type Ticket,
} from './ustabasi';

/** Where a ticket stands, in the order the page puts them: the ones that want
 *  a person first, then what is moving, then what is parked, then what is
 *  simply next — and last, what is over. */
export type Phase = 'red' | 'running' | 'waiting' | 'queued' | 'finished';

export const PHASES: Phase[] = ['red', 'running', 'waiting', 'queued', 'finished'];

/** How a finished ticket ended. */
export type Ending = 'done' | 'failed' | 'cancelled';

const ENDINGS: Ending[] = ['done', 'failed', 'cancelled'];

const DAY = 86400;

/** What one computer's `ustabasi.list` answered. */
export interface QueueSnap {
  available: boolean;
  tickets: Ticket[];
  queue?: {
    last_tick?: number | null; paused_until?: number | null;
    /** Since when the disk gate has held every start; null while it is open. */
    disk_low_since?: number | null;
    /** How many tickets the queue runs at once; null where it does not say. */
    slots?: number | null;
  };
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
   *  for a finished one when it finished. What the date picker reads. */
  at: number;
  /** `today 16:19`, for a finished one: when it ended. Empty in flight. */
  when: string;
  /** Its work reached the base, as the queue's events say. */
  merged: boolean;
  /** `worker r2 · 12m in this round · open 3h` */
  meta: string;
  /** The last thing that happened to it, on one line. */
  line: string;
  /** Why it would not start if it were put first in line now — `waits for
   *  #302`, `usage limit until 17:05`, `all 6 slots are busy; it starts
   *  next` — or null when the next pass of the supervisor would start it.
   *  Only for a queued ticket. */
  startBlock: string | null;
}

/** A heading and its rows: a column of the board. */
export interface FlightGroup { key: string; title: string; rows: Flight[] }

/** The columns this page reads that the queue keeps and an older daemon may
 *  not send. Read when they are there; the last event says the same thing
 *  when they are not. */
type Extra = { depends_on?: number | null; wake_at?: number | null; lane?: string | null };

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

/** How many tickets a queue runs at once where its snapshot does not say. */
export const SLOTS = 6;

/** Why a queued ticket put first in line would still not start on the
 *  supervisor's next pass, in the queue's own order of reasons
 *  (`hold_reason`, the usage pause, the disk gate, the slots) — or null when
 *  it would. */
export function startBlock(t: Ticket, snap: QueueSnap, now: number): string | null {
  if (t.status !== 'queued') return null;
  const x = t as Ticket & Extra;
  const ev = t.last_event;
  const until = (msg: string | undefined) => /until (\d{1,2}:\d{2})/.exec(msg || '')?.[1];
  if (x.wake_at && x.wake_at > now) return `the worker asked to wait until ${hm(x.wake_at)}`;
  if (ev?.kind === 'waiting') {
    const u = until(ev.msg);
    return u ? `the worker asked to wait until ${u}` : 'the worker asked to wait';
  }
  if (x.depends_on) {
    const dep = snap.tickets.find((o) => o.id === x.depends_on);
    if (!dep || dep.status !== 'done') return `waits for #${x.depends_on}`;
  } else if (ev?.kind === 'depends') {
    const n = /#(\d+)/.exec(ev.msg || '')?.[1];
    return n ? `waits for #${n}` : 'waits for another ticket';
  }
  if (x.lane) {
    const holder = snap.tickets.find((o) => o.id !== t.id && o.status === 'running' && (o as Ticket & Extra).lane === x.lane);
    if (holder) return `waits for #${holder.id} (lane ${x.lane})`;
  }
  const paused = snap.queue?.paused_until;
  if (paused && paused > now) return `usage limit until ${hm(paused)}`;
  if (ev?.kind === 'limit') {
    const u = until(ev.msg);
    return u ? `usage limit until ${u}` : 'usage limit';
  }
  if (snap.queue?.disk_low_since) return 'the disk is nearly full, so the queue starts nothing';
  const slots = snap.queue?.slots || SLOTS;
  const running = snap.tickets.filter((o) => o.status === 'running').length;
  if (running >= slots) return `all ${slots} slots are busy; it starts next`;
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
      startBlock: startBlock(t, snap, now),
    };
  });
}

/** …and the ones it finished: done, failed or cancelled, each saying how and
 *  when, and whether its work was merged. Every one of them — the date picker
 *  is `within`'s to apply. */
export function finished(host: string, snap: QueueSnap | null | undefined, now: number): Flight[] {
  if (!snap?.available) return [];
  return (snap.tickets || []).filter((t) => !inFlight(t)).map((t) => {
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
      startBlock: null,
    };
  });
}

function byTime(a: Flight, b: Flight): number {
  return b.at - a.at || a.ticket.id - b.ticket.id;
}

/** Where a ticket stands in the queue's order: 5 unless somebody said
 *  otherwise, which is also what an older daemon that does not say means. */
export function priorityOf(f: Flight): number {
  const p = f.ticket.priority;
  return typeof p === 'number' && Number.isFinite(p) ? p : 5;
}

/** The queue's own order — `ORDER BY priority, id`, lowest first — which is
 *  the order Queued is drawn in, so that dragging a card up it means "sooner". */
function byQueue(a: Flight, b: Flight): number {
  return priorityOf(a) - priorityOf(b) || a.ticket.id - b.ticket.id || a.host.localeCompare(b.host);
}

/** The Board's columns, in the order a ticket moves through them. Every one
 *  is drawn, empty or not: an empty Needs you column is news too. */
export type ColumnKey = 'queued' | 'waiting' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';

export const COLUMNS: { key: ColumnKey; title: string; holds: (f: Flight) => boolean }[] = [
  { key: 'queued', title: 'Queued', holds: (f) => f.phase === 'queued' },
  { key: 'waiting', title: 'Waiting', holds: (f) => f.phase === 'waiting' },
  { key: 'running', title: 'In progress', holds: (f) => f.phase === 'running' },
  { key: 'blocked', title: 'Needs you', holds: (f) => f.phase === 'red' },
  { key: 'done', title: 'Done', holds: (f) => f.ended === 'done' },
  { key: 'failed', title: 'Failed', holds: (f) => f.ended === 'failed' },
  { key: 'cancelled', title: 'Cancelled', holds: (f) => f.ended === 'cancelled' },
];

/** One column per status, every column drawn; Queued in the queue's own
 *  order, the newest card first in every other. */
export function boardColumns(rows: Flight[]): FlightGroup[] {
  return COLUMNS.map((c) => ({
    key: c.key, title: c.title, rows: rows.filter(c.holds).sort(c.key === 'queued' ? byQueue : byTime),
  }));
}

/** The column a ticket is in. */
export function columnOf(f: Flight): ColumnKey {
  return COLUMNS.find((c) => c.holds(f))?.key ?? 'queued';
}

/** What a card on the Board says under its title: the project, where it is or
 *  how it ended, and its age. `quire · worker r2 · open 3h`,
 *  `quire · done today 16:19 · merged`. */
export function cardMeta(f: Flight, now: number): string {
  if (f.ended) return [f.project, `${f.ended} ${f.when}`, f.merged ? 'merged' : ''].filter(Boolean).join(' · ');
  return [f.project, stageLine(f.ticket), totalAge(f.ticket, now)].join(' · ');
}

/** The head line, in words: `3 running · 1 needs you · 2 waiting · 2 queued ·
 *  5 done and 1 failed in the last 7 days`. A count of nothing is left out; with nothing
 *  at all it is empty. */
export function headLine(rows: Flight[], range: string | null = null): string {
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
    said.push(`${list} ${rangeWords(range)}`);
  }
  return said.join(' · ');
}

/** The page with nothing on it, in one sentence. */
export function nothing(range: string | null = null): string {
  return `Nothing moved and nothing finished ${rangeWords(range)}.`;
}

// ── the date picker ─────────────────────────────────────────────────────────

/** The days the board shows: from the start of `from`'s day up to, not
 *  including, `end` — the midnight after the last day. */
export interface Span { from: number; end: number; first: string; last: string }

/** The presets beside the two dates, by the value they put in the address;
 *  null is the default, the last seven days. */
export const PRESETS: { key: string | null; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: null, label: '7 days' }, { key: '30d', label: '30 days' },
];

/** A day as an `<input type="date">` writes it, where the person is. */
export function dayKey(at: number): string {
  const d = new Date(at * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayStart(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000;
  return Number.isFinite(at) ? at : null;
}

/** What a range in the address covers: `today`, the last `N` days with today
 *  as the last of them (`7d`, the default, is today and the six before it), or
 *  two dates, both days whole. Anything unreadable is the default. */
export function spanOf(range: string | null, now: number): Span {
  const today = midnight(now);
  const two = range ? /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range) : null;
  const a = two ? dayStart(two[1]) : null;
  const b = two ? dayStart(two[2]) : null;
  if (a != null && b != null) {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    // The midnight after the last day, found by the calendar rather than by
    // adding 86400: a day the clocks change on is 23 or 25 hours long.
    const end = midnight(hi + DAY + 3 * 3600);
    return { from: lo, end, first: dayKey(lo), last: dayKey(hi) };
  }
  const n = range === 'today' ? 1 : Math.max(1, Number(/^(\d+)d$/.exec(range || '')?.[1] || 7));
  const from = midnight(today - (n - 1) * DAY + 3 * 3600);
  const end = midnight(today + DAY + 3 * 3600);
  return { from, end, first: dayKey(from), last: dayKey(today) };
}

/** Is it on the board for these days: a finished ticket by when it finished,
 *  one in flight by when it last moved. */
export function within(f: Flight, span: Span): boolean {
  return f.at >= span.from && f.at < span.end;
}

/** The span finished tickets are counted over, in words. */
export function rangeWords(range: string | null): string {
  if (range === 'today') return 'today';
  const two = range ? /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range) : null;
  if (two) {
    const say = (k: string) => new Date((dayStart(k) ?? 0) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return two[1] === two[2] ? `on ${say(two[1])}` : `between ${say(two[1])} and ${say(two[2])}`;
  }
  const n = Number(/^(\d+)d$/.exec(range || '')?.[1] || 7);
  return `in the last ${n} days`;
}

// ── the search box ──────────────────────────────────────────────────────────

/** Does a card answer what is typed: `#30` is every ticket whose number starts
 *  30, narrowing as the number is typed out, and never one that only mentions
 *  #30 in its last event;
 *  anything else is words, every one of which has to be somewhere in its
 *  number, title, project or last event. Case does not matter. */
export function matches(f: Flight, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const id = /^#(\d+)$/.exec(q);
  if (id) return String(f.ticket.id).startsWith(id[1]);
  const hay = `#${f.ticket.id} ${f.ticket.title} ${f.project} ${f.line}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// ── the project picker ──────────────────────────────────────────────────────

/** Every project in the snapshots, A to Z, each with how many cards it would
 *  put on the board as the days and the search stand — none is left out for
 *  having nothing to show, so the list is the same list whatever is typed. */
export function projectCounts(all: Flight[], shown: Flight[]): { name: string; count: number }[] {
  const names = [...new Set(all.map((f) => f.project))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, count: shown.filter((f) => f.project === name).length }));
}

// ── a card moved to another column ──────────────────────────────────────────

/** What dropping a card on a column asks the queue to do. The queue's CLI
 *  owns what each one means; this only says which one a move is, or why
 *  there is none. */
export type Move =
  | { kind: 'cancel'; confirm: boolean }
  | { kind: 'restart' }
  | { kind: 'start' }
  | { kind: 'priority' }
  | { kind: 'refuse'; reason: string }
  | { kind: 'stay' };

/** Why a column takes nothing from a person: the queue puts tickets there. */
const REFUSED: Partial<Record<ColumnKey, string>> = {
  done: 'Only the queue marks a ticket done, once its work has passed and been merged.',
  blocked: 'Only a worker puts a ticket on you, by asking you something.',
  waiting: 'Waiting is the queue holding a ticket back; nothing can be put there.',
  failed: 'Only the queue marks a ticket failed.',
};

export function moveOf(f: Flight, to: ColumnKey): Move {
  const at = columnOf(f);
  if (to === 'queued' && at === 'queued') return { kind: 'priority' };
  if (to === at) return { kind: 'stay' };
  // Started is first in line (`ustabasi priority N 0`): the supervisor's next
  // pass, within a minute, takes it — or the card says what holds it.
  if (to === 'running') {
    if (f.phase === 'queued' || f.phase === 'waiting') return { kind: 'start' };
    if (f.phase === 'red') {
      return { kind: 'refuse', reason: `#${f.ticket.id} is waiting on you: answer it, or drag it to Queued to run it again.` };
    }
    return { kind: 'refuse', reason: `#${f.ticket.id} is ${f.ended}; drag it to Queued to run it again.` };
  }
  if (to === 'cancelled') {
    if (f.ended === 'done') return { kind: 'refuse', reason: `#${f.ticket.id} is done; there is nothing left to cancel.` };
    return { kind: 'cancel', confirm: f.phase === 'running' };
  }
  if (to === 'queued') {
    if (f.phase === 'running') {
      return { kind: 'refuse', reason: `#${f.ticket.id} is running; cancel it first, then put it back in the queue.` };
    }
    if (f.phase === 'waiting') {
      return { kind: 'refuse', reason: `#${f.ticket.id} is queued already; the queue is holding it back (${f.word}).` };
    }
    return { kind: 'restart' };
  }
  return { kind: 'refuse', reason: REFUSED[to] ?? 'The queue cannot make that move.' };
}

/** The `ustabasi priority` calls that put `f` at `index` of the Queued column
 *  — an index among the cards there once `f` has left it — in the order they
 *  are to be made; none where it would land where it is.
 *
 *  The queue picks `ORDER BY priority, id`, and only the tickets on the same
 *  computer are in that order, so only those are neighbours. One call does it
 *  where a number fits between them. Where none does — between two tickets of
 *  the same priority, the lower-numbered one below — the ones under it are
 *  moved down after it, one call each, until the order holds again. */
export function reorder(column: Flight[], f: Flight, index: number): { id: number; priority: number }[] {
  const rest = column.filter((x) => x.key !== f.key);
  const at = Math.max(0, Math.min(index, rest.length));
  const mine = (x: Flight) => x.host === f.host;
  const before = rest.slice(0, at).filter(mine);
  const after = rest.slice(at).filter(mine);
  const was = column.filter(mine).map((x) => x.key);
  const will = [...before, f, ...after].map((x) => x.key);
  if (was.join('|') === will.join('|')) return [];
  type K = [number, number];
  const gt = (a: K, b: K) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const above = before[before.length - 1];
  const below = after[0];
  const id = f.ticket.id;
  const keyOf = (x: Flight): K => [priorityOf(x), x.ticket.id];
  const fits = (p: number) => (!above || gt([p, id], keyOf(above))) && (!below || gt(keyOf(below), [p, id]));
  const tries: number[] = [];
  if (below) tries.push(id < below.ticket.id ? priorityOf(below) : priorityOf(below) - 1);
  if (above) tries.push(id > above.ticket.id ? priorityOf(above) : priorityOf(above) + 1);
  const one = tries.find(fits);
  if (one !== undefined) return [{ id, priority: one }];
  // Nothing fits between them: it takes the place under `above`, and every
  // ticket under that which would now sort before it moves down with it.
  const calls = [{ id, priority: tries[tries.length - 1] }];
  let prev: K = [calls[0].priority, id];
  for (const x of after) {
    if (gt(keyOf(x), prev)) break;
    const p = x.ticket.id > prev[1] ? prev[0] : prev[0] + 1;
    calls.push({ id: x.ticket.id, priority: p });
    prev = [p, x.ticket.id];
  }
  return calls;
}
