/** One card's three faces, out of the design system's parts and nothing else.
 *
 *  What each face *says* is decided in `src/card.ts`, where a check can reach it
 *  without a phone; this is the drawing of it. Every shape here was measured off
 *  `design/divan/frames/04-mobile4-ticket-human-agent-live-and-chat.html` — T1
 *  the human face, T2 the agent's, T3 the run as it is written — and the frame
 *  each came from is named above it.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. There is no placeholder in this file: a row with nothing in
 *  it is not drawn.
 *
 *  The head (`Crumbs`, `CardHead`) is deliberately one part used by all three
 *  faces rather than three copies of it. T1, T2 and T3 draw the same seven lines
 *  above the tab strip, character for character, and the note on T3 says why:
 *  the context must not change when the reader changes face. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text, TextInput } from './text';
import { Card, ExecutorBadge, Monogram, Tap } from './divan';
import { RADIUS, toneColours, useTokens, em, type Tone } from '../theme';
import { useT } from '../store';

// ── 1 · the head every face wears ───────────────────────────────────────────

/** T1's breadcrumb: the product's monogram and name, the branch, and the card's
 *  own key in mono on `s2`, with what kind of page this is at the far end.
 *  `500 12.5px` in `ink2` throughout, the separators in `ink3`. */
export function Crumbs({ project, index, branch, ticket, label, style }: {
  project: string;
  /** The product's place in the list it came from, so its monogram is the hue
   *  the Dashboard gave it. */
  index?: number | null;
  branch: string;
  /** `#142`, or the card's own short id. */
  ticket: string;
  /** What this page is: `Ticket`. */
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const slash = <Text style={{ fontSize: 12.5, color: t.ink3 }}>/</Text>;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 7 }, style]}>
      {!!project && <Monogram name={project} index={index} size={20} />}
      {!!project && (
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>
          {project}
        </Text>
      )}
      {!!project && !!branch && slash}
      {!!branch && (
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>
          {branch}
        </Text>
      )}
      {!!ticket && (project || branch) ? slash : null}
      {!!ticket && (
        <Text mono numberOfLines={1}
          style={{ fontSize: 12, fontWeight: '600', backgroundColor: t.s2, overflow: 'hidden',
                   paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>{ticket}</Text>
      )}
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Icon name="description" size={14} color={t.ink2} />
        <Text mono style={{ fontSize: 11.5, fontWeight: '500', color: t.ink2 }}>{label}</Text>
      </View>
    </View>
  );
}

/** T1's title and the line under it: which column the card is in, what is
 *  happening to it, and where it sits in that column.
 *
 *  The frame draws the column as a button with a chevron that moves the card
 *  without dragging. It is drawn here as what it is — a label — because moving a
 *  card is the board's gesture (`src/drag.ts`) and a chevron that opens nothing
 *  is worse than no chevron. */
export function CardHead({ title, column, mark, place, style }: {
  title: string;
  column: string;
  /** The board's own chip: its character, its words and its tone. */
  mark?: { text: string; tone: Tone } | null;
  /** `#3 in column`, where the card has a place in one. */
  place?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const col = mark ? toneColours(t, mark.tone) : null;
  return (
    <View style={[{ gap: 10 }, style]}>
      <Text style={{ fontSize: 22, lineHeight: 22 * 1.2, fontWeight: '600', letterSpacing: em(22, -0.015) }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1}
          style={{ height: 30, lineHeight: 30, paddingHorizontal: 10, borderRadius: RADIUS.mark,
                   backgroundColor: t.ink, color: t.bg, fontSize: 12.5, fontWeight: '600',
                   overflow: 'hidden' }}>{column}</Text>
        {!!mark && (
          <Text mono numberOfLines={1}
            style={{ fontSize: 11, fontWeight: '500', color: col!.fg, overflow: 'hidden',
                     backgroundColor: mark.tone === 'ink2' ? 'transparent' : col!.bg,
                     paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 }}>{mark.text}</Text>
        )}
        {!!place && (
          <Text mono numberOfLines={1}
            style={{ marginLeft: 'auto', fontSize: 11.5, color: t.ink3 }}>{place}</Text>
        )}
      </View>
    </View>
  );
}

/** The computer the work is on, in the words the board uses for it: a 11 pt
 *  monitor and the machine's name in mono, amber with when it was last heard
 *  from where that machine has gone quiet (T1's `studio`, Mobile8 S7's
 *  `mini · seen 21:02`). */
export function Machine({ name, seen, style }: {
  name: string; seen?: string | null; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const colour = seen ? t.amber : t.ink3;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }, style]}>
      <Icon name="monitor" size={11} color={colour} />
      <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: colour }}>
        {seen ? `${name} · ${seen}` : name}
      </Text>
    </View>
  );
}

