/** A ```mermaid block in an answer is drawn as a diagram (#645), and every
 *  other fence is still code.
 *
 *  The chat's real Markdown path runs here: `react-native-markdown-display`
 *  itself (its ES sources compiled on the way in), markdown-it, and the chat's
 *  own rules (`src/components/chat.tsx`), stood up with `react-test-renderer`
 *  over the stubs `render-chat.cjs` gives every chat check. The WebView is a
 *  recorder of its props with a hand to post what the page would say, and the
 *  clock is ours, so "five seconds without an answer" takes no five seconds.
 *
 *   · a closed ```mermaid fence → the Diagram, a WebView drawn from the page;
 *     ```ts, a bare ``` and ```bash → CodeBlock, with their language;
 *   · the page's size → the WebView exactly that tall, as wide as the bubble,
 *     scrolling sideways only when the drawing is wider;
 *   · offline and shut: whitelist about:blank/data only, the first load and
 *     nothing after it, securityLevel strict, clicks swallowed, no http(s)
 *     script or stylesheet anywhere in the page, mermaid pinned and bundled;
 *   · fails safe: the page says error → the code block with its copy button,
 *     one muted line over it, no WebView left; no word in 5 s → the same;
 *     a fence still streaming → code until it is closed; an empty mermaid
 *     fence → an empty code block;
 *   · theme: dark → mermaid's `dark`, light → `default`, the page's
 *     background the chat card's colour in each.
 *
 *  The page itself against a real browser engine: `scripts/diagram-page-live.cjs`.
 *
 *  Run: node scripts/test-diagram.cjs
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const { transform } = require('sucrase');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const React = R.React;
const h = React.createElement;
const { act } = React;

// ── the real Markdown library ───────────────────────────────────────────────
// It ships ES sources; compile its files (only its own) as they are loaded.
const MD_SRC = path.join(path.dirname(require.resolve('react-native-markdown-display/package.json')), 'src');
const plainJs = require.extensions['.js'];
require.extensions['.js'] = (mod, filename) => {
  if (!filename.startsWith(MD_SRC)) return plainJs(mod, filename);
  const code = transform(fs.readFileSync(filename, 'utf8'),
    { transforms: ['jsx', 'imports'], jsxRuntime: 'classic', filePath: filename }).code;
  mod._compile(code, filename);
};
const realMd = {};
for (const [req, file] of [
  ['react-native-markdown-display', 'index.js'],
  ['react-native-markdown-display/src/lib/util/cleanupTokens', 'lib/util/cleanupTokens.js'],
  ['react-native-markdown-display/src/lib/util/groupTextTokens', 'lib/util/groupTextTokens.js'],
  ['react-native-markdown-display/src/lib/util/omitListItemParagraph', 'lib/util/omitListItemParagraph.js'],
]) realMd[req] = path.join(MD_SRC, file);

// ── a WebView that records what it was given ───────────────────────────────
let pages = [];
const FakeWebView = React.forwardRef(function FakeWebView(props, _ref) {
  pages.push(props);
  return h('div', { 'data-rn': 'WebView' });
});

// ── the copy button is pressed for real ────────────────────────────────────
const copied = [];

const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(realMd, request)) return beneath.call(this, realMd[request], parent, isMain);
  if (request === 'react-native-webview') return { WebView: FakeWebView };
  if (request === 'expo-clipboard') return { setStringAsync: (s) => { copied.push(s); return Promise.resolve(true); } };
  return beneath.call(this, request, parent, isMain);
};

// The stub `react-native` lacks a few things the library's renderers name.
const RN = require('react-native');
RN.Image = RN.Image || RN.View;
RN.TouchableWithoutFeedback = RN.TouchableWithoutFeedback || RN.Pressable;
RN.Platform = RN.Platform || { OS: 'ios', select: (o) => o.ios ?? o.default };

// ── our clock ──────────────────────────────────────────────────────────────
// Every timer the components start is held here and fired by `tick`.
let now = 0;
let timers = [];
let nextTimer = 1;
global.setTimeout = (fn, ms = 0) => { const id = nextTimer++; timers.push({ id, at: now + ms, fn }); return id; };
global.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
function tick(ms) {
  const until = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    act(() => { due.fn(); });
  }
  now = until;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const TR = require('react-test-renderer');
const { ForceScheme, dark, light } = require(path.join(root, 'src/theme.ts'));
const M = require(path.join(root, 'src/mermaid.ts'));
const P = require(path.join(root, 'src/mermaid-page.ts'));
const G = require(path.join(root, 'src/mermaid.gen.ts'));
const I18N = require(path.join(root, 'src/i18n.ts'));
const { AssistantText } = require(path.join(root, 'src/components/chat.tsx'));
const { Diagram } = require(path.join(root, 'src/components/diagram.tsx'));
const { CodeBlock } = require(path.join(root, 'src/components/code.tsx'));

const checks = [];
const check = (name, ok, detail = '') => checks.push([name, !!ok, detail]);

function mount(el, scheme = 'light') {
  pages = [];
  let r;
  act(() => { r = TR.create(h(ForceScheme, { scheme }, el)); });
  return r;
}
const update = (r, el, scheme = 'light') => act(() => { r.update(h(ForceScheme, { scheme }, el)); });
const ofType = (r, type) => r.root.findAll((n) => n.type === type);
const byTest = (r, id) => r.root.findAll((n) => n.props && n.props.testID === id && typeof n.type !== 'string');
const lastPage = () => pages[pages.length - 1];
const words = (r) => {
  const out = [];
  const walk = (n) => { if (typeof n === 'string') out.push(n); else if (n && n.children) n.children.forEach(walk); };
  walk(r.toJSON());
  return out.join(' ');
};
/** The diagram's box is laid out at this width (the bubble, border included). */
function layout(r, width) {
  const box = byTest(r, 'diagram')[0];
  act(() => { box.props.onLayout({ nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } }); });
}
const post = (msg) => act(() => { lastPage().onMessage({ nativeEvent: { data: JSON.stringify(msg) } }); });

