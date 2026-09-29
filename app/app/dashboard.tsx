import React from 'react';
import { ScrollView, View, type GestureResponderEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { LOCALE, type Key } from '../src/i18n';
import { useDivanView, useQueueBadge } from '../src/queue';
import { COLUMNS, project as projectIn, type DivanView, type MergedCard, type MergedProject } from '../src/divan';
import { chips } from '../src/shell';
import type { DivanColumn } from '../src/protocol';
import { since } from '../src/tickets';
import {
  agentRows, asks, calm, chip, clock, counters, freshness, latest, line, machineWords,
  marks, pausedWords, quotaWords, staleness, staleWords, systemLine, target, type Ago, type Said,
} from '../src/dashboard';
import {
  blank, blankBody, branchCards, nowWords, oldWords, quiet, subtitle, waitingWords, type Line,
} from '../src/project';
import {
  COLUMN_LABEL, OPENS_ON, faces, foot, items, spread, tabs, tally, type Face, type Item,
} from '../src/board';
import {
  SETTLE_MS, back, carry, foot as dropFoot, hint, says, type Carried, type Landed,
} from '../src/drag';
import { ColumnTabs, EmptyState, ListRow, SectionHeader, Segments } from '../src/components/divan';
import {
  AgentLine, AgentRoster, AskCard, Counters, Note, NoteFoot, ProjectCard, SystemLine,
} from '../src/components/dashboard';
import { BranchCard, ProjectHead, QuietNote, StateLines } from '../src/components/project';
import { BoardCard, ColumnLine } from '../src/components/board';
import { DragHint, DropSlot, Float, useDrag } from '../src/components/drag';
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
  const params = useLocalSearchParams<{ project?: string; tab?: string; col?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const selected = one(params.project);
  const picked = selected ? projectIn(view, selected) : null;
  // Which face of the product's page is open, and which column of its board —
  // in the address rather than in a `useState`, the way the project itself is,
  // so that a redraw or a notification lands on the page somebody was reading.
  const face: Face = one(params.tab) === 'board' ? 'board' : 'overview';
  const col = COLUMNS.find((c) => c === one(params.col)) ?? OPENS_ON;
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

  const product = picked ? (
    <Project project={picked} index={view.projects.findIndex((p) => p.key === picked.key)}
      view={view} now={now} ago={ago} face={face} column={col}
      onFace={(to) => router.setParams({ tab: to })}
      onColumn={(to) => router.setParams({ col: to })}
      onOpen={(c) => go(() => router.push(`/card/${c.id}?host=${c.host}`))} />
  ) : null;

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <ProjectBar chips={bar} onSelect={enter} />
      <Line view={view} ago={ago} />
      {/* A product's board pins its column tabs and scrolls its cards under
          them, so that face is given the page rather than a place in a scroll
          view (`Project`). Everything else on this screen is one page. */}
      {product && face === 'board' ? product : (
      /* `flexGrow` so that the empty state, which centres itself in what it
         is given, has the page to centre itself in. */
      /* Mobile1 V1's body: `padding:16px 16px 0; gap:16`. */
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>
        {product ?? (
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
      )}
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

/** One product alone (Mobile2 V4, Mobile7 S4): who it is, and then whichever of
 *  its two faces is open — the Overview below, or its board.
 *
 *  The frame puts three tabs over them. Two are drawn: the chats a product owns
 *  are not filed yet, and a tab that dims under a thumb and does nothing is worse
 *  than a tab that is not there.
 *
 *  The two faces scroll differently, which is the one structural difference
 *  between them. The Overview is a page and scrolls as one, inside the
 *  Dashboard's own. The board is a head and a list: its column tabs are the drop
 *  targets of the drag, and a drop target that can be scrolled off the top of the
 *  page is not a drop target — so it is pinned, the cards move under it, and that
 *  face owns its own scrolling (`board` here, and the branch in `Dashboard`).
 */
function Project({ project: p, index, view, now, ago, face, column, onFace, onColumn, onOpen }: {
  project: MergedProject; index: number; view: DivanView; now: number; ago: Ago;
  face: Face;
  column: DivanColumn;
  onFace: (to: Face) => void;
  onColumn: (to: DivanColumn) => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const stale = oldWords(p, now, ago);
  const head = (
    <>
      <ProjectHead name={p.name} index={index} note={subtitle(p)} />
      {!!stale && (
        <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
          {T(stale.key, stale.params)}
        </Text>
      )}
      {/* Mobile2 V4's segmented control: the mark on the Board tab is the worst
          thing on the board, so the face that is not open still says whether it
          needs anybody (`src/board.ts boardMark`). */}
      <Segments value={face} onChange={(key) => onFace(key as Face)}
        segments={faces(p).map((f) => ({ key: f.key, label: T(f.label), mark: f.mark, tone: f.tone }))} />
    </>
  );
  if (face === 'board') {
    // The page's own padding, which the Dashboard's scroll view was carrying
    // until this face took the scrolling off it.
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12, gap: 12 }}>{head}</View>
        <Board project={p} view={view} ago={ago} column={column} onColumn={onColumn} onOpen={onOpen} />
      </View>
    );
  }
  return (
    // `flexGrow` so that the empty page, which centres itself in what it is
    // given, has the page to centre itself in. Mobile7 S4's own body: `padding:
    // 14px 16px 0; gap:12`.
    <View style={{ flexGrow: 1, gap: 12 }}>
      {head}
      <Overview project={p} view={view} now={now} ago={ago} />
    </View>
  );
}

/** The Overview face (Mobile2 V4, Mobile7 S4): what is happening and what it is
 *  waiting for, over its branches as cards.
 *
 *  It carries the two states that are not that. A product nothing has touched in
 *  a fortnight gets Mobile7 S5's block where the two lines would be — "quiet for
 *  23 days", what happened last — because "nothing running, nothing waiting"
 *  said twice over a dead product is true and useless. A product whose board is
 *  still empty gets Mobile7 S6's designed state instead of a page of zeros. Which
 *  of the three it is, is `src/project.ts`'s to decide.
 *
 *  Mobile2 V4 also puts the asking agent's card here, with its two proposed
 *  answers as buttons. Mobile7 S4 draws the same page without it and with the
 *  `waiting` line instead, which is the later of the two and the one followed
 *  here: answering is a screen of its own (Mobile6 S3, reached from the
 *  Dashboard's first counter), every question is on it, and a second place to
 *  answer the same question from would be two places to keep in step.
 *
 *  Nor are the frame's own branch figures: `99.2% crash-free`, `6,412 clicks
 *  28d`, `€1,140 MRR`. Nothing is connected to those sources (the plan puts them
 *  after the screens), and the numbers drawn instead are the board's own — what
 *  is open on a branch, what is in progress, what is done. */
function Overview({ project: p, view, now, ago }: {
  project: MergedProject; view: DivanView; now: number; ago: Ago;
}) {
  const T = useT();
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
  if (blank(p)) {
    return <EmptyState title={T('prNewTitle')} body={T(body.key, body.params)} foot={T('prNewFoot')} />;
  }
  return (
    <View style={{ flexGrow: 1, gap: 12 }}>
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
    </View>
  );
}

/** …and the board (Mobile2 V5, Mobile8 S7, Mobile3 D1-D4): four columns as four
 *  tabs, one of them open, the cards in it, and the one gesture on this phone
 *  that changes what a computer is doing.
 *
 *  The column is where a person put a card and the mark on the card is what is
 *  actually happening to it — two facts, kept apart, and `src/board.ts` decides
 *  both. A card that failed at four in the morning is therefore still in the
 *  column it was in, with a red mark and how long it has been like that; nothing
 *  on the computer moves a card, and on this screen only a thumb does.
 *
 *  **The tabs are pinned and the cards scroll under them.** That is the frame's
 *  own layout and it is also what makes the gesture possible: they are the drop
 *  targets, and a drop target that can be scrolled off the top of the page is
 *  not one. It is why this face of the project page owns its own scrolling
 *  instead of sitting inside the Dashboard's.
 *
 *  What a drag *decides* is `src/drag.ts` and what it draws is
 *  `components/drag.tsx`; what is left here is the arrangement and the one thing
 *  neither of them can do — ask a computer to move the card, and say what came
 *  back. Two things can come back short, and the screen tells them apart because
 *  they are not the same news: a machine that did not answer moved nothing and
 *  the board is as it was, while a queue that declined leaves the card where the
 *  thumb put it with nothing running on it.
 *
 *  A board with no card anywhere on it is Mobile7 S6's designed state, with the
 *  four tabs still over it at zero — the design's own rule for an empty screen is
 *  that the structure stays legible. */
function Board({ project: p, view, ago, column, onColumn, onOpen }: {
  project: MergedProject; view: DivanView; ago: Ago;
  column: DivanColumn;
  onColumn: (to: DivanColumn) => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const moveCard = useStore((s) => s.moveCard);
  const list = items(view, p, column, ago);
  const said = foot(p, column, view.now);
  const where = spread(p, list.map((i) => i.card));
  const empty = blankBody(p);

  /** The card that has just been put down, for the five seconds it says so.
   *  Held here and nowhere else: it is a fact about this phone rather than
   *  about any board (Mobile3 D4). */
  const [landed, setLanded] = React.useState<Landed | null>(null);
  const settle = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const put = React.useCallback((l: Landed | null) => {
    if (settle.current) clearTimeout(settle.current);
    setLanded(l);
    if (l) settle.current = setTimeout(() => setLanded(null), SETTLE_MS);
  }, []);
  React.useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  /** Ask the computer the card is on to move it, and say what came back.
   *
   *  Every move this screen makes goes through here — the drop, and the Undo that
   *  takes one back — so that there is one place a machine that has stopped
   *  answering can be caught. A rejected move is the whole reason the card in
   *  Mobile3 D4 has four things it can say rather than one, and the Undo used to
   *  have no catch of its own: a board left showing a card in the column somebody
   *  had just said they did not want it in.
   *
   *  `starts` is what the release promised: a worker was asked for. It is only
   *  true of the drop, never of an Undo. */
  const ask = React.useCallback(async (
    to: { carried: Carried; column: DivanColumn; position: number | null; starts: boolean },
  ) => {
    try {
      const { error } = await moveCard({ card: to.carried.card, host: to.carried.host,
                                         column: to.column, position: to.position });
      put({ carried: to.carried, column: to.column,
            moved: true, started: to.starts && !error, error });
    } catch (e: any) {
      // Nothing moved. The board is exactly as it was, and what says so is the
      // line above the cards rather than the card: the list may by now be showing
      // the column the card was aimed at, where that card is not.
      put({ carried: to.carried, column: to.column,
            moved: false, started: false, error: e?.message ?? '' });
    }
  }, [moveCard, put]);

  const drag = useDrag({
    open: column,
    rows: list.map((i) => ({ card: i.card.id, host: i.card.host })),
    onOpen: onColumn,
    onMove: (to) => { put(null); void ask(to); },
  });

  const carried = drag.drag?.carried ?? null;
  // What the line above the cards says. While a card is in the air it is the
  // gesture's (Mobile3 D1-D3); after it lands it is the card's own line, but only
  // where the card is not on screen to carry it — a move that never arrived left
  // the card in a column this list may no longer be showing, and a board that
  // opened the column the card went to may not have re-read it yet. Otherwise it
  // is the column's own tally.
  const air = drag.drag
    ? hint(drag.drag, { others: list.filter((i) => i.card.id !== carried?.card).length,
                        mixed: p.machines.length > 1 })
    : null;
  // Which of the two surfaces carries what just happened to a card, as one
  // answer read twice: the line below, and the card in the loop under it.
  const told = says(landed, list.map((i) => i.card.id));
  const note = landed && told.line ? dropFoot(landed) : null;
  /** Where the card in the air would land, among the cards that are drawn. */
  const slot = drag.target === column ? drag.drag?.slot ?? null : null;

  // The card in the air is out of the list once a place in this column has been
  // picked: the slot the frame draws is the one it is about to fill, and drawing
  // the hole it left as well would be two holes for one card. Before that — the
  // thumb over another column's tab — its own place is the hole (D2).
  const cards = list
    .filter((item) => !(slot != null && item.card.id === carried?.card))
    .map((item) => (
      <View key={item.card.id} onLayout={drag.list.row(item.card.id)}>
        <BoardRow item={item} onOpen={onOpen}
          hold={drag.hold(carry(item.card, item.face, item.who))}
          held={carried?.card === item.card.id}
          flying={drag.flying}
          landed={landed && told.card === item.card.id ? landed : null}
          onUndo={() => { if (landed) { put(null); void ask({ ...back(landed), starts: false }); } }} />
      </View>
    ));
  if (slot != null) cards.splice(slot, 0, <DropSlot key="slot" landing />);

  return (
    // `flex` rather than `flexGrow`: the cards scroll under the tabs, which is
    // the frame's layout and the gesture's requirement both.
    <View ref={drag.frame.ref} onLayout={drag.frame.onLayout}
      style={{ flex: 1 }} {...drag.pan.panHandlers}>
      {/* The tab strip is the width of the page in the frame, rule and all, and
          the page it is on is inset by 16. */}
      <View ref={drag.strip.ref} onLayout={drag.strip.onLayout}>
        <ColumnTabs value={column} onChange={(key) => onColumn(key as DivanColumn)}
          dragging={!!drag.drag} target={drag.target} onMeasure={drag.strip.onMeasure}
          columns={tabs(p, view.now).map((c) => ({ key: c.key, label: T(c.label), count: c.count }))} />
      </View>
      <ScrollView scrollEnabled={!drag.drag}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 6,
                                 paddingBottom: 24, gap: 6 }}>
        {blank(p) ? (
          <EmptyState title={T('prNewTitle')} body={T(empty.key, empty.params)} foot={T('prNewFoot')} />
        ) : (
          <>
            {air ? <DragHint tone={air.tone} text={words(T, air)} />
             : note ? <DragHint tone={note.tone} text={words(T, note)} />
             : <ColumnLine marks={tally(list.map((i) => i.card), view.now, ago)}
                 machines={where.map((m) => `${m.name} ${m.n}`).join(' · ')} />}
            {/* Measured as one block: a card's place in the column is read off its
                own layout inside this view, and this view's place on the glass. */}
            <View ref={drag.list.ref} onLayout={drag.list.onLayout} style={{ gap: 6 }}>{cards}</View>
            {!!said && (
              <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2,
                             paddingHorizontal: 4, paddingTop: 2 }}>
                {T(said.key, said.params)}
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {/* The card under the thumb, over everything and outside the list that is
          no longer holding it (Mobile3 D2). Where it goes is the hook's own
          answer, in this view's coordinates: the thumb arrives in the window's
          and this view starts a long way down it. */}
      {!!drag.drag && drag.flying && !!drag.float && (
        <Float face={drag.drag.carried.face} who={T(drag.drag.carried.who)}
          title={drag.drag.carried.title} style={drag.float} />
      )}
    </View>
  );
}

/** One sentence out of the drag's own words: a column's name and an executor's
 *  name are keys themselves, and are put into the reader's language before they
 *  are put into the sentence — the same two-step every other line on this screen
 *  takes. */
function words(T: ReturnType<typeof useT>,
               say: { said: Said; col?: Key; who?: Key }): string {
  const params = say.who ? { ...say.said.params, who: T(say.who) }
    : say.col ? { ...say.said.params, col: T(say.col) } : say.said.params;
  return T(say.said.key, params);
}

/** One card of the open column, in whichever of its three states it is: lying
 *  there, held (D1), or newly put down (D4). The card it left behind while it is
 *  in the air is an empty slot rather than the card (D2). */
function BoardRow({ item, onOpen, hold, held, flying, landed, onUndo }: {
  item: Item;
  onOpen: (card: MergedCard) => void;
  hold: { holdMs: number; onLongPress: (e: GestureResponderEvent) => void; onPressOut: () => void };
  held?: boolean;
  flying?: boolean;
  landed?: Landed | null;
  onUndo: () => void;
}) {
  const T = useT();
  if (held && flying) return <DropSlot />;
  const say = landed ? dropFoot(landed) : null;
  return (
    <BoardCard face={item.face} who={T(item.who)} mine={item.mine} hold={hold} lifted={held}
      title={item.card.title} line={item.summary}
      machine={item.machine && { name: item.machine.name,
                                 seen: item.machine.seen == null ? null
                                   : T('pfLastSeen', { time: clock(item.machine.seen) }) }}
      mark={item.mark && { text: `${item.mark.mark} ${T(item.mark.key, item.mark.params)}`,
                           tone: item.mark.tone }}
      landed={say && {
        text: words(T, say),
        tone: say.tone,
        action: say.undo ? T('dgUndo') : undefined,
        onAction: say.undo ? onUndo : undefined,
      }}
      onPress={() => onOpen(item.card)} />
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
