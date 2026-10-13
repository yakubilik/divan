/** Machine › Terminal's shell, the bridge between the socket and the page
 *  (#212), against a fake client.
 *
 *  Two halves. First `TermBridge` (`src/term.ts`) on its own: output in,
 *  keys out, resize, close, and the edges — output that beats the `term.open`
 *  answer, a shell that ends, a socket that comes back. Then the screen itself
 *  (`app/terminal.tsx`) stood up live with `react-test-renderer`, the WebView
 *  swapped for a recorder of what is injected into it and a hand to post what
 *  the page would say, the socket for the same fake client, and the keyboard's
 *  events taken off `Keyboard.addListener`:
 *
 *   · the page says ready at its size → `term.open` with that size, and the
 *     prompt the daemon prints is written into the page;
 *   · `echo hi` and Return typed in the page → `term.write`, and `hi` is
 *     written back into it;
 *   · the bar's Ctrl then `c` → `\x03`, its Tab → `\t`;
 *   · the keyboard coming up, or the phone turning → the page is asked to
 *     refit, and the size it answers with → `term.resize`;
 *   · leaving the screen → `term.close`.
 *
 *  The same against a real daemon and real xterm.js: `scripts/term-live.cjs`.
 *
 *  Run: node scripts/test-term.cjs
 */
const Module = require('module');
const path = require('path');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const { act } = R.React;

// ── a fake daemon ───────────────────────────────────────────────────────────
function fakeClient(opts = {}) {
  const calls = [];
  const listeners = new Set();
  const statusListeners = new Set();
  let n = 0;
  const c = {
    calls,
    hold: null,          // a promise term.open waits on, to order events around it
    call: async (type, data = {}) => {
      calls.push({ type, data });
      if (type === 'term.open') {
        const id = `t${++n}`;
        if (c.hold) await c.hold;
        if (opts.refuse) throw Object.assign(new Error('Terminals are not supported on Windows yet'), { code: 'term_unsupported' });
        return { term_id: id, pid: 1, cwd: '/home/me', shell: '/bin/zsh', cols: data.cols ?? 80, rows: data.rows ?? 24 };
      }
      if (type === 'term.write' && c.gone) throw Object.assign(new Error('gone'), { code: 'no_term' });
      return {};
    },
    on: (l) => { listeners.add(l); return () => listeners.delete(l); },
    onStatus: (l) => { statusListeners.add(l); return () => statusListeners.delete(l); },
    emit: (event, data) => { for (const l of [...listeners]) l({ event, chat_id: null, seq: null, data, ts: 0 }); },
    status: (s) => { for (const l of [...statusListeners]) l(s); },
    listening: () => listeners.size,
    of: (type) => calls.filter((x) => x.type === type),
  };
  return c;
}

// ── what the screen reaches for ─────────────────────────────────────────────
let client = fakeClient();
const injected = [];
let page = null;            // the WebView's props, as last rendered
const kbListeners = {};
const orientation = [];
let dims = { width: 390, height: 844 };

const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'expo-screen-orientation') {
    return { lockAsync: (o) => { orientation.push(o); return Promise.resolve(); },
             OrientationLock: { DEFAULT: 0, LANDSCAPE: 1, PORTRAIT_UP: 2 } };
  }
  if (request === 'react-native-webview') return { WebView: FakeWebView };
  if (request.startsWith('.') && parent
      && path.resolve(path.dirname(parent.filename), request) === path.join(root, 'src/ws')) {
    return { get client() { return client; } };
  }
  return beneath.call(this, request, parent, isMain);
};
const RN = require('react-native');
RN.Keyboard = {
  dismiss: () => { injected.push('<dismiss>'); },
  addListener: (name, fn) => { (kbListeners[name] ??= new Set()).add(fn); return { remove() { kbListeners[name].delete(fn); } }; },
};
RN.useWindowDimensions = () => dims;
RN.Platform = { OS: 'ios', select: (o) => o.ios ?? o.default };

const FakeWebView = R.React.forwardRef(function FakeWebView(props, ref) {
  page = props;
  R.React.useImperativeHandle(ref, () => ({
    injectJavaScript: (js) => { injected.push(js); },
    reload: () => {},
  }));
  return h('div', { 'data-rn': 'WebView' });
});

const TR = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act/.test(String(a[0]))) real(...a); };
}

const T = require(path.join(root, 'src/term.ts'));
const P = require(path.join(root, 'src/term-page.ts'));

