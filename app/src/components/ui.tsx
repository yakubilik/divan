import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { em, providerMark, useColors } from '../theme';

export { Icon } from './icon';
export { Text, TextInput } from './text';

/** An icon standing in a line of text: the web font it was drawn with gives
 *  a glyph a 1.2 em line box, and rows were laid out around that height. */
export function IconLine({ name, size = 18, color, weight }: { name: string; size?: number; color?: string; weight?: number }) {
  return <View style={{ height: Math.round(size * 1.2), justifyContent: 'center' }}><Icon name={name} size={size} color={color} weight={weight} /></View>;
}

/** Press feedback shared by everything tappable that is not a row. */
const dim = ({ pressed }: { pressed: boolean }) => (pressed ? { opacity: 0.6 } : null);

// ── page furniture ──────────────────────────────────────────────────────────

/** The top-left control of a pushed screen: a chevron (or a close cross) in a
 *  40 pt square, 10 pt in from the edge. */
export function BackBar({ onPress, icon = 'chevron_left', size = 26, right, style }: {
  onPress: () => void; icon?: string; size?: number; right?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2, paddingHorizontal: 10 }, style]}>
      <Pressable accessibilityLabel={icon === 'close' ? 'Close' : 'Back'} onPress={onPress} hitSlop={6} style={({ pressed }) => [s.sq40, pressed && { opacity: 0.5 }]}>
        <Icon name={icon} size={size} />
      </Pressable>
      {right}
    </View>
  );
}

export function LargeTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 14 }, style]}>
      <Text style={{ fontSize: 30, fontWeight: '600', letterSpacing: em(30, -0.025) }}>{children}</Text>
    </View>
  );
}

/** The bar a large title collapses into once it has scrolled away. */
export function CompactBar({ title, onBack, visible = true }: { title: string; onBack: () => void; visible?: boolean }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingBottom: 10, minHeight: 42,
                   borderBottomWidth: 1, borderBottomColor: visible ? c.line : 'transparent' }}>
      <Pressable onPress={onBack} hitSlop={10} style={({ pressed }) => [{ position: 'absolute', left: 10, top: 4, width: 26, height: 32, justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
        <Icon name="chevron_left" size={26} />
      </Pressable>
      {visible && <Text style={{ fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </View>
  );
}

/** A section heading above a card. */
export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ paddingHorizontal: 4 }, style]}>
      <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: em(12, 0.06), textTransform: 'uppercase', color: c.muted }}>{children}</Text>
    </View>
  );
}

/** Small mono eyebrow over a title: `CLAUDE · PERSONAL`, `STEP 1 OF 2`. */
export function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  const c = useColors();
  return <Text mono style={{ fontSize: 11, letterSpacing: em(11, 0.08), textTransform: 'uppercase', color: color ?? c.muted }}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14 }, style]}>{children}</View>;
}

/** A tappable line in a card: label on the left, the current value and a
 *  chevron on the right. */
export function Row({ label, value, mono, onPress, last, valueSize, children, style }: {
  label: string; value?: string | null; mono?: boolean; onPress?: () => void; last?: boolean;
  valueSize?: number; children?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, gap: 0 },
        !last && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }, style]}>
      <Text style={{ flex: 1, fontSize: 15 }}>{label}</Text>
      {children}
      {value != null && (
        <Text numberOfLines={1} mono={mono}
          style={{ fontSize: valueSize ?? (mono ? 12 : 13), color: c.muted, flexShrink: 1, marginLeft: 8 }}>{value}</Text>
      )}
      {onPress && <IconLine name="chevron_right" size={18} color={c.faint} />}
    </Pressable>
  );
}

/** One line of a card that is only there to separate. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ height: 1, backgroundColor: c.line }, style]} />;
}

// ── buttons ─────────────────────────────────────────────────────────────────

/** The full-width button at the foot of a screen. */
export function Button({ title, onPress, kind = 'primary', disabled, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'outline' | 'busy'; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const busy = kind === 'busy';
  return (
    <Pressable onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14,
        alignSelf: 'stretch',
      },
      kind === 'primary' && { backgroundColor: c.ink, padding: 15 },
      kind === 'outline' && { borderWidth: 1, borderColor: c.lineStrong, paddingVertical: 14, paddingHorizontal: 18 },
      busy && { backgroundColor: c.lineStrong, padding: 15 },
      disabled && !busy && { opacity: 0.4 },
      pressed && { opacity: 0.7 }, style]}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: kind === 'primary' ? c.onInk : busy ? c.muted : c.ink }}>{title}</Text>
    </Pressable>
  );
}

