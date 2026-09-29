import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore, useT } from '../../src/store';
import { useCard, useDivanView } from '../../src/queue';
import { since } from '../../src/tickets';
import { clock, executorKey, type Ago, type Said } from '../../src/dashboard';
import { executorFace } from '../../src/waiting';
import {
  FACES, OPENS_ON, SILENCE, details, find, head, live, sections, saying, stamp,
  tabs, trail, type Face, type Moment, type Say,
} from '../../src/card';
import { EmptyState, FaceTabs, SectionHeader } from '../../src/components/divan';
import {
  Block, BriefLine, CardHead, Commands, Criterion, Crumbs, DetailRow, DetailValue, LiveRow,
  SayBox, Sentences, TrailRow, Worker,
} from '../../src/components/card';
import { BackRow } from '../../src/components/waiting';
import { Text } from '../../src/components/text';
import { useTokens } from '../../src/theme';
import { Shell } from '../../src/components/shell';
import type { MergedCard, MergedProject } from '../../src/divan';
import type { DivanBrief, DivanCardDetail } from '../../src/protocol';
import type { RunSilence, Turn } from '../../src/transcript';

/** One card, opened — the three faces of Mobile4: T1 what it is, T2 what the
 *  machine was told, T3 what is happening right now.
 *
 *  The card is read out of the merged view (`src/divan.ts`) and everything else
 *  is asked of the machine the card is on (`useCard`). That split is the whole
 *  behaviour of this screen under a computer that has stopped answering: the
 *  human face is drawn from the last answer that machine gave, marked with when
 *  that was, and only the two faces that need the machine itself — the brief it
 *  holds and the run it is writing — say that it is not there.
 *
 *  **No text an agent produced is on the human face.** Not the brief, which
 *  Divan usually drafts; not what the worker printed; not a verdict. `src/card.ts`
 *  is where that is decided and `scripts/test-card.cjs` is where it is held:
 *  every string the agent side of this card holds is looked for in the human
 *  face's markup, and the check fails on any of them.
 *
 *  The head is one part drawn above all three faces rather than three heads that
 *  agree, because the frames' own note says the context must not change when the
 *  reader changes face — the breadcrumb, the title, the column and the card's
 *  place in it are the same seven lines on T1, T2 and T3.
 *
 *  The one write this screen makes is a sentence into a running worker, and it
 *  goes to the queue on the machine the card is on rather than to whichever
 *  computer this phone holds a socket to (`src/card.ts saying`). It does not
 *  stop the run: the queue appends it and the worker reads it at its next step,
 *  which is what the line under the box says. */
