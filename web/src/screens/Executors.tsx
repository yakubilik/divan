/** Who can do work, where they are and what they are on.
 *
 *  Web15 W13 and Web14 W10. Six columns: the worker's own square, what kind of
 *  worker it is, what that kind is for, the machine it is on, what it is doing
 *  right now and whether it can do anything at all. A coder on a machine that
 *  has gone quiet is `unavailable` rather than `busy` — it was working when the
 *  machine was last heard and nobody can say more than that — and the last row
 *  is always you, because the cards nobody can run are work too.
 *
 *  The frame ends on two cards: how many coders a machine may run at once, and
 *  a branch agent being added. Neither is settable from anywhere — the queue
 *  decides how many of its own workers to run and a branch agent is a folder on
 *  a computer — so what is here instead is the one that is true: the agents
 *  installed on this computer, which is the page under this one.
 */
import type { DivanView } from '../lib/divan';
import { executorLines } from '../lib/machine';
import { T } from '../lib/theme';
import type { View } from '../lib/shell';
import {
  Button, Card, Cell, EmptyState, ExecutorBadge, NameCell, SectionHeader, Table, Tag,
  type Column,
} from '../ui/divan';

/** W13's own tracks, bar the last: the frame keeps `40px` at the end for a
 *  `···` menu, and there is nothing to put in one — a row here goes nowhere and
 *  does nothing, so the table is the six columns that say something. */
const COLUMNS: Column[] = [
  { width: '30px' },
  { label: 'executor', width: '110px' },
  { label: 'what it is for', width: 'minmax(0, 1.3fr)' },
  { label: 'machine', width: '90px' },
  { label: 'doing now', width: 'minmax(0, 1.2fr)' },
  { label: 'state', width: '110px' },
];

export function Executors({ view, onView }: {
  view: DivanView;
  onView: (view: View) => void;
}) {
  const lines = executorLines(view);

  if (!view.hosts.length) {
    return (
      <EmptyState
        title="Nobody can do anything yet."
        body="An executor is a worker on a paired computer — a coder, a branch agent, the
              assistant — and there is no computer here to run one on. Pair one under Machines."
        actions={<Button label="Machines" onClick={() => onView('machines')} />}
      />
    );
  }

  return (
    <>
      <SectionHeader
        kind="page" title="Executors" note={`${lines.length} · who can do work`}
      />

      <Table
        columns={COLUMNS}
        rows={lines.map((e) => ({
          key: e.key,
          cells: [
            <ExecutorBadge executor={e.face} />,
            <NameCell title={e.who} />,
            <Cell text={e.kind} style={{ fontSize: 12.5 }} />,
            <Cell text={e.machine || '—'} />,
            <Cell text={e.doing} style={{ color: T.ink2 }} />,
            <Tag label={e.says} tone={e.tone} />,
          ],
        }))}
        empty="Nothing is installed and nothing is running."
      />

      <Card>
        <SectionHeader title="Agents on this computer" />
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          A branch agent is a folder on a computer: what is installed there is what can be
          asked for by name. The store, and what each of them is, is one level down.
        </div>
        <div>
          <Button small face="outline" label="Open" onClick={() => onView('agents')} />
        </div>
      </Card>
    </>
  );
}
