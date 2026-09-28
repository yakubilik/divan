import React, { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../../src/store';
import { useNow, useQueue } from '../../src/queue';
import { em, useColors } from '../../src/theme';
import { BackBar, Button, Dot, EmptyState, Icon, Spinner, Text, TextInput } from '../../src/components/ui';
import { Section, tone } from '../../src/components/ticket';
import { answerable, first, mark, repoName, since, STATUS_KEY } from '../../src/tickets';

/** One opened ticket: what it is for, how far the loop got, what the verifier
 *  made of it — and, on a ticket that stopped to ask, the question in full with a
 *  box under it.
 *
 *  The box is the only write this screen has. A note is not an INSERT: the queue
 *  appends it, clears the escalation and puts the ticket back in front of the
 *  worker, and that sequence belongs to the queue's own CLI, which is what the
 *  daemon runs. So the ticket leaves the red state by itself, and the wall
 *  behind this screen is re-read the moment it does. */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const now = useNow();
  const { tickets, state } = useQueue();
  const noteTicket = useStore((s) => s.noteTicket);
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const t = useMemo(() => tickets.find((x) => x.id === ticketId) ?? null, [tickets, ticketId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !t) return;
    setBusy(true);
    setErr(null);
    try {
      const msg = await noteTicket(t.id, text);
      setSent(msg || T('ticketSend'));
      setDraft('');
    } catch (e: any) {
      setErr(e?.message || T('ticketNoteRefused'));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, t, noteTicket, T]);

  // A ticket can go away while somebody is reading it — cancelled on the
  // computer, or the phone switched to a computer that never had it. Say so
  // rather than drawing an empty page. But only when the computer has actually
  // answered: "not in the queue", "not asked yet" and "not connected" are three
  // different answers, and a notification tapped on a sleeping phone arrives in
  // the middle one on its way to the first.
  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <BackBar onPress={() => router.back()} />
        {state === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Spinner size={22} width={2} /></View>
        ) : state === 'offline' ? (
          <EmptyState icon="cloud_off" title={T('cantConnect', { host: hostName })} body={T('hintOffline')} />
        ) : (
          <EmptyState icon="info" title={T('ticketGone')} body={T('ticketGoneBody')} />
        )}
      </View>
    );
  }

  const ph = tone(c, t.status);
  const wants = answerable(t.status);
  const held = since(t.updated_at ? now - t.updated_at : null, T);
  const repo = repoName(t.repo);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <BackBar onPress={() => router.back()} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 28, paddingHorizontal: 16, gap: 18 }}>
        <View style={{ gap: 8, paddingTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
            <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
            <Text mono style={{ fontSize: 12, color: wants ? ph.color : c.muted }}>{T(STATUS_KEY[t.status] ?? 'tsQueued')}</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '600', lineHeight: 24 * 1.25, letterSpacing: em(24, -0.02) }}>{t.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Text mono style={{ fontSize: 11, color: c.faint }}>{T('ticketRound', { stage: t.stage, round: t.round })}</Text>
            {!!repo && <Text mono style={{ fontSize: 11, color: c.faint }}>· {repo}</Text>}
            {!!t.branch && <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.faint, flexShrink: 1 }}>· {t.branch}</Text>}
            {!!held && <Text mono style={{ fontSize: 11, color: c.faint }}>· {T('ticketInState', { d: held })}</Text>}
          </View>
        </View>

        {/* The question first. On a red ticket nothing else here matters until
            it has been answered. */}
        {wants && !!t.escalation && (
          <View style={{ backgroundColor: ph.tint, borderRadius: 14, padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="warning" size={16} color={ph.color} />
              <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: em(12, 0.06), textTransform: 'uppercase', color: ph.color }}>{T('ticketWaiting')}</Text>
            </View>
            <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.5, color: c.text2 }}>{t.escalation}</Text>
          </View>
        )}

        {wants && (
          <View style={{ gap: 8 }}>
            <TextInput value={draft} onChangeText={setDraft} multiline editable={!busy}
              placeholder={T('ticketNoteHint')}
              style={{ backgroundColor: c.card, borderWidth: 1.5, borderColor: draft.trim() ? c.ink : c.lineStrong, borderRadius: 12,
                       paddingVertical: 11, paddingHorizontal: 12, fontSize: 14, lineHeight: 14 * 1.45, minHeight: 104, textAlignVertical: 'top' }} />
            <Button title={busy ? T('ticketSending') : T('ticketSend')} kind={busy ? 'busy' : 'primary'}
              disabled={!draft.trim()} onPress={() => void send()} />
            {!!err && <Text style={{ fontSize: 13, color: c.danger }}>{err}</Text>}
          </View>
        )}
        {/* What the queue said back, kept after the ticket has left the red
            state — otherwise the send reads as having done nothing. */}
        {!!sent && !err && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={16} color={c.ok} />
            <Text style={{ flex: 1, fontSize: 13, color: c.ok }}>{sent}</Text>
          </View>
        )}

        {!!t.goal && (
          <Section title={T('ticketGoal')}>
            <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.5, color: c.text2 }}>{t.goal}</Text>
          </Section>
        )}

        {t.done_criteria.length > 0 && (
          <Section title={T('ticketDoneWhen')}>
            <View style={{ gap: 9 }}>
              {t.done_criteria.map((crit, i) => {
                const m = mark(t.verdict, i);
                return (
                  <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ width: 16, paddingTop: 2, alignItems: 'center' }}>
                      {m
                        ? <Icon name={m.met ? 'check' : 'close'} size={14} color={m.met ? c.ok : c.warn} />
                        : <Text mono style={{ fontSize: 11, color: c.faint }}>{i + 1}</Text>}
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: c.text2 }}>{crit}</Text>
                      {m && !m.met && !!m.detail && (
                        <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: c.muted }}>{first(m.detail, 400)}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </Section>
        )}

        {/* On a finished ticket the escalation field holds its closing report
            instead of a question, so it is shown under its own heading. */}
        {!wants && !!t.escalation && (
          <Section title={T('ticketLastReport')}>
            <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.5, color: c.text2 }}>{t.escalation}</Text>
          </Section>
        )}

        {t.notes.length > 0 && (
          <Section title={T('ticketNotes')}>
            <View style={{ gap: 8 }}>
              {t.notes.map((n, i) => (
                <View key={i} style={{ backgroundColor: c.fill, borderRadius: 12, padding: 12, gap: 4 }}>
                  <Text mono style={{ fontSize: 11, color: c.faint }}>{n.from} · {since(now - n.ts, T)}</Text>
                  <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: c.text2 }}>{n.text}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
