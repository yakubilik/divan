#!/usr/bin/env node
/** The top line's two boxes: the machines count and the Inbox bell.
 *
 *     cd web && npm test
 *
 *  The line mounted into jsdom on its own — the Shell with a merged view of
 *  two machines, one of them unreachable, and the bell with three notices —
 *  and driven by presses:
 *
 *   · the machines count opens a box of the machines and stays on the page;
 *     a press outside it and Escape close it;
 *   · a row's Switch focuses that machine the way the sidebar's computer card
 *     does, and the box's foot opens the Machines page;
 *   · an Inbox row reads as a headline (the ticket's title), the queue's own
 *     sentence under it, and a quieter body; new rows are marked, and are not
 *     the next time the list is opened.
 *
 *  Compiled with the panel's own TypeScript, the way `test-newchat.mjs` does.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'topbar');

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
  'src/components/Shell.tsx', 'src/components/Inbox.tsx', 'src/vite-env.d.ts',
  '--outDir', '.test-build/topbar', '--rootDir', '.',
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
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div><p id="away">elsewhere</p></body></html>', {
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
try {
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
} catch { /* node's own is good enough */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
process.on('unhandledRejection', () => {});

const load = (p) => import(pathToFileURL(join(out, p)).href);
const { Shell } = await load('src/components/Shell.js');
const { InboxBell } = await load('src/components/Inbox.js');
const { useFleet } = await load('src/lib/fleet.js');
const { useInbox } = await load('src/lib/inbox.js');

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act ?? (await import('react-dom/test-utils')).act;
const h = React.createElement;
const doc = w.document;

// ── the fixture ─────────────────────────────────────────────────────────────

const now = Date.now() / 1000;
const host = (key, machine, reachable, extra = {}) => ({
  key, name: key, machine, os: 'macOS', osVersion: '26.3', reachable, stale: !reachable, missing: false,
  old: false, error: null, at: now - (reachable ? 30 : 7200), age: reachable ? 30 : 7200,
  projects: 2, cards: 4, running: reachable ? 2 : 0, waiting: 0, quota: null, ...extra,
});
const fleet = {
  hosts: [host('studio', 'Studio', true), host('cinema', 'Cinema PC', false, { os: 'Windows', osVersion: '11' })],
  projects: [], cards: [], agents: [],
  totals: { needsYou: 0, stuck: 0, running: 2, unknown: 0, queued: 0, paused: 0,
            machines: 2, reachable: 1, complete: false, asOf: now },
  quota: {}, now,
};
const slot = (name) => ({ cfg: { name }, status: 'online', info: null, chats: [], groups: [] });
useFleet.setState({
  hosts: { studio: slot('studio'), cinema: slot('cinema') }, order: ['studio', 'cinema'],
  focus: 'studio', allHosts: true, ready: true,
});

const notices = [
  { id: 3, host: 'studio', ticket: 226, ts: now - 120, kind: 'done', project: 'divan',
    title: 'Web top bar: machines popover like Inbox',
    headline: 'Merged into main after the verifier approved it.',
    body: 'The machines count opens a box now. The Inbox rows read as a headline, the outcome under it and a quieter body.',
    status: 'done' },
  { id: 2, host: 'studio', ticket: 225, ts: now - 900, kind: 'blocked', project: 'tutor',
    title: '', headline: '#225 asks which account the beta should use', body: '', status: 'blocked' },
  { id: 1, host: 'studio', ticket: 224, ts: now - 4000, kind: 'failed', project: 'macroly',
    title: 'Sync meals across devices', headline: 'Tests failed twice.', body: 'npm test exited 1.', status: 'failed' },
];
// The first one has not been seen; the other two have.
useInbox.setState({ items: notices, seen: { studio: 2 } });

const views = [];
const opened = [];
function Harness() {
  const [view, setView] = React.useState('chats');
  return h(Shell, {
    view, fleet, onView: (v) => { views.push(v); setView(v); },
    inbox: h(InboxBell, { onOpen: (n) => opened.push(n) }),
  }, h('main', { 'data-view': view }, view));
}

