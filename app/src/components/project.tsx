/** One product's page, out of the design system's parts and nothing else.
 *
 *  What each block *says* is decided in `src/project.ts`, where a check can
 *  reach it without a phone; this is the drawing of it. Every shape here was
 *  measured off `design/divan/frames/02-mobile2-*.html` (V4, the product at
 *  work) and `07-mobile7-*.html` (S4 the same page with a different product's
 *  numbers, S5 a product nothing has touched in weeks, S6 one whose board is
 *  still empty), and the frame each one came from is named above it.
 *
 *  Colour never comes from here: a tone is asked of the token table through
 *  `toneColours`, and the parts these are built out of (`components/divan`)
 *  bring their own. There is no placeholder in this file — a branch card with
 *  nothing in its third number slot is drawn with the slot empty, which is what
 *  the frames do, and never with a dash standing in for a figure. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './text';
import { Card, Monogram, StatusDot } from './divan';
import { SLOTS } from '../project';
import { em, RADIUS, toneColours, useTokens, type State, type Tone } from '../theme';

// ── 1 · whose page this is ──────────────────────────────────────────────────

/** Mobile2 V4 and Mobile7 S4/S5: a 44 pt monogram, the product's name at 26 pt
 *  semibold, and under it in mono what sort of thing it is and what it is for.
 *
 *  The mono line is content and not ours (`project.ts subtitle`), so a product
 *  nobody has described has no line rather than an invented one. */
export function ProjectHead({ name, index, note, style }: {
  name: string;
  /** Its place in the project list, so one product is one hue everywhere. */
  index: number | null;
  note?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 }, style]}>
      <Monogram name={name} index={index} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 26, fontWeight: '600', letterSpacing: em(26, -0.02) }}>
          {name}
        </Text>
        {!!note && (
          <Text mono numberOfLines={1} style={{ fontSize: 12, color: t.ink3, marginTop: 5 }}>{note}</Text>
        )}
      </View>
    </View>
  );
}

// ── 2 · what is happening, and what it is waiting for ───────────────────────

/** Mobile7 S4's two-row block: `background:s1; border-radius:14px; padding:11px
 *  14px; gap:6`, each row a 52 pt mono label against a 13.5 pt sentence.
 *
 *  Two rows and always two: "nothing is running" and "nothing is waiting on you"
 *  are answers, and a block that dropped a row when the answer was calm would
 *  make the reader work out which of the two was missing. */
export function StateLines({ rows, style }: {
  rows: { label: string; text: string; tone: Tone | null; quiet?: boolean }[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card radius={RADIUS.tile} inset={false} ring="none" style={style}>
      <View style={{ padding: 11, paddingHorizontal: 14, gap: 6 }}>
        {rows.map((row) => (
          <View key={row.label} style={{ flexDirection: 'row', gap: 8 }}>
            <Text mono style={{ width: 52, fontSize: 11, lineHeight: 19, fontWeight: '600',
                                color: row.tone ? toneColours(t, row.tone).fg : t.ink3 }}>
              {row.label}
            </Text>
            <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 13.5 * 1.4,
                           color: row.quiet ? t.ink2 : t.ink }}>
              {row.text}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

// ── 3 · a product nothing has touched in weeks ──────────────────────────────

/** Mobile7 S5: no surface, a `line2` ring, `padding:16px; gap:6`, a 20 pt
 *  semibold sentence and a grey paragraph under it.
 *
 *  It stands where the two rows above would be, because it is the same fact said
 *  properly: "nothing running, nothing waiting" for three weeks is not a calm
 *  morning, it is a product that has stopped, and the page says so in the words
 *  it takes to be useful. */
export function QuietNote({ title, body, style }: {
  title: string; body: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card hollow inset={false} style={style}>
      <View style={{ padding: 16, gap: 6 }}>
        <Text style={{ fontSize: 20, fontWeight: '600', letterSpacing: em(20, -0.01) }}>{title}</Text>
        <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2 }}>{body}</Text>
      </View>
    </Card>
  );
}

// ── 4 · a branch ────────────────────────────────────────────────────────────

/** One face of a product (Mobile2 V4, Mobile7 S4 and S5): a dot and its name,
 *  when its source last spoke at the far end, one line of status, and two or
 *  three numbers in three fixed slots.
 *
 *  `background:s1; border-radius:14px; padding:11px 14px 12px; gap:8`, the name
 *  at 15 pt semibold, the status line 13.5 pt in `ink2`, each figure a 17 pt
 *  mono number over a 10.5 pt mono label. A branch whose source has been silent
 *  for a week is drawn at four fifths (S5), which is the frame's own way of
 *  saying "this is still here and it is not news".
 *
 *  The card is not a way in: a branch has a page of its own in the design
 *  (Mobile9 S10 and S11) and that screen does not exist yet, so nothing here
 *  offers a press that would do nothing. */
export function BranchCard({ name, state, line, figures, refreshed, tone, dim, style }: {
  name: string;
  state: State;
  /** The line of status, already in the reader's language. */
  line: string;
  /** One to three numbers; the rest of the three slots stay empty. */
  figures: { value: number | string; label: string }[];
  /** `07:02`, `2 days old`. Absent where nothing has ever refreshed it. */
  refreshed?: string | null;
  /** …and what colour that is. Grey unless it is old enough to matter. */
  tone?: Tone | null;
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Card radius={RADIUS.tile} inset={false} style={[dim ? { opacity: 0.8 } : null, style]}>
      <View style={{ padding: 11, paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* A branch with nothing on it is the frame's unfilled dot: `line2`,
              which is quieter than the grey a state would give it. */}
          <StatusDot size={7} state={state === 'quiet' ? t.line2 : state} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontWeight: '600' }}>{name}</Text>
          {!!refreshed && (
            <Text mono numberOfLines={1}
              style={{ marginLeft: 'auto', fontSize: 11,
                       color: tone ? toneColours(t, tone).fg : t.ink3 }}>{refreshed}</Text>
          )}
        </View>
        <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 13.5 * 1.35, color: t.ink2 }}>{line}</Text>
        {figures.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Array.from({ length: SLOTS }, (_, i) => figures[i]).map((figure, i) => (
              <View key={i} style={{ flex: 1, minWidth: 0 }}>
                {!!figure && (
                  <>
                    <Text mono numberOfLines={1}
                      style={{ fontSize: 17, fontWeight: '500', letterSpacing: em(17, -0.01) }}>
                      {figure.value}
                    </Text>
                    <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: t.ink3, marginTop: 2 }}>
                      {figure.label}
                    </Text>
                  </>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </Card>
  );
}
