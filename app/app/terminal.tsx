import React, { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { EmptyState, ListRow, StatusDot } from '../src/components/divan';
import { MachineTabs, PageHead, UnderTab } from '../src/components/machine';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';
import type { Key } from '../src/i18n';

/** Machine › Terminal (HANDOVER §4.9): every chat on this computer at once, each
 *  with what it is doing and the last thing it said, and the ticket queue under
 *  it. A row opens the conversation, where a command is typed and its answer
 *  read — the desktop's wall of terminals, as a row list on the phone. */
export default function Terminal() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const chats = useStore((s) => s.chats) ?? {};
  const conn = useStore((s) => s.conn);
  const refresh = useStore((s) => s.refresh);
  useEffect(() => { if (conn === 'online') void refresh?.().catch(() => {}); }, [conn, refresh]);

  const list = Object.values(chats).filter((c) => !c.archived).sort((a, b) => b.updated_at - a.updated_at);
  const word = (status: string): Key => (status === 'running' ? 'tmWorking'
    : status === 'awaiting_approval' ? 'tmAsking' : 'tmIdle');

  return (
    <Shell place="machine">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
        <MachineTabs here="terminal" />
        <PageHead title={T('mTerminal')} count={list.length || null} style={{ marginTop: 6 }} />
        <Text style={{ fontSize: 13.5, color: t.ink2, paddingHorizontal: 4 }}>{T('tmNote')}</Text>
        {list.length === 0 ? <EmptyState title={T('tmNone')} /> : (
          <View>
            {list.map((c, i) => (
              <ListRow key={c.id} first={i === 0}
                lead={<StatusDot state={c.status === 'running' ? 'running' : c.status === 'awaiting_approval' ? 'asking' : 'quiet'}
                  hollow={c.status === 'idle'} />}
                title={c.title || T('chats')} note={c.last_preview || undefined}
                meta={T(word(c.status))} monoMeta={false}
                tone={c.status === 'awaiting_approval' ? 'amber' : c.status === 'running' ? 'run' : 'ink3'}
                onPress={() => go(() => router.push(`/chat/${c.id}`))} />
            ))}
          </View>
        )}
        <UnderTab here="terminal" style={{ marginTop: 8 }} />
      </ScrollView>
    </Shell>
  );
}
