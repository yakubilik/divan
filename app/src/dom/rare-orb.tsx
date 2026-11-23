'use dom';
/* The call's orb: Rare UI's MatrixOrb, the repository's own file
 * (src/rareui/components/ui/matrix-orb.tsx), drawn in a DOM island.
 * Rare UI (rareui.com) by Swami Malode, MIT + Commons Clause + Attribution. */
import './dom.css';
import MatrixOrb, { type MatrixOrbState } from '@/components/ui/matrix-orb';
import type { DOMProps } from 'expo/dom';

if (typeof document !== 'undefined') document.documentElement.classList.add('dark');

export default function RareOrb({ state, level, color, size }: {
  state: MatrixOrbState; level?: number; color?: string; size?: number; dom?: DOMProps;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh' }}>
      <MatrixOrb state={state} level={level} color={color} size={size} labels={{ idle: '', listening: '', thinking: '' }} />
    </div>
  );
}
