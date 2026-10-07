/** The chat screen, stood up in the same harness every judgement uses.
 *
 *  `render-divan.cjs` stubs what the Divan parts reach for; the conversation
 *  screen reaches for more — a `FlatList`, a dozen `Svg` shapes, eight Expo
 *  modules. These are the stand-ins the retired `audit-frames.cjs` built for the same job,
 *  bar one: the text field keeps `render-divan`'s own, so that typing into it
 *  is still something a check can do. `buildTimeline` is the real one off
 *  `src/store.ts`: it is pure, and it is what turns a chat's events into rows.
 *
 *  Used by `test-handover-machine.cjs`.
 */
const Module = require('module');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const React = R.React;
const h = React.createElement;
const RN = require('react-native');

/** A list that really walks what it was handed — `render-divan`'s own
 *  `SectionList`, one prop table over. The transcript is a `FlatList`, so
 *  without this the whole of Mobile4 C1 and Mobile10 renders as an empty box. */
RN.FlatList = React.forwardRef(function FlatList(props, _ref) {
  const { data = [], renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent,
          ListEmptyComponent, contentContainerStyle } = props;
  const kids = [];
  const el = (C) => (React.isValidElement(C) ? C : (typeof C === 'function' ? h(C) : null));
  const at = (node, key) => kids.push(h(React.Fragment, { key }, node));
  if (ListHeaderComponent) at(el(ListHeaderComponent), 'head');
  if (!data.length && ListEmptyComponent) at(el(ListEmptyComponent), 'empty');
  data.forEach((item, index) => at(renderItem({ item, index }),
    keyExtractor ? keyExtractor(item, index) : `i${index}`));
  if (ListFooterComponent) at(el(ListFooterComponent), 'foot');
  return h('div', { 'data-rn': 'FlatList',
                    'data-style': JSON.stringify(RN.StyleSheet.flatten(contentContainerStyle)) }, kids);
});
RN.ActivityIndicator = RN.View;
RN.TouchableOpacity = RN.Pressable;
RN.RefreshControl = RN.View;
RN.Switch = RN.View;
RN.Share = { share: () => Promise.resolve({ action: 'sharedAction' }) };
RN.Alert = { alert: () => {} };
RN.Linking = { openURL: () => Promise.resolve(), canOpenURL: () => Promise.resolve(true),
               addEventListener: () => ({ remove() {} }) };
RN.Dimensions = { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) };
RN.PixelRatio = { get: () => 3, roundToNearestPixel: (n) => n };
RN.InteractionManager = { runAfterInteractions: (fn) => { if (fn) fn(); return { cancel() {} }; } };
RN.LayoutAnimation = { configureNext: () => {}, Presets: {} };
RN.NativeModules = {};
RN.findNodeHandle = () => null;

/** The shapes beyond the one path `render-divan` needed: the quota ring is a
 *  `Circle`. Drawn as the same box, because none of them carries a word. */
const SVG = require('react-native-svg');
for (const name of ['Circle', 'Rect', 'G', 'Line', 'Defs', 'Stop', 'LinearGradient',
                    'RadialGradient', 'ClipPath', 'Mask', 'Polyline', 'Polygon', 'Ellipse',
                    'Text', 'TSpan']) if (!SVG[name]) SVG[name] = SVG.Path;

/** Markdown, reduced to the words in it. This file compares words; a real
 *  `markdown-it` in here would be checking `markdown-it`. */
const said = (n) => (n.content ? [n.content] : []).concat((n.children ?? []).flatMap(said));
const MARKDOWN = {
  __esModule: true, default: RN.View, renderRules: {}, styles: {},
  MarkdownIt: function MarkdownIt() { return { parse: (s) => [{ type: 'text', content: s, children: [] }] }; },
  stringToTokens: (s) => [{ type: 'text', content: s, children: [] }],
  tokensToAST: (t) => t,
  removeTextStyleProps: (s) => s,
  AstRenderer: class {
    render(nodes) { return h(RN.Text, null, said({ children: nodes }).join(' ')); }
    renderNode(node) { return h(RN.Text, null, said(node).join(' ')); }
  },
};

/** The eight native modules only the chat screen reaches for, and the one thing
 *  each of them has to answer for the screen to draw. Nothing in here decides
 *  anything a frame is compared against: the pickers are never opened, the
 *  recorder is never started, and the transcript this run reads is the fixture's.
 *  `expo-modules-core` refusing is the real answer on a phone without the drop
 *  module in the build — `modules/drop-target` catches it and says so. */
