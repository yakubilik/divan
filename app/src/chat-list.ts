/** How a chat list is read into headings — the web sidebar's and the phone's.
 *
 *  This file exists twice, byte for byte: `web/src/lib/chat-list.ts` and
 *  `app/src/chat-list.ts`. The two packages are bundled apart (Vite, Metro) and
 *  neither reaches into the other's folder, so the one source of truth is kept
 *  as two copies that a test holds identical (`app/scripts/test-chat-list.cjs`).
 *  Change one, copy it over the other. Everything here is pure: chats in,
 *  sections out, no clock read and no storage touched. */
import type { Chat, Group } from './protocol';

/** `group` is the only kind somebody made, and so the only one with a name to
 *  change or a heading to take away. `project` is a product the chats were
 *  filed under, and carries that product's id on this computer so a chat can
 *  be dropped into it; `archive` is where everything that has gone quiet ends up. */
export interface Section {
  key: string; title: string; hostKey: string; chats: Chat[];
  kind: 'group' | 'project' | 'folder' | 'loose' | 'archive' | 'host';
  projectId?: string;
}

/** The fields of a computer the merged and per-product lists read. */
export interface ListHost {
  chats: Chat[];
  info?: { name?: string } | null;
  cfg: { name: string };
}

/** How long a chat stays in the list after it last moved. */
export const CURRENT_S = 24 * 3600;

/** Whether a chat is still part of today. One that is pinned was put there to
 *  stay, and one that is working or waiting on an answer is the opposite of
 *  gone quiet, however long ago its last line was. */
export const isCurrent = (c: Chat, now: number) =>
  !c.archived && (!!c.pinned || c.status !== 'idle' || c.updated_at > now - CURRENT_S);

const rank = (c: Chat) => (c.pinned ? 0 : 1);
/** Pinned first, then the most recently active. Sorts in place. */
export const byRecency = (a: Chat[]) => a.sort((x, y) => rank(x) - rank(y) || y.updated_at - x.updated_at);

/** What a typed search is compared as. */
export const needle = (query: string) => query.trim().toLocaleLowerCase('tr');

/** `q` is already a needle. */
/** A chat nobody has written in: the pen pressed and put down. It is in no
 *  list — the daemon deletes it an hour on (`drop_empty`) — and shows up the
 *  moment its first line is sent, which writes the preview. */
export const isEmpty = (c: Chat) => !c.last_preview && c.status === 'idle' && !c.pinned;

/** Whether a chat is listed under a search; an empty chat never is. */
export function matches(c: Chat, q: string): boolean {
  if (isEmpty(c)) return false;
  if (!q) return true;
  return (c.title || '').toLocaleLowerCase('tr').includes(q)
    || (c.last_preview || '').toLocaleLowerCase('tr').includes(q)
    || (c.cwd || '').toLocaleLowerCase('tr').includes(q);
}

const hostName = (h: ListHost) => h.info?.name || h.cfg.name;

/** All computers at once: the sections become the computers themselves. The
 *  groups are a per-computer idea and would nest two deep here, so inside a
 *  computer the chats are simply the most recent first. */
export function fleetSections(hosts: Record<string, ListHost>, order: string[], q: string): Section[] {
  const out: Section[] = [];
  for (const k of order) {
    const slot = hosts[k];
    if (!slot) continue;
    const chats = byRecency(slot.chats.filter((c) => !c.archived && matches(c, q)));
    if (!chats.length) continue;
    out.push({ key: k, title: hostName(slot), hostKey: k, chats, kind: 'host' });
  }
  return out;
}

/** A product's own chats: the ones each computer filed under it and nothing
 *  else, today's first and the rest under an archive. A computer at a time,
 *  because a chat is opened on the computer that holds it — and with one
 *  computer, which is nearly always, that is one list and one archive. */
export function projectSections(
  hosts: Record<string, ListHost>, ids: Record<string, string>, q: string, now: number,
): Section[] {
  const keys = Object.keys(ids).filter((k) => hosts[k] && ids[k]);
  const today: Section[] = [];
  const quiet: Section[] = [];
  for (const k of keys) {
    const name = hostName(hosts[k]);
    const mine = byRecency(hosts[k].chats.filter((c) => c.project_id === ids[k] && matches(c, q)));
    const cur = mine.filter((c) => isCurrent(c, now));
    const old = mine.filter((c) => !isCurrent(c, now));
    if (cur.length) today.push({ key: `chats:${k}`, title: keys.length > 1 ? name : 'Chats', hostKey: k, chats: cur, kind: 'loose' });
    if (old.length) quiet.push({ key: `__archive:${k}`, title: keys.length > 1 ? `Archive · ${name}` : 'Archive', hostKey: k, chats: old, kind: 'archive' });
  }
  return [...today, ...quiet];
}

export const home = (path: string) => path
  .replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/');

/** One computer's list, which is the chats of the last day and nothing else:
 *  what has gone quiet falls out of its section into one `Archive` at the
 *  bottom, and comes back by itself the moment it moves again.
 *
 *  A current chat is under the group somebody put it in; failing that, under
 *  the product the computer filed it as — and where a group already carries
 *  that product's name, the two are one section rather than two with the same
 *  heading. What neither claims falls into sections by folder, the way the
 *  phone lists them; a single folder is not a grouping, so it stays one list:
 *  Daily. A chat somebody moved to Daily is there whatever folder it is in.
 *
 *  A group is drawn even with nothing in it — it is where the next chats go,
 *  and one that vanished the moment it was made would read as the button
 *  having done nothing. A search is the exception: it is asking where a chat
 *  is, and an empty heading is not an answer. */
/** The product a chat is filed under, or nothing when only the folder it was
 *  opened in said so (`project_by: 'folder'`): a chat that never touched a
 *  product's files — a question, a plan, a search — is not that product's work,
 *  and goes to Daily. One a person filed is theirs whatever filed it. */