export default function CardScreen() {
  const router = useRouter();
  const T = useT();
  const view = useDivanView();
  const sayCard = useStore((s) => s.sayCard);
  const params = useLocalSearchParams<{ id?: string; host?: string; face?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const id = one(params.id) ?? '';
  const card = find(view, id, one(params.host));
  // Which face is open, in the address rather than in a `useState`, the way the
  // board keeps its column: a redraw or a notification lands on the face
  // somebody was reading.
  const face: Face = FACES.find((f) => f === one(params.face)) ?? OPENS_ON;
  const project = card ? view.projects.find((p) => p.key === card.projectKey) ?? null : null;
  const index = card ? view.projects.findIndex((p) => p.key === card.projectKey) : -1;
  const got = useCard(id, one(params.host) ?? card?.host ?? null);
  const ago: Ago = (seconds) => since(seconds, T);

  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  /** The one write this screen makes. Where the sentence goes and where it lands
   *  in the log is the store's (`sayCard`); what is here is the box emptying,
   *  and filling itself again where the machine would not take it. */
  const to = card ? saying(card) : null;
  const send = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !to || !card) return;
    setDraft('');
    setBusy(true);
    setErr(null);
    try {
      await sayCard(to, text);
    } catch (e: any) {
      setDraft(text);
      setErr(e?.message || T('waitNotSent', { machine: card.machine }));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, to, card, sayCard, T]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(project ? `/dashboard?project=${project.key}&tab=board` : '/dashboard');
  };

  if (!card) {
    return (
      <Shell place="dashboard" badge={view.totals.needsYou}>
        <View style={{ flex: 1, paddingTop: 8, paddingHorizontal: 16 }}>
          <BackRow label={T('bdBoard')} onPress={back} style={{ paddingHorizontal: 4 }} />
          <EmptyState title={T('caGone')} body={T('caGoneBody')} />
        </View>
      </Shell>
    );
  }

  const brief = got.detail?.card.agent ?? null;
  const ticket = got.detail?.ticket ?? null;
  const h = head(view, card, project, ticket, ago);
  const seen = h.machine.seen == null ? null : T('pfLastSeen', { time: clock(h.machine.seen) });

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* T1's head: `padding:6px 18px 0` with `gap:10`, and the tab strip at
            the foot of it. Every face wears it, and it does not scroll. */}
        <View style={{ paddingTop: 6, paddingHorizontal: 18, gap: 10 }}>
          <BackRow label={T('bdBoard')} onPress={back} />
          <Crumbs project={h.project} index={index < 0 ? null : index} branch={h.branch}
            ticket={h.key} label={T('caTicket')} />
          <CardHead title={h.title} column={T(h.columnLabel)}
            place={h.place == null ? null : T('caInColumn', { n: h.place })}
            mark={h.mark && {
              text: `${h.mark.mark} ${T(h.mark.key, h.mark.params)}`
                    + (h.progress ? ` · ${h.progress.met}/${h.progress.of}` : ''),
              tone: h.mark.tone,
            }} />
          <FaceTabs value={face} onChange={(next) => router.setParams({ face: next })}
            faces={tabs(brief, got.live).map((f) => ({
              key: f.key, label: T(f.label), count: f.count, live: f.live }))} />
        </View>
        {face === 'human' ? <Human view={view} card={card} project={project} ago={ago}
                              brief={brief} seen={seen} />
         : face === 'agent' ? <Agent detail={got.detail} card={card} seen={seen}
                                loading={got.loading} error={got.error} />
         : <Live card={card} ago={ago} now={view.now} turns={got.turns} stamps={got.stamps}
             said={got.said} running={got.live} silence={got.silence} seen={seen}
             draft={draft} onDraft={setDraft} onSend={() => void send()} busy={busy} error={err}
             offered={!!to} />}
      </KeyboardAvoidingView>
    </Shell>
  );
}

/** T1. What the card is, in the words of whoever wrote it: its own sentences in
 *  the fixed box, then the list — who is on it and where, when it was made, when
 *  it last moved, which branch it is work on, and how big the brief behind the
 *  next tab is. Then what has happened to it.
 *
 *  The size of the brief is the only thing on this page that comes from the
 *  agent face at all, and it is a count rather than a word of it. */
