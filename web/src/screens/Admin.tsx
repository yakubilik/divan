import { useCallback, useEffect, useState } from 'react';
import { C, R } from '../lib/theme';
import { Btn, Dot, Empty, Icon, P, Spinner, mono } from '../ui/kit';
import { ago, uptime } from '../lib/format';
import { onAnyEvent, useFleet, type HostSlot } from '../lib/fleet';
import type {
  LastUpdate, PanelBuild, Release, Restarting, RestartResult, UpdateResult, UpdateStatus,
} from '../lib/protocol';

/* Two things ship from this repository and they come apart on their own. The
 * daemon is an editable install, so a pull is the update. The panel is build
 * output that is not in git, so a pull does nothing to it and the browser goes
 * on being served whatever was built here last. On a computer nobody sits in
 * front of, the gap is invisible and grows.
 *
 * So this screen is two rows and one button. The rows are what is actually
 * running — the commit, not the version constant, which has said 0.1.0 on both
 * machines for months. The button does both halves, because to whoever pressed
 * it they were never two things. */

const IC = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.6M20 5v6h-6',
  cloud: 'M7 18a4 4 0 0 1 .4-8 5 5 0 0 1 9.5 1.2A3.5 3.5 0 0 1 16.5 18z',
  history: 'M12 4a8 8 0 1 1-7.7 10M12 8v4l3 2M4 5v5h5',
  power: 'M12 4v7M7.5 6.5a7 7 0 1 0 9 0',
};

/** A day and a clock, for the two rows where "3h ago" is not enough — you want
 *  to know whether the restart was last night or during the deploy. */
function stamp(ts: number | null | undefined): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** What this computer calls itself. Falls back to the packaged constant, which
 *  is the honest answer on an install with no git to ask — and is marked as
 *  such, because a constant is exactly what cannot tell two computers apart. */
function versionLabel(rel: Release | null | undefined, packaged: string | undefined): string {
  if (rel?.version) return rel.version + (rel.dirty ? ' · dirty' : '');
  if (rel && rel.commit) return 'untagged';
  return packaged ? `v${packaged} (packaged)` : '—';
}

type Tone = 'ok' | 'warn' | 'danger' | 'idle';

const TONE: Record<Tone, string> = {
  ok: C.ok, warn: C.warn, danger: C.danger, idle: C.faint,
};

/** Where one computer stands, as the three sentences worth reading. */
interface Verdict { tone: Tone; text: string }

function daemonVerdict(st: UpdateStatus | null, slot: HostSlot): Verdict {
  if (slot.status !== 'online') return { tone: 'idle', text: 'offline' };
  if (!st) return { tone: 'idle', text: 'not checked yet' };
  if (!st.repo) return { tone: 'idle', text: 'not a git checkout — nothing to update' };
  if (st.local?.dirty) {
    const n = st.local.dirty_files ?? 0;
    return { tone: 'warn', text: `${n} uncommitted file${n === 1 ? '' : 's'} — held` };
  }
  if (st.ahead > 0) return { tone: 'warn', text: `${st.ahead} unpushed commit${st.ahead === 1 ? '' : 's'} — held` };
  if (st.behind > 0) return { tone: 'warn', text: `${st.behind} commit${st.behind === 1 ? '' : 's'} behind origin/main` };
  return { tone: 'ok', text: 'on origin/main' };
}

function panelVerdict(web: PanelBuild | null | undefined): Verdict {
  if (!web) return { tone: 'idle', text: 'not reported' };
  if (!web.built) return { tone: 'danger', text: 'never built on this computer' };
  if (!web.npm) return { tone: 'idle', text: 'no npm here — cannot be rebuilt' };
  if (web.stale === true) return { tone: 'warn', text: web.reason || 'behind the daemon' };
  if (web.stale === null) return { tone: 'warn', text: web.reason || 'built by hand — cannot be placed' };
  return { tone: 'ok', text: 'built from this commit' };
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Row({ icon, title, verdict, detail, action }: {
  icon: string; title: string; verdict: Verdict; detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
      borderTop: `1px solid ${C.border}`,
    }}>
      <Icon path={icon} size={16} color={C.mute} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</span>
          <Dot color={TONE[verdict.tone]} size={5} />
          <span style={{ fontSize: 12, color: TONE[verdict.tone] }}>{verdict.text}</span>
        </div>
        <div style={{
          ...mono, fontSize: 11, color: C.faint, marginTop: 4,
          display: 'flex', flexWrap: 'wrap', gap: '2px 10px',
        }}>{detail}</div>
      </div>
      {action}
    </div>
  );
}

