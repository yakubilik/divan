#!/usr/bin/env node
/** A chat's name reads the same in the list as over the chat, and is renamed
 *  where it is read.
 *
 *     cd web && npm test
 *
 *  The panel mounted into jsdom the way `test-newchat.mjs` mounts it, with
 *  chats whose stored titles carry the project in front ('DevTrace-main · FILM
 *  DIZI') under every kind of heading: Daily, a group, a product, and the
 *  merged list of every computer. Each row has to say what the header says.
 *  Then the header's name is pressed and edited in place: Save and Discard
 *  only once the text differs, Enter and Save send `chat.update` with exactly
 *  what was typed, Escape and Discard send nothing, and the row in the list
 *  says the new name as soon as the computer answers — no event, no reload.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'chattitle');

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
  '--outDir', '.test-build/chattitle', '--rootDir', '.',
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
/** One chat under each heading a computer's list has, every one stored the way
 *  the computer stores titles: the project first. */
const chats = () => [
  fakeChat({ id: 'daily', title: 'DevTrace-main · FILM DIZI', cwd: `${P}/DevTrace-main`,
             project_set: 1, project_id: '', project: null, updated_at: at }),
  fakeChat({ id: 'grouped', title: 'quire · Webhook retry policy', cwd: `${P}/quire`,
             group_id: 'g1', updated_at: at - 5 }),
  fakeChat({ id: 'filed', title: 'hush · Safari login', cwd: `${P}/hush`,
             project_id: 'p-hush', project: 'hush', updated_at: at - 10 }),
];
const host = (name, list) => {
  const h = fixtureHost();
  return { ...h, cfg: { ...h.cfg, name }, info: { ...h.info, name }, chats: list };
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const seed = (store, patch) => { Object.assign(store.getInitialState(), patch); store.setState(patch); };

const asked = [];
/** Whether the computer answers a rename; off, it refuses it. */
let answering = true;
seed(useFleet, {
  hosts: { studio: host('studio', chats()) }, order: ['studio'], focus: 'studio', ready: true, allHosts: false,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('That computer did not answer');
    if (type === 'agent.list') return { agents: [] };
    // Answered the way the daemon answers it — the chat as it now is — and
    // with no `chat.updated` broadcast behind it: what the list shows is what
    // the panel did with the answer.
    if (type === 'chat.update') {
      if (!answering) throw new Error('refused');
      const was = useFleet.getState().hosts[key].chats.find((c) => c.id === data.chat_id);
      return { ...was, ...data, id: data.chat_id, title_by: 'user' };
    }
    return {};
  },
});
seed(useDivanStore, { snaps: { studio: answered(fixture.studio(), Date.now() / 1000) } });
setThemeChoice('dark');

const root = createRoot(w.document.getElementById('root'));
await act(async () => { root.render(React.createElement(App)); });

// ── what is on screen ───────────────────────────────────────────────────────

const doc = w.document;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const settle = async () => { for (let i = 0; i < 5; i++) await tick(10); };
const nav = (label) => [...(doc.querySelector('header')?.querySelectorAll('button') ?? [])]
  .find((b) => (b.textContent ?? '').trim().startsWith(label)) ?? null;
const pane = () => doc.querySelector('.dv-chatpane');
/** The title a chat's row in the list shows, and the heading it is under. */
const row = (id) => {
  const el = [...(pane()?.querySelectorAll(`[data-chat-title="${id}"]`) ?? [])][0];
  const section = el?.closest('[data-section]')?.getAttribute('data-section') ?? null;
  const btn = el?.closest('button');
  const r = { title: el?.textContent ?? null, section, where: btn?.querySelector('[data-chat-where]')?.textContent ?? null };
  // The button is kept off the enumerable fields so a row prints as JSON.
  return Object.defineProperty(r, 'btn', { value: btn, enumerable: false });
};
const headTitle = () => pane()?.querySelector('.dv-chathead [data-chat-title]') ?? null;
const field = () => pane()?.querySelector('.dv-chathead input[data-chat-title-input]') ?? null;
const headButtons = () => [...(pane()?.querySelectorAll('.dv-chathead button') ?? [])]
  .map((b) => (b.textContent ?? '').trim()).filter((t) => t === 'Save' || t === 'Discard');
const headButton = (label) => [...(pane()?.querySelectorAll('.dv-chathead button') ?? [])]
  .find((b) => (b.textContent ?? '').trim() === label) ?? null;
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
const blur = async (el) => { await act(async () => { el.blur(); }); };
const renames = () => asked.filter((a) => a.type === 'chat.update');
const stored = (id) => useFleet.getState().hosts.studio.chats.find((c) => c.id === id)?.title;

// ── the list says what the header says, under every heading ─────────────────

group('a stored "<project> · X" reads X in every section');
await click(nav('Chats'));
await settle();
const daily = row('daily');
ok('Daily: the row says FILM DIZI, the folder quietly beside it',
  daily.section === '__loose' && daily.title === 'FILM DIZI' && /DevTrace-main/.test(daily.where ?? ''),
  JSON.stringify(daily));
const grouped = row('grouped');
ok('a group: the row says Webhook retry policy', grouped.section === 'g1' && grouped.title === 'Webhook retry policy',
  JSON.stringify(grouped));
