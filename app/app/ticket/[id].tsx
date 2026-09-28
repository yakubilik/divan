import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { useQueue, useRun } from '../../src/queue';
import { LOCALE, type Key } from '../../src/i18n';
import { em, useColors } from '../../src/theme';
import { BackBar, Dot, EmptyState, Icon, Spinner, Text, TextInput } from '../../src/components/ui';
import { AssistantText, ToolCard, UserBubble } from '../../src/components/chat';
import { tone } from '../../src/components/ticket';
import { answerable, around, conversation, hasDetails, marks, noteHint, runStartedAt,
         STATUS_KEY, VOICE_KEY, type Msg, type Voice } from '../../src/tickets';
import type { RunSilence, Turn } from '../../src/transcript';
import type { Ticket } from '../../src/protocol';

/** One ticket, opened.
 *
 *  It used to open as a report: the goal under a heading, the criteria under
 *  another, what it was waiting for under a third. Everything was there and none
 *  of it asked anything, so the answer never came. This is the same ticket read
 *  as the conversation it always was — what was asked for, what came back, and
 *  at the end the question, in the words a person would use. The desktop panel
 *  opens a ticket the same way, out of the same four fields, through its own
 *  copy of the reading (web/src/lib/ustabasi.ts): one language each, and the
 *  two agree line for line, so a change to one is a change owed to the other.
 *
 *  And now the part that was never here: what the agent is doing *right now*.
 *  Every run writes the model's own stream to a file — what it says, what it
 *  thinks, every tool it calls — and none of it reached the phone, so a ticket
 *  that had been working for three hours read exactly like one that had been
 *  working for three minutes. It is in the middle of the sequence, where it
 *  happened: what was said before the run began, then the run as it is written,
 *  then whatever has been said since. It appends while the page is open, and it
 *  only ever scrolls the reader who is already at the bottom.
 *
 *  The paperwork — the card's criteria, the verifier's per-criterion marks, the
 *  steps it has been through — is on the other page, behind the (i) on the
 *  card. What is left behind `Details` here is the short of it.
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
  const go = useNavGuard();
  const T = useT();
  const c = useColors();
  const { tickets, state } = useQueue();
  const run = useRun(ticketId);
  const noteTicket = useStore((s) => s.noteTicket);
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kbVisible, setKbVisible] = useState(false);
  /** What has been said from here but has not come back from the queue yet. The
   *  wall re-reads every eight seconds; until it does, a note that vanished on
   *  being sent reads as a note that was not sent. */
  const [pending, setPending] = useState<{ id: string; ts: number; text: string }[]>([]);

  const scroller = useRef<ScrollView>(null);
  /** Whether the end is what is being read. The queue is re-read every few
   *  seconds, and a note arriving while somebody is halfway up a long report
   *  must not drag them back down to the bottom of it — the same thing the chat
   *  timeline learned not to do. */
  const stick = useRef(true);

  const t = useMemo(() => tickets.find((x) => x.id === ticketId) ?? null, [tickets, ticketId]);
  const msgs = useMemo(() => (t ? conversation(t, T) : []), [t, T]);
  // The run's own log has no clock in it — it is a stream of blocks, and the
  // queue writes the time beside it in its events instead. What that gives is
  // the one fact that puts it in the sequence: everything in it happened after
  // the step that started it.
  const shown = useMemo(() => around(msgs, t ? runStartedAt(t) : null), [msgs, t]);
  // A note the queue has taken is in the conversation already; the copy shown
  // before it got there has to give way rather than stand next to it.
  const said = useMemo(() => new Set((t?.notes ?? []).map((n) => (n.text || '').trim())), [t?.notes]);
  const mine = pending.filter((p) => !said.has(p.text));

  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', () => setKbVisible(true));
    const b = Keyboard.addListener('keyboardWillHide', () => setKbVisible(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !t) return;
    const local = { id: `local-${Date.now()}`, ts: Date.now() / 1000, text };
    // Answering is asking to be shown the answer, wherever the reading had got to.
    stick.current = true;
    setPending((p) => [...p, local]);
    setDraft('');
    setBusy(true);
    setErr(null);
    try {
      await noteTicket(t.id, text);
    } catch (e: any) {
      // A note the queue refused is not in the conversation, whatever the screen
      // said for a second.
      setPending((p) => p.filter((x) => x.id !== local.id));
      setDraft(text);
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
  const asking = answerable(t.status);
  const composerBottom = kbVisible ? 8 : Math.max(insets.bottom - 4, 10);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}>
      {/* The header a chat has, saying which ticket this is instead of which
          folder: its colour, its number, its title, and where the loop got to. */}
      <View style={{ paddingTop: insets.top + 2, paddingHorizontal: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
                     borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable accessibilityLabel={T('back')} onPress={() => router.back()} hitSlop={6}
          style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
          <Icon name="chevron_left" size={26} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
            <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '600', letterSpacing: em(16, -0.01) }}>{t.title}</Text>
          </View>
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: asking ? ph.color : c.faint }}>
            {T(STATUS_KEY[t.status] ?? 'tsQueued')} · {T('ticketRound', { stage: t.stage, round: t.round })}
            {run.live ? ` · ${T('runLive')}` : ''}
          </Text>
        </View>
        {/* The other half of the ticket. `replace`, not `push`: the two pages
            are one ticket seen twice, and Back leads to the wall from either. */}
        <Pressable accessibilityRole="button" accessibilityLabel={T('ticketAbout')}
          onPress={() => go(() => router.replace(`/ticket-about/${t.id}`))} hitSlop={8}
          style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
                                   pressed && { opacity: 0.45 }]}>
          <Icon name="info" size={20} color={c.faint} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }}
        scrollEventThrottle={64}
        // The end of the conversation is the part that matters: on opening,
        // where the question is, and again after every answer. Hung off the
        // content rather than off a render, because a message that has just
        // been added has no height yet at the point the render finishes.
        onContentSizeChange={() => { if (stick.current) scroller.current?.scrollToEnd({ animated: false }); }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 18 }}>
        {shown.before.map((m) => <Row key={m.id} m={m} asking={asking} tint={ph.tint} />)}
        <Run run={run} />
        {shown.after.map((m) => <Row key={m.id} m={m} asking={asking} tint={ph.tint} />)}
        {mine.map((p) => (
          <View key={p.id} style={{ gap: 4 }}>
            <Who from="you" ts={p.ts} right />
            <UserBubble text={p.text} />
          </View>
        ))}
        {hasDetails(t) && <Details t={t} />}
      </ScrollView>

      {/* The box. It is offered whatever the ticket is doing, because a note is
          always allowed; the line under it says what sending will actually do,
          which is the one thing that changes with the state. */}
      <View style={{ paddingHorizontal: 10, paddingBottom: composerBottom, gap: 6 }}>
        {!!err && <Text style={{ fontSize: 12.5, color: c.danger, paddingHorizontal: 6 }}>{err}</Text>}
        <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 26, padding: 8,
                       flexDirection: 'row', alignItems: 'flex-end', gap: 6, boxShadow: c.shadow.card }}>
          <TextInput value={draft} onChangeText={setDraft} multiline editable={!busy}
            placeholder={T('ticketAnswerBox', { id: t.id })}
            numberOfLines={Platform.OS === 'web' ? 1 : undefined}
            style={{ flex: 1, fontSize: 15, paddingVertical: 4, paddingHorizontal: 8, minHeight: 26, maxHeight: 160 }} />
          <Pressable accessibilityLabel={T('send')} onPress={() => void send()} disabled={!draft.trim() || busy}
            style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                     // Still the send colour while the note is in flight: the
                     // draft is already gone by then, and a white spinner on the
                     // quiet fill is a spinner nobody can see.
                     backgroundColor: draft.trim() || busy ? c.accent : c.fill }}>
            {busy ? <Spinner size={14} color="#FFFFFF" track="rgba(255,255,255,.35)" />
                  : <Icon name="arrow_upward" size={20} weight={500} color={draft.trim() ? '#FFFFFF' : c.faint} />}
          </Pressable>
        </View>
        <Text mono style={{ fontSize: 11, color: c.faint, paddingHorizontal: 6 }}>{T(noteHint(t.status))}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

