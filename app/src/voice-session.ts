// The phone's half of the streaming call (docs/PROTOCOL.md § Voice session, docs/voice-quality-plan.md §3–4).
//
// The phone streams its echo-cancelled microphone to the daemon and plays what it is told, and it decides
// nothing about turns: the daemon says when the caller has finished, hands out turn ids and is the only
// side that lets anything reach an agent. What the phone does own is playback — pieces of the newest turn
// in order, nothing of a cancelled one — and barge-in, because the 300 ms budget can only be met where the
// microphone is.
//
// No React and no native module in here. src/voice.ts hands it the real socket, the native audio engine
// and the voice; scripts/test-voice-session.cjs hands it a real daemon and a fake engine fed with the
// bench's fixtures, so every rule below is checked without a phone.

export const RATE = 16000;
/** Level frames, as the daemon's (`voice.py`: 20 ms). */
export const FRAME_MS = 20;
/** One `voice.audio` message. */
export const SEND_MS = 100;
const SEND_SAMPLES = (RATE * SEND_MS) / 1000;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
/** Barge-in: at least this loud for this long while a reply is playing. The daemon's own over-echo rule. */
export const BARGE_DB = -35;
export const BARGE_MS = 120;
/** …and this far above the echo that is left after cancellation, which the detector learns while playing. */
export const ECHO_MARGIN_DB = 12;
/** Resume attempts after a dropped socket before the call gives up and the chat goes on as text (medkit's three). */
export const RESUME_TRIES = 3;
/** The daemon keeps a dropped session this long (`voice.RESUME_S`). */
export const RESUME_WINDOW_MS = 30000;
export const PING_MS = 10000;
/** `voice.ready` at the latest this long after the session starts, as the daemon's own cap. */
export const READY_CAP_MS = 3000;
/** A piece's `done` goes out this long after the player finished it: the last of its echo is still in the
 *  microphone audio not yet sent, and the daemon must hear that with its over-playback threshold. */
export const DONE_TAIL_MS = 250;

export type LiveState = 'idle' | 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'working'
  | 'reconnecting' | 'ended';
export type EndReason = 'hangup' | 'denied' | 'failed' | 'dropped' | 'unsupported';

export type WireEvent = { event: string; chat_id?: string | null; data: any };

/** The daemon's socket: requests with an answer, and fire-and-forget messages without an id. */
export interface Wire {
  call<T = any>(type: string, data: Record<string, any>, timeoutMs?: number): Promise<T>;
  tell(type: string, data: Record<string, any>): void;
  on(l: (ev: WireEvent) => void): () => void;
  onStatus(l: (s: string) => void): () => void;
  online(): boolean;
}

export type EngineEvent =
  | { kind: 'frame'; pcm: Int16Array; t_ms: number }
  | { kind: 'playback'; id: string; state: 'started' | 'done'; t_ms: number }
  /** The output changed (headset in or out, Bluetooth, speaker). The engine has already reconnected itself.
   *  `flushed` (reason `rebuilt`): the engine was rebuilt for the new hardware format and everything that
   *  was on its player is gone without a `done`. */
  | { kind: 'route'; reason: string; output: string; flushed?: boolean }
  /** Another app or a phone call took the audio session, or gave it back. */
  | { kind: 'interruption'; began: boolean }
  /** The engine died under us (media services reset, a restart that failed). */
  | { kind: 'failed'; reason: string };

/** The phone's audio: voice-processed microphone in (16 kHz mono PCM16), one player out, both on one
 *  engine so the echo canceller knows what the speaker is saying. */
export interface Engine {
  /** Rejects with `{ code: 'mic_denied' }` when the microphone is not allowed. */
  start(): Promise<void>;
  stop(): void;
  running(): boolean;
  /** Queue mono PCM16 at `rate` after whatever is queued, as item `id`. */
  play(id: string, pcm: Int16Array, rate: number): void;
  /** Silence now, and drop everything queued. Returns when the player has stopped. */
  flush(): void;
  on(l: (e: EngineEvent) => void): () => void;
}

