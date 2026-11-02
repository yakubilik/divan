import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useStore } from '../src/store';
import { HOME } from '../src/shell';
import { useColors } from '../src/theme';
import { openFresh } from '../src/fresh-chat';
import { launchDefaults, launchHandled, launchSkipped } from '../src/launch';
import { getOpenChat, protectChat } from '../src/push';

/** How long a cold start waits for the computer before it gives up on the
 *  empty chat and shows the Dashboard instead. */
const LAUNCH_WAIT_MS = 9000;

export default function Index() {
  const ready = useStore((s) => s.ready);
  const host = useStore((s) => s.host);
  const c = useColors();
  // Decided once, on the first render with a paired computer, and kept: a
  // second visit to `/` in the same process is not a launch.
  const [launching] = useState(() => !!host && !launchHandled());
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!host) return <Redirect href="/welcome" />;
  if (launching) return <Launch />;
  // Divan opens on the Dashboard: every project on every machine, rather than
  // one computer's chats.
  return <Redirect href={HOME} />;
}

/** A cold start: an empty chat with Hermes on the launch computer, opened over
 *  the Dashboard so Back lands there. A notification tap or a shared link that
 *  arrives meanwhile wins, and so does a computer that does not answer. */
function Launch() {
  const router = useRouter();
  const c = useColors();
  const conn = useStore((s) => s.conn);
  const hostInfo = useStore((s) => s.hostInfo);
  const catalog = useStore((s) => s.catalog);
  const accountsLoaded = useStore((s) => s.accountsLoaded);
  const loadAccounts = useStore((s) => s.loadAccounts);
  const started = useRef(false);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), LAUNCH_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (conn === 'online' && !accountsLoaded) void loadAccounts().catch(() => {});
  }, [conn, accountsLoaded, loadAccounts]);

  useEffect(() => {
    if (started.current) return;
    const home = () => { started.current = true; router.replace(HOME); };
    if (launchSkipped() || gaveUp) { home(); return; }
    if (conn !== 'online' || !hostInfo || !catalog || !accountsLoaded) return;
    started.current = true;
    const st = useStore.getState();
    openFresh({
      defaults: launchDefaults(st.defaults), hostInfo: st.hostInfo, accounts: st.accounts, catalog: st.catalog,
      listAgents: st.listAgents, createChat: (d) => st.createChat(d as any),
    }).then((chat) => {
      router.replace(HOME);
      // A tap that opened its own chat while this one was being made keeps
      // the screen; the empty chat deletes itself like any unused one.
      if (!chat || launchSkipped() || getOpenChat()) return;
      protectChat(chat.id);
      setTimeout(() => router.push(`/chat/${chat.id}`), 0);
    }).catch(() => router.replace(HOME));
  }, [conn, hostInfo, catalog, accountsLoaded, gaveUp, router]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}
