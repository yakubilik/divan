/** Every mobile screen, beside the frame that drew it.
 *
 *     cd app && node scripts/audit-frames.cjs [path/to/frames]
 *
 *  This is not part of any npm script and must not become one: the frames are
 *  private and are not in this repository, so a check that reads them cannot run
 *  on a clone. `scripts/test-*.cjs` are the ones that run everywhere, and the way
 *  they manage is by quoting into their own source the handful of values they
 *  need — sixteen colours, four column labels, three thresholds. That works for
 *  a threshold. It does not work for the question this file answers — *is every
 *  word on the screen the word the frame put there* — because the answer is a
 *  couple of thousand strings and quoting them would be copying the frames in.
 *
 *  So: point it at the frames and it reads them. Twenty-five mobile artboards
 *  across eleven files, each one read, and the app stood up on the screen and in
 *  the state that artboard drew. What comes out is two lists per variant — what
 *  the frame says and the app does not, and what the app says and the frame does
 *  not — and nothing else. It fixes nothing and it fails nothing: **a difference
 *  is not an error here**, so the exit code is zero whenever the run finished. It
 *  is non-zero only when the run could not happen at all: no frame directory, no
 *  `INDEX.json`, an artboard that is not in the file it is supposed to be in.
 *
 *  ## How a frame is read
 *
 *  A frame is a Design Canvas document: one `<x-dc>` template, one
 *  `class Component extends DCLogic` beside it whose `renderVals()` returns the
 *  data, and `{{ … }}`, `<sc-for>` and `<sc-if>` between the two. The runtime
 *  that draws them (`design/divan/support.js`) is a React renderer and wants a
 *  browser; all this needs is the text, so the three constructs are interpreted
 *  here — `textsOf` below — against the values `renderVals()` hands back. The
 *  document itself is read by the tag scanner in this file rather than by a DOM:
 *  the app has no HTML parser among its dependencies and this is not worth one.
 *  No frame is copied anywhere and no frame is quoted whole.
 *
 *  ## How a screen is read
 *
 *  Mounted, for real, through `scripts/render-divan.cjs` — the same arrangement
 *  every judgement in `scripts/test-*.cjs` uses, with the same stubs standing in
 *  for the phone. Three things are added to it here, all of them in the
 *  direction of the real app:
 *
 *   · **the real words.** `render-divan` answers `useT()` with the key rather
 *     than the sentence, because a check that looks for `cNeedsYou` is looking
 *     for the one thing a typo cannot fake. This file needs English, because the
 *     frame is in English, so `src/i18n.ts` is put back in front of it.
 *   · **the parts `render-divan` never needed.** `FlatList`, a dozen `Svg`
 *     shapes, and the eight Expo modules the chat screen reaches for. Chat is
 *     the one screen no existing check stands up, and it is a third of Mobile4
 *     and all of Mobile10.
 *   · **one honest reduction.** The Markdown renderer inside the transcript is
 *     answered with the words and none of the formatting. This file compares
 *     words, and a real `markdown-it` in here would be checking `markdown-it`.
 *
 *  ## What a "difference" is
 *
 *  Both sides are reduced to their text, normalised (one kind of quote, one kind
 *  of space, no stray separators), and each unit is looked for anywhere in the
 *  other side's text. So a line the app splits across two elements and the frame
 *  keeps in one still matches: this asks *whether a word is on the screen*, not
 *  where. Position, order and pixels are not its business — `test-divan.cjs`
 *  holds the palette and the parts, `test-dashboard.cjs`, `test-project.cjs`,
 *  `test-board.cjs`, `test-card.cjs`, `test-machine.cjs` and `test-waiting.cjs`
 *  hold each screen's own promises.
 *
 *  Most of what is left over is a frame's invented data against this file's
 *  fixture: the artboards are drawn on five made-up products, three made-up
 *  machines and one made-up evening, and the app draws whatever the paired
 *  computers report. Every one of those is *waived by a rule with a reason on it*
 *  (`WAIVED`, per variant), and the rules are printed with their reasons — so the
 *  two lists that come out are the differences nobody has yet explained, which is
 *  the only interesting number on the page. The report written from this run is
 *  `docs/audit/2026-09-30-divan-mobile-frames.md`.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const frames = path.resolve(root, process.argv[2] ?? '../design/divan/frames');

const die = (msg) => { console.error(`audit-frames: ${msg}`); process.exit(1); };

// ── the frames have to be there ─────────────────────────────────────────────

if (!fs.existsSync(frames)) {
  die(`no frame directory at ${frames}\n`
    + '  The frames are private and are not in this repository. Pass the path:\n'
    + '    node scripts/audit-frames.cjs ../../remote-ai-chat/design/divan/frames');
}
let index;
try { index = JSON.parse(fs.readFileSync(path.join(frames, 'INDEX.json'), 'utf8')); }
catch (e) { die(`cannot read ${path.join(frames, 'INDEX.json')}: ${e.message}`); }

/** The eleven files the mobile artboards are in, and which variant is in which.
 *  The order inside each file is `INDEX.json`'s own — Mobile11 really does draw
 *  S16 first and S14 last. Mobile3 is one template drawn four times rather than
 *  four artboards, so it is named by its loop instead of by an id: `frames` is
 *  the list `renderVals()` hands back, and `D1`–`D4` are the ids inside it.
 *  Web12–Web15 are deliberately absent: they are `web/scripts/audit-frames.mjs`. */
const FILES = [
  { match: '01-mobile1', variants: ['V1', 'V2', 'V3'] },
  { match: '02-mobile2', variants: ['V4', 'V5'] },
  { match: '03-mobile3', loop: 'frames', variants: ['M3'] },
  { match: '04-mobile4', variants: ['T1', 'T2', 'T3', 'C1'] },
  { match: '05-mobile5', variants: ['S1', 'S2'] },
  { match: '06-mobile6', variants: ['S3'] },
  { match: '07-mobile7', variants: ['S4', 'S5', 'S6'] },
  { match: '08-mobile8', variants: ['S7', 'S9'] },
  { match: '09-mobile9', variants: ['S10', 'S11'] },
  { match: '10-mobile10', variants: ['S12', 'S13'] },
  { match: '11-mobile11', variants: ['S16', 'S15', 'S14'] },
];

