import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../store';
import { useNavGuard } from '../nav';
import { useColors } from '../theme';
import { Dot, Icon, Text } from './ui';

/** The top of both home screens: which computer this is and how it is doing,
 *  and the screen's own actions on the right. Starting a chat is not one of
 *  them — that button belongs beside the Chats title, where the list is. */
export function HomeTop({ tab }: { tab: 'chats' | 'agents' }) {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const c = useColors();
  const conn = useStore((s) => s.conn);
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const switching = useStore((s) => s.switching);
  const online = conn === 'online';
  const name = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');
  const status = switching || conn === 'connecting' ? T('connecting')
    : online ? T('active', { n: hostInfo?.active_sessions ?? 0 })
    : conn === 'unauthorized' ? T('unauthorized') : T('offline');
  const dot = online && !switching ? c.ok : switching || conn === 'connecting' ? c.warn : c.lineStrong;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, paddingRight: 14, paddingBottom: 10, paddingLeft: 16 }}>
      <Pressable onPress={() => go(() => router.push('/host-sheet'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 999,
                 paddingVertical: 6, paddingLeft: 10, paddingRight: 12, boxShadow: c.shadow.pill, flexShrink: 1 }}>
        <Dot color={dot} />
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', flexShrink: 1 }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted }}>{status}</Text>
        <Icon name="expand_more" size={18} color={c.faint} />
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 4, marginLeft: 8 }}>
        {tab === 'chats' && <Btn icon="call" label={T('call')} onPress={() => go(() => router.push('/call'))} />}
        <Btn icon="settings" label={T('settings')} onPress={() => go(() => router.push('/settings'))} />
      </View>
    </View>
  );
}

function Btn({ icon, onPress, onLongPress, label }: { icon: string; onPress?: () => void; onLongPress?: () => void; label?: string }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress} hitSlop={4}
      style={({ pressed }) => [{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
      <Icon name={icon} size={22} />
    </Pressable>
  );
}
