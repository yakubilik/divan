import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { em, useColors, useTokens, type Palette } from '../theme';
import { useStore, useT } from '../store';
import { useNavGuard } from '../nav';
import { useCard, useDivanView } from '../queue';
import {
  HANDS, SILENCE, STEPS_SHOWN, answered, asking, find, live, saying, sections, side, stamp, trail,
  type Section,
} from '../card';
import { clock, executorKey, type Ago } from '../dashboard';
import { short } from '../compose';
import { status } from '../board';
import type { Key } from '../i18n';
import type { MergedCard } from '../divan';
import type { DivanCardDetail } from '../protocol';
import { Card, EmptyState, Pill, SectionHeader, Tap } from './divan';
import { BackRow } from './waiting';
import { Block, BriefLine, Commands, Criterion, LiveRow, SayBox, TrailRow } from './card';
import { StatusWord } from './board';
import { Shell } from './shell';
import { measure, openMenu } from './overlay';
import { answerable, cardLine, commitCount, first, roundAge, since, STATUS_KEY, stepLine,
         totalAge } from '../tickets';
import { Dot, Icon, Spinner, Text } from './ui';
import type { Ticket, TicketStatus } from '../protocol';

/** The colour a status is read by, in the app's palette rather than the panel's.
 *
 *  The two warm ones mean on this wall what they mean in a chat: the app's red
 *  is "this is waiting for you to say something", which is exactly a blocked
 *  ticket, and clay is a failure. Everything that is merely working is ink, so
 *  that on a wall of twenty cards the eye still goes to the two that need a
 *  person. Blocked and failed say the same word — the ticket is not moving
 *  until he answers — and are told apart by these two colours and by the line
 *  under the title. */
export function tone(c: Palette, status: TicketStatus | string): { color: string; tint: string } {
  switch (status) {
    case 'blocked': return { color: c.accentText, tint: c.accentTint };
    case 'failed': return { color: c.danger, tint: c.dangerBg };
    case 'running': return { color: c.ink, tint: c.fill };
    case 'done': return { color: c.ok, tint: c.okBg };
    default: return { color: c.faint, tint: c.fill };
  }
}

/** The (i), which is the whole reason the card has room for so little.
 *
 *  Its own tap target, a thumb's width from the card's — 40pt of it, hanging
 *  off the right of the title row where nothing else is, with the card's own
 *  press handler stopped at its edge. Everything a card used to carry and could
 *  not read — which pid, which model, which account, which step of which round,
 *  what the verifier made of which criterion — is behind it. */
function About({ onPress, color }: { onPress: () => void; color: string }) {
  const T = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={T('ticketAbout')}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ width: 40, height: 40, marginVertical: -12, marginRight: -10,
                                 alignItems: 'center', justifyContent: 'center' },
                               pressed && { opacity: 0.45 }]}>
      <Icon name="info" size={19} color={color} />
    </Pressable>
  );
}

/** One ticket on the wall.
 *
 *  Four things and no more: whose colour it is and its number; its title; what
 *  is happening, in words; and how long — since it was opened first, then this
 *  round. The pid, the model and the account are not on it. They were, and they
 *  were the widest thing on the card and the only thing on it nobody could act
 *  on; they are behind the (i) now, where somebody looking for them will look.
 *
 *  No percentage and no "3 of 8 done". Nothing in the queue knows how far along
 *  a ticket is — the criteria are answered once, at the end, by the verifier —
 *  so either would be a drawn guess. */
