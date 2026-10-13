/** The phone's chat list, read into headings exactly the way the web sidebar
 *  reads it: the sectioning itself is `./chat-list.ts`, a byte-for-byte copy of
 *  the web's `web/src/lib/chat-list.ts`. What is here is only what the phone
 *  adds around it — its archive switch, its flat view, and the shape a
 *  `SectionList` wants. */
import type { Chat, Group } from './protocol';
import {
  byRecency, hostSections, matches, needle, newChatIn, ownerOf, personCounts, whoseChats,
  type Section as Read,
} from './chat-list';

export type Section = {
  id: string; title: string; kind: Read['kind'] | 'flat'; mono: boolean;
  /** Empty while the heading is shut. */
  data: Chat[]; count: number; shut: boolean;
  /** Whether the heading offers its own + , as the web's does. */
  plus: boolean;
};

/** The one section the flat view draws. It is never shown as a heading, so it
 *  needs an id no group or folder could ever collide with. */
export const FLAT = '__flat__';

export type People = { names: string[]; me: string | null };

export function chatSections({ chats, groups, people, chosen, saved, productNames, projects, q, collapsed, showArchived, flat, now }: {
  chats: Record<string, Chat>; groups: Group[];
  people: People;
  /** Whose chats were picked on this phone for this computer (`''` everyone). */
  chosen: string | undefined;
  /** The order the sections were arranged into on this phone. */
  saved: string[];
  /** Product names by id, for a chat whose answer carried only the id. */
  productNames: Record<string, string>;
  projects?: { name: string; path: string }[];
  q: string; collapsed: Record<string, boolean>;
  /** Also list the chats archived by hand, which the web never fetches, and
   *  open the Archive. Off, the phone lists exactly what the web does. */
  showArchived: boolean;
  flat: boolean; now: number;
}): { sections: Section[]; who: string | null; counts: Record<string, number>; shared: boolean } {
  const names = people.names;
  const shared = names.length > 1;
  const who = whoseChats(names, people.me, chosen);
  const list = Object.values(chats)
    .filter((c) => showArchived || !c.archived)
    .map((c) => (!c.project && c.project_id && productNames[c.project_id] ? { ...c, project: productNames[c.project_id] } : c));
  const counts = personCounts(list, names);

  // Grouping is a way of reading the list, not a property of it. Asked for the
  // flat view, hand back one unnamed section: the same chats, pinned and then
  // newest first, no walls.
  if (flat) {
    const n = needle(q);
    const all = byRecency(list.filter((c) => (!who || ownerOf(c, names) === who) && matches(c, n)));
    return { sections: [{ id: FLAT, title: '', kind: 'flat', mono: false, data: all, count: all.length, shut: false, plus: false }],
             who, counts, shared };
  }

  const read = hostSections({ chats: list, groups, hostKey: '', query: q, who, names, saved, now });
  const sections = read.map((s): Section => {
    // The archive is everything that is not today, so it starts shut — except
    // under a search, which is looking through it, or with the switch on.
    const shut = collapsed[s.key] ?? (s.kind === 'archive' && !q.trim() && !showArchived);
    return { id: s.key, title: s.title, kind: s.kind, mono: s.kind === 'folder', data: shut ? [] : s.chats,
             count: s.chats.length, shut, plus: newChatIn(s, projects).offered };
  });
  return { sections, who, counts, shared };
}
