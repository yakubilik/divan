/** The whole panel, as `main.tsx` mounts it, over a made-up computer.
 *
 *  Built and driven by `scripts/test-walk-ui.mjs`. The address decides the page,
 *  exactly as it does in the shipped panel, so a reload and a cold open of any
 *  path are the panel's own. `sessionStorage['walk.fixture'] = 'empty'` swaps the
 *  busy computer for one that has nothing on it yet. Every request a screen makes
 *  of the computer is answered here and recorded on `window.__asked`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { App } from '../src/App';
import { Fallback } from '../src/components/Fallback';
import { answered, silent, useDivanStore } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { useLogs } from '../src/lib/timeline';
import { empty, mini, studio } from './divan-fixture.js';
import { chat, host, items } from './panel-fixture.js';
import { wall } from './ticket-fixture.js';

const bare = sessionStorage.getItem('walk.fixture') === 'empty';
const at = Date.now() / 1000;
const asked: { key: string; type: string; data: any }[] = [];
(window as any).__asked = asked;

const base = host();
const studioSlot = bare
  ? { ...base, chats: [], groups: [], limits: {} }
  : { ...base, chats: [chat({ project_id: 'p-quire', updated_at: at - 60 }),
                      chat({ id: 'c2', title: 'Safari login', status: 'running', updated_at: at - 120 }),
                      chat({ id: 'c3', title: 'Invoice PDF', status: 'awaiting_approval', updated_at: at - 180 })] };
const miniSlot = { ...host(), cfg: { ...base.cfg, port: 8766, name: 'mini' }, status: 'offline', chats: [], info: null };
const snapshot = bare ? empty() : studio();

const answer = async (key: string, type: string, data: any = {}) => {
  asked.push({ key, type, data });
  if (key === 'mini') throw new Error('That computer did not answer');
  switch (type) {
    case 'divan.snapshot': return snapshot;
    case 'account.list': return { accounts: base.accounts };
    case 'agent.list': return { agents: [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true, scope: 'account' }] };
    case 'agent.store': return { agents: [] };
    case 'ustabasi.list': return { available: !bare, tickets: bare ? [] : wall(), queue: { last_tick: at - 30 } };
    case 'ustabasi.run': return { available: true, reason: '', run: 'r-1', events: [], cursor: null, reset: true, live: false, caught_up: true, shots: [] };
    case 'pool.get': case 'pool.set':
      return { settings: { enabled: false, threshold: 0.9, thresholds: {}, use_overage: 'account', overage_by_account: {}, reserve: 0.05, order: {}, max_hops: 3 }, accounts: [] };
    case 'daemon.status':
      return { started_at: at - 1000, uptime_s: 1000, restarts: 0, pending: [], draining: null, last_restart: null, supervisor: { supervised: true, how: 'launchd', detail: null } };
    case 'update.status': return { current: '0.9.0', available: null, checked_at: at - 60 };
    case 'tool.status': return { tools: [] };
    case 'screen.info': return { enabled: false, displays: [] };
    case 'divan.card.get': return { card: snapshot.cards.find((c: any) => c.id === data.card_id) ?? null };
    case 'divan.project.open': return { items: [] };
    case 'host.git': return { repos: [] };
    default: return {};
  }
};

useFleet.setState({
  hosts: { studio: studioSlot as any, mini: miniSlot as any },
  order: ['studio', 'mini'], focus: 'studio', ready: true, call: answer as any,
});
useDivanStore.setState({
  snaps: {
    studio: answered(snapshot as any, at),
    mini: bare ? silent(null, 'connection refused') : silent(answered(mini() as any, at - 3 * 3600), 'connection refused'),
  },
});
if (!bare) {
  useLogs.setState({
    logs: { 'studio/c1': { items: items(), seq: 8, busy: false, pending: [], loading: false, error: null, truncated: false } } as any,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Fallback><App /></Fallback></StrictMode>,
);
