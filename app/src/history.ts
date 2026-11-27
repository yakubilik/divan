/** A chat's transcript, kept on the phone.
 *
 *  A chat used to exist only in memory: every first open after a launch, and
 *  every open after switching computers, drew a skeleton and asked the computer
 *  for the last five hundred events before a word of it showed. On 27 Nov 2026
 *  that was 464 KB for one chat, uncompressed (iOS sockets do not deflate), over
 *  a link losing three to six packets in a hundred at 250–380 ms a round trip:
 *  three or four seconds of grey bars for a conversation the phone had shown in
 *  full a minute earlier.
 *
 *  So the phone keeps what it has seen. A chat opens from its own disk at once,
 *  and the computer is asked only for what was written since — the events carry
 *  a sequence number and are never rewritten (`db.py`), so "everything after the
 *  last one I hold" is exact. A chat the phone has never seen opens on a short
 *  tail, a screenful, and the pages above it are fetched as they are scrolled
 *  to (`chat.get {before_seq}`).
 *
 *  The rules are here, apart from the store, so that they can be driven without
 *  a phone (`scripts/test-history.cjs`): the store hands this its storage and
 *  asks it what to request.
 */
import type { RacEvent } from './protocol';

/** How many events a chat nobody has opened on this phone is first asked for:
 *  a couple of screens. The rest comes in `BACK_PAGE`s. */
export const FIRST_PAGE = 80;
/** One page of older history, fetched when the list is scrolled near its top.
 *  Never without being asked for: the socket is one stream, and a page nobody
 *  is waiting on is a page the answer to a tap waits behind. */
export const BACK_PAGE = 200;
/** What a computer too old to read back is asked for instead: the tail a cold
 *  open always got. */
export const LEGACY_TAIL = 500;
/** How many events of a chat are written to disk: the end of it. More than a
 *  cold open ever showed, and small enough to write while a turn is running. */
export const KEEP = 500;
/** How far a kept copy may be behind, in forward pages, before it is cheaper
 *  to drop it and open on the tail: a chat left for a month is not walked
 *  through event by event to reach today. */
export const CATCH_UP_PAGES = 3;
/** A change waits this long for the next one before it is written, and no
 *  longer than `MAX_WAIT_MS` in all: a streaming turn is one write every few
 *  seconds, not one per event. */
export const WRITE_DELAY_MS = 2500;
export const MAX_WAIT_MS = 10_000;
/** Chats kept on disk, most recently written first; older ones are deleted. */
export const MAX_CHATS = 80;

export interface Saved {
  v: 1;
  /** The chat's row as the computer last gave it. */
  chat: any;
  /** The end of the transcript, oldest first, every one with a `seq`. */
  events: RacEvent[];
  /** Whether the computer has history above `events[0]`. */
  truncated: boolean;
  /** When this was written (ms). */
  at: number;
}

export interface HistoryStorage {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every key held, with when it was last written (ms). */
  list(): Promise<{ key: string; at: number }[]>;
}

/** The name a chat's copy is kept under. A chat id is only unique on its own
 *  computer, so the computer is part of the name; and both are made safe to be
 *  a file name, since that is what the store turns this into. */
export function keyOf(host: string, chat: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return `${safe(host)}.${safe(chat)}`;
}

/** What is written for a chat: its end, and whether anything is above it. */
export function snapshot(chat: any, events: RacEvent[], truncated: boolean, now: number): Saved {
  const durable = events.filter((e) => e.seq != null);
  const cut = durable.length > KEEP;
  return { v: 1, chat, events: cut ? durable.slice(-KEEP) : durable, truncated: truncated || cut, at: now };
}

/** A copy read back, or null where it is not one this code wrote: another
 *  version's, a file cut short by a kill mid-write, another chat's events, or
 *  events out of order. A copy that cannot be trusted is no copy — the chat
 *  opens from the computer, as it always did. */
export function parse(text: string | null, chatId: string): Saved | null {
  if (!text) return null;
  let j: any;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || j.v !== 1 || !Array.isArray(j.events) || !j.events.length) return null;
  let last = 0;
  for (const e of j.events) {
    if (!e || typeof e.seq !== 'number' || e.seq <= last || typeof e.event !== 'string') return null;
    if (e.chat_id != null && e.chat_id !== chatId) return null;
    last = e.seq;
  }
  return { v: 1, chat: j.chat ?? null, events: j.events, truncated: !!j.truncated, at: Number(j.at) || 0 };
}