function Human({ view, card, project, brief, ago, seen }: {
  view: ReturnType<typeof useDivanView>;
  card: MergedCard;
  project: MergedProject | null;
  brief: DivanBrief | null;
  ago: Ago;
  seen: string | null;
}) {
  const T = useT();
  const rows = details(view, card, project, brief, ago);
  const moments = trail(card);
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 18, paddingBottom: 24, gap: 14 }}>
      {!!card.summary.trim() && <Sentences text={card.summary.trim()} />}
      <View>
        {rows.map((row) => (
          <DetailRow key={row.key} label={T(row.label)}>
            {row.who ? (
              <Worker face={row.who.face} who={T(row.who.name)} size={22}
                machine={row.who.machine.name} seen={seen} />
            ) : row.parts ? (
              <DetailValue text={row.parts.map((p: Said) => T(p.key, p.params)).join(' · ')} />
            ) : (
              <DetailValue text={row.text ?? ''} />
            )}
          </DetailRow>
        ))}
      </View>
      {moments.length > 0 && (
        <View>
          <SectionHeader title={T('caActivity')} style={{ paddingHorizontal: 0, marginBottom: 6 }} />
          {moments.map((m) => (
            <TrailRow key={`${m.at}-${m.said.key}`} time={when(m.at)} text={words(T, m)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** One line of the trail out of the reading's own words: an executor's name and
 *  a column's name are keys themselves, and are put into the reader's language
 *  before they are put into the sentence. */
function words(T: ReturnType<typeof useT>, m: Moment): string {
  return T(m.said.key, {
    ...m.said.params,
    ...(m.who ? { who: T(m.who) } : {}),
    ...(m.col ? { col: T(m.col) } : {}),
  });
}

/** A moment in the trail: the time where it is today's, the date where it is
 *  not. A card runs for days, and `22:51` on its own is a lie by omission on the
 *  second morning. */
function when(at: number): string {
  const d = new Date(at * 1000);
  return new Date().toDateString() === d.toDateString() ? clock(at) : stamp(at).split(',')[0];
}

/** T2. The brief, as the machine gets it: monospace, block by block, as long as
 *  it needs to be. The criteria double as progress, because the verifier answers
 *  them one by one and its marks are the only reading of "how far in" that is
 *  not a guess.
 *
 *  Three states that are not a brief, and each says something different: the
 *  card has none, the machine holding it is not answering, and it has not been
 *  read yet. */
function Agent({ detail, card, seen, loading, error }: {
  detail: DivanCardDetail | null;
  card: MergedCard;
  seen: string | null;
  loading: boolean;
  error: string | null;
}) {
  const T = useT();
  const blocks = sections(detail?.card.agent, detail?.ticket);
  if (!detail) {
    if (loading) return <View style={{ flex: 1 }} />;
    return (
      <EmptyState title={T('caBriefQuiet', { machine: card.machine })}
        body={error || T('caBriefQuietBody')} />
    );
  }
  if (!blocks.length) return <EmptyState title={T('caNoBrief')} body={T('caNoBriefBody')} />;
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 18, paddingBottom: 24, gap: 13 }}>
      {!!seen && <Stale text={T('waitStale', { machine: card.machine })} />}
      {blocks.map((b) => (
        <Block key={b.key} label={T(b.label)} count={b.count}>
          {b.kind === 'code' ? <Commands lines={b.lines} />
           : b.kind === 'list' && b.met ? (
             <View>{b.lines.map((line, i) => (
               <Criterion key={i} text={line} met={b.met![i]} />))}</View>
           ) : (
             <View>{b.lines.map((line, i) => (
               <BriefLine key={i} text={line} quiet={b.key === 'files'} />))}</View>
           )}
        </Block>
      ))}
    </ScrollView>
  );
}

/** T3. The run as it is written: who is working and for how long, one line per
 *  step, and the box that says one sentence into it.
 *
 *  The log sits at the foot of the page and grows upwards, the way the frame
 *  draws it: what a person opens this tab for is the last line, not the first.
 *  A sentence they say lands in it in amber where they said it, and the step
 *  being written right now is the one row with a wash behind it. */
function Live({ card, ago, now, turns, stamps, said, running, silence, seen, draft, onDraft,
                onSend, busy, error, offered }: {
  card: MergedCard;
  ago: Ago;
  now: number;
  turns: Turn[];
  stamps: Record<string, number>;
  said: Say[];
  running: boolean;
  silence: RunSilence;
  seen: string | null;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  busy: boolean;
  error: string | null;
  offered: boolean;
}) {
  const T = useT();
  const t = useTokens();
  const lines = live(turns, said, stamps, running);
  const scroller = React.useRef<ScrollView>(null);
  const age = card.agent_status === 'running' && card.agent_status_at
    ? T('caRunning', { d: ago(Math.max(0, now - card.agent_status_at)) }) : null;
  const quiet = !lines.length && silence ? SILENCE[silence] : null;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Worker face={executorFace(card)} who={T(executorKey(card.executor))} machine={card.machine}
        seen={seen} age={age} style={{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 4 }} />
      <ScrollView ref={scroller}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end',
                                 paddingHorizontal: 10, paddingBottom: 4, gap: 2 }}>
        {quiet ? <EmptyState title={T(quiet.title)} body={T(quiet.body)} />
          : lines.map((line) => (
            <LiveRow key={line.id} tone={line.tone} now={line.now}
              time={line.at == null ? null : clock(line.at)}
              text={line.said ? T(line.said.key, line.said.params) : line.text ?? ''} />
          ))}
      </ScrollView>
      {offered ? (
        <SayBox value={draft} onChangeText={onDraft} onSend={onSend} busy={busy} error={error}
          placeholder={T('caSay', { who: T(executorKey(card.executor)) })} foot={T('caSayFoot')}
          style={{ paddingTop: 12, paddingHorizontal: 12, paddingBottom: 4 }} />
      ) : (
        <Text mono style={{ fontSize: 11, color: t.ink3, textAlign: 'center',
                            paddingVertical: 12, paddingHorizontal: 12 }}>
          {T('caSayNobody')}
        </Text>
      )}
    </View>
  );
}

/** The one line a stale face wears: what follows was true when that machine last
 *  answered. */
function Stale({ text }: { text: string }) {
  const t = useTokens();
  return <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.45, color: t.amber }}>{text}</Text>;
}
