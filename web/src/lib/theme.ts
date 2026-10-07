/** Divan's palette on the desktop, and the switch between its two themes.
 *
 *  Every colour here is a value of `src/styles/divan-tokens.css`, the design
 *  system's own token sheet, copied into this tree as it was handed over. That
 *  file is the single source: `SOURCE` below names, for each token, the custom
 *  property it is read from, `scripts/test-divan.mjs` parses the sheet and holds
 *  both tables to it, and `design/divan/TOKENS.md` writes the mapping down.
 *
 *  Nothing on screen reads a value out of this file directly. Both themes are
 *  written into the document as CSS custom properties (`themeCss`), and what a
 *  component reads is a reference to one of them: `T.ink3` is the string
 *  `var(--dv-ink3)`. That is what makes the switch free — the whole panel
 *  changes theme without a React render, and the older screens follow the new
 *  palette without a line of theirs changing.
 */

import { useEffect, useReducer } from 'react';

export type Scheme = 'light' | 'dark';

export interface Tokens {
  scheme: Scheme;
  /** The page. `--canvas` */
  bg: string;
  /** The first surface: a card, a column, a panel, a list. `--glass-1` */
  s1: string;
  /** The second surface: hover, a selected segment, a monogram's ground.
   *  `--glass-2` */
  s2: string;
  /** What stands out from the page: the composer, something held open over it.
   *  `--glass-strong` */
  sLift: string;
  /** The 1px edge every surface wears. `--glass-edge` */
  line: string;
  /** A separator, an unfilled track, the neutral chip fill. `--hairline` */
  line2: string;
  /** Primary text, and the button drawn in it. `--ink` */
  ink: string;
  /** Text and glyphs on an ink fill. `--on-ink` */
  onInk: string;
  /** Secondary text. `--ink-2` */
  ink2: string;
  /** Mono meta, timestamps, placeholders. `--ink-3` */
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
  /** Behind a modal, a sheet or a lightbox: the same fall. */
  scrim: string;
  /** A ticket nobody has taken yet: the dashed square, and the mark inside it.
   *  `--hairline` and `--ink-3`, the dashed "add" chip's own pair. */
  execLine: string;
  execInk: string;
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
  scrim: 'rgba(0,0,0,0.5)',
  execLine: 'rgba(255,255,255,0.08)', execInk: '#919189',
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
  scrim: 'rgba(0,0,0,0.26)',
  execLine: 'rgba(0,0,0,0.065)', execInk: '#696964',
};

/** Which custom property of divan-tokens.css each token is, on both sides. A
 *  property that holds a shadow gives the colour of its last layer — the long
 *  fall of `--shadow-float` is what a shadow and a dim are made of. Roles the
 *  sheet has no property for take the one the design gives that job: red and
 *  green are a dot or a word and never a fill, so their washes are the neutral
 *  chip fill `--hairline`, which is what `.dv-status` sits on. */
export const SOURCE: Record<Exclude<keyof Tokens, 'scheme'>, string> = {
  bg: '--canvas', s1: '--glass-1', s2: '--glass-2', sLift: '--glass-strong',
  line: '--glass-edge', line2: '--hairline',
  ink: '--ink', onInk: '--on-ink', ink2: '--ink-2', ink3: '--ink-3',
  amber: '--amber', amberBg: '--amber-wash', onAmber: '--on-amber', amberRing: '--amber',
  red: '--red', redBg: '--hairline', run: '--run', runBg: '--hairline',
  sh: '--shadow-float', scrim: '--shadow-float',
  execLine: '--hairline', execInk: '--ink-3',
};

export const tokensFor = (scheme: Scheme): Tokens => (scheme === 'dark' ? DARK : LIGHT);

export type TokenName = Exclude<keyof Tokens, 'scheme'>;

const NAMES = Object.keys(DARK).filter((k) => k !== 'scheme') as TokenName[];

/** `--dv-ink3`, and nothing shorter: the panel shares a document with nothing,
 *  but a two-letter prefix is what makes a stray custom property in a
 *  screenshot obviously ours. */
const cssName = (name: TokenName) => `--dv-${name}`;

/** The palette as a component reads it: a reference, not a value, so one render
 *  is correct in both themes. */
export const T = Object.fromEntries(
  NAMES.map((n) => [n, `var(${cssName(n)})`]),
) as Record<TokenName, string>;

