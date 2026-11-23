import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { Icon, Text } from './ui';

/** A word that something worked, dropped from the top of the screen and gone
 *  again: "Copied", "Saved". After Rare UI's toast (rareui.com, MIT + Commons
 *  Clause + Attribution, © Swami Malode), redrawn for React Native.
 *
 *  One at a time: a second toast replaces the first rather than stacking, a
 *  phone's top edge has room for one line. Nothing waits on it and nothing can
 *  be pressed in it; a toast that needs an answer is a dialog. */
export type ToastKind = 'success' | 'error' | 'info';
type Shown = { id: number; text: string; kind: ToastKind };

let listener: ((t: Shown) => void) | null = null;
let seq = 0;

export function toast(text: string, kind: ToastKind = 'success') {
  listener?.({ id: ++seq, text, kind });
}

const HOLD_MS = 1800;

export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<Shown | null>(null);
  const y = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (t) => {
      setShown(t);
      if (timer.current) clearTimeout(timer.current);
      y.stopAnimation();
      y.setValue(0);
      Animated.spring(y, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 220, mass: 0.9 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(y, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true })
          .start(({ finished }) => { if (finished) setShown((s) => (s?.id === t.id ? null : s)); });
      }, HOLD_MS);
    };
    return () => { listener = null; if (timer.current) clearTimeout(timer.current); };
  }, [y]);

  if (!shown) return null;
  const tone = shown.kind === 'error' ? c.danger : shown.kind === 'info' ? c.ink : c.ok;
  const icon = shown.kind === 'error' ? 'error' : shown.kind === 'info' ? 'info' : 'check_circle';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 6, alignItems: 'center', zIndex: 1000 }}>
      <Animated.View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingLeft: 10, paddingRight: 14,
        borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, boxShadow: c.shadow.card,
        opacity: y.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
        transform: [
          { translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
          { scale: y.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
        ],
      }}>
        <Icon name={icon} size={18} weight={500} color={tone} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.ink }}>{shown.text}</Text>
      </Animated.View>
    </View>
  );
}
