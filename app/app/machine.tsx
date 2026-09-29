import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { machineRows } from '../src/shell';
import { executorCount } from '../src/machine';
import { ListRow } from '../src/components/divan';
import { Text } from '../src/components/text';
import { em, useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';

/** The third place: everything the app knows that is about a computer rather
 *  than about work (Mobile11 S16).
 *
 *  It is a plain list, visited monthly. Each row has one grey summary line,
 *  nothing is coloured unless a machine is actually unreachable, and every row
 *  goes one level deeper and no further — to Machines and Executors
 *  (`app/machines.tsx`, `app/executors.tsx`, S15 and S14), and to the screens
 *  that were already there and moved under here unchanged. */
export default function Machine() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const rows = machineRows({
    machines: view.totals.machines,
    unreachable: view.totals.machines - view.totals.reachable,
    executors: executorCount(view),
  });

  return (
    <Shell place="machine">
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: '600', letterSpacing: em(28, -0.02), marginTop: 8 }}>{T('mTitle')}</Text>
        <Text style={{ fontSize: 13.5, color: t.ink2, marginTop: 4, marginBottom: 14 }}>{T('mSubtitle')}</Text>
        <View>
          {rows.map((row, i) => (
            <ListRow key={row.key} first={i === 0} icon={row.icon}
              title={T(row.title)} note={T(row.note, row.noteParams)}
              meta={row.meta ? T(row.meta, row.metaParams) : undefined} tone={row.tone}
              onPress={() => go(() => router.push(row.route))} />
          ))}
        </View>
      </ScrollView>
    </Shell>
  );
}
