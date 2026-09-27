import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { BackBar, Button, Card, Icon, Label, Note, Radio, Spinner, Text } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { callOnce } from '../src/ws';
import type { CliAccount, Provider } from '../src/protocol';

const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** One signed-in account on some other paired computer. */
type Source = { hostId: string; hostName: string; account: CliAccount };
type Step = 'idle' | 'export' | 'import' | 'verify';

export default function MoveSignIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { provider, id } = useLocalSearchParams<{ provider?: Provider; id?: string }>();
  const { hosts, activeHostId, host, hostInfo, createAccount, loadAccounts } = useStore();
  const [sources, setSources] = useState<Source[]>([]);
  const [scanning, setScanning] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const here = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const others = hosts.filter((h) => h.id !== activeHostId);

  // Every other computer is asked what it is signed in to. One that is off or
  // unreachable simply contributes nothing — it must not hold up the list.
  useEffect(() => {
    let alive = true;
    (async () => {
      const found: Source[] = [];
      await Promise.all(others.map(async (h) => {
        try {
          const r = await callOnce<{ accounts: CliAccount[] }>(h.host, h.port, h.token, 'account.list', {});
          for (const a of r.accounts) {
            if ((!provider || a.provider === provider) && a.logged_in) found.push({ hostId: h.id, hostName: h.name, account: a });
          }
        } catch {}
      }));
      if (alive) {
        setSources(found);
        setScanning(false);
        if (found.length === 1) setPicked(`${found[0].hostId}:${found[0].account.id}`);
      }
    })();
    return () => { alive = false; };
  }, [hosts.length, activeHostId, provider]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (verifyTimer.current) clearTimeout(verifyTimer.current); }, []);

  const move = useCallback(async (src: Source) => {
    const srcHost = hosts.find((h) => h.id === src.hostId);
    if (!srcHost) return;
    const prov = src.account.provider;
    setStep('export');
    try {
      const exported = await callOnce<{ credentials: Record<string, unknown>; label: string }>(
        srcHost.host, srcHost.port, srcHost.token, 'account.export', { account_id: src.account.id });

      // Into the account this screen was opened from, or a new one named after
      // the source. Never into the computer's own built-in account.
      let targetId = typeof id === 'string' ? id : '';
      if (!targetId) {
        const created = await createAccount(prov, src.account.is_default ? src.hostName : src.account.label);
        targetId = created.id;
      }

      // One request both writes the sign-in and proves it works here; the
      // proving is the part that takes time.
      setStep('import');
      verifyTimer.current = setTimeout(() => setStep((s) => (s === 'import' ? 'verify' : s)), 700);
      const r = await useStore.getState().importSignIn(targetId, exported.credentials);
      if (verifyTimer.current) clearTimeout(verifyTimer.current);
      if (!r.verified) {
        alert(T('moveFailed'), `${r.verify_error ?? ''}\n\n${T('moveKeptSource', { host: src.hostName })}`.trim());
        setStep('idle');
        await loadAccounts();
        return;
      }
      // Only now: the source's copy is dead the moment this one refreshes.
      try {
        await callOnce(srcHost.host, srcHost.port, srcHost.token, 'account.forget', { account_id: src.account.id });
      } catch {}
      await loadAccounts();
      alert(T('moveDone'), T('moveDoneBody', { label: host?.name ?? '', host: src.hostName }));
      router.back();
    } catch (e: any) {
      if (verifyTimer.current) clearTimeout(verifyTimer.current);
      alert(T('moveFailed'), e?.message ?? '');
      setStep('idle');
    }
  }, [hosts, id, host?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  function confirm() {
    const src = sources.find((s) => `${s.hostId}:${s.account.id}` === picked);
    if (!src) return;
    alert(T('moveConfirm'), T('moveConfirmBody', { host: src.hostName, label: src.account.is_default ? T('useDefaultAccount') : src.account.label }), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('moveButton'), onPress: () => void move(src) },
    ]);
  }

  const busy = step !== 'idle';
  const src = sources.find((s) => `${s.hostId}:${s.account.id}` === picked);
  const order: Step[] = ['export', 'import', 'verify'];
  const at = order.indexOf(step);
  const st = (i: number): 'done' | 'now' | 'later' => (at > i ? 'done' : at === i ? 'now' : 'later');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <BackBar onPress={() => router.back()} />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 14 }}>
          <Text style={{ fontSize: 26, fontWeight: '600', letterSpacing: em(26, -0.02), lineHeight: 30 }}>{T('moveSignIn')}</Text>
        </View>
        <Note icon="warning" style={{ marginHorizontal: 16 }}>{T('moveWarn')}</Note>
        <View style={{ paddingTop: 16, paddingHorizontal: 16, gap: 6 }}>
          <Label style={{ paddingTop: 10 }}>{T('moveSource')}</Label>
          <Card>
            {scanning ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 14 }}>
                <Spinner />
                <Text style={{ fontSize: 14, color: c.muted }}>{T('moveLoadingHost')}</Text>
              </View>
            ) : others.length === 0 || sources.length === 0 ? (
              <View style={{ paddingVertical: 14, paddingHorizontal: 14 }}>
                <Text style={{ fontSize: 14, color: c.muted }}>{others.length === 0 ? T('moveNoHosts') : T('moveNoAccounts')}</Text>
              </View>
            ) : sources.map((s, i) => {
              const key = `${s.hostId}:${s.account.id}`;
              const name = s.account.is_default ? T('ownShort') : s.account.label;
              return (
                <Pressable key={key} disabled={busy} onPress={() => setPicked(key)}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
                    i < sources.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                  <Radio on={picked === key} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15 }}>
                      {s.hostName} · {s.account.is_default ? name : <Text style={{ fontWeight: '600' }}>{name}</Text>}
                    </Text>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: c.muted }}>
                      {[NAMES[s.account.provider], s.account.detail].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </View>

        {busy && src && (
          <View style={{ paddingTop: 16, paddingHorizontal: 20, gap: 8 }}>
            <Line state={st(0)} text={at > 0 ? T('moveExported', { host: src.hostName }) : T('moveExporting', { host: src.hostName })} />
            <Line state={st(1)} text={T('moveImported', { host: here })} />
            <Line state={st(2)} text={T('moveVerifying')} />
          </View>
        )}

        <View style={{ marginTop: 'auto', paddingTop: 24, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
          <Button title={busy ? T('moveWorking') : T('moveButton')} kind={busy ? 'busy' : 'primary'} onPress={confirm} disabled={!picked} />
        </View>
      </ScrollView>
    </View>
  );
}

function Line({ state, text }: { state: 'done' | 'now' | 'later'; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {state === 'done' ? <Icon name="check" size={18} color={c.ok} /> : state === 'now' ? <View style={{ width: 18, alignItems: 'center' }}><Spinner /></View> : <View style={{ width: 18 }} />}
      <Text style={{ fontSize: 14, fontWeight: state === 'now' ? '600' : '400', color: state === 'later' ? c.faint : c.ink }}>{text}</Text>
    </View>
  );
}
