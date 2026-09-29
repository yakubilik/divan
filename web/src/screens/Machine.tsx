/** The Machine place: everything that is about a computer rather than about
 *  work.
 *
 *  Web15 draws it as `260px` of rows with the selected one filled and the page
 *  itself in the rest of the width, and its eight rows are all here: Machines,
 *  Executors, Terminals, Remote screen, Accounts & sign-ins, Quota thresholds,
 *  Admin and Settings. Six of them are pages built out of the design system
 *  (`ui/divan.tsx`) against the decisions in `lib/machine.ts`; the two the
 *  frames tell to stay as they are — the wall of terminals and the remote
 *  screen — are the screens the panel already had, unchanged, because what they
 *  do is the whole of what they are.
 *
 *  Four pages have no row of their own (`MACHINE_ASIDE`): a computer's folders,
 *  the agents installed on it, the update, and every default a new chat takes.
 *  Each is opened from the page above it and drawn with that page's row still
 *  filled — one level deeper, not somewhere else. Those four speak the older
 *  vocabulary (`C` in `lib/theme.ts`), which is the same palette under other
 *  names, so they follow both themes without a line of theirs changing.
 */
import { useEffect } from 'react';
import { MACHINE_ROWS, machineRow, updateWaiting, type View } from '../lib/shell';
import { useFleet } from '../lib/fleet';
import { signIns, signInsWanting, quotaVerdict, useThresholds } from '../lib/machine';
import { T } from '../lib/theme';
import type { DivanView } from '../lib/divan';
import { glyph } from '../ui/kit';
import { SidePanel, type PanelItem } from '../ui/divan';
import { sources, Accounts } from './Accounts';
import { Machines } from './Machines';
import { Executors } from './Executors';
import { Quota } from './Quota';
import { Admin } from './Admin';
import { Settings } from './Settings';
import { Fleet } from './Fleet';
import { Terminal } from './Terminal';
import { Projects } from './Projects';
import { Agents } from './Agents';
import { Screen } from './Screen';
import { Update } from './Update';
import { Preferences } from './Preferences';
import type { Agent } from '../lib/protocol';

export interface MachineProps {
  view: View;
  onView: (view: View) => void;
  /** The merged fleet, for the one thing this place says out loud: whether every
   *  machine is answering. */
  fleet: DivanView;
  onOpenChat: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
  onNewChatIn: (cwd: string) => void;
  onStartChat: (agent: Agent, accountId: string | null) => void;
  onPeek: (hostKey: string, chatId: string) => void;
}

/** The note under the title of the column: Web15 W12's `One machine is
 *  unreachable.` — the one sentence this place says about the fleet as a whole,
 *  and nothing when there is nothing wrong with it. */
export function machineNote(fleet: DivanView): string {
  const out = fleet.hosts.filter((h) => !h.reachable);
  if (!fleet.hosts.length) return 'No computer is paired yet.';
  if (!out.length) {
    return `${fleet.hosts.length} computer${fleet.hosts.length === 1 ? '' : 's'}, all reachable.`;
  }
  if (out.length === 1) return `${out[0].machine} cannot be reached.`;
  return `${out.length} of ${fleet.hosts.length} computers cannot be reached.`;
}

/** The six pages this ticket built. They stand in the page column beside the
 *  drawer, which carries their scroll and their padding; the four older ones
 *  bring their own head and take the whole width, as they always did. */
const DRAWN_HERE = new Set<View>([
  'machines', 'executors', 'accounts', 'quota', 'admin', 'settings',
]);

