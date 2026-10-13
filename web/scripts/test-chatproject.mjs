#!/usr/bin/env node
/** A chat filed under a product says that product's name in the middle of its
 *  head, and the name is the way to the product's own page.
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-chattitle.mjs` mounts it, over a
 *  computer whose board has a product called Divan and a chat filed under it.
 *  The name is drawn between the chat's own name and its chips, larger and
 *  bolder than the line under the chat's name, and the two sides of it are
 *  given equal shares of the bar — which is what the stylesheet is read for,
 *  since nothing is laid out here (`test-chatproject-ui.mjs` measures the same
 *  thing in a real browser). Pressed, it opens a menu with Dashboard in it;
 *  Escape and a press outside close that and leave the history alone;
 *  Dashboard is one step to `/p/divan`, and Back is the same chat. A chat
 *  filed under nothing has nothing in the middle, and the chat's own name is
 *  still renamed in place.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'chatproject');

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
  '--outDir', '.test-build/chatproject', '--rootDir', '.',
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

const at = Date.now() / 1000 - 60;
const P = '/Users/x/projects';
const chats = () => [
  fakeChat({ id: 'filed', title: 'Divan · Sidebar arrows', cwd: `${P}/private`,
             project_id: 'p-divan', project: 'Divan', updated_at: at }),
  fakeChat({ id: 'loose', title: 'Dinner plans', cwd: `${P}/notes`,
             project_set: 1, project_id: '', project: null, updated_at: at - 5 }),
  // Filed under the board's holding place for unclaimed work: not a product.
  fakeChat({ id: 'unfiled', title: 'Odd job', cwd: `${P}/misc`,
             project_id: 'p-unfiled', project: null, updated_at: at - 10 }),
];
/** The studio's board, with a product called Divan on it. */
const board = () => {
  const snap = fixture.studio();
  const like = snap.projects.find((p) => p.id === 'p-hush');
  snap.projects.push({ ...like, id: 'p-divan', name: 'Divan', slug: 'divan', summary: 'the panel itself',
                       repos: [`${P}/divan`], sort: 3 });
  return snap;
};
const host = () => {
  const h = fixtureHost();
  return { ...h, chats: chats() };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

const asked = [];
seed(useFleet, {
  hosts: { studio: host() }, order: ['studio'], focus: 'studio', ready: true, allHosts: false,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    if (type === 'agent.list') return { agents: [] };
    if (type === 'chat.update') {
      const was = useFleet.getState().hosts[key].chats.find((c) => c.id === data.chat_id);
      return { ...was, ...data, id: data.chat_id, title_by: 'user' };
    }
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(board(), Date.now() / 1000) } });
setThemeChoice('dark');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
const nav = (label) => [...(doc.querySelector('header')?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
const head = () => doc.querySelector('.dv-chathead');
const rowOf = (id) => doc.querySelector(`.dv-chatpane [data-chat-title="${id}"]`)?.closest('button') ?? null;
const headTitle = () => head()?.querySelector('.dv-chatname [data-chat-title]') ?? null;
const centre = () => head()?.querySelector('[data-chat-project]') ?? null;
const name = () => head()?.querySelector('[data-chat-project-name]') ?? null;
const menu = () => head()?.querySelector('[role="menu"]') ?? null;
const items = () => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((b) => (b.textContent ?? '').trim());
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
};
const key = async (el, k) => {
  await act(async () => { el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
};
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};
const path = () => w.location.pathname;
const px = (v) => parseFloat(v || '0');

// ── the name in the middle ──────────────────────────────────────────────────

group('a chat filed under Divan says Divan in the middle of its head');
await click(nav('Chats'));
await settle();
await click(rowOf('filed'));
await settle();
ok('the chat is open at its own address', path() === '/chats/filed' && headTitle()?.textContent === 'Sidebar arrows',
  `${path()} · ${headTitle()?.textContent}`);
ok('the head says Divan, once, as a button', name()?.textContent === 'Divan'
  && head().querySelectorAll('[data-chat-project]').length === 1 && name().tagName === 'BUTTON', name()?.textContent);
const kids = [...head().children].map((c) => c.className.split(' ')[0]);
ok('it sits between the chat’s name and the chips', kids.join(',') === 'dv-chatname,dv-chatproject,dv-chatchips', kids.join(','));
const sub = head().querySelector('.dv-chatname > div:last-child');
ok('the line under the chat’s name is still there (and is what names the folder)', /private · \d+ messages/.test(sub?.textContent ?? ''),
  sub?.textContent);
ok('larger and bolder than that line', px(name().style.fontSize) > px(sub.style.fontSize)
  && Number(name().style.fontWeight) >= 700 && px(name().style.fontSize) >= 20,
  `${name().style.fontSize}/${name().style.fontWeight} vs ${sub.style.fontSize}`);
ok('…and than the chat’s own name', px(name().style.fontSize) > px(headTitle().style.fontSize),
  `${name().style.fontSize} vs ${headTitle().style.fontSize}`);
ok('a name too long for its room is cut, not spilled', name().style.overflow === 'hidden'
  && name().style.textOverflow === 'ellipsis' && name().style.whiteSpace === 'nowrap');

group('the stylesheet keeps it in the middle');
const css = readFileSync(join(web, 'src', 'styles', 'divan-app.css'), 'utf8').replace(/\s+/g, ' ');
const wide = css.match(/@container \(min-width:(\d+)px\)\{(.*?\})\s*\}/);
ok('the head is the container its own width is asked of', /\.dv-chathead\{container-type:inline-size\}/.test(css));
ok('hidden unless the head is wide enough for three things', /\.dv-chatproject\{display:none\}/.test(css) && !!wide
  && /\.dv-chatproject\{display:block;[^}]*flex:0 1 auto/.test(wide?.[2] ?? ''), wide?.[0]);
ok('the name and the chips are given equal shares (flex 1 1 0 each)',
  /\.dv-chathead--project>\.dv-chatname\{flex:1 1 0!important\}/.test(wide?.[2] ?? '')
  && /\.dv-chathead--project>\.dv-chatchips\{flex:1 1 0;/.test(wide?.[2] ?? ''), wide?.[2]);
ok('chips that do not fit their share wrap instead of running under the name',
  /\.dv-chathead--project>\.dv-chatchips\{[^}]*flex-wrap:wrap/.test(wide?.[2] ?? ''));
ok('the name has a width it is cut at', /\.dv-chatproject\{[^}]*max-width:min\(260px,26%\)/.test(wide?.[2] ?? ''));
ok('the head is marked as having a middle', head().classList.contains('dv-chathead--project'), head().className);

// ── the menu ────────────────────────────────────────────────────────────────

group('pressing the name opens a menu with Dashboard in it');
ok('closed to begin with', !menu() && name().getAttribute('aria-expanded') === 'false');
const entries = w.history.length;
await click(name());
ok('a menu, with one row: Dashboard', items().join(',') === 'Dashboard' && name().getAttribute('aria-expanded') === 'true',
  items().join(','));
await key(doc.body, 'Escape');
ok('Escape closes it', !menu());
ok('…and the chat is still the page, with no entry pushed', path() === '/chats/filed' && w.history.length === entries
  && headTitle()?.textContent === 'Sidebar arrows', `${path()} · ${entries} → ${w.history.length}`);
await click(name());
ok('open again', items().join(',') === 'Dashboard');
await act(async () => { doc.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); });
ok('a press outside closes it', !menu());
ok('…with no entry pushed either', path() === '/chats/filed' && w.history.length === entries,
  `${path()} · ${entries} → ${w.history.length}`);
await click(name());
await click(name());
ok('a second press on the name closes it too', !menu() && w.history.length === entries);

group('Dashboard is the product’s own page, one step away');
await click(name());
await click(menu().querySelector('[data-chat-project-dashboard]'));
await settle();
const page = () => doc.querySelector('[data-project-page]');
ok('the address is /p/divan', path() === '/p/divan', path());
ok('the product’s page is drawn: scoped to Divan, its chats down the side, no chat open',
  !!page() && !doc.querySelector('.dv-chathead') && !!page().querySelector('[data-chat-title="filed"]')
    && !page().querySelector('[data-chat-title="loose"]') && /Divan/.test(doc.body.textContent ?? ''),
  `${!!page()} · head ${!!doc.querySelector('.dv-chathead')}`);
ok('exactly one entry was pushed', w.history.length === entries + 1, `${entries} → ${w.history.length}`);
await act(async () => {
  w.history.back();
  for (let n = 0; n < 50 && w.location.pathname === '/p/divan'; n++) await new Promise((r) => setTimeout(r, 10));
});
await settle();
ok('Back is the same chat, at its address, the name in the middle again',
  path() === '/chats/filed' && headTitle()?.textContent === 'Sidebar arrows' && name()?.textContent === 'Divan' && !menu(),
  `${path()} · ${headTitle()?.textContent} · ${name()?.textContent}`);

// ── a chat with no product ──────────────────────────────────────────────────

group('a chat filed under nothing has nothing in the middle');
for (const id of ['loose', 'unfiled']) {
  await click(rowOf(id));
  await settle();
  ok(`${id}: no name in the middle, and the head is the two things it was`,
    path() === `/chats/${id}` && !!headTitle() && !centre() && !head().classList.contains('dv-chathead--project')
      && [...head().children].map((c) => c.className).join(',') === 'dv-chatname,dv-chatchips',
    `${path()} · ${[...head().children].map((c) => c.className).join(',')}`);
}

// ── the chat's own name is still renamed in place ───────────────────────────

group('renaming in place still works beside it');
await click(rowOf('filed'));
await settle();
asked.length = 0;
await click(headTitle());
const field = () => head()?.querySelector('input[data-chat-title-input]') ?? null;
ok('pressed, the chat’s name is a field; the product’s name stays where it is',
  field()?.value === 'Sidebar arrows' && name()?.textContent === 'Divan' && !menu(), field()?.value);
await type(field(), 'Sidebar arrow order');
await key(field(), 'Enter');
await settle();
const renames = asked.filter((a) => a.type === 'chat.update');
ok('Enter sends the rename and the head says it',
  renames.length === 1 && JSON.stringify(renames[0].data) === JSON.stringify({ chat_id: 'filed', title: 'Sidebar arrow order' })
    && headTitle()?.textContent === 'Sidebar arrow order' && name()?.textContent === 'Divan',
  `${JSON.stringify(renames)} · ${headTitle()?.textContent}`);

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nChat head, the product in the middle: all checks passed');
process.exit(0);
