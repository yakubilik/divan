/** The parts the Divan screens are made of.
 *
 *  Eleven screens follow this ticket, and none of them should have to decide
 *  again what a card is, how tall a pill stands or which grey a timestamp is.
 *  Everything here was measured off `design/divan/frames/*.html` — the frame
 *  and the option each part came from is named above it, and the numbers are
 *  the frame's own. A part that the phone frames never draw says so.
 *
 *  Colour never comes from here: every value is a token (`src/tokens.ts`), so
 *  a screen built out of these parts cannot introduce one of its own.
 *
 *  Six of them were measured off a *web* frame instead, and say which: the
 *  drawer's own Settings and Accounts pages (Web15 W16 and W18) are the only
 *  place the design draws a card of settings, a switch, a small button at the
 *  end of a row or a row washed because it is the one asking for something. The
 *  phone has all four and no artboard of its own for them, and a desktop frame
 *  in the same palette is a better reference than a guess. One part — the field
 *  — has no frame at all anywhere, and says so where it is.
 *
 *  The names are plain — `Card`, `Pill`, `EmptyState` — because a screen built
 *  from Divan imports this module and nothing else of the same shape. Where a
 *  screen needs one of the older parts (`components/ui`), it imports it under
 *  the name it has there; the two are not meant to be mixed in one file.
 *
 *  A gallery of all of it is at `app/divan-gallery.tsx`, reachable from
 *  Settings in a development build. */
import React from 'react';
import { Pressable, View, type GestureResponderEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text, TextInput } from './text';
import { Sheet as SheetShell, SheetBar as _SheetBar, useSheet } from './sheet';
import {
  em, EXECUTORS, EXEC_PENDING_INK, EXEC_PENDING_LINE, monogram, ON_COLOUR, RADIUS, shadows, SIZE,
  STATE_MARK, stateColour, toneColours, useTokens,
  type ExecutorFace, type State, type Tokens, type Tone,
} from '../theme';

export { useSheet } from './sheet';

/** Press feedback, the same everywhere: the frames have no pressed state, so
 *  the app keeps the one it already uses. */
const dim = ({ pressed }: { pressed: boolean }) => (pressed ? { opacity: 0.6 } : null);

/** A `Pressable` where a press is optional: a card that goes somewhere is a
 *  button, and one that does not is a `View` that cannot swallow a touch.
 *
 *  Exported because a row inside a card is pressable too, and the feedback a
 *  press gets is the design system's to decide rather than each screen's. */
export function Tap({ onPress, onLongPress, holdMs, onPressOut, style, children }: {
  onPress?: () => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  /** How long a hold is, where the design says: the board's drag is 350 ms
   *  (`src/drag.ts HOLD_MS`) against the half second a `Pressable` takes by
   *  default. A number rather than the constant itself, because this file is the
   *  design system and knows nothing about a board. */
  holdMs?: number;
  /** The finger came up, however it came up. The board needs it: a card that was
   *  held and then let go without moving is a cancelled drag, and a press that
   *  ended is the only thing that says so. */
  onPressOut?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  if (!onPress && !onLongPress) return <View style={style}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} onPressOut={onPressOut}
      delayLongPress={holdMs}
      style={(st) => [style as ViewStyle, dim(st) as ViewStyle]}>{children}</Pressable>
  );
}

// ── 1 · card ────────────────────────────────────────────────────────────────

/** The block everything on a Divan screen sits in.
 *
 *  Mobile6 S3: `background:var(--s1); border-radius:16px; padding:12px 14px
 *  13px; gap:10px`, with a hairline ring drawn inside it. (Mobile1 V1's
 *  Needs-you card is the same shape at `padding:12px 12px 12px`; the padding
 *  taken here is S3's, which is the one four cards in a column agree on.)
 *
 *  The ring is the card's whole state vocabulary — `line` when it is ordinary,
 *  `amber` when it is asking, `red` when it has stopped — and Mobile3's drag
 *  frame gives a card being carried the lifted surface instead.
 *
 *  `bar` is that same drag frame's two-pixel green rule across the top of a
 *  card whose work is running, at the fraction of it that is done.
 *
 *  `inset: false` is the card whose contents are rows rather than a block — the
 *  agent roster of Mobile1 V2 (`padding:4px 14px`, each row `9px 0` over a
 *  `line`) and the system line of Mobile1 V1, which is one row 34 pt tall. The
 *  surface, the corner and the ring are the card's; the spacing inside it
 *  belongs to the rows, and a card that kept its own would push them apart.
 *
 *  `hollow` is the one card the frames draw with no surface at all: Mobile7 S5's
 *  block about a product nothing has touched in weeks, `border-radius:16px;
 *  padding:16px; box-shadow:inset 0 0 0 1px var(--line2)` over the page itself.
 *  It is a statement rather than a thing lying on the page, and the empty middle
 *  is what says so. */
