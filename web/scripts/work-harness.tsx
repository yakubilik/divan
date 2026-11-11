/** Work on its own, the way the panel draws it: the line over it with the Work
 *  button lit, and a queue with a ticket in every state on three projects and
 *  some finished this week. `?range=`, `?q=` and `?project=` narrow it as the
 *  address does. Every cancel, restart, priority and note (an answer sent from a card's
 *  chat) a card asks for is written down in `window.__writes`, answered the way the queue answers and
 *  applied to the queue the next read returns. A test can hold a write until it
 *  says how it ends (`__holdWrites`, `__answer`), hold a read of the queue
 *  across a move (`__holdNextList`) and shorten the poll (`?poll=ms`). A card's
 *  heading opens a stand-in for the ticket's page at `#ticket/<host>/<id>`.
 *  Built and photographed by `scripts/shot-work.mjs`, and dragged in a real
 *  browser by `scripts/test-work-ui.mjs`. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { Work, workPoll, type WorkLayout } from '../src/screens/Work';
import { useFleet } from '../src/lib/fleet';
import { host } from './panel-fixture.js';
import { ticket } from './ticket-fixture.js';

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
const t = (id: number, project: string, status: string, title: string, over: Record<string, unknown> = {}) => ticket({
  id, project, status, title, repo: `/Users/x/projects/${project}`, stage: 'worker', round: 1,
  created_at: NOW - 3 * 3600 - id * 60, updated_at: NOW - id, started_at: NOW - 3600,
  round_started_at: NOW - 14 * 60, finished_at: null, escalation: '', ask: '', notes: [], note_count: 0,
  last_event: { ts: NOW - 60, kind: 'report', msg: '[worker] committed the page and its test' }, ...over,
});
if (q.get('poll')) workPoll.ms = Number(q.get('poll'));
let tickets = [
  t(258, 'divan', 'running', 'Web panel: one live page of every ticket in flight'),
  t(259, 'divan', 'blocked', 'Phone: answer a ticket from the lock screen', {
    escalation: '- which Apple team should sign the widget?',
    // audit: language-data — a Turkish question whose yes and no chips are read from its particle
    ask: 'Widget için kişisel Apple takımını kullanayım mı?',
    // audit: end-language-data
    last_event: { ts: NOW - 300, kind: 'blocked', msg: 'which Apple team should sign the widget?' } }),
  t(260, 'divan', 'queued', 'Daemon: send the queue on change instead of on poll', {
    started_at: null, round_started_at: null, last_event: null, goal: 'Push ustabasi.list to the panel when it changes.' }),
  t(261, 'divan', 'queued', 'Web: one search over every chat', {
    started_at: null, round_started_at: null, last_event: { ts: NOW - 1800, kind: 'created', msg: 'filed from the phone' } }),
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
const writes: string[] = [];
const W = window as any;
W.__writes = writes;
/** Set once per page load: a test reads it back to tell a redraw from a reload. */
W.__loaded = Math.random();
/** Every read of the queue the page made, and whether one is held right now. */
W.__lists = 0;
W.__listHeld = false;
let listGate: Promise<void> | null = null;
W.__holdNextList = () => { listGate = new Promise((r) => { W.__releaseList = r; }); };
/** While held, a write waits for `__answer()` — or `__answer(why)`, a refusal. */
let held = false;
let answer: Promise<string | undefined> | null = null;
W.__holdWrites = (on = true) => { held = on; };
/** The mocked queue starts a ticket the moment it is put first in line. */
W.__startNow = false;
const apply = (type: string, d: any) => {
  const now = Date.now() / 1000;
  const patch: Record<string, unknown> = type === 'ustabasi.cancel' ? { status: 'cancelled', finished_at: now }
    : type === 'ustabasi.restart' ? { status: 'queued', finished_at: null }
    : { priority: d.priority, ...(d.priority === 0 && W.__startNow ? { status: 'running', started_at: now, last_event: null } : {}) };
  tickets = tickets.map((x: any) => (x.id === d.id ? { ...x, ...patch, updated_at: now } : x));
};
const QUEUE_WRITES: Record<string, string> = {
  'ustabasi.cancel': 'cancelled', 'ustabasi.restart': 'back in the queue', 'ustabasi.priority': 'priority',
};
useFleet.setState({
  hosts: { studio: { ...(host() as any), status: 'online' } }, order: ['studio'], focus: 'studio', ready: true,
  call: (async (_k: string, type: string, d: any) => {
    if (type === 'ustabasi.list') {
      W.__lists++;
      // What it read is what it was asked for: one held answers with that, late.
      const snap = { available: true, tickets: tickets.slice(), queue: { last_tick: NOW } };
      if (listGate) { const g = listGate; listGate = null; W.__listHeld = true; await g; W.__listHeld = false; }
      return snap;
    }
    // An answer from a card's chat: written down, and kept on the ticket.
    if (type === 'ustabasi.note') {
      writes.push(`note ${d.id} ${d.text}`);
      tickets = tickets.map((x: any) => (x.id === d.id
        ? { ...x, notes: [...x.notes, { ts: Date.now() / 1000, from: 'user', text: d.text }],
            // …and a stopped one goes back in the queue with it, as the queue does.
            ...(x.status === 'blocked' || x.status === 'failed' ? { status: 'queued', finished_at: null } : {}) } : x));
      return { ok: true, message: `#${d.id} noted` };
    }
    if (QUEUE_WRITES[type]) {
      writes.push(`${type.slice(9)} ${d.id}${type === 'ustabasi.priority' ? ` ${d.priority}` : ''}`);
      if (held) {
        answer = new Promise((r) => { W.__answer = r; });
        const why = await answer;
        if (why) throw new Error(why);
      }
      apply(type, d);
      return { ok: true, message: `#${d.id} ${QUEUE_WRITES[type]}${type === 'ustabasi.priority' ? ` ${d.priority}` : ''}` };
    }
    return {};
  }) as any,
});

/** A card's heading leaves the board for the ticket's page, as the panel's
 *  address does: one entry in the history, and Back draws the board again. */
const ticketAt = () => /^#ticket\/(\w+)\/(\d+)$/.exec(location.hash);

function Page() {
  const [layout, setLayout] = useState<WorkLayout>({
    range: q.get('range'), search: q.get('q') ?? '', project: q.get('project'),
  });
  const [, redraw] = useState(0);
  useEffect(() => {
    const on = () => redraw((n) => n + 1);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const open = ticketAt();
  return (
    <Shell view="overview" onView={() => {}} back={{ label: 'Dashboard', onBack: () => {} }}
      work={{ on: true, onOpen: () => {} }}>
      {open ? (
        <div data-ticket-page={`${open[1]}:${open[2]}`} style={{ padding: 40 }}>Ticket #{open[2]}</div>
      ) : (
        <Work layout={layout} onLayout={setLayout}
          onOpen={(h, id) => { history.pushState(null, '', `${location.search}#ticket/${h}/${id}`); redraw((n) => n + 1); }} />
      )}
    </Shell>
  );
}

createRoot(root).render(<Page />);
