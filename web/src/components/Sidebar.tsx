import { useEffect, useMemo, useRef, useState } from 'react';
import { C, R, SHADOW } from '../lib/theme';
import { Dot, Icon, P, Pulse, mono } from '../ui/kit';
import { ago, bareTitle, uptime } from '../lib/format';
import { useFleet, type HostSlot } from '../lib/fleet';
import { createGroup, deleteChat, deleteGroup, renameGroup, updateChat } from '../lib/actions';
import { hasChatDrag, hasSectionDrag, readChatDrag, readSectionDrag, setChatDrag, setSectionDrag } from '../lib/dnd';
import { DeleteChatDialog } from './ChatMenu';
import { DeleteGroupDialog, GroupNameDialog } from './GroupDialogs';
import type { Chat, Group } from '../lib/protocol';
import { refusalText } from '../lib/refusal';

const W = 260;
/** Collapsed, the sidebar is a strip with the way back to the list on it and
 *  the button that starts a chat. Anything narrower stops being a target. */
const RAIL = 48;
const ALL_LABEL = 'All computers';
const NOBODY: string[] = [];

export function ProviderMark({ provider, dim }: { provider: string; dim?: boolean }) {
  const claude = provider === 'claude';
  // `dim` is "this one is not there": an account not signed in, a tool not
  // installed. It goes grey rather than faint — fading the whole tile toward
  // the page put its mark at 2.2:1 on a light one, and whether the tool is
  // there is the one thing the tile has to say.
  const live = !dim;
  return (
    <div style={{
      width: 30, height: 30, borderRadius: R.btn, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: claude && live ? C.accentTint : C.surface2,
      border: `1px solid ${claude && live ? C.accentRing : C.border}`,
      color: claude && live ? C.accentSoft : C.mute,
      fontSize: claude ? 13 : 11, fontWeight: 600,
      ...(claude ? {} : mono),
    }}>
      {claude ? 'A' : '<>'}
    </div>
  );
}

function hostDetail(slot: HostSlot): string {
  if (slot.status === 'online') return `online · :${slot.cfg.port}`;
  if (slot.status === 'connecting') return 'connecting…';
  if (slot.status === 'unauthorized') return refusalText(slot.refusal).short;
  return slot.lastOnline ? `offline · ${ago(slot.lastOnline / 1000)}` : 'offline';
}