export function Card({ ring = 'line', lifted, hollow, dashed, wash, bar, radius = RADIUS.card, inset = true,
                       onPress, onLongPress, holdMs, onPressOut, style, children }: {
  ring?: 'line' | 'amber' | 'red' | 'run' | 'none';
  lifted?: boolean;
  /** No surface, and the emphasised line around it (Mobile7 S5). */
  hollow?: boolean;
  /** …drawn as a `1.5px` dashed outline instead: the card nothing runs on,
   *  which on the board is the one a person owns (Mobile2 V5). */
  dashed?: boolean;
  /** …or on that tone's wash instead of the ordinary surface: Mobile3 D4's card
   *  that has just been dropped into In Progress, `background:runBg` inside a
   *  solid `run` ring. The one card on a board that is not quiet, and it is
   *  quiet again five seconds later. */
  wash?: Tone | null;
  bar?: number | null;
  radius?: number;
  /** The card's own padding. False where its children carry it. */
  inset?: boolean;
  onPress?: () => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  holdMs?: number;
  onPressOut?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const t = useTokens();
  const border = ring === 'none' ? 'transparent'
    : ring === 'amber' ? t.amberRing
    : ring === 'red' ? t.red
    : ring === 'run' ? t.run
    : lifted || hollow ? t.line2 : t.line;
  return (
    <Tap onPress={onPress} onLongPress={onLongPress} holdMs={holdMs} onPressOut={onPressOut}
      style={[{ backgroundColor: hollow || dashed ? 'transparent'
                  : wash ? toneColours(t, wash).bg : lifted ? t.sLift : t.s1,
                borderRadius: radius, overflow: 'hidden',
                borderWidth: 1, borderColor: border },
              dashed && { borderWidth: 1.5, borderColor: t.line2, borderStyle: 'dashed' },
              lifted && { boxShadow: shadows(t).pop }, style]}>
      {bar != null && (
        <View style={{ height: 2, width: `${Math.max(0, Math.min(1, bar)) * 100}%`, backgroundColor: t.run }} />
      )}
      {inset
        ? <View style={{ padding: 12, paddingHorizontal: 14, paddingBottom: 13, gap: 10 }}>{children}</View>
        : children}
    </Tap>
  );
}

// ── 2 · list row ────────────────────────────────────────────────────────────

/** A line of a plain list, one level deep and no further.
 *
 *  Mobile11 S16, the Machine tab: `padding:13px 4px; border-top:1px solid
 *  var(--line); gap:12`, a 32 pt well in `s2` holding a 17 pt glyph, a 15 pt
 *  medium title over a 12 pt grey line, and — only when there is something to
 *  say — a mono note in a state's colour before the chevron.
 *
 *  `boxed` is the same row inside a card rather than on the page (Web15 W16 and
 *  W18), which is where every setting and every sign-in is. The slots are what
 *  those two frames put in a row and S16 does not: a mark of the thing's own in
 *  the well's place, and a control at the end of it. One part rather than two,
 *  because a row is a row and there is one place its type and its spacing are
 *  decided. */
export function ListRow({ icon, lead, title, note, noteMono, noteLines, meta, monoMeta = true, tone, right,
                          onPress, onLongPress, first, boxed, wash, chevron = true, style }: {
  icon?: string;
  /** …or a mark of its own in the well's place: a tool's badge, a status dot,
   *  an agent's glyph. Web15 W16 draws its rows this way, with a 34 pt marked
   *  square where this page has an icon. */
  lead?: React.ReactNode;
  title: string;
  /** The grey summary line under it. */
  note?: string | null;
  /** …in mono, where it is data rather than a sentence: an address, a version,
   *  a commit. W16's own second lines are prose and are not. */
  noteMono?: boolean;
  /** How many lines that summary may take. One, unless the row is the only
   *  place a sentence has to go. */
  noteLines?: number;
  /** The word at the end: `all reachable`, `2h 14m`. */
  meta?: string | null;
  /** …set in mono, which is what a number or a timestamp is. A word that is
   *  neither — a tool's name, a mode — takes the page's own face. */
  monoMeta?: boolean;
  /** What colour that word is. Grey unless something is wrong. */
  tone?: Tone;
  /** A control in the chevron's place: a switch, a small button, a check.
   *  Web15 W18's rows all end on one. */
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** The first row of a list has no line above it. */
  first?: boolean;
  /** Inside a card rather than on the page: Web15 W18's `padding:14px 20px;
   *  gap:16`, and the summary a step larger because a card gives it the room.
   *  Mobile11 S16's rows are the other case, laid straight on the page at
   *  `13px 4px`, which is what this is without it. */
  boxed?: boolean;
  /** The one row on a page that is asking for something, washed in its tone —
   *  W16's key that expires in twelve days. */
  wash?: Tone | null;
  chevron?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress} onLongPress={onLongPress}
      style={[{ flexDirection: 'row', alignItems: 'center' },
              boxed ? { gap: 16, paddingVertical: 14, paddingHorizontal: 20 }
                    : { gap: 12, paddingVertical: 13, paddingHorizontal: 4 },
              !first && { borderTopWidth: 1, borderTopColor: t.line },
              wash ? { backgroundColor: toneColours(t, wash).bg } : null, style]}>
      {lead ?? (!!icon && (
        <View style={{ width: SIZE.rowWell, height: SIZE.rowWell, borderRadius: RADIUS.well,
                       backgroundColor: t.s2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={SIZE.rowIcon} color={t.ink2} />
        </View>
      ))}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {!!note && (
          <Text mono={noteMono} numberOfLines={noteLines ?? 1}
            style={{ fontSize: boxed ? (noteMono ? 12 : 13) : 12,
                     lineHeight: boxed && !noteMono ? 13 * 1.4 : undefined,
                     color: t.ink3, marginTop: 2 }}>{note}</Text>
        )}
      </View>
      {!!meta && (
        <Text mono={monoMeta} numberOfLines={1}
          style={{ fontSize: monoMeta ? 11.5 : 13, fontWeight: '500', flexShrink: 1,
                   color: tone ? toneColours(t, tone).fg : t.ink3 }}>{meta}</Text>
      )}
      {right}
      {chevron && <Icon name="chevron_right" size={16} color={t.ink3} />}
    </Tap>
  );
}

/** A run of those rows under a mono lowercase word, in a card of their own.
 *
 *  Web15 W18, the drawer's Settings: `background:s1; border-radius:16px;
 *  box-shadow:inset 0 0 0 1px var(--line)`, the group's name at `padding:12px
 *  20px 6px` in `500 11.5px` mono `ink3`, and every row under a hairline —
 *  including the first, because the name is above it.
 *
 *  Three short groups rather than one long list is the frame's own arrangement,
 *  and the lowercase name is what keeps a group from reading as a heading. */
export function Group({ label, children, style }: {
  label?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card inset={false} style={style}>
      {!!label && (
        <Text mono style={{ fontSize: 11.5, fontWeight: '500', color: t.ink3,
                            paddingTop: 12, paddingHorizontal: 20, paddingBottom: 6 }}>{label}</Text>
      )}
      {children}
    </Card>
  );
}

/** The small button that lives at the end of a row, or in a line of them under
 *  a card. Web15 W16's `Manage` and `Renew`, W18's `Change`: `height:32px;
 *  padding:0 12px; border-radius:9px`, `500 13px` inside a `line2` ring or
 *  `600 13px` on `ink`.
 *
 *  `danger` is the app's own third face and no frame's: sign out, revoke this
 *  phone. The frames never draw a destructive button, and the page's red is
 *  what the app has always said that in. */
export function RowButton({ label, face = 'outline', icon, busy, disabled, onPress, style }: {
  label: string;
  face?: 'ink' | 'outline' | 'danger';
  icon?: string;
  /** Working on it: the button stays where it is and stops answering. */
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const off = disabled || busy;
  const fg = face === 'ink' ? t.bg : face === 'danger' ? t.red : t.ink;
  return (
    <Tap onPress={off ? undefined : onPress}
      style={[{ height: 32, borderRadius: RADIUS.well, paddingHorizontal: 12, flexDirection: 'row',
                alignItems: 'center', justifyContent: 'center', gap: 6,
                backgroundColor: face === 'ink' ? t.ink : 'transparent' },
              face !== 'ink' && { borderWidth: 1, borderColor: face === 'danger' ? t.red : t.line2 },
              off && { opacity: 0.45 }, style]}>
      {!!icon && <Icon name={icon} size={15} color={fg} />}
      <Text numberOfLines={1}
        style={{ fontSize: 13, fontWeight: face === 'ink' ? '600' : '500', color: fg }}>{label}</Text>
    </Tap>
  );
}

/** On or off, at the end of a row. Web15 W18: `width:40px; height:24px;
 *  border-radius:12px` in `ink`, and the knob `18px` in `bg` 3 pt in from the
 *  end it is at. Off is the same shape in `line2`, which is the frame's own
 *  unfilled fill. */
export function Switch({ value, onChange, label, disabled }: {
  value: boolean;
  onChange: (next: boolean) => void;
  /** What it is a switch for. The row beside it carries the words on screen, so
   *  without this the control itself is unnamed to anything that cannot see. */
  label?: string;
  disabled?: boolean;
}) {
  const t = useTokens();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label}
      accessibilityState={{ checked: value }} hitSlop={8}
      disabled={disabled} onPress={() => onChange(!value)}
      style={{ width: 40, height: 24, borderRadius: 12, opacity: disabled ? 0.5 : 1,
               backgroundColor: value ? t.ink : t.line2 }}>
      <View style={{ position: 'absolute', top: 3, left: value ? 19 : 3, width: 18, height: 18,
                     borderRadius: 9, backgroundColor: t.bg }} />
    </Pressable>
  );
}

// ── 3 · pill ────────────────────────────────────────────────────────────────

/** The one tappable shape that is not a row.
 *
 *  Mobile1 V1 draws it as the project chip at the top of the Dashboard
 *  (`height:34px; padding:0 12px; border-radius:17px; gap:7px; font:500
 *  13.5px`, a 7 pt dot in front, `ink` behind it when it is the selected one);
 *  Mobile6 S3 draws the same shape as an answer — amber when it is the one the
 *  agent is proposing, an outline when it is not. */
export function Pill({ label, face = 'surface', dot, onPress, style }: {
  label: string;
  /** `surface` an unselected chip · `ink` the selected one · `amber` the
   *  answer being proposed · `outline` an answer beside it. */
  face?: 'surface' | 'ink' | 'amber' | 'outline';
  /** The status dot in front of a project chip, as a state or a colour. */
  dot?: State | string | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const bg = face === 'ink' ? t.ink : face === 'amber' ? t.amber : face === 'outline' ? 'transparent' : t.s1;
  const fg = face === 'ink' ? t.bg : face === 'amber' ? t.onAmber : t.ink;
  return (
    <Tap onPress={onPress}
      style={[{ height: SIZE.pill, borderRadius: RADIUS.pill, paddingHorizontal: dot ? 12 : 13,
                flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: bg },
              face === 'outline' && { borderWidth: 1, borderColor: t.line2 }, style]}>
      {!!dot && <StatusDot state={dot} size={7} />}
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '500', color: fg }}>{label}</Text>
    </Tap>
  );
}

