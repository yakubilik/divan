/** One product's board, out of the design system's parts and nothing else.
 *
 *  What each card *says* is decided in `src/board.ts`, where a check can reach it
 *  without a phone; this is the drawing of it. Every shape here was measured off
 *  `design/divan/frames/08-mobile8-*.html` (S7, the board with several machines
 *  on it) and `02-mobile2-*.html` (V5, the same column on a product that lives
 *  on one), and the frame each came from is named above it. The card is S7's: it
 *  is the later of the two and the only one that has to make room for a machine.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`) bring
 *  their own.
 *
 *  The rule the whole file is written under is the one the frames keep: **the
 *  card stays quiet.** Every card is the same surface with the same hairline
 *  round it, whatever is happening on it, and the state is an 11 pt mono chip in
 *  its corner. A column of five cards each washed in its own colour is a column
 *  nobody reads twice — and the one card that is drawn differently is the one
 *  nothing runs on, which is a fact about the card rather than an alarm. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { Card, ExecutorBadge } from './divan';
import { RADIUS, toneColours, useTokens, type Tone } from '../theme';

// ── 1 · the line above the cards ────────────────────────────────────────────

/** What is in this column, and where it is running (Mobile8 S7: `? 1  ■ 1  × 1
 *  ● 1` with `studio 3 · cloud 2 · mini 1` at the far end; Mobile2 V5 draws the
 *  same line with the states spelled out, on a product that has room for it).
 *
 *  All of it is mono at 11.5 pt with `padding:0 4px 4px`, which is the line's
 *  whole layout: it is a reading of the column rather than a legend, so it is
 *  drawn once above the cards and not repeated on them. */
export function ColumnLine({ marks, machines, style }: {
  /** The states in this column, worst first, with how many of each. */
  marks: { mark: string; n: number; tone: Tone }[];
  /** `studio 3 · cloud 2`. Empty on a product that lives on one computer. */
  machines?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  if (!marks.length && !machines) return null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 4, paddingBottom: 4 }, style]}>
      {marks.map((m) => (
        <Text key={m.mark} mono style={{ fontSize: 11.5, fontWeight: '500', color: toneColours(t, m.tone).fg }}>
          {m.mark} {m.n}
        </Text>
      ))}
      {!!machines && (
        <Text mono numberOfLines={1}
          style={{ marginLeft: 'auto', flexShrink: 1, fontSize: 11.5, color: t.ink3 }}>{machines}</Text>
      )}
    </View>
  );
}

// ── 2 · a card ──────────────────────────────────────────────────────────────

/** One card on the board.
 *
 *  Mobile8 S7: `background:s1; border-radius:14px; padding:11px 13px; gap:7`
 *  with a hairline ring, a 24 pt executor square, its name at 12.5 semibold, the
 *  machine in mono 10.5 beside it, and the state chip pushed to the far end —
 *  mono 11 at `padding:4px 8px; border-radius:7px`, its tone's colour on its
 *  tone's wash. Then the title at 15 semibold and the card's own sentence under
 *  it in `ink2`, cut at one line.
 *
 *  `mine` is Mobile2 V5's own card for a ticket a person owns: no surface, a
 *  `1.5px` dashed outline, and no machine — nothing runs on it, so there is no
 *  computer for it to be running on.
 *
 *  A card is a way in only where there is something to open: the run behind it,
 *  on the computer this phone holds a socket to. Everywhere else it is a card and
 *  not a press, because another machine's ticket number would open this
 *  machine's queue (`src/board.ts items`). */
export function BoardCard({ face, who, machine, mark, title, line, mine, onPress, style }: {
  /** Which executor square to draw (`components/divan` `ExecutorBadge`), by the
   *  name the design gives that face. */
  face: string;
  who: string;
  /** The computer it runs on, and — when that computer has gone quiet — when it
   *  was last heard from. */
  machine?: { name: string; seen?: string | null } | null;
  /** The state chip: its character, its words and its tone. */
  mark?: { text: string; tone: Tone } | null;
  title: string;
  /** The card's own sentence. Absent where nobody wrote one. */
  line?: string;
  mine?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const col = mark ? toneColours(t, mark.tone) : null;
  // A quiet machine is the one thing on this card that may take a colour outside
  // the chip: what the chip says was true when that computer last answered, and
  // an amber badge is how the frame says so (S7's `mini · seen 21:02`).
  const stale = !!machine?.seen;
  return (
    <Card radius={RADIUS.tile} inset={false} dashed={mine} onPress={onPress} style={style}>
      <View style={{ padding: 11, paddingHorizontal: 13, gap: 7 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ExecutorBadge executor={face} size={24} />
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600' }}>{who}</Text>
          {!!machine && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
              <Icon name="monitor" size={11} color={stale ? t.amber : t.ink3} />
              <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: stale ? t.amber : t.ink3 }}>
                {machine.seen ? `${machine.name} · ${machine.seen}` : machine.name}
              </Text>
            </View>
          )}
          {!!mark && (
            /* The chip a person's own card gets is the one the frame draws
               without a wash: grey words on the card itself (V5). */
            <Text mono numberOfLines={1}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: '500',
                       color: col!.fg, backgroundColor: mark.tone === 'ink2' ? 'transparent' : col!.bg,
                       paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, overflow: 'hidden' }}>
              {mark.text}
            </Text>
          )}
        </View>
        <Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 15 * 1.3, fontWeight: '600' }}>{title}</Text>
        {!!line && (
          <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 13 * 1.4, color: t.ink2 }}>{line}</Text>
        )}
      </View>
    </Card>
  );
}
