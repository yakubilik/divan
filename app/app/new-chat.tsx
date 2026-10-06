/** A new chat, with every choice the panel's dialog offers (`web/src/components/
 *  NewChat.tsx`) and in the same order: the tool, the sign-in, the agent, the
 *  model, effort and permission mode, the folder — searched, recent ones first —
 *  the group, and the per-chat caps behind Advanced.
 *
 *  The two were different for a long time: the phone had the tool, model,
 *  effort, mode, folder and group, and a chat opened here could not be given an
 *  agent or an account, so the same computer opened a different chat depending
 *  on which screen asked. The agent rule is the panel's: what the last chat was
 *  opened with, or Hermes where it has never been chosen, and an explicit "No
 *  agent" stays one. */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Button, Icon, Label, Rule, Segmented, Skeleton, Text, TextInput } from '../src/components/ui';
import { alert, prompt } from '../src/components/overlay';
import { FolderRadios, GroupChips, OptionCard, ProviderCards, accountOptions } from '../src/components/pickers';
import { Sheet, SheetBar, useSheet } from '../src/components/sheet';
import type { Agent, Provider } from '../src/protocol';

export default function NewChat() {
  const router = useRouter();
  return <Sheet kind="page" onClose={() => router.back()}><Body /></Sheet>;
}

