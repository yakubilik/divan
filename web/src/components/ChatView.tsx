import { useEffect, useRef, useState } from 'react';
import { C, R } from '../lib/theme';
import { Chip, Dot, Icon, P, Pulse, Spinner, mono, Empty } from '../ui/kit';
import { Timeline } from './Timeline';
import { ChatComposer } from './ChatComposer';
import { ChatMenu } from './ChatMenu';
import { ChatDetails } from './ChatDetails';
import { duration, shortPath, toolSummary } from '../lib/format';
import type { Field } from './FieldSheet';
import type { Chat, Group } from '../lib/protocol';
import type { ChatLog } from '../lib/timeline';

function Header({ chat, groupName, count, accountLabel, onEdit, onMenu, onDetails, detailsOpen }: {
  chat: Chat; groupName: string | null; count: number; accountLabel: string | null;
  onEdit: (f: Field) => void;
  onMenu: () => void;
  onDetails: () => void;
  detailsOpen: boolean;
}) {
  const sub = [groupName, chat.cwd.split(/[/\\]/).pop(), `${count} messages`].filter(Boolean).join(' · ');
  const running = chat.status === 'running';
  const awaiting = chat.status === 'awaiting_approval';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
      borderBottom: `1px solid ${C.border}`, flexShrink: 0, position: 'relative',
    }}>
      {/* Basis 0 so a long title claims only the room the chips leave over,
          and a floor of 120 so it never collapses away entirely. */}
      <div style={{ flex: '1 1 0', minWidth: 120 }}>
        <div style={{
          fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{chat.title || 'New chat'}</div>
        <div style={{
          fontSize: 12, color: C.mute, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
        }}>
          <span style={{
            minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{sub}</span>
          {running && <><Pulse /><span style={{ color: C.accent }}>running</span></>}
          {awaiting && <>
            <Icon path={P.warn} size={11} color={C.warn} />
            <span style={{ color: C.warn }}>awaiting approval</span>
          </>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {/* Which sign-in is being spent, and the way to another one: this is
            where a person looks when a plan's limit has run out mid-chat. */}
        <Chip onClick={() => onEdit('account_id')} title="Account running this chat" shrink>
          <Icon path={P.agent} size={12} color={C.mute} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {accountLabel ?? 'account'}
          </span>
        </Chip>
        <Chip onClick={() => onEdit('model')}>
          <Dot color={C.accent} live /> {chat.model}
        </Chip>
        {chat.effort && (
          <Chip onClick={() => onEdit('effort')}>
            <Icon path={P.bolt} size={12} color={C.mute} /> {chat.effort}
          </Chip>
        )}
        <Chip onClick={() => onEdit('perm_mode')} tone={chat.perm_mode === 'bypass' ? 'warn' : 'plain'}>
          <Icon path={P.shield} size={12} color={chat.perm_mode === 'bypass' ? C.warn : C.mute} />
          {chat.perm_mode}
        </Chip>
        <Chip onClick={() => onEdit('cwd')} title={chat.cwd} shrink>
          <Icon path={P.folder} size={12} color={C.mute} />
          <span style={{
            ...mono, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{shortPath(chat.cwd, 2)}</span>
        </Chip>
        {/* The numbers nobody needs open all the time live behind this: cost, tokens,
            ids, the last few tools. `data-chat-details-toggle` is how the popover tells
            this click apart from a click outside it. */}
        <button
          type="button" onClick={onDetails} title="Chat details" data-chat-details-toggle
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px',
            borderRadius: R.btn, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            fontSize: 12, fontWeight: 600,
            background: detailsOpen ? C.surface3 : C.surface2,
            border: `1px solid ${detailsOpen ? C.borderStrong : C.border}`,
            color: detailsOpen ? C.text : C.text2,
          }}
        >
          <Icon path={P.info} size={12} color={detailsOpen ? C.text : C.mute} />
          Details
        </button>
        <button
          type="button" onClick={onMenu} title="Chat menu"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, lineHeight: 0 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={C.mute}>
            <circle cx="5.5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18.5" cy="12" r="1.8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function WorkingStrip({ log, onInterrupt }: { log: ChatLog; onInterrupt: () => void }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  let started: number | null = null;
  let toolCount = 0;
  let current: string | null = null;
  for (let i = log.items.length - 1; i >= 0; i--) {
    const it = log.items[i];
    if (it.kind === 'tool') {
      toolCount++;
      if (!current && it.running) current = `${it.tool} ${toolSummary(it.tool, it.input)}`.trim();
    }
    if (it.kind === 'turn' || it.kind === 'error') break;
    started = it.ts;
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, margin: '0 20px 8px',
      padding: '0 14px', height: 44, borderRadius: R.card,
      background: C.accentTint, border: `1px solid ${C.accentRing}`,
    }}>
      <Pulse />
      <span style={{ fontSize: 13, fontWeight: 600, color: C.accentSoft }}>Running</span>
      <span style={{ ...mono, fontSize: 12, color: C.mute }}>
        {started ? duration((now - started) * 1000) : '—'}
      </span>
      <span style={{
        ...mono, fontSize: 12, color: C.text2, flex: 1, minWidth: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{current ?? 'thinking…'}</span>
      {toolCount > 0 && (
        <span style={{ ...mono, fontSize: 12, color: C.mute, flexShrink: 0 }}>tool {toolCount}</span>
      )}
      <button
        type="button" onClick={onInterrupt}
        style={{
          height: 28, padding: '0 12px', borderRadius: R.btn, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          border: `1px solid ${C.dangerLine}`, background: C.dangerBg, color: C.danger,
        }}
      >
        <Icon path={P.stop} size={12} color={C.danger} /> Stop
      </button>
    </div>
  );
}

/** What is attached but not sent yet. A picture is shown as the picture, at the
 *  size a thumbnail wants to be — a file name is not a preview, and the whole
 *  point of attaching a screenshot is to see that it is the right one. */
export function ChatView({ chat, hostKey, log, groupName, groups, accountLabel, accountUsage, liveTokens, onSend, onInterrupt, onRespond, onEdit, onUpdate, onDelete, onUpload, onPopOut, sending }: {
  chat: Chat | null;
  hostKey: string | null;
  log: ChatLog;
  groupName: string | null;
  groups: Group[];
  accountLabel: string | null;
  /** 0–1 of the fullest window that account last reported. Details only. */
  accountUsage: number | null;
  liveTokens: number | null;
  sending: boolean;
  onPopOut: () => void;
  onSend: (text: string, attachments: any[]) => void;
  onInterrupt: () => void;
  onRespond: (requestId: string, d: 'allow' | 'allow_session' | 'deny') => void;
  onEdit: (f: Field) => void;
  onUpdate: (patch: Record<string, any>) => void;
  onDelete: () => void;
  onUpload: (file: File) => Promise<any>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [menu, setMenu] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    // Following the tail must not fight someone reading. A scroll under a
    // selection being dragged drops it, and with a turn streaming that is
    // several times a second — which is what it feels like to try to copy a
    // line out of an answer while the agent is still writing.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && el.contains(sel.anchorNode)) return;
    el.scrollTop = el.scrollHeight;
  }, [log.items]);

  if (!chat) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg }}>
        <Empty
          title="Pick a chat, or open a new one"
          hint="Click a chat in the list, or press ⌘N to start one. The panel is connected to every paired computer at once."
        />
      </div>
    );
  }

  const busy = log.busy || chat.status !== 'idle';
  const msgCount = log.items.filter((i) => i.kind === 'user' || i.kind === 'assistant').length;

  return (
    // `minHeight: 0` is not decoration. Between the sidebar and the inspector
    // this sits in a row, where `flex: 1` is about width and the height comes
    // from the viewport — so nothing here could ever overflow. Held over the
    // wall it sits in a column instead, and a flex item defaults to refusing to
    // shrink below its content: the timeline made this box taller than the
    // window that holds it, and the composer went out through the bottom edge,
    // clipped away. The chat looked read-only.
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Header
          chat={chat} groupName={groupName} count={msgCount} accountLabel={accountLabel}
          onEdit={onEdit} onMenu={() => { setDetails(false); setMenu(true); }}
          onDetails={() => setDetails((v) => !v)} detailsOpen={details}
        />
        {menu && (
          <ChatMenu
            chat={chat} groups={groups}
            onUpdate={onUpdate} onDelete={onDelete}
            onClose={() => setMenu(false)}
          />
        )}
        {details && (
          <ChatDetails
            chat={chat} items={log.items} busy={busy}
            liveTokens={liveTokens} accountLabel={accountLabel} accountUsage={accountUsage}
            onEdit={onEdit} onInterrupt={onInterrupt} onPopOut={onPopOut}
            onClose={() => setDetails(false)}
          />
        )}
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}
      >
        {log.loading && !log.items.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        )}
        {log.error && (
          <div style={{ fontSize: 13, color: C.danger, padding: 12 }}>{log.error}</div>
        )}
        <Timeline items={log.items} hostKey={hostKey ?? ''} onRespond={onRespond} />
      </div>
      {busy && <WorkingStrip log={log} onInterrupt={onInterrupt} />}
      <ChatComposer
        chat={chat} hostKey={hostKey ?? ''} busy={busy} sending={sending}
        onSend={onSend} onInterrupt={onInterrupt} onUpload={onUpload}
      />
    </div>
  );
}