/** Both themes, as the two rules the document carries. `data-theme` is set on
 *  `<html>` by the switch below, which is also what tells the browser which
 *  form controls and scrollbars to draw. */
export function themeCss(): string {
  const rule = (scheme: Scheme) => {
    const t = tokensFor(scheme);
    const vars = NAMES.map((n) => `${cssName(n)}:${t[n]}`).join(';');
    // Any element, not only `:root`: the switch writes the attribute on
    // `<html>`, and a gallery holding both themes up against the frames writes
    // it on a `<div>`.
    return `[data-theme="${scheme}"]{color-scheme:${scheme};${vars}}`;
  };
  return [
    rule('dark'),
    rule('light'),
    // The page itself, so that the document behind the panel is the panel's own
    // colour before React has drawn anything over it.
    `html,body{background:${T.bg};color:${T.ink};font-family:${SANS}}`,
    `::-webkit-scrollbar{width:10px;height:10px}`,
    `::-webkit-scrollbar-thumb{background:${T.line2};border-radius:5px;`
      + `border:3px solid transparent;background-clip:content-box}`,
    `::-webkit-scrollbar-thumb:hover{background:${T.ink3};border:3px solid transparent;`
      + `background-clip:content-box}`,
    `::-webkit-scrollbar-track{background:transparent}`,
    // The accent's orange, not a grey wash: a selection has to be visible on
    // every surface, and the second surface colour was nearly the first.
    `::selection{background:color-mix(in srgb,${T.red} 45%,transparent)}`,
  ].join('\n');
}

// ── the switch ──────────────────────────────────────────────────────────────

/** What the reader asked for, which is not the same as what is on screen:
 *  `system` follows the computer, and the other two are a decision that
 *  outlives the tab. Nothing stored is Night: it is the design's default. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'rac.theme';

const media = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null);

/** What the computer is set to. Dark unless it says otherwise: the panel was
 *  drawn dark first and a browser that cannot answer the question is likelier
 *  to be one of the odd ones than a light desktop. */
export function systemScheme(): Scheme {
  return media()?.matches ? 'light' : 'dark';
}

function storedChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark';
  } catch { return 'dark'; }
}

export const resolveScheme = (choice: ThemeChoice): Scheme => (
  choice === 'system' ? systemScheme() : choice
);

/** Put the resolved theme on the document. Everything drawn reads its colours
 *  out of the variables this attribute selects, so this one line is the whole
 *  of a theme change — there is no re-render behind it. */
function apply(scheme: Scheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = scheme;
  // The app root carries it too: divan-tokens.css declares its properties on
  // `.dv-root[data-theme]`, and the components sheet styles under `.dv-root`.
  document.getElementById('root')?.setAttribute('data-theme', scheme);
}

interface ThemeState {
  /** What was asked for. */
  choice: ThemeChoice;
  /** What is on screen. */
  scheme: Scheme;
  set: (choice: ThemeChoice) => void;
}

/** Deliberately not zustand, though the panel's other stores are: a theme is
 *  read by two screens and by nothing that re-renders on it, and the switch has
 *  to work before React mounts (the attribute is already on `<html>` when the
 *  first paint happens). A store would be a subscription list nobody needs. */
const listeners = new Set<() => void>();

const state: { choice: ThemeChoice; scheme: Scheme } = (() => {
  const choice = storedChoice();
  const scheme = resolveScheme(choice);
  apply(scheme);
  return { choice, scheme };
})();

function announce(): void {
  for (const fn of [...listeners]) fn();
}

/** The computer changing its mind while the panel is open, which is a thing
 *  macOS does at sunset. Followed only while nothing has been chosen by hand. */
media()?.addEventListener?.('change', () => {
  if (state.choice !== 'system') return;
  state.scheme = systemScheme();
  apply(state.scheme);
  announce();
});

export function setThemeChoice(choice: ThemeChoice): void {
  state.choice = choice;
  state.scheme = resolveScheme(choice);
  apply(state.scheme);
  try { localStorage.setItem(KEY, choice); } catch { /* private mode */ }
  announce();
}

export const themeChoice = (): ThemeChoice => state.choice;
export const themeScheme = (): Scheme => state.scheme;

/** For the screens that show the switch, and for nothing else: no colour needs
 *  this, because no colour is read in JavaScript. */
export function useTheme(): ThemeState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);
  return { choice: state.choice, scheme: state.scheme, set: setThemeChoice };
}

// ── the marks a project and an executor are drawn with ───────────────────────

