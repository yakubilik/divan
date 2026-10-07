#!/usr/bin/env node
/** Divan on the desktop: the palette, the switch, and the parts.
 *
 *     cd web && npm test
 *
 *  The palette is the part of a design that is easiest to agree on and easiest
 *  to lose: one screen reaches for a grey that is nearly right, the next copies
 *  it, and a month later nobody can say which of the two the artboard drew. So
 *  the sixteen values are checked against the block the frames declare — quoted
 *  here verbatim, with the frame named — and everything the panel paints is
 *  checked to be one of them.
 *
 *  The frames are deliberately not in this repository (they are private and this
 *  repository is public), which is exactly why the values have to be written
 *  down somewhere a check can reach. `design/divan/TOKENS.md` says the same
 *  thing in prose; this file is the copy that fails a build.
 *
 *  Three things are read rather than reasoned about:
 *
 *   · the parts are rendered, all of them, and the colours are read back off the
 *     markup — so "a new screen cannot introduce a colour" is answered by what
 *     came out, not by what was written;
 *   · every screen the panel already had is rendered too, because the palette
 *     under them was replaced and a screen that still paints a value of its own
 *     would only be visible in one theme;
 *   · the switch is driven: what it does with no answer from the computer, with
 *     an answer, with a stored choice, and when the computer changes its mind at
 *     sunset.
 *
 *  Compiled with the panel's own TypeScript into the panel's own tree, the way
 *  `test-ustabasi.mjs` does it, so that `react` resolves as it does in a build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '..');
const out = join(web, '.test-build', 'divan');

const src = (p) => readFileSync(join(web, p), 'utf8');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/ui/divan.tsx', 'scripts/divan-gallery.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/divan',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

// The panel is bundled, so its imports are written the way a bundler reads
// them: `./theme`, not `./theme.js`.
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}

// ── a browser, as far as a static render needs one ──────────────────────────

/** The panel reads three things off the browser before React mounts: a stored
 *  choice, what the computer is set to, and `<html>` to write the answer on.
 *  All three are stubbed, because all three are what the switch is. */
