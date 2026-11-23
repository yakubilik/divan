import React, { useEffect, useMemo, useRef } from 'react';
import { LogBox, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../src/theme';
import { useT } from '../src/store';
import { Icon, Text, TextInput } from '../src/components/ui';
import { AssistantText, TurnFooter, UserBubble, WorkingRow } from '../src/components/chat';
import { VoiceBubble } from '../src/components/media';
import { ModelPill } from '../src/components/model-pill';
import { toast } from '../src/components/toast';
import RareOrb from '../src/dom/rare-orb';
import type { Attachment } from '../src/store';

/** The chat's parts that the Rare UI pass touched, standing still for a
 *  screenshot without a computer behind them: a finished turn and a running
 *  one, a streaming answer, voice notes, the composer's model pill and a
 *  copied code block. `?part=status|stream|voice|model|copy` picks one.
 *
 *  The voice note reads `Documents/fixtures/voice.m4a` from the app's
 *  container on a simulator, like `media-fixtures`.
 *
 *  Development only: the route turns away in a release build. Its words are
 *  sample chat, not anything a user reads. */
function docsUri(): string {
  try { return Paths.document.uri; } catch { return ''; }
}

const ANSWER = 'Done. The status line now says what the turn is doing, and the footer says how long it took.';
const STREAM = 'Springs feel natural because they **carry velocity**. Interrupt one mid-flight and it picks up where it was.\n\n1. Use no bounce for menus\n2. A little bounce for playful';
const CODE = 'Here is the command:\n\n```sh\nnpm run test -- --watch\n```';

export default function RareuiFixtures() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const T = useT();
  const { part = 'status' } = useLocalSearchParams<{ part?: string }>();
  const since = useRef(Date.now() - 5_000).current;
  const voice = useMemo<Attachment>(() => ({
    path: '/fixtures/voice.m4a', name: 'voice.m4a', kind: 'audio', duration: 8,
    localUri: `${docsUri().replace(/\/?$/, '/')}fixtures/voice.m4a`,
    transcript: 'Bunlardan hangilerini Divan\'a ekleyebiliriz?',
  }), []);

  useEffect(() => { LogBox.ignoreAllLogs(true); return () => LogBox.ignoreAllLogs(false); }, []);
  // What a tap on the code block's copy button now says.
  useEffect(() => { if (part !== 'copy') return; toast(T('copied')); const t = setInterval(() => toast(T('copied')), 2500); return () => clearInterval(t); }, [part, T]);
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Icon name="chevron_left" size={26} color={c.ink} /></Pressable>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>Divan</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 20 }}>
        {part === 'status' && (
          <>
            <UserBubble text="Add the status line from Rare UI" />
            <AssistantText text={ANSWER} />
            <TurnFooter duration={9_000} cost={0.012} />
            <UserBubble text="Now the voice notes" />
            <WorkingRow phase={T('wsWorking')} since={since} tokens={1200} tools={2} />
          </>
        )}
        {part === 'stream' && (
          <>
            <UserBubble text="Why do springs feel better than easing curves?" />
            <View style={{ gap: 10 }}>
              <WorkingRow phase={T('wsWriting')} since={since} tokens={340} writing />
              <AssistantText text={STREAM} streaming />
            </View>
          </>
        )}
        {part === 'voice' && (
          <>
            <VoiceBubble item={voice} />
            <VoiceBubble item={{ ...voice, path: '/fixtures/voice2.m4a', name: 'cevap.m4a', transcript: undefined }} sent autoPlay />
          </>
        )}
        {part === 'orb' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 28, paddingTop: 20 }}>
            {(['idle', 'listening', 'thinking', 'speaking'] as const).map((m) => (
              <View key={m} style={{ alignItems: 'center', gap: 10 }}>
                <View style={{ width: 160, height: 160 }}>
                  <RareOrb state={m === 'speaking' ? 'listening' : m} color={m === 'speaking' ? c.ok : m === 'thinking' ? c.warn : c.accent} size={150}
                    dom={{ style: { flex: 1, backgroundColor: 'transparent' }, scrollEnabled: false }} />
                </View>
                <Text style={{ fontSize: 14, color: c.muted }}>{m}</Text>
              </View>
            ))}
          </View>
        )}
        {part === 'copy' && (
          <>
            <UserBubble text="How do I run the tests?" />
            <AssistantText text={CODE} />
          </>
        )}
      </ScrollView>
      {part === 'model' && (
        <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8 }}>
          <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 26, padding: 8, gap: 6, boxShadow: c.shadow.card }}>
            <TextInput placeholder={T('message')} style={{ fontSize: 15, paddingVertical: 4, paddingHorizontal: 8, minHeight: 26 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="add" size={20} weight={400} />
              </View>
              <ModelPill label="Opus · high" onOpenSheet={() => {}} defaultOpen current="opus" onPick={() => {}}
                models={[{ id: 'opus', label: 'Opus', hint: 'Most capable' }, { id: 'sonnet', label: 'Sonnet', hint: 'Fast and capable' }, { id: 'haiku', label: 'Haiku', hint: 'Fastest' }]} />
              <View style={{ flex: 1 }} />
              <Icon name="mic" size={22} color={c.muted} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
