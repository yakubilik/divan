import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, PanResponder, PixelRatio, Pressable, ScrollView,
  StyleSheet, View, type LayoutRectangle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useStore, useT } from '../src/store';
import { client } from '../src/ws';
import { useColors } from '../src/theme';
import { Icon, Spinner, Text, TextInput } from '../src/components/ui';
import { alert } from '../src/components/overlay';

/** The computer's screen, in your hand.
 *
 *  Deliberately small in scope: a few frames a second and a pointer, for the
 *  dialog no agent can answer and the button no tool can press. Everything here
 *  is a thin skin over two daemon calls — a JPEG over HTTP, and `screen.input`
 *  with coordinates between 0 and 1. The phone never learns the resolution, so
 *  nothing here breaks when a monitor is plugged in.
 *
 *  The canvas stays black in both themes. It is a picture of a screen with the
 *  letterbox showing, and there is no light-mode version of that.
 */

/** How long a touch can rest before it stops being a tap and starts being a
 *  right-click, and how far it can travel before it stops being a tap at all. */
const LONG_PRESS_MS = 450;
const TAP_SLOP = 8;
/** Wheel notches per point of two-finger travel. One notch is 120 on Windows;
 *  a finger moving a centimetre should turn into a line or two, not a page. */
const WHEEL_PER_PT = 3;
/** How far two fingers have to disagree before it is a pinch, and how far they
 *  have to travel together before it is anything at all. */
const PINCH_SLOP = 14;
const MAX_ZOOM = 5;

interface ViewXf { s: number; tx: number; ty: number }

/** Keep the picture over the canvas. At 1x there is nowhere to go, and at any
 *  other scale the edges may not come further in than the edge of the box. */
