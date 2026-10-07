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

/** Everything that was pressable in the last render, with the words on it.
 *  Markup cannot carry a function, and a gesture is the only way to ask a
 *  screen a question it answers by changing — "selecting a project enters it"
 *  is a claim about a tap, not about a source line. */
const PRESSES = [];

/** …and everything that could be pressed and held, which is the same thing for
 *  the board's drag: "a card can be picked up" is a claim about a handler being
 *  on it, and holding one is how a check asks. */
const HOLDS = [];

/** Every buzz the phone was asked for, in order. A haptic leaves no mark on a
 *  screen, so the only way to hold "the drop is felt" to anything is to record
 *  what reached this module. */
const BUZZES = [];

/** Every field that takes typing in the last render. A field's text is a prop,
 *  and the only way to type into one here is to call what it calls. */
const FIELDS = [];

/** Every menu a press asked the app's own popover for (`components/overlay`),
 *  newest last: what a chip offers is a claim about the menu it opens. */
const MENUS = [];

/** The words inside an element, however deep. A chip is a dot and a label; the
 *  label is what a check is looking for. */
function textOf(node) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props) return textOf(node.props.children);
  return '';
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
    // An empty box's only words. They are a prop rather than a child, so without
    // this a check cannot tell a composer from an empty view.
    if (rest.placeholder) attrs['data-placeholder'] = String(rest.placeholder);
    // `label` beside `text`: a control with no words in it — a switch, a
    // chevron — is findable by what it is called and by nothing else.
    if (typeof rest.onPress === 'function') {
      PRESSES.push({ text: textOf(children), label: rest.accessibilityLabel ?? null, press: rest.onPress });
    }
    if (typeof rest.onChangeText === 'function') {
      FIELDS.push({ label: rest.accessibilityLabel ?? null, placeholder: rest.placeholder ?? null,
                    change: rest.onChangeText });
    }
    if (typeof rest.onLongPress === 'function') {
      HOLDS.push({ text: textOf(children), hold: rest.onLongPress, out: rest.onPressOut,
                   delay: rest.delayLongPress ?? null });
    }
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

/** A list that really walks what it was handed. The other stubs can afford to
 *  be boxes, because what is asked of them is a colour; "every conversation is
 *  on the screen" is a question about the rows, so this one renders them. */
const SectionList = React.forwardRef(function SectionList(props, _ref) {
  const { sections = [], renderItem, renderSectionHeader, ListHeaderComponent,
          contentContainerStyle, keyExtractor } = props;
  const kids = [];
  const at = (node, key) => kids.push(React.createElement(React.Fragment, { key }, node));
  if (ListHeaderComponent) {
    at(React.isValidElement(ListHeaderComponent) ? ListHeaderComponent
       : React.createElement(ListHeaderComponent), 'head');
  }
  sections.forEach((section, si) => {
    if (renderSectionHeader) at(renderSectionHeader({ section }), `h${si}`);
    (section.data ?? []).forEach((item, index) => {
      at(renderItem({ item, index, section }), keyExtractor ? keyExtractor(item, index) : `${si}.${index}`);
    });
  });
  return React.createElement('div',
    { 'data-rn': 'SectionList', 'data-style': JSON.stringify(flatten(contentContainerStyle)) }, kids);
});

