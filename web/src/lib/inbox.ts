/** What the queue told the owner, kept where the panel can show it again.
 *
 *  ustabasi sends every "done", "asks", "failed" to Telegram and as a push to
 *  the phone, and until now that was the only place it was: a push dismissed
 *  was a result lost. The daemon hands the same messages out as a list
 *  (`ustabasi.notifications`); this polls every paired computer for what is new
 *  since the last answer, remembers which ones the reader has seen, and raises
 *  a browser notification for anything that arrives while the panel is open.
 */
import { create } from 'zustand';
import { queueNotices, type QueueNotice } from './actions';
import { useFleet } from './fleet';

export interface Notice extends QueueNotice { host: string }

const SEEN_KEY = 'rac.inbox.seen';
/** A poll is a database read on each computer; a ticket takes minutes. */
export const POLL_MS = 20_000;

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}

interface Inbox {
  items: Notice[];
  /** The newest id each computer has already answered with. */
  last: Record<string, number>;
  /** The newest id the reader has seen, per computer. */
  seen: Record<string, number>;
  /** Fetches what is new; returns only what arrived after a computer's first
   *  answer, which is what is worth a browser notification. */
  poll: () => Promise<Notice[]>;
  markSeen: () => void;
}

export const useInbox = create<Inbox>((set, get) => ({
  items: [],
  last: {},
  seen: readSeen(),
  poll: async () => {
    const fleet = useFleet.getState();
    const fresh: Notice[] = [];
    const news: Notice[] = [];
    await Promise.all(fleet.order.map(async (host) => {
      if (fleet.hosts[host]?.status !== 'online') return;
      try {
        const primed = host in get().last;
        const after = get().last[host] ?? 0;
        const r = await queueNotices(host, after);
        if (!r.available) return;
        const got = r.items.map((n) => ({ ...n, host }));
        if (got.length) fresh.push(...got);
        if (primed) news.push(...got);
        set((s) => ({ last: { ...s.last, [host]: Math.max(r.last, after) } }));
      } catch { /* an older daemon, or one that went quiet: nothing to add */ }
    }));
    if (fresh.length) {
      set((s) => {
        const known = new Set(s.items.map((n) => `${n.host}:${n.id}`));
        const add = fresh.filter((n) => !known.has(`${n.host}:${n.id}`));
        return { items: [...add, ...s.items].sort((a, b) => b.ts - a.ts).slice(0, 120) };
      });
    }
    return news;
  },
  markSeen: () => {
    const seen = { ...get().seen };
    for (const n of get().items) seen[n.host] = Math.max(seen[n.host] ?? 0, n.id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode */ }
    set({ seen });
  },
}));

export function unread(items: Notice[], seen: Record<string, number>): number {
  return items.filter((n) => n.id > (seen[n.host] ?? 0)).length;
}

/** What a notice says, said for a list: the ticket's title, and the kind as a
 *  word. The queue's own headline ("#111 ✅ … — done") repeats both. */
export const KIND_WORD: Record<string, string> = {
  done: 'done', blocked: 'asks you', failed: 'failed', reminder: 'still waiting',
  limit: 'usage limit', deadline: 'past its deadline', deadman: 'queue stopped',
};

/** A browser notification, when the reader allowed them. A click brings the
 *  panel forward and opens the ticket. */
export function announce(n: Notice, open: (n: Notice) => void): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = n.ticket ? `#${n.ticket} ${KIND_WORD[n.kind] ?? n.kind}` : (KIND_WORD[n.kind] ?? n.kind);
  const shown = new Notification(title, {
    body: n.title || n.headline, tag: `ustabasi-${n.host}-${n.id}`,
  });
  shown.onclick = () => { window.focus(); open(n); shown.close(); };
}