/** The buttons a card and an empty state end on. Mobile6 S3 (`height:40px;
 *  border-radius:11px`, amber filled beside a `line2` outline) and Mobile7 S6
 *  (the same pair at `height:48px; border-radius:13px` when they are the whole
 *  screen). */
export function Button({ label, face = 'ink', icon, tall, onPress, style }: {
  label: string;
  face?: 'ink' | 'amber' | 'outline';
  icon?: string;
  tall?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const bg = face === 'ink' ? t.ink : face === 'amber' ? t.amber : 'transparent';
  const fg = face === 'ink' ? t.bg : face === 'amber' ? t.onAmber : t.ink;
  return (
    <Tap onPress={onPress}
      style={[{ height: tall ? 48 : 40, borderRadius: tall ? RADIUS.buttonTall : RADIUS.button,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg },
              face === 'outline' && { borderWidth: 1, borderColor: t.line2 }, style]}>
      {!!icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={{ fontSize: tall ? 15 : 14, fontWeight: face === 'outline' ? '500' : '600', color: fg }}>{label}</Text>
    </Tap>
  );
}

// ── 4 · tab bar ─────────────────────────────────────────────────────────────

export interface Tab {
  key: string;
  label: string;
  icon: string;
  /** The amber count over the icon. Nothing is drawn for 0. */
  badge?: number;
}

/** Dashboard · Chat · Machine, at the foot of every screen.
 *
 *  Mobile1 V1: `height:84px` over the home indicator, a `line` above it, three
 *  equal columns, and the selected one's glyph sitting in a 60×32 well of `s2`
 *  with the label a weight heavier. The badge is Mobile1 V1's own: amber, with
 *  a two-pixel ring in the page colour so it reads as separate from the icon. */
export function TabBar({ tabs, value, onChange, style }: {
  tabs: Tab[]; value: string; onChange: (key: string) => void; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ height: SIZE.tabBar, flexDirection: 'row', backgroundColor: t.bg,
                    borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8, paddingHorizontal: 16 }, style]}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        const fg = on ? t.ink : t.ink3;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ width: SIZE.tabWell[0], height: SIZE.tabWell[1], borderRadius: SIZE.tabWell[1] / 2,
                           alignItems: 'center', justifyContent: 'center',
                           backgroundColor: on ? t.s2 : 'transparent' }}>
              <Icon name={tab.icon} size={SIZE.tabIcon} color={fg} />
              {!!tab.badge && (
                <View style={{ position: 'absolute', top: -2, right: 8, minWidth: 18, height: 18, borderRadius: 9,
                               paddingHorizontal: 5, backgroundColor: t.amber, borderWidth: 2, borderColor: t.bg,
                               alignItems: 'center', justifyContent: 'center' }}>
                  <Text mono style={{ fontSize: 10, fontWeight: '700', color: t.bg }}>{tab.badge}</Text>
                </View>
              )}
            </View>
            <Text style={{ fontSize: 11.5, fontWeight: on ? '600' : '500', color: fg }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── 5 · the board's column tabs ─────────────────────────────────────────────

export interface Column { key: string; label: string; count: number }

/** Ice Box · Queued · In Progress · Done — the board's four columns as four
 *  tabs, which on a phone are also the only drop targets there is room for.
 *
 *  Mobile2 V5 and Mobile3's drag frame: four equal `height:46px` tiles,
 *  `border-radius:12px`,
 *  4 pt apart, over a `line`. The selected one is filled with `s2`. While a
 *  card is in the air every other tab picks up a dashed `line2` outline and the
 *  one under the thumb turns green — `1.5px solid var(--run)` over `runBg`,
 *  with its name and its count in `run` — which is the whole of the gesture's
 *  feedback. */
export function ColumnTabs({ columns, value, onChange, dragging, target, onMeasure, style }: {
  columns: Column[];
  value: string;
  onChange?: (key: string) => void;
  /** A card is being dragged: the tabs become targets. */
  dragging?: boolean;
  /** The one under the thumb. */
  target?: string | null;
  /** Where each tab ended up, in this strip's own coordinates, so that the board
   *  can tell which one a thumb is over. Reported from here rather than worked
   *  out by the screen: how wide a tab is and how far apart they sit is this
   *  part's business, and a second copy of it in a gesture is how a drop target
   *  comes to be four points off the thing it is drawn on. */
  onMeasure?: (tabs: { key: string; x: number; y: number; w: number; h: number }[]) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const seen = React.useRef<Record<string, { key: string; x: number; y: number; w: number; h: number }>>({});
  const measured = (key: string, x: number, y: number, w: number, h: number) => {
    if (!onMeasure) return;
    seen.current[key] = { key, x, y, w, h };
    const all = columns.map((c) => seen.current[c.key]).filter(Boolean);
    if (all.length === columns.length) onMeasure(all);
  };
  return (
    <View style={[{ flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingBottom: 10,
                    borderBottomWidth: 1, borderBottomColor: t.line }, style]}>
      {columns.map((col) => {
        const isTarget = dragging && col.key === target;
        const on = col.key === value;
        const outline = isTarget ? t.run : dragging && !on ? t.line2 : 'transparent';
        return (
          <Pressable key={col.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={onChange && (() => onChange(col.key))}
            onLayout={onMeasure && ((e) => { const l = e.nativeEvent.layout;
                                             measured(col.key, l.x, l.y, l.width, l.height); })}
            style={{ flex: 1, height: SIZE.columnTab, borderRadius: RADIUS.tab, alignItems: 'center',
                     justifyContent: 'center', gap: 1,
                     borderWidth: isTarget ? 1.5 : 1, borderColor: outline,
                     borderStyle: dragging && !on && !isTarget ? 'dashed' : 'solid',
                     backgroundColor: isTarget ? t.runBg : on ? t.s2 : 'transparent' }}>
            <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600',
                                             color: isTarget ? t.run : on ? t.ink : t.ink2 }}>{col.label}</Text>
            <Text mono style={{ fontSize: 10.5, color: isTarget ? t.run : t.ink3 }}>{col.count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── 5b · the two faces of one page ──────────────────────────────────────────

export interface Segment {
  key: string;
  label: string;
  /** The mono character after the name: the worst thing on the page behind it
   *  (Mobile2 V4's red `■` on the Board tab). */
  mark?: string;
  /** …and what colour it is. */
  tone?: Tone | null;
}

/** Overview · Board — one page with two faces, as a segmented control.
 *
 *  Mobile2 V4: a track of `s1` at `border-radius:12px; padding:3px`, each
 *  segment `padding:8px 0` and centred at 13.5 pt medium, the selected one a
 *  card of `s2` sitting in it at the corner a row's well takes. The unselected
 *  names are `ink2`, which is the difference the frame draws between "the other
 *  face of this page" and "the page you are on".
 *
 *  The frame has a third segment, Chats, with a count on it. The chats a product
 *  owns are not filed yet, so it is not drawn: a segment that dims under a thumb
 *  and does nothing is worse than a segment that is not there. */
export function Segments({ segments, value, onChange, on = 's1', disabled, style }: {
  segments: Segment[];
  value: string | null | undefined;
  onChange: (key: string) => void;
  /** What it is sitting on, which decides which way round the two surfaces go.
   *  On the page (`s1`, Mobile2 V4) the track is the card and the selected
   *  segment is the well cut into it. In a card (`s2`, Web15 W18) it is the
   *  other way about: an `s2` track at `border-radius:10px; padding:3px` and the
   *  selected segment a 30 pt `s1` card lifted off it. */
  on?: 's1' | 's2';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const boxed = on === 's2';
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: boxed ? t.s2 : t.s1,
                    borderRadius: boxed ? 10 : RADIUS.tab, padding: 3,
                    opacity: disabled ? 0.5 : 1 }, style]}>
      {segments.map((seg) => {
        const sel = seg.key === value;
        return (
          <Pressable key={seg.key} accessibilityRole="tab" accessibilityState={{ selected: sel }}
            disabled={disabled} onPress={() => onChange(seg.key)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                     paddingVertical: 8, borderRadius: boxed ? 8 : RADIUS.well,
                     backgroundColor: sel ? (boxed ? t.s1 : t.s2) : 'transparent',
                     ...(sel && boxed ? { boxShadow: shadows(t).lift } : null) }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '500', color: sel ? t.ink : t.ink2 }}>
              {seg.label}
            </Text>
            {!!seg.mark && (
              <Text mono style={{ fontSize: 11, color: seg.tone ? toneColours(t, seg.tone).fg : t.ink3 }}>
                {seg.mark}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── 5c · the three faces of one card ────────────────────────────────────────

export interface Face {
  key: string;
  label: string;
  /** The mono number after the name: how long the brief is (Mobile4 T1's `46`).
   *  Nothing is drawn without one. */
  count?: number | null;
  /** The green dot in front of it: something is being written right now. */
  live?: boolean;
}

/** Human · Agent · Live — one card read three ways, as an underlined tab strip.
 *
 *  Mobile4 T1: three equal columns over a `line`, each `padding:10px 0` and
 *  centred at 13.5 pt medium, the selected one in `ink` with a two-pixel rule
 *  under it and the other two in `ink3`. The count beside a name is mono 11 in
 *  `ink3` whichever tab it is on, and the Live tab's 6 pt dot is `run`.
 *
 *  Not `Segments`, which is the same idea drawn as a track: that one switches
 *  between two faces of a *page* and this one between three readings of one
 *  thing, and the frames draw them differently on purpose — a segmented track
 *  under a title would read as a second navigation bar. */
export function FaceTabs({ faces, value, onChange, style }: {
  faces: Face[]; value: string; onChange: (key: string) => void; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.line }, style]}>
      {faces.map((face) => {
        const on = face.key === value;
        return (
          <Pressable key={face.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => onChange(face.key)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                     paddingVertical: 10, borderBottomWidth: 2,
                     borderBottomColor: on ? t.ink : 'transparent', marginBottom: -1 }}>
            {!!face.live && <StatusDot state={t.run} size={6} />}
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '500', color: on ? t.ink : t.ink3 }}>
              {face.label}
            </Text>
            {face.count != null && (
              <Text mono style={{ fontSize: 11, color: t.ink3 }}>{face.count}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── 6 · status dot ──────────────────────────────────────────────────────────

/** The smallest thing on the screen that carries a state.
 *
 *  Mobile1 V1 draws it at 7 pt in the machine line and in a project chip, and
 *  Mobile1 V3 at 8 pt in front of "All clear". A machine that cannot be reached
 *  is the same circle drawn as a `1.5px` ring instead of a fill (Web15 W12), so
 *  the difference survives being looked at sideways. */
export function StatusDot({ state, size = SIZE.dot, hollow, style }: {
  /** One of the six the frames colour, or a colour outright. */
  state: State | string;
  size?: number;
  hollow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const colour = state in STATE_MARK ? stateColour(t, state as State) : state;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 },
                  hollow ? { borderWidth: 1.5, borderColor: colour } : { backgroundColor: colour }, style]} />
  );
}

/** The same state as a character. Mobile1 V2's project counts and agent
 *  roster, and Mobile6 S3's section heads, label a state `■ ? ● ✓ ○` as well as
 *  colouring it, which is what keeps the board readable to an eye that does not
 *  separate red from green. */
export function StateMark({ state, size = 12, style }: { state: State; size?: number; style?: StyleProp<TextStyle> }) {
  const t = useTokens();
  return (
    <Text mono style={[{ fontSize: size, fontWeight: '700', color: stateColour(t, state) }, style]}>
      {STATE_MARK[state]}
    </Text>
  );
}

// ── 7 · executor badge ──────────────────────────────────────────────────────

/** Who is on a ticket, in a square you can read at 28 pt.
 *
 *  Mobile11 S14 draws all seven in one column: a Coder is `</>` on indigo, a
 *  branch agent its initial on its own colour, the research assistant and the
 *  two members of the household are circles. Mobile3's drag frame draws the
 *  eighth face — a ticket nobody has picked up yet, whose square is a dashed
 *  outline. The mark is always mono, 700, tightened by a tenth of an em so
 *  `</>` fits. */
export function ExecutorBadge({ executor, size = SIZE.executor, style }: {
  executor: string; size?: number; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const face: ExecutorFace = EXECUTORS[executor] ?? EXECUTORS.unassigned;
  const fill = face.fill ?? (executor === 'you' ? t.ink : t.s2);
  const ink = face.dashed ? EXEC_PENDING_INK : face.fill ? ON_COLOUR : executor === 'you' ? t.bg : t.ink;
  const font = size * 0.41;
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center',
                    borderRadius: face.round ? size / 2 : RADIUS.mark,
                    backgroundColor: face.dashed ? 'transparent' : fill },
                  face.dashed && { borderWidth: 1.5, borderColor: EXEC_PENDING_LINE, borderStyle: 'dashed' },
                  !face.dashed && !face.fill && executor !== 'you' && { borderWidth: 1.5, borderColor: t.line2 },
                  style]}>
      <Text mono numberOfLines={1}
        style={{ fontSize: font, fontWeight: '700', color: ink, letterSpacing: em(font, -0.06) }}>{face.mark}</Text>
    </View>
  );
}

/** A project's letter on its own colour: `32px` at `border-radius:9px` on a
 *  project card (Mobile1 V1), `26px` at `7px` in a title bar (Mobile2 V5),
 *  `22px` at `6px` beside a question (Mobile1 V1) — white on every one of the
 *  ramp's hues. */
export function Monogram({ name, index, size = SIZE.monogram, style }: {
  name: string;
  /** The project's place in the list being drawn, where there is one: the ramp
   *  is walked in order so that no two projects on a screen share a hue. */
  index?: number | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: size, height: size, borderRadius: Math.round(size * 0.28),
                    backgroundColor: monogram(name, index), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ fontSize: size * 0.47, fontWeight: '600', color: ON_COLOUR }}>
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

// ── 8 · counter ─────────────────────────────────────────────────────────────

/** One of the four numbers across the top of the Dashboard.
 *
 *  Mobile1 V1: `border-radius:14px; padding:10px 10px 9px`, the number in mono
 *  at `26px/1` and its name 8 pt under it at `11.5px`. A counter that is at
 *  zero drops its tint and its colour and goes grey on `s1` — Mobile1 V3 is the
 *  same four tiles on a calm morning, and the difference between the two is
 *  this component's whole behaviour.
 *
 *  `ring` is Mobile5 S1's fourth tile: `box-shadow: inset 0 0 0 1.5px
 *  var(--amber)` and no wash at all. It is how "2 agents whose state nobody
 *  knows" is told apart from "2 things need you" — the same colour, and not the
 *  same kind of fact, which two identical washes side by side would deny. */
export function Counter({ value, label, tone, ring, onPress, style }: {
  value: number | string;
  label: string;
  /** What it is a count of. Ignored while the count is 0. */
  tone?: Tone;
  /** Outlined in its tone rather than washed with it. */
  ring?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const zero = value === 0 || value === '0';
  const col = tone && !zero ? toneColours(t, tone) : null;
  return (
    <Tap onPress={onPress}
      style={[{ flex: 1, borderRadius: RADIUS.tile, paddingTop: 10, paddingHorizontal: 10, paddingBottom: 9,
                backgroundColor: col && !ring ? col.bg : ring ? 'transparent' : t.s1 },
              col && ring ? { borderWidth: 1.5, borderColor: col.fg } : null, style]}>
      <Text mono style={{ fontSize: 26, lineHeight: 26, fontWeight: '500', color: col ? col.fg : zero ? t.ink3 : t.ink }}>
        {value}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '500', marginTop: 8, color: col ? col.fg : t.ink2 }}>
        {label}
      </Text>
    </Tap>
  );
}

// ── 9 · section header ──────────────────────────────────────────────────────

/** What stands above a run of cards. The frames use two, and they mean
 *  different things:
 *
 *  `title` (Mobile1 V1, above Needs you and Projects) is a 15 pt semibold with
 *  a mono count or aside beside it, baseline-aligned, 4 pt in from the cards.
 *
 *  `mark` (Mobile6 S3) is the smaller one that groups a list by state —
 *  `? questions · 1` — set entirely in mono at 11.5 pt in that state's colour.
 *  It is a label on a group, not a heading over a section, and it is why the
 *  Waiting-on-you screen needs no dividers.
 *
 *  `page` is the third and there is one of it per screen: Mobile1 V1's
 *  `Overview` at `600 26px` with `letter-spacing:-.02em`, and the mono aside at
 *  the far end that says how much of the page below it is true — `4 projects ·
 *  Mon 28 Sep`, or Mobile5 S1's amber `partly as of 21:02`. */
export function SectionHeader({ title, count, note, right, kind = 'title', tone, style }: {
  title: string;
  /** The mono number that follows the title. */
  count?: number | string | null;
  /** A mono aside in its place: `sorted by urgency`, `all projects`. */
  note?: string | null;
  /** A mono aside pushed to the far end instead: `4 projects · Mon 28 Sep`. */
  right?: string | null;
  kind?: 'title' | 'mark' | 'page';
  /** Which state's colour a `mark`, or a `page`'s aside, takes. Grey without
   *  one. */
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  if (kind === 'page') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 4 }, style]}>
        <Text style={{ fontSize: 26, fontWeight: '600', letterSpacing: em(26, -0.02) }}>{title}</Text>
        {!!right && (
          <Text mono numberOfLines={1}
            style={{ fontSize: 12, fontWeight: tone ? '500' : '400', marginLeft: 'auto',
                     color: tone ? toneColours(t, tone).fg : t.ink3 }}>{right}</Text>
        )}
      </View>
    );
  }
  if (kind === 'mark') {
    return (
      <View style={[{ paddingTop: 4, paddingHorizontal: 4 }, style]}>
        <Text mono style={{ fontSize: 11.5, fontWeight: '500', color: tone ? toneColours(t, tone).fg : t.ink3 }}>
          {count == null ? title : `${title} · ${count}`}
        </Text>
      </View>
    );
  }
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 4 }, style]}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {count != null && <Text mono style={{ fontSize: 12, color: t.ink3, marginLeft: 8 }}>{count}</Text>}
      {!!note && <Text mono style={{ fontSize: 12, color: t.ink3, marginLeft: 8 }}>{note}</Text>}
      {!!right && <Text mono numberOfLines={1} style={{ fontSize: 12, color: t.ink3, marginLeft: 'auto' }}>{right}</Text>}
    </View>
  );
}

