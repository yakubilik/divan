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
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
// Both boxes go through the app's own input rather than React Native's, the
// way every other field in the app does (`components/card` `SayBox`): it is
// what turns a weight into the Geist file that has it, and what brings the
// caret colour, the keyboard's own theme and the padding the design draws.
import { Text, TextInput } from './text';
import { Icon } from './icon';
import { Monogram, Pill, StatusDot, Tap } from './divan';
import { measure, openMenu } from './overlay';
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
export function TitleBox({ value, onChangeText, placeholder, editable, label }: {
  value: string;
  label?: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable?: boolean;
}) {
  const t = useTokens();
  return (
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={editable !== false}
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
export function SentenceBox({ value, onChangeText, placeholder, editable, label }: {
  value: string;
  label?: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable?: boolean;
}) {
  const t = useTokens();
  return (
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={editable !== false}
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

// ── 2 · the Dashboard's Composer (HANDOVER §3, §5) ──────────────────────────

/** One option in a chip's menu. */
export interface ChipOption { value: string; label: string; checked: boolean }

/** One of the four chips under the field. */
export interface ComposeChip {
  name: string;
  value: string;
  /** Not the default: drawn in ink, with an × back to it. */
  changed: boolean;
  /** The amber dot and its word (`low quota`), or nothing. */
  warn?: string | null;
  options: ChipOption[];
  empty: string;
  onPick: (value: string) => void;
  onReset: () => void;
  resetLabel: string;
}

/** The Composer on the phone (DashboardPhone): the scope over the field, the
 *  field, the mode and send under it, and the chips in one row that scrolls
 *  sideways. A chip opens the app's own menu under it — never a sheet, never a
 *  system list — and nothing opens unless a chip is pressed. */
export function Composer({ to, scope, onClearScope, clearLabel, addLabel, scopeOptions, emptyScope,
  label, placeholder, text, onText, modes, mode, onMode, sendLabel, onSend, busy, chips, more, note, noteTone,
  locked }: {
  to: string;
  /** The scope is the page's product and cannot be taken off: the chip is
   *  drawn with no × and is not a press. */
  locked?: boolean;
  scope: { name: string; index: number | null } | null;
  onClearScope: () => void;
  clearLabel: string;
  addLabel: string;
  scopeOptions: { options: ChipOption[]; empty: string; onPick: (value: string) => void };
  emptyScope: string;
  label: string;
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  modes: { key: string; label: string }[];
  mode: string;
  onMode: (key: string) => void;
  sendLabel: string;
  onSend: () => void;
  busy?: boolean;
  chips: ComposeChip[];
  more?: { label: string; onPress: () => void } | null;
  note?: string | null;
  noteTone?: 'red' | 'ink3';
}) {
  const t = useTokens();
  const add = React.useRef<View>(null);
  return (
    <View style={{ backgroundColor: t.sLift, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: t.line,
                   paddingTop: 16, paddingHorizontal: 16, paddingBottom: 10,
                   boxShadow: `0 16px 36px -20px ${t.sh}` }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Text mono style={{ fontSize: 11.5, color: t.ink3 }}>{to}</Text>
        {scope && locked ? (
          <View accessibilityLabel={scope.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, borderRadius: RADIUS.pill,
                     paddingLeft: 6, paddingRight: 11, backgroundColor: t.ink }}>
            <Monogram name={scope.name} index={scope.index} size={18} />
            <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.onInk }}>{scope.name}</Text>
          </View>
        ) : scope ? (
          <Tap onPress={onClearScope}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            <View accessibilityLabel={clearLabel}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, borderRadius: RADIUS.pill,
                       paddingLeft: 6, paddingRight: 11, backgroundColor: t.ink }}>
              <Monogram name={scope.name} index={scope.index} size={18} />
              <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.onInk }}>{scope.name}</Text>
              <Text style={{ fontSize: 12.5, color: t.onInk, opacity: 0.6 }}>×</Text>
            </View>
          </Tap>
        ) : (
          <View ref={add} collapsable={false}>
            <Tap onPress={() => void openChip(add, scopeOptions.options, scopeOptions.empty, scopeOptions.onPick)}
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <View style={{ height: 28, borderRadius: RADIUS.pill, paddingHorizontal: 11, justifyContent: 'center',
                             borderWidth: 1, borderStyle: 'dashed', borderColor: t.line2 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink3 }}>{addLabel}</Text>
              </View>
            </Tap>
          </View>
        )}
        {!locked && <Text mono style={{ marginLeft: 'auto', fontSize: 11.5, color: t.ink3 }}>{emptyScope}</Text>}
      </View>
      <TextInput accessibilityLabel={label} value={text} onChangeText={onText} placeholder={placeholder}
        placeholderTextColor={t.ink3} multiline
        style={{ fontSize: 16, lineHeight: 24, minHeight: 52, color: t.ink, paddingHorizontal: 4, paddingVertical: 2 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, marginTop: 8,
                     borderTopWidth: 1, borderTopColor: t.line2 }}>
        <View style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: RADIUS.pill, backgroundColor: t.line2 }}>
          {modes.map((m) => {
            const on = m.key === mode;
            return (
              <Pressable key={m.key} accessibilityRole="button" accessibilityState={{ selected: on }}
                onPress={() => onMode(m.key)} hitSlop={{ top: 7, bottom: 7 }}
                style={{ height: 30, paddingHorizontal: 10, borderRadius: RADIUS.pill, justifyContent: 'center',
                         backgroundColor: on ? t.s2 : 'transparent' }}>
                <Text style={{ fontSize: 12.5, fontWeight: '500', color: on ? t.ink : t.ink2 }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityLabel={sendLabel} accessibilityRole="button" onPress={busy ? undefined : onSend}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                   backgroundColor: text.trim() && !busy ? t.ink : t.line2 }}>
          <Icon name="arrow_upward" size={20} color={text.trim() && !busy ? t.onInk : t.ink3} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 8 }}
        contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
        {chips.map((c) => <ChipButton key={c.name} chip={c} />)}
        {!!more && (
          <Tap onPress={more.onPress} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>{more.label}</Text>
          </Tap>
        )}
      </ScrollView>
      {!!note && (
        <Text mono style={{ fontSize: 11.5, lineHeight: 16, marginTop: 6, color: noteTone === 'red' ? t.red : t.ink3 }}>
          {note}
        </Text>
      )}
    </View>
  );
}

