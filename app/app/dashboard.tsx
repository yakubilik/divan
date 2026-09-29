import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { LOCALE } from '../src/i18n';
import { useDivanView, useQueueBadge } from '../src/queue';
import { project as projectIn, type DivanView, type MergedProject } from '../src/divan';
import { chips } from '../src/shell';
import { since } from '../src/tickets';
import {
  agentRows, asks, calm, chip, clock, counters, freshness, latest, line, machineWords,
  marks, pausedWords, quotaWords, staleness, staleWords, systemLine, target, type Ago, type Said,
} from '../src/dashboard';
import {
  blank, blankBody, branchCards, nowWords, oldWords, quiet, subtitle, waitingWords, type Line,
} from '../src/project';
import { EmptyState, ListRow, SectionHeader } from '../src/components/divan';
import {
  AgentLine, AgentRoster, AskCard, Counters, Note, NoteFoot, ProjectCard, SystemLine,
} from '../src/components/dashboard';
import { BranchCard, ProjectHead, QuietNote, StateLines } from '../src/components/project';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { ProjectBar, Shell } from '../src/components/shell';

/** The screen the whole product exists for: the one that is opened instead of a
 *  question being asked.
 *
 *  Mobile1 V1 top down — the project bar, the system line, the title, four
 *  counters, the questions only a person can answer — then V2's project cards
 *  and agent roster under them, and V3 when none of that applies: a morning
 *  where nothing needs anybody is a state this screen is designed for rather
 *  than an empty version of the busy one.
 *
 *  Three things are true of everything on it:
 *
 *  **Nothing here is invented.** Every counter is counted, every project card
 *  carries the two figures that exist for a product today — what the board says
 *  is running or waiting on it, and what git says has landed in its
 *  repositories — and the third figure the frames put at the top of a card, what
 *  the product earns, has no source connected and so is not drawn at all. A gap
 *  is honest; a placeholder is not.
 *
 *  **A machine that has gone quiet is said out loud.** Its cards still count
 *  towards what a person has to do, because a ticket that stopped to ask does
 *  not answer itself while a laptop is shut. What its *agents* are doing cannot
 *  be known, so that is a counter of its own, the title says how old the page
 *  is, and the projects that live there say when they were last seen.
 *
 *  **The judgements are not in here.** Which counter the fourth one is, which
 *  card needs a person first, what a project's corner says — all of it is
 *  `src/dashboard.ts`, so that `scripts/test-dashboard.cjs` can hold this screen
 *  to it without a phone. What is left in this file is the arrangement.
 *
 *  Selecting a project enters it, in the address (`/dashboard?project=quire`)
 *  rather than in a `useState`, so that it survives a redraw and can be linked
 *  to. The Dashboard *is* the project page — same place, scoped — which is how
 *  Mobile2 V4 reads it too: the project bar stays at the top with one chip
 *  selected, the tab bar stays lit on the Dashboard, and what changes is the page
 *  between them (`Project` below). */
