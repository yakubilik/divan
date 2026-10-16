/** Messages on their way to the computer (#292).
 *
 *  A message that has left the composer is the phone's to deliver, however the
 *  connection behaves. Each one is given an id of its own here, written to the
 *  phone's disk before anything is sent, and sent — and sent again on every
 *  reconnect — until the computer answers that it has it. The computer knows
 *  the id: a copy of a message it already accepted (the socket died after the
 *  message reached it and before the answer reached us) is answered again and
 *  not run twice (`server.py h_chat_send`).
 *
 *  So a lost connection is not a failed message, it is a late one: the bubble
 *  says "Sending…" for as long as the phone is reconnecting. Only a real
 *  refusal from the computer (the chat was deleted), or two minutes with no
 *  connection at all, turns it into "Not sent · Tap to retry" — and even then
 *  the message is still on the phone, waiting for that tap.
 *
 *  The rules are here, apart from the store, so that they can be driven
 *  without a phone (`scripts/test-outbox.cjs`): the store hands this its
 *  request, its storage and the socket's comings and goings.
 */

/** `sending`: on the phone, or on its way. `sent`: the computer said it has it,
 *  and the timeline's own copy has not arrived yet. `failed`: given up on until
 *  somebody taps it. */
export type OutState = 'sending' | 'sent' | 'failed';

export interface OutAttachment { path: string; name: string; [k: string]: unknown }

export interface OutMsg {
  /** The phone's name for the message; the computer remembers it. */
  client_id: string;
  /** The computer it is for: a message to the Mac is not sent to the mini. */
  host: string;
  chat_id: string;
  text: string;
  attachments: OutAttachment[];
  /** When it was written, or last retried by hand (ms). */
  at: number;
  state: OutState;
  /** Why it failed, in words a person can read. */
  error?: string | null;
}

/** How long a message waits on a connection that is not there before it is
 *  shown as not sent. Counted from whichever came later — the message, or the
 *  moment the connection went — so an app that comes back from an hour in the
 *  background is given its reconnect first. */
export const GIVE_UP_MS = 120_000;
/** How often a waiting message is looked at while it waits. */
export const TICK_MS = 5_000;

export interface OutboxStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

/** The request, as `client.call` makes it. */
export type Call = (type: string, data: Record<string, any>) => Promise<any>;

/** A name nobody else will give a message: time, then randomness. */
export function newClientId(): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `m-${Date.now().toString(36)}-${rand}`;
}

/** Whether a failed send is the connection's fault, and so only late. `offline`
 *  is every way a socket can not answer (ws.ts `connError`): not connected,
 *  dropped, timed out. `restarting` is a computer that said "in a moment". */
export function retryable(e: any): boolean {
  return e?.code === 'offline' || e?.code === 'restarting';
}

/** Whether the timeline already has this message: what hides the waiting
 *  bubble the moment the real one is there, acknowledged or not. */
export function delivered(events: { event: string; data?: any }[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const e of events ?? []) if (e.event === 'message.user' && e.data?.client_id) ids.add(e.data.client_id);
  return ids;
}

export interface OutboxDeps {
  call: Call;
  storage: OutboxStorage;
  /** The computer the phone is connected to, or trying to be. */
  host: () => string | null;
  /** Whether the socket is up right now (not what the banner shows). */
  online: () => boolean;
  onChange: (items: OutMsg[]) => void;
  now?: () => number;
  /** The words for a failure; the store passes its translator. */
  words?: { offline: string };
}

export class Outbox {
  items: OutMsg[] = [];
  private sending = false;
  private again = false;
  private offlineSince: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded: Promise<void> | null = null;
  /** Every `chat.send` made, for a test to count. */
  attempts = 0;

  constructor(private deps: OutboxDeps) {}

  private now() { return (this.deps.now ?? Date.now)(); }