export function TicketCard({ t, now, onPress, onAbout }: {
  t: Ticket; now: number; onPress: () => void; onAbout: () => void;
}) {
  const T = useT();
  const c = useColors();
  const ph = tone(c, t.status);
  const wants = answerable(t.status);
  const round = roundAge(t, now, T);
  const commits = commitCount(t, T);
  const asked = t.ask || t.escalation;
  const line = wants && asked ? first(asked, 180)
                                     : first(cardLine(t), 140) || T('ticketNoEvents');

  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: pressed ? c.fill : c.card, borderWidth: 1, borderColor: wants ? ph.color : c.line,
                                 borderRadius: 14, padding: 14, gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
        <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
        {/* The status, in a word, in its own colour, at the size of something
            meant to be read rather than filed. It used to be grey mono type in
            the far corner, which is where a machine token goes. */}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: ph.color }}>
          {T(STATUS_KEY[t.status] ?? 'tsQueued')}
        </Text>
        <About onPress={onAbout} color={c.faint} />
      </View>
      <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', lineHeight: 15 * 1.3 }}>{t.title}</Text>
      <Text numberOfLines={3} style={{ fontSize: 13, color: wants ? c.text2 : c.muted, lineHeight: 13 * 1.4 }}>{line}</Text>
      {/* How long it has been a ticket, first and on its own: it is the figure
          anybody means by "how long has this been going", and the smaller one
          under it was being read as that. */}
      <Text mono style={{ fontSize: 12, color: c.text2 }}>{totalAge(t, now, T)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {!!round && <Text mono style={{ fontSize: 11, color: c.faint }}>{round}</Text>}
        {!!commits && <Text mono style={{ fontSize: 11, color: c.faint }}>{round ? '· ' : ''}{commits}</Text>}
        {t.note_count > 0 && (
          <Text mono style={{ fontSize: 11, color: c.faint }}>
            {round || commits ? '· ' : ''}{t.note_count === 1 ? T('ticketOneNote') : T('ticketNoteCount', { n: t.note_count })}
          </Text>
        )}
      </View>
      {!!t.git?.subject && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: c.muted }}>{t.git.subject}</Text>
      )}
      {wants && (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 2,
                       backgroundColor: ph.tint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>{T('ticketAnswer')}</Text>
          <Icon name="chevron_right" size={16} color={ph.color} />
        </View>
      )}
    </Pressable>
  );
}

/** The header both of a ticket's pages wear: its colour, its number, its title
 *  and the word for what it is doing. Drawn once so the two pages cannot drift
 *  apart, and so that moving between them does not move anything on screen. */
export function TicketHeader({ t, now, onBack, right }: {
  t: Ticket; now: number; onBack: () => void; right?: React.ReactNode;
}) {
  const T = useT();
  const c = useColors();
  const ph = tone(c, t.status);
  const held = since(now - (t.created_at || now), T);
  return (
    <View style={{ paddingHorizontal: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
                   borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Pressable accessibilityLabel={T('back')} onPress={onBack} hitSlop={6}
        style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
        <Icon name="chevron_left" size={26} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
          <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '600' }}>{t.title}</Text>
        </View>
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: ph.color }}>
          {T(STATUS_KEY[t.status] ?? 'tsQueued')}
          <Text mono style={{ color: c.faint }}> · {stepLine({ stage: t.stage, round: t.round, at: 0 }, T)}
            {held ? ` · ${T('ticketOpen', { d: held })}` : ''}</Text>
        </Text>
      </View>
      {right}
    </View>
  );
}

// ── one ticket on one page (HANDOVER §4.4) ──────────────────────────────────

/** Where a ticket was opened from, as the address carries it, and where Back
 *  leads when there is no screen under this one to go back to (a link opened
 *  cold, a notification). */
export type From = 'waiting' | 'dashboard' | 'project' | 'board' | null;

/** One ticket, on one page: the human face — the status, `project · #no ·
 *  column`, the title and the sentences a person wrote — then, when the agent
 *  is asking, its question in an amber-edged card whose answers are one press
 *  each; then Live, the run's latest steps as a time and a sentence, with the
 *  one line you can say into it; then the Agent face, shut until it is pressed:
 *  Goal, Done when, Test, Files. The side column of the desktop page is under
 *  all of it here: Column, Executor (a menu under it), Machine, Branch, Runs
 *  alone, Opened — and then what has happened to the card.
 *
 *  **No text an agent produced is on the human face.** The question is the one
 *  thing an agent wrote that is open on the page, because it is addressed to
 *  the reader; the brief is behind the Agent face and the run is in Live. The
 *  judgements are `src/card.ts`.
 *
 *  Which parts are open (the Agent face, every step) is in the address, the way
 *  the board keeps its column: a redraw lands on what somebody was reading. */