/** Put a page of older events on top of what is held. The page may overlap —
 *  a computer too old to read back answers `before_seq` with the tail again —
 *  so only what is really above is taken. `older` is how many were added. */
export function prepend(held: RacEvent[], page: RacEvent[]): { events: RacEvent[]; older: number } {
  const first = held.length ? (held[0].seq ?? 0) : Number.MAX_SAFE_INTEGER;
  const above = page.filter((e) => e.seq != null && e.seq < first)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return { events: above.length ? [...above, ...held] : held, older: above.length };
}

export interface HistoryDeps {
  storage: HistoryStorage;
  now?: () => number;
  /** Timers of the test's own, where it wants to hold the clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: any) => void;
}

/** The copies on disk, and when they are written. */
export class History {
  private waiting = new Map<string, { timer: unknown; since: number; take: () => Saved | null }>();
  /** Every write and removal made, for a test to count. */
  writes = 0;

  constructor(private deps: HistoryDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }
  private setTimer(fn: () => void, ms: number) { return (this.deps.setTimer ?? setTimeout)(fn, ms); }
  private clearTimer(h: unknown) { (this.deps.clearTimer ?? (clearTimeout as (h: any) => void))(h); }

  /** The copy of a chat, or null: never throws, a disk that cannot be read
   *  is a chat that opens from the computer. */
  async load(host: string, chat: string): Promise<Saved | null> {
    try { return parse(await this.deps.storage.read(keyOf(host, chat)), chat); } catch { return null; }
  }

  /** The chat changed: write it down soon. `take` is asked at the moment of
   *  writing, so a burst of events is one write of where it ended up; a null
   *  from it (the chat is gone, the computer was switched) writes nothing. */
  touch(host: string, chat: string, take: () => Saved | null) {
    const key = keyOf(host, chat);
    const was = this.waiting.get(key);
    const since = was?.since ?? this.now();
    if (was) this.clearTimer(was.timer);
    const wait = Math.max(0, Math.min(WRITE_DELAY_MS, since + MAX_WAIT_MS - this.now()));
    const timer = this.setTimer(() => { void this.write(key); }, wait);
    this.waiting.set(key, { timer, since, take });
  }

  private async write(key: string): Promise<void> {
    const w = this.waiting.get(key);
    if (!w) return;
    this.waiting.delete(key);
    this.clearTimer(w.timer);
    let saved: Saved | null = null;
    try { saved = w.take(); } catch { saved = null; }
    if (!saved || !saved.events.length) return;
    try { this.writes++; await this.deps.storage.write(key, JSON.stringify(saved)); }
    catch (e) { console.warn('history: could not save', e); }
  }

  /** Write everything that is waiting, now: the app is going to the
   *  background, and iOS may not let the timer run. */
  async flush(): Promise<void> {
    await Promise.all([...this.waiting.keys()].map((k) => this.write(k)));
  }

  /** The chat is gone from its computer: its copy goes too, and nothing
   *  waiting is written after it. */
  async forget(host: string, chat: string): Promise<void> {
    const key = keyOf(host, chat);
    const w = this.waiting.get(key);
    if (w) { this.clearTimer(w.timer); this.waiting.delete(key); }
    try { this.writes++; await this.deps.storage.remove(key); } catch {}
  }

  /** A computer was unpaired: every copy of its chats goes. */
  async forgetHost(host: string): Promise<void> {
    const prefix = keyOf(host, '').replace(/\.$/, '') + '.';
    for (const [key, w] of this.waiting) if (key.startsWith(prefix)) { this.clearTimer(w.timer); this.waiting.delete(key); }
    try {
      for (const f of await this.deps.storage.list()) if (f.key.startsWith(prefix)) await this.deps.storage.remove(f.key);
    } catch {}
  }

  /** Keep the `MAX_CHATS` most recently written copies. Run once at launch. */
  async prune(): Promise<void> {
    try {
      const all = (await this.deps.storage.list()).sort((a, b) => b.at - a.at);
      for (const f of all.slice(MAX_CHATS)) await this.deps.storage.remove(f.key);
    } catch {}
  }
}
