/** Divan's palette on the phone.
 *
 *  Every value here is a value of the design system's token sheet,
 *  `web/src/styles/divan-tokens.css` — the same file the web panel loads — and
 *  `SOURCE` names, for each token, the custom property it is read from.
 *  `scripts/test-divan.cjs` parses that sheet and holds both tables to it;
 *  `design/divan/TOKENS.md` writes the mapping down.
 *
 *  This module is deliberately plain data — no React, no react-native — so the
 *  checks in `scripts/test-ustabasi.cjs` can read it without a phone.
 *  `theme.ts` is the only place that turns it into the `Palette` the screens
 *  already speak. */

export type Scheme = 'light' | 'dark';

export interface Tokens {
  scheme: Scheme;
  /** Screen background. `--canvas` */
  bg: string;
  /** The first surface: a card, a row, a chip. `--glass-1` */
  s1: string;
  /** The second surface: a selected tab, an icon well, a monogram's ground,
   *  the reader's own bubble. `--glass-2` */
  s2: string;
  /** What stands out from the page: the composer, the card being held.
   *  `--glass-strong` */
  sLift: string;
  /** The 1px edge every surface wears. `--glass-edge` */
  line: string;
  /** A separator, an unfilled track, the neutral chip fill. `--hairline` */
  line2: string;
  /** Primary text, and the primary button drawn in it. `--ink` */
  ink: string;
  /** Text on an ink fill. `--on-ink` */
  onInk: string;
  /** Secondary text. `--ink-2` */
  ink2: string;
  /** Meta: mono numbers, timestamps, placeholders. `--ink-3` */
  ink3: string;
  /** Needs you — the only accent. `--amber` */
  amber: string;
  /** Behind it. `--amber-wash` */
  amberBg: string;
  /** Text on top of amber. `--on-amber` */
  onAmber: string;
  /** The edge of a card that is asking. `--amber` */
  amberRing: string;
  /** Stuck, failed, unreachable — a dot or a word only. `--red` */
  red: string;
  /** Behind a red word: the neutral chip fill, never a red one. `--hairline` */
  redBg: string;
  /** Running, healthy. `--run` */
  run: string;
  /** Behind a green word: the neutral chip fill. `--hairline` */
  runBg: string;
  /** What a shadow is made of: the fall of `--shadow-float`. */
  sh: string;
}

/** Night: `.dv-root[data-theme="dark"]` in divan-tokens.css. */
export const DARK: Tokens = {
  scheme: 'dark',
  bg: '#18191c', s1: '#202125', s2: '#28292d', sLift: '#232428',
  line: 'rgba(255,255,255,0.07)', line2: 'rgba(255,255,255,0.08)',
  ink: '#ededeb', onInk: '#18191c', ink2: '#b3b3ae', ink3: '#919189',
  amber: '#e6b261', amberBg: 'rgba(230,178,97,0.14)', onAmber: '#1a140b',
  amberRing: '#e6b261',
  red: '#ec7a62', redBg: 'rgba(255,255,255,0.08)',
  run: '#7ccaa6', runBg: 'rgba(255,255,255,0.08)',
  sh: 'rgba(0,0,0,0.5)',
};

/** Day: `.dv-root[data-theme="light"]` in divan-tokens.css. */
export const LIGHT: Tokens = {
  scheme: 'light',
  bg: '#f1f1ef', s1: '#fafaf8', s2: '#ffffff', sLift: '#ffffff',
  line: 'rgba(0,0,0,0.07)', line2: 'rgba(0,0,0,0.065)',
  ink: '#0b0b0c', onInk: '#f7f7f5', ink2: '#4a4a46', ink3: '#696964',
  amber: '#8a560c', amberBg: 'rgba(200,140,40,0.14)', onAmber: '#ffffff',
  amberRing: '#8a560c',
  red: '#b3381e', redBg: 'rgba(0,0,0,0.065)',
  run: '#2a7560', runBg: 'rgba(0,0,0,0.065)',
  sh: 'rgba(0,0,0,0.26)',
};

