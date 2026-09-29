import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_PERM, useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Group, ListRow, RowButton, SectionHeader, Segments, Sheet, useSheet } from '../src/components/divan';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { alert } from '../src/components/overlay';
import { cliVersion } from '../src/components/pickers';
import type { Provider, ProviderDefaults } from '../src/protocol';

/** Which tool runs a turn, under which model, at what effort and with what it
 *  is allowed to do. With `id` it edits that chat and applies immediately;
 *  without it (`defaults=1`) it edits the defaults used by the pen button.
 *
 *  Drawn out of the design system's parts: the drawer's head from Web15 W12 over
 *  a page of W18's cards, and the two settings that are a choice between three
 *  words — effort, permission mode — as the segmented control W18 draws for
 *  exactly that. */
export default function ModelSheet() {
  const router = useRouter();
  const T = useT();
  const { id, defaults } = useLocalSearchParams<{ id?: string; defaults?: string }>();
  // For a chat it stands tall, with room for the account list; for the
  // defaults it stops lower down, over the settings it came from.
  const forDefaults = defaults === '1' || !id;
  const chat = useStore((s) => (id ? s.chats[id] : undefined));
  // With no chat to set anything on, the tall panel came up empty: nothing to
  // read, nothing to tap, and a scrim reduced to one hairline at the top, so
  // the only way out was to know to drag it. Say what happened, at the size of
  // saying it.
  if (!forDefaults && !chat) {
    return <Sheet title={T('modelTitle')} note={T('modelNoChat')} onClose={() => router.back()}><Gone /></Sheet>;
  }
  return (
    <Sheet title={T(forDefaults ? 'defaultsShort' : 'modelTitle')}
      note={T(forDefaults ? 'forNewChats' : 'appliesNowShort')}
      top={forDefaults ? 128 : 8} onClose={() => router.back()}>
      <Body />
    </Sheet>
  );
}

