/** A menu that belongs to this app, anchored under whatever opened it.
 *
 *  iOS's own action sheet was what this replaced. It slides up from the bottom
 *  of the screen in the system's typography and the system's grey, so it reads
 *  as the phone interrupting rather than the app answering — and it arrives far
 *  from the button that was pressed, which on a large phone is most of a screen
 *  away from the thumb that pressed it.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '../theme';

export interface MenuItem {
  label: string;
  onPress?: () => void;
  /** Drawn in the warning colour; still just an item, the confirmation is the
   *  caller's business. */
  destructive?: boolean;
  /** A tick on the right: for a menu that shows a current choice. */
  checked?: boolean;
  disabled?: boolean;
}

interface Anchor { x: number; y: number; width: number; height: number }
interface Open { anchor: Anchor; items: MenuItem[]; title?: string }

const MARGIN = 10;
const WIDTH = 240;

/** Measure the element that opens a menu. Give the ref to the trigger. */
export function useAnchoredMenu() {
  const [open, setOpen] = useState<Open | null>(null);
  const ref = useRef<View | null>(null);

  const show = useCallback((items: MenuItem[], title?: string) => {
    const node = ref.current;
    if (!node) return setOpen({ anchor: { x: 0, y: 0, width: 0, height: 0 }, items, title });
    node.measureInWindow((x, y, width, height) => setOpen({ anchor: { x, y, width, height }, items, title }));
  }, []);

  const close = useCallback(() => setOpen(null), []);
  return { ref, show, close, open };
}

export function AnchoredMenu({ state, onClose }: { state: Open | null; onClose: () => void }) {
  if (!state) return null;
  const win = Dimensions.get('window');
  const { anchor } = state;
  // Hangs from the trigger, pulled back inside the screen when the trigger sits
  // near an edge — a menu half off the side is worse than one slightly askew.
  const left = Math.min(Math.max(MARGIN, anchor.x + anchor.width - WIDTH), win.width - WIDTH - MARGIN);
  const below = anchor.y + anchor.height + 6;
  const room = win.height - below - MARGIN;
  const flip = room < 180 && anchor.y > win.height / 2;
  const maxHeight = flip ? anchor.y - MARGIN * 2 : room;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.card,
          { left, width: WIDTH, maxHeight },
          flip ? { bottom: win.height - anchor.y + 6 } : { top: below },
        ]}
      >
        {!!state.title && (
          <Text numberOfLines={1} style={[type.caption, styles.title]}>{state.title}</Text>
        )}
        <ScrollView bounces={false}>
          {state.items.map((it, i) => (
            <Pressable
              key={`${it.label}-${i}`}
              disabled={it.disabled}
              onPress={() => { onClose(); it.onPress?.(); }}
              style={({ pressed }) => [
                styles.row,
                i > 0 && styles.divider,
                pressed && { backgroundColor: colors.surface2 },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  type.body,
                  { color: it.disabled ? colors.faint : it.destructive ? colors.accent : colors.text, flex: 1 },
                ]}
              >
                {it.label}
              </Text>
              {it.checked && <Text style={[type.body, { color: colors.muted }]}>✓</Text>}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  title: {
    color: colors.muted,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    letterSpacing: 0,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
