// A finger on the captcha screen, turned into what the daemon replays in the
// browser (daemon/divan/captcha.py, `input`). Kept apart from the screen so the
// one decision in it — was that a tap or a drag — can be checked on its own.

/** x and y in 0..1 across the box, and when, in milliseconds. */
export type CapPoint = [number, number, number];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** A tap if the finger stayed within `slop` points of where it landed, else a
 *  drag that keeps its timing. Nothing for an empty gesture. */
export function capPoints(pts: CapPoint[], w: number, h: number, slop = 8): any | null {
  if (!pts.length || !w || !h) return null;
  const [x0, y0] = pts[0];
  const far = pts.some(([x, y]) => Math.hypot((x - x0) * w, (y - y0) * h) > slop);
  if (!far) return { type: 'tap', x: clamp(x0), y: clamp(y0) };
  const t0 = pts[0][2];
  // A long drag is thinned, never cut: the end of it is where the piece lands.
  const step = Math.max(1, Math.ceil(pts.length / 300));
  const kept = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  return { type: 'drag', points: kept.map(([x, y, t]) => [clamp(x), clamp(y), t - t0]) };
}
