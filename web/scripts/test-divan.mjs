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

// ── the artboards, quoted ───────────────────────────────────────────────────
// Whole `style` attributes, copied off a named frame — not a value at a time,
// which would be the same transcription twice and could never disagree with
// itself. Web14's four dark frames declare the sixteen as one block, character
// for character; this is W6, 'Project · Quire · Overview tab'.
const FRAME_DARK =
  '--bg:#131210;--s1:#1C1B18;--s2:#26241F;--line:rgba(236,232,225,.08);--line2:rgba(236,232,225,.2);'
  + '--ink:#EDE9E2;--ink2:#A9A499;--ink3:#8C877E;--amber:#EAB65A;--amberBg:rgba(234,182,90,.11);'
  + '--red:#EE6D55;--redBg:rgba(238,109,85,.12);--run:#7CC6A6;--runBg:rgba(124,198,166,.1);'
  + '--onAmber:#1A1609;--sh:rgba(0,0,0,.5)';
// …and Web15's eight light ones, all of them the same block. This is W12,
// 'Machine drawer · Machines'.
const FRAME_LIGHT =
  '--bg:#F5F3EE;--s1:#FFFFFF;--s2:#ECE9E2;--line:rgba(27,26,23,.09);--line2:rgba(27,26,23,.18);'
  + '--ink:#1B1A17;--ink2:#5C5850;--ink3:#7A756C;--amber:#9C6210;--amberBg:rgba(214,150,40,.14);'
  + '--red:#C2412B;--redBg:rgba(194,65,43,.1);--run:#2F8067;--runBg:rgba(47,128,103,.1);'
  + '--onAmber:#fff;--sh:rgba(27,26,23,.12)';
// The fourteen-name block of Web12 W1, which is the same design a hundredth
// heavier in four places — the difference `design/divan/TOKENS.md` records.
const FRAME_W1 =
  '--bg:#131210;--s1:#1C1B18;--s2:#26241F;--line:rgba(236,232,225,.08);--line2:rgba(236,232,225,.22);'
  + '--ink:#EDE9E2;--ink2:#A9A499;--ink3:#8C877E;--amber:#EAB65A;--amberBg:rgba(234,182,90,.12);'
  + '--red:#EE6D55;--redBg:rgba(238,109,85,.13);--run:#7CC6A6;--runBg:rgba(124,198,166,.12)';
/** The amber ring, which is not one of the sixteen: it is a `box-shadow` on the
 *  panel of an agent that is asking. Both frames are quoted whole. */
const RING_DARK = 'inset 0 0 0 1px rgba(234,182,90,.3)';        // Web12 W1 and W2
const RING_LIGHT = 'inset 0 0 0 1px rgba(156,98,16,.35)';       // Web13 W3 and W4
/** And the two surfaces `sLift` is borrowed from, which are phone frames: the
 *  desktop draws nothing in the air. */
const PHONE_DRAG_S2 = '#2A2822';                                // Mobile3 Drag frame
const PHONE_CHAT_S2 = '#E9E6DE';                                // Mobile4 C1

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

