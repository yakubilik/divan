/** A product's page on its own, the way the panel draws it: the line over it,
 *  the Overview, the Board or New ticket (`?view=`), and the fixture's busy
 *  board with a Queued column, a card under review and this month's Done.
 *  Built and photographed by `scripts/shot-project.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Composer } from '../src/components/Composer';
import { Overview, type ProjectTab } from '../src/screens/Overview';
import { merge, project } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { useDock } from '../src/lib/sessions';
import { boards } from './overview-fixture.js';
import { host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
const tab = (q.get('view') || 'overview') as ProjectTab;
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const NOW = Math.floor(Date.now() / 1000);
useFleet.setState({ hosts: { studio: host() as any }, order: ['studio'], focus: 'studio', ready: true });
// The question windows are put away: the picture is of the page.
useDock.setState({ minimised: ['studio:k2', 'studio:h1', 'studio:i5'], closed: {}, raised: [] });
const busy = boards(NOW).busy[0];
const c = (id: string, over: any) => ({ ...busy.snap.cards[0], id, ustabasi_id: null, agent_status: null,
  agent_status_at: null, agent_detail: '', summary: '', ...over });
const snap = { ...busy.snap, cards: [...busy.snap.cards,
  c('q1', { column: 'queued', position: 0, title: 'Bulk invite' }),
  c('q2', { column: 'queued', position: 1, title: 'Zapier hook' }),
  c('r1', { column: 'review', title: 'Payment flow', agent_status: 'running', agent_status_at: NOW - 480 }),
  c('i3', { column: 'in_progress', position: 2, title: 'Lesson search', agent_status: 'running', agent_status_at: NOW - 360 }),
  c('i5', { column: 'in_progress', position: 4, title: 'Exam timer', agent_status: 'blocked', agent_status_at: NOW - 4300,
            agent_detail: 'Test fails on Safari 17.' }),
  ...[1, 2, 3, 4, 5].map((n) => c(`d${n}`, { column: 'done', title: `Shipped ${n}`, moved_at: NOW - n * 86400 })),
] };
const view = merge([{ key: busy.key, name: busy.name,
  state: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } as any }], NOW);
const quire = project(view, 'quire');
const composer = <Composer view={view} lock="quire" onAsk={async () => {}} onCard={async () => ''} onOptions={() => {}} />;

createRoot(root).render(
  <Shell view="overview" onView={() => {}} fleet={view} back={{ label: 'Dashboard', onBack: () => {} }}>
    <Overview view={view} project={quire} onProject={() => {}} tab={tab} onTab={() => {}}
      projectComposer={composer} />
  </Shell>,
);
