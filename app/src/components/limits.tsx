import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useStore, useT } from '../store';
import { LOCALE, type Key } from '../i18n';
import { em, useColors, type Palette } from '../theme';
import { Dot, Icon, Text } from './ui';
import { alert, Layer, measure, noteClosed, type Rect } from './overlay';
import type { CliAccount, LimitWindow } from '../protocol';

const NAME: Record<string, Key> = {
  five_hour: 'limFiveHour', seven_day: 'limWeekAll', seven_day_opus: 'limWeekOpus',
  seven_day_sonnet: 'limWeekSonnet', overage: 'limOverage',
};

/** Amber from 60 %, red from 90 %; below that the plain text colour. */
export function tone(u: number, c: Palette): string {
  if (u >= 0.9) return c.danger;
  if (u >= 0.6) return c.warn;
  return c.text2;
}

function resetLabel(ts: number | null, T: ReturnType<typeof useT>): string {
  if (!ts) return '';
  const ms = ts * 1000 - Date.now();
  if (ms <= 0) return T('limResetsNow');
  const h = Math.floor(ms / 3600000);
  if (h < 24) return T('limResetsIn', { h: String(h), m: String(Math.floor((ms % 3600000) / 60000)) });
  const d = new Date(ts * 1000);
  return T('limResetsAt', { when: `${d.toLocaleDateString(LOCALE, { weekday: 'short' })} ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })}` });
}

/** How long ago the tool last measured. Shown because these numbers are only
 *  refreshed while a turn runs: after an idle hour the ring is a memory, not a
 *  reading, and saying so costs one line. */
function ageLabel(at: number | undefined, T: ReturnType<typeof useT>): string {
  if (!at) return '';
  const m = Math.floor((Date.now() / 1000 - at) / 60);
  if (m < 2) return T('limMeasuredNow');
  if (m < 60) return T('limMeasuredM', { m: String(m) });
  return T('limMeasuredH', { h: String(Math.floor(m / 60)) });
}

/** What the chat header wears: the plan being spent, a dot for the
 *  connection, and a ring for how much of the fullest window is gone. The
 *  whole chip is the tap target — a 30 pt ring beside a word is not one, and
 *  the word is the part the eye goes to. Until the tool has reported anything
 *  the ring is drawn empty, which is the difference between "you have used
 *  nothing" and "nobody has measured yet". A provider that never reports keeps
 *  the chip and loses only the ring. */
