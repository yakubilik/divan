#!/usr/bin/env node
/** The Panes screen, mounted and driven.
 *
 *     cd web && node scripts/test-panes-drive.mjs
 *
 *  The whole panel in jsdom, as `test-asking-chats.mjs` mounts it, with eight
 *  chats on one computer. Everything a person does on the screen is done with
 *  the events a person's browser produces:
 *
 *   · the Panes button on the top line opens `/panes`, and Back from it is the
 *     Chats screen it was opened from;
 *   · a chat row dragged off the sidebar and dropped on the empty screen is a
 *     pane of that chat, and a live event for that chat is drawn in it;
 *   · a second one dropped on the first pane's right edge splits it, and what
 *     is typed and sent in either pane goes to that pane's chat and no other;
 *   · six and more panes open, a divider dragged with the mouse resizes them —
 *     and the chats inside are not drawn again while it moves;
 *   · a pane maximised fills the area and restored is the layout it was; a pane
 *     closed gives its space to its neighbour;
 *   · a chat added to a full 2×2 grid makes the others shift and shrink, and a
 *     pane carried by its head to another pane's edge lands there;
 *   · the layout outlives a reload, and `/panes` opened cold draws it.
 *
 *  jsdom has no layout, so the Panes area says it is 1100×800 at (300, 50) —
 *  the size it is drawn at beside the list on a 1440×900 screen — and every
 *  pointer position below is in that frame. The browser pass, with pictures,
 *  is `test-panes-ui.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'panes-drive');

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
  '--outDir', '.test-build/panes-drive', '--rootDir', '.',
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

// ── a document, opened on the Chat place ────────────────────────────────────

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5177/chats', pretendToBeVisual: true,
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
// Back and Forward land on a popstate the browser fires later; React's
// complaint that it came outside act() is about the check, not the panel.
const warn = console.error;
console.error = (...a) => { if (String(a[0]).includes('not wrapped in act')) return; warn(...a); };

// The Panes area's frame, which a browser would measure.
const AREA = { left: 300, top: 50, width: 1100, height: 800 };
const rect = w.HTMLElement.prototype.getBoundingClientRect;
w.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.hasAttribute('data-panes')) {
    return { ...AREA, x: AREA.left, y: AREA.top, right: AREA.left + AREA.width, bottom: AREA.top + AREA.height, toJSON() {} };
  }
  return rect.call(this);
};
w.localStorage.removeItem('rac.panes');

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { App } = await load('src/App.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useLogs, logKey } = await load('src/lib/timeline.js');
const { usePanes, boxes } = await load('src/lib/panes.js');
const { paneRenders } = await load('src/screens/Panes.js');
const { host: fixtureHost, chat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act;

const TITLES = ['Webhook retry policy', 'Safari login', 'Invoice PDF', 'Paywall copy', 'Onboarding flow',
  'Release notes', 'Crash on launch', 'Pricing page'];
const host = fixtureHost();
host.chats = TITLES.map((title, i) => chat({ id: `c${i + 1}`, title, status: 'idle', updated_at: Math.floor(Date.now() / 1000) - i * 60 }));
const asked = [];
useFleet.setState({
  hosts: { studio: host }, order: ['studio'], focus: 'studio', ready: true,
  boot: () => {},
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('not in this check');
    if (type === 'chat.get') return { events: [], more: false };
    if (type === 'chat.send') return { accepted: true, queued: false };
    return {};
  },
});
// Every chat's conversation, as `chat.get` would have answered it.
const now = Date.now() / 1000;
useLogs.setState({ logs: Object.fromEntries(TITLES.map((t, i) => [logKey('studio', `c${i + 1}`), {
  items: [{ kind: 'user', id: `u${i + 1}`, ts: now - 300, text: `About ${t}`, attachments: [], queued: false }],
  seq: 10, truncated: false, busy: false, pending: [], loading: false, error: null,
}])) });

const doc = w.document;
let root = createRoot(doc.getElementById('root'));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };
await act(async () => { root.render(React.createElement(App)); });
await settle();

const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); };
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};
const area = () => doc.querySelector('[data-panes]');
const panes = () => [...doc.querySelectorAll('[data-pane]')];
const pane = (id) => doc.querySelector(`[data-pane="studio:${id}"]`);
const chatsIn = () => panes().map((p) => p.getAttribute('data-pane-chat'));
const row = (title) => [...doc.querySelectorAll('.dv-chatlist button[draggable="true"]')]
  .find((b) => (b.textContent ?? '').includes(title)) ?? null;
const pctOf = (el) => ['left', 'top', 'width', 'height'].map((k) => parseFloat(el.style[k]));
const boxOf = (id) => pctOf(pane(id));

/** A drag the way a browser runs one: the row's dragstart fills the
 *  DataTransfer, the screen sees dragover and then drop at a point. */