/** White, which the frames write as `#fff` on an executor's square. It belongs
 *  to the mark rather than to the theme — a coloured square brings its own
 *  background and does not follow the page — which is why it is a constant here
 *  and not a token. */
export const ON_COLOUR = '#FFFFFF';

/** A project's monogram ground. Monograms are colourless — the letter on the
 *  second surface — because projects are told apart by name, not by colour.
 *  `index` is still taken so that a caller holding a list need not change. */
export function monogram(_name: string, _index?: number | null): string {
  return T.s2;
}

/** How an executor is drawn: its mark, its colour, and whether the square is
 *  rounded off into a circle. Web14 W10 draws the roster, and Web12 W1 and W2
 *  put the same squares on the cards and on the chat panels.
 *
 *  `fill: null` means the badge takes the page's own tones, which only the two
 *  members of the household do: Divan sits in `ink` (W2's panel head draws it
 *  as `background:var(--ink);color:var(--bg)`), and you are drawn the same way. */
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

export const EXECUTORS: Record<string, ExecutorFace> = {
  coder: { mark: '</>', fill: '#48528F', round: false, dashed: false, kind: 'writes code · opens PRs' },
  unassigned: { mark: '</>', fill: null, round: false, dashed: true, kind: 'next free one takes it' },
  seo: { mark: 'S', fill: '#007083', round: false, dashed: false, kind: 'branch agent · SEO' },
  analyst: { mark: 'An', fill: '#3E6084', round: false, dashed: false, kind: 'branch agent · analytics' },
  research: { mark: 'R', fill: '#7A4475', round: true, dashed: false, kind: 'research assistant' },
  divan: { mark: 'D', fill: null, round: true, dashed: false, kind: 'the house agent' },
  you: { mark: 'Y', fill: null, round: true, dashed: false, kind: 'you · no machine' },
};

/** Colours that belong to what is under them rather than to the page: the black
 *  behind a photo or a remote screen, and the chrome drawn on top of it. They
 *  do not follow the theme — a picture is the same picture in either — and they
 *  are listed here so that no screen has to spell one out. */
export const MEDIA = {
  /** Behind a photo in the lightbox, and behind a video. */
  backdrop: 'rgba(0,0,0,0.88)',
  /** The frame a remote screen is shown in. */
  stage: '#000000',
  /** A button floating over the picture, and its outline. */
  chrome: 'rgba(255,255,255,0.08)',
  chromeLine: 'rgba(255,255,255,0.14)',
  /** Its label, and the dimmer one beside it. */
  ink: ON_COLOUR,
  inkDim: 'rgba(255,255,255,0.6)',
} as const;

// ── what a state looks like ─────────────────────────────────────────────────

/** The states the frames colour, and the character each is drawn with. Colour
 *  is never the only carrier: Web12 W2's summary line is `■ 1 stuck · ? 1
 *  asking · ● 2 running · ○ 1 yours`, so a state survives being read in grey. */
export type State = 'stuck' | 'asking' | 'running' | 'done' | 'yours' | 'quiet';

export const STATE_MARK: Record<State, string> = {
  stuck: '■', asking: '?', running: '●', done: '✓', yours: '○', quiet: '·',
};

/** Which of the theme's tones a state borrows. */
export type Tone = 'red' | 'amber' | 'run' | 'ink2' | 'ink3';

export const STATE_TONE: Record<State, Tone> = {
  stuck: 'red', asking: 'amber', running: 'run', done: 'ink3', yours: 'amber', quiet: 'ink3',
};

/** A tone as the frames use it: the colour, the wash behind it, and the line
 *  that outlines it. Web14 W10's roster has all three shapes in one table — a
 *  green `busy` chip on `runBg`, a red `unavailable` chip outlined in
 *  `inset 0 0 0 1px var(--red)`, a grey `idle` chip on `s2`. */
export interface ToneColours { fg: string; bg: string; line: string }

export function toneColours(tone: Tone): ToneColours {
  if (tone === 'red') return { fg: T.red, bg: T.redBg, line: T.red };
  if (tone === 'amber') return { fg: T.amber, bg: T.amberBg, line: T.amberRing };
  if (tone === 'run') return { fg: T.run, bg: T.runBg, line: T.run };
  if (tone === 'ink2') return { fg: T.ink2, bg: T.s2, line: T.line2 };
  return { fg: T.ink3, bg: T.s2, line: T.line };
}