export default function Dashboard() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const queue = useQueueBadge();
  const now = view.now;
  const host = useStore((s) => s.host);
  // A parameter can arrive twice; one project is being read either way.
  const param = useLocalSearchParams<{ project?: string }>().project;
  const selected = (Array.isArray(param) ? param[0] : param) || null;
  const picked = selected ? projectIn(view, selected) : null;
  // An empty string rather than nothing: `setParams` writes what it is given,
  // and "no project" has to be sayable.
  const enter = (key: string | null) => router.setParams({ project: key ?? '' });
  const open = (what: { ustabasi_id: number | null; host: string; projectKey: string }) => {
    const where = target(what, host?.id);
    if ('ticket' in where) go(() => router.push(`/ticket/${where.ticket}`));
    else enter(where.project);
  };
  const ago: Ago = (seconds) => since(seconds, T);
  const bar = chips(view, picked ? picked.key : null, T('allProjects'));
  const old = staleness(view);
  const today = new Date().toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  const aside = old
    ? T('dashPartly', { time: clock(old.asOf) })
    : `${T('dashProjects', { n: view.projects.length })} · ${today}`;

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <ProjectBar chips={bar} onSelect={enter} />
      <Line view={view} ago={ago} />
      {/* `flexGrow` so that the empty state, which centres itself in what it
          is given, has the page to centre itself in. */}
      {/* Mobile1 V1's body: `padding:16px 16px 0; gap:16`. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>
        {picked ? (
          <Project project={picked} index={view.projects.findIndex((p) => p.key === picked.key)}
            view={view} now={now} ago={ago} />
        ) : (
          <>
            <SectionHeader kind="page" title={T('overview')} right={aside}
              tone={old ? 'amber' : undefined} />
            {!!old && (
              <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
                {said(T, staleWords(old, ago))}
              </Text>
            )}
            <Paused view={view} ago={ago} />
            {/* Needs you opens the list of what is behind it (Mobile6 S3);
                with nothing behind it there is nothing to open, and the tile
                is a number like the other three. */}
            <Counters counters={counters(view)} label={(c) => T(c.key)}
              press={(c) => (c.key === 'cNeedsYou' && c.value > 0
                ? () => go(() => router.push('/waiting')) : undefined)} />
            <Calm view={view} />
            <Asks view={view} onOpen={open} />
            {view.projects.length === 0 ? <Nothing /> : (
              <>
                <View style={{ gap: 6 }}>
                  <SectionHeader title={T('projects')} note={T('dashSorted')} />
                  {view.projects.map((p, i) => (
                    <Product key={p.key} project={p} index={i} view={view} now={now} ago={ago}
                      onPress={() => enter(p.key)} />
                  ))}
                </View>
                <Agents view={view} now={now} ago={ago} onOpen={open} />
              </>
            )}
            {/* The two things on this screen that are not a project. Both are
                work rather than infrastructure, which is why neither is in the
                Machine list: the queue this computer is working through, and
                every conversation it has — the Chat place is one conversation
                and has no list in front of it, so this is where a second one
                is started and where one that was put away is found again. */}
            <View>
              {queue.available && (
                <ListRow first icon="terminal" title={T('ustabasi')} note={T('dashQueueNote')}
                  meta={queue.red ? T('queueRed', { n: queue.red }) : undefined} tone={queue.red ? 'red' : undefined}
                  onPress={() => go(() => router.push('/ustabasi'))} />
              )}
              <ListRow first={!queue.available} icon="chat_bubble" title={T('conversations')}
                note={T('dashChatsNote')} onPress={() => go(() => router.push('/chats'))} />
            </View>
          </>
        )}
      </ScrollView>
    </Shell>
  );
}

/** The system line, in whichever of its three states the fleet is in. Its words
 *  are two halves: which computers answered, and what is left to start an agent
 *  on. Where nothing has ever measured a quota the second half is absent — an
 *  empty track would be a number nobody read. */
function Line({ view, ago }: { view: DivanView; ago: Ago }) {
  const T = useT();
  const sys = systemLine(view);
  const quota = quotaWords(sys);
  // The healthy line labels its track; the other two have spent their left half
  // on a sentence and say "quota" inside the figure instead.
  return <SystemLine line={sys} say={said(T, machineWords(sys, ago))}
    quota={quota ? said(T, quota) : null}
    label={sys.quota && !sys.quota.spent && sys.state === 'healthy' ? T('sysQuota') : null} />;
}

/** A line the judgements chose, in the reader's language. */
function said(T: ReturnType<typeof useT>, x: Said): string {
  return T(x.key, x.params);
}

/** Out of quota (Mobile5 S2). Red, and not an alarm: what stopped, that nothing
 *  was lost, and exactly when it starts again. */
function Paused({ view, ago }: { view: DivanView; ago: Ago }) {
  const T = useT();
  const words = pausedWords(view, ago);
  if (!words) return null;
  return (
    <Note tone="red" icon="pause" title={said(T, words.title)} body={said(T, words.body)}
      foot={words.foot.length
        ? words.foot.map((x) => <NoteFoot key={x.key} text={said(T, x)} />)
        : null} />
  );
}

/** Nothing needs anybody (Mobile1 V3). A designed state and not an absence: the
 *  screen says so, and says what happened while nobody was looking — where
 *  anything can be counted. */
