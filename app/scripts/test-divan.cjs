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
                                 'shadows', 'scrim', 'veil', 'DERIVED', 'BORROWED', 'RADIUS', 'SIZE', 'ON_COLOUR']);

// ── the artboards, quoted ───────────────────────────────────────────────────
// The frames are not in this repository, so the only way a check can hold the
// table to them is to carry a transcription of one. These are whole `style`
// attributes, copied off a named frame — not a value at a time, which would be
// the same transcription twice and could never disagree with itself.
//
// Seventeen dark frames carry the sixteen names as one block, character for
// character. This is Mobile6 S3, "Waiting on you · everything that needs a
// human", which is the whole of that group and so the easiest one to find.
const FRAME_DARK =
  '--bg:#131210;--s1:#1C1B18;--s2:#26241F;--line:rgba(236,232,225,.08);--line2:rgba(236,232,225,.2);' +
  '--ink:#EDE9E2;--ink2:#A9A499;--ink3:#8C877E;--amber:#EAB65A;--amberBg:rgba(234,182,90,.11);' +
  '--red:#EE6D55;--redBg:rgba(238,109,85,.12);--run:#7CC6A6;--runBg:rgba(124,198,166,.1);' +
  '--onAmber:#1A1609;--sh:rgba(0,0,0,.5)';
// …and fourteen light ones. This is Mobile11 S16, "Machine drawer · findable,
// forgettable · light".
const FRAME_LIGHT =
  '--bg:#F5F3EE;--s1:#FFFFFF;--s2:#ECE9E2;--line:rgba(27,26,23,.09);--line2:rgba(27,26,23,.18);' +
  '--ink:#1B1A17;--ink2:#5C5850;--ink3:#7A756C;--amber:#9C6210;--amberBg:rgba(214,150,40,.14);' +
  '--red:#C2412B;--redBg:rgba(194,65,43,.1);--run:#2F8067;--runBg:rgba(47,128,103,.1);' +
  '--onAmber:#fff;--sh:rgba(27,26,23,.12)';
// The two frames `sLift` is read off, quoted the same way and for the same
// reason. Mobile3's drag frame is the only one in which a card is held in the
// air, and its `--s2` is that card; Mobile4 C1 is the light chat, whose `--s2` is the
// only raised light surface the design draws. Both blocks are fourteen names
// or fewer and differ from the majority — which is precisely what makes them
// worth quoting: `sLift` is the tone they differ *by*.
const FRAME_DRAG =
  '--bg:#131210;--s1:#1C1B18;--s2:#2A2822;--line:rgba(236,232,225,.08);--line2:rgba(236,232,225,.22);' +
  '--ink:#EDE9E2;--ink2:#A9A499;--ink3:#8C877E;--amber:#EAB65A;--amberBg:rgba(234,182,90,.12);' +
  '--red:#EE6D55;--redBg:rgba(238,109,85,.13);--run:#7CC6A6;--runBg:rgba(124,198,166,.13)';
const FRAME_CHAT =
  '--bg:#F5F3EE;--s1:#FFFFFF;--s2:#E9E6DE;--line:rgba(27,26,23,.09);--line2:rgba(27,26,23,.2);' +
  '--ink:#1B1A17;--ink2:#5C5850;--ink3:#7A756C;--run:#2F8067';

/** Every frame in the set, by the id the artboard labels it with: which group
 *  it belongs to, which theme it is drawn in, and how many of the sixteen names
 *  it declares. Nothing in this repository can look at the frames, so a
 *  citation is only as good as this list — it is what turns a group's name in
 *  a document into a claim that can be wrong. */
