import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, Modal, PanResponder, Platform, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FS from 'expo-file-system/legacy';
import Svg, { Path } from 'react-native-svg';
import { colors, mono } from '../theme';
import { fileUrl, type Attachment } from '../store';

/** Every picture in the chat on screen, in timeline order. The chat screen
 *  provides it; a photo grid reads it so that opening one picture opens the
 *  whole conversation's pictures, the way a messaging app's gallery does.
 *  Outside a chat (nothing provided) a grid falls back to its own pictures. */
export const GalleryScope = createContext<Attachment[]>([]);

export function galleryUri(a: Attachment): string | null {
  const remote = a.view || a.path;
  return a.localUri || (remote ? fileUrl(remote) : null);
}

const MAX_ZOOM = 4;
const DOUBLE_TAP_MS = 280;
const DISMISS_DY = 110;
const DISMISS_VY = 0.9;

const CloseIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2.2} strokeLinecap="round"><Path d="M6 6l12 12M18 6L6 18" /></Svg>
);
const ShareIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 3v13" /><Path d="M7 8l5-5 5 5" /><Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Svg>
);

/** Full-screen picture viewer: swipe sideways between pictures, pinch and
 *  double-tap to zoom, swipe down to leave, tap to hide the chrome, share
 *  (which on iOS is also "Save Image") from the top bar. */
export function Gallery({ items, index, onClose }: { items: Attachment[]; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(index);
  const [chrome, setChrome] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const listRef = useRef<FlatList<Attachment>>(null);
  // The picture slides with the finger on a swipe down and the backdrop thins
  // out under it, so leaving reads as putting the picture back in the chat.
  const dragY = useRef(new Animated.Value(0)).current;
  const backdrop = dragY.interpolate({ inputRange: [-300, 0, 300], outputRange: [0.4, 1, 0.4], extrapolate: 'clamp' });

  useEffect(() => { setAt(index); }, [index]);

  const current = items[at];
  const share = useCallback(async () => {
    if (!current || sharing) return;
    const uri = galleryUri(current);
    if (!uri) return;
    setSharing(true);
    try {
      // The share sheet wants a file it can hand around. A local picture is
      // one already; one on the computer is fetched into the cache first so the
      // sheet offers Save Image and AirDrop rather than a link.
      let local = uri;
      if (!/^file:/.test(uri)) {
        const name = (current.name || 'image').replace(/[^\w.-]+/g, '_');
        const dest = `${FS.cacheDirectory}share-${Date.now()}-${name}`;
        const r = await FS.downloadAsync(uri, dest);
        local = r.uri;
      }
      await Share.share(Platform.OS === 'ios' ? { url: local } : { message: local, url: local });
    } catch {
      /* the sheet was dismissed, or the file could not be fetched — nothing to say */
    } finally {
      setSharing(false);
    }
  }, [current, sharing]);

  const pan = useMemo(() => PanResponder.create({
    // Only a clearly vertical drag on an unzoomed picture. Sideways belongs to
    // the pager, and any drag on a zoomed picture is panning inside it.
    onMoveShouldSetPanResponderCapture: (_, g) => !zoomed && Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.6,
    onPanResponderMove: Animated.event([null, { dy: dragY }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dy) > DISMISS_DY || Math.abs(g.vy) > DISMISS_VY) {
        Animated.timing(dragY, { toValue: Math.sign(g.dy || 1) * height, duration: 180, useNativeDriver: true }).start(onClose);
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
  }), [zoomed, height, onClose, dragY]);

  const onMomentumEnd = useCallback((e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== at) { setAt(i); setZoomed(false); }
  }, [width, at]);

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <StatusBar hidden={!chrome} animated />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]} />
      <Animated.View style={{ flex: 1, transform: [{ translateY: dragY }] }} {...pan.panHandlers}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(index, Math.max(0, items.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(a) => a.path}
          onMomentumScrollEnd={onMomentumEnd}
          // A zoomed picture pans inside itself; the pager must not steal that.
          scrollEnabled={!zoomed}
          renderItem={({ item, index: i }) => (
            <ZoomPage
              uri={galleryUri(item)} width={width} height={height} active={i === at}
              onTap={() => setChrome((c) => !c)} onZoom={(z) => i === at && setZoomed(z)}
            />
          )}
        />
      </Animated.View>

      {chrome && (
        <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.btn}><CloseIcon /></Pressable>
          <Text style={styles.counter}>{items.length > 1 ? `${at + 1} / ${items.length}` : ''}</Text>
          <Pressable onPress={share} hitSlop={10} disabled={sharing} style={[styles.btn, sharing && { opacity: 0.4 }]}><ShareIcon /></Pressable>
        </View>
      )}
      {chrome && current?.name ? (
        <View pointerEvents="none" style={[styles.foot, { paddingBottom: insets.bottom + 10 }]}>
          <Text numberOfLines={1} style={styles.name}>{current.name}</Text>
        </View>
      ) : null}
    </Modal>
  );
}

/** One page: the picture inside a zoomable scroll view. Pinch is the scroll
 *  view's own (iOS); double-tap zooms to the tapped point and back. */
function ZoomPage({ uri, width, height, active, onTap, onZoom }: {
  uri: string | null; width: number; height: number; active: boolean; onTap: () => void; onZoom: (zoomed: boolean) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scale = useRef(1);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(uri, (w, h) => alive && w && h && setRatio(w / h), () => {});
    return () => { alive = false; };
  }, [uri]);

  // Back to 1× whenever this page leaves the screen, so swiping back to it
  // does not land on a corner of a picture zoomed in some time ago.
  useEffect(() => {
    if (!active && scale.current !== 1) {
      ref.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: false });
      scale.current = 1;
    }
  }, [active, width, height]);

  // Fit the picture to the page, never larger than itself would look blurry.
  const fit = useMemo(() => {
    const r = ratio ?? 1;
    const w = Math.min(width, height * r);
    return { width: w, height: w / r };
  }, [ratio, width, height]);

  const onPress = (e: any) => {
    const now = Date.now();
    const { locationX, locationY } = e.nativeEvent;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
      const sv = ref.current;
      if (!sv) return;
      if (scale.current > 1.05) {
        sv.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
      } else {
        // Zoom to 2.5× around the finger: the rect asked for is what ends up
        // filling the page.
        const z = 2.5;
        const w = width / z, h = height / z;
        sv.scrollResponderZoomTo({ x: locationX - w / 2, y: locationY - h / 2, width: w, height: h, animated: true });
      }
      return;
    }
    lastTap.current = now;
    // A single tap waits to be sure it is not the first half of a double.
    tapTimer.current = setTimeout(() => { tapTimer.current = null; onTap(); }, DOUBLE_TAP_MS);
  };

  return (
    <ScrollView
      ref={ref}
      style={{ width, height }}
      contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
      minimumZoomScale={1}
      maximumZoomScale={MAX_ZOOM}
      bouncesZoom
      centerContent
      alwaysBounceVertical={false}
      alwaysBounceHorizontal={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={(e) => {
        const z = e.nativeEvent.zoomScale ?? 1;
        const was = scale.current > 1.05;
        scale.current = z;
        const is = z > 1.05;
        if (was !== is) onZoom(is);
      }}
      onScrollEndDrag={(e) => { const z = e.nativeEvent.zoomScale ?? 1; scale.current = z; onZoom(z > 1.05); }}
    >
      <Pressable onPress={onPress} style={fit}>
        {uri ? <Image source={{ uri }} style={fit} resizeMode="contain" /> : null}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  counter: { color: colors.white, fontFamily: mono, fontSize: 14, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
  foot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
  name: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
});
