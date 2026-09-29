import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import type { Key } from '../src/i18n';
import type { UpdateStatus } from '../src/protocol';
import { Card, Dot, Icon, IconLine, Label, Row, SmallButton, Text, Toggle } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { LargeTitlePage } from '../src/components/page';
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

function Software({ status, busy, onUpdate }: { status: UpdateStatus; busy: boolean; onUpdate: () => void }) {
  const T = useT();
  const c = useColors();
  const behind = status.behind ?? 0;
  // "already up to date" cannot be a blocker here — we are behind.
  const blocking = (status.blockers ?? []).filter((b) => b !== 'already up to date');
  const local = `${status.local?.commit ?? '–'}${status.local?.branch ? ` · ${status.local.branch}` : ''}`;
  const foot = `${status.auto ? T('autoOn') : T('autoOff')} · ${T('dirtyFiles', { n: String(status.local?.dirty_files ?? 0) })}`;
  return (
    <Card style={{ paddingVertical: 12, paddingHorizontal: 14, gap: behind > 0 && !blocking.length ? 8 : 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text mono style={{ fontSize: 12 }}>{local}</Text>
        <Text mono style={{ fontSize: 12, color: behind > 0 ? c.warn : c.ok }}>{behind > 0 ? T('behindN', { n: String(behind) }) : T('upToDate')}</Text>
      </View>
      {behind > 0 && blocking.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="block" size={16} color={c.muted} />
          <Text style={{ fontSize: 13, color: c.muted, flex: 1 }}>{T('cantUpdate', { why: blocking.map((b) => (BLOCKER[b] ? T(BLOCKER[b]) : b)).join(' · ') })}</Text>
        </View>
      ) : behind > 0 && !!status.remote?.subject ? (
        <Text style={{ fontSize: 13, color: c.muted, lineHeight: 13 * 1.4 }}>{T('latest', { s: status.remote.subject })}</Text>
      ) : null}
      {behind > 0 && !blocking.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ fontSize: 12, color: c.faint, flexShrink: 1 }}>{foot}</Text>
          <SmallButton title={busy ? T('updating') : T('updateNow')} onPress={onUpdate} disabled={busy} padH={14} padV={8} />
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: c.faint }}>{foot}</Text>
      )}
    </Card>
  );
}

function ToggleRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const c = useColors();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 }, !last && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
      <Text style={{ flex: 1, fontSize: 15 }}>{label}</Text>
      <Toggle value={value} onChange={onChange} />
    </View>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const c = useColors();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 14 }, !last && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
      <Text style={{ flex: 1, fontSize: 14 }}>{label}</Text>
      <Text mono style={{ fontSize: 12, color: c.muted, textAlign: 'right', lineHeight: value.includes('\n') ? 19.2 : undefined }}>{value}</Text>
    </View>
  );
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export default function Settings() {
  const router = useRouter();
  const T = useT();
  const c = useColors();
  const pool = useStore((s) => s.pool);
  const { accounts, hosts, activeHostId, hostInfo, conn, defaults, prefs, device, setPrefs, setDevicePrefs, switchHost, removeHost, authenticate, pushToken, refreshHost, catalog, updateStatus, checkUpdate, applyUpdate } = useStore();
  const [updBusy, setUpdBusy] = useState(false);
  const accountSummary = accounts.length
    ? `${accounts.filter((a) => a.logged_in).length}/${accounts.length}`
    : undefined;
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
  const err = (e: any) => alert(T('error'), e.message);

  return (
    <LargeTitlePage title={T('settings')} contentStyle={{ paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: 16, gap: 6 }}>
        <Label>{T('computers')}</Label>
        <Card>
          {hosts.map((h) => {
            const active = h.id === activeHostId;
            const meta = active && hostInfo
              ? `${h.host}:${h.port} · claude ${short(hostInfo.versions.claude)} · codex ${short(hostInfo.versions.codex)}`
              : `${h.host}:${h.port}${active ? ` · ${conn === 'online' ? T('online') : T(conn === 'connecting' ? 'connecting' : 'offline')}` : ` · ${T('offline')}`}`;
            return (
              <Pressable key={h.id} onPress={() => !active && switchHost(h.id)} onLongPress={() => confirmRemove(h.id, h.name)}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
                <Dot color={active ? (online ? c.ok : conn === 'connecting' ? c.warn : c.lineStrong) : c.lineStrong} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 15, fontWeight: '500' }}>{(active && hostInfo?.name?.replace('.local', '')) || h.name}</Text>
                  <Text mono style={{ fontSize: 11, color: c.muted }}>{meta}</Text>
                </View>
                {busyHost === h.id ? <Text style={{ color: c.muted }}>…</Text> : active ? <Icon name="check" size={18} /> : null}
              </Pressable>
            );
          })}
          <Pressable onPress={() => router.push({ pathname: '/pair', params: { add: '1' } })}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 14 }, pressed && { backgroundColor: c.fill }]}>
            <IconLine name="add" size={18} />
            <Text style={{ fontSize: 15, fontWeight: '500' }}>{T('addComputer')}</Text>
          </Pressable>
        </Card>

        {!!updateStatus?.repo && (
          <>
            <Label style={{ paddingTop: 12 }}>{T('software')}</Label>
            <Software status={updateStatus} busy={updBusy} onUpdate={async () => {
              setUpdBusy(true);
              const r = await applyUpdate();
              setUpdBusy(false);
              if (!r.ok && r.error) alert(T('software'), T('updFailed', { e: r.error }));
            }} />
          </>
        )}

        <Label style={{ paddingTop: 12 }}>{T('accounts')}</Label>
        <Card>
          <Row label={T('accounts')} value={accountSummary} mono valueSize={13} onPress={() => router.push('/accounts')} />
          <Row label={T('pool')} value={pool?.enabled ? T('on') : T('off')} onPress={() => router.push('/pool')} last />
        </Card>

        <Label style={{ paddingTop: 12 }}>{T('defaults')}</Label>
        <Card>
          <Row label={T('toolRow')} value={defaults.provider === 'codex' ? 'Codex' : 'Claude'} onPress={openDefaults} />
          <Row label={T('modelRow')} value={[modelLabel, defaults.effort].filter(Boolean).join(' · ')} mono onPress={openDefaults} />
          <Row label={T('permRow')} value={defaults.perm_mode} mono onPress={openDefaults} last />
        </Card>

        <Label style={{ paddingTop: 12 }}>{T('security')}</Label>
        <Card>
          <ToggleRow label={T('faceIdLaunch')} value={prefs.faceIdLaunch} onChange={(v) => void toggleFaceId('faceIdLaunch', v)} />
          <ToggleRow label={T('faceIdBypass')} value={prefs.faceIdBypass} onChange={(v) => void toggleFaceId('faceIdBypass', v)} />
          <Pressable onPress={() => activeHostId && confirmRemove(activeHostId, hosts.find((h) => h.id === activeHostId)?.name ?? '')}
            style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 14 }, pressed && { backgroundColor: c.fill }]}>
            <Text style={{ fontSize: 15, fontWeight: '500', color: c.danger }}>{T('revokeDevice')}</Text>
          </Pressable>
        </Card>

        <Label style={{ paddingTop: 12 }}>{T('notifications')}</Label>
        <Card>
          <ToggleRow label={T('pushApproval')} value={device?.push_approval ?? true} onChange={(v) => void setDevicePrefs({ push_approval: v }).catch(err)} />
          <ToggleRow label={T('pushDone')} value={device?.push_done ?? true} onChange={(v) => void setDevicePrefs({ push_done: v }).catch(err)} last />
        </Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 }}>
          {pushToken ? <Icon name="check" size={14} color={c.ok} /> : <Icon name="info" size={16} color={c.faint} />}
          <Text style={{ fontSize: 12, color: c.muted, flex: 1 }}>{pushToken ? T('pushOk') : T('pushNo')}</Text>
        </View>

        {/* Only a development build has anything to say here, and only one
            thing: the design system's own screen, where every part the Divan
            screens are made of is drawn beside the frame it came from. */}
        {__DEV__ && (
          <>
            <Label style={{ paddingTop: 12 }}>{T('devSection')}</Label>
            <Card>
              <Row label={T('divanParts')} value={T('divanPartsNote')} onPress={() => router.push('/divan-gallery')} last />
            </Card>
          </>
        )}

        {hostInfo && (
          <>
            <Label style={{ paddingTop: 12 }}>{T('host')}</Label>
            <Card>
              <InfoRow label={T('system')} value={`${hostInfo.os} ${hostInfo.os_version}`} />
              <InfoRow label={T('daemon')} value={hostInfo.daemon_version} />
              <InfoRow label={T('uptime')} value={uptime(hostInfo.uptime_s)} />
              <InfoRow label={T('activeSessions')} value={String(hostInfo.active_sessions)} />
              <InfoRow label={T('roots')} value={hostInfo.roots.map(tilde).join('\n')} last />
            </Card>
            <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('hostRefresh')}</Text>
          </>
        )}
      </View>
    </LargeTitlePage>
  );
}