function clampXf(v: ViewXf, w: number, h: number): ViewXf {
  const lx = ((v.s - 1) * w) / 2;
  const ly = ((v.s - 1) * h) / 2;
  return { s: v.s, tx: Math.max(-lx, Math.min(lx, v.tx)), ty: Math.max(-ly, Math.min(ly, v.ty)) };
}

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
  const c = useColors();
  const host = useStore((s) => s.host);
  const conn = useStore((s) => s.conn);
  const hostInfo = useStore((s) => s.hostInfo);

  const [caps, setCaps] = useState<{ view: boolean; control: boolean; enabled: boolean; os?: string; reason?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  // Pinch to zoom, two fingers to move it. Plain state rather than an
  // Animated.Value because the gesture maths has to read it back on every
  // touch, and a native-driven value only reports home to JS now and then.
  const [xf, setXf] = useState<ViewXf>({ s: 1, tx: 0, ty: 0 });
  const xfRef = useRef(xf);
  xfRef.current = xf;

  // Two frames alternating. One <Image> swapping its uri goes blank between
  // pictures, which at five a second is a strobe; loading into the hidden one
  // and then showing it means the view is never empty.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState(0);
  const tick = useRef(0);
  const alive = useRef(true);

  const base = host ? `http://${host.host}:${host.port}` : null;

  // Which slot is on screen, in a ref as well as in state. `nextFrame` is
  // called from a timer set before the state has settled, and reading `front`
  // off that render loaded the next picture into the slot already showing —
  // which then fired `onLoadEnd` for the front slot, where nothing asks for
  // another frame. Two pictures in and the view froze while input kept working,
  // which is exactly what it looked like from the phone.
  const frontRef = useRef(0);
  const lastAt = useRef(0);

  const nextFrame = useCallback(() => {
    if (!alive.current || !base || !host) return;
    tick.current += 1;
    // As many pixels as the phone can actually draw, and more again when zoomed
    // in. A 1280-wide frame stretched across a 3440-wide desktop is mush, and
    // the grab is no slower for the extra — JPEG straight out of the capture
    // costs about the same at any size.
    const b = boxRef.current;
    const want = (b ? PixelRatio.getPixelSizeForLayoutSize(b.width) : 1280) * Math.min(xfRef.current.s, 2);
    const w = Math.max(640, Math.min(3840, Math.round(want)));
    const uri = `${base}/screen.jpg?token=${encodeURIComponent(host.token)}&w=${w}&q=72&t=${tick.current}`;
    const back = frontRef.current === 0 ? 1 : 0;
    setSlots((s) => (back === 1 ? [s[0], uri] : [uri, s[1]]));
  }, [base, host]);

  // Each frame asks for the next one once it has arrived, so the phone never
  // queues requests it cannot draw — a slow link simply runs at fewer frames a
  // second instead of falling further behind with every one.
  const onFrame = useCallback(() => {
    if (!alive.current) return;
    frontRef.current = frontRef.current === 0 ? 1 : 0;
    setFront(frontRef.current);
    setError(null);
    lastAt.current = Date.now();
    setTimeout(() => nextFrame(), 60);
  }, [nextFrame]);

  // A chain is only as good as its weakest link, and this one is a picture
  // loading. A frame that never arrives and never errors — a dropped request on
  // a sleeping radio — ends the stream silently. Ask again if nothing has been
  // drawn for a while; the cost of one extra request is nothing next to a view
  // that has quietly stopped.
  useEffect(() => {
    if (!caps?.view) return;
    const t = setInterval(() => {
      if (lastAt.current && Date.now() - lastAt.current > 4000) {
        lastAt.current = Date.now();
        nextFrame();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [caps?.view, nextFrame]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // A desktop is landscape and a phone is not, and the difference between the
  // two is whether this is a screen you can work on or a stamp. The route takes
  // the rotation for itself and hands it back on the way out; the rest of the
  // app stays the portrait app it was written as.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (conn !== 'online') return;
    let gone = false;
    client.call<any>('screen.info', {})
      .then((r) => { if (!gone) { setCaps(r); if (r.view) { lastAt.current = Date.now(); nextFrame(); } } })
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
      setCaps((prev) => (prev ? { ...prev, enabled: r.enabled } : prev));
    } catch (e: any) {
      alert(T('error'), e?.message ?? 'Could not turn control on');
    } finally { setBusy(false); }
  }, [T]);

  // ── touch ──────────────────────────────────────────────────────────────
  // One finger is the pointer, two fingers are the wheel. Everything is turned
  // into 0..1 before it leaves the phone.
  const gesture = useRef({
    startX: 0, startY: 0, startAt: 0, moved: false,
    dragging: false, longTimer: null as ReturnType<typeof setTimeout> | null,
    wheelY: 0, wheelX: 0, two: false,
    // What the second finger found when it arrived, and what the pair of them
    // turned out to mean.
    startDist: 0, startMidX: 0, startMidY: 0,
    startS: 1, startTx: 0, startTy: 0,
    mode: null as null | 'zoom' | 'pan' | 'wheel',
  }).current;
  const fitRef = useRef<Fit | null>(null);
  fitRef.current = fit(box, aspect);
  const boxRef = useRef<LayoutRectangle | null>(null);
  boxRef.current = box;

  const norm = useCallback((px: number, py: number) => {
    const f = fitRef.current;
    const b = boxRef.current;
    const v = xfRef.current;
    if (!f || !b) return null;
    // Undo the zoom before anything else. A finger lands on the picture as it
    // is drawn, not as it was laid out, and at 3x those are a long way apart.
    const cx = b.width / 2, cy = b.height / 2;
    const ux = cx + (px - cx - v.tx) / v.s;
    const uy = cy + (py - cy - v.ty) / v.s;
    const x = (ux - f.x) / f.w;
    const y = (uy - f.y) / f.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const controllable = !!caps?.control && !!caps?.enabled;
  // The pan responder below is built once and never rebuilt, so it cannot read
  // this off the render that made it: caps arrive after the first paint, and a
  // handler that closed over `false` would refuse every touch for the life of
  // the screen — which is exactly what it did.
  const controllableRef = useRef(false);
  controllableRef.current = controllable;

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent;
      gesture.two = (t.touches?.length ?? 1) > 1;
      gesture.startX = t.locationX;
      gesture.startY = t.locationY;
      gesture.startAt = Date.now();
      gesture.moved = false;
      gesture.dragging = false;
      gesture.wheelY = 0;
      gesture.wheelX = 0;
      gesture.mode = null;
      if (gesture.two || !controllableRef.current) return;
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
      const touches = e.nativeEvent.touches ?? [];
      if (Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP) gesture.moved = true;

      // ── two fingers ───────────────────────────────────────────────────
      // Zooming is not driving, so it works on a screen you are only allowed
      // to watch. Only the wheel below needs permission.
      if (touches.length > 1) {
        const [t0, t1] = touches;
        const dist = Math.hypot(t0.locationX - t1.locationX, t0.locationY - t1.locationY);
        const midX = (t0.locationX + t1.locationX) / 2;
        const midY = (t0.locationY + t1.locationY) / 2;
        const box = boxRef.current;

        if (!gesture.two) {
          // The second finger has just landed. Seed from here rather than from
          // wherever the first one started, and let go of any drag in progress
          // — a drag that ends in a pinch never meant to be a drag.
          gesture.two = true;
          gesture.mode = null;
          gesture.startDist = dist;
          gesture.startMidX = midX;
          gesture.startMidY = midY;
          gesture.startS = xfRef.current.s;
          gesture.startTx = xfRef.current.tx;
          gesture.startTy = xfRef.current.ty;
          gesture.wheelY = 0;
          gesture.wheelX = 0;
          if (gesture.dragging && controllableRef.current) send({ kind: 'up', button: 'left' });
          gesture.dragging = false;
          if (gesture.longTimer) { clearTimeout(gesture.longTimer); gesture.longTimer = null; }
          return;
        }

        if (!gesture.mode) {
          // Fingers changing their distance is a pinch. Fingers keeping it and
          // travelling together are the wheel at 1x, and the picture itself
          // once there is more of it than fits.
          if (Math.abs(dist - gesture.startDist) > PINCH_SLOP) gesture.mode = 'zoom';
          else if (Math.hypot(midX - gesture.startMidX, midY - gesture.startMidY) > PINCH_SLOP)
            gesture.mode = xfRef.current.s > 1.01 ? 'pan' : 'wheel';
          else return;
        }

        if (gesture.mode === 'zoom' && box && gesture.startDist > 0) {
          const s = Math.max(1, Math.min(MAX_ZOOM, gesture.startS * (dist / gesture.startDist)));
          const cx = box.width / 2, cy = box.height / 2;
          // Hold whatever is under the pinch still while the scale changes
          // around it, or zooming walks the picture off under the fingers.
          const k = s / gesture.startS;
          const tx = (gesture.startMidX - cx) - k * (gesture.startMidX - cx - gesture.startTx);
          const ty = (gesture.startMidY - cy) - k * (gesture.startMidY - cy - gesture.startTy);
          setXf(clampXf({ s, tx, ty }, box.width, box.height));
          return;
        }

        if (gesture.mode === 'pan' && box) {
          setXf(clampXf({
            s: xfRef.current.s,
            tx: gesture.startTx + (midX - gesture.startMidX),
            ty: gesture.startTy + (midY - gesture.startMidY),
          }, box.width, box.height));
          return;
        }

        if (gesture.mode === 'wheel') {
          if (!controllableRef.current) return;
          // Wheel notches are whole numbers, so travel is banked until there is
          // one to send rather than rounded away on every frame.
          gesture.wheelY += g.dy * WHEEL_PER_PT;
          gesture.wheelX += g.dx * WHEEL_PER_PT;
          const dy = Math.trunc(gesture.wheelY / 120) * 120;
          const dx = Math.trunc(gesture.wheelX / 120) * 120;
          if (dy || dx) {
            gesture.wheelY -= dy;
            gesture.wheelX -= dx;
            const p = norm(gesture.startMidX, gesture.startMidY);
            send({ kind: 'scroll', dy, dx: -dx, ...(p ?? {}) });
          }
        }
        return;
      }

      // ── one finger ────────────────────────────────────────────────────
      if (gesture.two) return;           // a finger lifted off a pinch: not a drag
      if (!controllableRef.current) return;
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
      if (gesture.two) { gesture.two = false; gesture.mode = null; return; }
      if (!controllableRef.current) return;
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
      if (gesture.dragging && controllableRef.current) send({ kind: 'up', button: 'left' });
      gesture.dragging = false;
      gesture.two = false;
      gesture.mode = null;
    },
  })).current;

  const name = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');
  const blocked = caps && !caps.view;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) => setBox(e.nativeEvent.layout)}
        {...pan.panHandlers}
      >
        {/* The zoom lives on this wrapper, not on the touch target: the gesture
            maths works in canvas coordinates and undoes the transform itself,
            and a scaled view would hand it numbers already halfway there. */}
        <View style={[StyleSheet.absoluteFillObject, {
          transform: [{ translateX: xf.tx }, { translateY: xf.ty }, { scale: xf.s }],
        }]}>
        {[0, 1].map((i) => slots[i] ? (
          <Image
            key={i}
            source={{ uri: slots[i]! }}
            resizeMode="contain"
            fadeDuration={0}
            onLoad={(e) => {
              // The aspect comes off the frame itself rather than a guess, so a
              // 16:10 Mac and a 16:9 PC both land where the finger went.
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
        </View>

        {!slots[front] && !error && (
          <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator color={c.accent} />
          </View>
        )}
      </View>

      {/* Over the picture, not above it. A bar across the top costs the desktop
          a strip of height it cannot spare on a phone held sideways, and what
          it bought was a name you already knew. These read on any wallpaper
          because they bring their own shade with them. */}
      <Pressable onPress={() => router.back()} hitSlop={10}
        style={({ pressed }) => [{ position: 'absolute', top: insets.top + 8, left: insets.left + 10,
                                   width: 34, height: 34, borderRadius: 17, alignItems: 'center',
                                   justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
                                  pressed && { opacity: 0.6 }]}>
        <Icon name="chevron_left" size={24} color="#fff" />
      </Pressable>

      <View style={{ position: 'absolute', top: insets.top + 8, right: insets.right + 10,
                     flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {xf.s > 1.01 && (
          <Pressable onPress={() => setXf({ s: 1, tx: 0, ty: 0 })} hitSlop={10}
            style={{ paddingHorizontal: 10, height: 30, borderRadius: 15, alignItems: 'center',
                     justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>{xf.s.toFixed(1)}×</Text>
          </Pressable>
        )}
        {controllable && (
          <Pressable onPress={() => setTyping((t) => !t)} hitSlop={10}
            style={{ paddingHorizontal: 12, height: 30, borderRadius: 15, alignItems: 'center',
                     justifyContent: 'center', backgroundColor: typing ? c.accent : 'rgba(0,0,0,0.45)' }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>keys</Text>
          </Pressable>
        )}
      </View>

      {/* Only when there is something to say. With control on, the screen says
          it by doing what it is told. */}
      {!controllable && (
        <View style={{ position: 'absolute', top: insets.top + 12, alignSelf: 'center',
                       paddingHorizontal: 12, paddingVertical: 5, borderRadius: 13,
                       backgroundColor: 'rgba(0,0,0,0.45)', maxWidth: '55%' }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: '#fff' }}>
            {blocked ? (caps?.reason ?? 'no screen here') : (caps?.reason ?? 'view only')}
          </Text>
        </View>
      )}

      {caps && caps.control && !caps.enabled && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16,
                       paddingVertical: 10, backgroundColor: c.card }}>
          <Text style={{ fontSize: 14, flex: 1 }}>
            You are watching. Turn control on to click and type.
          </Text>
          <Pressable onPress={enable} disabled={busy}
            style={({ pressed }) => [{ paddingHorizontal: 16, height: 34, borderRadius: 10, alignItems: 'center',
                                       justifyContent: 'center', backgroundColor: c.accent },
                                      (pressed || busy) && { opacity: 0.6 }]}>
            {busy ? <Spinner color="#fff" /> : <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Turn on</Text>}
          </Pressable>
        </View>
      )}

      {!!error && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.card }}>
          <Text style={{ fontSize: 12, color: c.accentText }}>{error}</Text>
        </View>
      )}

      {typing && controllable && (
        <View style={{ paddingBottom: insets.bottom + 6, backgroundColor: c.card }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            {keysFor(caps?.os === 'Darwin').map((k) => (
              <Pressable
                key={k.label}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); send({ kind: 'key', key: k.key, mods: k.mods }); }}
                style={({ pressed }) => [{ minWidth: 46, height: 34, paddingHorizontal: 10, borderRadius: 8,
                                           alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
                                          pressed && { backgroundColor: c.lineStrong }]}
              >
                <Text style={{ fontSize: 14 }}>{k.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            autoFocus
            value=""
            onChangeText={(t) => { if (t) send({ kind: 'text', text: t }); }}
            onSubmitEditing={() => send({ kind: 'key', key: 'enter' })}
            placeholder="Type onto the computer"
            placeholderTextColor={c.faint}
            autoCapitalize="none" autoCorrect={false} spellCheck={false}
            blurOnSubmit={false}
            style={{ marginHorizontal: 12, marginBottom: 6, height: 40, borderRadius: 10,
                     paddingHorizontal: 12, fontSize: 15, backgroundColor: c.fill, color: c.ink }}
          />
        </View>
      )}
    </View>
  );
}