const ReactNative = {
  View: host('div', 'View'),
  SectionList,
  Text: host('span', 'Text'),
  TextInput: host('span', 'TextInput'),
  Pressable: host('div', 'Pressable'),
  ScrollView: host('div', 'ScrollView'),
  // A page with a box at the foot of it: the card's live face raises it over the
  // keyboard, and without this the whole screen renders as `undefined`.
  KeyboardAvoidingView: host('div', 'KeyboardAvoidingView'),
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
  // The app's own dialog closes the keyboard before it comes up.
  Keyboard: { dismiss: () => {}, addListener: () => ({ remove() {} }) },
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
    useRouter: () => ({ back() {}, canGoBack: () => false,
                        // A screen that files something does not push the page
                        // it lands on, it replaces itself with it — so where
                        // that went is recorded the same way a push is, and
                        // kept apart from it.
                        replace: (to) => { REPLACED.push(typeof to === 'string' ? to : to); },
                        // Where a press went. A tap that leaves the screen
                        // cannot be seen in the markup it left, and "tapping an
                        // agent opens the run it is printing" is a claim about a
                        // route, so the pushes are recorded the same way the
                        // address is.
                        push: (to) => { PUSHED.push(typeof to === 'string' ? to : to); },
                        setParams: (patch) => Object.assign(PARAMS, patch) }),
    // The shell lights the tab the route is in, so a render has to be able to
    // say where it is. Every place is rendered by name in test-shell.cjs, so
    // the one this answers with is deliberately not one of them.
    usePathname: () => '/',
    // What is in the address. The Dashboard keeps the project being read
    // there, so a check can render it scoped by putting one in first.
    useLocalSearchParams: () => PARAMS,
    Redirect: () => null,
    useFocusEffect: () => {},
    Stack: Object.assign(host('div', 'Stack'), { Screen: () => null }),
  },
  // A menu or a dialog goes straight onto the window rather than into the view
  // controller it was asked for from (`components/overlay`), which is a native
  // view and here is just a box.
  'react-native-screens': { FullWindowOverlay: host('div', 'FullWindowOverlay'), enableFreeze: () => {} },
  'expo-haptics': {
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    selectionAsync: () => { BUZZES.push('selection'); return Promise.resolve(); },
    impactAsync: (style) => { BUZZES.push(String(style)); return Promise.resolve(); },
  },
  // The one native import the menus and dialogs reach for: the layer they are
  // drawn on, above everything the navigator owns. Here it is just a box.
  'react-native-screens': { FullWindowOverlay: host('div', 'FullWindowOverlay') },
  // Zustand's shallow compare. A screen that pulls its actions out in one slice
  // goes through it, and nothing here re-renders, so it is the identity.
  'zustand/react/shallow': { useShallow: (fn) => fn },
  // The three native modules the pre-pairing screens reach for. Each of them
  // pulls in `expo-modules-core`, whose own source is TypeScript inside
  // node_modules, which is where a plain `require` of Welcome or Pair stopped.
  // What they do is not a question a render can answer, so they are the
  // smallest things that answer at all.
  'expo-clipboard': { setStringAsync: () => Promise.resolve(true) },
  'expo-linking': { openURL: () => Promise.resolve(true), createURL: (p) => `remoteaichat://${p}` },
  // …and the camera, whose permission is not a stub but a state a check sets:
  // the pairing screen has three faces — the viewfinder, the form it falls back
  // to when the camera was refused, and the wait while the phone is deciding —
  // and which one it draws is this object.
  'expo-camera': {
    CameraView: host('div', 'CameraView'),
    useCameraPermissions: () => [CAMERA, () => Promise.resolve(CAMERA)],
  },
};

/** What `useCameraPermissions` answers. `null` is the moment before the phone
 *  has said anything, which is what it answers on a cold launch. */
let CAMERA = null;
const camera = {
  /** The camera is ours: the viewfinder is drawn. */
  granted() { CAMERA = { granted: true, canAskAgain: false }; },
  /** Refused for good: the screen falls back to the typed-in form. */
  denied() { CAMERA = { granted: false, canAskAgain: false }; },
  /** Nothing asked yet. */
  reset() { CAMERA = null; },
};

/** The app's own store reaches the keychain, the socket and the notification
 *  centre the moment it is imported, none of which exists here. The parts take
 *  props and read nothing from it; a whole screen does, so it is answered out
 *  of a plain object a check can fill in first (`store.set`). Left empty, every
 *  selector answers `undefined`, which is what it did before there was one. */
const STATE = {};
/** What `useT()` answers: the key, so a check reads the one thing a typo cannot
 *  fake — unless a picture wants the sentences (`words.real()`). */
