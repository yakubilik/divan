import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import type { Key } from '../src/i18n';
import type { UpdateStatus } from '../src/protocol';
import { Group, ListRow, RowButton, StatusDot, Switch } from '../src/components/divan';
import { MachineTabs, PageHead, UnderTab } from '../src/components/machine';
import { Shell } from '../src/components/shell';
import { composerProvider, withDefault } from '../src/compose';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { alert, measure, openMenu } from '../src/components/overlay';
import { tilde } from '../src/components/pickers';

/** Why this computer cannot follow main, in the reader's words. A blocker is
 *  shown instead of a dead button: the reason it cannot update is the useful
 *  part, and "uncommitted changes here" is something only the person reading
 *  it can resolve. */
const BLOCKER: Record<string, Key> = {
  'not a git checkout': 'updNoRepo', 'already up to date': 'updClean',
  'uncommitted changes': 'updDirty', 'unpushed commits': 'updAhead',
  'a turn is running': 'updBusy',
};

function uptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

/** Everything about this phone and the computer it is holding, in the short
 *  groups Web15 W18 puts them in.
 *
 *  W18 is the desktop's own Settings and is what this is drawn from: a card per
 *  group with its name in mono lowercase at the top, a row per setting with one
 *  grey line under the title saying what it does, and the control at the end of
 *  the row — a switch, a value with a chevron, or the small button W16 puts
 *  there. Nothing on the page is coloured except the one dot that says which
 *  computer is answering and the one button that takes something away. */
