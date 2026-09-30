/** Update: what each computer is running, and whether it matches origin/main.
 *
 *  Two things ship from this repository and they come apart on their own. The
 *  daemon is an editable install, so a pull is the update. The panel is build
 *  output that is not in git, so a pull does nothing to it and the browser goes
 *  on being served whatever was built here last. On a computer nobody sits in
 *  front of, the gap is invisible and grows.
 *
 *  So a computer is one card: a head that says which machine and what it is
 *  running, five rows of where it stands, and the notes it has to raise. The
 *  shape is Web15 W17's — a list of rows, each a thing, a grey line saying what
 *  it is, a word for where it stands and one button — one level under Admin,
 *  which is the row that opens it.
 */
import { useCallback, useEffect, useState } from 'react';
import { T } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import { Button, Card, EmptyState, Note, Row, SectionHeader, StatusDot } from '../ui/divan';
import type { Tone } from '../lib/theme';
import { ago, uptime } from '../lib/format';
import { daemonStatus } from '../lib/actions';
import { onAnyEvent, useFleet, type HostSlot } from '../lib/fleet';
import type {
  DaemonStatus, LastUpdate, PanelBuild, Release, Restarting, RestartResult, UpdateResult,
  UpdateStatus,
} from '../lib/protocol';

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
  return packaged ? `v${packaged} (packaged)` : 'no version reported';
}

/** Where one computer stands, as the three sentences worth reading. The tone is
 *  the design's own: green for running, amber for something held, red for
 *  something broken, grey for nothing to say. */
interface Verdict { tone: Tone; text: string }

function daemonVerdict(st: UpdateStatus | null, slot: HostSlot): Verdict {
  if (slot.status !== 'online') return { tone: 'ink3', text: 'offline' };
  if (!st) return { tone: 'ink3', text: 'not checked yet' };
  if (!st.repo) return { tone: 'ink3', text: 'not a git checkout — nothing to update' };
  if (st.local?.dirty) {
    const n = st.local.dirty_files ?? 0;
    return { tone: 'amber', text: `${n} uncommitted file${n === 1 ? '' : 's'} — held` };
  }
  if (st.ahead > 0) return { tone: 'amber', text: `${st.ahead} unpushed commit${st.ahead === 1 ? '' : 's'} — held` };
  if (st.behind > 0) return { tone: 'amber', text: `${st.behind} commit${st.behind === 1 ? '' : 's'} behind origin/main` };
  return { tone: 'run', text: 'on origin/main' };
}

function panelVerdict(web: PanelBuild | null | undefined): Verdict {
  if (!web) return { tone: 'ink3', text: 'not reported' };
  if (!web.built) return { tone: 'red', text: 'never built on this computer' };
  if (!web.npm) return { tone: 'ink3', text: 'no npm here — cannot be rebuilt' };
  if (web.stale === true) return { tone: 'amber', text: web.reason || 'behind the daemon' };
  if (web.stale === null) return { tone: 'amber', text: web.reason || 'built by hand — cannot be placed' };
  return { tone: 'run', text: 'built from this commit' };
}

/** The mono line under a row's title: the facts behind the verdict, in the
 *  order they are worth reading, with nothing standing in for what is missing. */