function browser({ system = null, stored = null } = {}) {
  const store = new Map(stored ? [['rac.theme', stored]] : []);
  const html = { dataset: {} };
  const changes = [];
  const query = {
    matches: system === 'light',
    addEventListener: (_e, fn) => changes.push(fn),
    removeEventListener: () => {},
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.document = {
    documentElement: html, hidden: false,
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null, querySelectorAll: () => [],
  };
  globalThis.window = {
    matchMedia: system === null ? undefined : () => query,
    addEventListener() {}, removeEventListener() {},
    location: { search: '', pathname: '/' }, open() {}, alert() {},
  };
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.location = globalThis.window.location;
  return {
    html, store, query,
    /** The computer changing its mind while the panel is open. */
    sunset: (scheme) => { query.matches = scheme === 'light'; changes.forEach((fn) => fn()); },
  };
}

let env = browser({ system: 'dark' });

const load = (p, bust = '') => import(pathToFileURL(join(out, p)).href + bust);

const K = await load('src/lib/theme.js');
const parts = await load('src/ui/divan.js');
const gallery = await load('scripts/divan-gallery.js');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

/** Every frame of the desktop set, by the id the artboard labels it with: the
 *  group it belongs to, the theme it is drawn in, and how many of the sixteen
 *  names it declares. Nothing here can look at the frames, so a citation is
 *  only as good as this list — it is what turns a frame's name in a comment
 *  into a claim that can be wrong. */
const FRAMES = {
  W1: ['Web12', 'dark', 14], W2: ['Web12', 'dark', 14],
  W3: ['Web13', 'light', 14], W4: ['Web13', 'light', 14],
  W6: ['Web14', 'dark', 16], W7: ['Web14', 'dark', 16], W8: ['Web14', 'light', 16],
  W9: ['Web14', 'dark', 16], W10: ['Web14', 'dark', 16],
  W11: ['Web15', 'light', 16], W12: ['Web15', 'light', 16], W13: ['Web15', 'light', 16],
  W14: ['Web15', 'light', 16], W15: ['Web15', 'light', 16], W16: ['Web15', 'light', 16],
  W17: ['Web15', 'light', 16], W18: ['Web15', 'light', 16],
};
/** The phone's, for the two values that are borrowed from it and for the empty
 *  state, which the desktop frames do not draw at all. */
const PHONE_FRAMES = { 'Mobile3 Drag frame': 'dark', 'Mobile4 C1': 'light', 'Mobile7 S6': 'dark' };

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;
const colours = (text) => text.match(COLOUR) ?? [];
/** …minus the ones inside a comment, which is where the frames are quoted. */
function coloursInCode(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return colours(bare);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => Object.keys(o).sort();

// ── 1 · the palette is divan-tokens.css ─────────────────────────────────────

const SHEET = src('src/styles/divan-tokens.css');
function sheet(scheme) {
  const body = SHEET.match(new RegExp(`\\.dv-root\\[data-theme="${scheme}"\\]\\s*\\{([^}]*)\\}`))[1]
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const colourOf = (value) => colours(value ?? '').at(-1);

group('the palette is divan-tokens.css');
{
  for (const [name, table] of [['dark', K.DARK], ['light', K.LIGHT]]) {
    const css = sheet(name);
    const wrong = keys(table).filter((k) => k !== 'scheme' && table[k] !== colourOf(css[K.SOURCE[k]]));
    ok(`every ${name} colour is the sheet’s own value`, wrong.length === 0,
      wrong.map((k) => `${k}: ${table[k]} vs ${K.SOURCE[k]} ${css[K.SOURCE[k]]}`).join(', '));
  }
  ok('every token names its property, and both sides hold the same names',
    eq(keys(K.DARK), keys(K.LIGHT)) && eq(keys(K.SOURCE), keys(K.DARK).filter((k) => k !== 'scheme')));
  ok('`tokensFor` answers with the table of that name',
    K.tokensFor('dark') === K.DARK && K.tokensFor('light') === K.LIGHT);
}

group('flat surfaces');
{
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(web, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else files.push(`${dir}/${e.name}`);
    }
  };
  walk('src');
  const blurred = files.filter((f) => /backdrop-filter\s*:|backdropFilter/.test(src(f)));
  ok('nothing under web/src declares a backdrop filter', blurred.length === 0, blurred.join(', '));
}

group('monograms');
ok('a monogram is the neutral surface for every name, and the ramp is gone',
  ['Quire', 'Hush', '', 'babysee'].every((n, i) => K.monogram(n) === K.T.s2 && K.monogram(n, i) === K.T.s2)
  && K.MONOGRAM === undefined);

// ── 2 · nothing else in the panel is a colour ──────────────────────────────

group('one table, and nothing beside it');
{
  const TOKEN_VALUES = new Set([
    ...Object.values(K.DARK), ...Object.values(K.LIGHT),
    K.ON_COLOUR,
    ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
    ...Object.values(K.MEDIA),
  ]);

  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(web, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  walk('src');
  ok('the whole panel was read to say so', files.length > 30, `${files.length} files`);

  const strayed = [];
  for (const f of files) {
    if (f === 'src/lib/theme.ts') continue;
    // The one screen that must not read the palette: it is what draws when the
    // app has thrown, and a boundary that imported the app's own modules would
    // go down with them. It paints in the browser's `Canvas`/`CanvasText` and in
    // a grey that is neither theme's, on purpose.
    if (f === 'src/components/Fallback.tsx') continue;
    const found = [...new Set(coloursInCode(src(f)))];
    if (found.length) strayed.push(`${f}: ${found.join(', ')}`);
  }
  ok('no screen and no component spells a colour of its own', strayed.length === 0, strayed.join('\n    '));

  const extra = [...new Set(coloursInCode(src('src/lib/theme.ts')))].filter((v) => !TOKEN_VALUES.has(v));
  ok('the token file holds nothing but the design’s own values', extra.length === 0, extra.join(', '));

  ok('the parts read the tokens rather than being handed a colour',
    (src('src/ui/divan.tsx').match(/\bT\.[a-zA-Z0-9]+/g) ?? []).length > 40);

  ok('nothing is written in a colour space the frames’ own oklch was converted out of',
    !/oklch\(|hsla?\(|color\(/.test(files.map((f) => coloursInCode(src(f)).join(' ')).join(' ')));

  // The shell is the one file outside the palette that could paint the page.
  const shell = src('index.html');
  ok('the document shell picks neither theme and spells no colour',
    coloursInCode(shell).length === 0 && /color-scheme"? content="light dark/.test(shell));
}

// ── 3 · both themes, completely ────────────────────────────────────────────

group('both themes are written into the document');
{
  const css = K.themeCss();
  const rules = {};
  for (const m of css.matchAll(/\[data-theme="(dark|light)"\]\{([^}]*)\}/g)) rules[m[1]] = m[2];
  ok('there is a rule for each theme', !!rules.dark && !!rules.light);
  for (const scheme of ['dark', 'light']) {
    const t = K.tokensFor(scheme);
    const declared = Object.fromEntries([...rules[scheme].matchAll(/--dv-([a-zA-Z0-9]+):([^;]+)/g)]
      .map((m) => [m[1], m[2]]));
    const names = keys(t).filter((k) => k !== 'scheme');
    ok(`the ${scheme} rule declares every name in the table`, eq(keys(declared), names),
      `${keys(declared).length} vs ${names.length}`);
    ok(`…each with the ${scheme} table's value`, names.every((n) => declared[n] === t[n]));
    ok(`…and tells the browser which controls to draw`, rules[scheme].includes(`color-scheme:${scheme}`));
  }
  ok('the page itself is painted out of the table, not out of the shell',
    css.includes(`html,body{background:${K.T.bg};color:${K.T.ink};font-family:${K.SANS}}`));

  // Everything the panel can ask for has to exist on both sides, or one theme
  // is missing a colour and only one of them shows it. What a file holds is a
  // name — `T.ink3` — so the names are what is collected.
  const used = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(join(web, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) {
        for (const m of src(rel).matchAll(/\bT\.([a-zA-Z0-9]+)/g)) used.add(m[1]);
      }
    }
  };
  walk('src');
  // One send button in the product: the command bar's, the moment there is
  // something to send, is the disc the chat's composer has always drawn — the
  // panel's accent, the ink fill, under the ink that belongs on it.
  ok('the bar’s send is the send the chat has, in the colour the chat sends in',
    /background: ready \? T\.ink : T\.line2, color: ready \? T\.onInk : T\.ink/
      .test(src('src/ui/divan.tsx'))
    && K.C.accent === K.T.ink && K.C.onAccent === K.T.onInk);
  const undeclared = [...used].filter((n) => K.DARK[n] === undefined);
  ok('every token the panel reaches for is one the table declares', undeclared.length === 0, undeclared.join(', '));
  ok('…and it does reach for them by name rather than by value', used.size >= 15, `${used.size}`);
  ok('…and the older vocabulary the screens speak is the same table under other names',
    Object.entries(K.C).every(([, value]) => typeof value === 'string'
      && (value === K.ON_COLOUR || /^var\(--dv-[a-zA-Z0-9]+\)$/.test(value)))
    && Object.entries(K.C).every(([, value]) => value === K.ON_COLOUR
      || K.DARK[value.slice('var(--dv-'.length, -1)] !== undefined));
}

// ── 4 · the switch ─────────────────────────────────────────────────────────

group('the switch');
{
  let n = 0;
  const fresh = async (opts) => {
    const e = browser(opts);
    const m = await load('src/lib/theme.js', `?switch=${++n}`);
    return { e, m };
  };

  {
    const { e, m } = await fresh({ system: 'light' });
    ok('with nothing stored it opens in Night, whatever the computer says',
      m.themeScheme() === 'dark' && m.themeChoice() === 'dark');
    ok('…and says so on the document before anything is drawn', e.html.dataset.theme === 'dark');
  }
  {
    const { m } = await fresh({ system: 'light', stored: 'system' });
    ok('following the computer is still a choice', m.themeScheme() === 'light');
  }
  {
    const { m } = await fresh({});
    ok('a browser that cannot answer the question gets the theme the panel was drawn in',
      m.themeScheme() === 'dark');
  }
  {
    const { e, m } = await fresh({ system: 'dark', stored: 'light' });
    ok('a choice made by hand outlives the tab', m.themeChoice() === 'light' && m.themeScheme() === 'light');
    ok('…and is on the document at first paint, not after a render', e.html.dataset.theme === 'light');
  }
  {
    const { e, m } = await fresh({ system: 'dark', stored: 'nonsense' });
    ok('nonsense in storage is not a theme', m.themeChoice() === 'dark' && e.html.dataset.theme === 'dark');
  }
  {
    const { e, m } = await fresh({ system: 'dark' });
    m.setThemeChoice('light');
    ok('setting it changes the document', e.html.dataset.theme === 'light' && m.themeScheme() === 'light');
    ok('…and is remembered', e.store.get('rac.theme') === 'light');
    m.setThemeChoice('system');
    ok('…and it can be handed back to the computer',
      m.themeChoice() === 'system' && m.themeScheme() === 'dark' && e.html.dataset.theme === 'dark');
  }
  {
    const { e, m } = await fresh({ system: 'dark', stored: 'system' });
    e.sunset('light');
    ok('the computer changing its mind at sunset is followed', m.themeScheme() === 'light'
      && e.html.dataset.theme === 'light');
    m.setThemeChoice('dark');
    e.sunset('light');
    ok('…but not once a person has chosen', m.themeScheme() === 'dark' && e.html.dataset.theme === 'dark');
  }
  {
    // Storage that throws is what private mode does, and it must not be the
    // thing that stops the panel from opening.
    const { m } = await fresh({ system: 'dark' });
    globalThis.localStorage = {
      getItem() { throw new Error('nope'); },
      setItem() { throw new Error('nope'); },
      removeItem() {},
    };
    let threw = null;
    try { m.setThemeChoice('light'); } catch (err) { threw = err; }
    ok('a browser that refuses to remember still switches', threw === null && m.themeScheme() === 'light');
  }
  env = browser({ system: 'dark' });

  ok('the switch is offered on a screen', /AppearanceSection/.test(src('src/screens/Preferences.tsx'))
    && /'appearance'/.test(src('src/screens/Preferences.tsx')));
  ok('…and in the command palette', /id: 'theme'/.test(src('src/App.tsx')));
  // Rendered rather than grepped: what this is about is that the one setting
  // which is this browser's own is reachable on a panel with no computer
  // behind it, and a regular expression over the source says nothing about
  // that — it only says the source has not been reworded.
  {
    const { useFleet } = await load('src/lib/fleet.js');
    Object.assign(useFleet.getInitialState(), { hosts: {}, order: [], focus: null, ready: true });
    useFleet.setState({ hosts: {}, order: [], focus: null, ready: true });
    const { Preferences } = await load('src/screens/Preferences.js');
    let alone = '';
    try { alone = renderToStaticMarkup(createElement(Preferences, {})); } catch (e) { alone = `threw: ${e.message}`; }
    ok('…and the screen that offers it stands up with no computer paired',
      alone.includes('Appearance') && alone.includes('Computers')
      && !alone.startsWith('threw:'), alone.slice(0, 160));
  }
}

// ── 5 · the parts ──────────────────────────────────────────────────────────

group('the parts');

const PARTS = ['Card', 'Row', 'Pill', 'Tabs', 'ColumnTab', 'StatusDot', 'ExecutorBadge',
               'Counter', 'SectionHeader', 'EmptyState', 'SidePanel'];
{
  const divan = src('src/ui/divan.tsx');
  for (const part of PARTS) {
    ok(`${part} is a part rather than something a screen has to invent`,
      new RegExp(`export function ${part}\\(`).test(divan));
  }
  ok('and the two the frames draw beside them — a button and a state’s character',
    /export function Button\(/.test(divan) && /export function StateMark\(/.test(divan)
    && /export function Monogram\(/.test(divan));

  // Every part names the frame it was measured off, and every frame it names
  // exists, in the theme the list says it is drawn in.
  const cited = [...divan.matchAll(/Web1[2345] (W\d+)/g)].map((m) => m[1]);
  ok('every part names the frame it was measured off', cited.length >= PARTS.length, `${cited.length}`);
  const wrongGroup = [...divan.matchAll(/(Web1[2345]) (W\d+)/g)]
    .filter((m) => FRAMES[m[2]]?.[0] !== m[1]).map((m) => `${m[1]} ${m[2]}`);
  ok('…and no part cites a frame from a group it is not in', wrongGroup.length === 0, wrongGroup.join(', '));
  const phone = [...divan.matchAll(/(Mobile\d+ (?:S\d+|C\d+|Drag frame))/g)].map((m) => m[1]);
  ok('…and where it borrows from the phone it says which frame, and why',
    phone.every((f) => PHONE_FRAMES[f] !== undefined) && phone.length > 0, phone.join(', '));
  ok('the parts sit on the design’s own corners and heights, not on numbers of their own',
    /borderRadius: RADIUS\./.test(divan) && /SIZE\.pill/.test(divan)
    && K.RADIUS.card === 16 && K.RADIUS.pill === 999 && K.SIZE.pill === 32 && K.SIZE.sidePanel === 260);
}

/** Every style attribute of a render, flattened. */
function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].replace(/&quot;/g, '"').split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    return decl;
  });
}
const anyStyle = (markup, pred) => styles(markup).some(pred);
const countStyles = (markup, pred) => styles(markup).filter(pred).length;

/** The colours a render actually paints: every variable it names, and every
 *  value it spells out. */
function paint(markup) {
  const vars = new Set();
  const literal = new Set();
  for (const decl of styles(markup)) {
    for (const value of Object.values(decl)) {
      for (const m of value.matchAll(/var\(--dv-([a-zA-Z0-9]+)\)/g)) vars.add(m[1]);
      for (const c of colours(value.replace(/var\([^)]*\)/g, ''))) literal.add(c);
    }
  }
  return { vars, literal };
}

/** A rendered markup string, walked as the tree it is: every element, with the
 *  backgrounds of everything above it, nearest first. React's output is
 *  well-formed, so a stack of open tags is the whole of the parsing needed —
 *  and what a check wants to know about a colour is almost always what is
 *  behind it. */
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'path', 'circle',
                      'rect', 'line', 'polyline', 'polygon', 'use', 'source']);

