import type { RacEvent } from './protocol';
import { errText, t } from './i18n';
import { parseRefusal, refuse, refusedFor, refusalText, type Refusal } from './refusal';

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
export function overTunnel(host: string): boolean {
  return typeof location !== 'undefined'
    && location.protocol === 'https:'
    && host === location.hostname;
}

/** Whether this page may open a socket to that address at all: anything from
 *  a page that is not HTTPS, and from one that is, only its own origin. A
 *  computer this says no to is reached through the gateway (`via`) instead. */
export function dialable(host: string): boolean {
  return typeof location === 'undefined' || location.protocol !== 'https:' || overTunnel(host);
}

/** Where a peer reached through the gateway lives on the gateway's origin. */
function peerPath(via?: string): string {
  return via ? `/peer/${encodeURIComponent(via)}` : '';
}

/** The socket's address, secure when it has to be. With `via`, the socket of
 *  a peer in that computer's machine directory, relayed by it — the second
 *  computer the paragraph above could not reach, reached on the page's own
 *  origin instead. */
export function wsUrl(host: string, port: number, token: string, via?: string): string {
  const scheme = overTunnel(host) ? 'wss' : 'ws';
  return `${scheme}://${host}:${port}${peerPath(via)}/ws?token=${encodeURIComponent(token)}`;
}

