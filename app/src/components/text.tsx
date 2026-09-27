import React, { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { family, MONO, useColors } from '../theme';

/** What a nested run of text inherits from the one around it. React Native
 *  already passes colour and size down; the font file is ours to pass, because
 *  each weight of Inter and JetBrains Mono is a family of its own. */
const Inherit = createContext<{ weight?: TextStyle['fontWeight']; mono: boolean } | null>(null);

export type TxtProps = TextProps & { mono?: boolean };

/** Every string in the app goes through this: Inter by default, JetBrains Mono
 *  with `mono` (or `fontFamily: MONO`), and `fontWeight` turned into the file
 *  that has that weight. */
export const Text = forwardRef<RNText, TxtProps>(function Text({ style, mono, ...rest }, ref) {
  const c = useColors();
  const parent = useContext(Inherit);
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const weight = flat.fontWeight ?? parent?.weight;
  const isMono = mono ?? (flat.fontFamily === MONO ? true : parent?.mono ?? false);
  // A family spelled out in full (markdown's own styles) is taken as given.
  const explicit = flat.fontFamily && flat.fontFamily !== MONO ? flat.fontFamily : null;
  const own: TextStyle = { fontFamily: explicit ?? family(weight as any, isMono), fontWeight: undefined };
  return (
    <Inherit.Provider value={{ weight, mono: isMono }}>
      <RNText ref={ref} {...rest}
        style={parent ? [flat, own] : [{ color: c.ink, fontSize: 15 }, flat, own]} />
    </Inherit.Provider>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps & { mono?: boolean }>(
  function TextInput({ style, mono, placeholderTextColor, ...rest }, ref) {
    const c = useColors();
    const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
    const isMono = mono ?? flat.fontFamily === MONO;
    return (
      <RNTextInput ref={ref} placeholderTextColor={placeholderTextColor ?? c.faint}
        selectionColor={c.accent} keyboardAppearance={c.scheme} {...rest}
        style={[{ color: c.ink, fontSize: 15, padding: 0 }, flat,
          { fontFamily: family(flat.fontWeight as any, isMono), fontWeight: undefined }]} />
    );
  });
