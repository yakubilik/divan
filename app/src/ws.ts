import type { RacEvent } from './protocol';
import { errText, t } from './i18n';
import { sha256Hex } from './sha256';

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
 *  restarting; `probe`: something was asked of a socket that had gone quiet,
 *  and the ping sent first went unanswered. */
export type ReconnectReason = 'heartbeat' | 'socket' | 'foreground' | 'restart' | 'probe';
/** `offline_s` runs from when the app noticed the loss; `silent_s` from the last
 *  thing the old socket delivered. They differ by however long iOS kept the app
 *  asleep: on 2026-10-13..16 every `socket code=1006 offline<1s` the daemon
 *  logged came after it had seen that socket go 9 s to 3 h earlier — the app
 *  only heard of it when it woke. */
export type Reconnect = { reason: ReconnectReason; code: number | null; offline_s: number; silent_s?: number;
                          via?: Door; dials?: number; fails?: DialFail[] };
/** Which address a socket was opened on: the computer's local-network one, or
 *  the tailnet one it was paired on. */
export type Door = 'lan' | 'tailnet';
/** How a dial failed, for the daemon's log. `timeout`: nothing answered (a
 *  dial that never reached the computer); `error`: refused or no route;
 *  `proof`: something answered on the LAN address but it was not this
 *  computer, or could not say so. Prefixed `lan-` for the LAN door. */
export type DialFail = 'timeout' | 'error' | 'lan-timeout' | 'lan-error' | 'lan-proof';

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
/** A socket that has delivered nothing for this long, in the foreground, is not
 *  to be trusted without asking: a working one answers a ping every
 *  HEARTBEAT_MS. Past it the app was asleep (iOS stops its timers along with
 *  everything else) or the pings are going unanswered. */
const STALE_MS = HEARTBEAT_MS + 2000;
/** A lost connection that is back within this is never shown: no
 *  "Reconnecting…" for a recovery nobody would have noticed. Every way an
 *  online socket can go counts, the OS closing it included — that is what a
 *  return from the background usually is. */
const QUIET_RECONNECT_MS = 3000;
/** How long to wait before dialling again, attempt by attempt. Short, because
 *  the app only dials in the foreground, where a person is waiting; a dial is a
 *  SYN, not a cost. It was 1, 2, 4, 8, 15 s on top of a ten-second handshake
 *  limit, and on 2026-10-16 every heartbeat loss the daemon logged came back
 *  with `offline=80.1s` (09:42:48, 09:45:49): 10+1+10+2+10+4+10+8+10+15 = 80,
 *  five dials that never completed and the sixth waited out the fifteen-second
 *  step — 8.7 s after the old socket's last bytes had already reached the Mac
 *  (09:42:40), so the way back had been open all that time. */
const RETRY_MS = [250, 500, 1000, 2000];

/** How long a request is given to be answered when nobody said otherwise. Long,
 *  because it covers a computer that is busy rather than one that is gone: a
 *  turn's worth of work can sit in front of an answer. */
const DEFAULT_TIMEOUT_MS = 30000;
// Bound the handshake too: iOS may leave a dead dial in CONNECTING. A dial on a
// path that comes back is answered within a second or two (the SYN is resent
// at once); one still waiting after five seconds is in TCP's long backoff, and a
// fresh dial is quicker than waiting it out.
const CONNECT_TIMEOUT_MS = 5000;
/** The LAN door is tried first, and it is given little time: on the same Wi-Fi
 *  the proof and the handshake take milliseconds, and away from home the
 *  address leads nowhere — every second spent on it is a second the tailnet
 *  dial waits. On 2026-11-06 reconnects through the tailnet took 136 to 782 s
 *  with the phone and the Mac on the same network. */
const LAN_PROOF_MS = 1200;
const LAN_CONNECT_MS = 1500;

/** Ask the computer on a LAN address to prove it is ours before the token goes
 *  there: 192.168.178.x is every Fritz!Box, and a phone on a friend's Wi-Fi
 *  would otherwise hand its token to whatever answers at the home address. The
 *  daemon answers sha256(token_hash + ":" + nonce) — see `lan_proof` in
 *  server.py — which only a computer holding this token's hash can. */
