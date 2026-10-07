/** The inbox: what the queue sent, newest first. A press opens the ticket. */
import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useColors } from '../src/theme';
import { BackBar, EmptyState, Text } from '../src/components/ui';
import { ListRow } from '../src/components/divan';
import { KIND_KEY, POLL_MS, useInbox } from '../src/inbox';
import { since } from '../src/tickets';

export default function InboxScreen() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const c = useColors();
  const items = useInbox((s) => s.items);
  const poll = useInbox((s) => s.poll);
  const markSeen = useInbox((s) => s.markSeen);

  useEffect(() => {
    void poll().then(markSeen);
    const t = setInterval(() => { void poll().then(markSeen); }, POLL_MS);
    return () => clearInterval(t);
  }, [poll, markSeen]);

  const now = Date.now() / 1000;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <BackBar onPress={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 8 }}>
        <Text style={{ fontSize: 30, fontWeight: '600', marginBottom: 8 }}>{T('inboxTitle')}</Text>
        {!items.length && <EmptyState title={T('inboxEmpty')} />}
        {items.map((n, i) => (
          <ListRow key={n.id} boxed first={i === 0}
            icon={n.kind === 'done' ? 'check_circle' : n.kind === 'failed' ? 'error' : n.kind === 'blocked' ? 'chat_bubble' : 'info'}
            tone={n.kind === 'done' ? undefined : n.kind === 'failed' ? 'red' : 'amber'}
            title={n.title || n.headline}
            note={[n.ticket ? `#${n.ticket} · ${T((KIND_KEY[n.kind] ?? 'kindDone') as any)}` : T((KIND_KEY[n.kind] ?? 'kindDone') as any),
                   n.project, T('inboxAgo', { d: since(now - n.ts, (k) => T(k)) })].filter(Boolean).join(' · ')}
            noteLines={1}
            onPress={n.ticket != null ? () => go(() => router.push(`/ticket/${n.ticket}`)) : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}
