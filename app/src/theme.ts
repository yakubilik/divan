import { useColorScheme } from 'react-native';

/** The whole palette, twice. Every screen was drawn in both, element for
 *  element, and these are the pairs: a value never appears on one side
 *  without its counterpart on the other. Nothing on screen picks a colour
 *  outside this table. The app follows the phone's own appearance. */
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

const SHADOW_INK = 'rgba(28,27,22,';

export const light: Palette = {
  scheme: 'light',
  bg: '#FBFAF8', card: '#FFFFFF', fill: '#F1F0EB', line: '#ECEAE3', lineStrong: '#DEDBD2',
  ink: '#1C1B18', onInk: '#FBFAF8', text2: '#3C3A33', muted: '#6A685F', faint: '#9C9A8F',
  segOn: '#FFFFFF', code: '#FAF9F6',
  warn: '#B5852B', warnBg: '#F7EFDB', ok: '#3F7A52', okBg: '#E7F1EA', danger: '#B14A33', dangerBg: '#F8E3DB',
  accent: '#FF5A48', accentText: '#FF373D', accentTint: '#FFE4DD',
  scrim: 'rgba(28,27,22,.35)', veil: 'rgba(251,250,248,.92)', halo: 'rgba(28,27,22,.12)',
  spinTrack: 'rgba(28,27,22,.15)', stripe: '#E6E4DD',
  shadow: {
    card: `0 1px 2px ${SHADOW_INK}.04), 0 4px 10px -6px ${SHADOW_INK}.08)`,
    pill: `0 1px 2px ${SHADOW_INK}.05)`,
    seg: `0 1px 2px ${SHADOW_INK}.08)`,
    menu: `0 24px 56px -16px ${SHADOW_INK}.35)`,
    pop: `0 24px 56px -16px ${SHADOW_INK}.3)`,
    raised: `0 8px 28px -10px ${SHADOW_INK}.13)`,
    knob: `0 1px 2px ${SHADOW_INK}.2)`,
  },
};

export const dark: Palette = {
  scheme: 'dark',
  bg: '#17160F', card: '#242219', fill: '#211F17', line: '#2D2B21', lineStrong: '#3F3C30',
  ink: '#F2F0E8', onInk: '#17160F', text2: '#D2CFC5', muted: '#9E9C90', faint: '#706E63',
  segOn: '#3F3C30', code: '#1C1B13',
  warn: '#D9A84A', warnBg: '#2F2915', ok: '#6FAE82', okBg: '#1F2D23', danger: '#E0735A', dangerBg: '#311E16',
  accent: '#FF5A48', accentText: '#FF8B72', accentTint: '#3A241C',
  scrim: 'rgba(0,0,0,.55)', veil: 'rgba(23,22,15,.92)', halo: 'rgba(242,240,232,.15)',
  spinTrack: 'rgba(242,240,232,.2)', stripe: '#2D2B21',
  shadow: {
    card: `0 1px 2px ${SHADOW_INK}.04), 0 4px 10px -6px ${SHADOW_INK}.08)`,
    pill: `0 1px 2px ${SHADOW_INK}.05)`,
    seg: `0 1px 2px ${SHADOW_INK}.08)`,
    menu: '0 24px 56px -16px rgba(0,0,0,.55)',
    pop: '0 24px 56px -16px rgba(0,0,0,.6)',
    raised: `0 8px 28px -10px ${SHADOW_INK}.13)`,
    knob: `0 1px 2px ${SHADOW_INK}.2)`,
  },
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
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
