/** The New ticket screen's parts, out of the design system's and nothing else.
 *
 *  Every shape here was measured off `design/divan/frames/08-mobile8-*.html`
 *  (S9, the fastest screen). What the screen *decides* — which machine takes
 *  the card, what is enough to file, what the request carries — is
 *  `src/compose.ts`, where a check can reach it without a phone.
 *
 *  Colour never comes from here: it is asked of the token table, and the parts
 *  these are built out of (`components/divan`) bring their own.
 *
 *  There is no field in this file for an executor, a goal, a criterion or a
 *  test. That is not an omission — S9 draws none, and the mono line under the
 *  box is the screen saying so out loud. */
import React from 'react';
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './text';
import { Icon } from './icon';
import { Monogram, Pill, Tap } from './divan';
import { LINE_HEIGHT, SUMMARY_LINES } from '../compose';
import { em, RADIUS, useTokens, type State } from '../theme';

// ── 1 · the bar over it ─────────────────────────────────────────────────────

/** S9's head: `padding:8px 20px 12px`, the way out on the left at 15 pt medium
 *  in `ink2`, and the product this is for as a chip at the far end — `height:32;
 *  padding:0 10px 0 6px; border-radius:16` on `s1` with a hairline round it, a
 *  20 pt monogram, the name at 13 pt medium and a chevron.
 *
 *  The chevron opens the list below (`ProjectRow`). It is drawn only where
 *  there is a second product to choose: a chevron that opens nothing is worse
 *  than no chevron. */
export function ComposeBar({ cancel, project, index, open, onCancel, onProject }: {
  cancel: string;
  /** The product the card is being written for. Absent while there is none. */
  project?: string | null;
  index?: number | null;
  /** The list under it is open. */
  open?: boolean;
  onCancel: () => void;
  /** Absent on a phone with one product: the chip is then a label. */
  onProject?: () => void;
}) {
  const t = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center',
                   paddingTop: 8, paddingHorizontal: 20, paddingBottom: 12 }}>
      <Tap onPress={onCancel} style={{ paddingVertical: 6, paddingRight: 16 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: t.ink2 }}>{cancel}</Text>
      </Tap>
      {!!project && (
        <Tap onPress={onProject}
          style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6,
                   height: 32, borderRadius: 16, paddingLeft: 6, paddingRight: 10,
                   backgroundColor: t.s1, borderWidth: 1, borderColor: t.line }}>
          <Monogram name={project} index={index ?? null} size={20} />
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500' }}>{project}</Text>
          {!!onProject && <Icon name={open ? 'expand_less' : 'expand_more'} size={14} color={t.ink} />}
        </Tap>
      )}
    </View>
  );
}

/** …and the list the chevron opens: the project bar's own chips, in the page
 *  rather than over it. A picker that covered the two boxes would cover the
 *  half-written card the product is being chosen for. */
export function ProjectRow({ projects, value, onPick, style }: {
  projects: { key: string; label: string; state: State }[];
  value: string | null;
  onPick: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 6,
                    paddingHorizontal: 20, paddingBottom: 10 }, style]}>
      {projects.map((p) => (
        <Pill key={p.key} label={p.label} dot={p.state}
          face={p.key === value ? 'ink' : 'surface'} onPress={() => onPick(p.key)} />
      ))}
    </View>
  );
}

// ── 2 · the two boxes ───────────────────────────────────────────────────────

/** The title: `font:600 24px/1.25; letter-spacing:-.015em`, and the one thing
 *  on the screen that is required. It is the page's own heading as well as its
 *  field — there is no label over it, because the screen is nothing else. */
export function TitleBox({ value, onChangeText, placeholder, editable }: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable?: boolean;
}) {
  const t = useTokens();
  return (
    <TextInput value={value} onChangeText={onChangeText} editable={editable !== false}
      autoFocus multiline placeholder={placeholder} placeholderTextColor={t.ink3}
      style={{ fontSize: 24, lineHeight: 24 * 1.25, fontWeight: '600',
               letterSpacing: em(24, -0.015), color: t.ink }} />
  );
}

/** …and the card's own two or three sentences, in the same fixed three-line
 *  space the ticket's human face reads them in (S9's own note): `height:72;
 *  font:400 16px/24px` in `ink2`. Fixed, so that the buttons under it do not
 *  move down the page while the thumb is on its way to them.
 *
 *  The number under it counts and nothing else: the box takes what is typed
 *  into it and that is what is filed, which is what the desktop's composer
 *  does with the same field (`src/compose.ts` `SUMMARY_MAX`). */
export function SentenceBox({ value, onChangeText, placeholder, editable }: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable?: boolean;
}) {
  const t = useTokens();
  return (
    <TextInput value={value} onChangeText={onChangeText} editable={editable !== false}
      multiline placeholder={placeholder} placeholderTextColor={t.ink3}
      style={{ height: SUMMARY_LINES * LINE_HEIGHT, textAlignVertical: 'top',
               fontSize: 16, lineHeight: LINE_HEIGHT, color: t.ink2 }} />
  );
}

// ── 3 · the line under them ─────────────────────────────────────────────────

/** S9's foot: a hairline, `padding-top:10`, and one mono line at 11 pt in
 *  `ink3` — what is *not* being asked for on the left, and how much of the box
 *  is used on the right.
 *
 *  The left half is the whole promise of this screen written down where it can
 *  be read before the button is pressed. */
export function ComposeFoot({ note, count, style }: {
  note: string;
  count: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8,
                    borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 }, style]}>
      <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: t.ink3 }}>{note}</Text>
      <Text mono style={{ marginLeft: 'auto', fontSize: 11, color: t.ink3 }}>{count}</Text>
    </View>
  );
}