// ── 10 · empty state ────────────────────────────────────────────────────────

/** A screen with nothing on it yet, which in this design is not an apology.
 *
 *  Mobile7 S6, the brand-new board: the structure stays visible (the column
 *  tabs are still there, at zero) and the middle of the screen is a sentence in
 *  24 pt, a paragraph of `ink2` under it, one or two full-width buttons, and a
 *  mono footnote saying what will *not* happen by itself. Left-aligned and
 *  vertically centred — not a mark in a circle. */
export function EmptyState({ title, body, actions, foot, style }: {
  title: string;
  body?: string;
  actions?: React.ReactNode;
  /** The mono line under the buttons. */
  foot?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flex: 1, justifyContent: 'center', gap: 14, paddingHorizontal: 32, paddingBottom: 40 }, style]}>
      <Text style={{ fontSize: 24, lineHeight: 24 * 1.15, fontWeight: '600', letterSpacing: em(24, -0.02) }}>{title}</Text>
      {!!body && <Text style={{ fontSize: 15, lineHeight: 15 * 1.5, color: t.ink2 }}>{body}</Text>}
      {!!actions && <View style={{ gap: 8, marginTop: 6 }}>{actions}</View>}
      {!!foot && <Text mono style={{ fontSize: 12, lineHeight: 12 * 1.5, color: t.ink3 }}>{foot}</Text>}
    </View>
  );
}

