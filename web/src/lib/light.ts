import type { Chat } from './protocol';

// Kept twice, byte for byte: `web/src/lib/light.ts` and `app/src/light.ts`
// (checked by app/scripts/test-chat-list.cjs).

/** What a chat row lights up with, worst news first.
 *
 *  - `awaiting`   an approval is waiting on somebody
 *  - `running`    a turn is in flight
 *  - `background` the turn ended, but something it started — a helper, a
 *                 build — is still running on the computer
 *  - `failed`     the last turn ended in an error nobody has looked at
 *  - `unread`     the last turn finished and nobody has looked at it
 *
 *  `seen_at` lives on the chat, on the computer, so a chat read on the phone
 *  is not lit here and the other way round. A daemon older than the lights
 *  sends none of these fields, and its rows light only the first two. */
export type Light = 'awaiting' | 'running' | 'background' | 'failed' | 'unread' | null;

export function chatLight(c: Chat): Light {
  if (c.status === 'awaiting_approval') return 'awaiting';
  if (c.status === 'running') return 'running';
  if (c.bg?.length) return 'background';
  if (unseen(c)) return c.done_failed ? 'failed' : 'unread';
  return null;
}

/** A turn has ended since anybody last looked. */
export function unseen(c: Chat): boolean {
  return !!c.done_at && c.done_at > (c.seen_at ?? 0);
}

/** What is running in the background, for the row's second line: the one
 *  task's own words, or how many there are. */
export function bgWhat(c: Chat): { label: string | null; count: number; agent: boolean } {
  const bg = c.bg ?? [];
  return { label: bg.length === 1 ? (bg[0].label || null) : null, count: bg.length,
    agent: bg.length === 1 && bg[0].kind.includes('agent') };
}