const FRAMES = {
  V1: ['Mobile1', 'dark', 14], V2: ['Mobile1', 'dark', 14], V3: ['Mobile1', 'light', 14],
  V4: ['Mobile2', 'dark', 14], V5: ['Mobile2', 'dark', 14],
  'Drag frame': ['Mobile3', 'dark', 14],
  T1: ['Mobile4', 'light', 16], T2: ['Mobile4', 'light', 16], T3: ['Mobile4', 'dark', 16],
  C1: ['Mobile4', 'light', 9],
  S1: ['Mobile5', 'dark', 16], S2: ['Mobile5', 'dark', 16],
  S3: ['Mobile6', 'dark', 16],
  S4: ['Mobile7', 'light', 16], S5: ['Mobile7', 'dark', 16], S6: ['Mobile7', 'dark', 16],
  S7: ['Mobile8', 'dark', 16], S9: ['Mobile8', 'light', 16],
  S10: ['Mobile9', 'dark', 16], S11: ['Mobile9', 'dark', 16],
  S12: ['Mobile10', 'dark', 16], S13: ['Mobile10', 'dark', 16],
  S14: ['Mobile11', 'dark', 16], S15: ['Mobile11', 'dark', 16], S16: ['Mobile11', 'light', 16],
  W1: ['Web12', 'dark', 14], W2: ['Web12', 'dark', 14],
  W3: ['Web13', 'light', 14], W4: ['Web13', 'light', 14],
  W6: ['Web14', 'dark', 16], W7: ['Web14', 'dark', 16], W8: ['Web14', 'light', 16],
  W9: ['Web14', 'dark', 16], W10: ['Web14', 'dark', 16],
  W11: ['Web15', 'light', 16], W12: ['Web15', 'light', 16], W13: ['Web15', 'light', 16],
  W14: ['Web15', 'light', 16], W15: ['Web15', 'light', 16], W16: ['Web15', 'light', 16],
  W17: ['Web15', 'light', 16], W18: ['Web15', 'light', 16],
};
const GROUPS = new Set(Object.values(FRAMES).map(([g]) => g));

/** And which frames each value that is *not* one of the sixteen was read off.
 *
 *  FRAMES alone catches a citation that names a frame of the wrong group or the
 *  wrong theme. It cannot catch one that names a frame which exists, is the
 *  right theme, and simply does not contain the value — which is the shape a
 *  wrong attribution takes once the obvious ones are gone. This is the answer
 *  key for that: every value below was searched for across all forty-two
 *  frames, and these are the ones it is in. Anything citing one of these values
 *  has to name a frame on its line. */
const READ_OFF = {
  'sLift dark': ['Drag frame'],
  'sLift light': ['C1'],
  'amberRing dark': ['V1', 'V4'],
  'amberRing light': ['W3', 'W4'],
  'project ramp': ['S1', 'S6'],
  Coder: ['S14'],
  SEO: ['S14'],
  Analyst: ['S14'],
  Research: ['S14'],
  'a ticket nobody has taken': ['Drag frame'],
};

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
// `sLift` is not one of the sixteen: it is the `--s2` of two frames that differ
// from the majority, so it is derived here from those frames' whole blocks
// rather than compared with a second copy of itself.
{
  const drag = declared(FRAME_DRAG);
  const chat = declared(FRAME_CHAT);
  checks.push(['the quoted drag frame is a dark frame of this design, differing only where it should',
    drag.bg === K.DARK.bg && drag.s1 === K.DARK.s1 && drag.ink === K.DARK.ink && drag.s2 !== K.DARK.s2]);
  checks.push(['…and the quoted light chat frame likewise',
    chat.bg === K.LIGHT.bg && chat.s1 === K.LIGHT.s1 && chat.ink === K.LIGHT.ink && chat.s2 !== K.LIGHT.s2]);
  checks.push(['the card you are holding is drawn in the surface those two frames raise to',
    K.DARK.sLift === drag.s2 && K.LIGHT.sLift === chat.s2]);
  checks.push(['…and the light one is written down as a borrowed role rather than an extracted one',
    eq([...K.BORROWED], ['sLift'])]);
}
checks.push(['the amber ring is the amber, at the weight Mobile1 V1 and Web13 W3 draw it',
  K.DARK.amberRing === 'rgba(234,182,90,.28)' && K.LIGHT.amberRing === 'rgba(156,98,16,.35)']);