const EXTRA = {
  'expo-modules-core': {
    requireNativeModule: () => { throw new Error('no native module in this build'); },
    requireOptionalNativeModule: () => null,
  },
  'expo-image-picker': {
    launchImageLibraryAsync: () => Promise.resolve({ canceled: true }),
    launchCameraAsync: () => Promise.resolve({ canceled: true }),
    requestMediaLibraryPermissionsAsync: () => Promise.resolve({ granted: true }),
    requestCameraPermissionsAsync: () => Promise.resolve({ granted: true }),
    MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
  },
  'expo-document-picker': { getDocumentAsync: () => Promise.resolve({ canceled: true }) },
  'expo-audio': {
    AudioModule: { requestRecordingPermissionsAsync: () => Promise.resolve({ granted: true }) },
    RecordingPresets: { HIGH_QUALITY: {} },
    setAudioModeAsync: () => Promise.resolve(),
    useAudioRecorder: () => ({ record() {}, stop: () => Promise.resolve(), uri: null,
                               prepareToRecordAsync: () => Promise.resolve() }),
    useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0, metering: 0 }),
    useAudioPlayer: () => ({ play() {}, pause() {}, remove() {} }),
    useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
  },
  'expo-video': { VideoView: RN.View, useVideoPlayer: () => ({ play() {}, pause() {} }) },
  'expo-video-thumbnails': { getThumbnailAsync: () => Promise.resolve({ uri: 'asset' }) },
  'expo-file-system': {
    documentDirectory: '/tmp/', cacheDirectory: '/tmp/',
    getInfoAsync: () => Promise.resolve({ exists: false }),
    deleteAsync: () => Promise.resolve(), copyAsync: () => Promise.resolve(),
    makeDirectoryAsync: () => Promise.resolve(),
    createUploadTask: () => ({ uploadAsync: () => Promise.resolve({ status: 200, body: '{}' }) }),
    FileSystemUploadType: { MULTIPART: 1 }, File: class {}, Directory: class {},
  },
  'expo-secure-store': { getItemAsync: () => Promise.resolve(null),
                         setItemAsync: () => Promise.resolve(), deleteItemAsync: () => Promise.resolve() },
  'expo-notifications': { addNotificationReceivedListener: () => ({ remove() {} }),
                          addNotificationResponseReceivedListener: () => ({ remove() {} }),
                          setNotificationHandler: () => {},
                          getPermissionsAsync: () => Promise.resolve({ status: 'granted' }) },
  'expo-constants': { __esModule: true, default: { expoConfig: { extra: {} } } },
  'expo-device': { deviceName: 'iPhone', modelName: 'iPhone' },
  'expo-localization': { getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }] },
  'expo-local-authentication': { hasHardwareAsync: () => Promise.resolve(true),
                                 isEnrolledAsync: () => Promise.resolve(true),
                                 authenticateAsync: () => Promise.resolve({ success: true }),
                                 supportedAuthenticationTypesAsync: () => Promise.resolve([]) },
  'expo-speech': { speak: () => {}, stop: () => {} },
  '@jamsch/expo-speech-recognition': {
    ExpoSpeechRecognitionModule: { start: () => {}, stop: () => {},
      requestPermissionsAsync: () => Promise.resolve({ granted: true }) },
    useSpeechRecognitionEvent: () => {},
  },
  'react-native-webview': { WebView: RN.View },
  'react-native-markdown-display': MARKDOWN,
  'react-native-markdown-display/src/lib/util/cleanupTokens': { cleanupTokens: (t) => t },
  'react-native-markdown-display/src/lib/util/groupTextTokens': { __esModule: true, default: (t) => t },
  'react-native-markdown-display/src/lib/util/omitListItemParagraph': { __esModule: true, default: (t) => t },
};
// Installed after `render-divan`'s own hook, so this one is asked first and its
// own misses fall through to that one.
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(EXTRA, request)) return EXTRA[request];
  return beneath.call(this, request, parent, isMain);
};


const STORE = Module._load('./store', { filename: path.join(root, 'src', 'render-chat.ts') }, false);
STORE.buildTimeline = require(path.join(root, 'src/store.ts')).buildTimeline;
STORE.fileUrl = (p) => `file://${p}`;

module.exports = { R };