function* elements(markup) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(markup))) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) {
      // Pop to the tag that is closing rather than popping one: React writes
      // `<path …></path>`, and a stack that pops on a tag it never pushed
      // starts handing back the wrong ancestor — which is how a modal's
      // contents came to look as if they were sitting straight on the page.
      const at = stack.map((f) => f.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const decl = {};
    for (const pair of (/style="([^"]*)"/.exec(attrs)?.[1] ?? '').replace(/&quot;/g, '"').split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    const paint = decl.background ?? decl['background-color'] ?? null;
    const own = decl.opacity == null ? 1 : Number(decl.opacity);
    const fade = stack.reduce((n, f) => n * f.fade, 1) * (Number.isFinite(own) ? own : 1);
    // `currentColor` is a glyph saying "whatever this button is drawn in",
    // which is the safe way to put an icon inside a button that changes colour
    // when it cannot be pressed. It means the nearest colour above it.
    const ink = decl.color ?? (stack.length ? stack[stack.length - 1].ink : null);
    yield {
      tag,
      style: decl,
      /** Its own opacity times every opacity above it, which is what a browser
       *  paints it at. */
      fade,
      /** What `currentColor` resolves to here. */
      ink,
      stroke: /stroke="([^"]*)"/.exec(attrs)?.[1] ?? null,
      fill: /fill="([^"]*)"/.exec(attrs)?.[1] ?? null,
      /** What it paints itself, if anything. */
      paint: paint && paint !== 'transparent' && paint !== 'none' ? paint : null,
      /** And what is above it, nearest first — its own not included, because
       *  an element's own fill is what is behind its text and not behind
       *  itself — each with the opacity it is painted at. */
      behind: stack.filter((f) => f.paint && f.paint !== 'transparent' && f.paint !== 'none')
        .map((f) => f.paint).reverse(),
      behindFade: stack.filter((f) => f.paint && f.paint !== 'transparent' && f.paint !== 'none')
        .map((f) => f.fade).reverse(),
    };
    if (!VOID.has(tag) && !selfClose) stack.push({ tag, paint, fade, ink });
  }
}

/** A colour an element brings with it — the white on a coloured square, the
 *  black behind a photo — does not follow the page and never came from the
 *  palette. Everything else has to be a variable. */
const OWN = new Set([K.ON_COLOUR, ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                     ...Object.values(K.MEDIA)]);

const drawn = {};
{
  const strayed = [];
  const undeclared = [];
  let threw = null;
  for (const s of gallery.SPECIMENS) {
    try { drawn[s.name] = renderToStaticMarkup(s.node); } catch (e) { threw = `${s.name}: ${e.message}`; break; }
    const { vars, literal } = paint(drawn[s.name]);
    for (const c of literal) if (!OWN.has(c)) strayed.push(`${s.name}: ${c}`);
    for (const v of vars) if (K.DARK[v] === undefined) undeclared.push(`${s.name}: ${v}`);
  }
  ok('every part stands up', threw === null, threw);
  ok('…and paints nothing it spelled out itself', strayed.length === 0, strayed.join(', '));
  ok('…and every colour it names is in the table, so it is drawn in either theme',
    undeclared.length === 0, undeclared.join(', '));
  ok('the gallery draws every one of them, each beside its frame',
    PARTS.every((p) => gallery.SPECIMENS.some((s) => s.name.startsWith(p)))
    && gallery.SPECIMENS.every((s) => typeof s.frame === 'string' && s.frame.length > 3));

  const v = (n) => `var(--dv-${n})`;
  ok('a card is drawn on the frames’ first surface, under the hairline they ring it with',
    styles(drawn.Card)[0].background === v('s1')
    && styles(drawn.Card)[0]['box-shadow'] === `0 0 0 1px ${v('line')}`);
  ok('…on the design’s own corner',
    styles(drawn.Card)[0]['border-radius'] === '16px');
  ok('a card that is asking wears the amber ring instead',
    styles(drawn.CardAsking)[0]['box-shadow'].includes(v('amberRing')));
  ok('…and a ticket card is the tighter of the two paddings the frames draw',
    styles(drawn.CardAsking)[0].padding === '12px 14px 13px'
    && styles(drawn.Card)[0].padding === '16px 18px');
  ok('a card being carried is drawn on the lifted surface, and falls further',
    styles(drawn.CardLifted)[0].background === v('sLift')
    && styles(drawn.CardLifted)[0]['box-shadow'].includes('24px'));
  ok('the running rule across it is green, and as wide as the work is done',
    anyStyle(drawn.CardLifted, (s) => s.background === v('run') && s.width === '38%' && s.height === '2px'));
  ok('a row is a 32 pt well, a title and a grey line, over a hairline',
    anyStyle(drawn.Row, (s) => s.width === '32px' && s['border-radius'] === '10px' && s.background === v('s2'))
    && anyStyle(drawn.Row, (s) => s['border-top'] === `1px solid ${v('line')}`));
  ok('…and the row that wants a person is washed in its state',
    anyStyle(drawn.Row, (s) => s.background === v('amberBg')));
  ok('a pill stands 32 high on the pill corner, filled or outlined',
    anyStyle(drawn.Pill, (s) => s.height === '32px' && s['border-radius'] === '999px')
    && anyStyle(drawn.PillAnswers, (s) => s['box-shadow'] === `inset 0 0 0 1px ${v('line2')}`
      && s.background === 'transparent'));
  ok('the selected chip is filled with the ink and labelled in the page colour',
    anyStyle(drawn.Pill, (s) => s.background === v('ink') && s.color === v('bg')));
  ok('the amber answer carries the one text colour the frames spell out',
    anyStyle(drawn.PillAnswers, (s) => s.background === v('amber') && s.color === v('onAmber')));
  ok('a tab strip is a well with a card in it',
    styles(drawn.Tabs)[0].background === v('s1')
    && countStyles(drawn.Tabs, (s) => s.background === v('s2') && s['border-radius'] === '10px') === 1);
  ok('a column with work in it carries the green wash',
    countStyles(drawn.ColumnTab, (s) => s.background === v('runBg')) === 1);
  ok('while a card is in the air every column says it would take it',
    countStyles(drawn.ColumnTabDrop, (s) => (s.border ?? '').includes('dashed')) === 2);
  ok('…and the one under the cursor turns green, and only that one',
    countStyles(drawn.ColumnTabDrop, (s) => s.border === `1.5px solid ${v('run')}`) === 1);
  ok('a status dot is 7 across, and the hollow one is the same circle as a ring',
    anyStyle(drawn.StatusDot, (s) => s.width === '7px' && s.background === v('run'))
    && anyStyle(drawn.StatusDot, (s) => s.border === `1.5px solid ${v('amber')}`
      && s.background === 'transparent'));
  ok('a state is never colour alone: the character is drawn beside it',
    ['■', '●', '○'].every((c) => drawn.StateMark.includes(c)));
  ok('a ticket nobody has taken is an outline where a Coder has a square',
    anyStyle(drawn.ExecutorBadge, (s) => s.background === K.EXECUTORS.coder.fill)
    && anyStyle(drawn.ExecutorBadge, (s) => (s.border ?? '').includes('dashed')));
  ok('…and the two who are not machines take the page’s own tones',
    anyStyle(drawn.ExecutorBadge, (s) => s.background === v('ink') && s.color === v('bg')));
  ok('the mark is mono, tightened so that `</>` fits',
    anyStyle(drawn.ExecutorBadge, (s) => s['letter-spacing'] === '-.06em'));
  ok('every project on one screen wears the same neutral monogram',
    eq([...new Set(styles(drawn.Monogram).map((s) => s.background).filter(Boolean))], [v('s2')]));
  ok('a counter with something to say is tinted and coloured',
    anyStyle(drawn.Counter, (s) => s.background === v('amberBg'))
    && anyStyle(drawn.Counter, (s) => s.color === v('amber')));
  ok('…one that is a different kind of fact is outlined instead of washed',
    anyStyle(drawn.Counter, (s) => s['box-shadow'] === `0 0 0 1.5px ${v('amber')}`
      && s.background === 'transparent'));
  ok('…and one at zero drops both, which is the whole of the calm screen',
    !paint(drawn.CounterZero).vars.has('amber') && !paint(drawn.CounterZero).vars.has('amberBg')
    && anyStyle(drawn.CounterZero, (s) => s.color === v('ink3')));
  ok('the number is mono at the frames’ own size',
    anyStyle(drawn.Counter, (s) => s['font-size'] === '32px' && s['font-family']?.includes('mono')));
  ok('a page head is one per screen, at 28 with the aside at the far end',
    anyStyle(drawn.SectionHeader, (s) => s['font-size'] === '28px' && s['letter-spacing'] === '-.02em')
    && anyStyle(drawn.SectionHeader, (s) => s['margin-left'] === 'auto'));
  ok('a section head is the smaller one, with its count in mono grey',
    anyStyle(drawn.SectionHeader, (s) => s['font-size'] === '15px' && s['font-weight'] === '600'));
  ok('an empty screen is a sentence and not a mark in a circle',
    anyStyle(drawn.EmptyState, (s) => s['font-size'] === '28px')
    && !anyStyle(drawn.EmptyState, (s) => parseFloat(s['border-radius'] ?? '0') >= 30 && !!s.width && s.width === s.height));
  ok('…and it says in mono what will not happen without a person',
    anyStyle(drawn.EmptyState, (s) => s.color === v('ink3') && s['font-family']?.includes('mono')));
  ok('the side panel is the 260 pt column of Web15, its selected row a card in a well',
    styles(drawn.SidePanel)[0].width === '260px'
    && countStyles(drawn.SidePanel, (s) => s.background === v('s2') && s.height === '40px') === 1);
  ok('…and what needs a person in it is amber, as a number or as a ring',
    anyStyle(drawn.SidePanel, (s) => s.color === v('amber'))
    && anyStyle(drawn.SidePanel, (s) => (s.border ?? '').includes(v('amber'))));
}

