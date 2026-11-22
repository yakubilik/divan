import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, PanResponder, PixelRatio, Pressable, View, useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStore, useT } from '../src/store';
import { client } from '../src/ws';
import { useColors } from '../src/theme';
import { Icon, Text, TextInput } from '../src/components/ui';
import { capPoints, type CapPoint } from '../src/captcha';

/** A captcha an agent stopped at, and nothing else of the page.
 *
 *  The daemon (captcha.py) cuts the captcha box out of the browser tab and
 *  sends it a few times a second; a touch here goes back as the same touch at
 *  the same spot of that box. Tap is a click, a drag is a drag with its own
 *  timing — a slider puzzle reads how the hand moved, not only where it ended.
 *
 *  The screen closes itself when the daemon says the box is gone or solved;
 *  Done and Give up are for when the page does not say so on its own.
 */

const TAP_SLOP = 8;

interface Frame { uri: string; w: number; h: number; frame: number }

export default function CaptchaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const t = useT();
  const conn = useStore((s) => s.conn);
  const win = useWindowDimensions();

  const [frame, setFrame] = useState<Frame | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const alive = useRef(true);
  const endedRef = useRef(false);
  const frameRef = useRef<Frame | null>(null);
  const boxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const viewRef = useRef<View>(null);

  const end = useCallback((state: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnded(state);
    if (state === 'solved') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => { if (alive.current && router.canGoBack()) router.back(); }, 1400);
  }, [router]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // One frame at a time: the next is asked for when the last has arrived, so
  // a slow link runs at fewer frames rather than further behind.
  useEffect(() => {
    if (conn !== 'online' || !id) return;
    let gone = false;
    const width = Math.min(1100, PixelRatio.getPixelSizeForLayoutSize(win.width));
    const loop = async () => {
      while (!gone && alive.current && !endedRef.current) {
        try {
          const r = await client.call<any>('captcha.frame', { id, width });
          if (gone) return;
          if (r?.state && r.state !== 'open') { end(r.state); return; }
          if (r?.jpeg) {
            const f = { uri: `data:image/jpeg;base64,${r.jpeg}`, w: r.w, h: r.h, frame: r.frame };
            frameRef.current = f;
            setFrame(f);
            setError(null);
          }
        } catch (e: any) {
          if (gone) return;
          if (e?.code === 'no_captcha') { end('gone'); return; }
          setError(e?.message ?? t('error'));
          await new Promise((res) => setTimeout(res, 1000));
        }
        await new Promise((res) => setTimeout(res, 120));
      }
    };
    void loop();
    return () => { gone = true; };
  }, [conn, id, win.width, end, t]);

  useEffect(() => client.on((ev) => {
    if (ev.event === 'captcha' && ev.data?.id === id && ev.data?.what === 'closed') end(ev.data.state);
  }), [id, end]);

  const send = useCallback((actions: any[]) => {
    client.call('captcha.input', { id, actions, frame: frameRef.current?.frame })
      .catch((e: any) => setError(e?.message ?? t('error')));
  }, [id, t]);

  // Where the picture is on screen, to turn a finger into 0..1 across it.
  const measure = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, w, h) => { boxRef.current = { x, y, w, h }; });
  }, []);

  const pts = useRef<CapPoint[]>([]);
  const at = (e: GestureResponderEvent): CapPoint | null => {
    const b = boxRef.current;
    if (!b || !b.w || !b.h) return null;
    return [(e.nativeEvent.pageX - b.x) / b.w, (e.nativeEvent.pageY - b.y) / b.h, Date.now()];
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { const p = at(e); pts.current = p ? [p] : []; },
    onPanResponderMove: (e) => { const p = at(e); if (p) pts.current.push(p); },
    onPanResponderRelease: (e) => {
      const p = at(e);
      if (p) pts.current.push(p);
      const b = boxRef.current;
      const out = b ? capPoints(pts.current, b.w, b.h, TAP_SLOP) : null;
      pts.current = [];
      if (!out) return;
      Haptics.selectionAsync().catch(() => {});
      sendRef.current([out]);
    },
  })).current;
  const sendRef = useRef(send);
  sendRef.current = send;

  const finish = useCallback((cancel: boolean) => {
    client.call('captcha.finish', { id, cancel }).catch(() => {});
    end(cancel ? 'cancelled' : 'solved');
  }, [id, end]);

  // The picture as large as the screen allows, at the box's own shape.
  const maxW = win.width - 16;
  const maxH = win.height - insets.top - insets.bottom - 200;
  let dw = maxW;
  let dh = frame ? (maxW * frame.h) / frame.w : 0;
  if (frame && dh > maxH) { dh = maxH; dw = (maxH * frame.w) / frame.h; }

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 48 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}
          style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron_left" size={24} color="#fff" />
        </Pressable>
        <Text style={{ flex: 1, color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 6 }}>{t('capTitle')}</Text>
        {!ended && (
          <Pressable onPress={() => finish(true)} hitSlop={10} style={{ paddingHorizontal: 10 }}>
            <Text style={{ color: '#bbb', fontSize: 14 }}>{t('capGiveUp')}</Text>
          </Pressable>
        )}
        {!ended && (
          <Pressable onPress={() => finish(false)} hitSlop={10}
            style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: c.accent }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{t('capDone')}</Text>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {ended ? (
          <Text style={{ color: '#fff', fontSize: 16 }}>{ended === 'solved' ? t('capSolved') : t('capClosed')}</Text>
        ) : frame ? (
          <View ref={viewRef} onLayout={measure} {...pan.panHandlers}
            style={{ width: dw, height: dh, borderRadius: 6, overflow: 'hidden' }}>
            <Image source={{ uri: frame.uri }} fadeDuration={0} resizeMode="stretch"
              style={{ width: dw, height: dh }} />
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#bbb', fontSize: 13 }}>{t('capWaiting')}</Text>
          </View>
        )}
      </View>

      {!ended && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
          {!!error && <Text style={{ color: '#f88', fontSize: 12 }}>{error}</Text>}
          <Text style={{ color: '#999', fontSize: 12, textAlign: 'center' }}>{t('capHint')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={text} onChangeText={setText} placeholder={t('capType')} autoCapitalize="none"
              autoCorrect={false} placeholderTextColor="#777"
              style={{ flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12, color: '#fff', backgroundColor: '#1c1c1e' }} />
            <Pressable disabled={!text} onPress={() => { send([{ type: 'text', text }]); setText(''); }}
              style={({ pressed }) => [{ paddingHorizontal: 14, height: 40, borderRadius: 10, justifyContent: 'center',
                                         backgroundColor: '#2c2c2e' }, (pressed || !text) && { opacity: 0.5 }]}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{t('capSend')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
