/** An answer with a pipe table, two diagrams, a broken diagram and a fence
 *  still streaming, drawn by `Prose` in a chat-wide column. Built and driven
 *  by `scripts/test-prose-ui.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Prose } from '../src/components/Bubble';
import { setThemeChoice, themeCss } from '../src/lib/theme';
import { ShareContext } from '../src/components/ShareChip';
import { useFleet } from '../src/lib/fleet';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
const style = document.createElement('style');
style.textContent = themeCss();
document.head.appendChild(style);
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root';
root.dataset.theme = scheme;

const fence = '```';
export const ANSWER = [
  'Kalem kalem, normal bir ay:',
  '',
  '| Servis | Ne yapıyor | Aylık |',
  '|---|---|--:|',
  '| **AWS EC2 app** (`t4g.medium`) | API, web, Keycloak | ~30 $ |',
  '| **ElevenLabs** | Sanal öğrencinin sesi | 99 $ |',
  '| **Cloudflare Stream** | Videolar | 6 $ |',
  '',
  'Grafik:',
  '',
  `${fence}mermaid`,
  'xychart-beta horizontal',
  '    title "Normal bir ay (TL)"',
  '    x-axis ["ElevenLabs", "App sunucusu", "Provalar", "Veritabanı"]',
  '    y-axis "TL" 0 --> 5500',
  '    bar [4950, 1500, 2000, 850]',
  fence,
  '',
  `${fence}mermaid`,
  'pie title Nereye gidiyor',
  '    "ElevenLabs" : 4950',
  '    "AWS" : 4100',
  '    "Provalar" : 2000',
  fence,
  '',
  'Bozuk olan:',
  '',
  `${fence}mermaid`,
  'this is not mermaid at all {{{',
  fence,
  '',
  'Hâlâ yazılıyor:',
  '',
  `${fence}mermaid`,
  'pie title Yarım',
].join('\n');

// The daemon, as far as a shared key's chip asks it: every call written down.
(window as any).__calls = [];
useFleet.setState({
  call: async (host: string, type: string, data: any) => {
    (window as any).__calls.push({ host, type, data });
    if (data.service === 'rac-secret-gone') throw Object.assign(new Error('gone'), { code: 'secret_gone' });
    return { value: 'the-value-123' };
  },
} as any);
const SHARED = 'Şifre: [secret-share rac-secret-grikoc-deneme Gri Koç deneme şifresi] ve eski: [secret-share rac-secret-gone]';
const now = Date.now() / 1000;

createRoot(root).render(
  createElement('div', { style: { width: 760, padding: 24, color: 'var(--ink)', fontSize: 15, lineHeight: '22px' } },
    createElement(Prose, { text: ANSWER }),
    createElement('div', { 'data-case': 'live' },
      createElement(ShareContext.Provider, { value: { hostKey: 'studio', chatId: 'c1', sentAt: now - 60 } },
        createElement(Prose, { text: SHARED }))),
    createElement('div', { 'data-case': 'old' },
      createElement(ShareContext.Provider, { value: { hostKey: 'studio', chatId: 'c1', sentAt: now - 4000 } },
        createElement(Prose, { text: SHARED }))),
    createElement('div', { 'data-case': 'nochat' }, createElement(Prose, { text: SHARED }))),
);