const detail = (...parts: (string | number | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' · ');

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
  /** What a restart would cost right now, asked before anybody presses it. The
   *  daemon has always been able to say; the panel used to find out afterwards,
   *  from the answer to the restart itself — which is a minute too late to
   *  decide not to. */
  const [cost, setCost] = useState<DaemonStatus | null>(null);
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

  useEffect(() => {
    if (!online) { setCost(null); return; }
    let mine = true;
    daemonStatus(hostKey)
      .then((r) => { if (mine) setCost(r?.supervisor ? r : null); })
      // An older daemon has no answer for this, which is not a restart that
      // costs nothing — it is a question that was not answered, and the button
      // says as much as it ever did.
      .catch(() => { if (mine) setCost(null); });
    return () => { mine = false; };
  }, [hostKey, online, slot.info?.started_at, restart?.state]);

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
  const version = versionLabel(st?.release ?? slot.info?.release, slot.info?.daemon_version);

  const origin: Verdict = !online ? { tone: 'ink3', text: 'not asked while offline' }
    : st?.error ? { tone: 'red', text: 'unreachable' }
      : st?.remote ? { tone: 'run', text: 'reachable' }
        : { tone: 'ink3', text: 'not checked yet' };

  return (
    <Card inset={false}>
      <Row
        first
        lead={<StatusDot state={online ? 'running' : 'quiet'} hollow={!online} />}
        title={name} mark
        note={detail(version, !online ? 'offline'
          : slot.info ? `up ${uptime(slot.info.uptime_s)}` : 'no uptime reported',
          st?.checked_at && `checked ${ago(st.checked_at)}`,
          st?.auto === false && 'auto-update off')}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              small face="outline" label={checking ? 'Checking…' : 'Check'}
              disabled={!online || checking || busy}
              onClick={() => void check(true)}
            />
            <Button
              small face={current || held ? 'outline' : 'ink'}
              label={busy ? 'Updating…' : current ? 'Up to date' : 'Update'}
              disabled={!online || busy || checking || !st?.repo || current || held}
              title={held ? (st?.blockers ?? []).join(' · ') : undefined}
              onClick={apply}
            />
          </span>
        }
      />

      <Row
        icon={P.cpu} title="Daemon" meta={dv.text} tone={dv.tone}
        note={detail(version, local?.commit, local?.branch, local?.subject)}
      />

      <Row
        icon={P.layout} title="Web panel" meta={pv.text} tone={pv.tone}
        note={detail(web?.sha ?? (web?.built ? 'unstamped' : null),
          web?.built_at && `built ${ago(web.built_at)}`,
          web && !web.npm && 'npm missing') || 'this computer has not reported a build'}
      />

      <Row
        icon={IC.cloud} title="origin/main" meta={origin.text} tone={origin.tone}
        note={detail(st?.remote?.commit, st?.latest && `latest ${st.latest}`, st?.remote?.subject)
          || 'nothing has been read from origin yet'}
      />

      <Row
        icon={IC.history} title="Last update"
        meta={!last ? 'never on this computer' : last.error ? 'finished with a problem' : ago(last.at)}
        tone={!last ? 'ink3' : last.error ? 'amber' : 'run'}
        note={last
          ? detail(stamp(last.at), last.pulled && last.from && `${last.from} → ${last.to}`,
            [last.pulled ? 'daemon' : null, last.web ? 'panel' : null].filter(Boolean).join(' + ')
              || 'nothing moved',
            last.version, last.error)
          : 'nothing has been pulled here yet'}
      />

      <Row
        icon={IC.power} title="Last restart"
        meta={slot.info?.started_at ? ago(slot.info.started_at)
          : online ? 'not reported' : 'offline'}
        tone={slot.info?.started_at ? 'run' : 'ink3'}
        note={detail(stamp(slot.info?.started_at),
          slot.info ? `up ${uptime(slot.info.uptime_s)}` : 'no uptime reported',
          // Counted on the way back in, so it is every start this database has
          // ever seen — including the ones an update asked for.
          slot.info?.restarts && `start #${slot.info.restarts}`,
          // …and what pressing the button beside this would cost, before it is
          // pressed: the chats with work in them, and whether anything would
          // bring the daemon back afterwards.
          restartCost(cost))}
        right={draining
          ? <Button small face="outline" label="Cancel" onClick={cancelRestart} />
          : <Button
              small face="outline" label={stopping ? 'Stopping…' : 'Restart'}
              disabled={!online || asking || stopping || busy}
              onClick={() => void ask(false)}
            />}
      />

      {(draining || stopping || restart?.state === 'cancelled' || st?.error || failed
        || (!!blockers.length && !busy) || result) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
          {draining && (
            <Note tone="amber" icon={P.warn} title="Waiting for work to finish"
              body={`${restart!.pending.length} chat${restart!.pending.length === 1 ? '' : 's'} `
                + 'still running. New messages are refused until they are done.'} />
          )}
          {stopping && (
            <Note tone="amber" icon={P.warn} title="Stopping"
              body={(restart?.forced ? 'Turns in flight were interrupted. ' : '')
                + 'The supervisor brings it back in a few seconds.'} />
          )}
          {restart?.state === 'cancelled' && (
            <Note tone="amber" icon={P.warn} title="Restart abandoned"
              body="A chat was still working. Nothing was interrupted." />
          )}
          {st?.error && <Note tone="red" icon={P.warn} title="Could not reach origin" body={st.error} />}
          {failed && <Note tone="red" icon={P.warn} title="That did not work" body={failed} />}
          {!!blockers.length && !busy && (
            <Note tone="amber" icon={P.warn} title="Held" body={blockers.join(' · ')} />
          )}
          {result && (result.ok
            ? <Note tone="run" icon={P.check} title={[
                result.pulled ? `pulled to ${result.revision?.commit ?? 'origin/main'}` : null,
                result.web?.rebuilt ? `panel rebuilt at ${result.web.commit}` : null,
              ].filter(Boolean).join(' · ') || 'nothing to do'}
              body={result.restarting ? 'Restarting — it will come back on its own.' : undefined} />
            : <Note tone="red" icon={P.warn} title="The update stopped" body={result.error} />)}
        </div>
      )}
    </Card>
  );
}

