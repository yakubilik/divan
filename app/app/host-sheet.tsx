import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Group, ListRow, Sheet, StatusDot, useSheet } from '../src/components/divan';
import { Icon } from '../src/components/icon';
import { alert } from '../src/components/overlay';

/** The computer picker behind the name in the top-left of the home screens.
 *  Picking one closes the sheet straight away — the switch itself plays out on
 *  the screen underneath, which keeps its list up until the new one lands.
 *
 *  Drawn out of the design system's parts (`components/divan`): the drawer's
 *  head from Web15 W12, and W18's rows in their card under it. The dot is the
 *  only colour on it, and it is on one row at most. */
export default function HostSheet() {
  const router = useRouter();
  const T = useT();
  return (
    <Sheet title={T('computersTitle')} note={T('hostHint')} onClose={() => router.back()}>
      <Body />
    </Sheet>
  );
}

function Body() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const t = useTokens();
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
    <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, gap: 10 }}>
      <Group>
        {hosts.map((h, i) => {
          const active = h.id === activeHostId;
          // Only the live computer can claim a state; the rest are just names.
          const live = active && !switching && conn === 'online';
          const state = !active || switching ? 'quiet' : conn === 'online' ? 'running'
            : conn === 'connecting' ? 'asking' : 'quiet';
          // What is happening to this row, in a word rather than in a spinner:
          // the only animation Divan repeats is the running dot (Web15 W18).
          const meta = busy === h.id ? T('hostRemoving')
            : active && (switching || conn === 'connecting') ? T('connecting')
            : live ? T('online') : active ? T('offline') : null;
          return (
            <ListRow key={h.id} first={i === 0} boxed chevron={!active} onPress={() => pick(h.id)}
              onLongPress={() => confirmRemove(h.id, h.name)}
              lead={<StatusDot state={state} hollow={!active} />}
              title={(active && hostInfo?.name?.replace('.local', '')) || h.name}
              note={`${h.host}:${h.port}`} noteMono
              meta={meta} tone={live ? 'run' : meta === T('connecting') ? 'amber' : 'ink3'}
              right={active && !switching ? <Icon name="check" size={18} color={t.ink} /> : undefined} />
          );
        })}
      </Group>
      <View>
        <ListRow first icon="visibility" title={T('viewScreen')}
          onPress={() => close(() => router.push('/screen'))} />
        <ListRow icon="add" title={T('addComputer')}
          onPress={() => close(() => router.push({ pathname: '/pair', params: { add: '1' } }))} />
      </View>
    </View>
  );
}
