import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { Button, Card, Eyebrow, Icon, Text } from '../src/components/ui';

const REPO = 'https://github.com/yakubilik/remote-ai-chat';
const TAILSCALE = 'https://tailscale.com/download';

const INSTALL = 'git clone ' + REPO + '.git\ncd remote-ai-chat/daemon && ./install.sh';

/** What the pairing screen used to assume you already knew: that the agent
 *  runs on a computer, that a daemon has to be installed there, and that
 *  reaching it from the bus needs a private network between the two. */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);

  const toPair = () => router.replace('/pair');

  /** A command you are meant to run somewhere else. Tapping it copies — the
   *  phone is not where it runs, so the only useful thing the box can do is
   *  hand it over. */
  function copy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void Clipboard.setStringAsync(INSTALL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const steps = [T('welNet1'), T('welNet2')];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', gap: 6, paddingTop: 12, paddingHorizontal: 20 }}>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: c.ink }} />
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: step === 1 ? c.ink : c.lineStrong }} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ paddingTop: 28, paddingHorizontal: 20, gap: 10 }}>
          <Eyebrow>{T(step === 0 ? 'welStep1' : 'welStep2')}</Eyebrow>
          <Text style={{ fontSize: 30, fontWeight: '600', letterSpacing: em(30, -0.025), lineHeight: 33 }}>
            {T(step === 0 ? 'welTitle1' : 'welTitle2')}
          </Text>
          <Text style={{ fontSize: 15, lineHeight: 22.5, color: c.text2 }}>{T(step === 0 ? 'welBody1' : 'welBody2')}</Text>
        </View>

        {step === 0 ? (
          <>
            <Pressable onPress={copy} style={{ marginTop: 20, marginHorizontal: 16 }}>
              <Card style={{ padding: 14, gap: 12, boxShadow: c.shadow.card }}>
                <Text mono style={{ fontSize: 13, lineHeight: 13 * 1.55 }}>{INSTALL}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name={copied ? 'check' : 'content_copy'} size={16} color={copied ? c.ok : c.muted} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: copied ? c.ok : c.muted }}>{copied ? T('welCopied') : T('welCopy')}</Text>
                </View>
              </Card>
            </Pressable>
            <View style={{ paddingTop: 14, paddingHorizontal: 20, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Icon name="info" size={16} color={c.faint} />
                <Text style={{ flex: 1, fontSize: 13, lineHeight: 19.5, color: c.muted }}>{T('welWindows')}</Text>
              </View>
              <Pressable onPress={() => void Linking.openURL(REPO)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Icon name="open_in_new" size={16} color={c.faint} />
                <Text style={{ fontSize: 13, lineHeight: 19.5, textDecorationLine: 'underline' }}>{REPO.replace('https://', '')}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Card style={{ marginTop: 20, marginHorizontal: 16 }}>
              {[...steps, null].map((line, i) => (
                <View key={i} style={[{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
                  i < 2 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                  <Text mono style={{ fontSize: 12, color: c.faint, paddingTop: 2 }}>{i + 1}</Text>
                  <Text style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>
                    {line ?? <>{T('welNet3a')}<Text mono style={{ fontSize: 13 }}>100.x.x.x</Text>{T('welNet3b')}</>}
                  </Text>
                </View>
              ))}
            </Card>
            <Pressable onPress={() => void Linking.openURL(TAILSCALE)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 16, paddingHorizontal: 20, alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>{T('welTailscale')}</Text>
              <Icon name="arrow_outward" size={18} />
            </Pressable>
          </>
        )}

        <View style={{ marginTop: 'auto', paddingHorizontal: 16, paddingBottom: insets.bottom + 10, paddingTop: 24 }}>
          {step === 0 ? (
            <View style={{ alignItems: 'center', gap: 16 }}>
              <Button title={T('welNext')} onPress={() => setStep(1)} />
              <Pressable onPress={toPair} hitSlop={8}>
                <Text style={{ fontSize: 14, color: c.muted }}>{T('welSkip')} <Text style={{ color: c.ink, fontWeight: '600' }}>{T('welSkipLink')}</Text></Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title={T('back')} kind="outline" onPress={() => setStep(0)} style={{ alignSelf: 'auto' }} />
              <Button title={T('welStart')} onPress={toPair} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
