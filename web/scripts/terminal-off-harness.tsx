/** Machine › Terminal on a computer whose terminal is turned off
 *  (`terminal = false` in its config.toml): the sentence in place of a shell.
 *  Built and photographed by `scripts/shot-terminal-off.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Shells } from '../src/components/Shells';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { host } from './panel-fixture.js';

setThemeChoice('dark');
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';

const h: any = host();
useFleet.setState({
  hosts: { studio: { ...h, info: { ...(h.info ?? {}), name: 'studio', terminal: false } } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async () => { throw Object.assign(new Error('nothing is sent'), { code: 'terminal_disabled' }); },
} as any);

createRoot(root).render(createElement('div', { style: { height: '100%', display: 'flex' } },
  createElement(Shells, { header: null })));
