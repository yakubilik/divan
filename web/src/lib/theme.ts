/** Divan's palette on the desktop, and the switch between its two themes.
 *
 *  Every colour here was read out of a frame's own CSS custom properties
 *  (`design/divan/frames/12-web12-*.html` and `13-web13-*` — the same desktop
 *  screens dark and light — and `14-web14-*` and `15-web15-*` for the parts the
 *  later screens need), not chosen here. The frames open every screen with the
 *  same block of sixteen declarations, which is why this table has exactly
 *  those sixteen and no favourites of its own; `design/divan/TOKENS.md` says
 *  which frame each value came from, and a disagreement between this file and
 *  an artboard is settled by the artboard.
 *
 *  The frames are deliberately not in this repository — they are private and
 *  this repository is public — so `scripts/test-divan.mjs` carries a
 *  transcription of the two blocks and holds this table to it.
 *
 *  Nothing on screen reads a value out of this file directly. Both themes are
 *  written into the document as CSS custom properties (`themeCss`), and what a
 *  component reads is a reference to one of them: `T.ink3` is the string
 *  `var(--dv-ink3)`. That is what makes the switch free — the whole panel
 *  changes theme without a React render, and there is no second copy of the
 *  palette to keep in step.
 */

import { useEffect, useReducer } from 'react';

export type Scheme = 'light' | 'dark';

export interface Tokens {
  scheme: Scheme;
  /** The page. `--bg` */
  bg: string;
  /** The first surface: a card, a column, a panel, a chip. `--s1` */
  s1: string;
  /** The second surface: a selected tab, an icon well, a quiet fill. Above
   *  `s1` in the dark, below `bg` in the light — in both, the tone a selected
   *  thing takes. `--s2` */
  s2: string;
  /** The same surface a step further from the page: what is being held or is
   *  open over something else. Not one of the sixteen — the desktop frames
   *  never draw a card in the air — so it is borrowed from the phone's
   *  `--s2` of Mobile3's drag frame, and on the light side from Mobile4 C1.
   *  Recorded as borrowed in `design/divan/TOKENS.md`. */
  sLift: string;
  /** Hairline: a separator, the ring every card on the desktop wears
   *  (`box-shadow:0 0 0 1px var(--line)`, 56 times across the web frames).
   *  `--line` */
  line: string;
  /** The emphasised line: an outline button, an unfilled track, the rule
   *  between the nav and the project chips. `--line2` */
  line2: string;
  /** Primary text, and the button drawn in it. `--ink` */
  ink: string;
  /** Secondary text: a description, the body line under a title. `--ink2` */
  ink2: string;
  /** Meta: mono numbers, timestamps, placeholders, a column's aside. `--ink3` */
  ink3: string;
  /** Needs you. `--amber` */
  amber: string;
  /** Behind it. `--amberBg` */
  amberBg: string;
  /** Text on top of amber — the one pair the frames spell out. `--onAmber` */
  onAmber: string;
  /** The amber drawn as a ring rather than a fill, around the panel of an agent
   *  that is asking: Web12 W1 and W2's `inset 0 0 0 1px rgba(234,182,90,.3)`,
   *  and Web13 W3 and W4's `rgba(156,98,16,.35)` on the light side. (The phone
   *  draws the same ring a hundredth lighter; the value here is the desktop's
   *  own, which is the frame this file is extracted from.) */
  amberRing: string;
  /** Stuck, failed, deleted. `--red` */
  red: string;
  redBg: string;
  /** Running, healthy, reachable. `--run` */
  run: string;
  runBg: string;
  /** What a shadow is made of in this theme. `--sh` */
  sh: string;
  /** Behind a modal, a sheet or a lightbox. Derived, not extracted: the
   *  desktop frames draw no dim — the machine drawer of Web15 is a page, not a
   *  panel over one — so the dark side is `--sh` itself and the light side is
   *  the same ink at the weight the panel already dimmed with. Recorded as
   *  derived in `design/divan/TOKENS.md`. */
  scrim: string;
}

