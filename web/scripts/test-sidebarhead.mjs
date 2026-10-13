#!/usr/bin/env node
/** The head of the Chat place's list: the machine card alone in its row, and
 *  hiding the list a panel icon on the top line.
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-newchat.mjs` mounts it, over two
 *  computers, the first a Mac that calls itself `Dilara-MacBook-Air.local`.
 *  What is driven: the card's name without `.local` and its port on its own;
 *  no button beside the card; the top line's hide control collapsing the list
 *  to the rail and the rail's show bringing it back; and a press on the card
 *  still opening the other computer, which a press on it focuses. Widths are
 *  measured in a real browser by `test-sidebarhead-ui.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'sidebarhead');

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
  '--outDir', '.test-build/sidebarhead', '--rootDir', '.',
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
// Nothing here reaches a network: a poll that finds no socket is left to fail.
process.on('unhandledRejection', () => {});

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const fixture = await import(pathToFileURL(join(web, 'scripts', 'divan-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);

const host = fixtureHost();
const at = Date.now() / 1000 - 60;
const air = {
  ...host, cfg: { ...host.cfg, port: 443, name: 'air' }, info: { ...host.info, name: 'Dilara-MacBook-Air.local' },
  chats: host.chats.map((c, i) => ({ ...c, archived: 0, updated_at: at - i * 5 })),
};
const mini = { ...fixtureHost(), cfg: { ...host.cfg, port: 8766, name: 'mini' }, status: 'offline', chats: [], info: null };

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };
seed(useFleet, {
  hosts: { air, mini }, order: ['air', 'mini'], focus: 'air', ready: true,
  call: async (key, type) => { if (type === 'divan.snapshot') throw new Error('That computer did not answer'); return {}; },
});
seed(useDivanStore, { snaps: { air: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');
localStorage.removeItem('rac.sidebar');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await settle(); };
const header = () => doc.querySelector('header');
const list = () => doc.querySelector('.dv-chatlist');
const head = () => doc.querySelector('[data-sidebar-head]');
const card = () => head()?.querySelector('[data-host-card]') ?? null;
const hide = () => doc.querySelector('button[aria-label="Hide the chat list"]');
const show = () => doc.querySelector('button[aria-label="Show the chat list"]');
const railed = () => !!list() && list().style.width === '48px';
const PANEL = /^M5 4h14a2 2 0 0 1 2 2v12/;

group('the Chat place');
await click([...header().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('Chats')));
ok('the list is open, 260px', !!list() && list().style.width === '260px', list()?.style.width);

group('the machine card');
ok('the card is the only thing in its row: no button beside it',
  !!card() && head().children.length === 1 && !head().querySelector(':scope > button')
    && [...head().querySelectorAll('button')].every((b) => card().parentElement.contains(b)),
  head()?.outerHTML.slice(0, 300));
ok('no chevron-left button anywhere in the list', ![...list().querySelectorAll('path')]
  .some((p) => p.getAttribute('d') === 'm15 5-7 7 7 7'));
const name = head().querySelector('[data-host-name]')?.textContent;
ok('the name drops .local: Dilara-MacBook-Air', name === 'Dilara-MacBook-Air', name);
ok('the port is apart from the status, in smaller type',
  /online/.test(card().textContent) && [...card().querySelectorAll('span')].some((s) => s.textContent === ':443' && s.style.fontSize === '10px'),
  card().textContent);
const carets = [...card().querySelectorAll('svg path')].map((p) => p.getAttribute('d'));
ok('one affordance: a single dropdown caret', carets.filter((d) => d === 'm6 9 6 6 6-6').length === 1
  && !carets.includes('m9 6 6 6-6 6'), JSON.stringify(carets));

group('the card still opens the other computer');
await click(card());
const other = () => [...head().querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('mini'));
ok('a press on the card lists the other computer', !!other() && card().getAttribute('aria-expanded') === 'true');
await click(other());
ok('picking it focuses it', useFleet.getState().focus === 'mini' && head().querySelector('[data-host-name]')?.textContent === 'mini',
  useFleet.getState().focus);
await click(card());
await click([...head().querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Dilara-MacBook-Air')));
ok('and back', useFleet.getState().focus === 'air');

group('hide and show');
ok('hide is on the top line, a panel icon, the line’s own icon button',
  !!hide() && header().contains(hide()) && !list().contains(hide()) && hide().classList.contains('dv-icon-btn')
    && PANEL.test(hide().querySelector('path')?.getAttribute('d') ?? ''), hide()?.outerHTML);
await click(hide());
ok('pressed, the list is the rail and the hide control is gone', railed() && !hide(), list()?.style.width);
ok('the rail’s show is the same quiet panel icon', !!show() && list().contains(show()) && show().classList.contains('dv-icon-btn')
  && PANEL.test(show().querySelector('path')?.getAttribute('d') ?? ''), show()?.outerHTML);
await click(show());
ok('show brings the list back, with the card and the hide control', !railed() && !!card() && !!hide(), list()?.style.width);

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nThe chat list head: all checks passed');
process.exit(0);
