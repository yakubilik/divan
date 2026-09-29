/** The shell the three Divan places stand in: the tab bar at the foot of every
 *  one of them, and the project bar across the top of the Dashboard.
 *
 *  What a place *is* — which route, which icon, what the project bar says — is
 *  in `src/shell.ts`, where a test can reach it. This is the drawing of it, out
 *  of the design system's own parts and nothing else (`components/divan`). */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../store';
import { useNavGuard } from '../nav';
import { useTokens } from '../theme';
import { Pill, TabBar } from './divan';
import { PLACES, PLACE_ICON, PLACE_LABEL, PLACE_ROUTE, placeOf, type Chip, type Place } from '../shell';

/** A place: its own content, with the tab bar under it.
 *
 *  `top` is the status bar's room. The Dashboard and Machine take it here,
 *  because the frames start their content right under the clock; the Chat
 *  place does not, because the chat screen has always drawn its own. */
export function Shell({ place, badge, top = true, children }: {
  place: Place;
  /** The amber count over the Dashboard's icon: how much needs a person. */
  badge?: number;
  top?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const go = useNavGuard();
  const insets = useSafeAreaInsets();
  const t = useTokens();
  const T = useT();
  // The tab bar follows the route rather than the prop, so a screen pushed over
  // a place — the ticket wall, Settings — cannot leave it lit on the wrong one.
  const here = placeOf(usePathname()) ?? place;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top ? insets.top : 0 }}>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      <TabBar value={here}
        tabs={PLACES.map((p) => ({
          key: p, label: T(PLACE_LABEL[p]), icon: PLACE_ICON[p],
          ...(p === 'dashboard' && badge ? { badge } : {}),
        }))}
        onChange={(key) => { if (key !== here) go(() => router.replace(PLACE_ROUTE[key as Place])); }} />
    </View>
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
