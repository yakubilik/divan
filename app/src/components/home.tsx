import React, { useCallback } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useStore, useT } from '../store';
import { useNavGuard } from '../nav';
import { BADGE_POLL_MS, redCount } from '../tickets';
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
  const queue = useStore((s) => s.ustabasi);
  const online = conn === 'online';
  // The ticket queue is only somewhere the phone can go if the computer runs
  // one, which most do not. When it does, the count of tickets that stopped to
  // ask is on the badge: a queue that has gone red is the one thing on this
  // computer nobody would otherwise find out about until they looked.
  const red = queue?.available ? redCount(queue.tickets) : 0;

  // Nothing else keeps this number honest. The queue is asked once on connect
  // and then only by the wall, which is not open — so a ticket that went red an
  // hour ago would sit behind an unbadged button until something reconnected.
  // Asked again on the way back to the foreground, and slowly while a home
  // screen is up: one local read a minute, against a ticket nobody would
  // otherwise find out about for hours.
  const loadUstabasi = useStore((s) => s.loadUstabasi);
  // …and not at all on a computer that has already said it does not know the
  // request: that answer cannot change without a restart, and a minute is a
  // long time to keep asking a question already answered.
  const oldHost = useStore((s) => s.ustabasiOld);
  useFocusEffect(useCallback(() => {
    if (conn !== 'online' || oldHost) return;
    void loadUstabasi();
    const timer = setInterval(() => void loadUstabasi(), BADGE_POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void loadUstabasi(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [conn, oldHost, loadUstabasi]));
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
        {tab === 'chats' && queue?.available && (
          <Btn icon="terminal" label={T('ustabasi')} badge={red} onPress={() => go(() => router.push('/ustabasi'))} />
        )}
        {tab === 'chats' && <Btn icon="call" label={T('call')} onPress={() => go(() => router.push('/call'))} />}
        <Btn icon="settings" label={T('settings')} onPress={() => go(() => router.push('/settings'))} />
      </View>
    </View>
  );
}

function Btn({ icon, onPress, onLongPress, label, badge }: { icon: string; onPress?: () => void; onLongPress?: () => void; label?: string; badge?: number }) {
  const c = useColors();
  return (
    <Pressable accessibilityLabel={badge ? `${label} (${badge})` : label} onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress} hitSlop={4}
      style={({ pressed }) => [{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
      <Icon name={icon} size={22} />
      {!!badge && (
        <View style={{ position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
                       backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 10, fontWeight: '600', color: '#FFFFFF' }}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}
