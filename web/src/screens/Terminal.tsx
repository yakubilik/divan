import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MONO, RADIUS, SHADOW, T, toneFace, type State, type ToneFace,
} from '../lib/theme';
import { Icon, P, mono } from '../ui/kit';
import { ago, cost, duration, shortPath, tildeAll, tokens, toolSummary } from '../lib/format';
import { useFleet } from '../lib/fleet';
import { emptyLog, logKey, useLogs, type ChatLog, type Item } from '../lib/timeline';
import { deleteChat, respond, updateChat } from '../lib/actions';
import { hasChatDrag, readChatDrag, setChatDrag } from '../lib/dnd';
import {
  Button, Card, Choice, EmptyState, Pill, Quoted, SectionHeader, StatusDot, Write,
} from '../ui/divan';
import type { Chat } from '../lib/protocol';
import { Ustabasi } from './Ustabasi';

/** Terminal mode: every chat at once, each one drawn as the window it would be
 *  if it were a terminal on a desk. The chat list answers "what have I got";
 *  this answers "what is happening", which is a different question and needs
 *  the last few lines of each conversation, not a one-line preview of the most
 *  recent one. Nothing here is a new source of truth — the tiles read the same
 *  fleet store and the same folded event logs the chat screen reads.
 *
 *  TODO(daemon): Web15 W14, the frame behind this row of the Machine drawer,
 *  draws a different product — tabs of a real shell on a reachable machine, a
 *  pty with `git status` and `divan ps` typed into it, and an agent's own
 *  session attached to. Nothing carries one: there is no request that opens a
 *  shell, and none that writes to one. So what this page is is what it has
 *  always been — every chat on every computer at once, with the ticket queue
 *  beside it — under the head that frame puts over it. */

// ── what a tile is doing ─────────────────────────────────────────────────────
// The daemon's `chat.status` has three values, and a tile needs to tell apart
// the three ways a chat can be not-running: it finished, it was interrupted, or
// it fell over. Those three are only visible in the log's last turn, so the
// phase is the chat's status first and the timeline's tail second.

type Phase = 'working' | 'approval' | 'error' | 'done' | 'stopped' | 'idle';

/** Every phase is one of Divan's tones, and a tone comes with the wash behind
 *  it and the line round it (`toneFace`): the tile's head is washed in its
 *  phase and the tile is outlined in it, because a wall is read by colour from
 *  across a room, long before any of the words on it are legible. Nothing here
 *  thins a colour of its own — the two weights a tone has are the design's
 *  (TOKENS.md).
 *
 *  Working is the green and not the red on purpose. The two warm colours — the
 *  amber that wants an answer and the red that went wrong — are the only warm
 *  things on a wall of twenty tiles, and the eye goes to them; painting "busy"
 *  in the red would put a third warm hue beside the two that matter and bury
 *  them. The frames draw no blue at all, so what the panel used to paint blue
 *  is the green that means work is happening. */
const PHASE: Record<Phase, ToneFace> = {
  working: toneFace('working', 'run'),
  approval: toneFace('needs approval', 'amber'),
  error: toneFace('error', 'red'),
  done: toneFace('done', 'ink3'),
  stopped: toneFace('stopped', 'ink3'),
  idle: toneFace('idle', 'ink3'),
};

/** …and the state each phase is, in the six the design names: colour is never
 *  the only carrier, so a chip and a tile both say it with a character too. */
const MARK: Record<Phase, State> = {
  working: 'running', approval: 'asking', error: 'stuck',
  done: 'done', stopped: 'quiet', idle: 'quiet',
};

/** The ring a tile wears. `Card` takes four, and three of them are states. */
const RING: Record<Phase, 'line' | 'amber' | 'red' | 'run'> = {
  working: 'run', approval: 'amber', error: 'red',
  done: 'line', stopped: 'line', idle: 'line',
};

const FILTERS: { key: Phase | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'working', label: 'Working' },
  { key: 'approval', label: 'Needs approval' },
  { key: 'error', label: 'Error' },
  { key: 'done', label: 'Done' },
  { key: 'stopped', label: 'Stopped' },
];

