// EMA Lightning on the phone: letter ids in, 48 kHz mono float32 out, through the three ONNX graphs of
// tts/ and the host steps of tts/common.py, ported line by line. Nothing here knows which onnxruntime it
// runs on: the app hands it onnxruntime-react-native, the node test onnxruntime-node, both through
// `ortRuntime` below, so the code that is checked against the PyTorch reference is the code that talks.

import { frontend, ids as letterIds } from './frontend';
import { chunk, type Piece } from './chunker';

export const RATE = 48000;
export const HOP = 1920; // audio samples per latent frame (25 Hz)
export const LATENT = 64;
export const STEPS = 4;
export const WINDOW = 100; // frames per decoded window
export const CONTEXT = 8; // frames decoded on each side of a window
const MAX_WORD_FRAMES = 250;
const MAX_FRAMES = 3000;
const SENTENCE_PAUSE = 0.25; // as the chunker's

export type Stage = 'text' | 'sound' | 'decoder';
export const STAGES: Stage[] = ['text', 'sound', 'decoder'];

// ── the runtime, kept small ─────────────────────────────────────────────────

export type TensorData = Float32Array | BigInt64Array;
export type Feeds = Record<string, { data: TensorData; dims: number[] }>;
export type Outputs = Record<string, { data: unknown; dims: readonly number[] }>;

/** One loaded graph. */
export interface Session { run(feeds: Feeds): Promise<Outputs> }

/** What the pipeline needs from onnxruntime: a graph by name, loaded once. */
export interface Runtime { load(stage: Stage): Promise<Session> }

/** The part of `onnxruntime-node` / `onnxruntime-react-native` used here; both export it. */
export interface Ort {
  InferenceSession: { create(path: string, options?: object): Promise<{ run(feeds: any): Promise<any> }> };
  Tensor: new (type: 'float32' | 'int64', data: TensorData, dims: readonly number[]) => unknown;
}

/** A Runtime over either onnxruntime: `path(stage)` is where that graph's file is. */
export function ortRuntime(ort: Ort, path: (stage: Stage) => string, options: object = {}): Runtime {
  return {
    async load(stage) {
      const session = await ort.InferenceSession.create(path(stage), { executionProviders: ['cpu'], ...options });
      return {
        async run(feeds) {
          const tensors: Record<string, unknown> = {};
          for (const [name, t] of Object.entries(feeds)) {
            tensors[name] = new ort.Tensor(t.data instanceof Float32Array ? 'float32' : 'int64', t.data, t.dims);
          }
          return session.run(tensors);
        },
      };
    },
  };
}

// ── host steps (tts/common.py) ──────────────────────────────────────────────

/** Each letter's word index and the index of its word's first letter (common.words). */
export function words(text: string): { cw: number[]; wstart: number[] } {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] !== ' ' && (i === 0 || text[i - 1] === ' ')) starts.push(i);
  if (!starts.length) starts.push(0);
  const bounds = [0, ...starts.slice(1), text.length];
  const cw: number[] = [], wstart: number[] = [];
  for (let w = 0; w < bounds.length - 1; w++) {
    for (let i = bounds[w]; i < bounds[w + 1]; i++) { cw.push(w); wstart.push(bounds[w]); }
  }
  return { cw, wstart };
}

const roundHalfEven = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** Letter durations to frames per word, each frame's word and its position in the word (common.plan). */
export function plan(dur: ArrayLike<number>, cw: number[], speed = 1.0) {
  const sp = Math.fround(speed);
  const sums = new Float32Array(cw[cw.length - 1] + 1);
  for (let i = 0; i < cw.length; i++) sums[cw[i]] = Math.fround(sums[cw[i]] + Math.fround(Math.fround(dur[i]) / sp));
  const n = Array.from(sums, (s) => Math.min(MAX_WORD_FRAMES, Math.max(1, roundHalfEven(s))));
  const frames = Math.min(n.reduce((a, b) => a + b, 0), MAX_FRAMES);
  const fw = new BigInt64Array(frames);
  const fp = new Float32Array(frames);
  let f = 0;
  for (let w = 0; w < n.length && f < frames; w++) {
    for (let k = 0; k < n[w] && f < frames; k++, f++) { fw[f] = BigInt(w); fp[f] = k / n[w]; }
  }
  return { wordFrames: n, fw, fp, frames };
}