export default function Settings() {
  const router = useRouter();
  const T = useT();
  const t = useTokens();
  const pool = useStore((s) => s.pool);
  const { accounts, hosts, activeHostId, hostInfo, conn, defaults, prefs, device, setPrefs, setDevicePrefs, switchHost, removeHost, authenticate, pushToken, refreshHost, catalog, updateStatus, checkUpdate, applyUpdate } = useStore();
  const [updBusy, setUpdBusy] = useState(false);
  useEffect(() => { if (conn === 'online') { void refreshHost().catch(() => {}); const t = setInterval(() => void refreshHost().catch(() => {}), 30000); return () => clearInterval(t); } }, [conn, refreshHost]);
  // Ask the computer where it stands the moment this screen is open. `refresh`
  // makes it talk to GitHub, which is why it happens here and not on a timer.
  useEffect(() => { if (conn === 'online') void checkUpdate(true).catch(() => {}); }, [conn, checkUpdate]);
  const short = (v: string | null | undefined) => { const m = (v ?? '').match(/\d+\.\d+/); return m ? m[0] : '–'; };
  const modelLabel = catalog?.[defaults.provider]?.models.find((m) => m.id === defaults.model)?.label ?? defaults.model;
  const online = conn === 'online';
  const [busyHost, setBusyHost] = useState<string | null>(null);

  async function toggleFaceId(key: 'faceIdLaunch' | 'faceIdBypass', v: boolean) {
    if (!v) { const ok = await authenticate(T('authToDisable')); if (!ok) return; }
    await setPrefs({ [key]: v });
  }

  function confirmRemove(id: string, name: string) {
    alert(T('removeHost'), T('removeHostBody', { name }), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('remove'), style: 'destructive', onPress: async () => {
        setBusyHost(id);
        try { await removeHost(id); } finally { setBusyHost(null); }
        if (useStore.getState().hosts.length === 0) { router.dismissAll(); router.replace('/pair'); }
      } },
    ]);
  }
  const openDefaults = () => router.push({ pathname: '/model-sheet', params: { defaults: '1' } });
  const setDefaults = useStore((s) => s.setDefaults);
  // What the Composer's chips open with (HANDOVER §5), and where that lasting
  // answer is changed: the sign-in and the model of the tool it opens chats on.
  const chipTool = composerProvider(catalog, defaults);
  const chipModels = catalog?.[chipTool]?.models ?? [];
  const chipPd = defaults.byProvider?.[chipTool];
  const chipModel = [chipPd?.model, defaults.model].find((m) => m && chipModels.some((x) => x.id === m)) ?? chipModels[0]?.id ?? null;
  const chipAccounts = accounts.filter((a) => a.provider === chipTool && (a.logged_in || a.is_default))
    .map((a) => ({ value: a.is_default ? '' : a.id, label: a.is_default ? T('stOwnAccount') : a.label }));
  const chipAccount = chipPd?.account_id ?? '';
  const accountRef = React.useRef<View>(null);
  const modelRef = React.useRef<View>(null);
  const pickFrom = async (ref: React.RefObject<View | null>, items: { value: string; label: string }[],
                          now: string | null, onPick: (v: string) => void) => {
    const anchor = await measure(ref);
    openMenu({ anchor, align: 'right', items: items.map((o) => ({ label: o.label, checked: o.value === now, onPress: () => onPick(o.value) })) });
  };
  const err = (e: any) => alert(T('error'), e.message);

  return (
    <Shell place="machine">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 40, gap: 10 }}>
        <MachineTabs here="settings" />
        <PageHead title={T('settings')} style={{ marginTop: 6, marginBottom: 2 }} />

        <Group label={T('stNewChats')}>
          <View ref={accountRef} collapsable={false}>
            <ListRow first boxed title={T('stDefaultAccount')} note={T('stDefaultsChips')} monoMeta={false}
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
        </Group>

        <Group label={T('sgComputers')}>
          {hosts.map((h, i) => {
            const active = h.id === activeHostId;
            const meta = busyHost === h.id ? T('hostRemoving')
              : active ? (online ? T('online') : T(conn === 'connecting' ? 'connecting' : 'offline'))
              : T('offline');
            const detail = active && hostInfo
              ? `${h.host}:${h.port} · claude ${short(hostInfo.versions.claude)} · codex ${short(hostInfo.versions.codex)}`
              : `${h.host}:${h.port}`;
            return (
              <ListRow key={h.id} first={i === 0} boxed chevron={!active}
                onPress={() => !active && switchHost(h.id)} onLongPress={() => confirmRemove(h.id, h.name)}
                lead={<StatusDot state={active && online ? 'running' : active && conn === 'connecting' ? 'asking' : 'quiet'}
                  hollow={!active} />}
                title={(active && hostInfo?.name?.replace('.local', '')) || h.name}
                note={detail} noteMono
                meta={meta} tone={active && online ? 'run' : 'ink3'}
                right={active && busyHost !== h.id ? <Icon name="check" size={18} color={t.ink} /> : undefined} />
            );
          })}
          <ListRow first={hosts.length === 0} boxed chevron={false} icon="add" title={T('addComputer')}
            onPress={() => router.push({ pathname: '/pair', params: { add: '1' } })} />
        </Group>

        {!!updateStatus?.repo && (
          <Software status={updateStatus} busy={updBusy} onUpdate={async () => {
            setUpdBusy(true);
            const r = await applyUpdate();
            setUpdBusy(false);
            if (!r.ok && r.error) alert(T('software'), T('updFailed', { e: r.error }));
          }} />
        )}

        <Group label={T('sgAccounts')}>
          <ListRow first boxed title={T('accounts')} note={T('mAccountsNote')}
            meta={accounts.length ? `${accounts.filter((a) => a.logged_in).length}/${accounts.length}` : null}
            onPress={() => router.push('/accounts')} />
          <ListRow boxed title={T('pool')} note={T('mPoolNote')}
            meta={T(pool?.enabled ? 'on' : 'off')} monoMeta={false}
            onPress={() => router.push('/pool')} />
        </Group>

        <Group label={T('sgDefaults')}>
          <ListRow first boxed title={T('toolRow')} note={T('sgDefaultsNote')}
            meta={defaults.provider === 'codex' ? 'Codex' : 'Claude'} monoMeta={false} onPress={openDefaults} />
          <ListRow boxed title={T('modelRow')}
            meta={[modelLabel, defaults.effort].filter(Boolean).join(' · ')} onPress={openDefaults} />
          <ListRow boxed title={T('permRow')} meta={defaults.perm_mode} onPress={openDefaults} />
        </Group>

        <Group label={T('sgSecurity')}>
          <ListRow first boxed chevron={false} title={T('faceIdLaunch')}
            right={<Switch label={T('faceIdLaunch')} value={prefs.faceIdLaunch} onChange={(v) => void toggleFaceId('faceIdLaunch', v)} />} />
          <ListRow boxed chevron={false} title={T('faceIdBypass')} note={T('sgBypassNote')}
            right={<Switch label={T('faceIdBypass')} value={prefs.faceIdBypass} onChange={(v) => void toggleFaceId('faceIdBypass', v)} />} />
        </Group>
        {/* W16's own foot: the one destructive thing, as a button under the card
            with the sentence that says what it costs beside it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
          <RowButton face="danger" label={T('revokeDevice')}
            onPress={() => activeHostId && confirmRemove(activeHostId, hosts.find((h) => h.id === activeHostId)?.name ?? '')} />
          <Text style={{ flex: 1, fontSize: 12, lineHeight: 12 * 1.4, color: t.ink3 }}>{T('sgRevokeNote')}</Text>
        </View>

        <Group label={T('sgNotifications')}>
          <ListRow first boxed chevron={false} title={T('pushApproval')}
            right={<Switch label={T('pushApproval')} value={device?.push_approval ?? true}
              onChange={(v) => void setDevicePrefs({ push_approval: v }).catch(err)} />} />
          <ListRow boxed chevron={false} title={T('pushDone')}
            right={<Switch label={T('pushDone')} value={device?.push_done ?? true}
              onChange={(v) => void setDevicePrefs({ push_done: v }).catch(err)} />} />
        </Group>
        <Text style={{ fontSize: 12, lineHeight: 12 * 1.4, color: t.ink3, paddingHorizontal: 4 }}>
          {pushToken ? T('pushOk') : T('pushNo')}
        </Text>

        {/* Only a development build has anything to say here, and only one
            thing: the design system's own screen, where every part the Divan
            screens are made of is drawn beside the frame it came from. */}
        {__DEV__ && (
          <Group label={T('sgDev')}>
            <ListRow first boxed title={T('divanParts')} note={T('divanPartsNote')}
              onPress={() => router.push('/divan-gallery')} />
          </Group>
        )}

        {!!hostInfo && (
          <>
            <Group label={T('sgHost')}>
              <ListRow first boxed chevron={false} title={T('system')}
                meta={`${hostInfo.os} ${hostInfo.os_version}`} />
              <ListRow boxed chevron={false} title={T('daemon')} meta={hostInfo.daemon_version} />
              <ListRow boxed chevron={false} title={T('uptime')} meta={uptime(hostInfo.uptime_s)} />
              <ListRow boxed chevron={false} title={T('activeSessions')} meta={String(hostInfo.active_sessions)} />
              <ListRow boxed chevron={false} title={T('roots')}
                note={hostInfo.roots.map(tilde).join('\n')} noteMono
                noteLines={Math.max(1, hostInfo.roots.length)} />
            </Group>
            <Text style={{ fontSize: 12, color: t.ink3, paddingHorizontal: 4 }}>{T('hostRefresh')}</Text>
          </>
        )}
        <UnderTab here="settings" style={{ marginTop: 8 }} />
      </ScrollView>
    </Shell>
  );
}

