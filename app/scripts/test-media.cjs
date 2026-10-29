/** Photos and videos in a chat, checked without a phone (#552).
 *
 *    1. The bubble's size (`src/media-size.ts`): a phone video stays upright, a
 *       landscape one stays wide, a square stays square, and only a shape more
 *       extreme than the frame (1:4, 4:1) is clamped — the one case that crops.
 *    2. The bubbles themselves (`src/components/media.tsx`): a single photo and
 *       a video draw at that size once they know their picture's.
 *    3. The full-screen viewer: one pager for the photos and videos together;
 *       a photo read from the original the message names, not the bubble's
 *       smaller copy; a video in the system player, letterboxed (`contain`),
 *       with its own controls; a sideways swipe left to the pager at zoom 1 and
 *       a drag down that puts the viewer away.
 *
 *  Run: node scripts/test-media.cjs
 */
const Module = require('module');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const RN = require('react-native');
const S = require(path.join(root, 'src/media-size.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. the size of the box ──────────────────────────────────────────────────
const B = S.BUBBLE;
const portrait = S.bubbleSize(1080, 1920);
const landscape = S.bubbleSize(1920, 1080);
const square = S.bubbleSize(1200, 1200);
const tall = S.bubbleSize(500, 2000);
const wide = S.bubbleSize(2000, 500);
const unknown = S.bubbleSize(undefined, 0);
const ratio = (b) => b.width / b.height;
const inside = (b) => b.width <= B.maxW && b.height <= B.maxH && b.width >= B.minW && b.height >= B.minH;

checks.push(['a 9:16 phone video is a portrait bubble', portrait.height > portrait.width]);
checks.push(['…as tall as the frame allows, its whole frame in it (not cropped)',
  portrait.height === B.maxH && !portrait.cropped && Math.abs(ratio(portrait) - 9 / 16) < 0.01]);
checks.push(['a 16:9 video is a landscape bubble, as wide as the frame, uncropped',
  landscape.width > landscape.height && landscape.width === B.maxW && !landscape.cropped && Math.abs(ratio(landscape) - 16 / 9) < 0.02]);
checks.push(['a square is square', square.width === square.height && square.width === B.maxW && !square.cropped]);
checks.push(['an extreme 1:4 is clamped to the narrowest bubble and cropped',
  eq(tall, { width: B.minW, height: B.maxH, cropped: true })]);
checks.push(['an extreme 4:1 is clamped to the shortest bubble and cropped',
  eq(wide, { width: B.maxW, height: B.minH, cropped: true })]);
checks.push(['every box stays inside the frame', [portrait, landscape, square, tall, wide, unknown].every(inside)]);
checks.push(['a small picture is drawn at the frame, not at its pixel size',
  eq(S.bubbleSize(90, 160), S.bubbleSize(1080, 1920))]);
checks.push(['a size not known yet gets a 4:3 placeholder', eq(unknown, { width: B.maxW, height: Math.round(B.maxW * 0.75), cropped: true })]);
checks.push(['the frame fits the message column on a 375-point phone', B.maxW <= Math.floor(375 * 0.8) - 2]);
checks.push(['photos and videos are told apart by kind, then by name',
  S.isPhoto({ kind: 'image' }) && S.isPhoto({ name: 'a.HEIC' }) && !S.isPhoto({ kind: 'video', name: 'a.png' })
  && S.isVideo({ kind: 'video' }) && S.isVideo({ name: 'clip.MOV' }) && !S.isVideo({ name: 'a.jpg' })]);
const url = (p) => `u:${p}`;
checks.push(['the viewer reads the original first, the kept copy after',
  eq(S.viewerSources({ path: '/o.jpg', view: '/v.jpg' }, url), ['u:/o.jpg', 'u:/v.jpg'])]);
checks.push(['…and a photo still on the phone before either',
  eq(S.viewerSources({ localUri: 'file:///p.jpg', path: '/o.jpg', view: '/v.jpg' }, url), ['file:///p.jpg', 'u:/o.jpg', 'u:/v.jpg'])]);

// ── 2 & 3. the components ───────────────────────────────────────────────────
/** A list that renders what it was handed, with the props it was given. */
let list = null;
RN.FlatList = function FlatList(props) {
  list = props;
  return h('div', { 'data-rn': 'FlatList' }, (props.data || []).map((item, index) =>
    h(R.React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))));
};
RN.Image = function Image(props) {
  return h('div', { 'data-rn': 'Image', 'data-src': props.source?.uri ?? '', 'data-fit': props.resizeMode ?? '',
                    'data-style': JSON.stringify(R.flatten(props.style)) });
};
RN.Share = { share: () => Promise.resolve() };
/** Scroll views keep their props: a video page's drag down is one of them. */
let scrolls = [];
RN.ScrollView = function ScrollView(props) {
  scrolls.push(props);
  return h('div', { 'data-rn': 'ScrollView', 'data-style': JSON.stringify(R.flatten(props.style)) }, props.children);
};
RN.LogBox = { ignoreAllLogs() {} };
RN.Linking = { openURL: () => Promise.resolve() };
class ValueXY { constructor() { this.x = new RN.Animated.Value(0); this.y = new RN.Animated.Value(0); } }
RN.Animated.ValueXY = ValueXY;
RN.Animated.event = () => () => {};
const panPrev = RN.PanResponder.create;
let pans = [];
RN.PanResponder.create = (cfg) => { pans.push(cfg); return { panHandlers: {} }; };

const players = [];
const MORE = {
  'expo-audio': { useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}), setAudioModeAsync: () => Promise.resolve() },
  'expo-video': {
    VideoView: (p) => h('div', { 'data-rn': 'VideoView', 'data-fit': p.contentFit ?? '', 'data-controls': String(!!p.nativeControls),
                                 'data-pip': String(!!p.allowsPictureInPicture), 'data-fullscreen': String(!!p.fullscreenOptions?.enable),
                                 'data-style': JSON.stringify(R.flatten(p.style)) }),
    useVideoPlayer: (src) => { const p = { src, play() {}, pause() {} }; players.push(p); return p; },
  },
  'expo-video-thumbnails': { getThumbnailAsync: () => Promise.resolve({ uri: '', width: 0, height: 0 }) },
  'expo-file-system': { File: class {}, Paths: {} },
  'expo-status-bar': { StatusBar: () => null },
};
const loadPrev = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(MORE, request)) return MORE[request];
  return loadPrev.call(this, request, parent, isMain);
};
const media = require(path.join(root, 'src/components/media.tsx'));
const fileUrl = (p) => `http://mac/files?path=${encodeURIComponent(p)}`;