// splitmix64 in 32-bit halves: Hermes has BigInt, but 2 x 4 x T x 64 BigInt mixes per piece are slow.
function mul64(ah: number, al: number, bh: number, bl: number): [number, number] {
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  const lo = ((mid & 0xffff) << 16 | (p00 & 0xffff)) >>> 0;
  const carry = (mid >>> 16) + (p01 >>> 16) + (p10 >>> 16) + p11;
  const hi = (carry + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
  return [hi, lo];
}

function add64(ah: number, al: number, bh: number, bl: number): [number, number] {
  const lo = al + bl;
  return [(ah + bh + (lo > 0xffffffff ? 1 : 0)) >>> 0, lo >>> 0];
}

const GOLDEN = [0x9e3779b9, 0x7f4a7c15], M1 = [0xbf58476d, 0x1ce4e5b9], M2 = [0x94d049bb, 0x133111eb];

function xorShift(h: number, l: number, s: number): [number, number] {
  // z ^ (z >> s) for 0 < s < 32
  return [(h ^ (h >>> s)) >>> 0, (l ^ ((l >>> s) | (h << (32 - s)))) >>> 0];
}

/** splitmix64 of counter `index` under `seed`, as a uniform in (0, 1]: ((draw >> 11) + 1) / 2**53. */
function uniform(seedH: number, seedL: number, index: number): number {
  // (index + 1) * GOLDEN + seed, mod 2**64
  const i = index + 1;
  let [h, l] = mul64(Math.floor(i / 0x100000000) >>> 0, i >>> 0, GOLDEN[0], GOLDEN[1]);
  [h, l] = add64(h, l, seedH, seedL);
  [h, l] = xorShift(h, l, 30);
  [h, l] = mul64(h, l, M1[0], M1[1]);
  [h, l] = xorShift(h, l, 27);
  [h, l] = mul64(h, l, M2[0], M2[1]);
  [h, l] = xorShift(h, l, 31);
  // z >> 11 is 53 bits: h * 2**21 + (l >>> 11)
  return (h * 2097152 + (l >>> 11) + 1) / 9007199254740992;
}

/** float32 [STEPS, frames, LATENT] Gaussian noise (common.noise): element k is Box-Muller of draws 2k, 2k+1. */
export function noise(seed: number, frames: number): Float32Array {
  const out = new Float32Array(STEPS * frames * LATENT);
  const sh = Math.floor(seed / 0x100000000) >>> 0, sl = seed >>> 0;
  for (let k = 0; k < out.length; k++) {
    const u1 = uniform(sh, sl, 2 * k), u2 = uniform(sh, sl, 2 * k + 1);
    out[k] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
  return out;
}

/** The decoder's windows over `frames`: [start, end) pairs; the first may be shorter, for streaming. */
export function windows(frames: number, first = WINDOW): [number, number][] {
  const spans: [number, number][] = [];
  for (let s = 0; s < frames;) {
    const e = Math.min(frames, s + (s === 0 ? first : WINDOW));
    spans.push([s, e]);
    s = e;
  }
  return spans;
}

// ── what is said, in pieces ─────────────────────────────────────────────────

const SENTENCE_END = /[.!?]+["')]*(?= )/g;

/** Spoken text as the pieces the engine reads one at a time: sentence by sentence, so the first one can
 *  be heard while the rest is still being made, and each sentence through EMA's chunker so none is
 *  longer than the model reads in one pass. Each carries the silence that follows it. */
export function pieces(spoken: string, speed = 1.0): Piece[] {
  const out: Piece[] = [];
  let from = 0;
  const cuts = Array.from(spoken.matchAll(SENTENCE_END), (m) => m.index! + m[0].length);
  for (const end of [...cuts, spoken.length]) {
    const sentence = spoken.slice(from, end);
    from = end;
    const parts = chunk(sentence, speed);
    if (!parts.length) continue;
    if (out.length) out[out.length - 1].pause = Math.max(out[out.length - 1].pause, SENTENCE_PAUSE);
    out.push(...parts);
  }
  if (out.length) out[out.length - 1].pause = 0;
  return out;
}

// ── the engine ──────────────────────────────────────────────────────────────

export type Timings = { loadMs: number; warmMs: number };

export type SynthOptions = {
  seed?: number;
  speed?: number;
  /** Frames in the first decoded window; the rest are WINDOW. */
  first?: number;
  /** Asked between graph runs; true stops the piece where it is. */
  cancelled?: () => boolean;
};

export class Cancelled extends Error {
  constructor() { super('cancelled'); }
}

/** The three graphs, loaded once and run piece by piece. Not reentrant: one piece at a time. */
export class Engine {
  private sessions: Record<Stage, Session> | null = null;
  private loading: Promise<Timings> | null = null;
  timings: Timings | null = null;

  constructor(private runtime: Runtime, private now: () => number = () => Date.now()) {}

  get ready(): boolean { return this.sessions != null; }

  /** Load the graphs and run one short piece through them, once; later calls get the same promise. */
  load(): Promise<Timings> {
    if (!this.loading) {
      this.loading = (async () => {
        const t0 = this.now();
        const loaded = {} as Record<Stage, Session>;
        for (const stage of STAGES) loaded[stage] = await this.runtime.load(stage);
        const t1 = this.now();
        // The first run of a graph allocates; do it here and not under the first answer.
        await this.run(loaded, letterIds('tamam.'), 'tamam.', {});
        this.sessions = loaded;
        this.timings = { loadMs: t1 - t0, warmMs: this.now() - t1 };
        return this.timings;
      })();
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  /** Audio for one piece of spoken text (frontend output), 48 kHz mono float32. */
  async synthesise(spoken: string, options: SynthOptions = {}): Promise<Float32Array> {
    if (!this.sessions) throw new Error('EMA is not loaded');
    return this.run(this.sessions, letterIds(spoken), spoken, options);
  }

  private async run(s: Record<Stage, Session>, ids: number[], spoken: string, o: SynthOptions): Promise<Float32Array> {
    const stop = () => { if (o.cancelled?.()) throw new Cancelled(); };
    const L = ids.length;
    const { cw, wstart } = words(spoken);
    const i64 = (a: number[]) => BigInt64Array.from(a, (x) => BigInt(x));
    const text = await s.text.run({ ids: { data: i64(ids), dims: [1, L] } });
    stop();
    const h = text.h, dur = text.dur;
    const durData = dur.data as Float32Array;
    const p = plan(durData, cw, o.speed ?? 1.0);
    const sound = await s.sound.run({
      h: { data: h.data as Float32Array, dims: [...h.dims] },
      dur: { data: durData, dims: [...dur.dims] },
      cw: { data: i64(cw), dims: [1, L] },
      wstart: { data: i64(wstart), dims: [1, L] },
      fw: { data: p.fw, dims: [1, p.frames] },
      fp: { data: p.fp, dims: [1, p.frames] },
      noise: { data: noise(o.seed ?? 0, p.frames), dims: [1, STEPS, p.frames, LATENT] },
    });
    stop();
    const latents = sound.latents.data as Float32Array;
    const T = p.frames;
    const audio = new Float32Array(T * HOP);
    for (const [a0, e] of windows(T, o.first)) {
      const a = Math.max(0, a0 - CONTEXT), b = Math.min(T, e + CONTEXT);
      const out = await s.decoder.run({ z: { data: latents.slice(a * LATENT, b * LATENT), dims: [1, b - a, LATENT] } });
      stop();
      const wave = out.audio.data as Float32Array;
      audio.set(wave.subarray((a0 - a) * HOP, (e - a) * HOP), a0 * HOP);
    }
    return audio;
  }
}

/** Written Turkish to the pieces the engine reads. */
export function prepare(text: string, speed = 1.0): Piece[] {
  return pieces(frontend(text), speed);
}
