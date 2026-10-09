/** What an agent is asking, kept open as a conversation on the Dashboard.
 *
 *  The Dashboard used to say a question in a card under "Needs you": the whole
 *  of the question in a paragraph, and an Open that left the page. This is the
 *  other way round. A question that is waiting opens itself as a floating chat
 *  over the page, with the project and the agent in its head and the question
 *  in it whole; the answer typed there goes back to exactly the ticket or chat
 *  that asked, and the window **stays open** while the agent works with it —
 *  a follow-up lands in the same conversation, under the answer it follows.
 *
 *  Two kinds of thing ask, and each keeps its own transport:
 *
 *   · **a ticket** in a computer's queue that stopped on a question (a board
 *     card whose agent is `asking`). Its answer is a note on that ticket
 *     (`ustabasi.note`), which is what re-opens it.
 *   · **a chat** waiting on an approval or a structured question
 *     (`awaiting_approval`). That window is the chat itself (`ChatPanel`), so
 *     its approvals and forms answer through `approval.respond` and anything
 *     typed is `chat.send`, as everywhere else in the panel.
 *
 *  **When it closes.** Only when the agent says the exchange is over, and never
 *  because something went quiet: an answer being sent, the question clearing
 *  off the card, the ticket going back to work or a turn ending are all part of
 *  the conversation, not the end of it. What a queue says for "I have what I
 *  need and I have finished" is a ticket the verifier passed — `verified` on
 *  the card — so that is the one thing that closes a ticket's window by itself.
 *  A chat has no such word in the protocol, so a chat's window is closed by the
 *  person and only by them. Putting a window away (–) or closing it (×) is
 *  always theirs; a closed question that is still unanswered stays on the
 *  Dashboard under "Needs you", one press from coming back.
 *
 *  Nothing here draws. `scripts/test-asking.mjs` holds the rules without a
 *  browser and drives the window in a document.
 */
import { create } from 'zustand';
import type { Chat } from './protocol';
import type { DivanView, MergedCard } from './divan';
import { idOf, sessions, type Session } from './sessions';

// ── what is asking right now ────────────────────────────────────────────────

/** One thing that is waiting on an answer this moment. */
export interface Pending {
  /** The thread it belongs to. A ticket's is the card's own session id, so the
   *  board and the Dashboard name one question the same way. */
  id: string;
  kind: 'ticket' | 'chat';
  host: string;
  /** The product, and the face asking — what the head of the window says. */
  project: string;
  who: string;
  title: string;
  /** The question, whole. Empty for a chat: its question is in its timeline. */
  question: string;
  /** When it was asked; the same question asked again later is a new turn. */
  at: number;
  cardId?: string;
  ticket?: number | null;
  chatId?: string;
  session?: Session;
}

/** A chat's thread id. Prefixed, because a chat and a card are different
 *  things on the same computer and their ids come from different tables. */
export const chatThread = (host: string, chatId: string): string => `chat:${host}:${chatId}`;

/** What is asking: every ticket stopped on a question (a coding agent's
 *  question or a decision somebody else asked for), and every chat that is
 *  holding a request open. Stuck work and cards that are yours are not
 *  questions — they stay on the Dashboard as they were. */
export function pending(view: DivanView, hosts: Record<string, { chats?: Chat[] } | undefined>): Pending[] {
  const out: Pending[] = [];
  for (const s of sessions(view)) {
    if (s.kind !== 'question' && s.kind !== 'decision') continue;
    out.push({
      id: s.id, kind: 'ticket', host: s.host,
      project: [s.project, s.card.branch].filter(Boolean).join(' · '),
      who: s.who, title: s.card.title, question: s.said, at: s.at ?? 0,
      cardId: s.card.id, ticket: s.ticket, session: s,
    });
  }
  for (const [host, slot] of Object.entries(hosts)) {
    for (const c of slot?.chats ?? []) {
      if (c.status !== 'awaiting_approval' || c.archived) continue;
      out.push({
        id: chatThread(host, c.id), kind: 'chat', host,
        project: c.project || 'Chat', who: c.title || 'Chat', title: c.title || 'Chat',
        question: '', at: c.updated_at || 0, chatId: c.id,
      });
    }
  }
  return out;
}

// ── a thread ────────────────────────────────────────────────────────────────

/** One thing said in a ticket's conversation. */
export interface Line { from: 'agent' | 'you'; text: string; at: number }

export interface Thread {
  id: string;
  kind: 'ticket' | 'chat';
  host: string;
  project: string;
  who: string;
  title: string;
  cardId?: string;
  ticket?: number | null;
  chatId?: string;
  /** When the window first opened. */
  opened: number;
  /** A ticket's conversation, oldest first: each question it asked and each
   *  answer sent from here. A chat's is its own timeline, so this stays empty. */
  lines: Line[];
  /** The question last taken in, and the stamp it carried — what tells a
   *  follow-up from the same question read again on the next poll. */
  asked: string;
  askedAt: number;
}

