// The ustabasi wall's judgements, kept away from the screens that draw them so
// they can be checked without a phone (scripts/test-ustabasi.cjs). Nothing in
// here touches React, the store or the palette.
import type { Key } from './i18n';
import type { Ticket, TicketStatus, TicketVerdict, UstabasiSnapshot } from './protocol';

/** How often the wall re-reads the queue while it is open. The supervisor ticks
 *  every few minutes, so a second would be pointless; a minute would mean
 *  answering a ticket and watching a stale card insist it is still red. The
 *  desktop panel polls at the same rate. */
export const POLL_MS = 8000;

/** The supervisor stamps a heartbeat at the start of every tick. Older than
 *  this and the queue is not running, whatever the cards say — a supervisor
 *  that died leaves every ticket exactly as it was. */
export const TICK_STALE_S = 10 * 60;

/** Every status, in the words the app shows for it. */
export const STATUS_KEY: Record<TicketStatus, Key> = {
  running: 'tsRunning', blocked: 'tsBlocked', failed: 'tsFailed',
  done: 'tsDone', queued: 'tsQueued', cancelled: 'tsCancelled',
};

/** Red first, then whatever is moving, then the rest. An id order would put the
 *  ticket that has been waiting since last night below three that are merrily
 *  working, which is exactly backwards. The same order the panel uses. */
const RANK: Record<TicketStatus, number> = {
  blocked: 0, failed: 1, running: 2, queued: 3, done: 4, cancelled: 5,
};

/** A ticket you can talk to. The queue re-opens a blocked or failed ticket the
 *  moment a note lands; a running one takes the note at its next stage
 *  boundary, which is useful but not urgent, so the box is offered only where
 *  the ticket is actually stopped waiting for it. */
export function answerable(status: TicketStatus | string): boolean {
  return status === 'blocked' || status === 'failed';
}

/** The ones that need a person. This is the number the chats screen badges. */
export function redCount(tickets: Ticket[]): number {
  return tickets.filter((t) => answerable(t.status)).length;
}

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const r = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    return r !== 0 ? r : b.updated_at - a.updated_at;
  });
}

/** The verifier's mark against the card's nth criterion, or null where it has
 *  not judged this one. Positional: it answers them in order but writes its own
 *  wording for each, so the card's text stays and only the mark comes from it. */
export function mark(verdict: TicketVerdict | null | undefined, i: number): { met: boolean; detail?: string } | null {
  const f = verdict?.findings?.[i];
  if (!f) return null;
  return { met: f.status === 'met', detail: f.detail };
}

/** Which of the wall's six faces to draw. Every one of these has been a blank
 *  screen or a spinner that never stopped at some point: a computer that is not
 *  connected, one whose daemon predates the two requests, one that simply has
 *  no queue, and one whose queue is empty. */
export type Wall = 'offline' | 'oldHost' | 'error' | 'loading' | 'noQueue' | 'empty' | 'tickets';

export function wall(s: { online: boolean; snapshot: UstabasiSnapshot | null; error: string | null; oldHost: boolean }): Wall {
  if (!s.online) return 'offline';
  if (s.oldHost) return 'oldHost';
  // A snapshot already in hand outlives a failed poll: the queue is still
  // whatever it was eight seconds ago, which beats replacing it with an error.
  if (s.error && !s.snapshot) return 'error';
  if (!s.snapshot) return 'loading';
  if (!s.snapshot.available) return 'noQueue';
  if (s.snapshot.tickets.length === 0) return 'empty';
  return 'tickets';
}

/** "This computer has never heard of that request" — an older daemon, which is
 *  a thing to say once, not to retry or to dress up as a failure. The daemon
 *  answers an unknown request in words rather than with a code. A connection
 *  that dropped mid-request is not this. */
export function oldHost(e: { message?: string; code?: string | null } | null | undefined): boolean {
  if (!e || e.code === 'offline') return false;
  return /unknown (type|request)/i.test(e.message || '');
}

/** The ticket a notification is about, if it is about one. The daemon's chat
 *  pushes carry `chat_id`; a ticket push carries the ticket's number, and the
 *  two are routed to different screens. */
export function ticketFromPush(data: any): number | null {
  const raw = data?.ticket_id ?? data?.ticket;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A gap in seconds, as short as it can be read at a glance. */
export function since(seconds: number | null | undefined, unit: (k: 'unitSec' | 'unitMin' | 'unitHour' | 'unitDay') => string): string {
  if (seconds == null) return '';
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 60) return `${Math.round(n)}${unit('unitSec')}`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}${unit('unitMin')}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${unit('unitHour')} ${m % 60}${unit('unitMin')}`;
  return `${Math.floor(h / 24)}${unit('unitDay')} ${h % 24}${unit('unitHour')}`;
}

/** The opening of a longer text, cut on a word. A card has two lines for what
 *  a worker wrote as twenty. */
export function first(text: string | null | undefined, n: number): string {
  const t = (text || '').trim();
  if (t.length <= n) return t;
  // Only back up to the previous space when the cut landed inside a word —
  // a cut that already fell on one has no half word to throw away.
  const cut = t.slice(0, n);
  return (/\s/.test(t[n]) ? cut : cut.replace(/\s+\S*$/, '')) + '…';
}

/** The repository a ticket works in, named the way the rest of the app names a
 *  folder: the last segment, never the path — this screen is a screenshot away
 *  from being public. */
export function repoName(repo: string | null | undefined): string {
  const parts = (repo || '').split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
