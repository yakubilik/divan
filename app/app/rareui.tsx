import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useStore, useT } from '../src/store';
import { httpBase } from '../src/ws';
import { useColors } from '../src/theme';
import { Icon, Text } from '../src/components/ui';

/** Every Rare UI component, running: the computer's panel serves them at
 *  `/rareui.html` straight from the Rare UI repository's files (web/src/rareui),
 *  and this screen shows that page. Rare UI (rareui.com) by Swami Malode, MIT +
 *  Commons Clause + Attribution; the credit stands at the foot of the page. */
export default function RareUi() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const T = useT();
  const host = useStore((s) => s.host);
  const uri = host ? `${httpBase(host.host, host.port)}/rareui.html` : null;
  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Icon name="chevron_left" size={26} color="#FFFFFF" /></Pressable>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#FFFFFF' }}>{T('rareUi')}</Text>
      </View>
      {uri ? (
        <WebView source={{ uri }} style={{ flex: 1, backgroundColor: '#000' }} allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false} originWhitelist={['*']} />
      ) : (
        <Text style={{ color: c.muted, padding: 20 }}>{T('noConnection')}</Text>
      )}
    </View>
  );
}
