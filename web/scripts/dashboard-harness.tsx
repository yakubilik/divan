/** The Dashboard on its own, the way the panel draws it: the app root's own
 *  classes, the line over it, the Composer and the fixture's two-machine board.
 *  Built and photographed by `scripts/shot-dashboard.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Composer } from '../src/components/Composer';
import { Overview } from '../src/screens/Overview';
import { merge } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { boards } from './overview-fixture.js';
import { host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const NOW = Math.floor(Date.now() / 1000);
useFleet.setState({ hosts: { studio: host() as any }, order: ['studio'], focus: 'studio', ready: true });
const view = merge(boards(NOW).busy.map((b: any) => ({
  key: b.key, name: b.name, state: { snapshot: b.snap, at: NOW, reachable: true, error: null, old: false },
})), NOW);

createRoot(root).render(
  <Shell view="overview" onView={() => {}} fleet={view}>
    <Overview view={view} project={null} onProject={() => {}}
      composer={<Composer view={view} onAsk={async () => {}} onOptions={() => {}} />} />
  </Shell>,
);
