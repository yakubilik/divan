/** Machine › Machines (HANDOVER §4.9): a card per computer — its own name in
 *  mono, online or unreachable, what it is running and when it was last seen —
 *  and beside them the quota ring and who can do work.
 *
 *  A machine that cannot be reached says so in red, in words, and says that
 *  what it last reported may be stale; its buttons are the two worth pressing on
 *  a computer that is not there — ask it again, or let it go. The pairing card
 *  and the rule for a quiet machine stay under the cards. No figure here is
 *  made up: the ring is the fleet's measured share, and with nothing measured
 *  it says so instead.
 */
import { useState } from 'react';
import { uptime } from '../lib/format';
import { STALE_AFTER_S, type DivanView, type HostView } from '../lib/divan';
import {
  ACTION_LABEL, executorLines, machineLines, quotaVerdict, resetsWords, useThresholds,
  type MachineAction,
} from '../lib/machine';
import { useFleet } from '../lib/fleet';
import { parsePairing } from '../lib/actions';
import { useDivanStore } from '../lib/divan';
import { T } from '../lib/theme';
import type { View } from '../lib/shell';
import { Button, Card, EmptyState, Quoted, SectionHeader, Write } from '../ui/divan';

/** How long ago it answered, the way W12 says it: `12s ago` while it is still
 *  seconds, and the panel's own `2h 14m` after that. */
