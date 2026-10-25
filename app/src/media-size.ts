/** How big a photo or video bubble is drawn, the way the messengers draw one:
 *  the box takes the picture's own shape inside a fixed frame, so a phone video
 *  stays tall and a landscape one stays wide. Only a shape more extreme than
 *  the frame allows is clamped, and only then is anything cropped.
 *
 *  Pure, so `scripts/test-media.cjs` checks it without a phone. */

export interface Bounds { maxW: number; maxH: number; minW: number; minH: number }

/** The frame a single photo or video bubble lives in. 250 wide fits the
 *  80%-wide message column on the smallest phone the app runs on (iPhone SE,
 *  375 points); 330 tall is a little under half of its screen. */
export const BUBBLE: Bounds = { maxW: 250, maxH: 330, minW: 120, minH: 100 };

export interface BoxSize {
  width: number;
  height: number;
  /** The box is not the picture's shape (it was clamped, or the shape is not
   *  known yet), so filling it crops some of the picture. */
  cropped: boolean;
}

/** The box for a picture `w` × `h` pixels. An unknown size (0, negative, not
 *  a number) gets a 4:3 landscape placeholder until the real one arrives. */
export function bubbleSize(w: number | null | undefined, h: number | null | undefined, b: Bounds = BUBBLE): BoxSize {
  if (!(w! > 0) || !(h! > 0) || !isFinite(w!) || !isFinite(h!)) {
    return { width: b.maxW, height: Math.round((b.maxW * 3) / 4), cropped: true };
  }
  const scale = Math.min(b.maxW / w!, b.maxH / h!);
  const fw = w! * scale;
  const fh = h! * scale;
  const width = Math.round(Math.max(b.minW, fw));
  const height = Math.round(Math.max(b.minH, fh));
  return { width, height, cropped: fw < b.minW || fh < b.minH };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

/** What the full-screen viewer pages through: photos and videos, in order. */
export function isPhoto(a: { kind?: string; name?: string; path?: string }): boolean {
  return a.kind === 'image' || (!a.kind && IMAGE_EXT.test(a.name || a.path || ''));
}
export function isVideo(a: { kind?: string; name?: string; path?: string }): boolean {
  return a.kind === 'video' || (!a.kind && VIDEO_EXT.test(a.name || a.path || ''));
}

/** Where the viewer reads a picture from, best first: the phone's own copy
 *  (a message still being sent), then the original the message names, then the
 *  copy the computer kept for the bubble (`view`, at most 1600 px — the daemon
 *  shrinks it), which outlives the original being deleted. The bubble itself
 *  starts from `view`, since that is what it was made for. */
export function viewerSources(a: { localUri?: string; path?: string; view?: string }, url: (p: string) => string | null): string[] {
  const out: string[] = [];
  const add = (u: string | null | undefined) => { if (u && !out.includes(u)) out.push(u); };
  add(a.localUri);
  if (a.path) add(url(a.path));
  if (a.view) add(url(a.view));
  return out;
}
