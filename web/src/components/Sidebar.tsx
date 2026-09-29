import { useMemo, useState } from 'react';
import { C, R } from '../lib/theme';
import { Dot, Icon, P, Pulse, mono } from '../ui/kit';
import { ago, uptime } from '../lib/format';
import { useFleet, type HostSlot } from '../lib/fleet';
import { setChatDrag } from '../lib/dnd';
import type { Chat, Group } from '../lib/protocol';

const W = 260;
/** Collapsed, the sidebar keeps the one thing it cannot give up: the way back
 *  to the other screens. Anything narrower than this stops being a target. */
const RAIL = 48;
const ALL_LABEL = 'All computers';

export type View = 'chats' | 'terminal' | 'screen' | 'dashboard' | 'projects' | 'agents' | 'admin' | 'settings';

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

const NAV: { view: View; label: string; icon: string }[] = [
  { view: 'chats', label: 'Chats', icon: 'M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l5-4h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z' },
  { view: 'terminal', label: 'Terminal', icon: P.terminal },
  { view: 'screen', label: 'Screen', icon: P.monitor },
  { view: 'dashboard', label: 'Panel', icon: P.grid },
  { view: 'projects', label: 'Projects', icon: P.folder },
  { view: 'agents', label: 'Agents', icon: P.agent },
  { view: 'admin', label: 'Admin', icon: P.download },
  { view: 'settings', label: 'Settings', icon: P.gear },
];

function NavRow({ item, active, count, alert, onClick }: {
  item: typeof NAV[number]; active: boolean; count?: number; alert?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36,
        padding: '0 10px', borderRadius: R.btn, cursor: 'pointer', textAlign: 'left',
        background: active ? C.accentTint : 'transparent',
        border: `1px solid ${active ? C.accentRing : 'transparent'}`,
      }}
    >
      <Icon path={item.icon} size={16} color={active ? C.accentSoft : C.mute} />
      <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 600 : 400, color: active ? C.text : C.text2 }}>
        {item.label}
      </span>
      {alert ? <Dot color={C.warn} live />
        : count != null ? <span style={{ fontSize: 12, color: C.faint }}>{count}</span> : null}
    </button>
  );
}

interface Section { key: string; title: string; hostKey: string; chats: Chat[] }

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
    out.push({ key: k, title: slot.info?.name || slot.cfg.name, hostKey: k, chats });
  }
  return out;
}

function sections(chats: Chat[], groups: Group[], hostKey: string): Section[] {
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
    const arr = byGroup.get(g.id);
    if (arr?.length) out.push({ key: g.id, title: g.name, hostKey, chats: byRecency(arr) });
  }
  if (loose.length) out.push({ key: '__loose', title: 'Ungrouped', hostKey, chats: byRecency(loose) });
  return out;
}