const filed = row('filed');
ok('a product: the row says Safari login, with no project repeated under its own heading',
  filed.section === 'project:hush' && filed.title === 'Safari login' && filed.where === null, JSON.stringify(filed));

await click(daily.btn);
await settle();
ok('the header says the same as the row', headTitle()?.textContent === 'FILM DIZI' && row('daily').title === 'FILM DIZI',
  `${headTitle()?.textContent} / ${row('daily').title}`);
for (const id of ['grouped', 'filed']) {
  await click(row(id).btn);
  await settle();
  ok(`${id}: the header and the row agree`, headTitle()?.textContent === row(id).title,
    `${headTitle()?.textContent} / ${row(id).title}`);
}

// Every computer at once: the headings are the computers.
await act(async () => {
  useFleet.setState({
    hosts: { ...useFleet.getState().hosts,
             cinema: host('cinema', [fakeChat({ id: 'far', title: 'Kuran-app · Audio cache', cwd: `${P}/Kuran-app`,
                                                updated_at: at })]) },
    order: ['studio', 'cinema'], allHosts: true,
  });
});
await settle();
const far = row('far');
const fleetDaily = row('daily');
ok('the fleet list: rows say X, under the computer’s heading',
  far.section === 'cinema' && far.title === 'Audio cache' && fleetDaily.section === 'studio'
    && fleetDaily.title === 'FILM DIZI',
  `${JSON.stringify(far)} ${JSON.stringify(fleetDaily)}`);
await act(async () => {
  const { cinema, ...rest } = useFleet.getState().hosts;
  useFleet.setState({ hosts: rest, order: ['studio'], allHosts: false });
});
await settle();

// ── the header's name is a field ────────────────────────────────────────────

group('pressing the header name edits it in place');
await click(row('daily').btn);
await settle();
asked.length = 0;
await click(headTitle());
ok('pressed, the name is a field holding it, focused', field()?.value === 'FILM DIZI' && doc.activeElement === field(),
  `${field()?.value} · focused ${doc.activeElement === field()}`);
ok('no Save or Discard while the text is unchanged', headButtons().length === 0, headButtons().join(','));
await type(field(), 'FILM DIZI ');
ok('…nor for the same name with a space after it', headButtons().length === 0, headButtons().join(','));
await blur(field());
ok('leaving it unchanged just leaves it: the name again, nothing sent',
  !field() && headTitle()?.textContent === 'FILM DIZI' && !renames().length, `${!!field()} · ${renames().length}`);

group('Escape and Discard put the old name back and send nothing');
await click(headTitle());
await type(field(), 'Films and series');
ok('a different name: Save and Discard beside the field', headButtons().join(',') === 'Save,Discard', headButtons().join(','));
await blur(field());
ok('leaving the field with changed text keeps it open, so a press on Save is not lost',
  field()?.value === 'Films and series', field()?.value);
await key(field(), 'Escape');
ok('Escape: the old name, no field, nothing sent',
  !field() && headTitle()?.textContent === 'FILM DIZI' && !renames().length, `${headTitle()?.textContent} · ${renames().length}`);
ok('…and the chat is still open (Escape went no further)', !!pane()?.querySelector('.dv-chathead'));
await click(headTitle());
await type(field(), 'Films and series');
await click(headButton('Discard'));
ok('Discard: the old name, no field, nothing sent',
  !field() && headTitle()?.textContent === 'FILM DIZI' && !renames().length, `${headTitle()?.textContent} · ${renames().length}`);

group('Save sends the rename and the list follows at once');
await click(headTitle());
await type(field(), 'Films');
await click(headButton('Save'));
await settle();
ok('Save sends chat.update with exactly the typed name',
  renames().length === 1 && JSON.stringify(renames()[0].data) === JSON.stringify({ chat_id: 'daily', title: 'Films' }),
  JSON.stringify(renames()));
ok('the header and the sidebar row both say it, with no event and no reload',
  headTitle()?.textContent === 'Films' && row('daily').title === 'Films' && stored('daily') === 'Films',
  `${headTitle()?.textContent} / ${row('daily').title} / ${stored('daily')}`);

group('Enter saves');
await click(headTitle());
await type(field(), '  FILM DIZI  ');
await key(field(), 'Enter');
await settle();
ok('Enter sends chat.update with the name, trimmed',
  renames().length === 2 && renames()[1].data.title === 'FILM DIZI', JSON.stringify(renames()));
ok('…and the row says FILM DIZI', row('daily').title === 'FILM DIZI' && headTitle()?.textContent === 'FILM DIZI',
  `${row('daily').title} / ${headTitle()?.textContent}`);
await click(headTitle());
await key(field(), 'Enter');
ok('Enter on an unchanged name sends nothing and leaves the field', !field() && renames().length === 2,
  `${!!field()} · ${renames().length}`);

group('a rename the computer refuses');
answering = false;
await click(headTitle());
await type(field(), 'Nope');
await key(field(), 'Enter');
await settle();
ok('the name goes back to what the computer has', headTitle()?.textContent === 'FILM DIZI' && row('daily').title === 'FILM DIZI',
  `${headTitle()?.textContent} / ${row('daily').title}`);

await act(async () => { root.unmount(); });
rmSync(out, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nChat title, in the list and in place: all checks passed');
process.exit(0);
