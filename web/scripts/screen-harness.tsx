/** The remote screen, live, over a fake computer whose frames the shot server
 *  hands out. `?state=blocked` is a Mac that has not granted Accessibility.
 *  Built and photographed by `scripts/shot-screen.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Screen } from '../src/screens/Screen';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const blocked = q.get('state') === 'blocked';
setThemeChoice('dark');
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';

const caps = blocked
  ? { view: true, control: false, enabled: true, os: 'Darwin', displays: [],
      reason: 'macOS has not granted this app Accessibility permission, so clicks would go nowhere — System Settings › Privacy & Security › Accessibility' }
  : { view: true, control: true, enabled: true, os: 'Darwin', reason: null, displays: [] };
const h: any = host();
useFleet.setState({
  hosts: { studio: { ...h, cfg: { ...h.cfg, port: Number(location.port) } } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (_k: string, type: string) => {
    if (type === 'screen.info') return caps;
    if (type === 'screen.clipboard.get') return { text: 'divan pair --print', truncated: false };
    return {};
  },
} as any);

createRoot(root).render(createElement('div', { style: { height: '100%', display: 'flex' } }, createElement(Screen)));
setTimeout(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Connect');
  btn?.click();
  if (!blocked) {
    // A copy, so the line it leaves is in the picture.
    setTimeout(() => {
      const mac = /Mac/.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: mac, ctrlKey: !mac, bubbles: true }));
    }, 300);
  } else {
    setTimeout(() => {
      const pic = [...document.querySelectorAll('div')].find((d) => d.style.transform.startsWith('scale'));
      pic?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300 }));
    }, 300);
  }
}, 400);
