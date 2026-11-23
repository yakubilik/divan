import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RareToast from '../dom/rare-toast';

/** A word that something worked, dropped from the top of the screen: "Copied",
 *  "Saved". Drawn by Rare UI's own Toaster (`src/dom/rare-toast.tsx`, rareui.com,
 *  MIT + Commons Clause + Attribution, © Swami Malode) in a see-through island
 *  over the top of the app that no touch lands on.
 *
 *  Nothing waits on a toast and nothing can be pressed in it; a toast that
 *  needs an answer is a dialog. */
export type ToastKind = 'success' | 'error' | 'info';
type Msg = { id: number; text: string; kind: ToastKind };

let listener: ((t: Msg) => void) | null = null;
let seq = 0;

export function toast(text: string, kind: ToastKind = 'success') {
  listener?.({ id: ++seq, text, kind });
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<Msg | null>(null);
  // The island is only on screen from the first toast on: a web view that has
  // nothing to show yet need not be loaded at launch.
  useEffect(() => { listener = setMsg; return () => { listener = null; }; }, []);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top, height: 120, zIndex: 1000 }}>
      <RareToast msg={msg} dom={{ style: { flex: 1, backgroundColor: 'transparent' }, scrollEnabled: false }} />
    </View>
  );
}
