/** The top line with its two boxes, one of them open: `?open=machines` or
 *  `?open=inbox`. Built and photographed by `scripts/shot-topbar.mjs`. */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Shell } from '../src/components/Shell';
import { InboxBell } from '../src/components/Inbox';
import { useFleet } from '../src/lib/fleet';
import { useInbox } from '../src/lib/inbox';
import { setThemeChoice, themeCss } from '../src/lib/theme';

const q = new URLSearchParams(location.search);
const scheme = q.get('theme') === 'light' ? 'light' : 'dark';
setThemeChoice(scheme);
document.documentElement.dataset.theme = scheme;
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = scheme;

const now = Date.now() / 1000;
const host = (key: string, machine: string, os: string, v: string, reachable: boolean, running: number, ago: number) => ({
  key, name: key, machine, os, osVersion: v, reachable, stale: !reachable, missing: false, old: false,
  error: null, at: now - ago, age: ago, projects: 3, cards: 8, running, waiting: 0, quota: null,
});
const fleet: any = {
  hosts: [host('studio', 'MacBook', 'macOS', '26.3', true, 2, 20), host('salure', 'Salure', 'Ubuntu', '24.04', true, 0, 40),
          host('cinema', 'Cinema PC', 'Windows', '11', false, 0, 3 * 3600)],
  projects: [], cards: [], agents: [], quota: {}, now,
  totals: { needsYou: 0, stuck: 0, running: 2, unknown: 0, queued: 0, paused: 0, machines: 3, reachable: 2, complete: false, asOf: now },
};
const slot = (name: string) => ({ cfg: { name }, status: 'online', info: null, chats: [], groups: [] });
useFleet.setState({ hosts: { studio: slot('studio'), salure: slot('salure'), cinema: slot('cinema') } as any,
  order: ['studio', 'salure', 'cinema'], focus: 'studio', allHosts: false, ready: true });
useInbox.setState({
  seen: { studio: 2 },
  items: [
    { id: 4, host: 'studio', ticket: 226, ts: now - 120, kind: 'done', project: 'divan', status: 'done',
      title: 'Web top bar: machines popover like Inbox', headline: 'Merged into main after the verifier approved it.',
      body: 'The machines count opens a box with every machine in it. Inbox rows read as a title, the outcome under it and a quieter body.' },
    { id: 3, host: 'studio', ticket: 225, ts: now - 600, kind: 'blocked', project: 'tutor', status: 'blocked',
      title: 'Beta sign-up with Stripe', headline: 'Needs to know which Stripe account the beta should use.',
      body: 'Everything else is built and tested; the checkout page waits on the account.' },
    { id: 2, host: 'studio', ticket: 224, ts: now - 4000, kind: 'failed', project: 'macroly', status: 'failed',
      title: 'Sync meals across devices', headline: 'Tests failed twice.', body: 'npm test exited 1: two sync tests time out against the emulator.' },
    { id: 1, host: 'studio', ticket: 223, ts: now - 9000, kind: 'done', project: 'babysee', status: 'done',
      title: 'Sleep chart in the week view', headline: 'Merged into main.', body: '' },
  ] as any,
});

createRoot(root).render(h('div', null,
  h('style', null, themeCss()),
  h(Shell, { view: 'overview', fleet, onView: () => {}, inbox: h(InboxBell, { onOpen: () => {} }) } as any),
));
setTimeout(() => {
  const which = q.get('open') === 'inbox' ? 'button[data-inbox]' : 'button[data-sys="machines"]';
  (document.querySelector(which) as HTMLButtonElement | null)?.click();
}, 400);
