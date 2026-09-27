import React from 'react';
import { Pressable, View } from 'react-native';
import { useStore, useT } from '../store';
import { useColors } from '../theme';
import { Card, Icon, ProviderBadge, Radio, Skeleton, Text } from './ui';
import type { CliAccount, Group, Project, Provider } from '../protocol';

/** The accounts a tool can actually run under: the ones signed in, plus the
 *  computer's own login, which is always on offer and is spelled with the
 *  app's own words rather than the computer's (`is_default`). The empty id is
 *  that one — it is "no account of ours", not an account named "". */
export function accountOptions(accounts: CliAccount[], provider: Provider, defaultLabel: string, notSignedIn: string) {
  return accounts
    .filter((a) => a.provider === provider && (a.logged_in || a.is_default))
    .map((a) => ({ id: a.is_default ? '' : a.id,
                   label: a.is_default ? defaultLabel : a.label,
                   hint: a.logged_in ? a.detail : notSignedIn,
                   signedIn: a.logged_in }));
}

/** `cli 1.2.4` out of whatever the tool printed for its version. */
export function cliVersion(v: string | null | undefined): string {
  const m = (v ?? '').match(/\d+(?:\.\d+)+/);
  return m ? `cli ${m[0]}` : 'cli –';
}

/** Two cards, Claude and Codex, the chosen one with an ink border. */
export function ProviderCards({ value, onChange }: { value: Provider; onChange: (p: Provider) => void }) {
  const c = useColors();
  const hostInfo = useStore((s) => s.hostInfo);
  const opts: { id: Provider; label: string; ver: string }[] = [
    { id: 'claude', label: 'Claude', ver: cliVersion(hostInfo?.versions.claude) },
    { id: 'codex', label: 'Codex', ver: cliVersion(hostInfo?.versions.codex) },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {opts.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
                     borderWidth: on ? 1.5 : 1, borderColor: on ? c.ink : c.line }}>
            <ProviderBadge provider={o.id} />
            <View>
              <Text style={{ fontSize: 14, fontWeight: on ? '600' : '500' }}>{o.label}</Text>
              <Text mono style={{ fontSize: 10.5, color: c.muted }}>{o.ver}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A card of choices, one per line, with a check on the chosen one. */
export function OptionCard({ options, value, onChange, mono }: {
  options: { id: string; label: string; hint?: string; muted?: boolean }[]; value: string | null; onChange: (id: string) => void; mono?: boolean;
}) {
  const c = useColors();
  return (
    <Card>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
              i < options.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text mono={mono} style={{ fontSize: mono ? 13.5 : 14, fontWeight: on ? '600' : '400', color: o.muted ? c.faint : c.ink }}>{o.label}</Text>
              {!!o.hint && <Text style={{ fontSize: 12, color: o.muted ? c.faint : c.muted }}>{o.hint}</Text>}
            </View>
            {on && <Icon name="check" size={20} />}
          </Pressable>
        );
      })}
    </Card>
  );
}

/** Folders as radios, for the new-chat sheet. */
export function FolderRadios({ value, projects, onChange, loading }: {
  value: string | null; projects: Project[]; onChange: (p: string) => void; loading?: boolean;
}) {
  const T = useT();
  const c = useColors();
  if (projects.length === 0) {
    // "no folders" is a claim; while the list is on its way it is not true yet
    return loading
      ? <View style={{ paddingVertical: 8 }}><Skeleton width="58%" height={12} /></View>
      : <Text style={{ fontSize: 13, color: c.muted, paddingVertical: 6 }}>{T('noFolders')}</Text>;
  }
  return (
    <View style={{ gap: 6 }}>
      {projects.map((p) => (
        <Pressable key={p.path} onPress={() => onChange(p.path)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <Radio on={p.path === value} />
          <Text mono numberOfLines={1} style={{ fontSize: 13, flex: 1 }}>{tilde(p.path)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Groups as a row of pills, with a pill that makes a new one. */
function GroupPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress}
      style={[{ borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }, on ? { backgroundColor: c.ink, borderWidth: 1, borderColor: c.ink } : { borderWidth: 1, borderColor: c.lineStrong }]}>
      <Text style={{ fontSize: 13, fontWeight: on ? '600' : '400', color: on ? c.onInk : c.text2 }}>{label}</Text>
    </Pressable>
  );
}

export function GroupChips({ value, groups, onChange, onNew }: {
  value: string | null; groups: Group[]; onChange: (g: string | null) => void; onNew: () => void;
}) {
  const T = useT();
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
      <GroupPill label={T('none')} on={value === null} onPress={() => onChange(null)} />
      {groups.map((g) => <GroupPill key={g.id} label={g.name} on={g.id === value} onPress={() => onChange(g.id)} />)}
      <GroupPill label={T('newGroupPill')} on={false} onPress={onNew} />
    </View>
  );
}

export function tilde(p: string | null | undefined): string {
  return (p ?? '').replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~').replace(/\\/g, '/');
}

/** `…/payments/api`, for the chat header. */
export function tailCwd(p: string | null | undefined): string {
  const parts = tilde(p).split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : tilde(p);
}

/** `~/…/payments/api`: the tail of a path is the part that names it. */
export function shortCwd(p: string | null | undefined): string {
  const t = tilde(p);
  const parts = t.split('/').filter(Boolean);
  return parts.length > 3 ? `${t.startsWith('~') ? '~/' : '/'}…/${parts.slice(-2).join('/')}` : t;
}
