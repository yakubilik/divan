import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agentAccountOf, useStore, useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { BackBar, Button, Card, Icon, Label, Note, Radio, Spinner, Text } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { accountOptions } from '../src/components/pickers';
import { hex6 } from '../src/components/agentcard';
import type { StoreItem } from '../src/protocol';

/** Installing a skill pack is three things happening in order, so it says which
 *  one it is on rather than spinning silently. */
type Step = 0 | 1 | 2 | 3;

/** One agent from the store, and the install that puts it on this computer.
 *  Reached from the store list — which agent it is arrives as `id`. */
export default function AgentInstall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { agents, storeSources, storeLoaded, loadStore, installAgent, defaults, conn,
          accounts, loadAccounts, setDefaults } = useStore();
  const [step, setStep] = useState<Step>(0);
  const account = agentAccountOf(defaults);

  useFocusEffect(useCallback(() => {
    if (conn !== 'online') return;
    if (!storeLoaded) void loadStore().catch(() => {});
    void loadAccounts().catch(() => {});
  }, [conn, storeLoaded, loadStore, loadAccounts]));

  const { id } = useLocalSearchParams<{ id: string }>();
  const source = useMemo(() => storeSources.find((s) => s.items.some((i) => i.id === id)), [storeSources, id]);
  const item: StoreItem | undefined = source?.items.find((i) => i.id === id);
  // The store id is `<source>:<what>`; an installed agent carries the source's name.
  const have = agents.some((a) => a.name === (id ?? '').split(':')[0]);
  // A bundle brings skills, and skills are written under the account it is
  // installed into — the computer's own account has no folder of its own to
  // put them in, so the computer refuses. Without an account the install cannot
  // succeed, so it is not offered: the screen asks for one instead of failing
  // at the end of the attempt. A lone agent definition has no skills and does
  // land somewhere writable, so it is not gated.
  const needsAccount = !account && item?.kind === 'bundle';
  // Having signed in already is a different problem from having nowhere to
  // install: one is answered on the Accounts screen, the other by picking one
  // here. Sending someone who has nine accounts off to add a tenth would
  // answer neither, so the picker is shown as soon as there is a real account.
  const hasAdded = accounts.some((a) => a.provider === 'claude' && a.logged_in && !a.is_default);
  const opts = accountOptions(accounts, 'claude', T('useDefaultAccount'), T('notSignedIn'));

  async function install() {
    if (!item || needsAccount) return;
    setStep(1);
    try {
      // One request, one answer — the computer reports no progress in between.
      // Nothing is ticked off until it comes back, or a failed install would
      // leave the screen claiming skills had been downloaded that never were.
      await installAgent(item.id, account);
      setStep(3);
    } catch (e: any) {
      setStep(0);
      alert(T('error'), e?.message ?? '');
    }
  }

  const color = hex6(item?.color, c.accent);
  const lines: { title: string; now: string }[] = [
    { title: T('hStep1'), now: T('hStep1Now') },
    { title: T('hStep2'), now: T('hStep2Now') },
    { title: T('hStep3'), now: T('hStep3') },
  ];
  const finished = have || step === 3;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 10, paddingBottom: 24, alignItems: 'center', gap: 10,
                       experimental_backgroundImage: `linear-gradient(180deg, ${color}26 0%, ${c.bg} 100%)` } as any}>
          <View style={{ alignSelf: 'flex-start', marginHorizontal: -10 }}><BackBar onPress={() => router.back()} style={{ paddingTop: 0 }} /></View>
          <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 30, fontWeight: '600', color: '#FFFFFF' }}>{(item?.label.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '600', letterSpacing: em(24, -0.02) }}>{item?.label ?? ''}</Text>
          <Text mono style={{ fontSize: 12, color: c.muted }}>
            {[item?.skills ? T('nSkills', { n: String(item.skills) }) : '', source?.label].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {(
          <View style={{ paddingTop: 4, paddingHorizontal: 16, gap: 6 }}>
            <Label style={{ paddingTop: 10 }}>{T('installInto')}</Label>
            <Card>
              {opts.map((o, i) => (
                <Pressable key={o.id} disabled={step > 0 || finished} onPress={() => void setDefaults({ agentAccountId: o.id || null })}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
                    i < opts.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                  <Radio on={(account ?? '') === o.id} />
                  <Text style={{ fontSize: 15 }}>{o.label}</Text>
                </Pressable>
              ))}
            </Card>
            <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('skillsWhere')}</Text>
            {needsAccount && !finished && (
              <Note icon="warning" style={{ marginTop: 6 }}>{hasAdded ? T('hermesPickAccount') : T('hermesNeedsAccount')}</Note>
            )}
          </View>
        )}

        {(step > 0 || finished) && (
          <View style={{ paddingTop: 18, paddingHorizontal: 20, gap: 10 }}>
            {lines.map((l, i) => {
              const n = i + 1;
              const done = finished || step > n;
              const active = !finished && step === n;
              return (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {done ? <Icon name="check_circle" size={20} color={c.ok} />
                    : active ? <View style={{ width: 20, alignItems: 'center' }}><Spinner size={14} /></View>
                    : <Icon name="radio_button_unchecked" size={18} color={c.faint} />}
                  <Text style={{ fontSize: 15, fontWeight: n === 3 && done ? '600' : '400', color: done || active ? c.ink : c.faint }}>{done ? l.title : l.now}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ marginTop: 'auto', paddingTop: 24, paddingHorizontal: 16, paddingBottom: insets.bottom + 10 }}>
          {finished ? (
            <Button title={T('goToAgents')} onPress={() => router.back()} />
          ) : !hasAdded && needsAccount ? (
            <Button title={T('goToAccounts')} onPress={() => router.push('/accounts')} />
          ) : (
            <Button title={step > 0 ? T('installing') : T('installNamed', { name: item?.label ?? '' })} kind={step > 0 ? 'busy' : 'primary'}
              onPress={() => void install()} disabled={!item || needsAccount} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