/** Where `/upload`, `/files` and `/screen.jpg` live, by the same rule. */
export function httpBase(host: string, port: number, via?: string): string {
  return `${overTunnel(host) ? 'https' : 'http'}://${host}:${port}${peerPath(via)}`;
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

/** A call that cannot be made because the computer refused this token: the
 *  message is the refusal's own sentence, so a screen that shows the error
 *  says why rather than "connection lost". */
function refusedError(r: Refusal): Error & { code?: string | null } {
  const e: Error & { code?: string | null } = new Error(refusalText(r).long);
  e.code = 'unauthorized';
  return e;
}

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'unauthorized';

/** How often to prove the socket is still there, and how long to wait for the
 *  proof. Short enough that a dead connection is noticed within a turn, long
 *  enough to ride out a burst of streamed text. */
const HEARTBEAT_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 10000;
/** Unanswered pings in a row before the socket is buried. One was too few: on
 *  a path losing 2-6 % of its packets with 85-300 ms round trips, a single
 *  late answer is a slow link (or a busy computer), not a dead socket — and
 *  burying on it had the panel closing and redialling a socket that worked
 *  every couple of minutes for as long as the link stayed poor. Anything that
 *  arrives on the socket in between counts as an answer. Same rule as the
 *  phone's client (app/src/ws.ts). */
const HEARTBEAT_MISSES = 2;
/** What a timed-out ping waits before it is believed. A timer can run before
 *  frames that already arrived are handed over — a tab busy rendering a long
 *  chat, or one just woken whose expired timers fire first — and the socket
 *  buried on it was one that worked. */
const HEARTBEAT_GRACE_MS = 250;
/** How long a foreground check waits. Coming back to the tab is when the
 *  socket is most likely gone and a person is looking at the screen; ten
 *  seconds of "online" that is not is the worst of both. */
const FOREGROUND_PROBE_MS = 2000;
/** How long to wait before dialling again, attempt by attempt. Short at first,
 *  because a dial is a SYN, not a cost, and most losses are over in a second:
 *  it was 1, 2, 4, 8, 15 s, and after a daemon restart the panel took 23-24 s
 *  to come back where the phone takes under one. Then it slows to what it
 *  was, because unlike the phone the panel dials from a tab nobody is looking
 *  at: a computer that is switched off is asked every fifteen seconds, not
 *  every two for ever. Coming back to the tab starts from the top (`poke`). */
const RETRY_MS = [250, 500, 1000, 2000, 4000, 8000, 15000];
/** The handshake's limit. A dial on a path that comes back is answered within
 *  a second or two; one still waiting after five is in TCP's long backoff —
 *  the browser will sit in CONNECTING for a minute or more — and a fresh dial
 *  is quicker than waiting it out. */
const CONNECT_TIMEOUT_MS = 5000;

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
  /** Heartbeat pings in a row that nothing answered. */
  private missed = 0;
  /** When anything last arrived on the socket: proof it is alive. */
  private lastRx = 0;
  /** One foreground probe at a time; a second caller waits on the first. */
  private probing: Promise<boolean> | null = null;
  private token = '';
  status: ConnStatus = 'idle';
  /** Why the computer said no, once it has. See lib/refusal.ts. */
  refusal: Refusal | null = null;

  connect(host: string, port: number, token: string, via?: string) {
    const url = wsUrl(host, port, token, via);
    // Same target and a live socket → nothing to do (init() can run twice under Fast Refresh).
    if (this.wanted && this.url === url && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.url = url;
    this.token = token;
    this.retry = 0;
    if (this.timer) clearTimeout(this.timer);
    this.closeSocket();
    // A token this tab has already been refused with is not offered again:
    // the answer will not change, and through the tunnel asking again is what
    // counts towards a lock.
    const known = refusedFor(token);
    if (known) { this.refused(known); return; }
    this.refusal = null;
    this.wanted = true;
    this.open();
  }

  private refused(r: Refusal) {
    this.wanted = false;
    this.refusal = r;
    refuse(this.token, r);
    this.setStatus('unauthorized');
  }

  private closeSocket() {
    const old = this.ws;
    this.clearConnectTimer();
    this.ws = null;
    this.stopHeartbeat();
    if (old) { try { old.onopen = null; old.onerror = null; old.onclose = null; old.onmessage = null; old.close(); } catch {} }
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  disconnect() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.closeSocket();
    this.setStatus('idle');
  }

  private open() {
    if (!this.wanted) return;
    // Refused over HTTP since the last socket — /upload, say — is refused here too.
    const known = refusedFor(this.token);
    if (known) { this.refused(known); return; }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    // Bound the handshake: without this a dial into a path that drops the SYN
    // stays in CONNECTING until the browser gives up, and nothing — not the
    // retry ladder, not poke() — dials again while it does.
    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.CONNECTING) return;
      console.warn('ws: connection handshake timed out; retrying');
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
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.clearConnectTimer();
      this.ws = null;
      this.stopHeartbeat();
      const refusal = e.code === 4401 || e.code === 1008 ? parseRefusal(e.code, e.reason) : null;
      for (const p of this.pending.values()) p.reject(refusal ? refusedError(refusal) : connError('wsDropped'));
      this.pending.clear();
      if (refusal) { this.refused(refusal); return; }
      this.setStatus('offline');
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.wanted) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
    this.timer = setTimeout(() => this.open(), delay);
  }

  /** A socket can die without the browser being told: the daemon restarted, the
   *  laptop slept, the Wi-Fi handed over, a NAT dropped an idle flow. The tab
   *  goes on reporting readyState OPEN, so events simply stop arriving and
   *  nothing reconnects — the turn on screen looks like it stopped halfway,
   *  and the only way to find out it did not is to send something and watch it
   *  time out. A round trip we control is the only way to tell a quiet
   *  connection from a dead one. */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.hb = setInterval(() => { void this.beat(); }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
  }

  /** The interval's ping, which forgives a miss. */
  private async beat(): Promise<boolean> {
    if (this.beating) return true;
    this.beating = true;
    try {
      return await this.ask('heartbeat', HEARTBEAT_TIMEOUT_MS);
    } finally {
      this.beating = false;
    }
  }

  /** A ping that does not forgive: the tab came back to the front. It waits
   *  only FOREGROUND_PROBE_MS, because a person is looking at the screen. Its
   *  own ping, even with the interval's still out: that one may have ten
   *  seconds left to run. */
  private probe(): Promise<boolean> {
    if (!this.probing) {
      this.probing = this.ask('foreground', FOREGROUND_PROBE_MS).finally(() => { this.probing = null; });
    }
    return this.probing;
  }

  /** One ping. A socket that delivered anything since it went out is alive. */
  private async ask(why: 'heartbeat' | 'foreground', ms: number): Promise<boolean> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const sent = Date.now();
    try {
      await this.request('ping', {}, ms);
      this.missed = 0;
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, HEARTBEAT_GRACE_MS));
      if (this.ws !== ws) return false;
      if (this.lastRx >= sent) { this.missed = 0; return true; }
      // Same socket, and nothing at all came back: it is gone whatever the tab
      // says — once it has failed to answer often enough.
      if (why !== 'heartbeat' || ++this.missed >= HEARTBEAT_MISSES) this.dropDead(why);
      return false;
    }
  }

  /** Bury a socket the browser still believes in, and start reconnecting now. */
  private dropDead(why: 'heartbeat' | 'foreground') {
    console.warn(`ws: socket not answering (${why}), reconnecting`);
    this.closeSocket();
    for (const p of this.pending.values()) p.reject(connError('wsDropped'));
    this.pending.clear();
    this.setStatus('offline');
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    this.open();
  }

  /** Force an immediate reconnect attempt (e.g. the tab came back to the front).
   *  A dial already under way is left alone: it has CONNECT_TIMEOUT_MS to
   *  finish and is replaced when that runs out. */
  poke() {
    if (!this.wanted || this.status === 'connecting') return;
    // A tab coming back from the background is precisely when "online" is most
    // likely to be a stale belief, so check it instead of trusting it. Asked,
    // never assumed: the phone buries a socket that has been silent past a
    // heartbeat without asking, because iOS takes a suspended app's sockets
    // away. A browser does not — it only slows a hidden tab's timers, so a
    // quiet socket there is usually a working one whose pings were late, and
    // replacing it is a reconnect and a full refresh for nothing. One that
    // did die with a sleeping laptop costs the probe's two seconds.
    if (this.status === 'online') { void this.probe(); return; }
    this.redial();
  }

  /** Dial now instead of at the retry ladder's next step. */
  private redial() {
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
    if (this.refusal) return Promise.reject(refusedError(this.refusal));
    if (!this.wanted) return Promise.reject(connError('wsNotConnected'));
    // Hurry a reconnect along; a socket that still counts as online (closing,
    // say) is not probed for this — its close will bring the next one.
    if (this.status !== 'online' && this.status !== 'connecting') this.redial();
    return new Promise<void>((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); off(); fn(); };
      const timer = setTimeout(() => done(() => reject(connError('wsNotConnected'))), ms);
      const off = this.onStatus((s) => {
        if (s === 'online') done(resolve);
        else if (s === 'unauthorized' && this.refusal) done(() => reject(refusedError(this.refusal!)));
        else if (s === 'unauthorized' || s === 'idle') done(() => reject(connError('wsNotConnected')));
      });
    });
  }

  async call<T = any>(type: string, data: Record<string, any> = {}): Promise<T> {
    await this.ready();
    return this.request<T>(type, data);
  }

  /** One request on the socket as it stands — no waiting for a reconnect. The
   *  heartbeat needs this: asking ready() to heal the connection first would
   *  defeat the point of asking whether it is healthy. */
  private request<T = any>(type: string, data: Record<string, any> = {}, timeoutMs = 30000): Promise<T> {
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

  on(l: (ev: RacEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onStatus(l: (s: ConnStatus) => void) { this.statusListeners.add(l); return () => { this.statusListeners.delete(l); }; }

  private setStatus(s: ConnStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}

export const client = new RacClient();

/** One request to a computer other than the connected one, on its own socket.
 *  Used to read a sign-in off a second machine without dropping the live
 *  connection. The socket is closed as soon as the reply lands. */
export function callOnce<T = any>(host: string, port: number, token: string,
                                  type: string, data: Record<string, any> = {}): Promise<T> {
  const known = refusedFor(token);
  if (known) return Promise.reject(refusedError(known));
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
    const timer = setTimeout(() => finish(() => reject(connError('wsTimeout'))), 30000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, type, data })); } catch {} };
    ws.onerror = () => {};
    ws.onclose = (e: any) => finish(() => {
      if (e?.code !== 4401) { reject(connError('wsNotConnected')); return; }
      const why = parseRefusal(e.code, e.reason);
      refuse(token, why);
      reject(new Error(why.kind === 'unauthorized' ? t('copyUnauthorized') : refusalText(why).long));
    });
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (msg.id !== 1) return;                         // host.status arrives first
      if (msg.type === 'ok') finish(() => resolve(msg.data as T));
      else if (msg.type === 'error') finish(() => reject(rpcError(msg.data)));
    };
  });
}
