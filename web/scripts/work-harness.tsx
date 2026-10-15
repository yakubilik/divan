/** Work on its own, the way the panel draws it: the line over it with the Work
 *  button lit, and a queue with a ticket in every state on three projects and
 *  some finished this week. `?layout=board` or `?layout=date` draws that
 *  layout. Built and photographed by `scripts/shot-work.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Work } from '../src/screens/Work';
import { useFleet } from '../src/lib/fleet';
import { host } from './panel-fixture.js';
import { ticket } from './ticket-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
const layout = q.get('layout') === 'board' ? 'board' : q.get('layout') === 'date' ? 'date' : null;
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const NOW = Math.floor(Date.now() / 1000);
const t = (id: number, project: string, status: string, title: string, over: Record<string, unknown> = {}) => ticket({
  id, project, status, title, repo: `/Users/x/projects/${project}`, stage: 'worker', round: 1,
  created_at: NOW - 3 * 3600 - id * 60, updated_at: NOW - id, started_at: NOW - 3600,
  round_started_at: NOW - 14 * 60, finished_at: null, escalation: '', ask: '', notes: [], note_count: 0,
  last_event: { ts: NOW - 60, kind: 'report', msg: '[worker] committed the page and its test' }, ...over,
});
const tickets = [
  t(258, 'divan', 'running', 'Web panel: one live page of every ticket in flight'),
  t(259, 'divan', 'blocked', 'Phone: answer a ticket from the lock screen', {
    last_event: { ts: NOW - 300, kind: 'blocked', msg: 'which Apple team should sign the widget?' } }),
  t(260, 'divan', 'queued', 'Daemon: send the queue on change instead of on poll', {
    started_at: null, round_started_at: null, last_event: null, goal: 'Push ustabasi.list to the panel when it changes.' }),
  t(71, 'nl-artsen', 'running', 'Doctor pages: structured data for every practice', { stage: 'check', round: 2 }),
  t(72, 'nl-artsen', 'queued', 'Sitemap split by city', {
    last_event: { ts: NOW - 900, kind: 'limit', msg: 'account main limited until 17:05; waiting it out' } }),
  t(31, 'isghocam-seo', 'failed', 'Landing copy A/B test', {
    last_event: { ts: NOW - 1200, kind: 'failed', msg: 'check failed three times: lighthouse below 90' } }),
  t(32, 'isghocam-seo', 'queued', 'Blog index pagination', {
    depends_on: 31, started_at: null, round_started_at: null,
    last_event: { ts: NOW - 4000, kind: 'depends', msg: 'waits for #31' } }),
  t(30, 'isghocam-seo', 'done', 'Robots.txt', { finished_at: NOW - 2 * 86400, merged: 'merged into main (4dd999f)' }),
  t(257, 'divan', 'done', 'Web /waiting: one page of everything waiting on you', {
    finished_at: NOW - 40 * 60, merged: 'merged into main (0c4a6de)',
    last_event: { ts: NOW - 39 * 60, kind: 'clean', msg: 'worktree removed (auto)' } }),
  t(255, 'divan', 'cancelled', 'Phone: a second way to file a ticket', { finished_at: NOW - 26 * 3600 }),
  t(70, 'nl-artsen', 'failed', 'Import the practice list from the registry', {
    finished_at: NOW - 5 * 3600,
    last_event: { ts: NOW - 5 * 3600, kind: 'failed', msg: 'verifier crashed repeatedly; needs a human look' } }),
  t(69, 'nl-artsen', 'done', 'Practice pages: opening hours', { finished_at: NOW - 12 * 86400 }),
];
useFleet.setState({
  hosts: { studio: { ...(host() as any), status: 'online' } }, order: ['studio'], focus: 'studio', ready: true,
  call: (async (_k: string, type: string) => (type === 'ustabasi.list'
    ? { available: true, tickets, queue: { last_tick: NOW } } : {})) as any,
});

createRoot(root).render(
  <Shell view="overview" onView={() => {}} back={{ label: 'Dashboard', onBack: () => {} }}
    work={{ on: true, onOpen: () => {} }}>
    <Work layout={{ group: layout, older: 0 }} />
  </Shell>,
);
