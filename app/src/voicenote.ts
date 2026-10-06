// A voice bubble's decisions, away from the player that carries them out. No
// React, no expo-audio — `scripts/test-voicenote.cjs` drives all of it with
// fake players, so what a tap on the waveform seeks to, which bubble keeps
// playing and what the time under it says are checked without a phone.

/** How many bars a waveform has across the bubble. */
export const BARS = 40;

/** Heights a bar is drawn at, in points. */
export const BAR_MIN = 3;
export const BAR_MAX = 24;

/** The seek position, in seconds, for a touch `x` points from the waveform's
 *  left edge. A finger that slides past either end holds at that end. */
export function seekFor(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return Math.min(1, Math.max(0, x / width)) * duration;
}

/** How many bars, counted from the left, are drawn in the strong colour: every
 *  bar the playhead has reached. */
export function playedBars(position: number, duration: number, n = BARS): number {
  if (!(duration > 0) || !(position > 0)) return 0;
  return Math.min(n, Math.ceil((position / duration) * n));
}

// deterministic pseudo-waveform so a bubble looks the same every render
export function bars(seed: string, n = BARS): number[] {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => { h = (h * 1103515245 + 12345) >>> 0; return BAR_MIN + ((h >>> 8) % (BAR_MAX - BAR_MIN - 4)); });
}

/** The bar heights for one sound: its real loudness when the daemon measured
 *  it (`peaks`, 0-100), the made-up shape otherwise — a message from before the
 *  daemon measured anything still draws a full waveform. */
export function waveform(peaks: number[] | undefined, seed: string, n = BARS): number[] {
  if (!peaks || peaks.length === 0) return bars(seed, n);
  return Array.from({ length: n }, (_, i) => {
    const v = Math.min(100, Math.max(0, peaks[Math.floor((i * peaks.length) / n)] || 0));
    return Math.round(BAR_MIN + (v / 100) * (BAR_MAX - BAR_MIN));
  });
}

// ── speed ──────────────────────────────────────────────────────────────────

export const SPEEDS = [1, 1.5, 2] as const;

/** The speed after `rate` on the chip: 1x, 1.5x, 2x and round again. */
export function nextSpeed(rate: number): number {
  const i = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

export function speedLabel(rate: number): string {
  return `${rate}x`;
}

/** The speed last picked on any bubble, for as long as the app runs: a person
 *  who listens at 2x listens to the next note at 2x too. */
let remembered = 1;
export function rememberedSpeed(): number { return remembered; }
export function rememberSpeed(rate: number): void { remembered = rate; }

// ── where a bubble is ──────────────────────────────────────────────────────

export type Phase = 'idle' | 'playing' | 'paused';

/** Idle is at the start, or at the end it ran to; paused is stopped part way. */
export function phase(playing: boolean, position: number, duration: number): Phase {
  if (playing) return 'playing';
  if (position > 0.05 && (!(duration > 0) || position < duration - 0.05)) return 'paused';
  return 'idle';
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The time under the waveform: where it is while it plays or waits part way,
 *  how long it is otherwise. */
export function timeLabel(playing: boolean, position: number, duration: number): string {
  return fmt(phase(playing, position, duration) === 'idle' ? duration : position);
}

// ── one at a time ──────────────────────────────────────────────────────────

export interface Pausable { pause(): void }

/** The bubble playing now. Starting another pauses it, so two notes never
 *  talk over each other. */
let current: Pausable | null = null;

/** Call before `play()`: pauses whichever other player was playing. */
export function claim(p: Pausable): void {
  if (current && current !== p) {
    try { current.pause(); } catch {}
  }
  current = p;
}

/** A bubble that paused or went away gives the slot back. */
export function release(p: Pausable): void {
  if (current === p) current = null;
}

export function playingNow(): Pausable | null { return current; }
