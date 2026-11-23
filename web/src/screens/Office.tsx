import { officeUrl } from '../lib/actions';
import { useFleet } from '../lib/fleet';
import { EmptyState } from '../ui/divan';

/** The office: every agent on the home computer as a pixel character at a
 *  desk. The page is the daemon's own (daemon/divan/office_page: pixtuoid's
 *  web build fed the hook lines office.py taps), so this is only a frame over
 *  it, on the first computer of the fleet. */
export function OfficeFrame() {
  const key = useFleet((s) => s.order[0] ?? null);
  const src = key ? officeUrl(key) : '';
  if (!src) {
    return <EmptyState title="No office here" body="This panel is not connected to a computer yet." />;
  }
  return (
    <div data-office-screen="" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
      <iframe title="Office" src={src} style={{ flex: 1, border: 0, display: 'block' }} />
    </div>
  );
}
