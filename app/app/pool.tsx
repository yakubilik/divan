import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useColors, type Palette } from '../src/theme';
import { Card, Icon, Label, Note, Segmented, Text, Toggle } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import { LargeTitlePage } from '../src/components/page';
import type { PoolAccount, Provider } from '../src/protocol';

const PROVIDERS: Provider[] = ['claude', 'codex'];
const NAMES: Record<Provider, string> = { claude: 'Claude', codex: 'Codex' };
const LINES = ['0.9', '0.95', '0.99', '1'];
// The window the five-hour line is stored under; every other window falls
// back to `threshold`, which is what the weekly control edits.
const FIVE_HOUR = 'five_hour';
const RESERVES = ['0.05', '0.1', '0.2'];
const pct = (v: string) => `${Math.round(Number(v) * 100)}%`;

/** Where one sign-in stands, in as few words as the row has room for. */
function standing(a: PoolAccount, T: (k: any, p?: any) => string, c: Palette): { text: string; color: string } {
  if (a.blocked) {
    const back = a.until ? new Date(a.until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    return { text: back ? T('poolBlocked', { time: back }) : T('poolBlockedNoTime'), color: c.muted };
  }
  if (a.spending) return { text: T('poolSpending'), color: c.danger };
  if (a.on_overage) return { text: T('poolOnOverage'), color: c.warn };
  if (a.unknown) return { text: T('poolUnknown'), color: c.faint };
  return { text: T('poolFree', { percent: Math.round((1 - (a.utilization ?? 0)) * 100) }), color: c.ok };
}

export default function PoolScreen() {
  const T = useT();
  const c = useColors();
  const { pool, poolAccounts, conn, loadPool, setPool } = useStore();

  const reload = useCallback(() => {
    if (conn === 'online') void loadPool();
  }, [conn, loadPool]);
  useFocusEffect(reload);
  useEffect(reload, [reload]);

  // Only a tool with a second sign-in has anywhere to move a chat to. One
  // account is not a pool, and saying so beats an order list of one.
  const counts = useMemo(() => Object.fromEntries(PROVIDERS.map((p) => [p, poolAccounts.filter((a) => a.provider === p).length])), [poolAccounts]);

  const save = (patch: any) => setPool(patch).catch((e: any) => alert(T('error'), e.message));

  /** Moving a sign-in up the list. The order is the whole policy — "the next
   *  account" means the next one here — so it is edited where it is read,
   *  one step at a time, rather than behind a drag handle that fights the
   *  scroll view on a phone. */
  const move = (provider: Provider, id: string, by: number) => {
    const ids = poolAccounts.filter((a) => a.provider === provider).map((a) => a.account_id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    save({ order: { ...(pool?.order ?? {}), [provider]: ids } });
  };

  /** One sign-in's own answer on extra usage. Set explicitly rather than
   *  cleared back to the default: "I decided this one" is worth keeping even
   *  when it happens to match what the default says today. */
  const toggleStrict = (a: PoolAccount) =>
    save({ overage_by_account: { ...(pool?.overage_by_account ?? {}),
                                 [a.account_id]: a.strict ? 'account' : 'never' } });

  const on = !!pool?.enabled;
  return (
    <LargeTitlePage title={T('pool')} titleStyle={{ paddingTop: 4, paddingBottom: 14 }}>
      <View style={{ paddingHorizontal: 16, gap: 6 }}>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', flex: 1 }}>{T('poolOn')}</Text>
            <Toggle value={on} onChange={(v) => save({ enabled: v })} disabled={!pool} />
          </View>
          <Text style={{ fontSize: 13, color: c.muted, lineHeight: 13 * 1.45 }}>{T('poolHint')}</Text>
        </Card>
        {PROVIDERS.filter((p) => counts[p] < 2).map((p) => (
          <Note key={p} icon="warning">{T('poolNeedsTwo', { p: NAMES[p] })}</Note>
        ))}

        {on && (
          <>
            <View style={{ gap: 6, paddingTop: 10 }}>
              <Label>{T('poolThreshold5h')}</Label>
              <Segmented options={LINES} labels={Object.fromEntries(LINES.map((v) => [v, pct(v)]))}
                value={String(pool?.thresholds?.[FIVE_HOUR] ?? pool?.threshold ?? 0.95)}
                onChange={(v) => save({ thresholds: { ...(pool?.thresholds ?? {}), [FIVE_HOUR]: Number(v) } })} />
            </View>
            <View style={{ gap: 6, paddingTop: 6 }}>
              <Label>{T('poolThresholdWeek')}</Label>
              <Segmented options={LINES} labels={Object.fromEntries(LINES.map((v) => [v, pct(v)]))}
                value={String(pool?.threshold ?? 0.99)} onChange={(v) => save({ threshold: Number(v) })} />
            </View>
            <View style={{ gap: 6, paddingTop: 6 }}>
              <Label>{T('poolOverage')}</Label>
              <Segmented options={['account', 'never']} labels={{ account: T('poolOverageAccount'), never: T('poolOverageNever') }}
                value={pool?.use_overage ?? 'account'} onChange={(v) => save({ use_overage: v })} />
            </View>
            {/* Only meaningful when we are the thing preventing the spend. With
                overage allowed there is nothing to hold plan back against. */}
            {pool?.use_overage === 'never' && (
              <View style={{ gap: 6, paddingTop: 6 }}>
                <Label>{T('poolReserve')}</Label>
                <Segmented options={RESERVES} labels={Object.fromEntries(RESERVES.map((v) => [v, pct(v)]))}
                  value={String(pool?.reserve ?? 0.1)} onChange={(v) => save({ reserve: Number(v) })} />
                <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('poolReserveHint')}</Text>
              </View>
            )}

            {PROVIDERS.filter((p) => counts[p] > 0).map((provider) => (
              <View key={provider} style={{ gap: 6 }}>
                <Label style={{ paddingTop: 10 }}>{T('poolOrderOf', { p: NAMES[provider] })}</Label>
                <Card>
                  {poolAccounts.filter((a) => a.provider === provider).map((a, i, all) => {
                    const s = standing(a, T, c);
                    const extra = [a.strict ? T('poolStrict') : '', a.strict && a.margin > 0 ? T('poolMargin', { percent: Math.round(a.margin * 100) }) : ''].filter(Boolean);
                    return (
                      <View key={a.account_id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingLeft: 14, paddingRight: 10 },
                        i < all.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                        <Text mono style={{ fontSize: 12, color: c.faint, width: 12 }}>{i + 1}</Text>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500' }}>{a.label}</Text>
                          <Text numberOfLines={1} style={{ fontSize: 12, color: s.color }}>
                            {s.text}{extra.length ? <Text style={{ color: c.faint }}> · {extra.join(' · ')}</Text> : null}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          <Round icon={a.strict ? 'money_off' : 'attach_money'} onPress={() => toggleStrict(a)} />
                          <Round icon="arrow_upward" onPress={() => move(provider, a.account_id, -1)} disabled={i === 0} />
                          <Round icon="arrow_downward" onPress={() => move(provider, a.account_id, 1)} disabled={i === all.length - 1} />
                        </View>
                      </View>
                    );
                  })}
                </Card>
              </View>
            ))}
            <Text style={{ fontSize: 12, color: c.faint, paddingVertical: 4, paddingHorizontal: 4, lineHeight: 12 * 1.45 }}>{T('poolOrderHint')}</Text>
          </>
        )}
      </View>
    </LargeTitlePage>
  );
}

function Round({ icon, onPress, disabled }: { icon: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4}
      style={({ pressed }) => [{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
        pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={17} />
    </Pressable>
  );
}
