/** How much of a plan this chat's sign-in has spent, on the chat's own head.
 *
 *  The phone has had this since it had accounts (`app/src/components/
 *  limits.tsx`) and the panel did not, so the one screen you sit in front of
 *  all day was the one that could not tell you a weekly limit was nearly gone.
 *  This is that ring, drawn with the panel's own parts.
 *
 *  **A ring and not a bar.** The figure is a share of something whole, the head
 *  is a row of chips, and a bar long enough to read would have cost the title
 *  its room. The number lives in the middle of the ring so the chip is legible
 *  at a glance and exact on a second look.
 *
 *  **Empty is not zero.** The tool only measures during a turn, so a sign-in
 *  nobody has spent has no reading at all — the ring is drawn hollow with a
 *  dash in it. A ring at 0 % would be a claim nobody made.
 *
 *  The press opens every window the plan reported, in the order the plan names
 *  them, with when each refills and how old the reading is. The judgements are
 *  `planUse` in `lib/machine.ts`; what is here is the arrangement.
 */
import { useEffect, useRef, useState } from 'react';
import { C, R, SHADOW } from '../lib/theme';
import { limitTone, planUse, type LimitTone } from '../lib/machine';
import type { LimitWindow } from '../lib/protocol';
import { mono } from '../ui/kit';

const TONE: Record<LimitTone, string> = {
  plain: C.text2, warn: C.warn, danger: C.danger,
};

/** The ring itself, at whatever size it is asked for. Also the figure the
 *  accounts table draws in its own column, which is why it is separate.
 *
 *  The empty track is a CSS border and only the filled arc is drawn, which
 *  looks like a detail and is not: a hairline is a *rule*, and the panel draws
 *  rules as borders everywhere else. Stroked into the SVG it became ink — a
 *  thing the contrast check measures as something a person has to read — and a
 *  hairline cannot pass that and should not have to. */
export function Ring({ share, size = 30, stroke = 3.5, colour, children }: {
  /** 0–1, or null where nothing has been measured. */
  share: number | null;
  size?: number;
  stroke?: number;
  colour?: string;
  children?: React.ReactNode;
}) {
  const r = size / 2 - stroke / 2;
  const circ = 2 * Math.PI * r;
  const col = colour ?? (share == null ? C.mute : TONE[limitTone(share)]);
  return (
    <span style={{
      position: 'relative', flex: 'none', width: size, height: size, boxSizing: 'border-box',
      borderRadius: '50%', border: `${stroke}px solid ${C.border}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {share != null && (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          style={{ position: 'absolute', top: -stroke, left: -stroke }}>
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke}
            strokeDasharray={`${circ * Math.max(0, Math.min(1, share))} ${circ}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      )}
      {children}
    </span>
  );
}

export function LimitsRing({ windows, now, accountLabel }: {
  windows: LimitWindow[] | undefined;
  now: number;
  /** Whose plan this is, for the head of the card the press opens. */
  accountLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(el)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const use = planUse(windows, now);
  const share = use.top ? use.top.share : null;
  const col = use.spent ? C.danger : share == null ? C.mute : TONE[limitTone(share)];

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={use.unknown
          ? 'Usage — nothing measured yet'
          : `Usage · ${Math.round((share ?? 0) * 100)}% of ${use.top?.label}`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          height: 28, width: 28, padding: 0, borderRadius: R.chip,
          background: open ? C.surface3 : C.surface,
          border: `1px solid ${open ? C.borderStrong : C.border}`,
          cursor: 'pointer',
        }}
      >
        <Ring share={share} size={22} stroke={3} colour={col}>
          <span style={{ ...mono, fontSize: 8.5, fontWeight: 700, color: col, lineHeight: 1 }}>
            {share == null ? '–' : Math.round(share * 100)}
          </span>
        </Ring>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0, width: 288, zIndex: 40,
          background: C.surface, border: `1px solid ${C.borderStrong}`, borderRadius: R.card,
          boxShadow: SHADOW.pop, padding: 14,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Usage limits</span>
            <span style={{
              ...mono, marginLeft: 'auto', fontSize: 10.5, color: C.mute,
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{use.measured || accountLabel || ''}</span>
          </div>

          {use.unknown ? (
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.text2 }}>
              No reading yet — the plan reports itself while a turn runs, so send a message
              and this fills in.
            </div>
          ) : use.windows.map((w) => (
            <div key={w.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5 }}>{w.label}</span>
                <span style={{ ...mono, marginLeft: 'auto', fontSize: 12.5, color: TONE[w.tone] }}>
                  {Math.round(w.share * 100)}%
                </span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.borderStrong }}>
                <div style={{
                  width: `${w.share * 100}%`, height: '100%', borderRadius: 3,
                  background: TONE[w.tone],
                }} />
              </div>
              {/* When it refills, and — only where it explains the number — how
                  old the reading is: on the window the ring draws, and on any
                  the newest report has stopped mentioning. */}
              {(!!w.resets || w.stale || w.key === use.top?.key) && (
                <div style={{ fontSize: 11, color: C.mute }}>
                  {[w.resets, (w.stale || w.key === use.top?.key) ? w.measured : '']
                    .filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}

          {use.spent && (
            <div style={{ fontSize: 12, lineHeight: 1.5, color: C.danger }}>
              A send was refused on this plan and it has not reset yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
