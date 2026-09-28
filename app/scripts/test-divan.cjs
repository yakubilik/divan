/** The Divan design system, checked without a phone.
 *
 *  The palette is the part of a design that is easiest to agree on and easiest
 *  to lose: one screen reaches for a grey that is nearly right, then the next
 *  one copies it, and a month later nobody can say which of the two the
 *  artboard drew. So the sixteen values are checked against the block the
 *  frames declare — quoted here verbatim, with the frame named — and the whole
 *  app palette is checked to contain nothing that is not one of them.
 *
 *  The frames themselves are deliberately not in this repository (they are
 *  private and this repository is public), which is exactly why the values have
 *  to be written down somewhere a check can reach. `design/divan/TOKENS.md`
 *  says the same thing in prose; this file is the copy that fails a build.
 *
 *  The parts are checked twice. Once by reading them — is there a part at all,
 *  does the gallery draw it, is it reachable only in a development build. And
 *  once by standing them up: `render-divan.cjs` renders every one of them in
 *  both themes out of the app's own React, with React Native stubbed down to a
 *  style you can read, so that "every colour a new screen uses comes from the
 *  table" is answered by what came out rather than by what was written.
 *
 *  Run: node scripts/test-divan.cjs  (also folded into test-ustabasi.cjs, so
 *  one command covers both.)
 */
const { transform } = require('sucrase');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function load(file, exports) {
  const js = transform(src(file), { transforms: ['typescript', 'imports'] }).code;
  const out = path.join(os.tmpdir(), 'rac-' + path.basename(file).replace(/\W/g, '-') + '.cjs');
  fs.writeFileSync(out, js + `\nmodule.exports={${exports.join(',')}};`);
  delete require.cache[out];
  return require(out);
}

const K = load('src/tokens.ts', ['DARK', 'LIGHT', 'light', 'dark', 'tokensFor', 'monogram', 'MONOGRAM',
                                 'EXECUTORS', 'STATE_MARK', 'STATE_TONE', 'toneColours', 'stateColour',
                                 'shadows', 'scrim', 'veil', 'RADIUS', 'SIZE', 'ON_COLOUR']);

// ── the artboards, quoted ───────────────────────────────────────────────────
// The `style` attribute that opens every dark phone in design/divan/frames —
// thirteen of them declare it character for character, starting with
// Mobile1 V1 "Overview, top: counters and what needs you · dark".
const FRAME_DARK =
  '--bg:#131210;--s1:#1C1B18;--s2:#26241F;--line:rgba(236,232,225,.08);--line2:rgba(236,232,225,.2);' +
  '--ink:#EDE9E2;--ink2:#A9A499;--ink3:#8C877E;--amber:#EAB65A;--amberBg:rgba(234,182,90,.11);' +
  '--red:#EE6D55;--redBg:rgba(238,109,85,.12);--run:#7CC6A6;--runBg:rgba(124,198,166,.1);' +
  '--onAmber:#1A1609;--sh:rgba(0,0,0,.5)';
// …and the six light ones, from Mobile1 V3 "Overview: nothing needs you ·
// light, 07:31".
const FRAME_LIGHT =
  '--bg:#F5F3EE;--s1:#FFFFFF;--s2:#ECE9E2;--line:rgba(27,26,23,.09);--line2:rgba(27,26,23,.18);' +
  '--ink:#1B1A17;--ink2:#5C5850;--ink3:#7A756C;--amber:#9C6210;--amberBg:rgba(214,150,40,.14);' +
  '--red:#C2412B;--redBg:rgba(194,65,43,.1);--run:#2F8067;--runBg:rgba(47,128,103,.1);' +
  '--onAmber:#fff;--sh:rgba(27,26,23,.12)';

/** `--bg:#131210;--s1:…` -> `{ bg: '#131210', s1: … }`, with `#fff` spelled
 *  out: CSS's shorthand and the app's six digits are the same colour. */