for (const f of FILES) {
  f.file = index.find((e) => (e.file ?? '').includes(f.match))?.file;
  if (!f.file) die(`INDEX.json lists no file matching ${f.match}`);
  f.path = path.join(frames, f.file.replace(/^frames\//, ''));
  if (!fs.existsSync(f.path)) die(`INDEX.json names ${f.file}, which is not there`);
}

// ── the smallest HTML reader that can hold an artboard ──────────────────────
//
// Tags, attributes and text, with `<style>` and `<script>` swallowed whole. Not
// a DOM and not trying to be one: what is asked of it is "the text under this
// element", against documents this repository does not write.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                      'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parse(html) {
  const doc = { tag: '#doc', attrs: {}, kids: [] };
  const stack = [doc];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][-\w]*)\s*>|<([a-zA-Z][-\w]*)((?:\s+[-:\w@.]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/gi;
  let at = 0;
  let m;
  const text = (s) => { if (s) stack[stack.length - 1].kids.push({ text: s }); };
  while ((m = re.exec(html))) {
    text(html.slice(at, m.index));
    at = re.lastIndex;
    if (m[0].startsWith('<!')) continue;
    if (m[1]) {
      // A close tag pops to the nearest open element of that name, so a document
      // that leaves a `<p>` open does not swallow everything after it.
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = {};
    for (const a of (m[3] ?? '').matchAll(/([-:\w@.]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? '';
    }
    const node = { tag, attrs, kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (VOID.has(tag) || m[4]) continue;
    if (tag === 'script' || tag === 'style') {
      const end = html.toLowerCase().indexOf(`</${tag}`, at);
      const stop = end < 0 ? html.length : end;
      node.kids.push({ text: html.slice(at, stop) });
      re.lastIndex = stop;
      at = stop;
      continue;
    }
    stack.push(node);
  }
  text(html.slice(at));
  return doc;
}

/** The named entities these two sides actually use, plus every numeric one. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
              hellip: '…', middot: '·', times: '×', rsquo: '’', lsquo: '‘',
              ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', euro: '€', pound: '£' };
const unent = (s) => s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
  if (body[0] !== '#') return ENT[body] ?? all;
  const hex = body[1] === 'x' || body[1] === 'X';
  return String.fromCodePoint(parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10));
});

/** Every element under `node` the predicate likes, outermost first. */
function find(node, pred, out = []) {
  for (const kid of node.kids ?? []) {
    if (!kid.tag) continue;
    if (pred(kid)) out.push(kid);
    find(kid, pred, out);
  }
  return out;
}

// ── text, the same way on both sides ────────────────────────────────────────

/** One kind of quote, one kind of space, no stray separator: a difference has to
 *  be a difference in the words, not in which apostrophe somebody typed. */
const norm = (s) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[      ]/g, ' ')
  .replace(/…/g, '...')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[·|,;:]+\s*/, '').replace(/\s*[·|,;:]+$/, '')
  .trim();

/** `{{ expr }}` against a scope, which is `renderVals()`'s object with the loop
 *  variables laid over it. A binding that throws is empty rather than fatal: the
 *  frames are drawn by a runtime with its own opinions about a missing value, and
 *  a run that died on one would say nothing about any screen. */
const evalIn = (expr, scope) => {
  const keys = Object.keys(scope ?? {});
  try { return new Function(...keys, `return (${expr});`)(...keys.map((k) => scope[k])); }
  catch { return undefined; }
};
const unwrap = (attr) => String(attr ?? '').replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '').trim();

/** Every text unit under an element, in order, normalised and emptied of blanks.
 *  On the frame side `interpolate` is on and `sc-for` / `sc-if` are walked; on
 *  the app side neither exists and this is just the words. */
function textsOf(node, { scope = null, bound = null, placeholders = false } = {}) {
  const found = [];
  const walk = (el, at) => {
    for (const kid of el.kids ?? []) {
      if (kid.text !== undefined) {
        const raw = unent(kid.text);
        const done = scope
          ? raw.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalIn(e.trim(), at) ?? ''))
          : raw;
        const unit = norm(done);
        if (!unit) continue;
        found.push(unit);
        // A unit that came out of a `{{ … }}` is the artboard's *data* and not
        // its chrome: `renderVals()` put it there. Recorded rather than guessed
        // at, which is the only way to tell an invented ticket title from a
        // button's label without listing either.
        if (bound && raw.includes('{{')) bound.add(unit);
        continue;
      }
      if (kid.tag === 'style' || kid.tag === 'script' || kid.tag === 'noscript') continue;
      // An empty box's only words are a prop rather than a child, so without
      // this a composer is indistinguishable from an empty view.
      if (placeholders && kid.attrs['data-placeholder']) {
        const unit = norm(unent(kid.attrs['data-placeholder']));
        if (unit) found.push(unit);
      }
      if (scope && kid.tag === 'sc-for') {
        const list = evalIn(unwrap(kid.attrs.list), at);
        const as = kid.attrs.as || 'it';
        if (Array.isArray(list)) for (const item of list) walk(kid, { ...at, [as]: item });
        continue;
      }
      if (scope && kid.tag === 'sc-if') {
        if (evalIn(unwrap(kid.attrs.value), at)) walk(kid, at);
        continue;
      }
      walk(kid, at);
    }
  };
  walk(node, scope);
  return found;
}

// ── the frames, read ────────────────────────────────────────────────────────

/** Every mobile variant's text, by id, and the label the artboard carries. The
 *  artboard is the element with `data-screen-label` on it — so the designer's
 *  caption above it and the note underneath, which are about the drawing rather
 *  than in it, are left out. */
const frameTexts = {};
const frameLabel = {};
/** Per variant, the units that came out of a data binding rather than out of the
 *  template: everything `renderVals()` invented. */
const frameBound = {};

for (const f of FILES) {
  const src = fs.readFileSync(f.path, 'utf8');
  const js = /<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/.exec(src);
  let vals = {};
  if (js) {
    try {
      class DCLogic {}
      const Component = new Function('DCLogic', `${js[1]}\nreturn Component;`)(DCLogic);
      vals = new Component().renderVals() ?? {};
    } catch (e) { die(`${f.file}: its renderVals() would not run: ${e.message}`); }
  }
  const doc = parse(src);

  if (f.loop) {
    // One artboard drawn once per item of a list — Mobile3's four moments of the
    // same gesture. One variant, four states, and the union of their words: the
    // drawing is one drawing, and a run that compared the app against only the
    // first of them would be leaving three quarters of the gesture unasked.
    const loop = find(doc, (n) => n.tag === 'sc-for' && unwrap(n.attrs.list) === f.loop
      && find(n, (k) => 'data-screen-label' in k.attrs).length > 0)[0];
    if (!loop) die(`${f.file}: no sc-for over ${f.loop} with an artboard in it`);
    const art = find(loop, (n) => 'data-screen-label' in n.attrs)[0];
    const list = evalIn(f.loop, vals);
    if (!Array.isArray(list) || !list.length) die(`${f.file}: ${f.loop} is not a list of states`);
    const as = loop.attrs.as || 'it';
    const id = f.variants[0];
    const bound = new Set();
    const seen = [];
    const ids = [];
    for (const item of list) {
      seen.push(...textsOf(art, { scope: { ...vals, [as]: item }, bound }));
      if (item && item.id) ids.push(String(item.id));
    }
    frameTexts[id] = [...new Set(seen)];
    frameBound[id] = bound;
    frameLabel[id] = `${art.attrs['data-screen-label']} · ${ids.join(', ')}`;
    continue;
  }

  for (const id of f.variants) {
    const opt = find(doc, (n) => n.attrs.id === id && (n.attrs.class ?? '').includes('dv-opt'))[0];
    if (!opt) die(`${f.file}: no variant #${id}`);
    const art = find(opt, (n) => 'data-screen-label' in n.attrs)[0];
    if (!art) die(`${f.file}: #${id} has no artboard in it`);
    const bound = new Set();
    frameLabel[id] = art.attrs['data-screen-label'];
    frameTexts[id] = textsOf(art, { scope: vals, bound });
    frameBound[id] = bound;
  }
}

// ── the app, stood up ───────────────────────────────────────────────────────

const R = require('./render-divan.cjs');
const React = R.React;
const h = React.createElement;
const I = require(path.join(root, 'src/i18n.ts'));

/** The parts `render-divan` never needed, because no check before this one stood
 *  up a list or the chat screen. Each of these is the smallest thing that answers
 *  the question "what words came out"; none of them decides anything. */
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
/** A field that shows what is in it. `render-divan` draws the placeholder and
 *  not the value, because nothing before this compared a screen with something
 *  typed into it — and Mobile8 S9 is a screen with two sentences typed into it. */
RN.TextInput = React.forwardRef(function TextInput(props, _ref) {
  const { style, value, placeholder, ...rest } = props;
  const attrs = { 'data-rn': 'TextInput', 'data-style': JSON.stringify(R.flatten(style)) };
  // A field shows one or the other, never both.
  if (placeholder && !value) attrs['data-placeholder'] = String(placeholder);
  if (rest.accessibilityLabel) attrs['data-label'] = rest.accessibilityLabel;
  return h('span', attrs, value == null ? null : String(value));
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

/** `render-divan`'s stand-in for `src/store.ts`, reached the way a screen reaches
 *  it, so that what is patched onto it here is the object the screens are handed.
 *  Two patches, both towards the real app:
 *
 *   · `useT` answers with the sentence rather than the key. Every `test-*.cjs`
 *     wants the key — it is the one thing a typo cannot fake — and this file
 *     wants the English, because that is what the frame is in.
 *   · `buildTimeline` is the real one, off `src/store.ts`. It is pure, it is what
 *     turns a chat's events into the rows the transcript draws, and a stub of it
 *     would be this file drawing its own idea of a conversation. */
const STORE = Module._load('./store', { filename: path.join(root, 'src', 'audit.ts') }, false);
STORE.useT = () => (key, params) => I.t(key, params);
STORE.buildTimeline = require(path.join(root, 'src/store.ts')).buildTimeline;
STORE.fileUrl = () => null;

/** What a screen drew, as text. `data-placeholder` is in: an empty composer's
 *  only words are its placeholder, and both sides of Mobile10 turn on it. */
const drew = (markup) => textsOf(parse(markup), { placeholders: true });

// ── the fleet the artboards draw ────────────────────────────────────────────
//
// Three computers and five products, arranged the way Mobile1 V1, Mobile5 S1 and
// Mobile11 S15 arrange them: a studio that answered twelve seconds ago, a mini
// whose lid has been shut for two hours and fourteen minutes with one product
// that only lives there, and a Hetzner box that answered three seconds ago. The
// cast is the frames' own and so is the shape of it; the values are this file's,
// because that is the whole point of the comparison.
//
// The clock is this moment rather than a round number: every age on every one of
// these screens is measured against the phone's own `Date.now()`, so a fixture
// stamped in 2023 would have every machine on it two years silent and every
// state on every screen would be the stale one.

const M = require(path.join(root, 'src/divan.ts'));
const C = require(path.join(root, 'src/card.ts'));
const G = require(path.join(root, 'src/drag.ts'));

const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;
const QUIET = 2 * HOUR + 14 * MIN;

const branch = (kind, name, o = {}) => ({
  id: `${kind}-id`, kind, name, summary: o.summary ?? '', summary_at: o.at ?? null,
  cards: o.cards ?? {}, open: o.open ?? 0,
});
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  summary: o.summary ?? '', kind: o.kind ?? '', repos: o.repos ?? [], sort: 0, archived: false,
  created_at: o.created_at ?? 0, updated_at: o.updated_at ?? NOW - 60,
  branches: o.branches ?? [], counts: o.counts ?? {},
  running: o.running ?? 0, waiting: o.waiting ?? 0, summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project ?? 'Quire-id', branch_id: `${o.branch ?? 'engineering'}-id`,
  branch: o.branch ?? 'engineering', column: o.column ?? 'in_progress', position: o.position ?? 0,
  title: o.title ?? id, summary: o.summary ?? '', executor: o.executor ?? 'coding_agent',
  machine: o.machine ?? null, repo: o.repo ?? null, ustabasi_id: o.ustabasi ?? null,
  agent_status: o.status ?? null, agent_status_at: o.at ?? null, agent_detail: o.detail ?? '',
  created_at: o.created ?? 0, updated_at: o.updated ?? 0, moved_at: o.moved ?? null,
});
const agent = (id, o = {}) => ({
  card_id: id, project_id: o.project, project: o.projectName ?? '', branch: o.branch ?? 'engineering',
  title: o.title ?? id, executor: o.executor ?? 'coding_agent', machine: o.machine ?? '',
  status: 'running', detail: o.detail ?? '', since: o.since ?? NOW - 600,
  ustabasi_id: o.ustabasi ?? null,
});
const quota = (o = {}) => ({ enabled: true, accounts: 2, blocked: o.blocked ?? 0, spent: !!o.spent,
                             left: o.left ?? null, resets_at: o.resets_at ?? null, unknown: !!o.unknown });
