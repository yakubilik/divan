/** How the chat list is read into headings: the phone's copy of the web
 *  sidebar's `sections()` (web/src/components/Sidebar.tsx), kept pure so it can
 *  be checked without a phone. The web also ages quiet chats into an Archive;
 *  the phone keeps its own archive switch instead, so that part is not here. */
import type { Chat, Group } from './protocol';

export type Section = { id: string; title: string; mono: boolean; data: Chat[]; count: number };

/** The one section the flat view draws. It is never shown as a heading, so it
 *  needs an id no group or folder could ever collide with. */
export const FLAT = '__flat__';

const home = (path: string) => path
  .replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/');

export function chatSections({ chats, groups, productNames, q, collapsed, showArchived, flat, daily: dailyTitle, only }: {
  chats: Record<string, Chat>; groups: Group[];
  /** Product names by id, for a chat whose answer carried only the id. */
  productNames: Record<string, string>;
  q: string; collapsed: Record<string, boolean>; showArchived: boolean; flat: boolean;
  /** The loose heading beside others, and the same heading when it is alone. */
  daily: string; only: string;
}): Section[] {
  // `chats` is keyed by id, so its natural order is whenever each chat was first
  // seen — sort explicitly: pinned first, then most recently active.
  const needle = q.toLowerCase();
  const all = Object.values(chats)
    .filter((ch) => (showArchived || !ch.archived) && (!q || ch.title.toLowerCase().includes(needle) || ch.last_preview.toLowerCase().includes(needle)))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
  // Grouping is a way of reading the list, not a property of it. Asked for the
  // flat view, hand back one unnamed section: same chats, newest first, no
  // walls. Nothing is regrouped or forgotten — the groups are still there the
  // moment the view is switched back.
  if (flat) return [{ id: FLAT, title: '', mono: false, data: all, count: all.length }];

  // A chat is under the group somebody put it in, if that group still exists;
  // failing that, under the product the computer filed it as — and where a
  // group already carries that product's name, the two are one heading rather
  // than two with the same words. A group that has since been deleted claims
  // nothing, so its chats fall through rather than vanishing with it.
  const made = new Set(groups.map((g) => g.id));
  const named = new Map(groups.map((g) => [g.name.toLocaleLowerCase(), g.id]));
  const byGroup: Record<string, Chat[]> = {};
  const byProject = new Map<string, Chat[]>();
  // What neither claims falls into sections by the folder it works in. One
  // project is one section without anybody naming it, and a single folder is
  // not a grouping at all, so it stays as one plain list. A chat somebody moved
  // to Daily stays there, whatever folder it is in; so does one with no folder.
  const byCwd: Record<string, Chat[]> = {};
  const daily: Chat[] = [];
  for (const ch of all) {
    const project = ch.project || (ch.project_id ? productNames[ch.project_id] : undefined);
    const group = ch.group_id && made.has(ch.group_id) ? ch.group_id
      : project ? named.get(project.toLocaleLowerCase()) : undefined;
    if (group) (byGroup[group] ||= []).push(ch);
    else if (project) byProject.set(project, [...(byProject.get(project) ?? []), ch]);
    else if ((ch.project_set && !ch.project_id) || !ch.cwd) daily.push(ch);
    else (byCwd[ch.cwd] ||= []).push(ch);
  }

  const out: Section[] = groups.map((g) => ({ id: g.id, title: g.name, mono: false, data: collapsed[g.id] ? [] : (byGroup[g.id] ?? []), count: byGroup[g.id]?.length ?? 0 }));
  for (const [name, data] of byProject) {
    const id = `project:${name}`;
    out.push({ id, title: name, mono: false, data: collapsed[id] ? [] : data, count: data.length });
  }
  const folders = Object.keys(byCwd);
  if (folders.length > 1) {
    folders
      .sort((a, b) => (byCwd[b][0]?.updated_at ?? 0) - (byCwd[a][0]?.updated_at ?? 0))
      .forEach((path) => {
        const id = `cwd:${path}`;
        out.push({ id, title: home(path), mono: true, data: collapsed[id] ? [] : byCwd[path], count: byCwd[path].length });
      });
  } else daily.push(...(byCwd[folders[0]] ?? []));
  if (daily.length || (groups.length === 0 && out.length === 0)) {
    daily.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
    out.push({ id: '', title: out.length ? dailyTitle : only, mono: false,
               data: collapsed[''] ? [] : daily, count: daily.length });
  }
  return out;
}
