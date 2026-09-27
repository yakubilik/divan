import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { Icon } from './icon';
import { Text } from './text';

/* A sheet the way the design draws it: the page stays where it is under a
 * warm dim, and a panel in the page colour comes up from the bottom. The
 * system sheets shrink the page behind them and tint it their own grey, which
 * is a different picture. Used as a route (presented `transparentModal` with
 * no animation of its own) and inside a Modal for the attach sheet. */

const Ctx = createContext<{ close: (after?: () => void) => void; pan: Record<string, any> }>({ close: (after) => after?.(), pan: {} });

/** Close the sheet this component is in, animating it away first. */
export function useSheet() { return useContext(Ctx); }

/** The title bar of a `page` sheet: a cross, the title, and an action. It is
 *  also where the sheet is dragged down from. */
export function SheetBar({ title, action, onAction, border }: { title: string; action?: string; onAction?: () => void; border?: boolean }) {
  const c = useColors();
  const { close, pan } = useSheet();
  return (
    <View {...pan} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingHorizontal: 10, paddingBottom: 10,
                            borderBottomWidth: 1, borderBottomColor: border ? c.line : 'transparent' }}>
      <Pressable onPress={() => close()} hitSlop={6} style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
        <Icon name="close" size={24} />
      </Pressable>
      <Text style={{ fontSize: 16, fontWeight: '600' }}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} style={({ pressed }) => [{ minWidth: 40, paddingHorizontal: 8, alignItems: 'flex-end' }, pressed && { opacity: 0.5 }]}>
          <Text style={{ fontSize: 15, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      ) : <View style={{ width: 40 }} />}
    </View>
  );
}

export function Sheet({ children, onClose, kind = 'fit', handle = kind === 'fit', style, top: fixedTop }: {
  children: React.ReactNode;
  onClose: () => void;
  /** A `fit` sheet that is given a top stands at that height below the
   *  status bar whatever its content, like a detent. */
  top?: number;
  /** `fit` sizes to its content (a list of computers, the model picker);
   *  `page` fills the screen below the status bar (new chat, chat settings). */
  kind?: 'fit' | 'page';
  handle?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const y = useRef(new Animated.Value(win.height)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [y, fade]);

  const close = useCallback((after?: () => void) => {
    if (done.current) return;
    done.current = true;
    setClosing(true);
    Animated.parallel([
      Animated.timing(y, { toValue: win.height, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => { onClose(); after?.(); });
  }, [y, fade, win.height, onClose]);

  // The responder is made once; it has to reach the close of this render,
  // which knows the current onClose.
  const closeRef = useRef(close);
  closeRef.current = close;

  // Pulled down past a third of its travel (or flicked), it goes; otherwise
  // it springs back.
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => { if (g.dy > 0) y.setValue(g.dy); },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 140 || g.vy > 1.1) closeRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  })).current;

  const top = kind === 'page' ? insets.top + 6 : insets.top + (fixedTop ?? 8);
  return (
    <Ctx.Provider value={{ close, pan: pan.panHandlers }}>
      <View style={StyleSheet.absoluteFill} pointerEvents={closing ? 'none' : 'auto'}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim, opacity: fade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
        </Animated.View>
        <Animated.View
          style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg,
                    borderTopLeftRadius: kind === 'page' ? 14 : 22, borderTopRightRadius: kind === 'page' ? 14 : 22,
                    overflow: 'hidden', transform: [{ translateY: y }] },
                  kind === 'page' || fixedTop != null ? { top } : { maxHeight: win.height - top }, style]}>
          {handle && (
            <View {...pan.panHandlers} hitSlop={{ top: 10, bottom: 14 }} style={{ paddingTop: 8 }}>
              <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.lineStrong, alignSelf: 'center' }} />
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    </Ctx.Provider>
  );
}