checks.push(['…and it is the amber and nothing else: the ring is that hue, thinned',
  ['dark', 'light'].every((sch) => {
    const t = K.tokensFor(sch);
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const ring = t.amberRing.match(/[\d.]+/g).slice(0, 3).map(Number);
    // The frames write the ring in the amber's own channels; light's `--amber`
    // is the darkened text colour, so the ring is allowed to be the brighter
    // wash hue instead. Either way it must be an amber, not a new colour.
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 60);
    return near(ring, rgb(t.amber)) || near(ring, t.amberBg.match(/[\d.]+/g).slice(0, 3).map(Number));
  })]);
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
      && v !== '#6F7BBC' && v !== '#92A0E3');   // the dashed Coder, Mobile3 Drag frame
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
checks.push(['the seven executors of Mobile11 S14 are all there',
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

// 8b · the greys still separate ─────────────────────────────────────────────
// Two of the app's four text tiers now share one of the design's three, which
// is the decision here most likely to cost legibility. So it is measured rather
// than trusted: every tier, on every surface it can land on, in both themes.
// The floor is 3.5:1 — under it a 12 pt mono timestamp stops being readable on
// a phone held at arm's length, and the design's own weakest pair sits at 3.8.
function luminance(hex) {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
{
  const FLOOR = 3.5;
  const thin = [];
  for (const scheme of ['dark', 'light']) {
    const t = K.tokensFor(scheme);
    for (const fg of ['ink', 'ink2', 'ink3', 'amber', 'red', 'run']) {
      for (const bg of ['bg', 's1', 's2']) {
        const r = contrast(t[fg], t[bg]);
        if (r < FLOOR) thin.push(`${scheme} ${fg} on ${bg} ${r.toFixed(2)}`);
      }
    }
    const onAmber = contrast(t.onAmber, t.amber);
    if (onAmber < FLOOR) thin.push(`${scheme} onAmber ${onAmber.toFixed(2)}`);
  }
  checks.push([`every tier of text separates from every surface it lands on${thin.length ? ` (${thin.join(', ')})` : ''}`,
    thin.length === 0]);
  checks.push(['…and the two tiers that were collapsed are the same one on purpose',
    contrast(K.LIGHT.ink3, K.LIGHT.s2) >= FLOOR && contrast(K.DARK.ink3, K.DARK.s2) >= FLOOR]);
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
checks.push(['the tab bar stands 84 high over a hairline, as Mobile1 V1 draws it',
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

// 11 · every frame this work cites exists, and says what it is cited for ────
// The frames are outside the repository, so a citation cannot be followed by a
// machine — which is exactly why round one had four of them wrong and nothing
// noticed. FRAMES above is the set as it actually is; these checks hold every
// citation in the document, the parts and the gallery against it.
const DOC = fs.readFileSync(path.join(root, '..', 'design/divan/TOKENS.md'), 'utf8');
/** Every file that says where something came from. `tokens.ts` is on this list
 *  because it is the file a screen author actually opens: a wrong group in a
 *  doc comment misleads exactly as far as a wrong group in the document does,
 *  and round two had one there after round one had four here. This file is on
 *  it too, minus its own FRAMES table, which is the answer key rather than a
 *  citation. */
const CITING = {
  'design/divan/TOKENS.md': DOC,
  'src/tokens.ts': src('src/tokens.ts'),
  'src/theme.ts': src('src/theme.ts'),
  'src/components/divan.tsx': divan,
  'app/divan-gallery.tsx': gallery,
  'scripts/test-divan.cjs': src('scripts/test-divan.cjs').replace(/const FRAMES = \{[\s\S]*?\n\};/, ''),
};

/** `Mobile6 S3`, `Web13 W3 and W4`, `Mobile3's drag frame` — a group, and the
 *  frames named in the ninety characters after it, which is as far as a
 *  citation ever reaches in this codebase. */
/** The frame ids named in a piece of text, however they are spelled. */
function frameIds(text) {
  return [...text.matchAll(/\b([VTCSW]\d{1,2})\b|'?([Dd]rag[\s*]+frame)'?/g)]
    .map((m) => (m[1] || (m[2] && 'Drag frame')));
}

function citations(text) {
  const out = [];
  const groups = [...text.matchAll(/\b(Mobile|Web)(\d+)\b/g)];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i][0];
    const from = groups[i].index + g.length;
    const until = Math.min(from + 90, i + 1 < groups.length ? groups[i + 1].index : text.length);
    out.push([g, frameIds(text.slice(from, until))]);
  }
  return out;
}

for (const [file, text] of Object.entries(CITING)) {
  const bad = [];
  for (const [group, ids] of citations(text)) {
    if (!GROUPS.has(group)) { bad.push(`${group} is not a screen group`); continue; }
    // A group with no frame named after it is the shape the wrong attribution
    // took in round one: naming only the group is unfalsifiable until it has to
    // say which of that group's frames, at which point it plainly is not there.
    if (!ids.length) { bad.push(`${group} names no frame`); continue; }
    for (const id of ids) {
      if (!FRAMES[id]) bad.push(`${group} ${id}: no such frame`);
      else if (FRAMES[id][0] !== group) bad.push(`${group} ${id}: ${id} is in ${FRAMES[id][0]}`);
    }
  }
  checks.push([`every frame ${file} cites is a frame of the group it names${bad.length ? ` (${bad.join('; ')})` : ''}`,
    bad.length === 0]);
}
checks.push(['…and the six files between them make enough citations for that to mean something',
  Object.values(CITING).reduce((n, t) => n + citations(t).length, 0) >= 80]);
checks.push(['…and the set it is checked against is the whole set, with its gaps',
  Object.keys(FRAMES).length === 42 && GROUPS.size === 15
  && !FRAMES.S8 && !FRAMES.W5 && FRAMES['Drag frame'] !== undefined]);

// The error round one made was subtler than a bad id: a light value cited to a
// frame that exists but is drawn dark. The rows that carry their own provenance
// name a side, so the side can be checked.
{
  const rows = [...DOC.matchAll(/^\| `([a-zA-Z]+)` (dark|light) \| ([^|]+)\| ([^|]+)\|/gm)];
  const wrong = [];
  for (const [, token, side, , from] of rows) {
    const ids = frameIds(from);
    if (!ids.length) wrong.push(`${token} ${side}: names no frame`);
    for (const id of ids) {
      if (!FRAMES[id]) wrong.push(`${token} ${side}: no frame ${id}`);
      else if (FRAMES[id][1] !== side) wrong.push(`${token} ${side}: ${id} is a ${FRAMES[id][1]} frame`);
    }
  }
  checks.push([`a value read off a frame is read off a frame of its own theme${wrong.length ? ` (${wrong.join('; ')})` : ''}`,
    wrong.length === 0 && rows.length === 4]);

  // …and off a frame that actually contains it.
  const astray = [];
  for (const [, token, side, , from] of rows) {
    const key = `${token} ${side}`;
    const ids = frameIds(from);
    const allowed = READ_OFF[key];
    if (!allowed) { astray.push(`${key}: nothing recorded`); continue; }
    for (const id of ids) if (!allowed.includes(id)) astray.push(`${key}: ${id} does not carry it`);
  }
  checks.push([`…and off one it is actually in${astray.length ? ` (${astray.join('; ')})` : ''}`, astray.length === 0]);

  // The marks — the ramp and the executor faces — are cited the same way and
  // checked the same way.
  const marks = [...DOC.matchAll(/^\| ([a-zA-Z][^|`]*?) \| `oklch[^|]*\| [^|]*\| ([^|]+)\|/gm)];
  const lost = [];
  for (const [, label, from] of marks) {
    const allowed = READ_OFF[label.trim()];
    if (!allowed) { lost.push(`${label.trim()}: nothing recorded`); continue; }
    const ids = frameIds(from);
    if (!ids.length) lost.push(`${label.trim()}: names no frame`);
    for (const id of ids) if (!allowed.includes(id)) lost.push(`${label.trim()}: ${id} does not draw it`);
  }
  checks.push([`every mark is cited to a frame that draws it${lost.length ? ` (${lost.join('; ')})` : ''}`,
    lost.length === 0 && marks.length === 6]);

  // The same claims live a second time in the token module's doc comments, and
  // round two is what happens when only one copy is checked.
  const tokens = src('src/tokens.ts');
  const drifted = [];
  for (const name of ['sLift', 'amberRing']) {
    const at = tokens.indexOf(`\n  ${name}: string;`);
    const doc = tokens.slice(tokens.lastIndexOf('/**', at), at);
    const allowed = [...READ_OFF[`${name} dark`], ...READ_OFF[`${name} light`]];
    const ids = frameIds(doc);
    if (!ids.length) drifted.push(`${name}: its comment names no frame`);
    for (const id of ids) if (!allowed.includes(id)) drifted.push(`${name}: ${id} does not carry it`);
  }
  checks.push([`the token module says the same thing the document does${drifted.length ? ` (${drifted.join('; ')})` : ''}`,
    drifted.length === 0]);
}
// And the two frames the whole block is quoted from have to be able to carry it.
checks.push(['the frames the sixteen are quoted from declare all sixteen, one of each theme',
  FRAMES.S3[1] === 'dark' && FRAMES.S3[2] === 16 && FRAMES.S16[1] === 'light' && FRAMES.S16[2] === 16
  && Object.keys(declared(FRAME_DARK)).length === 16 && Object.keys(declared(FRAME_LIGHT)).length === 16]);
checks.push(['…and the document sends a reader to those two and no others',
  /\*\*Mobile6 S3\*\*/.test(DOC) && /\*\*Mobile11 S16\*\*/.test(DOC)]);
checks.push(['the two frames sLift is read off are the ones that raise a surface',
  FRAMES['Drag frame'][1] === 'dark' && FRAMES.C1[1] === 'light'
  && Object.keys(declared(FRAME_DRAG)).length === 14 && Object.keys(declared(FRAME_CHAT)).length === 9]);

// 12 · what is derived is written down, and only what is ────────────────────
// A third derived value could otherwise be added to the code and never reach
// the document, which is where a reviewer looks.
{
  const WORDS = ['no', 'one', 'two', 'three', 'four'];
  const section = (heading) => {
    const i = DOC.indexOf(heading);
    if (i < 0) return null;
    const rest = DOC.slice(i + heading.length);
    const j = rest.indexOf('\n### ');
    return rest.slice(0, j < 0 ? undefined : j);
  };
  const derivedHead = `### The ${WORDS[K.DERIVED.length]} values that were not in a frame`;
  const body = section(derivedHead);
  const named = body ? [...body.matchAll(/\*\*`([a-zA-Z]+)`\*\*/g)].map((m) => m[1]) : [];
  checks.push([`the document has a section for the ${WORDS[K.DERIVED.length]} derived values${body ? '' : ` (looking for "${derivedHead}")`}`,
    body !== null]);
  checks.push([`…naming exactly the ones the code calls derived (${named.join(', ') || 'none'})`,
    eq(named.sort(), [...K.DERIVED].sort())]);
  checks.push(['…and every one of them is a function of the tokens rather than a value in the table',
    [...K.DERIVED].every((n) => typeof K[n] === 'function' && K.DARK[n] === undefined)]);
  const borrowed = [...K.BORROWED];
  checks.push([`the value whose role was borrowed is written down as such (${borrowed.join(', ')})`,
    borrowed.every((n) => DOC.includes(`**The light \`${n}\` borrows its role.**`))]);
  checks.push(['…and it is a value in the table, not a function: only its role is a judgement',
    borrowed.every((n) => K.DARK[n] !== undefined && K.LIGHT[n] !== undefined && typeof K[n] !== 'function')]);
}

// 13 · the one mark whose colour is not the design's ────────────────────────
// An agent brings its own colour. When it has none, or an unreadable one, it
// falls back to the app's accent — which is now a pair, lighter in the dark
// theme and darker in the light one. A fixed fallback would draw it in the
// wrong theme's red on the other theme's page, which is how it read at 2.7:1.
for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const mark = (colour) => R.styles(R.render(scheme, h(R.agentcard.AgentGlyph, { label: 'Hermes', color: colour })));
  for (const [what, colour] of [['no colour', null], ['a colour that is not one', 'periwinkle']]) {
    const st = mark(colour);
    checks.push([`an agent with ${what} is drawn in the ${scheme} theme's own red`,
      st.some((x) => x.color === t.red) && st.some((x) => x.backgroundColor === `${t.red}22`)]);
  }
  const own = mark('#4A5D86');
  checks.push([`…and an agent that has one keeps it in the ${scheme} theme`,
    own.some((x) => x.color === '#4A5D86')]);
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
