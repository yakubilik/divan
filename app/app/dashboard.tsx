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
  agentRows, asks, calm, chip, clock, counters, latest, line, marks, staleness,
  systemLine, target, type Ago,
} from '../src/dashboard';
import { EmptyState, ListRow, SectionHeader } from '../src/components/divan';
import {
  AgentLine, AgentRoster, AskCard, Counters, Note, NoteFoot, ProjectCard, SystemLine,
} from '../src/components/dashboard';
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
 *  to. Until the project page exists the Dashboard *is* the project page — same
 *  place, scoped — which is how Mobile2 V4 reads it too. */
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
        <SectionHeader kind="page" title={picked ? picked.name : T('overview')}
          right={picked ? picked.machines.join(' · ') : aside} tone={!picked && old ? 'amber' : undefined} />
        {picked ? <Project project={picked} /> : (
          <>
            {!!old && (
              <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
                {old.machines.length > 1
                  ? T('dashStaleMany', { n: old.machines.length, time: clock(old.asOf) })
                  : old.projects.length
                    ? T('dashStale', { name: old.machines[0], d: ago(old.age),
                                       projects: old.projects.join(', '), time: clock(old.asOf) })
                    : T('dashStaleBare', { name: old.machines[0], d: ago(old.age) })}
              </Text>
            )}
            <Paused view={view} now={now} ago={ago} />
            <Counters counters={counters(view)} label={(c) => T(c.key)} />
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
  const say = sys.state === 'none' ? T('sysNoMachines')
    : sys.state === 'unreachable' && sys.unreachable > 1 ? T('sysUnreachableMany', { n: sys.unreachable })
    : sys.state === 'unreachable' && sys.quiet
      ? (sys.quiet.age == null
          ? T('sysUnreachableNever', { name: sys.quiet.name })
          : T('sysUnreachable', { name: sys.quiet.name, d: ago(sys.quiet.age) }))
    : sys.machines === 1 ? T('sysOneMachine') : T('sysMachines', { n: sys.machines });
  const q = sys.quota;
  const quota = !q ? null
    : q.spent
      ? (q.resets_at ? T('sysQuotaSpent', { time: clock(q.resets_at) }) : T('sysQuotaOut'))
      : sys.state === 'unreachable'
        ? T('sysQuotaShort', { p: q.pct })
        : q.resets_at ? T('sysQuotaLeft', { p: q.pct, time: clock(q.resets_at) })
        : T('sysQuotaBare', { p: q.pct });
  // The healthy line labels its track; the other two have spent their left half
  // on a sentence and say "quota" inside the figure instead.
  return <SystemLine line={sys} say={say} quota={quota}
    label={q && !q.spent && sys.state === 'healthy' ? T('sysQuota') : null} />;
}

/** Out of quota (Mobile5 S2). Red, and not an alarm: what stopped, that nothing
 *  was lost, and exactly when it starts again. */
function Paused({ view, now, ago }: { view: DivanView; now: number; ago: Ago }) {
  const T = useT();
  const q = view.quota;
  if (!q.spent) return null;
  const back = q.resets_at;
  const n = view.totals.paused;
  return (
    <Note tone="red" icon="pause"
      title={back ? T('pausedTitle', { time: clock(back) }) : T('pausedTitleBare')}
      body={n === 0 ? T('pausedBodyNone')
        : T(n === 1 ? 'pausedBodyOne' : 'pausedBody',
            { n, d: ago(back == null ? null : Math.max(0, back - now)) })}
      foot={back ? (
        <>
          <NoteFoot text={T('pausedUsed')} />
          <NoteFoot text={T('pausedResets', { time: clock(back) })} />
        </>
      ) : null} />
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
        const who = T(ask.who);
        return (
          <AskCard key={ask.card.id} project={name} index={at.get(ask.card.projectKey) ?? null}
            who={ask.state === 'stuck' ? T('whoStopped', { who })
               : ask.state === 'asking' ? T('whoAsks', { who }) : T('whoYours')}
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
  const back = view.quota.resets_at;
  return (
    <ProjectCard index={index} name={p.name} onPress={onPress}
      line={T(said.key, said.params)}
      chip={{ mark: mark.mark, text: T(mark.key, mark.params), tone: mark.tone }}
      freshness={p.stale ? (p.lastSeen == null ? null : T('pfLastSeen', { time: clock(p.lastSeen) }))
        : p.paused > 0 && back ? T('pfResume', { time: clock(back) })
        : null}
      figure={p.activity ? {
        value: p.activity.week,
        label: T('pfFinished'),
        moved: p.activity.at == null ? T('pfNeverMoved') : T('pfMoved', { d: ago(Math.max(0, now - p.activity.at)) }),
      } : null}
      marks={marks(p)} latest={latest(p)} />
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

/** One product: its branches, which is everything the merged view knows about
 *  it that is not a card. A branch with no source connected says so rather than
 *  showing a number nobody measured. */
function Project({ project }: { project: MergedProject }) {
  const T = useT();
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={T('branches')} count={project.branches.length} />
      <View>
        {project.branches.map((b, i) => (
          <ListRow key={b.id || b.kind} first={i === 0} title={b.name || b.kind}
            note={b.summary || T('branchNoSource')}
            meta={b.open ? T('branchOpen', { n: b.open }) : undefined}
            chevron={false} />
        ))}
      </View>
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