/** `--bg:#131210;--s1:…` -> `{ bg: '#131210', … }`, with `#fff` spelled out. */
function declared(block) {
  const out = {};
  for (const pair of block.split(';')) {
    const [name, value] = pair.split(':');
    out[name.replace(/^--/, '')] = value.length === 4 && value[0] === '#'
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase()
      : value;
  }
  return out;
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;
const colours = (text) => text.match(COLOUR) ?? [];
/** …minus the ones inside a comment, which is where the frames are quoted. */
function coloursInCode(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return colours(bare);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => Object.keys(o).sort();

// ── 1 · the palette is the design's, and the design's is all of it ──────────

group('the palette is the artboards’');
{
  for (const [name, table, block] of [['dark', K.DARK, FRAME_DARK], ['light', K.LIGHT, FRAME_LIGHT]]) {
    const frame = declared(block);
    const missing = Object.keys(frame).filter((k) => table[k] === undefined);
    const wrong = Object.keys(frame).filter((k) => table[k] !== undefined
      && table[k].toUpperCase() !== frame[k].toUpperCase());
    ok(`every name the ${name} frames declare is in the table`, missing.length === 0, missing.join(', '));
    ok(`…with the frame's own value (${name})`, wrong.length === 0, wrong.join(', '));
    ok(`…all sixteen of them (${name})`, Object.keys(frame).length === 16);
  }
  ok('the two sides declare the same names — none without its counterpart',
    eq(keys(K.DARK), keys(K.LIGHT)));
  ok('…and every one of them is a colour, not a name or an empty string',
    keys(K.DARK).filter((k) => k !== 'scheme').every((k) =>
      [K.DARK[k], K.LIGHT[k]].every((v) => typeof v === 'string' && colours(v).length === 1)));
  ok('the tables are told apart by their own name and that is what `tokensFor` answers to',
    K.DARK.scheme === 'dark' && K.LIGHT.scheme === 'light'
    && K.tokensFor('dark') === K.DARK && K.tokensFor('light') === K.LIGHT);

  // Web12's own block is the same design at the last decimal, which is worth
  // holding onto: it is the frame the amber ring and the counters come off.
  const w1 = declared(FRAME_W1);
  const differs = Object.keys(w1).filter((k) => w1[k] !== K.DARK[k]);
  ok('Web12 W1 is a dark frame of this design, differing only in the last decimal of a wash or a line',
    eq(differs.sort(), ['amberBg', 'line2', 'redBg', 'runBg']), differs.join(', '));

  ok('the amber ring is the ring the desktop frames draw, in both themes',
    RING_DARK.includes(K.DARK.amberRing) && RING_LIGHT.includes(K.LIGHT.amberRing));
  ok('…and it is the amber and nothing else: that hue, thinned',
    [['dark', K.DARK], ['light', K.LIGHT]].every(([, t]) => {
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const ring = t.amberRing.match(/[\d.]+/g).slice(0, 3).map(Number);
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 60);
      return near(ring, rgb(t.amber)) || near(ring, t.amberBg.match(/[\d.]+/g).slice(0, 3).map(Number));
    }));
  ok('the surface of a card in the air is borrowed from the phone, and says so',
    K.DARK.sLift === PHONE_DRAG_S2 && K.LIGHT.sLift === PHONE_CHAT_S2
    && eq([...K.BORROWED], ['sLift']));
  ok('the dim behind a sheet is derived, and says so',
    K.DERIVED.includes('scrim')
    && K.DARK.scrim === K.DARK.sh && K.LIGHT.scrim !== K.LIGHT.sh);
  ok('the ticket nobody has taken keeps the artboard’s indigo in the dark',
    K.DARK.execLine === '#6F7BBC' && K.DARK.execInk === '#92A0E3');
  ok('…and on a light page takes the placeholder the desktop frames do draw',
    K.LIGHT.execLine === K.LIGHT.line2 && K.LIGHT.execInk === K.LIGHT.ink3
    && K.DERIVED.includes('execLine') && K.DERIVED.includes('execInk'));
  ok('…and the derived and the borrowed are those three and that one, and no more',
    eq([...K.DERIVED].sort(), ['execInk', 'execLine', 'scrim']) && K.BORROWED.length === 1);
}

// ── 2 · nothing else in the panel is a colour ──────────────────────────────

group('one table, and nothing beside it');
{
  const TOKEN_VALUES = new Set([
    ...Object.values(K.DARK), ...Object.values(K.LIGHT),
    K.ON_COLOUR, ...K.MONOGRAM,
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
    css.includes(`html,body{background:${K.T.bg};color:${K.T.ink}}`));

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
    ok('with nothing stored it follows the computer', m.themeScheme() === 'light' && m.themeChoice() === 'system');
    ok('…and says so on the document before anything is drawn', e.html.dataset.theme === 'light');
  }
  {
    const { m } = await fresh({ system: 'dark' });
    ok('…the other way too', m.themeScheme() === 'dark');
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
    ok('nonsense in storage is not a theme', m.themeChoice() === 'system' && e.html.dataset.theme === 'dark');
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
    const { e, m } = await fresh({ system: 'dark' });
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
  ok('…and the screen that offers it works with no computer paired',
    /section === 'appearance' && <AppearanceSection \/>/.test(src('src/screens/Preferences.tsx'))
    && /section !== 'hosts' && section !== 'appearance' && !slot/.test(src('src/screens/Preferences.tsx')));
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
    && K.RADIUS.card === 16 && K.RADIUS.pill === 16 && K.SIZE.pill === 32 && K.SIZE.sidePanel === 260);
}

/** Every style attribute of a render, flattened. */
function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].split(';')) {
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
    for (const pair of (/style="([^"]*)"/.exec(attrs)?.[1] ?? '').split(';')) {
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
const OWN = new Set([K.ON_COLOUR, ...K.MONOGRAM, ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
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
    anyStyle(drawn.Row, (s) => s.width === '32px' && s['border-radius'] === '9px' && s.background === v('s2'))
    && anyStyle(drawn.Row, (s) => s['border-top'] === `1px solid ${v('line')}`));
  ok('…and the row that wants a person is washed in its state',
    anyStyle(drawn.Row, (s) => s.background === v('amberBg')));
  ok('a pill stands 32 high on a 16 corner, filled or outlined',
    anyStyle(drawn.Pill, (s) => s.height === '32px' && s['border-radius'] === '16px')
    && anyStyle(drawn.PillAnswers, (s) => s['box-shadow'] === `inset 0 0 0 1px ${v('line2')}`
      && s.background === 'transparent'));
  ok('the selected chip is filled with the ink and labelled in the page colour',
    anyStyle(drawn.Pill, (s) => s.background === v('ink') && s.color === v('bg')));
  ok('the amber answer carries the one text colour the frames spell out',
    anyStyle(drawn.PillAnswers, (s) => s.background === v('amber') && s.color === v('onAmber')));
  ok('a tab strip is a well with a card in it',
    styles(drawn.Tabs)[0].background === v('s1')
    && countStyles(drawn.Tabs, (s) => s.background === v('s2') && s['border-radius'] === '9px') === 1);
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
  ok('no two projects on one screen share a hue',
    new Set(styles(drawn.Monogram).map((s) => s.background).filter(Boolean)).size === 4);
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
    && !anyStyle(drawn.EmptyState, (s) => parseFloat(s['border-radius'] ?? '0') >= 30));
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
  const screens = {
    Fleet: ['src/screens/Fleet.js', 'Fleet', { onOpenChat() {}, onNewChat() {} }],
    Projects: ['src/screens/Projects.js', 'Projects', { onNewChatIn() {}, onOpenChat() {} }],
    Agents: ['src/screens/Agents.js', 'Agents', { onStartChat() {} }],
    Terminal: ['src/screens/Terminal.js', 'Terminal', { onPeek() {}, onNewChat() {} }],
    Screen: ['src/screens/Screen.js', 'Screen', {}],
    Update: ['src/screens/Update.js', 'Update', {}],
    Preferences: ['src/screens/Preferences.js', 'Preferences', {}],
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

  for (const [world, state] of [['alone', nothing], ['paired', paired]]) {
    seed(state);
    for (const [name, [path, exp, props]] of Object.entries(screens)) {
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
  ok('every screen still stands up, paired and alone', broken.length === 0, broken.join('\n    '));
  ok('…and none of them paints a value of its own', strayed.length === 0, strayed.join(', '));
  ok('…so every colour on every screen exists in both themes', undeclared.length === 0, undeclared.join(', '));
  ok('the wall draws its tiles, which is the only place the phase colours are',
    ['needs approval', 'working', 'done'].some((w) => (drawn['screen:Terminal paired'] ?? '').includes(w))
    && (drawn['screen:Terminal paired'] ?? '').includes('Invoice PDF'),
    (drawn['screen:Terminal paired'] ?? '').length.toString());
  ok('…and a paired screen is a fuller screen than an empty one',
    (drawn['screen:Preferences paired'] ?? '').length > (drawn['screen:Preferences alone'] ?? '').length * 1.5,
    `${(drawn['screen:Preferences paired'] ?? '').length} vs ${(drawn['screen:Preferences alone'] ?? '').length}`);
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
    (drawn['screen:Preferences paired'] ?? '').includes('&lt;&gt;'));
}

group('white belongs on a filled colour and nowhere else');
{
  // The one pair a palette cannot make safe by itself: `onAccent` and
  // `onWarn` are the two "text on a filled colour" values, and on a neutral
  // surface they are invisible in one theme and merely odd in the other. This
  // is what a white send glyph on `surface2` looked like: legal in both
  // checks, 1.03:1 on a light page.
  const FILLED = new Set([K.T.red, K.T.amber, K.T.run, K.T.ink,
                          ...K.MONOGRAM, ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
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
  ok('the composer is still a textarea in a rounded field',
    /<textarea/.test(view) && /R\.composer/.test(view));
  ok('the transcript still scrolls under it', /overflowY: 'auto'/.test(view));
  ok('a bubble is still squared off on the corner that points at who said it',
    /borderRadius: `\$\{R\.bubble\}px \$\{R\.bubble\}px 4px/.test(src('src/components/Bubble.tsx')));
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
  ok('…and the one derived and the one borrowed value are recorded as such',
    K.DERIVED.every((n) => new RegExp(`\`${n}\``).test(doc))
    && K.BORROWED.every((n) => new RegExp(`\`${n}\``).test(doc)));
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