// ── 6 · the screens that were already here ─────────────────────────────────

group('the screens the panel already had');
{
  // Every section of this computer's page, because five of the seven are
  // behind a press and a static render cannot press one — and it is the screen
  // this ticket rewrote hardest.
  const SECTIONS = ['hosts', 'accounts', 'defaults', 'tools', 'appearance', 'security', 'about'];
  const screens = {
    Fleet: ['src/screens/Fleet.js', 'Fleet', { onOpenChat() {}, onNewChat() {} }],
    Projects: ['src/screens/Projects.js', 'Projects', { onNewChatIn() {}, onOpenChat() {} }],
    Agents: ['src/screens/Agents.js', 'Agents', { onStartChat() {} }],
    Terminal: ['src/screens/Terminal.js', 'Terminal', { onPeek() {}, onNewChat() {} }],
    Screen: ['src/screens/Screen.js', 'Screen', {}],
    Update: ['src/screens/Update.js', 'Update', {}],
    ...Object.fromEntries(SECTIONS.map((x) => (
      [`Preferences·${x}`, ['src/screens/Preferences.js', 'Preferences', { section: x }]]
    ))),
    Onboarding: ['src/screens/Onboarding.js', 'Onboarding', { onPaired() {} }],
    Ustabasi: ['src/screens/Ustabasi.js', 'Ustabasi', {}],
    Sidebar: ['src/components/Sidebar.js', 'Sidebar', {
      view: 'chats', onView() {}, selected: null, selectedHost: null, onSelect() {},
      onNewChat() {}, searchRef: { current: null }, collapsed: false, onCollapse() {},
    }],
    Palette: ['src/components/Palette.js', 'Palette', {
      commands: [{ id: 'theme', label: 'Light theme', run() {} }],
      onOpenChat() {}, onNewChatIn() {}, onClose() {},
    }],
    ChatView: ['src/components/ChatView.js', 'ChatView', {
      chat: null, hostKey: null, log: { items: [], busy: false }, sending: false, groups: [],
      groupName: null, accountLabel: null, accountUsage: null, liveTokens: null,
      onSend() {}, onUpload() {}, onInterrupt() {}, onRespond() {}, onEdit() {},
      onUpdate() {}, onDelete() {}, onPopOut() {},
    }],
  };
  const broken = [];
  const strayed = [];
  const undeclared = [];
  // Twice: with nothing paired, which is the state every screen opens in and
  // the only one it could draw until now, and with a computer on the other end
  // — which is where the rows, the accounts, the quota bars and the two marks
  // the panel dims actually are. `useFleet` is a store, so seeding it is what a
  // check does instead of pairing.
  const { useFleet } = await load('src/lib/fleet.js');
  const { host } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
  const paired = { hosts: { studio: host() }, order: ['studio'], focus: 'studio', ready: true };
  const nothing = { hosts: {}, order: [], focus: null, ready: true };
  /** The same computer answering eight minutes ago and not since: every figure
   *  on the page is what it last said, and a screen that reads `info` as if it
   *  were fresh has to survive it. */
  const stale = () => {
    const slot = host();
    slot.lastOnline = (Date.now() / 1000 - 8 * 60) * 1000;
    return { hosts: { studio: slot }, order: ['studio'], focus: 'studio', ready: true };
  };
  /** …and the same computer refusing the connection with its last answer still
   *  in hand, which is where a screen that assumes `info` is there falls over. */
  const gone = () => {
    const slot = host();
    slot.status = 'offline';
    slot.info = null;
    slot.catalog = null;
    slot.accounts = [];
    slot.limits = {};
    slot.lastOnline = (Date.now() / 1000 - 600) * 1000;
    return { hosts: { studio: slot }, order: ['studio'], focus: 'studio', ready: true };
  };

  /** A render on a server is handed the store's *initial* state — zustand
   *  reads `getServerState || getInitialState` — so a store seeded with
   *  `setState` alone is invisible to `renderToStaticMarkup`, which is why
   *  every screen in this file drew its empty state and nothing noticed. The
   *  initial state is the object the store was made with, so seeding it means
   *  writing into that object too. */
  const seed = (patch) => {
    Object.assign(useFleet.getInitialState(), patch);
    useFleet.setState(patch);
  };

  // Terminal's wall is a list this browser keeps rather than something the
  // daemon sends, and a tile's transcript comes from the log store — so a wall
  // with tiles on it, which is the only thing that draws the phase table, needs
  // both seeded as well.
  const { useLogs } = await load('src/lib/timeline.js');
  const { items: timeline } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
  const oneLog = (patch) => ({ items: timeline(), seq: 8, busy: false, pending: [],
                               loading: false, error: null, truncated: false, ...patch });
  const wallLogs = {
    'studio/c1': oneLog(), 'studio/c2': oneLog({ busy: true }), 'studio/c3': oneLog(),
  };
  Object.assign(useLogs.getInitialState(), { logs: wallLogs });
  useLogs.setState({ logs: wallLogs });
  globalThis.localStorage.setItem('rac.terminal.wall',
    JSON.stringify(['studio/c1', 'studio/c2', 'studio/c3']));

  // The Machine place and its thirteen pages. Six of them — the machines
  // table, the executors, the sign-ins, the thresholds, Admin and Settings —
  // are drawn by no other tree in this file, so until now nothing here read a
  // colour, a white or a placeholder off them. The drawer takes a merged view
  // as well as the store, so the two move together: a world where the store
  // has no computer is a world where the view has none either.
  const D = await load('src/lib/divan.js');
  const { studio: studioSnap, mini: miniSnap } =
    await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
  const NOW_S = Math.floor(Date.now() / 1000);
  const FLEET = {
    alone: D.merge([], NOW_S),
    paired: D.merge([{ key: 'studio', name: 'studio', state: D.answered(studioSnap(), NOW_S) }], NOW_S),
    stale: D.merge([{ key: 'studio', name: 'studio', state: D.answered(studioSnap(), NOW_S - 8 * 60) }], NOW_S),
    // Two machines the drawer has to draw and one of them has never answered:
    // that is where a table has nothing to put in a cell, which is the state
    // criterion 4 is about.
    unreachable: D.merge([
      { key: 'studio', name: 'studio', state: D.silent(null, 'not connected') },
      { key: 'mini', name: 'mini',
        state: D.silent(D.answered(miniSnap(), NOW_S - 600), 'connection refused') },
    ], NOW_S),
  };
  const shell = await load('src/lib/shell.js');
  const DRAWER = [...shell.MACHINE_ROWS.map((r) => r.view),
                  ...shell.MACHINE_ASIDE.map((a) => a.view)];
  const drawerPages = (world) => Object.fromEntries(DRAWER.map((v) => (
    [`Machine·${v}`, ['src/screens/Machine.js', 'Machine', {
      view: v, fleet: FLEET[world], onView() {}, onOpenChat() {}, onNewChat() {},
      onNewChatIn() {}, onStartChat() {}, onPeek() {},
    }]]
  )));

  // Four worlds, because that is what the screens have to survive: nothing
  // paired, a computer answering, one whose answer is eight minutes old, and
  // one that has stopped answering with its last answer still on screen.
  for (const [world, state] of [['alone', nothing], ['paired', paired],
                               ['stale', stale()], ['unreachable', gone()]]) {
    seed(state);
    for (const [name, [path, exp, props]] of Object.entries({ ...screens, ...drawerPages(world) })) {
      let markup;
      try {
        const mod = await load(path);
        markup = renderToStaticMarkup(createElement(mod[exp], props));
      } catch (e) { broken.push(`${world} ${name}: ${e.message.slice(0, 120)}`); continue; }
      // Kept, because the two checks that measure pairs read every tree drawn
      // in this file and a screen is the biggest of them.
      drawn[`screen:${name} ${world}`] = markup;
      const { vars, literal } = paint(markup);
      for (const c of literal) if (!OWN.has(c)) strayed.push(`${world} ${name}: ${c}`);
      for (const v of vars) if (K.DARK[v] === undefined) undeclared.push(`${world} ${name}: ${v}`);
    }
  }
  ok('every screen still stands up: alone, paired, stale and unreachable',
    broken.length === 0, broken.join('\n    '));
  ok('…and that is every page of the Machine place as well as every screen',
    DRAWER.length === 13
    && DRAWER.every((v) => (drawn[`screen:Machine·${v} unreachable`] ?? '').length > 400),
    DRAWER.map((v) => `${v} ${(drawn[`screen:Machine·${v} unreachable`] ?? '').length}`).join(' · '));
  ok('…and none of them paints a value of its own', strayed.length === 0, strayed.join(', '));
  ok('…so every colour on every screen exists in both themes', undeclared.length === 0, undeclared.join(', '));
  ok('the wall draws its tiles, which is the only place the phase colours are',
    ['needs approval', 'working', 'done'].some((w) => (drawn['screen:Terminal paired'] ?? '').includes(w))
    && (drawn['screen:Terminal paired'] ?? '').includes('Invoice PDF'),
    (drawn['screen:Terminal paired'] ?? '').length.toString());
  ok('…and a paired screen is a fuller screen than an empty one',
    (drawn['screen:Preferences·accounts paired'] ?? '').length
      > (drawn['screen:Preferences·accounts alone'] ?? '').length * 1.5,
    `${(drawn['screen:Preferences·accounts paired'] ?? '').length} vs `
      + `${(drawn['screen:Preferences·accounts alone'] ?? '').length}`);
  ok('…and all seven sections of this computer’s page drew in all four worlds',
    SECTIONS.every((x) => ['alone', 'paired', 'stale', 'unreachable']
      .every((w) => (drawn[`screen:Preferences·${x} ${w}`] ?? '').length > 400)),
    SECTIONS.map((x) => `${x} ${(drawn[`screen:Preferences·${x} unreachable`] ?? '').length}`).join(' · '));
  // The panels that open over a screen are drawn against a paired computer
  // too: New chat reads the catalog off one.
  seed(paired);
}

