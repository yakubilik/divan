import { useEffect, useMemo, useRef, useState } from 'react';
import { C, R, SHADOW } from '../lib/theme';
import { Dot, Icon, P, Pulse, mono } from '../ui/kit';
import { ago, uptime } from '../lib/format';
import { useFleet, type HostSlot } from '../lib/fleet';
import { createGroup, deleteGroup, renameGroup, updateChat } from '../lib/actions';
import { hasChatDrag, readChatDrag, setChatDrag } from '../lib/dnd';
import { DeleteGroupDialog, GroupNameDialog } from './GroupDialogs';
import type { Chat, Group } from '../lib/protocol';

const W = 260;
/** Collapsed, the sidebar is a strip with the way back to the list on it and
 *  the button that starts a chat. Anything narrower stops being a target. */
const RAIL = 48;
const ALL_LABEL = 'All computers';

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
  if (slot.status === 'unauthorized') return 'no access · token revoked';
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
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

/** `group` is the only kind somebody made, and so the only one with a name to
 *  change or a heading to take away. */
interface Section {
  key: string; title: string; hostKey: string; chats: Chat[];
  kind: 'group' | 'folder' | 'loose' | 'host';
}

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

const home = (path: string) => path
  .replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/');

/** One computer's list. A group is drawn even with nothing in it — an empty
 *  group is where the next chats go, and one that vanished the moment it was
 *  made would read as the button having done nothing. A search is the
 *  exception: it is asking where a chat is, and an empty heading is not an
 *  answer. The chats nobody has filed fall into sections by the folder they
 *  work in, the way the phone lists them; a single folder is not a grouping,
 *  so it stays one plain list. */
function sections(chats: Chat[], groups: Group[], hostKey: string, searching: boolean): Section[] {
  const byGroup = new Map<string, Chat[]>();
  const loose: Chat[] = [];
  for (const c of chats) {
    if (c.archived) continue;
    if (c.group_id) {
      const arr = byGroup.get(c.group_id) ?? [];
      arr.push(c);
      byGroup.set(c.group_id, arr);
    } else loose.push(c);
  }
  const out: Section[] = [];
  for (const g of [...groups].sort((a, b) => a.sort - b.sort)) {
    const arr = byGroup.get(g.id) ?? [];
    if (arr.length || !searching) out.push({ key: g.id, title: g.name, hostKey, chats: byRecency(arr), kind: 'group' });
  }
  const byCwd = new Map<string, Chat[]>();
  for (const c of byRecency(loose)) byCwd.set(c.cwd || '', [...(byCwd.get(c.cwd || '') ?? []), c]);
  if (byCwd.size > 1) {
    for (const [path, arr] of byCwd) {
      out.push({ key: `cwd:${path}`, title: home(path) || 'Ungrouped', hostKey, chats: arr, kind: 'folder' });
    }
  } else if (loose.length) {
    out.push({ key: '__loose', title: groups.length ? 'Ungrouped' : 'Chats', hostKey, chats: loose, kind: 'loose' });
  }
  return out;
}

function ChatRow({ chat, selected, onPick, onDrag }: {
  chat: Chat; selected: boolean; onPick: () => void;
  /** Set where the row can be picked up and filed under another heading. */
  onDrag?: (dt: DataTransfer) => void;
}) {
  const awaiting = chat.status === 'awaiting_approval';
  const running = chat.status === 'running';
  return (
    <button
      type="button" onClick={onPick}
      draggable={!!onDrag} onDragStart={onDrag && ((e) => onDrag(e.dataTransfer))}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 56,
        padding: '8px 10px', borderRadius: R.card, cursor: 'pointer', textAlign: 'left',
        background: selected ? C.accentTint : 'transparent',
        border: `1px solid ${selected ? C.accentRing : 'transparent'}`,
      }}
    >
      <ProviderMark provider={chat.provider} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500, color: C.text, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{chat.title || 'New chat'}</div>
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
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
  );
}