const PHONE_VIDEO = { path: '/u/phone.mov', name: 'phone.mov', kind: 'video' };
const WIDE_VIDEO = { path: '/u/wide.mp4', name: 'wide.mp4', kind: 'video' };
const TALL_PHOTO = { path: '/w/tall.jpg', view: '/u/shown/tall-1.jpg', name: 'tall.jpg', kind: 'image' };
const WIDE_PHOTO = { path: '/w/wide.png', name: 'wide.png', kind: 'image' };

const boxOf = (html, rn) => {
  const m = [...html.matchAll(/data-rn="Pressable" data-style="([^"]*)"/g)][0];
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"')) : null;
};

// Before anything has measured the video, the placeholder; after, its shape.
let before = boxOf(R.render('light', h(media.VideoBubble, { item: PHONE_VIDEO })));
checks.push(['a video whose size is not known yet draws the placeholder', before.width === B.maxW && before.height === 188]);
media.rememberSize(fileUrl(PHONE_VIDEO.path), 1080, 1920);
media.rememberSize(fileUrl(WIDE_VIDEO.path), 1920, 1080);
media.rememberSize(fileUrl(TALL_PHOTO.view), 1200, 1600);
media.rememberSize(fileUrl(WIDE_PHOTO.path), 1600, 900);
const vPortrait = boxOf(R.render('light', h(media.VideoBubble, { item: PHONE_VIDEO })));
const vLandscape = boxOf(R.render('light', h(media.VideoBubble, { item: WIDE_VIDEO })));
checks.push(['a phone video bubble is drawn upright, at its own shape',
  vPortrait.width === portrait.width && vPortrait.height === portrait.height]);
checks.push(['a landscape video bubble is drawn wide', vLandscape.width === landscape.width && vLandscape.height === landscape.height]);
const pTall = boxOf(R.render('light', h(media.ImageGroup, { items: [TALL_PHOTO] })));
const pWide = boxOf(R.render('light', h(media.ImageGroup, { items: [WIDE_PHOTO], align: 'left' })));
const pTallWant = S.bubbleSize(1200, 1600);
const pWideWant = S.bubbleSize(1600, 900);
checks.push(['a single portrait photo is a portrait bubble at its own shape',
  pTall.width === pTallWant.width && pTall.height === pTallWant.height && pTall.height > pTall.width]);
checks.push(['a single landscape photo is a landscape bubble at its own shape',
  pWide.width === pWideWant.width && pWide.height === pWideWant.height && pWide.width > pWide.height]);