group('the panels the screens open over themselves');
{
  // A modal, a sheet, a popover and a menu are screens too — the panel spends
  // half its time in one — and none of them needs a daemon to stand up. They
  // were the half of "every screen in both themes" that neither check drew.
  const { chat: makeChat, pending: makePending, items: makeItems, shots, groups } =
    await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
  const { NOW: ticketNow, wall: ticketWall } =
    await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);
  const { groupByProject } = await load('src/lib/ustabasi.js');
  const ticketGroups = groupByProject(ticketWall());
  const chat = makeChat();
  const pending = makePending();
  const items = makeItems();
  const { ticket } = await import(pathToFileURL(join(web, 'scripts', 'ticket-fixture.js')).href);

  const overlays = {
    Modal: ['src/components/Modal.js', 'Modal', { onClose() {}, children: 'anything' }],
    ApprovalModal: ['src/components/ApprovalModal.js', 'ApprovalModal', {
      pending, chat, queued: 2, onRespond() {}, onOpenChat() {}, onClose() {},
    }],
    NewChat: ['src/components/NewChat.js', 'NewChat', {
      hostKey: 'studio', initialCwd: undefined, initialAgent: null, onDone() {}, onClose() {},
    }],
    ChatMenu: ['src/components/ChatMenu.js', 'ChatMenu', {
      chat, groups: groups(), onUpdate() {}, onDelete() {}, onClose() {},
    }],
    ChatDetails: ['src/components/ChatDetails.js', 'ChatDetails', {
      chat, items, busy: true, liveTokens: 1240, accountLabel: 'yakup@…',
      accountUsage: 0.64, onEdit() {}, onInterrupt() {}, onPopOut() {}, onClose() {},
    }],
    Lightbox: ['src/components/Lightbox.js', 'Lightbox', {
      shots: shots(), start: 0, onClose() {},
    }],
    FieldSheet: ['src/components/FieldSheet.js', 'FieldSheet', {
      field: 'model', chat, catalog: null, projects: [], accounts: [], limits: {},
      busy: false, onPick() {}, onClose() {},
    }],
    TicketChat: ['src/components/TicketChat.js', 'TicketChat', {
      t: ticket(), tone: K.toneFace('needs an answer', 'amber'), onClose() {}, onNote: async () => 'ok',
    }],
    // The chat with a chat in it, which is the only way the composer is drawn
    // at all — and the composer at rest is where a white glyph on a neutral
    // disc hid through a whole round. Both of its states, because the resting
    // one and the running one are different buttons.
    ChatOpen: ['src/components/ChatView.js', 'ChatView', {
      chat, hostKey: 'studio', log: { items, busy: false, pending: [] }, sending: false,
      groups: [], groupName: null, accountLabel: 'yakup@…', accountUsage: 0.64, liveTokens: null,
      onSend: async () => {}, onUpload: async () => ({}), onInterrupt() {}, onRespond() {},
      onEdit() {}, onUpdate() {}, onDelete() {}, onPopOut() {},
    }],
    ChatBusy: ['src/components/ChatView.js', 'ChatView', {
      chat: { ...chat, status: 'running' }, hostKey: 'studio',
      log: { items, busy: true, pending: [] }, sending: true,
      groups: [], groupName: null, accountLabel: 'yakup@…', accountUsage: 0.64, liveTokens: 1240,
      onSend: async () => {}, onUpload: async () => ({}), onInterrupt() {}, onRespond() {},
      onEdit() {}, onUpdate() {}, onDelete() {}, onPopOut() {},
    }],
    // The two pieces of a screen that only appear in a state a whole-screen
    // render does not reach on its own: the section this ticket adds, which is
    // behind a click on the rail, and the mark the panel dims for a tool that
    // is not installed or an account not signed in.
    AppearanceSection: ['src/screens/Preferences.js', 'AppearanceSection', {}],
    // The ticket queue's wall, whose cards carry the other copy of the phase
    // table. The screen itself reads the queue over the socket and draws
    // nothing without one; its wall takes the tickets as a prop, which is what
    // `test-wall-ui.mjs` does with them too.
    TicketWall: ['src/screens/Ustabasi.js', 'Wall', {
      groups: ticketGroups, now: ticketNow, onOpen() {},
    }],
    ProviderMarkDim: ['src/components/Sidebar.js', 'ProviderMark', { provider: 'codex', dim: true }],
    ProviderMarkLive: ['src/components/Sidebar.js', 'ProviderMark', { provider: 'claude' }],
  };
  const broken = [];
  const strayed = [];
  const undeclared = [];
  for (const [name, [path, exp, props]] of Object.entries(overlays)) {
    let markup;
    try {
      const mod = await load(path);
      markup = renderToStaticMarkup(createElement(mod[exp], props));
    } catch (e) { broken.push(`${name}: ${e.message.slice(0, 120)}`); continue; }
    drawn[`overlay:${name}`] = markup;
    if (markup.length < 200) broken.push(`${name}: drew almost nothing (${markup.length})`);
    const { vars, literal } = paint(markup);
    for (const c of literal) if (!OWN.has(c)) strayed.push(`${name}: ${c}`);
    for (const v of vars) if (K.DARK[v] === undefined) undeclared.push(`${name}: ${v}`);
  }
  ok('every panel the screens open stands up', broken.length === 0, broken.join('\n    '));
  ok('…and none of them paints a value of its own', strayed.length === 0, strayed.join(', '));
  ok('…so they are drawn in either theme like everything else',
    undeclared.length === 0, undeclared.join(', '));
  ok('…and there are fourteen of them, the chat among them with a chat open in it',
    Object.keys(overlays).length === 14 && (drawn['overlay:ChatOpen'] ?? '').includes('<textarea'));
  ok('the ticket wall draws its cards, which carry the queue’s own phase colours',
    (drawn['overlay:TicketWall'] ?? '').includes('needs an answer')
    || (drawn['overlay:TicketWall'] ?? '').includes('stopped'),
    (drawn['overlay:TicketWall'] ?? '').slice(0, 120));
  ok('the switch this ticket adds is drawn rather than grepped for',
    (drawn['overlay:AppearanceSection'] ?? '').includes('system')
    && (drawn['overlay:AppearanceSection'] ?? '').includes('theme'));
  ok('…and the mark the panel dims is drawn in both of its states',
    (drawn['overlay:ProviderMarkDim'] ?? '').includes('&lt;&gt;')
    && (drawn['overlay:ProviderMarkDim'] ?? '') !== (drawn['overlay:ProviderMarkLive'] ?? ''));
  ok('…and a paired preferences page draws that dim mark itself, where the real one is',
    (drawn['screen:Preferences·accounts paired'] ?? '').includes('&lt;&gt;'));
}