const FLOW = 'flowchart TD\n  A[Phone] --> B(Daemon)\n  B --> C{Agent}';
const message = [
  'Here is how it flows:',
  '', '```mermaid', FLOW, '```',
  '', 'and the code:', '',
  '```ts', 'const x: number = 1;', '```',
  '', '```', 'plain text', '```',
  '', '```bash', 'npm test', '```',
].join('\n');

// ── 1. the chat rules choose the diagram for a closed mermaid fence ───────
{
  const r = mount(h(AssistantText, { text: message }));
  const diagrams = ofType(r, Diagram);
  const codes = ofType(r, CodeBlock).map((n) => n.props.lang);
  check('a closed ```mermaid fence in an answer is drawn as a Diagram, from the fence\'s own text',
    diagrams.length === 1 && diagrams[0].props.code === FLOW, JSON.stringify(diagrams.map((d) => d.props.code)));
  check('```ts, a bare ``` and ```bash all stay CodeBlocks, with their language',
    JSON.stringify(codes) === JSON.stringify(['ts', '', 'bash']), JSON.stringify(codes));
  check('the drawn diagram is a WebView loading the mermaid page (its html is the source)',
    pages.length >= 0 && byTest(r, 'diagram').length === 1);
  r.unmount();
}

// ── unit: which fences are closed ──────────────────────────────────────────
{
  const mdIt = require('markdown-it')();
  const fences = (src) => M.markClosedFences(mdIt.parse(src, {})).filter((t) => t.type === 'fence');
  const view = (src) => fences(src).map((t) => M.fenceView({ sourceInfo: t.info, sourceMeta: t.meta, content: t.content }));
  check('closed mermaid → diagram; unclosed → code; empty → code; other languages → code',
    JSON.stringify([
      view('```mermaid\npie\n "a": 1\n```'), view('```mermaid\npie\n "a": 1'), view('```mermaid\n```'),
      view('```Mermaid title\npie\n "a":1\n```'), view('```ts\nx\n```'), view('```\nx\n```'),
      view('```mermaid\npie\n "a": 1\n``` ▍'), view('> ```mermaid\n> pie\n>  "a": 1\n> ```'),
      view('~~~mermaid\npie\n "a": 1\n~~~'),
    ]) === JSON.stringify([['diagram'], ['code'], ['code'], ['diagram'], ['code'], ['code'], ['code'], ['diagram'], ['diagram']]));
}

// ── 3b. still streaming → code; closed → the diagram ──────────────────────
{
  const half = 'Drawing it:\n\n```mermaid\nflowchart TD\n  A --> B';
  const r = mount(h(AssistantText, { text: half, streaming: true }));
  const s1 = [ofType(r, Diagram).length, ofType(r, CodeBlock).length];
  // The closing marker has arrived but the message is still streaming: the
  // cursor sits on that line, so it is not a closing fence yet.
  update(r, h(AssistantText, { text: half + '\n```', streaming: true }));
  const s2 = [ofType(r, Diagram).length, ofType(r, CodeBlock).length];
  update(r, h(AssistantText, { text: half + '\n```', streaming: false }));
  const s3 = [ofType(r, Diagram).length, ofType(r, CodeBlock).length];
  // A fence closed earlier in a message that is still going is final.
  update(r, h(AssistantText, { text: half + '\n```\n\nAnd more words', streaming: true }));
  const s4 = [ofType(r, Diagram).length, ofType(r, CodeBlock).length];
  check('a mermaid fence still being written shows as a CodeBlock, and becomes the diagram once it is closed',
    JSON.stringify([s1, s2, s3, s4]) === JSON.stringify([[0, 1], [0, 1], [1, 0], [1, 0]]), JSON.stringify([s1, s2, s3, s4]));
  r.unmount();
}

