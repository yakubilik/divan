import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, PanResponder, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, type LayoutRectangle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStore, useT } from '../src/store';
import { client } from '../src/ws';
import { colors, radius, type } from '../src/theme';
import { Back, Spinner } from '../src/components/ui';

/** The computer's screen, in your hand.
 *
 *  Deliberately small in scope: a few frames a second and a pointer, for the
 *  dialog no agent can answer and the button no tool can press. Everything here
 *  is a thin skin over two daemon calls — a JPEG over HTTP, and `screen.input`
 *  with coordinates between 0 and 1. The phone never learns the resolution, so
 *  nothing here breaks when a monitor is plugged in.
 */

/** How long a touch can rest before it stops being a tap and starts being a
 *  right-click, and how far it can travel before it stops being a tap at all. */
const LONG_PRESS_MS = 450;
const TAP_SLOP = 8;
/** Wheel notches per point of two-finger travel. One notch is 120 on Windows;
 *  a finger moving a centimetre should turn into a line or two, not a page. */
const WHEEL_PER_PT = 3;

interface Fit { x: number; y: number; w: number; h: number }

/** Where the frame actually sits inside the box it is drawn in. `contain`
 *  letterboxes, and a touch in the letterbox is not a touch on the screen —
 *  without this every click lands offset by the size of the black bar. */
function fit(box: LayoutRectangle | null, aspect: number): Fit | null {
  if (!box || !box.width || !box.height || !aspect) return null;
  const boxAspect = box.width / box.height;
  if (boxAspect > aspect) {
    const w = box.height * aspect;
    return { x: (box.width - w) / 2, y: 0, w, h: box.height };
  }
  const h = box.width / aspect;
  return { x: 0, y: (box.height - h) / 2, w: box.width, h };
}

// The arrows and the escape key are the same everywhere; copy and paste are
// not. The daemon takes 'ctrl' at face value and does not quietly turn it into
// Command on a Mac — ^C in a terminal is half the reason anyone opens this
// screen — so the client is the one that has to know which machine it is
// driving, and it is told in screen.info.
const keysFor = (mac: boolean): { label: string; key: string; mods?: string[] }[] => [
  { label: 'esc', key: 'escape' },
  { label: 'tab', key: 'tab' },
  { label: '⏎', key: 'enter' },
  { label: '⌫', key: 'backspace' },
  { label: '←', key: 'left' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: '→', key: 'right' },
  { label: mac ? '⌘C' : '^C', key: 'c', mods: [mac ? 'cmd' : 'ctrl'] },
  { label: mac ? '⌘V' : '^V', key: 'v', mods: [mac ? 'cmd' : 'ctrl'] },
];

