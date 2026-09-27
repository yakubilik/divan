import React, { useEffect, useRef } from 'react';
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
import { getOpenChat, registerForPush } from '../src/push';

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
  const [fontsLoaded, fontError] = useFonts(FONTS);

  useEffect(() => {
    void init();
    void registerForPush().then((t) => t && setPushToken(t));
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
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const cid = (r.notification.request.content.data as any)?.chat_id;
      if (!cid) return;
      // The tap only brought the app forward — we are already reading this chat.
      if (getOpenChat() === cid) return;
      // A notification is a jump somewhere else, not a step deeper into wherever
      // the user happened to be. Pushing left the previous chat underneath, so
      // Back walked into *that* chat instead of leaving. Land on the tapped chat
      // with the list behind it.
      try { if (router.canDismiss()) router.dismissTo('/chats'); } catch {}
      router.push(`/chat/${cid}`);
    });
    return () => { sub.remove(); tap.remove(); };
  }, [init, setPushToken, lock, router]);

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
        <Stack.Screen name="settings" />
        <Stack.Screen name="agents" />
        <Stack.Screen name="agent-store" />
        <Stack.Screen name="agent-install" />
        <Stack.Screen name="accounts" />
        <Stack.Screen name="pool" />
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
