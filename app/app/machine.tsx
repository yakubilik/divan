import React from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { since } from '../src/tickets';
import type { Ago } from '../src/dashboard';
import { fleetLine, machineLines, type MachineAction, type Words } from '../src/machine';
import { Button, EmptyState } from '../src/components/divan';
import { HeadAction, MachineCard, MachineTabs, PageHead } from '../src/components/machine';
import { ComputerSettings } from '../src/components/computer-settings';
import { alert } from '../src/components/overlay';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';

/** Machine › Computers (HANDOVER §4.9): the first of the place's four tabs.
 *
 *  A card per computer — its own name in mono, online or unreachable, what it
 *  is running and when it was last seen, and its two buttons: use it, or open
 *  its screen. A machine that has stopped answering says so in red, in words.
 *  Under the cards are the settings of the one this phone is holding.
 *
 *  Pairing is the head's `+ Pair`, removing a computer is a card's long-press
 *  (an app-styled confirmation, never the system's). Every card but the held
 *  one offers `Use this machine`, which switches without leaving the page; the
 *  held one is marked `current`. The quota went to Accounts and the workers to
 *  Settings › more (Yakup, 7 Nov 2026: one page, one subject). */
export default function Machine() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const hosts = useStore((s) => s.hosts);
  const activeHostId = useStore((s) => s.activeHostId);
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
    // A machine this phone has no pairing for cannot be switched to —
    // `switchHost` would quietly do nothing — so it is offered pairing.
    if (action === 'pair' || !hosts.some((h) => h.id === id)) { pair(); return; }
    // Switching stays on this page: the card that was pressed becomes the
    // marked one, and the rest of the page is every machine either way.
    if (action === 'use') { void switchHost(id); return; }
    go(() => { void switchHost(id); router.push('/screen'); });
  };
  const label = (a: MachineAction) =>
    T(a === 'retry' ? 'maRetry' : a === 'use' ? 'maUse' : a === 'pair' ? 'maPairThis' : 'maScreen');

  const confirmRemove = (id: string, name: string) => {
    alert(T('removeHost'), T('removeHostBody', { name }), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('remove'), style: 'destructive', onPress: async () => {
        await removeHost(id);
        if (useStore.getState().hosts.length === 0) { router.dismissAll(); router.replace('/pair'); }
      } },
    ]);
  };

  const lines = machineLines(view, ago, { active: activeHostId, paired: hosts.map((h) => h.id) });

  return (
    <Shell place="machine" badge={view.totals.needsYou}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 24, gap: 10 }}>
        <MachineTabs here="machines" />
        <PageHead title={T('tabComputers')} right={<HeadAction label={T('maPair')} onPress={pair} />}
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
                  line={m.unpaired ? [...m.line.map(say), T('maNotPaired')] : m.line.map(say)}
                  seen={say(m.seen)} current={m.current ? T('maCurrent') : undefined}
                  actions={m.actions.map((a) => ({
                    key: a,
                    label: label(a),
                    // One filled button per card: what this card is for.
                    face: a === 'screen' || (a === 'retry' && m.actions.includes('use')) ? 'outline' : 'ink',
                    onPress: () => press(a, m.id),
                  }))}
                  onLongPress={() => confirmRemove(m.id, m.machine)} />
              ))}

              <ComputerSettings onRemove={confirmRemove} />
            </>
          )}
      </ScrollView>
    </Shell>
  );
}
