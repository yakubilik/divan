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
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { Card, StatusDot, Tap } from './divan';
import { RADIUS, toneColours, useTokens, type Tone } from '../theme';
import type { StatusKind } from '../board';

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

// ── 2 · the status word ─────────────────────────────────────────────────────

/** The dot a status word is drawn with (HANDOVER §2): running green, asking
 *  amber, stuck red, testing grey, done the quiet grey; queued and idle are an
 *  empty ring. Never the dot alone. */
export function statusDot(t: ReturnType<typeof useTokens>, kind: StatusKind): { colour: string; hollow: boolean } {
  switch (kind) {
    case 'run': return { colour: t.run, hollow: false };
    case 'ask': return { colour: t.amber, hollow: false };
    case 'stuck': return { colour: t.red, hollow: false };
    case 'review': return { colour: t.ink2, hollow: false };
    case 'done': return { colour: t.ink3, hollow: false };
    default: return { colour: t.ink3, hollow: true };
  }
}

/** `dv-status`: the dot and the word. Asking is the one word in amber. */
export function StatusWord({ kind, word, style }: { kind: StatusKind; word: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const d = statusDot(t, kind);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]}>
      <StatusDot state={d.colour} hollow={d.hollow} size={7} />
      <Text style={{ fontSize: 12.5, fontWeight: '500', color: kind === 'ask' ? t.amber : t.ink2 }}>{word}</Text>
    </View>
  );
}

// ── 3 · a card ──────────────────────────────────────────────────────────────

/** One card on the board (BoardPhone): the title, the one sentence an agent
 *  asked or stopped on, the status word and the mono corner — machine and how
 *  long. A card that is asking has an amber edge as well as the word.
 *
 *  `mine` is a person's own card: no surface and a dashed outline, because
 *  nothing runs on it. `lifted` is the card under the thumb; `landed` the one
 *  just put down, with what happened and the way to take it back. */
export function BoardCard({ title, line, status, meta, mine, lifted, landed, hold, onPress, style }: {
  title: string;
  line?: string;
  status?: { kind: StatusKind; word: string } | null;
  meta?: string;
  mine?: boolean;
  lifted?: boolean;
  landed?: { text: string; tone: Tone; action?: string; onAction?: () => void } | null;
  /** What makes it draggable (`components/drag` `useDrag`). */
  hold?: { holdMs: number; onLongPress: (e: GestureResponderEvent) => void; onPressOut: () => void };
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card radius={RADIUS.md} inset={false} dashed={mine && !landed} onPress={onPress}
      lifted={lifted} ring={landed ? 'run' : status?.kind === 'ask' ? 'amber' : lifted ? 'none' : 'line'}
      wash={landed ? landed.tone : null}
      holdMs={hold?.holdMs} onLongPress={hold?.onLongPress} onPressOut={hold?.onPressOut}
      style={[lifted && { transform: [{ scale: 1.03 }] }, style]}>
      <View style={{ padding: 14, gap: 10 }}>
        <Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 21, fontWeight: '500',
                                         color: status?.kind === 'done' ? t.ink2 : t.ink }}>{title}</Text>
        {!!line && <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>{line}</Text>}
        {(!!status || !!meta) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!!status && <StatusWord kind={status.kind} word={status.word} />}
            {!!meta && (
              <Text mono numberOfLines={1} style={{ marginLeft: 'auto', flexShrink: 1, fontSize: 11.5, color: t.ink3 }}>
                {meta}
              </Text>
            )}
          </View>
        )}
      </View>
      {!!landed && (
        /* D4's foot: what happened, and the way back where there is one. */
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8,
                       borderTopWidth: 1, borderTopColor: t.line2,
                       paddingVertical: 8, paddingHorizontal: 12 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: t.ink2 }}>{landed.text}</Text>
          {!!landed.action && (
            <Tap onPress={landed.onAction} style={{ marginLeft: 'auto', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink }}>{landed.action}</Text>
            </Tap>
          )}
        </View>
      )}
    </Card>
  );
}
