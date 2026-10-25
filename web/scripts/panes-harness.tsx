/** The whole panel with eight chats on one computer, for the Panes screen.
 *  Built and driven by `scripts/test-panes-ui.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { App } from '../src/App';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { logKey, useLogs } from '../src/lib/timeline';
import { paneRenders } from '../src/screens/Panes';
import { chat, host } from './panel-fixture.js';

setThemeChoice('dark');
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';

const NOW = Math.floor(Date.now() / 1000);
/** What each chat is about, and the two turns its conversation has so far. */
const TALK: [string, string, string][] = [
  ['Webhook retry policy', 'The Stripe webhooks fail on a cold start — make the retries back off.',
    'Done: retries now back off 1s, 4s, 16s, 64s, then go to the dead-letter queue. Tests pass.'],
  ['Safari login', 'Login on Safari 18 loops back to the sign-in page.',
    'The session cookie was SameSite=None without Secure on the preview domain. Fixed and deployed to staging.'],
  ['Invoice PDF', 'The invoice PDF cuts off the VAT line on A4.',
    'The footer had a fixed height. It now grows with the totals block; A4 and Letter both render whole.'],
  ['Paywall copy', 'Rewrite the paywall headline, three options.',
    '1. Learn faster, every day.  2. Your tutor, always on.  3. Unlock every lesson — cancel anytime.'],
  ['Onboarding flow', 'Cut the onboarding to three screens.',
    'Merged the goal and level screens, moved notifications to after the first lesson. Three screens now.'],
  ['Release notes', 'Draft the 2.4 release notes.',
    'Drafted: offline lessons, faster sync, the Safari login fix and the new invoice layout.'],
  ['Crash on launch', 'Android 15 crashes on launch since 2.3.1.',
    'A null splash theme on Android 15. Patched the manifest; the crash is gone on the emulator.'],
  ['Pricing page', 'Add a yearly toggle to the pricing page.',
    'Added — yearly shows the monthly price with “2 months free” under it.'],
];
const h: any = host();
h.chats = TALK.map(([title], i) => chat({ id: `c${i + 1}`, title, status: 'idle', updated_at: NOW - i * 90 }));
const sent: any[] = [];
(window as any).__sent = sent;
(window as any).__renders = paneRenders;
useFleet.setState({
  hosts: { studio: h }, order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (_key: string, type: string, data: any) => {
    if (type === 'divan.snapshot') throw new Error('offline');
    if (type === 'chat.send') { sent.push(data); return { accepted: true, queued: false }; }
    if (type === 'chat.get') return { events: [], more: false };
    return {};
  },
} as any);
useLogs.setState({ logs: Object.fromEntries(TALK.map(([, ask, said], i) => [logKey('studio', `c${i + 1}`), {
  items: [
    { kind: 'user', id: `u${i}`, ts: NOW - 600 + i, text: ask, attachments: [], queued: false },
    { kind: 'assistant', id: `a${i}`, ts: NOW - 540 + i, segment: 0, text: said, done: true },
  ],
  seq: 10, truncated: false, busy: false, pending: [], loading: false, error: null,
}])) } as any);
(window as any).__feed = (chatId: string, seq: number, event: string, data: any) =>
  useLogs.getState().feed('studio', { seq, event, chat_id: chatId, ts: Date.now() / 1000, data } as any);

createRoot(root).render(createElement(App));
