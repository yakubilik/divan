import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForceScheme, useTokens, type Scheme } from '../src/theme';
import { Text } from '../src/components/text';
import { Icon } from '../src/components/icon';
import {
  Button, Card, ColumnTabs, Counter, EmptyState, ExecutorBadge, ListRow, Monogram, Pill,
  SectionHeader, Sheet, StateMark, StatusDot, TabBar,
} from '../src/components/divan';

/** Every part of the Divan design system, on one screen, in whichever theme you
 *  ask for.
 *
 *  Eleven screens are built out of `src/components/divan.tsx`, and a part that
 *  can only be seen inside a finished screen cannot be compared with the frame
 *  it came from. So each of them is drawn here in the states the frames draw it
 *  in, under the name of the frame it was measured off: hold this next to
 *  `design/divan/frames/` and a disagreement is settled by looking.
 *
 *  Both themes are first-class in the design and the app has no theme switch —
 *  the phone has one already — so the only place that needs to show one theme
 *  while the phone is in the other is this screen, and the switch at the top of
 *  it reaches no further than the page below it.
 *
 *  Development only. Nothing links here in a release build, and the route
 *  itself turns away if one is reached some other way. The strings in it are
 *  the names of parts rather than anything a user reads, which is why they are
 *  not in the string table. */
export default function DivanGallery() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [scheme, setScheme] = useState<Scheme | null>(null);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <ForceScheme scheme={scheme}>
      <Page onBack={() => router.back()} scheme={scheme} onScheme={setScheme} bottom={insets.bottom} top={insets.top} />
    </ForceScheme>
  );
}

