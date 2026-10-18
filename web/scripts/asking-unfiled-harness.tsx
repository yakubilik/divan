/** The Dashboard on the daemon's own snapshot of a ticket in the holding place
 *  that stopped on a question (`fixtures/unfiled-ask-snapshot.json`), with
 *  nothing seeded into the floating chat: the window has to open by itself.
 *  Every request the panel makes is kept in `window.__asked`. Built and driven
 *  by `scripts/test-asking-unfiled-ui.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Composer } from '../src/components/Composer';
import { Overview } from '../src/screens/Overview';
import { answered, merge } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { host } from './panel-fixture.js';
import SNAP from './fixtures/unfiled-ask-snapshot.json';

document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const NOW = Math.floor(Date.now() / 1000);
const asked: { key: string; type: string; data: any }[] = [];
(window as any).__asked = asked;
useFleet.setState({
  hosts: { studio: { ...host(), chats: [] } as any }, order: ['studio'], focus: 'studio', ready: true,
  call: (async (key: string, type: string, data: any) => {
    asked.push({ key, type, data });
    if (type.startsWith('ustabasi.')) return { ok: true, message: 'noted' };
    return {};
  }) as any,
});
const view = merge([{ key: 'studio', name: 'studio', state: answered(SNAP as any, NOW) }] as any, NOW);

createRoot(root).render(
  <Shell view="overview" onView={() => {}} fleet={view}>
    <Overview view={view} project={null} onProject={() => {}}
      composer={<Composer view={view} onAsk={async () => {}} onOptions={() => {}} />} />
  </Shell>,
);
