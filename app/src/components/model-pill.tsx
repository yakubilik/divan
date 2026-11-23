import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useColors } from '../theme';
import { useT } from '../store';
import type { ProviderCatalog } from '../protocol';
import { measure, type Rect } from './overlay';
import { Icon, Text } from './ui';

/** The effort a chat keeps when it moves to `model`: the same one if the new
 *  model takes it, else high, else whatever it does take, and none for a model
 *  that takes no effort at all — carrying "max" onto one of those sent an
 *  unsupported parameter and failed the turn. The model sheet decides the same. */
export function effortFor(cat: ProviderCatalog | undefined, model: string, current: string | null | undefined): string | null {
  const next: string[] = cat?.models?.find((x) => x.id === model)?.efforts ?? cat?.efforts ?? [];
  if (next.length === 0) return null;
  return current && next.includes(current) ? current : next.includes('high') ? 'high' : next[0];
}

export type PillModel = { id: string; label: string; hint?: string };

/** The model a chat answers with, in the composer: one tap from the message
 *  being written with it. A tap opens the models right above the pill, a
 *  second tap on one switches to it; everything else the model sheet holds
 *  (effort, sign-in, permissions) is one row further. After Rare UI's model
 *  picker (rareui.com, MIT + Commons Clause + Attribution, © Swami Malode). */
export function ModelPill({ label, disabled, onOpenSheet, models, current, onPick, defaultOpen }: {
  label: string; disabled?: boolean; onOpenSheet: () => void;
  models?: PillModel[]; current?: string; onPick?: (id: string) => void;
  /** Development fixtures only: drawn open. */
  defaultOpen?: boolean;
}) {
  const c = useColors();
  const T = useT();
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const grow = useRef(new Animated.Value(0)).current;
  const { height: screenH } = useWindowDimensions();
  const quick = !!models?.length && !!onPick;

  const open = async () => {
    if (!quick) { onOpenSheet(); return; }
    const r = await measure(ref);
    setAnchor(r);
  };
  const close = (then?: () => void) => {
    Animated.timing(grow, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => { setAnchor(null); then?.(); });
  };
  useEffect(() => {
    if (!anchor) return;
    grow.setValue(0);
    Animated.spring(grow, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 260, mass: 0.8 }).start();
  }, [anchor, grow]);
  useEffect(() => {
    if (!defaultOpen) return;
    const t = setTimeout(() => void open(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  return (
    <>
      <Pressable ref={ref} onPress={() => void open()} disabled={disabled}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: anchor ? c.lineStrong : c.line,
          backgroundColor: anchor ? c.fill : 'transparent', borderRadius: 999, paddingVertical: 6, paddingLeft: 9, paddingRight: 8,
          opacity: disabled ? 0.45 : 1 }, pressed && { backgroundColor: c.fill }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
        <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: c.text2 }}>{label}</Text>
        <Icon name={anchor ? 'expand_less' : 'expand_more'} size={14} color={c.text2} />
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
        {anchor && (
          <Animated.View style={{
            position: 'absolute', left: anchor.x - 4, bottom: screenH - anchor.y + 8, minWidth: 236, maxWidth: 300,
            backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.lineStrong, boxShadow: c.shadow.card, padding: 5,
            opacity: grow.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              { scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
            ],
          }}>
            {models!.map((m) => {
              const on = m.id === current;
              return (
                <Pressable key={m.id} onPress={() => close(() => { if (!on) onPick!(m.id); })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 13 },
                    (on || pressed) && { backgroundColor: c.fill }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: on ? '600' : '500', color: c.ink }}>{m.label}</Text>
                    {!!m.hint && <Text numberOfLines={1} style={{ fontSize: 12, color: c.muted, marginTop: 1 }}>{m.hint}</Text>}
                  </View>
                  {on && <Icon name="check" size={18} weight={500} color={c.accent} />}
                </Pressable>
              );
            })}
            <View style={{ height: 1, backgroundColor: c.line, marginVertical: 4, marginHorizontal: 8 }} />
            <Pressable onPress={() => close(onOpenSheet)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 13 },
                pressed && { backgroundColor: c.fill }]}>
              <Icon name="tune" size={18} color={c.muted} />
              <Text style={{ fontSize: 14, color: c.text2 }}>{T('modelMore')}</Text>
            </Pressable>
          </Animated.View>
        )}
      </Modal>
    </>
  );
}
