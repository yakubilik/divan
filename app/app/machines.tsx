import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { since } from '../src/tickets';
import type { Ago } from '../src/dashboard';
import { machineLines, quotaBlock, type MachineAction, type Words } from '../src/machine';
import { Button, EmptyState, ListRow } from '../src/components/divan';
import { HeadAction, MachineCard, PageHead, QuotaCard } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { alert } from '../src/components/overlay';
import { Shell } from '../src/components/shell';

/** Machine › Machines — Mobile11 S15.
 *
 *  One card per computer: whether it answered, when it was last heard from, how
 *  much work it was carrying, and the one page this phone has about a single
 *  computer. The quota is over them rather than in one of them because it
 *  belongs to the account and not to a machine.
 *
 *  **A machine that has stopped answering is the reason to open this page**, so
 *  nothing about that is inferred from a colour: its card is ringed, its dot is
 *  hollow, the word beside it says `unreachable`, and its last contact is the
 *  one amber number on the page. A machine that has never answered at all has
 *  no last contact to print and says *that* instead — the two silences are not
 *  the same thing, and the page must not let them read as one.
 *
 *  What the page says is `src/machine.ts`; what is here is the arrangement and
 *  the four things a press does. Pairing is the head's `+ Pair` (the frame's
 *  own), removing is a card's long-press (the frame's own note), and the
 *  computer picker — which machine this phone is holding a socket to, and where
 *  it answers — is the row at the foot: it is a different question from "which
 *  machines are paired", and it is the screen that was here before this one. */
export default function Machines() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const view = useDivanView();
  const switchHost = useStore((s) => s.switchHost);
  const removeHost = useStore((s) => s.removeHost);
  const ago: Ago = (seconds) => since(seconds, T);
  const say = (w: Words) => (w.said ? T(w.said.key, w.said.params) : w.text);

  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/machine'); };
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
        // Nothing left to pick from: pairing is the only way out, the same exit
        // the computer picker has always taken.
        if (useStore.getState().hosts.length === 0) { router.dismissAll(); router.replace('/pair'); }
      } },
    ]);
  };

  const lines = machineLines(view, ago);
  const quota = quotaBlock(view, ago);

  return (
    <Shell place="machine" badge={view.totals.needsYou}>
      {/* `flexGrow` so that a phone with nothing paired, whose empty state
          centres itself in what it is given, has the page to centre itself in. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 24, gap: 8 }}>
        <BackRow label={T('mTitle')} onPress={back} style={{ paddingHorizontal: 4 }} />
        <PageHead title={T('maTitle')} right={<HeadAction label={T('maPair')} onPress={pair} />}
          style={{ marginBottom: 4 }} />
        {!!quota && (
          <QuotaCard title={T('maQuota')} says={T(quota.says.key, quota.says.params)} left={quota.left}
            tone={quota.tone} foot={quota.foot ? T(quota.foot.key, quota.foot.params) : null} />
        )}
        {lines.length === 0
          ? <EmptyState title={T('maNone')} body={T('maNoneBody')}
              actions={<Button label={T('addComputer')} icon="add" tall onPress={pair} />} />
          : (
            <>
              {lines.map((m) => (
                <MachineCard key={m.id} name={m.machine} detail={m.detail} state={m.state}
                  says={T(m.says)} tone={m.tone} ring={m.ring}
                  figures={m.figures.map((f) => ({ value: say(f.value), label: T(f.label), tone: f.tone }))}
                  actions={m.actions.map((a) => ({
                    key: a,
                    label: T(a === 'retry' ? 'maRetry' : 'maScreen'),
                    face: a === 'retry' ? 'ink' : 'outline',
                    onPress: () => press(a, m.id),
                  }))}
                  onLongPress={() => confirmRemove(m.id, m.machine)} />
              ))}
              <View style={{ marginTop: 6 }}>
                <ListRow first icon="swap_horiz" title={T('maPicker')} note={T('maPickerNote')}
                  onPress={() => go(() => router.push('/host-sheet'))} />
              </View>
            </>
          )}
      </ScrollView>
    </Shell>
  );
}