const dragRow = async (title, x, y) => {
  const store = new Map();
  const dt = {
    setData: (k, v) => store.set(k, v), getData: (k) => store.get(k) ?? '',
    get types() { return [...store.keys()]; }, effectAllowed: 'all', dropEffect: 'none',
  };
  const fire = async (el, kind, at) => {
    const ev = new w.MouseEvent(kind, { bubbles: true, cancelable: true, clientX: at?.x ?? 0, clientY: at?.y ?? 0 });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    await act(async () => { el.dispatchEvent(ev); });
    return ev;
  };
  const src = row(title);
  if (!src) throw new Error(`no draggable row for ${title}: ${[...doc.querySelectorAll('.dv-chatlist button')].map((b) => `${b.getAttribute('draggable')}:${b.textContent}`).join(' | ').slice(0, 600)} ${doc.querySelectorAll('.dv-chatlist').length}`);
  await fire(src, 'dragstart');
  const target = doc.elementFromPoint?.(x, y) ?? area();
  const over = await fire(target && area().contains(target) ? target : area(), 'dragover', { x, y });
  const hinted = !!doc.querySelector('[data-pane-hint]');
  await fire(area(), 'drop', { x, y });
  await fire(src, 'dragend');
  return { accepted: over.defaultPrevented, hinted };
};
/** A mouse held down on `el`, moved through `path` and let go. */
const mouse = async (el, from, path, between) => {
  await act(async () => { el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: from.x, clientY: from.y })); });
  for (const p of path) {
    await act(async () => { w.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y })); });
    if (between) await between(p);
  }
  await act(async () => { w.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, clientX: path.at(-1).x, clientY: path.at(-1).y })); });
  await settle();
};
/** A point inside the area, in fractions of it. */
const pt = (fx, fy) => ({ x: AREA.left + fx * AREA.width, y: AREA.top + fy * AREA.height });

group('getting there, and back');
{
  const btn = doc.querySelector('button[aria-label="Panes"]');
  ok('the top line has a Panes button', !!btn);
  await click(btn);
  await settle();
  ok('…which opens the Panes screen at /panes, with the chat list beside it',
    w.location.pathname === '/panes' && !!area() && !!doc.querySelector('[data-panes-screen] .dv-chatlist'),
    w.location.pathname);
  ok('…empty, saying how a chat gets in', !!doc.querySelector('[data-panes-empty]') && panes().length === 0);
  await act(async () => { w.history.back(); });
  await new Promise((r) => setTimeout(r, 50));
  await settle();
  ok('browser Back from Panes is the Chats screen it was opened from', w.location.pathname.startsWith('/chats') && !area(),
    w.location.pathname);
  await act(async () => { w.history.forward(); });
  await new Promise((r) => setTimeout(r, 50));
  await settle();
  ok('…and Forward is Panes again', w.location.pathname === '/panes' && !!area(), w.location.pathname);
}