// ── 11 · sheet ──────────────────────────────────────────────────────────────

/** A panel that comes up over the page.
 *
 *  The phone frames draw no sheet: every Divan screen on the phone is a whole
 *  page, and the machine drawer — the one thing that is a panel — is a drawer
 *  only on the desktop (Web15 W12). So the shell is the app's own
 *  (`components/sheet`), which already comes up in the page's colour under a
 *  dim rather than shrinking the page behind it; what is new is that it is
 *  drawn in Divan's tokens, and that its head is the drawer's head from Web15
 *  W12: a 24 pt title with `letter-spacing:-.02em` over one grey line of 13 pt.
 *
 *  Presented as a route (`presentation: 'transparentModal'`), the way the
 *  app's other sheets are. */
export function Sheet({ title, note, onClose, children, kind = 'fit', top, style }: {
  title?: string;
  note?: string;
  onClose: () => void;
  kind?: 'fit' | 'page';
  /** A `fit` sheet held at a fixed height below the status bar, the way a
   *  detent works: the model picker for one chat stands nearly full height, the
   *  same picker for the defaults stops over the Settings it came from. */
  top?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    // A titled sheet is dragged down by its head (`SheetTitle` carries the
    // responder), so the grab handle over it would be a second one for the same
    // gesture.
    <SheetShell kind={kind} top={top} handle={!title && kind === 'fit'} onClose={onClose} style={style}>
      {!!title && <SheetTitle title={title} note={note} />}
      {children}
    </SheetShell>
  );
}