function declared(block) {
  const out = {};
  for (const pair of block.split(';')) {
    const [name, value] = pair.split(':');
    out[name.replace(/^--/, '')] = value.length === 4 && value[0] === '#'
      ? ('#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3]).toUpperCase()
      : value;
  }
  return out;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => Object.keys(o).sort();
/** Every colour written out in a piece of source: a hex, an rgb/rgba, or one
 *  of the CSS colour spaces the frames use and React Native cannot read. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;
const colours = (text) => text.match(COLOUR) ?? [];
/** …minus the ones inside a comment, which is where the frames are quoted. */
function coloursInCode(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return colours(bare);
}

const checks = [];

// 1 · the palette is the design's, and the design's is all of it ────────────
for (const [name, table, block] of [['dark', K.DARK, FRAME_DARK], ['light', K.LIGHT, FRAME_LIGHT]]) {
  const frame = declared(block);
  const missing = Object.keys(frame).filter((k) => table[k] === undefined);
  const wrong = Object.keys(frame).filter((k) => table[k] !== undefined
    && table[k].toUpperCase() !== frame[k].toUpperCase());
  checks.push([`every name the ${name} frames declare is in the table`, missing.length === 0]);
  checks.push([`…with the frame's own value (${wrong.length ? wrong.join(', ') : 'all sixteen'})`, wrong.length === 0]);
}
checks.push(['the two sides declare the same names — none without its counterpart',
  eq(keys(K.DARK), keys(K.LIGHT))]);
checks.push(['…and every one of them is a colour, not a name or an empty string',
  keys(K.DARK).filter((k) => k !== 'scheme').every((k) =>
    [K.DARK[k], K.LIGHT[k]].every((v) => typeof v === 'string' && colours(v).length === 1))]);
checks.push(['the two lifted surfaces are the pair Mobile3 and Mobile11 draw a held card in',
  K.DARK.sLift === '#2A2822' && K.LIGHT.sLift === '#E9E6DE']);
checks.push(['the amber ring is the amber, at the weight Mobile1 V1 draws it',
  K.DARK.amberRing === 'rgba(234,182,90,.28)' && K.LIGHT.amberRing === 'rgba(156,98,16,.35)']);
checks.push(['the two tables are told apart by their own name', K.DARK.scheme === 'dark' && K.LIGHT.scheme === 'light']);
checks.push(['…and that is the name `tokensFor` answers to',
  K.tokensFor('dark') === K.DARK && K.tokensFor('light') === K.LIGHT]);

// 2 · nothing else is a colour ──────────────────────────────────────────────
// The whole point of one table is that no second one can appear beside it.
// `theme.ts` is now the hook and the fonts; the parts and the gallery are drawn
// out of the table. None of the three may spell a colour out.
const DERIVED = new Set([K.scrim(K.DARK), K.scrim(K.LIGHT), K.veil(K.DARK), K.veil(K.LIGHT)]);
const TOKEN_VALUES = new Set([...Object.values(K.DARK), ...Object.values(K.LIGHT),
                              K.ON_COLOUR, ...K.MONOGRAM,
                              ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean)]);
for (const file of ['src/theme.ts', 'src/components/divan.tsx', 'app/divan-gallery.tsx']) {
  const found = coloursInCode(src(file));
  checks.push([`${file} spells no colour of its own${found.length ? ` (${[...new Set(found)].join(', ')})` : ''}`,
    found.length === 0]);
}
{
  // tokens.ts may, of course — but only the values the frames declare, the two
  // derived ones that say so in place, and the marks converted out of oklch.
  const extra = [...new Set(coloursInCode(src('src/tokens.ts')))]
    .filter((v) => !TOKEN_VALUES.has(v) && !DERIVED.has(v)
      && v !== '#6F7BBC' && v !== '#92A0E3');   // the dashed Coder, Mobile3
  checks.push([`tokens.ts holds nothing but the design's own values${extra.length ? ` (${extra.join(', ')})` : ''}`,
    extra.length === 0]);
}
checks.push(['no colour anywhere is written in a space React Native cannot read',
  ['src/tokens.ts', 'src/theme.ts', 'src/components/divan.tsx', 'app/divan-gallery.tsx']
    .every((f) => !/oklch\(|hsla?\(|color\(/.test(coloursInCode(src(f)).join(' ')))]);

// 3 · the app's own palette is made of nothing else ─────────────────────────
// Every screen in the app, new and old, reads `useColors()`. Each side of it
// has to resolve to a value from that side's table — that is what "the palette
// was replaced" means, rather than "a second palette was added".
for (const [name, pal, tok] of [['dark', K.dark, K.DARK], ['light', K.light, K.LIGHT]]) {
  const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok)]);
  const flat = Object.entries(pal).filter(([k]) => k !== 'scheme' && k !== 'shadow');
  const stray = flat.filter(([, v]) => !own.has(v)).map(([k]) => k);
  checks.push([`every colour of the ${name} palette comes from the ${name} tokens${stray.length ? ` (${stray.join(', ')})` : ''}`,
    stray.length === 0]);
  const sh = Object.values(pal.shadow);
  checks.push([`…and every ${name} shadow is built out of them too`,
    sh.length > 0 && sh.every((s) => colours(s).every((c) => own.has(c)))]);
  checks.push([`…and the ${name} shadows are the three the frames draw`,
    new Set(sh).size === 3 && new Set(sh).size === new Set(Object.values(K.shadows(tok))).size]);
}
checks.push(['the palette has a value for every role it declares, on both sides',
  eq(keys(K.light), keys(K.dark))
  && keys(K.light).every((k) => K.light[k] != null && K.dark[k] != null)]);
checks.push(['the roles the frames collapse are collapsed on purpose, not by accident',
  K.light.muted === K.light.faint && K.dark.muted === K.dark.faint
  && K.light.muted === K.LIGHT.ink3 && K.dark.muted === K.DARK.ink3]);
checks.push(['a card is the frames’ first surface and a quiet fill its second',
  K.light.card === K.LIGHT.s1 && K.light.fill === K.LIGHT.s2
  && K.dark.card === K.DARK.s1 && K.dark.fill === K.DARK.s2]);
checks.push(['the accent is the design’s red, in both themes',
  K.light.accent === K.LIGHT.red && K.dark.accent === K.DARK.red]);

// 4 · the marks ─────────────────────────────────────────────────────────────
checks.push(['a project keeps its colour for as long as it keeps its name',
  K.monogram('Quire') === K.monogram('Quire')]);
checks.push(['…and a screen holding the whole list gives no two projects the same hue',
  new Set([0, 1, 2, 3, 4].map((i) => K.monogram('x', i))).size === 5]);
checks.push(['a place past the end of the ramp comes back round rather than off it',
  K.monogram('x', 5) === K.monogram('x', 0) && K.MONOGRAM.includes(K.monogram('x', -1))]);
checks.push(['every colour a monogram can take is in the ramp',
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].every((n) => K.MONOGRAM.includes(K.monogram(n)))]);
checks.push(['a project with no name still gets one rather than nothing',
  typeof K.monogram('') === 'string' && K.MONOGRAM.includes(K.monogram(''))]);
