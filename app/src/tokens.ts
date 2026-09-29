/** Divan's palette, straight off the artboards.
 *
 *  Every value here was read out of a frame's own CSS custom properties
 *  (`design/divan/frames/*.html`, the block that opens each phone), not chosen
 *  here. The frames declare the same sixteen names on every screen, light and
 *  dark, which is why this table has exactly those sixteen and no favourites of
 *  its own. `design/divan/TOKENS.md` says which frame each value came from; if
 *  a disagreement ever reaches this file, the artboard settles it.
 *
 *  This module is deliberately plain data — no React, no react-native — so the
 *  checks in `scripts/test-ustabasi.cjs` can read it without a phone.
 *  `theme.ts` is the only place that turns it into the `Palette` the screens
 *  already speak. */

export type Scheme = 'light' | 'dark';

export interface Tokens {
  scheme: Scheme;
  /** Screen background. `--bg` */
  bg: string;
  /** The first surface: a card, a row, a chip, the machine line. `--s1` */
  s1: string;
  /** The second surface: a selected tab, an icon well, the reader's own
   *  bubble, a code block. Above `s1` in the dark, below `bg` in the light —
   *  in both it is the tone a selected thing takes. `--s2` */
  s2: string;
  /** The same surface, one step further from the page: the card you are
   *  holding. The dark side is the `--s2` of Mobile3's drag frame, which is
   *  that role exactly. The light side has no such frame — nothing is dragged
   *  on a light artboard — so it borrows the `--s2` of Mobile4 C1, the light
   *  chat, which is the only place the design draws a raised light surface.
   *  Recorded as borrowed in `design/divan/TOKENS.md`. */
  sLift: string;
  /** Hairline: a separator, the border under a tab strip. `--line` */
  line: string;
  /** The emphasised line, and the only line thick enough to be a fill: an
   *  unfilled quota track, an outline button, a dashed placeholder. `--line2` */
  line2: string;
  /** Primary text, and the primary button drawn in it. `--ink` */
  ink: string;
  /** Secondary text: a description, a body line under a title. `--ink2` */
  ink2: string;
  /** Meta: mono numbers, timestamps, placeholders, a row's chevron. `--ink3` */
  ink3: string;
  /** Needs you. `--amber` */
  amber: string;
  /** Behind it. `--amberBg` */
  amberBg: string;
  /** Text on top of amber — the one pair the frames spell out. `--onAmber` */
  onAmber: string;
  /** The amber drawn as a ring rather than as a fill, around a card that is
   *  asking for something. Mobile1 V1's `inset 0 0 0 1px rgba(234,182,90,.28)`,
   *  and on the light side Web13 W3's `inset 0 0 0 1px rgba(156,98,16,.35)` —
   *  the only place the design draws this ring in a light theme. */
  amberRing: string;
  /** Stuck, failed, red. `--red` */
  red: string;
  redBg: string;
  /** Running, healthy, done — green. `--run` */
  run: string;
  runBg: string;
  /** What a shadow is made of in this theme. `--sh` */
  sh: string;
}

/** Mobile6 S3 · Waiting on you — one of the seventeen dark frames that declare
 *  the whole block, character for character. (Three more, Mobile1 V1 and V2 and
 *  Mobile2 V4, declare fourteen of the sixteen and agree with every one of
 *  them; `--onAmber` and `--sh` arrive later in the set.) `sLift` and
 *  `amberRing` are not in that block and say above where they come from. */
export const DARK: Tokens = {
  scheme: 'dark',
  bg: '#131210', s1: '#1C1B18', s2: '#26241F', sLift: '#2A2822',
  line: 'rgba(236,232,225,.08)', line2: 'rgba(236,232,225,.2)',
  ink: '#EDE9E2', ink2: '#A9A499', ink3: '#8C877E',
  amber: '#EAB65A', amberBg: 'rgba(234,182,90,.11)', onAmber: '#1A1609',
  amberRing: 'rgba(234,182,90,.28)',
  red: '#EE6D55', redBg: 'rgba(238,109,85,.12)',
  run: '#7CC6A6', runBg: 'rgba(124,198,166,.1)',
  sh: 'rgba(0,0,0,.5)',
};

/** Mobile11 S16 · Machine drawer, light — one of the fourteen light frames
 *  that declare the whole block, character for character. (Mobile1 V3 and
 *  Web13 W3/W4 declare fourteen of the sixteen and agree with every one.) */
