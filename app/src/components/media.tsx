import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File, Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useColors } from '../theme';
import { fileUrl, useStore, useT, type Attachment } from '../store';
import { Icon, Text } from './ui';
import { claim, fmt, nextSpeed, phase, playedBars, release, rememberSpeed, rememberedSpeed, seekFor, speedLabel, timeLabel, waveform } from '../voicenote';
import { bubbleSize, isVideo, viewerSources } from '../media-size';

function srcOf(a: Attachment): string | null {
  const remote = a.view || a.path;
  return a.localUri || (remote ? fileUrl(remote) : null);
}

/** The pixel size of each picture and video a bubble has drawn, by address,
 *  so a bubble scrolled away and back is the right shape at once instead of
 *  starting from the placeholder again. */
const sizes = new Map<string, { w: number; h: number }>();
/** A video's first frame, made once per address. */
const posters = new Map<string, string>();

/** What a bubble learns once its picture or first frame has loaded; exported
 *  so `scripts/test-media.cjs` can hand a bubble a size without a decoder. */
export function rememberSize(uri: string, w: number, h: number) { sizes.set(uri, { w, h }); }

// ── gallery ─────────────────────────────────────────────────────────────────

/** Every photo and video in the chat, so the viewer can page through all of
 *  them rather than only the ones in the bubble that was tapped. */
const GalleryCtx = createContext<{ open: (a: Attachment, fallback: Attachment[]) => void } | null>(null);

export function GalleryProvider({ items, children }: { items: Attachment[]; children: React.ReactNode }) {
  const [state, setState] = useState<{ list: Attachment[]; index: number } | null>(null);
  const ctx = useMemo(() => ({
    open: (a: Attachment, fallback: Attachment[]) => {
      const list = items.some((x) => x.path === a.path) ? items : fallback;
      setState({ list, index: Math.max(0, list.findIndex((x) => x.path === a.path)) });
    },
  }), [items]);
  return (
    <GalleryCtx.Provider value={ctx}>
      {children}
      {state && <Gallery items={state.list} start={state.index} onClose={() => setState(null)} />}
    </GalleryCtx.Provider>
  );
}

/** A bubble's way into the viewer: the chat's own when there is one, and a
 *  viewer of just this message's media when there is not. */
function useViewer(group: Attachment[]) {
  const gal = useContext(GalleryCtx);
  const [local, setLocal] = useState<number | null>(null);
  const open = (a: Attachment) => (gal ? gal.open(a, group) : setLocal(Math.max(0, group.indexOf(a))));
  const viewer = !gal && local != null ? <Gallery items={group} start={local} onClose={() => setLocal(null)} /> : null;
  return { open, viewer };
}

/** Full screen, black, the way the Photos app and the messengers do it: one
 *  photo or video at a time, the whole frame letterboxed, swipe across for the
 *  next, double-tap or pinch a photo to zoom, drag down to put it away. A video
 *  plays in the system player (AVPlayerViewController under expo-video), with
 *  its own scrubber, full screen and picture-in-picture. */