group('a chat dragged in from the sidebar');
{
  const d = await dragRow('Webhook retry policy', ...Object.values(pt(0.5, 0.5)));
  ok('the screen takes the drag and lights up where it would land', d.accepted && d.hinted, JSON.stringify(d));
  ok('dropped on the empty screen, it is a pane of that chat, the whole area',
    chatsIn().join() === 'c1' && JSON.stringify(boxOf('c1')) === JSON.stringify([0, 0, 100, 100]), JSON.stringify(boxOf('c1')));
  const p1 = pane('c1');
  ok('…drawn as the floating chat window: the agent in the head, the conversation, a composer',
    !!p1.querySelector('section[data-panel] header') && (p1.textContent ?? '').includes('About Webhook retry policy')
    && !!p1.querySelector('textarea[name="composer"]'), (p1.textContent ?? '').slice(0, 200));
  await act(async () => {
    useLogs.getState().feed('studio', { seq: 11, event: 'turn.started', chat_id: 'c1', ts: now, data: {} });
    useLogs.getState().feed('studio', { seq: 12, event: 'text.delta', chat_id: 'c1', ts: now, data: { segment: 1, text: 'The retries back off now.' } });
  });
  ok('a new message for that chat streams into the pane, no reload', (pane('c1').textContent ?? '').includes('The retries back off now.'),
    (pane('c1').textContent ?? '').slice(-200));
  await act(async () => { useLogs.getState().feed('studio', { seq: 13, event: 'turn.done', chat_id: 'c1', ts: now, data: {} }); });

  // On the right edge of the first pane.
  await dragRow('Safari login', ...Object.values(pt(0.9, 0.5)));
  ok('dropped on the first pane’s right edge, it splits that pane: the new one on the right',
    chatsIn().join() === 'c1,c2' && boxOf('c1')[2] === 50 && boxOf('c2')[0] === 50, JSON.stringify([boxOf('c1'), boxOf('c2')]));
  await dragRow('Invoice PDF', ...Object.values(pt(0.75, 0.05)));
  ok('dropped on the right pane’s top edge, it splits that one: the new one above it',
    boxOf('c3')[0] === 50 && boxOf('c3')[1] === 0 && boxOf('c3')[3] === 50 && boxOf('c2')[1] === 50 && boxOf('c1')[3] === 100,
    JSON.stringify([boxOf('c1'), boxOf('c2'), boxOf('c3')]));
  await dragRow('Paywall copy', ...Object.values(pt(0.25, 0.95)));
  ok('…and on the left pane’s bottom edge: a 2×2 grid', boxOf('c4')[0] === 0 && boxOf('c4')[1] === 50 && boxOf('c1')[3] === 50,
    JSON.stringify(panes().map(pctOf)));
}

group('two panes, two chats: each composer sends to its own');
{
  for (const [id, words] of [['c2', 'Ship the Safari fix'], ['c1', 'Back off for five minutes']]) {
    asked.length = 0;
    await type(pane(id).querySelector('textarea[name="composer"]'), words);
    await click(pane(id).querySelector('button[title="Send"]'));
    await settle();
    const sends = asked.filter((a) => a.type === 'chat.send');
    ok(`typed in ${id}’s pane and sent, it is chat.send to ${id} and to no other pane`,
      sends.length === 1 && sends[0].data.chat_id === id && sends[0].data.text === words && sends[0].key === 'studio',
      JSON.stringify(sends.map((s) => s.data)));
  }
}