checks.push(['the seven executors of Mobile11 are all there',
  eq(keys(K.EXECUTORS), ['analyst', 'coder', 'divan', 'research', 'seo', 'unassigned', 'you'])]);
checks.push(['a Coder is `</>` and a ticket nobody has taken is the same mark, unfilled',
  K.EXECUTORS.coder.mark === '</>' && K.EXECUTORS.unassigned.mark === '</>'
  && K.EXECUTORS.coder.dashed === false && K.EXECUTORS.unassigned.dashed === true]);
checks.push(['the two who are not machines are circles',
  K.EXECUTORS.you.round && K.EXECUTORS.divan.round && !K.EXECUTORS.coder.round]);
checks.push(['…and they take the page’s own tones rather than a colour of their own',
  K.EXECUTORS.you.fill === null && K.EXECUTORS.divan.fill === null]);
checks.push(['every executor says what it is, in the words the frames use',
  Object.values(K.EXECUTORS).every((e) => typeof e.kind === 'string' && e.kind.length > 0)]);

// 5 · a state is never carried by colour alone ──────────────────────────────
checks.push(['every state has a character as well as a colour',
  keys(K.STATE_MARK).length === 6 && eq(keys(K.STATE_MARK), keys(K.STATE_TONE))]);
checks.push(['…and the characters are the ones the frames draw',
  K.STATE_MARK.stuck === '■' && K.STATE_MARK.asking === '?' && K.STATE_MARK.running === '●'
  && K.STATE_MARK.done === '✓' && K.STATE_MARK.yours === '○']);