/** Web15 W12's drawer head, and the close the phone needs and the desktop does
 *  not. Drags the sheet down, the same as the app's own bar. */
export function SheetTitle({ title, note }: { title: string; note?: string }) {
  const t = useTokens();
  const { close, pan } = useSheet();
  return (
    <View {...pan} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                            paddingTop: 12, paddingHorizontal: 20, paddingBottom: 14,
                            borderBottomWidth: 1, borderBottomColor: t.line }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 24, fontWeight: '600', letterSpacing: em(24, -0.02) }}>{title}</Text>
        {!!note && <Text style={{ fontSize: 13, color: t.ink3, marginTop: 4 }}>{note}</Text>}
      </View>
      <Pressable accessibilityLabel="Close" onPress={() => close()} hitSlop={10}
        style={(st) => [{ width: 32, height: 32, borderRadius: RADIUS.well, backgroundColor: t.s2,
                          alignItems: 'center', justifyContent: 'center' }, dim(st) as ViewStyle]}>
        <Icon name="close" size={16} color={t.ink2} />
      </Pressable>
    </View>
  );
}

/** Re-exported so a screen that wants the app's plainer sheet bar does not have
 *  to reach past this module for it. */
export const SheetBar = _SheetBar;

// ── 12 · a row you type into ────────────────────────────────────────────────

