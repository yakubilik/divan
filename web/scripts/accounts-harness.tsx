/** The chat's Account sheet and Settings › Accounts as #525 left them: the
 *  sheet listing what the computer says when it opens, and a read that failed
 *  said as such. Built and photographed by `scripts/shot-accounts.mjs`. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Preferences } from '../src/screens/Preferences';
import { FieldSheet } from '../src/components/FieldSheet';
import { useFleet } from '../src/lib/fleet';
import { setThemeChoice } from '../src/lib/theme';
import { chat, host } from './panel-fixture.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'sheet';
setThemeChoice('dark');
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';

const h: any = host();
const accounts = [
  { id: 'default-claude', provider: 'claude', label: "This computer's account", logged_in: false,
    detail: '', is_default: true },
  { id: 'work', provider: 'claude', label: 'Work', logged_in: true, detail: 'work@example.com', is_default: false },
  { id: 'second', provider: 'claude', label: 'Second subscription', logged_in: true,
    detail: 'second@example.com', is_default: false },
];
const why = 'The computer took too long to answer';
useFleet.setState({
  hosts: { studio: { ...h, accounts: [] } },
  order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (_k: string, type: string) => {
    if (type === 'account.list') {
      if (view === 'settings-error') throw new Error(why);
      return { accounts };
    }
    return {};
  },
} as any);

if (view === 'settings-error') {
  createRoot(root).render(createElement(Preferences, { section: 'accounts' }));
} else {
  const error = view === 'sheet-error';
  createRoot(root).render(createElement(FieldSheet, {
    field: 'account_id', chat: chat() as any, catalog: h.catalog, projects: [],
    accounts: error ? [] : accounts as any, accountsLoading: false,
    accountsError: error ? why : null, limits: {}, busy: false,
    onPick: () => {}, onClose: () => {},
  }));
}