const pull = (number, title, o = {}) => ({ number, title, branch: `pr/${number}`, draft: !!o.draft,
                                           checks: o.checks ?? null, failing: o.failing ?? 0,
                                           at: o.at ?? NOW - 600 });
const snapshot = (machine, o = {}) => ({ machine, os: o.os ?? 'Darwin', at: o.at ?? NOW,
  projects: o.projects ?? [], cards: o.cards ?? [], agents: o.agents ?? [], quota: o.quota ?? null,
  activity: o.activity ?? {}, pulls: o.pulls ?? {}, queue: {} });
const paired = (id, name, o = {}) => ({ id, name, state: { snapshot: o.snapshot ?? null,
  at: o.at ?? null, reachable: !!o.reachable, error: o.error ?? null, old: false } });

const QUOTA = quota({ left: 0.64, resets_at: NOW + 4 * HOUR + 44 * MIN });
const SPENT = quota({ spent: true, left: 0, resets_at: NOW + 4 * HOUR + 46 * MIN, blocked: 5 });

/** Mobile2 V4's product: five faces, an agent at work, a question on one branch,
 *  something that fell over on another, and two repositories. */
const QUIRE = project('Quire', {
  kind: 'SaaS', summary: 'client portals for studios', repos: ['/r/quire', '/r/quire-web'],
  running: 2, waiting: 2, counts: { ice_box: 11, queued: 3, in_progress: 6, done: 48 },
  branches: [
    branch('engineering', 'Engineering', { summary: 'v3.18 deployed, Safari login still red',
      at: NOW - 6 * MIN, open: 9, cards: { ice_box: 4, queued: 2, in_progress: 4, done: 31 } }),
    branch('seo', 'SEO', { summary: 'Rewriting comparison pages, 9 of 14 done',
      at: NOW - 3 * HOUR, open: 4, cards: { ice_box: 3, queued: 1, in_progress: 1, done: 12 } }),
    branch('analytics', 'Analytics', { summary: 'Up since the pricing test', at: NOW - 16 * HOUR,
      open: 1, cards: { in_progress: 1, done: 2 } }),
    branch('marketing', 'Marketing', { summary: 'Draft waits for you', at: NOW - 30 * HOUR,
      open: 2, cards: { ice_box: 2, done: 3 } }),
    branch('customers', 'Customers', { summary: 'Both answered by agent', at: NOW - 3 * DAY,
      open: 0, cards: { done: 8 } }),
  ],
});

/** Mobile7 S4's: the same page with another product's numbers in the same slots,
 *  and two faces nobody has put a card on at all. */
const KANJI = project('Kanji Daily', {
  kind: 'iOS · Android', summary: 'five kanji a day', repos: ['/r/kanji'],
  running: 2, counts: { ice_box: 3, in_progress: 2, done: 19 },
  branches: [
    branch('engineering', 'Engineering', { summary: 'Android build green again on Gradle 8.6',
      at: NOW - 40 * MIN, open: 4, cards: { ice_box: 3, in_progress: 1, done: 14 } }),
    branch('analytics', 'Analytics', { summary: 'D30 retention up after the streak change',
      at: NOW - 5 * HOUR, open: 1, cards: { in_progress: 1, done: 5 } }),
    branch('marketing', 'Marketing', {}),
    branch('customers', 'Customers', { summary: '3 emails open, all older than a day',
      at: NOW - 2 * DAY, open: 3, cards: { ice_box: 3 } }),
  ],
});

/** Mobile1 V2's third product, whose only open card is nobody's but yours. */
const HUSH = project('Hush', {
  kind: 'iOS', summary: 'a quiet journal', repos: ['/r/hush'], waiting: 1,
  counts: { in_progress: 1, done: 27 },
  branches: [branch('engineering', 'Engineering', { summary: 'Resubmit 2.4 to App Review',
    at: NOW - 27 * MIN, open: 1, cards: { in_progress: 1, done: 27 } })],
});

/** Mobile7 S5's: three weeks without an agent, a commit or a card moving. */
const WALK = project('The Long Walk', {
  kind: 'Content site', summary: 'long-distance hiking', repos: ['/r/walk'],
  counts: { ice_box: 2, done: 212 },
  branches: [
    branch('seo', 'SEO', { summary: 'Last crawl found no errors', at: NOW - 23 * DAY,
      open: 2, cards: { ice_box: 2, done: 180 } }),
    branch('analytics', 'Analytics', { summary: 'Traffic down slightly, seasonal',
      at: NOW - 16 * HOUR, open: 0, cards: { done: 20 } }),
    branch('marketing', 'Marketing', { summary: 'Newsletter paused since August',
      at: NOW - 41 * DAY, open: 0, cards: { done: 12 } }),
  ],
});

/** Mobile7 S6's: created a minute ago, five faces made, nothing on any of them,
 *  and no repository to have a history in. */
const PEBBLE = project('Pebble', {
  created_at: NOW - 60, updated_at: NOW - 60,
  branches: ['engineering', 'seo', 'analytics', 'marketing', 'customers']
    .map((k) => branch(k, k[0].toUpperCase() + k.slice(1))),
});

/** Quire's board, one card in every state Mobile2 V5 and Mobile8 S7 draw. */
const QUIRE_CARDS = [
  card('q1', { status: 'asking', ustabasi: 12, at: NOW - 12 * MIN, position: 0,
    title: 'Webhook retry policy',
    summary: 'Failed Stripe webhooks are dropped after 3 tries. Decide whether to keep that '
      + "or follow Stripe's 3-day schedule, then build it.",
    detail: 'Keep our 3 webhook retries, or follow Stripe’s 3-day schedule?',
    created: NOW - 2 * DAY, moved: NOW - 40 * MIN }),
  card('q2', { status: 'failed', ustabasi: 7, at: NOW - 9 * MIN, position: 1,
    title: 'Price localisation for GBP', summary: 'UK studios see euros at checkout.',
    detail: '3 of 5 checks', created: NOW - 2 * DAY }),
  card('q3', { status: 'running', ustabasi: 9, at: NOW - 23 * MIN, position: 2,
    title: 'Bulk invite clients from a CSV',
    summary: 'Studios want to add a whole client roster at once. Let them upload a CSV of names '
      + 'and emails, preview who will be invited, then send in one go.',
    detail: '3 of 5 checks', created: NOW - 3 * DAY, moved: NOW - 26 * MIN }),
  card('q4', { status: 'verified', position: 3, title: 'Invoice PDF redesign',
    summary: "Match the portal's type and spacing, keep the layout accountants expect.",
    created: NOW - 4 * DAY }),
  card('q5', { executor: 'human', position: 4, moved: NOW - 2 * DAY, created: NOW - 3 * DAY,
    title: 'Write the onboarding email',
    summary: 'The first email after signup is still the default one. Write a short, personal '
      + 'version in my own voice.' }),
  card('q6', { column: 'queued', branch: 'seo', title: 'Comparison page: Quire vs Notion',
    created: NOW - DAY }),
  card('q7', { column: 'ice_box', title: 'Zapier integration', created: NOW - 5 * DAY }),
  card('q8', { column: 'ice_box', branch: 'seo', title: 'Rewrite 14 comparison pages',
    status: 'running', ustabasi: 31, at: NOW - 40 * MIN, detail: '9 of 14',
    created: NOW - 6 * DAY }),
  card('q9', { branch: 'analytics', status: 'running', position: 5, title: 'Pricing test read-out',
    executor: 'branch_agent', created: NOW - DAY }),
];

