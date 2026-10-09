/** The Dashboard with an agent's question open in its floating chat: the
 *  screenshot's question, an answer sent, and a follow-up under it. Built and
 *  driven by `scripts/test-asking-ui.mjs`. */
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
import { useAsking } from '../src/lib/asking';
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
const FIRST = '- Strix taraması ChatGPT aboneliğinle çalışsın diye Mac\'te bir kez ChatGPT girişini yapar mısın?\n'
  + '- Giriş yapmak istemezsen bu tarama için ücretli API anahtarı kullanayım mı, kullanırsam hangisi olsun?\n'
  + '- Strix taraması ChatGPT aboneliğinle çalışsın diye Mac\'te bir kez ChatGPT girişini yapar mısın?';
const FOLLOW = '- Tamam, girişi sen yapacaksın. Tarama yalnızca canlı siteyi mi kapsasın, staging de olsun mu?\n'
  + '- Bulguları bilete not olarak mı yazayım, ayrı bir rapor dosyası olarak mı?';
const AT = NOW - 60;

useFleet.setState({ hosts: { studio: host() as any }, order: ['studio'], focus: 'studio', ready: true });
const [studio, mini] = boards(NOW).busy;
const snap = structuredClone(studio.snap);
snap.projects = snap.projects.map((p: any) => (p.id === 'p-quire' ? { ...p, name: 'babysee', slug: 'babysee' } : p));
snap.cards = snap.cards.map((c: any) => (c.id === 'k2' ? {
  ...c, title: 'Strix security scan', agent_status: 'asking', agent_status_at: AT, agent_detail: FOLLOW,
} : c));
const view = merge([
  { key: 'studio', name: 'studio', state: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } },
  { key: 'mini', name: 'mini', state: { snapshot: mini.snap, at: NOW, reachable: true, error: null, old: false } },
] as any, NOW);
const project = 'babysee · Engineering';
useAsking.setState({
  threads: [{
    id: 'studio:k2', kind: 'ticket', host: 'studio', project, who: 'Coder', title: 'Strix security scan',
    cardId: 'k2', ticket: 42, opened: NOW - 900, asked: FOLLOW, askedAt: AT,
    lines: [
      { from: 'agent', text: FIRST, at: NOW - 900 },
      { from: 'you', text: 'Hangi hesapla giriş yapmam gerekiyor?', at: NOW - 600 },
      { from: 'agent', text: 'Strix\'i çalıştıran Mac\'teki ChatGPT hesabı; Plus aboneliği olan hangisiyse o.', at: NOW - 500 },
      { from: 'you', text: 'Girişi ben yaparım, ücretli anahtar kullanma.', at: NOW - 300 },
      { from: 'agent', text: FOLLOW, at: AT },
    ],
  }],
  minimised: [], closed: {}, selected: 'studio:k2',
});

createRoot(root).render(
  <Shell view="overview" onView={() => {}} fleet={view}>
    <Overview view={view} project={null} onProject={() => {}}
      composer={<Composer view={view} onAsk={async () => {}} onOptions={() => {}} />} />
  </Shell>,
);
