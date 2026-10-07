/** What was done on a product today, a chat at a time.
 *
 *  The computer writes two things on every chat (`recap.py`): one line of what
 *  it is working on, and a line for each thing that has been done in it. A
 *  product's day is those, for the chats that moved since midnight here — and
 *  for one still working, whenever it started. A chat from a daemon that does
 *  not write them yet is still part of the day, under its title.
 */
import { bareTitle } from './format';
import type { Chat, ChatStatus } from './protocol';

export interface ChatDay {
  id: string;
  hostKey: string;
  /** What the chat is working on. */
  task: string;
  /** What has been done in it, oldest first. */
  done: string[];
  status: ChatStatus;
  /** When it last moved, as a clock. */
  at: string;
}

export const STATUS_WORD: Record<ChatStatus, string> = {
  idle: '', running: 'Working', awaiting_approval: 'Needs you',
};

/** Midnight before `now`, where the person is. Seconds, like `updated_at`. */
export function midnight(now: number): number {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

export function today(
  chats: { hostKey: string; chat: Chat }[], now: number, since = midnight(now),
): ChatDay[] {
  return chats
    .filter(({ chat: c }) => !c.archived && (c.updated_at >= since || c.status !== 'idle'))
    .sort((a, b) => b.chat.updated_at - a.chat.updated_at)
    .map(({ hostKey, chat: c }) => ({
      id: c.id,
      hostKey,
      task: (c.task || '').trim() || bareTitle(c.title, c.cwd, c.project),
      done: (c.done || '').split('\n').map((l) => l.trim()).filter(Boolean),
      status: c.status,
      at: new Date(c.updated_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
}
