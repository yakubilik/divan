'use dom';
/* The app's toasts, drawn by Rare UI's Toaster, the repository's own file
 * (src/rareui/components/ui/toast.tsx). The native side hands over the newest
 * message; a new id is a new toast.
 * Rare UI (rareui.com) by Swami Malode, MIT + Commons Clause + Attribution. */
import './dom.css';
import { useEffect } from 'react';
import Toaster, { toast } from '@/components/ui/toast';
import type { DOMProps } from 'expo/dom';

if (typeof document !== 'undefined') document.documentElement.classList.add('dark');

export default function RareToast({ msg }: {
  msg: { id: number; text: string; kind: 'success' | 'error' | 'info' } | null; dom?: DOMProps;
}) {
  useEffect(() => {
    if (!msg) return;
    if (msg.kind === 'error') toast.error(msg.text);
    else if (msg.kind === 'info') toast.info(msg.text);
    else toast.success(msg.text);
  }, [msg?.id]);
  return <Toaster position="top-center" />;
}