export function filedProject(c: Chat): string | null {
  if (!c.project || (c.project_by === 'folder' && !c.project_set)) return null;
  return c.project;
}

export function sections(chats: Chat[], groups: Group[], hostKey: string, searching: boolean, now: number): Section[] {
  const named = new Map(groups.map((g) => [g.name.toLocaleLowerCase(), g.id]));
  const made = new Set(groups.map((g) => g.id));
  const byGroup = new Map<string, Chat[]>();
  const byProject = new Map<string, Chat[]>();
  const byCwd = new Map<string, Chat[]>();
  const daily: Chat[] = [];
  const quiet: Chat[] = [];
  const put = (m: Map<string, Chat[]>, k: string, c: Chat) => { m.set(k, [...(m.get(k) ?? []), c]); };
  for (const c of byRecency([...chats])) {
    const project = filedProject(c);
    const group = c.group_id && made.has(c.group_id) ? c.group_id
      : project ? named.get(project.toLocaleLowerCase()) : undefined;
    if (!isCurrent(c, now)) quiet.push(c);
    else if (group) put(byGroup, group, c);
    else if (project) put(byProject, project, c);
    else if ((c.project_set && !c.project_id) || c.project_by === 'folder') daily.push(c);
    else put(byCwd, c.cwd || '', c);
  }
  const out: Section[] = [];
  for (const g of [...groups].sort((a, b) => a.sort - b.sort)) {
    const arr = byGroup.get(g.id) ?? [];
    if (arr.length || !searching) out.push({ key: g.id, title: g.name, hostKey, chats: arr, kind: 'group' });
  }
  for (const [name, arr] of byProject) {
    out.push({ key: `project:${name}`, title: name, hostKey, chats: arr, kind: 'project',
               projectId: arr[0].project_id ?? undefined });
  }
  for (const [path, arr] of byCwd) {
    if (byCwd.size > 1 && path) out.push({ key: `cwd:${path}`, title: home(path), hostKey, chats: arr, kind: 'folder' });
    else daily.push(...arr);
  }
  // Drawn empty beside other sections, like a group: it is where a chat is
  // dropped to take it out of its group and its product.
  if (daily.length || (out.length && !searching)) {
    out.push({ key: '__loose', title: out.length ? 'Daily' : 'Chats', hostKey, chats: byRecency(daily), kind: 'loose' });
  }
  if (quiet.length) out.push({ key: '__archive', title: 'Archive', hostKey, chats: quiet, kind: 'archive' });
  return out;
}

/** The sections as they were arranged. One nobody has placed keeps the place
 *  it would have had, after the ones somebody did; the archive is last
 *  whatever anybody dragged. */
export function arrange(list: Section[], saved: string[]): Section[] {
  const at = (s: Section) => {
    if (s.kind === 'archive') return saved.length + 1;
    const i = saved.indexOf(s.key);
    return i < 0 ? saved.length : i;
  };
  return list.map((s, i) => [s, i] as const)
    .sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([s]) => s);
}

/** The saved order once the section `key` is put down this side of `to`.
 *  What is not on screen today keeps its place behind what is. */
export function reorder(list: Section[], saved: string[], key: string, to: string, after: boolean): string[] {
  const keys = list.filter((s) => s.kind !== 'archive' && s.key !== key).map((s) => s.key);
  keys.splice(keys.indexOf(to) + (after ? 1 : 0), 0, key);
  return [...keys, ...saved.filter((k) => !keys.includes(k))];
}

/** The folder a heading's own + opens a chat in: a folder's own path, else
 *  the first of its chats that has one, else the project of that name. A group
 *  with nothing in it yet has no folder to offer, and still takes a chat, so
 *  `true` there with no folder; the archive offers none. */
export function newChatIn(s: Section, projects: { name: string; path: string }[] | undefined): { offered: boolean; cwd?: string } {
  if (s.kind === 'archive') return { offered: false };
  const cwd = s.kind === 'folder' ? s.key.slice(4)
    : s.chats.find((c) => c.cwd)?.cwd
      ?? projects?.find((p) => p.name === s.title)?.path;
  return { offered: !!cwd || s.kind === 'group', cwd };
}

export const EVERYONE = 'Everyone';

/** Whose a chat is: a chat from before there were people is the first person's. */
export const ownerOf = (c: Chat, names: string[]) => (c.owner && names.includes(c.owner) ? c.owner : names[0]);

/** Whose chats the list shows, on a computer more than one person uses: what
 *  was picked here (`''` is everyone), failing that this device's own person.
 *  Null is everyone's. */
export function whoseChats(names: string[], me: string | null | undefined, chosen: string | undefined): string | null {
  if (names.length < 2) return null;
  if (chosen === '') return null;
  if (chosen && names.includes(chosen)) return chosen;
  return me ?? null;
}

/** How many chats each person has, over the whole list. */
export function personCounts(chats: Chat[], names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (names.length > 1) for (const c of chats) if (!isEmpty(c)) out[ownerOf(c, names)] = (out[ownerOf(c, names)] ?? 0) + 1;
  return out;
}

/** One computer's list as it is drawn: that person's chats, searched, read
 *  into sections and put in the order somebody arranged them. */
export function hostSections({ chats, groups, hostKey, query, who, names, saved, now }: {
  chats: Chat[]; groups: Group[]; hostKey: string; query: string;
  who: string | null; names: string[]; saved: string[]; now: number;
}): Section[] {
  const q = needle(query);
  const mine = who ? chats.filter((c) => ownerOf(c, names) === who) : chats;
  return arrange(sections(mine.filter((c) => matches(c, q)), groups, hostKey, !!q, now), saved);
}
