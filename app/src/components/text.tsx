import React, { createContext, forwardRef, useContext } from 'react';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { family, MONO, useColors } from '../theme';

/** What a nested run of text inherits from the one around it. React Native
 *  already passes colour and size down; the font file is ours to pass, because
 *  each weight of Geist and Geist Mono is a family of its own. */
const Inherit = createContext<{ weight?: TextStyle['fontWeight']; mono: boolean } | null>(null);

export type TxtProps = TextProps & { mono?: boolean };

/** Every string in the app goes through this: Geist by default, Geist Mono
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

/** What a selection is drawn in: orange, on both themes. The tint iOS used
 *  before was the system grey, which on the chat's surfaces barely showed. */
export const SELECTION = '#FF8C00';

/** Text a person can take part of.
 *
 *  A `selectable` <Text> on iOS cannot be dragged through: a long press offers
 *  Copy for the whole node and nothing else, so one sentence or one path out of
 *  an answer could not be had. A UITextView can, and a TextInput that is not
 *  editable is one — with the selection handles, the orange tint, and the
 *  links found and made tappable by iOS itself, since a nested run with an
 *  `onPress` does nothing inside it. Nested <Text> children keep their styles:
 *  the field draws them as one attributed string.
 *
 *  Android's <Text selectable> already selects a range, so it stays. */
export function SelectableText({ style, mono, children }: {
  style?: TextProps['style'];
  mono?: boolean;
  children?: React.ReactNode;
}) {
  const c = useColors();
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  if (Platform.OS !== 'ios') {
    return <Text selectable selectionColor={SELECTION} mono={mono} style={style}>{children}</Text>;
  }
  const isMono = mono ?? flat.fontFamily === MONO;
  const explicit = flat.fontFamily && flat.fontFamily !== MONO ? flat.fontFamily : null;
  return (
    <Inherit.Provider value={{ weight: flat.fontWeight, mono: isMono }}>
      <RNTextInput
        editable={false} multiline scrollEnabled={false}
        dataDetectorTypes="link" selectionColor={SELECTION}
        style={[{ color: c.ink, fontSize: 15 }, flat, {
          fontFamily: explicit ?? family(flat.fontWeight as any, isMono), fontWeight: undefined,
          padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0,
        }]}
      >
        {children}
      </RNTextInput>
    </Inherit.Provider>
  );
}
