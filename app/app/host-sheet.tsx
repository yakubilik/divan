import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Card, Dot, Icon, Spinner, Text } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { Sheet, useSheet } from '../src/components/sheet';

/** The computer picker behind the name in the top-left of the home screens.
 *  Picking one closes the sheet straight away — the switch itself plays out on
 *  the screen underneath, which keeps its list up until the new one lands. */
export default function HostSheet() {
  const router = useRouter();
  return (
    <Sheet onClose={() => router.back()}>
      <Body />
    </Sheet>
  );
}

function Body() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { close } = useSheet();
  const hosts = useStore((s) => s.hosts);
  const activeHostId = useStore((s) => s.activeHostId);
  const hostInfo = useStore((s) => s.hostInfo);
  const conn = useStore((s) => s.conn);
  const switching = useStore((s) => s.switching);
  const switchHost = useStore((s) => s.switchHost);
  const removeHost = useStore((s) => s.removeHost);
  const [busy, setBusy] = useState<string | null>(null);

  function pick(id: string) {
    if (id === activeHostId) { close(); return; }
    void Haptics.selectionAsync().catch(() => {});
    // Close first: the crossfade belongs to the screen underneath, and holding
    // the sheet open through the reconnect would hide the thing being waited on.
    close();
    void switchHost(id);
  }

  function confirmRemove(id: string, name: string) {
    alert(T('removeHost'), T('removeHostBody', { name }), [
      { text: T('cancel'), style: 'cancel' },
      {
        text: T('remove'), style: 'destructive', onPress: async () => {
          setBusy(id);
          try { await removeHost(id); } finally { setBusy(null); }
          // Nothing left to pick from — the pairing screen is the only way out.
          if (useStore.getState().hosts.length === 0) { router.dismissAll(); router.replace('/pair'); }
        },
      },
    ]);
  }

  return (
    <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', paddingHorizontal: 4 }}>{T('computersTitle')}</Text>
      <Card>
        {hosts.map((h, i) => {
          const active = h.id === activeHostId;
          // Only the live computer can claim a colour; the rest are just names.
          const dot = active ? (conn === 'online' ? c.ok : conn === 'connecting' ? c.warn : c.lineStrong) : c.lineStrong;
          return (
            <Pressable key={h.id} onPress={() => pick(h.id)} onLongPress={() => confirmRemove(h.id, h.name)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
                i < hosts.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
              <Dot color={dot} />
              <View style={{ flex: 1, gap: 2 }}>
                {/* Every computer reads at full strength; the dot and the check say which one is live. */}
                <Text style={{ fontSize: 15, fontWeight: active ? '600' : '400' }}>
                  {(active && hostInfo?.name?.replace('.local', '')) || h.name}
                </Text>
                <Text mono style={{ fontSize: 11, color: c.muted }}>{h.host}:{h.port}</Text>
              </View>
              {busy === h.id || (active && switching) ? <Spinner /> : active ? <Icon name="check" size={20} /> : <Icon name="chevron_right" size={18} color={c.faint} />}
            </Pressable>
          );
        })}
      </Card>
      <Pressable onPress={() => close(() => router.push({ pathname: '/pair', params: { add: '1' } }))}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 4 }, pressed && { opacity: 0.6 }]}>
        <Icon name="add" size={18} />
        <Text style={{ fontSize: 15, fontWeight: '500' }}>{T('addComputer')}</Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('hostHint')}</Text>
    </View>
  );
}
