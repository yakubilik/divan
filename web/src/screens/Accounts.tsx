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
 *
 *  Nothing here asks for `account.list`: the place around this page does, on
 *  the way in (`screens/Machine.tsx`), because the amber count belongs to the
 *  drawer as much as to this table and a page that asked for it itself would be
 *  a page you had to open before the warning existed.
 */
import { useEffect, useState } from 'react';
import { ago, uptime } from '../lib/format';
import { installTool, poolGet, poolSet } from '../lib/actions';
import { onAnyEvent } from '../lib/fleet';
import { signIns, signInsWanting, type SignInSource } from '../lib/machine';
import { useFleet } from '../lib/fleet';
import { T } from '../lib/theme';
import type { View } from '../lib/shell';
import type { PoolView, Provider } from '../lib/protocol';
import {
  Button, Card, Cell, Choice, EmptyState, NameCell, SectionHeader, Table, Tag, type Column,
} from '../ui/divan';
import { mono } from '../ui/kit';
import { Ring } from '../components/LimitsRing';
import { ProviderMark } from '../components/Sidebar';

/** How long a sign-in has left, said the way W16 says it — `12 days` — and in
 *  the panel's own `2h 14m` once there are hours rather than days left, which
 *  is the point at which the hours are what you want to know. */
function left(seconds: number | null): string {
  const days = seconds == null ? 0 : Math.floor(seconds / 86_400);
  return days ? `${days} day${days === 1 ? '' : 's'}` : uptime(seconds);
}

/** W16's own tracks, exactly. */
const COLUMNS: Column[] = [
  { width: '36px' },
  { label: 'account', width: 'minmax(0, 1.2fr)' },
  { label: 'state', width: '150px' },
  // The plan's own figure, which this page could not say at all: a sign-in
  // that is connected and nine-tenths spent used to read exactly like one
  // nobody had touched.
  { label: 'plan used', width: '96px' },
  { label: 'used by', width: 'minmax(0, 1fr)' },
  { label: 'last used', width: '120px' },
  { width: '150px' },
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
      versions: slot.info?.versions ?? null,
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

  const [installing, setInstalling] = useState<string | null>(null);
  const [said, setSaid] = useState<{ key: string; line: string } | null>(null);

  // What the installer prints, as it prints it: the daemon streams it, and a
  // button that said `Installing…` for ninety seconds with nothing under it is
  // a button nobody believes.
  useEffect(() => onAnyEvent((_k, ev) => {
    if (ev.event !== 'tool.install.output') return;
    const line = String((ev.data as any)?.line ?? '').trim();
    if (line) setSaid((was) => (was ? { ...was, line } : was));
  }), []);

  const install = async (hostKey: string, key: string, provider: Provider) => {
    setInstalling(key);
    setSaid({ key, line: 'asking that computer to install it…' });
    try {
      const r = await installTool(hostKey, provider);
      setSaid({ key, line: r.already ? 'it was already there' : `installed ${r.version ?? ''}`.trim() });
      await useFleet.getState().refreshAccounts(hostKey);
    } catch (e: any) {
      setSaid({ key, line: e?.message ?? 'that did not work' });
    } finally {
      setInstalling(null);
    }
  };

  const list = sources(hosts, order);
  const rows = signIns(list, now, left, ago);
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
        note={`${rows.filter((r) => r.state === 'connected').length} of ${rows.length} connected`}
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
            <ProviderMark provider={s.provider} size={34} dim={s.state === 'missing' || s.state === 'signedOut'} />,
            <NameCell title={s.title} note={s.note} />,
            <Tag label={s.says} tone={s.tone} />,
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Ring share={s.used} size={22} stroke={3}
                colour={s.spent ? T.red : undefined} />
              <span style={{ ...mono, fontSize: 12, color: s.used == null ? T.ink3 : T.ink2 }}>
                {s.used != null ? `${Math.round(s.used * 100)}%`
                  : s.lapsed ? 'reset since' : 'not measured'}
              </span>
            </span>,
            <Cell text={s.usedBy} style={{ color: T.ink2 }} />,
            <Cell text={s.lastUsed || 'never'} tone={s.lastUsed ? undefined : 'ink3'} />,
            <span style={{ marginLeft: 'auto' }}>
              {/* A sign-in is renewed where a sign-in is made — one level
                  down, with the computer already chosen. A *tool* that is not
                  installed is a different job, and it is done from here: the
                  computer runs the installer and says what it printed. */}
              <Button
                small face={s.wants ? 'ink' : 'outline'}
                label={s.state === 'missing' && installing === s.key ? 'Installing…' : s.action}
                onClick={s.state === 'missing'
                  ? () => void install(s.hostKey, s.key, s.provider)
                  : () => { onFocus(s.hostKey); onView('preferences'); }}
              />
            </span>,
          ],
        }))}
        empty={loading ? 'Asking each computer which accounts it has…'
          : 'No computer has reported an account yet.'}
      />

      {!!said && (
        <div style={{ ...mono, fontSize: 11.5, color: T.ink3, padding: '0 2px' }}>
          {said.line}
        </div>
      )}

      <Pool hosts={hosts} order={order} />

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