// ── 2 · the human face (T1) ─────────────────────────────────────────────────

/** The card's own sentences, in the fixed box the frame gives them: three lines
 *  at `15.5px/24`, on the design system's card. */
export function Sentences({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <Card radius={RADIUS.tile} style={style}>
      <Text numberOfLines={3} style={{ fontSize: 15.5, lineHeight: 24, color: t.ink }}>{text}</Text>
    </Card>
  );
}

/** One row of the list under it: a 96 pt label in `ink3` at 12 pt, the value
 *  beside it at `500 13.5`, over a hairline. */
export function DetailRow({ label, children, style }: {
  label: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9,
                    borderTopWidth: 1, borderTopColor: t.line }, style]}>
      <Text style={{ width: 96, fontSize: 12, color: t.ink3 }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {children}
      </View>
    </View>
  );
}

/** The plain value in one, which is most of them. */
export function DetailValue({ text }: { text: string }) {
  return <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13.5, fontWeight: '500' }}>{text}</Text>;
}

/** One line of the activity trail: a 52 pt time in mono `ink3`, and what
 *  happened at 13 pt in `ink2`. */
export function TrailRow({ time, text, style }: {
  time: string; text: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', gap: 8, paddingVertical: 5 }, style]}>
      <Text mono style={{ width: 52, fontSize: 11, lineHeight: 18, color: t.ink3 }}>{time}</Text>
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: t.ink2 }}>{text}</Text>
    </View>
  );
}

// ── 3 · the agent face (T2) ─────────────────────────────────────────────────

/** One block of the brief: a mono label in `ink3` at `600 10.5` with the
 *  frame's own letter-spacing, and the block under it. */
export function Block({ label, count, children, style }: {
  label: string; count?: string | null; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={style}>
      <Text mono style={{ fontSize: 10.5, fontWeight: '600', color: t.ink3, marginBottom: 5,
                          letterSpacing: em(10.5, 0.02) }}>
        {count ? `${label} · ${count}` : label}
      </Text>
      {children}
    </View>
  );
}

/** A line of the brief. Mono at `12.5/1.55`, which is the whole agent face's
 *  measure; `quiet` is the one the frame draws a shade back, which is the file
 *  list. */
export function BriefLine({ text, quiet, style }: {
  text: string; quiet?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Text mono style={[{ fontSize: 12.5, lineHeight: 12.5 * 1.55, color: quiet ? t.ink2 : t.ink }, style]}>
      {text}
    </Text>
  );
}

/** One done-criterion, with what the verifier made of it: `✓` in `run` where it
 *  was met, `○` in `ink3` where nothing has been said about it yet, `×` in `red`
 *  where it was not. A 16 pt column, the frame's own. */
export function Criterion({ text, met }: { text: string; met?: boolean | null }) {
  const t = useTokens();
  const glyph = met == null ? '○' : met ? '✓' : '×';
  const colour = met == null ? t.ink3 : met ? t.run : t.red;
  return (
    <View style={{ flexDirection: 'row', gap: 6, paddingTop: 3 }}>
      <Text mono style={{ width: 16, fontSize: 12.5, lineHeight: 12.5 * 1.55, color: colour }}>{glyph}</Text>
      <BriefLine text={text} style={{ flex: 1 }} />
    </View>
  );
}

/** The commands that settle it, drawn as the block of code they are: `s2`, the
 *  design's own smallest corner, one command a line. */
