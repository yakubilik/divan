/** The Machine place: everything that is about a computer rather than about work.
 *
 *  Seven of the old panel's eight screens were this — the fleet's health, the
 *  agents installed on a machine, the wall of its sessions, its own screen, its
 *  folders, its update, its settings — and they are all still here, unchanged,
 *  behind the column Web15 draws them behind: `260px` of rows, the selected one
 *  filled, and the page itself in the rest of the width.
 *
 *  Nothing on this page was rewritten by this ticket. The screens speak the older
 *  vocabulary (`C` in `lib/theme.ts`), which is the same palette under other
 *  names, so they follow both themes without a line of theirs changing; the ones
 *  the design has frames for are rebuilt in their own tickets. What changed is
 *  where they are: one place instead of seven rows in a sidebar, and the note
 *  under each row says what it is for — which is the part of "findable,
 *  forgettable" a list of bare words was missing.
 */
import { MACHINE_ROWS, type View } from '../lib/shell';
import { T } from '../lib/theme';
import type { DivanView } from '../lib/divan';
import { P } from '../ui/kit';
import { SidePanel, type PanelItem } from '../ui/divan';
import { Dashboard } from './Dashboard';
import { Terminal } from './Terminal';
import { Projects } from './Projects';
import { Agents } from './Agents';
import { Screen } from './Screen';
import { Admin } from './Admin';
import { Settings } from './Settings';
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

export function Machine(props: MachineProps) {
  const { view, onView, fleet } = props;
  const unreachable = fleet.hosts.filter((h) => !h.reachable).length;
  const items: PanelItem[] = MACHINE_ROWS.map((row) => ({
    key: row.view,
    label: row.label,
    icon: (P as Record<string, string>)[row.icon],
    // The frame puts a hollow dot on the row that has something wrong under it,
    // and the machines are the only row on this list that can.
    // …drawn in the amber of something that wants a person, which is the state
    // that colour belongs to.
    ...(row.view === 'machines' && unreachable > 0
      ? { dot: 'asking' as const, hollow: true } : {}),
  }));

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch',
      overflow: 'hidden', background: T.bg,
    }}>
      <div style={{ flex: 'none', padding: '28px 12px 28px 20px', overflowY: 'auto' }}>
        <SidePanel
          title="Machine" note={machineNote(fleet)}
          items={items} value={view} onChange={(key) => onView(key as View)}
        />
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, margin: '14px 12px 0' }}>
          {MACHINE_ROWS.find((r) => r.view === view)?.note}
        </div>
      </div>
      {/* The screens bring their own head, their own scroll and their own
          padding: each of them was the whole width of the panel until now, and
          this place is the width they are given rather than a layout of its own. */}
      <Page {...props} />
    </div>
  );
}

function Page({ view, onOpenChat, onNewChat, onNewChatIn, onStartChat, onPeek }: MachineProps) {
  if (view === 'terminal') return <Terminal onPeek={onPeek} onNewChat={onNewChat} />;
  if (view === 'screen') return <Screen />;
  if (view === 'projects') return <Projects onNewChatIn={onNewChatIn} onOpenChat={onOpenChat} />;
  if (view === 'agents') return <Agents onStartChat={onStartChat} />;
  if (view === 'admin') return <Admin />;
  if (view === 'settings') return <Settings />;
  // Every other view in this place is the fleet panel, which is where the
  // machines themselves are: it is the first row and the page this place opens
  // on, so it is also the answer to a view that has drifted.
  return <Dashboard onOpenChat={onOpenChat} onNewChat={onNewChat} />;
}
