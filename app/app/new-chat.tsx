import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Button, Label, Rule, Segmented } from '../src/components/ui';
import { alert, prompt } from '../src/components/overlay';
import { FolderRadios, GroupChips } from '../src/components/pickers';
import { Sheet, SheetBar, useSheet } from '../src/components/sheet';
import type { Provider } from '../src/protocol';

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
  const loadProjects = useStore((st) => st.loadProjects);
  const createChat = useStore((st) => st.createChat);
  const createGroup = useStore((st) => st.createGroup);
  const setDefaults = useStore((st) => st.setDefaults);
  const prefs = useStore((st) => st.prefs);
  const authenticate = useStore((st) => st.authenticate);
  const [provider, setProvider] = useState<Provider>(defaults.provider);
  const [model, setModel] = useState(defaults.model);
  const [effort, setEffort] = useState<string | null>(defaults.effort);
  const [perm, setPerm] = useState(defaults.perm_mode);
  const [cwd, setCwd] = useState<string | null>(defaults.cwd);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadProjects().catch(() => {}); }, [loadProjects]);
  const cat = catalog?.[provider];
  useEffect(() => {
    if (!cat) return;
    if (!cat.models.some((m) => m.id === model)) setModel(cat.models[0].id);
    if (effort && !cat.efforts.includes(effort)) setEffort(cat.efforts[0] ?? null);
    if (!cat.perm_modes.includes(perm)) setPerm(cat.perm_modes[0]);
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const efforts: string[] = (cat?.models.find((m: any) => m.id === model) as any)?.efforts ?? cat?.efforts ?? [];

  const effectiveCwd = cwd || projects[0]?.path || null;

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
      const chat = await createChat({ provider, model, effort: effort ?? undefined, perm_mode: perm, cwd: effectiveCwd ?? undefined, group_id: groupId ?? undefined, account_id: defaults.byProvider?.[provider]?.account_id ?? undefined } as any);
      void setDefaults({ provider, model, effort: effort ?? 'high', perm_mode: perm, cwd: effectiveCwd });
      close(() => router.push(`/chat/${chat.id}`));
    } catch (e: any) {
      alert(T('couldNotStart'), e.message);
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <SheetBar title={T('newChat')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 12, flexGrow: 1 }}>
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
        <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 6 }}>
          <Label>{T('folder')}</Label>
          <FolderRadios value={effectiveCwd} projects={projects} loading={!projectsLoaded} onChange={setCwd} />
          <Rule style={{ marginVertical: 6 }} />
          <Label>{T('group')}</Label>
          <GroupChips value={groupId} groups={groups} onChange={setGroupId} onNew={newGroup} />
        </View>
        <View style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: insets.bottom + 6 }}>
          <Button title={T('startChat')} onPress={() => void start()} disabled={busy || !cat || !effectiveCwd} />
        </View>
      </ScrollView>
    </View>
  );
}
