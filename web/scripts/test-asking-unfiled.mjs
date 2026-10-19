#!/usr/bin/env node
/** A ticket in the holding place that stops on a question opens the Dashboard's
 *  floating chat, and its answer is a note on that ticket.
 *
 *     cd web && node scripts/test-asking-unfiled.mjs
 *
 *  The board is `fixtures/unfiled-ask-snapshot.json`, written by the daemon's
 *  own `Board.snapshot` (`make-unfiled-ask-fixture.py`): a ticket out of a folder
 *  no product claims is imported into the holding place, and the daemon sends
 *  those cards under `unfiled`, not `cards`. The panel used to drop that list in
 *  `answered()` and read only `cards` in `sessions()`, so such a question never
 *  reached `pending()` and no window opened.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking-unfiled');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/App.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/asking-unfiled', '--rootDir', '.',
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

// Images are imported as modules; under Node each is its path, as in test-drive.mjs.
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
try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch { /* fine */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = globalThis.ResizeObserver;
}
if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = globalThis.IntersectionObserver;
}
process.on('unhandledRejection', () => {});

// ── the panel ───────────────────────────────────────────────────────────────

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useDivanStore, answered, merge } = await load('src/lib/divan.js');
const { NO_ASK, sync, pending, phase } = await load('src/lib/asking.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const { host: fixtureHost } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act;

const SNAP = JSON.parse(readFileSync(join(web, 'scripts', 'fixtures', 'unfiled-ask-snapshot.json'), 'utf8'));
const NOW = Math.floor(Date.now() / 1000);
const ASKING = SNAP.unfiled.find((c) => c.agent_status === 'asking');
const ASK = ASKING.agent_detail;
const THREAD = `studio:${ASKING.id}`;

// ── the rules, on the daemon's own answer ───────────────────────────────────

group('a blocked ticket with a question in the holding place is pending');
{
  ok('the fixture is the shape the daemon sends: the asking ticket under `unfiled`, not `cards`',
    ASKING.ustabasi_id === 348 && ASKING.executor === 'coding_agent' && !!ASK
      && !SNAP.cards.some((c) => c.agent_status === 'asking'));
  const view = merge([{ key: 'studio', name: 'studio', state: answered(SNAP, NOW) }], NOW);
  const list = pending(view, {});
  const p = list.find((x) => x.kind === 'ticket');
  ok('pending() yields a ticket with the question whole, on ticket 348',
    list.length === 1 && !!p && p.question === ASK && p.ticket === 348 && p.id === THREAD
      && p.host === 'studio' && p.cardId === ASKING.id,
    JSON.stringify(list.map(({ session, ...x }) => x)));
  ok('the Dashboard\'s count says it needs you, as the list under it does', view.totals.needsYou === 1,
    String(view.totals.needsYou));
  ok('…named by its folder, since no product claims it', p?.project.startsWith('passaparola'), p?.project);
  const state = sync(NO_ASK, list, view, NOW);
  ok('sync opens its window with the question in it, selected',
    state.selected === THREAD && state.threads[0]?.lines[0]?.text === ASK);
  ok('…and the window reads it as asking, not withdrawn', phase(state.threads[0], view, {}) === 'asking',
    phase(state.threads[0], view, {}));
}

// ── the Dashboard, mounted ──────────────────────────────────────────────────

const asked = [];
useFleet.setState({
  hosts: { studio: { ...fixtureHost(), chats: [] } },
  order: ['studio'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('not in this check');
    if (type.startsWith('ustabasi.')) return { ok: true, message: 'noted' };
    return {};
  },
});
useDivanStore.setState({ snaps: { studio: answered(SNAP, NOW) } });
setThemeChoice('dark');

const doc = w.document;
const root = createRoot(doc.getElementById('root'));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };
await act(async () => { root.render(React.createElement(App)); });
await settle();

const win = () => doc.querySelector('[data-asking-window]');

group('the Dashboard opens it by itself and the answer is a note on that ticket');
{
  const said = win()?.textContent ?? '';
  ok('the floating window is open on the Dashboard on that ticket',
    win()?.getAttribute('data-asking-window') === THREAD && w.location.pathname === '/',
    `${win()?.getAttribute('data-asking-window')} ${w.location.pathname}`);
  ok('…with the question whole in it', said.includes(ASK), said.slice(0, 300));
  const input = win().querySelector('input[type="text"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, 'yakupkeskin.dev olsun');
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  const notes = asked.filter((a) => a.type === 'ustabasi.note');
  ok('one ustabasi.note to ticket 348 on the studio, with the words typed',
    notes.length === 1 && notes[0].key === 'studio' && notes[0].data.id === 348
      && notes[0].data.text === 'yakupkeskin.dev olsun', JSON.stringify(notes));
  ok('the window stays open', win()?.getAttribute('data-asking-window') === THREAD);
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