/** …and what the code host said about its two repositories. Quire's site has
 *  three open and its web repository nothing, which is an answer and not a gap. */
const QUIRE_PULLS = {
  '/r/quire': { at: NOW - 200, open: [
    pull(412, 'Bulk invite from CSV', { checks: 'pending', at: NOW - 40 * MIN }),
    pull(410, 'GBP price localisation', { checks: 'failing', failing: 2, at: NOW - 5 * MIN }),
    pull(409, 'Invoice PDF redesign', { checks: 'passing', draft: true, at: NOW - 90 * MIN })] },
  '/r/quire-web': { at: NOW - 200, open: [] },
};

const ACTIVITY = {
  '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 3 },
  '/r/kanji': { at: NOW - 2 * DAY, week: 4, today: 0 },
  '/r/hush': { at: NOW - 2 * DAY, week: 2, today: 0 },
  '/r/walk': { at: NOW - 23 * DAY, week: 0, today: 0 },
};

/** The computer everything is checked out on. `o.quota` is how the two quota
 *  screens are told apart, and `o.calm` is Mobile1 V3's morning. */
const studio = (o = {}) => paired('h1', 'studio', { reachable: true, at: NOW - 12,
  snapshot: snapshot('studio', { at: NOW - 12, quota: o.quota ?? QUOTA,
    projects: [QUIRE, KANJI, HUSH, WALK, PEBBLE],
    cards: o.cards ?? QUIRE_CARDS.concat([
      card('k1', { project: 'Kanji Daily-id', status: 'running', ustabasi: 17,
                   title: 'Gradle 8.7 build', detail: 'Android build red on Gradle 8.7',
                   created: NOW - DAY }),
      // The decision Mobile6 S3 draws as its second group: the assistant asking
      // which way to go, which is a choice rather than blocked work
      // (`src/waiting.ts kindOf`).
      card('h1c', { project: 'Hush-id', executor: 'assistant', status: 'asking',
                    title: 'Resubmit 2.4 to App Review',
                    summary: 'Apple rejected 2.4 over the paywall wording.',
                    detail: 'Resubmit 2.4 with "Start 7-day free trial, then €4.99/mo"?',
                    at: NOW - 27 * MIN, created: NOW - DAY, moved: NOW - 27 * MIN }),
      card('w1', { project: 'The Long Walk-id', branch: 'seo', column: 'ice_box',
                   title: '6 glossary pages', created: NOW - 30 * DAY }),
    ]),
    agents: o.agents ?? [
      agent('q3', { project: 'Quire-id', projectName: 'Quire', ustabasi: 9, machine: 'studio',
                    title: 'Bulk invite clients from a CSV', detail: '3 of 5 checks' }),
      agent('q9', { project: 'Quire-id', projectName: 'Quire', branch: 'analytics',
                    machine: 'studio', executor: 'branch_agent', title: 'Pricing test read-out' }),
      agent('k1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'studio',
                    title: 'Gradle 8.7 build', detail: 'Android build red on Gradle 8.7' }),
    ],
    activity: ACTIVITY, pulls: QUIRE_PULLS }) });

/** The laptop with the lid shut, and the one product that only lives there. */
const MINI = paired('h2', 'mini', { at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Kanji Daily', { kind: 'iOS · Android', summary: 'five kanji a day',
      repos: ['/r/kanji-api'], running: 2, counts: { in_progress: 2 },
      branches: [branch('engineering', 'Engineering', { open: 2, cards: { in_progress: 2 } })] })],
    cards: [card('m1', { project: 'Kanji Daily-id', status: 'blocked', ustabasi: 21,
                         at: NOW - (HOUR + 12 * MIN), title: 'Fix portal login on Safari 17',
                         summary: 'Clients on Safari 17 are sent back to login.',
                         detail: "Can't reproduce on the simulator.", created: NOW - 2 * DAY }),
            card('m2', { project: 'Kanji Daily-id', status: 'running', title: 'Deck sync',
                         created: NOW - DAY })],
    agents: [agent('m1', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'mini',
                           title: 'Fix portal login on Safari 17' }),
             agent('m2', { project: 'Kanji Daily-id', projectName: 'Kanji Daily', machine: 'mini',
                           title: 'Deck sync' })] }) });

/** The third machine, which answers and holds two of Quire's cards. */
const CLOUD = paired('h3', 'cloud', { reachable: true, at: NOW - 3,
  snapshot: snapshot('cloud', { at: NOW - 3, quota: QUOTA,
    projects: [project('Quire', { kind: 'SaaS', summary: 'client portals for studios',
      repos: ['/r/quire'], running: 1, counts: { in_progress: 1 },
      branches: [branch('seo', 'SEO', { open: 1, cards: { in_progress: 1 } })] })],
    cards: [card('c1', { branch: 'seo', status: 'running', title: 'Comparison pages',
                         detail: '9 of 14', created: NOW - DAY })],
    agents: [agent('c1', { project: 'Quire-id', projectName: 'Quire', branch: 'seo',
                           machine: 'cloud', executor: 'branch_agent',
                           title: 'Comparison pages', detail: '9 of 14' })] }) });

/** …and the same machine with nothing running on it, which is what draws
 *  Mobile11 S14's idle Coder (`src/machine.ts` `freeLine`), with the assistant on
 *  it so that the page's third group is the one S14 draws rather than `You`. */
const CLOUD_IDLE = paired('h3', 'cloud', { reachable: true, at: NOW - 3,
  snapshot: snapshot('cloud', { at: NOW - 3, quota: QUOTA,
    projects: [project('Quire', { kind: 'SaaS', repos: ['/r/quire'],
      branches: [branch('engineering', 'Engineering')] })],
    cards: [], agents: [] }) });

/** Mobile1 V3's morning: nothing needs anybody, agents running, and fourteen
 *  things landed while the phone was face down. */
const CALM_QUIET = (id, name) => paired(id, name, { reachable: true, at: NOW - 20,
  snapshot: snapshot(name, { at: NOW - 20, quota: QUOTA,
    projects: [project('Hush', { kind: 'iOS', repos: ['/r/hush'],
      branches: [branch('engineering', 'Engineering')] })],
    activity: { '/r/hush': { at: NOW - 5 * HOUR, week: 3, today: 1 } } }) });

const CALM = [paired('h1', 'studio', { reachable: true, at: NOW - 12,
  snapshot: snapshot('studio', { at: NOW - 12, quota: QUOTA,
    projects: [project('Quire', { kind: 'SaaS', summary: 'client portals for studios',
        repos: ['/r/quire'], running: 2, counts: { in_progress: 2, done: 48 },
        branches: [branch('engineering', 'Engineering', { open: 2, cards: { in_progress: 2 } })] }),
      project('Kanji Daily', { kind: 'iOS · Android', repos: ['/r/kanji'], running: 1,
        counts: { in_progress: 1 },
        branches: [branch('engineering', 'Engineering', { open: 1, cards: { in_progress: 1 } })] }),
      project('Hush', { kind: 'iOS', repos: ['/r/hush'],
        branches: [branch('engineering', 'Engineering')] }),
      project('The Long Walk', { kind: 'Content site', repos: ['/r/walk'],
        branches: [branch('seo', 'SEO')] })],
    cards: [card('c3', { status: 'running', ustabasi: 9, title: 'Bulk invite clients from a CSV' }),
            card('c4', { status: 'running', title: 'Pricing test read-out' }),
            card('c5', { project: 'Kanji Daily-id', status: 'running', title: 'Deck sync' })],
    agents: [agent('c3', { project: 'Quire-id', projectName: 'Quire', machine: 'studio',
                           title: 'Bulk invite clients from a CSV' }),
             agent('c4', { project: 'Quire-id', projectName: 'Quire', machine: 'studio',
                           title: 'Pricing test read-out' }),
             agent('c5', { project: 'Kanji Daily-id', projectName: 'Kanji Daily',
                           machine: 'studio', title: 'Deck sync' })],
    activity: { '/r/quire': { at: NOW - 3 * HOUR, week: 14, today: 14 },
                '/r/kanji': { at: NOW - 4 * HOUR, week: 9, today: 4 },
                '/r/hush': { at: NOW - 5 * HOUR, week: 3, today: 1 },
                '/r/walk': { at: NOW - 6 * HOUR, week: 3, today: 3 } } }) }),
  CALM_QUIET('h2', 'mini'), CALM_QUIET('h3', 'cloud')];

