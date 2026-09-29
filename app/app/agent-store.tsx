import React, { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { EmptyState, Group, ListRow } from '../src/components/divan';
import { PageHead } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { AgentGlyph } from '../src/components/agentcard';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import type { StoreItem } from '../src/protocol';

/** What can be added, before anything is added.
 *
 *  A tap on "Add an agent" that goes straight to installing something the
 *  reader never chose is a tap they cannot take back. The list is also the
 *  only place that says what an agent brings with it before it lands.
 *
 *  Drawn out of the design system's parts: Web15 W16's rows, whose leading mark
 *  is the thing's own badge rather than an icon well, in a card per source with
 *  the source's name in mono over it. A source that would not answer says so on
 *  its own row rather than as a tinted block — it is one source failing, not
 *  the page. */
export default function AgentStore() {
  const router = useRouter();
  const T = useT();
  const t = useTokens();
  const { agents, storeSources, storeLoaded, loadStore, conn } = useStore();

  useFocusEffect(useCallback(() => {
    if (conn === 'online' && !storeLoaded) void loadStore().catch(() => {});
  }, [conn, storeLoaded, loadStore]));

  // An installed agent carries the name of the source it came from.
  const installed = (item: StoreItem) => agents.some((a) => a.name === item.id.split(':')[0]);
  const total = storeSources.reduce((n, s) => n + s.items.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 32, gap: 10 }}>
        <BackRow label={T('mAgents')} onPress={() => router.back()} style={{ paddingHorizontal: 4 }} />
        <PageHead title={T('addAgent')} count={storeLoaded ? total || null : null} style={{ marginBottom: 2 }} />
        {!storeLoaded ? (
          // Nothing has arrived yet. A word rather than a shape pretending to be
          // a list: Divan's only repeating animation is the running dot.
          <Text mono style={{ fontSize: 12, color: t.ink3, paddingHorizontal: 4 }}>{T('asLoading')}</Text>
        ) : total === 0 && storeSources.every((s) => !s.error) ? (
          <EmptyState title={T('asNone')} body={T('asNoneBody')} />
        ) : storeSources.map((src) => (
          <Group key={src.id} label={src.label}>
            {src.error ? (
              <ListRow first boxed chevron={false} title={T('asSourceFailed')} note={src.error} noteLines={3}
                meta={T('asUnreachable')} tone="red" />
            ) : src.items.map((item, i) => {
              const have = installed(item);
              return (
                <ListRow key={item.id} first={i === 0} boxed
                  lead={<AgentGlyph label={item.label} color={item.color} size={34} radius={9} font={15} />}
                  title={item.label}
                  note={item.skills ? T('nSkills', { n: String(item.skills) }) : null} noteMono
                  chevron={!have}
                  right={have ? <Icon name="check" size={18} color={t.ink} /> : undefined}
                  onPress={() => router.push({ pathname: '/agent-install', params: { id: item.id } })} />
              );
            })}
          </Group>
        ))}
      </ScrollView>
    </View>
  );
}