export interface AskState {
  threads: Thread[];
  minimised: string[];
  /** Closed by hand, by the stamp of the question that was showing: the same
   *  question does not open itself again, a new one does. */
  closed: Record<string, number>;
  /** The window that is open. One at a time: the rest are tabs under it. */
  selected: string | null;
}

export const NO_ASK: AskState = { threads: [], minimised: [], closed: {}, selected: null };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function open(p: Pending, now: number): Thread {
  return {
    id: p.id, kind: p.kind, host: p.host, project: p.project, who: p.who, title: p.title,
    cardId: p.cardId, ticket: p.ticket, chatId: p.chatId, opened: now,
    lines: p.kind === 'ticket' && p.question ? [{ from: 'agent', text: p.question, at: p.at }] : [],
    asked: p.question, askedAt: p.at,
  };
}

/** A thread brought up to date with what is asking now.
 *
 *  A question is appended once: the same stamp read on the next poll, or the
 *  same text re-stamped by a board that moved the card, is the question already
 *  on screen. A different question — or the same words asked again after an
 *  answer was sent — is a follow-up, and goes under the answer. */
function follow(t: Thread, p: Pending): Thread {
  const head = {
    project: p.project, who: p.who, title: p.title, ticket: p.ticket ?? t.ticket,
    // A chat's request is in its timeline; the stamp is only what a close is
    // remembered by.
    askedAt: p.kind === 'chat' ? p.at : t.askedAt,
  };
  if (p.at === t.askedAt || p.kind !== 'ticket') {
    // Untouched where nothing moved, so that a poll that changed nothing is
    // not a new state and not a render.
    const moved = (Object.keys(head) as (keyof typeof head)[]).some((k) => head[k] !== t[k]);
    return moved ? { ...t, ...head } : t;
  }
  const last = t.lines[t.lines.length - 1];
  const again = norm(p.question) !== norm(t.asked) || last?.from === 'you';
  if (!again || !p.question) return { ...t, ...head, askedAt: p.at };
  return {
    ...t, ...head, asked: p.question, askedAt: p.at,
    lines: [...t.lines, { from: 'agent', text: p.question, at: p.at }],
  };
}

/** Whether the agent has said the exchange is over: the ticket finished and
 *  the verifier passed it. Nothing else closes a window by itself. */
export function complete(t: Thread, view: DivanView): boolean {
  if (t.kind !== 'ticket') return false;
  const card = view.cards.find((c) => c.host === t.host && c.id === t.cardId);
  return card?.agent_status === 'verified';
}

/** Everything the page knows, folded into what the reader has open.
 *
 *  Run on every update and on every load, and the same input always gives the
 *  same state: that is what keeps a reload or a poll from drawing one question
 *  twice. */
export function sync(state: AskState, asking: Pending[], view: DivanView, now: number): AskState {
  let threads = state.threads.filter((t) => !complete(t, view));
  let closed = state.closed;
  let selected = state.selected;
  for (const p of asking) {
    const i = threads.findIndex((t) => t.id === p.id);
    if (i >= 0) {
      const next = follow(threads[i], p);
      if (next !== threads[i]) threads = threads.map((t, j) => (j === i ? next : t));
      continue;
    }
    // Closed with this very question on it: it stays on the Dashboard as a row,
    // and does not jump back over the page.
    if (closed[p.id] !== undefined && closed[p.id] === p.at) continue;
    if (closed[p.id] !== undefined) {
      closed = Object.fromEntries(Object.entries(closed).filter(([k]) => k !== p.id));
    }
    threads = [...threads, open(p, now)];
  }
  const ids = new Set(threads.map((t) => t.id));
  const minimised = state.minimised.filter((id) => ids.has(id));
  if (!selected || !ids.has(selected) || minimised.includes(selected)) {
    // The oldest question that is not put away: what has waited longest first.
    selected = threads.find((t) => !minimised.includes(t.id))?.id ?? null;
  }
  const same = threads.length === state.threads.length
    && threads.every((t, i) => t === state.threads[i])
    && closed === state.closed && selected === state.selected
    && minimised.length === state.minimised.length;
  return same ? state : { threads, minimised, closed, selected };
}

/** What a thread is doing, for the badge in its head. */
export type Phase = 'asking' | 'working' | 'stopped' | 'withdrawn' | 'quiet';

export function phase(t: Thread, view: DivanView,
                      hosts: Record<string, { chats?: Chat[] } | undefined>): Phase {
  if (t.kind === 'chat') {
    const chat = hosts[t.host]?.chats?.find((c) => c.id === t.chatId);
    if (!chat) return 'withdrawn';
    if (chat.status === 'awaiting_approval') return 'asking';
    return chat.status === 'running' ? 'working' : 'quiet';
  }
  const card: MergedCard | undefined = view.cards.find((c) => c.host === t.host && c.id === t.cardId);
  const board = view.hosts.find((h) => h.key === t.host);
  if (!card) return board && !board.missing && !board.stale ? 'withdrawn' : 'working';
  if (card.agent_status === 'asking') return 'asking';
  if (card.agent_status === 'cancelled') return 'withdrawn';
  if (card.agent_status === 'failed' || card.agent_status === 'blocked') return 'stopped';
  return 'working';
}