export const stateColour = (s: State) => toneColours(STATE_TONE[s]).fg;

/** A word and the three colours it is drawn in — what the two walls (terminal
 *  mode and the ticket queue) label a tile with. The colours are a tone's, so
 *  that "needs an answer" is the same amber on both and neither has to name a
 *  wash of its own. */
export interface ToneFace { label: string; color: string; wash: string; edge: string }

export function toneFace(label: string, tone: Tone): ToneFace {
  const c = toneColours(tone);
  return { label, color: c.fg, wash: c.bg, edge: c.line };
}

// ── form ────────────────────────────────────────────────────────────────────

/** The design's five corners — sm 10 · md 16 · lg 22 · xl 28 · pill — and the
 *  roles the panel already had, each landed on one of them. */
const CORNER = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const RADIUS = {
  ...CORNER,
  /** A status chip. */
  chip: CORNER.pill,
  /** An executor's square, a small mark. */
  mark: CORNER.sm,
  /** A list row's icon well, a small button, the selected tab in its track. */
  well: CORNER.sm,
  /** A top-bar item and a side-panel row, and an inset quote block. */
  nav: CORNER.sm,
  quote: CORNER.sm,
  /** A button that ends a card. */
  button: CORNER.pill,
  /** The tab strip's track, and a card in the chat panel. */
  tab: CORNER.md,
  /** A counter tile, a ticket card on the board. */
  tile: CORNER.md,
  /** A card, a board column, the chat panel, the drawer. */
  card: CORNER.md,
  /** A pill. */
  pill: CORNER.pill,
  /** The composer inside a panel. */
  field: CORNER.pill,
  /** The command bar across the bottom: the composer's corner. */
  bar: CORNER.xl,
} as const;

/** Heights and spans the desktop frames repeat. */
export const SIZE = {
  /** The top bar: `height:58px`, in thirteen of the frames. */
  topBar: 58,
  /** An item in it, and a row of the side panel's list. */
  navItem: 34,
  /** A pill, and a small button — a row's own actions in Web15 W12. */
  pill: 32,
  /** The mono chip at the far end of the top bar, which is where that bar says
   *  something rather than goes somewhere: `height:30px;border-radius:9px` at
   *  `500 11.5px` mono, in all eight frames of Web15. */
  barChip: 30,
  /** The button a card or an empty state ends on. */
  button: 34,
  /** A status dot; the hollow one is the same circle at 1.5px. */
  dot: 7,
  /** An executor's square on a card or a panel head. */
  executor: 28,
  /** A project's monogram on a project card (Web12 W1), 46 in a page head. */
  monogram: 34,
  /** The Divan mark in the top bar, and the size the mark is drawn at wherever
   *  it stands alone. Sized to the cap height of the 19 pt wordmark beside it,
   *  not to the 58 pt bar: a logo reads as one object or as two. */
  logo: 22,
  /** …and the mark at its default, for a favicon or a splash. */
  mark: 24,
  /** A list row's icon well, and the glyph in it. */
  rowWell: 32,
  rowIcon: 17,
  /** The side panel of Web15: `grid-template-columns:260px minmax(0,1fr)`. */
  sidePanel: 260,
  /** Its rows. */
  sideRow: 40,
  /** The chat session Web12 W1 opens at the bottom right: `width:350px;
   *  height:500px`. The second one, to the left of it, is drawn a size down —
   *  `320 × 440` — which is the frame saying which one is being read; the panel
   *  opens both at the first size, because on this end either of the two can be
   *  the one you answer. */
  panel: 350,
  panelTall: 500,
  /** A minimised session in the dock: `width:136px; height:44px`, and the
   *  `+1` beside them at `44 × 44`. */
  tab: 136,
  tabTall: 44,
  /** The composer inside a panel: `height:40px`. */
  field: 40,
  /** The command bar across the bottom: `width:420px; height:52px`, with a
   *  36 pt send button in it. */
  bar: 420,
  barTall: 52,
  send: 36,
} as const;

/** The shadows, as the frames write them. There are four, and a card wearing
 *  the first is the commonest thing on the desktop. */
