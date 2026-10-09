import type { RacEvent } from './protocol';
import { errText, t } from './i18n';

/** Whether this computer's address is the address of the page we are on, over
 *  HTTPS — which is to say: reached through a tunnel rather than the tailnet.
 *
 *  Everything below spoke plain `ws://` and plain `http://`. On a tailnet that
 *  is right: WireGuard has already encrypted the hop, and there is no
 *  certificate for a `100.x` address to present anyway. Off it, it is not
 *  merely weak but impossible — a page served over HTTPS may not open an
 *  insecure socket, and the browser refuses it before the daemon hears
 *  anything.
 *
 *  A panel reached through a tunnel is served over HTTPS, by the hostname the
 *  tunnel answers on, and talks to the computer behind that same hostname. So
 *  the one case that has to be secure is exactly the case where the computer's
 *  address is the page's own — which is what this asks. A second computer on
 *  the tailnet stays `ws://` and stays unreachable from such a page; that is
 *  the tunnel's shape, not something a scheme can fix.
 *
 *  The phone has no `location` at all, so nothing there changes. */
function overTunnel(host: string): boolean {
  return typeof location !== 'undefined'
    && location.protocol === 'https:'
    && host === location.hostname;
}

/** The socket's address, secure when it has to be. */
export function wsUrl(host: string, port: number, token: string): string {
  const scheme = overTunnel(host) ? 'wss' : 'ws';
  return `${scheme}://${host}:${port}/ws?token=${encodeURIComponent(token)}`;
}

/** Where `/upload`, `/files` and `/screen.jpg` live, by the same rule. */
export function httpBase(host: string, port: number): string {
  return `${overTunnel(host) ? 'https' : 'http'}://${host}:${port}`;
}


type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** The daemon speaks one language (English) and tags every error with a code;
 *  it is translated here so no screen has to think about it. The code rides
 *  along on the Error: a screen that can do something better than an alert —
 *  ask for the name again, say — has to know which error it caught. */
function rpcError(data: any): Error & { code?: string | null } {
  const e: Error & { code?: string | null } = new Error(errText(data?.code, data?.message));
  e.code = data?.code ?? null;
  return e;
}

/** "The computer is not reachable right now" — as opposed to a real refusal
 *  from the daemon. Screens that were only going to say so themselves can check
 *  the code and stay quiet instead of raising an alert about it. */
function connError(key: 'wsNotConnected' | 'wsDropped' | 'wsTimeout'): Error & { code?: string | null } {
  const e: Error & { code?: string | null } = new Error(t(key));
  e.code = 'offline';
  return e;
}

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'unauthorized';

/** Why the last socket went away, told to the daemon in the next `hello` so its
 *  log can say which side gave up. `heartbeat`: pings went unanswered; `socket`:
 *  the OS closed it (a network change lands here, as a 1006); `foreground`: the
 *  app came back and found it dead or gone; `restart`: the daemon said it was
 *  restarting. */
export type ReconnectReason = 'heartbeat' | 'socket' | 'foreground' | 'restart';
export type Reconnect = { reason: ReconnectReason; code: number | null; offline_s: number };

/** How often to prove the socket is still there, and how long to wait for the
 *  proof. Short enough that a dead connection is noticed within a turn, long
 *  enough to ride out a burst of streamed text on a slow phone. */
const HEARTBEAT_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 10000;
/** Unanswered pings in a row before the socket is buried. One was too few: a
 *  Mac at load 40 stalls every process on it for three to eight seconds at a
 *  time — a server doing nothing at all stalls as long as the daemon does — so
 *  a single late answer is a busy computer, not a dead socket. Anything that
 *  arrives on the socket in between counts as an answer. */
const HEARTBEAT_MISSES = 2;
/** How long a foreground check waits. Coming back is when the socket is most
 *  likely gone and a person is looking at the screen; ten seconds of "online"
 *  that is not is the worst of both. */
