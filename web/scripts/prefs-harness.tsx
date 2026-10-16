/** Settings → this computer → New chats, with the folder the computer opens new
 *  chats in (#299). Built and photographed by `scripts/shot-prefs.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Preferences } from '../src/screens/Preferences';
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

const h: any = host();
useFleet.setState({
  hosts: { studio: { ...h,
    info: { ...h.info, default_cwd: '/Users/x/projects/quire', default_cwd_chosen: true },
    projects: [{ path: '/Users/x/projects/DevTrace-main', name: 'DevTrace-main', is_git: true }, ...h.projects] } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async () => ({}),
} as any);

createRoot(root).render(createElement(Preferences, { section: 'defaults' }));