function HostCard({ hosts, order, focus, allHosts, onFocus, onAll }: {
  hosts: Record<string, HostSlot>; order: string[]; focus: string | null;
  allHosts: boolean;
  onFocus: (k: string) => void;
  onAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const slot = focus ? hosts[focus] : null;
  const online = slot?.status === 'online';
  const many = order.length > 1;
  const onlineCount = order.filter((k) => hosts[k]?.status === 'online').length;

  if (!slot) {
    return (
      <div style={{
        border: `1px solid ${C.border}`, borderRadius: R.card, background: C.bg,
        padding: '12px 14px', fontSize: 12, color: C.mute,
      }}>No computer paired yet</div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: R.card, background: C.bg, overflow: 'hidden' }}>
      <button
        type="button" onClick={() => many && setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px',
          background: 'transparent', border: 'none',
          cursor: many ? 'pointer' : 'default', textAlign: 'left',
        }}
      >
        <Icon path={allHosts ? P.grid : P.cpu} size={16} color={allHosts ? C.accentSoft : C.mute} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{allHosts ? ALL_LABEL : (slot.info?.name || slot.cfg.name)}</div>
          <div style={{
            fontSize: 11, color: C.mute, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2,
          }}>
            <Dot
              color={allHosts
                ? (onlineCount ? C.ok : C.faint)
                : online ? C.ok : slot.status === 'unauthorized' ? C.danger : C.faint}
              live={allHosts ? onlineCount > 0 : online} size={5}
            />
            <span
              title={!allHosts && slot.status === 'unauthorized' ? refusalText(slot.refusal).long : undefined}
              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {allHosts ? `${order.length} computers · ${onlineCount} online` : hostDetail(slot)}
            </span>
          </div>
        </div>
        {many && <Icon path={open ? P.chevronDown : P.chevronRight} size={13} color={C.faint} />}
      </button>
      {/* Only worth offering with more than one computer paired: with one, the
          merged list and that computer's list are the same list. */}
      {open && many && !allHosts && (
        <button
          type="button"
          onClick={() => { onAll(); setOpen(false); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
            padding: '0 12px', background: 'transparent', border: 'none',
            borderTop: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <Icon path={P.grid} size={13} color={C.accentSoft} />
          <span style={{ flex: 1, fontSize: 12, color: C.text2 }}>{ALL_LABEL}</span>
          <span style={{ fontSize: 11, color: C.faint }}>{order.length}</span>
        </button>
      )}
      {open && order.filter((k) => k !== focus || allHosts).map((k) => {
        const s = hosts[k];
        return (
          <button
            key={k} type="button"
            onClick={() => { onFocus(k); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
              padding: '0 12px', background: 'transparent', border: 'none',
              borderTop: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Dot color={s.status === 'online' ? C.ok : C.faint} live={s.status === 'online'} size={5} />
            <span style={{
              flex: 1, fontSize: 12, color: C.text2, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{s.info?.name || s.cfg.name}</span>
            <span style={{ fontSize: 11, color: C.faint }}>{hostDetail(s).split(' · ')[0]}</span>
          </button>
        );
      })}
    </div>
  );
}

const EVERYONE = 'Everyone';
const PERSON_KEY = 'rac.person';

function savedPeople(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PERSON_KEY) || '{}') ?? {}; } catch { return {}; }
}

/** Whose chats the list shows, on a computer more than one person uses. Above
 *  every group, and picked the way a computer is: the one showing, and the
 *  others under it. */
function PersonCard({ names, who, counts, onPick }: {
  names: string[]; who: string | null; counts: Record<string, number>;
  onPick: (who: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = names.reduce((n, p) => n + (counts[p] ?? 0), 0);
  const line = (key: string, label: string, n: number, pick: string | null) => (
    <button
      key={key} type="button"
      onClick={() => { onPick(pick); setOpen(false); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
        padding: '0 12px', background: 'transparent', border: 'none',
        borderTop: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
      }}
    >
      <Icon path={P.users} size={13} color={pick ? C.mute : C.accentSoft} />
      <span style={{ flex: 1, fontSize: 12, color: C.text2 }}>{label}</span>
      <span style={{ fontSize: 11, color: C.faint }}>{n}</span>
    </button>
  );
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: R.card, background: C.bg, overflow: 'hidden' }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        aria-label="Whose chats" data-person={who ?? 'all'}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 34, padding: '0 12px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Icon path={P.users} size={14} color={who ? C.mute : C.accentSoft} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{who ?? EVERYONE}</span>
        <span style={{ fontSize: 11, color: C.faint }}>{who ? (counts[who] ?? 0) : total}</span>
        <Icon path={open ? P.chevronDown : P.chevronRight} size={13} color={C.faint} />
      </button>
      {open && who && line('__all', EVERYONE, total, null)}
      {open && names.filter((p) => p !== who).map((p) => line(p, p, counts[p] ?? 0, p))}
    </div>
  );
}

/** `group` is the only kind somebody made, and so the only one with a name to
 *  change or a heading to take away. `project` is a product the chats were
 *  filed under, and carries that product's id on this computer so a chat can
 *  be dropped into it; `archive` is where everything that has gone quiet ends up. */
interface Section {
  key: string; title: string; hostKey: string; chats: Chat[];
  kind: 'group' | 'project' | 'folder' | 'loose' | 'archive' | 'host';
  projectId?: string;
}

/** How long a chat stays in the list after it last moved. */
const CURRENT_S = 24 * 3600;

/** Whether a chat is still part of today. One that is pinned was put there to
 *  stay, and one that is working or waiting on an answer is the opposite of
 *  gone quiet, however long ago its last line was. */
const isCurrent = (c: Chat, now: number) =>
  !c.archived && (!!c.pinned || c.status !== 'idle' || c.updated_at > now - CURRENT_S);

const rank = (c: Chat) => (c.pinned ? 0 : 1);
const byRecency = (a: Chat[]) => a.sort((x, y) => rank(x) - rank(y) || y.updated_at - x.updated_at);

function matches(c: Chat, q: string): boolean {
  if (!q) return true;
  return (c.title || '').toLocaleLowerCase('tr').includes(q)
    || (c.last_preview || '').toLocaleLowerCase('tr').includes(q)
    || (c.cwd || '').toLocaleLowerCase('tr').includes(q);
}

/** All computers at once: the sections become the computers themselves. The
 *  groups are a per-computer idea and would nest two deep here, so inside a
 *  computer the chats are simply the most recent first. */
function fleetSections(hosts: Record<string, HostSlot>, order: string[], q: string): Section[] {
  const out: Section[] = [];
  for (const k of order) {
    const slot = hosts[k];
    if (!slot) continue;
    const chats = byRecency(slot.chats.filter((c) => !c.archived && matches(c, q)));
    if (!chats.length) continue;
    out.push({ key: k, title: slot.info?.name || slot.cfg.name, hostKey: k, chats, kind: 'host' });
  }
  return out;
}

/** A product's own chats: the ones each computer filed under it and nothing
 *  else, today's first and the rest under an archive. A computer at a time,
 *  because a chat is opened on the computer that holds it — and with one
 *  computer, which is nearly always, that is one list and one archive. */
function projectSections(
  hosts: Record<string, HostSlot>, ids: Record<string, string>, q: string, now: number,
): Section[] {
  const keys = Object.keys(ids).filter((k) => hosts[k] && ids[k]);
  const today: Section[] = [];
  const quiet: Section[] = [];
  for (const k of keys) {
    const name = hosts[k].info?.name || hosts[k].cfg.name;
    const mine = byRecency(hosts[k].chats.filter((c) => c.project_id === ids[k] && matches(c, q)));
    const cur = mine.filter((c) => isCurrent(c, now));
    const old = mine.filter((c) => !isCurrent(c, now));
    if (cur.length) today.push({ key: `chats:${k}`, title: keys.length > 1 ? name : 'Chats', hostKey: k, chats: cur, kind: 'loose' });
    if (old.length) quiet.push({ key: `__archive:${k}`, title: keys.length > 1 ? `Archive · ${name}` : 'Archive', hostKey: k, chats: old, kind: 'archive' });
  }
  return [...today, ...quiet];
}

const home = (path: string) => path
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
function sections(chats: Chat[], groups: Group[], hostKey: string, searching: boolean, now: number): Section[] {
  const named = new Map(groups.map((g) => [g.name.toLocaleLowerCase(), g.id]));
  const made = new Set(groups.map((g) => g.id));
  const byGroup = new Map<string, Chat[]>();
  const byProject = new Map<string, Chat[]>();
  const byCwd = new Map<string, Chat[]>();
  const daily: Chat[] = [];
  const quiet: Chat[] = [];
  const put = (m: Map<string, Chat[]>, k: string, c: Chat) => { m.set(k, [...(m.get(k) ?? []), c]); };
  for (const c of byRecency([...chats])) {
    const group = c.group_id && made.has(c.group_id) ? c.group_id
      : c.project ? named.get(c.project.toLocaleLowerCase()) : undefined;
    if (!isCurrent(c, now)) quiet.push(c);
    else if (group) put(byGroup, group, c);
    else if (c.project) put(byProject, c.project, c);
    else if (c.project_set && !c.project_id) daily.push(c);
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

/** The order somebody dragged the sections into, per computer. Kept in this
 *  browser: the sections are this list's way of reading the chats — half of
 *  them are products nobody made a group for — so there is no row on the
 *  computer for an order to be written on. */
const ORDER_KEY = 'rac.chatSections';

function savedOrders(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '{}') ?? {}; } catch { return {}; }
}

/** The sections as they were arranged. One nobody has placed keeps the place
 *  it would have had, after the ones somebody did; the archive is last
 *  whatever anybody dragged. */
function arrange(list: Section[], saved: string[]): Section[] {
  const at = (s: Section) => {
    if (s.kind === 'archive') return saved.length + 1;
    const i = saved.indexOf(s.key);
    return i < 0 ? saved.length : i;
  };
  return list.map((s, i) => [s, i] as const)
    .sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([s]) => s);
}

/** A screen with nothing to hover with shows the row's bin all the time. */
const NO_HOVER = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
const BIN = 28;

function ChatRow({ chat, selected, onPick, onDrag, onDelete, under }: {
  chat: Chat; selected: boolean; onPick: () => void;
  /** The project whose heading this row is read under, where it has one: the
   *  title then leaves that name out and starts with what the chat is about. */
  under?: string | null;
  /** Set where the row can be picked up and filed under another heading. */
  onDrag?: (dt: DataTransfer) => void;
  /** Asks before it deletes: the row only says which chat was meant. */
  onDelete: () => void;
}) {
  const awaiting = chat.status === 'awaiting_approval';
  const running = chat.status === 'running';
  const [over, setOver] = useState(false);
  // The bin is beside the row and not inside it — a button inside a button is
  // not one — and stands where the row's clock is, which gives way to it.
  const bin = over || NO_HOVER;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}
      onFocus={() => setOver(true)} onBlur={() => setOver(false)}
    >
    <button
      type="button" onClick={onPick} className={selected ? 'dv-tinted' : undefined}
      draggable={!!onDrag} onDragStart={onDrag && ((e) => onDrag(e.dataTransfer))}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 56,
        padding: NO_HOVER ? `8px ${BIN + 12}px 8px 10px` : '8px 10px',
        borderRadius: R.card, cursor: 'pointer', textAlign: 'left',
        background: selected ? C.accentTint : 'transparent',
        border: `1px solid ${selected ? C.accentRing : 'transparent'}`,
      }}
    >
      <ProviderMark provider={chat.provider} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500, color: C.text, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{under !== undefined ? bareTitle(chat.title, chat.cwd, under) : chat.title || 'New chat'}</div>
        <div style={{
          fontSize: 12, color: awaiting ? C.warn : C.mute, display: 'flex',
          alignItems: 'center', gap: 4, marginTop: 2, minWidth: 0,
        }}>
          {awaiting && <Icon path={P.warn} size={11} color={C.warn} />}
          <span style={{
            ...(awaiting ? mono : null),
            minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {chat.last_preview || (running ? 'Running…' : 'Empty chat')}
          </span>
        </div>
      </div>
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center',
        visibility: over && !NO_HOVER ? 'hidden' : undefined,
      }}>
        {awaiting ? (
          <span style={{
            ...mono, fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
            color: C.warn, background: C.warnBg,
            border: `1px solid ${C.warnLine}`, borderRadius: R.badge, padding: '2px 6px',
          }}>APPROVE</span>
        ) : running ? <Pulse /> : (
          <span style={{ fontSize: 11, color: C.faint }}>{ago(chat.updated_at)}</span>
        )}
      </div>
    </button>
    {bin && (
      <button
        type="button" onClick={onDelete}
        title="Delete chat" aria-label={`Delete chat: ${chat.title || 'New chat'}`}
        style={{
          position: 'absolute', right: 8, top: '50%', marginTop: -BIN / 2,
          width: BIN, height: BIN, borderRadius: R.btn, cursor: 'pointer',
          background: C.surface3, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon path={P.trash} size={14} color={C.danger} />
      </button>
    )}
    </div>
  );
}

