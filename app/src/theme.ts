import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { DARK, LIGHT, scrim, type Scheme, shadows, type Tokens, tokensFor, veil } from './tokens';

export * from './tokens';

/** The whole palette, twice, under the names the screens already use. Every
 *  screen was drawn in both, element for element, and these are the pairs: a
 *  value never appears on one side without its counterpart on the other.
 *  Nothing on screen picks a colour outside this table, and this table picks
 *  nothing outside `tokens.ts`, which is the design's own. The app follows the
 *  phone's own appearance. */
export interface Palette {
  scheme: 'light' | 'dark';
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
 *   · `scrim` and `veil` are derived in `tokens.ts`, where the reason is. */
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

/** Normally nothing: the app follows the phone and there is no switch in it,
 *  because the phone already has one. The design gallery is the exception —
 *  the frames exist in both themes and the point of the gallery is to be held
 *  up against them, so it can ask a subtree to be drawn in the other one. */
const Forced = createContext<Scheme | null>(null);

export function ForceScheme({ scheme, children }: { scheme: Scheme | null; children: ReactNode }) {
  // `createElement` rather than JSX so that the palette stays a `.ts` file:
  // every script and document in the repository points at `src/theme.ts`.
  return createElement(Forced.Provider, { value: scheme }, children);
}

export function useScheme(): Scheme {
  const forced = useContext(Forced);
  const phone = useColorScheme();
  return forced ?? (phone === 'dark' ? 'dark' : 'light');
}

export function useColors(): Palette {
  return useScheme() === 'dark' ? dark : light;
}

/** The design's own sixteen names, for anything drawn from the Divan frames.
 *  `useColors` is the same table under the names the older screens use. */
export function useTokens(): Tokens {
  return tokensFor(useScheme());
}

/** Font families as registered in the root layout. React Native cannot pick a
 *  weight out of a family of static files, so each weight is its own family
 *  and `Text` maps `fontWeight` onto it. */
export const FONTS = {
  'Inter-Regular': require('../assets/fonts/Inter-Regular.ttf'),
  'Inter-Medium': require('../assets/fonts/Inter-Medium.ttf'),
  'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
  'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
  'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrainsMono-Medium': require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  'JetBrainsMono-SemiBold': require('../assets/fonts/JetBrainsMono-SemiBold.ttf'),
};

/** Stands in for a font family in a style: `Text` swaps it for the mono file
 *  of the right weight. */
export const MONO = 'mono';

export function family(weight: string | number | undefined, mono: boolean): string {
  const w = Number(weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : weight) || 400;
  if (mono) return w >= 600 ? 'JetBrainsMono-SemiBold' : w >= 500 ? 'JetBrainsMono-Medium' : 'JetBrainsMono-Regular';
  return w >= 700 ? 'Inter-Bold' : w >= 600 ? 'Inter-SemiBold' : w >= 500 ? 'Inter-Medium' : 'Inter-Regular';
}

/** CSS letter-spacing is in em; React Native's is in points. */
export const em = (size: number, e: number) => size * e;

/** The provider's two-letter mark, as the design draws it. */
export function providerMark(provider: string): string {
  return provider === 'codex' ? 'Cx' : 'Cl';
}
