/** The machines count on the top line, and the box a press on it opens.
 *
 *  Drawn the way the Inbox bell is: the count stays where it was, and a press
 *  opens a panel under it instead of leaving the page. One row per paired
 *  machine — its name, whether it answers, what it runs and when it last said
 *  anything — with the switch the sidebar's computer card has, and a way on to
 *  the Machines page at the foot. Outside click and Escape close it. */
import { useEffect, useRef, useState } from 'react';
import type { DivanView, HostView } from '../lib/divan';
import { useFleet } from '../lib/fleet';
import { ago } from '../lib/format';
import { T, SHADOW } from '../lib/theme';
import { mono } from '../ui/kit';

/** What a machine is running, as one quiet line: the system it said it is,
 *  and how many agents it has going. */
export function runningLine(h: HostView): string {
  const os = [h.os, h.osVersion].filter(Boolean).join(' ');
  const agents = h.missing ? '' : h.running ? `${h.running} running` : 'nothing running';
  return [os, agents].filter(Boolean).join(' · ');
}

export function MachinesMenu({ fleet, here, needsYou, onAll }: {
  fleet: DivanView;
  /** The Machine place is the page being read. */
  here: boolean;
  needsYou?: boolean;
  /** The Machines page, from the box's foot. */
  onAll: () => void;
}) {
  const focus = useFleet((s) => s.focus);
  const allHosts = useFleet((s) => s.allHosts);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const t = fleet.totals;
  const all = t.machines > 0 && t.reachable === t.machines;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  // The sidebar's computer card does exactly this when a computer is picked.
  const switchTo = (key: string) => {
    const f = useFleet.getState();
    f.setAllHosts(false);
    f.setFocus(key);
    setOpen(false);
  };

  return (
    <div ref={box} style={{ position: 'relative', flex: 'none' }}>
      <button type="button" className="dv-btn dv-btn--ghost dv-hit" data-sys="machines"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        aria-current={here ? 'page' : undefined} aria-expanded={open} aria-haspopup="dialog"
        title="Machines" onClick={() => setOpen((o) => !o)}>
        <i className={`dv-dot ${all ? 'dv-dot--run' : t.reachable ? 'dv-dot--ask' : 'dv-dot--stuck'}`} aria-hidden="true" />
        <b>{t.reachable}/{t.machines}</b><span className="sys-word"> machines</span>
        {needsYou && <><i className="dv-dot dv-dot--ask" aria-hidden="true" /><span className="dv-hidden">needs you</span></>}
      </button>
      {open && (
        <div role="dialog" aria-label="Machines" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 40, width: 420,
          maxHeight: '70vh', overflowY: 'auto', borderRadius: 14, background: T.s1,
          boxShadow: SHADOW.drawer, padding: 6,
        }}>
          {fleet.hosts.map((h, i) => {
            const current = !allHosts && focus === h.key;
            const seen = h.at != null ? ago(h.at) : '';
            return (
              <div key={h.key} data-machine={h.key} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderTop: i ? `1px solid ${T.line}` : undefined,
              }}>
                <i className={`dv-dot ${h.reachable ? 'dv-dot--run' : 'dv-dot--stuck'}`} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{
                      fontSize: 14, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{h.machine}</span>
                    <span data-state="" style={{ fontSize: 12, color: h.reachable ? T.run : T.red }}>
                      {h.reachable ? 'online' : 'unreachable'}
                    </span>
                  </div>
                  <div style={{
                    ...mono, fontSize: 11, color: T.ink3, marginTop: 3, lineHeight: 1.45,
                  }}>
                    {[runningLine(h), seen ? `seen ${seen === 'now' ? 'just now' : seen === 'yesterday' ? seen : `${seen} ago`}` : 'never seen']
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {current ? (
                  <span style={{ fontSize: 12, color: T.ink3, flex: 'none' }}>Current</span>
                ) : (
                  <button type="button" className="dv-btn dv-btn--ghost dv-hit" data-switch={h.key}
                    style={{ flex: 'none' }} aria-label={`Switch to ${h.machine}`}
                    onClick={() => switchTo(h.key)}>Switch</button>
                )}
              </div>
            );
          })}
          <div style={{ borderTop: `1px solid ${T.line}`, marginTop: 2, padding: '6px 6px 2px' }}>
            <button type="button" className="dv-btn dv-btn--ghost dv-hit" data-all-machines=""
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => { setOpen(false); onAll(); }}>All machines</button>
          </div>
        </div>
      )}
    </div>
  );
}
