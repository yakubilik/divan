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
 *  bring their own. */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './text';
import { Card, Monogram, StatusDot, Tap } from './divan';
import { em, RADIUS, toneColours, useTokens, type State, type Tone } from '../theme';

// ── 1 · whose page this is ──────────────────────────────────────────────────

/** ProjectPhone's head: a 44 pt monogram, the name at 28 with the meta line
 *  under it — the stage as a word, `live since 4 Jan 2026` — and the one
 *  sentence of what it is for below. No stage rail: the stage is that word. */
export function ProjectHead({ name, index, meta, description, right, style }: {
  name: string;
  /** Its place in the project list. */
  index: number | null;
  meta?: string;
  description?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <View style={[{ gap: 10 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Monogram name={name} index={index} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 28, lineHeight: 32, fontWeight: '600', letterSpacing: em(28, -0.03) }}>
            {name}
          </Text>
          {!!meta && <Text mono numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 16, color: t.ink3 }}>{meta}</Text>}
        </View>
        {right}
      </View>
      {!!description && (
        <Text style={{ fontSize: 14, lineHeight: 20, color: t.ink2 }}>{description}</Text>
      )}
    </View>
  );
}

/** The board in four numbers (ProjectPhone): one card, four columns of a mono
 *  figure over its name, In Progress in ink. The whole card opens the board. */
export function BoardSummary({ counts, label, onPress, style }: {
  counts: { key: string; label: string; count: number }[];
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  return (
    <Tap onPress={onPress}
      style={[{ flexDirection: 'row', backgroundColor: t.s1, borderRadius: RADIUS.md, borderWidth: 1,
                borderColor: t.line, paddingVertical: 12, paddingHorizontal: 8, minHeight: 44 }, style]}>
      <View accessibilityLabel={label} style={{ flexDirection: 'row', flex: 1 }}>
        {counts.map((c) => {
          const hot = c.key === 'in_progress';
          return (
            <View key={c.key} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Text mono style={{ fontSize: 18, lineHeight: 22, fontWeight: '500', color: t.ink }}>{c.count}</Text>
              <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: hot ? t.ink2 : t.ink3 }}>{c.label}</Text>
            </View>
          );
        })}
      </View>
    </Tap>
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