export async function lanProof(host: string, port: number, token: string, deviceId: string,
                               ms: number = LAN_PROOF_MS): Promise<'ok' | 'lan-timeout' | 'lan-error' | 'lan-proof'> {
  const nonce = randomHex(16);
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl?.abort(); }, ms);
  try {
    const r = await Promise.race([
      fetch(`http://${host}:${port}/lan/proof?device=${encodeURIComponent(deviceId)}&nonce=${nonce}`,
            ctl ? { signal: ctl.signal } : {}),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms + 50)),
    ]);
    if (!r.ok) return 'lan-proof';
    const j: any = await r.json();
    const want = sha256Hex(`${sha256Hex(token)}:${nonce}`);
    return j && j.proof === want ? 'ok' : 'lan-proof';
  } catch {
    return timedOut ? 'lan-timeout' : 'lan-error';
  } finally {
    clearTimeout(timer);
  }
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export class RacClient {
  private ws: WebSocket | null = null;
  private rid = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(ev: RacEvent) => void>();
  private statusListeners = new Set<(s: ConnStatus) => void>();
  private linkListeners = new Set<(s: ConnStatus) => void>();
  private url = '';
  private target: { host: string; port: number; token: string } | null = null;
  /** The LAN door, when the computer has one and told us (`host.status`). */
  private lan: { host: string; port: number; token: string; deviceId: string } | null = null;
  /** The LAN door failed during this outage: the next dial goes to the tailnet
   *  at once. Cleared after a tailnet dial fails too, so the two alternate. */
  private skipLan = false;
  /** Bumped by every connect() and dial, so an answer that comes back after
   *  the world moved on is ignored. */
  private dialGen = 0;
  private via: Door = 'tailnet';
  private dials = 0;
  private fails: DialFail[] = [];
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private hb: ReturnType<typeof setInterval> | null = null;
  private beating = false;
  private missed = 0;
  /** When anything last arrived on the socket: proof it is alive. */
  private lastRx = 0;
  /** When the socket opened, which is as good as something arriving. */
  private openedAt = 0;
  /** One probe at a time; a second caller waits on the first. */
  private probing: Promise<boolean> | null = null;
  /** Until when 'offline'/'connecting' are kept from the listeners. */
  private hushUntil = 0;
  private hushTimer: ReturnType<typeof setTimeout> | null = null;
  private lost: { reason: ReconnectReason; code: number | null; at: number; quiet: number } | null = null;
  status: ConnStatus = 'idle';

  connect(host: string, port: number, token: string, lan?: { host: string; deviceId: string } | null) {
    const url = wsUrl(host, port, token);
    const door = lan && lan.host && lan.deviceId && lan.host !== host
      ? { host: lan.host, port, token, deviceId: lan.deviceId } : null;
    // Same target and a live socket → nothing to do (init() can run twice under Fast Refresh).
    if (this.wanted && this.url === url && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.lan = door;
      return;
    }
    this.url = url;
    this.target = { host, port, token };
    this.lan = door;
    this.skipLan = false;
    this.dials = 0;
    this.fails = [];
    this.wanted = true;
    this.retry = 0;
    this.lost = null;
    // A computer chosen just now has no outage to hide yet.
    this.hushUntil = 0;
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

  /** Learn (or forget) the computer's LAN address while connected — it is told
   *  in `host.status`, after the first socket is already open. Used from the
   *  next dial on. */
  setLan(lan: { host: string; deviceId: string } | null) {
    const t = this.target;
    if (!t) return;
    this.lan = lan && lan.host && lan.deviceId && lan.host !== t.host
      ? { host: lan.host, port: t.port, token: t.token, deviceId: lan.deviceId } : null;
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private open() {
    if (!this.wanted) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.lan && !this.skipLan) { void this.openLan(this.lan); return; }
    this.dial(this.url, 'tailnet', CONNECT_TIMEOUT_MS);
  }

  /** The LAN door: ask the address to prove it is ours, then dial it. Any
   *  failure goes straight on to the tailnet, with no wait in between. */
  private async openLan(lan: { host: string; port: number; token: string; deviceId: string }) {
    const gen = ++this.dialGen;
    this.setStatus('connecting');
    this.dials++;
    const proof = await lanProof(lan.host, lan.port, lan.token, lan.deviceId);
    if (gen !== this.dialGen || !this.wanted || this.ws) return;
    if (proof !== 'ok') {
      this.fails.push(proof);
      this.skipLan = true;
      this.open();
      return;
    }
    this.dials--;   // the dial below counts itself
    this.dial(wsUrl(lan.host, lan.port, lan.token), 'lan', LAN_CONNECT_MS);
  }

  private dial(url: string, door: Door, limitMs: number) {
    const gen = ++this.dialGen;
    this.dials++;
    this.setStatus('connecting');
    const failed = (kind: 'timeout' | 'error') => {
      if (door === 'lan') {
        this.fails.push(kind === 'timeout' ? 'lan-timeout' : 'lan-error');
        this.skipLan = true;
        this.setStatus('offline');
        this.open();
        return;
      }
      this.fails.push(kind);
      // The tailnet failed too: give the LAN door another go on the next dial.
      this.skipLan = false;
      this.setStatus('offline');
      this.scheduleRetry();
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      failed('error');
      return;
    }
    this.ws = ws;
    let opened = false;
    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.CONNECTING) return;
      console.warn(`ws: connection handshake timed out (${door}); retrying`);
      this.markLost('socket', null);
      this.closeSocket();
      failed('timeout');
    }, limitMs);
    ws.onopen = () => {
      if (this.ws !== ws || gen !== this.dialGen) return;
      opened = true;
      this.clearConnectTimer();
      this.via = door;
      this.retry = 0; this.missed = 0; this.lastRx = 0; this.openedAt = Date.now();
      this.setStatus('online'); this.startHeartbeat();
    };
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now(); this.missed = 0; this.handle(String(m.data));
    };
    // Native errors can contain the credential-bearing URL. Keep diagnostics
    // free of that payload; the close event records the numeric code.
    ws.onerror = () => {
      if (this.ws !== ws) return;
      console.warn('ws: native socket error');
      // A dial that failed is over. React Native follows the error with a
      // close; not every WebSocket does — Node's leaves a refused handshake in
      // CONNECTING with no close at all — and waiting for one would sit out
      // the handshake limit on a computer that has already said no.
      if (ws.readyState !== WebSocket.OPEN) {
        // Detached before the close: Node's close() on a failed dial fires
        // `error` again, synchronously, and this handler would recurse.
        ws.onerror = null; ws.onclose = null;
        try { ws.close(); } catch {}
        if (!opened) { this.dialFailed(ws, 1006, failed); return; }
        this.lostSocket(1006);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (!opened) { this.dialFailed(ws, e.code ?? null, failed); return; }
      this.lostSocket(e.code ?? null);
    };
  }

  /** A dial that never opened. A refusal of the token is final whichever door
   *  it came through; anything else is that door failing. */
  private dialFailed(ws: WebSocket, code: number | null, failed: (k: 'timeout' | 'error') => void) {
    if (code === 4401 || code === 1008) { this.lostSocket(code); return; }
    this.clearConnectTimer();
    if (this.ws === ws) this.ws = null;
    this.stopHeartbeat();
    for (const p of this.pending.values()) p.reject(connError('wsDropped'));
    this.pending.clear();
    this.markLost('socket', code);
    failed('error');
  }

  /** The socket in hand is gone, by a close or a failed dial. */
  private lostSocket(code: number | null) {
    this.clearConnectTimer();
    this.ws = null;
    this.stopHeartbeat();
    for (const p of this.pending.values()) p.reject(connError('wsDropped'));
    this.pending.clear();
    if (code === 4401 || code === 1008) { this.setStatus('unauthorized'); this.wanted = false; return; }
    if (this.status === 'online') this.hush();
    this.markLost('socket', code);
    this.setStatus('offline');
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (!this.wanted) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
    this.timer = setTimeout(() => this.open(), delay);
  }

  /** Keep the coming 'offline'/'connecting' from the listeners for a while: an
   *  online socket just went, and most of the time the next one is up before
   *  anybody could have read a banner. Started once per outage. */
  private hush() {
    if (this.hushUntil <= Date.now()) this.hushUntil = Date.now() + QUIET_RECONNECT_MS;
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

  /** A ping that does not forgive: a foreground check, or a request about to go
   *  out on a socket that has gone quiet. It waits only FOREGROUND_PROBE_MS,
   *  because a person is looking at the screen. Its own ping, even with the
   *  interval's still out: that one may have ten seconds left to run. */
  private probe(reason: ReconnectReason): Promise<boolean> {
    if (!this.probing) {
      this.probing = this.ask(reason, FOREGROUND_PROBE_MS).finally(() => { this.probing = null; });
    }
    return this.probing;
  }

  /** One ping. A socket that delivered anything since it went out is alive. */
  private async ask(reason: ReconnectReason, ms: number): Promise<boolean> {
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
      // Same socket, and nothing at all came back: it is gone whatever iOS
      // says — once it has failed to answer often enough.
      if (reason !== 'heartbeat' || ++this.missed >= HEARTBEAT_MISSES) this.dropDead(reason);
      return false;
    }
  }

  /** How long the socket has gone without delivering anything. */
  private silentFor(): number {
    return Date.now() - Math.max(this.lastRx, this.openedAt);
  }

  /** Note why the connection went, keeping when it first went: an outage that
   *  takes several dials is one outage, and `offline_s` is all of it. */
  private markLost(reason: ReconnectReason, code: number | null) {
    if (this.lost && reason !== 'restart') return;
    // A new outage: the LAN door gets the first dial again. The dial count
    // runs on until `hello` takes it (takeReconnect), so a failure that came
    // before the loss was noticed — a first dial at a cold start — is in it.
    if (!this.lost) this.skipLan = false;
    this.lost = { reason, code: code ?? this.lost?.code ?? null, at: this.lost?.at ?? Date.now(),
                  quiet: this.lost?.quiet ?? (Math.max(this.lastRx, this.openedAt) || Date.now()) };
  }

  /** Why the last connection was lost, once: `hello` carries it to the daemon. */
  takeReconnect(): Reconnect | null {
    const l = this.lost;
    this.lost = null;
    const s = (ms: number) => Math.round(ms / 100) / 10;
    const out: Reconnect | null = l && { reason: l.reason, code: l.code, offline_s: s(Date.now() - l.at), silent_s: s(Date.now() - l.quiet),
                                          via: this.via, dials: this.dials, fails: this.fails.slice(-12) };
    this.dials = 0; this.fails = [];
    return out;
  }

  /** Bury a socket the OS still believes in, and start reconnecting now. */
  private dropDead(reason: ReconnectReason) {
    console.warn(`ws: socket not answering (${reason}), reconnecting`);
    this.markLost(reason, null);
    this.closeSocket();
    for (const p of this.pending.values()) p.reject(connError('wsDropped'));
    this.pending.clear();
    this.hush();
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
    // to be a stale belief, so check it instead of trusting it. A socket that
    // has been silent past a heartbeat was asleep with the app: iOS takes it
    // away within seconds of suspending us (since_ping=404 s, 1009 s in the
    // daemon's log), and asking it first only adds the probe's two seconds to
    // the wait. A fresh one is a tenth of that.
    if (this.status === 'online') {
      if (!reason) return;
      if (this.silentFor() > STALE_MS) this.dropDead(reason);
      else void this.probe(reason);
      return;
    }
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
    // "Online" on a socket that has said nothing for longer than a heartbeat is
    // a belief, not a fact — the app may have slept, or the pings be going
    // unanswered. Ask before trusting it with what the person just did: a send
    // into a dead socket waits out its whole timeout, and that is the chat that
    // "shows nothing". A dead one is replaced at once and the request waits
    // for the new one.
    if (this.status === 'online' && this.silentFor() > STALE_MS) await this.probe('probe');
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
  /** What a person is shown: a reconnect inside the quiet window never leaves
   *  'online' here (see setStatus). For the banner and whatever reads like it. */
  onStatus(l: (s: ConnStatus) => void) { this.statusListeners.add(l); return () => { this.statusListeners.delete(l); }; }
  /** Every change as it happens, unhushed. For code that has to act on the
   *  socket going, however briefly: a call that must stop playing the answer
   *  it was in the middle of, a shell that has to be attached to again. */
  onLink(l: (s: ConnStatus) => void) { this.linkListeners.add(l); return () => { this.linkListeners.delete(l); }; }

  /** Listeners hear every state but the in-between ones of a reconnect still
   *  inside its quiet window; if that runs out, they hear where it got to. */
  private setStatus(s: ConnStatus) {
    const was = this.status;
    this.status = s;
    if (s !== was || s === 'online') for (const l of this.linkListeners) l(s);
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
      // `once` is for the daemon's log only: this socket is not the phone's
      // connection coming and going, and is not written down as one.
      ws = new WebSocket(`${wsUrl(host, port, token)}&once=1`);
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