export function Commands({ lines }: { lines: string[] }) {
  const t = useTokens();
  return (
    <View style={{ backgroundColor: t.s2, borderRadius: RADIUS.well, paddingVertical: 9, paddingHorizontal: 11 }}>
      {lines.map((line, i) => (
        <Text key={i} mono style={{ fontSize: 12, lineHeight: 12 * 1.6 }}>{line}</Text>
      ))}
    </View>
  );
}

// ── 4 · the live face (T3) ──────────────────────────────────────────────────

/** Who is working, where, and for how long: a 24 pt executor square, its name
 *  at `600 13`, the machine, and the run's age in mono `ink3`. */
export function Worker({ face, who, machine, seen, age, size = 24, style }: {
  face: string; who: string; machine?: string | null; seen?: string | null; age?: string | null;
  /** T3's square is 24 and T1's row draws the same thing at 22. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 }, style]}>
      <ExecutorBadge executor={face} size={size} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: '600' }}>{who}</Text>
      {!!machine && <Machine name={machine} seen={seen} />}
      {!!age && <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3 }}>{age}</Text>}
    </View>
  );
}

/** One line of the run: a 58 pt time and what happened, both mono, the whole row
 *  on the design's smallest corner. The step being written right now is the one
 *  row with a wash behind it and the cursor after it. */
export function LiveRow({ time, text, tone, now }: {
  time?: string | null;
  text: string;
  /** `null` is the ordinary line, in `ink2`. */
  tone?: Tone | null;
  now?: boolean;
}) {
  const t = useTokens();
  const col = tone ? toneColours(t, tone) : null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, paddingHorizontal: 10,
                   borderRadius: RADIUS.mark, backgroundColor: now ? t.runBg : 'transparent' }}>
      <Text mono style={{ width: 58, fontSize: 11, lineHeight: 17, color: t.ink3 }}>{time || ''}</Text>
      <Text mono numberOfLines={2}
        style={{ flex: 1, fontSize: 12, lineHeight: 17, color: now ? t.ink : col ? col.fg : t.ink2 }}>
        {now ? `${text} ▍` : text}
      </Text>
    </View>
  );
}

/** The one line a person can say into a run while it is working: a 48 pt pill
 *  with the send button in it, and the mono line under it saying what sending
 *  will do.
 *
 *  It is offered only where there is a worker to read it (`src/card.ts
 *  saying`); the screen draws the foot alone where there is not, because "the
 *  run doesn't stop" is not true of a card nothing is running on. */
export function SayBox({ value, onChangeText, onSend, placeholder, foot, label, busy, error, style }: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder: string;
  foot: string;
  /** What the field is called, for a reader who cannot see the placeholder. */
  label?: string;
  busy?: boolean;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const T = useT();
  const ready = !!value.trim() && !busy;
  return (
    <View style={[{ gap: 6 }, style]}>
      {!!error && <Text style={{ fontSize: 12, color: t.red, paddingHorizontal: 16 }}>{error}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48,
                     borderRadius: 24, backgroundColor: t.s1, borderWidth: 1, borderColor: t.line2,
                     paddingLeft: 16, paddingRight: 6 }}>
        <TextInput value={value} onChangeText={onChangeText} editable={!busy} multiline
          accessibilityLabel={label ?? placeholder}
          placeholder={placeholder} placeholderTextColor={t.ink3}
          style={{ flex: 1, fontSize: 15, color: t.ink, paddingVertical: 12, maxHeight: 120 }} />
        {/* Still the send colour while the sentence is in flight, at half
            strength: the box has already emptied by then, and a button that
            goes grey the moment it is pressed reads as a button that refused. */}
        <Tap onPress={ready ? onSend : undefined} label={T('send')}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                   backgroundColor: ready || busy ? t.ink : t.s2, opacity: busy ? 0.5 : 1 }}>
          <Icon name="arrow_upward" size={18} weight={500} color={ready || busy ? t.bg : t.ink3} />
        </Tap>
      </View>
      {!!foot && <Text mono style={{ fontSize: 11, color: t.ink3, textAlign: 'center' }}>{foot}</Text>}
    </View>
  );
}
