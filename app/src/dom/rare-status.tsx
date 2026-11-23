'use dom';
/* A running turn, said the way Rare UI says it: its AiStatus, the repository's
 * own file (src/rareui/components/ui/ai-status.tsx), in a DOM island.
 * Rare UI (rareui.com) by Swami Malode, MIT + Commons Clause + Attribution. */
import './dom.css';
import AiStatus, { type AiStatusState } from '@/components/ui/ai-status';
import type { DOMProps } from 'expo/dom';

if (typeof document !== 'undefined') document.documentElement.classList.add('dark');

export default function RareStatus({ state, label, detail, elapsed }: {
  state: AiStatusState; label?: string; detail?: string; elapsed?: number; dom?: DOMProps;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
      <AiStatus state={state} label={label} detail={detail} elapsed={elapsed} />
    </div>
  );
}
