/** Sessions and plan limits: what is running on every computer right now, and
 *  how much of each sign-in's plan is gone.
 *
 *  One level under Machines — the table up there says how much of today's quota
 *  a machine has spent; this says which window that number came out of, and
 *  which chat is spending it. No frame of its own, so it is built out of what
 *  Web15 draws for the pages that do have one: the page head, W12's table for
 *  the computers and for the sessions, W11's track for a plan window (stated
 *  rather than set, which is what a read-only `Slider` is), and W17's rows for
 *  everything that is a fact with a word at the end.
 *
 *  TODO(daemon): the artboard asks for numbers the protocol does not carry yet.
 *  Each of these is a daemon change, not a screen change — until then the panel
 *  stays quiet rather than drawing a guess.
 *   - CPU / RAM load: host.info reports no measurements.
 *   - A "last 7 days" cost chart: there is no historical spend query, only a
 *     per-chat lifetime total.
 *   - A queue panel for the phone: queue depth is not in the protocol.
 *   - Daemon restart count and last error: the daemon keeps neither.
 *   - "N sessions closed in the last 24h": there is no closed-session history.
 */
import { useEffect, useMemo, useState } from 'react';
import { T, type Tone } from '../lib/theme';
import { Icon, P, Pulse, Spinner, mono } from '../ui/kit';
import {
  Button, Card, Cell, EmptyState, NameCell, Quoted, Row, SectionHeader, Slider, StatusDot,
  Table, Tag, Well, type Column,
} from '../ui/divan';
import { ago, clock, cost, tilde, toolSummary, until, uptime, windowName } from '../lib/format';
import { onAnyEvent, selectRunning, useFleet, type HostSlot, type Running } from '../lib/fleet';
import { interrupt } from '../lib/actions';
import type { LimitWindow } from '../lib/protocol';
import { refusalText } from '../lib/refusal';

export interface FleetProps {
  onOpenChat: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
}

const IC = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.6M20 5v6h-6',
};

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** The address a computer answers on is a private detail — enough of it is
 *  shown to tell two computers apart, never enough to dial it. */
function maskHost(host: string): string {
  if (!host) return '';
  if (isLocal(host)) return 'local';
  const ip = host.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})$/);
  if (ip) return `${ip[1]}.•••.•••.${ip[2]}`;
  const [first, ...rest] = host.split('.');
  const head = first.length > 3 ? `${first.slice(0, 3)}•••` : `${first}•••`;
  return rest.length ? `${head}.${rest.join('.')}` : head;
}

/** Clock-style elapsed time — the column reads as a stopwatch, not as prose. */
function elapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'just now';
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** A connection, in the design's own six states and its own words. */
function connOf(slot: HostSlot): { says: string; state: 'running' | 'asking' | 'stuck' | 'quiet'; tone: Tone } {
  if (slot.status === 'online') return { says: 'online', state: 'running', tone: 'run' };
  if (slot.status === 'connecting') return { says: 'connecting…', state: 'asking', tone: 'amber' };
  if (slot.status === 'unauthorized') return { says: refusalText(slot.refusal).short, state: 'stuck', tone: 'red' };
  return { says: 'offline', state: 'quiet', tone: 'ink3' };
}

/** How full a plan window is, in the three tones the design gives a reading:
 *  green while there is room, amber where it is worth knowing, red at the end. */
const limitTone = (u: number): Tone => (u >= 0.9 ? 'red' : u >= 0.6 ? 'amber' : 'run');

/** What a permission mode is, as a state rather than as a word: a chat that may
 *  do anything without asking is the one worth seeing across a table. */
const permTone = (mode: string): Tone => {
  const m = (mode || '').toLowerCase();
  if (m.includes('bypass') || m.includes('danger') || m.includes('full')) return 'amber';
  if (m.includes('edit')) return 'run';
  return 'ink3';
};