/** When a message was said. The day is in it because a ticket runs for days, and
 *  "14:02" on its own is a lie by omission on the second morning. */
function when(ts: number, T: ReturnType<typeof useT>): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (new Date().toDateString() === d.toDateString()) return T('ticketToday', { time });
  return `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} ${time}`;
}

const VOICE_TONE: Record<Voice, (c: ReturnType<typeof useColors>) => string> = {
  you: (c) => c.muted, worker: (c) => c.ink, verifier: (c) => c.ok,
  triage: (c) => c.warn, supervisor: (c) => c.faint,
};

function Who({ from, ts, right }: { from: Voice; ts: number; right?: boolean }) {
  const T = useT();
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: right ? 'flex-end' : 'flex-start' }}>
      <Text mono style={{ fontSize: 11, color: VOICE_TONE[from](c) }}>{T(VOICE_KEY[from])}</Text>
      <Text mono style={{ fontSize: 11, color: c.faint }}>· {when(ts, T)}</Text>
    </View>
  );
}

/** One message. What a person said is a bubble on the right, the way it is in a
 *  chat; everything the machinery said is plain words on the left. */
function Row({ m, asking, tint }: { m: Msg; asking: boolean; tint: string }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const T = useT();
  if (m.from === 'you') {
    return (
      <View style={{ gap: 4 }}>
        <Who from={m.from} ts={m.ts} right />
        <UserBubble text={m.text} />
      </View>
    );
  }
  // The question at the end of a stopped ticket is the only thing on this
  // screen that wants an answer, and it is washed in the colour the card said
  // so with on the wall.
  const highlit = !!m.tail && asking;
  return (
    <View style={{ gap: 4 }}>
      <Who from={m.from} ts={m.ts} />
      <View style={highlit ? { backgroundColor: tint, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 } : undefined}>
        <AssistantText text={m.text} />
      </View>
      {!!m.more && (
        <View style={{ gap: 8, marginTop: 4 }}>
          {open && <AssistantText text={m.more} />}
          <Pressable onPress={() => setOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4,
                     borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
            <Icon name={open ? 'expand_less' : 'chevron_right'} size={14} color={c.muted} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: c.muted }}>{open ? T('ticketLess') : T('ticketMore')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** The card's criteria and what the verifier made of them. Not a message —
 *  nobody said it to anybody — so it sits at the end, closed.
 *
 *  The marks come from `marks()`, the same reading the (i) page uses, which
 *  matches a finding to the criterion it is about by its text. This fold used
 *  to do it by position on the grounds that it was only a summary: a verdict
 *  answering four of nine points put its fourth cross on the ninth sentence,
 *  one tap from the page that had already been fixed. A summary of a wrong
 *  answer is a wrong answer. */
function Details({ t }: { t: Ticket }) {
  const T = useT();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const n = t.done_criteria.length;
  const judged = useMemo(() => marks(t.done_criteria || [], t.verdict), [t.done_criteria, t.verdict]);
  return (
    <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12 }}>
        <Icon name={open ? 'expand_less' : 'chevron_right'} size={15} color={c.faint} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: c.muted }}>{T('ticketDetails')}</Text>
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.faint, flexShrink: 1 }}>
          {n === 1 ? T('ticketOneCriterion') : T('ticketCriteria', { n })}
          {t.verdict?.verdict ? ` · ${t.verdict.verdict}` : ''}
        </Text>
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, padding: 12, gap: 9 }}>
          {t.done_criteria.map((crit, i) => {
            const m = judged[i];
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ width: 16, paddingTop: 2, alignItems: 'center' }}>
                  {m ? <Icon name={m.met ? 'check' : 'close'} size={14} color={m.met ? c.ok : c.warn} />
                     : <Text mono style={{ fontSize: 11, color: c.faint }}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: c.text2 }}>{crit}</Text>
                  {m && !m.met && !!m.detail && (
                    <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: c.muted }}>{m.detail}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** What the agent on this ticket is printing, drawn the way a chat draws it.
 *
 *  No new visual language: a sentence is `AssistantText`, a tool call is the
 *  `ToolCard` a chat already uses, and the run's own last line is a rule with a
 *  word on it. What is different is only that nobody typed any of it — it is
 *  one side of a conversation, which is what a run is.
 *
 *  Every silence gets a sentence rather than a spinner. A ticket nobody has
 *  started, a run whose directory has been cleared away, a computer whose
 *  daemon predates this screen, a computer with no queue at all: each of those
 *  is a thing to say once, and each of them was a spinner that never stopped in
 *  some earlier version of this. */