/** Web14 W6 · Project · Quire · Overview tab — one of the dark frames that
 *  declare the whole block, character for character. (Web12 W1 and W2 declare
 *  fourteen of the sixteen and agree with all but the last decimal of
 *  `--line2` and the three washes.) `sLift`, `amberRing` and `scrim` are not in
 *  that block and say above where they come from. */
export const DARK: Tokens = {
  scheme: 'dark',
  bg: '#131210', s1: '#1C1B18', s2: '#26241F', sLift: '#2A2822',
  line: 'rgba(236,232,225,.08)', line2: 'rgba(236,232,225,.2)',
  ink: '#EDE9E2', ink2: '#A9A499', ink3: '#8C877E',
  amber: '#EAB65A', amberBg: 'rgba(234,182,90,.11)', onAmber: '#1A1609',
  amberRing: 'rgba(234,182,90,.3)',
  red: '#EE6D55', redBg: 'rgba(238,109,85,.12)',
  run: '#7CC6A6', runBg: 'rgba(124,198,166,.1)',
  sh: 'rgba(0,0,0,.5)',
  scrim: 'rgba(0,0,0,.5)',
};

/** Web15 W12 · Machine drawer · Machines — one of the eight light frames of
 *  that group, all of which declare the whole block character for character.
 *  (Web13 W3 and W4 declare fourteen of the sixteen and agree with every one.) */
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
  scrim: 'rgba(27,26,23,.35)',
};

export const tokensFor = (scheme: Scheme): Tokens => (scheme === 'dark' ? DARK : LIGHT);

/** The one value in the table that is not in a frame at all, and the one whose
 *  value is in a frame but whose role is not. Named here so that a third of
 *  either cannot appear without `design/divan/TOKENS.md` gaining a line about
 *  it — a check holds the two lists together. */
export const DERIVED = ['scrim'] as const;
export const BORROWED = ['sLift'] as const;

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
    `html,body{background:${T.bg};color:${T.ink}}`,
    `::-webkit-scrollbar{width:10px;height:10px}`,
    `::-webkit-scrollbar-thumb{background:${T.line2};border-radius:5px;`
      + `border:3px solid transparent;background-clip:content-box}`,
    `::-webkit-scrollbar-thumb:hover{background:${T.ink3};border:3px solid transparent;`
      + `background-clip:content-box}`,
    `::-webkit-scrollbar-track{background:transparent}`,
    `::selection{background:${T.s2}}`,
  ].join('\n');
}

// ── the switch ──────────────────────────────────────────────────────────────

/** What the reader asked for, which is not the same as what is on screen:
 *  `system` is the default and follows the computer, and the other two are a
 *  decision that outlives the tab. */
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
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch { return 'system'; }
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

/** White, which the frames write as `#fff` on a monogram and on an executor's
 *  square. It belongs to the mark rather than to the theme — a coloured square
 *  brings its own background and does not follow the page — which is why it is
 *  a constant here and not a token. */
export const ON_COLOUR = '#FFFFFF';

/** A project's monogram colour. The frames pick these out of a small ramp of
 *  equally dark, equally muted hues so that four projects in a list are told
 *  apart by hue alone and none of them shouts; white sits on every one.
 *
 *  Written `oklch(0.48 0.07 H)` on the artboard — Web12 W1 draws the first four
 *  on one dashboard (Quire 265, Kanji Daily 320, Hush 210, The Long Walk 130)
 *  and the fifth, 95, belongs to the project Mobile7 S6 invents. Converted to
 *  the sRGB a browser shows, so that the phone and the panel spell the same
 *  project the same colour. */
export const MONOGRAM = ['#4A5D86', '#6F5076', '#226873', '#50663A', '#706332'] as const;

