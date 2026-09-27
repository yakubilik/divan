import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_PERM, useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Icon, Label, Segmented, Text } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { OptionCard, ProviderCards } from '../src/components/pickers';
import { Sheet, useSheet } from '../src/components/sheet';
import type { Provider, ProviderDefaults } from '../src/protocol';

/** With `id` it edits that chat and applies immediately; without it
 *  (`defaults=1`) it edits the defaults used by the pen button. */
export default function ModelSheet() {
  const router = useRouter();
  const { id, defaults } = useLocalSearchParams<{ id?: string; defaults?: string }>();
  // For a chat it stands tall, with room for the account list; for the
  // defaults it stops lower down, over the settings it came from.
  const forDefaults = defaults === '1' || !id;
  return <Sheet onClose={() => router.back()} top={forDefaults ? 128 : 8}><Body /></Sheet>;
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function Body() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { close } = useSheet();
  const { id, defaults: defaultsMode } = useLocalSearchParams<{ id?: string; defaults?: string }>();
  const editingDefaults = defaultsMode === '1' || !id;
  const chat = useStore((s) => (id ? s.chats[id] : undefined));
  const catalog = useStore((s) => s.catalog);
  const defaults = useStore((s) => s.defaults);
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
  if (!editingDefaults && !chat) return null;

  const accountValue = (editingDefaults ? defaults.byProvider?.[provider]?.account_id : chat?.account_id) ?? '';
  return (
    <ScrollView bounces={false} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>{editingDefaults ? T('defaultsShort') : T('modelTitle')}</Text>
        <Text mono style={{ fontSize: 11, color: c.muted }}>{editingDefaults ? T('forNewChats') : T('appliesNowShort')}</Text>
      </View>
      <ProviderCards value={provider} onChange={onProvider} />
      {cat && (
        <>
          <OptionCard mono options={cat.models.map((m) => ({ id: m.id, label: m.label, hint: capital(m.hint) }))} value={model} onChange={onModel} />
          {efforts.length > 0 && (
            <View style={{ gap: 6 }}>
              <Label>{T('effort')}</Label>
              <Segmented options={efforts} value={effort} onChange={onEffort} labels={{ medium: 'med' }} />
            </View>
          )}
          {/* The default account is chosen on the Accounts screen, where the
              check mark is; here it is only asked for one chat. */}
          {!editingDefaults && accountsFor.length > 1 && (
            <View style={{ gap: 6 }}>
              <Label>{T('accountFor')}</Label>
              <OptionCard
                options={accountsFor.map((a) => ({ id: a.is_default ? '' : a.id,
                  label: a.is_default ? T('useDefaultAccount') : a.label,
                  hint: a.logged_in ? a.detail : T('notSignedIn'), muted: !a.logged_in }))}
                value={accountValue}
                onChange={(v) => {
                  const a = accountsFor.find((x) => (x.is_default ? '' : x.id) === v);
                  if (a && !a.logged_in && !a.is_default) return;
                  onAccount(v || null);
                }} />
            </View>
          )}
          <View style={{ gap: 6 }}>
            <Label>{T('permMode')}</Label>
            <Segmented options={cat.perm_modes} value={perm} onChange={(p) => void onPerm(p)} />
            {prefs.faceIdBypass && cat.perm_modes.includes('bypass') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, paddingHorizontal: 4 }}>
                <Icon name="face" size={15} color={c.muted} />
                <Text style={{ fontSize: 12, color: c.muted }}>{T('faceIdForBypass')}</Text>
              </View>
            )}
          </View>
        </>
      )}
      {!editingDefaults && (
        <Pressable onPress={() => close(() => router.push({ pathname: '/chat-settings', params: { id } }))}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 }, pressed && { opacity: 0.6 }]}>
          <Text style={{ fontSize: 15, fontWeight: '500' }}>{T('moreSettings')}</Text>
          <Icon name="chevron_right" size={18} color={c.faint} />
        </Pressable>
      )}
    </ScrollView>
  );
}