const FOREGROUND_PROBE_MS = 2000;
/** What a timed-out ping waits before it is believed. A timer can run before
 *  frames that already arrived are handed over — a JS thread busy rendering a
 *  long chat for seconds, or an app just woken whose expired timers fire
 *  first — and on 2026-10-09 the daemon saw the old socket's close frame 9 to
 *  130 ms before the new socket: the phone was burying sockets that worked. */
const HEARTBEAT_GRACE_MS = 250;
/** A reconnect the app starts itself and finishes within this is not shown:
 *  no "reconnecting" for a blink nobody would have noticed. */
const QUIET_RECONNECT_MS = 1000;

/** How long a request is given to be answered when nobody said otherwise. Long,
 *  because it covers a computer that is busy rather than one that is gone: a
 *  turn's worth of work can sit in front of an answer. */
const DEFAULT_TIMEOUT_MS = 30000;
// Bound the handshake too: iOS may leave a dead dial in CONNECTING.
const CONNECT_TIMEOUT_MS = 10000;

export class RacClient {
  private ws: WebSocket | null = null;
  private rid = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(ev: RacEvent) => void>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private url = '';
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private hb: ReturnType<typeof setInterval> | null = null;
  private beating = false;
  private missed = 0;
  /** When anything last arrived on the socket: proof it is alive. */
  private lastRx = 0;
  /** Until when 'offline'/'connecting' are kept from the listeners. */
  private hushUntil = 0;
  private hushTimer: ReturnType<typeof setTimeout> | null = null;
  private lost: { reason: ReconnectReason; code: number | null; at: number } | null = null;
  status: ConnStatus = 'idle';

