// Who reads an answer out: EMA on the phone for Turkish when it is loaded, the system voice otherwise —
// and the system voice again, for that answer, the moment EMA fails or is slow to start. No React and no
// native module in here; src/voice.ts hands it the real engine, player and expo-speech, the node test
// hands it fakes, so the choice and the stop that the call depends on are checked without a phone.

import type { Piece } from './chunker';

/** EMA as the speaker sees it. */
export interface Ema {
  ready(): boolean;
  /** Written text to the pieces read one at a time. */
  prepare(text: string): Piece[];
  /** One piece's audio, 48 kHz mono float32. Rejects when `cancelled()` turns true part way. */
  synthesise(spoken: string, options: { seed: number; cancelled: () => boolean }): Promise<Float32Array>;
}

/** Plays PCM pieces back to back. One per utterance. */
export interface Player {
  /** Queue a piece after whatever is queued, followed by `pause` seconds of silence. */
  enqueue(pcm: Float32Array, pause: number): void;
  /** Everything has been queued; `onDrained` once it has all been heard. */
  finish(onDrained: () => void): void;
  /** Silence now, and drop whatever is queued. */
  stop(): void;
}

/** The system voice (expo-speech). `onDone` may come from its own stop as well. */
export interface SystemVoice {
  speak(text: string, lang: string, onDone: () => void): void;
  stop(): void;
}

export type Timers = {
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (h: any) => void;
  now: () => number;
};

export type SpeakerDeps = {
  ema: () => Ema | null;
  /** Whether the person wants EMA for Turkish (the call screen's switch). */
  enabled: () => boolean;
  player: () => Player;
  system: SystemVoice;
  timers?: Timers;
  log?: (line: string) => void;
  /** No audio handed to the player this long after speak: the system voice reads it instead. */
  firstAudioMs?: number;
};

export type Stats = { firstChunkMs: number | null; rtf: number | null; fellBack: string | null };

export const FIRST_AUDIO_MS = 1500;
const RATE = 48000;

export const isTurkish = (lang: string) => /^tr\b/i.test(lang || '');

type Utterance = { kind: 'ema' | 'system'; cancelled: boolean; done: () => void; player: Player | null; timer: unknown };

export function createSpeaker(deps: SpeakerDeps) {
  const timers: Timers = deps.timers ?? { setTimeout, clearTimeout, now: () => Date.now() };
  const log = deps.log ?? (() => {});
  const limit = deps.firstAudioMs ?? FIRST_AUDIO_MS;
  let current: Utterance | null = null;
  let stats: Stats = { firstChunkMs: null, rtf: null, fellBack: null };

  const once = (f: () => void) => {
    let called = false;
    return () => { if (!called) { called = true; f(); } };
  };

  /** True when the next Turkish answer would be read by EMA. */
  function wouldUseEma(lang: string): boolean {
    if (!isTurkish(lang) || !deps.enabled()) return false;
    try { return !!deps.ema()?.ready(); } catch { return false; }
  }

  function system(u: Utterance, text: string, lang: string) {
    u.kind = 'system';
    deps.system.speak(text, lang, u.done);
  }

  /** EMA gives up on this utterance; the system voice reads `text` (all of it, or what is left). */
  function fallBack(u: Utterance, text: string, lang: string, why: string) {
    if (u.cancelled || u.kind !== 'ema') return;
    u.cancelled = true;               // stops the synthesis loop at its next step
    timers.clearTimeout(u.timer);
    stats = { ...stats, fellBack: why };
    log(`ema: falling back to the system voice (${why})`);
    u.player?.stop();
    const next: Utterance = { kind: 'system', cancelled: false, done: u.done, player: null, timer: null };
    if (current === u) current = next;
    const finished = u.done;
    next.done = once(() => { if (current === next) current = null; finished(); });
    system(next, text, lang);
  }

  async function read(u: Utterance, ema: Ema, text: string, pieces: Piece[], lang: string, start: number) {
    let handed = 0, made = 0, spent = 0;
    try {
      for (let i = 0; i < pieces.length; i++) {
        if (u.cancelled) return;
        const t = timers.now();
        const pcm = await ema.synthesise(pieces[i].text, { seed: i, cancelled: () => u.cancelled });
        if (u.cancelled) return;
        spent += timers.now() - t;
        made += pcm.length / RATE;
        if (!pcm.length) continue;
        if (handed === 0) {
          timers.clearTimeout(u.timer);
          stats = { ...stats, firstChunkMs: timers.now() - start };
          log(`ema: first chunk after ${stats.firstChunkMs} ms`);
        }
        u.player!.enqueue(pcm, pieces[i].pause);
        handed = i + 1;
      }
    } catch (e: any) {
      if (u.cancelled) return;
      if (!handed) { fallBack(u, text, lang, `error: ${e?.message ?? e}`); return; }
      const rest = pieces.slice(handed).map((p) => p.text).join(' ');
      // What was made is already playing; the system voice picks up after it.
      log(`ema: error after ${handed} of ${pieces.length} pieces: ${e?.message ?? e}`);
      timers.clearTimeout(u.timer);
      u.player!.finish(() => {
        if (u.cancelled) return;
        u.kind = 'system';
        u.player = null;
        deps.system.speak(rest, lang, u.done);
      });
      return;
    }
    if (u.cancelled) return;
    if (!handed) { fallBack(u, text, lang, 'no audio'); return; }
    stats = { ...stats, rtf: made > 0 ? spent / 1000 / made : null };
    log(`ema: ${made.toFixed(2)} s of audio in ${(spent / 1000).toFixed(2)} s, RTF ${stats.rtf?.toFixed(3)}`);
    u.player!.finish(() => { if (!u.cancelled) u.done(); });
  }

  function speak(text: string, lang: string, onDone: () => void) {
    if (current) stop();
    const u: Utterance = { kind: 'system', cancelled: false, done: () => {}, player: null, timer: null };
    u.done = once(() => { if (current === u) current = null; onDone(); });
    current = u;
    if (!wouldUseEma(lang)) { system(u, text, lang); return; }

    const start = timers.now();
    let ema: Ema, pieces: Piece[];
    try {
      ema = deps.ema()!;
      pieces = ema.prepare(text);
    } catch (e: any) {
      log(`ema: could not prepare the text: ${e?.message ?? e}`);
      system(u, text, lang);
      return;
    }
    if (!pieces.length) { system(u, text, lang); return; }
    u.kind = 'ema';
    stats = { firstChunkMs: null, rtf: null, fellBack: null };
    try {
      u.player = deps.player();
    } catch (e: any) {
      fallBack(u, text, lang, `player: ${e?.message ?? e}`);
      return;
    }
    u.timer = timers.setTimeout(() => fallBack(u, text, lang, `no audio in ${limit} ms`), limit);
    void read(u, ema, text, pieces, lang, start);
  }

  /** Silence now. The utterance's onDone still comes, once, a moment later — as expo-speech's onStopped
   *  does — so a caller that stops and moves on in the same tick is already in its next state then. */
  function stop() {
    const u = current;
    current = null;
    if (!u) { try { deps.system.stop(); } catch {} return; }
    const wasEma = u.kind === 'ema';
    u.cancelled = true;
    timers.clearTimeout(u.timer);
    try { u.player?.stop(); } catch {}
    try { deps.system.stop(); } catch {}
    if (wasEma) timers.setTimeout(u.done, 0);
  }

  return { speak, stop, wouldUseEma, stats: () => stats };
}
