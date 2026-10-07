/** Pictures of a ticket and of Waiting on you on the phone.
 *
 *     node scripts/shot-ticket.cjs <out-dir> [dark|light]
 *
 *  Stood up through `render-divan.cjs` with the real words and photographed the
 *  way `shot-dashboard.cjs` photographs the Dashboard. Not a check, and in no
 *  npm script. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./render-divan.cjs');
const { photograph } = require('./shot-dashboard.cjs');

const root = path.join(__dirname, '..');
const dir = path.resolve(process.argv[2] || os.tmpdir());
const scheme = process.argv[3] === 'light' ? 'light' : 'dark';
const suffix = scheme === 'light' ? '-light' : '';
const h = R.React.createElement;
const CA = require(path.join(root, 'src/card.ts'));
const CardScreen = require(path.join(root, 'app/card/[id].tsx')).default;
const Waiting = require(path.join(root, 'app/waiting.tsx')).default;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const QUESTION = 'The test keys work. Use the live ones now, or wait for the review?';
const project = {
  id: 'Quire-id', name: 'Quire', slug: 'quire', summary: 'client portals for studios', kind: 'SaaS',
  repos: ['/r/quire'], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60, stage: 'live', milestones: [],
  branches: [{ id: 'engineering-id', kind: 'engineering', name: 'Engineering', summary: '', summary_at: null,
               cards: { in_progress: 4 }, open: 4 }],
  counts: { in_progress: 4 }, running: 1, waiting: 3, summary_line: '',
  open_items: [{ id: 'o1', project_id: 'Quire-id', title: 'Generate a Shopier API key', body: 'Paste it into the project.',
                 state: 'todo', owner: '', area: '', sort: 0, comments: [], created_at: NOW - 3 * DAY, updated_at: NOW, closed_at: null }],
};
const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering', column: 'in_progress',
  position: o.position || 0, title: o.title, summary: o.summary || '', executor: o.executor || 'coding_agent', machine: 'studio',
  repo: null, ustabasi_id: o.ticket ?? null, agent_status: o.status ?? null, agent_status_at: NOW - (o.ago || 600),
  agent_detail: o.detail || '', created_at: NOW - DAY, updated_at: NOW - 600, moved_at: NOW - (o.ago || 600),
});
const cards = [
  card('a1', { status: 'asking', ticket: 41, title: 'Stripe keys', ago: 720, detail: QUESTION,
               summary: 'Checkout has run on the test keys since launch. Put the live keys in before the first studio pays, and keep the test ones for staging.' }),
  card('d1', { status: 'asking', ticket: 43, executor: 'assistant', title: 'Paywall copy', ago: 3600, position: 1,
               detail: 'Keep the calm version, or test the urgent one this week?' }),
  card('h1', { executor: 'human', title: 'Write the onboarding email', ago: 7200, position: 2 }),
  card('r1', { status: 'running', ticket: 42, title: 'Lesson search', position: 3 }),
];
const snap = { machine: 'studio', os: 'Darwin', at: NOW, queue: {}, agents: [], activity: {},
  quota: { enabled: true, accounts: 1, blocked: 0, spent: false, left: 0.64, resets_at: NOW + 4 * 3600, unknown: false },
  projects: [project], cards };
const BRIEF = { goal: 'Swap the Stripe test keys for the live ones in production',
  done_criteria: ['checkout charges with the live key', 'staging keeps the test key'],
  verify_cmd: 'npm test -- payments', constraints: [], paths: ['api/src/payments/stripe.ts'], notes: '' };
const TICKET = { id: 41, title: 'Stripe keys', status: 'blocked', stage: 'worker', round: 1, repo: '/r/quire', branch: 'ustabasi/41',
  created_at: NOW - DAY, updated_at: NOW - 600, started_at: NOW - 2400, finished_at: null, goal: BRIEF.goal,
  done_criteria: BRIEF.done_criteria, escalation: '', ask: QUESTION, verdict: null, notes: [], note_count: 0, last_event: null,
  project: 'quire', round_started_at: NOW - 2400, git: null, steps: [] };
const page = (events, cursor) => ({ available: true, reason: '', run: 'r', events, cursor, live: false, caught_up: true });
const detail = (events, cursor) => ({ card: { ...cards[0], agent: BRIEF }, project, ticket: TICKET, run: page(events, cursor) });
const READ = CA.took(CA.opening('a1', 'h1'), detail([
  { k: 'text', text: 'Read the checkout route and the env files.' },
  { k: 'tool', id: 't1', name: 'Bash', input: { command: 'npm test -- payments' } },
  { k: 'result', id: 't1', text: '12 passed' }], 'c1'), NOW - 600);
const OPEN = CA.took(READ, detail([{ k: 'text', text: 'Checkout is ready for the live key; it is not in the env yet.' }], 'c2'), NOW - 120);

R.words.real();
const stand = (params) => {
  R.store.reset();
  R.params.reset();
  R.store.set({ hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } },
    host: { id: 'h1' }, conn: 'online', loadDivan() {}, loadCard() {}, sayCard() {}, handCard() {}, openItem() {},
    ustabasi: null, ustabasiOld: false, loadUstabasi() {}, openCard: OPEN, drafts: {}, setDraft() {} });
  R.params.set(params);
};
fs.mkdirSync(dir, { recursive: true });
stand({ id: 'a1', host: 'h1', from: 'board' });
console.log(photograph(R.render(scheme, h(CardScreen)), scheme, path.join(dir, `ticket-phone${suffix}.png`), 2000));
stand({ id: 'a1', host: 'h1', from: 'board', agent: 'open' });
console.log(photograph(R.render(scheme, h(CardScreen)), scheme, path.join(dir, `ticket-phone-agent-face${suffix}.png`), 2400));
stand({});
console.log(photograph(R.render(scheme, h(Waiting)), scheme, path.join(dir, `waiting-phone${suffix}.png`), 1500));
process.exit(0);