/** Which tone an event in the stream is read in. */
const EVENT_TONE: Record<string, Tone> = {
  'tool.use': 'run', 'tool.result': 'run',
  'approval.request': 'amber', 'approval.resolved': 'run',
  'turn.started': 'ink3', 'turn.done': 'run', 'turn.error': 'red',
  'message.user': 'ink2',
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** What a chat is doing this very second. The chat row itself only knows its
 *  status, so the tool in flight and the moment the turn started are folded out
 *  of the live event stream instead. */
interface Live {
  tool: string | null; detail: string; approval: string | null;
  since: number | null;
  /** the tool has already returned: still the truest answer to "what is it
   *  doing", but drawn dimmer so a finished call cannot pass for a live one */
  done: boolean;
}

const EMPTY_LIVE: Live = { tool: null, detail: '', approval: null, since: null, done: false };

/** W12's tracks, with the columns a session has that a machine does not. */
const COMPUTERS: Column[] = [
  { width: '34px' },
  { label: 'machine', width: 'minmax(0, 1.3fr)' },
  { label: 'state', width: '120px' },
  { label: 'uptime', width: '110px' },
  { label: 'running', width: '130px' },
  { label: 'tools', width: 'minmax(0, 150px)' },
  { label: 'address', width: '120px' },
];

const SESSIONS: Column[] = [
  { width: '24px' },
  { label: 'chat', width: 'minmax(0, 1.6fr)' },
  { label: 'machine', width: '100px' },
  { label: 'model', width: 'minmax(0, 150px)' },
  { label: 'may do', width: '110px' },
  { label: 'doing now', width: 'minmax(0, 1.3fr)' },
  { label: 'time', width: '72px' },
  { label: 'cost', width: '72px' },
  { width: '96px' },
];

function sessionRow(r: Running, live: Live, now: number,
                    onOpen: () => void, onStop: () => void) {
  const chat = r.chat;
  const awaiting = chat.status === 'awaiting_approval';
  const since = live.since ?? chat.updated_at;
  const doing = live.tool ? `${live.tool} ${live.detail}`.trim() : 'running…';
  return {
    key: `${r.hostKey}/${chat.id}`,
    tone: 'amber' as Tone,
    wash: awaiting,
    onClick: onOpen,
    title: chat.title || 'New chat',
    cells: [
      <StatusDot state={awaiting ? 'asking' : 'running'} hollow={awaiting} />,
      <NameCell title={chat.title || 'New chat'} note={tilde(chat.cwd)} />,
      <Cell text={r.hostName} style={{ color: T.ink2 }} />,
      <>
        <Tag label={chat.provider === 'claude' ? 'Claude' : 'Codex'} />
        <Cell text={chat.effort ? `${chat.model} · ${chat.effort}` : chat.model} />
      </>,
      <Tag label={chat.perm_mode || 'asks first'} tone={permTone(chat.perm_mode)} />,
      awaiting
        ? <Cell text={live.approval || 'waiting for you to allow something'} tone="amber" />
        : <>
            <Pulse color={T.run} />
            <Cell text={doing} tone={live.done ? 'ink3' : undefined} />
          </>,
      <Cell text={elapsed(now / 1000 - since)} tone={awaiting ? 'amber' : undefined} />,
      <Cell text={cost(chat.total_cost_usd)} />,
      <span style={{ marginLeft: 'auto' }}>
        {awaiting
          ? <Button small face="amber" label="Answer" onClick={onOpen} />
          : <Button small face="outline" label="Stop" title="Stop this turn" onClick={onStop} />}
      </span>,
    ],
  };
}

/** Every sign-in that has reported a window, grouped the way it is spent: one
 *  account on one machine. */
function limitBlocks(hosts: Record<string, HostSlot>, order: string[]) {
  const out: { key: string; host: string; label: string; id: string; windows: LimitWindow[] }[] = [];
  for (const k of order) {
    const slot = hosts[k];
    if (!slot) continue;
    for (const [id, windows] of Object.entries(slot.limits ?? {})) {
      const live = (windows ?? [])
        .filter((w) => typeof w.utilization === 'number')
        .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0));
      if (!live.length) continue;
      out.push({
        key: `${k}/${id}`,
        host: slot.info?.name || slot.cfg.name,
        label: slot.accounts.find((a) => a.id === id)?.label || id,
        id,
        windows: live,
      });
    }
  }
  return out;
}

