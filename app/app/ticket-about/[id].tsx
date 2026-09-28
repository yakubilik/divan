import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { useNow, useQueue } from '../../src/queue';
import { LOCALE } from '../../src/i18n';
import { useColors } from '../../src/theme';
import { BackBar, EmptyState, Icon, Spinner, Text } from '../../src/components/ui';
import { TicketHeader, tone } from '../../src/components/ticket';
import { marks, stepAge, stepLine, stepMark, VOICE_KEY, type StepMark } from '../../src/tickets';
import type { Ticket, TicketStep } from '../../src/protocol';

/** A ticket, read rather than watched.
 *
 *  The chat page next door answers "what is it doing right now". This one
 *  answers the question you ask before that one and could not ask at all: what
 *  step is it on, and how did it get there. The queue knows — it writes an
 *  event every time it hands a ticket to somebody — and none of it reached the
 *  phone, so the only answer on offer was to read two thousand words of the
 *  last verifier report and work it out.
 *
 *  So: the steps as a checklist, each round's worker, check and verifier, each
 *  one ticked, crossed or marked as the one running now — and the running one
 *  saying which stage, which round, how long it has been going, on which model
 *  and account. Then the card's criteria with the verifier's marks against
 *  them, then what was asked for, what it is waiting for, and the notes.
 *
 *  Nothing on it is a guess. There is no percentage and no "4 of 9 done",
 *  because nothing in the queue knows how far along a ticket is: the criteria
 *  are answered once, at the end, by the verifier, and until then the honest
 *  mark against every one of them is none. */