function Calm({ view }: { view: DivanView }) {
  const T = useT();
  const { doneToday } = view.totals;
  // The rule is `calm()` and not a copy of it. A guard written out again here
  // was how this block came to be drawn over a quiet machine's own amber
  // sentence: two spellings of one rule, and only one of them was checked.
  if (!calm(view)) return null;
  return (
    <Note tone="run" dot title={T('calmTitle')}
      foot={doneToday ? <NoteFoot text={T(doneToday === 1 ? 'calmDoneOne' : 'calmDone', { n: doneToday })} /> : null} />
  );
}

/** The questions, worst first (Mobile1 V1). */
function Asks({ view, onOpen }: {
  view: DivanView;
  onOpen: (what: { ustabasi_id: number | null; host: string; projectKey: string }) => void;
}) {
  const T = useT();
  const host = useStore((s) => s.host);
  const list = asks(view);
  if (!list.length) return null;
  const at = new Map(view.projects.map((p, i) => [p.key, i]));
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={T('needsYou')} count={list.length} />
      {list.map((ask) => {
        const name = view.projects[at.get(ask.card.projectKey) ?? -1]?.name ?? ask.card.branch;
        return (
          <AskCard key={ask.card.id} project={name} index={at.get(ask.card.projectKey) ?? null}
            who={said(T, { ...ask.says, params: ask.says.params && { who: T(ask.who) } })}
            question={ask.question}
            action={'ticket' in target(ask.card, host?.id) ? T('ticketAnswer') : null}
            onPress={() => onOpen(ask.card)} onAction={() => onOpen(ask.card)} />
        );
      })}
    </View>
  );
}

/** One product's card (Mobile1 V2, Mobile5 S1 and S2). */
function Product({ project: p, index, view, now, ago, onPress }: {
  project: MergedProject; index: number; view: DivanView; now: number; ago: Ago; onPress: () => void;
}) {
  const T = useT();
  const mark = chip(p, now, ago);
  const said = line(p, now);
  const fresh = freshness(p);
  return (
    <ProjectCard index={index} name={p.name} onPress={onPress}
      line={T(said.key, said.params)}
      chip={{ mark: mark.mark, text: T(mark.key, mark.params), tone: mark.tone }}
      freshness={fresh ? T(fresh.key, fresh.params) : null}
      figure={p.activity ? {
        value: p.activity.week,
        label: T('pfFinished'),
        moved: p.activity.at == null ? T('pfNeverMoved') : T('pfMoved', { d: ago(Math.max(0, now - p.activity.at)) }),
      } : null}
      marks={marks(p)} latest={latest(p.cards)} />
  );
}

/** Who is on what, where (Mobile1 V2). Only the agents actually at work: a card
 *  that stopped to ask is a question and is read above, not here. */
function Agents({ view, now, ago, onOpen }: {
  view: DivanView; now: number; ago: Ago;
  onOpen: (what: { ustabasi_id: number | null; host: string; projectKey: string }) => void;
}) {
  const T = useT();
  const rows = agentRows(view);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={T('agents')} count={rows.length} />
      <AgentRoster>
        {rows.map((r, i) => {
          const name = view.projects[r.index]?.name ?? r.agent.project;
          const detail = (r.agent.detail || '').trim();
          const when = r.agent.unknown
            ? T('pfLastSeen', { time: clock(r.agent.since_contact) })
            : r.agent.since == null ? '' : ago(Math.max(0, now - r.agent.since));
          return (
            <AgentLine key={r.agent.card_id} first={i === 0} mark={r.mark} tone={r.tone}
              who={T(r.who)} project={name} index={r.index}
              text={[r.agent.title, detail || when].filter(Boolean).join(' · ')}
              onPress={() => onOpen(r.agent)} />
          );
        })}
      </AgentRoster>
    </View>
  );
}