const bubbleImg = R.render('light', h(media.ImageGroup, { items: [TALL_PHOTO] }));
checks.push(["the bubble draws the computer's kept copy", bubbleImg.includes(`data-src="${fileUrl(TALL_PHOTO.view).replace(/&/g, '&amp;')}"`)]);

// The viewer, over a message with a photo, a video and another photo.
let closed = 0;
pans = [];
const group = [TALL_PHOTO, PHONE_VIDEO, WIDE_PHOTO];
scrolls = [];
const viewer = R.render('dark', h(media.Gallery, { items: group, start: 0, onClose: () => { closed++; } }));
const pan = pans[0];
checks.push(['the viewer is one pager for photos and videos together',
  list && list.data.length === 3 && list.horizontal === true && list.pagingEnabled === true && list.scrollEnabled === true]);
checks.push(['…opened on the item that was tapped', list.initialScrollIndex === 0]);
const srcs = [...viewer.matchAll(/data-rn="Image" data-src="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
checks.push(['a photo opens at the original the message names, not the bubble copy',
  srcs.includes(fileUrl(TALL_PHOTO.path)) && srcs.includes(fileUrl(WIDE_PHOTO.path))]);
checks.push(['…drawn whole (contain)', [...viewer.matchAll(/data-rn="Image" data-src="[^"]*" data-fit="([^"]*)"/g)].every((m) => m[1] === 'contain')]);
checks.push(['…with the system pinch zoom under it, up to 4×, starting whole',
  scrolls.some((p) => p.maximumZoomScale === 4 && p.minimumZoomScale === 1 && p.zoomScale === 1)]);
checks.push(['a video not on screen has no player fetching it', !/data-rn="VideoView"/.test(viewer) && players.length === 0]);
checks.push(['…only the page on screen and its neighbours are drawn', list.initialNumToRender === 1 && list.windowSize === 3]);
// The same viewer opened on the video.
const onVideo = R.render('dark', h(media.Gallery, { items: group, start: 1, onClose: () => { closed++; } }));
const video = onVideo.match(/data-rn="VideoView" data-fit="([^"]*)" data-controls="([^"]*)" data-pip="([^"]*)" data-fullscreen="([^"]*)" data-style="([^"]*)"/);
checks.push(['a video plays in the system player, letterboxed and never cropped', !!video && video[1] === 'contain']);
checks.push(['…with its native controls, full screen and picture-in-picture', !!video && video[2] === 'true' && video[3] === 'true' && video[4] === 'true']);
const vs = video && JSON.parse(video[5].replace(/&quot;/g, '"'));
checks.push(['…filling the page, the width of the screen', !!vs && vs.width === 390 && vs.height > 600]);
checks.push(['…reading the original video, with one player', players.length === 1 && players[0].src === fileUrl(PHONE_VIDEO.path)]);
checks.push(['a sideways swipe at zoom 1 is left to the pager',
  pan.onMoveShouldSetPanResponder({}, { dx: 80, dy: 4 }) === false]);
checks.push(['a drag down is taken by the viewer', pan.onMoveShouldSetPanResponder({}, { dx: 3, dy: 40 }) === true]);
pan.onPanResponderRelease({}, { dx: 0, dy: 40, vy: 0.1 });
checks.push(['…a short one springs back', closed === 0]);
pan.onPanResponderRelease({}, { dx: 5, dy: 200, vy: 0.4 });
checks.push(['…a long one puts the viewer away', closed === 1]);
const videoScroll = scrolls.find((p) => p.alwaysBounceVertical && typeof p.onScrollEndDrag === 'function');
checks.push(['a video page sits in a native vertical scroll that only bounces', !!videoScroll && !videoScroll.maximumZoomScale]);
if (videoScroll) {
  const before2 = closed;
  videoScroll.onScrollEndDrag({ nativeEvent: { contentOffset: { y: -30 }, velocity: { y: 0.2 } } });
  const small = closed === before2;
  videoScroll.onScrollEndDrag({ nativeEvent: { contentOffset: { y: -140 }, velocity: { y: 0.5 } } });
  checks.push(['…a short pull on the video springs back, a long one puts the viewer away', small && closed === before2 + 1]);
  closed = before2;
}
checks.push(['the close button puts it away too', (() => {
  const b = R.presses().find((p) => p.label === 'close'); if (!b) return false; b.press(); return closed === 2;
})()]);

// Opened from a bubble with no chat around it: its own viewer, of the message.
const lone = R.render('light', h(media.VideoBubble, { item: PHONE_VIDEO, group }));
checks.push(['a video bubble is pressable', R.presses().some((p) => p.label === 'video phone.mov') && lone.length > 0]);

RN.PanResponder.create = panPrev;
Module._load = loadPrev;

let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name);
  if (!ok) bad++;
}
console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