export function TicketPage({ id, host, from }: { id: string; host: string | null; from: From }) {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const sayCard = useStore((s) => s.sayCard);
  const handCard = useStore((s) => s.handCard);
  const active = useStore((s) => s.host);
  const params = useLocalSearchParams<{ agent?: string; steps?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const card = find(view, id, host);
  const project = card ? view.projects.find((p) => p.key === card.projectKey) ?? null : null;
  const got = useCard(id, host ?? card?.host ?? null);
  const ago: Ago = (seconds) => since(seconds, T);
  // The sentence being written is kept in the store, the way a project's
  // Composer keeps its own: leaving the page does not throw it away.
  const sayKey = `say:${host ?? ''}:${id}`;
  const draft = useStore((s) => s.drafts?.[sayKey]?.text ?? '');
  const keep = useStore((s) => s.setDraft);
  const setDraft = (text: string) => keep(sayKey, { text });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const executorRef = React.useRef<View>(null);

  const to = card ? saying(card) : null;
  /** A sentence into the run: the queue's note, which is the live channel the
   *  ticket's chat has always used. It lands in Live where it was said. */
  const say = React.useCallback(async (text: string, fromBox: boolean) => {
    if (!text || busy || !to || !card) return;
    if (fromBox) setDraft('');
    setBusy(true);
    setErr(null);
    try {
      await sayCard(to, text);
    } catch (e: any) {
      if (fromBox) setDraft(text);
      setErr(e?.message || T('waitNotSent', { machine: card.machine }));
    } finally {
      setBusy(false);
    }
  }, [busy, to, card, sayCard, T, sayKey]);

  const backLabel = from === 'waiting' ? T('waitTitle')
    : from === 'dashboard' ? T('tabDashboard')
    : from === 'project' ? (project?.name ?? T('tkBack'))
    : project ? `${project.name} · ${T('bdBoard')}` : T('bdBoard');
  const back = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace(from === 'waiting' ? '/waiting'
      : from === 'dashboard' ? '/dashboard'
      : project ? `/dashboard?project=${project.key}${from === 'project' ? '' : '&tab=board'}` : '/dashboard');
  };

  if (!card) {
    return (
      <Shell place="dashboard" badge={view.totals.needsYou}>
        <View style={{ flex: 1, paddingTop: 8, paddingHorizontal: 16 }}>
          <BackRow label={backLabel} onPress={back} style={{ paddingHorizontal: 4 }} />
          <EmptyState title={T('caGone')} body={T('caGoneBody')} />
        </View>
      </Shell>
    );
  }

  const ticket = got.detail?.ticket ?? null;
  const ask = asking(card, ticket, got.said);
  const st = status(card);
  const lines = live(got.turns, got.said, got.stamps, got.live);
  const all = one(params.steps) === 'all';
  const shown = all ? lines : lines.slice(-STEPS_SHOWN);
  const agentOpen = one(params.agent) === 'open';
  const rows = side(view, card, project, ago);
  const moments = trail(card);
  const where = [project?.name, card.ustabasi_id != null ? `#${card.ustabasi_id}` : null,
                 T(rows[0].word!)].filter(Boolean).join(' · ');
  const quiet = !lines.length && got.silence ? SILENCE[got.silence] : null;
  const whole = card.ustabasi_id != null && card.host === active?.id;

  const hand = async () => {
    const anchor = await measure(executorRef);
    openMenu({
      anchor, align: 'right', width: 220,
      items: HANDS.map((x) => ({
        label: T(executorKey(x)), checked: x === card.executor,
        onPress: () => { void handCard({ card: card.id, host: card.host }, x).catch((e: any) => setErr(e?.message ?? '')); },
      })),
    });
  };

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 16, paddingBottom: 32, gap: 24 }}>
          <BackRow label={backLabel} onPress={back} style={{ paddingHorizontal: 4 }} />

          {/* The human face. */}
          <View style={{ gap: 10, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {answered(card, got.said)
                ? <StatusWord kind="idle" word={T('tkAnswered')} />
                : !!st && <StatusWord kind={st.kind} word={T(st.word)} />}
              <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 11.5, color: t.ink3 }}>{where}</Text>
            </View>
            <Text style={{ fontSize: 26, lineHeight: 31, fontWeight: '600', letterSpacing: em(26, -0.025) }}>{card.title}</Text>
            {card.summary.trim()
              ? <Text style={{ fontSize: 15, lineHeight: 23, color: t.ink2 }}>{card.summary.trim()}</Text>
              : <Text style={{ fontSize: 15, lineHeight: 23, color: t.ink3 }}>{T('tkNoSentences')}</Text>}
          </View>

          {!!ask && (
            <Card ring={ask.stuck ? 'line' : 'amber'}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '500', color: ask.stuck ? t.red : t.amber }}>
                  {T(ask.stuck ? 'tkStopped' : 'tkAsking')}
                </Text>
                {card.agent_status_at != null && (
                  <Text mono style={{ fontSize: 11, color: t.ink3 }}>{short(view.now - card.agent_status_at)}</Text>
                )}
              </View>
              <Text style={{ fontSize: 15, lineHeight: 15 * 1.35, fontWeight: '500' }}>{ask.text}</Text>
              {!!to && ask.answers.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {ask.answers.map((words, i) => (
                    <Pill key={words} label={words} face={i === 0 ? 'amber' : 'outline'}
                      onPress={busy ? undefined : () => void say(words, false)} />
                  ))}
                </View>
              )}
            </Card>
          )}

          {/* Live: the latest steps, and the one line you can say into it. */}
          <View style={{ gap: 10 }}>
            <SectionHeader title={T('caLive')}
              right={[T(executorKey(card.executor)), card.machine].filter(Boolean).join(' · ')} />
            <Card inset={false} style={{ paddingVertical: 6 }}>
              {quiet ? (
                <View style={{ padding: 10, gap: 3 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: t.ink2 }}>{T(quiet.title)}</Text>
                  <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: t.ink3 }}>{T(quiet.body)}</Text>
                </View>
              ) : shown.map((line) => (
                <LiveRow key={line.id} tone={line.tone} now={line.now}
                  time={line.at == null ? null : clock(line.at)}
                  text={line.said ? T(line.said.key, line.said.params) : line.text ?? ''} />
              ))}
              {lines.length > STEPS_SHOWN && (
                <Tap onPress={() => router.setParams({ steps: all ? '' : 'all' })}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>
                    {all ? T('tkShowLess') : T('tkShowAll', { n: lines.length })}
                  </Text>
                </Tap>
              )}
            </Card>
            {to ? (
              <SayBox value={draft} onChangeText={setDraft} onSend={() => void say(draft.trim(), true)}
                busy={busy} error={err} placeholder={T('tkSay')} label={T('tkSay')} foot={T('caSayFoot')} />
            ) : (
              <Text mono style={{ fontSize: 11, color: t.ink3, textAlign: 'center' }}>{T('caSayNobody')}</Text>
            )}
            {whole && (
              <Tap onPress={() => go(() => router.push(`/ticket/${card.ustabasi_id}?run=1`))}
                style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>{T('tkWholeRun')}</Text>
              </Tap>
            )}
          </View>

          <AgentFace open={agentOpen} detail={got.detail} card={card} loading={got.loading} error={got.error}
            onToggle={() => router.setParams({ agent: agentOpen ? '' : 'open' })} />

          {/* The side column, under the page. */}
          <Card inset={false} style={{ paddingHorizontal: 14 }}>
            {rows.map((r, i) => {
              const value = (
                <>
                  <Text mono={r.mono} numberOfLines={1} style={{ flexShrink: 1, fontSize: 13.5, fontWeight: '500' }}>
                    {r.word ? T(r.word) : r.text}
                  </Text>
                  {!!r.note && (
                    <Text mono numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: r.warn ? t.amber : t.ink3 }}>
                      {T(r.note.key, r.note.params)}
                    </Text>
                  )}
                </>
              );
              return (
                <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44,
                                           borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}>
                  <Text style={{ width: 96, fontSize: 13, color: t.ink3 }}>{T(r.label)}</Text>
                  {r.key === 'executor' ? (
                    <View ref={executorRef} collapsable={false} style={{ flex: 1 }}>
                      <Tap onPress={() => void hand()} label={T('tkHand')}
                        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {value}
                        <Icon name="expand_more" size={16} color={t.ink3} />
                      </Tap>
                    </View>
                  ) : (
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{value}</View>
                  )}
                </View>
              );
            })}
          </Card>

          {moments.length > 0 && (
            <View>
              <SectionHeader title={T('caActivity')} style={{ marginBottom: 6 }} />
              {moments.map((m) => (
                <TrailRow key={`${m.at}-${m.said.key}`} time={when(m.at)}
                  text={T(m.said.key, { ...m.said.params, ...(m.who ? { who: T(m.who) } : {}),
                                        ...(m.col ? { col: T(m.col) } : {}) })} />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Shell>
  );
}

/** A moment in the trail: the time where it is today's, the date where not. */
function when(at: number): string {
  const d = new Date(at * 1000);
  return new Date().toDateString() === d.toDateString() ? clock(at) : stamp(at).split(',')[0];
}

const FACE_ROW: Record<Section['key'], Key> = {
  goal: 'tkGoal', done: 'tkDoneWhen', test: 'tkTest', files: 'tkFiles', constraints: 'tkConstraints', notes: 'tkNotes',
};

/** The brief, shut until it is pressed: Goal, Done when, Test, Files — and the
 *  constraints and notes where the card has any. */
function AgentFace({ open, detail, card, loading, error, onToggle }: {
  open: boolean;
  detail: DivanCardDetail | null;
  card: MergedCard;
  loading: boolean;
  error: string | null;
  onToggle: () => void;
}) {
  const T = useT();
  const t = useTokens();
  const blocks = sections(detail?.card.agent, detail?.ticket);
  const at = (key: Section['key']) => blocks.find((b) => b.key === key) ?? null;
  const order: Section['key'][] = ['goal', 'done', 'test', 'files', 'constraints', 'notes'];
  return (
    <Card>
      <Tap onPress={onToggle} label={T('tkAgentFace')}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={open ? 'expand_less' : 'chevron_right'} size={16} color={t.ink3} />
        <Text style={{ fontSize: 13, fontWeight: '600' }}>{T('tkAgentFace')}</Text>
        <Text mono numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontSize: 11, color: t.ink3 }}>
          {T('tkAgentFaceNote')}
        </Text>
      </Tap>
      {open && (!detail ? (
        <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>
          {loading ? T('wsStarting') : `${T('caBriefQuiet', { machine: card.machine })}${error ? ` · ${error}` : ''}`}
        </Text>
      ) : !blocks.length ? (
        <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink2 }}>{T('caNoBrief')}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {order.filter((k) => k === 'goal' || k === 'done' || k === 'test' || k === 'files' || at(k)).map((k) => {
            const b = at(k);
            return (
              <Block key={k} label={T(FACE_ROW[k])} count={b?.count ?? null}>
                {!b ? <BriefLine text={T('tkNone')} quiet />
                  : b.kind === 'code' ? <Commands lines={b.lines} />
                  : b.kind === 'list' && b.met
                    ? <View>{b.lines.map((line, i) => <Criterion key={i} text={line} met={b.met![i]} />)}</View>
                    : <View>{b.lines.map((line, i) => <BriefLine key={i} text={line} quiet={b.key === 'files'} />)}</View>}
              </Block>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

/** Where a ticket was opened from, out of the address. */
export function fromOf(v: string | null | undefined): From {
  return v === 'waiting' || v === 'dashboard' || v === 'project' || v === 'board' ? v : null;
}
