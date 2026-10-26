import React, { useEffect, useMemo } from 'react';
import { LogBox, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../src/theme';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { UserBubble } from '../src/components/chat';
import { GalleryProvider } from '../src/components/media';
import type { Attachment } from '../src/store';

/** Four chat bubbles over fixture media — a phone video, a landscape video, a
 *  portrait photo and a landscape photo — drawn by the chat's own bubble and
 *  opened in the chat's own viewer, without a computer to send them.
 *
 *  The files are not in the bundle: they are copied into the app's documents
 *  folder on a simulator (`xcrun simctl get_app_container … data`, then
 *  `Documents/fixtures/`), so a release build carries none of them. Reached
 *  with `divan://media-fixtures`, or `divan://media-fixtures?only=portrait.mp4`
 *  for one bubble alone.
 *
 *  Development only, like `divan-gallery`: the route turns away in a release
 *  build. Its few words are fixture names, not anything a user reads. */
/** The documents folder, or nothing where there is none (a headless render). */
function docsUri(): string {
  try { return Paths.document.uri; } catch { return ''; }
}

export default function MediaFixtures() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const { only } = useLocalSearchParams<{ only?: string }>();
  const dir = `${docsUri().replace(/\/?$/, '/')}fixtures/`;
  const items = useMemo<Attachment[]>(() => [
    { path: '/fixtures/portrait.mp4', name: 'portrait.mp4', kind: 'video', duration: 4, localUri: dir + 'portrait.mp4' },
    { path: '/fixtures/landscape.mp4', name: 'landscape.mp4', kind: 'video', duration: 4, localUri: dir + 'landscape.mp4' },
    { path: '/fixtures/portrait.jpg', name: 'portrait.jpg', kind: 'image', localUri: dir + 'portrait.jpg' },
    { path: '/fixtures/landscape.jpg', name: 'landscape.jpg', kind: 'image', localUri: dir + 'landscape.jpg' },
  ], [dir]);

  // The development warnings toast would sit over the bubbles being looked at.
  useEffect(() => { LogBox.ignoreAllLogs(true); return () => LogBox.ignoreAllLogs(false); }, []);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <GalleryProvider items={items}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Icon name="chevron_left" size={26} color={c.ink} /></Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>media fixtures</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: insets.bottom + 20 }}>
          {items.filter((a) => !only || a.name === only).map((a) => <UserBubble key={a.path} text="" attachments={[a]} />)}
        </ScrollView>
      </View>
    </GalleryProvider>
  );
}
