import React, { useEffect, useMemo } from 'react';
import { FlatList, LogBox, Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForceScheme, useColors } from '../src/theme';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { AssistantText, UserBubble } from '../src/components/chat';

/** Answers carrying ```mermaid blocks (#645) — a flowchart, a pie, an
 *  xychart-beta bar chart, a sequence and one that is not a diagram — drawn
 *  by the chat's own bubbles in a list laid out like the transcript, without a
 *  computer to send them.
 *
 *  Reached with `divan://diagram-fixtures`, `?scheme=dark|light` to draw it in
 *  one theme whatever the phone's is, and `?only=flow,pie` for some of them.
 *
 *  Development only, like `media-fixtures`: the route turns away in a release
 *  build. Its few words are fixture text, not anything a user reads. */
const FIXTURES: { id: string; ask: string; answer: string }[] = [
  { id: 'flow', ask: 'How does a message reach the agent?', answer: [
    'Like this:', '', '```mermaid', 'flowchart TD',
    '  A[Phone] -->|tailnet| B(Daemon)', '  B --> C{Agent}', '  C -->|tool call| D[Approval]', '  C -->|answer| A', '```',
    '', 'Approvals come back to the phone.'].join('\n') },
  { id: 'pie', ask: 'Where did the build time go?', answer: [
    '```mermaid', 'pie title Build time', '  "Compile" : 42', '  "Tests" : 30', '  "Bundle" : 18', '  "Upload" : 10', '```'].join('\n') },
  { id: 'xy', ask: 'Tickets this week?', answer: [
    '```mermaid', 'xychart-beta', '  title "Tickets per day"', '  x-axis [Mon, Tue, Wed, Thu, Fri]',
    '  y-axis "Tickets" 0 --> 12', '  bar [5, 8, 3, 11, 7]', '```'].join('\n') },
  { id: 'seq', ask: 'And the handshake?', answer: [
    '```mermaid', 'sequenceDiagram', '  Phone->>Daemon: chat.send', '  Daemon->>Agent: prompt',
    '  Agent-->>Daemon: answer', '  Daemon-->>Phone: event', '```'].join('\n') },
  { id: 'bad', ask: 'Draw the retry loop?', answer: [
    'Here:', '', '```mermaid', 'flowchart TD', '  A -->> -- B[[', '```'].join('\n') },
];

export default function DiagramFixtures() {
  const { scheme, only } = useLocalSearchParams<{ scheme?: string; only?: string }>();
  const forced = scheme === 'dark' || scheme === 'light' ? scheme : null;
  return <ForceScheme scheme={forced}><Fixtures only={only} /></ForceScheme>;
}

function Fixtures({ only }: { only?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const want = (only ?? '').split(',').filter(Boolean);
  // The transcript is an inverted list; so is this, newest at the bottom.
  const rows = useMemo(() => FIXTURES.filter((f) => !want.length || want.includes(f.id))
    .flatMap((f) => [{ key: `${f.id}-q`, user: true, text: f.ask }, { key: `${f.id}-a`, user: false, text: f.answer }])
    .reverse(), [only]);

  // The development warnings toast would sit over the diagrams being looked at.
  useEffect(() => { LogBox.ignoreAllLogs(true); return () => LogBox.ignoreAllLogs(false); }, []);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Icon name="chevron_left" size={26} color={c.ink} /></Pressable>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>diagram fixtures</Text>
      </View>
      <FlatList
        data={rows}
        inverted
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 + insets.bottom, gap: 12, flexGrow: 1 }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        renderItem={({ item }) => (item.user ? <UserBubble text={item.text} /> : <AssistantText text={item.text} />)}
      />
    </View>
  );
}
