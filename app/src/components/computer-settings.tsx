import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStore, useT } from '../store';
import { client } from '../ws';
import { ARCHIVE_CHOICES, archiveLabel } from '../archive';
import type { Key } from '../i18n';
import type { UpdateStatus } from '../protocol';
import { Group, ListRow, RowButton } from './divan';
import { Text } from './text';
import { useTokens } from '../theme';
import { alert, measure, openMenu } from './overlay';
import { tilde } from './pickers';
import { freshCwd } from '../fresh-chat';

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

/** What belongs to the computer this phone is holding, under its card on the
 *  Computers tab: where new chats open, when quiet ones are archived, whether
 *  its Divan is up to date, and what it is. All of it is kept on the computer
 *  (config.toml), so the phone and the web panel agree. */
export function ComputerSettings({ onRemove }: { onRemove?: (id: string, name: string) => void }) {
  const T = useT();
  const t = useTokens();
  const { conn, hostInfo, updateStatus, checkUpdate, applyUpdate, refreshHost } = useStore();
  const online = conn === 'online';
  // The computer in front: when it changes, its folders and its archive are read again.
  const held = useStore((s) => s.host?.id);
  const heldName = useStore((s) => s.host?.name) ?? '';
  const [updBusy, setUpdBusy] = useState(false);
  useEffect(() => { if (online) { void refreshHost().catch(() => {}); const t = setInterval(() => void refreshHost().catch(() => {}), 30000); return () => clearInterval(t); } }, [online, refreshHost]);
  // Ask the computer where it stands the moment this is open. `refresh` makes
  // it talk to GitHub, which is why it happens here and not on a timer.
  useEffect(() => { if (online) void checkUpdate(true).catch(() => {}); }, [online, checkUpdate]);
  const err = (e: any) => alert(T('error'), e.message);
  const pickFrom = async (ref: React.RefObject<View | null>, items: { value: string; label: string }[],
                          now: string | null, onPick: (v: string) => void) => {
    const anchor = await measure(ref);
    openMenu({ anchor, align: 'right', items: items.map((o) => ({ label: o.label, checked: o.value === now, onPress: () => onPick(o.value) })) });
  };

  // Where new chats open: the computer's answer, so the web panel's New chat
  // opens there too. The first root, then every folder it lists.
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);
  const setDefaultCwd = useStore((s) => s.setDefaultCwd);
  useEffect(() => { if (online) void loadProjects().catch(() => {}); }, [online, held, loadProjects]);
  const folderRef = React.useRef<View>(null);
  const folderNow = hostInfo?.default_cwd_chosen ? freshCwd(hostInfo) : '';
  const firstRoot = hostInfo?.roots?.[0];
  const folderChoices = [
    { value: '', label: firstRoot ? `${T('stFirstRoot')} · ${tilde(firstRoot)}` : T('stFirstRoot') },
    ...(projects ?? []).map((p) => ({ value: p.path, label: tilde(p.path) })),
  ];

  // How long a chat may be quiet before the computer archives it.
  const [archiveH, setArchiveH] = useState<number | null>(hostInfo?.auto_archive_h ?? null);
  useEffect(() => { if (hostInfo?.auto_archive_h != null) setArchiveH(hostInfo.auto_archive_h); }, [hostInfo?.auto_archive_h]);
  const archiveRef = React.useRef<View>(null);
  useEffect(() => {
    if (!online) return;
    client.call<{ hours: number }>('chat.autoarchive', {}).then((r) => setArchiveH(r.hours)).catch(() => {});
  }, [online, held]);
  const setArchive = (hours: number) => {
    client.call<{ hours: number }>('chat.autoarchive', { hours }).then((r) => setArchiveH(r.hours)).catch(err);
  };
  const archiveChoices = [...new Set([...ARCHIVE_CHOICES, ...(archiveH == null ? [] : [archiveH])])]
    .sort((a, b) => a - b).map((h) => ({ value: String(h), label: archiveLabel(h, T) }));

  if (!hostInfo) return null;
  const name = hostInfo.name?.replace('.local', '') ?? '';
  return (
    <>
    <Group label={T('sgThisComputer', { name })}>
      <View ref={folderRef} collapsable={false}>
        <ListRow first boxed title={T('stDefaultFolder')} note={T('stDefaultFolderNote')}
          meta={freshCwd(hostInfo) ? tilde(freshCwd(hostInfo)!) : '–'}
          onPress={online ? () => void pickFrom(folderRef, folderChoices, folderNow ?? '',
            (v) => void setDefaultCwd(v || null).catch(err)) : undefined} />
      </View>
      <View ref={archiveRef} collapsable={false}>
        <ListRow boxed title={T('autoArchive')} note={T('autoArchiveNote')} noteLines={2}
          meta={archiveH == null ? '–' : archiveLabel(archiveH, T)} monoMeta={false}
          onPress={online ? () => void pickFrom(archiveRef, archiveChoices, archiveH == null ? null : String(archiveH),
            (v) => setArchive(Number(v))) : undefined} />
      </View>
      {!!updateStatus?.repo && (
        <Software status={updateStatus} busy={updBusy} onUpdate={async () => {
          setUpdBusy(true);
          const r = await applyUpdate();
          setUpdBusy(false);
          if (!r.ok && r.error) alert(T('software'), T('updFailed', { e: r.error }));
        }} />
      )}
      <ListRow boxed chevron={false} title={T('stAbout')}
        note={[T('stAboutNote', { os: `${hostInfo.os} ${hostInfo.os_version}`, v: hostInfo.daemon_version,
                                   up: uptime(hostInfo.uptime_s), n: String(hostInfo.active_sessions) }),
               ...hostInfo.roots.map(tilde)].join('\n')}
        noteMono noteLines={1 + hostInfo.roots.length} />
    </Group>
    {/* The one destructive thing, as a button under the card with the sentence
        that says what it costs beside it. */}
    {!!onRemove && !!held && (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
        <RowButton face="danger" label={T('revokeDevice')} onPress={() => onRemove(held, heldName)} />
        <Text style={{ flex: 1, fontSize: 12, lineHeight: 12 * 1.4, color: t.ink3 }}>{T('sgRevokeNote')}</Text>
      </View>
    )}
    </>
  );
}

/** Where this computer's checkout stands against main, and the one button that
 *  moves it: one row, and a second only when something is in the way or
 *  waiting. */
function Software({ status, busy, onUpdate }: { status: UpdateStatus; busy: boolean; onUpdate: () => void }) {
  const T = useT();
  const behind = status.behind ?? 0;
  // "already up to date" cannot be a blocker here — we are behind.
  const blocking = (status.blockers ?? []).filter((b) => b !== 'already up to date');
  const local = `${status.local?.commit ?? '–'}${status.local?.branch ? ` · ${status.local.branch}` : ''}`
    + ` · ${T(status.auto ? 'autoOn' : 'autoOff')}`;
  const why = blocking.map((b) => (BLOCKER[b] ? T(BLOCKER[b]) : b)).join(' · ');
  return (
    <>
      <ListRow boxed chevron={false} title={T('software')} note={local} noteMono
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
    </>
  );
}