/** …and the same laptop with its lid open, which is the state Mobile1 V1, V2 and
 *  every project and board artboard but Mobile8 S7 are drawn in: three machines,
 *  all reachable. The artboards that draw a machine that has stopped answering
 *  say so in their own titles, and they are the ones given `quiet`. */
const MINI_UP = paired('h2', 'mini', { reachable: true, at: NOW - 30,
  snapshot: { ...MINI.state.snapshot, at: NOW - 30 } });

/** Every fleet a variant is drawn against, by what it is a case of. */
const FLEET = {
  /** Three computers, all of them answering. */
  answering: [studio(), MINI_UP, CLOUD],
  /** …and the same three with the laptop's lid shut two hours ago. */
  quiet: [studio(), MINI, CLOUD],
  /** Mobile1 V3's morning: nothing needs anybody. */
  calm: CALM,
  /** Mobile5 S2: today's quota is gone and five agents stopped where they were. */
  spent: [studio({ quota: SPENT }), MINI_UP, CLOUD],
  /** Mobile11 S14's roster, which is the one artboard about the executors
   *  themselves: a busy Coder and a busy branch agent on the studio, a Coder
   *  nobody can reach on the mini, an idle Coder on a machine with nothing
   *  running, the assistant at work, and the cards that are yours. */
  executors: [studio(), MINI, CLOUD_IDLE],
};

// ── the screens, and how each artboard's state is reached ────────────────────

const SCREEN = {
  dashboard: require(path.join(root, 'app/dashboard.tsx')).default,
  branch: require(path.join(root, 'app/branch/[id].tsx')).default,
  card: require(path.join(root, 'app/card/[id].tsx')).default,
  chat: require(path.join(root, 'app/chat/[id].tsx')).default,
  waiting: require(path.join(root, 'app/waiting.tsx')).default,
  'new-ticket': require(path.join(root, 'app/new-ticket.tsx')).default,
  machine: require(path.join(root, 'app/machine.tsx')).default,
  machines: require(path.join(root, 'app/machines.tsx')).default,
  executors: require(path.join(root, 'app/executors.tsx')).default,
};

/** Which route file each screen is, for the report and for the list of screens
 *  no artboard draws. */
const FILE_OF = {
  dashboard: 'app/dashboard.tsx', branch: 'app/branch/[id].tsx', card: 'app/card/[id].tsx',
  chat: 'app/chat/[id].tsx', waiting: 'app/waiting.tsx', 'new-ticket': 'app/new-ticket.tsx',
  machine: 'app/machine.tsx', machines: 'app/machines.tsx', executors: 'app/executors.tsx',
};

/** Everything a Divan screen finds in the store. The actions answer and record
 *  nothing: no variant here presses anything, and a screen that asked its
 *  computer for something would be drawing a state no artboard drew. */
const holding = (hosts, extra = {}) => ({
  hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
  divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
  host: hosts.length ? { id: hosts[0].id, name: hosts[0].name, host: '100.64.1.2', port: 8790, token: 't' } : null,
  conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  moveCard: () => Promise.resolve({ error: '' }), createCard: () => Promise.resolve(),
  answerCard: () => Promise.resolve(), loadCard() {}, sayCard: () => Promise.resolve(),
  switchHost() {}, removeHost: () => Promise.resolve(),
  ...extra,
});

/** One screen, in one theme, with one fleet in hand and one address. */
function draw(name, { theme = 'dark', fleet = 'answering', at = {}, store = {}, props } = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  const hosts = FLEET[fleet];
  R.store.set(holding(hosts, store));
  R.params.set(at);
  return R.render(theme, h(SCREEN[name], props));
}

// ── the card, as its own machine hands it over ──────────────────────────────
//
// `app/card/[id].tsx` draws what `loadCard` put in the store rather than what the
// board carries, so the three faces of Mobile4 need that answer. It is the
// daemon's own shape (`docs/PROTOCOL.md`), filled the way a card somebody has
// been reading for a few minutes is filled.

const BRIEF = {
  goal: 'Add POST /clients/import accepting text/csv (name,email[,company]), max 500 rows. '
    + 'Dry run first; ?commit=1 sends invites via InviteMailer.',
  done_criteria: ['Dry run returns valid / duplicate / invalid',
                  'Duplicates matched on lower(email)',
                  '501 rows answer 422 with the row count',
                  'Commit is idempotent per upload id',
                  'Preview UI passes axe, 0 violations'],
  verify_cmd: 'npm test clients/import\nnpm run lint && npm run typecheck',
  constraints: ['No new dependencies; papaparse is already in web/', "Don't touch billing/"],
  paths: ['api/src/routes/clients/import.ts', 'api/src/mailers/InviteMailer.ts',
          'web/src/portal/ImportClients.tsx'],
  notes: 'Studios often paste Excel exports with a BOM; strip it.',
};

const TICKET = {
  id: 9, title: 'Bulk invite clients from a CSV', status: 'running', stage: 'work', round: 1,
  repo: '/r/quire', branch: 'ustabasi/9', created_at: NOW - 3 * DAY, updated_at: NOW - 4 * MIN,
  started_at: NOW - 23 * MIN, finished_at: null, goal: BRIEF.goal,
  done_criteria: BRIEF.done_criteria, escalation: '',
  verdict: { round: 1, verdict: 'partly',
    findings: BRIEF.done_criteria.map((c, i) => ({ criterion: c, status: i < 3 ? 'met' : 'unmet' })) },
  notes: [], note_count: 0, last_event: null, project: 'quire',
  round_started_at: NOW - 23 * MIN, git: null, steps: [],
};

/** Two pages of the run, so that the live face is a river with something in it
 *  and the second page is one this phone watched arrive. */
const RUN_ONE = [
  { k: 'tool', id: 't1', name: 'Read', input: { file_path: '/r/quire/api/src/routes/clients/import.ts' } },
  { k: 'result', id: 't1', text: 'ok' },
  { k: 'tool', id: 't2', name: 'Bash', input: { command: 'npm test clients/import' } },
  { k: 'result', id: 't2', text: '11 passed', error: false },
  { k: 'text', text: 'Splitting the commit into batches of 100' },
];
const RUN_TWO = [
  { k: 'tool', id: 't3', name: 'Bash', input: { command: 'npm run e2e --grep "csv invite"' } },
  { k: 'result', id: 't3', text: 'timeout at 501 rows', error: true },
  { k: 'text', text: 'Batching the commit, 100 at a time' },
];
const detail = (events) => ({
  card: { ...QUIRE_CARDS[2], host: 'h1', machine: 'studio', agent: BRIEF },
  project: QUIRE, ticket: TICKET,
  run: { available: true, reason: '', run: 'r1', events, cursor: 'r1:120', live: true,
         caught_up: true },
});
const OPEN_CARD = C.took(C.took(C.opening('q3', 'h1'), detail(RUN_ONE), NOW - 60),
                         detail(RUN_TWO), NOW);

// ── the conversation ────────────────────────────────────────────────────────
//
// Mobile4 C1 and Mobile10 are the chat screen, and nothing else in this
// repository stands it up — so this is the one fixture here with no sibling in
// `scripts/test-*.cjs`. Four turns in one evening, in the daemon's own event
// shape (`src/protocol.ts RacEvent`).

const CHAT = { id: 'c1', group_id: null, title: 'Tonight', provider: 'claude', model: 'opus',
  effort: 'high', perm_mode: 'safe', cwd: '/Users/x/projects/kanji', provider_session_id: 's1',
  account_id: null, status: 'idle', last_preview: '', max_turns: null, max_budget_usd: null,
  total_cost_usd: 0.21, pinned: 0, archived: 0, created_at: NOW - 2 * HOUR, updated_at: NOW - 3 * MIN };