export function Fleet({ onOpenChat, onNewChat }: FleetProps) {
  const fleet = useFleet();
  const { hosts, order, activity } = fleet;
  const [live, setLive] = useState<Record<string, Live>>({});
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const running = useMemo(() => selectRunning(fleet), [fleet.hosts, fleet.order]);
  const ticking = running.length > 0;

  // Only the running rows need a second hand; when nothing runs the clock in
  // the page head is the only thing left to keep fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ticking ? 1000 : 30000);
    return () => clearInterval(id);
  }, [ticking]);

  useEffect(() => onAnyEvent((key, ev) => {
    if (!ev.chat_id) return;
    const k = `${key}/${ev.chat_id}`;
    const d: any = ev.data || {};
    const ts = ev.ts || Date.now() / 1000;
    setLive((m) => {
      const cur = m[k] ?? EMPTY_LIVE;
      switch (ev.event) {
        case 'turn.started':
          return { ...m, [k]: { ...EMPTY_LIVE, since: ts } };
        case 'tool.use':
          return { ...m, [k]: { ...cur, tool: d.tool ?? null, detail: toolSummary(d.tool ?? '', d.input), done: false } };
        case 'tool.result':
          return cur.tool ? { ...m, [k]: { ...cur, done: true } } : m;
        case 'approval.request':
          return { ...m, [k]: { ...cur, approval: `${d.tool ?? ''} ${toolSummary(d.tool ?? '', d.input)}`.trim() } };
        case 'approval.resolved':
          return { ...m, [k]: { ...cur, approval: null } };
        case 'turn.done':
        case 'turn.error': {
          if (!(k in m)) return m;
          const next = { ...m };
          delete next[k];
          return next;
        }
        default:
          return m;
      }
    });
  }), []);

  const doRefresh = async () => {
    setBusy(true);
    try { await Promise.all(order.map((k) => fleet.refresh(k))); }
    finally { setBusy(false); }
  };

  const awaiting = running.filter((r) => r.chat.status === 'awaiting_approval').length;
  const openCost = running.reduce((n, r) => n + (Number(r.chat.total_cost_usd) || 0), 0);
  const onlineCount = order.filter((k) => hosts[k]?.status === 'online').length;
  const anyOnline = onlineCount > 0;
  const blocks = useMemo(() => limitBlocks(hosts, order), [hosts, order]);
  const stamp = new Date(now);

  if (!order.length) {
    return (
      <EmptyState
        title="No computer is paired yet."
        body="This page is the live half of the machines table: every session running anywhere,
              and the plan window each sign-in is spending. Both arrive with the first computer."
        foot="nothing is running · no plan has been read"
      />
    );
  }

  return (
    <>
      <SectionHeader
        kind="page" title="Sessions and plan limits"
        note={`${onlineCount} of ${order.length} answering`}
        right={`${stamp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `
          + stamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      >
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button small face="outline" label={busy ? 'Reading…' : 'Refresh'}
            disabled={busy} onClick={doRefresh} />
          <Button small icon={P.plus} label="New chat" onClick={onNewChat} />
        </span>
      </SectionHeader>

      <Table
        columns={COMPUTERS}
        rows={order.filter((k) => hosts[k]).map((k) => {
          const slot = hosts[k];
          const conn = connOf(slot);
          const info = slot.info;
          const known = slot.chats.filter((c) => !c.archived).length;
          return {
            key: k,
            tone: conn.tone,
            wash: slot.status === 'unauthorized',
            cells: [
              <Well icon={P.cpu} />,
              <NameCell
                mark title={info?.name || slot.cfg.name}
                note={info
                  ? `${info.os}${info.os_version ? ` ${info.os_version}` : ''} · daemon ${info.daemon_version}`
                    + (isLocal(slot.cfg.host) ? ' · this computer' : '')
                  : 'no daemon information'}
              />,
              <>
                <StatusDot state={conn.state} hollow={slot.status !== 'online'} />
                <Cell text={conn.says} tone={conn.tone} />
              </>,
              <Cell
                text={info && slot.status === 'online' ? uptime(info.uptime_s)
                  : slot.lastOnline ? `seen ${ago(slot.lastOnline / 1000)}` : 'never reached'}
                tone={slot.status === 'online' ? undefined : 'ink3'}
              />,
              <Cell
                text={info && slot.status === 'online'
                  ? `${info.active_sessions} sessions · ${info.connected_devices} devices`
                  : `${known} chats, last known`}
                tone={slot.status === 'online' ? undefined : 'ink3'}
              />,
              <Cell
                text={info?.versions
                  ? `claude ${info.versions.claude ?? 'absent'} · codex ${info.versions.codex ?? 'absent'}`
                  : 'not reported'}
                tone={info?.versions ? undefined : 'ink3'}
              />,
              <Cell text={maskHost(slot.cfg.host)} tone="ink3" />,
            ],
          };
        })}
      />

      <SectionHeader
        title="Running now" count={running.length}
        note={awaiting ? `${awaiting} waiting for you` : undefined}
        right={running.length ? `${cost(openCost)} across the open chats` : undefined}
        tone={awaiting ? 'amber' : undefined}
      >
        {!!running.length && (
          <span style={{ marginLeft: 'auto' }}>
            <Button
              small face="outline" label="Stop every one"
              onClick={() => { for (const r of running) interrupt(r.hostKey, r.chat.id).catch(() => {}); }}
            />
          </span>
        )}
      </SectionHeader>

      <Table
        columns={SESSIONS}
        rows={running.map((r) => sessionRow(
          r, live[`${r.hostKey}/${r.chat.id}`] ?? EMPTY_LIVE, now,
          () => onOpenChat(r.hostKey, r.chat.id),
          () => interrupt(r.hostKey, r.chat.id).catch(() => {}),
        ))}
        empty={anyOnline
          ? 'Nothing is running anywhere. The moment a chat starts working, or asks to be '
            + 'allowed to do something, its row appears here.'
          : 'No computer is answering. When they come back, their running sessions gather here.'}
      />

      <SectionHeader title="Plan limits" count={blocks.length} note="as the tools report them" />

      {blocks.length ? blocks.map((b) => (
        <Card key={b.key}>
          <SectionHeader title={b.label} note={b.label === b.id ? undefined : b.id} right={b.host} />
          {b.windows.map((w) => {
            const u = Math.max(0, Math.min(1, w.utilization ?? 0));
            return (
              <Slider
                key={w.window} value={u} format={pct}
                label={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {windowName(w.window)}
                    {w.status === 'rejected' && <Tag label="used up" tone="red" />}
                    {w.status === 'allowed_warning' && <Tag label="warning" tone="amber" />}
                    {!!w.overage_status && <Tag label={`overage · ${w.overage_status}`} />}
                  </span>
                }
                note={
                  <span style={{ color: limitTone(u) === 'run' ? T.ink3 : undefined }}>
                    {w.resets_at ? `resets ${until(w.resets_at)}` : 'no reset time reported'}
                  </span>
                }
              />
            );
          })}
        </Card>
      )) : (
        <Card>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
            No tool has reported plan usage yet. A window lands here after the first turn a
            sign-in takes.
          </div>
        </Card>
      )}

      <SectionHeader
        title="Live events" count={activity.length || undefined}
        note={anyOnline ? 'the stream is open' : 'the stream is closed'}
        tone={anyOnline ? 'run' : 'ink3'}
      />

      <Card inset={false} style={{ maxHeight: 340, overflowY: 'auto' }}>
        {activity.length ? activity.slice(0, 40).map((a, i) => (
          <Row
            key={a.id} first={i === 0}
            lead={<Cell text={clock(a.ts)} tone="ink3" style={{ width: 58, flex: 'none' }} />}
            title={<Cell text={a.event} tone={EVENT_TONE[a.event] ?? 'ink3'} style={{ width: 130 }} />}
            note={order.length > 1 ? `${a.hostName} · ${a.text}` : a.text}
            onClick={a.chatId ? () => onOpenChat(a.hostKey, a.chatId!) : undefined}
            style={{ padding: '7px 18px' }}
          />
        )) : (
          <div style={{ padding: '14px 18px' }}>
            <Quoted>no events yet — rows stream in here once a turn begins</Quoted>
          </div>
        )}
      </Card>

      <div style={{ ...mono, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.ink3 }}>
        {busy ? <Spinner size={12} color={T.ink3} /> : <Icon path={IC.refresh} size={12} color={T.ink3} />}
        every figure here was read from the computer it belongs to
      </div>
    </>
  );
}
