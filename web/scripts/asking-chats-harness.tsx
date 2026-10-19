/** The whole panel with a ticket stopped on a question, for the Chat place and
 *  the Dashboard alike: the question's floating window is drawn on both, from
 *  the one store. Built and driven by `scripts/test-asking-chats-ui.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { App } from '../src/App';
import { answered, useDivanStore } from '../src/lib/divan';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { boards } from './overview-fixture.js';
import { host } from './panel-fixture.js';

setThemeChoice('dark');
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';
try { localStorage.removeItem('rac.asking'); } catch { /* fine */ }

const NOW = Math.floor(Date.now() / 1000);
const QUESTION = '- Strix taraması ChatGPT aboneliğinle çalışsın diye Mac\'te bir kez ChatGPT girişini yapar mısın?\n'
  + '- Giriş yapmak istemezsen bu tarama için ücretli API anahtarı kullanayım mı, kullanırsam hangisi olsun?';
const [studio] = boards(NOW).busy;
const snap = structuredClone(studio.snap);
snap.cards = snap.cards.map((c: any) => (c.id === 'k2' ? {
  ...c, title: 'Strix security scan', agent_status: 'asking', agent_status_at: NOW - 60, agent_detail: QUESTION,
} : c));
useDivanStore.setState({ snaps: { studio: answered(snap, NOW) } } as any);

const h: any = host();
const notes: any[] = [];
(window as any).__notes = notes;
useFleet.setState({
  hosts: { studio: { ...h, chats: h.chats.map((c: any) => ({ ...c, status: c.status === 'awaiting_approval' ? 'idle' : c.status })) } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (key: string, type: string, data: any) => {
    if (type === 'divan.snapshot') throw new Error('offline');
    if (type === 'ustabasi.note') { notes.push({ key, data }); return { ok: true, message: 'noted' }; }
    if (type === 'chat.get') return { events: [], more: false };
    return {};
  },
} as any);

createRoot(root).render(createElement(App));