/** The tail of a log, read once and handed to everything that needs a piece of
 *  it. Walking backwards stops at the turn boundary: what a tile shows is the
 *  turn that is running, or the one that just ended — not the whole history. */
interface Tail {
  phase: Phase;
  /** the still-open approval, if the agent is waiting on one */
  approval: Extract<Item, { kind: 'approval' }> | null;
  lastUser: string | null;
  lastAssistant: string | null;
  /** the tool that is running right now, or the last one that ran */
  lastTool: string | null;
  running: string | null;
  thinking: string | null;
  tools: number;
  toolErrors: number;
  error: string | null;
  turn: Extract<Item, { kind: 'turn' }> | null;
  /** when the current turn started, for the clock on a working tile */
  startedAt: number | null;
}

function readTail(chat: Chat, log: ChatLog): Tail {
  const t: Tail = {
    phase: 'idle', approval: null, lastUser: null, lastAssistant: null,
    lastTool: null, running: null, thinking: null, tools: 0, toolErrors: 0,
    error: null, turn: null, startedAt: null,
  };

  // The last turn marker, if there is one: everything after it is the turn
  // that is live, everything before it is already accounted for.
  let cut = -1;
  for (let i = log.items.length - 1; i >= 0; i--) {
    const it = log.items[i];
    if (it.kind === 'turn' || it.kind === 'error') { cut = i; break; }
  }
  const tailItems = log.items.slice(cut + 1);
  const closing = cut >= 0 ? log.items[cut] : null;
  if (closing?.kind === 'turn') t.turn = closing;
  if (closing?.kind === 'error') t.error = closing.message;

  for (const it of tailItems) {
    if (t.startedAt == null) t.startedAt = it.ts;
    switch (it.kind) {
      case 'user': if (it.text.trim()) t.lastUser = it.text; break;
      case 'assistant': if (it.text.trim()) t.lastAssistant = it.text; break;
      case 'thinking': t.thinking = it.text; break;
      case 'tool': {
        t.tools++;
        if (it.isError) t.toolErrors++;
        const line = `${it.tool} ${toolSummary(it.tool, it.input)}`.trim();
        t.lastTool = line;
        t.running = it.running ? line : null;
        break;
      }
      case 'approval':
        if (it.decision == null) t.approval = it;
        break;
    }
  }

  // A chat whose turn ended with nothing after it still deserves its last
  // words on the tile, so the search above widens when the tail is empty.
  if (!t.lastUser || !t.lastAssistant) {
    for (let i = log.items.length - 1; i >= 0; i--) {
      const it = log.items[i];
      if (!t.lastAssistant && it.kind === 'assistant' && it.text.trim()) t.lastAssistant = it.text;
      if (!t.lastUser && it.kind === 'user' && it.text.trim()) t.lastUser = it.text;
      if (t.lastUser && t.lastAssistant) break;
    }
  }

  t.phase = chat.status === 'awaiting_approval' || t.approval ? 'approval'
    : chat.status === 'running' || log.busy ? 'working'
    : t.error ? 'error'
    : t.turn?.stopReason === 'interrupted' ? 'stopped'
    : t.turn ? 'done'
    : 'idle';
  return t;
}

/** The footer's one line of numbers. Only what the turn actually reported: a
 *  chat that never ran has no cost and says so by saying nothing. */
function metaLine(chat: Chat, t: Tail, now: number): string {
  if (t.phase === 'working') {
    const bits = [t.startedAt ? duration((now - t.startedAt) * 1000) : null];
    if (t.tools) bits.push(`${t.tools} ${t.tools === 1 ? 'tool' : 'tools'}`);
    return bits.filter(Boolean).join(' · ') || 'starting…';
  }
  if (t.phase === 'approval') return t.approval?.tool ?? 'waiting on you';
  if (t.phase === 'error') return t.error ?? 'the turn failed';
  if (t.phase === 'stopped') return 'stopped by you';
  if (t.turn) {
    const used = t.turn.usage?.output_tokens ?? t.turn.usage?.input_tokens ?? null;
    return [
      t.turn.costUsd != null ? cost(t.turn.costUsd) : null,
      t.turn.durationMs != null ? duration(t.turn.durationMs) : null,
      used != null ? `${tokens(used)} tok` : null,
    ].filter(Boolean).join(' · ') || 'finished';
  }
  return chat.last_preview ? '' : 'nothing has run here yet';
}

