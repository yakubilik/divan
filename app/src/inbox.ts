/** What the queue sent, kept on the phone for reading again (the panel's
 *  `web/src/lib/inbox.ts`, for one computer: the one this phone is on).
 *
 *  The push is still how a result arrives; this is where it is when the push
 *  is gone. The newest id the reader has seen is kept per computer, so the
 *  count on the dashboard is what came in since the list was last opened. */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { useStore } from './store';
import type { QueueNotice } from './protocol';

const SEEN_KEY = 'rac.inbox.seen';
export const POLL_MS = 20_000;

interface Inbox {
  host: string | null;
  items: QueueNotice[];
  last: number;
  seen: number;
  poll: () => Promise<void>;
  markSeen: () => void;
}

export const useInbox = create<Inbox>((set, get) => ({
  host: null,
  items: [],
  last: 0,
  seen: 0,
  poll: async () => {
    const st = useStore.getState();
    const host = st.activeHostId;
    if (!host || st.conn !== 'online') return;
    // A different computer is a different inbox: start it over.
    if (host !== get().host) {
      const kept = await SecureStore.getItemAsync(`${SEEN_KEY}.${host}`).catch(() => null);
      set({ host, items: [], last: 0, seen: Number(kept) || 0 });
    }
    try {
      const r = await st.queueNotices(get().last);
      if (!r.available || useStore.getState().activeHostId !== host) return;
      const known = new Set(get().items.map((n) => n.id));
      const add = r.items.filter((n) => !known.has(n.id));
      set({ items: [...add, ...get().items].sort((a, b) => b.id - a.id).slice(0, 120),
            last: Math.max(r.last, get().last) });
    } catch { /* an older daemon: no inbox to show */ }
  },
  markSeen: () => {
    const top = get().items[0]?.id ?? get().seen;
    set({ seen: top });
    const host = get().host;
    if (host) void SecureStore.setItemAsync(`${SEEN_KEY}.${host}`, String(top)).catch(() => {});
  },
}));

export function unread(items: QueueNotice[], seen: number): number {
  return items.filter((n) => n.id > seen).length;
}

export const KIND_KEY: Record<string, string> = {
  done: 'kindDone', blocked: 'kindBlocked', failed: 'kindFailed', reminder: 'kindReminder',
  limit: 'kindLimit', deadline: 'kindDeadline', deadman: 'kindDeadman',
};