/** Open a chip's menu under it: the app's own popover (`components/overlay`). */
async function openChip(ref: React.RefObject<View | null>, options: ChipOption[], empty: string,
                        onPick: (value: string) => void) {
  const anchor = await measure(ref);
  openMenu({
    anchor, align: 'left',
    items: options.length
      ? options.map((o) => ({ label: o.label, checked: o.checked, onPress: () => onPick(o.value) }))
      : [{ kind: 'cancel', label: empty }],
  });
}

function ChipButton({ chip: c }: { chip: ComposeChip }) {
  const t = useTokens();
  const ref = React.useRef<View>(null);
  return (
    <View ref={ref} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Tap onPress={() => void openChip(ref, c.options, c.empty, c.onPick)}
        style={{ minHeight: 44, justifyContent: 'center' }}>
        <View accessibilityLabel={`${c.name}: ${c.value}${c.warn ? `, ${c.warn}` : ''}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, borderRadius: RADIUS.pill,
                   paddingLeft: 10, paddingRight: 8, backgroundColor: t.line2, borderWidth: 1,
                   borderColor: c.changed ? t.ink3 : t.line }}>
          <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink3 }}>{c.name}</Text>
          <Text style={{ fontSize: 12.5, fontWeight: '500', color: c.changed ? t.ink : t.ink2 }}>{c.value}</Text>
          {!!c.warn && <StatusDot state="asking" size={6} />}
          {!!c.warn && <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.amber }}>{c.warn}</Text>}
          <Icon name="expand_more" size={16} color={t.ink3} />
        </View>
      </Tap>
      {c.changed && (
        <Pressable accessibilityLabel={c.resetLabel} accessibilityRole="button" onPress={c.onReset}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 }}>
          <Icon name="close" size={16} color={t.ink2} />
        </Pressable>
      )}
    </View>
  );
}