// ── the few lines a tile shows ───────────────────────────────────────────────

/** One thing drawn in a tile. `you` and `agent` are the conversation and are
 *  drawn as bubbles on their own side; `note` is everything that is not
 *  somebody talking — the tools that ran, the command waiting to be allowed,
 *  the error. Those keep a quiet line of their own rather than a bubble,
 *  because a tile that puts "7 steps" in a speech bubble is claiming the agent
 *  said it. */
interface Line {
  side: 'you' | 'agent' | 'note';
  text: string;
  /** notes only: the colour the line is carrying (an error is red, an approval amber) */
  color?: string;
  code?: boolean;
}

function conversation(chat: Chat, t: Tail, log: ChatLog): Line[] {
  // The conversation itself, in the order it happened. This used to be a
  // summary — the last thing said on each side — and a summary is why the wall
  // looked frozen: two lines that only change when a whole turn ends, on a
  // screen whose entire job is to show movement. The tile shows the tail of the
  // transcript instead, so every message that lands pushes the one above it up.
  const out: Line[] = [];
  for (const it of log.items) {
    if (it.kind === 'user' && it.text.trim()) out.push({ side: 'you', text: it.text });
    else if (it.kind === 'assistant' && it.text.trim()) out.push({ side: 'agent', text: it.text });
  }

  // What the agent is doing right now, under the last thing it said. Tool calls
  // are deliberately not in the list above: a turn runs twenty of them and the
  // last four lines of the tile would never be a conversation again. The one
  // that is running is worth a line, because it is the thing that is moving.
  if (t.phase === 'working') {
    const live = t.running ?? t.thinking;
    if (live) out.push({ side: 'note', text: live, color: T.ink3, code: !!t.running });
  }
  if (t.approval) {
    out.push({
      side: 'note', code: true, color: PHASE.approval.color,
      text: tildeAll(t.approval.preview) || t.approval.tool,
    });
  }
  if (t.phase === 'error' && t.error) {
    out.push({ side: 'note', text: t.error, color: T.red, code: true });
  }
  // Nothing folded in yet — either the chat is empty, or its log is on the way.
  if (!out.length) {
    out.push({
      side: 'note', color: T.ink3,
      text: log.loading ? 'reading the conversation…'
        : log.error ? log.error
        : chat.last_preview || 'Nothing has been said here yet.',
    });
  }
  return out;
}

// ── the tile ─────────────────────────────────────────────────────────────────

const LINES = 4;

function TileButton({ icon, title, tone, onClick }: {
  icon: string; title: string; tone?: 'danger'; onClick: (e: React.MouseEvent) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <button
      type="button" title={title} onClick={onClick}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      style={{
        width: 24, height: 24, borderRadius: RADIUS.mark, flexShrink: 0, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        border: 'none',
        background: !hot ? 'transparent' : tone === 'danger' ? T.redBg : T.s2,
      }}
    >
      <Icon path={icon} size={13} color={hot ? (tone === 'danger' ? T.red : T.ink) : T.ink3} width={2} />
    </button>
  );
}