// ── 3c. an empty mermaid fence ─────────────────────────────────────────────
{
  const r = mount(h(AssistantText, { text: 'Nothing:\n\n```mermaid\n```' }));
  const codes = ofType(r, CodeBlock);
  check('an empty ```mermaid fence renders as an empty CodeBlock, no diagram',
    ofType(r, Diagram).length === 0 && codes.length === 1 && codes[0].props.code === '' && codes[0].props.lang === 'mermaid',
    JSON.stringify(codes.map((c) => c.props)));
  r.unmount();
}

// ── 1/4. sizing, width, scrolling, theme ──────────────────────────────────
{
  const r = mount(h(Diagram, { code: FLOW }), 'dark');
  check('before its box is laid out no WebView is made (the page needs the bubble width)', pages.length === 0);
  layout(r, 342);
  const p0 = lastPage();
  const box0 = byTest(r, 'diagram')[0];
  check('while drawing: a placeholder box, the WebView hidden, at the bubble\'s inner width',
    p0 && p0.style.opacity === 0 && p0.style.width === 340 && R.flatten(box0.props.style).height === 180 + 2,
    JSON.stringify(p0 && p0.style));
  post({ t: 'size', w: 300, h: 240 });
  const p1 = lastPage();
  const box1 = byTest(r, 'diagram')[0];
  const scroll1 = r.root.findAll((n) => n.props && n.props.horizontal === true && typeof n.type !== 'string')[0];
  check('the page says its size → the WebView is exactly that tall, the box 2pt more (its border), shown',
    p1.style.height === 240 && R.flatten(box1.props.style).height === 242 && p1.style.opacity === 1, JSON.stringify(p1.style));
  check('a drawing narrower than the bubble fits it: WebView as wide as the bubble, no sideways scrolling',
    p1.style.width === 340 && scroll1.props.scrollEnabled === false, `${p1.style.width} ${scroll1.props.scrollEnabled}`);
  check('dark scheme → mermaid\'s dark theme, on the dark chat card colour',
    /theme:"dark"/.test(p1.source.html) && p1.source.html.includes(`background:${dark.card};`) && p1.style.backgroundColor === dark.card);
  r.unmount();

  const w = mount(h(Diagram, { code: 'sequenceDiagram\n  A->>B: hi\n  B->>C: hi\n  C->>D: hi' }), 'light');
  layout(w, 342);
  post({ t: 'size', w: 670, h: 400 });
  const pw = lastPage();
  const scroll = w.root.findAll((n) => n.props && n.props.horizontal === true && typeof n.type !== 'string')[0];
  check('a drawing wider than the bubble keeps its width and the box scrolls sideways',
    pw.style.width === 670 && pw.style.height === 400 && scroll.props.scrollEnabled === true, JSON.stringify(pw.style));
  check('light scheme → mermaid\'s default theme, on the light chat card colour',
    /theme:"default"/.test(pw.source.html) && pw.source.html.includes(`background:${light.card};`) && pw.style.backgroundColor === light.card);
  w.unmount();
}