checks.push(['stuck is red, asking is amber and running is green, in both themes',
  ['dark', 'light'].every((s) => {
    const t = K.tokensFor(s);
    return K.stateColour(t, 'stuck') === t.red && K.stateColour(t, 'asking') === t.amber
      && K.stateColour(t, 'running') === t.run;
  })]);
checks.push(['a tone answers with both a colour and the wash behind it',
  ['red', 'amber', 'run', 'ink2', 'ink3'].every((tone) => {
    const c = K.toneColours(K.DARK, tone);
    return typeof c.fg === 'string' && typeof c.bg === 'string' && c.fg !== c.bg;
  })]);

// 6 · the parts, and the one room they can all be seen in ───────────────────
const PARTS = ['Card', 'ListRow', 'Pill', 'TabBar', 'ColumnTabs', 'StatusDot', 'ExecutorBadge',
               'Counter', 'SectionHeader', 'EmptyState', 'Sheet'];
const divan = src('src/components/divan.tsx');
const gallery = src('app/divan-gallery.tsx');
for (const part of PARTS) {
  checks.push([`${part} is a part rather than something a screen has to invent`,
    new RegExp(`export function ${part}\\(`).test(divan)]);
}
checks.push(['the gallery draws every one of them',
  PARTS.every((p) => new RegExp(`<${p}[\\s/>]`).test(gallery))]);