export const LIGHT: Tokens = {
  scheme: 'light',
  bg: '#F5F3EE', s1: '#FFFFFF', s2: '#ECE9E2', sLift: '#E9E6DE',
  line: 'rgba(27,26,23,.09)', line2: 'rgba(27,26,23,.18)',
  ink: '#1B1A17', ink2: '#5C5850', ink3: '#7A756C',
  amber: '#9C6210', amberBg: 'rgba(214,150,40,.14)', onAmber: '#FFFFFF',
  amberRing: 'rgba(156,98,16,.35)',
  red: '#C2412B', redBg: 'rgba(194,65,43,.1)',
  run: '#2F8067', runBg: 'rgba(47,128,103,.1)',
  sh: 'rgba(27,26,23,.12)',
};

export const tokensFor = (scheme: Scheme): Tokens => (scheme === 'dark' ? DARK : LIGHT);

/** White, which the frames write as `#fff` on a monogram and on an executor's
 *  mark. It belongs to the mark rather than to the theme — a coloured square
 *  brings its own background, so it does not follow the page — and it is here
 *  so that no screen has to spell a colour out. */
export const ON_COLOUR = '#FFFFFF';

// ── the marks a project and an executor are drawn with ───────────────────────

/** A project's monogram colour. The frames pick these out of a small ramp of
 *  equally dark, equally muted hues so that four projects in a list are told
 *  apart by hue alone and none of them shouts; white sits on every one.
 *
 *  They are written `oklch(0.48 0.07 H)` on the artboard, which React Native
 *  cannot parse, so each is converted to the sRGB the browser would show.
 *  Mobile5 S1 draws the first four on one dashboard — Quire 265, Kanji Daily
 *  320, Hush 210, The Long Walk 130 — and Mobile7 S6 the fifth, 95, which
 *  belongs to the project it invents. */
export const MONOGRAM = ['#4A5D86', '#6F5076', '#226873', '#50663A', '#706332'] as const;

/** Which of them a project gets.
 *
 *  A screen that has the whole list in front of it — the Dashboard, the project
 *  bar — passes the project's place in that list, and four projects get four
 *  different hues, which is the frames' own arrangement. A screen holding one
 *  project and no list falls back to the name, which at least keeps the same
 *  project the same colour everywhere it appears. */