export function Gallery({ items, start, onClose }: { items: Attachment[]; start: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  // The page area under the top bar, measured once laid out; until then, the
  // screen less the bars, so the first frame is not an empty one.
  const [areaH, setAreaH] = useState(win.height - insets.top - insets.bottom - 48 - 40);
  const drag = useRef(new Animated.ValueXY()).current;
  const current = items[index];

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !zoomed && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dy) > 120 || Math.abs(g.vy) > 1.2) onClose();
      else Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 4 }).start(),
  }), [zoomed, drag, onClose]);

  const dist = drag.y.interpolate({ inputRange: [-300, 0, 300], outputRange: [1, 0, 1], extrapolate: 'clamp' });
  const backdrop = dist.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });
  const scale = dist.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] });
  const rotate = drag.x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-4deg', '0deg', '4deg'], extrapolate: 'clamp' });
  const chrome = dist.interpolate({ inputRange: [0, 0.2], outputRange: [1, 0], extrapolate: 'clamp' });

  async function share() {
    if (!current) return;
    try {
      let uri = current.localUri ?? null;
      const remote = viewerSources(current, fileUrl)[0] ?? null;
      if (!uri && remote && Platform.OS !== 'web') {
        const f = await File.downloadFileAsync(remote, new File(Paths.cache, current.name || (isVideo(current) ? 'video' : 'image')), { idempotent: true });
        uri = f.uri;
      }
      await Share.share(Platform.OS === 'ios' ? { url: uri ?? remote ?? '' } : { message: uri ?? remote ?? '' });
    } catch {}
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait']}>
      <StatusBar hidden />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]} />
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <Animated.View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 12, opacity: chrome, zIndex: 2 }}>
          <Pressable accessibilityLabel="close" onPress={onClose} hitSlop={8} style={g.round}><Icon name="close" size={22} weight={400} color="#FFFFFF" /></Pressable>
          <Text mono style={{ fontSize: 13, color: '#FFFFFF' }}>{items.length > 1 ? `${index + 1} / ${items.length}` : ''}</Text>
          <Pressable onPress={() => void share()} hitSlop={8} style={g.round}><Icon name="ios_share" size={22} weight={400} color="#FFFFFF" /></Pressable>
        </Animated.View>
        <Animated.View {...pan.panHandlers} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}
          style={{ flex: 1, transform: [{ translateX: drag.x }, { translateY: drag.y }, { scale }, { rotate }] }}>
          {areaH > 0 && (
            <FlatList
              data={items}
              extraData={index}
              horizontal pagingEnabled scrollEnabled={!zoomed}
              initialScrollIndex={start}
              getItemLayout={(_d, i) => ({ length: win.width, offset: win.width * i, index: i })}
              keyExtractor={(a, i) => `${i}:${a.path}`}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / win.width))}
              renderItem={({ item, index: i }) => isVideo(item)
                ? <VideoPage item={item} width={win.width} height={areaH} active={i === index} onClose={onClose} />
                : <ZoomImage item={item} width={win.width} height={areaH} onZoom={setZoomed} />}
            />
          )}
        </Animated.View>
        <Animated.View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, paddingTop: 12, opacity: chrome }}>
          <Text mono numberOfLines={1} style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{current?.name ?? ''}</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** One video, in the system player: letterboxed (`contain`), never cropped,
 *  with the player's own controls. It plays while it is the page on screen and
 *  pauses when swiped away.
 *
 *  The player's own touch handling keeps a drag on the picture from reaching
 *  the viewer's pan responder, so the drag down that puts it away is a native
 *  one: the page sits in a vertical scroll view that only bounces, and a pull
 *  past `DISMISS` (or a flick) closes the viewer. */
const DISMISS = 90;
function VideoPage({ item, width, height, active, onClose }: { item: Attachment; width: number; height: number; active: boolean; onClose: () => void }) {
  const uri = viewerSources(item, fileUrl)[0] ?? null;
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  useEffect(() => {
    if (active) player.play(); else player.pause();
  }, [active, player]);
  return (
    <ScrollView style={{ width, height }} contentContainerStyle={{ width, height }} alwaysBounceVertical
      showsVerticalScrollIndicator={false} scrollEventThrottle={16}
      onScrollEndDrag={(e) => {
        const { contentOffset, velocity } = e.nativeEvent as any;
        if (Math.abs(contentOffset?.y ?? 0) > DISMISS || Math.abs(velocity?.y ?? 0) > 1.5) onClose();
      }}>
      <View style={{ width, height, backgroundColor: '#000' }}>
        <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls
          allowsPictureInPicture fullscreenOptions={{ enable: true }} />
      </View>
    </ScrollView>
  );
}

/** One photo that zooms. The pinch is the system's own scroll-view zoom
 *  (UIScrollView on iOS), a second tap within a moment does 2.5×. It shows the
 *  original the message names, not the bubble's smaller copy — that copy is
 *  drawn underneath only until the original arrives, and is what is left if
 *  the original has gone. */