// `collapsed` arrives renamed: the section headers in the list below already
// own that word, and two different things called collapsed in one component is
// how you end up hiding the wrong one.
export function Sidebar({ selected, selectedHost, onSelect, onNewChat, onNewChatIn, searchRef,
                          collapsed: railed = false, onCollapse, project }: {
  /** On a product's own page: the list is that product's chats, on whichever
   *  computers have it, and the things that are about one computer's whole
   *  list — which computer, its groups, their order — are not offered. */
  project?: { ids: Record<string, string> } | null;
  selected: string | null;
  selectedHost: string | null;
  onSelect: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
  /** A chat that opens already in this folder, from a heading's own + . Under
   *  a group's heading it is also filed in that group: that is what the + there
   *  says, whatever folder the chat ends up working in. */
  onNewChatIn?: (hostKey: string, cwd: string | undefined, groupId?: string) => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  collapsed?: boolean;
  onCollapse?: (next: boolean) => void;
}) {
  const { hosts, order, focus, allHosts, setFocus, setAllHosts } = useFleet();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** The group whose heading has its menu open, and what is being asked about
   *  a group in a dialog. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [asking, setAsking] = useState<
    { what: 'new' }
    | { what: 'rename' | 'delete' | 'delete-chat'; hostKey: string; id: string; name: string } | null
  >(null);

  // Which chats are a day old is a question about the clock, and a list left
  // open overnight has to notice the answer changing.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => clearInterval(tick);
  }, []);

  const [orders, setOrders] = useState(savedOrders);
  const saved = (focus && orders[focus]) || [];

  const slot = focus ? hosts[focus] : null;
  // Whose chats are showing. Each browser opens on its own person's, and
  // remembers what was picked instead, per computer.
  const [picked, setPicked] = useState(savedPeople);
  const names = slot?.people?.names ?? NOBODY;
  const shared = names.length > 1 && !project;
  const chosen = focus ? picked[focus] : undefined;
  const who = !shared ? null
    : chosen === '' ? null
    : chosen && names.includes(chosen) ? chosen
    : (slot?.people?.me ?? null);
  const pickPerson = (p: string | null) => {
    if (!focus) return;
    const next = { ...picked, [focus]: p ?? '' };
    setPicked(next);
    try { localStorage.setItem(PERSON_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const ownerOf = (c: Chat) => (c.owner && names.includes(c.owner) ? c.owner : names[0]);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (shared) for (const c of slot?.chats ?? []) out[ownerOf(c)] = (out[ownerOf(c)] ?? 0) + 1;
    return out;
  }, [shared, slot?.chats, names]);
  // One computer paired means there is nothing to merge: the fleet list and
  // that computer's list would be the same list, minus its groups.
  const fleetWide = !project && allHosts && order.length > 1;
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (project) return projectSections(hosts, project.ids, q, now);
    if (fleetWide) return fleetSections(hosts, order, q);
    if (!slot) return [] as Section[];
    const mine = who ? slot.chats.filter((c) => ownerOf(c) === who) : slot.chats;
    return arrange(sections(mine.filter((c) => matches(c, q)), slot.groups, focus!, !!q, now), saved);
  }, [fleetWide, hosts, order, slot?.chats, slot?.groups, focus, query, now, saved.join('\n'), project?.ids,
      who, names]);
  // Groups belong to one computer, so there is one to make only while the list
  // is one computer's.
  const canGroup = !!slot && !!focus && !fleetWide && !project;
  /** The heading a dragged chat is over. */
  const [over, setOver] = useState<string | null>(null);
  // A chat dropped on a group goes into it. Dropped on a product it comes out
  // of its group and is filed under that product for good — the computer never
  // moves a chat a person put somewhere. Dropped on Daily it comes out of its
  // group and its product, for good the same way. Dropped on a folder it only
  // comes out of the group it was in.
  const drop = (s: Section, dt: DataTransfer) => {
    setOver(null);
    const drag = readChatDrag(dt);
    if (!drag || drag.hostKey !== s.hostKey) return;
    const to = s.kind === 'group' ? s.key : null;
    const chat = hosts[s.hostKey]?.chats.find((c) => c.id === drag.chatId);
    const patch: Record<string, string | null> = {};
    if ((chat?.group_id ?? null) !== to) patch.group_id = to;
    if (s.kind === 'project' && s.projectId && chat?.project_id !== s.projectId) patch.project_id = s.projectId;
    if (s.key === '__loose' && (chat?.project_id || !chat?.project_set)) patch.project_id = '';
    if (Object.keys(patch).length) updateChat(s.hostKey, drag.chatId, patch).catch(() => {});
  };

  /** Where a dragged heading would land: this side of that section. */
  const [line, setLine] = useState<{ key: string; after: boolean } | null>(null);
  const move = (key: string | null, to: string, after: boolean) => {
    setLine(null);
    if (!focus || !key || key === to) return;
    const keys = list.filter((s) => s.kind !== 'archive' && s.key !== key).map((s) => s.key);
    keys.splice(keys.indexOf(to) + (after ? 1 : 0), 0, key);
    // What is not on screen today keeps its place behind what is.
    const next = { ...orders, [focus]: [...keys, ...saved.filter((k) => !keys.includes(k))] };
    setOrders(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* private mode: until reload */ }
  };

  // Collapsed: the chat list is gone. It exists because the wall of tiles under
  // the Machine place wants the width, and it can give the whole list up without
  // trapping anybody — the three places are in the bar above, which is drawn
  // whatever this does.
  if (railed) {
    return (
      <div className="dv-chatlist" style={{
        width: RAIL, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '8px 0', height: '100%',
      }}>
        <button
          type="button" onClick={() => onCollapse?.(false)} title="Show the chat list" aria-label="Show the chat list"
          style={{
            width: 32, height: 32, borderRadius: R.btn, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon path={P.chevronRight} size={14} color={C.mute} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button" onClick={onNewChat} title="New chat" aria-label="New chat"
          style={{
            width: 32, height: 32, borderRadius: R.btn, cursor: 'pointer',
            background: C.accent, border: `1px solid ${C.accent}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon path={P.plus} size={15} color={C.onAccent} width={2.6} />
        </button>
        <div title={slot?.status === 'online' ? 'Online' : 'Offline'} style={{ padding: '6px 0 2px' }}>
          <Dot color={slot?.status === 'online' ? C.ok : C.faint} live={slot?.status === 'online'} size={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="dv-chatlist" style={{
      width: W, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {project ? <div style={{ height: 8, flexShrink: 0 }} /> : (
      <div style={{ padding: '8px 8px 0', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <HostCard
            hosts={hosts} order={order} focus={focus} allHosts={fleetWide}
            onFocus={(k) => { setAllHosts(false); setFocus(k); }}
            onAll={() => setAllHosts(true)}
          />
        </div>
        {onCollapse && (
          <button
            type="button" onClick={() => onCollapse(true)} title="Hide the chat list" aria-label="Hide the chat list"
            style={{
              width: 30, height: 30, flexShrink: 0, borderRadius: R.btn, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon path={P.chevronLeft} size={14} color={C.mute} />
          </button>
        )}
      </div>
      )}

      {/* The list, which is now all there is: a chat is picked here, and the
          wall under the Machine place drags its tiles out of here.

          Starting a chat belongs above it rather than on a screen of its own:
          this is where someone is standing when they want one. */}
      <div style={{ padding: '0 8px 8px' }}>
        <button
          type="button" onClick={onNewChat}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', height: 34, borderRadius: R.btn, cursor: 'pointer',
            background: C.accent, border: `1px solid ${C.accent}`,
            color: C.onAccent, fontSize: 13, fontWeight: 600,
          }}
        >
          <Icon path={P.plus} size={15} color={C.onAccent} width={2.6} />
          New chat
          <span style={{ ...mono, fontSize: 11 }}>⌘N</span>
        </button>
      </div>
      <div style={{ padding: '0 8px 8px', display: 'flex', gap: 6 }}>
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px',
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: R.input,
        }}>
          <Icon path={P.search} size={14} color={C.mute} />
          <input
            ref={searchRef} name="chat-search" aria-label="Search chats"
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none',
              outline: 'none', fontSize: 13, color: C.text,
            }}
          />
          <span style={{ ...mono, fontSize: 11, color: C.faint }}>⌘F</span>
        </div>
        {canGroup && (
          <button
            type="button" onClick={() => setAsking({ what: 'new' })}
            title="New group" aria-label="New group"
            style={{
              width: 32, height: 32, flexShrink: 0, borderRadius: R.input, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon path={P.folderPlus} size={15} color={C.mute} width={1.8} />
          </button>
        )}
      </div>

      {shared && !fleetWide && (
        <div style={{ padding: '0 8px 8px' }}>
          <PersonCard names={names} who={who} counts={counts} onPick={pickPerson} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {list.map((s) => {
          // The archive is everything that is not today, so it starts shut —
          // except under a search, which is looking through it.
          const shut = collapsed[s.key] ?? (s.kind === 'archive' && !query.trim());
          return (
            <div
              key={s.key} data-section={s.key}
              // The whole section catches, not only its heading: a group with
              // forty chats in it is a tall target and a 30px line is not. It
              // catches two things — a chat, which goes into it, and another
              // heading, which goes above or below it by the half it is over.
              {...(canGroup && s.kind !== 'archive' ? {
                onDragOver: (e: React.DragEvent) => {
                  const chat = hasChatDrag(e.dataTransfer);
                  if (!chat && !hasSectionDrag(e.dataTransfer)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (chat) { if (over !== s.key) setOver(s.key); return; }
                  const box = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > box.top + box.height / 2;
                  if (line?.key !== s.key || line.after !== after) setLine({ key: s.key, after });
                },
                onDragLeave: (e: React.DragEvent) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setOver((o) => (o === s.key ? null : o));
                  setLine((l) => (l?.key === s.key ? null : l));
                },
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  if (!hasSectionDrag(e.dataTransfer)) { drop(s, e.dataTransfer); return; }
                  const box = e.currentTarget.getBoundingClientRect();
                  move(readSectionDrag(e.dataTransfer), s.key, e.clientY > box.top + box.height / 2);
                },
              } : {})}
              style={{
                marginBottom: 4, position: 'relative', borderRadius: R.card,
                ...(over === s.key ? { background: C.accentTint, boxShadow: `inset 0 0 0 1px ${C.accentRing}` } : {}),
                ...(line?.key === s.key ? { boxShadow: `inset 0 ${line.after ? -2 : 2}px 0 ${C.accent}` } : {}),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !shut }))}
                // A heading is picked up and put down above or below another.
                draggable={canGroup && s.kind !== 'archive'}
                onDragStart={(e) => setSectionDrag(e.dataTransfer, s.key)}
                onDragEnd={() => setLine(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: 30,
                  padding: '0 4px', background: 'transparent', border: 'none', cursor: 'pointer',
                }}
              >
                <Icon path={shut ? P.chevronRight : P.chevronDown} size={12} color={C.mute} />
                {/* Merged list: a section is a computer, so it carries that
                    computer's state — otherwise an offline machine's chats
                    look as live as any other. */}
                {fleetWide && (
                  <Dot
                    color={hosts[s.hostKey]?.status === 'online' ? C.ok
                      : hosts[s.hostKey]?.status === 'unauthorized' ? C.danger : C.faint}
                    live={hosts[s.hostKey]?.status === 'online'} size={5}
                  />
                )}
                {/* A folder is a path, and a path shouted in capitals is not the
                    path any more. */}
                <span style={{
                  flex: 1, textAlign: 'left', fontSize: 11, color: C.mute,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  ...(s.kind === 'folder' ? mono
                    : { fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' as const }),
                }}>{s.title}</span>
                <span style={{ fontSize: 11, color: C.faint }}>{s.chats.length}</span>
              </button>
              {s.kind === 'group' && (
                <button
                  type="button" data-group-menu title="Group menu" aria-label={`Group menu: ${s.title}`}
                  onClick={() => setMenuFor(menuFor === s.key ? null : s.key)}
                  style={{
                    width: 24, height: 24, flexShrink: 0, borderRadius: R.btn, cursor: 'pointer',
                    background: menuFor === s.key ? C.surface3 : 'transparent', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon path={P.more} size={14} color={C.mute} width={2.8} />
                </button>
              )}
              {onNewChatIn && !project && s.kind !== 'archive' && (() => {
                const cwd = s.kind === 'folder' ? s.key.slice(4)
                  : s.chats.find((c) => c.cwd)?.cwd
                    ?? hosts[s.hostKey]?.projects.find((p) => p.name === s.title)?.path;
                // A group with nothing in it yet has no folder to offer, and
                // still takes a chat.
                return cwd || s.kind === 'group' ? (
                  <button
                    type="button" title={`New chat in ${s.title}`} aria-label={`New chat in ${s.title}`}
                    onClick={() => onNewChatIn(s.hostKey, cwd, s.kind === 'group' ? s.key : undefined)}
                    style={{
                      width: 24, height: 24, flexShrink: 0, borderRadius: R.btn, cursor: 'pointer',
                      background: 'transparent', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon path={P.plus} size={14} color={C.mute} />
                  </button>
                ) : null;
              })()}
              </div>
              {menuFor === s.key && (
                <GroupMenu
                  onRename={() => setAsking({ what: 'rename', hostKey: s.hostKey, id: s.key, name: s.title })}
                  onDelete={() => setAsking({ what: 'delete', hostKey: s.hostKey, id: s.key, name: s.title })}
                  onClose={() => setMenuFor(null)}
                />
              )}
              {!shut && s.chats.map((c) => (
                <ChatRow
                  key={`${s.hostKey}/${c.id}`} chat={c}
                  selected={selected === c.id && selectedHost === s.hostKey}
                  onPick={() => onSelect(s.hostKey, c.id)}
                  onDrag={canGroup ? (dt) => setChatDrag(dt, { hostKey: s.hostKey, chatId: c.id }) : undefined}
                  onDelete={() => setAsking({ what: 'delete-chat', hostKey: s.hostKey, id: c.id, name: c.title })}
                  under={project ? c.project ?? null : s.kind === 'project' ? s.title : undefined}
                />
              ))}
            </div>
          );
        })}
        {(slot || fleetWide || project) && !list.length && (
          <div style={{ padding: '24px 12px', fontSize: 13, color: C.mute, textAlign: 'center' }}>
            {query ? 'No chat matches' : 'No chats yet'}
          </div>
        )}
      </div>

      {!project && <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.mute }}>
          <Dot color={slot?.status === 'online' ? C.ok : C.faint} live={slot?.status === 'online'} size={5} />
          <span style={mono}>daemon {slot?.info?.daemon_version ?? '—'}</span>
          {slot?.info && <span style={mono}>· {uptime(slot.info.uptime_s)}</span>}
        </div>
      </div>}

      {asking?.what === 'new' && focus && (
        <GroupNameDialog
          title="New group" confirm="Create"
          onSubmit={(name) => createGroup(focus, name)}
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.what === 'rename' && (
        <GroupNameDialog
          title="Rename group" confirm="Save" initial={asking.name}
          onSubmit={(name) => renameGroup(asking.hostKey, asking.id, name)}
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.what === 'delete' && (
        <DeleteGroupDialog
          name={asking.name}
          onDelete={() => { deleteGroup(asking.hostKey, asking.id).catch(() => {}); }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.what === 'delete-chat' && (
        <DeleteChatDialog
          title={asking.name}
          onDelete={() => { deleteChat(asking.hostKey, asking.id).catch(() => {}); }}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}

/** What can be done to a group, under its heading. Outside it and Escape both
 *  put it away, the way a chat's own menu goes. */
function GroupMenu({ onRename, onDelete, onClose }: {
  onRename: () => void; onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // The button that opened it closes it by itself; putting it away here as
      // well would have that same click open it again.
      if ((e.target as Element).closest?.('[data-group-menu]')) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const row = (label: string, icon: string, onPick: () => void, danger?: boolean) => (
    <button
      type="button" onClick={() => { onPick(); onClose(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 34,
        padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        textAlign: 'left', color: danger ? C.danger : C.text,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.surface3; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon path={icon} size={14} color={danger ? C.danger : C.mute} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 30, right: 0, width: 180, zIndex: 40,
        background: C.surface, border: `1px solid ${C.borderStrong}`, borderRadius: R.card,
        padding: '6px 0', boxShadow: SHADOW.pop,
      }}
    >
      {row('Rename', P.pencil, onRename)}
      {row('Delete group', P.trash, onDelete, true)}
    </div>
  );
}

export { W as SIDEBAR_W };