export default function Screen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const host = useStore((s) => s.host);
  const conn = useStore((s) => s.conn);
  const hostInfo = useStore((s) => s.hostInfo);

  const [caps, setCaps] = useState<{ view: boolean; control: boolean; enabled: boolean; os?: string; reason?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);

  // Two frames alternating. One <Image> swapping its uri goes blank between
  // pictures, which at five a second is a strobe; loading into the hidden one
  // and then showing it means the view is never empty.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState(0);
  const tick = useRef(0);
  const alive = useRef(true);

  const base = host ? `http://${host.host}:${host.port}` : null;

  const nextFrame = useCallback(() => {
    if (!alive.current || !base || !host) return;
    tick.current += 1;
    const uri = `${base}/screen.jpg?token=${encodeURIComponent(host.token)}&w=1280&t=${tick.current}`;
    setSlots((s) => (front === 0 ? [s[0], uri] : [uri, s[1]]));
  }, [base, host, front]);

  // Each frame asks for the next one once it has arrived, so the phone never
  // queues requests it cannot draw — a slow link simply runs at fewer frames a
  // second instead of falling further behind with every one.
  const onFrame = useCallback(() => {
    if (!alive.current) return;
    setFront((f) => (f === 0 ? 1 : 0));
    setError(null);
    setTimeout(() => nextFrame(), 60);
  }, [nextFrame]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (conn !== 'online') return;
    let gone = false;
    client.call<any>('screen.info', {})
      .then((r) => { if (!gone) { setCaps(r); if (r.view) nextFrame(); } })
      .catch((e) => !gone && setError(e?.message ?? 'Could not ask the computer about its screen'));
    return () => { gone = true; };
  }, [conn]);

  const send = useCallback((...actions: any[]) => {
    client.call('screen.input', { actions }).catch((e: any) => {
      setError(e?.message ?? 'That did not go through');
    });
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const r = await client.call<any>('screen.enable', { enabled: true });
      setCaps((c) => (c ? { ...c, enabled: r.enabled } : c));
    } catch (e: any) {
      Alert.alert(T('error'), e?.message ?? 'Could not turn control on');
    } finally { setBusy(false); }
  }, [T]);

  // ── touch ──────────────────────────────────────────────────────────────
  // One finger is the pointer, two fingers are the wheel. Everything is turned
  // into 0..1 before it leaves the phone.
  const gesture = useRef({
    startX: 0, startY: 0, startAt: 0, moved: false,
    dragging: false, longTimer: null as ReturnType<typeof setTimeout> | null,
    wheelY: 0, wheelX: 0, two: false,
  }).current;
  const fitRef = useRef<Fit | null>(null);
  fitRef.current = fit(box, aspect);

  const norm = useCallback((px: number, py: number) => {
    const f = fitRef.current;
    if (!f) return null;
    const x = (px - f.x) / f.w;
    const y = (py - f.y) / f.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const controllable = !!caps?.control && !!caps?.enabled;

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      if (!controllable) return;
      const t = e.nativeEvent;
      gesture.two = (t.touches?.length ?? 1) > 1;
      gesture.startX = t.locationX;
      gesture.startY = t.locationY;
      gesture.startAt = Date.now();
      gesture.moved = false;
      gesture.dragging = false;
      gesture.wheelY = 0;
      gesture.wheelX = 0;
      if (gesture.two) return;
      // Resting a finger is a right-click. It fires on the timer rather than on
      // release so it feels like the platform's own long-press.
      gesture.longTimer = setTimeout(() => {
        if (gesture.moved) return;
        const p = norm(gesture.startX, gesture.startY);
        if (!p) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        send({ kind: 'click', button: 'right', x: p.x, y: p.y });
        gesture.dragging = true;         // release must not also left-click
      }, LONG_PRESS_MS);
    },
    onPanResponderMove: (e, g) => {
      if (!controllable) return;
      const two = (e.nativeEvent.touches?.length ?? 1) > 1 || gesture.two;
      if (Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP) gesture.moved = true;

      if (two) {
        gesture.two = true;
        // Wheel notches are whole numbers, so travel is banked until there is
        // one to send rather than rounded away on every frame.
        gesture.wheelY += g.dy * WHEEL_PER_PT;
        gesture.wheelX += g.dx * WHEEL_PER_PT;
        const dy = Math.trunc(gesture.wheelY / 120) * 120;
        const dx = Math.trunc(gesture.wheelX / 120) * 120;
        if (dy || dx) {
          gesture.wheelY -= dy;
          gesture.wheelX -= dx;
          const p = norm(gesture.startX, gesture.startY);
          send({ kind: 'scroll', dy, dx: -dx, ...(p ?? {}) });
        }
        return;
      }

      if (!gesture.moved) return;
      if (gesture.longTimer) { clearTimeout(gesture.longTimer); gesture.longTimer = null; }
      const p = norm(e.nativeEvent.locationX, e.nativeEvent.locationY);
      if (!p) return;
      if (!gesture.dragging) {
        const from = norm(gesture.startX, gesture.startY);
        if (!from) return;
        gesture.dragging = true;
        send({ kind: 'down', button: 'left', x: from.x, y: from.y });
      }
      send({ kind: 'move', x: p.x, y: p.y });
    },
    onPanResponderRelease: (e) => {
      if (gesture.longTimer) { clearTimeout(gesture.longTimer); gesture.longTimer = null; }
      if (!controllable) return;
      if (gesture.two) { gesture.two = false; return; }
      const p = norm(e.nativeEvent.locationX, e.nativeEvent.locationY)
        ?? norm(gesture.startX, gesture.startY);
      if (!p) return;
      if (gesture.dragging) {
        send({ kind: 'up', button: 'left', x: p.x, y: p.y });
      } else {
        Haptics.selectionAsync().catch(() => {});
        send({ kind: 'click', button: 'left', x: p.x, y: p.y });
      }
      gesture.dragging = false;
    },
    onPanResponderTerminate: () => {
      if (gesture.longTimer) { clearTimeout(gesture.longTimer); gesture.longTimer = null; }
      if (gesture.dragging) send({ kind: 'up', button: 'left' });
      gesture.dragging = false;
      gesture.two = false;
    },
  })).current;

  const name = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');
  const blocked = caps && !caps.view;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}><Back /></Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.headline, { color: colors.text }]}>{name}</Text>
          <Text numberOfLines={1} style={[type.caption, { color: controllable ? colors.warning : colors.muted }]}>
            {blocked ? (caps?.reason ?? 'no screen here')
              : controllable ? 'control is on'
              : caps?.control === false ? (caps.reason ?? 'view only')
              : 'view only'}
          </Text>
        </View>
        {controllable && (
          <Pressable onPress={() => setTyping((t) => !t)} hitSlop={10} style={styles.chip}>
            <Text style={[type.caption, { color: typing ? colors.accent : colors.text }]}>keys</Text>
          </Pressable>
        )}
      </View>

      <View
        style={{ flex: 1 }}
        onLayout={(e) => setBox(e.nativeEvent.layout)}
        {...pan.panHandlers}
      >
        {[0, 1].map((i) => slots[i] ? (
          <Image
            key={i}
            source={{ uri: slots[i]! }}
            resizeMode="contain"
            fadeDuration={0}
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source ?? ({} as any);
              if (width && height) setAspect(width / height);
            }}
            onLoadEnd={() => { if (i !== front) onFrame(); }}
            onError={() => {
              setError('The screen could not be read. Is the computer locked?');
              setTimeout(() => nextFrame(), 1500);
            }}
            style={[StyleSheet.absoluteFillObject, { opacity: i === front ? 1 : 0 }]}
          />
        ) : null)}

        {!slots[front] && !error && (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        )}
      </View>

      {caps && caps.control && !caps.enabled && (
        <View style={styles.notice}>
          <Text style={[type.sub, { color: colors.text, flex: 1 }]}>
            You are watching. Turn control on to click and type.
          </Text>
          <Pressable onPress={enable} disabled={busy} style={styles.enableBtn}>
            {busy ? <Spinner color={colors.white} /> : <Text style={[type.sub, { color: colors.white, fontWeight: '600' }]}>Turn on</Text>}
          </Pressable>
        </View>
      )}

      {!!error && (
        <View style={styles.notice}>
          <Text style={[type.caption, { color: colors.danger, flex: 1 }]}>{error}</Text>
        </View>
      )}

      {typing && controllable && (
        <View style={{ paddingBottom: insets.bottom + 6, backgroundColor: colors.surface }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keyRow}>
            {keysFor(caps?.os === 'Darwin').map((k) => (
              <Pressable
                key={k.label}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); send({ kind: 'key', key: k.key, mods: k.mods }); }}
                style={styles.key}
              >
                <Text style={[type.sub, { color: colors.text }]}>{k.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            autoFocus
            value=""
            onChangeText={(t) => { if (t) send({ kind: 'text', text: t }); }}
            onSubmitEditing={() => send({ kind: 'key', key: 'enter' })}
            placeholder="Type onto the computer"
            placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false} spellCheck={false}
            blurOnSubmit={false}
            style={[type.body, styles.input]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: colors.surface },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface },
  enableBtn: { paddingHorizontal: 16, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  keyRow: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  key: { minWidth: 46, height: 34, paddingHorizontal: 10, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  input: { marginHorizontal: 12, marginBottom: 6, height: 40, borderRadius: radius.md, paddingHorizontal: 12, backgroundColor: colors.bg, color: colors.text },
});
