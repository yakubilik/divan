import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_PERM, useStore, useT } from '../src/store';
import { PLACE_ROUTE } from '../src/shell';
import { useColors } from '../src/theme';
import { Button, Card, Icon, Label, Segmented, Text, TextInput, Toggle } from '../src/components/ui';
import { alert, measure, openMenu, prompt } from '../src/components/overlay';
import { shortCwd, tilde } from '../src/components/pickers';
import { Sheet, SheetBar, useSheet } from '../src/components/sheet';
import type { Provider } from '../src/protocol';

export default function ChatSettings() {
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore((st) => st.chats[id!]);
  const catalog = useStore((st) => st.catalog);
  const projects = useStore((st) => st.projects);
  const groups = useStore((st) => st.groups);
  const loadProjects = useStore((st) => st.loadProjects);
  const updateChat = useStore((st) => st.updateChat);
  const deleteChat = useStore((st) => st.deleteChat);
  const createGroup = useStore((st) => st.createGroup);
  const prefs = useStore((st) => st.prefs);
  const authenticate = useStore((st) => st.authenticate);
  const setDefaults = useStore((st) => st.setDefaults);
  const [provider, setProvider] = useState<Provider>(chat?.provider ?? 'claude');
  const cat = catalog?.[provider] ?? null;
  const [title, setTitle] = useState(chat?.title ?? '');
  const [model, setModel] = useState(chat?.model ?? '');
  const [effort, setEffort] = useState<string | null>(chat?.effort ?? null);
  const [perm, setPerm] = useState(chat?.perm_mode ?? DEFAULT_PERM);
  const [cwd, setCwd] = useState<string | null>(chat?.cwd ?? null);
  const [groupId, setGroupId] = useState<string | null>(chat?.group_id ?? null);
  const [maxTurns, setMaxTurns] = useState(chat?.max_turns ? String(chat.max_turns) : '');
  const [budget, setBudget] = useState(chat?.max_budget_usd ? chat.max_budget_usd.toFixed(2) : '');
  const [saving, setSaving] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pool = useStore((st) => st.pool);
  const [pinned, setPinned] = useState(!!chat?.pool_pinned);
  const folderRow = useRef<View>(null);
  const groupRow = useRef<View>(null);

  useEffect(() => { void loadProjects().catch(() => {}); }, [loadProjects]);
  useEffect(() => {
    if (!cat || provider === chat?.provider) return;
    setModel(cat.models[0].id); setEffort(cat.efforts[0] ?? null); setPerm(cat.perm_modes[0]);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!chat) return null;
  const efforts: string[] = (cat?.models.find((m: any) => m.id === model) as any)?.efforts ?? cat?.efforts ?? [];

  async function choosePerm(p: string) {
    if (p === 'bypass' && prefs.faceIdBypass) {
      const ok = await authenticate(T('bypassAuth'));
      if (!ok) return;
    }
    setPerm(p);
  }

  async function save() {
    setSaving(true);
    try {
      await updateChat(chat!.id, {
        provider, model, effort, perm_mode: perm, cwd: cwd ?? undefined, group_id: groupId,
        title: title.trim().slice(0, 60) || chat!.title,
        max_turns: maxTurns.trim() ? Number(maxTurns) : null,
        max_budget_usd: budget.trim() ? Number(budget.replace('$', '')) : null,
        pool_pinned: pinned ? 1 : 0,
      } as any);
      void setDefaults({ provider, model, effort: effort ?? 'high', perm_mode: perm, cwd: cwd ?? undefined });
      close();
    } catch (e: any) { alert(T('couldNotSave'), e.message); }
    finally { setSaving(false); }
  }
  function remove() {
    alert(T('deleteChat'), T('deleteChatBody'), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('delete'), style: 'destructive', onPress: async () => { await deleteChat(chat!.id); router.dismissAll(); router.replace(PLACE_ROUTE.chat); } },
    ]);
  }

  async function pickFolder() {
    const anchor = await measure(folderRow);
    openMenu({ anchor, align: 'right', width: 260, items: projects.length
      ? projects.map((p) => ({ label: tilde(p.path), checked: p.path === cwd, onPress: () => setCwd(p.path) }))
      : [{ kind: 'cancel', label: projectsLoaded ? T('noFolders') : T('wStarting') }] });
  }
  async function pickGroup() {
    const anchor = await measure(groupRow);
    openMenu({ anchor, align: 'right', width: 240, items: [
      { label: T('none'), checked: groupId === null, onPress: () => setGroupId(null) },
      ...groups.map((g) => ({ label: g.name, checked: g.id === groupId, onPress: () => setGroupId(g.id) })),
      { kind: 'divider' },
      { label: T('newGroupAction'), icon: 'add', onPress: () => prompt({
          title: T('newGroupTitle'), placeholder: T('groupName'), confirm: T('create'), cancel: T('cancel'),
          submit: async (n) => { if (!n.trim()) return T('groupNameEmpty'); const g = await createGroup(n.trim().slice(0, 60)); setGroupId(g.id); },
        }) },
    ] });
  }

  return (
    <View style={{ flex: 1 }}>
      <SheetBar title={T('chatSettings')} action={T('save')} onAction={() => void save()} border={scrolled} />
      <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" scrollEventThrottle={32}
        onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 4)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 6, gap: 12, flexGrow: 1 }}>
        <View style={{ gap: 6 }}>
          <Label>{T('titleLabel')}</Label>
          <TextInput value={title} onChangeText={setTitle} placeholder={T('chatName')}
            style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 15 }} />
        </View>
        <View style={{ gap: 6 }}>
          <Label>{T('tool')}</Label>
          <Segmented options={['claude', 'codex'] as Provider[]} value={provider} onChange={setProvider} labels={{ claude: 'Claude', codex: 'Codex' }} />
        </View>
        {cat && (
          <>
            <View style={{ gap: 6 }}>
              <Label>{T('model')}</Label>
              <Segmented options={cat.models.map((m) => m.id)} value={model} onChange={setModel}
                labels={Object.fromEntries(cat.models.map((m) => [m.id, m.label]))} />
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
            </View>
          </>
        )}
        <Card>
          <Pressable ref={folderRow} onPress={() => void pickFolder()}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
            <Text style={{ flex: 1, fontSize: 15 }}>{T('folder')}</Text>
            <Text mono numberOfLines={1} style={{ fontSize: 12, color: c.muted, flexShrink: 1 }}>{shortCwd(cwd)}</Text>
            <Icon name="chevron_right" size={18} color={c.faint} />
          </Pressable>
          <Pressable ref={groupRow} onPress={() => void pickGroup()}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14 }, pressed && { backgroundColor: c.fill }]}>
            <Text style={{ flex: 1, fontSize: 15 }}>{T('group')}</Text>
            <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted, flexShrink: 1 }}>{groups.find((g) => g.id === groupId)?.name ?? T('none')}</Text>
            <Icon name="chevron_right" size={18} color={c.faint} />
          </Pressable>
        </Card>

        <View style={{ gap: 6 }}>
          <Label style={{ paddingTop: 10 }}>{T('limits')}</Label>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Text style={{ flex: 1, fontSize: 15 }}>{T('maxTurns')}</Text>
              <NumberPill value={maxTurns} onChange={setMaxTurns} placeholder="∞" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, opacity: provider === 'claude' ? 1 : 0.5 }}>
              <Text style={{ flex: 1, fontSize: 15 }}>{T('maxBudget')}</Text>
              <NumberPill value={budget ? (budget.startsWith('$') ? budget : `$${budget}`) : ''} onChange={(v) => setBudget(v.replace('$', ''))} placeholder="∞" decimal editable={provider === 'claude'} />
            </View>
          </Card>
          <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('budgetClaudeOnly')}</Text>
          {pool?.enabled && (
            <>
              <Label style={{ paddingTop: 10 }}>{T('poolSection')}</Label>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 15 }}>{T('poolChatPin')}</Text>
                  <Text style={{ fontSize: 12, color: c.muted }}>{T('poolChatPinHint')}</Text>
                </View>
                <Toggle value={pinned} onChange={setPinned} />
              </Card>
            </>
          )}
          {/* The two ids in full, because the reason to want one is always
              somewhere else: `claude --resume <session>` in a terminal, a
              database row, a bug report. Truncated to eight characters they
              were only ever decoration. */}
          <Label style={{ paddingTop: 10 }}>{T('idsSection')}</Label>
          <Card>
            <CopyRow label={T('chatId')} value={chat.id} />
            <CopyRow label={T('sessionId')} value={chat.provider_session_id} last />
          </Card>
          <Text mono style={{ fontSize: 11.5, color: c.muted, paddingTop: 12, paddingHorizontal: 4 }}>
            {T('totalCost', { cost: chat.total_cost_usd.toFixed(2) })}
          </Text>
        </View>
        <View style={{ marginTop: 'auto', paddingTop: 24, gap: 10 }}>
          <Button title={T('save')} onPress={() => void save()} disabled={saving} />
          <Pressable onPress={remove} style={({ pressed }) => [{ padding: 12, alignItems: 'center' }, pressed && { opacity: 0.6 }]}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: c.danger }}>{T('deleteChat')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/** An id, in full, that copies itself when tapped.
 *
 *  Wrapping rather than truncating: a session id you cannot read all of is a
 *  session id you have to go and find somewhere else, which is the thing this
 *  row exists to save. */
function CopyRow({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  const c = useColors();
  const T = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Pressable
      onPress={() => void copy()} disabled={!value}
      style={({ pressed }) => [{ gap: 4, paddingVertical: 11, paddingHorizontal: 14 },
                               !last && { borderBottomWidth: 1, borderBottomColor: c.line },
                               pressed && !!value && { backgroundColor: c.fill }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, color: c.muted }}>{label}</Text>
        <Text style={{ fontSize: 12, color: copied ? c.accent : c.faint }}>
          {value ? (copied ? T('welCopied') : T('welCopy')) : T('notYet')}
        </Text>
      </View>
      {!!value && <Text mono selectable style={{ fontSize: 12.5 }}>{value}</Text>}
    </Pressable>
  );
}

/** A number inside a quiet pill, right-aligned, edited in place. Defined out
 *  here so it is not a new component on every keystroke. */
function NumberPill({ value, onChange, placeholder, decimal, editable = true }: { value: string; onChange: (v: string) => void; placeholder: string; decimal?: boolean; editable?: boolean }) {
  const c = useColors();
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} mono keyboardType={decimal ? 'decimal-pad' : 'number-pad'} editable={editable}
      style={{ fontSize: 14, backgroundColor: c.fill, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, textAlign: 'right',
               // sized to what it holds: JetBrains Mono is 0.6 em a glyph
               width: 20 + Math.max(2, (value || placeholder).length) * 8.4 }} />
  );
}
