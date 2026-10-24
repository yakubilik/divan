#!/usr/bin/env node
/** A computer's sign-ins are read when a screen needs them, not once per page
 *  load (#525).
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-chattitle.mjs` mounts it, with
 *  two computers: `studio`, in focus, and `mac`, whose accounts were never
 *  read. The way it went wrong: the chat screen asked `account.list` only for
 *  the computer in focus, only while that list was empty, and dropped a failure
 *  without asking again — so a chat on another computer, a list read while
 *  every sign-in said "signed out", or one answer that timed out left the
 *  Account sheet and Settings › Accounts empty until the page was reloaded.
 *
 *  Checked here: opening a chat's Account sheet asks that chat's computer and
 *  draws what it says; a refused `account.list` is said in the sheet and in
 *  Settings › Accounts rather than drawn as "no accounts"; and Settings ›
 *  Accounts lists the focused computer after the sidebar goes to All computers
 *  and back, and after that computer reconnects.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'accounts-refetch');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/accounts-refetch', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });

for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (
      spec.endsWith('.js') ? m : `${a}${spec}.js${z}`
    )));
}
mkdirSync(join(out, 'src', 'assets'), { recursive: true });
for (const f of readdirSync(join(web, 'src', 'assets'))) {
  if (f.endsWith('.png')) writeFileSync(join(out, 'src', 'assets', `${f}.js`), `export default ${JSON.stringify(`/assets/${f}`)};\n`);
}

// ── a document ──────────────────────────────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/', pretendToBeVisual: true,
});
const w = dom.window;
for (const name of Object.getOwnPropertyNames(w)) {
  if (name in globalThis) continue;
  try { globalThis[name] = w[name]; } catch { /* not ours */ }
}
for (const name of ['window', 'document', 'location', 'history', 'localStorage',
                    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
                    'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  try { globalThis[name] = w[name]; } catch { /* as above */ }
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
} catch { /* node's own is good enough */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
  if (!globalThis[name]) {
    globalThis[name] = class { observe() {} unobserve() {} disconnect() {} };
    w[name] = globalThis[name];
  }
}
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function scrollIntoView() {};
process.on('unhandledRejection', () => {});

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const at = Date.now() / 1000 - 60;
const host = (name, list, accounts) => {
  const h = fixtureHost();
  return { ...h, cfg: { ...h.cfg, name, host: `${name}.local` }, info: { ...h.info, name }, chats: list, accounts };
};

/** What the Mac says when it is asked: its own account and two more. */
const macAccounts = () => [
  { id: 'default-claude', provider: 'claude', label: "This computer's account", logged_in: false,
    detail: '', is_default: true },
  { id: 'work', provider: 'claude', label: 'Work', logged_in: true, detail: 'work@example.com', is_default: false },
  { id: 'second', provider: 'claude', label: 'Second subscription', logged_in: true,
    detail: 'second@example.com', is_default: false },
];

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

const asked = [];
/** What account.list does on the Mac: answer, or refuse with this text. */
let refuse = null;
seed(useFleet, {
  hosts: {
    studio: host('studio', [fakeChat({ id: 's1', title: 'Studio chat', updated_at: at })], fixtureHost().accounts),
    mac: host('mac', [fakeChat({ id: 'm1', title: 'OAuth chat', updated_at: at - 5 })], []),
  },
  order: ['studio', 'mac'], focus: 'studio', ready: true, allHosts: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    if (type === 'agent.list') return { agents: [] };
    if (type === 'account.list') {
      await new Promise((r) => setTimeout(r, 5));
      if (refuse) throw new Error(refuse);
      return { accounts: key === 'mac' ? macAccounts() : fixtureHost().accounts };
    }
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 6; i++) await tick(10); };
const nav = (label) => [...(doc.querySelector('header')?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
const pane = () => doc.querySelector('.dv-chatpane');
const rowBtn = (id) => pane()?.querySelector(`[data-chat-title="${id}"]`)?.closest('button')
  ?? [...(pane()?.querySelectorAll('[data-chat-title]') ?? [])]
    .find((el) => el.textContent === id)?.closest('button') ?? null;
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
};
const accountChip = () => doc.querySelector('[title="Account running this chat"]');
const lists = (key) => asked.filter((a) => a.type === 'account.list' && a.key === key).length;
const go = async (path) => {
  await act(async () => {
    w.history.pushState(null, '', path);
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
  });
  await settle();
};
/** What a person reads: the page's text without the stylesheets' text. */
const text = () => {
  const walk = doc.createTreeWalker(doc.body, w.NodeFilter.SHOW_TEXT);
  const parts = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.parentElement?.closest('style, script')) parts.push(n.nodeValue ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ');
};

// ── the chat's Account sheet ────────────────────────────────────────────────

group('the Account sheet of a chat on a computer whose accounts were never read');
await click(nav('Chats'));
await settle();
const m1 = rowBtn('m1') ?? rowBtn('OAuth chat');
ok('the Mac’s chat is in the All computers list', !!m1);
await click(m1);
await settle();
// Whatever opening the chat read, the list is cleared again: the sheet itself
// has to ask.
await act(async () => {
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, accounts: [] } } }));
});
const before = lists('mac');
ok('a chip to open the Account sheet', !!accountChip());
await click(accountChip());
await settle();
ok('opening the sheet asks the Mac for account.list', lists('mac') > before,
  `account.list on mac: ${lists('mac')} (was ${before})`);
