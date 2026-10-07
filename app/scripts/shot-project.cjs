/** Pictures of a product on the phone: its page, its board and New ticket.
 *
 *     node scripts/shot-project.cjs <out-dir> [dark|light]
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
const C = require(path.join(root, 'src/compose.ts'));
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
const NewTicket = require(path.join(root, 'app/new-ticket.tsx')).default;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const branch = (kind, name, o = {}) => ({ id: `${kind}-id`, kind, name, summary: o.summary || '',
  summary_at: o.at ?? null, cards: o.cards || {}, open: o.open || 0 });
const project = {
  id: 'Quire-id', name: 'Quire', slug: 'quire', summary: 'client portals for studios', kind: 'SaaS',
  repos: ['/r/quire'], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  stage: 'live', milestones: [{ id: 'm', at: Date.UTC(2026, 0, 4) / 1000, title: 'Live', note: '', kind: 'live' }],
  branches: [branch('engineering', 'Engineering', { open: 3, cards: { queued: 2, in_progress: 5, done: 5 } }),
             branch('seo', 'SEO'), branch('analytics', 'Analytics'), branch('marketing', 'Marketing')],
  counts: { queued: 2, in_progress: 5 }, running: 3, waiting: 2, summary_line: '',
};
const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering', column: o.column || 'in_progress',
  position: o.position || 0, title: o.title, summary: '', executor: 'coding_agent', machine: 'studio', repo: null,
  ustabasi_id: o.ticket ?? null, agent_status: o.status ?? null, agent_status_at: NOW - (o.ago || 600),
  agent_detail: o.detail || '', created_at: NOW - DAY, updated_at: NOW - 600, moved_at: o.moved ?? NOW - 600,
});
const snap = { machine: 'studio', os: 'Darwin', at: NOW, queue: {},
  quota: { enabled: true, accounts: 1, blocked: 0, spent: false, left: 0.64, resets_at: NOW + 4 * 3600, unknown: false },
  projects: [project], agents: [], activity: { '/r/quire': { at: NOW - 840, week: 4, today: 1 } },
  cards: [
    card('q1', { column: 'queued', title: 'Bulk invite clients' }),
    card('q2', { column: 'queued', position: 1, title: 'Zapier hook' }),
    card('a1', { status: 'asking', ticket: 41, title: 'Stripe keys', ago: 840,
                 detail: 'The test keys work. Use the live ones now, or wait for the review?' }),
    card('r1', { status: 'running', ticket: 42, position: 1, title: 'Lesson search', ago: 360 }),
    card('r2', { status: 'running', ticket: 43, position: 2, title: 'Certificate PDF layout', ago: 2460 }),
    card('s1', { status: 'blocked', ticket: 45, position: 4, title: 'Exam timer resets on Safari', ago: 4320,
                 detail: 'Test fails on Safari 17; the rest pass.' }),
    card('v1', { column: 'review', status: 'running', ticket: 46, title: 'Payment flow with Stripe', ago: 480 }),
  ] };

R.words.real();
const stand = (params) => {
  R.store.reset();
  R.params.reset();
  R.store.set({ hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } },
    host: { id: 'h1' }, conn: 'online', loadDivan() {}, ustabasi: { available: true, tickets: [] }, ustabasiOld: false, loadUstabasi() {},
    catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: '' }], efforts: ['high'], perm_modes: ['default'] } },
    defaults: { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: null, byProvider: {} },
    accounts: [{ id: 'default-claude', provider: 'claude', label: 'own', logged_in: true, is_default: true, detail: '' }],
    accountsLoaded: true, loadAccounts: async () => {}, limits: {}, projects: [], listAgents: async () => [], chats: {},
    compose: C.NO_DRAFT, setCompose() {}, drafts: {}, setDraft() {}, createCard: async () => {} });
  R.params.set(params);
};
fs.mkdirSync(dir, { recursive: true });
stand({ project: 'quire' });
console.log(photograph(R.render(scheme, h(Dashboard)), scheme, path.join(dir, `project-phone${suffix}.png`), 1900));
stand({ project: 'quire', tab: 'board' });
console.log(photograph(R.render(scheme, h(Dashboard)), scheme, path.join(dir, `board-phone${suffix}.png`), 1100));
stand({ project: 'quire' });
console.log(photograph(R.render(scheme, h(NewTicket, { opening: 'Refund policy page',
  sentences: 'A short page that says when a student gets money back and how.' })), scheme,
path.join(dir, `new-ticket-phone${suffix}.png`), 700));
process.exit(0);
