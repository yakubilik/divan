/** The whole panel in the Chat place, a chat whose stored title is
 *  'DevTrace-main · FILM DIZI' open, its name pressed and being changed: the
 *  field with Save and Discard beside it, and the list reading the bare name
 *  under every heading. Built and photographed by `scripts/shot-chattitle.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { App } from '../src/App';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { chat, host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;

const at = Date.now() / 1000 - 60;
const P = '/Users/x/projects';
const h: any = host();
useFleet.setState({
  hosts: { studio: { ...h, chats: [
    chat({ id: 'daily', title: 'DevTrace-main · FILM DIZI', cwd: `${P}/DevTrace-main`, project_set: 1,
           project_id: '', project: null, updated_at: at, last_preview: 'Which series are still on the list?' }),
    chat({ id: 'grouped', title: 'quire · Webhook retry policy', group_id: 'g1', updated_at: at - 5 }),
    chat({ id: 'filed', title: 'hush · Safari login', cwd: `${P}/hush`, project_id: 'p-hush', project: 'hush',
           updated_at: at - 10, last_preview: 'Cookie is set on the wrong domain.' }),
  ] } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (_k: string, type: string) => { if (type === 'divan.snapshot') throw new Error('offline'); return {}; },
} as any);

createRoot(root).render(createElement(App));
// Once the chat is open, its name is pressed and a new one typed — again
// until it holds, since the chat opening late puts the plain name back.
const rename = () => {
  const field = document.querySelector('.dv-chathead input[data-chat-title-input]') as HTMLInputElement | null;
  if (field) {
    if (field.value !== 'Films and series') {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Films and series');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else {
    (document.querySelector('.dv-chathead [data-chat-title]') as HTMLButtonElement | null)?.click();
  }
  setTimeout(rename, 100);
};
setTimeout(rename, 300);
