import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { BackBar, Button, Card, Eyebrow, Icon, Text, WaitBars } from '../src/components/ui';
import type { Key } from '../src/i18n';
import type { Provider } from '../src/protocol';

const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** Every method the computer offers has a name and a sentence here. An id the
 *  app has never heard of still shows, under its own id, rather than vanishing. */
const TITLE: Record<string, Key> = {
  subscription: 'mSubscription', console: 'mConsole', sso: 'mSso',
  api_key: 'mApiKey', device: 'mDevice', browser_here: 'mBrowserHere',
};
const BODY: Record<string, Key> = {
  subscription: 'mSubscriptionBody', console: 'mConsoleBody', sso: 'mSsoBody',
  api_key: 'mApiKeyBody', device: 'mDeviceBody', browser_here: 'mBrowserHereBody',
};

export default function LoginMethod() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { id, provider } = useLocalSearchParams<{ id: string; provider: Provider }>();
  const prov = (provider ?? 'claude') as Provider;
  const tools = useStore((s) => s.tools);
  const account = useStore((s) => s.accounts.find((a) => a.id === id));
  const methods = tools.find((t) => t.provider === prov)?.login_methods ?? [];
  const [picked, setPicked] = useState<string>(methods[0]?.id ?? '');
  // The list belongs to the computer, and this screen is reachable before the
  // computer has answered — a cold launch, or straight after adding an account.
  // Without asking for it here the card stays empty and Continue has nothing
  // to continue to.
  const conn = useStore((s) => s.conn);
  const loadTools = useStore((s) => s.loadTools);
  useEffect(() => {
    if (!methods.length && conn === 'online') void loadTools().catch(() => {});
  }, [methods.length, conn, loadTools]);
  // A list that arrives late still has to end up on its first entry: the choice
  // above was made when there was nothing yet to choose.
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === picked)) setPicked(methods[0].id);
  }, [methods, picked]);

  function go() {
    if (!picked) return;
    router.replace({ pathname: '/account-login', params: { id: id!, provider: prov, method: picked } });
  }

  const who = account ? (account.is_default ? T('ownShort') : account.label) : '';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <BackBar icon="close" onPress={() => router.back()} />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ paddingTop: 6, paddingHorizontal: 20, paddingBottom: 16, gap: 6 }}>
          <Eyebrow>{[NAMES[prov], who].filter(Boolean).join(' · ')}</Eyebrow>
          <Text style={{ fontSize: 28, fontWeight: '600', letterSpacing: em(28, -0.02) }}>{T('pickMethodTitle')}</Text>
        </View>
        <Card style={{ marginHorizontal: 16 }}>
          {methods.length ? methods.map((m, i) => {
            const on = picked === m.id;
            return (
              <Pressable key={m.id} onPress={() => setPicked(m.id)}
                style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
                  i < methods.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 15, fontWeight: on ? '600' : '500' }}>{TITLE[m.id] ? T(TITLE[m.id]) : m.id}</Text>
                  {BODY[m.id] ? <Text style={{ fontSize: 13, color: c.muted, lineHeight: 13 * 1.4 }}>{T(BODY[m.id])}</Text> : null}
                </View>
                {on && <Icon name="check" size={22} weight={500} />}
              </Pressable>
            );
          }) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
              <WaitBars />
              <Text style={{ fontSize: 14, color: c.muted }}>{T('wStarting')}</Text>
            </View>
          )}
        </Card>
        <Pressable onPress={() => router.replace({ pathname: '/move-signin', params: { provider: prov, id: id! } })}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 }, pressed && { opacity: 0.6 }]}>
          <Icon name="move_down" size={18} weight={400} color={c.text2} />
          <Text style={{ fontSize: 14, color: c.text2 }}>{T('moveFromAnother')}</Text>
        </Pressable>
        <View style={{ marginTop: 'auto', paddingHorizontal: 16, paddingBottom: insets.bottom + 6, paddingTop: 16 }}>
          <Button title={T('continueBtn')} onPress={go} disabled={!picked} />
        </View>
      </ScrollView>
    </View>
  );
}
