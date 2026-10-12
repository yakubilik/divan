/** The whole panel in the Chat place, New chat just pressed: the list on the
 *  left, nothing selected, the empty composer in the middle. Built and
 *  photographed by `scripts/shot-newchat.mjs`. */
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
useFleet.setState({
  hosts: { studio: { ...h, chats: h.chats.map((c: any, i: number) => ({ ...c, archived: 0, updated_at: at - i * 5 })) } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (_k: string, type: string) => { if (type === 'divan.snapshot') throw new Error('offline'); return {}; },
} as any);

createRoot(root).render(createElement(App));
// Once the place has opened on its newest chat, New chat is pressed.
setTimeout(() => {
  const btn = [...document.querySelectorAll('.dv-chatpane button')]
    .find((b) => (b.textContent ?? '').replace(/\s+/g, '') === 'Newchat⌘N') as HTMLButtonElement | undefined;
  btn?.click();
}, 600);