/** Where this computer's checkout stands against main, and the one button that
 *  moves it. Three rows: what it is on, what is in the way or what is waiting,
 *  and whether it follows main by itself. */
function Software({ status, busy, onUpdate }: { status: UpdateStatus; busy: boolean; onUpdate: () => void }) {
  const T = useT();
  const behind = status.behind ?? 0;
  // "already up to date" cannot be a blocker here — we are behind.
  const blocking = (status.blockers ?? []).filter((b) => b !== 'already up to date');
  const local = `${status.local?.commit ?? '–'}${status.local?.branch ? ` · ${status.local.branch}` : ''}`;
  const why = blocking.map((b) => (BLOCKER[b] ? T(BLOCKER[b]) : b)).join(' · ');
  return (
    <Group label={T('sgSoftware')}>
      <ListRow first boxed chevron={false} title={T('sgCheckout')} note={local} noteMono
        meta={behind > 0 ? T('behindN', { n: String(behind) }) : T('upToDate')}
        tone={behind > 0 ? 'amber' : 'run'}
        right={behind > 0 && !blocking.length
          ? <RowButton face="ink" label={busy ? T('updating') : T('updateNow')} busy={busy} onPress={onUpdate} />
          : undefined} />
      {behind > 0 && (blocking.length > 0 || !!status.remote?.subject) && (
        <ListRow boxed chevron={false} icon={blocking.length ? 'block' : 'download'}
          title={T(blocking.length ? 'sgBlocked' : 'sgWaiting')}
          note={blocking.length ? T('cantUpdate', { why }) : T('latest', { s: status.remote?.subject ?? '' })}
          noteLines={3} />
      )}
      <ListRow boxed chevron={false} title={T('sgAuto')}
        note={T('dirtyFiles', { n: String(status.local?.dirty_files ?? 0) })}
        meta={T(status.auto ? 'autoOn' : 'autoOff')} monoMeta={false} />
    </Group>
  );
}
