/** The first page of the Machine drawer: every paired computer, what it is
 *  running, and how much of its plan is gone.
 *
 *  Web15 W12 and Web14 W10 are this page — the same table at two widths. Five
 *  columns and the row's own buttons: a machine, whether it is answering, when
 *  it last did, what it was running then and what it has spent today. The
 *  machine that cannot be reached is washed in amber and its buttons are the
 *  two that are worth pressing on a computer that is not there — ask it again,
 *  or let it go.
 *
 *  Under the table, the three things W12 says about the fleet as a whole: what
 *  it has left to run an agent on and the thresholds it is read against, how a
 *  new machine is added, and what happens while one of them is quiet. The last
 *  is not a promise — it is the merge's own rule (`STALE_AFTER_S`), written
 *  where somebody looking at a quiet machine will read it.
 *
 *  What the frame offers and this does not: the frame's pairing card counts a
 *  code down (`code expires in 9:41`) and its quiet-machine card offers to move
 *  tasks to another computer by itself. Neither exists — `pair` prints a link
 *  with no clock on it, and nothing moves work between machines — so the card
 *  says how pairing really works and the moving is not offered.
 */
import { useState } from 'react';
import { uptime } from '../lib/format';
import { count } from '../lib/overview';
import { STALE_AFTER_S, type DivanView } from '../lib/divan';
import {
  ACTION_LABEL, machineLines, quotaVerdict, useThresholds,
  type MachineAction,
} from '../lib/machine';
import { useFleet } from '../lib/fleet';
import { parsePairing } from '../lib/actions';
import { useDivanStore } from '../lib/divan';
import { T, type Tone } from '../lib/theme';
import type { View } from '../lib/shell';
import {
  Button, Card, Cell, EmptyState, NameCell, SectionHeader, StatusDot, Table, Tag, Write,
  type Column,
} from '../ui/divan';
import { Icon, P, mono } from '../ui/kit';

const COLUMNS: Column[] = [
  { width: '34px' },
  { label: 'machine', width: 'minmax(0, 1.4fr)' },
  { label: 'state', width: '120px' },
  { label: 'last contact', width: '110px' },
  { label: 'running', width: '100px' },
  { label: 'quota use today', width: '110px' },
  { width: 'minmax(0, 210px)' },
];

export function Machines({ view, onView, onFocus }: {
  view: DivanView;
  /** The three pages that are about one computer are opened from a row, with
   *  that computer in hand. */
  onView: (view: View) => void;
  onFocus: (hostKey: string) => void;
}) {
  const { thresholds } = useThresholds();
  const removeHost = useFleet((s) => s.removeHost);
  const addHost = useFleet((s) => s.addHost);
  const load = useDivanStore((s) => s.load);
  // Letting a computer go is the one thing on this page that cannot be undone,
  // so the button asks first — in place, on the row it is about, rather than in
  // a window over a table of nine others.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);

  const pair = () => {
    const cfg = parsePairing(link);
    if (!cfg) { setPairError('That is not a pairing link. It starts remoteaichat://pair?'); return; }
    setLink('');
    setPairError(null);
    addHost(cfg);
  };

  const lines = machineLines(view, uptime, thresholds);
  const quota = quotaVerdict(view.quota, thresholds);

  const act = (key: string, action: MachineAction) => {
    if (action === 'remove') {
      if (confirming !== key) { setConfirming(key); return; }
      setConfirming(null);
      removeHost(key);
      return;
    }
    setConfirming(null);
    if (action === 'retry') { void load(key); return; }
    onFocus(key);
    onView(action === 'terminal' ? 'terminal' : action === 'screen' ? 'screen' : 'projects');
  };

  if (!view.hosts.length) {
    return (
      <EmptyState
        title="No computer is paired yet."
        body="Divan is the computers you pair with it. Run the pairing command on one and it
              appears here within a few seconds, with everything it is running."
        foot={PAIR_CMD}
      />
    );
  }

  return (
    <>
      <SectionHeader kind="page" title="Machines" note={count(view.hosts.length, 'paired')} />

      <Table
        columns={COLUMNS}
        rows={lines.map((m) => ({
          key: m.key,
          tone: 'amber' as Tone,
          wash: m.wash,
          cells: [
            <span style={{
              flex: 'none', width: 32, height: 32, borderRadius: 9, background: T.s2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon path={P.cpu} size={17} color={T.ink2} /></span>,
            <NameCell mark title={m.machine} note={m.detail || undefined} />,
            <>
              <StatusDot state={m.state} hollow={m.state === 'asking'} />
              <Cell text={m.says} tone={m.tone} />
            </>,
            <Cell text={m.contact || 'never'} tone={m.contact ? undefined : 'ink3'} />,
            <Cell text={m.running} tone={m.wash ? 'amber' : undefined} />,
            <Cell text={m.quota} tone={m.quotaTone} />,
            <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              {m.actions.map((a) => (
                <Button
                  key={a} small face="outline"
                  label={a === 'remove' && confirming === m.key ? 'Sure?' : ACTION_LABEL[a]}
                  title={a === 'remove' ? `Unpair ${m.machine} from this panel` : undefined}
                  onClick={() => act(m.key, a)}
                />
              ))}
            </span>,
          ],
        }))}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <Card>
          <SectionHeader title="Agent quota" right={quota.says} tone={quota.tone} />
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{quota.body}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag label={`warn ${Math.round(thresholds.warn * 100)}%`} tone="ink3" />
            <Tag label={`stop ${Math.round(thresholds.stop * 100)}%`} tone="ink3" />
            <Button small face="outline" label="Change" onClick={() => onView('quota')} />
            <Button small face="outline" label="Plan limits" onClick={() => onView('fleet')}
              title="Every session running anywhere, and the windows each sign-in reports" />
          </div>
        </Card>

        <Card>
          <SectionHeader title="Pair a new machine" />
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
            Run this on the computer you want to add and paste the link it prints. It appears
            here within a few seconds.
          </div>
          <div style={{
            ...mono, fontSize: 12, color: T.ink, background: T.s2,
            padding: '10px 12px', borderRadius: 10, overflowX: 'auto',
          }}>{PAIR_CMD}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              flex: 1, minWidth: 0, ...mono, fontSize: 12, background: T.s2,
              padding: '9px 12px', borderRadius: 10,
            }}>
              <Write
                value={link} onChange={(v) => { setLink(v); setPairError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
                label="The pairing link that command printed"
                placeholder="remoteaichat://pair?host=…"
              />
            </span>
            <Button small label="Pair" onClick={pair} />
          </div>
          {!!pairError && (
            <div style={{ fontSize: 12.5, color: T.amber }}>{pairError}</div>
          )}
        </Card>

        <Card>
          <SectionHeader title="When a machine goes quiet" />
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
            After {Math.round(STALE_AFTER_S / 60)} minutes without an answer its numbers are
            drawn as what they were, its agents show as unknown and its row turns amber.
            Nothing is moved to another machine: what it was doing, it is still doing.
          </div>
        </Card>
      </div>
    </>
  );
}

/** What `pair` is run as on the computer being added. The panel does not print
 *  the token itself — the command does, on that computer — so there is nothing
 *  here to leak. */
const PAIR_CMD = 'remote-ai-chat pair --name Panel';