export const SHADOW = {
  /** The hairline ring a card wears instead of a border, so that the corner
   *  stays exact: `0 0 0 1px var(--line)`. */
  ring: `0 0 0 1px ${T.line}`,
  /** Something resting on the page: `0 1px 2px var(--sh)`. */
  lift: `0 1px 2px ${T.sh}`,
  /** A menu, a popover, the command bar: a line around it and a long fall. */
  pop: `0 0 0 1px ${T.line2}, 0 10px 24px ${T.sh}`,
  /** The drawer, which falls further. */
  drawer: `0 0 0 1px ${T.line2}, 0 14px 36px ${T.sh}`,
  /** A window standing over the page: the chat session of Web12 W1, `0 24px
   *  60px rgba(0,0,0,.55)` in the dark and the same fall in the light frame's
   *  own shadow colour. Its ring is not in here, because which colour that ring
   *  is, is what the window is *saying*. */
  float: `0 24px 60px ${T.sh}`,
} as const;

/** An outline, which the frames draw inside the shape rather than on it. */
export const outline = (colour: string) => `inset 0 0 0 1px ${colour}`;

/** The two typefaces, as divan-tokens.css spells `--font-sans` and
 *  `--font-mono`. Geist is loaded by divan-components.css. */
export const SANS = '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

// ── the older vocabulary ────────────────────────────────────────────────────

/** The panel's screens speak a palette that predates Divan — `surface`,
 *  `mute`, `accent`, `hair` — and they are not being rewritten in this ticket.
 *  So `C` stays, and every one of its names is now one of the tokens above: the
 *  same table under the older names, which is why the screens follow both
 *  themes without a line of theirs changing.
 *
 *  Most of it is a token renamed. The decisions, all of them recorded in
 *  `design/divan/TOKENS.md`:
 *
 *   · `mute` and `faint` are both `--ink3`. The panel grew four tiers of text;
 *     the frames draw three, and they put mono meta, timestamps and
 *     placeholders in the same one.
 *   · `accent` is `--ink`, with `--on-ink` on it: the design's primary fill.
 *     Red is kept for trouble and is never a fill.
 *   · `accentSoft` — the panel's "this one is selected" colour — is `--ink`.
 *     The frames draw a selected nav item, chip or tab in the primary ink and
 *     the rest in `--ink3`, and nothing in them is a lighter accent.
 *   · `info` is `--run`. The frames draw no blue at all; what the panel painted
 *     blue is work in progress, and in Divan that is the green.
 *   · `hair` is `--line`. It was a near-black used as a separator, which is
 *     what a hairline is; the three places that used it as a fill now say `bg`,
 *     the tone the frames put inside a card.
 *   · `surface3` is `--sLift`, the surface that is being held open.
 */
export const C = {
  /** The page. */
  bg: T.bg,
  /** A card, a row, a chip, a panel. */
  surface: T.s1,
  /** A quiet fill: a selected segment, an icon well, a button face. */
  surface2: T.s2,
  /** Held open: a details panel, a hovered menu row. */
  surface3: T.sLift,
  /** An inset inside a card: a code block, a log, a track. */
  inset: T.bg,
  /** A separator. */
  hair: T.line,

  text: T.ink,
  text2: T.ink2,
  mute: T.ink3,
  faint: T.ink3,
  /** Text and glyphs on top of a filled accent. */
  onAccent: T.onInk,
  /** Text on top of amber — the one pair the frames spell out. */
  onWarn: T.onAmber,

  /** The filled control — a primary button, send, a switch thrown on — is
   *  the design's primary fill, `--ink` under `--on-ink`: red is a dot or a
   *  word and never a fill. */
  accent: T.ink,
  /** The selected one of anything. */
  accentSoft: T.ink,
  accentTint: T.redBg,
  accentRing: T.red,

  ok: T.run, okBg: T.runBg, okLine: T.run,
  warn: T.amber, warnBg: T.amberBg, warnLine: T.amberRing,
  danger: T.red, dangerBg: T.redBg, dangerLine: T.red,
  info: T.run, infoBg: T.runBg, infoLine: T.run,

  border: T.line,
  borderStrong: T.line2,

  /** Behind a modal or a sheet. */
  scrim: T.scrim,
} as const;

/** The corners the older screens are drawn on, each landed on one of the
 *  design's five. */
export const R = {
  badge: RADIUS.sm, btn: RADIUS.sm, input: RADIUS.sm, card: RADIUS.md, media: RADIUS.md,
  chip: RADIUS.pill, bubble: RADIUS.lg, composer: RADIUS.xl,
} as const;

/** Colour for a chat's status dot, and for the row that carries it. */
export function statusColor(status: string): string {
  if (status === 'running') return C.info;
  if (status === 'awaiting_approval') return C.warn;
  return C.faint;
}
