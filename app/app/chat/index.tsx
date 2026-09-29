import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { theChat } from '../../src/shell';
import { useTokens } from '../../src/theme';
import { Button, EmptyState } from '../../src/components/divan';
import { Shell } from '../../src/components/shell';
import { Conversation } from './[id]';

/** The second place: the conversation.
 *
 *  There is one of it (Mobile4 C1). No thread list in front of it, no project
 *  picker, no "new chat" and no computer picker over the top — the tab enters
 *  the conversation itself, which is the screen it has always been, drawn here
 *  with the tab bar under it and nothing else added.
 *
 *  Which conversation is `theChat`: the newest one that is not archived, held
 *  once entered so that a reply arriving somewhere else cannot swap it out from
 *  under a half-typed message. A phone that has none starts one rather than
 *  showing an empty list — a chat is what this place *is*, so there is nothing
 *  else for it to be. */
export default function ChatPlace() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [held, setHeld] = useState<string | null>(null);
  const id = useStore((s) => theChat(s.chats, held));
  const conn = useStore((s) => s.conn);
  const chatsLoaded = useStore((s) => s.chatsLoaded);
  const defaults = useStore((s) => s.defaults);
  const projects = useStore((s) => s.projects);
  const { createChat, loadProjects } = useStore(useShallow((s) => ({ createChat: s.createChat, loadProjects: s.loadProjects })));
  const [failed, setFailed] = useState(false);
  // One attempt per connection. Making a chat is a round trip, and a second one
  // started while the first is in flight is a second conversation nobody asked
  // for — which on this screen would also be the one it then settles on.
  const starting = useRef(false);

  useEffect(() => { if (id && id !== held) setHeld(id); }, [id, held]);

  useEffect(() => {
    if (id || conn !== 'online' || !chatsLoaded || starting.current || failed) return;
    starting.current = true;
    void (async () => {
      try {
        // The computer's folders decide where a chat runs, and nothing has
        // needed them yet on a phone that opens on the Dashboard.
        let cwd = defaults.cwd || projects[0]?.path;
        if (!cwd) {
          await loadProjects().catch(() => {});
          cwd = defaults.cwd || useStore.getState().projects[0]?.path;
        }
        if (!cwd) { setFailed(true); return; }
        const chat = await createChat({
          provider: defaults.provider, model: defaults.model, effort: defaults.effort,
          perm_mode: defaults.perm_mode, cwd,
          account_id: defaults.byProvider?.[defaults.provider]?.account_id ?? undefined,
        } as any);
        setHeld(chat.id);
      } catch {
        setFailed(true);
      } finally {
        starting.current = false;
      }
    })();
  }, [id, conn, chatsLoaded, failed, defaults, projects, createChat, loadProjects]);

  // Back online after a refusal: worth one more try.
  useEffect(() => { if (conn === 'online') setFailed(false); }, [conn]);

  let body: React.ReactNode;
  if (id) {
    // The chat draws its own bottom room for the home indicator, and the tab
    // bar now stands in that room. Told there is none, it puts its composer
    // exactly where it was — this is the whole of what the place does to it.
    body = (
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
        <Conversation id={id} />
      </SafeAreaInsetsContext.Provider>
    );
  } else if (conn === 'unauthorized') {
    body = (
      <EmptyState title={T('noAccess')} body={T('noAccessHint', { host: T('computer') })}
        actions={<Button label={T('pairAgain')} onPress={() => go(() => router.push({ pathname: '/pair', params: { add: '1' } }))} />} />
    );
  } else if (failed) {
    body = (
      <EmptyState title={T('couldNotStart')} body={T('chatPlacePick')}
        actions={<Button label={T('newChat')} onPress={() => go(() => router.push('/new-chat'))} />} />
    );
  } else if (conn === 'offline') {
    body = <EmptyState title={T('cantConnect', { host: T('computer') })} body={T('hintOffline')} />;
  } else {
    // Connecting, or the list has not landed. A conversation that is one
    // request away is not an empty screen worth explaining.
    body = <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  return <Shell place="chat" top={!id}>{body}</Shell>;
}