function Run({ run }: { run: ReturnType<typeof useRun> }) {
  const T = useT();
  const c = useColors();

  if (run.silence) return <RunSilent why={run.silence} />;
  if (run.loading && !run.turns.length) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Spinner size={12} />
        <Text mono style={{ fontSize: 11, color: c.faint }}>{T('wsStarting')}</Text>
      </View>
    );
  }
  if (!run.turns.length) return null;

  return (
    <View style={{ gap: 16 }}>
      {run.jumped && (
        <Text mono style={{ fontSize: 11, color: c.faint, textAlign: 'center' }}>{T('runJumped')}</Text>
      )}
      {run.turns.map((turn) => <RunTurn key={turn.id} turn={turn} />)}
      {run.live && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Spinner size={11} color={c.ink} />
          <Text mono style={{ fontSize: 11, color: c.muted }}>{T('runLive')}</Text>
        </View>
      )}
    </View>
  );
}

function RunTurn({ turn }: { turn: Turn }) {
  const T = useT();
  const c = useColors();
  if (turn.kind === 'say') return <AssistantText text={turn.text} />;
  if (turn.kind === 'thought') {
    return (
      <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: c.muted, fontStyle: 'italic' }}>
        {turn.text}
      </Text>
    );
  }
  if (turn.kind === 'did') {
    return (
      <ToolCard tool={turn.tool} input={{ ...turn.input, description: turn.summary }}
        result={turn.output == null ? undefined : { output: turn.output, is_error: !!turn.failed }} />
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      <Text mono style={{ fontSize: 11, color: turn.failed ? c.danger : c.faint }}>
        {T(turn.failed ? 'runEndedBadly' : 'runEnded')}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
    </View>
  );
}

/** The six ways there is nothing to read, each with words of its own. The key
 *  type is what keeps them honest: a renamed string is a compiler error here
 *  rather than a screen showing the name of a variable. */
const SILENCE: Record<Exclude<RunSilence, null>, { title: Key; body: Key }> = {
  neverRun: { title: 'runNothing', body: 'runNothingBody' },
  noLog: { title: 'runNoLog', body: 'runNoLogBody' },
  noTicket: { title: 'ticketGone', body: 'ticketGoneBody' },
  noQueue: { title: 'queueNone', body: 'runNoQueueBody' },
  oldHost: { title: 'runOldHost', body: 'runOldHostBody' },
  offline: { title: 'queueUnreachable', body: 'hintOffline' },
};

function RunSilent({ why }: { why: Exclude<RunSilence, null> }) {
  const T = useT();
  const c = useColors();
  const words = SILENCE[why];
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: 12, padding: 12, gap: 3 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted }}>{T(words.title)}</Text>
      <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: c.faint }}>{T(words.body)}</Text>
    </View>
  );
}
