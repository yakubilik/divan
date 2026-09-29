import { useEffect, useMemo, useRef, useState } from 'react';
import { SHADOW, T } from '../lib/theme';
import { Icon, P, Pulse, mono } from '../ui/kit';
import { Card, Row, SectionHeader, StatusDot, Tag, Write } from '../ui/divan';
import { tilde } from '../lib/format';
import { useFleet } from '../lib/fleet';
import { ProviderMark } from './Sidebar';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  danger?: boolean;
  run: () => void;
}

interface Row {
  key: string;
  group: string;
  label: string;
  hint?: string;
  shortcut?: string;
  danger?: boolean;
  mark?: 'chat-claude' | 'chat-codex' | 'folder' | 'command';
  running?: boolean;
  run: () => void;
}

export function Palette({ commands, onOpenChat, onNewChatIn, onClose }: {
  commands: Command[];
  onOpenChat: (hostKey: string, chatId: string) => void;
  onNewChatIn: (cwd: string) => void;
  onClose: () => void;
}) {
  const { hosts, order, focus } = useFleet();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    const hit = (s: string) => !q || s.toLocaleLowerCase('tr').includes(q);
    const out: Row[] = [];

    for (const key of order) {
      const slot = hosts[key];
      if (!slot) continue;
      const many = order.length > 1;
      for (const c of slot.chats) {
        if (c.archived) continue;
        if (!hit(c.title) && !hit(c.cwd)) continue;
        out.push({
          key: `chat:${key}:${c.id}`,
          group: 'Chats',
          label: c.title || 'New chat',
          hint: [many ? (slot.info?.name ?? slot.cfg.name) : null, c.cwd.split(/[/\\]/).pop()].filter(Boolean).join(' · '),
          mark: c.provider === 'claude' ? 'chat-claude' : 'chat-codex',
          running: c.status !== 'idle',
          run: () => { onOpenChat(key, c.id); onClose(); },
        });
        if (out.length > 40) break;
      }
    }

    const slot = focus ? hosts[focus] : null;
    for (const p of slot?.projects ?? []) {
      if (!hit(p.name) && !hit(p.path)) continue;
      out.push({
        key: `proj:${p.path}`,
        group: 'Projects',
        label: tilde(p.path),
        hint: 'new chat here',
        mark: 'folder',
        run: () => { onNewChatIn(p.path); onClose(); },
      });
    }

    for (const c of commands) {
      if (!hit(c.label)) continue;
      out.push({
        key: `cmd:${c.id}`, group: 'Commands', label: c.label, hint: c.hint,
        shortcut: c.shortcut, danger: c.danger, mark: 'command',
        run: () => { c.run(); onClose(); },
      });
    }
    return out;
  }, [query, hosts, order, focus, commands, onOpenChat, onNewChatIn, onClose]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); rows[cursor]?.run(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  const focused = focus ? hosts[focus] : null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: T.scrim, zIndex: 60,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 110,
      }}
    >
      {/* What ⌘K opens is the bar Web12 W1 draws across the bottom, unrolled:
          the same field, the same key at the end of it, and under it the
          things it can reach as the rows they are on every other page. */}
      <Card
        raised inset={false}
        style={{ width: 640, maxWidth: 'calc(100vw - 48px)', boxShadow: SHADOW.pop }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', height: 52,
          borderBottom: `1px solid ${T.line}`, fontSize: 16,
        }}>
          <Icon path={P.search} size={17} color={T.ink3} />
          <Write
            value={query} onChange={setQuery} onKeyDown={onKey} autoFocus
            label="Search folders, chats and commands"
            placeholder="folder, chat, command…"
          />
          <Tag label="esc" />
        </div>

        <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', padding: '6px 0' }}>
          {rows.map((r, i) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            const on = i === cursor;
            return (
              <div key={r.key}>
                {head && (
                  <SectionHeader
                    kind="mark" title={head.toLocaleLowerCase('en')}
                    style={{ padding: '10px 18px 4px' }}
                  />
                )}
                <span data-i={i} onMouseEnter={() => setCursor(i)} style={{ display: 'block' }}>
                  <Row
                    first
                    title={r.label} mark={r.mark === 'folder'}
                    tone={r.danger ? 'red' : on ? 'ink2' : undefined} wash={on}
                    meta={r.hint ?? null}
                    lead={r.mark === 'chat-claude' || r.mark === 'chat-codex'
                      ? <ProviderMark provider={r.mark === 'chat-claude' ? 'claude' : 'codex'} />
                      : <Icon
                          path={r.mark === 'folder' ? P.folder : r.danger ? P.stop : P.bolt}
                          size={17} color={r.danger ? T.red : T.ink3}
                        />}
                    right={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {r.running && <Pulse color={T.run} />}
                        {r.shortcut && <Tag label={r.shortcut} />}
                      </span>
                    }
                    onClick={r.run}
                    style={{ padding: '8px 18px', gap: 10 }}
                  />
                </span>
              </div>
            );
          })}
          {!rows.length && (
            <div style={{
              padding: '28px 18px', fontSize: 13.5, lineHeight: 1.5, color: T.ink2,
            }}>
              Nothing here matches those words — a chat, a folder on the computer you are on,
              or one of the panel’s own commands.
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', height: 36,
          borderTop: `1px solid ${T.line}`, ...mono, fontSize: 11, color: T.ink3,
        }}>
          <span>↑↓ move</span>
          <span>⏎ open</span>
          <span>⌘K close</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot
              state={focused?.status === 'online' ? 'running' : 'quiet'}
              hollow={focused?.status !== 'online'} size={6}
            />
            {focused
              ? `${focused.info?.name ?? focused.cfg.name} ${focused.status === 'online' ? 'online' : 'offline'}`
              : 'no computer paired'}
          </span>
        </div>
      </Card>
    </div>
  );
}