const root = createRoot(doc.getElementById('root'));
await act(async () => { root.render(h(Harness)); });

const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
};
const key = async (k) => {
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })); });
};
const count = () => doc.querySelector('header button[data-sys="machines"]');
const box = () => doc.querySelector('header [role="dialog"][aria-label="Machines"]');
const shown = () => doc.querySelector('main')?.dataset.view;

// ── the machines box ────────────────────────────────────────────────────────

group('the machines count opens a box, the way the bell does');
{
  ok('the count reads N/M machines', /1\/2\s*machines/.test(count()?.textContent ?? ''), count()?.textContent);
  ok('…and nothing is open before it is pressed', !box());
  const path = w.location.href;
  await click(count());
  const b = box();
  ok('pressing it opens a dialog', !!b && count().getAttribute('aria-expanded') === 'true');
  const rows = [...(b?.querySelectorAll('[data-machine]') ?? [])];
  ok('…with a row for every machine, named', rows.map((r) => r.dataset.machine).join() === 'studio,cinema'
    && rows[0].textContent.includes('Studio') && rows[1].textContent.includes('Cinema PC'),
    rows.map((r) => r.textContent).join(' | '));
  ok('…each saying whether it answers, with a dot to match',
    rows[0].querySelector('[data-state]')?.textContent === 'online' && !!rows[0].querySelector('.dv-dot--run')
      && rows[1].querySelector('[data-state]')?.textContent === 'unreachable' && !!rows[1].querySelector('.dv-dot--stuck'));
  ok('…what it runs and when it was last seen',
    rows[0].textContent.includes('macOS 26.3') && rows[0].textContent.includes('2 running')
      && rows[0].textContent.includes('seen just now')
      && rows[1].textContent.includes('Windows 11') && rows[1].textContent.includes('seen 2h ago'),
    rows.map((r) => r.textContent).join(' | '));
  ok('…and the page under it has not changed, nor the address',
    views.length === 0 && shown() === 'chats' && w.location.href === path, `${views} · ${w.location.href}`);

  await click(doc.getElementById('away'));
  ok('a press outside closes it', !box());

  await click(count());
  ok('it opens again', !!box());
  await click(box().querySelector('[data-machine="studio"]'));
  ok('…a press inside it leaves it open', !!box());
  await key('Escape');
  ok('…and Escape closes it', !box() && views.length === 0);
}

group('a row switches to its machine; the foot opens the Machines page');
{
  await click(count());
  ok('the merged list is showing, so every row offers the switch',
    !!box().querySelector('button[data-switch="studio"]') && !!box().querySelector('button[data-switch="cinema"]'));
  await click(box().querySelector('button[data-switch="cinema"]'));
  const f = useFleet.getState();
  ok('Switch focuses that machine, as the sidebar card does (focus set, the merged list off)',
    f.focus === 'cinema' && f.allHosts === false, `${f.focus} · ${f.allHosts}`);
  ok('…closes the box and stays on the page', !box() && views.length === 0 && shown() === 'chats');

  await click(count());
  ok('the focused machine is marked current, with no switch on it',
    !box().querySelector('button[data-switch="cinema"]')
      && box().querySelector('[data-machine="cinema"]').textContent.includes('Current')
      && !!box().querySelector('button[data-switch="studio"]'));
  const all = box().querySelector('button[data-all-machines]');
  ok('the foot says All machines', all?.textContent === 'All machines');
  await click(all);
  ok('…and opens the Machines page', views.join() === 'machines' && shown() === 'machines' && !box(), views.join());
  ok('…where the count is the page you are on', count().getAttribute('aria-current') === 'page');
}

group('the Settings button is as it was');
{
  const gear = [...doc.querySelectorAll('header button')].find((b) => b.getAttribute('aria-label') === 'Settings');
  await click(gear);
  ok('Settings still opens Settings', views.at(-1) === 'settings' && shown() === 'settings');
}

