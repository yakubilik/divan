import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Card, Icon, Label, Note, Skeleton, Text } from '../src/components/ui';
import { LargeTitlePage } from '../src/components/page';
import { AgentGlyph } from '../src/components/agentcard';
import type { StoreItem } from '../src/protocol';

/** What can be added, before anything is added.
 *
 *  A tap on "Add an agent" that goes straight to installing something the
 *  reader never chose is a tap they cannot take back. The list is also the
 *  only place that says what an agent brings with it before it lands. */
export default function AgentStore() {
  const router = useRouter();
  const T = useT();
  const c = useColors();
  const { agents, storeSources, storeLoaded, loadStore, conn } = useStore();

  useFocusEffect(useCallback(() => {
    if (conn === 'online' && !storeLoaded) void loadStore().catch(() => {});
  }, [conn, storeLoaded, loadStore]));

  // An installed agent carries the name of the source it came from.
  const installed = (item: StoreItem) => agents.some((a) => a.name === item.id.split(':')[0]);

  return (
    <LargeTitlePage title={T('addAgent')} titleStyle={{ paddingTop: 4, paddingBottom: 14 }}>
      <View style={{ paddingHorizontal: 16, gap: 6 }}>
        {!storeLoaded ? (
          <Card>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, opacity: 1 - i * 0.25 },
                i < 2 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                <Skeleton width={36} height={36} radius={10} />
                <View style={{ flex: 1, gap: 7 }}><Skeleton width="45%" height={12} /><Skeleton width="60%" height={10} color={c.fill} /></View>
              </View>
            ))}
          </Card>
        ) : storeSources.map((src) => (
          <View key={src.id} style={{ gap: 6 }}>
            <Label style={{ paddingTop: 10 }}>{src.label}</Label>
            {src.error ? (
              <Note tone="danger" icon="error">{src.error}</Note>
            ) : (
              <Card>
                {src.items.map((item, i) => {
                  const have = installed(item);
                  return (
                    <Pressable key={item.id}
                      onPress={() => router.push({ pathname: '/agent-install', params: { id: item.id } })}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
                        i < src.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
                      <AgentGlyph label={item.label} color={item.color} size={36} radius={10} font={16} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontSize: 15, fontWeight: '500' }}>{item.label}</Text>
                        <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.muted }}>
                          {[item.skills ? T('nSkills', { n: String(item.skills) }) : '', src.label].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {have ? <Icon name="check" size={20} /> : <Icon name="chevron_right" size={18} color={c.faint} />}
                    </Pressable>
                  );
                })}
              </Card>
            )}
          </View>
        ))}
      </View>
    </LargeTitlePage>
  );
}