const WORDS = { t: (key) => key };
const words = {
  real() { const { t } = require(path.join(root, 'src/i18n.ts')); WORDS.t = t; },
  keys() { WORDS.t = (key) => key; },
};
const PARAMS = {};
const PUSHED = [];
const REPLACED = [];
const STORE = {
  useT: () => WORDS.t,
  // The two things screens import from the store that are not the store: the
  // permission mode a new chat starts on, and the reading of which account an
  // agent is installed under. Both are the real ones (`src/store.ts`) — they
  // decide something, and a stub that answered differently would be checking
  // the stub.
  DEFAULT_PERM: 'bypass',
  agentAccountOf: (d) => (d.agentAccountId !== undefined ? d.agentAccountId
    : (d.byProvider?.claude?.account_id ?? null)),
  // A screen that takes a slice asks with a selector; one that takes half the
  // store at once (`const { a, b } = useStore()`) asks with nothing, and used to
  // be handed `undefined` to destructure.
  useStore: Object.assign((selector) => (typeof selector === 'function' ? selector(STATE) : STATE),
    { getState: () => STATE, setState: (patch) => Object.assign(STATE, patch) }),
};

/** What a screen being rendered will find in the store, and in the address. */
const store = {
  set(patch) { Object.assign(STATE, patch); },
  reset() { for (const k of Object.keys(STATE)) delete STATE[k]; },
};
const params = {
  set(patch) { Object.assign(PARAMS, patch); },
  reset() { for (const k of Object.keys(PARAMS)) delete PARAMS[k]; },
};
/** Every route a press pushed, oldest first. Not cleared by `render`: a push
 *  happens when a handler is called, which is after the render that offered it. */
const nav = {
  pushed() { return PUSHED.slice(); },
  replaced() { return REPLACED.slice(); },
  reset() { PUSHED.length = 0; REPLACED.length = 0; },
};

let OVERLAY = null;
let OVERLAY_LOADING = false;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('.') && parent
      && path.resolve(path.dirname(parent.filename), request) === path.join(root, 'src/store')) return STORE;
  if (request.startsWith('.') && parent && !OVERLAY_LOADING
      && path.resolve(path.dirname(parent.filename), request) === path.join(root, 'src/components/overlay')) {
    if (!OVERLAY) {
      OVERLAY_LOADING = true;
      try {
        const real = realLoad.call(this, request, parent, isMain);
        OVERLAY = { ...real, openMenu: (spec) => { MENUS.push(spec); },
                    measure: () => Promise.resolve({ x: 0, y: 0, width: 0, height: 0 }) };
      } finally { OVERLAY_LOADING = false; }
    }
    return OVERLAY;
  }
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

/** Render a tree in one of the two themes and hand back its markup. Whatever
 *  was pressable in it is left in `presses()` for a check that wants to press
 *  one of them. */
function render(scheme, element) {
  PRESSES.length = 0;
  HOLDS.length = 0;
  BUZZES.length = 0;
  FIELDS.length = 0;
  return renderToStaticMarkup(React.createElement(theme.ForceScheme, { scheme }, element));
}

/** What the last render left pressable. */
function presses() { return PRESSES.slice(); }

/** …and what it left holdable, which is the board's drag. */
function holds() { return HOLDS.slice(); }

/** Every buzz asked for since the last render. A gesture is felt before anything
 *  about it is drawn, so this is the only record of that half of it. */
function buzzes() { return BUZZES.slice(); }

/** …and the one whose words are exactly this. */
function pressOn(text) {
  const found = PRESSES.filter((p) => p.text === text);
  if (found.length !== 1) throw new Error(`pressOn(${JSON.stringify(text)}): ${found.length} of them`);
  found[0].press();
}

/** Type into the field with this label, the way a keyboard would. */
function typeInto(label, value) {
  const found = FIELDS.filter((f) => f.label === label || f.placeholder === label);
  if (found.length !== 1) throw new Error(`typeInto(${JSON.stringify(label)}): ${found.length} of them`);
  found[0].change(value);
}

/** The menus pressed open so far, and forgetting them. */
const menus = { all: () => MENUS.slice(), last: () => MENUS[MENUS.length - 1] ?? null, reset: () => { MENUS.length = 0; } };

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

module.exports = { React, theme, parts, ui, agentcard, gallery, render, styles, paint, flatten,
                   store, params, nav, camera, presses, pressOn, holds, buzzes, typeInto, menus, words };