// `collapsed` arrives renamed: the section headers in the list below already
// own that word, and two different things called collapsed in one component is
// how you end up hiding the wrong one.
export function Sidebar({ selected, selectedHost, onSelect, onNewChat, searchRef,
                          collapsed: railed = false, onCollapse }: {
  selected: string | null;
  selectedHost: string | null;
  onSelect: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
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
    { what: 'new' } | { what: 'rename' | 'delete'; hostKey: string; id: string; name: string } | null
  >(null);

  const slot = focus ? hosts[focus] : null;
  // One computer paired means there is nothing to merge: the fleet list and
  // that computer's list would be the same list, minus its groups.
  const fleetWide = allHosts && order.length > 1;
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (fleetWide) return fleetSections(hosts, order, q);
    if (!slot) return [] as Section[];
    return sections(slot.chats.filter((c) => matches(c, q)), slot.groups, focus!, !!q);
  }, [fleetWide, hosts, order, slot?.chats, slot?.groups, focus, query]);
  // Groups belong to one computer, so there is one to make only while the list
  // is one computer's.
  const canGroup = !!slot && !!focus && !fleetWide;
  /** The heading a dragged chat is over. */
  const [over, setOver] = useState<string | null>(null);
  // A chat dropped on a group goes into it; dropped on anything that is not a
  // group — a folder, the unfiled list — it comes out of the one it was in.
  const drop = (s: Section, dt: DataTransfer) => {
    setOver(null);
    const drag = readChatDrag(dt);
    if (!drag || drag.hostKey !== s.hostKey) return;
    const to = s.kind === 'group' ? s.key : null;
    const from = hosts[s.hostKey]?.chats.find((c) => c.id === drag.chatId)?.group_id ?? null;
    if (from !== to) updateChat(s.hostKey, drag.chatId, { group_id: to }).catch(() => {});
  };

  // Collapsed: the chat list is gone. It exists because the wall of tiles under
  // the Machine place wants the width, and it can give the whole list up without
  // trapping anybody — the three places are in the bar above, which is drawn
  // whatever this does.
  if (railed) {
    return (
      <div style={{
        width: RAIL, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '8px 0', height: '100%',
      }}>
        <button
          type="button" onClick={() => onCollapse?.(false)} title="Show the chat list"
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
          type="button" onClick={onNewChat} title="New chat"
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
    <div style={{
      width: W, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
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
            type="button" onClick={() => onCollapse(true)} title="Hide the chat list"
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
            ref={searchRef} name="chat-search"
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {list.map((s) => {
          const shut = collapsed[s.key];
          return (
            <div
              key={s.key}
              // The whole section catches, not only its heading: a group with
              // forty chats in it is a tall target and a 30px line is not.
              {...(canGroup ? {
                onDragOver: (e: React.DragEvent) => {
                  if (!hasChatDrag(e.dataTransfer)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== s.key) setOver(s.key);
                },
                onDragLeave: (e: React.DragEvent) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === s.key ? null : o));
                },
                onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(s, e.dataTransfer); },
              } : {})}
              style={{
                marginBottom: 4, position: 'relative', borderRadius: R.card,
                ...(over === s.key ? { background: C.accentTint, boxShadow: `inset 0 0 0 1px ${C.accentRing}` } : {}),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !shut }))}
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
                />
              ))}
            </div>
          );
        })}
        {(slot || fleetWide) && !list.length && (
          <div style={{ padding: '24px 12px', fontSize: 13, color: C.mute, textAlign: 'center' }}>
            {query ? 'No chat matches' : 'No chats yet'}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.mute }}>
          <Dot color={slot?.status === 'online' ? C.ok : C.faint} live={slot?.status === 'online'} size={5} />
          <span style={mono}>daemon {slot?.info?.daemon_version ?? '—'}</span>
          {slot?.info && <span style={mono}>· {uptime(slot.info.uptime_s)}</span>}
        </div>
      </div>

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