function since(seconds: number | null): string {
  return seconds != null && seconds < 60 ? `${Math.round(seconds)}s` : uptime(seconds);
}

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

  const lines = machineLines(view, since, thresholds);
  const quota = quotaVerdict(view.quota, thresholds);
  const left = view.quota.left != null && !view.quota.unknown ? Math.max(0, Math.min(1, view.quota.left)) : null;
  const low = quota.state === 'warn' || quota.state === 'stop' || quota.state === 'spent';
  const resets = view.quota.resets_at != null ? resetsWords(view.quota.resets_at, view.now) : '';
  const workers = executorLines(view);

  const act = (key: string, action: MachineAction) => {
    if (action === 'remove') {
      if (confirming !== key) { setConfirming(key); return; }
      setConfirming(null);
      removeHost(key);
      return;
    }
    setConfirming(null);
    if (action === 'retry') { void load(key); return; }
    // The three pages that are about one computer, opened with that computer in
    // hand: its wall, its screen and its folders.
    onFocus(key);
    if (action === 'terminal') onView('terminal');
    else if (action === 'screen') onView('screen');
    else onView('projects');
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
      <section>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em' }}>
          Machines
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '22px', color: T.ink2 }}>
          {fleetSentence(view, quota.state)}
        </p>
      </section>

      <div className="dv-cols2" style={{ marginTop: 8 }}>
        <main style={{ gap: 12 }}>
          {lines.map((m) => {
            const h = view.hosts.find((x) => x.key === m.key)!;
            const never = h.missing && h.age == null;
            const says = h.reachable ? 'online' : never ? 'never answered' : 'unreachable';
            return (
              <article key={m.key} className="dv-glass dv-machine" data-machine={m.machine}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="dv-machine-name" style={h.reachable ? undefined : { color: T.ink2 }}>
                    {m.machine}
                  </span>
                  <span className={`dv-status ${h.reachable ? 'dv-status--run' : never ? 'dv-status--idle' : 'dv-status--stuck dv-said'}`}
                    style={{ marginLeft: 'auto' }} data-state={says}>
                    <i aria-hidden="true" />{says}
                  </span>
                </div>
                <p>{runningSentence(view, h)}</p>
                <span className="dv-meta">{seenWords(h)}{m.detail ? ` · ${m.detail}` : ''}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {m.actions.map((a) => (
                    <button key={a} type="button" className={`dv-btn dv-hit${a === 'remove' ? ' dv-btn--danger' : ''}`}
                      aria-label={a === 'remove' ? `Unpair ${m.machine} from this panel` : `${ACTION_LABEL[a]} · ${m.machine}`}
                      onClick={() => act(m.key, a)}>
                      {a === 'remove' && confirming === m.key ? 'Sure?' : ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}

          <Card>
            <SectionHeader title="Pair a new machine" />
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
              Run this on the computer you want to add and paste the link it prints. It appears
              here within a few seconds.
            </div>
            <Quoted>{PAIR_CMD}</Quoted>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Quoted style={{ flex: 1, minWidth: 0 }}>
                <Write
                  value={link} onChange={(v) => { setLink(v); setPairError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
                  label="The pairing link that command printed"
                  placeholder="remoteaichat://pair?host=…"
                />
              </Quoted>
              <Button small label="Pair" onClick={pair} />
            </div>
            {!!pairError && (
              <div style={{ fontSize: 12.5, color: T.amber }}>{pairError}</div>
            )}
          </Card>

          <Card>
            <SectionHeader title="When a machine goes quiet" />
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
              After {Math.round(STALE_AFTER_S / 60)} minutes without an answer it is drawn as
              unreachable, with what it last said. Nothing is moved to another machine: what it
              was doing, it is still doing.
            </div>
          </Card>
        </main>

        <aside style={{ gap: 24 }}>
          <section data-quota>
            <div className="dv-sec"><h3>Quota</h3>{!!resets && <span className="dv-meta">{resets}</span>}</div>
            <div className="dv-glass dv-quota">
              {left != null ? (
                <>
                  <span className={`dv-ring${low ? ' dv-ring--low' : ''}`} aria-hidden="true"
                    style={{ ['--p' as any]: `${Math.round(left * 100)}%` }} />
                  <div>
                    <div style={{ font: '500 20px/24px var(--font-mono)' }}>
                      {Math.round(left * 100)}%
                      {low && <span style={{ color: T.amber, fontFamily: 'var(--font-sans)', fontSize: 13, marginLeft: 8 }}>low</span>}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: '19px', color: T.ink2 }}>left of the plan</div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, lineHeight: '19px', color: T.ink2 }}>
                  {quota.state === 'spent' ? 'No quota left. Agents pick up again at reset.' : 'No plan window measured yet.'}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <span className="dv-meta" style={{ alignSelf: 'center' }}>
                warn {Math.round(thresholds.warn * 100)}% · stop {Math.round(thresholds.stop * 100)}%
              </span>
              <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={() => onView('quota')}>Change</button>
              <button type="button" className="dv-btn dv-btn--ghost dv-hit" onClick={() => onView('fleet')}
                title="Every session running anywhere, and the windows each sign-in reports">Plan limits</button>
            </div>
          </section>
          <section>
            <div className="dv-sec"><h3>Executors</h3><span className="dv-meta">{workers.length}</span></div>
            <div className="dv-glass" style={{ borderRadius: 'var(--radius-md)', padding: '2px 14px' }}>
              {workers.map((e) => (
                <div key={e.key} className="dv-live" style={{ padding: '12px 4px' }}>
                  <i className={`dv-dot${e.tone === 'run' ? ' dv-dot--run' : e.tone === 'amber' ? ' dv-dot--ask' : e.tone === 'red' ? ' dv-dot--stuck' : ''}`} aria-hidden="true" />
                  <span className="t">{e.who}</span>
                  <span className="dv-meta" style={e.tone === 'amber' ? { color: T.amber } : undefined}>
                    {[e.machine, e.says].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

/** The one sentence under the title: how many answer, and whether there is
 *  quota to start work on. Nothing about quota where none was measured. */
export function fleetSentence(view: DivanView, quota: string): string {
  const n = view.hosts.length;
  const up = view.hosts.filter((h) => h.reachable).length;
  const head = up === n ? (n === 1 ? 'Reachable.' : `All ${n} reachable.`) : `${up} of ${n} reachable.`;
  const tail = quota === 'ok' ? ' Enough quota to start work.'
    : quota === 'warn' ? ' Quota is low.'
      : quota === 'stop' ? ' Quota is under the stop line: new tickets wait.'
        : quota === 'spent' ? ' No quota left.' : '';
  return head + tail;
}

/** What a machine is running, by name; on one that has gone quiet, what it was
 *  running when it was last heard, and that this may no longer be true. */
export function runningSentence(view: DivanView, h: HostView): string {
  const titles = view.agents.filter((a) => a.host === h.key).map((a) => a.title).filter(Boolean);
  const list = titles.length ? `${titles.length}: ${titles.join(', ')}.` : '';
  if (h.reachable) return list ? `Running ${list}` : 'Nothing running.';
  if (h.missing && h.age == null) return 'It has never answered, so there is nothing to show.';
  return `${list ? `Was running ${list}` : 'Nothing was running.'} What it last reported may be stale.`;
}

/** `seen just now`, `seen 4m ago`, `last seen 3h ago`. */
export function seenWords(h: HostView): string {
  if (h.age == null) return 'never seen';
  const when = h.age < 60 ? 'just now' : `${uptime(h.age)} ago`;
  return h.reachable ? `seen ${when}` : `last seen ${when}`;
}

/** What `pair` is run as on the computer being added. The panel does not print
 *  the token itself — the command does, on that computer — so there is nothing
 *  here to leak. */
const PAIR_CMD = 'remote-ai-chat pair --name Panel';