export function Update() {
  const { hosts, order } = useFleet();
  const working = order.some((k) => hosts[k]?.status === 'connecting');

  if (!order.length) {
    return (
      <EmptyState
        title="No computer is paired yet."
        body="An update is a pull on a computer: the daemon it runs and the panel it serves,
              moved together. Pair one under Machines and it appears here with what it is
              running."
        foot="nothing updates by itself · the button on each card is the whole of it"
      />
    );
  }

  return (
    <>
      <SectionHeader
        kind="page" title="Update"
        right={`${order.length} computer${order.length === 1 ? '' : 's'}`}
      />
      <div style={{ fontSize: 14.5, lineHeight: 1.5, color: T.ink2, maxWidth: 620 }}>
        What each computer is running, and whether it matches origin/main. The daemon and the
        panel are updated together — the panel is build output and would otherwise sit behind
        the daemon serving it.
      </div>
      {order.map((k) => hosts[k] && <HostCard key={k} hostKey={k} slot={hosts[k]} />)}
      <div style={{ ...mono, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.ink3 }}>
        {working ? <Spinner size={12} color={T.ink3} /> : <Icon path={IC.refresh} size={12} color={T.ink3} />}
        each card was read from its own computer, one at a time
      </div>
    </>
  );
}

/** What a restart would cost, in the words the row has room for.
 *
 *  Two facts, and both of them change the answer to "shall I press this": how
 *  much work is in flight, and whether anything would start the daemon again.
 *  An unsupervised computer that is restarted from here comes back only if
 *  somebody is sitting at it — that is worth knowing beforehand, and the
 *  daemon has always been able to say it. */
export function restartCost(status: DaemonStatus | null): string | null {
  if (!status) return null;
  const busy = (status.pending ?? []).filter((p) => p.busy).length;
  const queued = (status.pending ?? []).reduce((n, p) => n + (p.queued || 0), 0);
  const parts: string[] = [];
  if (busy) parts.push(`${busy} chat${busy === 1 ? '' : 's'} running`);
  if (queued) parts.push(`${queued} message${queued === 1 ? '' : 's'} queued`);
  if (!parts.length) parts.push('nothing in flight');
  if (status.supervisor?.supervised === false) parts.push('nothing would restart it');
  return parts.join(' · ');
}
