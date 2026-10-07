/** The thin line over every page (HANDOVER §1, §3: `dv-topline`), and the page
 *  under it.
 *
 *  It is the only navigation the panel has. On the left, the way back — or the
 *  word `divan` on the Dashboard, which is where back leads. On the right, the
 *  system line: how many machines answered, how much of the plan is left, the
 *  Chats and the Machine place, and the switch between the two themes. The
 *  three-place bar and its project chips are gone: a product is a tile on the
 *  Dashboard, and a chat is started from the Composer.
 *
 *  Every number on it is counted off the merged view. A quota nothing has
 *  measured is not drawn at all.
 */
import { setThemeChoice, useTheme } from '../lib/theme';
import { placeOf, type Chip, type Place, type View } from '../lib/shell';
import type { DivanView } from '../lib/divan';
import { useThresholds } from '../lib/machine';
import type { State } from '../lib/theme';

/** The line's clock, which the old bar carried and the frames dropped. Kept
 *  for the screens that still print one. */
export function stamp(now: number): string {
  const d = new Date(now * 1000);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    + ` · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

const SVG = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const MACHINE = 'M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM7 7.5h.01M7 16.5h.01';
const CHAT = 'M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z';
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z';
const SUN = 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z';
const BACK = 'M15 5 8 12l7 7';

/** The switch, at the end of the line. Labelled with the theme it will give
 *  you; the third answer (follow this computer) is in Machine › Settings. */
export function ThemeSwitch() {
  const { scheme } = useTheme();
  const other = scheme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="dv-icon-btn dv-hit" title={`Switch to the ${other} theme`}
      aria-label={`Switch to the ${other} theme`} onClick={() => setThemeChoice(other)}>
      {SVG(other === 'light' ? SUN : MOON)}
    </button>
  );
}

/** The right-hand half: `● 2/2 machines · ◔ quota 64% · Chats · Machine`. */
function Sys({ fleet, here, dots, onView, inbox }: {
  fleet?: DivanView | null;
  here: Place;
  dots?: Partial<Record<Place, State>>;
  onView: (view: View) => void;
  inbox?: React.ReactNode;
}) {
  const warn = useThresholds((s) => s.thresholds.warn);
  const t = fleet?.totals;
  const q = fleet?.quota;
  const left = q && !q.unknown && q.left != null ? Math.max(0, Math.min(1, q.left)) : null;
  const low = left != null && left <= warn;
  const all = !!t && t.machines > 0 && t.reachable === t.machines;
  return (
    <div className="sys">
      {!!t && t.machines > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} data-sys="machines">
          <i className={`dv-dot ${all ? 'dv-dot--run' : t.reachable ? 'dv-dot--ask' : 'dv-dot--stuck'}`} aria-hidden="true" />
          <b>{t.reachable}/{t.machines}</b><span className="sys-word"> machines</span>
        </span>
      )}
      {left != null && (
        <>
          <span className="sep" />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} data-sys="quota">
            <span className={`dv-ring${low ? ' dv-ring--low' : ''}`} aria-hidden="true"
              style={{ ['--p' as any]: `${Math.round(left * 100)}%` }} />
            <span className="sys-word">quota </span><b>{Math.round(left * 100)}%</b>{low && <span style={{ color: 'var(--amber)' }}>low</span>}
          </span>
        </>
      )}
      <span className="sep" />
      <PlaceButton label="Chats" icon={CHAT} on={here === 'chat'} dot={dots?.chat}
        onClick={() => onView('chats')} />
      <PlaceButton label="Machine" icon={MACHINE} on={here === 'machine'} dot={dots?.machine}
        onClick={() => onView('machines')} />
      {inbox}
      <ThemeSwitch />
    </div>
  );
}

function PlaceButton({ label, icon, on, dot, onClick }: {
  label: string; icon: string; on: boolean; dot?: State; onClick: () => void;
}) {
  return (
    <button type="button" className="dv-btn dv-btn--ghost dv-hit" aria-current={on ? 'page' : undefined}
      // A place you are already in is not re-entered: it would drop the
      // Machine page you are reading for the first one in its list.
      onClick={() => { if (!on) onClick(); }}
      title={on ? undefined : `Go to ${label}`} aria-label={label}>
      {SVG(icon)}<span className="sys-word">{label}</span>
      {!!dot && <><i className="dv-dot dv-dot--ask" aria-hidden="true" /><span className="dv-hidden">needs you</span></>}
    </button>
  );
}

/** A page: the line, and the page's own content under it. `back` is where the
 *  left end leads; absent, it is the word, on the Dashboard. */
export function Shell({ view, onView, fleet, dots, back, onHome, inbox, children }: {
  view: View;
  onView: (view: View) => void;
  /** The merged view the system line counts off. */
  fleet?: DivanView | null;
  /** Kept from the old bar's signature; the line has no clock and no chips. */
  now?: number;
  chips?: Chip[] | null;
  onProject?: (key: string | null) => void;
  /** Which places have something in them that wants a person. */
  dots?: Partial<Record<Place, State>>;
  back?: { label: string; onBack: () => void } | null;
  onHome?: () => void;
  /** The bell: what the queue sent, and the ticket a press on one opens. */
  inbox?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const here = placeOf(view);
  const home = here === 'dashboard' && !back;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header style={{ flex: 'none', padding: '4px 20px' }}>
        <div className="dv-topline" style={home ? { maxWidth: 1016, margin: '0 auto' } : undefined}>
          {back ? (
            <button type="button" className="dv-back dv-hit" onClick={back.onBack}
              aria-label={`Back to ${back.label}`}>
              {SVG(BACK)}{back.label}
            </button>
          ) : (
            <a className="dv-word" href="/" aria-current={home ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); onHome ? onHome() : onView('overview'); }}>divan</a>
          )}
          <Sys fleet={fleet} here={here} dots={dots} onView={onView} inbox={inbox} />
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
