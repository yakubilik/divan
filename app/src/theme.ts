import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette, type Scheme, type Tokens, tokensFor } from './tokens';

/** The palette is plain data and lives next door with the tokens it is made
 *  of, so that a check can read it without a phone. What is left here is how a
 *  screen gets at it, and the two typefaces. */
export * from './tokens';

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
  'Geist-Regular': require('../assets/fonts/Geist-Regular.ttf'),
  'Geist-Medium': require('../assets/fonts/Geist-Medium.ttf'),
  'Geist-SemiBold': require('../assets/fonts/Geist-SemiBold.ttf'),
  'Geist-Bold': require('../assets/fonts/Geist-Bold.ttf'),
  'GeistMono-Regular': require('../assets/fonts/GeistMono-Regular.ttf'),
  'GeistMono-Medium': require('../assets/fonts/GeistMono-Medium.ttf'),
  'GeistMono-SemiBold': require('../assets/fonts/GeistMono-SemiBold.ttf'),
};

/** Stands in for a font family in a style: `Text` swaps it for the mono file
 *  of the right weight. */
export const MONO = 'mono';

export function family(weight: string | number | undefined, mono: boolean): string {
  const w = Number(weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : weight) || 400;
  if (mono) return w >= 600 ? 'GeistMono-SemiBold' : w >= 500 ? 'GeistMono-Medium' : 'GeistMono-Regular';
  return w >= 700 ? 'Geist-Bold' : w >= 600 ? 'Geist-SemiBold' : w >= 500 ? 'Geist-Medium' : 'Geist-Regular';
}

/** CSS letter-spacing is in em; React Native's is in points. */
export const em = (size: number, e: number) => size * e;

/** The provider's two-letter mark, as the design draws it. */
export function providerMark(provider: string): string {
  return provider === 'codex' ? 'Cx' : 'Cl';
}