/** Which custom property of divan-tokens.css each token is. A shadow property
 *  gives the colour of its last layer. Red and green are a dot or a word and
 *  never a fill, so their washes are the neutral chip fill `--hairline`. The
 *  web panel's `SOURCE` is the same table. */
export const SOURCE: Record<Exclude<keyof Tokens, 'scheme'>, string> = {
  bg: '--canvas', s1: '--glass-1', s2: '--glass-2', sLift: '--glass-strong',
  line: '--glass-edge', line2: '--hairline',
  ink: '--ink', onInk: '--on-ink', ink2: '--ink-2', ink3: '--ink-3',
  amber: '--amber', amberBg: '--amber-wash', onAmber: '--on-amber', amberRing: '--amber',
  red: '--red', redBg: '--hairline', run: '--run', runBg: '--hairline',
  sh: '--shadow-float',
};

export const tokensFor = (scheme: Scheme): Tokens => (scheme === 'dark' ? DARK : LIGHT);

/** White, which the frames write as `#fff` on an executor's mark. It belongs
 *  to the mark rather than to the theme — a coloured square brings its own
 *  background, so it does not follow the page — and it is here so that no
 *  screen has to spell a colour out. */
export const ON_COLOUR = '#FFFFFF';

// ── the marks a project and an executor are drawn with ───────────────────────

/** A project's monogram ground. Monograms are colourless — the letter on the
 *  second surface — because projects are told apart by name, not by colour.
 *  `index` is still taken so that a caller holding a list need not change. */
export function monogram(t: Tokens, _name: string, _index?: number | null): string {
  return t.s2;
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

/** The design's five corners — sm 10 · md 16 · lg 22 · xl 28 · pill — and the
 *  roles the app already had, each landed on one of them. */
const CORNER = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const RADIUS = {
  ...CORNER,
  /** A small mark: a status chip, an executor's square, a monogram. */
  mark: CORNER.sm,
  /** A list row's icon well. */
  well: CORNER.sm,
  /** A counter tile, a ticket card. */
  tile: CORNER.md,
  /** The board's column tab, a message card in the chat. */
  tab: CORNER.md,
  /** A card, a section block. */
  card: CORNER.md,
  /** A button, full width or half. */
  button: CORNER.pill,
  /** The empty state's two buttons, which are taller. */
  buttonTall: CORNER.pill,
  /** A pill, a project chip, the tab bar's icon well. */
  pill: CORNER.pill,
  /** The sheet that comes up from the bottom. */
  sheet: CORNER.lg,
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

/** The one value in this file that is not in the token sheet. Named here so
 *  that another cannot appear without `design/divan/TOKENS.md` gaining a line
 *  about it — a check holds the two lists together. */
export const DERIVED = ['veil'] as const;

/** Behind a sheet: the sheet's own shadow fall, `--shadow-float`. */
export const scrim = (t: Tokens) => t.sh;

/** The page showing faintly through whatever is laid over it — behind the
 *  board's drop target. Derived: `--canvas` at .92. Recorded as derived in
 *  `design/divan/TOKENS.md`. */
export const veil = (t: Tokens) => (t.scheme === 'dark' ? 'rgba(24,25,28,.92)' : 'rgba(241,241,239,.92)');

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
 *  derived from the tokens above, so a screen that asks for `c.card` gets
 *  `--glass-1` and there is no second table to drift.
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
 *   · `veil` is the one derived value, and says so above. */
function palette(t: Tokens): Palette {
  const sh = shadows(t);
  return {
    scheme: t.scheme,
    bg: t.bg, card: t.s1, fill: t.s2, line: t.line, lineStrong: t.line2,
    bubble: t.s2,
    ink: t.ink, onInk: t.onInk, text2: t.ink2, muted: t.ink3, faint: t.ink3,
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