function Note({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const color = TONE[tone];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, margin: '0 16px 14px',
      padding: '9px 11px', borderRadius: R.btn, fontSize: 12, color,
      background: tone === 'danger' ? C.dangerBg : C.warnBg,
      border: `1px solid ${tone === 'danger' ? C.dangerLine : C.warnLine}`,
    }}>
      <Icon path={P.warn} size={13} color={color} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** One computer. Each card owns its own status and its own button: they update
 *  one at a time, and a machine that is offline or mid-restart must not be able
 *  to freeze the others' rows. */
function HostCard({ hostKey, slot }: { hostKey: string; slot: HostSlot }) {
  const call = useFleet((s) => s.call);
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [restart, setRestart] = useState<Restarting | null>(null);
  const [asking, setAsking] = useState(false);

  const online = slot.status === 'online';
  const name = slot.info?.name || slot.cfg.name;

  const check = useCallback(async (refresh: boolean) => {
    if (!online) return;
    setChecking(true);
    setFailed(null);
    try {
      setSt(await call<UpdateStatus>(hostKey, 'update.status', { refresh }));
    } catch (e: any) {
      // A daemon older than update.status is the likely cause, and it is not
      // an error anyone can act on — it is simply a computer this screen
      // cannot speak to yet.
      setFailed(String(e?.message ?? e));
    } finally {
      setChecking(false);
    }
  }, [call, hostKey, online]);

  // Cheap read on arrival, one round trip to the remote when someone is
  // actually looking at the screen. `check` is the expensive half.
  useEffect(() => { void check(true); }, [check]);

  // The daemon announces on its own schedule too — it is the one holding the
  // fetch loop, and an update it applied by itself should not leave this
  // screen claiming work is still pending.
  useEffect(() => onAnyEvent((k, ev) => {
    if (k !== hostKey) return;
    if (ev.event === 'update.available') setSt((cur) => ({ ...(cur ?? {} as UpdateStatus), ...ev.data }));
    if (ev.event === 'update.applied') void check(false);
    // The daemon narrates its own shutdown. `cancelled` is the one worth
    // clearing on: the machine is staying, and leaving a banner up would say
    // otherwise.
    if (ev.event === 'daemon.restarting') {
      setRestart(ev.data as Restarting);
      if (ev.data?.state === 'cancelled') setTimeout(() => setRestart(null), 6000);
    }
  }), [hostKey, check]);

  // A restart is a gap, not a fault: the socket closes on purpose and comes
  // back a second or two later. Asking early rather than waiting out the
  // reconnect backoff is what makes it read as a blink.
  useEffect(() => {
    if (slot.status === 'online' && restart && restart.state !== 'cancelled') {
      setRestart(null);
      void check(false);
    }
  }, [slot.status]);

  const apply = async () => {
    setApplying(true);
    setResult(null);
    setFailed(null);
    try {
      const r = await call<UpdateResult>(hostKey, 'update.apply', {});
      setResult(r);
      // A pull ends with the daemon exiting, so there is nothing to re-read:
      // the socket is about to drop and the reconnect brings the new commit
      // back by itself. A panel-only rebuild does not restart anything, so
      // that one does need asking again.
      if (!r.restarting) await check(false);
    } catch (e: any) {
      setFailed(String(e?.message ?? e));
    } finally {
      setApplying(false);
    }
  };

  const ask = async (force: boolean) => {
    setAsking(true);
    setFailed(null);
    try {
      const r = await call<RestartResult>(hostKey, 'daemon.restart', { force });
      // Nothing to wait for means it is already going; the event that says so
      // may well lose the race with the socket closing.
      if (!r.draining) setRestart({ state: 'stopping', pending: [], forced: force });
    } catch (e: any) {
      setFailed(String(e?.message ?? e));
    } finally { setAsking(false); }
  };

  const cancelRestart = async () => {
    try { await call(hostKey, 'daemon.restart.cancel', {}); }
    catch (e: any) { setFailed(String(e?.message ?? e)); }
  };

  const draining = restart?.state === 'draining';
  const stopping = restart?.state === 'stopping';

  const local = st?.local;
  const web = st?.web;
  // Either source will do: update.status reads it fresh, host.info carries it
  // from the moment this computer connected. A screen opened before the first
  // check should still say when the machine last moved.
  const last: LastUpdate | null = st?.last_update ?? slot.info?.last_update ?? null;
  const dv = daemonVerdict(st, slot);
  const pv = panelVerdict(web);
  // The daemon row already spells out a dirty tree and unpushed commits, in
  // more detail than a blocker line can. Only what nothing else on the card
  // says is worth a second sentence.
  const blockers = (st?.blockers ?? []).filter(
    (b) => b !== 'already up to date' && b !== 'uncommitted changes' && b !== 'unpushed commits',
  );
  const held = (st?.blockers ?? []).some((b) => b !== 'already up to date');
  const current = !!st && st.repo && st.behind <= 0 && web?.stale === false;
  const busy = applying || !!st?.busy;

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: R.card, background: C.surface,
      overflow: 'hidden', marginBottom: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
      }}>
        <Dot color={online ? C.ok : C.faint} live={online} size={6} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{name}</div>
          <div style={{ ...mono, fontSize: 11, color: C.faint, marginTop: 2 }}>
            {versionLabel(st?.release ?? slot.info?.release, slot.info?.daemon_version)}
            {online ? ` · up ${uptime(slot.info?.uptime_s)}` : ' · offline'}
            {st?.checked_at ? ` · checked ${ago(st.checked_at)}` : ''}
            {st?.auto === false ? ' · auto-update off' : ''}
          </div>
        </div>
        <Btn kind="quiet" onClick={() => void check(true)} disabled={!online || checking || busy}>
          {checking ? <Spinner size={13} color={C.mute} /> : <Icon path={IC.refresh} size={14} color={C.mute} />}
          Check
        </Btn>
        <Btn
          kind={current || held ? 'ghost' : 'primary'}
          onClick={apply}
          disabled={!online || busy || checking || !st?.repo || current || held}
          title={held ? (st?.blockers ?? []).join(' · ') : undefined}
        >
          {busy ? <Spinner size={13} color="currentColor" />
            : <Icon path={current ? P.check : P.download} size={14} color="currentColor" />}
          {busy ? 'Updating…' : current ? 'Up to date' : 'Update'}
        </Btn>
      </div>

      <Row
        icon={P.cpu} title="Daemon" verdict={dv}
        detail={<>
          <span>{versionLabel(st?.release ?? slot.info?.release, slot.info?.daemon_version)}</span>
          <span>{local?.commit ?? '—'}</span>
          <span>{local?.branch ?? ''}</span>
          {local?.subject && (
            <span style={{
              color: C.mute, maxWidth: 420, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{local.subject}</span>
          )}
        </>}
      />

      <Row
        icon={P.layout} title="Web panel" verdict={pv}
        detail={<>
          <span>{web?.sha ?? (web?.built ? 'unstamped' : '—')}</span>
          {web?.built_at ? <span>built {ago(web.built_at)}</span> : null}
          {web && !web.npm ? <span>npm missing</span> : null}
        </>}
      />

      <Row
        icon={IC.cloud} title="origin/main" verdict={
          !online ? { tone: 'idle', text: '—' }
            : st?.error ? { tone: 'danger', text: 'unreachable' }
              : st?.remote ? { tone: 'ok', text: 'reachable' }
                : { tone: 'idle', text: 'not checked yet' }
        }
        detail={<>
          <span>{st?.remote?.commit ?? '—'}</span>
          {st?.latest ? <span>latest {st.latest}</span> : null}
          {st?.remote?.subject && (
            <span style={{
              color: C.mute, maxWidth: 420, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{st.remote.subject}</span>
          )}
        </>}
      />

      <Row
        icon={IC.history} title="Last update" verdict={
          !last ? { tone: 'idle', text: 'never on this computer' }
            : last.error ? { tone: 'warn', text: 'finished with a problem' }
              : { tone: 'ok', text: ago(last.at) }
        }
        detail={last ? <>
          <span>{stamp(last.at)}</span>
          {last.pulled && last.from ? <span>{last.from} → {last.to}</span> : null}
          <span>{[last.pulled ? 'daemon' : null, last.web ? 'panel' : null]
            .filter(Boolean).join(' + ') || 'nothing moved'}</span>
          {last.version ? <span>{last.version}</span> : null}
          {last.error ? <span style={{ color: C.warn }}>{last.error}</span> : null}
        </> : <span>nothing has been pulled here yet</span>}
      />

      <Row
        icon={IC.power} title="Last restart" action={
          draining ? (
            <Btn kind="ghost" onClick={cancelRestart}>
              <Spinner size={13} color={C.warn} />
              Cancel
            </Btn>
          ) : (
            <Btn kind="ghost" onClick={() => void ask(false)}
                 disabled={!online || asking || stopping || busy}>
              <Icon path={IC.power} size={14} color={C.mute} />
              {stopping ? 'Stopping…' : 'Restart'}
            </Btn>
          )
        } verdict={
          slot.info?.started_at
            ? { tone: 'ok', text: ago(slot.info.started_at) }
            : { tone: 'idle', text: online ? 'not reported' : 'offline' }
        }
        detail={<>
          <span>{stamp(slot.info?.started_at) || '—'}</span>
          <span>up {uptime(slot.info?.uptime_s)}</span>
          {/* Counted on the way back in, so it is every start this database has
              ever seen — including the ones an update asked for. */}
          {slot.info?.restarts ? <span>start #{slot.info.restarts}</span> : null}
        </>}
      />

      <div style={{ paddingTop: 14 }}>
        {draining && (
          <Note tone="warn">
            Waiting for {restart!.pending.length} chat
            {restart!.pending.length === 1 ? '' : 's'} to finish before stopping.
            New messages are refused until it does.
          </Note>
        )}
        {stopping && (
          <Note tone="warn">
            Stopping{restart?.forced ? ' — turns in flight were interrupted' : ''}. The
            supervisor brings it back in a few seconds.
          </Note>
        )}
        {restart?.state === 'cancelled' && (
          <Note tone="warn">
            Restart abandoned — a chat was still working. Nothing was interrupted.
          </Note>
        )}
        {st?.error && <Note tone="danger">Could not reach origin: {st.error}</Note>}
        {failed && <Note tone="danger">{failed}</Note>}
        {!!blockers.length && !busy && <Note tone="warn">Held: {blockers.join(' · ')}</Note>}
        {result && (
          result.ok ? (
            <div style={{
              margin: '0 16px 14px', padding: '9px 11px', borderRadius: R.btn,
              fontSize: 12, color: C.ok, background: C.okBg,
              border: `1px solid ${C.okLine}`,
            }}>
              {[
                result.pulled ? `pulled to ${result.revision?.commit ?? 'origin/main'}` : null,
                result.web?.rebuilt ? `panel rebuilt at ${result.web.commit}` : null,
              ].filter(Boolean).join(' · ') || 'nothing to do'}
              {result.restarting ? ' · restarting, it will come back on its own' : ''}
            </div>
          ) : <Note tone="danger">{result.error}</Note>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── screen ───────────────────────────── */

export function Admin() {
  const { hosts, order } = useFleet();

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 20px 40px' }}>
        <div style={{ marginBottom: 6, fontSize: 18, fontWeight: 600, color: C.text }}>Admin</div>
        <div style={{ fontSize: 13, color: C.mute, marginBottom: 18, lineHeight: 1.5 }}>
          What each computer is running, and whether it matches origin/main. The
          daemon and the panel are updated together — the panel is build output
          and would otherwise sit behind the daemon serving it.
        </div>
        {order.length
          ? order.map((k) => hosts[k] && <HostCard key={k} hostKey={k} slot={hosts[k]} />)
          : <Empty title="No computer paired yet" hint="Pair one from Settings first." />}
      </div>
    </div>
  );
}