export function Machine(props: MachineProps) {
  const { view, onView, fleet } = props;
  const { hosts, order } = useFleet();
  const refreshAccounts = useFleet((s) => s.refreshAccounts);
  const { thresholds } = useThresholds();

  // Entering the place asks every computer which sign-ins it has.
  //
  // `account.list` shells out to both CLIs and can take seconds, so it is not
  // part of the connect path — which meant, until this asked for it, that the
  // amber count on the Accounts row was 0 on a panel nobody had opened that
  // page on. The one thing that page exists to say was the one thing you had to
  // go and look for. Asked once per computer: a slot that has answered has its
  // own two accounts at least, so a list that is still empty is a question
  // nobody has put yet.
  const cold = order.filter((k) => hosts[k]?.status === 'online'
    && !hosts[k].accounts.length && !hosts[k].loading.accounts).join(',');
  useEffect(() => {
    for (const key of cold ? cold.split(',') : []) refreshAccounts(key).catch(() => {});
  }, [cold, refreshAccounts]);
  const unreachable = fleet.hosts.filter((h) => !h.reachable).length;
  // What under this place wants a person, on the row it is about: a chat
  // waiting to be allowed to do something — which is on the wall as well as in
  // the Chat place — an update in hand, a sign-in about to stop working, and a
  // plan under the threshold somebody set on the sixth row.
  const approvals = order.reduce(
    (n, k) => n + (hosts[k]?.chats.filter((c) => c.status === 'awaiting_approval').length ?? 0), 0);
  const update = order.some((k) => updateWaiting(hosts[k]?.info?.update));
  const expiring = signInsWanting(
    signIns(sources(hosts, order), fleet.now, () => '', () => ''));
  const quota = quotaVerdict(fleet.quota, thresholds);
  const here = machineRow(view);

  const items: PanelItem[] = MACHINE_ROWS.map((row) => ({
    key: row.view,
    label: row.label,
    icon: glyph(row.icon),
    // The frame puts a mark on the row that has something under it: a hollow
    // dot for the machine that cannot be reached (Web15 W12), an amber count
    // for the sign-in that is expiring (W16). Both are the amber of something
    // that wants a person, which is the state that colour belongs to.
    ...(row.view === 'machines' && unreachable > 0
      ? { dot: 'asking' as const, hollow: true } : {}),
    ...(row.view === 'terminal' && approvals > 0 ? { count: approvals } : {}),
    ...(row.view === 'accounts' && expiring > 0 ? { count: expiring } : {}),
    ...(row.view === 'quota' && (quota.state === 'warn' || quota.state === 'stop'
      || quota.state === 'spent') ? { dot: 'asking' as const } : {}),
    ...(row.view === 'admin' && update ? { dot: 'asking' as const } : {}),
  }));

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch',
      overflow: 'hidden', background: T.bg,
    }}>
      <div style={{ flex: 'none', padding: '28px 12px 28px 20px', overflowY: 'auto' }}>
        <SidePanel
          title="Machine" note={machineNote(fleet)}
          items={items} value={here} onChange={(key) => onView(key as View)}
        />
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, margin: '14px 12px 0' }}>
          {MACHINE_ROWS.find((r) => r.view === here)?.note}
        </div>
      </div>
      {/* The page beside it: Web15's `grid-template-columns:260px minmax(0,1fr);
          gap:40px`, as a column of blocks `gap:18px` apart. The four older
          screens bring their own head, their own scroll and their own padding —
          each of them was the whole width of the panel until now — so they are
          handed the width and left alone. */}
      {DRAWN_HERE.has(view) ? (
        <div style={{
          flex: 1, minWidth: 0, overflowY: 'auto', padding: '28px 32px 40px 28px',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0, maxWidth: 1080,
          }}>
            <Page {...props} />
          </div>
        </div>
      ) : <Page {...props} />}
    </div>
  );
}

function Page(props: MachineProps) {
  const { view, onView, fleet, onOpenChat, onNewChat, onNewChatIn, onStartChat, onPeek } = props;
  const setFocus = useFleet.getState().setFocus;
  if (view === 'executors') return <Executors view={fleet} onView={onView} />;
  if (view === 'terminal') return <Terminal onPeek={onPeek} onNewChat={onNewChat} />;
  if (view === 'screen') return <Screen />;
  if (view === 'accounts') {
    return <Accounts now={fleet.now} onView={onView} onFocus={setFocus} />;
  }
  if (view === 'quota') return <Quota view={fleet} />;
  if (view === 'admin') return <Admin now={fleet.now} onView={onView} />;
  if (view === 'settings') return <Settings onView={onView} />;
  if (view === 'fleet') return <Fleet onOpenChat={onOpenChat} onNewChat={onNewChat} />;
  if (view === 'projects') return <Projects onNewChatIn={onNewChatIn} onOpenChat={onOpenChat} />;
  if (view === 'agents') return <Agents onStartChat={onStartChat} />;
  if (view === 'update') return <Update />;
  if (view === 'preferences') return <Preferences />;
  // Every other view in this place is the machines themselves: it is the first
  // row and the page this place opens on, so it is also the answer to a view
  // that has drifted.
  return <Machines view={fleet} onView={onView} onFocus={setFocus} />;
}
