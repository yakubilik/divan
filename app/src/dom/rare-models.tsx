'use dom';
/* The model switcher: Rare UI's ModelPicker, the repository's own file
 * (src/rareui/components/ui/model-picker.tsx). It unfolds out of its own pill;
 * a pick goes back to the native side, which saves it on the chat.
 * Rare UI (rareui.com) by Swami Malode, MIT + Commons Clause + Attribution. */
import './dom.css';
import { useEffect } from 'react';
import ModelPicker from '@/components/ui/model-picker';
import type { DOMProps } from 'expo/dom';

if (typeof document !== 'undefined') document.documentElement.classList.add('dark');

export default function RareModels({ models, value, onPick }: {
  models: { id: string; name: string; description?: string }[];
  value?: string; onPick: (id: string) => Promise<void>; dom?: DOMProps;
}) {
  // The native pill was the tap; this one opens on arrival rather than asking for a second.
  useEffect(() => { const t = setTimeout(() => document.querySelector<HTMLButtonElement>('button')?.click(), 80); return () => clearTimeout(t); }, []);
  return (
    <div style={{ position: 'fixed', left: 8, bottom: 8 }}>
      <ModelPicker models={models} value={value} onChange={(id) => void onPick(id)} searchable={models.length > 6} />
    </div>
  );
}
