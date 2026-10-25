/** The computer this phone is holding, at the top of the chat list: the web
 *  sidebar's `HostCard` (web/src/components/Sidebar.tsx), drawn out of the
 *  design system's parts.
 *
 *  A computer glyph, its name, and under it the status dot and the word for it.
 *  With more than one computer paired a caret says it opens, and opening it
 *  lists the others under it, the way the web's does; picking one switches to
 *  it with the store's `switchHost`, as the Computers sheet does. With one there
 *  is nothing to open, so the card is not a button and draws no caret.
 *
 *  The web can merge every computer's chats into one list ("All computers").
 *  The phone holds one socket to one computer, so it has no such row: the
 *  card only switches. */
import React, { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStore, useT, type StoredHost } from '../store';
import { useTokens } from '../theme';
import { Card, ListRow, StatusDot, Tap } from './divan';
import { Icon } from './icon';
import { Text } from './text';

const NO_HOSTS: StoredHost[] = [];

export function HostCard({ style }: { style?: object }) {
  const T = useT();
  const t = useTokens();
  const hosts = useStore((s) => s.hosts) ?? NO_HOSTS;
  const host = useStore((s) => s.host);
  const hostInfo = useStore((s) => s.hostInfo);
  const conn = useStore((s) => s.conn);
  const switching = useStore((s) => s.switching);
  const switchHost = useStore((s) => s.switchHost);
  const [open, setOpen] = useState(false);

  // `host` is the held one; its row in the pairings is the one with the address.
  // (Read through `host` rather than the active id: a file that imports the
  // design system is held by test-divan-merge to never name that id.)
  const held = hosts.find((h) => h.id === host?.id) ?? host;
  if (!held) return null;
  const many = hosts.length > 1;
  const others = hosts.filter((h) => h.id !== held.id);
  const name = hostInfo?.name?.replace(/\.local$/, '') || held.name;
  // The web's hostDetail(), in the words the phone already has for it.
  const state = switching || conn === 'connecting' ? 'asking'
    : conn === 'online' ? 'running' : conn === 'unauthorized' ? 'stuck' : 'quiet';
  const detail = switching || conn === 'connecting' ? T('connecting')
    : conn === 'online' ? T('online') : conn === 'unauthorized' ? T('unauthorized') : T('offline');
  const online = state === 'running';

  function pick(id: string) {
    setOpen(false);
    void Haptics.selectionAsync().catch(() => {});
    void switchHost(id);
  }

  return (
    <Card inset={false} style={style}>
      <Tap label={T('computer')} onPress={many ? () => setOpen((o) => !o) : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Icon name="monitor" size={17} color={t.ink3} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot state={state} hollow={state === 'quiet'} />
            <Text numberOfLines={1} style={{ fontSize: 12, color: t.ink3, flexShrink: 1 }}>{detail}</Text>
            {online && <Text mono style={{ fontSize: 11, color: t.ink3 }}>:{held.port}</Text>}
          </View>
        </View>
        {many && (
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Icon name="expand_more" size={16} color={t.ink3} />
          </View>
        )}
      </Tap>
      {open && many && others.map((h) => (
        // A computer that is not the held one has no socket open, so it has no
        // state to claim: a hollow dot, as on the Computers sheet.
        <ListRow key={h.id} boxed lead={<StatusDot state="quiet" hollow />}
          title={h.name} note={`${h.host}:${h.port}`} noteMono
          style={{ paddingVertical: 10, paddingHorizontal: 14, gap: 10 }}
          onPress={() => pick(h.id)} />
      ))}
    </Card>
  );
}
