import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agentAccountOf, useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Button, Group, ListRow, StatusDot } from '../src/components/divan';
import { PageHead } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { AgentGlyph } from '../src/components/agentcard';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { alert } from '../src/components/overlay';
import { accountOptions } from '../src/components/pickers';
import type { StoreItem } from '../src/protocol';

/** Installing a skill pack is three things happening in order, so it says which
 *  one it is on rather than spinning silently. */
type Step = 0 | 1 | 2 | 3;

/** One agent from the store, and the install that puts it on this computer.
 *  Reached from the store list — which agent it is arrives as `id`.
 *
 *  Drawn out of the design system's parts: the page's own name over the agent's
 *  badge, W18's card of rows for the account it is written under, and the three
 *  steps as the marks Divan already has for a state — a green tick behind, a
 *  running dot on the one happening now, a hollow grey dot ahead. The only
 *  colour that is not a token is the agent's own, which it brings with it the
 *  way a project's monogram does. */
export default function AgentInstall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const t = useTokens();
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

  // The store has not answered, or it answered and this agent is not in it —
  // an address arrived for something nobody can describe. Two different
  // silences, and neither of them is a page with an unnamed Install on it.
  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 8, paddingHorizontal: 16,
                                             paddingBottom: insets.bottom + 10 }}>
          <BackRow label={T('addAgent')} onPress={() => router.back()} style={{ paddingHorizontal: 4 }} />
          <PageHead lines={2} title={T(storeLoaded ? 'aiUnknown' : 'addAgent')} style={{ marginTop: 6 }} />
          <Text style={{ fontSize: 14, lineHeight: 14 * 1.5, color: t.ink2, paddingTop: 8, paddingHorizontal: 4 }}>
            {T(storeLoaded ? 'aiUnknownBody' : 'asLoading')}
          </Text>
        </ScrollView>
      </View>
    );
  }

  const lines: { title: string; now: string }[] = [
    { title: T('hStep1'), now: T('hStep1Now') },
    { title: T('hStep2'), now: T('hStep2Now') },
    { title: T('hStep3'), now: T('hStep3') },
  ];
  const finished = have || step === 3;
  const locked = step > 0 || finished;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 8, paddingHorizontal: 16,
                                           paddingBottom: 8 }}>
        <BackRow label={T('addAgent')} onPress={() => router.back()} style={{ paddingHorizontal: 4 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingHorizontal: 4 }}>
          <AgentGlyph label={item.label} color={item.color} size={44} radius={12} font={20} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <PageHead title={item.label} style={{ paddingHorizontal: 0 }} />
            <Text mono numberOfLines={1} style={{ fontSize: 12, color: t.ink3, marginTop: 2 }}>
              {[item.skills ? T('nSkills', { n: String(item.skills) }) : '', source?.label].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        <Group label={T('installInto')} style={{ marginTop: 16 }}>
          {opts.map((o, i) => {
            const on = (account ?? '') === o.id;
            return (
              <ListRow key={o.id} first={i === 0} boxed chevron={false} title={o.label}
                onPress={locked ? undefined : () => void setDefaults({ agentAccountId: o.id || null })}
                right={on ? <Icon name="check" size={18} color={t.ink} /> : undefined} />
            );
          })}
        </Group>
        <Text style={{ fontSize: 12, lineHeight: 12 * 1.45, color: t.ink3, paddingTop: 8, paddingHorizontal: 4 }}>
          {T('skillsWhere')}
        </Text>
        {needsAccount && !finished && (
          <Group style={{ marginTop: 10 }}>
            <ListRow first boxed chevron={false} wash="amber" icon="warning"
              title={T(hasAdded ? 'hermesPickAccount' : 'hermesNeedsAccount')} noteLines={3} />
          </Group>
        )}

        {locked && (
          <View style={{ paddingTop: 18, paddingHorizontal: 4, gap: 10 }}>
            {lines.map((l, i) => {
              const n = i + 1;
              const done = finished || step > n;
              const active = !finished && step === n;
              return (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {done ? <Icon name="check" size={16} color={t.run} />
                    : <View style={{ width: 16, alignItems: 'center' }}>
                        <StatusDot state={active ? 'running' : 'quiet'} hollow={!active} />
                      </View>}
                  <Text style={{ fontSize: 15, fontWeight: n === 3 && done ? '500' : '400',
                                 color: done || active ? t.ink : t.ink3 }}>{done ? l.title : l.now}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ marginTop: 'auto', paddingTop: 24, paddingBottom: insets.bottom + 10 }}>
          {finished ? (
            <Button label={T('goToAgents')} tall onPress={() => router.back()} />
          ) : !hasAdded && needsAccount ? (
            <Button label={T('goToAccounts')} tall onPress={() => router.push('/accounts')} />
          ) : (
            <Button label={step > 0 ? T('installing') : T('installNamed', { name: item.label })} tall
              style={needsAccount || step > 0 ? { opacity: 0.4 } : undefined}
              onPress={() => { if (!needsAccount && step === 0) void install(); }} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
