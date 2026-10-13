import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { client } from '../src/ws';
import { Button, EmptyState, ListRow, Segments, StatusDot } from '../src/components/divan';
import { MachineTabs, PageHead, UnderTab } from '../src/components/machine';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';
import { KEY_BAR, TermBridge, type TermClient } from '../src/term';
import { TERM_THEME, termPage, toPageScript } from '../src/term-page';
import type { Key } from '../src/i18n';

/** Machine › Terminal: a real shell on the computer in front (`term.*`), drawn
 *  by xterm.js in a WebView, with the keys the iOS keyboard lacks on a bar over
 *  it. The wiring is `src/term.ts`; this is the drawing of it.
 *
 *  Chats is the other half (HANDOVER §4.9): every chat on this computer at once,
 *  each with what it is doing and the last thing it said, and the ticket queue
 *  under it. `?view=chats` opens on it. */
export default function Terminal() {
  const T = useT();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<'shell' | 'chats'>(params.view === 'chats' ? 'chats' : 'shell');
  const host = useStore((s) => s.host);

  return (
    <Shell place="machine">
      <View style={{ paddingTop: 8, paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
        <MachineTabs here="terminal" />
        <Segments value={view} onChange={(k) => setView(k === 'chats' ? 'chats' : 'shell')}
          segments={[{ key: 'shell', label: T('tmShell') }, { key: 'chats', label: T('tmChats') }]} />
      </View>
      {/* Kept mounted behind Chats, so switching over and back finds the same
          shell; it is let go of when the screen itself is left. */}
      <View style={{ flex: 1, minHeight: 0, display: view === 'shell' ? 'flex' : 'none' }}>
        {host ? <ShellPane key={host.id} name={host.name} visible={view === 'shell'} />
          : <EmptyState title={T('tmNoComputer')} />}
      </View>
      {view === 'chats' && <ChatWall />}
    </Shell>
  );
}

/** One shell on the connected computer, open for as long as this is mounted. */
export function ShellPane({ name, visible, via = client }: {
  name: string; visible: boolean; via?: TermClient;
}) {
  const T = useT();
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const web = useRef<WebView>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const html = useMemo(() => termPage(), []);
  const [kb, setKb] = useState(0);

  // One bridge per mount, and leaving the screen lets go of its shell. Made in
  // an effect rather than during render so that a mount React tries twice
  // closes the first and draws a fresh page for the second (the WebView is
  // keyed by it).
  const [bridge, setBridge] = useState<TermBridge | null>(null);
  useEffect(() => {
    const b = new TermBridge(via, (m) => web.current?.injectJavaScript(toPageScript(m)), redraw);
    setBridge(b);
    return () => b.close();
  }, [via]);

  // The bar sits on the keyboard: the pane shrinks by the keyboard's height,
  // the page refits, and the shell is told its new size.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow',
      (e: any) => setKb(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // The page's own resize event follows its box, but a turned phone or a
  // keyboard is asked about explicitly as well once the layout has settled.
  useEffect(() => {
    const id = setTimeout(() => bridge?.fit(), 60);
    return () => clearTimeout(id);
  }, [bridge, kb, width, height, visible]);

  // The app is held upright everywhere but here and the remote screen: a shell
  // is wider on its side.
  useEffect(() => {
    if (!visible) return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
  }, [visible]);

  if (!bridge) return <View style={{ flex: 1, backgroundColor: TERM_THEME.background }} />;
  const st = bridge.state;
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: TERM_THEME.background,
                   paddingBottom: kb > 0 ? kb : insets.bottom }}>
      <View style={{ flex: 1, minHeight: 0 }} onLayout={() => bridge.fit()}>
        <WebView
          key={bridge.serial}
          ref={web}
          accessibilityLabel="Shell"
          originWhitelist={['*']}
          source={{ html }}
          onMessage={(e) => bridge.fromPage(e.nativeEvent.data)}
          // iOS may throw the page away in the background; it says `ready`
          // again and is given back what it had.
          onContentProcessDidTerminate={() => web.current?.reload()}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          scrollEnabled={false}
          bounces={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: TERM_THEME.background }}
        />
        {st !== 'live' && st !== 'closed' && (
          <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 12,
                         backgroundColor: t.s1, gap: 8 }}>
            <Text accessibilityLabel="Shell state" style={{ fontSize: 13.5, color: t.ink2 }}>
              {st === 'ended' ? T('tmEnded') : st === 'failed' ? `${T('tmFailed')} ${bridge.error ?? ''}`.trim()
                : T('tmOpening', { name })}
            </Text>
            {(st === 'ended' || st === 'failed') && (
              <Button label={T(st === 'ended' ? 'tmNewShell' : 'tmRetry')} onPress={() => bridge.restart()} />
            )}
          </View>
        )}
      </View>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 8, paddingVertical: 6 }}>
        {KEY_BAR.map((k) => {
          const on = k.key === 'ctrl' && bridge.ctrl;
          return (
            <Pressable key={k.key} accessibilityRole="button" accessibilityLabel={k.name}
              accessibilityState={k.key === 'ctrl' ? { selected: on } : undefined}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); bridge.key(k.key); }}
              style={({ pressed }) => ({ minWidth: 40, height: 34, paddingHorizontal: 10, borderRadius: 8,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? TERM_THEME.cursor : pressed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)' })}>
              <Text mono style={{ fontSize: 14, color: on ? TERM_THEME.background : TERM_THEME.foreground }}>{k.label}</Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" accessibilityLabel={T('tmHideKeyboard')}
          onPress={() => { bridge.blur(); Keyboard.dismiss(); }}
          style={{ minWidth: 40, height: 34, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center',
                   justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' }}>
          <Text style={{ fontSize: 14, color: TERM_THEME.foreground }}>⌨︎↓</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** Every chat on this computer, a row each; a row opens the conversation. */
function ChatWall() {
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
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
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
  );
}
