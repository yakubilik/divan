import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { useT } from '../store';
import type { ProviderCatalog } from '../protocol';
import RareModels from '../dom/rare-models';
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

/** The model a chat answers with, in the composer. A tap unfolds Rare UI's own
 *  ModelPicker (`src/dom/rare-models.tsx`, rareui.com, MIT + Commons Clause +
 *  Attribution, © Swami Malode) over the composer; a pick switches the chat at
 *  once. Everything else the model sheet holds (effort, sign-in, permissions)
 *  is the row under it. */
export function ModelPill({ label, disabled, onOpenSheet, models, current, onPick, defaultOpen }: {
  label: string; disabled?: boolean; onOpenSheet: () => void;
  models?: PillModel[]; current?: string; onPick?: (id: string) => void;
  /** Development fixtures only: drawn open. */
  defaultOpen?: boolean;
}) {
  const c = useColors();
  const T = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const quick = !!models?.length && !!onPick;
  const picked = useRef(false);

  useEffect(() => { if (defaultOpen) { const t = setTimeout(() => setOpen(true), 400); return () => clearTimeout(t); } }, [defaultOpen]);

  const tap = () => (quick ? setOpen(true) : onOpenSheet());
  const close = (then?: () => void) => { setOpen(false); if (then) setTimeout(then, 250); };

  return (
    <>
      <Pressable onPress={tap} disabled={disabled}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.line,
          borderRadius: 999, paddingVertical: 6, paddingLeft: 9, paddingRight: 8, opacity: disabled ? 0.45 : 1 }, pressed && { backgroundColor: c.fill }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
        <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: c.text2 }}>{label}</Text>
        <Icon name="expand_more" size={14} color={c.text2} />
      </Pressable>
      {quick && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => close()} statusBarTranslucent>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={() => close()} />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 8 }}>
            <View style={{ width, height: 400 }}>
              <RareModels value={current} models={models!.map((m) => ({ id: m.id, name: m.label, description: m.hint }))}
                onPick={async (id) => { if (picked.current) return; picked.current = true; close(() => { picked.current = false; if (id !== current) onPick!(id); }); }}
                dom={{ style: { flex: 1, backgroundColor: 'transparent' }, scrollEnabled: false }} />
            </View>
            <Pressable onPress={() => close(onOpenSheet)}
              style={({ pressed }) => [{ marginHorizontal: 16, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
                borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong }, pressed && { backgroundColor: c.fill }]}>
              <Icon name="tune" size={18} color={c.muted} />
              <Text style={{ fontSize: 14, color: c.text2 }}>{T('modelMore')}</Text>
            </Pressable>
          </View>
        </Modal>
      )}
    </>
  );
}
