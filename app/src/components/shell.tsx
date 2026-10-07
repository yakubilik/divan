/** The shell the three Divan places stand in: the tab bar at the foot of every
 *  one of them, and the project bar across the top of the Dashboard.
 *
 *  What a place *is* — which route, which icon, what the project bar says — is
 *  in `src/shell.ts`, where a test can reach it. This is the drawing of it, out
 *  of the design system's own parts and nothing else (`components/divan`). */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../store';
import { useNavGuard } from '../nav';
import { em, useTokens } from '../theme';
import { Pill, StatusDot } from './divan';
import { Icon } from './icon';
import { Text } from './text';
import { useDivanShown } from '../queue';
import { machineWords, quotaWords, systemLine } from '../dashboard';
import { since } from '../tickets';
import { WARN_AT } from '../machine';
import { PLACE_ICON, PLACE_LABEL, PLACE_ROUTE, placeOf, type Chip, type Place } from '../shell';

/** A place: the thin line over it, and its own content under it (HANDOVER §1,
 *  §3 `dv-topline`; DashboardPhone).
 *
 *  The line is the whole navigation. On the left the way back — up one level,
 *  to the Dashboard from a place — or the word `divan` on the Dashboard itself.
 *  On the right what the fleet is: machines answering out of paired, and the
 *  quota left as a ring and its figure (absent where nothing measured one),
 *  then Chat and Machine as 44 pt buttons. The tab bar is gone; both of its
 *  other places are one press away from every screen, as they were.
 *
 *  `top` is the status bar's room. The chat place does not take it, because
 *  the chat screen has always drawn its own. */
export function Shell({ place, top = true, back, children }: {
  place: Place;
  /** Kept for the callers; the count is on the Dashboard's own line now. */
  badge?: number;
  top?: boolean;
  /** Where the left end leads. Absent: to the Dashboard from another place, and
   *  the word on the Dashboard itself. */
  back?: { label: string; onPress: () => void } | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const go = useNavGuard();
  const insets = useSafeAreaInsets();
  const t = useTokens();
  const T = useT();
  const path = (usePathname() || '/').split('?')[0];
  const here = placeOf(path) ?? place;
  // A screen pushed over a place (a card, the waiting list) goes back to what
  // it was pushed from; a place goes back to the Dashboard.
  const root = path === '/' || path === PLACE_ROUTE[here];
  const leave = back !== undefined ? back
    : here === 'dashboard' && root ? null
      : { label: T(PLACE_LABEL.dashboard),
          onPress: () => go(() => (!root && router.canGoBack() ? router.back() : router.replace(PLACE_ROUTE.dashboard))) };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top ? insets.top : 0 }}>
      <Topline back={leave} here={here}
        onPlace={(p) => { if (p !== here) go(() => router.replace(PLACE_ROUTE[p])); }} />
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
    </View>
  );
}

/** `divan · ● 2/2 · ◔ 64% · Chat · Machine`. */
export function Topline({ back, here, onPlace }: {
  back: { label: string; onPress: () => void } | null;
  here: Place;
  onPlace: (place: Place) => void;
}) {
  const t = useTokens();
  const T = useT();
  const view = useDivanShown();
  const sys = systemLine(view);
  const low = !!sys.quota && sys.quota.pct / 100 <= WARN_AT;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16 }}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel={T('cmBackTo', { place: back.label })}
          onPress={back.onPress}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingRight: 8 }}>
          <Icon name="chevron_left" size={20} color={t.ink2} />
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500', color: t.ink2, maxWidth: 160 }}>{back.label}</Text>
        </Pressable>
      ) : (
        <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600', letterSpacing: em(18, -0.02), color: t.ink }}>
          divan
        </Text>
      )}
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {sys.machines > 0 && (
          // The figure is drawn; the sentence it stands for is what is read out.
          <View accessibilityLabel={T(machineWords(sys, (x) => since(x, T)).key, machineWords(sys, (x) => since(x, T)).params)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <StatusDot state={sys.unreachable === 0 ? 'running' : sys.unreachable < sys.machines ? 'asking' : 'stuck'} size={7} />
            <Text mono style={{ fontSize: 12, fontWeight: '500', color: t.ink2 }}>
              {sys.machines - sys.unreachable}/{sys.machines}
            </Text>
          </View>
        )}
        {!!sys.quota && (
          <View accessibilityLabel={`${T(quotaWords(sys)!.key, quotaWords(sys)!.params)}${low ? `, ${T('cmLow')}` : ''}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 1, height: 12, backgroundColor: t.line2 }} />
            <Ring pct={sys.quota.pct} colour={low ? t.amber : t.ink2} track={t.line2} />
            <Text mono style={{ fontSize: 12, fontWeight: '500', color: t.ink2 }}>{sys.quota.pct}%</Text>
            {low && <Text style={{ fontSize: 12, color: t.amber }}>{T('cmLow')}</Text>}
          </View>
        )}
        {(['chat', 'machine'] as Place[]).map((p) => (
          <Pressable key={p} accessibilityRole="button" accessibilityLabel={T(PLACE_LABEL[p])}
            accessibilityState={{ selected: here === p }} onPress={() => onPlace(p)}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
                     borderRadius: 22, backgroundColor: here === p ? t.line2 : 'transparent' }}>
            <Icon name={PLACE_ICON[p]} size={22} color={here === p ? t.ink : t.ink2} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The quota ring: a 16 pt track with the share left drawn over it. */
function Ring({ pct, colour, track }: { pct: number; colour: string; track: string }) {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const r = 6;
  const a = 2 * Math.PI * p - Math.PI / 2;
  const x = 8 + r * Math.cos(a);
  const y = 8 + r * Math.sin(a);
  const arc = p >= 1 ? 'M8 2a6 6 0 1 1 0 12a6 6 0 1 1 0-12'
    : `M8 2A6 6 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Path d="M8 2a6 6 0 1 1 0 12a6 6 0 1 1 0-12" stroke={track} strokeWidth={3} fill="none" />
      {p > 0 && <Path d={arc} stroke={colour} strokeWidth={3} fill="none" />}
    </Svg>
  );
}

/** The bar across the top of the Dashboard (Mobile1 V1): `All`, then one chip
 *  per product, each with the dot that says how it is doing. It scrolls
 *  sideways and never wraps — the frame runs its fifth chip off the edge. */
export function ProjectBar({ chips, onSelect }: {
  chips: Chip[];
  onSelect: (key: string | null) => void;
}) {
  // `flex:none` in the frame: the bar is one chip tall, and a horizontal
  // scroller in a column will otherwise take the whole page.
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ gap: 6, paddingTop: 10, paddingHorizontal: 16 }}>
      {chips.map((chip) => (
        <Pill key={chip.key ?? '*'} label={chip.label} dot={chip.state}
          face={chip.selected ? 'ink' : 'surface'} onPress={() => onSelect(chip.key)} />
      ))}
    </ScrollView>
  );
}