export default function TicketAbout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = Number(id);
  const router = useRouter();
  const go = useNavGuard();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const now = useNow();
  const { tickets, state } = useQueue();
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const t = useMemo(() => tickets.find((x) => x.id === ticketId) ?? null, [tickets, ticketId]);
  const judged = useMemo(() => (t ? marks(t.done_criteria || [], t.verdict) : []), [t]);

  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <BackBar onPress={() => router.back()} />
        {state === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} width={2} /></View>
        ) : state === 'offline' ? (
          <EmptyState icon="cloud_off" title={T('cantConnect', { host: hostName })} body={T('hintOffline')} />
        ) : state === 'noQueue' ? (
          <EmptyState icon="terminal" title={T('queueNone')} body={T('queueNoneBody')} />
        ) : (
          <EmptyState icon="info" title={T('ticketGone')} body={T('ticketGoneBody')} />
        )}
      </View>
    );
  }

  const steps = t.steps || [];
  const notes = [...(t.notes || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 2 }}>
      <TicketHeader t={t} now={now} onBack={() => router.back()}
        right={<Chat onPress={() => go(() => router.replace(`/ticket/${t.id}`))} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16,
                                           paddingBottom: insets.bottom + 28, gap: 22 }}>
        <Section title={T('detailSteps')}>
          {steps.length === 0
            ? <Quiet text={T('detailStepsNone')} />
            : steps.map((s, i) => <Step key={i} s={s} now={now} />)}
        </Section>

        <Section title={T('detailCriteria')}
          aside={t.verdict?.verdict ? T('detailVerdictLine', { round: t.round, verdict: t.verdict.verdict }) : undefined}>
          {(t.done_criteria || []).length === 0
            ? <Quiet text={T('detailCriteriaNone')} />
            : t.done_criteria.map((crit, i) => {
              const m = judged[i];
              return (
                <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
                  <View style={{ width: 16, paddingTop: 2, alignItems: 'center' }}>
                    {m ? <Icon name={m.met ? 'check' : 'close'} size={15} color={m.met ? c.ok : c.warn} />
                       : <Text mono style={{ fontSize: 11, color: c.faint }}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: c.text2 }}>{crit}</Text>
                    {m && !m.met && !!m.detail && (
                      <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: c.muted }}>{m.detail}</Text>
                    )}
                    {!m && <Text mono style={{ fontSize: 11, color: c.faint }}>{T('detailUnjudged')}</Text>}
                  </View>
                </View>
              );
            })}
        </Section>

        {!!(t.goal || '').trim() && (
          <Section title={T('detailAsked')}>
            <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.5, color: c.text2 }}>{t.goal.trim()}</Text>
          </Section>
        )}

        {!!(t.escalation || '').trim() && (
          <Section title={T('detailAsking')} tint={tone(c, t.status).color}>
            <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.5, color: c.text2 }}>{t.escalation.trim()}</Text>
          </Section>
        )}

        {notes.length > 0 && (
          <Section title={T('detailNotes')}
            aside={t.note_count > notes.length ? T('ticketNoteCount', { n: t.note_count }) : undefined}>
            {notes.map((n, i) => (
              <View key={i} style={{ gap: 3 }}>
                <Text mono style={{ fontSize: 11, color: c.faint }}>
                  {T(VOICE_KEY[(n.from || '').toLowerCase() === 'user' ? 'you' : 'worker'])} · {when(n.ts)}
                </Text>
                <Text style={{ fontSize: 13, lineHeight: 13 * 1.5, color: c.text2 }}>{(n.text || '').trim()}</Text>
              </View>
            ))}
          </Section>
        )}

        {!!t.branch && (
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.faint }}>
            {T('detailBranch')} {t.branch}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function when(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} `
    + d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The way back to the chat. The two pages are one ticket seen twice, so this
 *  replaces rather than pushes: Back leads to the wall from either of them
 *  rather than walking between them. */
function Chat({ onPress }: { onPress: () => void }) {
  const T = useT();
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={T('detailOpenChat')} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 32,
                                 paddingHorizontal: 11, borderRadius: 999, backgroundColor: c.fill },
                               pressed && { opacity: 0.55 }]}>
      <Icon name="chat_bubble" size={14} color={c.muted} />
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: c.muted }}>{T('detailOpenChat')}</Text>
    </Pressable>
  );
}

function Section({ title, aside, tint, children }: {
  title: string; aside?: string; tint?: string; children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase',
                       color: tint || c.muted }}>{title}</Text>
        {!!aside && <Text mono numberOfLines={1} style={{ flex: 1, fontSize: 11, color: c.faint }}>{aside}</Text>}
      </View>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function Quiet({ text }: { text: string }) {
  const c = useColors();
  return <Text style={{ fontSize: 13, color: c.faint }}>{text}</Text>;
}

const MARK_ICON: Record<StepMark, string> = {
  done: 'check', crossed: 'close', stopped: 'block', now: 'more_horiz',
};

/** One line of the checklist. The one running now is the only one drawn in ink
 *  and the only one that says whose machine it is on, because that is the line
 *  the page was opened to find. */
function Step({ s, now }: { s: TicketStep; now: number }) {
  const T = useT();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const mark = stepMark(s);
  const colour = mark === 'done' ? c.ok : mark === 'crossed' ? c.warn : mark === 'now' ? c.ink : c.faint;
  const detail = mark === 'now'
    ? [s.model && s.account ? T('detailStepOn', { model: s.model, account: s.account }) : s.model || s.account,
       s.pid ? T('detailStepPid', { pid: s.pid }) : null].filter(Boolean).join(' · ')
    : '';

  return (
    <Pressable onPress={() => s.note && setOpen((o) => !o)} disabled={!s.note}
      style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
      <View style={{ width: 18, paddingTop: 1, alignItems: 'center' }}>
        {mark === 'now' ? <Spinner size={12} color={c.ink} />
                        : <Icon name={MARK_ICON[mark]} size={15} color={colour} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text mono style={{ fontSize: 13, fontWeight: mark === 'now' ? '600' : '400',
                              color: mark === 'now' ? c.ink : c.text2 }}>
            {stepLine(s, T)}
          </Text>
          <Text mono style={{ flex: 1, fontSize: 11, color: c.faint }}>
            {stepAge(s, now, T)}
            {mark === 'now' ? ` · ${T('detailStepNow')}`
              : mark === 'crossed' && s.outcome === 'rejected' ? ` · ${T('detailStepRejected')}`
              : mark === 'stopped' ? ` · ${T('detailStepStopped')}` : ''}
          </Text>
        </View>
        {!!detail && <Text mono style={{ fontSize: 11, color: c.muted }}>{detail}</Text>}
        {!!s.note && (
          <Text numberOfLines={open ? undefined : 1} style={{ fontSize: 12.5, lineHeight: 12.5 * 1.4, color: c.muted }}>
            {s.note}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
