/** The Waiting-on-you screen's own two blocks, out of the design system's parts
 *  and nothing else.
 *
 *  What each of them *says* is decided in `src/waiting.ts`, where a check can
 *  reach it without a phone; this is the drawing of it. Every shape here was
 *  measured off `design/divan/frames/06-mobile6-waiting-on-you.html` (S3), and
 *  the frame is named above each one.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. There is no placeholder in this file — a card with nothing
 *  to say in one of its slots is drawn without that slot. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { Card, ExecutorBadge, Tap } from './divan';
import { SIZE, toneColours, useTokens, type Tone } from '../theme';

// ── 1 · the way back ────────────────────────────────────────────────────────

/** Mobile6 S3's `‹ Overview`: the one line above the title, in `ink3` at 13 pt
 *  medium with a 16 pt chevron against it.
 *
 *  This screen is the only phone frame that draws one, because it is the only
 *  one that is a page of its own inside a place rather than the place itself —
 *  everything else at this depth is a whole route with a large title over it. */
export function BackRow({ label, onPress, style }: {
  label: string; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }, style]}>
      <Icon name="chevron_left" size={16} color={t.ink3} />
      <Text style={{ fontSize: 13, fontWeight: '500', color: t.ink3 }}>{label}</Text>
    </Tap>
  );
}

// ── 2 · one thing waiting on a person ───────────────────────────────────────

/** Mobile6 S3's card, the same shape under all four of its heads.
 *
 *  A 28 pt executor face; who is waiting, and under it in mono the product, the
 *  card and the computer it is on; how long it has been waiting, at the far
 *  end. Then what was said — the loud 15 pt line when it is a question, the
 *  quiet 14 pt `ink2` paragraph when it is an agent explaining where it got
 *  stuck. Then whatever can be done about it.
 *
 *  The second line is the whole of "where did this come from": the frame writes
 *  `Quire · Safari 17 login · on studio`, and a list gathered off four computers
 *  is unreadable without it. */
export function WaitingCard({ face, who, from, age, said, asked, stuck, body, note, tone, actions, after, onPress }: {
  /** Which executor face the card wears (`ExecutorBadge`). */
  face: string;
  /** `Coder`, `You` — already in the reader's language. */
  who: string;
  /** The mono line: product, card, machine. */
  from: string;
  /** `12m`, `1h 12m`, `2 days`. Absent where nothing stamped the card. */
  age?: string | null;
  said: string;
  /** `said` is a question, not a report. */
  asked?: boolean;
  /** The status word of an agent that stopped, in red beside the age. */
  stuck?: string | null;
  /** A quiet paragraph under what was said. */
  body?: string | null;
  /** A mono line under the buttons: what a tap on one of them did, or why it
   *  did not. Absent while there is nothing to report, which is almost always. */
  note?: string | null;
  tone?: Tone;
  actions?: React.ReactNode;
  /** Something under the buttons that a press opened: a comment box. */
  after?: React.ReactNode;
  onPress?: () => void;
}) {
  const t = useTokens();
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <ExecutorBadge executor={face} size={SIZE.executor} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600' }}>{who}</Text>
          <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 2 }}>{from}</Text>
        </View>
        {!!stuck && (
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '500', color: toneColours(t, 'red').fg }}>{stuck}</Text>
        )}
        {!!age && (
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: t.ink3 }}>{age}</Text>
        )}
      </View>
      {!!said && (asked
        ? <Text style={{ fontSize: 15, lineHeight: 15 * 1.35, fontWeight: '500' }}>{said}</Text>
        : <Text style={{ fontSize: 14, lineHeight: 14 * 1.4, color: t.ink2 }}>{said}</Text>)}
      {!!body && <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2 }}>{body}</Text>}
      {!!actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{actions}</View>}
      {after}
      {!!note && (
        <Text mono numberOfLines={2}
          style={{ fontSize: 11, fontWeight: '500', color: tone ? toneColours(t, tone).fg : t.ink3 }}>{note}</Text>
      )}
    </Card>
  );
}