export function monogram(name: string, index?: number | null): string {
  if (index != null) return MONOGRAM[((index % MONOGRAM.length) + MONOGRAM.length) % MONOGRAM.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM[h % MONOGRAM.length];
}

/** How an executor is drawn on a card: its mark, its colour, and whether the
 *  square is rounded off into a circle. Mobile11 S14 draws all seven of them in
 *  one column — it is the frame the `EXS` table in that file feeds — and
 *  Mobile3's drag frame draws the eighth face, a ticket nobody has taken.
 *
 *  `fill: null` means the badge takes the page's own tones, which only the two
 *  members of the household do: Divan sits in `s2` behind a `line2` ring, and
 *  you are drawn in `ink`. */
export interface ExecutorFace {
  /** The one or two characters in the square. */
  mark: string;
  /** The square's colour, or null when it takes the theme's own. */
  fill: string | null;
  /** A circle rather than a rounded square: the two who are not machines, and
   *  the research assistant. */
  round: boolean;
  /** Not assigned yet — the square is an outline waiting to be filled. */
  dashed: boolean;
  /** The grey line under the name, in the frames' words. */
  kind: string;
}

/** The dashed Coder, which only Mobile3's drag frame draws: `1.5px dashed
 *  oklch(0.6 0.1 275)` around `oklch(0.72 0.1 275)`, converted the same way as
 *  the monograms. */
export const EXEC_PENDING_LINE = '#6F7BBC';
export const EXEC_PENDING_INK = '#92A0E3';

export const EXECUTORS: Record<string, ExecutorFace> = {
  coder: { mark: '</>', fill: '#48528F', round: false, dashed: false, kind: 'writes code · opens PRs' },
  unassigned: { mark: '</>', fill: null, round: false, dashed: true, kind: 'next free one takes it' },
  seo: { mark: 'S', fill: '#007083', round: false, dashed: false, kind: 'branch agent · SEO' },
  analyst: { mark: 'An', fill: '#3E6084', round: false, dashed: false, kind: 'branch agent · analytics' },
  research: { mark: 'R', fill: '#7A4475', round: true, dashed: false, kind: 'research assistant' },
  divan: { mark: 'D', fill: null, round: true, dashed: false, kind: 'the house agent' },
  you: { mark: 'Y', fill: null, round: true, dashed: false, kind: 'you · no machine' },
};

export type ExecutorName = keyof typeof EXECUTORS;

// ── what a state looks like ─────────────────────────────────────────────────

/** The five states the frames colour, and the character each is drawn with.
 *  Colour is never the only carrier: `■ 1 stuck` keeps its square, `? 1` its
 *  question mark, so a state survives being read in grey. */
export type State = 'stuck' | 'asking' | 'running' | 'done' | 'yours' | 'quiet';

/** Mobile1 V2's project counts and agent roster, and Mobile6 S3's section
 *  heads: between them the five are all drawn. */
export const STATE_MARK: Record<State, string> = {
  stuck: '■', asking: '?', running: '●', done: '✓', yours: '○', quiet: '·',
};

/** Which of the theme's tones a state borrows. Resolved against `Tokens` by
 *  `stateColour` rather than frozen here, because every one of them is a pair. */
export type Tone = 'red' | 'amber' | 'run' | 'ink2' | 'ink3';

export const STATE_TONE: Record<State, Tone> = {
  stuck: 'red', asking: 'amber', running: 'run', done: 'ink3', yours: 'amber', quiet: 'ink3',
};

/** The tone's text colour and, where it has one, the wash behind it. */
export function toneColours(t: Tokens, tone: Tone): { fg: string; bg: string } {
  if (tone === 'red') return { fg: t.red, bg: t.redBg };
  if (tone === 'amber') return { fg: t.amber, bg: t.amberBg };
  if (tone === 'run') return { fg: t.run, bg: t.runBg };
  if (tone === 'ink2') return { fg: t.ink2, bg: t.s2 };
  return { fg: t.ink3, bg: t.s2 };
}

export const stateColour = (t: Tokens, s: State) => toneColours(t, STATE_TONE[s]).fg;

// ── form ────────────────────────────────────────────────────────────────────

/** The corners the frames actually draw. Nothing else is used. */
export const RADIUS = {
  /** A small mark: a status chip, an executor's square, a monogram. */
  mark: 8,
  /** A list row's icon well. */
  well: 9,
  /** A counter tile, a ticket card. */
  tile: 14,
  /** The board's column tab, a message card in the chat. */
  tab: 12,
  /** A card, a section block. */
  card: 16,
  /** A button, full width or half. */
  button: 11,
  /** The empty state's two buttons, which are taller. */
  buttonTall: 13,
  /** A pill, a project chip, the tab bar's icon well. */
  pill: 999,
  /** The sheet that comes up from the bottom. */
  sheet: 22,
} as const;

/** Heights and spans the frames repeat. */
export const SIZE = {
  /** The project chip and the answer pill: `height:34px`. */
  pill: 34,
  /** The board's column tab: `height:46px`. */
  columnTab: 46,
  /** The tab bar, above the home indicator: `height:84px`. */
  tabBar: 84,
  /** Its selected icon well: `width:60px;height:32px`. */
  tabWell: [60, 32] as const,
  /** The icon inside it. */
  tabIcon: 22,
  /** An executor's square on a card. */
  executor: 28,
  /** A project's monogram on a project card. */
  monogram: 32,
  /** A list row's icon well, and the icon in it. */
  rowWell: 32,
  rowIcon: 17,
  /** A status dot. */
  dot: 8,
} as const;

/** The shadows, written as the frames write them. There are only three: a
 *  small lift, a popover, and the drawer that covers half the page. */
export function shadows(t: Tokens) {
  return {
    /** A pill, a selected segment, a card that rests on the page. */
    lift: `0 1px 2px ${t.sh}`,
    /** A menu or a popover: a line around it and a long soft fall. */
    pop: `0 0 0 1px ${t.line2}, 0 10px 24px ${t.sh}`,
    /** A sheet, which falls further. */
    sheet: `0 0 0 1px ${t.line2}, 0 14px 36px ${t.sh}`,
  };
}

/** The two values in this file that are in no frame at all, and the one whose
 *  value is in a frame but whose role is not. Named here so that a third of
 *  either cannot appear without `design/divan/TOKENS.md` gaining a line about
 *  it — a check holds the two lists together. */
export const DERIVED = ['scrim', 'veil'] as const;
export const BORROWED = ['sLift'] as const;

/** Behind a sheet. The mobile frames never draw one — the phone screens are
 *  all full pages — so this is a derived value: the dark side is `--sh`
 *  itself, and the light side is the same ink at the weight the app already
 *  dimmed with. Recorded as derived in `design/divan/TOKENS.md`. */
export const scrim = (t: Tokens) => (t.scheme === 'dark' ? t.sh : 'rgba(27,26,23,.35)');

/** The page showing faintly through whatever is laid over it — behind the
 *  board's drop target. Derived too: the page's own colour at the weight the
 *  app used. */
export const veil = (t: Tokens) => (t.scheme === 'dark' ? 'rgba(19,18,16,.92)' : 'rgba(245,243,238,.92)');

/** The whole palette, twice, under the names the screens already use. Every
 *  screen was drawn in both, element for element, and these are the pairs: a
 *  value never appears on one side without its counterpart on the other.
 *  Nothing on screen picks a colour outside this table, and this table picks
 *  nothing outside the sixteen above it. The app follows the phone's own
 *  appearance. */
export interface Palette {
  scheme: Scheme;
  /** Screen background. */
  bg: string;
  /** Cards, rows, sheets, menus. */
  card: string;
  /** Quiet fills: search field, segmented track, chips, icon wells. */
  fill: string;
  /** Default border and separator. */
  line: string;
  /** Emphasised border, an unfilled track, a disabled fill. */
  lineStrong: string;
  /** Primary text, and the primary button that is drawn in it. */
  ink: string;
  /** Text on top of `ink`. */
  onInk: string;
  /** The reader's own messages. A raised neutral, not an inverted one: a
   *  white slab in a dark thread reads as an error, not as "mine". */
  bubble: string;
  text2: string;
  muted: string;
  faint: string;
  /** The selected segment of a segmented control. */
  segOn: string;
  /** Code blocks, table heads, the address bar of the sign-in page. */
  code: string;
  warn: string; warnBg: string;
  ok: string; okBg: string;
  danger: string; dangerBg: string;
  /** Allow, send, the recording dot — the same red in both themes. */
  accent: string;
  /** Red as text: needs approval, a toggled-on chip. */
  accentText: string;
  accentTint: string;
  /** Dim behind a sheet, a menu or a dialog. */
  scrim: string;
  /** Behind the drop target. */
  veil: string;
  /** The halo around the live-turn dot. */
  halo: string;
  /** The unfilled part of a spinner drawn on a card. */
  spinTrack: string;
  /** Second stripe of an image that has not loaded yet. */
  stripe: string;
  shadow: {
    /** A card resting on the page. */
    card: string;
    /** The small lift under a pill or a selected segment. */
    pill: string;
    seg: string;
    /** A menu or popover. */
    menu: string;
    /** A menu attached to the chat header, a sheet over the page. */
    pop: string;
    /** A pending approval, which has to stand out from the transcript. */
    raised: string;
    /** The knob of a switch. */
    knob: string;
  };
}

/** The `Palette` is no longer written out twice by hand: both sides of it are
 *  derived from the design's own sixteen tokens, so a screen that asks for
 *  `c.card` gets the frames' `--s1` and there is no second table to drift.
 *
 *  Most roles are a token under an older name. Four are a judgement, and all
 *  four are recorded in `design/divan/TOKENS.md`:
 *
 *   · `muted` and `faint` both land on `--ink3`. The app grew four tiers of
 *     text; the frames draw three, and they put mono meta, timestamps,
 *     placeholders and a row's chevron in the same one.
 *   · `segOn` is `--s1` on an `--s2` track: the selected segment is a card
 *     sitting in a well, which is how the frames draw a selected column tab.
 *   · `accent` is `--red`. The frames give the send button `--ink` and keep red
 *     for trouble; the app's accent is the colour of Allow, of the recording
 *     dot and of delete, which is the same red.
 *   · `scrim` and `veil` are the two derived values, and say so above. */
function palette(t: Tokens): Palette {
  const sh = shadows(t);
  return {
    scheme: t.scheme,
    bg: t.bg, card: t.s1, fill: t.s2, line: t.line, lineStrong: t.line2,
    bubble: t.s2,
    ink: t.ink, onInk: t.bg, text2: t.ink2, muted: t.ink3, faint: t.ink3,
    segOn: t.s1, code: t.s2,
    warn: t.amber, warnBg: t.amberBg,
    ok: t.run, okBg: t.runBg,
    danger: t.red, dangerBg: t.redBg,
    accent: t.red, accentText: t.red, accentTint: t.redBg,
    scrim: scrim(t), veil: veil(t), halo: t.line2,
    spinTrack: t.line2, stripe: t.s2,
    shadow: {
      card: sh.lift, pill: sh.lift, seg: sh.lift,
      menu: sh.sheet, pop: sh.pop, raised: sh.pop, knob: sh.lift,
    },
  };
}

export const light: Palette = palette(LIGHT);
export const dark: Palette = palette(DARK);