  connect(host: string, port: number, token: string) {
    const url = wsUrl(host, port, token);
    // Same target and a live socket → nothing to do (init() can run twice under Fast Refresh).
    if (this.wanted && this.url === url && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.url = url;
    this.wanted = true;
    this.retry = 0;
    this.lost = null;
    if (this.timer) clearTimeout(this.timer);
    this.closeSocket();
    this.open();
  }

  private closeSocket() {
    const old = this.ws;
    this.clearConnectTimer();
    this.ws = null;
    this.stopHeartbeat();
    if (old) { try { old.onopen = null; old.onerror = null; old.onclose = null; old.onmessage = null; old.close(); } catch {} }
  }

  disconnect() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.closeSocket();
    this.setStatus('idle');
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private open() {
    if (!this.wanted) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.setStatus('offline');
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.CONNECTING) return;
      console.warn('ws: connection handshake timed out; retrying');
      this.markLost('socket', null);
      this.closeSocket();
      this.setStatus('offline');
      this.scheduleRetry();
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.clearConnectTimer();
      this.retry = 0; this.missed = 0; this.lastRx = 0;
      this.setStatus('online'); this.startHeartbeat();
    };
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now(); this.missed = 0; this.handle(String(m.data));
    };
    // Native errors can contain the credential-bearing URL. Keep diagnostics
    // free of that payload; the close event records the numeric code.
    ws.onerror = () => { if (this.ws === ws) console.warn('ws: native socket error'); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.clearConnectTimer();
      this.ws = null;
      this.stopHeartbeat();
      for (const p of this.pending.values()) p.reject(connError('wsDropped'));
      this.pending.clear();
      if (e.code === 4401 || e.code === 1008) { this.setStatus('unauthorized'); this.wanted = false; return; }
      this.markLost('socket', e.code ?? null);
      this.setStatus('offline');
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.wanted) return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.retry++, 4));
    this.timer = setTimeout(() => this.open(), delay);
  }

  /** A socket can die without the phone being told: the daemon restarted, the
   *  Wi-Fi handed over, the laptop slept, a NAT dropped an idle flow. iOS goes
   *  on reporting readyState OPEN, so events simply stop arriving and nothing
   *  reconnects — until the next thing the user does times out and the whole
   *  backlog lands at once, which is exactly what a long agent turn looks like
   *  when it "freezes". A round trip we control is the only way to tell a quiet
   *  connection from a dead one. */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.hb = setInterval(() => { void this.beat(); }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
  }

  /** One ping. The interval's beat forgives a miss; a foreground check does
   *  not, and waits only FOREGROUND_PROBE_MS, because coming back is when a
   *  socket is most likely dead and a person is looking at the screen. Either
   *  way a socket that delivered anything since the ping went out is alive. */
  private async beat(reason: ReconnectReason = 'heartbeat'): Promise<boolean> {
    if (this.beating) return true;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    this.beating = true;
    const sent = Date.now();
    try {
      await this.request('ping', {}, reason === 'heartbeat' ? HEARTBEAT_TIMEOUT_MS : FOREGROUND_PROBE_MS);
      this.missed = 0;
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, HEARTBEAT_GRACE_MS));
      if (this.ws !== ws) return false;
      if (this.lastRx >= sent) { this.missed = 0; return true; }
      // Same socket, and nothing at all came back: it is gone whatever iOS
      // says — once it has failed to answer often enough.
      if (reason !== 'heartbeat' || ++this.missed >= HEARTBEAT_MISSES) this.dropDead(reason);
      return false;
    } finally {
      this.beating = false;
    }
  }

  /** Note why the connection went, keeping when it first went. */
  private markLost(reason: ReconnectReason, code: number | null) {
    if (this.lost && reason !== 'restart') return;
    this.lost = { reason, code: code ?? this.lost?.code ?? null, at: this.lost?.at ?? Date.now() };
  }

  /** Why the last connection was lost, once: `hello` carries it to the daemon. */
  takeReconnect(): Reconnect | null {
    const l = this.lost;
    this.lost = null;
    return l && { reason: l.reason, code: l.code, offline_s: Math.round((Date.now() - l.at) / 100) / 10 };
  }

  /** Bury a socket the OS still believes in, and start reconnecting now. */
  private dropDead(reason: ReconnectReason) {
    console.warn(`ws: no answer to heartbeat (${reason}), reconnecting`);
    this.markLost(reason, null);
    this.closeSocket();
    for (const p of this.pending.values()) p.reject(connError('wsDropped'));
    this.pending.clear();
    this.hushUntil = Date.now() + QUIET_RECONNECT_MS;
    this.setStatus('offline');
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    this.open();
  }

  /** Force an immediate reconnect attempt (e.g. app came to foreground). The
   *  reason is what the daemon is told if this is what brought the socket back;
   *  a request waiting on a reconnect passes none, it only hurries one along. */
  poke(reason: 'foreground' | 'restart' | null = 'foreground') {
    if (!this.wanted || this.status === 'connecting') return;
    // Coming back from the background is precisely when "online" is most likely
    // to be a stale belief, so check it instead of trusting it.
    if (this.status === 'online') { if (reason) void this.beat(reason); return; }
    if (reason) this.markLost(reason, null);
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    this.open();
  }

  private handle(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if ((m.type === 'ok' || m.type === 'error') && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      if (m.type === 'ok') p.resolve(m.data);
      else p.reject(rpcError(m.data));
      return;
    }
    if (m.type === 'event') {
      const ev: RacEvent = { event: m.event, chat_id: m.chat_id, seq: m.seq, data: m.data, ts: m.ts };
      for (const l of this.listeners) l(ev);
    }
  }

  /** Resolve once the socket is usable. A call made in the seconds around a
   *  reconnect — the app just came back to the foreground, the phone changed
   *  network — is not a failure, it is early. Waiting out the reconnect is the
   *  difference between a working tap and a "not connected" alert about a
   *  computer that is right there. */
  private ready(ms = 6000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!this.wanted) return Promise.reject(connError('wsNotConnected'));
    this.poke(null);
    return new Promise<void>((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); off(); fn(); };
      const timer = setTimeout(() => done(() => reject(connError('wsNotConnected'))), ms);
      const off = this.onStatus((s) => {
        if (s === 'online') done(resolve);
        else if (s === 'unauthorized' || s === 'idle') done(() => reject(connError('wsNotConnected')));
      });
    });
  }

  /** A request, on a connection this will wait out a reconnect for.
   *
   *  `timeoutMs` is how long the daemon is given to answer. The default is
   *  generous because most requests are a person waiting for something they
   *  asked for; a poll that nobody is watching wants a short one, so that a
   *  computer with the lid shut costs seconds rather than half a minute. */
  async call<T = any>(type: string, data: Record<string, any> = {}, timeoutMs?: number): Promise<T> {
    await this.ready();
    return this.request<T>(type, data, timeoutMs);
  }

  /** One request on the socket as it stands — no waiting for a reconnect. The
   *  heartbeat needs this: asking ready() to heal the connection first would
   *  defeat the point of asking whether it is healthy. */
  private request<T = any>(type: string, data: Record<string, any> = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(connError('wsNotConnected'));
    const id = ++this.rid;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id, type, data }));
      } catch {
        this.pending.delete(id);
        reject(connError('wsNotConnected'));
        return;
      }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(connError('wsTimeout')); }
      }, timeoutMs);
    });
  }

  /** A message with no id, which the daemon answers only if it fails (`voice.audio` and the other
   *  fire-and-forget voice messages). Dropped when the socket is not open: audio is only worth its moment. */
  tell(type: string, data: Record<string, any> = {}): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify({ type, data })); return true; } catch { return false; }
  }

  on(l: (ev: RacEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onStatus(l: (s: ConnStatus) => void) { this.statusListeners.add(l); return () => { this.statusListeners.delete(l); }; }

  /** Listeners hear every state but the in-between ones of a reconnect still
   *  inside its quiet window; if that runs out, they hear where it got to. */
  private setStatus(s: ConnStatus) {
    this.status = s;
    if (this.hushTimer) { clearTimeout(this.hushTimer); this.hushTimer = null; }
    const wait = this.hushUntil - Date.now();
    if ((s === 'offline' || s === 'connecting') && wait > 0) {
      this.hushTimer = setTimeout(() => { this.hushTimer = null; this.hushUntil = 0; this.announce(this.status); }, wait);
      return;
    }
    this.hushUntil = 0;
    this.announce(s);
  }

  private announce(s: ConnStatus) {
    for (const l of this.statusListeners) l(s);
  }
}

export const client = new RacClient();

/** One request to a computer other than the connected one, on its own socket.
 *  Used to read a sign-in off a second machine without dropping the live
 *  connection. The socket is closed as soon as the reply lands. */
export function callOnce<T = any>(host: string, port: number, token: string,
                                  type: string, data: Record<string, any> = {},
                                  timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(host, port, token));
    } catch {
      reject(connError('wsNotConnected'));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { ws.onclose = null; ws.onmessage = null; ws.close(); } catch {}
      clearTimeout(timer);
      fn();
    };
    // The whole round trip, not just the answer: a computer that is asleep
    // never finishes the handshake, so a timeout on the reply alone would wait
    // for ever on the one case this exists to survive.
    const timer = setTimeout(() => finish(() => reject(connError('wsTimeout'))), timeoutMs);
    ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, type, data })); } catch {} };
    ws.onerror = () => {};
    ws.onclose = (e: any) => finish(() => reject(
      e?.code === 4401 ? new Error(t('copyUnauthorized')) : connError('wsNotConnected')));
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.id !== 1) return;                         // host.status arrives first
      if (msg.type === 'ok') finish(() => resolve(msg.data as T));
      else if (msg.type === 'error') finish(() => reject(rpcError(msg.data)));
    };
  });
}