group('a full grid makes room, and a pane carried by its head');
{
  const before = Object.fromEntries(['c1', 'c2', 'c3', 'c4'].map((id) => [id, boxOf(id)]));
  // Pressed in the list: no place named, so it goes beside the biggest pane.
  await click(row('Onboarding flow'));
  await settle();
  const after = Object.fromEntries(['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => [id, boxOf(id)]));
  const moved = Object.keys(before).filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]));
  const rs = Object.values(after);
  const overlap = rs.some((a, i) => rs.some((b, j) => j > i
    && Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.01 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.01));
  ok('a fifth chat on a full 2×2 grid is a pane, and the open ones shift and shrink to make room',
    chatsIn().length === 5 && moved.length >= 1 && after.c1[2] < before.c1[2] && !overlap, JSON.stringify(after));
  ok('…animated: every tile eases to its new place', /dv-pane\s*\{[^}]*transition: left/.test(doc.querySelector('[data-panes] style')?.textContent ?? ''));

  // c4 carried by its head to the right edge of the whole screen.
  const head = pane('c4').querySelector('header');
  const kept = pane('c4').querySelector('section[data-panel]');
  let hinted = false;
  await mouse(head, pt(0.2, 0.6), [pt(0.3, 0.6), pt(0.6, 0.5), { x: AREA.left + AREA.width - 10, y: AREA.top + 400 }],
    async () => { hinted = hinted || !!doc.querySelector('[data-pane-hint]'); });
  const c4 = boxOf('c4');
  ok('a pane picked up by its head lights up where it would go as it is carried', hinted);
  ok('…and put down on the screen’s right edge it is a column down the whole right, the others rearranged beside it',
    Math.abs(c4[0] + c4[2] - 100) < 0.01 && c4[1] === 0 && c4[3] === 100
    && ['c1', 'c2', 'c3', 'c5'].every((id) => boxOf(id)[0] + boxOf(id)[2] <= c4[0] + 0.01), JSON.stringify(panes().map(pctOf)));
  ok('…the same window, carried rather than opened again', pane('c4').querySelector('section[data-panel]') === kept);

  // …and c2 put on the left edge of c1.
  await mouse(pane('c2').querySelector('header'), pt(0.6, 0.6),
    [pt(0.5, 0.5), { x: AREA.left + boxOf('c1')[0] / 100 * AREA.width + 30, y: AREA.top + (boxOf('c1')[1] + boxOf('c1')[3] / 2) / 100 * AREA.height }]);
  ok('a pane dropped on another’s left edge lands to its left', boxOf('c2')[0] + boxOf('c2')[2] <= boxOf('c1')[0] + 0.01
    && Math.abs(boxOf('c2')[1] - boxOf('c1')[1]) < 0.01, JSON.stringify(panes().map(pctOf)));
}

group('six and more, and a divider dragged');
{
  // A clean screen first, every pane closed by its own ×.
  for (const p of panes()) await click(p.querySelector('button[aria-label="Close"]'));
  ok('every pane closed by its ×, the screen is empty again', panes().length === 0 && !!doc.querySelector('[data-panes-empty]'));
  for (const t of TITLES.slice(0, 7)) { await click(row(t)); await settle(); }
  ok('seven chats pressed in the list are seven panes at once — no limit', chatsIn().length === 7, chatsIn().join());
  ok('…each of them at least the minimum size (240×200)',
    panes().every((p) => { const [, , pw, ph] = pctOf(p); return pw / 100 * AREA.width >= 239.9 && ph / 100 * AREA.height >= 199.9; }),
    JSON.stringify(panes().map(pctOf)));
  // The divider down the middle of the screen.
  const line = doc.querySelector('[data-pane-divider=":0"]');
  ok('there is a divider between the panes to drag', !!line);
  const key = line.getAttribute('data-pane-divider');
  const div = boxes(usePanes.getState().root).dividers.find((d) => d.key === key);
  const sizesBefore = Object.fromEntries(panes().map((p) => [p.getAttribute('data-pane'), pctOf(p)]));
  const rendered = () => Object.fromEntries([...paneRenders]);
  const count0 = rendered();
  const bodies0 = panes().map((p) => p.querySelector('section[data-panel]'));
  const x0 = AREA.left + div.at.x * AREA.width;
  const y0 = AREA.top + (div.at.y + div.at.h / 2) * AREA.height;
  let changing = false;
  let redrawnDuring = false;
  const stamps = [];
  await mouse(line, { x: x0, y: y0 }, [1, 2, 3, 4, 5, 6].map((i) => ({ x: x0 - i * 8, y: y0 })), async () => {
    stamps.push(panes().map(pctOf).join('|'));
    changing = changing || doc.querySelector('[data-panes]').hasAttribute('data-resizing');
    redrawnDuring = redrawnDuring || JSON.stringify(rendered()) !== JSON.stringify(count0);
  });
  const sizesAfter = Object.fromEntries(panes().map((p) => [p.getAttribute('data-pane'), pctOf(p)]));
  ok('the panes follow the pointer on every move of the drag', new Set(stamps).size === stamps.length && stamps.length === 6
    && changing, `${new Set(stamps).size}/${stamps.length}`);
  ok('…and while the divider moves, not one pane’s chat is drawn again — only sizes change',
    !redrawnDuring && panes().every((p, i) => p.querySelector('section[data-panel]') === bodies0[i]),
    JSON.stringify({ before: count0, after: rendered() }));
  ok('…nor when it is let go and the layout is saved', JSON.stringify(rendered()) === JSON.stringify(count0),
    JSON.stringify({ before: count0, after: rendered() }));
  const lineAt = () => boxes(usePanes.getState().root).dividers.find((d) => d.key === key).at.x * AREA.width;
  const px = (v) => v / 100 * AREA.width;
  const leftPair = (s) => px(s['studio:c1'][2] + s['studio:c5'][2]);
  ok('the divider moved the 48 px the pointer did: the panes left of it 48 px narrower, the ones right of it 48 px wider',
    Math.abs(lineAt() - (x0 - AREA.left - 48)) < 0.5 && Math.abs(leftPair(sizesBefore) - leftPair(sizesAfter) - 48) < 0.5
    && Math.abs(px(sizesAfter['studio:c4'][2] - sizesBefore['studio:c4'][2]) - 48) < 0.5
    && Math.abs(px(sizesBefore['studio:c2'][0] - sizesAfter['studio:c2'][0]) - 48) < 0.5,
    JSON.stringify({ sizesBefore, sizesAfter }));
  // Pulled far past every minimum.
  await mouse(line, { x: AREA.left + boxes(usePanes.getState().root).dividers.find((d) => d.key === key).at.x * AREA.width, y: y0 },
    [{ x: -4000, y: y0 }]);
  ok('pulled as far as it goes, every pane keeps at least its minimum size (240×200)',
    panes().every((p) => { const [, , pw, ph] = pctOf(p); return pw / 100 * AREA.width >= 239.9 && ph / 100 * AREA.height >= 199.9; }),
    JSON.stringify(panes().map((p) => pctOf(p).slice(2).map((v, i) => +(v / 100 * (i ? AREA.height : AREA.width)).toFixed(1)))));
}

