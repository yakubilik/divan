/** A real shell on the computer in front, for Machine › Terminal (`term.*`,
 *  docs/PROTOCOL.md *Terminal*).
 *
 *  The shell is drawn by xterm.js inside a WebView (`term-page.ts`); this is
 *  the half that knows nothing about drawing — the bytes between the socket and
 *  that page. The page says `ready` with the size it fitted to, and the shell
 *  is opened at that size; what the shell prints goes into the page; what is
 *  typed in it, and the key bar under it, goes out as `term.write`; the page
 *  refitting (the keyboard came up, the phone turned) is `term.resize`; and
 *  leaving the screen is `term.close`. The same rules as the panel's
 *  (`web/src/lib/term.ts`), for one shell rather than tabs of them.
 *
 *  Kept apart from React and the WebView so that a check can drive it against
 *  a fake client (`scripts/test-term.cjs`).
 */
import type { RacEvent } from './protocol';

/** What the bridge needs of the socket: `client` in `ws.ts` is one. */
export interface TermClient {
  call<T = any>(type: string, data?: Record<string, any>): Promise<T>;
  on(listener: (ev: RacEvent) => void): () => void;
  onStatus?(listener: (status: string) => void): () => void;
}

/** What the page sends: it has drawn and fitted, something was typed, it
 *  refitted, or the program in the shell switched how arrows are spelled. */
export type FromPage =
  | { t: 'ready'; cols: number; rows: number }
  | { t: 'data'; data: string }
  | { t: 'size'; cols: number; rows: number }
  | { t: 'mode'; appCursor: boolean };

/** What the page is told: draw this, start over, fit to your box, take or give
 *  up the keyboard. */
export type ToPage =
  | { t: 'out'; data: string }
  | { t: 'reset' }
  | { t: 'fit' }
  | { t: 'focus' }
  | { t: 'blur' };

export type TermState = 'idle' | 'opening' | 'live' | 'ended' | 'failed' | 'closed';

/** The keys the iOS keyboard does not have, in the order the bar shows them. */
export type BarKey = 'esc' | 'tab' | 'ctrl' | 'left' | 'up' | 'down' | 'right' | 'pipe' | 'tilde'
  | 'slash' | 'dash';

export const KEY_BAR: { key: BarKey; label: string; name: string }[] = [
  { key: 'esc', label: 'esc', name: 'Escape' },
  { key: 'tab', label: 'tab', name: 'Tab' },
  { key: 'ctrl', label: 'ctrl', name: 'Control' },
  { key: 'left', label: '←', name: 'Left arrow' },
  { key: 'up', label: '↑', name: 'Up arrow' },
  { key: 'down', label: '↓', name: 'Down arrow' },
  { key: 'right', label: '→', name: 'Right arrow' },
  { key: 'pipe', label: '|', name: 'Pipe' },
  { key: 'tilde', label: '~', name: 'Tilde' },
  { key: 'slash', label: '/', name: 'Slash' },
  { key: 'dash', label: '-', name: 'Dash' },
];

const ARROW: Record<string, string> = { up: 'A', down: 'B', right: 'C', left: 'D' };

/** What a bar key sends. Arrows are `ESC [ A` normally and `ESC O A` while a
 *  program (vim, less) has asked for application cursor keys. */
export function keySequence(key: BarKey, appCursor = false): string {
  switch (key) {
    case 'esc': return '\x1b';
    case 'tab': return '\t';
    case 'pipe': return '|';
    case 'tilde': return '~';
    case 'slash': return '/';
    case 'dash': return '-';
    case 'ctrl': return '';
    default: return `\x1b${appCursor ? 'O' : '['}${ARROW[key]}`;
  }
}

/** A character typed with Control held: a letter is its control code (^C is
 *  `\x03`), and the handful of symbols that have one map to it. Anything else
 *  is sent as it is. */
