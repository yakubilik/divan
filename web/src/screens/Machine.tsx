/** The Machine place: everything that is about a computer rather than about
 *  work (HANDOVER §4.9).
 *
 *  Four tabs — Machines, Executors, Terminal, Settings — and under each one the
 *  pages that belong to it, as a row of links (`MACHINE_TABS`). Every page the
 *  old drawer reached is one of them: the remote screen, the sessions and plan
 *  limits, the folders, Admin and the update sit under Machines; the agents on
 *  a computer and the sign-ins they work through under Executors; the quota
 *  thresholds and everything one computer keeps under Settings. The wall of
 *  terminals, the remote screen and this computer's own settings take the
 *  whole width and bring their own scroll.
 */
import { useEffect, useRef } from 'react';
import { MACHINE_TABS, machinePageLabel, machineTab, updateWaiting, type View } from '../lib/shell';
import { useFleet } from '../lib/fleet';
import { signIns, signInsWanting, quotaVerdict, useThresholds } from '../lib/machine';
import type { DivanView } from '../lib/divan';
import { sources, Accounts } from './Accounts';
import { Machines } from './Machines';
import { Executors } from './Executors';
import { Quota } from './Quota';
import { Admin } from './Admin';
import { Settings } from './Settings';
import { Fleet } from './Fleet';
import { Terminal, type TerminalView } from './Terminal';
import { Projects } from './Projects';
import { Agents } from './Agents';
import { Screen } from './Screen';
import { Update } from './Update';
import { Preferences, type SectionId } from './Preferences';
import type { Agent } from '../lib/protocol';

export interface MachineProps {
  view: View;
  /** A page of this place, and which part of it where it has parts. */
  onView: (view: View, part?: string | null) => void;
  /** Which part of the page is open (`Place.sub`): the Terminal's wall, a
   *  section of one computer's settings. Held above, in the address. */
  sub?: string | null;
  onSub?: (part: string | null) => void;
  /** The merged fleet, for the one thing this place says out loud: whether every
   *  machine is answering. */
  fleet: DivanView;
  onOpenChat: (hostKey: string, chatId: string) => void;
  onNewChat: () => void;
  onNewChatIn: (cwd: string) => void;
  onStartChat: (agent: Agent, accountId: string | null) => void;
  onPeek: (hostKey: string, chatId: string) => void;
  /** The ticket open on the queue's wall: a chat's card link, or a tile. */
  ticket?: number | null;
  onTicket?: (id: number | null) => void;
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

/** The pages that stand in this place's own page column, which carries their
 *  scroll and their padding. Everything else here takes the whole width and
 *  brings its own: the wall of terminals, the picture of a remote screen, and
 *  the seven sections of one computer's own settings. */
const DRAWN_HERE = new Set<View>([
  'machines', 'executors', 'accounts', 'quota', 'admin', 'settings',
  'fleet', 'projects', 'agents', 'update',
]);

/** HANDOVER §4.9: four tabs — Computers · Accounts · Terminal · Settings — each
 *  at its own path (`/machine/<tab>`), and every other page the drawer used to
 *  list sitting in a row of links under the tab it is about (`MACHINE_TABS`).
 *  Nothing the drawer reached is gone; the marks it carried (an approval on the
 *  wall, a sign-in expiring, a thin plan, an update in hand) are on the tab and
 *  on the link they are about. */
export function Machine(props: MachineProps) {
  const { view, onView, fleet } = props;
  const { hosts, order } = useFleet();
  const refreshAccounts = useFleet((s) => s.refreshAccounts);
  const { thresholds } = useThresholds();
  /** Which computers have been asked which sign-ins they have. */
  const put = useRef(new Set<string>());

  // Entering the place asks every computer which sign-ins it has — once, and
  // once means once even when the answer never comes: an empty list is what a
  // refusal looks like as well as a question nobody has put, and re-asking on
  // that would be a CLI shell-out on that machine every round trip.
  const online = order.filter((k) => hosts[k]?.status === 'online').join(',');
  useEffect(() => {
    const live = online ? online.split(',') : [];
    for (const key of [...put.current]) if (!live.includes(key)) put.current.delete(key);
    for (const key of live) {
      if (put.current.has(key) || useFleet.getState().hosts[key]?.accounts.length) continue;
      put.current.add(key);
      refreshAccounts(key).catch(() => {});
    }
  }, [online, refreshAccounts]);
  const unreachable = fleet.hosts.filter((h) => !h.reachable).length;
  const approvals = order.reduce(
    (n, k) => n + (hosts[k]?.chats.filter((c) => c.status === 'awaiting_approval').length ?? 0), 0);
  const update = order.some((k) => updateWaiting(hosts[k]?.info?.update));
  const expiring = signInsWanting(
    signIns(sources(hosts, order), fleet.now, () => '', () => ''));
  const quota = quotaVerdict(fleet.quota, thresholds);
  const thin = quota.state === 'warn' || quota.state === 'stop' || quota.state === 'spent';

  /** What wants a person on one page, as the mark beside its name. */
  const mark = (v: View): { count?: number; dot?: boolean; red?: boolean } => (
    v === 'machines' && unreachable > 0 ? { dot: true, red: true }
      : v === 'terminal' && approvals > 0 ? { count: approvals }
        : v === 'accounts' && expiring > 0 ? { count: expiring }
          : v === 'quota' && thin ? { dot: true }
            : (v === 'admin' || v === 'update') && update ? { dot: true }
              : {});
  const tab = machineTab(view);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* The tabs first and on their own line, the pages under the open tab on
          a quieter line beneath them: two levels that read as two levels. */}
      <div style={{ flex: 'none', padding: '8px 32px 0' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="dv-seg" role="group" aria-label="Machine">
            {MACHINE_TABS.map((t) => {
              const wants = t.pages.map(mark).find((m) => m.count || m.dot);
              return (
                <button key={t.key} type="button" className="dv-hit" aria-pressed={t.key === tab.key}
                  onClick={() => { if (t.key !== tab.key || view !== t.pages[0]) onView(t.pages[0]); }}>
                  {t.label}
                  {!!wants && <Mark red={wants.red} />}
                </button>
              );
            })}
          </div>
          {tab.key !== 'machines' && <ComputerPicker />}
          </div>
          {tab.pages.length > 1 && (
            <nav aria-label={`Under ${tab.label}`} className="dv-subnav">
              {tab.pages.map((v) => {
                const m = mark(v);
                return (
                  <a key={v} href={`/machine/${v}`} className="dv-hit"
                    aria-current={v === view ? 'page' : undefined}
                    onClick={(e) => { e.preventDefault(); if (v !== view) onView(v); }}>
                    <span>{machinePageLabel(v)}</span>
                    {!!m.count && <b className="dv-badge" aria-label={`${m.count} want you`}>{m.count}</b>}
                    {!!m.dot && <Mark red={m.red} />}
                  </a>
                );
              })}
            </nav>
          )}
        </div>
      </div>
      {DRAWN_HERE.has(view) ? (
        <div data-machine-page style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 32px 80px' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0, maxWidth: 1080, margin: '0 auto',
          }}>
            <Page {...props} />
          </div>
        </div>
      ) : (
        <div data-machine-page style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', paddingTop: 12 }}>
          <Page {...props} />
        </div>
      )}
    </div>
  );
}