/** The pool: what happens when a sign-in runs out mid-turn.
 *
 *  It is the one setting on this page that is about *tomorrow morning* rather
 *  than about today: with it on, a chat whose account is spent carries on on
 *  the next one in the order rather than stopping; with it off, the limit is
 *  the limit. The phone has had this since it had accounts; the panel could
 *  read every plan's percentage and not say what the computer would do at the
 *  end of one.
 *
 *  What is offered here is what a person decides — whether it is on, and how
 *  much of a window to leave before handing over. The rest of the pool's
 *  settings (the per-window thresholds, the order, the per-account overage) are
 *  the phone's, and this says so rather than drawing half of them.
 */
function Pool({ hosts, order }: {
  hosts: ReturnType<typeof useFleet.getState>['hosts'];
  order: string[];
}) {
  // One computer's pool: the one in focus, because the pool is a setting of the
  // machine that runs the chats rather than of the fleet.
  const focus = useFleet((s) => s.focus);
  const hostKey = focus && hosts[focus] ? focus : order.find((k) => hosts[k]?.status === 'online') ?? null;
  const slot = hostKey ? hosts[hostKey] : null;
  const [view, setView] = useState<PoolView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hostKey || slot?.status !== 'online') return;
    let mine = true;
    poolGet(hostKey)
      // A computer too old to know the pool answers the way it answers
      // anything it does not know — with nothing in it. That is not a pool
      // that is off, so it is drawn as a question nobody answered.
      .then((r) => { if (mine) { setView(r?.settings ? r : null); setFailed(null); } })
      .catch((e) => { if (mine) setFailed(e?.message ?? 'that computer did not answer'); });
    return () => { mine = false; };
  }, [hostKey, slot?.status]);

  // The daemon tells everybody when the pool moves, including the client that
  // moved it: one answer, one shape, no local copy to drift.
  useEffect(() => onAnyEvent((k, ev) => {
    if (k !== hostKey || ev.event !== 'pool.updated') return;
    const next = ev.data as PoolView;
    if (next?.settings) setView(next);
  }), [hostKey]);

  const set = async (patch: Record<string, any>) => {
    if (!hostKey || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await poolSet(hostKey, patch);
      if (r?.settings) setView(r);
    }
    catch (e: any) { setFailed(e?.message ?? 'that did not reach the computer'); }
    finally { setBusy(false); }
  };

  if (!hostKey) return null;
  const on = !!view?.settings.enabled;
  const threshold = Math.round((view?.settings.threshold ?? 0.9) * 100);
  const blocked = (view?.accounts ?? []).filter((a) => a.blocked);

  return (
    <Card>
      <SectionHeader
        title="When a sign-in runs out"
        note={slot?.info?.name ?? hostKey}
        right={view ? (on ? 'the next sign-in takes over' : 'the turn stops') : undefined}
        tone={on ? 'run' : undefined}
      />
      {failed ? (
        <div style={{ ...mono, fontSize: 11.5, color: T.red }}>{failed}</div>
      ) : !view?.settings ? (
        <div style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>
          {slot?.status === 'online' ? 'this computer has not said what its pool is set to'
            : 'not asked while that computer is offline'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Choice
              label="Whether the pool is on" value={on ? 'on' : 'off'}
              options={[{ key: 'on', label: 'On' }, { key: 'off', label: 'Off' }]}
              onChange={(v) => void set({ enabled: v === 'on' })}
            />
            <span style={{ fontSize: 13, color: T.ink2 }}>hand over at</span>
            <Choice
              label="How much of a window to spend before handing over"
              value={String(threshold)}
              options={[{ key: '70', label: '70%' }, { key: '80', label: '80%' },
                        { key: '90', label: '90%' }]}
              onChange={(v) => void set({ threshold: Number(v) / 100 })}
            />
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
            {on
              ? `A chat that reaches ${threshold}% of a window carries on on the next sign-in in `
                + 'the order instead of stopping. The order, the per-window thresholds and which '
                + 'account may spend past its plan are set on the phone.'
              : 'A chat whose sign-in is spent stops there and says so. Turn this on and the '
                + 'computer moves it to another sign-in of the same tool instead.'}
          </div>
          {!!blocked.length && (
            <div style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>
              {blocked.map((a) => `${a.label} is out${a.until ? ` until ${new Date(a.until * 1000)
                .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`)
                .join(' · ')}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
