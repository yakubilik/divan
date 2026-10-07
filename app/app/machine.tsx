import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { since } from '../src/tickets';
import type { Ago } from '../src/dashboard';
import { executorGroups, fleetLine, machineLines, quotaBlock, WARN_AT, type MachineAction, type Words } from '../src/machine';
import { Button, EmptyState, ListRow, SectionHeader } from '../src/components/divan';
import { ExecutorRow, HeadAction, MachineCard, MachineTabs, PageHead, QuotaRing, UnderTab } from '../src/components/machine';
import { alert } from '../src/components/overlay';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';

/** Machine › Machines (HANDOVER §4.9): the first of the place's four tabs.
 *
 *  A card per computer — its own name in mono, online or unreachable, what it
 *  is running and when it was last seen. A machine that has stopped answering
 *  says so in red, in words, and says that what it last reported may be stale.
 *  The side column of the desktop drops below: the quota ring (the share left,
 *  when it resets, amber with the word `low` when low) and who can do work.
 *
 *  Pairing is the head's `+ Pair`, removing a computer is a card's long-press
 *  (an app-styled confirmation, never the system's), the computer picker and the
 *  remote screen are rows at the foot. */
export default function Machine() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const switchHost = useStore((s) => s.switchHost);
  const removeHost = useStore((s) => s.removeHost);
  const ago: Ago = (seconds) => since(seconds, T);
  const say = (w: Words) => (w.said ? T(w.said.key, w.said.params) : w.text);

  const pair = () => go(() => router.push({ pathname: '/pair', params: { add: '1' } }));

  /** The one page the app has about one computer is the computer's own screen,
   *  and it is a window onto whichever machine this phone is holding — so the
   *  socket is moved first, and then the window opens on the right machine. */
  const press = (action: MachineAction, id: string) => {
    if (action === 'retry') { view.reload(); return; }
    go(() => { void switchHost(id); router.push('/screen'); });
  };

  const confirmRemove = (id: string, name: string) => {
    alert(T('removeHost'), T('removeHostBody', { name }), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('remove'), style: 'destructive', onPress: async () => {
        await removeHost(id);
        if (useStore.getState().hosts.length === 0) { router.dismissAll(); router.replace('/pair'); }
      } },
    ]);
  };

  const lines = machineLines(view, ago);
  const quota = quotaBlock(view, ago);
  const pct = quota ? Math.round(quota.left * 100) : null;
  const low = !!quota && quota.left <= WARN_AT;
  const workers = executorGroups(view).flatMap((g) => g.rows);

  return (
    <Shell place="machine" badge={view.totals.needsYou}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 24, gap: 10 }}>
        <MachineTabs here="machines" />
        <PageHead title={T('maTitle')} right={<HeadAction label={T('maPair')} onPress={pair} />}
          style={{ marginTop: 6 }} />
        {lines.length > 0 && (
          <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink2, paddingHorizontal: 4 }}>
            {fleetLine(view).map(say).join(' ')}
          </Text>
        )}
        {lines.length === 0
          ? <EmptyState title={T('maNone')} body={T('maNoneBody')}
              actions={<Button label={T('addComputer')} icon="add" tall onPress={pair} />} />
          : (
            <>
              {lines.map((m) => (
                <MachineCard key={m.id} name={m.machine} detail={m.detail} state={m.state}
                  says={T(m.says)} tone={m.tone} ring={m.ring} figures={[]}
                  line={m.line.map(say)} seen={say(m.seen)}
                  actions={m.actions.map((a) => ({
                    key: a,
                    label: T(a === 'retry' ? 'maRetry' : 'maScreen'),
                    face: a === 'retry' ? 'ink' : 'outline',
                    onPress: () => press(a, m.id),
                  }))}
                  onLongPress={() => confirmRemove(m.id, m.machine)} />
              ))}

              <SectionHeader title={T('maQuota')} note={quota?.foot ? T(quota.foot.key, quota.foot.params) : null}
                kind="title" style={{ paddingTop: 14, paddingHorizontal: 4 }} />
              {pct != null
                ? <QuotaRing pct={pct} low={low} />
                : <Text style={{ fontSize: 13, color: t.ink2, paddingHorizontal: 4 }}>{T('maNoWindow')}</Text>}

              <SectionHeader title={T('mExecutors')} count={workers.length || null}
                kind="title" style={{ paddingTop: 14, paddingHorizontal: 4 }} />
              <View>
                {workers.map((row, i) => (
                  <ExecutorRow key={row.key} first={i === 0} face={row.face} who={say(row.who)}
                    machine={say(row.machine)} doing={say(row.doing)}
                    says={T(row.says.key, row.says.params)} tone={row.tone} ring={row.ring} />
                ))}
              </View>

              <View style={{ marginTop: 6 }}>
                <ListRow first icon="swap_horiz" title={T('maPicker')} note={T('maPickerNote')}
                  onPress={() => go(() => router.push('/host-sheet'))} />
              </View>
            </>
          )}
        <UnderTab here="machines" style={{ marginTop: 8 }} />
      </ScrollView>
    </Shell>
  );
}
