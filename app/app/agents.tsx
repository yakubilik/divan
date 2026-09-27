import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { agentAccountOf, useStore, useT } from '../src/store';
import { client } from '../src/ws';
import { useColors } from '../src/theme';
import { Icon, Skeleton, Tabs, Text } from '../src/components/ui';
import { alert, measure, openMenu } from '../src/components/overlay';
import { accountOptions } from '../src/components/pickers';
import { AgentCard } from '../src/components/agentcard';
import { HomeTop } from '../src/components/home';
import type { Agent } from '../src/protocol';

/** Two columns of squares, the way an app grid reads. */
export default function Agents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { agents, agentsLoaded, loadAgents, defaults, projects, createChat, conn, removeAgent,
          accounts, loadAccounts, setDefaults } = useStore();
  const [opening, setOpening] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<{ label: string; n: number } | null>(null);
  const change = useRef<View>(null);

  const account = agentAccountOf(defaults);

  useFocusEffect(useCallback(() => {
    if (conn !== 'online') return;
    void loadAgents(account, defaults.cwd ?? null).catch(() => {});
    void loadAccounts().catch(() => {});
  }, [conn, loadAgents, loadAccounts, account, defaults.cwd]));

  // Agents belong to an account, so an empty grid can just mean the wrong one
  // is selected. Saying which one, and letting it be changed here, is the
  // difference between "you have no agents" and "not in this account".
  const accountOpts = accountOptions(accounts, 'claude', T('useDefaultAccount'), T('notSignedIn'));
  const current = accountOpts.find((o) => o.id === (account ?? ''));
  const accountLabel = current ? (current.id === '' ? T('ownShort') : current.label) : T('ownShort');

  // Only what belongs here: the built-in creator, and agents installed or
  // written through the app. The computer's own set stays with the computer —
  // those are other tools' workers, not chat partners.
  const loose = agents.filter((a) => a.installed);
  const waiting = !agentsLoaded && (conn === 'online' || conn === 'connecting');

  // An empty account is most often the wrong account. Find one that does have
  // agents, so the empty state can say where they are.
  useEffect(() => {
    setElsewhere(null);
    if (waiting || loose.length || conn !== 'online') return;
    let alive = true;
    (async () => {
      for (const o of accountOpts.filter((x) => x.id !== (account ?? ''))) {
        try {
          const r = await client.call<{ agents: Agent[] }>('agent.list', { account_id: o.id || null, cwd: defaults.cwd ?? null });
          const n = r.agents.filter((a) => a.installed).length;
          if (n && alive) { setElsewhere({ label: o.id === '' ? T('ownShort') : o.label, n }); return; }
        } catch {}
      }
    })();
    return () => { alive = false; };
  }, [waiting, loose.length, conn, account, accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function remove(a: Agent) {
    alert(T('removeAgent'), T('removeAgentBody'), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('remove'), style: 'destructive',
        onPress: () => void removeAgent(a.name, account).catch((e) => alert(T('error'), e?.message ?? '')) },
    ]);
  }

  async function open(a: Agent) {
    setOpening(a.id);
    try {
      // The same account the list was read from. An agent lives in one
      // account's folder, so a chat created against a different one cannot
      // find it — which is what made tapping an installed agent fail.
      const chat = await createChat({
        provider: 'claude', title: a.label, agent_id: a.id,
        account_id: account ?? undefined,
        cwd: defaults.cwd ?? projects[0]?.path ?? null,
      } as any);
      router.push(`/chat/${chat.id}`);
    } catch (e: any) {
      alert(T('error'), e?.message ?? '');
    } finally { setOpening(null); }
  }

  async function pickAccount() {
    const anchor = await measure(change);
    openMenu({ anchor, align: 'right', width: 240, items: accountOpts.map((o) => ({
      label: o.id === '' ? T('useDefaultAccount') : o.label, checked: o.id === (account ?? ''),
      onPress: () => void setDefaults({ agentAccountId: o.id || null }),
    })) });
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <HomeTop tab="agents" />
      <Tabs value={1} labels={[T('chatsTab'), T('agentsTab')]} onChange={() => router.replace('/chats')} />
      <Pressable ref={change} onPress={() => void pickAccount()}
        style={{ marginTop: 14, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.fill, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted, flex: 1 }}>{T('agentsFor')}<Text style={{ color: c.ink, fontWeight: '600' }}>{accountLabel}</Text></Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '600' }}>{T('change')}</Text>
          <Icon name="unfold_more" size={16} />
        </View>
      </Pressable>

      {waiting ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 12, paddingHorizontal: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: '48.5%', aspectRatio: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 16, padding: 14, gap: 8, opacity: 1 - i * 0.15 }}>
              <Skeleton width={40} height={40} radius={12} />
              <View style={{ flex: 1 }} />
              <Skeleton width="60%" height={13} />
              <Skeleton width="85%" height={10} color={c.fill} />
            </View>
          ))}
        </View>
      ) : loose.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingBottom: 120 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', textAlign: 'center' }}>{T('noAgentsHere')}</Text>
          <Text style={{ fontSize: 14, color: c.muted, lineHeight: 21, textAlign: 'center' }}>
            {T('agentsBelong')}
            {elsewhere && <> <Text style={{ color: c.ink, fontWeight: '600' }}>{elsewhere.label}</Text>{T('agentsHas', { n: elsewhere.n })}</>}
          </Text>
          <Pressable onPress={() => router.push('/agent-store')} hitSlop={8} style={{ paddingTop: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' }}>{T('addAgent')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 12, paddingHorizontal: 16 }}>
            {loose.map((a) => (
              <AgentCard key={a.id} agent={a} busy={opening === a.id}
                disabled={!!opening} onPress={() => void open(a)} onLongPress={() => remove(a)} />
            ))}
          </View>
          {/* Out of the grid: as a tile it was left stranded half-width on a
              row of its own whenever the agent count was odd, and read as a
              card that had been cut in half. */}
          <Pressable onPress={() => router.push('/agent-store')}
            style={({ pressed }) => [{ marginTop: 10, marginHorizontal: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.lineStrong, borderRadius: 14,
                                       padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
            <Icon name="add" size={18} />
            <Text style={{ fontSize: 15, fontWeight: '500' }}>{T('addAgent')}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