group('maximise, restore, close');
{
  const layout = () => JSON.stringify(panes().map((p) => [p.getAttribute('data-pane'), pctOf(p)]));
  const was = layout();
  const p = pane('c3');
  await click(p.querySelector('button[aria-label="Fill the Panes screen"]'));
  ok('maximised, the pane fills the Panes area and the others are out of sight',
    JSON.stringify(boxOf('c3')) === JSON.stringify([0, 0, 100, 100]) && pane('c3').hasAttribute('data-pane-max')
    && panes().filter((x) => x !== pane('c3')).every((x) => x.style.visibility === 'hidden'), JSON.stringify(boxOf('c3')));
  await click(pane('c3').querySelector('button[aria-label="Restore the layout"]'));
  ok('restored, the layout is exactly what it was', layout() === was, `${layout()}\n    ${was}`);

  const nb = boxes(usePanes.getState().root).panes;
  const gone = nb['studio:c3'];
  await click(pane('c3').querySelector('button[aria-label="Close"]'));
  const after = boxes(usePanes.getState().root).panes;
  const took = Object.keys(after).filter((k) => {
    const a = after[k]; const b = nb[k];
    return Math.abs(a.w * a.h - (b.w * b.h + gone.w * gone.h)) < 1e-6;
  });
  ok('closed, it is gone, and one neighbour takes exactly the space it had', !pane('c3') && chatsIn().length === 6 && took.length === 1,
    JSON.stringify({ took, gone }));
}

group('kept: a reload, and /panes opened cold');
{
  const layout = () => JSON.stringify(panes().map((p) => [p.getAttribute('data-pane'), pctOf(p)]).sort());
  const was = layout();
  const saved = w.localStorage.getItem('rac.panes');
  ok('the layout is written down in this browser', !!saved && JSON.parse(saved).root?.kind === 'split');
  await act(async () => { root.unmount(); });
  await act(async () => { usePanes.setState({ root: null, max: null }); usePanes.getState().reload(); });
  w.history.replaceState(null, '', '/panes');
  root = createRoot(doc.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  ok('/panes opened cold draws the saved layout: the same chats, the same splits, the same sizes',
    w.location.pathname === '/panes' && layout() === was, `${layout()}\n    ${was}`);
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
