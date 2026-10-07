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
import { follow, Taps } from '../src/tap';
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

  /* A notification tap. What it opens, what it does with one reported twice,
   * and what it does with one that arrived before the app could act on it are
   * all in src/tap.ts, where they can be driven by a test — this is the part
   * that needs a router and a store: the computer the tap was sent to, and the
   * chat that must not be swept away by the pop on the way to it. */
  const taps = useRef(new Taps());

  const deliverTap = useCallback(async () => {
    const st = useStore.getState();
    // Not yet: `take` keeps it, and the effect below asks again the moment
    // either of these turns.
    const tap = taps.current.take(st);
    if (!tap) return;

    // A notification says which computer it came from, and the phone may be
    // connected to another one — a chat id means nothing to a computer that
    // does not have that chat, and what opened was a screen that could never
    // fill.
    if (tap.device && tap.device !== st.activeHostId
        && st.hosts.some((h) => h.id === tap.device)) {
      try { await st.switchHost(tap.device); } catch {}
    }
    // The tap only brought the app forward — we are already reading this chat.
    if (tap.chat && getOpenChat() === tap.chat) return;
    // The pop unmounts the chat screens above the list, and an unused one
    // deletes itself on the way out — including, once, the very chat being
    // opened. Name it first so it is spared.
    if (tap.chat) protectChat(tap.chat);
    follow(tap, router);
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
      if (!taps.current.offer(r?.notification.request.content.data ?? {})) return;
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
        {/* Divan's three places. They replace each other at the root of the
            stack rather than stacking up, so Back leaves the app from any of
            them and everything else is pushed over whichever one is up. */}
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="chat/index" />
        <Stack.Screen name="machine" />
        <Stack.Screen name="chat/[id]" />
        {/* The Needs-you counter, opened up: everything waiting on a person
            across every project and every machine. Pushed over the Dashboard
            rather than being a fourth place — it is one of the Dashboard's own
            numbers with the things behind it shown. */}
        <Stack.Screen name="waiting" />
        {/* One branch of a product, opened: its status, its numbers, what its
            agent did and the cards that belong to it (Mobile9 S10, S11).
            Addressed by kind rather than by id — two computers give the same
            branch two ids, and the kind is what the merge folds them by. */}
        <Stack.Screen name="branch/[id]" />
        {/* One card of a board, opened: what it is, what the machine was told,
            and what the worker on it is doing right now. Pushed over the
            Dashboard the way the Waiting screen is — it is a card of one of its
            boards opened up, and Back leads to the board it came from. */}
        <Stack.Screen name="card/[id]" />
        {/* Writing one down (Mobile8 S9). A modal over the board rather than a
            page pushed onto it: it is a thing you do mid-thought, and Cancel
            has to leave the board exactly where it was. */}
        <Stack.Screen name="new-ticket" options={{ presentation: 'modal' }} />
        <Stack.Screen name="new-chat" options={SHEET} />
        <Stack.Screen name="chat-settings" options={SHEET} />
        <Stack.Screen name="model-sheet" options={SHEET} />
        <Stack.Screen name="host-sheet" options={SHEET} />
        {/* The two pages of the Machine drawer that are made of what the
            computers answered (Mobile11 S15, S14): the machines themselves,
            with the one that stopped answering said out loud, and everyone who
            can be handed a ticket. Pushed over the Machine tab, which stays
            lit under them. */}
        <Stack.Screen name="machines" />
        <Stack.Screen name="executors" />
        <Stack.Screen name="terminal" />
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
        {/* The ticket queue on the computer, and one of its tickets — twice.
            `ticket/[id]` is the chat: what the agent on it is printing, as it
            prints it, which is where a push about a red ticket lands.
            `ticket-about/[id]` is the reading of it: the steps, the criteria
            and the rest of the card. They replace each other rather than
            stacking, so Back leads to the wall from either. */}
        <Stack.Screen name="ustabasi" />
        <Stack.Screen name="ticket/[id]" />
        <Stack.Screen name="ticket-about/[id]" />
        <Stack.Screen name="login-method" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="account-login" />
        <Stack.Screen name="login-web" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="move-signin" />
        {/* The Divan design system, part by part. Nothing links here outside a
            development build, and the screen itself turns away in one. */}
        <Stack.Screen name="divan-gallery" />
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