const ev = (seq, event, data) => ({ event, chat_id: 'c1', seq, ts: NOW - 40 * MIN + seq * 4 * MIN, data });
const TURNS = [
  ev(1, 'message.user', { text: 'kanji android still red?' }),
  ev(2, 'message.assistant', { text: 'Yes. Gradle 8.7 breaks the Firebase plugin, and Coder has '
    + 'tried two workarounds.' }),
  ev(3, 'turn.done', { cost_usd: 0.04 }),
  ev(4, 'message.user', { text: 'pin 8.6 and move on. ticket for the upgrade' }),
  ev(5, 'message.assistant', { text: 'Done. Coder restarted on 8.6.' }),
  ev(6, 'turn.done', { cost_usd: 0.05 }),
  ev(7, 'message.user', { text: 'the quire newsletter is too long. half it' }),
  ev(8, 'message.assistant', { text: 'Cut from 520 to 250 words. I kept the pricing section and '
    + 'dropped the changelog.' }),
  ev(9, 'turn.done', { cost_usd: 0.12 }),
];

const chatStore = () => ({
  chats: { c1: CHAT }, events: { c1: TURNS }, live: {}, thinking: {}, progress: {}, busy: {},
  loadedChats: { c1: true }, limits: {}, groups: [], accounts: [], accountsLoaded: true,
  catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: 'default' }],
                       efforts: ['high'], perm_modes: ['safe'] } },
  hostInfo: { name: 'studio', os: 'Darwin', os_version: '25.3.0', daemon_version: '1.9.0',
              versions: { claude: '1.2.4' }, roots: ['/Users/x/projects'] },
  openChat() {}, send: () => Promise.resolve(), interrupt: () => Promise.resolve(),
  respond: () => Promise.resolve(), uploadAttachment: () => Promise.resolve(null),
  updateChat: () => Promise.resolve(), deleteChat: () => Promise.resolve(),
  createGroup: () => Promise.resolve(), settleLive() {}, loadAccounts: () => Promise.resolve(),
});

// ── the gesture ─────────────────────────────────────────────────────────────
//
// Mobile3 is four moments of one drag, and a static render cannot hold a gesture:
// `renderToStaticMarkup` draws once, and every one of those four moments is a
// state a hook took on after a touch. So the board it happens on is rendered the
// ordinary way, and the surfaces the gesture puts over it are mounted with the
// state each moment puts them in — `DragHint` with the sentence `src/drag.ts`
// chooses for that moment, the `Float` with the card in the air, the `DropSlot`
// it left behind, and the landed card's own foot. Those are the same parts
// `app/dashboard.tsx` draws and the same words it reads; what is not asked here
// is the arithmetic that chooses between them, which is `test-drag.cjs`'s.

const DRAG_PARTS = require(path.join(root, 'src/components/drag.tsx'));
const DIVAN_PARTS = require(path.join(root, 'src/components/divan.tsx'));
const BOARD_PARTS = require(path.join(root, 'src/components/board.tsx'));

/** One sentence out of the drag's own words, the two-step `app/dashboard.tsx`
 *  takes: a column's name and an executor's name are keys themselves and are put
 *  into the reader's language before they are put into the sentence. */
const dragWords = (say) => I.t(say.said.key, say.who ? { ...say.said.params, who: I.t(say.who) }
  : say.col ? { ...say.said.params, col: I.t(say.col) } : say.said.params);

/** The four moments, as `src/drag.ts` sees them: held in its own column, aimed at
 *  another column's tab, resting there long enough for that column to open with a
 *  place picked, and put down. */
function dragSurfaces() {
  const rect = (key, i) => ({ key, rect: { x: 12 + i * 94, y: 96, w: 90, h: 46 } });
  const targets = ['ice_box', 'queued', 'in_progress', 'done'].map(rect);
  const carried = G.carry(QUIRE_CARDS[5], 'coding_agent', 'exCoder');
  const base = { carried, targets, from: { x: 195, y: 300 }, onBoard: true, position: null };
  const moments = [
    // Held, in its own column, the thumb where the card lies.
    { id: 'D1', drag: { ...base, open: 'queued', at: { x: 195, y: 300 }, over: null,
                        opened: false, since: null, slot: null } },
    // Carried onto the In Progress tab, which has not opened yet.
    { id: 'D2', drag: { ...base, open: 'queued', at: { x: 290, y: 118 }, over: 'in_progress',
                        opened: false, since: NOW * 1000, slot: null } },
    // The tab has opened under it and a place in the column is picked.
    { id: 'D3', drag: { ...base, open: 'in_progress', at: { x: 290, y: 380 }, over: 'in_progress',
                        opened: true, since: NOW * 1000, slot: 1, position: 1 } },
  ];
  const kids = [];
  for (const m of moments) {
    const air = G.hint(m.drag, { others: 5 });
    kids.push(h(DRAG_PARTS.DragHint, { key: `h${m.id}`, tone: air.tone, text: dragWords(air) }));
  }
  // D4: the card that has just been put down, and the two other things a release
  // can come back with. All three are the card's own foot.
  for (const [key, landed] of Object.entries({
    started: { carried, column: 'in_progress', moved: true, started: true, error: '' },
    moved: { carried, column: 'ice_box', moved: true, started: false, error: '' },
    refused: { carried, column: 'in_progress', moved: true, started: false, error: 'the queue is full' },
  })) {
    const say = G.foot(landed);
    kids.push(h(BOARD_PARTS.BoardCard, { key: `c${key}`, face: carried.face, who: I.t(carried.who),
      title: carried.title, line: '', landed: { text: dragWords(say), tone: say.tone,
        action: say.undo ? I.t('dgUndo') : undefined } }));
  }
  kids.push(h(DRAG_PARTS.Float, { key: 'float', face: carried.face, who: I.t(carried.who),
                                  title: carried.title }));
  kids.push(h(DRAG_PARTS.DropSlot, { key: 'slot', landing: true }));
  return h(RN.View, null, kids);
}

// ── which screen each artboard is, and in which state ───────────────────────
//
// `screens` is what the report names as the code behind a variant; `show` is the
// markup. Two artboards draw one screen scrolled to two different heights
// (Mobile1 V1 and V2), so both are compared against the whole of it: this asks
// whether a word is on the screen, not how far down it.