group('white belongs on a filled colour and nowhere else');
{
  // The one pair a palette cannot make safe by itself: `onAccent` and
  // `onWarn` are the two "text on a filled colour" values, and on a neutral
  // surface they are invisible in one theme and merely odd in the other. This
  // is what a white send glyph on `surface2` looked like: legal in both
  // checks, 1.03:1 on a light page.
  const FILLED = new Set([K.T.red, K.T.amber, K.T.run, K.T.ink,
                          ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                          K.MEDIA.backdrop, K.MEDIA.stage, K.MEDIA.chrome]);
  const WHITE = new Set([K.ON_COLOUR, K.T.onAmber]);
  const misplaced = [];
  let placed = 0;
  for (const [where, markup] of Object.entries(drawn)) {
    for (const el of elements(markup)) {
      // A value drawn *on* the element sits on the element's own fill where it
      // has one; a fill sits on whatever is behind the element itself.
      const front = [el.style.color, el.style['border'], el.style['border-color'],
                     el.style['box-shadow'], el.stroke, el.fill]
        .map((v) => (v === 'currentColor' ? el.ink : v)).filter(Boolean);
      const isFront = front.some((v) => [...WHITE].some((w) => v.includes(w)));
      const isFill = WHITE.has(el.paint ?? '');
      if (!isFront && !isFill) continue;
      placed++;
      const on = (isFront ? el.paint ?? el.behind[0] : el.behind[0]) ?? '(nothing)';
      // `onAmber` is the one pair the frames spell out, so it is stricter: it
      // is the amber's own text colour and belongs on the amber.
      const wanted = front.some((v) => v.includes(K.T.onAmber)) ? new Set([K.T.amber]) : FILLED;
      if (!wanted.has(on)) misplaced.push(`${where}: ${el.tag} on ${on}`);
    }
  }
  ok('nothing drawn in the two "on a filled colour" values sits on a neutral surface',
    misplaced.length === 0, [...new Set(misplaced)].slice(0, 8).join('\n    '));
  ok('…over every tree drawn in this file: the parts, the screens and the panels',
    placed >= 10 && Object.keys(drawn).some((k) => k.startsWith('screen:'))
    && Object.keys(drawn).some((k) => k.startsWith('overlay:')), String(placed));
}