/** Which of them a project gets. A screen with the whole list in front of it
 *  passes the project's place in that list, and four projects get four
 *  different hues, which is the frames' own arrangement; a screen holding one
 *  project and no list falls back to the name, which at least keeps the same
 *  project the same colour everywhere it appears. */
export function monogram(name: string, index?: number | null): string {
  if (index != null) return MONOGRAM[((index % MONOGRAM.length) + MONOGRAM.length) % MONOGRAM.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM[h % MONOGRAM.length];
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

/** The dashed Coder, which only Mobile3's drag frame and Web12's own card table
 *  draw: `1.5px dashed oklch(0.6 0.1 275)` around `oklch(0.72 0.1 275)`,
 *  converted the same way as the monograms. */
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

/** The corners the desktop frames draw, and nothing else. */
export const RADIUS = {
  /** A status chip: `padding:4px 8px;border-radius:7px`. */
  chip: 7,
  /** An executor's square, a small mark. */
  mark: 8,
  /** A list row's icon well, a small button, the selected tab inside its
   *  track: `height:32px;border-radius:9px`, 33 times in Web15. */
  well: 9,
  /** A top-bar item and a side-panel row: `height:34px;border-radius:10px`. */
  nav: 10,
  /** A button that ends a card: `height:34px;border-radius:11px` (Web14 W9). */
  button: 11,
  /** The tab strip's track, and a card in the chat panel. */
  tab: 12,
  /** A counter tile, a ticket card on the board. */
  tile: 14,
  /** A card, a board column, the chat panel, the drawer. */
  card: 16,
  /** A pill: `height:32px;border-radius:16px`, 46 times across the frames. */
  pill: 16,
  /** The composer inside a panel: `height:40px;border-radius:20px`. */
  field: 20,
  /** The command bar across the bottom: `height:52px;border-radius:26px`. */
  bar: 26,
} as const;

/** Heights and spans the desktop frames repeat. */
export const SIZE = {
  /** The top bar: `height:58px`, in thirteen of the frames. */
  topBar: 58,
  /** An item in it, and a row of the side panel's list. */
  navItem: 34,
  /** A pill, and a small button — a row's own actions in Web15 W12. */
  pill: 32,
  /** The button a card or an empty state ends on. */
  button: 34,
  /** A status dot; the hollow one is the same circle at 1.5px. */
  dot: 7,
  /** An executor's square on a card or a panel head. */
  executor: 28,
  /** A project's monogram on a project card (Web12 W1), 46 in a page head. */
  monogram: 34,
  /** A list row's icon well, and the glyph in it. */
  rowWell: 32,
  rowIcon: 17,
  /** The side panel of Web15: `grid-template-columns:260px minmax(0,1fr)`. */
  sidePanel: 260,
  /** Its rows. */
  sideRow: 40,
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
} as const;

/** An outline, which the frames draw inside the shape rather than on it. */
export const outline = (colour: string) => `inset 0 0 0 1px ${colour}`;

export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

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
 *   · `accent` is `--red`. The frames give the send button `--ink` and keep red
 *     for trouble; the panel's accent is the colour of Allow, of the recording
 *     dot and of delete, which is that red.
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
  /** Text and glyphs on top of a filled accent or a coloured mark. */
  onAccent: ON_COLOUR,
  /** Text on top of amber — the one pair the frames spell out. */
  onWarn: T.onAmber,

  accent: T.red,
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

/** The corners the older screens are drawn on. Left as they were — this ticket
 *  replaces the palette and adds the parts; the screens that use these are the
 *  ones it is not rebuilding. */
export const R = {
  badge: 6, btn: 8, input: 10, card: 12, media: 14, chip: 16, bubble: 18, composer: 26,
} as const;

/** Colour for a chat's status dot, and for the row that carries it. */
export function statusColor(status: string): string {
  if (status === 'running') return C.info;
  if (status === 'awaiting_approval') return C.warn;
  return C.faint;
}
