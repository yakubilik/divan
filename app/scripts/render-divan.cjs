/** The Divan parts, rendered — without a phone, a simulator or a test runner.
 *
 *  Reading the source of a component tells you it asks the token table for its
 *  colours. It does not tell you what comes out: a card whose surface is
 *  `t.s1` in a file where `t` is the wrong theme is still a card that reads
 *  `t.s1`. So this file stands the parts up for real, in both themes, and looks
 *  at the styles that fall out of them.
 *
 *  It needs React, and react-dom to render to a string — a devDependency of the
 *  app for that reason and no other. It was written believing react-dom came in
 *  with expo-router; it does not, and on a clean `npm ci` the whole judgement
 *  suite stopped at this require. Everything React Native supplies is stubbed
 *  here down to what a style can be read through: a host element carrying its
 *  flattened style as an attribute. The stubs are deliberately dumb — this is not
 *  a simulator, and the only questions it answers are "did it render" and "in
 *  which colours".
 *
 *  Used by `test-divan.cjs`; it has nothing to say on its own.
 */
const { transform } = require('sucrase');
const Module = require('module');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '..');

// Metro defines this; the gallery reads it to decide whether it exists at all.
global.__DEV__ = true;

// ── TypeScript, and the files a bundler would have swallowed ────────────────
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    const code = transform(fs.readFileSync(filename, 'utf8'),
      { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', filePath: filename }).code;
    mod._compile(code, filename);
  };
}
for (const ext of ['.ttf', '.png', '.wav', '.jpg']) {
  require.extensions[ext] = (mod) => { mod.exports = { uri: 'asset' }; };
}

// ── what a style is, once every wrapper is off it ───────────────────────────
function flatten(style) {
  if (style == null || style === false) return {};
  if (Array.isArray(style)) return style.reduce((acc, s) => Object.assign(acc, flatten(s)), {});
  if (typeof style === 'function') return flatten(style({ pressed: false }));
  return style;
}

/** Every React Native element becomes a `div` (or a `span`, for text) carrying
 *  its flattened style, so that react-dom can render it and a check can read
 *  it back out of the markup. */
function host(tag, kind) {
  const H = React.forwardRef(function Host(props, _ref) {
    const { style, children, ...rest } = props;
    const attrs = { 'data-rn': kind, 'data-style': JSON.stringify(flatten(style)) };
    if (rest.accessibilityLabel) attrs['data-label'] = rest.accessibilityLabel;
    if (rest.numberOfLines) attrs['data-lines'] = String(rest.numberOfLines);
    return React.createElement(tag, attrs, children);
  });
  H.displayName = kind;
  return H;
}

const Animated = {
  View: host('div', 'Animated.View'),
  Value: class { constructor(v) { this._v = v; } setValue() {} interpolate() { return this; } },
  timing: () => ({ start: (cb) => cb && cb() }),
  spring: () => ({ start: (cb) => cb && cb() }),
  parallel: () => ({ start: (cb) => cb && cb() }),
  sequence: () => ({ start: () => {} }),
  loop: () => ({ start: () => {}, stop: () => {} }),
  delay: () => ({ start: () => {} }),
};

const ReactNative = {
  View: host('div', 'View'),
  Text: host('span', 'Text'),
  TextInput: host('span', 'TextInput'),
  Pressable: host('div', 'Pressable'),
  ScrollView: host('div', 'ScrollView'),
  Image: host('div', 'Image'),
  Modal: host('div', 'Modal'),
  Animated,
  Easing: { linear: 0, inOut: () => 0, in: () => 0, out: () => 0, quad: 0, cubic: 0 },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  StyleSheet: {
    create: (o) => o,
    flatten,
    absoluteFill: {},
    absoluteFillObject: {},
  },
  // Both themes are asked for by name in the checks, through ForceScheme; this
  // stands in for the phone that is not here.
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios', select: (o) => o.ios ?? o.default },
};

const STUBS = {
  'react-native': ReactNative,
  'react-native-svg': { __esModule: true, default: host('span', 'Svg'), Svg: host('span', 'Svg'), Path: host('span', 'Path') },
  'react-native-safe-area-context': {
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    SafeAreaProvider: host('div', 'SafeAreaProvider'),
  },
  'expo-router': {
    useRouter: () => ({ back() {}, push() {}, replace() {}, canGoBack: () => false }),
    // The shell lights the tab the route is in, so a render has to be able to
    // say where it is. Every place is rendered by name in test-shell.cjs, so
    // the one this answers with is deliberately not one of them.
    usePathname: () => '/',
    Redirect: () => null,
    useFocusEffect: () => {},
    Stack: Object.assign(host('div', 'Stack'), { Screen: () => null }),
  },
  'expo-haptics': { selectionAsync: () => Promise.resolve(), impactAsync: () => Promise.resolve() },
};

/** The app's own store reaches the keychain, the socket and the notification
 *  centre the moment it is imported, none of which exists here. Nothing being
 *  rendered reads from it — the parts take props — so it is answered with the
 *  two things a component can ask it for. */
const STORE = {
  useT: () => (key) => key,
  useStore: Object.assign(() => undefined, { getState: () => ({}), setState: () => {} }),
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent
      && path.resolve(path.dirname(parent.filename), request) === path.join(root, 'src/store')) return STORE;
  return realLoad.call(this, request, parent, isMain);
};

// ── the parts themselves ────────────────────────────────────────────────────
const theme = require(path.join(root, 'src/theme.ts'));
const parts = require(path.join(root, 'src/components/divan.tsx'));
// The parts the screens that already exist are made of. They are not Divan's,
// but they are drawn in Divan's palette now, and that is worth standing up.
const ui = require(path.join(root, 'src/components/ui.tsx'));
// An agent's mark, which is the one older part whose colour is not a token: an
// agent brings its own, and only falls back to the palette when it has none.
const agentcard = require(path.join(root, 'src/components/agentcard.tsx'));
const gallery = require(path.join(root, 'app/divan-gallery.tsx'));

/** Render a tree in one of the two themes and hand back its markup. */
function render(scheme, element) {
  return renderToStaticMarkup(React.createElement(theme.ForceScheme, { scheme }, element));
}

/** Every `data-style` in a piece of markup, as objects. */
function styles(markup) {
  return [...markup.matchAll(/data-style="([^"]*)"/g)].map((m) => JSON.parse(
    m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")));
}

/** Every colour that ended up on screen, whatever property it arrived in. */
function paint(markup) {
  const out = new Set();
  for (const s of styles(markup)) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'string' && /color|Color|shadow/i.test(k) && v !== 'transparent') out.add(v);
    }
  }
  return out;
}

module.exports = { React, theme, parts, ui, agentcard, gallery, render, styles, paint, flatten };