group('every pair of tokens that meets can be read');
{
  // The browser pass measures what a browser actually painted, which is the
  // whole truth and needs Chrome. This is the half of it that can be had
  // without one, and it is the half that regresses: a pair of tokens put
  // together in the source — this ink on that surface — in every component
  // above, in both themes.
  //
  // Opacity is resolved rather than stepped over: an element is painted at its
  // own opacity times every opacity above it, which is a product this walk
  // already has the ancestors for. Skipping a faded element instead is how the
  // round-one send glyph stayed invisible to a check that ran over it, so the
  // count of what was skipped is asserted to be zero — a colour this cannot
  // work out has to become a failure, not a silence.
  const rgba = (value) => {
    if (value.startsWith('#')) {
      const h = value.slice(1);
      const p = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
      return [...p.map((x) => parseInt(x, 16)), 1];
    }
    const n = (value.match(/[\d.]+/g) ?? []).map(Number);
    return n.length >= 3 ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : null;
  };
  /** A style value as a colour in one theme, or null if it is not one. */
  const resolve = (value, t) => {
    if (!value) return null;
    const v = value.trim();
    const token = /^var\(--dv-([a-zA-Z0-9]+)\)$/.exec(v);
    if (token) return t[token[1]] ? rgba(t[token[1]]) : null;
    return /^(#|rgba?\()/.test(v) ? rgba(v) : null;
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = (c) => {
    const ch = c.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const thin = [];
  let pairs = 0;
  let skipped = 0;
  for (const scheme of ['dark', 'light']) {
    const t = K.tokensFor(scheme);
    for (const [where, markup] of Object.entries(drawn)) {
      for (const el of elements(markup)) {
        const fronts = [el.style.color, el.stroke, el.fill].filter((v) => v && v !== 'none');
        if (!fronts.length) continue;
        // Nothing is painted at all at zero: a diff's blank gutter and the
        // frames of a screen share that are there to hold a size, and an
        // invisible thing has no pair to read.
        if (el.fade === 0) continue;
        // The stack under it, its own fill first, composited down to the page.
        // A faded ancestor's fill is faded too, which is what the browser does.
        let bg = rgba(t.bg);
        const layers = [...(el.paint ? [{ v: el.paint, fade: el.fade }] : []),
                        ...el.behind.map((v, i) => ({ v, fade: el.behindFade[i] }))]
          .map(({ v, fade }) => {
            const c = resolve(v, t);
            return c && [c[0], c[1], c[2], c[3] * fade];
          });
        if (layers.some((c) => !c)) { skipped++; continue; }
        for (const c of [...layers].reverse()) bg = over(c, bg);
        for (const front of fronts) {
          const fg = resolve(front === 'currentColor' ? el.ink : front, t);
          if (!fg) { skipped++; continue; }
          pairs++;
          const ratio = contrast(over([fg[0], fg[1], fg[2], fg[3] * el.fade], bg), bg);
          if (ratio < 3) {
            thin.push(`${scheme} · ${where} · ${el.tag} · ${front}`
              + (el.fade < 1 ? ` at ${el.fade.toFixed(2)} opacity` : '')
              + ` on rgb(${bg.slice(0, 3).map(Math.round).join(',')}) = ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
  }
  ok('every ink a component puts on a surface separates from it, in both themes',
    thin.length === 0, [...new Set(thin)].slice(0, 10).join('\n    '));
  ok('…measured over both themes and every component rendered above',
    pairs > 1500, `${pairs} pairs`);
  ok('…and nothing was left unmeasured', skipped === 0, `${skipped} skipped`);
}

group('the fades that are left are the ones that were decided');
{
  // Everything a person reads is drawn at full strength now: "grey rather than
  // faint" replaced every fade that was standing in for "you cannot press
  // this", because a fade is the one thing the palette cannot make legible and
  // the one thing a check that only measures colours cannot see.
  //
  // Four are left and each is a decision, so they are written down here: a
  // fade nobody decided on cannot appear without this list gaining a line.
  const DECIDED = {
    // The tile being carried stays faintly in place, so that the gap it will
    // leave is visible while the drop target is chosen. The artboard draws the
    // ghost that way itself; nothing is read off it.
    'src/screens/Terminal.tsx': ['lifted ? 0.4 : 1'],
    // Not a fade but an absence: a diff's gutter holds its width when there is
    // no sign in it, and a screen share's frames are stacked and only the
    // front one is shown.
    'src/components/Timeline.tsx': ["sign === ' ' ? 0 : 1"],
    'src/screens/Screen.tsx': ['i === front ? 1 : 0'],
    // The textarea a copy goes through, which is one pixel and off screen.
    'src/lib/clipboard.ts': ['0'],
    // The two animations: a caret blinking and the "working" dot breathing.
    'src/ui/kit.tsx': ['1', '0', '0.35'],
    // The screen that draws when the app has thrown. It cannot read the palette
    // — a boundary that imported the app's modules would go down with them — so
    // its second and third lines are quietened with opacity rather than with
    // `ink2` and `ink3`.
    'src/components/Fallback.tsx': ['0.75', '0.8'],
  };
  const undecided = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(web, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      for (const m of src(rel).matchAll(/opacity: ?([^,;}\n]+)/g)) {
        const what = m[1].trim();
        if (!(DECIDED[rel] ?? []).includes(what)) undecided.push(`${rel}: ${what}`);
      }
    }
  };
  walk('src');
  ok('no element is faded except the four places that say why', undecided.length === 0,
    undecided.join(', '));
  ok('…and every one of those four is still there, so the list is not stale',
    Object.entries(DECIDED).every(([f, list]) => list.every((v) => src(f).includes(`opacity: ${v}`)
      || src(f).includes(`opacity:${v}`))));
}

group('the chat was left alone');
{
  const chat = ['src/components/ChatView.tsx', 'src/components/Bubble.tsx',
                'src/components/Timeline.tsx', 'src/components/ChatDetails.tsx',
                'src/components/TicketChat.tsx'];
  for (const f of chat) {
    ok(`${f.split('/').pop()} was not rebuilt out of the new parts`, !/ui\/divan/.test(src(f)));
  }
  // What "the layout is not changed" means, mechanically: the composer, the
  // transcript and the bubble are still drawn the way they were, and the only
  // thing this ticket touched in them is which name a colour has.
  const view = src('src/components/ChatView.tsx');
  // The composer moved out of the screen and into a part of its own — the
  // window a chat opens in on the Dashboard draws the same one, and a chat
  // that could do less in one window than the other was two chats. It is
  // still the chat's own box, drawn the chat's own way, which is what this
  // was always about.
  const composer = src('src/components/ChatComposer.tsx');
  ok('the composer is still a textarea in a rounded field',
    /<textarea/.test(composer) && /R\.composer/.test(composer)
    && /ChatComposer/.test(view) && !/ui\/divan/.test(composer));
  ok('the transcript still scrolls under it', /overflowY: 'auto'/.test(view));
  ok('a bubble is still squared off on the corner that points at who said it',
    /borderRadius: '18px 18px 6px 18px'/.test(src('src/components/Bubble.tsx')));
}

group('the keyboard and the palette still work');
{
  const app = src('src/App.tsx');
  for (const [key, what] of [["'k'", 'the palette'], ["'b'", 'the rail'], ["'n'", 'a new chat'],
                             ["'f'", 'search'], ["','", 'settings'], ["'1'", 'the dashboard'],
                             ["'2'", 'projects'], ["'3'", 'agents'], ["'4'", 'terminal mode'],
                             ["'5'", 'the screen'], ["'6'", 'admin']]) {
    ok(`⌘${key.replaceAll("'", '')} still opens ${what}`, app.includes(`e.key === ${key}`));
  }
  ok('the palette is still mounted', /<Palette$|<Palette\b/m.test(app));
  ok('…and it offers the theme that is not on screen',
    /theme\.scheme === 'dark' \? 'Light theme' : 'Dark theme'/.test(app));
}

// ── 7 · the greys still separate ───────────────────────────────────────────

group('the greys separate, in both themes');
{
  const luminance = (hex) => {
    const h = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const FLOOR = 3.5;
  const thin = [];
  for (const scheme of ['dark', 'light']) {
    const t = K.tokensFor(scheme);
    for (const fg of ['ink', 'ink2', 'ink3', 'amber', 'red', 'run']) {
      for (const bg of ['bg', 's1', 's2', 'sLift']) {
        const r = contrast(t[fg], t[bg]);
        if (r < FLOOR) thin.push(`${scheme} ${fg} on ${bg} ${r.toFixed(2)}`);
      }
    }
    const pair = contrast(t.onAmber, t.amber);
    if (pair < FLOOR) thin.push(`${scheme} onAmber ${pair.toFixed(2)}`);
    const onInk = contrast(t.bg, t.ink);
    if (onInk < FLOOR) thin.push(`${scheme} bg on ink ${onInk.toFixed(2)}`);
  }
  ok('every tier of text separates from every surface it can land on', thin.length === 0, thin.join(', '));
}

// ── 8 · the document says the same thing ───────────────────────────────────

group('design/divan/TOKENS.md');
{
  const path = join(root, 'design', 'divan', 'TOKENS.md');
  ok('there is one tokens document, and the web is a part of it', existsSync(path));
  const doc = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const others = existsSync(join(root, 'design', 'divan'))
    ? readdirSync(join(root, 'design', 'divan')).filter((f) => /TOKENS/i.test(f))
    : [];
  ok('…and not a second one beside it', eq(others, ['TOKENS.md']), others.join(', '));
  ok('the web side is written down in it', /\bweb\b/i.test(doc) && /web\/src\/lib\/theme\.ts/.test(doc));
  ok('…and it names where the parts, the gallery and this check live',
    ['web/src/ui/divan.tsx', 'web/scripts/divan-gallery.tsx', 'web/scripts/test-divan.mjs']
      .every((f) => doc.includes(f)));

  const missing = [];
  for (const scheme of ['dark', 'light']) {
    const t = K.tokensFor(scheme);
    for (const [name, value] of Object.entries(t)) {
      if (name === 'scheme') continue;
      // `#fff` and `#FFFFFF` are the same colour, and the document quotes the
      // frames' own spelling.
      const alt = value === '#FFFFFF' ? '#fff' : value;
      if (!doc.includes(value) && !doc.includes(alt)) missing.push(`${scheme} ${name} ${value}`);
    }
  }
  ok('every value in the table is in the document too', missing.length === 0, missing.join(', '));
  const unmapped = Object.entries(K.SOURCE).filter(([n, prop]) => !doc.includes(`| \`${n}\` | \`${prop}\` |`));
  ok('…and every token’s property is written down beside it', unmapped.length === 0,
    unmapped.map(([n]) => n).join(', '));
}

// ── the screens that were carried over last ────────────────────────────────

/** Everything under `web/src` this branch touched, asked of git rather than
 *  written down: a list kept by hand is a list that goes stale the first time
 *  a file is added to the work, and then the check quietly stops covering it.
 *  The merge base is the comparison, so it says the same thing on the branch
 *  and after a merge. */
function carried() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'main...HEAD', '--', 'web/src'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const list = out.split('\n').filter(Boolean).map((f) => f.replace(/^web\//, ''));
    if (list.length) return list;
  } catch { /* no git, no main, or nothing between them */ }
  return null;
}

group('no page is still drawn in the older vocabulary');
{
  // The palette that predates Divan is the same table under other names
  // (`C` in `lib/theme.ts`), so a page built out of it follows both themes and
  // no colour check can see it. What is visible is the *shape*: `Btn` is not
  // `Button`, `R.card` is 12 where a Divan card is 16, and a page made of them
  // is a page from before the frames. So this is the one criterion that is
  // answered by what a screen is written with rather than by what it paints.
  const OLD = ['Btn', 'Chip', 'Dot', 'Label', 'Segment', 'Radio', 'Empty'];
  const pages = [];
  for (const e of readdirSync(join(web, 'src/screens'), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.tsx')) pages.push(`src/screens/${e.name}`);
  }
  pages.push('src/components/Palette.tsx', 'src/App.tsx');

  const speaking = [];
  for (const f of pages) {
    const text = src(f);
    const kit = /import\s*\{([^}]*)\}\s*from\s*'[^']*ui\/kit'/.exec(text)?.[1] ?? '';
    const took = kit.split(',').map((n) => n.trim()).filter((n) => OLD.includes(n));
    const palette = [...new Set([...text.matchAll(/\b([CR])\.[a-zA-Z0-9]+/g)].map((m) => m[1]))];
    if (took.length || palette.length) speaking.push(`${f}: ${[...took, ...palette].join(', ')}`);
  }
  ok('every page of the panel is built out of the design system and nothing older',
    speaking.length === 0, speaking.join('\n    '));
  ok('…and there were enough pages for that to mean something',
    pages.length >= 20, `${pages.length} pages`);
  // The two that still hold the older set are the reason it is still there:
  // the chat is not being rebuilt, and the icon vocabulary is shared.
  ok('…while the chat, which is not being rebuilt, still speaks it',
    /\bC\./.test(src('src/components/ChatView.tsx')));
}

group('every carried screen asks its computer for exactly what it did');
{
  // A carry is a change of language, not of behaviour, and the half of that
  // which a render cannot see is the half that leaves this browser: which
  // requests a screen makes, and which events it drives with. Both are read
  // off the source and held to `main` — a screen that quietly dropped a
  // handler or gained a call would show up here as a difference.
  const REQUEST = /'((?:screen|chat|ustabasi|host|divan|account|agent|tool|approval|group|limits|update|daemon)\.[a-z_.]+)'/g;
  const DRIVE = /\bon(MouseDown|MouseUp|MouseMove|MouseEnter|MouseLeave|Wheel|ContextMenu|DoubleClick|KeyDown|DragStart|DragEnd|DragOver|DragLeave|Drop|Click|Change|Blur|Paste|Load|Error)\s*[=:]/g;
  const surface = (text) => JSON.stringify([
    [...new Set([...text.matchAll(REQUEST)].map((m) => m[1]))].sort(),
    [...new Set([...text.matchAll(DRIVE)].map((m) => m[1]))].sort(),
  ]);
  /** The one difference that is on purpose, with the reason. The frames draw
   *  no hovered state at all — a card says what it is with its ring — so the
   *  wall's tiles stopped lighting up under the pointer when they became
   *  `Card`s. Nothing a person can do changed; a colour that appeared under
   *  the mouse did not. */
  const ON_PURPOSE = { 'src/screens/Ustabasi.tsx': ['MouseEnter', 'MouseLeave'] };
  const allow = (f, before) => {
    const [reqs, drives] = JSON.parse(before);
    const dropped = ON_PURPOSE[f] ?? [];
    return JSON.stringify([reqs, drives.filter((d) => !dropped.includes(d))]);
  };
  const CARRIED = carried();
  let was = null;
  try {
    const git = (args) => execFileSync('git', args,
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const base = git(['merge-base', 'main', 'HEAD']).trim();
    was = CARRIED.map((f) => git(['show', `${base}:web/${f}`]));
  } catch { /* no git, no main, or a file this branch added has no `before` */ }
  if (was === null) console.log('  · no git to read the merge base from: nothing to compare against');
  else {
    const changed = CARRIED
      .map((f, i) => [f, allow(f, surface(was[i])), surface(src(f))])
      .filter(([, before, after]) => before !== after);
    ok('none of them gained a request, lost one, or dropped an event it drove with',
      changed.length === 0,
      changed.map(([f, before, after]) => `${f}:\n      was ${before}\n      now ${after}`).join('\n    '));
    ok('…over every file under src this branch touched, which git named rather than a list',
      // However many that is: a branch that touches two files is compared on
      // two. What is held is that each was read from `main` and was a real file.
      CARRIED.length > 0 && was.every((t) => t.length > 200), CARRIED.join(', '));
  }
}

group('nothing on a screen is standing in for something');
{
  // Read off the rendered markup, over every tree in this file except the
  // chat, which is not being rebuilt. A dash counts wherever it ends a run of
  // text, not only where it is the whole of one, so `up —` is caught as well
  // as `—`. The one exemption is a button whose whole label is a glyph.
  const CHAT = /Chat|Sidebar|FieldSheet|Lightbox|Approval|Timeline|Bubble|NewChat/;
  const HOLDING = [
    [/\blorem\b|\bipsum\b/i, 'lorem ipsum'],
    [/\bTODO\b|\bTBD\b|\bFIXME\b/, 'a note to the author'],
    [/coming soon|not implemented|under construction/i, 'a promise'],
    [/\bfoo\b|\bbar\b|\bbaz\b/i, 'a stand-in name'],
    [/[—–]\s*</, 'a dash where a value goes'],
    [/>\s*(?:\.\.\.|…)\s*</, 'an ellipsis where a value goes'],
  ];

  /** A button that is one glyph and nothing else: the minimise and close marks
   *  at the end of a panel's head. Anything else a button holds is words on a
   *  screen — most rows on these pages are buttons, because most rows go
   *  somewhere — so only this shape is dropped, and the inner match cannot
   *  cross another `<button`. The em dash is deliberately not in the set: no
   *  control on these screens is labelled with one, so exempting it would only
   *  ever hide a missing value. */
  const GLYPH = /^(?:[–×✓✕]|&times;|&#\d+;)$/;
  const BUTTON = /<button\b[^>]*>((?:(?!<\/?button)[\s\S])*)<\/button>/g;

  /** The words, with the tags out of the way. An opening tag becomes `<>`, not
   *  `><`: the latter puts a `<` in front of an element's own text, and every
   *  value on these screens is the sole child of a tag. */
  const standingIn = (markup) => {
    const words = markup
      .replace(BUTTON, (whole, inner) => (
        GLYPH.test(inner.replace(/<[^>]*>/g, '').trim()) ? ' ' : whole))
      .replace(/<[a-zA-Z][^>]*>/g, '<>');
    return HOLDING.filter(([re]) => re.test(words)).map(([, what]) => what);
  };

  const DASH = 'a dash where a value goes';
  ok('a value that is only a dash is reported',
    standingIn(renderToStaticMarkup(createElement(parts.Cell, { text: '—' }))).includes(DASH));
  ok('…inside a row that goes somewhere, which is most rows on these pages',
    standingIn(renderToStaticMarkup(createElement(parts.Table, {
      columns: [{ label: 'chat', width: '1fr' }, { label: 'cost', width: '80px' }],
      rows: [{ key: 'r', onClick() {}, cells: [
        createElement(parts.NameCell, { title: 'Webhook retry policy' }),
        createElement(parts.Cell, { text: '—' }),
      ] }],
    }))).includes(DASH));
  ok('…and where the dash ends a line rather than being the whole of it',
    standingIn(renderToStaticMarkup(createElement(parts.Cell, { text: 'up —' }))).includes(DASH));
  ok('…while the glyph a panel is put away with is not a missing value',
    standingIn(renderToStaticMarkup(createElement(parts.PanelHead, {
      title: 'Coder', onMinimise() {}, onClose() {},
    }))).length === 0);

  const found = [];
  let read = 0;
  for (const [where, markup] of Object.entries(drawn)) {
    if (CHAT.test(where)) continue;
    read++;
    for (const what of standingIn(markup)) found.push(`${where}: ${what}`);
  }
  ok('no screen, panel or part draws a placeholder where a value belongs',
    found.length === 0, [...new Set(found)].slice(0, 10).join('\n    '));
  ok('…over every tree drawn in this file that is not the chat',
    read >= 70, `${read} trees`);
}

// ── the gallery, written out ────────────────────────────────────────────────
// Something to hold up against the frames: both themes, every part, no daemon.

writeFileSync(join(out, 'gallery.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<title>Divan · the desktop parts</title><style>'
  + 'html,body{margin:0;font-family:-apple-system,"SF Pro Text",system-ui,sans-serif}'
  + '</style></head><body>'
  + renderToStaticMarkup(createElement(gallery.GalleryPage))
  + '</body></html>');

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