function Tile({ chat, hostKey, hostName, log, tail: t, now, onPeek, onDelete, onDismiss, onRename, onDragStart }: {
  chat: Chat; hostKey: string; hostName: string; log: ChatLog; tail: Tail; now: number;
  onPeek: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  onRename: (title: string) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const [hot, setHot] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);   // non-null while renaming

  const commit = () => {
    const next = (draft ?? '').trim();
    setDraft(null);
    if (next && next !== chat.title) onRename(next.slice(0, 120));
  };
  const ph = PHASE[t.phase];
  const shown = conversation(chat, t, log).slice(-LINES);

  const answer = (d: 'allow' | 'deny') => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!t.approval) return;
    respond(hostKey, chat.id, t.approval.requestId, d).catch(() => {});
  };

  return (
    // A tile is a card wearing its phase as a ring, which is the design
    // system's whole vocabulary for a card that wants something.
    <Card
      inset={false} ring={RING[t.phase]} lifted={lifted}
      onClick={onPeek}
      // A draggable ancestor swallows text selection inside the input, so the
      // tile stops being draggable for as long as the title is being typed.
      drag={{
        draggable: draft === null,
        onDragStart: (e) => { setLifted(true); onDragStart(e as React.DragEvent); },
        onDragEnd: () => setLifted(false),
      }}
      style={{
        minHeight: 270,
        transform: hot && !lifted ? 'translateY(-2px)' : 'none',
        boxShadow: hot && !lifted ? SHADOW.pop : undefined,
        // The tile being carried stays faintly in place, so the gap it will
        // leave is visible while the drop target is being chosen.
        opacity: lifted ? 0.4 : 1,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
      }}
    >
      <span onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} style={{
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0,
      }}>
      {/* Title bar. The three dots are not buttons — they are what makes a
          rectangle read as a window at a glance across a wall of them. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        background: ph.wash,
        borderBottom: `1px solid ${ph.edge}`, flexShrink: 0,
      }}>
        <span style={{ display: 'flex', gap: 5, flexShrink: 0, paddingRight: 4 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 9, height: 9, borderRadius: 5, background: T.s2 }} />
          ))}
        </span>
        <StatusDot
          state={MARK[t.phase]} hollow={t.phase === 'approval'}
          style={{ animation: t.phase === 'working' ? 'rac-breathe 1.4s ease-in-out infinite' : undefined }}
        />
        {draft === null ? (
          <span
            // Double-click is the shortcut everyone already tries on a title;
            // the pencil next to it is for everyone who does not.
            onDoubleClick={(e) => { e.stopPropagation(); setDraft(chat.title); }}
            title={chat.title || 'New chat'}
            style={{
              flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: T.ink,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >{chat.title || 'New chat'}</span>
        ) : (
          <input
            autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();                       // Esc here is not "close the wall"
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
            }}
            style={{
              flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: T.ink,
              background: T.bg, border: `1px solid ${T.amber}`, borderRadius: RADIUS.mark,
              outline: 'none', padding: '2px 6px', font: 'inherit', caretColor: T.amber,
            }}
          />
        )}
        <span style={{ ...mono, fontSize: 11, color: T.ink3, flexShrink: 0 }}>{ago(chat.updated_at)}</span>
        <div style={{ display: 'flex', gap: 1, flexShrink: 0, marginRight: -4 }}>
          <TileButton icon={P.pencil} title="Rename this chat"
            onClick={(e) => { e.stopPropagation(); setDraft(chat.title); }} />
          <TileButton icon={P.trash} title="Delete this chat" tone="danger"
            onClick={(e) => { e.stopPropagation(); onDelete(); }} />
          <TileButton icon={P.eyeOff} title="Take off the wall"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }} />
        </div>
      </div>

      <div style={{
        ...mono, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px 0',
        fontSize: 11, color: T.ink3, minWidth: 0,
      }}>
        <span style={{ flexShrink: 0, color: T.ink2 }}>{chat.provider}</span>
        <span>·</span>
        <span style={{ flexShrink: 0 }}>{chat.model}</span>
        <span>·</span>
        <span title={chat.cwd} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shortPath(chat.cwd, 2)}
        </span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, paddingLeft: 6 }}>{hostName}</span>
      </div>

      {/* The conversation sits at the bottom of the tile and grows upwards, the
          way a terminal fills: the newest line is always in the same place. */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden', padding: 12,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 9,
      }}>
        {shown.map((l, i) => {
          // A note is not a bubble: it sits full width, quiet and mono, the way
          // the tool rows do in the chat screen.
          if (l.side === 'note') {
            return (
              <div key={i} style={{
                minWidth: 0, color: l.color ?? T.ink3, lineHeight: 1.4,
                fontSize: l.code ? 11.5 : 12.5, fontFamily: l.code ? MONO : undefined,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{l.text}</div>
            );
          }
          const you = l.side === 'you';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: you ? 'flex-end' : 'flex-start' }}>
              <span style={{
                maxWidth: '84%', padding: '7px 10px', fontSize: 13, lineHeight: 1.4,
                // Squared off on the corner that points at whoever said it —
                // the same shape the chat screen uses, so a tile reads as the
                // conversation it is a window onto.
                borderRadius: you ? '14px 14px 5px 14px' : '14px 14px 14px 5px',
                background: you ? T.ink : T.s2,
                color: you ? T.onInk : T.ink,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                wordBreak: 'break-word',
              }}>{l.text}</span>
            </div>
          );
        })}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '9px 12px',
        borderTop: `1px solid ${ph.edge}`, flexShrink: 0,
      }}>
        <span style={{
          ...mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6,
          textTransform: 'uppercase', color: ph.color, flexShrink: 0,
        }}>{ph.label}</span>
        <span style={{
          ...mono, flex: 1, minWidth: 0, fontSize: 11, color: T.ink3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{metaLine(chat, t, now)}</span>
        {/* Answering from the tile is the point of the mode: the thing worth
            crossing the room for is a chat that stopped to ask. */}
        {t.approval && (
          <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <Button small face="outline" label="Deny" onClick={() => answer('deny')} />
            <Button small face="amber" label="Allow" onClick={() => answer('allow')} />
          </span>
        )}
      </div>
      </span>
    </Card>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

interface Entry { hostKey: string; hostName: string; chat: Chat }

const tileKey = (e: { hostKey: string; chat: Chat }) => `${e.hostKey}/${e.chat.id}`;

/** The wall: which chats are on it, in the order they were put there. One list,
 *  because the wall *is* that list — a chat is on it because someone put it
 *  there, not because it exists.
 *
 *  It belongs to this browser rather than to the daemon: a wall is how one
 *  person likes to stand in front of their screens, and the phone has no wall
 *  at all. */
const WALL_KEY = 'rac.terminal.wall';

function loadKeys(name: string): string[] {
  try {
    const raw = localStorage.getItem(name);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}

function saveKeys(name: string, keys: string[]): void {
  try { localStorage.setItem(name, JSON.stringify(keys)); } catch { /* private mode */ }
}

export interface TerminalProps {
  onPeek: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
}

/** Which wall this screen is showing. Remembered, because it is a way of
 *  working and not a filter you re-pick every morning: someone who watches the
 *  queue watches it all day. */
const SOURCE_KEY = 'rac.terminal.source';
type Source = 'chats' | 'ustabasi';

function loadSource(): Source {
  try { return localStorage.getItem(SOURCE_KEY) === 'ustabasi' ? 'ustabasi' : 'chats'; } catch { return 'chats'; }
}

/** The switch between the two walls. Lives in the header of both, so it reads
 *  as one screen with two subjects rather than two screens. */
function SourceToggle({ value, onChange }: { value: Source; onChange: (s: Source) => void }) {
  return (
    <Choice
      label="What the wall shows" value={value} onChange={onChange}
      options={[{ key: 'chats' as Source, label: 'Chats' },
                { key: 'ustabasi' as Source, label: 'Ustabasi' }]}
    />
  );
}

export function Terminal({ onPeek, onNewChat }: TerminalProps) {
  const { hosts, order } = useFleet();
  const logs = useLogs((s) => s.logs);
  const [source, setSourceState] = useState<Source>(loadSource);
  const [filter, setFilter] = useState<Phase | 'all'>('all');
  const [query, setQuery] = useState('');
  const [wall, setWall] = useState<string[]>(() => loadKeys(WALL_KEY));
  /** the gap a tile would land in, while one is being dragged over the grid */
  const [dropAt, setDropAt] = useState<{ key: string | null; before: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A working tile counts its own turn up, so the whole wall ticks together
  // rather than each tile keeping a timer of its own.
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const flash = (text: string, undo: (() => void) | null = null) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, undo });
    timer.current = setTimeout(() => setToast(null), 5000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => { saveKeys(WALL_KEY, wall); }, [wall]);

  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const key of order) {
      const slot = hosts[key];
      if (!slot) continue;
      const name = slot.info?.name || slot.cfg.name;
      for (const chat of slot.chats) {
        if (chat.archived) continue;
        out.push({ hostKey: key, hostName: name, chat });
      }
    }
    return out;
  }, [hosts, order]);

  // What is on the wall, in the order it was put there — before the search box
  // and the filter pills get a say. The wall is a list of keys, so this is a
  // lookup rather than a sort: the order is not derived from anything, it is
  // the order someone arranged, and nothing a chat does moves it.
  const byKey = useMemo(() => new Map(entries.map((e) => [tileKey(e), e])), [entries]);

  const ordered = useMemo(() => wall
    .map((k) => byKey.get(k))
    // A key with no chat behind it is usually a computer that is asleep, not a
    // chat that is gone — so it is skipped here and left in the stored wall.
    // Pruning it would quietly empty the wall of every machine that happened
    // to be offline when this screen was opened.
    .filter((e): e is Entry => !!e)
    .map((e) => {
      const log = logs[logKey(e.hostKey, e.chat.id)] ?? emptyLog();
      return { ...e, log, tail: readTail(e.chat, log) };
    }), [wall, byKey, logs]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return ordered;
    return ordered.filter((r) => [r.chat.title, r.chat.cwd, r.chat.last_preview, r.hostName]
      .some((s) => (s || '').toLocaleLowerCase('tr').includes(q)));
  }, [ordered, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.tail.phase] = (c[r.tail.phase] ?? 0) + 1;
    return c;
  }, [rows]);

  /** Put a chat on the wall before `beforeKey`, or last when that is null.
   *  Moving a tile already up there and hanging a new one are the same act:
   *  take the key out wherever it is, put it back where it was dropped. */
  const arrange = (dragKey: string, beforeKey: string | null) => {
    // Dropped on its own left edge: the tile is already there. Without this the
    // key is taken out, then looked for, then not found, and the tile it was
    // meant to stay next to sends it to the end of the wall.
    if (beforeKey === dragKey) return;
    setWall((cur) => {
      const next = cur.filter((k) => k !== dragKey);
      const at = beforeKey ? next.indexOf(beforeKey) : -1;
      next.splice(at < 0 ? next.length : at, 0, dragKey);
      return next;
    });
  };

  /** Take a tile off the wall, with a way back for the next few seconds. The
   *  chat is untouched — this is about what is on a screen, not about the chat. */
  const takeDown = (key: string, title: string) => {
    const at = wall.indexOf(key);
    setWall((cur) => cur.filter((k) => k !== key));
    flash(`${title || 'Chat'} taken off the wall`, () => setWall((cur) => {
      if (cur.includes(key)) return cur;
      const next = cur.slice();
      next.splice(at < 0 ? next.length : Math.min(at, next.length), 0, key);
      return next;
    }));
  };

  const tiles = filter === 'all' ? rows : rows.filter((r) => r.tail.phase === filter);

  /** Chats that exist but are not up. What "Add" would put up, and the reason
   *  the button is not there once the wall holds everything. */
  const missing = useMemo(
    () => entries.filter((e) => !wall.includes(tileKey(e))),
    [entries, wall],
  );

  // A tile draws the last few lines of a conversation, and those only exist
  // once the chat has been read. The chat screen loads one at a time; this
  // screen needs all of them, so it asks for the ones it is about to draw and
  // lets the live feed keep them current from there.
  const wanted = tiles.map((r) => `${r.hostKey}/${r.chat.id}`).join('|');
  useEffect(() => {
    const state = useLogs.getState();
    const fleet = useFleet.getState();
    for (const r of tiles) {
      if (fleet.hosts[r.hostKey]?.status !== 'online') continue;
      // A read that failed is worth asking for again — the usual reason it
      // failed is the computer having been away, and it is back now. `open`
      // shares one request per chat, so asking twice costs one.
      const have = state.logs[logKey(r.hostKey, r.chat.id)];
      if (have && !have.error) continue;
      void state.open(r.hostKey, r.chat.id);
    }
  }, [wanted, order.map((k) => hosts[k]?.status).join('|')]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirm(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onlineCount = order.filter((k) => hosts[k]?.status === 'online').length;

  const setSource = (s: Source) => {
    try { localStorage.setItem(SOURCE_KEY, s); } catch { /* private mode */ }
    setSourceState(s);
  };
  const toggle = <SourceToggle value={source} onChange={setSource} />;

  // The other wall. Placed after every hook above, so switching walls is not a
  // change in how many hooks this component runs.
  if (source === 'ustabasi') return <Ustabasi header={toggle} />;

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: T.bg, position: 'relative',
    }}>
      {/* Header: which computers are answering, then the way to narrow the wall
          down. Sticky, because the grid below it is the part that scrolls. */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${T.line}`, background: T.bg }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px 10px', flexWrap: 'wrap',
        }}>
          {toggle}
          {/* The page head Web15 W14 draws over this, under the name the drawer
              gives the row: `600 26px` at `-.02em` with one plain aside, which
              is the design system's own `page` head and not a size invented
              here. */}
          <SectionHeader
            kind="page" title="Terminal"
            note={`${onlineCount} of ${order.length} online`}
            style={{ flexShrink: 0 }}
          />

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            {order.map((k) => {
              const slot = hosts[k];
              if (!slot) return null;
              const online = slot.status === 'online';
              const busy = slot.chats.filter((c) => c.status !== 'idle').length;
              return (
                <Pill
                  key={k}
                  dot={online ? (busy ? 'running' : 'done') : 'quiet'}
                  label={
                    <>
                      <span style={{ fontWeight: 600 }}>{slot.info?.name || slot.cfg.name}</span>
                      <span style={{ color: T.ink3, marginLeft: 6 }}>
                        {online ? (busy ? `${busy} active` : 'idle') : 'offline'}
                      </span>
                    </>
                  }
                />
              );
            })}
          </div>

          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Quoted style={{
              display: 'flex', alignItems: 'center', gap: 8, width: 240, maxWidth: '40vw',
              boxSizing: 'border-box', padding: '0 12px', height: 32, fontSize: 13,
            }}>
              <Icon path={P.search} size={15} color={T.ink3} />
              <Write
                value={query} onChange={setQuery} label="Search chats"
                placeholder="Search chats"
              />
            </Quoted>
            <Button small icon={P.plus} label="New chat" onClick={onNewChat} />
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 24px 12px', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Pill
              key={f.key} face={filter === f.key ? 'ink' : 'surface'}
              dot={f.key === 'all' ? null : MARK[f.key]}
              onClick={() => setFilter(f.key)}
              label={<>{f.label}<span style={{ ...mono, marginLeft: 6 }}>{counts[f.key] ?? 0}</span></>}
            />
          ))}

          {/* Dragging nine chats up one at a time is a chore nobody asked for,
              and an empty wall with no way to fill it but dragging reads as a
              broken screen. This is the shortcut; taking one back down is one
              click on the tile. */}
          {!!missing.length && (
            <span style={{ marginLeft: 'auto' }}>
              <Button
                small face="outline" icon={P.plus} label={`Add ${missing.length}`}
                title="Put every chat that is not already up on the wall"
                onClick={() => {
                  const add = missing.map(tileKey);
                  setWall((cur) => [...cur, ...add]);
                  flash(`${add.length} put up`, () => setWall((cur) => cur.filter((k) => !add.includes(k))));
                }}
              />
            </span>
          )}
          {!!wall.length && (
            <span style={{ marginLeft: missing.length ? 0 : 'auto' }}>
              <Button
                small face="outline" icon={P.eyeOff} label="Clear"
                title="Take everything off the wall"
                onClick={() => {
                  const was = wall;
                  setWall([]);
                  flash('Wall cleared', () => setWall(was));
                }}
              />
            </span>
          )}
        </div>
      </div>

      {/* A tile dropped on the scroller rather than on another tile goes last.
          What puts a chat up in the first place is Add: the list it used to be
          dragged from is the Chat place now, and the two are never on screen
          together. */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 44px' }}
        onDragOver={(e) => { if (hasChatDrag(e.dataTransfer)) { e.preventDefault(); setDropAt({ key: null, before: false }); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}
        onDrop={(e) => {
          const d = readChatDrag(e.dataTransfer);
          setDropAt(null);
          if (!d) return;
          e.preventDefault();
          arrange(`${d.hostKey}/${d.chatId}`, null);
        }}
      >
        {tiles.length ? (
          <div style={{
            display: 'grid', gap: 14,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
          }}>
            {tiles.map((r, i) => {
              const key = tileKey(r);
              const mark = dropAt?.key === key;
              // Which side of the tile the pointer is on decides which gap it
              // lands in. Insertion is always "before something", so the right
              // half means before whatever comes next — and nothing, when this
              // is the last tile, which is the list's end.
              const gap = (e: React.DragEvent) => {
                const box = e.currentTarget.getBoundingClientRect();
                const before = e.clientX < box.left + box.width / 2;
                return { before, target: before ? key : (tiles[i + 1] ? tileKey(tiles[i + 1]) : null) };
              };
              return (
                <div
                  key={key} style={{ position: 'relative' }}
                  onDragOver={(e) => {
                    if (!hasChatDrag(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    setDropAt({ key, before: gap(e).before });
                  }}
                  onDrop={(e) => {
                    const d = readChatDrag(e.dataTransfer);
                    setDropAt(null);
                    if (!d) return;
                    e.preventDefault();
                    e.stopPropagation();
                    arrange(`${d.hostKey}/${d.chatId}`, gap(e).target);
                  }}
                >
                  {mark && (
                    <span style={{
                      position: 'absolute', top: -4, bottom: -4, width: 3, borderRadius: 2,
                      background: T.amber, zIndex: 2,
                      left: dropAt.before ? -8 : undefined,
                      right: dropAt.before ? undefined : -8,
                    }} />
                  )}
                  <Tile
                    chat={r.chat} hostKey={r.hostKey} hostName={r.hostName}
                    log={r.log} tail={r.tail} now={now}
                    onDragStart={(e) => setChatDrag(e.dataTransfer, { hostKey: r.hostKey, chatId: r.chat.id })}
                    onPeek={() => onPeek(r.hostKey, r.chat.id)}
                    onRename={(title) => updateChat(r.hostKey, r.chat.id, { title })
                      .catch((e) => flash(e?.message ?? 'That did not work'))}
                    onDelete={() => setConfirm(r)}
                    onDismiss={() => takeDown(key, r.chat.title)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            border: dropAt ? `1.5px dashed ${T.line2}` : '1.5px dashed transparent',
            borderRadius: RADIUS.card,
          }}>
            <EmptyState
              title={!order.length ? 'No computer is paired yet.'
                : !entries.length ? 'No chat has been started anywhere.'
                : wall.length ? 'No chat on the wall matches.'
                : 'The wall is empty.'}
              body={!order.length
                ? 'A wall is every chat on every paired computer at once. Pair one under Machines.'
                : !entries.length
                  ? 'The first chat you start on any of these computers goes up here.'
                  : wall.length
                    ? 'Every tile on the wall is somewhere else on the filter above.'
                    : 'Add puts the chats up; a tile can then be dragged into any order.'}
            />
          </div>
        )}
      </div>

      {confirm && (
        <div
          onClick={() => setConfirm(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40, padding: 24,
            background: T.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400 }}>
            <Card raised ring="red">
              <span style={{
                width: 38, height: 38, borderRadius: RADIUS.well, background: T.redBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon path={P.trash} size={19} color={T.red} />
              </span>
              <SectionHeader kind="page" title="Delete this chat?" style={{ fontSize: 22 }} />
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
                “{confirm.chat.title || 'New chat'}” and its history are removed from {confirm.hostName}.
                This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button wide face="outline" label="Cancel" onClick={() => setConfirm(null)} />
                <Button
                  wide label="Delete"
                  onClick={() => {
                    const { hostKey, chat } = confirm;
                    setConfirm(null);
                    deleteChat(hostKey, chat.id)
                      .then(() => flash('Chat deleted'))
                      .catch((e) => flash(e?.message ?? 'That did not work'));
                  }}
                />
              </div>
            </Card>
          </span>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 14, padding: '9px 12px 9px 18px',
          borderRadius: RADIUS.pill, background: T.ink, color: T.bg, fontSize: 13.5,
          boxShadow: SHADOW.pop,
        }}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo!();
                if (timer.current) clearTimeout(timer.current);
                setToast(null);
              }}
              style={{
                padding: '4px 10px', borderRadius: RADIUS.chip, cursor: 'pointer', border: 'none',
                fontSize: 13, fontWeight: 600, background: T.bg, color: T.ink,
              }}
            >Undo</button>
          )}
        </div>
      )}
    </div>
  );
}
