// What a tapped notification opens, decided away from the screen that opens it.
//
// Three things have gone wrong with a tap, and none of them is visible in a
// simulator: a tap that launched the app arrived before the keychain was open
// and was spent on a store that was still empty; the launch response and the
// listener both reported the same tap and it opened twice; and a ticket push
// landed on the chat list because nothing read the ticket out of it. All three
// are decisions about a payload and a state — no router, no store, no React —
// so they live here and are checked in scripts/test-ustabasi.cjs.

/** A tap, as the phone can act on it: which chat or which ticket, and which
 *  computer it was sent to. */
export interface Tap {
  chat?: string;
  ticket?: number;
  device?: string;
}

/** The ticket a notification is about, if it is about one. The daemon's chat
 *  pushes carry `chat_id`; a ticket push carries the ticket's number, and the
 *  two are routed to different screens. The ticket queue is a separate program
 *  and spells it `ticket`; `ticket_id` is taken as well, because the key is an
 *  agreement rather than one program's spelling of it (docs/PROTOCOL.md). */
export function ticketFromPush(data: any): number | null {
  const raw = data?.ticket_id ?? data?.ticket;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A notification's `data`, read as a tap — or nothing, for a push that is
 *  about neither a chat nor a ticket. */
export function tapFromPush(data: any): Tap | null {
  const ticket = ticketFromPush(data);
  const chat = data?.chat_id ? String(data.chat_id) : undefined;
  if (!chat && ticket == null) return null;
  return {
    ...(chat ? { chat } : {}),
    ...(ticket != null ? { ticket } : {}),
    ...(data?.device_id ? { device: String(data.device_id) } : {}),
  };
}

/** Which screens a tap opens, deepest last.
 *
 *  A ticket opens the ticket, with the wall under it so that Back leads to the
 *  rest of the queue rather than out of it. A chat opens the chat, with the list
 *  under it — pushing on top of wherever the reader happened to be made Back
 *  walk into *that* chat instead of leaving. */
export function routeForTap(tap: Tap | null | undefined): string[] {
  if (tap?.ticket != null) return ['/ustabasi', `/ticket/${tap.ticket}`];
  if (tap?.chat) return [`/chat/${tap.chat}`];
  return [];
}

/** How long two reports of the same tap are treated as the one tap. The launch
 *  response and the listener can both carry it, and the pair of them used to
 *  open the same chat twice. */
const SAME_TAP_MS = 3000;

/** What a tap is identified by while the app decides whether it has already
 *  acted on it. */
function key(tap: Tap): string {
  return tap.ticket != null ? `ticket:${tap.ticket}` : `chat:${tap.chat}`;
}

/** The holding pen a tap waits in until the app can act on it.
 *
 *  A tap that launches the app arrives before the hosts are out of the keychain
 *  and before Face ID has been answered. Acted on then it is spent on an empty
 *  store, and what the user gets is the chat list — the exact thing the
 *  notification existed to skip. So it is kept, and `take()` hands it over the
 *  first time it is asked while the app is both ready and unlocked. */
export class Taps {
  private pending: Tap | null = null;
  private last: { key: string; at: number } | null = null;

  constructor(private clock: () => number = Date.now) {}

  /** A tap reported by the launch response or by the listener. */
  offer(data: any): Tap | null {
    const tap = tapFromPush(data);
    if (tap) this.pending = tap;
    return tap;
  }

  /** The tap to act on now, or null — because there is none, because the app
   *  cannot act yet (in which case it is still here for the next ask), or
   *  because this is the second report of one already acted on. */
  take(st: { ready: boolean; locked: boolean }): Tap | null {
    const tap = this.pending;
    if (!tap) return null;
    // Not yet. Held, not dropped: whatever asks again when `ready` or `locked`
    // turns gets it.
    if (!st.ready || st.locked) return null;
    this.pending = null;
    const k = key(tap);
    const now = this.clock();
    if (this.last && this.last.key === k && now - this.last.at < SAME_TAP_MS) return null;
    this.last = { key: k, at: now };
    return tap;
  }

  /** Whether a tap is still waiting for the app to be ready. */
  get held(): boolean { return this.pending !== null; }
}

/** Somewhere to send the user: the two calls this needs out of the router,
 *  named so a test can stand in for it. */
export interface Nav {
  canDismiss(): boolean;
  dismissTo(path: string): void;
  push(path: string): void;
}

/** Open what a tap is about.
 *
 *  The stack is popped back to the list first, so that Back leaves the app
 *  rather than walking down through whatever was open when the banner arrived.
 *  Of the pushes, only the last one matters — the wall under a ticket is a
 *  courtesy, and a courtesy that throws must not cost the tap its ticket. */
export function follow(tap: Tap, nav: Nav, home = '/chats'): string[] {
  const routes = routeForTap(tap);
  if (!routes.length) return [];
  try { if (nav.canDismiss()) nav.dismissTo(home); } catch {}
  routes.forEach((path, i) => {
    if (i === routes.length - 1) nav.push(path);
    else { try { nav.push(path); } catch {} }
  });
  return routes;
}