checks.push(['…and names the frame each was measured off, so the comparison is possible',
  (gallery.match(/frame="[^"]+"/g) ?? []).length >= PARTS.length]);
checks.push(['every part reads the tokens rather than being handed a colour',
  (divan.match(/useTokens\(\)/g) ?? []).length >= PARTS.length]);
checks.push(['the parts sit on the design’s own corners, not on numbers of their own',
  /borderRadius: RADIUS\./.test(divan) && K.RADIUS.card === 16 && K.RADIUS.pill === 999]);
checks.push(['…and on its own heights',
  /SIZE\.tabBar/.test(divan) && K.SIZE.tabBar === 84 && K.SIZE.columnTab === 46 && K.SIZE.pill === 34]);

// The gallery is a room for a design review, not a screen of the app.
checks.push(['the gallery is reachable in a development build and nowhere else',
  /if \(!__DEV__\) return <Redirect/.test(gallery)]);
checks.push(['…and nothing links to it outside one',
  /\{__DEV__ && \(/.test(src('app/settings.tsx')) && /\/divan-gallery/.test(src('app/settings.tsx'))]);
checks.push(['the only screen that may ask for a theme is the gallery',
  /ForceScheme/.test(gallery)
  && !['app/chats.tsx', 'app/index.tsx', 'app/settings.tsx', 'app/ustabasi.tsx', 'src/components/chat.tsx']
       .some((f) => /ForceScheme/.test(src(f)))]);

// 7 · the chat screens are left alone ───────────────────────────────────────
// Yakup likes them. They follow the new palette because everything does, but
// nothing in them was restyled, and the parts above are not for them.
for (const f of ['src/components/chat.tsx', 'app/chat/[id].tsx', 'src/components/media.tsx']) {
  checks.push([`${f} was not rebuilt out of the new parts`, !/components\/divan/.test(src(f))]);
}
// A colour an element brings with it — white on a photo, black behind a video —
// does not follow the page and never came from the palette.
const OWN_BACKGROUND = /^(#fff(fff)?|#000(000)?|rgba?\(255,\s*255,\s*255[^)]*\)|rgba?\(0,\s*0,\s*0[^)]*\))$/i;
checks.push(['…and they still take every colour that follows the page from the palette',
  ['src/components/chat.tsx', 'app/chat/[id].tsx'].every((f) => /useColors\(\)/.test(src(f))
    && coloursInCode(src(f)).every((c) => OWN_BACKGROUND.test(c)))]);

// 8 · the palette that was replaced is gone ─────────────────────────────────
// The surest sign a palette was added rather than replaced is the old one
// surviving in a corner: a shadow written by hand, a fallback nobody reads. So
// the values that were only ever the previous palette's are looked for
// everywhere, and there is nowhere for them to be.
const REPLACED = [
  '#FBFAF8', '#F1F0EB', '#ECEAE3', '#DEDBD2', '#EDEBE4', '#3C3A33', '#6A685F', '#9C9A8F', '#FAF9F6',
  '#B5852B', '#F7EFDB', '#3F7A52', '#E7F1EA', '#B14A33', '#F8E3DB', '#E6E4DD',
  '#100F0A', '#17160F', '#1E1C15', '#1A1811', '#2D2B21', '#3F3C30', '#2A2722', '#F2F0E8', '#D2CFC5',
  '#9E9C90', '#706E63', '#1C1B13', '#D9A84A', '#2F2915', '#6FAE82', '#1F2D23', '#E0735A', '#311E16',
  '#FF5A48', '#FF373D', '#FFE4DD', '#FF8B72', '#3A241C', 'rgba(28,27,22,', 'rgba(181,133,43,',
];
{
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.gen.ts')) files.push(rel);
    }
  };
  walk('src'); walk('app');
  const left = [];
  for (const f of files) {
    const text = src(f);
    for (const v of REPLACED) if (text.includes(v)) left.push(`${f}: ${v}`);
  }
  checks.push([`no screen still writes a value from the palette that was replaced${left.length ? ` (${left.join(', ')})` : ''}`,
    left.length === 0]);
  checks.push(['…and the whole app was read to say so', files.length > 30]);
}

// 9 · the parts, stood up ───────────────────────────────────────────────────
// Reading a component tells you it asks the table for its colours; it does not
// tell you which ones came out. So each part is rendered, in both themes, and
// the styles are read back off it.
const R = require('./render-divan.cjs');
const h = R.React.createElement;

/** One of each, in the states the frames draw. A part that needs a parent to
 *  make sense gets one. */
const SPECIMENS = {
  Card: () => h(R.parts.Card, { ring: 'amber' }, h(R.parts.Pill, { label: 'Quire', dot: 'running' })),
  CardLifted: () => h(R.parts.Card, { lifted: true, ring: 'none', bar: 0.38 }),
  ListRow: () => h(R.parts.ListRow, { first: true, icon: 'monitor', title: 'Machines', note: '3 paired', meta: 'all reachable', tone: 'run' }),
  Pill: () => h(R.parts.Pill, { label: 'Follow Stripe', face: 'amber' }),
  PillOutline: () => h(R.parts.Pill, { label: 'Keep 3', face: 'outline' }),
  Button: () => h(R.parts.Button, { label: 'New ticket', icon: 'add', tall: true }),
  TabBar: () => h(R.parts.TabBar, { value: 'dashboard', onChange() {},
    tabs: [{ key: 'dashboard', label: 'Dashboard', icon: 'grid_view', badge: 2 },
           { key: 'chat', label: 'Chat', icon: 'chat_bubble' },
           { key: 'machine', label: 'Machine', icon: 'dns' }] }),
  ColumnTabs: () => h(R.parts.ColumnTabs, { value: 'progress', dragging: true, target: 'queued',
    columns: [{ key: 'icebox', label: 'Ice Box', count: 11 }, { key: 'queued', label: 'Queued', count: 4 },
              { key: 'progress', label: 'In Progress', count: 3 }, { key: 'done', label: 'Done', count: 48 }] }),
  StatusDot: () => h(R.parts.StatusDot, { state: 'stuck' }),
  StateMark: () => h(R.parts.StateMark, { state: 'asking' }),
  ExecutorBadge: () => h(R.parts.ExecutorBadge, { executor: 'coder' }),
  ExecutorPending: () => h(R.parts.ExecutorBadge, { executor: 'unassigned' }),
  ExecutorYou: () => h(R.parts.ExecutorBadge, { executor: 'you' }),
  Monogram: () => h(R.parts.Monogram, { name: 'Quire', index: 0 }),
  CounterHot: () => h(R.parts.Counter, { value: 2, label: 'Needs you', tone: 'amber' }),
  CounterZero: () => h(R.parts.Counter, { value: 0, label: 'Needs you', tone: 'amber' }),
  SectionHeader: () => h(R.parts.SectionHeader, { title: 'Needs you', count: 2 }),
  SectionMark: () => h(R.parts.SectionHeader, { kind: 'mark', tone: 'red', title: '\u25a0 stuck', count: 1 }),
  EmptyState: () => h(R.parts.EmptyState, { title: 'A new board.', body: 'Write the first ticket.', foot: 'Nothing starts until you move one.' }),
  Sheet: () => h(R.parts.Sheet, { title: 'Machine', note: 'Infrastructure.', onClose() {} },
    h(R.parts.ListRow, { first: true, title: 'Machines' })),
};

/** A shadow is a string of colours; count each of them. */
const paintOf = (markup) => {
  const out = new Set();
  for (const v of R.paint(markup)) {
    const inside = v.match(COLOUR);
    if (inside && (inside.length > 1 || inside[0] !== v)) inside.forEach((c) => out.add(c));
    else out.add(v);
  }
  return out;
};

const drawn = {};
for (const scheme of ['dark', 'light']) {
  const tok = K.tokensFor(scheme);
  const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR,
                       ...K.MONOGRAM, '#6F7BBC', '#92A0E3',
                       ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean)]);
  const strayed = [];
  let threw = null;
  for (const [name, make] of Object.entries(SPECIMENS)) {
    let markup;
    try { markup = R.render(scheme, make()); } catch (e) { threw = `${name}: ${e.message}`; break; }
    drawn[`${scheme}:${name}`] = markup;
    for (const c of paintOf(markup)) if (!own.has(c)) strayed.push(`${name}: ${c}`);
  }
  checks.push([`every part stands up in the ${scheme} theme${threw ? ` (${threw})` : ''}`, threw === null]);
  checks.push([`…and paints nothing that is not a ${scheme} token${strayed.length ? ` (${strayed.slice(0, 4).join(', ')})` : ''}`,
    strayed.length === 0]);
}

/** The flattened style of the nth element of a rendered part. */
const styleOf = (key, n = 0) => R.styles(drawn[key])[n];
const anyStyle = (key, pred) => R.styles(drawn[key]).some(pred);

checks.push(['a card is drawn on the frames\u2019 first surface, in both themes',
  styleOf('dark:Card').backgroundColor === K.DARK.s1 && styleOf('light:Card').backgroundColor === K.LIGHT.s1]);
checks.push(['…and a card being held is drawn on the lifted one',
  styleOf('dark:CardLifted').backgroundColor === K.DARK.sLift
  && styleOf('light:CardLifted').backgroundColor === K.LIGHT.sLift]);
checks.push(['a card that is asking wears the amber ring rather than the hairline',
  styleOf('dark:Card').borderColor === K.DARK.amberRing]);
checks.push(['the running rule across a card is green, and as wide as the work is done',
  anyStyle('dark:CardLifted', (s) => s.backgroundColor === K.DARK.run && s.width === '38%' && s.height === 2)]);
checks.push(['the tab bar stands 84 high over a hairline, as Mobile1 draws it',
  styleOf('dark:TabBar').height === K.SIZE.tabBar && styleOf('dark:TabBar').borderTopColor === K.DARK.line]);
checks.push(['…and the selected tab\u2019s glyph sits in a 60\u00d732 well of the second surface',
  anyStyle('dark:TabBar', (s) => s.width === 60 && s.height === 32 && s.backgroundColor === K.DARK.s2)]);
checks.push(['…and the badge over it is amber, ringed in the page colour',
  anyStyle('dark:TabBar', (s) => s.backgroundColor === K.DARK.amber && s.borderColor === K.DARK.bg)]);
checks.push(['a column tab is 46 high on the design\u2019s own corner',
  anyStyle('dark:ColumnTabs', (s) => s.height === K.SIZE.columnTab && s.borderRadius === K.RADIUS.tab)]);
checks.push(['the tab a card is being dropped on turns green, and only that one',
  R.styles(drawn['dark:ColumnTabs']).filter((s) => s.backgroundColor === K.DARK.runBg && s.borderColor === K.DARK.run).length === 1]);
checks.push(['…while the others show they would take it',
  R.styles(drawn['dark:ColumnTabs']).filter((s) => s.borderStyle === 'dashed').length === 2]);
checks.push(['a counter that has something to say is tinted and coloured',
  styleOf('dark:CounterHot').backgroundColor === K.DARK.amberBg
  && anyStyle('dark:CounterHot', (s) => s.color === K.DARK.amber)]);
checks.push(['…and one at zero drops both, which is the whole of the calm screen',
  styleOf('dark:CounterZero').backgroundColor === K.DARK.s1
  && !anyStyle('dark:CounterZero', (s) => s.color === K.DARK.amber)]);
checks.push(['a pill stands 34 high, filled or outlined',
  styleOf('dark:Pill').height === K.SIZE.pill && styleOf('dark:PillOutline').height === K.SIZE.pill
  && styleOf('dark:PillOutline').backgroundColor === 'transparent']);
checks.push(['the amber pill carries the one text colour the frames spell out',
  anyStyle('dark:Pill', (s) => s.color === K.DARK.onAmber)
  && anyStyle('light:Pill', (s) => s.color === K.LIGHT.onAmber)]);
checks.push(['a ticket nobody has taken has an outline where a Coder has a square',
  styleOf('dark:ExecutorPending').borderStyle === 'dashed'
  && styleOf('dark:ExecutorBadge').backgroundColor === K.EXECUTORS.coder.fill]);
checks.push(['you are drawn in the page\u2019s own ink, in either theme',
  styleOf('dark:ExecutorYou').backgroundColor === K.DARK.ink
  && styleOf('light:ExecutorYou').backgroundColor === K.LIGHT.ink]);
checks.push(['a section mark is set in the colour of the state it groups',
  anyStyle('dark:SectionMark', (s) => s.color === K.DARK.red)]);
checks.push(['an empty state is a sentence and not a mark in a circle',
  anyStyle('dark:EmptyState', (s) => s.fontSize === 24 && s.fontFamily === 'Inter-SemiBold')
  && !anyStyle('dark:EmptyState', (s) => s.borderRadius >= 30)]);
checks.push(['a sheet comes up in the page\u2019s colour, on the design\u2019s corner',
  anyStyle('dark:Sheet', (s) => s.backgroundColor === K.DARK.bg && s.borderTopLeftRadius === K.RADIUS.sheet)]);
checks.push(['…over a dim rather than over a shrunken page',
  anyStyle('dark:Sheet', (s) => s.backgroundColor === K.scrim(K.DARK))]);

// 10 · the screens that were already here ──────────────────────────────────
// They were not rebuilt, but the palette under them was replaced, so the parts
// they are made of are stood up too: nothing of theirs may paint a colour that
// is not in the new table, and the one place where two greys have to stay
// apart — the selected segment and the track it sits in — is looked at.
const OLD_PARTS = (tok) => ({
  Card: () => h(R.ui.Card, {}, h(R.ui.Row, { label: 'Accounts', value: 'two', onPress() {}, last: true })),
  Button: () => h(R.ui.Button, { title: 'Pair computer', onPress() {} }),
  ButtonOutline: () => h(R.ui.Button, { title: 'Later', kind: 'outline', onPress() {} }),
  SmallButton: () => h(R.ui.SmallButton, { title: 'Update now', onPress() {} }),
  Segmented: () => h(R.ui.Segmented, { options: ['a', 'b'], value: 'a', onChange() {} }),
  Tabs: () => h(R.ui.Tabs, { value: 0, onChange() {}, labels: ['Chats', 'Agents'] }),
  Toggle: () => h(R.ui.Toggle, { value: true, onChange() {} }),
  ToggleOff: () => h(R.ui.Toggle, { value: false, onChange() {} }),
  Radio: () => h(R.ui.Radio, { on: true }),
  Chip: () => h(R.ui.Chip, {}, 'opus'),
  NoteWarn: () => h(R.ui.Note, { tone: 'warn', icon: 'warning' }, 'Connecting'),
  NoteDanger: () => h(R.ui.Note, { tone: 'danger' }, 'It failed'),
  Empty: () => h(R.ui.EmptyState, { icon: 'chat_bubble', title: 'No chats yet', body: 'Tap the pen.' }),
  Label: () => h(R.ui.Label, {}, 'Computers'),
  Eyebrow: () => h(R.ui.Eyebrow, {}, 'STEP 1 OF 2'),
  LargeTitle: () => h(R.ui.LargeTitle, {}, 'Settings'),
  Dot: () => h(R.ui.Dot, { color: tok.run }),
  Rule: () => h(R.ui.Rule, {}),
});
const old = {};
for (const scheme of ['dark', 'light']) {
  const tok = K.tokensFor(scheme);
  const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR, '#fff', '#000']);
  const strayed = [];
  let threw = null;
  for (const [name, make] of Object.entries(OLD_PARTS(tok))) {
    let markup;
    try { markup = R.render(scheme, make()); } catch (e) { threw = `${name}: ${e.message}`; break; }
    old[`${scheme}:${name}`] = markup;
    for (const c of paintOf(markup)) if (!own.has(c)) strayed.push(`${name}: ${c}`);
  }
  checks.push([`the parts the older screens are made of still stand up in the ${scheme} theme${threw ? ` (${threw})` : ''}`,
    threw === null]);
  checks.push([`…and every colour they paint is one of the ${scheme} tokens${strayed.length ? ` (${strayed.slice(0, 4).join(', ')})` : ''}`,
    strayed.length === 0]);
  // A segmented control whose thumb is the colour of its track is a control
  // with nothing selected, which is the one way this substitution could have
  // gone quietly wrong.
  const seg = R.styles(old[`${scheme}:Segmented`]);
  checks.push([`…and the selected segment is still a different grey from its track in the ${scheme} theme`,
    seg.some((s) => s.backgroundColor === tok.s2) && seg.some((s) => s.backgroundColor === tok.s1)]);
  const on = R.styles(old[`${scheme}:Toggle`]).find((s) => s.width === 46);
  const off = R.styles(old[`${scheme}:ToggleOff`]).find((s) => s.width === 46);
  checks.push([`…and a switch still says which way it is thrown in the ${scheme} theme`,
    !!on && !!off && on.backgroundColor === tok.ink && off.backgroundColor === tok.line2]);
}

// The gallery itself: it is the room the design review happens in, so it has
// to come up.
{
  let markup = null, threw = null;
  try { markup = R.render(null, h(R.gallery.default)); } catch (e) { threw = e.message; }
  checks.push([`the gallery comes up${threw ? ` (${threw})` : ''}`, threw === null]);
  checks.push(['…with every part on it', markup !== null && R.styles(markup).length > 200]);
}

module.exports = { checks };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
