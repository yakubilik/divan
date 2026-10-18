// A link shared to Divan from another app's share sheet (#333).
//
// Share on an Instagram post, an X post or a YouTube video, pick Divan, and the
// share extension (`plugins/with-share-extension.js`) opens the app on
// `divan://share?url=…` — or `?text=…` when what was shared is words with a
// link somewhere inside them, which is how Instagram and X hand a post over.
// The app then opens a chat the way the pen on the chat list does
// (`openFresh` in `src/fresh-chat.ts`: the remembered tool, model and sign-in,
// the computer's default folder, Hermes by the sheet's agent rule) and sends
// the link as its first message, which is what Hermes's social-link-reader
// skill reads. Which account the chat runs on is the computer's pool's
// business, as it is for every other chat.
//
// A share can arrive before the app can act on it: on a cold start the hosts
// are not out of the keychain yet, Face ID has not been answered, the socket is
// still connecting — or this phone was never paired at all. So it is held here,
// like a notification tap is in `src/tap.ts`, and handed over the first time
// it is asked while the app is ready, unlocked and online; until then the app
// says plainly that it is waiting. No React, no store and no router, so
// `scripts/test-share.cjs` drives it without a phone.
import { openFresh, type FreshDeps } from './fresh-chat';
import type { Chat } from './protocol';

/** The first http(s) link in some text, or null. Trailing punctuation a
 *  sentence puts after a link (`see https://x.com/a/status/1.`) is not part of
 *  it; a closing bracket is, when the link opened one (Wikipedia-style). */
export function urlFromText(text: string | null | undefined): string | null {
  const m = String(text ?? '').match(/https?:\/\/[^\s<>"'“”‘’]+/i);
  if (!m) return null;
  let url = m[0];
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?…]/.test(last)) { url = url.slice(0, -1); continue; }
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) { url = url.slice(0, -1); continue; }
    if (last === ']' && !url.includes('[')) { url = url.slice(0, -1); continue; }
    break;
  }
  // `https://` with nothing after it is not a link to anything.
  return /^https?:\/\/[^/?#]+/i.test(url) ? url : null;
}

/** What a share hands the app, as the deep link's query carries it. */
export interface SharedParams { url?: string | string[]; text?: string | string[] }

export type Shared = { url: string } | { error: 'noLink' };

/** The link a share is about: `url` when the extension found one, else the
 *  first link in `text`. Anything else — a photo caption, a note — has no link
 *  to read and opens no chat. */
export function sharedLink(p: SharedParams | null | undefined): Shared {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const url = urlFromText(one(p?.url)) ?? urlFromText(one(p?.text));
  return url ? { url } : { error: 'noLink' };
}

/** The deep link the share extension opens the app with; the extension builds
 *  the same one in Swift. */
export function shareLink(p: { url?: string; text?: string }, scheme = 'divan'): string {
  const [k, v] = p.url ? ['url', p.url] : ['text', p.text ?? ''];
  return `${scheme}://share?${k}=${encodeURIComponent(v)}`;
}

/** The first message of the chat a link opens: the link itself, as a person
 *  pasting it would send it. */
export function shareMessage(url: string): string {
  return url;
}

/** What the app is, as far as acting on a share goes. */
export interface ShareState {
  ready: boolean;
  locked: boolean;
  /** A computer is paired. */
  paired: boolean;
  conn: string;
  /** The computer has said where a new chat opens (`host.info`). */
  hostInfo: FreshDeps['hostInfo'];
}

/** What a held link is waiting for: nothing (`go`), the app itself to open
 *  (`app`, not worth a word), a computer to be paired (`pair`), or the
 *  connection to the paired one (`connect`). */
export type ShareWait = 'go' | 'app' | 'pair' | 'connect';

export function shareWait(st: ShareState): ShareWait {
  if (!st.ready || st.locked) return 'app';
  if (!st.paired) return 'pair';
  if (st.conn !== 'online' || !(st.hostInfo?.default_cwd || st.hostInfo?.roots?.length)) return 'connect';
  return 'go';
}

/** How long the same link shared twice counts as one share: iOS can deliver
 *  the deep link both as the launch URL and as an event. */
const SAME_SHARE_MS = 3000;

/** How long a held link waits on a connection before the app says it is
 *  waiting: a cold start is connected within a second or two, and a dialog
 *  that flashes up just before the chat opens says nothing true. */
