import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Group, ListRow, Switch } from '../src/components/divan';
import { MachineTabs, PageHead, UnderTab } from '../src/components/machine';
import { Shell } from '../src/components/shell';
import { composerProvider, withDefault, workingAccount } from '../src/compose';
import { launchHostId } from '../src/launch';
import { permissionFor } from '../src/permissions';
import { Text } from '../src/components/text';
import { alert, measure, openMenu } from '../src/components/overlay';

/** Machine › Settings: what a new chat starts as, and this phone — then the
 *  pages nobody opens every day, as rows at the foot.
 *
 *  What belongs to one computer (its folder, its archive, its software) is
 *  under that computer's card on the Computers tab; the sign-ins are the
 *  Accounts tab. This page used to hold all of it, eight groups deep, and the
 *  thing being looked for could not be found (Yakup, 7 Nov 2026). */
export default function Settings() {
  const router = useRouter();
  const T = useT();
  const t = useTokens();
  const { accounts, hosts, activeHostId, defaults, prefs, device, setPrefs, setDevicePrefs, authenticate, pushToken, catalog } = useStore();
  const setDefaults = useStore((s) => s.setDefaults);

  async function toggleFaceId(key: 'faceIdLaunch' | 'faceIdBypass', v: boolean) {
    if (!v) { const ok = await authenticate(T('authToDisable')); if (!ok) return; }
    await setPrefs({ [key]: v });
  }
  const err = (e: any) => alert(T('error'), e.message);
  const pickFrom = async (ref: React.RefObject<View | null>, items: { value: string; label: string }[],
                          now: string | null, onPick: (v: string) => void) => {
    const anchor = await measure(ref);
    openMenu({ anchor, align: 'right', items: items.map((o) => ({ label: o.label, checked: o.value === now, onPress: () => onPick(o.value) })) });
  };

  // What the Composer's chips open with (HANDOVER §5), and where that lasting
  // answer is changed: the sign-in and the model of the tool it opens chats on.
  const chipTool = composerProvider(catalog, defaults);
  const chipModels = catalog?.[chipTool]?.models ?? [];
  const chipPd = defaults.byProvider?.[chipTool];
  const chipModel = [chipPd?.model, defaults.model].find((m) => m && chipModels.some((x) => x.id === m)) ?? chipModels[0]?.id ?? null;
  const chipAccounts = accounts.filter((a) => a.provider === chipTool && a.logged_in)
    .map((a) => ({ value: a.is_default ? '' : a.id, label: a.is_default ? T('stOwnAccount') : a.label }));
  const chipAccount = workingAccount(accounts, chipTool, chipPd?.account_id ?? '');
  const accountRef = React.useRef<View>(null);
  const launchRef = React.useRef<View>(null);
  const modelRef = React.useRef<View>(null);
  const launchHost = launchHostId(hosts, prefs.launchHost, activeHostId);
  const openDefaults = () => router.push({ pathname: '/model-sheet', params: { defaults: '1' } });

  return (
    <Shell place="machine">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 40, gap: 10 }}>
        <MachineTabs here="settings" />
        <PageHead title={T('settings')} style={{ marginTop: 6, marginBottom: 2 }} />

        <Group label={T('stNewChats')}>
          {hosts.length > 1 && (
            <View ref={launchRef} collapsable={false}>
              <ListRow first boxed title={T('stLaunchHost')} note={T('stLaunchHostNote')} monoMeta={false}
                meta={hosts.find((h) => h.id === launchHost)?.name ?? '–'}
                onPress={() => void pickFrom(launchRef, hosts.map((h) => ({ value: h.id, label: h.name })), launchHost,
                  (v) => void setPrefs({ launchHost: v }))} />
            </View>
          )}
          <View ref={accountRef} collapsable={false}>
            <ListRow first={hosts.length <= 1} boxed title={T('stDefaultAccount')} note={T('stDefaultsChips')} monoMeta={false}
              meta={chipAccounts.find((a) => a.value === chipAccount)?.label ?? (chipAccount || T('stOwnAccount'))}
              onPress={() => void pickFrom(accountRef, chipAccounts, chipAccount,
                (v) => void setDefaults(withDefault(defaults, chipTool, { account_id: v })))} />
          </View>
          <View ref={modelRef} collapsable={false}>
            <ListRow boxed title={T('stDefaultModel')}
              meta={chipModels.find((m) => m.id === chipModel)?.label ?? chipModel ?? T('stNoModel')}
              onPress={() => void pickFrom(modelRef, chipModels.map((m) => ({ value: m.id, label: m.label || m.id })), chipModel,
                (v) => void setDefaults(withDefault(defaults, chipTool, { model: v })))} />
          </View>
          <ListRow boxed title={T('stToolPerm')} monoMeta={false}
            meta={`${defaults.provider === 'codex' ? 'Codex' : 'Claude'} · ${permissionFor(defaults.provider, catalog?.[defaults.provider], defaults)}`}
            onPress={openDefaults} />
        </Group>

        <Group label={T('sgThisPhone')}>
          <ListRow first boxed chevron={false} title={T('faceIdLaunch')}
            right={<Switch label={T('faceIdLaunch')} value={prefs.faceIdLaunch} onChange={(v) => void toggleFaceId('faceIdLaunch', v)} />} />
          <ListRow boxed chevron={false} title={T('faceIdBypass')} note={T('sgBypassNote')}
            right={<Switch label={T('faceIdBypass')} value={prefs.faceIdBypass} onChange={(v) => void toggleFaceId('faceIdBypass', v)} />} />
          <ListRow boxed chevron={false} title={T('pushApproval')}
            right={<Switch label={T('pushApproval')} value={device?.push_approval ?? true}
              onChange={(v) => void setDevicePrefs({ push_approval: v }).catch(err)} />} />
          <ListRow boxed chevron={false} title={T('pushDone')}
            right={<Switch label={T('pushDone')} value={device?.push_done ?? true}
              onChange={(v) => void setDevicePrefs({ push_done: v }).catch(err)} />} />
        </Group>
        {/* Said only when it is wrong: a phone that gets its pushes needs no line. */}
        {!pushToken && (
          <Text style={{ fontSize: 12, lineHeight: 12 * 1.4, color: t.ink3, paddingHorizontal: 4 }}>{T('pushNo')}</Text>
        )}

        <UnderTab here="settings" style={{ marginTop: 8 }} />

        {/* Only a development build has the design system's own screen. */}
        {__DEV__ && (
          <Group label={T('sgDev')}>
            <ListRow first boxed title={T('divanParts')} note={T('divanPartsNote')}
              onPress={() => router.push('/divan-gallery')} />
          </Group>
        )}
      </ScrollView>
    </Shell>
  );
}
