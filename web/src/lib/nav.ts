/** Where the panel is, as an address — and as something the back button can
 *  undo.
 *
 *  The panel held every bit of where you were in `useState`: which page, which
 *  product, which tab of it, which card, which chat. One of those
 *  reached the address (`?project=`) and it was written with `replaceState`, so
 *  the browser's history had exactly one entry the whole time you were using
 *  the panel. Pressing Back did what Back does with one entry: it left.
 *
 *  So this is that state written down in one shape, read out of a URL and
 *  written back into one. Two things it has to be, and the first version of it
 *  was only the first:
 *
 *   · **an address you can go back through.** What pushes an entry is a place
 *     a person went to on purpose — a page, a product, a card, a chat.
 *   · **an address a person can read.** `/p/quire/board`, not
 *     `?project=quire&tab=board&card=100.64.1.2%3A8790%3A0d2279020af7`.
 *     A card is named by its own id and the machine it is on is looked up, the
 *     way anybody reading the link would: the address is what the thing is,
 *     not how this browser happens to reach it.
 *
 *  Nothing else is in here: a modal, a window in the corner and a palette are
 *  not places, and a back button that closed a dialog you opened two pages ago
 *  would be a worse bug than the one this fixes.
 *
 *  Deep paths are the daemon's business too — `/p/quire/board` is not a file,
 *  and a reload of one has to come back as the panel rather than as a 404. The
 *  daemon serves any path that is not a file as `index.html` (`server.py`,
 *  `_mount_panel`), which is the other half of this file.
 */
import type { View } from './shell';

/** Where the panel is. Every field is either in the address or absent from it —
 *  there is no state here that a reload could not put back. */
export interface Place {
  view: View;
  /** The product the Dashboard is scoped to, by its slug, or null for all. */
  project: string | null;
  /** Which tab of a scoped product: what is happening on it, or its board. */
  tab: string;
  /** Which card, by the card's own id — never `host:id`, which is an
   *  address of this browser's and not of the card. */
  card: string | null;
  /** The chat being read. The computer that holds it is looked up, except
   *  where a link carried one (a popped-out window). */
  chat: string | null;
  host: string | null;
}

export const HOME: Place = {
  view: 'overview', project: null, tab: 'overview', card: null,
  chat: null, host: null,
};

/** The pages of the Machine place, by the word they go under in a path. They
 *  are the view's own name — one word each, and every one of them already
 *  reads as a page. */
const MACHINE: View[] = [
  'machines', 'executors', 'terminal', 'screen', 'accounts', 'quota', 'admin', 'settings',
  'fleet', 'projects', 'agents', 'update', 'preferences',
];

const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** A place, as the path it is written at.
 *
 *  ```
 *  /                          the Dashboard
 *  /waiting                   everything waiting on you
 *  /chats                     the Chat place · /chats/<id> one chat
 *  /machine/accounts          a page of the Machine place
 *  /p/quire                   one product
 *  /p/quire/board             …its board
 *  /p/quire/chat/9f2c…        …one of its chats, open in the middle of it
 *  /p/quire/c/0d2279020af7    …and one card, wherever that card lives
 *  ```
 *
 *  A product's branches had a tab (`/p/quire/branches`) and a page each
 *  (`/p/quire/b/engineering`). Both are gone from the panel; an address kept
 *  to either is read as the product's own page (`readPlace`).
 */
export function pathOf(place: Place): string {
  if (place.view === 'chats') return place.chat ? `/chats/${enc(place.chat)}` : '/chats';
  if (place.view !== 'overview') return `/machine/${place.view}`;
  if (!place.project) return place.tab === 'waiting' ? '/waiting' : '/';
  const head = `/p/${enc(place.project)}`;
  if (place.card) return `${head}/c/${enc(place.card)}`;
  if (place.tab === 'board') return `${head}/board`;
  // One of the product's chats, open where its page is. With none open the
  // page is the product's own.
  if (place.tab === 'chat' && place.chat) return `${head}/chat/${enc(place.chat)}`;
  return head;
}

/** …and what is left over, which is one thing: the computer a popped-out
 *  window was told to use. Everything else about where the panel is, is in the
 *  path. */
export function searchOf(place: Place): string {
  return place.host ? `?host=${enc(place.host)}` : '';
}

/** A place, read back out of an address. Anything unrecognised is the
 *  Dashboard rather than a view nothing draws — an address somebody edited by
 *  hand, or one written by an older build. */
export function readPlace(pathname: string, search = ''): Place {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const host = (q.get('host') || '').trim() || null;
  const parts = (pathname || '/').split('/').filter(Boolean).map(dec);
  const place: Place = { ...HOME, host };

  // The addresses the panel wrote before it had paths. A link somebody kept is
  // still a link, so they are read and then written back out the new way.
  if (!parts.length && (q.get('project') || q.get('chat') || q.get('view'))) {
    const view = (q.get('view') || '').trim() as View;
    return {
      view: view === 'chats' || MACHINE.includes(view) ? view : 'overview',
      project: (q.get('project') || '').trim() || null,
      // A branch's tab or page named here is the product's own page now.
      tab: q.get('tab') === 'board' ? 'board' : 'overview',
      // …including a card named the old way, `host:id`, whose tail is the id.
      card: ((q.get('card') || '').trim().split(':').pop() || null),
      chat: (q.get('chat') || '').trim() || null,
      host,
    };
  }

  if (!parts.length) return place;
  if (parts[0] === 'chats') return { ...place, view: 'chats', chat: parts[1] ?? null };
  if (parts[0] === 'waiting') return { ...place, tab: 'waiting' };
  if (parts[0] === 'machine') {
    const view = parts[1] as View;
    return { ...place, view: MACHINE.includes(view) ? view : 'machines' };
  }
  if (parts[0] === 'p' && parts[1]) {
    const scoped: Place = { ...place, project: parts[1] };
    if (parts[2] === 'board') return { ...scoped, tab: 'board' };
    if (parts[2] === 'chat' && parts[3]) return { ...scoped, tab: 'chat', chat: parts[3] };
    // `/p/quire/branches` and `/p/quire/b/<kind>` were the branch tab and a
    // branch's page; both fall through to the product's own page.
    if (parts[2] === 'c' && parts[3]) return { ...scoped, card: parts[3], tab: 'board' };
    return scoped;
  }
  return place;
}

/** Two places that would draw the same screen. What it is for: not pushing a
 *  second history entry for a state change that moved nothing — a board poll
 *  answering, a chat being renamed under you. */
export function samePlace(a: Place, b: Place): boolean {
  return (['view', 'project', 'tab', 'card', 'chat', 'host'] as (keyof Place)[])
    .every((k) => a[k] === b[k]);
}

/** A place a history entry carries, as this build draws it. An entry written
 *  before the branch pages went can still say `tab: 'branches'` or name a
 *  branch; Back to it is the product's own page. */
export function placeOfState(state: Partial<Place> & { branch?: unknown }): Place {
  const { branch: _gone, ...rest } = state;
  const to: Place = { ...HOME, ...rest };
  if (to.tab === 'branches') to.tab = 'overview';
  return to;
}