/** What an injected script hands the page, back as the message it carries. */
const message = (js) => {
  const m = /^window\.divanIn&&window\.divanIn\((.*)\);true;$/s.exec(js);
  return m ? JSON.parse(m[1]) : null;
};
const drawn = (list) => list.map(message).filter((m) => m && m.t === 'out').map((m) => m.data).join('');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const checks = [];
const ready = (async () => {
  // ── 1 · the bridge on its own ─────────────────────────────────────────────
  {
    const c = fakeClient();
    const out = [];
    const b = new T.TermBridge(c, (m) => out.push(m));
    let release;
    c.hold = new Promise((r) => { release = r; });
    b.fromPage(JSON.stringify({ t: 'ready', cols: 47, rows: 31 }));
    await flush();
    // The daemon prints the prompt before its answer to term.open lands.
    c.emit('term.output', { term_id: 't1', data: 'me@studio ~ % ' });
    c.emit('term.output', { term_id: 'other', data: 'not ours' });
    release();
    await flush();
    checks.push(['term: the page saying ready opens one shell at the size it fitted',
      c.of('term.open').length === 1 && c.of('term.open')[0].data.cols === 47 && c.of('term.open')[0].data.rows === 31
      && b.state === 'live' && b.termId === 't1']);
    checks.push(['term: a prompt printed before term.open answered is still drawn, and another term\'s output is not',
      drawn(out.map(P.toPageScript)) === 'me@studio ~ % ']);

    c.emit('term.output', { term_id: 't1', data: 'hi\r\n' });
    checks.push(['term: term.output for the shell is written into the page',
      out[out.length - 1].t === 'out' && out[out.length - 1].data === 'hi\r\n']);

    c.calls.length = 0;
    for (const ch of 'ls\r') b.fromPage({ t: 'data', data: ch });
    b.key('tab');
    b.key('esc');
    b.key('up');
    b.fromPage({ t: 'mode', appCursor: true });
    b.key('up');
    b.key('pipe');
    b.key('tilde');
    b.key('ctrl');
    const latched = b.ctrl;
    b.fromPage({ t: 'data', data: 'c' });
    b.key('ctrl');
    b.fromPage({ t: 'data', data: 'D' });
    b.fromPage({ t: 'data', data: 'x' });
    const writes = c.of('term.write').map((x) => x.data.data);
    checks.push(['term: keys out — typing, Tab \\t, Esc, arrows (ESC [ A, then ESC O A in application mode), | and ~',
      JSON.stringify(writes.slice(0, 9)) === JSON.stringify(['l', 's', '\r', '\t', '\x1b', '\x1b[A', '\x1bOA', '|', '~'])
      && c.of('term.write').every((x) => x.data.term_id === 't1')]);
    checks.push(['term: Ctrl latches for one key — Ctrl then c is \\x03, Ctrl then D is \\x04, and the next key is plain',
      latched && JSON.stringify(writes.slice(9)) === JSON.stringify(['\x03', '\x04', 'x']) && !b.ctrl]);
    checks.push(['term: withCtrl maps the symbols that have a control code and leaves the rest',
      T.withCtrl('[') === '\x1b' && T.withCtrl(' ') === '\x00' && T.withCtrl('?') === '\x7f' && T.withCtrl('1') === '1']);

    c.calls.length = 0;
    b.fromPage({ t: 'size', cols: 47, rows: 31 });
    b.fromPage({ t: 'size', cols: 47, rows: 18 });
    b.fromPage({ t: 'size', cols: 0, rows: 0 });
    checks.push(['term: a refit to a new size is term.resize; the same size or a hidden page\'s zero is not sent',
      JSON.stringify(c.calls) === JSON.stringify([{ type: 'term.resize', data: { term_id: 't1', cols: 47, rows: 18 } }])]);

    // A socket that came back re-attaches; a page iOS threw away is redrawn.
    c.calls.length = 0;
    c.status('online'); c.status('offline'); c.status('online');
    out.length = 0;
    b.fromPage({ t: 'ready', cols: 47, rows: 18 });
    checks.push(['term: a socket that comes back re-attaches (term.attach), and a page drawn anew gets its scrollback back',
      JSON.stringify(c.calls) === JSON.stringify([{ type: 'term.attach', data: { term_id: 't1' } }])
      && out[0].t === 'reset' && out[1].t === 'out' && out[1].data.includes('me@studio ~ % ') && out[1].data.includes('hi\r\n')
      && c.of('term.open').length === 0]);

    c.calls.length = 0;
    b.close();
    b.close();
    c.emit('term.output', { term_id: 't1', data: 'late' });
    b.key('tab');
    checks.push(['term: close sends term.close once, stops listening, and nothing is sent after it',
      JSON.stringify(c.calls) === JSON.stringify([{ type: 'term.close', data: { term_id: 't1' } }])
      && c.listening() === 0 && b.state === 'closed' && !out.some((m) => m.data === 'late')]);
  }
  {
    // Ended by the shell; a new one; refused; left while opening.
    const c = fakeClient();
    const out = [];
    const b = new T.TermBridge(c, (m) => out.push(m));
    b.fromPage({ t: 'ready', cols: 80, rows: 24 });
    await flush();
    c.emit('term.exit', { term_id: 't1', code: 0 });
    const ended = b.state === 'ended' && /shell ended with 0/.test(drawn(out.map(P.toPageScript)));
    c.calls.length = 0;
    b.key('tab');
    const quiet = c.calls.length === 0;
    b.restart();
    await flush();
    checks.push(['term: term.exit ends the shell in words, nothing more is written to it, and New shell opens another',
      ended && quiet && b.state === 'live' && b.termId === 't2' && c.of('term.open').length === 1]);
    b.close();

    const refused = fakeClient({ refuse: true });
    const r = new T.TermBridge(refused, () => {});
    r.fromPage({ t: 'ready', cols: 80, rows: 24 });
    await flush();
    checks.push(['term: a computer that refuses (Windows) leaves the shell failed with the daemon\'s reason',
      r.state === 'failed' && /Windows/.test(r.error)]);

    const slow = fakeClient();
    let release;
    slow.hold = new Promise((res) => { release = res; });
    const s = new T.TermBridge(slow, () => {});
    s.fromPage({ t: 'ready', cols: 80, rows: 24 });
    await flush();
    s.close();
    release();
    await flush();
    checks.push(['term: leaving while term.open is on its way closes the shell it answers with',
      JSON.stringify(slow.of('term.close')) === JSON.stringify([{ type: 'term.close', data: { term_id: 't1' } }])]);
  }
  {
    const html = P.termPage();
    checks.push(['term: the page carries xterm.js, the fit addon and its stylesheet inline, and fetches nothing',
      html.includes('function(e,t)') && html.includes('FitAddon') && html.includes('.xterm-viewport')
      && !/<script[^>]+src=|<link[^>]+href=/i.test(html) && html.includes("post({t:'ready'")]);
    const js = P.toPageScript({ t: 'out', data: 'a\u2028b"</script>' });
    checks.push(['term: what is injected into the page is one call carrying the message intact',
      JSON.stringify(message(js)) === JSON.stringify({ t: 'out', data: 'a\u2028b"</script>' }) && !js.includes('\u2028')]);
  }

  // ── 2 · the screen ────────────────────────────────────────────────────────
  R.words.real();
  client = fakeClient();
  R.store.set({
    host: { id: 'h1', name: 'studio', host: '100.64.0.1', port: 8790, token: 't'.repeat(32) },
    conn: 'online', chats: {}, refresh: async () => {},
  });
  R.params.reset();
  const Terminal = require(path.join(root, 'app/terminal.tsx')).default;
  const view = () => h(R.theme.ForceScheme, { scheme: 'dark' }, h(Terminal));
  let screen;
  await act(async () => { screen = TR.create(view()); });
  const settle = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  const say = async (m) => { await act(async () => { page.onMessage({ nativeEvent: { data: JSON.stringify(m) } }); }); await settle(); };
  const press = async (label) => {
    const [p] = screen.root.findAll((x) => x.props.accessibilityLabel === label && typeof x.props.onPress === 'function'
      && typeof x.type !== 'string');
    if (!p) return false;
    await act(async () => { p.props.onPress(); });
    await settle();
    return true;
  };
  const words = () => JSON.stringify(screen.toJSON());
  await settle();

  // 1 · tapping Terminal opens a shell at the page's size, and the prompt shows
  const shown = !!page && page.source?.html?.includes('xterm') && page.keyboardDisplayRequiresUserAction === false;
  const opening = words().includes('Opening a shell on studio');
  await say({ t: 'ready', cols: 44, rows: 38 });
  client.emit('term.output', { term_id: 't1', data: '\x1b[1mme@studio\x1b[0m ~ % ' });
  await settle();
  checks.push(['terminal screen: it opens on a WebView drawing xterm.js, saying it is opening a shell on the computer',
    shown && opening]);
  checks.push(['terminal screen: the page\'s ready opens the shell with term.open at the screen\'s cols and rows, and the prompt is written into the page',
    JSON.stringify(client.of('term.open').map((x) => x.data)) === JSON.stringify([{ cols: 44, rows: 38 }])
    && drawn(injected).includes('me@studio') && !words().includes('Opening a shell')]);

  // 2 · echo hi + Return
  client.calls.length = 0;
  for (const ch of 'echo hi') await say({ t: 'data', data: ch });
  await say({ t: 'data', data: '\r' });
  client.emit('term.output', { term_id: 't1', data: 'echo hi\r\nhi\r\nme@studio ~ % ' });
  await settle();
  checks.push(['terminal screen: typing echo hi and Return sends it as term.write, and hi comes back into the page',
    client.of('term.write').map((x) => x.data.data).join('') === 'echo hi\r'
    && client.of('term.write').every((x) => x.data.term_id === 't1') && /\r\nhi\r\n/.test(drawn(injected))]);

  // 3 · the key bar
  client.calls.length = 0;
  const bar = ['Escape', 'Tab', 'Control', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Pipe', 'Tilde']
    .every((l) => screen.root.findAll((x) => x.props.accessibilityLabel === l && typeof x.props.onPress === 'function').length > 0);
  await press('Control');
  const lit = screen.root.findAll((x) => x.props.accessibilityLabel === 'Control' && x.props.accessibilityState?.selected).length > 0;
  await say({ t: 'data', data: 'c' });
  await press('Tab');
  await press('Up arrow');
  checks.push(['terminal screen: the key bar has Esc, Tab, Ctrl, the arrows, | and ~',  bar]);
  checks.push(['terminal screen: the bar\'s Ctrl lights up, and Ctrl then c sends \\x03; Tab sends \\t',
    lit && JSON.stringify(client.of('term.write').map((x) => x.data.data)) === JSON.stringify(['\x03', '\t', '\x1b[A'])]);

  // 4 · keyboard up / down, and turning the phone
  const fits = () => injected.map(message).filter((m) => m && m.t === 'fit').length;
  const answerFit = async (cols, rows) => { await say({ t: 'size', cols, rows }); };
  client.calls.length = 0;
  let before = fits();
  await act(async () => { for (const f of kbListeners.keyboardWillShow ?? []) f({ endCoordinates: { height: 336 } }); });
  await settle(100);
  const padded = screen.root.findAll((x) => x.props.style && R.flatten(x.props.style).paddingBottom === 336).length > 0;
  const askedUp = fits() > before;
  await answerFit(44, 22);
  before = fits();
  await act(async () => { for (const f of kbListeners.keyboardWillHide ?? []) f({}); });
  await settle(100);
  const askedDown = fits() > before;
  await answerFit(44, 38);
  before = fits();
  dims = { width: 844, height: 390 };
  await act(async () => { screen.update(view()); });
  await settle(100);
  const askedTurn = fits() > before;
  await answerFit(96, 14);
  checks.push(['terminal screen: the keyboard coming up lifts the bar over it and asks the page to refit; its size goes out as term.resize',
    padded && askedUp && askedDown && askedTurn
    && JSON.stringify(client.of('term.resize').map((x) => x.data)) === JSON.stringify([
      { term_id: 't1', cols: 44, rows: 22 }, { term_id: 't1', cols: 44, rows: 38 }, { term_id: 't1', cols: 96, rows: 14 }])]);
  checks.push(['terminal screen: while the shell is shown the phone may turn (orientation unlocked)',
    orientation[0] === 0]);

  // Hide keyboard
  injected.length = 0;
  await press('Hide keyboard');
  checks.push(['terminal screen: Hide keyboard takes focus off the page and dismisses the keyboard',
    injected.some((js) => message(js)?.t === 'blur') && injected.includes('<dismiss>')]);

  // Chats is still there, and the shell survives the switch
  client.calls.length = 0;
  const [seg] = screen.root.findAll((x) => typeof x.props.onChange === 'function' && Array.isArray(x.props.segments)
    && x.props.segments.some((sg) => sg.key === 'chats'));
  await act(async () => { seg.props.onChange('chats'); });
  await settle();
  const chatsShown = words().includes('No chat on this computer yet.');
  await act(async () => { seg.props.onChange('shell'); });
  await settle();
  checks.push(['terminal screen: Chats shows the chat wall, and switching back finds the same shell (no close, no new open)',
    chatsShown && client.of('term.close').length === 0 && client.of('term.open').length === 0]);

  // 5 · leaving
  client.calls.length = 0;
  await act(async () => { screen.unmount(); });
  checks.push(['terminal screen: leaving the screen sends term.close for its shell and lets the phone stand upright again',
    JSON.stringify(client.calls) === JSON.stringify([{ type: 'term.close', data: { term_id: 't1' } }])
    && orientation[orientation.length - 1] === 2 && client.listening() === 0]);
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