function Body() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { close } = useSheet();
  const projectsLoaded = useStore((st) => st.projectsLoaded);
  const catalog = useStore((st) => st.catalog);
  const defaults = useStore((st) => st.defaults);
  const projects = useStore((st) => st.projects);
  const groups = useStore((st) => st.groups);
  const chats = useStore((st) => st.chats);
  const accounts = useStore((st) => st.accounts);
  const accountsLoaded = useStore((st) => st.accountsLoaded);
  const conn = useStore((st) => st.conn);
  const loadProjects = useStore((st) => st.loadProjects);
  const loadAccounts = useStore((st) => st.loadAccounts);
  const listAgents = useStore((st) => st.listAgents);
  const createChat = useStore((st) => st.createChat);
  const createGroup = useStore((st) => st.createGroup);
  const setDefaults = useStore((st) => st.setDefaults);
  const prefs = useStore((st) => st.prefs);
  const authenticate = useStore((st) => st.authenticate);

  const [provider, setProvider] = useState<Provider>(defaults.provider);
  const pd = defaults.byProvider?.[provider];
  const [model, setModel] = useState(pd?.model ?? defaults.model);
  const [effort, setEffort] = useState<string | null>(pd?.effort ?? defaults.effort);
  const [perm, setPerm] = useState(pd?.perm_mode ?? defaults.perm_mode);
  /** '' is the computer's own sign-in, the way `chat.create` reads "no account_id". */
  const [account, setAccount] = useState<string>(pd?.account_id ?? '');
  const [agentId, setAgentId] = useState<string | null>(null);
  /** Whether anyone picked an agent here. Until then the remembered one (Hermes
   *  the first time) is applied when the list arrives. */
  const [agentTouched, setAgentTouched] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [cwd, setCwd] = useState<string | null>(defaults.cwd);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [maxTurns, setMaxTurns] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadProjects().catch(() => {}); }, [loadProjects]);
  useEffect(() => { if (!accountsLoaded) void loadAccounts().catch(() => {}); }, [accountsLoaded, loadAccounts]);

  const cat = catalog?.[provider];
  // Each tool brings its own models, efforts and modes: a choice the new one
  // still knows is kept, anything else falls back to what this tool last used.
  useEffect(() => {
    if (!cat) return;
    const d = defaults.byProvider?.[provider];
    setModel((m) => (cat.models.some((x) => x.id === m) ? m
      : d?.model && cat.models.some((x) => x.id === d.model) ? d.model : cat.models[0].id));
    setEffort((e) => (e && cat.efforts.includes(e) ? e
      : d?.effort && cat.efforts.includes(d.effort) ? d.effort : cat.efforts[0] ?? null));
    setPerm((p) => (cat.perm_modes.includes(p) ? p
      : d?.perm_mode && cat.perm_modes.includes(d.perm_mode) ? d.perm_mode : cat.perm_modes[0]));
  }, [cat, provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const efforts: string[] = (cat?.models.find((m: any) => m.id === model) as any)?.efforts ?? cat?.efforts ?? [];

  const accountOpts = useMemo(
    () => accountOptions(accounts, provider, T('useDefaultAccount'), T('notSignedIn')),
    [accounts, provider, T]);
  // A remembered sign-in that is gone, or belongs to the other tool, is the
  // computer's own — the same resolution the panel makes.
  useEffect(() => {
    if (!accountOpts.length) return;
    setAccount((a) => (accountOpts.some((o) => o.id === a) ? a
      : (defaults.byProvider?.[provider]?.account_id ?? '') && accountOpts.some((o) => o.id === defaults.byProvider?.[provider]?.account_id)
        ? (defaults.byProvider?.[provider]?.account_id as string) : ''));
  }, [accountOpts, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveCwd = cwd || projects[0]?.path || null;

  // Which agents exist depends on the account (its folder holds the installed
  // ones) and on the folder (a project can carry its own), so it is asked again
  // when either changes. Codex reads no agent prompt, so it has none.
  useEffect(() => {
    if (provider !== 'claude' || conn !== 'online') { setAgents([]); return; }
    let alive = true;
    setAgentsLoading(true);
    listAgents(account || null, effectiveCwd)
      .then((list) => { if (alive) setAgents(list); })
      .catch(() => { if (alive) setAgents([]); })
      .finally(() => { if (alive) setAgentsLoading(false); });
    return () => { alive = false; };
  }, [provider, account, effectiveCwd, conn, listAgents]);

  const agentList = useMemo(() => agents.filter((a) => a.installed), [agents]);
  const agent = agentList.find((a) => a.id === agentId) ?? null;
  useEffect(() => {
    if (agentTouched || agentsLoading || !agentList.length) return;
    if (defaults.lastAgent === null) return;
    const named = (w: string | null | undefined) =>
      w ? agentList.find((a) => a.id === w || a.name === w) : undefined;
    const hit = named(defaults.lastAgent) ?? named('hermes');
    if (hit) setAgentId(hit.id);
  }, [agentList, agentsLoading, agentTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // The four folders the latest chats were in, then the rest; a search covers all.
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    for (const ch of Object.values(chats)) {
      if (ch.cwd) seen.set(ch.cwd, Math.max(seen.get(ch.cwd) ?? 0, ch.updated_at ?? 0));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
  }, [chats]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    if (!q) return projects.filter((p) => !recent.includes(p.path));
    return projects.filter((p) =>
      p.name.toLocaleLowerCase('tr').includes(q) || p.path.toLocaleLowerCase('tr').includes(q));
  }, [projects, query, recent]);

  async function choosePerm(p: string) {
    if (p === 'bypass' && prefs.faceIdBypass) {
      const ok = await authenticate(T('bypassAuth'));
      if (!ok) return;
    }
    setPerm(p);
  }

  function newGroup() {
    prompt({
      title: T('newGroupTitle'), placeholder: T('groupName'), confirm: T('create'), cancel: T('cancel'),
      submit: async (n) => { if (!n.trim()) return T('groupNameEmpty'); const g = await createGroup(n.trim().slice(0, 60)); setGroupId(g.id); },
    });
  }

  async function start() {
    setBusy(true);
    try {
      const chat = await createChat({
        provider, model, effort: effort ?? undefined, perm_mode: perm, cwd: effectiveCwd ?? undefined,
        group_id: groupId ?? undefined, account_id: account || undefined,
        // An agent chat is named after the agent, as the panel names it.
        ...(agent ? { agent_id: agent.id, title: agent.label || agent.name } : {}),
        max_turns: maxTurns ? Number(maxTurns) : null,
        max_budget_usd: budget ? Number(budget) : null,
      } as any);
      void setDefaults({
        provider, model, effort: effort ?? 'high', perm_mode: perm, cwd: effectiveCwd,
        byProvider: { ...defaults.byProvider, [provider]: { model, effort, perm_mode: perm, account_id: account || null } },
        ...(provider === 'claude' && agentTouched ? { lastAgent: agent ? agent.id : null } : {}),
      });
      close(() => router.push(`/chat/${chat.id}`));
    } catch (e: any) {
      alert(T('couldNotStart'), e.message);
    } finally { setBusy(false); }
  }

  const box = { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 6 } as const;

  return (
    <View style={{ flex: 1 }}>
      <SheetBar title={agent ? T('ncChatWith', { name: agent.label || agent.name }) : T('newChat')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 14, flexGrow: 1 }}>
        <View style={{ gap: 6 }}>
          <Label>{T('tool')}</Label>
          <ProviderCards value={provider} onChange={(p) => { setProvider(p); if (p !== 'claude') setAgentId(null); }} />
        </View>

        {accountOpts.length > 1 && (
          <View style={{ gap: 6 }}>
            <Label>{T('accountFor')}</Label>
            <OptionCard options={accountOpts.map((o) => ({ id: o.id, label: o.label, hint: o.hint, muted: !o.signedIn }))}
              value={account} onChange={setAccount} />
          </View>
        )}

        {provider === 'claude' && (
          <View style={{ gap: 6 }}>
            <Label>{T('ncAgent')}</Label>
            <OptionCard
              options={[
                { id: '', label: T('ncNoAgent'), hint: T('ncNoAgentHint') },
                ...agentList.map((a) => ({
                  id: a.id,
                  label: `${a.glyph ? `${a.glyph}  ` : ''}${a.label || a.name}`
                    + (a.scope === 'project' ? ` · ${T('ncProjectAgent')}` : ''),
                  hint: a.description || a.name,
                })),
              ]}
              value={agentId ?? ''}
              onChange={(id) => { setAgentTouched(true); setAgentId(id || null); }} />
            {agentsLoading && !agentList.length && (
              <Text style={{ fontSize: 12.5, color: c.muted, paddingHorizontal: 4 }}>{T('ncReadingAgents')}</Text>
            )}
          </View>
        )}

        {cat ? (
          <>
            <View style={{ gap: 6 }}>
              <Label>{T('model')}</Label>
              <OptionCard options={cat.models.map((m: any) => ({ id: m.id, label: m.label || m.id, hint: m.hint }))}
                value={model} onChange={setModel} />
            </View>
            {efforts.length > 0 && (
              <View style={{ gap: 6 }}>
                <Label>{T('effort')}</Label>
                <Segmented options={efforts} value={effort} onChange={setEffort} />
              </View>
            )}
            <View style={{ gap: 6 }}>
              <Label>{T('permMode')}</Label>
              <Segmented options={cat.perm_modes} value={perm} onChange={(p) => void choosePerm(p)} />
              {perm === 'bypass' && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 10, backgroundColor: c.warnBg }}>
                  <Icon name="error" size={15} color={c.warn} />
                  <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: c.warn }}>{T('ncBypassWarn')}</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <Text style={{ fontSize: 13, color: c.muted }}>{T('ncNoModels')}</Text>
        )}

        <View style={box}>
          <Label>{T('folder')}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingHorizontal: 10, height: 38 }}>
            <Icon name="search" size={16} color={c.muted} />
            <TextInput value={query} onChangeText={setQuery} placeholder={T('ncSearchFolders')}
              autoCapitalize="none" autoCorrect={false} style={{ flex: 1, fontSize: 14 }} />
          </View>
          {!query && recent.length > 0 && (
            <>
              <Text style={{ fontSize: 11.5, color: c.muted, marginTop: 4 }}>{T('ncRecent')}</Text>
              <FolderRadios value={effectiveCwd} onChange={setCwd}
                projects={recent.map((p) => ({ path: p, name: p.split(/[/\\]/).pop() ?? p, is_git: false }))} />
              <Rule style={{ marginVertical: 4 }} />
            </>
          )}
          {!projectsLoaded && !projects.length
            ? <View style={{ paddingVertical: 8 }}><Skeleton width="58%" height={12} /></View>
            : <FolderRadios value={effectiveCwd} projects={filtered} loading={!projectsLoaded} onChange={setCwd} />}
          <Rule style={{ marginVertical: 6 }} />
          <Label>{T('group')}</Label>
          <GroupChips value={groupId} groups={groups} onChange={setGroupId} onNew={newGroup} />
        </View>

        <View style={{ gap: 8 }}>
          <Pressable onPress={() => setAdvanced((a) => !a)} hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
            <Icon name={advanced ? 'expand_more' : 'chevron_right'} size={16} color={c.muted} />
            <Text style={{ fontSize: 14, color: c.text2 }}>{T('ncAdvanced')}</Text>
            <Text style={{ fontSize: 12.5, color: c.faint, marginLeft: 6 }}>{T('ncCapsPerChat')}</Text>
          </Pressable>
          {advanced && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { label: 'max_turns', value: maxTurns, set: setMaxTurns },
                { label: 'max_budget_usd', value: budget, set: setBudget },
              ].map((f) => (
                <View key={f.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 10,
                                             borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.card }}>
                  <Text mono style={{ fontSize: 11.5, color: c.muted, flex: 1 }} numberOfLines={1}>{f.label}</Text>
                  <TextInput mono value={f.value} onChangeText={(v) => f.set(v.replace(/[^0-9.]/g, ''))}
                    placeholder={T('ncUnlimited')} keyboardType="decimal-pad"
                    style={{ width: 72, textAlign: 'right', fontSize: 13 }} />
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: insets.bottom + 6 }}>
          <Button title={T('startChat')} onPress={() => void start()} disabled={busy || !cat || !effectiveCwd} />
        </View>
      </ScrollView>
    </View>
  );
}