/** The small ink button inside a card or an empty state. */
export function SmallButton({ title, onPress, disabled, padH = 16, padV = 9, tone = 'ink' }: {
  title: string; onPress: () => void; disabled?: boolean; padH?: number; padV?: number; tone?: 'ink' | 'accent';
}) {
  const c = useColors();
  const accent = tone === 'accent';
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={(st) => [{ backgroundColor: accent ? c.accent : c.ink, borderRadius: accent ? 999 : 10, paddingHorizontal: padH, paddingVertical: padV },
        disabled && { opacity: 0.4 }, dim(st)]}>
      <Text style={{ fontSize: accent ? 13 : 14, fontWeight: '600', color: accent ? '#FFFFFF' : c.onInk }}>{title}</Text>
    </Pressable>
  );
}

/** A text link: underlined, centred, muted. */
export function LinkText({ title, onPress, onLongPress, color, weight = '400', size = 14 }: {
  title: string; onPress: () => void; onLongPress?: () => void; color?: string; weight?: '400' | '600'; size?: number;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={8} style={dim}>
      <Text style={{ fontSize: size, color: color ?? c.muted, fontWeight: weight, textDecorationLine: 'underline' }}>{title}</Text>
    </Pressable>
  );
}

// ── controls ────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({ options, value, onChange, labels, disabled }: {
  options: readonly T[]; value: T | null | undefined; onChange: (v: T) => void; labels?: Partial<Record<string, string>>; disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: 10, padding: 3 }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} disabled={disabled} onPress={() => onChange(o)}
            style={[{ flex: 1, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8 },
              on && { backgroundColor: c.segOn, boxShadow: c.shadow.seg }]}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: on ? '600' : '500', color: on ? c.ink : c.muted }}>
              {labels?.[o] ?? o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Chats | Agents, at the top of both home screens. */
export function Tabs({ value, onChange, labels }: { value: 0 | 1; onChange: (v: 0 | 1) => void; labels: [string, string] }) {
  const c = useColors();
  return (
    <View style={{ marginHorizontal: 16, flexDirection: 'row', backgroundColor: c.fill, borderRadius: 999, padding: 3 }}>
      {labels.map((l, i) => {
        const on = i === value;
        return (
          <Pressable key={l} onPress={() => !on && onChange(i as 0 | 1)}
            style={[{ flex: 1, alignItems: 'center', padding: 7, borderRadius: 999 },
              on && { backgroundColor: c.ink, boxShadow: c.shadow.seg }]}>
            <Text style={{ fontSize: 13, fontWeight: on ? '600' : '500', color: on ? c.onInk : c.muted }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 46×28, ink when on. */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={() => onChange(!value)} disabled={disabled} hitSlop={8}
      style={{ width: 46, height: 28, borderRadius: 999, backgroundColor: value ? c.ink : c.lineStrong, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ position: 'absolute', top: 2, left: value ? 20 : 2, width: 24, height: 24, borderRadius: 12,
                     backgroundColor: c.card, boxShadow: c.shadow.knob }} />
    </Pressable>
  );
}

/** A radio: a thick ink ring when chosen, a hairline when not. */
export function Radio({ on }: { on: boolean }) {
  const c = useColors();
  return <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 6 : 1.5, borderColor: on ? c.ink : c.lineStrong }} />;
}

// ── marks ───────────────────────────────────────────────────────────────────

/** The tools' own app icons, shipped with the app so a chat row says at a
 *  glance which one it talks to. (Their trademarks; used to identify them.) */
const PROVIDER_ICONS: Record<string, any> = {
  claude: require('../../assets/provider-claude.png'),
  codex: require('../../assets/provider-codex.png'),
};

/** The mark a chat, an account or a tool is drawn with: the tool's own icon,
 *  quieter on an archived chat. An account with nobody signed in has no icon
 *  to draw, so it keeps the dashed square and the two-letter mark. */
export function ProviderBadge({ provider, size = 26, variant }: {
  provider: string; size?: number; variant?: 'filled' | 'outline' | 'dashed';
}) {
  const c = useColors();
  const v = variant ?? 'filled';
  const icon = PROVIDER_ICONS[provider];
  if (v === 'dashed' || !icon) {
    return (
      <View style={[{ width: size, height: size, borderRadius: size * 0.3, alignItems: 'center', justifyContent: 'center' },
        v === 'dashed' ? { borderWidth: 1.5, borderColor: c.lineStrong, borderStyle: 'dashed' } : { backgroundColor: c.ink }]}>
        <Text mono style={{ fontSize: size * 0.42, fontWeight: '600', color: v === 'dashed' ? c.faint : c.onInk }}>
          {providerMark(provider)}
        </Text>
      </View>
    );
  }
  return (
    <Image source={icon} resizeMode="cover"
      style={{ width: size, height: size, borderRadius: size * 0.3, opacity: v === 'outline' ? 0.45 : 1 }} />
  );
}

/** Machine data on a row: model, effort, mode. */
export function Chip({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 }}>
      <Text mono numberOfLines={1} style={{ fontSize: 10.5, color: c.muted }}>{children}</Text>
    </View>
  );
}

export function Dot({ color, size = 8, style }: { color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** A thin ring with one coloured quarter, turning. The design's spinner. */
export function Spinner({ size = 11, width = 2, color, track }: { size?: number; width?: number; color?: string; track?: string }) {
  const c = useColors();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: width,
      borderColor: track ?? c.lineStrong, borderTopColor: color ?? c.ink, transform: [{ rotate }] }} />
  );
}

/** Five bars, the middle one tallest, breathing in turn: waiting on somebody
 *  else (a browser, a sign-in). */
export function WaitBars({ large }: { large?: boolean }) {
  const c = useColors();
  const spec = large
    ? { w: 5, gap: 5, h: 28, r: 3, bars: [[10, c.lineStrong], [20, c.muted], [28, c.ink], [16, c.muted], [8, c.lineStrong]] as [number, string][] }
    : { w: 4, gap: 4, h: 22, r: 2, bars: [[8, c.faint], [16, c.text2], [22, c.ink], [12, c.muted], [6, c.faint]] as [number, string][] };
  const anims = useRef(spec.bars.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = anims.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 120),
      Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay((spec.bars.length - 1 - i) * 120),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims, spec.bars.length]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spec.gap, height: spec.h }}>
      {spec.bars.map(([h, col], i) => (
        <Animated.View key={i} style={{ width: spec.w, height: h, borderRadius: spec.r, backgroundColor: col,
          transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, -h * 0.12] }) },
                      { scaleY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }} />
      ))}
    </View>
  );
}

