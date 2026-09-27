import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { BackBar, Button, Card, Icon, LargeTitle, Text, TextInput } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import type { HostConfig } from '../src/protocol';

const PAIR_CMD = 'remote-ai-chat pair';

export default function Pair() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const addHost = useStore((s) => s.addHost);
  const hostCount = useStore((s) => s.hosts.length);
  const [perm, requestPerm] = useCameraPermissions();
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8790');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const params = useLocalSearchParams<{ host?: string; port?: string; token?: string; name?: string; device_id?: string; add?: string }>();
  const adding = params.add === '1' || hostCount > 0;
  const denied = perm ? !perm.granted && !perm.canAskAgain : false;
  const showCamera = !manual && !denied && !!perm?.granted;

  // Deep link: remoteaichat://pair?host=..&port=..&token=..  (QR alternatifi)
  useEffect(() => {
    if (params.host && params.token && !busy) {
      void finish({ host: String(params.host), port: Number(params.port) || 8790, token: String(params.token), name: String(params.name || params.host), device_id: params.device_id ? String(params.device_id) : undefined });
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
      router.replace('/chats');
    } finally { setBusy(false); }
  }

  /** Accepts what `remote-ai-chat pair` prints: the remoteaichat:// deep link,
   *  and the older JSON payload. */
  function parsePairCode(data: string): HostConfig | null {
    const text = (data || '').trim();
    if (text.startsWith('remoteaichat://')) {
      const q = text.slice(text.indexOf('?') + 1);
      const p: Record<string, string> = {};
      for (const pair of q.split('&')) {
        const i = pair.indexOf('=');
        if (i > 0) p[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
      }
      if (!p.host || !p.token) return null;
      return { host: p.host, port: Number(p.port) || 8790, token: p.token, name: p.name || p.host, device_id: p.device_id };
    }
    try {
      const j = JSON.parse(text);
      if (!j.host || !j.token) return null;
      return { host: j.host, port: Number(j.port) || 8790, token: j.token, name: j.name || j.host, device_id: j.device_id };
    } catch {
      return null;
    }
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

  const form = manual || denied;
  const back = adding || (form && !denied)
    ? () => { if (manual && !denied) setManual(false); else router.back(); }
    : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top }} keyboardShouldPersistTaps="handled">
        {back ? <BackBar onPress={back} /> : null}
        <LargeTitle>{adding ? T('pairAddTitle') : T('pairTitle')}</LargeTitle>
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ fontSize: 14, color: c.muted }}>{adding ? T('pairSubtitleAdd') : T('pairSubtitle')}</Text>
        </View>
        <Pressable onPress={() => void Clipboard.setStringAsync(PAIR_CMD)} style={{ marginTop: 8, marginHorizontal: 16 }}>
          <Card style={{ borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text mono style={{ fontSize: 14, flex: 1 }}>{PAIR_CMD}</Text>
            <Icon name="content_copy" size={18} color={c.muted} />
          </Card>
        </Pressable>

        {form ? (
          <>
            {denied && (
              <View style={{ marginTop: 14, marginHorizontal: 16, backgroundColor: c.fill, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="no_photography" size={20} color={c.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500' }}>{T('pairCameraOff')}</Text>
                  <Text style={{ fontSize: 12, color: c.muted }}>{T('pairCameraOffHint')}</Text>
                </View>
              </View>
            )}
            <Card style={{ marginTop: 14, marginHorizontal: 16 }}>
              <Field label={T('pairHost')} value={host} onChange={setHost} placeholder="100.x.x.x" keyboard="numbers-and-punctuation" />
              <Field label={T('pairPort')} value={port} onChange={setPort} placeholder="8790" keyboard="number-pad" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 12, color: c.muted }}>{T('pairToken')}</Text>
                  <TextInput value={token} onChangeText={setToken} secureTextEntry={!showToken} mono
                    autoCapitalize="none" autoCorrect={false} placeholder="token"
                    style={{ fontSize: 15, letterSpacing: showToken ? 0 : 2 }} />
                </View>
                <Pressable onPress={() => setShowToken((v) => !v)} hitSlop={10}>
                  <Icon name={showToken ? 'visibility_off' : 'visibility'} size={20} color={c.muted} />
                </Pressable>
              </View>
            </Card>
            <View style={{ marginTop: 'auto', paddingTop: 24, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
              <Button title={T('pairConnect')} disabled={busy || !host.trim() || !token.trim()}
                onPress={() => finish({ host: host.trim(), port: Number(port) || 8790, token: token.trim(), name: host.trim() })} />
            </View>
          </>
        ) : (
          <>
            <View style={{ marginTop: 18, marginHorizontal: 16, height: 340, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1A1A18',
                           alignItems: 'center', justifyContent: 'center' }}>
              {showCamera && (
                <CameraView style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : onScan} />
              )}
              <View style={{ width: 200, height: 200, borderWidth: 2.5, borderColor: 'rgba(255,255,255,.9)', borderRadius: 22 }} />
              <Text style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: '#FFFFFF' }}>
                {T('pairPoint')}
              </Text>
            </View>
            <View style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
              <Button title={T('pairManualBtn')} kind="outline" onPress={() => setManual(true)} />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; keyboard: 'numbers-and-punctuation' | 'number-pad';
}) {
  const c = useColors();
  return (
    <View style={{ gap: 3, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} mono autoCapitalize="none" autoCorrect={false}
        keyboardType={keyboard} style={{ fontSize: 15 }} />
    </View>
  );
}