const body = text();
ok('the sheet lists the Mac’s signed-in accounts', /Work/.test(body) && /Second subscription/.test(body)
  && /work@example\.com/.test(body), body.slice(0, 400));
ok('…and does not say there is nothing to choose', !/Nothing to choose/.test(body));
await act(async () => { doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
await settle();

group('a stale list is read again when the sheet opens');
await act(async () => {
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, accounts: [macAccounts()[0]] } } }));
});
const stale = lists('mac');
await click(accountChip());
await settle();
ok('opening it again asks again', lists('mac') > stale, `${lists('mac')} vs ${stale}`);
ok('…and what the computer says now replaces the stale list', /Second subscription/.test(text()));
await act(async () => { doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
await settle();

group('a refused account.list is said in the sheet');
await act(async () => {
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, accounts: [] } } }));
});
refuse = 'The computer took too long to answer';
await click(accountChip());
await settle();
ok('the sheet says why the accounts could not be read', /took too long to answer/.test(text()), text().slice(0, 400));
ok('…and not that there is nothing to choose', !/Nothing to choose/.test(text()));
await act(async () => { doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
await settle();

// ── Settings › Accounts ─────────────────────────────────────────────────────

group('Settings › Accounts on the focused computer');
await act(async () => {
  useFleet.setState((s) => ({ focus: 'mac', hosts: { ...s.hosts, mac: { ...s.hosts.mac, accounts: [] } } }));
});
await go('/machine/preferences/accounts');
ok('a refused list says why', /took too long to answer/.test(text()), text().slice(0, 600));
ok('…and does not read as "No accounts on this computer"', !/No accounts on this computer/.test(text()));

refuse = null;
group('after the sidebar goes to one computer and back to All computers');
await go('/chats');
const card = doc.querySelector('[data-host-card]');
await click(card);
const pick = [...doc.querySelectorAll('.dv-chatlist button')].find((b) => /mac/.test(b.textContent ?? '')
  && !b.hasAttribute('data-host-card'));
ok('the sidebar offers the Mac on its own', !!pick);
if (pick) await click(pick);
await settle();
ok('the sidebar is on the Mac alone', !useFleet.getState().allHosts && useFleet.getState().focus === 'mac');
await click(doc.querySelector('[data-host-card]'));
const all = [...doc.querySelectorAll('.dv-chatlist button')].find((b) => /All computers/.test(b.textContent ?? '')
  && !b.hasAttribute('data-host-card'));
ok('…and offers All computers', !!all);
if (all) await click(all);
await settle();
ok('the sidebar is on All computers', useFleet.getState().allHosts);
await go('/machine/preferences/accounts');
ok('Settings › Accounts lists the Mac’s accounts', /Second subscription/.test(text()) && /Work/.test(text()),
  text().slice(0, 600));
ok('…with no stale refusal over them', !/took too long to answer/.test(text()));

group('after the computer reconnects');
await act(async () => {
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, accounts: [] } } }));
});
const beforeReconnect = lists('mac');
// The socket drops and comes back within one render: what the page sees is
// online, then online again, with a newer lastOnline.
await act(async () => {
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, status: 'connecting' } } }));
  useFleet.setState((s) => ({ hosts: { ...s.hosts, mac: { ...s.hosts.mac, status: 'online', lastOnline: Date.now() + 1000 } } }));
});
await settle();
ok('the reconnect asks again', lists('mac') > beforeReconnect, `${lists('mac')} vs ${beforeReconnect}`);
ok('…and the accounts are listed again', /Second subscription/.test(text()), text().slice(0, 600));

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAccounts read when they are needed: all checks passed');
process.exit(0);
