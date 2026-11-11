/** Real shells on a computer, opened from the panel (`term.*`, docs/PROTOCOL.md
 *  *Terminal*).
 *
 *  This is the half of the Terminal tab that knows nothing about drawing: which
 *  shells are open on which computer, which one is in front, and the bytes
 *  between the socket and whatever draws them. The drawing is xterm.js
 *  (`xterm-view.ts`), reached through the small `TermView` below so that the
 *  wiring can be driven in a test without a browser behind it.
 *
 *  Shells live here rather than in the screen, so leaving the Terminal tab and
 *  coming back finds them still running, with what they printed meanwhile kept
 *  in a bounded scrollback. A shell ends when its tab is closed, when it exits,
 *  or when the daemon's own reaper ends it — never because a page was left.
 */
import { create } from 'zustand';
import { onAnyEvent, useFleet } from './fleet';
import { errText } from './i18n';
import type { RacEvent } from './protocol';

export type ShellState = 'opening' | 'live' | 'ended' | 'failed';

export interface Shell {
  /** This panel's own id for the tab, known before the daemon answers. */
  id: string;
  hostKey: string;
  /** The daemon's id, once `term.open` has answered. */
  termId: string | null;
  state: ShellState;
  /** The tab's label: the shell's name and its number on that computer. */
  title: string;
  cols: number;
  rows: number;
  error: string | null;
  code: number | null;
}

/** What draws a shell. xterm.js in the panel; a recorder in the tests. */
export interface TermView {
  write(data: string): void;
  /** Keystrokes and pastes, as the text the shell should be sent. */
  onData(fn: (data: string) => void): void;
  /** The grid changed size (a fit after the window or the pane moved). */
  onResize(fn: (size: { cols: number; rows: number }) => void): void;
  /** Size the grid to its element, and report it through `onResize`. */
  fit(): void;
  focus(): void;
  dispose(): void;
  readonly cols: number;
  readonly rows: number;
}

export type ViewFactory = (el: HTMLElement) => Promise<TermView>;

/** xterm.js is loaded when the first shell is drawn, not with the panel: most
 *  visits never open one, and it is the largest thing the panel would carry. */
let factory: ViewFactory = (el) => import('./xterm-view').then((m) => m.createView(el));
export function viewFactory(): ViewFactory { return factory; }
/** For tests: draw shells with something other than xterm.js. */
export function setViewFactory(f: ViewFactory): void { factory = f; }

/** How much of what a shell printed is kept for redrawing it. */
const SCROLLBACK = 256 * 1024;

const buffers = new Map<string, string>();
const sinks = new Map<string, Set<(data: string) => void>>();
/** Output for a term whose `term.open` answer has not arrived yet: the daemon
 *  may print the prompt before the reply reaches us. Keyed `hostKey\0termId`. */
const early = new Map<string, string>();
let seq = 0;
/** The size the last drawn shell had, so a new one opens at about the right
 *  size rather than at 80×24 and then jumps. */
let lastSize = { cols: 80, rows: 24 };

function emit(id: string, data: string) {
  if (!data) return;
  const was = buffers.get(id) ?? '';
  const next = was + data;
  buffers.set(id, next.length > SCROLLBACK ? next.slice(next.length - SCROLLBACK) : next);
  for (const fn of sinks.get(id) ?? []) fn(data);
}

/** Everything the shell has printed that is still kept. */
export function scrollback(id: string): string { return buffers.get(id) ?? ''; }

