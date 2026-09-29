import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { LOCALE } from '../src/i18n';
import { useDivanView, useQueueBadge } from '../src/queue';
import { project as projectIn, type MergedProject } from '../src/divan';
import { chips } from '../src/shell';
import { since } from '../src/tickets';
import { EmptyState, ListRow, SectionHeader } from '../src/components/divan';
import { ProjectBar, Shell } from '../src/components/shell';

/** The first of Divan's three places, and the one the app opens on.
 *
 *  This is the shell of it (Mobile1 V1, top down): the project bar, the title
 *  that says whether you are looking at everything or at one product, and a
 *  body. The counters, the questions only a person can answer, the project
 *  cards and the system line are the next ticket's — what is under the title
 *  here is the plain reading of the merged view, so that nothing in it is
 *  unreachable while that screen is being built: every product, and the ticket
 *  queue, which was a button in the corner of the old chat list.
 *
 *  Selecting a project in the bar enters it. Until the project page exists the
 *  Dashboard *is* the project page — same place, scoped — which is also how the
 *  frames read it: Mobile2 V4 is this screen with a chip lit. */
export default function Dashboard() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const view = useDivanView();
  const queue = useQueueBadge();
  const [selected, setSelected] = useState<string | null>(null);
  const picked = selected ? projectIn(view, selected) : null;
  const bar = chips(view, picked ? picked.key : null, T('allProjects'));
  const today = new Date().toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <ProjectBar chips={bar} onSelect={setSelected} />
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>
        <SectionHeader title={picked ? picked.name : T('overview')}
          right={picked ? picked.machines.join(' · ') : `${T('dashProjects', { n: view.projects.length })} · ${today}`} />
        {picked ? <Project project={picked} /> : (
          <>
            {queue.available && (
              <View>
                <ListRow first icon="terminal" title={T('ustabasi')} note={T('dashQueueNote')}
                  meta={queue.red ? T('queueRed', { n: queue.red }) : undefined} tone={queue.red ? 'red' : undefined}
                  onPress={() => go(() => router.push('/ustabasi'))} />
              </View>
            )}
            {view.projects.length === 0
              ? <Nothing />
              : (
                <View style={{ gap: 8 }}>
                  <SectionHeader title={T('projects')} note={T('dashSorted')} />
                  <View>
                    {view.projects.map((p, i) => (
                      <ListRow key={p.key} first={i === 0} title={p.name}
                        note={p.machines.join(' · ')} {...state(p, T)}
                        onPress={() => setSelected(p.key)} />
                    ))}
                  </View>
                </View>
              )}
          </>
        )}
      </ScrollView>
    </Shell>
  );
}

/** What a project's row says at its end: the worst true thing about it, in that
 *  state's colour. A machine that has gone quiet says so before it says how
 *  many agents it had — the number is a memory, and the age is the fact. */
function state(p: MergedProject, T: ReturnType<typeof useT>): { meta?: string; tone?: 'red' | 'amber' | 'run' } {
  if (p.stale) return { meta: T('dashQuiet', { d: since(p.lastSeen == null ? null : Math.max(0, Date.now() / 1000 - p.lastSeen), T) }), tone: undefined };
  if (p.waiting > 0) return { meta: T('queueRed', { n: p.waiting }), tone: 'amber' };
  if (p.running > 0) return { meta: T('queueRunning', { n: p.running }), tone: 'run' };
  return {};
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