/** One product alone (Mobile2 V4, Mobile7 S4): who it is, a line of what is
 *  happening and a line of what it is waiting for, then its branches as cards.
 *
 *  The same page carries the two states that are not that. A product nothing has
 *  touched in a fortnight gets Mobile7 S5's block where the two lines would be —
 *  "quiet for 23 days", what happened last — because "nothing running, nothing
 *  waiting" said twice over a dead product is true and useless. A product whose
 *  board is still empty gets Mobile7 S6's designed state instead of a page of
 *  zeros. Which of the three it is, is `src/project.ts`'s to decide.
 *
 *  The frame's three tabs — Overview, Board, Chats — are not here: the Board is
 *  the next ticket and the chats a product owns are not filed yet, and a tab
 *  that dims under a thumb and does nothing is worse than a tab that is not
 *  there. This page is the Overview, which is the one of the three that exists.
 *
 *  Mobile2 V4 also puts the asking agent's card on this page, with its two
 *  proposed answers as buttons. Mobile7 S4 draws the same page without it and
 *  with the `waiting` line instead, which is the later of the two and the one
 *  followed here: answering is a screen of its own (Mobile6 S3, reached from the
 *  Dashboard's first counter), every question is on it, and a second place to
 *  answer the same question from would be two places to keep in step. The line
 *  says what is waiting and names it; the answering happens where it is designed
 *  to.
 *
 *  Nor are the frame's own branch figures: `99.2% crash-free`, `6,412 clicks
 *  28d`, `€1,140 MRR`. Nothing is connected to those sources (the plan puts them
 *  after the screens), and the numbers drawn instead are the board's own — what
 *  is open on a branch, what is in progress, what is done. */
function Project({ project: p, index, view, now, ago }: {
  project: MergedProject; index: number; view: DivanView; now: number; ago: Ago;
}) {
  const T = useT();
  const t = useTokens();
  const stale = oldWords(p, now, ago);
  const asleep = quiet(p, now, ago);
  const body = blankBody(p);
  const happening = nowWords(view, p);
  const pending = waitingWords(view, p);
  /** One of the two lines: every sentence it is made of, worst first, with the
   *  executor each names put into the reader's language — the same two-step the
   *  Dashboard's questions take. Several sentences where several things are true
   *  at once, which is what keeps "1 agent is running" off a page whose own card
   *  says `⏸ 1 paused`. */
  const line = (x: Line) => x.clauses
    .map((c) => T(c.said.key, c.who ? { ...c.said.params, who: T(c.who) } : c.said.params))
    .join(' ');
  return (
    // `flexGrow` so that the empty board, which centres itself in what it is
    // given, has the page to centre itself in. Mobile7 S4's own body: `padding:
    // 14px 16px 0; gap:12`.
    <View style={{ flexGrow: 1, gap: 12 }}>
      <ProjectHead name={p.name} index={index} note={subtitle(p)} />
      {!!stale && (
        <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
          {T(stale.key, stale.params)}
        </Text>
      )}
      {blank(p) ? (
        <EmptyState title={T('prNewTitle')} body={T(body.key, body.params)} foot={T('prNewFoot')} />
      ) : (
        <>
          {asleep
            ? <QuietNote title={T(asleep.title.key, asleep.title.params)}
                body={T(asleep.body.key, asleep.body.params)} />
            : <StateLines rows={[
                { label: T('prNow'), text: line(happening), tone: happening.tone },
                { label: T('prWaiting'), text: line(pending), tone: pending.tone, quiet: true },
              ]} />}
          <View style={{ gap: 6 }}>
            <SectionHeader title={T('branches')} count={p.branches.length} />
            {branchCards(p, now).map((b) => (
              <BranchCard key={b.key} name={b.name} state={b.state} dim={b.dim}
                line={b.said ? T(b.said.key, b.said.params) : b.text}
                figures={b.figures.map((f) => ({ value: f.value, label: T(f.label) }))}
                refreshed={b.refreshed ? T(b.refreshed.said.key, b.refreshed.said.params) : null}
                tone={b.refreshed?.tone ?? null} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/** No product on any machine — every paired computer is either silent or
 *  running a daemon older than this screen. Not an apology, and not a spinner:
 *  the structure stays and the middle of the screen says what is missing
 *  (Mobile7 S6). */
function Nothing() {
  const T = useT();
  return <EmptyState title={T('dashEmpty')} body={T('dashEmptyBody')} style={{ paddingTop: 60 }} />;
}