  /** What the last run of the app left waiting. Read once; a message added
   *  before it is read is kept, after the ones that were already waiting. */
  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        let saved: OutMsg[] = [];
        try {
          const raw = await this.deps.storage.read();
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) saved = parsed.filter((m) => m && m.client_id && m.chat_id && m.host);
        } catch {}
        const mine = new Set(this.items.map((m) => m.client_id));
        // A message the app was killed in the middle of sending is still only
        // sending: the computer may or may not have it, and the id settles it.
        const back = saved.filter((m) => !mine.has(m.client_id))
          .map((m) => ({ ...m, state: m.state === 'failed' ? 'failed' as const : 'sending' as const }));
        this.items = [...back, ...this.items];
        this.changed(false);
        this.schedule();
      })();
    }
    return this.loaded;
  }

  /** A new message: on disk first, then on its way. */
  async add(host: string, chat_id: string, text: string, attachments: OutAttachment[] = []): Promise<OutMsg> {
    const m: OutMsg = { client_id: newClientId(), host, chat_id, text, attachments, at: this.now(), state: 'sending', error: null };
    this.items = [...this.items, m];
    await this.changed();
    void this.flush();
    return m;
  }

  /** Try a failed message again, as if it had just been written. */
  async retry(client_id: string): Promise<void> {
    this.items = this.items.map((m) => (m.client_id === client_id && m.state === 'failed'
      ? { ...m, state: 'sending' as const, at: this.now(), error: null } : m));
    await this.changed();
    void this.flush();
  }

  /** Give up on a failed message for good. */
  async discard(client_id: string): Promise<OutMsg | null> {
    const m = this.items.find((x) => x.client_id === client_id) ?? null;
    this.items = this.items.filter((x) => x.client_id !== client_id);
    await this.changed();
    return m;
  }

  /** The timeline has its own copy of these: the waiting bubble can go. One
   *  still unacknowledged stays in the outbox — only the computer's answer
   *  takes it out — but is no longer drawn (see `delivered`). */
  seen(ids: Iterable<string>) {
    const got = new Set(ids);
    // The daemon writes the message into the timeline before it answers, so
    // the copy usually arrives first: kept, for the answer to find.
    for (const id of got) {
      if (!this.items.some((m) => m.client_id === id)) continue;
      this.shown.add(id);
      if (this.shown.size > 200) this.shown.delete(this.shown.values().next().value!);
    }
    const before = this.items.length;
    this.items = this.items.filter((m) => !(m.state === 'sent' && got.has(m.client_id)));
    if (this.items.length !== before) this.changed(false);
  }
  /** Ids the timeline has shown, of messages not yet acknowledged. */
  private shown = new Set<string>();

  /** The socket came up or went. Up: everything waiting goes now. */
  link(up: boolean) {
    if (!up) { this.offlineSince ??= this.now(); return; }
    this.offlineSince = null;
    void this.flush();
  }

  /** Waiting messages, looked at: the ones that have waited too long on no
   *  connection are given up on, and the rest are sent if the socket is up
   *  (a send that timed out on a socket that never dropped is retried here). */
  tick() {
    const now = this.now();
    const host = this.deps.host();
    if (!this.deps.online()) {
      const since = this.offlineSince ?? now;
      let gaveUp = false;
      this.items = this.items.map((m) => {
        if (m.state !== 'sending' || m.host !== host || this.inFlight === m.client_id) return m;
        if (now - Math.max(m.at, since) < GIVE_UP_MS) return m;
        gaveUp = true;
        return { ...m, state: 'failed' as const, error: this.deps.words?.offline ?? 'not connected to the computer' };
      });
      if (gaveUp) void this.changed();
      return;
    }
    void this.flush();
  }

  private inFlight: string | null = null;

  /** Send what is waiting for the connected computer, oldest first, one at a
   *  time: a message is never overtaken by the one typed after it. A send that
   *  fails for want of a connection stops the run; the next reconnect, or the
   *  next tick, starts it again. */
  async flush(): Promise<void> {
    if (this.sending) { this.again = true; return; }
    this.sending = true;
    try {
      do {
        this.again = false;
        for (;;) {
          const host = this.deps.host();
          const m = this.items.find((x) => x.state === 'sending' && x.host === host);
          if (!m) break;
          this.inFlight = m.client_id;
          let ack: any;
          try {
            this.attempts++;
            ack = await this.deps.call('chat.send', {
              chat_id: m.chat_id, text: m.text, attachments: m.attachments, client_id: m.client_id });
          } catch (e: any) {
            if (retryable(e)) break;
            this.items = this.items.map((x) => (x.client_id === m.client_id
              ? { ...x, state: 'failed' as const, error: e?.message ?? null } : x));
            await this.changed();
            continue;
          } finally {
            this.inFlight = null;
          }
          // The computer has it. One that did not name the message back is an
          // older daemon, whose timeline will not carry the id either: nothing
          // would ever hide the bubble, so it goes now — as it does when the
          // timeline's copy has already arrived.
          this.items = ack?.client_id === m.client_id && !this.shown.delete(m.client_id)
            ? this.items.map((x) => (x.client_id === m.client_id ? { ...x, state: 'sent' as const } : x))
            : this.items.filter((x) => x.client_id !== m.client_id);
          await this.changed();
        }
      } while (this.again);
    } finally {
      this.sending = false;
      this.schedule();
    }
  }

  /** The timer runs only while something is waiting. */
  private schedule() {
    const waiting = this.items.some((m) => m.state === 'sending');
    if (waiting && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    else if (!waiting && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Tell the screen, and write down what is not yet the computer's. */
  private async changed(persist = true) {
    this.deps.onChange(this.items);
    this.schedule();
    if (!persist) return;
    const keep = this.items.filter((m) => m.state !== 'sent');
    try { await this.deps.storage.write(JSON.stringify(keep)); } catch (e) { console.warn('outbox: could not save', e); }
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