/** One voice for the whole call: text in, PCM chunks out as they are made. */
export interface Voice {
  name: string;
  synth(text: string, cancelled: () => boolean): AsyncIterable<{ pcm: Int16Array; rate: number }>;
}

export type Clock = {
  now: () => number;
  setTimeout: (f: () => void, ms: number) => any;
  clearTimeout: (h: any) => void;
  setInterval: (f: () => void, ms: number) => any;
  clearInterval: (h: any) => void;
};

export type SessionDeps = {
  wire: Wire;
  engine: Engine;
  voice: Voice;
  clock?: Clock;
  log?: (line: string) => void;
};

export type StartOptions = {
  chatId?: string | null;
  lang: string;
  client: { build: string; device: string };
  /** Said by the phone when the call is up, before anyone has spoken. */
  greeting?: string;
};

/** What the screen shows: the daemon's state, the words it heard, and the pieces it said. */
export type Heard = { turn: number; text: string; final: boolean };
export type Said = { turn: number; piece: number; text: string; kind: string };

/** Per turn, everything needed to say how long the caller waited (client clock, ms). */
export type TurnTiming = {
  turn: number;
  /** When the audio holding the end of speech was captured (from `voice.turn`'s timeline position). */
  speechEnd: number | null;
  firstSay: number | null;
  firstAudible: number | null;
  /** Speech end → first audible piece. */
  endToAudible: number | null;
  /** The same, on the daemon's clock, via the `voice.ping` offset. */
  firstAudibleServer: number | null;
};

/** One line of the call as the screen writes it. */
export type ConversationLine = { turn: number; who: 'you' | 'them'; text: string; final: boolean; kind?: string };

export type BargeRecord = { turn: number; detected: number; stopped: number; playedMs: number };

export type Listener = (s: Snapshot) => void;
export type Snapshot = {
  state: LiveState;
  sessionId: string | null;
  turn: number;
  heard: Heard | null;
  said: Said[];
  ended: EndReason | null;
  error: { code: string; message: string } | null;
};

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (h) => clearInterval(h),
};

// ── audio helpers ───────────────────────────────────────────────────────────

/** dBFS of one frame, as `voice.frame_db`. */
export function frameDb(pcm: Int16Array, from = 0, to = pcm.length): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / n);
  return rms <= 0 ? -120 : 20 * Math.log10(rms / 32768);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}

const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  const at = (i: number) => (i < clean.length ? B64_INDEX[clean.charCodeAt(i)] : 0);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = at(i), b = at(i + 1), c = at(i + 2), d = at(i + 3);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function pcmBase64(pcm: Int16Array): string {
  return toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/** Float samples (EMA's) to PCM16. */
export function toPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const x = Math.max(-1, Math.min(1, f[i]));
    out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  return out;
}

// ── barge-in ────────────────────────────────────────────────────────────────

/** The caller talking over a reply, told apart from the reply's own echo.
 *
 *  The input is echo-cancelled, so most of the reply never reaches it; what does is quiet and steady. The
 *  detector learns that floor while the reply plays and fires on `BARGE_MS` of frames at least
 *  `BARGE_DB` and at least `ECHO_MARGIN_DB` above it — a speaker with a weak canceller raises the bar
 *  instead of answering itself. A route change forgets the floor: a headset has none. */
export class BargeDetector {
  private floor = -90;
  private run = 0;

  reset() { this.floor = -90; this.run = 0; }

  threshold() { return Math.max(BARGE_DB, this.floor + ECHO_MARGIN_DB); }

  /** One 20 ms frame heard while a reply plays; true when the caller has cut in. */
  feed(db: number): boolean {
    const bar = this.threshold();
    if (db >= bar) {
      this.run += 1;
      return this.run * FRAME_MS >= BARGE_MS;
    }
    this.run = 0;
    // Only what is clearly below the bar teaches the floor, so the start of a word does not raise it.
    this.floor = this.floor <= -89 ? db : this.floor * 0.9 + db * 0.1;
    return false;
  }