export function LimitsRing({ chatId, accountId, provider, label, sub, dot, onOpenChange }: {
  chatId?: string; accountId?: string | null; provider?: string; label: string; sub?: string; dot: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const T = useT();
  const c = useColors();
  const all = useStore((s) => s.limits);
  const accounts = useStore((s) => s.accounts);
  const busy = useStore((s) => (chatId ? !!s.busy[chatId] : false));
  const updateChat = useStore((s) => s.updateChat);
  const [open, setOpenState] = useState<Rect | null>(null);
  const setOpen = (r: Rect | null) => { if (!r) noteClosed(); setOpenState(r); onOpenChange?.(!!r); };
  const chip = useRef<View>(null);
  const key = accountId || `default-${provider ?? 'claude'}`;
  // The chip already names the account being spent, so this is where a reader
  // looks to change it. Only sign-ins that can actually run a turn are offered.
  const others = useMemo(
    () => (chatId ? accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default)) : []),
    [accounts, provider, chatId]);

  /** Moving a chat to another account starts a new thread there: a resume id
   *  belongs to one account's transcript store, and the daemon drops it on the
   *  way over. That is a whole conversation's memory, so it is asked first. */
  function switchTo(a: CliAccount) {
    const next = a.is_default ? null : a.id;
    const name = a.is_default ? T('useDefaultAccount') : a.label;
    setOpen(null);
    if ((accountId ?? null) === next) return;
    if (busy) { alert(T('acctSwitch'), T('acctSwitchBusy')); return; }
    alert(T('acctSwitch'), T('acctSwitchBody', { name }), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('acctSwitchGo'), onPress: () => {
          updateChat(chatId!, { account_id: next } as any).catch((e: any) => alert(T('error'), e.message));
        } },
    ]);
  }
  const windows = useMemo(
    () => (all[key] ?? []).filter((w) => typeof w.utilization === 'number')
      .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)),
    [all, key]);
  // Every window of one report is measured at the same instant, so a window
  // lagging the newest reading is one the tool has stopped reporting. A daemon
  // new enough to know that has already dropped it; against an older one the
  // row stays, and this is what stops it from reading as current.
  const newest = useMemo(
    () => windows.reduce((n, w) => Math.max(n, w.at ?? 0), 0), [windows]);
  const reports = !provider || provider === 'claude';

  const top: LimitWindow | undefined = windows[0];
  const pct = Math.max(0, Math.min(1, top?.utilization ?? 0));
  const col = top ? tone(pct, c) : c.faint;
  const r = 13.25, circ = 2 * Math.PI * r;
  const lineOpen = open ? c.lineStrong : c.line;
  // The card lists windows in the order the plan names them, not by how full.
  const ordered = useMemo(() => {
    const order = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];
    return [...windows].sort((a, b) => (order.indexOf(a.window) + 1 || 99) - (order.indexOf(b.window) + 1 || 99));
  }, [windows]);
  const measured = windows.reduce((m, w) => Math.max(m, w.at ?? 0), 0);

  return (
    <>
      <Pressable ref={chip} hitSlop={6}
        onPress={() => void measure(chip).then(setOpen)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: c.card, borderWidth: 1, borderColor: lineOpen, borderRadius: 999,
                 paddingVertical: 4, paddingRight: reports ? 5 : 11, paddingLeft: 11, boxShadow: open ? undefined : c.shadow.pill, maxWidth: 240 }}>
        <Dot color={dot} size={7} />
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>{label}</Text>
        {!!sub && <Text numberOfLines={1} style={{ fontSize: 13, color: c.muted, flexShrink: 1 }}>{sub}</Text>}
        {reports && (
          <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={30} height={30} viewBox="0 0 30 30" style={StyleSheet.absoluteFill}>
              <Circle cx="15" cy="15" r={r} fill="none" stroke={lineOpen} strokeWidth={3.5} />
              {top && <Circle cx="15" cy="15" r={r} fill="none" stroke={col} strokeWidth={3.5}
                strokeDasharray={`${circ * pct} ${circ}`} transform="rotate(-90 15 15)" />}
            </Svg>
            <Text mono style={{ fontSize: 9, fontWeight: '600', color: col }}>{top ? Math.round(pct * 100) : '–'}</Text>
          </View>
        )}
      </Pressable>

      {open && (
      <Layer onRequestClose={() => setOpen(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(null)} />
        {(
          <View style={{ position: 'absolute', top: open.y + open.height + 32, left: 16, right: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong,
                         borderRadius: 16, padding: 16, gap: 14, boxShadow: c.shadow.menu }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '600' }}>{T('limTitle')}</Text>
              {!!measured && <Text mono style={{ fontSize: 11, color: c.faint }}>{ageLabel(measured, T)}</Text>}
            </View>
            {ordered.length === 0 && <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>{T('limNone')}</Text>}
            {ordered.map((w, i) => {
              const p = Math.max(0, Math.min(1, w.utilization ?? 0));
              const t = tone(p, c);
              return (
                <View key={w.window} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13 }}>{NAME[w.window] ? T(NAME[w.window]) : w.window}</Text>
                    <Text mono style={{ fontSize: 13, color: t }}>{Math.round(p * 100)}%</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: c.lineStrong }}>
                    <View style={{ width: `${p * 100}%`, height: '100%', borderRadius: 3, backgroundColor: t }} />
                  </View>
                  {(!!w.resets_at || i === 0 || newest - (w.at ?? 0) > 60) && (
                    <Text style={{ fontSize: 12, color: c.faint }}>
                      {/* When it resets, and how old the reading is — the second
                          on the top row, which is the one the ring draws, and on
                          any row a newer report has stopped mentioning. Those
                          are the two cases where "when" explains the number. */}
                      {w.resets_at ? resetLabel(w.resets_at, T) : ''}
                      {i === 0 || newest - (w.at ?? 0) > 60
                        ? `${w.resets_at ? ' · ' : ''}${ageLabel(w.at, T)}` : ''}
                    </Text>
                  )}
                </View>
              );
            })}
            {others.length > 1 && (
              <>
                <View style={{ height: 1, backgroundColor: c.lineStrong }} />
                <Text mono style={{ fontSize: 11, letterSpacing: em(11, 0.08), textTransform: 'uppercase', color: c.faint }}>{T('acctForChat')}</Text>
                <View style={{ gap: 2 }}>
                  {others.map((a) => {
                    const on = (accountId ?? null) === (a.is_default ? null : a.id);
                    const util = (all[a.id] ?? []).reduce((m, w) => Math.max(m, w.utilization ?? 0), 0);
                    const plan = (a.detail.split(' · ').pop() || '').trim();
                    const extra = [plan, !on && util ? `${Math.round(util * 100)}%` : ''].filter(Boolean).join(' · ');
                    return (
                      <Pressable key={a.id} onPress={() => switchTo(a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, flex: 1, color: on ? c.ink : c.muted }}>
                          {a.is_default ? T('useDefaultAccount') : a.label}
                          {!!extra && <Text style={{ color: c.faint }}> · {extra}</Text>}
                        </Text>
                        {on && <Icon name="check" size={18} weight={400} />}
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 12, color: c.faint, lineHeight: 12 * 1.4 }}>{T('acctSwitchHint')}</Text>
              </>
            )}
          </View>
        )}
      </Layer>
      )}
    </>
  );
}