// ── the Inbox ───────────────────────────────────────────────────────────────

const bell = () => doc.querySelector('header button[data-inbox]');
const inbox = () => doc.querySelector('header [role="dialog"][aria-label="Inbox"]');
const px = (el) => parseFloat(el?.style.fontSize ?? '0');

group('an Inbox row reads as a headline, what came of it, and the rest');
{
  ok('the bell counts one new', bell().getAttribute('aria-label') === 'Inbox, 1 new', bell().getAttribute('aria-label'));
  await click(bell());
  const rows = [...inbox().querySelectorAll('button[data-notice]')];
  ok('three rows', rows.length === 3);
  const [first, second, third] = rows;
  const part = (r, p) => r.querySelector(`[data-part="${p}"]`);
  const title = part(first, 'title');
  const said = part(first, 'headline');
  const body = part(first, 'body');
  ok('title, headline and body are three elements',
    !!title && !!said && !!body && title !== said && said !== body
      && title.textContent === notices[0].title && said.textContent === notices[0].headline
      && body.textContent === notices[0].body);
  ok('the title is the headline: 15px or more, semibold or heavier, in ink',
    px(title) >= 15 && Number(title.style.fontWeight) >= 600 && title.style.color === 'var(--dv-ink)',
    `${title.style.fontSize} ${title.style.fontWeight} ${title.style.color}`);
  ok('the body is smaller and quieter: ink2/ink3, more line height, up to three lines',
    px(body) < px(title) && /var\(--dv-ink[23]\)/.test(body.style.color)
      && Number(body.style.lineHeight) >= 1.5 && body.style.webkitLineClamp === '3',
    `${body.style.fontSize} ${body.style.color} ${body.style.lineHeight} ${body.style.webkitLineClamp}`);
  ok('the outcome sentence sits between them in size',
    px(said) < px(title) && px(said) >= px(body) && /var\(--dv-ink[23]\)/.test(said.style.color));
  const kind = part(first, 'kind');
  ok('the kind is a small coloured tag', !!kind && px(kind) <= 12 && kind.textContent.includes('done')
    && kind.style.color === 'var(--dv-run)' && !!kind.style.background, `${kind?.style.color} · ${kind?.style.background}`);
  ok('project and time are quiet meta', /divan · 2m ago/.test(part(first, 'meta')?.textContent ?? '')
    && part(first, 'meta').style.color === 'var(--dv-ink3)', part(first, 'meta')?.textContent);
  ok('a notice with only a headline shows it once, as the title',
    part(second, 'title')?.textContent === notices[1].headline && !part(second, 'headline'));
  ok('rows after the first are separated by a line',
    second.style.borderTop.includes('var(--dv-line)') && third.style.borderTop.includes('var(--dv-line)'),
    second.style.borderTop);

  ok('the unseen notice is marked, and only it',
    first.hasAttribute('data-unread') && !!first.querySelector('[data-unread-dot]')
      && !second.hasAttribute('data-unread') && !third.hasAttribute('data-unread')
      && first.style.background === 'var(--dv-amberBg)' && second.style.background === 'transparent',
    `${first.style.background} / ${second.style.background}`);
  ok('opening the list clears the bell\'s count', bell().getAttribute('aria-label') === 'Inbox');

  await key('Escape');
  ok('Escape closes it', !inbox());
  await click(bell());
  const again = [...inbox().querySelectorAll('button[data-notice]')];
  ok('opened again, nothing is marked new any more',
    again.length === 3 && again.every((r) => !r.hasAttribute('data-unread') && !r.querySelector('[data-unread-dot]')));
  await click(again[0]);
  ok('a press on a row opens its ticket and closes the list', opened.length === 1 && opened[0].ticket === 226 && !inbox());
}

await act(async () => { root.unmount(); });
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