function ChatRow({ chat, hostKey, selected, onPick }: {
  chat: Chat; hostKey: string; selected: boolean; onPick: () => void;
}) {
  const awaiting = chat.status === 'awaiting_approval';
  const running = chat.status === 'running';
  return (
    <button
      type="button" onClick={onPick}
      // Draggable everywhere, not only in terminal mode: the list does not
      // know which screen is on the right, and a drag that finds no target
      // simply ends where it started.
      draggable
      onDragStart={(e) => setChatDrag(e.dataTransfer, { hostKey, chatId: chat.id })}
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
export function Sidebar({ view, onView, selected, selectedHost, onSelect, onNewChat, searchRef,
                          collapsed: railed = false, onCollapse }: {
  view: View;
  onView: (v: View) => void;
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

  const slot = focus ? hosts[focus] : null;
  // One computer paired means there is nothing to merge: the fleet list and
  // that computer's list would be the same list, minus its groups.
  const fleetWide = allHosts && order.length > 1;
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (fleetWide) return fleetSections(hosts, order, q);
    if (!slot) return [] as Section[];
    return sections(slot.chats.filter((c) => matches(c, q)), slot.groups, focus!);
  }, [fleetWide, hosts, order, slot?.chats, slot?.groups, focus, query]);

  const counts: Partial<Record<View, number>> = {
    chats: fleetWide
      ? order.reduce((n, k) => n + (hosts[k]?.chats.filter((c) => !c.archived).length ?? 0), 0)
      : slot?.chats.filter((c) => !c.archived).length,
    // Terminal mode is the wall of what is happening, so its number is what is
    // happening — not how many chats exist, which the row above already says.
    terminal: order.reduce((n, k) => n + (hosts[k]?.chats.filter((c) => c.status !== 'idle').length ?? 0), 0),
    projects: slot?.projects.length,
  };
  const anyAwaiting = order.some((k) => hosts[k]?.chats.some((c) => c.status === 'awaiting_approval'));
  // Straight off host.info, which every computer sends on connect: no extra
  // round trip to light this up, and it is already true before anyone has
  // opened the Admin screen.
  const anyPending = order.some((k) => {
    const u = hosts[k]?.info?.update;
    return !!u && (u.behind > 0 || (!!u.web?.npm && u.web?.stale !== false));
  });

  // Collapsed: the chat list is gone but the screens are not. Terminal mode is
  // the reason this exists — a wall of tiles wants the width — and a wall you
  // cannot get out of is a trap, so the navigation stays whatever happens.
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
        <div style={{ width: 24, height: 1, background: C.border, margin: '4px 0' }} />
        {NAV.map((item) => (
          <button
            key={item.view} type="button" onClick={() => onView(item.view)} title={item.label}
            style={{
              width: 32, height: 32, borderRadius: R.btn, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
              background: view === item.view ? C.accentTint : 'transparent',
              border: `1px solid ${view === item.view ? C.accentRing : 'transparent'}`,
            }}
          >
            <Icon path={item.icon} size={16} color={view === item.view ? C.accentSoft : C.mute} />
            {(item.view === 'dashboard' || item.view === 'terminal') && anyAwaiting && (
              <span style={{
                position: 'absolute', top: 3, right: 3, width: 6, height: 6,
                borderRadius: 3, background: C.warn,
              }} />
            )}
          </button>
        ))}
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

      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((item) => (
          <NavRow
            key={item.view} item={item} active={view === item.view}
            count={counts[item.view]}
            alert={((item.view === 'dashboard' || item.view === 'terminal') && anyAwaiting)
              || (item.view === 'admin' && anyPending)}
            onClick={() => onView(item.view)}
          />
        ))}
      </div>

      {/* Terminal mode gets the list too. The wall answers "what is happening";
          the list is still how you reach a chat that is not on the wall — and
          it is where a tile is dragged from. */}
      {view === 'chats' || view === 'terminal' ? (
        <>
          {/* Starting a chat belongs above the list of chats, not on the panel
              screen: this is where someone is standing when they want one. */}
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
          <div style={{ padding: '0 8px 8px' }}>
            <div style={{
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
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {list.map((s) => {
              const shut = collapsed[s.key];
              return (
                <div key={s.key} style={{ marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [s.key]: !shut }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: 30,
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
                    <span style={{
                      flex: 1, textAlign: 'left', fontSize: 11, fontWeight: 600,
                      letterSpacing: 0.6, textTransform: 'uppercase', color: C.mute,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{s.title}</span>
                    <span style={{ fontSize: 11, color: C.faint }}>{s.chats.length}</span>
                  </button>
                  {!shut && s.chats.map((c) => (
                    <ChatRow
                      key={`${s.hostKey}/${c.id}`} chat={c} hostKey={s.hostKey}
                      selected={selected === c.id && selectedHost === s.hostKey}
                      onPick={() => onSelect(s.hostKey, c.id)}
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
        </>
      ) : <div style={{ flex: 1 }} />}

      <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.mute }}>
          <Dot color={slot?.status === 'online' ? C.ok : C.faint} live={slot?.status === 'online'} size={5} />
          <span style={mono}>daemon {slot?.info?.daemon_version ?? '—'}</span>
          {slot?.info && <span style={mono}>· {uptime(slot.info.uptime_s)}</span>}
        </div>
      </div>
    </div>
  );
}

export { W as SIDEBAR_W };
