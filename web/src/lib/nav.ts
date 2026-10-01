/** Where the panel is, as an address — and as something the back button can
 *  undo.
 *
 *  The panel held every bit of where you were in `useState`: which page, which
 *  product, which tab of it, which face, which card, which chat. One of those
 *  reached the address (`?project=`) and it was written with `replaceState`, so
 *  the browser's history had exactly one entry the whole time you were using
 *  the panel. Pressing Back did what Back does with one entry: it left.
 *
 *  So this is that state written down in one shape, read out of a URL and
 *  written back into one. Two things it has to be, and the first version of it
 *  was only the first:
 *
 *   · **an address you can go back through.** What pushes an entry is a place
 *     a person went to on purpose — a page, a product, a face, a card, a chat.
 *   · **an address a person can read.** `/p/babysee/board`, not
 *     `?project=babysee&tab=board&card=100.80.178.83%3A8790%3A0d2279020af7`.
 *     A card is named by its own id and the machine it is on is looked up, the
 *     way anybody reading the link would: the address is what the thing is,
 *     not how this browser happens to reach it.
 *
 *  Nothing else is in here: a modal, a window in the corner and a palette are
 *  not places, and a back button that closed a dialog you opened two pages ago
 *  would be a worse bug than the one this fixes.
 *
 *  Deep paths are the daemon's business too — `/p/babysee/board` is not a file,
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
  /** Which tab of a scoped product: what is happening on it, the faces it has,
   *  or its board. */
  tab: string;
  /** Which face of that product is open, by kind. */
  branch: string | null;
  /** …and which card, by the card's own id — never `host:id`, which is an
   *  address of this browser's and not of the card. */
  card: string | null;
  /** The chat being read. The computer that holds it is looked up, except
   *  where a link carried one (a popped-out window). */
  chat: string | null;
  host: string | null;
}

export const HOME: Place = {
  view: 'overview', project: null, tab: 'overview', branch: null, card: null,
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
 *  /chats                     the Chat place · /chats/<id> one chat
 *  /machine/accounts          a page of the Machine place
 *  /p/babysee                 one product
 *  /p/babysee/branches        …the faces it has beside its code
 *  /p/babysee/board           …its board
 *  /p/babysee/chat/9f2c…      …its chats, and the one that is open
 *  /p/babysee/b/engineering   …one of its faces
 *  /p/babysee/c/0d2279020af7  …and one card, wherever that card lives
 *  ```
 */
export function pathOf(place: Place): string {
  if (place.view === 'chats') return place.chat ? `/chats/${enc(place.chat)}` : '/chats';
  if (place.view !== 'overview') return `/machine/${place.view}`;
  if (!place.project) return '/';
  const head = `/p/${enc(place.project)}`;
  if (place.card) return `${head}/c/${enc(place.card)}`;
  if (place.branch) return `${head}/b/${enc(place.branch)}`;
  if (place.tab === 'board' || place.tab === 'branches') return `${head}/${place.tab}`;
  // The product's own chats, and the one that is open among them.
  if (place.tab === 'chat') return place.chat ? `${head}/chat/${enc(place.chat)}` : `${head}/chat`;
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
      tab: q.get('tab') === 'board' || q.get('tab') === 'branches'
        ? (q.get('tab') as string) : 'overview',
      branch: (q.get('branch') || '').trim() || null,
      // …including a card named the old way, `host:id`, whose tail is the id.
      card: ((q.get('card') || '').trim().split(':').pop() || null),
      chat: (q.get('chat') || '').trim() || null,
      host,
    };
  }

  if (!parts.length) return place;
  if (parts[0] === 'chats') return { ...place, view: 'chats', chat: parts[1] ?? null };
  if (parts[0] === 'machine') {
    const view = parts[1] as View;
    return { ...place, view: MACHINE.includes(view) ? view : 'machines' };
  }
  if (parts[0] === 'p' && parts[1]) {
    const scoped: Place = { ...place, project: parts[1] };
    if (parts[2] === 'board' || parts[2] === 'branches') return { ...scoped, tab: parts[2] };
    if (parts[2] === 'chat') return { ...scoped, tab: 'chat', chat: parts[3] ?? null };
    if (parts[2] === 'b' && parts[3]) return { ...scoped, branch: parts[3] };
    if (parts[2] === 'c' && parts[3]) return { ...scoped, card: parts[3], tab: 'board' };
    return scoped;
  }
  return place;
}

/** Two places that would draw the same screen. What it is for: not pushing a
 *  second history entry for a state change that moved nothing — a board poll
 *  answering, a chat being renamed under you. */
export function samePlace(a: Place, b: Place): boolean {
  return (['view', 'project', 'tab', 'branch', 'card', 'chat', 'host'] as (keyof Place)[])
    .every((k) => a[k] === b[k]);
}