function ZoomImage({ item, width, height: h, onZoom }: { item: Attachment; width: number; height: number; onZoom: (z: boolean) => void }) {
  const ref = useRef<ScrollView>(null);
  const last = useRef(0);
  const [z, setZ] = useState(1);
  const sources = useMemo(() => viewerSources(item, fileUrl), [item]);
  const [at, setAt] = useState(0);
  const [ready, setReady] = useState(false);
  const uri = sources[at] ?? null;
  const under = srcOf(item);
  function tap(x: number, y: number) {
    const now = Date.now();
    if (now - last.current < 280) {
      const next = z > 1 ? 1 : 2.5;
      const w = width / next; const hh = h / next;
      (ref.current as any)?.scrollResponderZoomTo?.({ x: x - w / 2, y: y - hh / 2, width: w, height: hh, animated: true });
      setZ(next); onZoom(next > 1);
      last.current = 0;
    } else last.current = now;
  }
  return (
    <View style={{ width, height: h }}>
      <ScrollView ref={ref} maximumZoomScale={4} minimumZoomScale={1} centerContent bounces={z > 1} alwaysBounceVertical={false}
        showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScroll={(e) => { const s = (e.nativeEvent as any).zoomScale ?? 1; if ((s > 1.01) !== (z > 1.01)) { setZ(s); onZoom(s > 1.01); } }}
        scrollEventThrottle={32}
        contentContainerStyle={{ width, height: h || undefined, alignItems: 'center', justifyContent: 'center' }}>
        <Pressable onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)} style={{ width, height: h || '100%' }}>
          {under && !ready && under !== uri && <Image source={{ uri: under }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
          {uri && (
            <Image key={uri} source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain"
              onLoad={() => setReady(true)} onError={() => setAt((n) => n + 1)} />
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const g = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,.12)', alignItems: 'center', justifyContent: 'center' },
});

// ── in the transcript ──────────────────────────────────────────────────────

function Thumb({ a, style, onPress, onSize, children }: {
  a: Attachment; style: any; onPress: () => void; onSize?: (w: number, h: number) => void; children?: React.ReactNode;
}) {
  const c = useColors();
  const uri = srcOf(a);
  // A picture that will not load says so. Left blank it reads as a rendering
  // bug; named, it reads as a file name where a picture should be.
  const [gone, setGone] = useState(false);
  return (
    <Pressable accessibilityLabel={`photo ${a.name}`} onPress={onPress} style={[{ overflow: 'hidden', backgroundColor: c.fill }, style]}>
      {uri && !gone ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setGone(true)}
          onLoad={(e) => { const s = (e.nativeEvent as any)?.source; if (onSize && s?.width > 0 && s?.height > 0) onSize(s.width, s.height); }} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }}>
          <Icon name="broken_image" size={22} color={c.faint} />
          <Text numberOfLines={2} mono style={{ fontSize: 10, color: c.faint, textAlign: 'center' }}>{a.name}</Text>
        </View>
      )}
      {children}
    </Pressable>
  );
}

/** The pixel size of what `uri` points at, once something has measured it. */
function useMeasured(uri: string | null) {
  const [size, setSize] = useState(() => (uri ? sizes.get(uri) ?? null : null));
  const measured = (w: number, h: number) => {
    if (!uri) return;
    rememberSize(uri, w, h);
    setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  };
  return [size, measured] as const;
}

/** One photo: a bubble the photo's own shape (see `bubbleSize`). */
function SinglePhoto({ a, align, onPress }: { a: Attachment; align: 'left' | 'right'; onPress: () => void }) {
  const [size, measured] = useMeasured(srcOf(a));
  const box = bubbleSize(size?.w, size?.h);
  return (
    <Thumb a={a} onPress={onPress} onSize={measured}
      style={{ width: box.width, height: box.height, borderRadius: 16, borderBottomRightRadius: align === 'right' ? 4 : 16, borderBottomLeftRadius: align === 'left' ? 4 : 16 }} />
  );
}

/** Photos: one alone in its own shape; several as a small grid, one wide on
 *  top and two below, "+N" on the last one when there are more than fit. Tap
 *  opens the viewer. `group` is the whole message's media (photos and videos),
 *  what a viewer opened from here pages through when the chat has none. */
export function ImageGroup({ items, align = 'right', group }: { items: Attachment[]; align?: 'left' | 'right'; group?: Attachment[] }) {
  const c = useColors();
  const { open, viewer } = useViewer(group ?? items);
  const n = items.length;
  let body: React.ReactNode;
  if (n === 1) {
    body = <SinglePhoto a={items[0]} align={align} onPress={() => open(items[0])} />;
  } else if (n === 2) {
    body = (
      <View style={{ flexDirection: 'row', gap: 4, width: 220 }}>
        <Thumb a={items[0]} onPress={() => open(items[0])} style={{ flex: 1, height: 110, borderRadius: 4, borderTopLeftRadius: 14 }} />
        <Thumb a={items[1]} onPress={() => open(items[1])} style={{ flex: 1, height: 110, borderRadius: 4, borderTopRightRadius: 14 }} />
      </View>
    );
  } else {
    const more = n - 3;
    body = (
      <View style={{ width: 230, gap: 3 }}>
        <Thumb a={items[0]} onPress={() => open(items[0])} style={{ height: 130, borderRadius: 4, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} />
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <Thumb a={items[1]} onPress={() => open(items[1])} style={{ flex: 1, height: 80, borderRadius: 4 }} />
          <Thumb a={items[2]} onPress={() => open(items[2])} style={{ flex: 1, height: 80, borderRadius: 4 }}>
            {more > 0 && (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: c.veil }]}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.muted }}>+{more}</Text>
              </View>
            )}
          </Thumb>
        </View>
      </View>
    );
  }
  return (
    <>
      {body}
      {viewer}
    </>
  );
}