/** Which computer the tab is about, on every tab but Computers (Yakup, 7 Nov
 *  2026: "pick any computer and see only its accounts, or add one there").
 *  It is the fleet's focus, so the address, the Terminal, Settings and This
 *  computer all follow it. With one computer there is nothing to pick, and
 *  its name is said instead. */
function ComputerPicker() {
  const { hosts, order, focus, setFocus } = useFleet();
  const held = (focus && hosts[focus]) ? focus : order[0] ?? null;
  if (!order.length) return null;
  const name = (k: string) => hosts[k]?.info?.name?.replace(/\.local$/, '') || hosts[k]?.cfg.name || k;
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="dv-meta">computer</span>
      <div className="dv-seg" role="group" aria-label="Computer">
        {order.map((k) => {
          const off = hosts[k]?.status !== 'online';
          return (
            <button key={k} type="button" className="dv-hit" aria-pressed={k === held}
              title={off ? `${name(k)} is not answering` : undefined}
              onClick={() => { if (k !== held) setFocus(k); }}>
              <i className={`dv-dot ${off ? 'dv-dot--stuck' : 'dv-dot--run'}`} aria-hidden="true" />
              {name(k)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The dot beside a tab or a page: amber where something wants a person, red
 *  where a machine cannot be reached — and the word for it, for a reader who
 *  cannot see the colour. */
function Mark({ red }: { red?: boolean }) {
  return (
    <>
      <i className={`dv-dot ${red ? 'dv-dot--stuck' : 'dv-dot--ask'}`} aria-hidden="true" />
      <span className="dv-hidden">{red ? 'unreachable' : 'needs you'}</span>
    </>
  );
}

function Page(props: MachineProps) {
  const { view, onView, fleet, onOpenChat, onNewChat, onNewChatIn, onStartChat, onPeek } = props;
  const setFocus = useFleet.getState().setFocus;
  // The computer the picker over the page holds.
  const fs = useFleet.getState();
  const only = (fs.focus && fs.hosts[fs.focus]) ? fs.focus : fs.order[0] ?? null;
  const onlyName = only ? (fs.hosts[only]?.info?.name || fs.hosts[only]?.cfg.name || only) : null;
  if (view === 'executors') return <Executors view={fleet} onView={onView} machine={onlyName} />;
  if (view === 'terminal') {
    return (
      <Terminal onPeek={onPeek} onNewChat={onNewChat} ticket={props.ticket}
        source={props.onSub ? (props.sub ?? 'shell') as TerminalView : undefined}
        onSource={props.onSub && ((s) => props.onSub!(s === 'shell' ? null : s))}
        onTicket={props.onTicket} />
    );
  }
  if (view === 'screen') return <Screen />;
  if (view === 'accounts') {
    return <Accounts now={fleet.now} onView={onView} onFocus={setFocus} only={only} />;
  }
  if (view === 'quota') return <Quota view={fleet} />;
  if (view === 'admin') return <Admin now={fleet.now} onView={onView} />;
  if (view === 'settings') return <Settings onView={onView} onSection={(s) => onView('preferences', s)} />;
  if (view === 'fleet') return <Fleet onOpenChat={onOpenChat} onNewChat={onNewChat} />;
  if (view === 'projects') return <Projects onNewChatIn={onNewChatIn} onOpenChat={onOpenChat} />;
  if (view === 'agents') return <Agents onStartChat={onStartChat} />;
  if (view === 'update') return <Update />;
  if (view === 'preferences') {
    return props.onSub
      ? <Preferences section={(props.sub ?? 'accounts') as SectionId}
          onSection={(s) => props.onSub!(s === 'accounts' ? null : s)} />
      : <Preferences />;
  }
  // Every other view in this place is the machines themselves: it is the first
  // row and the page this place opens on, so it is also the answer to a view
  // that has drifted.
  return <Machines view={fleet} onView={onView} onFocus={setFocus} />;
}