export const PHASE_WORD: Record<Phase, string> = {
  asking: 'asking', working: 'working on it', stopped: 'stopped',
  withdrawn: 'withdrawn', quiet: 'idle',
};

// ── the question, as the points it makes ────────────────────────────────────

/** A question as the separate points in it, each said once.
 *
 *  The queue writes a question as a list, and a list read back as a paragraph
 *  is a wall — "- A? - B? - C?" on one line is the card in the screenshot this
 *  was made for. Split on the list's own marks, whether they start lines or
 *  follow a sentence on the same one, and a point made twice word for word is
 *  drawn once. */
export function points(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text || '').split('\n')) {
    for (const piece of raw.split(/(?<=[?.!:])\s+[-•*]\s+/)) {
      const line = piece.trim();
      if (!line) continue;
      const bare = line.replace(/^(?:[-*•‣]|\d+[.)])\s+/, '').trim();
      const marked = bare !== line;
      if (!marked && out.length && !/[?.!:]$/.test(out[out.length - 1])) {
        // A wrapped line belongs to the point above it.
        const joined = `${out.pop()} ${bare}`;
        seen.add(norm(joined));
        out.push(joined);
        continue;
      }
      const key = norm(bare);
      if (!bare || seen.has(key)) continue;
      seen.add(key);
      out.push(bare);
    }
  }
  return out;
}

// ── the store ───────────────────────────────────────────────────────────────

const KEPT = 'rac.asking';

function read(): AskState {
  try {
    const held = JSON.parse(localStorage.getItem(KEPT) || 'null');
    if (!held || !Array.isArray(held.threads)) return NO_ASK;
    const threads = held.threads.filter((t: any) => t && typeof t.id === 'string'
      && typeof t.host === 'string' && (t.kind === 'ticket' || t.kind === 'chat'))
      .map((t: any) => ({ ...t, lines: Array.isArray(t.lines) ? t.lines : [] }));
    return {
      threads,
      minimised: (held.minimised ?? []).filter((x: any) => typeof x === 'string'),
      closed: held.closed && typeof held.closed === 'object' ? held.closed : {},
      selected: typeof held.selected === 'string' ? held.selected : null,
    };
  } catch { return NO_ASK; }
}

function write(s: AskState): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify({
      threads: s.threads, minimised: s.minimised, closed: s.closed, selected: s.selected,
    }));
  } catch { /* private mode */ }
}

interface AskStore extends AskState {
  sync: (asking: Pending[], view: DivanView, now?: number) => void;
  select: (id: string) => void;
  minimise: (id: string) => void;
  /** Close by hand. A question still waiting stays on the Dashboard. */
  close: (id: string) => void;
  /** Bring a question back, from the Dashboard's row or a tab — opening a
   *  thread for it if it was closed. */
  raise: (p: Pending) => void;
  /** An answer that went out from here, kept in the conversation. */
  said: (id: string, text: string, at?: number) => void;
}

/** Kept across a reload: the conversation is what was said, and an answer that
 *  vanished from it on a refresh would read as an answer that was never sent. */
export const useAsking = create<AskStore>((set) => {
  const put = (fn: (s: AskState) => AskState) => set((s) => {
    const next = fn(s);
    if (next !== s) write(next);
    return next;
  });
  return {
    ...read(),
    sync: (asking, view, now = Date.now() / 1000) => put((s) => sync(s, asking, view, now)),
    select: (id) => put((s) => ({ ...s, selected: id, minimised: s.minimised.filter((x) => x !== id) })),
    minimise: (id) => put((s) => {
      const minimised = s.minimised.includes(id) ? s.minimised : [...s.minimised, id];
      const selected = s.selected === id
        ? s.threads.find((t) => !minimised.includes(t.id))?.id ?? null : s.selected;
      return { ...s, minimised, selected };
    }),
    close: (id) => put((s) => {
      const t = s.threads.find((x) => x.id === id);
      const threads = s.threads.filter((x) => x.id !== id);
      const minimised = s.minimised.filter((x) => x !== id);
      return {
        threads, minimised,
        closed: t ? { ...s.closed, [id]: t.askedAt } : s.closed,
        selected: s.selected === id
          ? threads.find((x) => !minimised.includes(x.id))?.id ?? null : s.selected,
      };
    }),
    raise: (p) => put((s) => {
      const closed = Object.fromEntries(Object.entries(s.closed).filter(([k]) => k !== p.id));
      const threads = s.threads.some((t) => t.id === p.id) ? s.threads
        : [...s.threads, open(p, Date.now() / 1000)];
      return { threads, closed, selected: p.id, minimised: s.minimised.filter((x) => x !== p.id) };
    }),
    said: (id, text, at = Date.now() / 1000) => put((s) => ({
      ...s,
      threads: s.threads.map((t) => (t.id === id ? { ...t, lines: [...t.lines, { from: 'you', text, at }] } : t)),
    })),
  };
});

/** The thread a card on the Dashboard belongs to. */
export const threadOf = (card: { host: string; id: string }): string => idOf(card);
