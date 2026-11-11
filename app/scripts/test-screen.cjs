/** The remote screen on the phone, mounted and tapped (#213).
 *
 *  The screen is stood up live — `react-test-renderer`, because a refusal has
 *  to re-render — over the shared harness, with the socket swapped for a
 *  recorder and the gesture handler taken straight off `PanResponder.create`.
 *  What is asserted is what goes to the computer, in order:
 *
 *   · a tap on the live frame is `screen.input` with a normalised click;
 *   · Paste is `screen.clipboard.set` with the phone's text, then the
 *     computer's own paste shortcut; Copy from remote is its copy shortcut,
 *     then `screen.clipboard.get`, and the text lands on the phone;
 *   · with control off or refused (Accessibility on a Mac) the screen says why
 *     in words and a tap is not sent.
 *
 *  Run: node scripts/test-screen.cjs
 */
const Module = require('module');
const path = require('path');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

// ── what the screen reaches for ─────────────────────────────────────────────
const calls = [];
let inputRefusal = null;
let remoteCaps = null;
const client = {
  call: async (type, data) => {
    calls.push({ type, data });
    if (type === 'screen.info') return { ...remoteCaps };
    if (type === 'screen.input' && inputRefusal) throw Object.assign(new Error(inputRefusal.message), inputRefusal);
    if (type === 'screen.clipboard.get') return { text: 'words on the computer', truncated: false };
    if (type === 'screen.clipboard.set') return { chars: data.text.length };
    return {};
  },
};
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'expo-screen-orientation') {
    return { lockAsync: () => Promise.resolve(), OrientationLock: { DEFAULT: 0, LANDSCAPE: 1, PORTRAIT_UP: 2 } };
  }
  if (request.startsWith('.') && parent
      && path.resolve(path.dirname(parent.filename), request) === path.join(root, 'src/ws')) return { client };
  return beneath.call(this, request, parent, isMain);
};
const clip = require('expo-clipboard');
// audit: language-data — a letter outside ASCII the pasted text must carry intact
let phoneClipboard = 'from the phone · ş';
// audit: end-language-data
clip.getStringAsync = async () => phoneClipboard;
clip.setStringAsync = async (t) => { phoneClipboard = t; return true; };
const RN = require('react-native');
let gesture = null;
RN.PanResponder = { create: (cfg) => { gesture = cfg; return { panHandlers: {} }; } };

const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act/.test(String(a[0]))) real(...a); };
}

const ACCESSIBILITY = 'macOS has not granted this app Accessibility permission, so clicks would go nowhere — '
  + 'System Settings › Privacy & Security › Accessibility';
const MAC = { view: true, control: true, enabled: true, os: 'Darwin', reason: null, displays: [] };

const checks = [];
const ready = (async () => {
  R.words.real();
  remoteCaps = { ...MAC };
  const stand = (screen) => R.store.set({
    host: { id: 'h1', name: 'studio', host: '100.64.0.1', port: 8790, token: 't'.repeat(32) },
    conn: 'online', hostInfo: { name: 'studio', os: 'Darwin', screen },
  });
  stand({ ...MAC });
  const Screen = require(path.join(root, 'app/screen.tsx')).default;
  const view = () => h(R.theme.ForceScheme, { scheme: 'dark' }, h(Screen));
  let page;
  await act(async () => { page = TR.create(view()); });
  const settle = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  await settle();
  const canvas = page.root.findAll((n) => typeof n.props.onLayout === 'function')[0];
  await act(async () => { canvas.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 800, height: 450 } } }); });
  const tap = async (x, y) => {
    await act(async () => {
      gesture.onPanResponderGrant({ nativeEvent: { pageX: x, pageY: y, touches: [{}] } });
      gesture.onPanResponderRelease({ nativeEvent: { pageX: x, pageY: y } });
    });
    await settle();
  };
  const press = async (label) => {
    const [p] = page.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function'
      && typeof n.type !== 'string');
    if (!p) return false;
    await act(async () => { p.props.onPress(); });
    await settle(250);
    return true;
  };
  const words = () => JSON.stringify(page.toJSON());
  const inputs = () => calls.filter((c) => c.type === 'screen.input').map((c) => c.data.actions[0]);

  // 1 · a tap
  calls.length = 0;
  await tap(200, 112.5);
  const [click] = inputs();
  checks.push(['screen: a tap on the live frame sends screen.input with a normalised left click',
    click?.kind === 'click' && click.button === 'left' && click.x === 0.25 && click.y === 0.25]);

  // 2 · Paste
  calls.length = 0;
  const pasted = await press('Paste');
  const setAt = calls.findIndex((c) => c.type === 'screen.clipboard.set');
  const vAt = calls.findIndex((c) => c.type === 'screen.input' && c.data.actions[0].key === 'v');
  checks.push(['screen: Paste is in the toolbar, sets the computer\'s clipboard to the phone\'s text, then sends ⌘V to the Mac',
    // audit: language-data — a letter outside ASCII the pasted text must carry intact
    pasted && setAt >= 0 && calls[setAt].data.text === 'from the phone · ş' && vAt > setAt
    // audit: end-language-data
    && JSON.stringify(calls[vAt].data.actions[0].mods) === '["cmd"]']);

  // 3 · Copy from remote
  calls.length = 0;
  const copied = await press('Copy from remote');
  const cAt = calls.findIndex((c) => c.type === 'screen.input' && c.data.actions[0].key === 'c');
  const getAt = calls.findIndex((c) => c.type === 'screen.clipboard.get');
  checks.push(['screen: Copy from remote sends ⌘C, reads the computer\'s clipboard and puts it on the phone',
    copied && cAt >= 0 && getAt > cAt && JSON.stringify(calls[cAt].data.actions[0].mods) === '["cmd"]'
    && phoneClipboard === 'words on the computer' && words().includes('Copied 21 characters to this phone')]);

  // 4 · control off, from host.status
  stand({ ...MAC, enabled: false });
  await act(async () => { page.update(view()); });
  await settle();
  calls.length = 0;
  await tap(200, 112.5);
  checks.push(['screen: with control turned off elsewhere the screen follows host.status, says so in words, and a tap is not sent',
    words().includes('Remote control is off on this computer') && inputs().length === 0
    && !page.root.findAll((n) => n.props.accessibilityLabel === 'Paste').length]);

  // 5 · Accessibility missing
  stand({ ...MAC, control: false, reason: ACCESSIBILITY });
  await act(async () => { page.update(view()); });
  await settle();
  checks.push(['screen: a Mac without Accessibility shows the daemon\'s reason in words',
    page.root.findAll((n) => n.props.accessibilityLabel === 'Why control is unavailable')
      .some((n) => JSON.stringify(n.props.children).includes('Accessibility'))]);

  // 6 · refused by the daemon after the screen thought it could
  stand({ ...MAC });
  await act(async () => { page.update(view()); });
  await settle();
  inputRefusal = { code: 'control_unavailable', message: ACCESSIBILITY };
  remoteCaps = { ...MAC, control: false, reason: ACCESSIBILITY };
  calls.length = 0;
  await tap(400, 225);
  checks.push(['screen: a tap the daemon refuses shows its reason and the screen asks again what is allowed',
    words().includes('Accessibility') && calls.some((c) => c.type === 'screen.info')]);
  inputRefusal = null;

  await act(async () => { page.unmount(); });
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