// ── blocks ──────────────────────────────────────────────────────────────────

/** A tinted note: amber for a warning, clay-pink for a failure. */
export function Note({ tone = 'warn', icon, children, style }: {
  tone?: 'warn' | 'danger' | 'plain'; icon?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = tone === 'warn' ? c.warnBg : tone === 'danger' ? c.dangerBg : c.fill;
  const ic = tone === 'warn' ? c.warn : tone === 'danger' ? c.danger : c.muted;
  return (
    <View style={[{ flexDirection: 'row', gap: 8, backgroundColor: bg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }, style]}>
      {!!icon && <View style={{ paddingTop: 1 }}><Icon name={icon} size={16} color={ic} /></View>}
      {typeof children === 'string'
        ? <Text style={{ flex: 1, fontSize: 13, lineHeight: 13 * 1.45, color: c.text2 }}>{children}</Text>
        : <View style={{ flex: 1 }}>{children}</View>}
    </View>
  );
}

/** The centred "nothing here" of a list: a mark in a well, a line, a hint. */
export function EmptyState({ icon, title, body, action, style }: {
  icon?: string; title: string; body?: React.ReactNode; action?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingBottom: 140 }, style]}>
      {!!icon && (
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <Icon name={icon} size={30} color={c.text2} />
        </View>
      )}
      <Text style={{ fontSize: 18, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      {body != null && <Text style={{ fontSize: 14, color: c.muted, lineHeight: 21, textAlign: 'center' }}>{body}</Text>}
      {!!action && <View style={{ marginTop: 6 }}>{action}</View>}
    </View>
  );
}

/** A block that stands in for text that has not arrived. */
export function Skeleton({ width, height = 11, radius = 4, color, style }: {
  width: number | `${number}%`; height?: number; radius?: number; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      Animated.timing(a, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: color ?? c.line, opacity: a }, style]} />;
}

/** Placeholder rows in a card, the shape of the chat list's rows. */
export function SkeletonCard({ rows = 5, chips = true, style }: { rows?: number; chips?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <Card style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[{ flexDirection: 'row', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
          { borderBottomWidth: 1, borderBottomColor: c.line }]}>
          <Skeleton width={26} height={26} radius={8} />
          <View style={{ flex: 1, gap: 7, paddingTop: 2 }}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="85%" height={10} color={c.fill} />
            {chips && (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Skeleton width={48} height={14} radius={999} color={c.fill} />
                <Skeleton width={36} height={14} radius={999} color={c.fill} />
              </View>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  sq40: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
