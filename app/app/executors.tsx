import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useT } from '../src/store';
import { useDivanView } from '../src/queue';
import { executorGroups, type Words } from '../src/machine';
import { EmptyState, SectionHeader } from '../src/components/divan';
import { ExecutorRow, PageHead } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { Shell } from '../src/components/shell';

/** Machine › Executors — Mobile11 S14.
 *
 *  Everyone who can do work, grouped by kind. Each row says four things and the
 *  frame's own note is the specification for them: what it is for (on the
 *  heading over the run, which is what keeps a row one line long), which
 *  computer it is on, what it is doing now, and whether it is busy, idle or
 *  unavailable.
 *
 *  Nobody here is invented. A worker is a row because a machine said it was
 *  running one; a reachable computer with no worker on it is the row that says
 *  it could take the next ticket; a computer that has gone quiet or run out of
 *  quota is the row that says it could not, and why. The man himself is listed
 *  last, runs on no machine, and his state is how much is waiting on him.
 *
 *  The reading is `src/machine.ts` so that `scripts/test-machine.cjs` can hold
 *  this page to it without a phone. */
export default function Executors() {
  const router = useRouter();
  const T = useT();
  const view = useDivanView();
  const say = (w: Words) => (w.said ? T(w.said.key, w.said.params) : w.text);

  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/machine'); };
  // One reading of "is there anybody", so the count beside the title cannot
  // stand over a page that says there is nobody.
  const groups = executorGroups(view);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Shell place="machine" badge={view.totals.needsYou}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 20,
                                           paddingBottom: 24 }}>
        <BackRow label={T('mTitle')} onPress={back} />
        <PageHead title={T('exTitle')} count={total || null} style={{ marginTop: 6, paddingHorizontal: 0 }} />
        {total === 0
          ? <EmptyState title={T('exNone')} body={T('exNoneBody')} />
          : groups.map((g) => (
            <View key={g.key}>
              <SectionHeader title={T(g.title)} note={g.note ? T(g.note) : null}
                kind="title" style={{ paddingTop: 14, paddingBottom: 6, paddingHorizontal: 0 }} />
              {g.rows.map((row, i) => (
                <ExecutorRow key={row.key} first={i === 0} face={row.face} who={say(row.who)}
                  machine={say(row.machine)} doing={say(row.doing)}
                  says={T(row.says.key, row.says.params)} tone={row.tone} ring={row.ring} />
              ))}
            </View>
          ))}
      </ScrollView>
    </Shell>
  );
}
