import { uptime } from './format';

/** The wall's arithmetic, away from its drawing: which project a card belongs
 *  to, what order cards and columns come in, and the four short readings a card
 *  shows instead of a progress bar.
 *
 *  There is no percentage here and there will not be one. Nothing in the queue
 *  knows how far along a ticket is — the criteria are answered once, at the end,
 *  by the verifier — so a bar would be a drawn guess. What can be counted is
 *  counted: how long it has been open, how long this round has been going, whose
 *  hands it is in, and what has landed on the branch.
 */

/** As much of a ticket as any of this needs. The screen's `Ticket` is this and
 *  more; keeping the shape small is what makes these functions testable. */
export interface WallTicket {
  status: string;
  repo: string;
  project?: string | null;
  stage: string;
  round: number;
  created_at: number;
  updated_at: number;
  finished_at?: number | null;
  round_started_at?: number | null;
  git?: { commits: number; subject: string } | null;
}

/** Red first, then whatever is moving, then the rest. An id order would put the
 *  ticket that has been waiting since last night below three that are merrily
 *  working, which is exactly backwards. */
const RANK: Record<string, number> = {
  blocked: 0, failed: 1, running: 2, queued: 3, done: 4, cancelled: 5,
};

export function rank(status: string): number {
  return RANK[status] ?? 9;
}

/** A ticket nobody is going to touch again. `failed` is not one of these: it is
 *  stopped waiting for a person, which is the most open a ticket gets. */
const CLOSED = ['done', 'cancelled'];

function closedAt(t: WallTicket): number | null {
  return CLOSED.includes(t.status) && t.finished_at ? t.finished_at : null;
}

export function sortTickets<T extends WallTicket>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    return r !== 0 ? r : b.updated_at - a.updated_at;
  });
}

/** The project a ticket is work on. The daemon names it — `babysee/app` is
 *  babysee — and the folder name is the fallback for a repository its path
 *  policy has nothing to say about. */
export function projectName(t: WallTicket): string {
  const named = (t.project || '').trim();
  if (named) return named;
  const parts = (t.repo || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unfiled';
}

export interface Group<T> { project: string; tickets: T[] }

/** One column per project, the reddest column first.
 *
 *  Twenty cards in one grid is a wall you have to read twice: the two tickets on
 *  the same repository are three columns apart and look unrelated. Grouped, the
 *  question "what is happening in babysee" is answered by looking at one column.
 *  A project with nothing in it is not a column — the grouping comes out of the
 *  tickets, so there is nothing to leave out.
 */
export function groupByProject<T extends WallTicket>(tickets: T[]): Group<T>[] {
  const by = new Map<string, T[]>();
  for (const t of tickets) {
    const name = projectName(t);
    const list = by.get(name);
    if (list) list.push(t);
    else by.set(name, [t]);
  }
  return [...by.entries()]
    .map(([project, list]) => ({ project, tickets: sortTickets(list) }))
    .sort((a, b) => {
      // The column's rank is its best ticket's: one red card pulls the whole
      // project to the front, which is the only sort order that matters at 3am.
      const r = rank(a.tickets[0].status) - rank(b.tickets[0].status);
      if (r !== 0) return r;
      const moved = b.tickets[0].updated_at - a.tickets[0].updated_at;
      return moved !== 0 ? moved : a.project.localeCompare(b.project);
    });
}

/** "12s", "49m", "15h 18m", "2d 3h" — the same shape the rest of the panel uses
 *  for an age, with seconds only while there is nothing else to say. */
function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : uptime(s);
}

/** How long this has been a ticket — the figure a person means by "how long has
 *  it been running". Once it is finished, how long it took. */
export function totalAge(t: WallTicket, now: number): string {
  const end = closedAt(t);
  return end
    ? `took ${span(end - t.created_at)}`
    : `open ${span(now - t.created_at)}`;
}

/** How long the current round has been going, which is the smaller figure and
 *  is drawn as the smaller figure. Null where there is no round in progress: a
 *  finished ticket's last round does not go on getting longer, and a ticket
 *  still in the queue has not had one. */
export function roundAge(t: WallTicket, now: number): string | null {
  if (closedAt(t) || !t.round_started_at) return null;
  return `${span(now - t.round_started_at)} in this round`;
}

/** Whose hands it is in, and for the how-many-th time. */
export function stageLine(t: WallTicket): string {
  return `${t.stage} r${t.round}`;
}

/** What has landed on the branch. Nothing committed yet, or no worktree to
 *  look in, and the card says nothing rather than N/A. */
export function commitCount(t: WallTicket): string | null {
  const n = t.git?.commits;
  if (!n) return null;
  return `${n} ${n === 1 ? 'commit' : 'commits'}`;
}
