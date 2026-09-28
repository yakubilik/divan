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
  /** The same surface while a card is held in the air over the board, one step
   *  further from the page. `--s2` of Mobile3, where a ticket is dragged. */
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
   *  asking for something. Mobile1 V1's `inset 0 0 0 1px rgba(234,182,90,.28)`
   *  and its light counterpart in Web14. */
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

/** Mobile1 V1 · Overview, top (and every other dark frame: the block is
 *  repeated verbatim on all thirteen of them). */
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

/** Mobile1 V3 · Overview: nothing needs you, 07:31 (and the five other light
 *  frames, which repeat it). */
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
 *  In frame order: Quire 265, Kanji Daily 320, Hush 210, The Long Walk 130,
 *  Pebble 95 (Mobile7 S6, the brand-new project). */
export const MONOGRAM = ['#4A5D86', '#6F5076', '#226873', '#50663A', '#706332'] as const;

/** Which of them a project gets. A project keeps its colour for as long as it
 *  keeps its name, and two projects on one screen almost never collide — which
 *  is all the frames ask of it. */
export function monogram(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM[h % MONOGRAM.length];
}

/** How an executor is drawn on a card: its mark, its colour, and whether the
 *  square is rounded off into a circle. Mobile11's `EXS` table, plus the two
 *  Coder faces from its `exOf` — one assigned, one still to be picked up.
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

/** The dashed Coder: `1.5px dashed oklch(0.6 0.1 275)` around
 *  `oklch(0.72 0.1 275)`, converted the same way as the monograms. */
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

/** Mobile1 V2's `counts`, Mobile6's section heads. */
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

/** Behind a sheet. The mobile frames never draw one — the phone screens are
 *  all full pages — so this is the one derived value in the file: the dark side
 *  is `--sh` itself, and the light side is the same ink at the weight the app
 *  already dimmed with. Recorded as derived in `design/divan/TOKENS.md`. */
export const scrim = (t: Tokens) => (t.scheme === 'dark' ? t.sh : 'rgba(27,26,23,.35)');

/** The page showing faintly through whatever is laid over it — behind the
 *  board's drop target. The page's own colour at the weight the app used. */
export const veil = (t: Tokens) => (t.scheme === 'dark' ? 'rgba(19,18,16,.92)' : 'rgba(245,243,238,.92)');
