/** Accounts & sign-ins: what the agents work through, and which of them stops
 *  working soon.
 *
 *  Web15 W16. Five columns — the account, its state, what uses it, when it last
 *  did, and the one button worth having at the end — with the sign-in that is
 *  expiring lifted to the top of the table in amber, and the same amber counted
 *  on the drawer's own row so that it is visible from the other seven pages.
 *  **That is the whole point of this page:** a sign-in that has already expired
 *  is a morning of failed turns, and the only moment worth saying so is before
 *  it happens.
 *
 *  The frame draws seven services — GitHub, App Store Connect, Stripe, Search
 *  Console — because that is the fleet Divan is heading for. This panel's
 *  sign-ins are the ones its agents actually work through: the Claude and Codex
 *  accounts on each paired computer, as `account.list` reports them. A computer
 *  that says when one of them runs out (`CliAccount.expires_at`) gets the amber
 *  countdown; one that does not say is drawn as connected rather than as
 *  something with an invented date on it.
 *
 *  Renewing is signing in again, which is a pty on that computer and lives
 *  where it always has — one level down, under Settings › This computer. The
 *  button goes there with the computer already chosen.
 */
import { useEffect } from 'react';
import { ago } from '../lib/format';
import { signIns, signInsWanting, type SignInSource } from '../lib/machine';
import { useFleet } from '../lib/fleet';
import { uptime } from '../lib/format';
import { T } from '../lib/theme';
import type { View } from '../lib/shell';
import {
  Button, Card, Cell, EmptyState, NameCell, SectionHeader, Table, Tag, type Column,
} from '../ui/divan';
import { mono } from '../ui/kit';

const COLUMNS: Column[] = [
  { width: '36px' },
  { label: 'account', width: 'minmax(0, 1.2fr)' },
  { label: 'state', width: '150px' },
  { label: 'used by', width: 'minmax(0, 1fr)' },
  { label: 'last used', width: '110px' },
  { width: '110px' },
];

/** What the screens need out of the fleet store to say anything here. Built
 *  from the slots so that `lib/machine.ts` never has to know there is a store. */
export function sources(hosts: ReturnType<typeof useFleet.getState>['hosts'],
                        order: string[]): SignInSource[] {
  return order.filter((k) => hosts[k]).map((k) => {
    const slot = hosts[k];
    return {
      hostKey: k,
      machine: slot.info?.name || slot.cfg.name || k,
      online: slot.status === 'online',
      accounts: slot.accounts,
      limits: slot.limits,
      chats: slot.chats,
    };
  });
}

export function Accounts({ now, onView, onFocus }: {
  now: number;
  onView: (view: View) => void;
  onFocus: (hostKey: string) => void;
}) {
  const hosts = useFleet((s) => s.hosts);
  const order = useFleet((s) => s.order);
  const refreshAccounts = useFleet((s) => s.refreshAccounts);

  // `account.list` shells out to both CLIs and is never part of the connect
  // path, so the page that needs it asks for it — once per computer that is
  // online, when it is opened.
  const online = order.filter((k) => hosts[k]?.status === 'online').join(',');
  useEffect(() => {
    for (const key of online ? online.split(',') : []) void refreshAccounts(key);
  }, [online, refreshAccounts]);

  const list = sources(hosts, order);
  const rows = signIns(list, now, uptime, ago);
  const wanting = signInsWanting(rows);
  const loading = order.some((k) => hosts[k]?.loading.accounts);

  if (!order.length) {
    return (
      <EmptyState
        title="No sign-ins to show."
        body="A sign-in belongs to a paired computer — it is how the agents on it reach a
              model. Pair a computer under Machines and its accounts appear here."
        actions={<Button label="Machines" onClick={() => onView('machines')} />}
      />
    );
  }

  return (
    <>
      <SectionHeader
        kind="page" title="Accounts & sign-ins"
        note={`${rows.length} connected`}
        right={wanting ? `${wanting} want you` : undefined}
        tone={wanting ? 'amber' : undefined}
      />

      <Table
        columns={COLUMNS}
        rows={rows.map((s) => ({
          key: s.key,
          tone: s.tone,
          wash: s.state === 'expiring' || s.state === 'expired',
          cells: [
            <span style={{
              ...mono, flex: 'none', width: 34, height: 34, borderRadius: 9, background: T.s2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, color: T.ink2,
            }}>{s.mark}</span>,
            <NameCell title={s.title} note={s.note} />,
            <Tag label={s.says} tone={s.tone} />,
            <Cell text={s.usedBy} style={{ color: T.ink2 }} />,
            <Cell text={s.lastUsed || 'never'} tone={s.lastUsed ? undefined : 'ink3'} />,
            <span style={{ marginLeft: 'auto' }}>
              <Button
                small face={s.wants ? 'ink' : 'outline'} label={s.action}
                onClick={() => { onFocus(s.hostKey); onView('preferences'); }}
              />
            </span>,
          ],
        }))}
        empty={loading ? 'Asking each computer which accounts it has…'
          : 'No computer has reported an account yet.'}
      />

      <Card>
        <SectionHeader title="Where the keys are" />
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          Every sign-in lives on the computer it belongs to, in that tool's own folder. The
          panel reads whether it works and when it stops working; it never holds one, and
          nothing about a sign-in leaves the machine it is on.
        </div>
      </Card>
    </>
  );
}
