'use dom';
/* A voice note: Rare UI's VoiceNote, the repository's own file
 * (src/rareui/components/ui/voice-note.tsx), playing the note's file.
 * Rare UI (rareui.com) by Swami Malode, MIT + Commons Clause + Attribution. */
import './dom.css';
import VoiceNote from '@/components/ui/voice-note';
import type { DOMProps } from 'expo/dom';

if (typeof document !== 'undefined') document.documentElement.classList.add('dark');

export default function RareVoice({ src, duration, seed, accent }: {
  src: string; duration?: number; seed?: number; accent?: string; dom?: DOMProps;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <VoiceNote src={src} duration={duration} seed={seed} accent={accent} size="md" style={{ width: '100%' }} />
    </div>
  );
}