/** A video as its first frame with a play badge, in the video's own shape: a
 *  phone video upright, a landscape one wide (see `bubbleSize`). The first
 *  frame comes out of the decoder already turned the way the video is watched.
 *  Tap opens it in the viewer, in the system player. */
export function VideoBubble({ item, stacked, group }: { item: Attachment; stacked?: boolean; group?: Attachment[] }) {
  const uri = srcOf(item);
  const [thumb, setThumb] = useState<string | null>(() => (uri ? posters.get(uri) ?? null : null));
  const [size, measured] = useMeasured(uri);
  const { open, viewer } = useViewer(group ?? [item]);
  useEffect(() => {
    let alive = true;
    if (uri && !posters.has(uri) && Platform.OS !== 'web') {
      VideoThumbnails.getThumbnailAsync(uri, { time: 500 }).then((r) => {
        posters.set(uri, r.uri);
        if (!alive) return;
        setThumb(r.uri);
        if (r.width > 0 && r.height > 0) measured(r.width, r.height);
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = bubbleSize(size?.w, size?.h);
  return (
    <>
      <Pressable accessibilityLabel={`video ${item.name}`} onPress={() => uri && open(item)}
        style={{ width: box.width, height: box.height, borderRadius: stacked ? 4 : 16, overflow: 'hidden', backgroundColor: '#1A1A18', alignItems: 'center', justifyContent: 'center' }}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play_arrow" size={24} weight={400} color="#FFFFFF" />
        </View>
        {item.duration != null && (
          <View style={{ position: 'absolute', left: 8, bottom: 8, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: 'rgba(0,0,0,.45)' }}>
            <Text mono style={{ fontSize: 10.5, color: '#FFFFFF' }}>{fmt(item.duration)}</Text>
          </View>
        )}
      </Pressable>
      {viewer}
    </>
  );
}

/** Voice note, drawn the way a messenger draws one: play/pause on the left, a
 *  waveform across the rest that a finger can scrub, the time under it and a
 *  speed chip once it has started. `sent` is a sound the agent made rather
 *  than one the person spoke: it sits on the left under its file name, and
 *  nobody looked for speech in it. What a touch seeks to, which bubble keeps
 *  playing and what the time says are decided in `voicenote.ts`. */
export function VoiceBubble({ item, sent }: { item: Attachment; sent?: boolean }) {
  const T = useT();
  const c = useColors();
  const { width: screen } = useWindowDimensions();
  const transcriptionOn = useStore((s) => s.hostInfo?.transcription ?? true);
  const uri = srcOf(item);
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  const wave = useMemo(() => waveform(item.peaks, item.path), [item.peaks, item.path]);
  const [rate, setRate] = useState(rememberedSpeed);
  // Where the finger holds the playhead while it is down; the player is only
  // told on release, so a drag does not stutter the sound under it.
  const [scrub, setScrub] = useState<number | null>(null);
  const width = Math.round(screen * 0.72);
  // Measured once laid out; until then, what the bubble's own sizes leave for
  // it (paddings, the button and the gap beside it).
  const [waveW, setWaveW] = useState(width - 10 - 14 - 38 - 10);
  const total = status.duration || item.duration || 0;
  const position = scrub ?? (status.currentTime || 0);
  const now = phase(status.playing, position, total);
  const lit = playedBars(position, total, wave.length);

  useEffect(() => () => release(player), [player]);
  // The end is the start again: play, and the whole length under it.
  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    void player.seekTo(0).catch(() => {});
    release(player);
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (!uri) return;
    if (status.playing) { player.pause(); release(player); return; }
    if (total && position >= total - 0.05) void player.seekTo(0).catch(() => {});
    claim(player);
    const r = rememberedSpeed();
    setRate(r);
    // A mode left unset is the ambient one, which the silent switch mutes: the
    // counter ran and nothing was heard.
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}).then(() => {
      player.setPlaybackRate(r);
      player.play();
    });
  };
  const speed = () => {
    const r = nextSpeed(rate);
    setRate(r);
    rememberSpeed(r);
    player.setPlaybackRate(r);
  };

  // A tap or a sideways drag on the waveform moves the playhead. A drag that
  // turns out to be vertical is handed back to the chat list's scroll.
  const live = useRef({ x0: 0, width: 0, total: 0, sideways: false });
  live.current.width = waveW;
  live.current.total = total;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!uri,
    onMoveShouldSetPanResponder: (_e, g) => !!uri && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => !live.current.sideways,
    onPanResponderGrant: (e) => {
      const l = live.current;
      l.x0 = e.nativeEvent.locationX;
      l.sideways = false;
      setScrub(seekFor(l.x0, l.width, l.total));
    },
    onPanResponderMove: (_e, g) => {
      const l = live.current;
      if (!l.sideways && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy)) l.sideways = true;
      if (l.sideways) setScrub(seekFor(l.x0 + g.dx, l.width, l.total));
    },
    onPanResponderRelease: (_e, g) => {
      const l = live.current;
      const tap = Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6;
      if (l.sideways || tap) void player.seekTo(seekFor(l.x0 + (l.sideways ? g.dx : 0), l.width, l.total)).catch(() => {});
      l.sideways = false;
      setScrub(null);
    },
    onPanResponderTerminate: () => { live.current.sideways = false; setScrub(null); },
  }), [player, uri]);

  const spoke = !!item.transcript;
  const knob = total ? Math.min(1, position / total) * waveW : 0;
  return (
    <View style={{ alignItems: sent ? 'flex-start' : 'flex-end', gap: 4 }}>
      <View style={[{ width, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, paddingVertical: 9, paddingLeft: 10, paddingRight: 14 },
                    sent ? { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderBottomLeftRadius: 6 }
                         : { backgroundColor: c.bubble, borderBottomRightRadius: 6 }]}>
        <Pressable onPress={toggle} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={status.playing ? 'pause' : 'play_arrow'} size={24} weight={400} color={c.onInk} />
        </Pressable>
        <View style={{ flex: 1, gap: 3 }}>
          {sent && <Text numberOfLines={1} style={{ fontSize: 12, color: c.text2 }}>{item.name}</Text>}
          <View {...pan.panHandlers} onLayout={(e) => setWaveW(e.nativeEvent.layout.width)}
            style={{ height: 28, justifyContent: 'center' }}>
            <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 28 }}>
              {wave.map((h, i) => (
                <View key={i} style={{ width: 2.5, height: h, borderRadius: 1.25, backgroundColor: i < lit ? c.ink : c.faint }} />
              ))}
            </View>
            {now !== 'idle' && waveW > 0 && (
              <View pointerEvents="none" style={{ position: 'absolute', left: knob - 6, top: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: c.ink }} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 18 }}>
            <Text mono style={{ fontSize: 11, color: c.faint }}>{timeLabel(status.playing, position, total)}</Text>
            {now !== 'idle' && (
              <Pressable onPress={speed} hitSlop={8} style={{ backgroundColor: sent ? c.fill : c.card, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 1 }}>
                <Text mono style={{ fontSize: 11, color: c.text2 }}>{speedLabel(rate)}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
      {sent ? null : spoke ? (
        <Text style={{ fontSize: 13, color: c.muted, fontStyle: 'italic', textAlign: 'right' }}>“{item.transcript}”</Text>
      ) : (
        <Text style={{ fontSize: 12, color: c.faint, fontStyle: 'italic' }}>{transcriptionOn ? T('noSpeech') : T('noTranscript')}</Text>
      )}
    </View>
  );
}

function fmtSize(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file by name. `openable` chips (the agent's) open in the system viewer
 *  on tap — Safari shows a PDF and offers the share sheet, which is download,
 *  AirDrop and Files in one place, with no native module of our own. */
export function FileChip({ item, openable }: { item: Attachment; openable?: boolean }) {
  const c = useColors();
  const uri = openable ? srcOf(item) : null;
  const size = fmtSize(item.size);
  return (
    <Pressable disabled={!uri} onPress={() => uri && Linking.openURL(uri).catch(() => {})}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 10,
               paddingVertical: 6, paddingHorizontal: 10, maxWidth: 260 }}>
      <Icon name="description" size={16} color={c.muted} />
      <Text numberOfLines={1} style={{ fontSize: 12, color: c.text2, flexShrink: 1 }}>{item.name}</Text>
      {!!size && openable && <Text mono style={{ fontSize: 10.5, color: c.faint }}>{size}</Text>}
    </Pressable>
  );
}
