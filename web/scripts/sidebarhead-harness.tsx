/** The whole panel in the Chat place over two computers, the first of them a
 *  Mac that calls itself `Dilara-MacBook-Air.local` and answers on :443. Built
 *  and driven by `scripts/test-sidebarhead-ui.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { App } from '../src/App';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;

const at = Date.now() / 1000 - 60;
const h: any = host();
const air = {
  ...h,
  cfg: { ...h.cfg, port: 443, name: 'air' },
  info: { ...h.info, name: 'Dilara-MacBook-Air.local' },
  chats: h.chats.map((c: any, i: number) => ({ ...c, archived: 0, updated_at: at - i * 5 })),
};
const mini = { ...host(), cfg: { ...h.cfg, port: 8766, name: 'mini' }, status: 'offline', chats: [], info: null };
useFleet.setState({
  hosts: { air, mini }, order: ['air', 'mini'], focus: 'air', ready: true,
  boot: () => {},
  call: async (_k: string, type: string) => { if (type === 'divan.snapshot') throw new Error('offline'); return {}; },
} as any);

createRoot(root).render(createElement(App));