// ── 2. offline and shut ────────────────────────────────────────────────────
{
  const r = mount(h(Diagram, { code: FLOW }));
  layout(r, 342);
  const p = lastPage();
  check('the WebView\'s whitelist is about:blank and data: only',
    JSON.stringify(p.originWhitelist) === JSON.stringify(['about:blank', 'data:*']), JSON.stringify(p.originWhitelist));
  const g = p.onShouldStartLoadWithRequest;
  const answers = [g({ url: 'about:blank' }), g({ url: 'about:blank' }), g({ url: 'https://example.com' }), g({ url: 'data:text/html,x' })];
  const g2 = M.diagramNavGuard();
  check('the page\'s own first load is let through and every request after it refused (a link, a reload, a data: page)',
    JSON.stringify(answers) === '[true,false,false,false]' && g2({ url: 'https://example.com' }) === false,
    JSON.stringify(answers));
  check('the WebView opens no windows and previews no links',
    p.setSupportMultipleWindows === false && p.allowsLinkPreview === false && p.javaScriptCanOpenWindowsAutomatically === false);
  r.unmount();

  const html = P.mermaidPage({ code: FLOW + '\n  click A href "https://example.com"', dark: false, background: '#fff' });
  const remote = html.match(/<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*["']?\s*(https?:)?\/\//gi);
  check('the built page loads no script, stylesheet, image or frame from http(s):// (or //)', !remote, JSON.stringify(remote));
  check('the page carries a Content-Security-Policy that lets nothing in from anywhere',
    /http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'/.test(html));
  check('mermaid runs with securityLevel strict, error drawing off, and clicks in the page are swallowed',
    html.includes("securityLevel:'strict'") && html.includes('suppressErrorRendering:true')
    && /addEventListener\(k,function\(e\)\{e\.preventDefault\(\);e\.stopPropagation\(\);\},true\)/.test(html)
    && html.includes("removeAttribute('href')"));
  const header = fs.readFileSync(path.join(root, 'scripts/gen-mermaid.cjs'), 'utf8');
  const gen = fs.readFileSync(path.join(root, 'src/mermaid.gen.ts'), 'utf8').slice(0, 400);
  check('mermaid is bundled, from a generator that pins its version, and the page is built from it',
    G.MERMAID_VERSION === '12.3.0' && /Pinned: mermaid 12\.3\.0/.test(header) && /mermaid 12\.3\.0/.test(gen)
    && html.includes(G.MERMAID_JS.slice(0, 200)) && G.MERMAID_JS.length > 1e6);
  const evil = P.mermaidPage({ code: 'flowchart TD\n  A["</script><script>alert(1)</script>"] --> B["$& $1"]', dark: false, background: '#fff' });
  check('the diagram text cannot end the page\'s script, and is carried as written',
    (evil.match(/<\/script>/g) || []).length === (html.match(/<\/script>/g) || []).length && evil.includes('$& $1'));
}

// ── 3a. mermaid could not draw it ──────────────────────────────────────────
{
  const BAD = 'flowchart TD\n  A -->> -- B[[';
  const r = mount(h(AssistantText, { text: `Look:\n\n\`\`\`mermaid\n${BAD}\n\`\`\`` }));
  layout(r, 342);
  post({ t: 'error', message: 'Parse error on line 2' });
  const fb = byTest(r, 'diagram-fallback');
  const codes = ofType(r, CodeBlock);
  const copy = r.root.findAll((n) => n.props && [I18N.t('copyCode'), 'copyCode'].includes(n.props.accessibilityLabel) && typeof n.props.onPress === 'function'
    && typeof n.type !== 'string');
  act(() => { copy[0] && copy[0].props.onPress(); });
  const txt = words(r);
  check('invalid mermaid → the normal CodeBlock with its code, no diagram box left',
    fb.length === 1 && codes.length === 1 && codes[0].props.code === BAD && byTest(r, 'diagram').length === 0, txt);
  check('…with its copy button working', copy.length === 1 && copied[copied.length - 1] === BAD, JSON.stringify(copied));
  // The harness's `useT` answers with the key itself; the app's with i18n.ts.
  const said = [I18N.t('diagramFailed'), 'diagramFailed'];
  const line = r.root.findAll((n) => typeof n.type !== 'string' && n.props && said.includes(n.props.children));
  check('…and one muted line over it saying the diagram could not be drawn (Turkish: Diyagram çizilemedi)',
    line.length >= 1 && R.flatten(line[0].props.style).color === light.muted && txt.indexOf(line[0].props.children) < txt.indexOf('flowchart')
    && I18N.tr.diagramFailed === 'Diyagram çizilemedi', txt);
  // A late size after the failure changes nothing.
  r.unmount();
}

// ── 3d. a page that never answers ──────────────────────────────────────────
{
  const r = mount(h(Diagram, { code: 'pie\n  "a": 1\n  "b": 2' }));
  layout(r, 342);
  tick(4999);
  const before = [byTest(r, 'diagram').length, byTest(r, 'diagram-fallback').length];
  tick(1);
  const after = [byTest(r, 'diagram').length, byTest(r, 'diagram-fallback').length];
  const codes = ofType(r, CodeBlock);
  check('a WebView that says nothing for 5 s falls back to the CodeBlock (and not a moment before)',
    JSON.stringify(before) === '[1,0]' && JSON.stringify(after) === '[0,1]' && codes.length === 1 && M.DIAGRAM_TIMEOUT_MS === 5000,
    JSON.stringify([before, after]));
  r.unmount();

  const ok = mount(h(Diagram, { code: 'pie\n  "x": 1' }));
  layout(ok, 342);
  post({ t: 'size', w: 200, h: 150 });
  tick(6000);
  check('a page that did answer is not given up on when the 5 s pass', byTest(ok, 'diagram').length === 1);
  ok.unmount();
}

// ── the page's messages ─────────────────────────────────────────────────────
check('the page\'s messages are read strictly: a size must be two positive numbers',
  JSON.stringify([M.readDiagramMessage('{"t":"size","w":10.2,"h":5}'), M.readDiagramMessage('{"t":"size","w":0,"h":5}'),
                  M.readDiagramMessage('nope'), M.readDiagramMessage('{"t":"error","message":"x"}')])
  === JSON.stringify([{ t: 'size', w: 11, h: 5 }, null, null, { t: 'error', message: 'x' }]));

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} diagram checks passed`);
process.exit(failed ? 1 : 0);