const VARIANTS = [
  { id: 'V1', kin: ['V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering' }) },
  { id: 'V2', kin: ['V1', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering' }) },
  { id: 'V3', kin: ['V1', 'V2', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'light',
    show: () => draw('dashboard', { theme: 'light', fleet: 'calm' }) },
  { id: 'V4', kin: ['V1', 'V2', 'V3', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering', at: { project: 'quire' } }) },
  { id: 'V5', kin: ['V1', 'V2', 'V3', 'V4', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering', at: { project: 'quire', tab: 'board' } }) },
  { id: 'M3', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard', 'src/components/drag.tsx'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering', at: { project: 'quire', tab: 'board' } })
      + R.render('dark', dragSurfaces()) },
  { id: 'T1', kin: ['T2', 'T3'], screens: ['card'], theme: 'dark',
    show: () => draw('card', { fleet: 'answering', at: { id: 'q3', host: 'h1' },
                               store: { openCard: OPEN_CARD } }) },
  { id: 'T2', kin: ['T1', 'T3'], screens: ['card'], theme: 'dark',
    show: () => draw('card', { fleet: 'answering', at: { id: 'q3', host: 'h1', face: 'agent' },
                               store: { openCard: OPEN_CARD } }) },
  { id: 'T3', kin: ['T1', 'T2'], screens: ['card'], theme: 'dark',
    show: () => draw('card', { fleet: 'answering', at: { id: 'q3', host: 'h1', face: 'live' },
                               store: { openCard: OPEN_CARD } }) },
  { id: 'C1', kin: ['S12', 'S13'], screens: ['chat'], theme: 'dark',
    show: () => draw('chat', { at: { id: 'c1' }, store: chatStore(), props: { id: 'c1' } }) },
  { id: 'S1', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S2', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'quiet' }) },
  { id: 'S2', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S4', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'spent' }) },
  { id: 'S3', screens: ['waiting'], theme: 'dark',
    show: () => draw('waiting', { fleet: 'answering' }) },
  { id: 'S4', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S5', 'S6', 'S7'], screens: ['dashboard'], theme: 'light',
    show: () => draw('dashboard', { theme: 'light', fleet: 'answering',
                                    at: { project: 'kanji-daily' } }) },
  { id: 'S5', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S6', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering', at: { project: 'the-long-walk' } }) },
  { id: 'S6', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S7'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'answering', at: { project: 'pebble', tab: 'board' } }) },
  { id: 'S7', kin: ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6'], screens: ['dashboard'], theme: 'dark',
    show: () => draw('dashboard', { fleet: 'quiet', at: { project: 'quire', tab: 'board' } }) },
  { id: 'S9', screens: ['new-ticket'], theme: 'dark',
    show: () => draw('new-ticket', { fleet: 'answering', at: { project: 'quire' },
      props: { opening: 'Export client list as CSV',
               sentences: 'Studios keep asking to download their client list. One button on the '
                 + 'Clients page, same columns as the import.' } }) },
  { id: 'S10', kin: ['S11'], screens: ['branch'], theme: 'dark',
    show: () => draw('branch', { fleet: 'answering', at: { project: 'quire', id: 'seo' } }) },
  { id: 'S11', kin: ['S10'], screens: ['branch'], theme: 'dark',
    show: () => draw('branch', { fleet: 'answering', at: { project: 'quire', id: 'engineering' } }) },
  { id: 'S12', kin: ['C1', 'S13'], screens: ['chat'], theme: 'dark',
    show: () => draw('chat', { at: { id: 'c1' }, store: chatStore(), props: { id: 'c1' } }) },
  { id: 'S13', kin: ['C1', 'S12'], screens: ['chat'], theme: 'dark',
    show: () => draw('chat', { at: { id: 'c1' }, store: chatStore(), props: { id: 'c1' } }) },
  { id: 'S14', screens: ['executors'], theme: 'dark',
    show: () => draw('executors', { fleet: 'executors' }) },
  { id: 'S15', screens: ['machines'], theme: 'dark',
    show: () => draw('machines', { fleet: 'quiet' }) },
  { id: 'S16', screens: ['machine'], theme: 'light',
    show: () => draw('machine', { theme: 'light', fleet: 'answering' }) },
];

// ── the rules that explain a difference ─────────────────────────────────────
//
// Filled in below, per variant. A rule is a pattern and the reason it is allowed
// to match; nothing is dropped quietly, because every unit a rule swallows is
// printed under its reason. "Waived" is therefore a claim a reader can disagree
// with rather than a number that went missing.

const rx = (re, why) => ({ re, why });
const waiverFor = (unit, rules) => rules.find((r) => r.re.test(unit)) ?? null;

/** Two units every one of these artboards opens with, and the only thing on any
 *  of them that no app draws. Waived by position rather than by pattern, so that
 *  a time on a branch page is not swallowed with them. */
const PLATFORM = 'the phone’s own status bar — the clock and the battery — which iOS draws over '
  + 'every app and no screen in here can. The two texts every artboard opens with.';

/** A figure, a delta, a duration, a monogram, a glyph: the artboards' data told
 *  by its form rather than by its content, for the values baked into a template
 *  rather than supplied by `renderVals()`. Handed the reason it is waived under,
 *  because the same shapes mean different things on different screens. */
const SHAPES = (why) => [
  rx(/^[€$£]?[0-9][0-9 .,]*(k|%|★|d|h|m|s|\/mo)?$/, why),
  rx(/^[▲▼] ?[0-9]/, why),
  rx(/^([0-9]+[dhms] ?)+(ago)?$/, why),
  rx(/^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?( ?· ?overnight)?$/, why),
  rx(/^[0-9]{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/, why),
  rx(/^[A-Z][A-Za-z]?$/, why),
  rx(/^[^\p{L}0-9]{1,4}$/u, why),
];

/** What the frames' own numbers are, said once. */
const FRAME_DATA = 'the artboard’s own data — five invented products, three invented machines and '
  + 'one invented evening, typed into the template; the app draws what its paired computers '
  + 'report, which in this run is this file’s own fleet';
/** …and what this run's are. */
const APP_DATA = 'this file’s own fleet — the five products, three machines, nine cards and one '
  + 'conversation seeded above, against the artboard’s';

/** This run's own strings, named outright: they are in this file, a few hundred
 *  lines up, and naming them is how a reader checks that nothing else was swept
 *  in with them. Handed the reason, because the same list explains a product name
 *  on one screen and a card title on another. */
const FIXTURE = (why) => [
  rx(/^(Quire|Kanji Daily|Hush|The Long Walk|Pebble)$/, why),
  rx(/^(studio|mini|cloud|Darwin)$/, why),
  rx(/^(SaaS · client portals for studios|iOS · Android · five kanji a day|Content site · long-distance hiking|iOS · a quiet journal)$/, why),
  rx(/^(Webhook retry policy|Price localisation for GBP|Bulk invite clients from a CSV|Invoice PDF redesign|Write the onboarding email|Comparison page: Quire vs Notion|Zapier integration|Rewrite 14 comparison pages|Pricing test read-out|Gradle 8\.7 build|Deck sync|Resubmit 2\.4 to App Review|6 glossary pages|Comparison pages|Fix portal login on Safari 17|Export client list as CSV|Custom domains for client portals|Tonight)/, why),
  rx(/^(Failed Stripe webhooks are dropped|UK studios see euros at checkout|Studios want to add a whole client roster|Match the portal's type and spacing|The first email after signup|Clients on Safari 17 are sent back|Apple rejected 2\.4 over the paywall|Studios keep asking to download|Keep our 3 webhook retries|Resubmit 2\.4 with "Start 7-day|Can't reproduce on the simulator|Follow Stripe's 3-day schedule|3 of 5 checks|9 of 14|Android build red on Gradle 8\.7|v3\.18 deployed, Safari login still red|Rewriting comparison pages, 9 of 14 done|Up since the pricing test|Last crawl found no errors|Traffic down slightly, seasonal|Newsletter paused since August|Android build green again on Gradle 8\.6|D30 retention up after the streak change|3 emails open, all older than a day)/, why),
  rx(/^(kanji android still red\?|Yes\. Gradle 8\.7 breaks|pin 8\.6 and move on|Done\. Coder restarted|the quire newsletter is too long|Cut from 520 to 250 words)/, why),
  rx(/^(quire|quire-api|quire-web|main|Engineering|SEO|Analytics|Marketing|Customers|Seo)$/, why),
  rx(/^(Coder|Branch|Research|You|Y|Divan)$/, why),
  rx(/^(nothing running|quiet|quiet for [0-9]+ days|no source connected yet)$/, why),
  rx(/^(on |finished · |resume |last seen |[?■●○✓×◐⏸] ?[0-9]+|[0-9]+ (task|tasks|agent|agents|open|done|posts|in progress)\b)/, why),
  rx(/^(Read |Bash |Splitting the commit|Batching the commit|now: |npm |Coder: )/, why),
  rx(/^(Quire|Kanji Daily|Hush|The Long Walk|Pebble) · /, why),
  rx(/^(501 rows answer 422|Commit is idempotent per upload id)/, why),
  rx(/^[0-9]+ criteria · [0-9]+ commands? · [0-9]+ files?$/, why),
  rx(/^#[0-9]+ in column$/, why),
  rx(/^[0-9]+ waiting$/, why),
  rx(/^[?■○●✓×◐] ?(questions|decisions|stuck|yours) · [0-9]+$/, why),
  rx(/^(yours|questions|decisions|stuck) · [0-9]+$/, why),
  rx(/^studio [0-9]+( · (mini|cloud) [0-9]+)+$/, why),
  ...SHAPES(why),
];

/** Every variant's rules. `app` is this run's fixture unless a variant has a
 *  reason of its own to add; `frame` is the artboards' data, by shape, plus the
 *  lines each artboard writes with a figure of its own in them. Everything a rule
 *  here does not reach is a difference, and differences are what this prints. */
const WAIVED = {};
for (const v of VARIANTS) {
  WAIVED[v.id] = { frame: SHAPES(FRAME_DATA), app: FIXTURE(APP_DATA) };
}

/** …and the sentences whose only difference is the figure in them. Each of these
 *  is a line the app draws too, in this run's own numbers: the quota window, how
 *  many machines answered, how long the quiet one has been quiet, when a paused
 *  agent comes back. A rule per screen rather than one for all of them, so that a
 *  line that really is missing from one screen is not covered by another's. */
const SAME_LINE_OWN_FIGURES = (id, patterns, why, side = 'both') => {
  for (const which of side === 'both' ? ['frame', 'app'] : [side]) {
    WAIVED[id][which].unshift(...patterns.map((re) => rx(re, why)));
  }
};

const QUOTA_LINE = 'the same line with this fleet’s own figure in it: the quota window this run '
  + 'reads is not the artboard’s evening (src/dashboard.ts quotaWords, machineWords)';
for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'M3', 'S1', 'S2', 'S4', 'S5', 'S6', 'S7']) {
  SAME_LINE_OWN_FIGURES(id, [
    /^[0-9]+% · resets [0-9]{1,2}:[0-9]{2}$/,
    /^quota ?[0-9]+%( · until [0-9]{1,2}:[0-9]{2})?$/,
    /^[0-9]+ machines$/,
  ], QUOTA_LINE);
}
SAME_LINE_OWN_FIGURES('S1', [
  /^partly as of [0-9]{1,2}:[0-9]{2}$/,
  /^mini (hasn't|has not) answered for /,
  /^on mini · [0-9]+ agents, state unknown$/,
  /^last seen [0-9]{1,2}:[0-9]{2}$/,
  /^on studio, cloud · [0-9]+ agents$/,
], 'the same line with this fleet’s own figures in it — how stale the page is, which machine went '
  + 'quiet and for how long, and which machines a product is on (src/dashboard.ts staleness, '
  + 'freshness, src/project.ts)');
SAME_LINE_OWN_FIGURES('S2', [
  /^Agents are paused until [0-9]{1,2}:[0-9]{2}$/,
  /^Today's agent quota is used up\./,
  /^used [0-9]+%$/,
  /^resets [0-9]{1,2}:[0-9]{2}$/,
  /^[0-9]+ agents? paused( mid-task)?$/,
  /^⏸ [0-9]+ paused$/,
  /^resume [0-9]{1,2}:[0-9]{2}$/,
], 'the same line with this fleet’s own figures in it: when the quota comes back and how many '
  + 'agents it stopped (src/dashboard.ts pausedWords, quotaWords, marks)');
SAME_LINE_OWN_FIGURES('S15', [
  /^resets [0-9]{1,2}:[0-9]{2} · in [0-9]+h [0-9]+m$/,
  /^[0-9]+s ago$/,
  /^[0-9]+ tasks? · unknown$/,
], 'the same line with this fleet’s own figures in it (src/machine.ts machineLines)');
SAME_LINE_OWN_FIGURES('S1', [
  /^◌ stale /,
  /^○ yours$/,
], 'the same chip, in another branch of its own precedence: the app draws ◌ stale and ○ yours too, '
  + 'and in this run those products have a stuck card on them, which outranks both '
  + '(src/dashboard.ts:354-364 chip)', 'frame');
SAME_LINE_OWN_FIGURES('S14', [/^[0-9]+$/], 'a count of this run’s own roster (src/machine.ts executorCount)');
SAME_LINE_OWN_FIGURES('S3', [
  /^[0-9]+ days?$/,
], 'the same duration in this run’s own units (src/tickets.ts since)');

// ── the run ─────────────────────────────────────────────────────────────────

const report = [];
for (const v of VARIANTS) {
  let app;
  try { app = drew(v.show()); }
  catch (e) { die(`${v.id}: the screen would not stand up: ${e.message}`); }

  const frame = frameTexts[v.id];
  if (!frame) die(`${v.id}: no artboard of that name was read`);
  const frameHay = ` ${frame.join(' ')} `;
  const appHay = ` ${app.join(' ')} `;

  const rules = WAIVED[v.id] ?? { frame: [], app: [] };
  // Two artboards of one screen — V1 and V2 are the Dashboard at two scroll
  // heights, S1 and S2 the same screen in two states of the fleet, T1/T2/T3 the
  // three faces of one page — so a word the app draws that is on the *other*
  // artboard is on the screen the frames drew, just not on this drawing of it.
  const kinHay = ` ${(v.kin ?? []).flatMap((id) => frameTexts[id] ?? []).join(' ')} `;
  const kin = (v.kin ?? []).length ? [{ re: { test: (u) => kinHay.includes(u) },
    why: `drawn by another artboard of this same screen (${v.kin.join(', ')}): the app puts it on `
      + 'the screen, and that is where the frames drew it' }] : [];
  const bar = frame.slice(0, 2).map((u) => rx(new RegExp(`^${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), PLATFORM));
  // The artboard's own data, told from its chrome by where it came from: a unit
  // the frame's `renderVals()` supplied is a product, a card, a roster line or a
  // message it invented, and the app draws what its paired computers report.
  const supplied = frameBound[v.id] ?? new Set();
  const frameRules = [
    ...bar,
    ...(rules.frame ?? []),
    { re: { test: (u) => supplied.has(u) },
      why: 'a value the artboard’s own renderVals() supplies — the board content, the roster, the '
        + 'figures and the conversation it invented; the app draws what its paired computers report' },
  ];
  const bucket = (units, hay, side) => {
    const missing = [];
    const waived = new Map();
    for (const unit of [...new Set(units)]) {
      if (hay.includes(unit)) continue;
      const rule = waiverFor(unit, side === 'frame' ? frameRules : [...kin, ...(rules.app ?? [])]);
      if (!rule) { missing.push(unit); continue; }
      if (!waived.has(rule.why)) waived.set(rule.why, []);
      waived.get(rule.why).push(unit);
    }
    return { missing, waived };
  };

  // `AUDIT_DUMP=V1` prints both sides of one variant in full, which is how the
  // lines in the report were read off and how they can be read off again.
  if (process.env.AUDIT_DUMP === v.id) {
    console.log(`\n== ${v.id} frame (${frame.length})`);
    for (const u of frame) console.log(`   F | ${u}`);
    console.log(`\n== ${v.id} app (${app.length})`);
    for (const u of app) console.log(`   A | ${u}`);
  }

  const frameOnly = bucket(frame, appHay, 'frame');
  const appOnly = bucket(app, frameHay, 'app');
  report.push({ v, frameOnly, appOnly, frame, app });

  const verdict = frameOnly.missing.length + appOnly.missing.length === 0 ? 'birebir' : 'farkli';
  console.log(`\n── ${v.id} · ${frameLabel[v.id]}`);
  console.log(`   ${verdict} · ${v.screens.map((s) => FILE_OF[s] ?? s).join(', ')} · ${v.theme}`
    + ` · frame ${frame.length} texts, app ${app.length}`
    + ` · ${frameOnly.missing.length} in the frame only, ${appOnly.missing.length} in the app only`);
  const show = (title, b) => {
    if (b.missing.length) {
      console.log(`   ${title}`);
      for (const u of b.missing) console.log(`     · ${u}`);
    }
    for (const [why, units] of b.waived) {
      console.log(`   waived (${units.length}) — ${why}`);
      for (const u of units) console.log(`     ~ ${u}`);
    }
  };
  show('in the frame, not on the screen:', frameOnly);
  show('on the screen, not in the frame:', appOnly);
}

// ── the screens no artboard draws ───────────────────────────────────────────
//
// Read off the route folder rather than off a list in this file, so that a screen
// added tomorrow shows up here instead of going unmentioned. `_layout.tsx` is the
// navigator and `index.tsx` is the redirect that picks the first screen; neither
// is a face.

const routes = [];
const walkRoutes = (dir, prefix) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { walkRoutes(path.join(dir, e.name), `${prefix}${e.name}/`); continue; }
    if (!e.name.endsWith('.tsx')) continue;
    if (e.name === '_layout.tsx') continue;
    routes.push(`${dir}/${e.name}`.replace(/^app\//, 'app/'));
  }
};
walkRoutes('app', '');

const drawnFiles = new Set(VARIANTS.flatMap((v) => v.screens.map((s) => FILE_OF[s]).filter(Boolean)));
const undrawn = routes.filter((f) => !drawnFiles.has(f));

console.log('\n── screens no mobile artboard draws');
for (const f of undrawn) console.log(`   · ${f}`);

// …and whether `test-divan-screens.cjs`'s eight is the whole of that list, which
// is the claim this half of the run is really checking.
const eight = [...fs.readFileSync(path.join(root, 'scripts/test-divan-screens.cjs'), 'utf8')
  .matchAll(/^\s*'?[\w-]+'?:\s*'(app\/[\w[\]./-]+\.tsx)',?$/gm)].map((m) => m[1]);
const missedByEight = undrawn.filter((f) => !eight.includes(f));
console.log(`\n   test-divan-screens.cjs carries ${eight.length} of them`
  + `${eight.length ? ` (${eight.join(', ')})` : ''}`);
console.log(`   ${missedByEight.length} of the undrawn screens are in no frame and in neither list:`);
for (const f of missedByEight) console.log(`     · ${f}`);

const same = report.filter((r) => !r.frameOnly.missing.length && !r.appOnly.missing.length);
console.log(`\n${same.length} of ${report.length} variants had nothing left unexplained`
  + ` (${report.length - same.length} did).`);

process.exit(0);
