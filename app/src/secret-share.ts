/** A key an agent hands over (`daemon/divan/secret_share.py`): the agent writes
 *  `[secret-share rac-secret-NAME label]`, the chat shows a chip, and a tap asks
 *  the daemon for the value and puts it on the clipboard. The value is never in
 *  the transcript; the daemon refuses it an hour after the agent's message. */

export const SHARE_TTL_S = 3600;
export const SHARE = /\[secret-share (rac-secret-[a-z0-9][a-z0-9-]{1,80})(?: ([^\]\n]{1,60}))?\]/g;
const SCHEME = 'divan-secret://share';

export interface Share { chatId: string; service: string; until: number; label: string }

/** A label for a service that came without one: `rac-secret-openai-prod` → `openai-prod`. */
export const shareLabel = (service: string, label?: string) =>
  (label ?? '').trim() || service.replace(/^rac-secret-/, '');

export function shareUrl(s: Share): string {
  const q = [['c', s.chatId], ['s', s.service], ['u', String(Math.round(s.until))], ['l', s.label]]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${SCHEME}?${q}`;
}

export function parseShareUrl(url: string): Share | null {
  if (!url?.startsWith(`${SCHEME}?`)) return null;
  const q: Record<string, string> = {};
  for (const part of url.slice(SCHEME.length + 1).split('&')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { q[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch { return null; }
    }
  }
  const until = Number(q.u);
  if (!q.c || !q.s || !Number.isFinite(until)) return null;
  return { chatId: q.c, service: q.s, until, label: q.l ?? '' };
}

/** The message's Markdown with each share as a link the chip rule draws. Without
 *  a chat (a ticket report, a fixture) there is nothing to ask the daemon, so a
 *  share is only its name, the way a pasted key is shown. `sentAt` is the
 *  message's time in seconds; a message still streaming is new. */
export function shareMarkdown(src: string, chatId?: string, sentAt?: number, now = Date.now() / 1000): string {
  return src.replace(SHARE, (_m, service: string, label?: string) => {
    const name = shareLabel(service, label);
    if (!chatId) return `\`🔒 ${name}\``;
    const until = (sentAt ?? now) + SHARE_TTL_S;
    return `[🔑 ${name}](${shareUrl({ chatId, service, until, label: name })})`;
  });
}
