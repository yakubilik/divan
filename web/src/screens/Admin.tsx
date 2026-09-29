/** Admin: what is under this installation rather than in front of it — the
 *  update, the logs, the keys, the folders an agent may open and what it has all
 *  cost.
 *
 *  Web15 W17 is a list of cards, each one a thing, a grey line saying what it
 *  is, a word for where it stands and one button. That shape is here exactly;
 *  what the rows are is the difference.
 *
 *  TODO(daemon): four of the frame's rows have nothing behind them and are left
 *  off rather than faked — nightly backups to a cloud (there is no cloud and no
 *  backup request), agent logs kept ninety days and offered as a download (the
 *  wall has them, the daemon has no export), data retention as a setting, and a
 *  monthly agent budget in euros. `Remove a project` is left off for the same
 *  reason: `divan.project.delete` does not exist. What is here instead is every
 *  administrative fact this panel can actually answer, and each row's button
 *  opens the page that does that job.
 */
import { cost } from '../lib/format';
import { adminLines, signIns, signInsWanting, type AdminSource } from '../lib/machine';
import { sources } from './Accounts';
import { useFleet } from '../lib/fleet';
import { updateWaiting, type View } from '../lib/shell';
import { T } from '../lib/theme';
import { Button, Card, EmptyState, Row, SectionHeader, Tag } from '../ui/divan';
import { glyph } from '../ui/kit';

export function Admin({ now, onView }: { now: number; onView: (view: View) => void }) {
  const hosts = useFleet((s) => s.hosts);
  const order = useFleet((s) => s.order);
  const focus = useFleet((s) => s.focus);
  const slot = (focus && hosts[focus]) || (order.length ? hosts[order[0]] : null);

  if (!slot) {
    return (
      <EmptyState
        title="Nothing to administer yet."
        body="Admin is about a computer: what it is running, what it keeps and what it lets an
              agent open. Pair one under Machines."
        actions={<Button label="Machines" onClick={() => onView('machines')} />}
      />
    );
  }

  const rows = signIns(sources(hosts, order), now, () => '', () => '');
  const source: AdminSource = {
    machine: slot.info?.name || slot.cfg.name,
    online: slot.status === 'online',
    behind: slot.info?.update?.behind ?? 0,
    webStale: slot.info?.update?.web?.stale === true,
    update: updateWaiting(slot.info?.update),
    version: slot.info?.release?.version || slot.info?.daemon_version || '',
    roots: slot.info?.roots?.length ?? 0,
    signIns: rows.length,
    wantingSignIns: signInsWanting(rows),
    chats: slot.chats.length,
    spend: slot.chats.reduce((n, c) => n + (c.total_cost_usd || 0), 0),
    folders: slot.projects.length,
  };

  return (
    <>
      <SectionHeader
        kind="page" title="Admin" note="the update, the logs, the keys and the folders"
        right={source.machine}
      />

      <Card inset={false} style={{ padding: '4px 0' }}>
        {adminLines(source, cost).map((line, i) => (
          <Row
            key={line.key} first={i === 0}
            icon={glyph(ICON[line.key] ?? 'layout')}
            title={line.title} note={line.note}
            right={
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Tag label={line.says} tone={line.tone} />
                <Button small face="outline" label={line.action}
                  onClick={() => onView(line.goes as View)} />
              </span>
            }
          />
        ))}
      </Card>

      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, maxWidth: 560 }}>
        Everything above is on {source.machine} itself. The panel reads it and asks that
        computer to change it; nothing about it is kept here or anywhere else.
      </div>
    </>
  );
}

const ICON: Record<string, string> = {
  update: 'download', logs: 'terminal', keys: 'key',
  folders: 'folder', roots: 'shield', spend: 'bolt',
};
