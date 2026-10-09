import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Button, Card, SectionHeader, Tap } from '../src/components/divan';
import { PageHead } from '../src/components/machine';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';

const SEAL = require('../assets/divan-seal.png');

const REPO = 'https://github.com/yakubilik/divan';
const TAILSCALE = 'https://tailscale.com/download';

const INSTALL = 'git clone ' + REPO + '.git\ncd divan/daemon && ./install.sh';

/** What the pairing screen used to assume you already knew: that the agent
 *  runs on a computer, that a daemon has to be installed there, and that
 *  reaching it from the bus needs a private network between the two.
 *
 *  No frame draws this — there is nothing to pair with on an artboard — so it
 *  is built out of the design system's parts and follows the one page Divan
 *  does draw for a screen that is a statement rather than a list (Mobile7 S6):
 *  a mono line saying where you are, one sentence at the top of the page, a
 *  paragraph in `ink2` under it, and the buttons at the foot. */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const t = useTokens();
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
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      {/* How far along the two steps are. Two rules rather than dots: the same
          2 pt rule a running card wears across its top (Mobile3 D4). */}
      <View style={{ flexDirection: 'row', gap: 6, paddingTop: 12, paddingHorizontal: 20 }}>
        <View style={{ flex: 1, height: 2, backgroundColor: t.ink }} />
        <View style={{ flex: 1, height: 2, backgroundColor: step === 1 ? t.ink : t.line2 }} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}>
        <View style={{ paddingTop: 24, paddingHorizontal: 20, gap: 8 }}>
          {/* The seal, once, where the app first says its name. */}
          <Image source={SEAL} accessibilityLabel="Divan" testID="welcome-seal"
            style={{ width: 96, height: 96, marginBottom: 10 }} />
          <SectionHeader kind="mark" title={T(step === 0 ? 'welStep1' : 'welStep2')}
            style={{ paddingTop: 0, paddingHorizontal: 0 }} />
          <PageHead lines={3} title={T(step === 0 ? 'welTitle1' : 'welTitle2')} style={{ paddingHorizontal: 0 }} />
          <Text style={{ fontSize: 15, lineHeight: 15 * 1.5, color: t.ink2 }}>
            {T(step === 0 ? 'welBody1' : 'welBody2')}
          </Text>
        </View>

        {step === 0 ? (
          <>
            <Card onPress={copy} style={{ marginTop: 18, marginHorizontal: 16 }}>
              <Text mono style={{ fontSize: 13, lineHeight: 13 * 1.55 }}>{INSTALL}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name={copied ? 'check' : 'content_copy'} size={16} color={copied ? t.run : t.ink3} />
                <Text mono style={{ fontSize: 12, fontWeight: '500', color: copied ? t.run : t.ink3 }}>
                  {copied ? T('welCopied') : T('welCopy')}
                </Text>
              </View>
            </Card>
            <View style={{ paddingTop: 14, paddingHorizontal: 20, gap: 12 }}>
              <Text style={{ fontSize: 13, lineHeight: 13 * 1.5, color: t.ink3 }}>{T('welWindows')}</Text>
              <Tap onPress={() => void Linking.openURL(REPO)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                <Text mono style={{ fontSize: 12.5, color: t.ink }}>{REPO.replace('https://', '')}</Text>
                <Icon name="arrow_outward" size={15} color={t.ink} />
              </Tap>
            </View>
          </>
        ) : (
          <>
            <Card inset={false} style={{ marginTop: 18, marginHorizontal: 16 }}>
              {[...steps, null].map((line, i) => (
                <View key={i} style={[{ flexDirection: 'row', gap: 12, paddingVertical: 13, paddingHorizontal: 20 },
                  i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                  <Text mono style={{ fontSize: 12, color: t.ink3, paddingTop: 2 }}>{i + 1}</Text>
                  <Text style={{ flex: 1, fontSize: 15, lineHeight: 15 * 1.4 }}>
                    {line ?? <>{T('welNet3a')}<Text mono style={{ fontSize: 13 }}>100.x.x.x</Text>{T('welNet3b')}</>}
                  </Text>
                </View>
              ))}
            </Card>
            <Tap onPress={() => void Linking.openURL(TAILSCALE)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                       paddingVertical: 16, paddingHorizontal: 20 }}>
              <Text style={{ fontSize: 15, fontWeight: '500' }}>{T('welTailscale')}</Text>
              <Icon name="arrow_outward" size={17} color={t.ink} />
            </Tap>
          </>
        )}

        <View style={{ marginTop: 'auto', paddingTop: 24, paddingHorizontal: 16,
                       paddingBottom: insets.bottom + 10, gap: 12 }}>
          {step === 0 ? (
            <>
              <Button label={T('welNext')} tall onPress={() => setStep(1)} />
              <Tap onPress={toPair} style={{ alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 8 }}>
                <Text style={{ fontSize: 13.5, color: t.ink3 }}>
                  {T('welSkip')} <Text style={{ color: t.ink, fontWeight: '500' }}>{T('welSkipLink')}</Text>
                </Text>
              </Tap>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label={T('back')} face="outline" tall onPress={() => setStep(0)} style={{ paddingHorizontal: 18 }} />
              <Button label={T('welStart')} tall onPress={toPair} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