/** The one shape no frame draws: a field.
 *
 *  Nothing in Divan is typed into except the card being written (`components/
 *  compose`), and the drawer's rows all end on a control rather than on a box.
 *  So this is W18's row with the control's place given to the value itself —
 *  the same `padding:14px 20px`, the label where a row's title goes at 13 pt in
 *  `ink3`, and the value in mono under it at 15 pt, which is what a host and a
 *  token are. It is a row, so a run of them stacks in a `Group` like any other.
 *
 *  `secret` is a token: the app has always hidden one behind an eye rather than
 *  printing it on a screen somebody is holding up to a camera. */
export function FieldRow({ label, value, onChange, placeholder, keyboard, secret, shown, onShow,
                          first, style }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  keyboard?: 'numbers-and-punctuation' | 'number-pad' | 'default';
  secret?: boolean;
  /** …and whether it is being shown right now. */
  shown?: boolean;
  onShow?: () => void;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingHorizontal: 20 },
                  !first && { borderTopWidth: 1, borderTopColor: t.line }, style]}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ fontSize: 13, color: t.ink3 }}>{label}</Text>
        <TextInput mono value={value} onChangeText={onChange} placeholder={placeholder}
          placeholderTextColor={t.ink3} autoCapitalize="none" autoCorrect={false}
          keyboardType={keyboard ?? 'default'} secureTextEntry={!!secret && !shown}
          style={{ fontSize: 15, color: t.ink, letterSpacing: secret && !shown ? 2 : 0 }} />
      </View>
      {!!secret && (
        <Pressable accessibilityLabel={label} onPress={onShow} hitSlop={10} style={dim}>
          <Icon name={shown ? 'visibility_off' : 'visibility'} size={20} color={t.ink3} />
        </Pressable>
      )}
    </View>
  );
}

/** The tokens themselves, for the rare place that needs one directly. Anything
 *  that reaches for this and is not a one-off belongs in this file instead. */
export function useDivan(): Tokens { return useTokens(); }