export function withCtrl(data: string): string {
  if (!data) return data;
  const ch = data[0];
  const code = ch.toUpperCase().charCodeAt(0);
  let out: string | null = null;
  if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64);   // @ A-Z [ \ ] ^ _
  else if (ch === ' ') out = '\x00';
  else if (ch === '?') out = '\x7f';
  return out === null ? data : out + data.slice(1);
}

/** How much of what the shell printed is kept, to redraw a page iOS threw
 *  away (a WebView's content process can be killed in the background). */
const SCROLLBACK = 256 * 1024;

let serials = 0;

export class TermBridge {
  /** Tells one bridge from the next: the page it draws on is keyed by it. */
  readonly serial = ++serials;
  state: TermState = 'idle';
  termId: string | null = null;
  error: string | null = null;
  code: number | null = null;
  /** The next character typed is sent with Control held. */
  ctrl = false;
  appCursor = false;
  cols = 0;
  rows = 0;
  private pageReady = false;
  private scroll = '';
  /** Output for a term whose `term.open` answer has not arrived yet: the
   *  daemon may print the prompt before the reply reaches the phone. */
  private early = new Map<string, string>();
  private off: (() => void)[] = [];
  private status: string | null = null;

  constructor(private client: TermClient, private post: (m: ToPage) => void,
              private changed: () => void = () => {}) {
    this.off.push(client.on((ev) => this.onEvent(ev)));
    if (client.onStatus) {
      this.off.push(client.onStatus((s) => this.onStatus(s)));
    }
  }

  private set(p: Partial<TermBridge>) {
    Object.assign(this, p);
    this.changed();
  }

  /** Read through a method: inside `open` the compiler would otherwise
   *  keep believing the state it checked before the await. */
  private gone(): boolean { return this.state === 'closed'; }

  private send(m: ToPage) {
    if (this.pageReady && this.state !== 'closed') this.post(m);
  }

