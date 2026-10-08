/** A branch, the chat and Machine on their own, the way the panel draws them
 *  (`?view=branch|chat|machine`). Built and photographed by
 *  `scripts/shot-machine.mjs`. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { themeCss } from '../src/lib/theme';
import { Shell } from '../src/components/Shell';
import { ChatView } from '../src/components/ChatView';
import { Overview } from '../src/screens/Overview';
import { Machine } from '../src/screens/Machine';
import { answered, merge, project, silent } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { useDock } from '../src/lib/sessions';
import { NOW, mini, studio } from './divan-fixture.js';
import { chat, host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
const which = q.get('view') || 'branch';
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

const s = studio();
s.cards = s.cards.map((c: any) => (c.id === 'k1' ? { ...c, agent_detail: 'Wrote the retry table; two of three tests pass.' }
  : c.id === 'k2' ? { ...c, agent_detail: 'Asked whether to use the live Stripe keys now.', agent_status_at: NOW - 3 * 3600 } : c));
const view = merge([
  { key: 'studio', name: 'studio', state: answered(s, NOW) },
  { key: 'mini', name: 'mini', state: silent(answered(mini(), NOW - 3 * 3600), 'connection refused') },
], NOW);
useFleet.setState({
  hosts: { studio: { ...host(), chats: [chat({ project_id: 'p-quire' })] } as any,
           mini: { ...host(), cfg: { ...host().cfg, name: 'mini' }, status: 'offline', chats: [] } as any },
  order: ['studio', 'mini'], focus: 'studio', ready: true,
  call: (async () => { throw new Error('not in the picture'); }) as any,
});

// The windows a stopped or asking card opens on its own sit in the dock here.
useDock.setState({ minimised: ['studio:k2', 'studio:k1', 'mini:m1'], closed: {}, raised: [] } as any);

const log = {
  items: [
    { kind: 'user', id: 'u1', ts: NOW - 300, text: 'Students keep asking about refunds. We should have a page for that.', attachments: [], queued: false },
    { kind: 'assistant', id: 'a1', ts: NOW - 290, segment: 0, done: true,
      text: 'Agreed. I filed it so nothing starts until you move it. Checkout and the footer would both link to it.' },
    { kind: 'tool', id: 't1', ts: NOW - 280, tool: 'Bash', input: { command: 'ustabasi add refund.json' },
      output: '#41 queued: Refund policy page  (worker opus, verifier opus)', isError: false, running: false },
    { kind: 'user', id: 'u2', ts: NOW - 120, text: 'How did the paywall copy do last week?', attachments: [], queued: false },
    { kind: 'assistant', id: 'a2', ts: NOW - 110, segment: 1, done: true,
      text: 'The analytics source for Quire is not connected yet, so I cannot give you a real number.' },
  ],
  seq: 5, truncated: false, busy: false, pending: [], loading: false, error: null,
} as any;

const page = which === 'chat' ? (
  <Shell view="chats" onView={() => {}} fleet={view} back={{ label: 'Dashboard', onBack: () => {} }}>
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 20px' }}>
        <button type="button" className="dv-btn dv-btn--ghost dv-hit" aria-expanded={false}>Earlier</button>
        <span className="dv-meta" style={{ marginLeft: 'auto' }}>Hermes</span>
      </div>
      <ChatView chat={chat({ project_id: 'p-quire', title: 'Refund page' }) as any} hostKey="studio" log={log}
        groupName={null} groups={[]} accountLabel="you@…" accountUsage={0.36} accountLimits={undefined}
        now={NOW} liveTokens={null} liveContext={null} sending={false} filedUnder="Quire"
        tickets={{ open: () => {}, describe: () => ({ column: 'Ice Box', title: 'Refund policy page' }) }}
        onPopOut={() => {}} onSend={() => {}} onInterrupt={() => {}} onRespond={() => {}} onEdit={() => {}}
        onUpdate={() => {}} onNewGroup={async () => {}} onDelete={() => {}} onUpload={async () => null} />
    </div>
  </Shell>
) : which === 'machine' ? (
  <Shell view="machines" onView={() => {}} fleet={view} back={{ label: 'Dashboard', onBack: () => {} }}>
    <Machine view="machines" onView={() => {}} fleet={view} onOpenChat={() => {}} onNewChat={() => {}}
      onNewChatIn={() => {}} onStartChat={() => {}} onPeek={() => {}} />
  </Shell>
) : (
  <Shell view="overview" onView={() => {}} fleet={view} back={{ label: 'Quire', onBack: () => {} }}>
    <Overview view={view} project={project(view, 'quire')} onProject={() => {}} tab="overview" onTab={() => {}}
      branch={q.get('branch') || 'Engineering'} onBranch={() => {}} card={null} onCard={() => {}} />
  </Shell>
);
createRoot(root).render(page);
