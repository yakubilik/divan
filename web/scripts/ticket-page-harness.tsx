/** The ticket page and Waiting on you on their own, the way the panel draws
 *  them (`?view=ticket|waiting`), off the fixture's busy board with a question
 *  on it, a decision, something stopped, a card that is yours and a Still open
 *  item. Built and photographed by `scripts/shot-ticket.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Composer } from '../src/components/Composer';
import { Overview } from '../src/screens/Overview';
import { merge, project } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { useDock } from '../src/lib/sessions';
import { boards } from './overview-fixture.js';
import { host } from './panel-fixture.js';
import { ticket } from './ticket-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
const which = q.get('view') === 'waiting' ? 'waiting' : 'ticket';
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const NOW = Math.floor(Date.now() / 1000);
const busy = boards(NOW).busy[0];
const c = (id: string, over: any) => ({ ...busy.snap.cards[0], id, summary: '', agent_detail: '', ...over });
const QUESTION = 'The test keys work. Use the live ones now, or wait for the review?';
const snap = {
  ...busy.snap,
  projects: busy.snap.projects.map((p: any) => (p.slug !== 'quire' ? p : { ...p, open_items: [
    { id: 'o1', project_id: p.id, title: 'Generate a Shopier API key', body: 'Paste it into the project.',
      state: 'todo', owner: '', area: 'payments', sort: 0, comments: [], created_at: NOW - 3 * 86400,
      updated_at: NOW, closed_at: null },
  ] })),
  cards: [
    ...busy.snap.cards.filter((x: any) => x.id !== 'k2'),
    c('k2', { title: 'Stripe keys', agent_status: 'asking', agent_status_at: NOW - 720, ustabasi_id: 42,
              summary: 'Checkout has run on the test keys since launch. Put the live keys in before the first studio pays, and keep the test ones for staging.',
              agent_detail: QUESTION }),
    c('dc', { title: 'Paywall copy', executor: 'assistant', agent_status: 'asking', agent_status_at: NOW - 3600,
              ustabasi_id: 43, agent_detail: 'Keep the calm version, or test the urgent one this week?' }),
  ],
};
const FACE = { goal: 'Swap the Stripe test keys for the live ones in production', done_criteria: ['checkout charges with the live key', 'staging keeps the test key'],
               verify_cmd: 'npm test -- payments', constraints: [], paths: ['api/src/payments/stripe.ts', 'infra/prod.env'], notes: '' };
let page = 0;
useFleet.setState({
  hosts: { studio: host() as any }, order: ['studio'], focus: 'studio', ready: true,
  call: (async (_key: string, type: string, data: any) => {
    if (type === 'divan.card.get') {
      const card = snap.cards.find((x: any) => x.id === data.card_id);
      return { card: { ...card, agent: FACE }, project: null, run: null,
        ticket: ticket({ id: card.ustabasi_id, title: card.title, status: 'blocked', ask: QUESTION, escalation: '',
          notes: [{ ts: NOW - 900, from: 'user', text: 'Keep the test keys for staging.' }], note_count: 1, verdict: null,
          steps: [], started_at: NOW - 2400, round_started_at: NOW - 2400, created_at: NOW - 86400, last_event: null }) };
    }
    if (type === 'ustabasi.run') {
      page += 1;
      return { available: true, reason: '', run: 'r', live: false, caught_up: true, shots: [], cursor: `c${page}`,
        reset: !data.cursor, events: data.cursor ? [] : [
          { k: 'text', text: 'Read the checkout route and the env files.' },
          { k: 'tool', id: 't1', name: 'Bash', input: { command: 'npm test -- payments' } },
          { k: 'result', id: 't1', text: '12 passed' },
          { k: 'text', text: 'Checkout is ready for the live key; it is not in the env yet.' },
        ] };
    }
    throw new Error('not in the picture');
  }) as any,
});
useDock.setState({ minimised: ['studio:k2', 'studio:h1', 'studio:dc'], closed: {}, raised: [] });
const view = merge([{ key: busy.key, name: busy.name,
  state: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } as any }], NOW);
const quire = project(view, 'quire');
const composer = <Composer view={view} lock="quire" onAsk={async () => {}} onOptions={() => {}} />;

createRoot(root).render(which === 'ticket' ? (
  <Shell view="overview" onView={() => {}} fleet={view} back={{ label: 'Quire · Board', onBack: () => {} }}>
    <Overview view={view} project={quire} onProject={() => {}} tab="board" onTab={() => {}}
      card="studio:k2" onCard={() => {}} projectComposer={composer} />
  </Shell>
) : (
  <Shell view="overview" onView={() => {}} fleet={view} back={{ label: 'Dashboard', onBack: () => {} }}>
    <Overview view={view} project={null} onProject={() => {}} tab="waiting" onTab={() => {}} />
  </Shell>
));