  /** Nothing is playing: the run starts over next time. */
  idle() { this.run = 0; }
}

// ── the session ─────────────────────────────────────────────────────────────

type Piece = {
  turn: number; piece: number; text: string; last: boolean; kind: string;
  items: number; doneItems: number; synthDone: boolean;
  started: number | null; done: boolean; playedMs: number;
  /** The item playing now, and when it started. */
  current: { id: string; at: number; ms: number } | null;
};

export class VoiceSession {
  private wire: Wire;
  private engine: Engine;
  private voice: Voice;
  private clock: Clock;
  private log: (line: string) => void;
  private opts: StartOptions | null = null;
  private listeners = new Set<Listener>();
  private offs: (() => void)[] = [];
  private snap: Snapshot = { state: 'idle', sessionId: null, turn: 0, heard: null, said: [], ended: null, error: null };

  // microphone → daemon
  private seq = 0;
  private buf = new Int16Array(SEND_SAMPLES);
  private filled = 0;
  private bufAt = 0;
  private sub = new Int16Array(FRAME_SAMPLES);
  private subFilled = 0;
  /** Capture time of each sent message, by seq: the audio timeline on the phone's clock. */
  private sentAt = new Map<number, number>();

  // daemon → speaker
  private newest = 0;
  private dead = new Set<number>();
  private pieces: Piece[] = [];
  private items = new Map<string, { p: Piece; ms: number }>();
  /** Audio of each turn played to the end of its item, in ms. */
  private played = new Map<number, number>();
  /** The latest words heard in each turn. */
  private heardBy = new Map<number, { text: string; final: boolean }>();
  private synthQueue: Piece[] = [];
  private synthing = false;
  private barge = new BargeDetector();

  // connection
  private resuming = false;
  private droppedAt: number | null = null;
  private dropTimer: any = null;
  private pingTimer: any = null;
  private readyTimer: any = null;
  private readySent = false;
  private offset: { rtt: number; ms: number } | null = null;
  private paused = false;

  // what happened, for the timing report
  readonly timings = new Map<number, TurnTiming>();
  readonly barges: BargeRecord[] = [];
  readonly starts: { resumed: boolean; at: number }[] = [];
  private stopReply: any = null;

  constructor(deps: SessionDeps) {
    this.wire = deps.wire;
    this.engine = deps.engine;
    this.voice = deps.voice;
    this.clock = deps.clock ?? realClock;
    this.log = deps.log ?? (() => {});
  }

  get state(): LiveState { return this.snap.state; }
  get sessionId(): string | null { return this.snap.sessionId; }
  snapshot(): Snapshot { return this.snap; }