/** Follow what a shell prints from now on. */
export function subscribe(id: string, fn: (data: string) => void): () => void {
  let set = sinks.get(id);
  if (!set) { set = new Set(); sinks.set(id, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

interface ShellsState {
  shells: Shell[];
  /** hostKey → the shell in front on that computer */
  active: Record<string, string>;
  /** hostKey → why a shell cannot be opened there: its terminal is turned
   *  off (`terminal_disabled`). Shown in place of a tab, never as one. */
  refused: Record<string, string>;
  open: (hostKey: string, size?: { cols: number; rows: number }) => Promise<Shell | null>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  close: (id: string) => void;
  select: (hostKey: string, id: string) => void;
}

const call = <T = any>(hostKey: string, type: string, data: Record<string, any>) =>
  useFleet.getState().call<T>(hostKey, type, data);

/** The host.status a `terminal_disabled` answer arrived under, per computer.
 *  Until the computer says something new about itself, it is taken at its word
 *  and asked nothing more; a fresh host.status (it reconnected, or the switch
 *  was flipped and announced) lets the next press ask again. */
const offUnder = new Map<string, unknown>();

/** Whether this computer's terminal is known to be off, so `term.open` would
 *  only be refused: its host.status says so, or it answered so under the
 *  host.status it still has. */
export function terminalOff(hostKey: string): boolean {
  const info = useFleet.getState().hosts[hostKey]?.info;
  if (info?.terminal === false) return true;
  return offUnder.has(hostKey) && offUnder.get(hostKey) === info;
}

function shellName(path: unknown): string {
  const s = typeof path === 'string' ? path.split('/').pop() : '';
  return s || 'shell';
}

export const useShells = create<ShellsState>((set, get) => {
  const patch = (id: string, p: Partial<Shell>) =>
    set((s) => ({ shells: s.shells.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const find = (id: string) => get().shells.find((x) => x.id === id);

  return {
    shells: [],
    active: {},
    refused: {},

    open: async (hostKey, size) => {
      const refuse = () => set((s) => ({ refused: { ...s.refused, [hostKey]: errText('terminal_disabled') } }));
      // Nothing is sent to a computer whose terminal is off, and no tab is
      // made for a shell that cannot open: the page says why instead.
      if (terminalOff(hostKey)) { refuse(); return null; }
      if (get().refused[hostKey]) {
        set((s) => { const refused = { ...s.refused }; delete refused[hostKey]; return { refused }; });
      }
      const { cols, rows } = size ?? lastSize;
      const id = `sh${++seq}`;
      const n = get().shells.filter((x) => x.hostKey === hostKey).length + 1;
      const shell: Shell = {
        id, hostKey, termId: null, state: 'opening', title: `shell ${n}`,
        cols, rows, error: null, code: null,
      };
      set((s) => ({ shells: [...s.shells, shell], active: { ...s.active, [hostKey]: id } }));
      try {
        const r = await call<{ term_id: string; shell?: string; cols?: number; rows?: number }>(
          hostKey, 'term.open', { cols, rows });
        if (!find(id)) {
          // Closed while it was opening: let the daemon know it is not wanted.
          call(hostKey, 'term.close', { term_id: r.term_id }).catch(() => {});
          return null;
        }
        const now = find(id)!;
        patch(id, {
          termId: r.term_id, state: 'live', title: `${shellName(r.shell)} ${n}`,
          cols: r.cols ?? cols, rows: r.rows ?? rows,
        });
        const k = `${hostKey}\0${r.term_id}`;
        const first = early.get(k);
        early.delete(k);
        if (first) emit(id, first);
        // The pane may have been fitted while the daemon was answering.
        if (now.cols !== (r.cols ?? cols) || now.rows !== (r.rows ?? rows)) {
          get().resize(id, now.cols, now.rows);
        }
        return find(id) ?? null;
      } catch (e: any) {
        if (e?.code === 'terminal_disabled') {
          offUnder.set(hostKey, useFleet.getState().hosts[hostKey]?.info);
          if (find(id)) get().close(id);
          refuse();
          return null;
        }
        patch(id, { state: 'failed', error: e?.message ?? 'The shell did not open' });
        return find(id) ?? null;
      }
    },

    write: (id, data) => {
      const sh = find(id);
      if (!sh?.termId || sh.state !== 'live' || !data) return;
      call(sh.hostKey, 'term.write', { term_id: sh.termId, data }).catch((e: any) => {
        if (e?.code === 'no_term') ended(sh.hostKey, sh.termId!, null);
      });
    },

    resize: (id, cols, rows) => {
      if (!(cols > 0 && rows > 0)) return;
      lastSize = { cols, rows };
      const sh = find(id);
      if (!sh || (sh.cols === cols && sh.rows === rows)) return;
      patch(id, { cols, rows });
      // Not yet open: `open` sends the size it finds once the daemon answers.
      if (!sh.termId || sh.state !== 'live') return;
      call(sh.hostKey, 'term.resize', { term_id: sh.termId, cols, rows }).catch(() => {});
    },

    close: (id) => {
      const sh = find(id);
      if (!sh) return;
      if (sh.termId && sh.state === 'live') {
        call(sh.hostKey, 'term.close', { term_id: sh.termId }).catch(() => {});
      }
      buffers.delete(id);
      sinks.delete(id);
      set((s) => {
        const shells = s.shells.filter((x) => x.id !== id);
        const active = { ...s.active };
        if (active[sh.hostKey] === id) {
          // The neighbour that slides into its place, else the one before it.
          const mine = s.shells.filter((x) => x.hostKey === sh.hostKey);
          const at = mine.findIndex((x) => x.id === id);
          const next = mine[at + 1] ?? mine[at - 1];
          if (next) active[sh.hostKey] = next.id; else delete active[sh.hostKey];
        }
        return { shells, active };
      });
    },

    select: (hostKey, id) => set((s) => ({ active: { ...s.active, [hostKey]: id } })),
  };
});

function ended(hostKey: string, termId: string, code: number | null) {
  const sh = useShells.getState().shells.find((x) => x.hostKey === hostKey && x.termId === termId);
  if (!sh || sh.state === 'ended') return;
  useShells.setState((s) => ({
    shells: s.shells.map((x) => (x.id === sh.id ? { ...x, state: 'ended', code } : x)),
  }));
  emit(sh.id, `\r\n\x1b[2m[shell ended${code != null ? ` with ${code}` : ''}]\x1b[0m\r\n`);
}

/** Where `term.output` and `term.exit` from every computer come in. Exported so
 *  a test can drive it without a socket; the panel reaches it through the
 *  fleet's tap below. */
export function onTermEvent(hostKey: string, ev: RacEvent): void {
  if (ev.event !== 'term.output' && ev.event !== 'term.exit') return;
  const d: any = ev.data ?? {};
  const termId = typeof d.term_id === 'string' ? d.term_id : null;
  if (!termId) return;
  if (ev.event === 'term.exit') {
    ended(hostKey, termId, typeof d.code === 'number' ? d.code : null);
    return;
  }
  const data = typeof d.data === 'string' ? d.data : '';
  const sh = useShells.getState().shells.find((x) => x.hostKey === hostKey && x.termId === termId);
  if (sh) { emit(sh.id, data); return; }
  // Most likely the prompt of a shell whose `term.open` answer is still on
  // its way. Bounded, so output for a term nobody here opened cannot pile up.
  const k = `${hostKey}\0${termId}`;
  const was = early.get(k) ?? '';
  if (was.length < SCROLLBACK) early.set(k, was + data);
}

onAnyEvent(onTermEvent);

/** A socket that dropped and came back is a new socket to the daemon, which
 *  keeps a detached shell running for five minutes: re-attach to what was
 *  open on that computer, and mark ended what did not survive. */
const seen: Record<string, string> = {};
useFleet.subscribe((s) => {
  for (const key of s.order) {
    const status = s.hosts[key]?.status ?? 'idle';
    const was = seen[key];
    seen[key] = status;
    if (status !== 'online' || was === undefined || was === 'online') continue;
    for (const sh of useShells.getState().shells) {
      if (sh.hostKey !== key || sh.state !== 'live' || !sh.termId) continue;
      const termId = sh.termId;
      call(key, 'term.attach', { term_id: termId }).catch((e: any) => {
        if (e?.code === 'no_term' || e?.code === 'terminal_disabled') ended(key, termId, null);
      });
    }
  }
});
