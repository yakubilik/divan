import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useStore, useT } from '../src/store';
import { HOME } from '../src/shell';
import { DEFAULT_PORT, parsePairCode } from '../src/pair';
import { ON_COLOUR, RADIUS, useTokens } from '../src/theme';
import { Button, Card, FieldRow, Group, ListRow, Tap } from '../src/components/divan';
import { PageHead } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { alert } from '../src/components/overlay';
import type { HostConfig } from '../src/protocol';

const PAIR_CMD = 'remote-ai-chat pair';

/** The one screen that has to work before anything else does: this phone has
 *  never spoken to a computer, and this is where it is handed the address and
 *  the token.
 *
 *  No frame draws it — an artboard has no camera — so it is the design system's
 *  parts arranged the way Divan arranges a page you came to do one thing on:
 *  the frame's own `‹` row where there is somewhere to go back to, the page's
 *  name, the command to run over there, and then either the viewfinder or the
 *  three fields that stand in for it. Nothing here is coloured; the only
 *  colours on the page belong to the camera's own picture. */
export default function Pair() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const t = useTokens();
  const addHost = useStore((s) => s.addHost);
  const hostCount = useStore((s) => s.hosts.length);
  const [perm, requestPerm] = useCameraPermissions();
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [copied, setCopied] = useState(false);
  const params = useLocalSearchParams<{ host?: string; port?: string; token?: string; name?: string; device_id?: string; add?: string }>();
  const adding = params.add === '1' || hostCount > 0;
  const denied = perm ? !perm.granted && !perm.canAskAgain : false;
  const showCamera = !manual && !denied && !!perm?.granted;

  // Deep link: remoteaichat://pair?host=..&port=..&token=..  (QR alternative)
  useEffect(() => {
    if (params.host && params.token && !busy) {
      void finish({ host: String(params.host), port: Number(params.port) || DEFAULT_PORT, token: String(params.token), name: String(params.name || params.host), device_id: params.device_id ? String(params.device_id) : undefined });
    }
  }, [params.host, params.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // The camera is what this screen is for; ask for it straight away rather
  // than behind a tap. A refusal lands on the typed-in form.
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) void requestPerm();
  }, [perm?.granted, perm?.canAskAgain]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(cfg: HostConfig) {
    setBusy(true);
    try {
      await addHost(cfg);
      if (router.canGoBack()) router.dismissAll();
      router.replace(HOME);
    } finally { setBusy(false); }
  }

  function onScan({ data }: { data: string }) {
    if (busy || scanned) return;
    const cfg = parsePairCode(data);
    setScanned(true);
    if (!cfg) {
      alert(T('pairBadCode'), T('pairBadCodeBody'), [{ text: 'OK', onPress: () => setScanned(false) }]);
      return;
    }
    void finish(cfg);
  }

  function copy() {
    void Clipboard.setStringAsync(PAIR_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const form = manual || denied;
  const back = adding || (form && !denied)
    ? () => { if (manual && !denied) setManual(false); else router.back(); }
    : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 8, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled">
        {back ? <BackRow label={T(manual && !denied ? 'pairScanBack' : 'back')} onPress={back}
          style={{ paddingHorizontal: 4 }} /> : null}
        <PageHead title={adding ? T('pairAddTitle') : T('pairTitle')} style={{ marginTop: 6 }} />
        <Text style={{ fontSize: 14, lineHeight: 14 * 1.45, color: t.ink2, paddingTop: 6, paddingHorizontal: 4 }}>
          {adding ? T('pairSubtitleAdd') : T('pairSubtitle')}
        </Text>
        {/* The command is the same on both halves of this screen: whether the
            code is read off the screen or typed in, it is what prints it. */}
        <Card onPress={copy} radius={RADIUS.tab} inset={false} style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 }}>
            <Text mono style={{ fontSize: 14, flex: 1 }}>{PAIR_CMD}</Text>
            <Icon name={copied ? 'check' : 'content_copy'} size={17} color={copied ? t.run : t.ink3} />
          </View>
        </Card>

        {form ? (
          <>
            {denied && (
              <Group style={{ marginTop: 12 }}>
                <ListRow first boxed chevron={false} wash="amber" icon="no_photography"
                  title={T('pairCameraOff')} note={T('pairCameraOffHint')} noteLines={2} />
              </Group>
            )}
            <Group style={{ marginTop: 12 }}>
              <FieldRow first label={T('pairHost')} value={host} onChange={setHost}
                placeholder="100.x.x.x" keyboard="numbers-and-punctuation" />
              <FieldRow label={T('pairPort')} value={port} onChange={setPort}
                placeholder={String(DEFAULT_PORT)} keyboard="number-pad" />
              <FieldRow label={T('pairToken')} value={token} onChange={setToken} placeholder="token"
                secret shown={showToken} onShow={() => setShowToken((v) => !v)} />
            </Group>
            <View style={{ marginTop: 'auto', paddingTop: 24, paddingBottom: insets.bottom + 10 }}>
              <Button label={busy ? T('pairConnecting') : T('pairConnect')} tall
                style={busy || !host.trim() || !token.trim() ? { opacity: 0.4 } : undefined}
                onPress={() => {
                  if (busy || !host.trim() || !token.trim()) return;
                  void finish({ host: host.trim(), port: Number(port) || DEFAULT_PORT, token: token.trim(), name: host.trim() });
                }} />
            </View>
          </>
        ) : (
          <>
            {/* The viewfinder. Its reticle is white on both themes because what
                is behind it is the camera's own picture and not the page —
                `ON_COLOUR`, the same reason a monogram's letter is white. */}
            <View style={{ marginTop: 16, height: 320, borderRadius: 20, overflow: 'hidden',
                           backgroundColor: t.s2, alignItems: 'center', justifyContent: 'center' }}>
              {showCamera && (
                <CameraView style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : onScan} />
              )}
              {showCamera && (
                <View style={{ width: 200, height: 200, borderWidth: 2.5, borderColor: ON_COLOUR, borderRadius: 22 }} />
              )}
            </View>
            <Text mono style={{ fontSize: 12, color: t.ink3, paddingTop: 10, paddingHorizontal: 4 }}>
              {T('pairPoint')}
            </Text>
            <View style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: insets.bottom + 10 }}>
              <Tap onPress={() => setManual(true)} style={{ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: t.ink }}>{T('pairManualBtn')}</Text>
              </Tap>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
