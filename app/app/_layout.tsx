import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { useStore, useT } from '../src/store';
import { client } from '../src/ws';
import { em, FONTS, useColors } from '../src/theme';
import { Button, Icon, Text } from '../src/components/ui';
import { DialogHost, MenuHost } from '../src/components/overlay';
import { getOpenChat, protectChat, registerForPush } from '../src/push';
import { ticketFromPush } from '../src/tickets';
import * as ScreenOrientation from 'expo-screen-orientation';
import { prepareForCalls, startIncomingCalls } from '../src/incoming-call';

/** Presented over the page by the app's own sheet (see components/sheet). */
const SHEET = { presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } } as const;

export default function RootLayout() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const unlock = useStore((s) => s.unlock);
  const lock = useStore((s) => s.lock);
  const setPushToken = useStore((s) => s.setPushToken);
  const router = useRouter();
  const bg = useRef<number | null>(null);
  const c = useColors();

  /* A notification tap, and the two things that used to go wrong with it.
   *
   * It says which computer it came from now, and the phone may be connected to
   * another one — a chat id means nothing to a computer that does not have that
   * chat, and what opened was a screen that could never fill. And a tap that
   * launches the app arrives before the hosts are out of the keychain and
   * before Face ID has been answered, so it is held here until the app can act
   * on it rather than spent on a store that is still empty. Both are the same
   * symptom from the outside: an empty chat. */
  const pendingTap = useRef<{ chat?: string; ticket?: number; device?: string } | null>(null);
  const lastTap = useRef<{ key: string; at: number } | null>(null);

  const deliverTap = useCallback(async () => {
    const tap = pendingTap.current;
    if (!tap) return;
    const st = useStore.getState();
    // Not yet: the effect below tries again the moment either of these turns.
    if (!st.ready || st.locked) return;
    pendingTap.current = null;
    // The launch response and the listener can both report the same tap.
    const key = tap.ticket != null ? `ticket:${tap.ticket}` : `chat:${tap.chat}`;
    if (lastTap.current && lastTap.current.key === key
        && Date.now() - lastTap.current.at < 3000) return;
    lastTap.current = { key, at: Date.now() };

    if (tap.device && tap.device !== st.activeHostId
        && st.hosts.some((h) => h.id === tap.device)) {
      try { await st.switchHost(tap.device); } catch {}
    }
    // A ticket that went red is announced by its number, and the whole reason
    // the notification exists is that nobody would otherwise be looking. Land
    // on the ticket itself, with the wall under it so Back leads to the rest of
    // the queue rather than out of it.
    if (tap.ticket != null) {
      try { if (router.canDismiss()) router.dismissTo('/chats'); } catch {}
      router.push('/ustabasi');
      router.push(`/ticket/${tap.ticket}`);
      return;
    }
    if (!tap.chat) return;
    // The tap only brought the app forward — we are already reading this chat.
    if (getOpenChat() === tap.chat) return;
    // A notification is a jump somewhere else, not a step deeper into wherever
    // the user happened to be. Pushing left the previous chat underneath, so
    // Back walked into *that* chat instead of leaving. Land on the tapped chat
    // with the list behind it. The pop unmounts the chat screens above the
    // list, and an unused one deletes itself on the way out — including,
    // once, the very chat being opened. Name it first so it is spared.
    protectChat(tap.chat);
    try { if (router.canDismiss()) router.dismissTo('/chats'); } catch {}
    router.push(`/chat/${tap.chat}`);
  }, [router]);

  useEffect(() => { void deliverTap(); }, [ready, locked, deliverTap]);
  const [fontsLoaded, fontError] = useFonts(FONTS);

  useEffect(() => {
    // The binary allows landscape so that the screen viewer can ask for it.
    // Everything else is the portrait app it was drawn as, and says so once.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    void init();
    void registerForPush().then((t) => t && setPushToken(t));
    // Nothing registers for VoIP pushes until something loads the module, so
    // this belongs at the root: a phone nobody imported cannot be rung.
    startIncomingCalls();
    void prepareForCalls();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        client.poke();
        // re-lock after 60s in background
        if (bg.current && Date.now() - bg.current > 60_000) lock();
        bg.current = null;
      } else if (st === 'background') {
        bg.current = Date.now();
      }
    });
    const queue = (r: Notifications.NotificationResponse | null) => {
      const data = (r?.notification.request.content.data ?? {}) as any;
      const ticket = ticketFromPush(data);
      if (!data.chat_id && ticket == null) return;
      pendingTap.current = {
        chat: data.chat_id ? String(data.chat_id) : undefined,
        ticket: ticket ?? undefined,
        device: data.device_id ? String(data.device_id) : undefined,
      };
      void deliverTap();
    };
    // A tap that launched the app is delivered before any listener can be
    // attached, so it has to be asked for as well; the listener catches every
    // tap after that, and the pair of them cannot double-open a chat.
    void Notifications.getLastNotificationResponseAsync().then(queue).catch(() => {});
    const tap = Notifications.addNotificationResponseReceivedListener(queue);
    return () => { sub.remove(); tap.remove(); };
  }, [init, setPushToken, lock, router, deliverTap]);

  useEffect(() => { if (ready && locked) void unlock(); }, [ready, locked, unlock]);

  // Without the fonts the system face stands in; a blank app would not.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <SafeAreaProvider>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'default' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="pair" />
        <Stack.Screen name="chats" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="new-chat" options={SHEET} />
        <Stack.Screen name="chat-settings" options={SHEET} />
        <Stack.Screen name="model-sheet" options={SHEET} />
        <Stack.Screen name="host-sheet" options={SHEET} />
        {/* A call is a mode, not a place: it comes up over whatever you were
            reading and leaves it exactly where it was. */}
        <Stack.Screen name="call" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" />
        {/* The computer's own screen. Full bleed and no animation: it is a
            window onto something already happening, not a page. */}
        <Stack.Screen name="screen" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="agents" />
        <Stack.Screen name="agent-store" />
        <Stack.Screen name="agent-install" />
        <Stack.Screen name="accounts" />
        <Stack.Screen name="pool" />
        {/* The ticket queue on the computer, and one of its tickets. A push
            about a red ticket lands on the second one directly. */}
        <Stack.Screen name="ustabasi" />
        <Stack.Screen name="ticket/[id]" />
        <Stack.Screen name="login-method" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="account-login" />
        <Stack.Screen name="login-web" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="move-signin" />
      </Stack>
      {ready && locked && <LockScreen onUnlock={() => void unlock()} />}
      <MenuHost />
      <DialogHost />
    </SafeAreaProvider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const c = useColors();
  const T = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 40 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={38} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '600', letterSpacing: em(22, -0.01) }}>{T('locked')}</Text>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 22 }}>
        <Button title={T('unlockBtn')} onPress={onUnlock} />
      </View>
    </View>
  );
}