  /** A message from the page, as the WebView handed it over. */
  fromPage(raw: string | FromPage): void {
    let m: FromPage;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ready': {
        const again = this.pageReady;
        this.pageReady = true;
        if (again || this.scroll) {
          // A page drawn anew over a shell that kept running: give it back
          // what it had.
          this.post({ t: 'reset' });
          if (this.scroll) this.post({ t: 'out', data: this.scroll });
        }
        if (this.state === 'idle') void this.open(m.cols, m.rows);
        else this.resize(m.cols, m.rows);
        return;
      }
      case 'data': this.type(m.data); return;
      case 'size': this.resize(m.cols, m.rows); return;
      case 'mode': this.appCursor = !!m.appCursor; return;
    }
  }

  /** `term.open` at the page's size. Only from `idle`: a shell is opened once. */
  async open(cols: number, rows: number): Promise<void> {
    if (this.state !== 'idle') return;
    const c = cols > 0 ? Math.floor(cols) : 80;
    const r = rows > 0 ? Math.floor(rows) : 24;
    this.set({ state: 'opening', cols: c, rows: r, error: null, code: null });
    try {
      const res = await this.client.call<{ term_id: string; cols?: number; rows?: number }>(
        'term.open', { cols: c, rows: r });
      if (this.gone()) {
        // Left while it was opening: let the daemon know it is not wanted.
        this.client.call('term.close', { term_id: res.term_id }).catch(() => {});
        return;
      }
      const opened = { cols: res.cols ?? c, rows: res.rows ?? r };
      this.set({ termId: res.term_id, state: 'live' });
      const first = this.early.get(res.term_id);
      this.early.clear();
      if (first) this.output(first);
      // The page may have refitted while the daemon was answering.
      if (opened.cols !== this.cols || opened.rows !== this.rows) {
        this.client.call('term.resize', { term_id: res.term_id, cols: this.cols, rows: this.rows }).catch(() => {});
      }
    } catch (e: any) {
      if (this.gone()) return;
      this.set({ state: 'failed', error: e?.message || 'The shell did not open' });
    }
  }

  /** Another shell after this one ended or failed to open. */
  restart(): void {
    if (this.state !== 'ended' && this.state !== 'failed') return;
    this.scroll = '';
    this.early.clear();
    this.set({ state: 'idle', termId: null, error: null, code: null, appCursor: false });
    this.send({ t: 'reset' });
    void this.open(this.cols, this.rows);
  }

  /** What was typed in the page. A latched Control applies to its first key. */
  type(data: string): void {
    if (!data) return;
    if (this.ctrl) {
      data = withCtrl(data);
      this.set({ ctrl: false });
    }
    this.write(data);
  }

  /** A key on the bar. Control latches for the next key typed. */
  key(key: BarKey): void {
    if (key === 'ctrl') { this.set({ ctrl: !this.ctrl }); return; }
    if (this.ctrl) this.set({ ctrl: false });
    this.write(keySequence(key, this.appCursor));
  }

  write(data: string): void {
    const id = this.termId;
    if (!id || this.state !== 'live' || !data) return;
    this.client.call('term.write', { term_id: id, data }).catch((e: any) => {
      if (e?.code === 'no_term') this.ended(id, null);
    });
  }

  resize(cols: number, rows: number): void {
    if (!(cols > 0 && rows > 0)) return;
    if (cols === this.cols && rows === this.rows) return;
    this.set({ cols, rows });
    // Not open yet: `open` sends the size it finds once the daemon answers.
    if (!this.termId || this.state !== 'live') return;
    this.client.call('term.resize', { term_id: this.termId, cols, rows }).catch(() => {});
  }

  /** Ask the page to measure its box again: the keyboard moved, the phone
   *  turned. If the grid changed it answers with `size`. */
  fit(): void { this.send({ t: 'fit' }); }
  focus(): void { this.send({ t: 'focus' }); }
  blur(): void { this.send({ t: 'blur' }); }

  /** Leaving the screen: the shell is let go of, and nothing more is heard. */
  close(): void {
    if (this.state === 'closed') return;
    const id = this.termId;
    const live = this.state === 'live';
    this.state = 'closed';
    for (const f of this.off.splice(0)) f();
    if (id && live) this.client.call('term.close', { term_id: id }).catch(() => {});
    this.changed();
  }

  private output(data: string) {
    if (!data) return;
    const next = this.scroll + data;
    this.scroll = next.length > SCROLLBACK ? next.slice(next.length - SCROLLBACK) : next;
    this.send({ t: 'out', data });
  }

  private ended(id: string, code: number | null) {
    if (id !== this.termId || this.state !== 'live') return;
    this.set({ state: 'ended', code });
    this.output(`\r\n\x1b[2m[shell ended${code != null ? ` with ${code}` : ''}]\x1b[0m\r\n`);
  }

  private onEvent(ev: RacEvent) {
    if (ev.event !== 'term.output' && ev.event !== 'term.exit') return;
    const d: any = ev.data ?? {};
    const id = typeof d.term_id === 'string' ? d.term_id : null;
    if (!id) return;
    if (ev.event === 'term.exit') { this.ended(id, typeof d.code === 'number' ? d.code : null); return; }
    const data = typeof d.data === 'string' ? d.data : '';
    if (id === this.termId) { if (this.state === 'live') this.output(data); return; }
    if (this.state !== 'opening') return;
    const was = this.early.get(id) ?? '';
    if (was.length < SCROLLBACK) this.early.set(id, was + data);
  }

  /** A socket that dropped and came back is a new socket to the daemon, which
   *  keeps a detached shell for five minutes: attach to it again. */
  private onStatus(s: string) {
    const was = this.status;
    this.status = s;
    if (s !== 'online' || was === null || was === 'online') return;
    const id = this.termId;
    if (!id || this.state !== 'live') return;
    this.client.call('term.attach', { term_id: id }).catch((e: any) => {
      if (e?.code === 'no_term') this.ended(id, null);
    });
  }
}