function Page({ onBack, scheme, onScheme, top, bottom }: {
  onBack: () => void; scheme: Scheme | null; onScheme: (s: Scheme | null) => void; top: number; bottom: number;
}) {
  const t = useTokens();
  const [tab, setTab] = useState('dashboard');
  const [column, setColumn] = useState('progress');
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Pressable onPress={onBack} hitSlop={8} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron_left" size={26} color={t.ink} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600' }}>Divan parts</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {([['System', null], ['Light', 'light'], ['Dark', 'dark']] as [string, Scheme | null][]).map(([label, s]) => (
            <Pill key={label} label={label} face={scheme === s ? 'ink' : 'surface'} onPress={() => onScheme(s)}
              style={{ height: 30, paddingHorizontal: 11 }} />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 24, gap: 18 }}>
        <Part name="Counter" frame="Mobile1 V1 / V3">
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Counter value={2} label="Needs you" tone="amber" />
            <Counter value={2} label="Stuck" tone="red" />
            <Counter value={4} label="Running" />
            <Counter value={0} label="Done today" tone="run" />
          </View>
        </Part>

        <Part name="Section header" frame="Mobile1 V1 · Mobile6 S3">
          <SectionHeader title="Overview" right="4 projects · Mon 28 Sep" />
          <SectionHeader title="Needs you" count={2} />
          <SectionHeader title="Projects" note="sorted by urgency" />
          <SectionHeader kind="mark" tone="amber" title="? questions" count={1} />
          <SectionHeader kind="mark" tone="red" title="■ stuck" count={1} />
          <SectionHeader kind="mark" title="yours" count={1} />
        </Part>

        <Part name="Status dot" frame="Mobile1 V1 / V3 · Web15 W12">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 }}>
            <StatusDot state="running" />
            <StatusDot state="asking" />
            <StatusDot state="stuck" />
            <StatusDot state="quiet" />
            <StatusDot state="asking" hollow />
            <StatusDot state="running" size={7} />
            <StateMark state="stuck" />
            <StateMark state="asking" />
            <StateMark state="running" />
            <StateMark state="done" />
            <StateMark state="yours" />
          </View>
        </Part>

        <Part name="Pill" frame="Mobile1 V1 · Mobile6 S3">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 }}>
            <Pill label="All" face="ink" dot="asking" />
            <Pill label="Quire" dot="stuck" />
            <Pill label="Hush" dot="asking" />
            <Pill label="The Long Walk" dot={t.line2} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 }}>
            <Pill label="Follow Stripe" face="amber" />
            <Pill label="Keep 3" face="outline" />
            <Pill label="Reply…" face="outline" />
          </View>
        </Part>

        <Part name="Button" frame="Mobile6 S3 · Mobile7 S6">
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
            <Button label="Resubmit" face="amber" style={{ flex: 1 }} />
            <Button label="Not yet" face="outline" style={{ flex: 1 }} />
          </View>
          <View style={{ gap: 8, paddingHorizontal: 4 }}>
            <Button label="New ticket" icon="add" tall />
            <Button label="Tell Divan what Pebble is" face="outline" tall />
          </View>
        </Part>

        <Part name="Executor badge · monogram" frame="Mobile11 EXS · Mobile3 · Mobile1 V1">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
            {['coder', 'unassigned', 'seo', 'analyst', 'research', 'divan', 'you'].map((e) => (
              <ExecutorBadge key={e} executor={e} />
            ))}
            <ExecutorBadge executor="coder" size={22} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
            {['Quire', 'Kanji Daily', 'Hush', 'The Long Walk', 'Pebble'].map((p, i) => (
              <Monogram key={p} name={p} index={i} />
            ))}
            <Monogram name="Quire" size={26} />
          </View>
        </Part>

        <Part name="Card" frame="Mobile1 V1 · Mobile3 · Mobile6 S3">
          <View style={{ gap: 8, paddingHorizontal: 4 }}>
            <Card ring="amber">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Monogram name="Quire" size={22} />
                <Text style={{ fontSize: 13, fontWeight: '600' }}>Quire</Text>
                <Text mono style={{ marginLeft: 'auto', fontSize: 11, fontWeight: '500', color: t.amber }}>? Coder asks</Text>
              </View>
              <Text style={{ fontSize: 15, lineHeight: 15 * 1.35, fontWeight: '500' }}>
                Keep our 3 webhook retries, or follow Stripe’s 3-day schedule?
              </Text>
            </Card>
            <Card bar={0.38}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 28 }}>
                <ExecutorBadge executor="coder" />
                <View style={{ minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600' }}>Coder</Text>
                  <Text mono style={{ fontSize: 10.5, color: t.ink3 }}>writes code · opens PRs</Text>
                </View>
              </View>
              <Text style={{ fontSize: 15.5, lineHeight: 15.5 * 1.3, fontWeight: '600' }}>Bulk invite clients from a CSV</Text>
              <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2 }}>
                Studios want to add a whole client roster at once. Upload a CSV of names and emails, preview who gets
                invited, send in one go.
              </Text>
            </Card>
            <Card ring="red">
              <Text style={{ fontSize: 15.5, fontWeight: '600' }}>Fix portal login on Safari 17</Text>
            </Card>
            <Card lifted ring="none">
              <Text style={{ fontSize: 15, fontWeight: '600' }}>Custom domains for client portals</Text>
            </Card>
          </View>
        </Part>

        <Part name="List row" frame="Mobile11 S16">
          <View style={{ paddingHorizontal: 16 }}>
            <ListRow first icon="monitor" title="Machines" note="3 paired" meta="all reachable" tone="run" />
            <ListRow icon="group" title="Executors" note="4 Coders, 3 branch agents, Divan, you" />
            <ListRow icon="terminal" title="Terminals" note="studio, mini, cloud" />
            <ListRow icon="screen_share" title="Remote screen" note="studio, mini" />
            <ListRow icon="key" title="Accounts & sign-ins" note="GitHub, App Store Connect, Stripe" meta="1 expiring" tone="amber" />
            <ListRow icon="speed" title="Quota thresholds" note="warn at 20% · pause at 0%" />
            <ListRow icon="shield" title="Admin" note="backups, logs, API keys" />
            <ListRow icon="settings" title="Settings" note="appearance, haptics, voice" />
          </View>
        </Part>

        <Part name="Column tabs" frame="Mobile2 V5 · Mobile3">
          <ColumnTabs value={column} onChange={setColumn} dragging={dragging} target="progress"
            columns={[
              { key: 'icebox', label: 'Ice Box', count: 11 },
              { key: 'queued', label: 'Queued', count: 4 },
              { key: 'progress', label: 'In Progress', count: 3 },
              { key: 'done', label: 'Done', count: 48 },
            ]} />
          <View style={{ paddingHorizontal: 16 }}>
            <Button label={dragging ? 'Put the card down' : 'Pick a card up'} face="outline"
              onPress={() => setDragging((d) => !d)} />
          </View>
        </Part>

        <Part name="Empty state" frame="Mobile7 S6">
          <View style={{ height: 320, backgroundColor: t.s1, borderRadius: 16, marginHorizontal: 16 }}>
            <EmptyState
              title="A new board."
              body="Write the first ticket. A title and a couple of sentences is all it needs; the agent brief can come later."
              actions={<>
                <Button label="New ticket" icon="add" tall />
                <Button label="Tell Divan what Pebble is" face="outline" tall />
              </>}
              foot="Divan can draft the first five tickets into Ice Box. Nothing starts until you move one." />
          </View>
        </Part>

        <Part name="Sheet" frame="Web15 W12 · the app's own shell">
          <View style={{ paddingHorizontal: 16 }}>
            <Button label="Open the sheet" face="outline" onPress={() => setSheet(true)} />
          </View>
        </Part>

        <Part name="Tab bar" frame="Mobile1 V1">
          <TabBar value={tab} onChange={setTab} style={{ borderRadius: 0 }}
            tabs={[
              { key: 'dashboard', label: 'Dashboard', icon: 'grid_view', badge: 2 },
              { key: 'chat', label: 'Chat', icon: 'chat_bubble' },
              { key: 'machine', label: 'Machine', icon: 'dns' },
            ]} />
        </Part>
      </ScrollView>

      {sheet && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
          <Sheet title="Machine" note="Infrastructure. Nothing here needs you." onClose={() => setSheet(false)}>
            <View style={{ paddingHorizontal: 16, paddingBottom: bottom + 16 }}>
              <ListRow first icon="monitor" title="Machines" note="3 paired" meta="all reachable" tone="run" />
              <ListRow icon="group" title="Executors" note="4 Coders, 3 branch agents, Divan, you" />
              <ListRow icon="terminal" title="Terminals" note="studio, mini, cloud" />
            </View>
          </Sheet>
        </View>
      )}
    </View>
  );
}

/** One part, with the frame it was measured off written next to its name. */
function Part({ name, frame, children }: { name: string; frame: string; children: React.ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: t.ink2 }}>{name}</Text>
        <Text mono numberOfLines={1} style={{ flex: 1, fontSize: 10.5, color: t.ink3, textAlign: 'right' }}>{frame}</Text>
      </View>
      <View style={{ gap: 8, paddingHorizontal: 12 }}>{children}</View>
    </View>
  );
}