export const CONNECT_GRACE_MS = 4000;

/** The holding pen a shared link waits in until the app can open its chat. */
export class Shares {
  private pending: string | null = null;
  private last: { url: string; at: number } | null = null;
  private since = 0;
  private told = false;
  private subs = new Set<() => void>();

  constructor(private clock: () => number = Date.now) {}

  /** A share, as the deep link brought it. A link replaces whatever link was
   *  still waiting (the newest share is the one meant); no link is refused and
   *  leaves a waiting one alone. */
  offer(p: SharedParams | null | undefined): Shared {
    const s = sharedLink(p);
    if ('url' in s) {
      const dup = this.last && this.last.url === s.url && this.clock() - this.last.at < SAME_SHARE_MS;
      if (!dup && this.pending !== s.url) { this.pending = s.url; this.since = this.clock(); this.told = false; }
      for (const f of this.subs) f();
    }
    return s;
  }

  /** The link to open a chat for now, or null — because there is none, or
   *  because the app cannot yet, in which case it is still here. */
  take(st: ShareState): string | null {
    const url = this.pending;
    if (!url || shareWait(st) !== 'go') return null;
    this.pending = null;
    this.last = { url, at: this.clock() };
    return url;
  }

  /** A link whose chat could not be opened, back in the pen for another try. */
  putBack(url: string): void {
    if (!this.pending) this.pending = url;
    this.last = null;
  }

  /** The link given up on by the person, on purpose. */
  discard(): void { this.pending = null; this.told = false; }

  /** What to tell the person about a held link, once per link: `pair` at
   *  once, `connect` once the link has waited `CONNECT_GRACE_MS` for it (see
   *  `shareWait`), or null when there is nothing to say yet. */
  notice(st: ShareState): 'pair' | 'connect' | null {
    if (!this.pending || this.told) return null;
    const w = shareWait(st);
    if (w !== 'pair' && !(w === 'connect' && this.clock() - this.since >= CONNECT_GRACE_MS)) return null;
    this.told = true;
    return w;
  }

  get held(): string | null { return this.pending; }

  /** Called on every offer, so whoever delivers can try at once. */
  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => { this.subs.delete(f); };
  }
}

/** The one pen the deep link fills and the root layout empties. */
export const shares = new Shares();

/** Open the chat a shared link asks for: a fresh chat (`openFresh`), then the
 *  link as its first message. The send goes through the outbox, so once the
 *  chat exists the link is on the phone's disk until the computer has it. */
export async function openShared(url: string, deps: FreshDeps & {
  send: (id: string, text: string) => Promise<void>;
}): Promise<Chat> {
  const chat = await openFresh(deps);
  if (!chat) throw new Error('No folder to open a chat in');
  await deps.send(chat.id, shareMessage(url));
  return chat;
}

/** What the app is asked to say about a share. */
export type ShareSay =
  | { kind: 'noLink' }
  | { kind: 'pair' }
  | { kind: 'connect' }
  | { kind: 'failed'; message: string };

/** A share arriving: into the pen, or — with no link in it — turned away out
 *  loud. What `app/share.tsx` does with the deep link's query. */
export function receive(pen: Shares, p: SharedParams | null | undefined, say: (s: ShareSay) => void): Shared {
  const s = pen.offer(p);
  if ('error' in s) say({ kind: 'noLink' });
  return s;
}

/** One attempt at the link in the pen: opened in a fresh chat if the app can,
 *  held (and said so, when it is time) if it cannot, and put back with the
 *  reason said if the computer refused. What the root layout runs on every
 *  change that could let a held link through. */
export async function deliver(pen: Shares, st: ShareState & FreshDeps & { send: (id: string, text: string) => Promise<void> }, out: {
  opened: (chat: Chat) => void;
  say: (s: ShareSay) => void;
}): Promise<'opened' | 'held' | 'none' | 'failed'> {
  const url = pen.take(st);
  if (!url) {
    if (!pen.held) return 'none';
    const n = pen.notice(st);
    if (n) out.say({ kind: n });
    return 'held';
  }
  try {
    out.opened(await openShared(url, st));
    return 'opened';
  } catch (e: any) {
    pen.putBack(url);
    out.say({ kind: 'failed', message: e?.message ?? String(e) });
    return 'failed';
  }
}
