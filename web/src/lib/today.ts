/** What was done on a product today.
 *
 *  The computer writes on every chat a line for each thing that has been done
 *  in it (`recap.py`). A product's day is those lines, off the chats that
 *  moved since midnight here, the latest first — a list of work, not of
 *  chats: a chat nothing has come of yet adds nothing to it, and the chats
 *  themselves are down the left of the page.
 */
import type { Chat } from './protocol';

export interface Did {
  key: string;
  text: string;
}

/** How many are shown before the rest is asked for. */
export const TODAY_SHOWN = 5;

/** Midnight before `now`, where the person is. Seconds, like `updated_at`. */
export function midnight(now: number): number {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

export function today(chats: Chat[], now: number, since = midnight(now)): Did[] {
  return chats
    .filter((c) => !c.archived && c.updated_at >= since)
    .sort((a, b) => b.updated_at - a.updated_at)
    .flatMap((c) => (c.done || '').split('\n').map((l) => l.trim()).filter(Boolean)
      // Written oldest first; the day reads latest first.
      .reverse().map((text, i) => ({ key: `${c.id}:${i}`, text })));
}
