import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { ICON_BOX, ICON_PATHS } from '../icons.gen';
import { useColors } from '../theme';

type Cut = { weight: number; opsz: number; d: string };

/** name -> every cut of it that was generated. */
const CUTS: Record<string, Cut[]> = {};
for (const [key, d] of Object.entries(ICON_PATHS)) {
  const [name, w, o] = key.split(':');
  (CUTS[name] ||= []).push({ weight: Number(w), opsz: Number(o), d });
}

/** The cut the design would have drawn: the web font picks its optical size
 *  from the font size, clamped to 20-48. A size that was never generated gets
 *  the nearest one, weight first. */
function pick(name: string, size: number, weight: number): string | null {
  const cuts = CUTS[name];
  if (!cuts) return null;
  const opsz = Math.max(20, Math.min(48, Math.round(size)));
  let best = cuts[0];
  let score = Infinity;
  for (const c of cuts) {
    const s = Math.abs(c.weight - weight) * 10 + Math.abs(c.opsz - opsz);
    if (s < score) { score = s; best = c; }
  }
  return best.d;
}

/** A Material Symbols Rounded glyph. `size` is the font size it is drawn at in
 *  the design, which is also the square it occupies. */
export function Icon({ name, size = 20, weight = 300, color }: {
  name: string; size?: number; weight?: number; color?: string;
}) {
  const c = useColors();
  const d = pick(name, size, weight);
  if (!d) {
    if (__DEV__) console.warn(`icon: ${name} was not generated (scripts/gen-icons.py)`);
    return null;
  }
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`}>
      <Path d={d} fill={color ?? c.ink} />
    </Svg>
  );
}