function Gone() {
  const insets = useSafeAreaInsets();
  const T = useT();
  const { close } = useSheet();
  return (
    <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 18,
                   alignItems: 'flex-start' }}>
      <RowButton label={T('close')} onPress={() => close()} />
    </View>
  );
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Body() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const t = useTokens();
  const { close } = useSheet();
  const { id, defaults: defaultsMode } = useLocalSearchParams<{ id?: string; defaults?: string }>();
  const editingDefaults = defaultsMode === '1' || !id;
  const chat = useStore((s) => (id ? s.chats[id] : undefined));
  const catalog = useStore((s) => s.catalog);
  const defaults = useStore((s) => s.defaults);
  const hostInfo = useStore((s) => s.hostInfo);
  const updateChat = useStore((s) => s.updateChat);
  const setDefaults = useStore((s) => s.setDefaults);
  const prefs = useStore((s) => s.prefs);
  const authenticate = useStore((s) => s.authenticate);
  const accounts = useStore((s) => s.accounts);
  const loadAccounts = useStore((s) => s.loadAccounts);
  useEffect(() => { void loadAccounts().catch(() => {}); }, [loadAccounts]);

  const initial = editingDefaults
    ? { provider: defaults.provider, model: defaults.model, effort: defaults.effort as string | null, perm: defaults.perm_mode }
    : { provider: chat?.provider ?? 'claude', model: chat?.model ?? '', effort: chat?.effort ?? null, perm: chat?.perm_mode ?? DEFAULT_PERM };
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [effort, setEffort] = useState<string | null>(initial.effort);
  const [perm, setPerm] = useState(initial.perm);
  const cat = catalog?.[provider] ?? null;
  // A model can name its own efforts (Codex does); one that names none has no
  // effort setting at all, and the control is not offered. A daemon older than
  // this app sends no per-model list, so fall back to the provider's rather
  // than letting the control vanish against an older computer.
  const efforts: string[] = (cat?.models?.find((m: any) => m.id === model) as any)?.efforts ?? cat?.efforts ?? [];
  // Every sign-in of this tool is listed, but only one that is actually signed
  // in can run a turn — and the computer's own login is always offered.
  const accountsFor = accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default));

  function onAccount(accountId: string | null) {
    if (editingDefaults) {
      const d = defaults.byProvider?.[provider] ?? { model, effort, perm_mode: perm };
      void setDefaults({ byProvider: { ...(defaults.byProvider ?? {}), [provider]: { ...d, account_id: accountId } } });
      return;
    }
    updateChat(id!, { account_id: accountId } as any).catch((e) => alert(T('couldNotSave'), e.message));
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function remember(p: Provider, d: ProviderDefaults) {
    void setDefaults({ provider: p, model: d.model, effort: d.effort ?? 'high', perm_mode: d.perm_mode, byProvider: { ...(defaults.byProvider ?? {}), [p]: d } });
  }
  function apply(next: Partial<{ provider: Provider; model: string; effort: string | null; perm_mode: string }>) {
    const p = { provider, model, effort, perm_mode: perm, ...next };
    remember(p.provider, { model: p.model, effort: p.effort, perm_mode: p.perm_mode });
    if (editingDefaults) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => updateChat(id!, p as any).catch((e) => alert(T('couldNotSave'), e.message)), 250);
  }

  /** Switching tool restores what was last used with that tool (or a sane catalog default). */
  function onProvider(pv: Provider) {
    const cc = catalog?.[pv];
    if (!cc) return;
    const last = defaults.byProvider?.[pv];
    const m = last && cc.models.some((x) => x.id === last.model) ? last.model : (cc.models.find((x: any) => x.hint?.startsWith('default')) ?? cc.models[0]).id;
    const e = last && (last.effort == null || cc.efforts.includes(last.effort)) ? last.effort : (cc.efforts.includes('high') ? 'high' : cc.efforts.includes('medium') ? 'medium' : cc.efforts[0] ?? null);
    const pm = last && cc.perm_modes.includes(last.perm_mode) ? last.perm_mode : cc.perm_modes[0];
    setProvider(pv); setModel(m); setEffort(e); setPerm(pm);
    apply({ provider: pv, model: m, effort: e, perm_mode: pm });
  }
  const onModel = (m: string) => {
    const next: string[] = (cat?.models?.find((x: any) => x.id === m)?.efforts) ?? cat?.efforts ?? [];
    // Carrying "max" onto a model that has no effort setting is what sent an
    // unsupported parameter and failed the turn.
    const e = next.length === 0 ? null : (effort && next.includes(effort) ? effort : (next.includes('high') ? 'high' : next[0]));
    setModel(m); setEffort(e); apply({ model: m, effort: e });
  };
  const onEffort = (e: string) => { setEffort(e); apply({ effort: e }); };
  async function onPerm(p: string) {
    if (p === 'bypass' && prefs.faceIdBypass) { const ok = await authenticate(T('bypassAuth')); if (!ok) return; }
    setPerm(p); apply({ perm_mode: p });
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Deleted from another device while this was open: get out of the way rather
  // than sit there editing a chat that is gone.
  useEffect(() => { if (!editingDefaults && !chat) close(); }, [editingDefaults, chat]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountValue = (editingDefaults ? defaults.byProvider?.[provider]?.account_id : chat?.account_id) ?? '';
  const mark = (on: boolean) => (on ? <Icon name="check" size={18} color={t.ink} /> : undefined);
  return (
    <ScrollView bounces={false} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16,
                                                         paddingBottom: insets.bottom + 10, gap: 14 }}>
      <Segments value={provider} onChange={(v) => onProvider(v as Provider)}
        segments={[{ key: 'claude', label: 'Claude', mark: cliVersion(hostInfo?.versions.claude) },
                   { key: 'codex', label: 'Codex', mark: cliVersion(hostInfo?.versions.codex) }]} />
      {cat && (
        <>
          <Group label={T('model')}>
            {cat.models.map((m, i) => (
              <ListRow key={m.id} first={i === 0} boxed chevron={false} title={m.label}
                note={m.hint ? capital(m.hint) : null} onPress={() => onModel(m.id)}
                right={mark(m.id === model)} />
            ))}
          </Group>
          {efforts.length > 0 && (
            <View style={{ gap: 6 }}>
              <SectionHeader kind="mark" title={T('effort')} style={{ paddingHorizontal: 4 }} />
              <Segments value={effort} onChange={onEffort}
                segments={efforts.map((e) => ({ key: e, label: e === 'medium' ? 'med' : e }))} />
            </View>
          )}
          {/* The default account is chosen on the Accounts screen, where the
              check mark is; here it is only asked for one chat. */}
          {!editingDefaults && accountsFor.length > 1 && (
            <Group label={T('accountFor')}>
              {accountsFor.map((a, i) => {
                const key = a.is_default ? '' : a.id;
                return (
                  <ListRow key={a.id} first={i === 0} boxed chevron={false}
                    title={a.is_default ? T('useDefaultAccount') : a.label}
                    note={a.logged_in ? a.detail : T('notSignedIn')}
                    onPress={a.logged_in || a.is_default ? () => onAccount(key || null) : undefined}
                    right={mark(key === accountValue)} />
                );
              })}
            </Group>
          )}
          <View style={{ gap: 6 }}>
            <SectionHeader kind="mark" title={T('permMode')} style={{ paddingHorizontal: 4 }} />
            <Segments value={perm} onChange={(p) => void onPerm(p)}
              segments={cat.perm_modes.map((p) => ({ key: p, label: p }))} />
            {prefs.faceIdBypass && cat.perm_modes.includes('bypass') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                <Icon name="face" size={15} color={t.ink3} />
                <Text style={{ fontSize: 12, color: t.ink3 }}>{T('faceIdForBypass')}</Text>
              </View>
            )}
          </View>
        </>
      )}
      {!editingDefaults && (
        <ListRow first title={T('moreSettings')}
          onPress={() => close(() => router.push({ pathname: '/chat-settings', params: { id } }))} />
      )}
    </ScrollView>
  );
}