  /** Where the next captured sample lands on the session's audio timeline (ms since `voice.start`). */
  timelineMs(): number { return ((this.seq * SEND_SAMPLES + this.filled) * 1000) / RATE; }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snap);
    return () => { this.listeners.delete(l); };
  }

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l(this.snap);
  }

  private live(): boolean { return this.snap.state !== 'idle' && this.snap.state !== 'ended'; }

  /** Up the call: microphone first (so a denial sends nothing), then the session, then the greeting.
   *  A second start while one is up returns the same session. */
  async start(opts: StartOptions): Promise<void> {
    if (this.live()) return;
    this.opts = opts;
    this.set({ state: 'starting', ended: null, error: null, said: [], heard: null });
    this.offs.push(this.engine.on((e) => this.onEngine(e)));
    try {
      await this.engine.start();
    } catch (e: any) {
      this.release();
      this.set({ state: 'ended', ended: e?.code === 'mic_denied' ? 'denied' : 'failed',
                 error: { code: e?.code || 'mic_failed', message: String(e?.message ?? e) } });
      return;
    }
    try {
      await this.open(null);
    } catch (e: any) {
      this.release();
      const unsupported = e?.code === 'unknown_type' || e?.code === 'unknown_method' || /unknown/i.test(String(e?.message));
      this.set({ state: 'ended', ended: unsupported ? 'unsupported' : 'failed',
                 error: { code: e?.code || 'voice_start_failed', message: String(e?.message ?? e) } });
      return;
    }
    this.offs.push(this.wire.on((ev) => this.onEvent(ev)));
    this.offs.push(this.wire.onStatus((s) => this.onStatus(s)));
    this.pingTimer = this.clock.setInterval(() => void this.ping(), PING_MS);
    void this.ping();
    this.readyTimer = this.clock.setTimeout(() => this.ready(), READY_CAP_MS);
    if (opts.greeting) this.enqueueSay({ turn: 0, piece: 0, text: opts.greeting, last: true, kind: 'greeting' });
  }

  /** `voice.start`, fresh or resuming `sid`. */
  private async open(sid: string | null): Promise<void> {
    const o = this.opts!;
    const r = await this.wire.call<{ session_id: string; turn_id: number; resumed?: boolean }>('voice.start', {
      ...(o.chatId ? { chat_id: o.chatId } : {}), lang: o.lang, sample_rate: RATE, client: o.client,
      ...(sid ? { session_id: sid } : {}),
    });
    const resumed = !!r.resumed && r.session_id === sid;
    this.starts.push({ resumed, at: this.clock.now() });
    if (!resumed) {
      // A new session has its own audio timeline.
      this.seq = 0;
      this.sentAt.clear();
      this.filled = 0;
    }
    this.newest = Math.max(resumed ? this.newest : 0, r.turn_id || 0);
    this.set({ sessionId: r.session_id, turn: this.newest, state: 'listening' });
  }

  private release() {
    for (const off of this.offs.splice(0)) { try { off(); } catch {} }
    for (const t of [this.dropTimer, this.readyTimer, this.stopReply]) if (t) this.clock.clearTimeout(t);
    if (this.pingTimer) this.clock.clearInterval(this.pingTimer);
    this.dropTimer = this.readyTimer = this.pingTimer = this.stopReply = null;
    this.dropPlayback(null);
    try { this.engine.stop(); } catch {}
  }

  /** The call's timing as the phone measured it: per turn, speech end → first audible piece on the
   *  phone's clock (and on the daemon's, through the `voice.ping` offset); every barge-in's stop. */
  timingReport() {
    const turns = [...this.timings.values()];
    return { session_id: this.snap.sessionId, voice: this.voice.name, clock_offset: this.offset,
             end_to_audible: latencySummary(turns), turns, barges: this.barges, starts: this.starts };
  }

  /** Hang up: silence and the microphone released at once, then the daemon told. Safe to call twice. */
  async stop(reason: EndReason = 'hangup'): Promise<any> {
    if (!this.live()) return null;
    const sid = this.snap.sessionId;
    this.log(`voice: report ${JSON.stringify(this.timingReport())}`);
    this.release();
    this.set({ state: 'ended', ended: reason });
    if (!sid || !this.wire.online()) return null;
    try { return await this.wire.call('voice.stop', { session_id: sid }, 5000); } catch { return null; }
  }

  // ── microphone ────────────────────────────────────────────────────────────
  private onEngine(e: EngineEvent) {
    if (e.kind === 'frame') this.onFrame(e.pcm, e.t_ms);
    else if (e.kind === 'playback') this.onPlayback(e.id, e.state, e.t_ms);
    else if (e.kind === 'route') {
      // The engine reconnected itself on the new route; the echo there is a different echo.
      this.log(`voice: route ${e.reason} → ${e.output}`);
      this.barge.reset();
      // A rebuilt engine has an empty player: the piece that was playing will never report done, so it is
      // reported stopped now with what was heard of it, and the turn's queued pieces go with it.
      if (e.flushed || e.reason === 'rebuilt') this.dropPlayback(null);
    } else if (e.kind === 'interruption') {
      if (e.began) this.pause();
      else void this.resume();
    } else if (e.kind === 'failed') {
      this.log(`voice: engine failed (${e.reason}), restarting`);
      this.pause();
      void this.resume();
    }
  }

  /** The audio session was taken (a phone call, Siri) or the engine died: let go of it, keep the call. */
  pause() {
    if (!this.live() || this.paused) return;
    this.paused = true;
    this.dropPlayback(null);
    try { this.engine.stop(); } catch {}
  }

  /** Take the microphone and player back (interruption over, app in front again). Same session. */
  async resume(): Promise<void> {
    if (!this.live()) return;
    if (!this.paused && this.engine.running()) return;
    try {
      await this.engine.start();
      this.paused = false;
      this.barge.reset();
    } catch (e: any) {
      this.log(`voice: could not take the microphone back: ${e?.message ?? e}`);
    }
  }

  /** The app came to the front: a microphone iOS stopped in the background is started again. */
  async foreground(): Promise<void> {
    if (!this.live()) return;
    if (!this.engine.running()) { this.paused = true; await this.resume(); }
  }

  private onFrame(pcm: Int16Array, t: number) {
    if (!this.live()) return;
    // Level, 20 ms at a time, for the barge-in detector.
    const playing = this.playingNow();
    for (let i = 0; i < pcm.length; i++) {
      this.sub[this.subFilled++] = pcm[i];
      if (this.subFilled === FRAME_SAMPLES) {
        this.subFilled = 0;
        if (playing) {
          if (this.barge.feed(frameDb(this.sub))) this.bargeIn();
        } else this.barge.idle();
      }
    }
    // 100 ms messages, on the phone's audio timeline.
    let at = 0;
    while (at < pcm.length) {
      if (this.filled === 0) this.bufAt = t + ((at * 1000) / RATE);
      const n = Math.min(SEND_SAMPLES - this.filled, pcm.length - at);
      this.buf.set(pcm.subarray(at, at + n), this.filled);
      this.filled += n;
      at += n;
      if (this.filled === SEND_SAMPLES) {
        this.send(this.buf, this.bufAt);
        this.filled = 0;
      }
    }
  }

  private send(chunk: Int16Array, t: number) {
    const seq = this.seq++;
    this.sentAt.set(seq, t);
    if (this.sentAt.size > 6000) this.sentAt.delete(seq - 6000);   // ten minutes
    const sid = this.snap.sessionId;
    // Offline the message is lost; the daemon fills the gap in `seq` with silence on resume.
    if (!sid || this.snap.state === 'reconnecting' || !this.wire.online()) return;
    this.wire.tell('voice.audio', { session_id: sid, seq, t_client_ms: Math.round(t), pcm_b64: pcmBase64(chunk) });
  }

  // ── daemon events ─────────────────────────────────────────────────────────
  private onEvent(ev: WireEvent) {
    if (!ev.event?.startsWith('voice.')) return;
    const d = ev.data || {};
    if (d.session_id !== this.snap.sessionId) return;
    const turn = Number(d.turn_id ?? 0);
    if (turn > this.newest) {
      // A newer turn: anything of an older one still queued or playing is stale.
      this.newest = turn;
      this.dropOlder(turn);
      this.set({ turn });
    }
    switch (ev.event) {
      case 'voice.state':
        if (this.snap.state !== 'reconnecting' || d.state !== 'reconnecting') this.set({ state: d.state });
        break;
      case 'voice.transcript':
        this.heardBy.set(turn, { text: d.text || '', final: !!d.final });
        this.set({ heard: { turn, text: d.text || '', final: !!d.final } });
        break;
      case 'voice.say':
        if (turn < this.newest || this.dead.has(turn)) return;
        this.timing(turn).firstSay ??= this.clock.now();
        this.enqueueSay({ turn, piece: Number(d.piece), text: String(d.text || ''), last: !!d.last, kind: d.kind || 'reply' });
        break;
      case 'voice.cancel':
        this.dead.add(turn);
        this.dropPlayback(turn);
        break;
      case 'voice.turn': {
        const tm = this.timing(turn);
        tm.speechEnd = this.captureTime(Number(d.t_speech_end_ms));
        this.finishTiming(tm);
        if (d.committed_text) {
          this.heardBy.set(turn, { text: d.committed_text, final: true });
          this.set({ heard: { turn, text: d.committed_text, final: true } });
        }
        break;
      }
      case 'voice.error':
        this.set({ error: { code: d.code, message: d.message || '' } });
        break;
    }
  }

  /** The phone-clock time the audio at `ms` on the session timeline was captured. */
  private captureTime(ms: number): number | null {
    if (!Number.isFinite(ms)) return null;
    const seq = Math.floor(ms / SEND_MS);
    const at = this.sentAt.get(seq);
    return at == null ? null : at + (ms - seq * SEND_MS);
  }

  private timing(turn: number): TurnTiming {
    let t = this.timings.get(turn);
    if (!t) {
      t = { turn, speechEnd: null, firstSay: null, firstAudible: null, endToAudible: null, firstAudibleServer: null };
      this.timings.set(turn, t);
    }
    return t;
  }

  private finishTiming(t: TurnTiming) {
    if (t.speechEnd != null && t.firstAudible != null) t.endToAudible = Math.round(t.firstAudible - t.speechEnd);
    if (t.firstAudible != null && this.offset) t.firstAudibleServer = Math.round(t.firstAudible + this.offset.ms);
  }

  // ── playback ──────────────────────────────────────────────────────────────
  private enqueueSay(s: { turn: number; piece: number; text: string; last: boolean; kind: string }) {
    const p: Piece = { ...s, items: 0, doneItems: 0, synthDone: false, started: null, done: false, playedMs: 0, current: null };
    this.pieces.push(p);
    this.pieces.sort((a, b) => a.turn - b.turn || a.piece - b.piece);
    if (s.text.trim()) {
      this.set({ said: [...this.snap.said, { turn: s.turn, piece: s.piece, text: s.text, kind: s.kind }] });
      this.synthQueue.push(p);
      this.synthQueue.sort((a, b) => a.turn - b.turn || a.piece - b.piece);
      void this.pump();
    } else {
      p.synthDone = true;
      this.settle();
    }
  }

  private stale(p: Piece): boolean {
    return p.turn !== 0 && (p.turn < this.newest || this.dead.has(p.turn));
  }

  /** Make the queued pieces one at a time, in order; each chunk is handed to the player as it is made, so
   *  the first words play while the rest of the answer is still arriving. */
  private async pump() {
    if (this.synthing) return;
    this.synthing = true;
    try {
      while (this.synthQueue.length && this.live()) {
        const p = this.synthQueue.shift()!;
        if (this.stale(p) || p.done) continue;
        let k = 0;
        try {
          for await (const chunk of this.voice.synth(p.text, () => this.stale(p) || p.done || !this.live())) {
            if (this.stale(p) || p.done || !this.live()) break;
            if (!chunk.pcm.length) continue;
            const id = `${p.turn}:${p.piece}:${k++}`;
            const ms = (chunk.pcm.length * 1000) / chunk.rate;
            this.items.set(id, { p, ms });
            p.items += 1;
            this.engine.play(id, chunk.pcm, chunk.rate);
          }
        } catch (e: any) {
          this.log(`voice: could not make "${p.text.slice(0, 40)}": ${e?.message ?? e}`);
        }
        p.synthDone = true;
        this.settle();
      }
    } finally {
      this.synthing = false;
    }
  }

  private onPlayback(id: string, state: 'started' | 'done', t: number) {
    const it = this.items.get(id);
    if (!it) return;                          // flushed: its piece was already reported stopped
    const p = it.p;
    if (state === 'started') {
      p.current = { id, at: t, ms: it.ms };
      if (p.started == null) {
        p.started = t;
        this.report(p, 'started', t);
        if (p.turn > 0) {
          const tm = this.timing(p.turn);
          if (tm.firstAudible == null) { tm.firstAudible = t; this.finishTiming(tm); }
        }
        this.ready();
      }
    } else {
      this.items.delete(id);
      p.doneItems += 1;
      p.playedMs += it.ms;
      this.played.set(p.turn, (this.played.get(p.turn) ?? 0) + it.ms);
      if (p.current?.id === id) p.current = null;
      this.settle();
    }
  }

  /** Report pieces that have finished, in order. A piece with nothing to play (an empty closing piece)
   *  is done once everything before it is. */
  private settle() {
    for (const p of this.pieces) {
      if (p.done) continue;
      if (!p.synthDone || p.doneItems < p.items) return;
      p.done = true;
      if (p.started == null) this.report(p, 'started', this.clock.now());
      const at = this.clock.now();
      this.clock.setTimeout(() => this.report(p, 'done', at), DONE_TAIL_MS);
    }
    this.pieces = this.pieces.filter((p) => !p.done);
  }

  private report(p: Piece, state: 'started' | 'done' | 'stopped', t: number) {
    const sid = this.snap.sessionId;
    if (!sid || !this.wire.online()) return;
    this.wire.tell('voice.playback', { session_id: sid, turn_id: p.turn, piece: p.piece, state,
                                       played_ms: Math.round(p.playedMs), t_client_ms: Math.round(t) });
  }

  /** A reply piece is audible right now. */
  playingNow(): boolean {
    return this.pieces.some((p) => p.current != null && p.started != null && !p.done);
  }

  private playedOf(turn: number, now: number): number {
    let ms = this.played.get(turn) ?? 0;
    for (const p of this.pieces) {
      if (p.turn === turn && p.current) ms += Math.min(p.current.ms, Math.max(0, now - p.current.at));
    }
    return Math.round(ms);
  }

  /** How much of a turn's answer the caller has heard so far, in ms. */
  heardOf(turn: number): number { return this.playedOf(turn, this.clock.now()); }

  /** The call so far, turn by turn: what the caller said (final once committed; only the newest turn's
   *  words while they are still provisional) and what was said back. A turn the daemon replaced because
   *  the caller went on talking leaves nothing behind unless some of its answer was actually heard. */
  conversation(): ConversationLine[] {
    const turns = new Set<number>([...this.heardBy.keys(), ...this.snap.said.map((p) => p.turn)]);
    const out: ConversationLine[] = [];
    for (const turn of [...turns].sort((a, b) => a - b)) {
      const h = this.heardBy.get(turn);
      if (h && h.text && (h.final || turn === this.newest)) out.push({ turn, who: 'you', text: h.text, final: h.final });
      const said = this.snap.said.filter((p) => p.turn === turn);
      if (said.length && (turn === 0 || !this.dead.has(turn) || this.heardOf(turn) > 0)) {
        out.push({ turn, who: 'them', text: said.map((p) => p.text).join(' '), final: true, kind: said[0].kind });
      }
    }
    return out;
  }

  /** The daemon cancelled this turn, or the caller cut into it. */
  isDead(turn: number): boolean { return this.dead.has(turn); }

  /** Stop the player and drop the pieces of `turn` (all of them for null); the ones that had started are
   *  reported stopped with what was heard of them. */
  private dropPlayback(turn: number | null) {
    const onPlayer = (p: Piece) => p.current != null || p.items > p.doneItems;
    let hit = this.pieces.filter((p) => turn == null || p.turn === turn);
    const audible = hit.some(onPlayer);
    if (audible) {
      try { this.engine.flush(); } catch {}
      // A flush empties the whole player, so whatever else was on it is gone too.
      hit = [...new Set([...hit, ...this.pieces.filter(onPlayer)])];
    }
    const now = this.clock.now();
    for (const p of hit) {
      if (p.started != null && !p.done) {
        if (p.current) {
          const part = Math.min(p.current.ms, Math.max(0, now - p.current.at));
          p.playedMs += part;
          this.played.set(p.turn, (this.played.get(p.turn) ?? 0) + part);
        }
        this.report(p, 'stopped', now);
      }
      p.done = true;
      p.current = null;
    }
    for (const [id, it] of this.items) if (hit.includes(it.p)) this.items.delete(id);
    this.pieces = this.pieces.filter((p) => !p.done);
    this.synthQueue = this.synthQueue.filter((p) => !hit.includes(p));
  }

  private dropOlder(turn: number) {
    for (const t of new Set(this.pieces.map((p) => p.turn))) if (t !== 0 && t < turn) this.dropPlayback(t);
  }

  /** The caller talked over the reply: player first, then the daemon. */
  private bargeIn() {
    const turn = this.pieces.find((p) => p.current != null)?.turn ?? this.newest;
    const detected = this.clock.now();
    const played = this.playedOf(turn, detected);
    if (turn !== 0) this.dead.add(turn);
    this.dropPlayback(turn);
    const stopped = this.clock.now();
    this.barges.push({ turn, detected, stopped, playedMs: played });
    this.barge.idle();
    const sid = this.snap.sessionId;
    if (sid && this.wire.online()) {
      this.wire.tell('voice.barge', { session_id: sid, turn_id: turn, played_ms: played, t_client_ms: Math.round(detected) });
    }
    this.log(`voice: barge-in on turn ${turn}, stopped ${stopped - detected} ms after detection`);
  }

  private ready() {
    if (this.readySent || !this.snap.sessionId) return;
    this.readySent = true;
    this.wire.tell('voice.ready', { session_id: this.snap.sessionId, t_client_ms: this.clock.now() });
  }

  // ── connection ────────────────────────────────────────────────────────────
  private async ping() {
    const t0 = this.clock.now();
    try {
      const r = await this.wire.call<{ t_client_ms: number; t_server_ms: number }>('voice.ping', { t_client_ms: t0 }, 5000);
      const t1 = this.clock.now();
      const rtt = t1 - t0;
      if (!this.offset || rtt <= this.offset.rtt) this.offset = { rtt, ms: r.t_server_ms - (t0 + t1) / 2 };
    } catch {}
  }

  clockOffset() { return this.offset; }

  private onStatus(s: string) {
    if (!this.live()) return;
    if (s === 'online') { void this.reconnect(); return; }
    if (this.snap.state === 'reconnecting') return;
    // Nothing of an interrupted turn is played after the socket comes back.
    this.dropPlayback(null);
    this.dead.add(this.newest);
    this.droppedAt = this.clock.now();
    this.set({ state: 'reconnecting' });
    this.dropTimer = this.clock.setTimeout(() => {
      if (this.snap.state === 'reconnecting') void this.stop('dropped');
    }, RESUME_WINDOW_MS);
  }

  private async reconnect() {
    if (this.resuming || this.snap.state !== 'reconnecting') return;
    this.resuming = true;
    try {
      for (let i = 0; i < RESUME_TRIES; i++) {
        try {
          await this.open(this.snap.sessionId);
          if (this.dropTimer) { this.clock.clearTimeout(this.dropTimer); this.dropTimer = null; }
          this.droppedAt = null;
          return;
        } catch (e: any) {
          this.log(`voice: resume ${i + 1} failed: ${e?.message ?? e}`);
          await new Promise((r) => this.clock.setTimeout(() => r(null), 500));
          if (!this.live()) return;
        }
      }
      // Three tries, then the call ends and the chat carries on as text.
      await this.stop('dropped');
    } finally {
      this.resuming = false;
    }
  }
}

/** Speech end → first audible piece over the turns that have both, for the screen and the report. */
export function latencySummary(timings: Iterable<TurnTiming>): { n: number; median: number | null; p95: number | null } {
  const xs = [...timings].map((t) => t.endToAudible).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!xs.length) return { n: 0, median: null, p95: null };
  const q = (f: number) => xs[Math.min(xs.length - 1, Math.round(f * (xs.length - 1)))];
  return { n: xs.length, median: q(0.5), p95: q(0.95) };
}
