#!/usr/bin/env node
/** The Dashboard's floating chat for what agents are asking, mounted and used.
 *
 *     cd web && node scripts/test-asking.mjs
 *
 *  The whole panel in jsdom, as `test-drive.mjs` mounts it, with a fake
 *  transport that records every request. A question arrives on the board and
 *  the window opens by itself; an answer is typed and sent; the board moves the
 *  way the queue moves it — back to work, then a follow-up, then finished — and
 *  what is on screen and what went out are read after each step.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'asking');

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
  '--outDir', '.test-build/asking', '--rootDir', '.',
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
const { useDivanStore, answered } = await load('src/lib/divan.js');
const { useAsking, NO_ASK, points, sync, pending } = await load('src/lib/asking.js');
const { setThemeChoice } = await load('src/lib/theme.js');
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);
const { host: fixtureHost, chat: fakeChat } = await import(pathToFileURL(join(web, 'scripts', 'panel-fixture.js')).href);
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act;

const NOW = Math.floor(Date.now() / 1000);

/** The question the screenshot shows, as the queue wrote it: a list on one
 *  line, one point made twice word for word. */
const STRIX = '- Strix taraması ChatGPT aboneliğinle çalışsın diye Mac\'te bir kez ChatGPT girişini yapar mısın? '
  + '- Giriş yapmak istemezsen bu tarama için ücretli API anahtarı kullanayım mı? '
  + '- Strix taraması ChatGPT aboneliğinle çalışsın diye Mac\'te bir kez ChatGPT girişini yapar mısın?';
const FOLLOW = 'Got it. Should the scan also cover the staging site?';

/** The two boards, with the studio's ticket asking the screenshot's question
 *  and the mini's ticket asking one of its own. `edit` moves a card the way the
 *  queue's mirror moves it. */
let studioCard = { agent_status: 'asking', agent_status_at: NOW - 600, agent_detail: STRIX };
let miniCard = { agent_status: 'asking', agent_status_at: NOW - 300, agent_detail: 'Which region should the API deploy to?' };
const snaps = () => {
  const [studio, mini] = boards(NOW).busy;
  const s = structuredClone(studio.snap);
  const m = structuredClone(mini.snap);
  s.cards = s.cards.map((c) => (c.id === 'k2' ? { ...c, title: 'Security scan', ...studioCard } : c));
  m.cards = m.cards.map((c) => (c.id === 'm1' ? { ...c, ...miniCard } : c));
  return { studio: answered(s, NOW), mini: answered(m, NOW) };
};
const board = async () => { await act(async () => { useDivanStore.setState({ snaps: snaps() }); }); await settle(); };

const asked = [];
/** The chat that holds a structured question and an approval. */
const qchat = fakeChat({ id: 'q1', title: 'Pick a pricing model', status: 'awaiting_approval', updated_at: NOW - 120 });
const studioHost = () => {
  const h = fixtureHost();
  return { ...h, chats: [...h.chats.map((c) => ({ ...c, status: c.status === 'awaiting_approval' ? 'idle' : c.status })), qchat] };
};
useFleet.setState({
  hosts: { studio: studioHost(), mini: { ...fixtureHost(), chats: [] } },
  order: ['studio', 'mini'], focus: 'studio', ready: true,
  call: async (key, type, data) => {
    asked.push({ key, type, data });
    if (type === 'divan.snapshot') throw new Error('not in this check');
    if (type === 'chat.get') return { events: [], more: false };
    if (type.startsWith('ustabasi.')) return { ok: true, message: 'noted' };
    return {};
  },
});
useDivanStore.setState({ snaps: snaps() });
setThemeChoice('dark');

const doc = w.document;
let root = createRoot(doc.getElementById('root'));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => {}); };
const mount = async () => {
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
};
const reload = async () => {
  await act(async () => { root.unmount(); });
  // What a reload keeps is what was written down; the store is read back from it.
  const kept = JSON.parse(w.localStorage.getItem('rac.asking') || 'null');
  useAsking.setState({ ...NO_ASK, ...kept });
  root = createRoot(doc.getElementById('root'));
  await mount();
};
await mount();

const win = () => doc.querySelector('[data-asking-window]');
const winId = () => win()?.getAttribute('data-asking-window') ?? null;
const tabs = () => [...doc.querySelectorAll('[data-asking-tab]')];
const tab = (id) => doc.querySelector(`[data-asking-tab="${id}"]`);
const lines = () => [...(win()?.querySelectorAll('[data-asking-line]') ?? [])].map((e) => e.getAttribute('data-asking-line'));
const row = (id) => doc.querySelector(`[data-asking-row="${id}"]`);
const notes = () => asked.filter((a) => a.type === 'ustabasi.note');
const click = async (el) => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await settle(); };
const btn = (label, within = doc) => [...within.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label
  || b.getAttribute('aria-label') === label) ?? null;
const typeAndSend = async (text) => {
  const input = win().querySelector('input[type="text"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await settle();
};
const body = () => doc.body.textContent ?? '';

// ── 1 ───────────────────────────────────────────────────────────────────────

group('a pending question opens itself as a floating chat on the Dashboard');
{
  const w1 = win();
  const said = w1?.textContent ?? '';
  const items = [...(w1?.querySelectorAll('[data-asking-line="agent"] li') ?? [])].map((li) => li.textContent);
  ok('the window is open over the Dashboard with no navigation',
    !!w1 && w.location.pathname === '/' && !!doc.querySelector('h1.dv-greet'), `${winId()} ${w.location.pathname}`);
  ok('…the oldest question first, with the project and the agent in its head',
    winId() === 'studio:k2' && said.includes('Quire · Engineering') && said.includes('Coder') && said.includes('asking'),
    said.slice(0, 200));
  ok('…the whole question, each point once, as a list',
    items.length === 2 && items[0].startsWith('Strix taraması') && items[1].startsWith('Giriş yapmak'),
    JSON.stringify(items));
  ok('Needs you holds a one-line row for it, not a second copy of the question',
    !!row('studio:k2') && !row('studio:k2').textContent.includes('Strix')
      && body().split('Giriş yapmak istemezsen').length - 1 === 1, row('studio:k2')?.textContent);
  ok('every pending request has its own tab: two tickets on two machines and the chat holding a request',
    tabs().map((t) => t.getAttribute('data-asking-tab')).join(' ') === 'studio:k2 mini:m1 chat:studio:q1',
    tabs().map((t) => t.getAttribute('data-asking-tab')).join(' '));
}

// ── 2 ───────────────────────────────────────────────────────────────────────

group('an answer goes to the ticket that asked, once, and the chat stays open');
{
  asked.length = 0;
  await typeAndSend('Use the API key in the keychain for now');
  const sent = notes();
  ok('one ustabasi.note, to the studio, on ticket 42, with the words typed',
    sent.length === 1 && sent[0].key === 'studio' && sent[0].data.id === 42
      && sent[0].data.text === 'Use the API key in the keychain for now', JSON.stringify(sent));
  ok('the window is still open on the same conversation, the answer under the question',
    winId() === 'studio:k2' && lines().join(',') === 'agent,you', lines().join(','));
}

// ── 3 ───────────────────────────────────────────────────────────────────────

group('answered, the asking state clears while the conversation stays');
{
  studioCard = { agent_status: 'running', agent_status_at: NOW - 30, agent_detail: '' };
  await board();
  ok('the row leaves Needs you and the tab says it is working',
    !row('studio:k2') && tab('studio:k2')?.getAttribute('data-phase') === 'working',
    `${!!row('studio:k2')} ${tab('studio:k2')?.getAttribute('data-phase')}`);
  ok('the window has not closed: the ticket working is not the exchange ending',
    winId() === 'studio:k2' && /working with your answer/.test(win().textContent), win()?.textContent?.slice(-120));
  // The same snapshot read again, as the next poll reads it.
  await board();
  ok('a poll that changed nothing changes nothing', lines().join(',') === 'agent,you' && tabs().length === 3);
}

group('a follow-up arrives in the same chat');
{
  studioCard = { agent_status: 'asking', agent_status_at: NOW - 10, agent_detail: FOLLOW };
  await board();
  ok('the follow-up is under the answer, in the same window, with no new tab',
    winId() === 'studio:k2' && lines().join(',') === 'agent,you,agent' && win().textContent.includes(FOLLOW)
      && tabs().length === 3, `${winId()} ${lines()} ${tabs().length}`);
  await board();
  await reload();
  ok('neither the next poll nor a reload draws it twice',
    winId() === 'studio:k2' && lines().join(',') === 'agent,you,agent'
      && win().textContent.split(FOLLOW).length - 1 === 1 && tabs().length === 3,
    `${lines()} ${tabs().length}`);
  asked.length = 0;
  await typeAndSend('Yes, staging too');
  ok('answering the follow-up is one more note to the same ticket, and the window stays',
    notes().length === 1 && notes()[0].data.id === 42 && notes()[0].key === 'studio' && winId() === 'studio:k2'
      && lines().join(',') === 'agent,you,agent,you', `${JSON.stringify(notes())} ${lines()}`);
}

// ── 4 ───────────────────────────────────────────────────────────────────────

group('putting it away and closing it are the reader’s, and it can always come back');
{
  studioCard = { agent_status: 'asking', agent_status_at: NOW - 5, agent_detail: 'Last one: weekly or daily scans?' };
  await board();
  await click(btn('Put this away', win()));
  ok('– puts the window away; the tab stays and the row under Needs you stays',
    winId() !== 'studio:k2' && !!tab('studio:k2') && !!row('studio:k2'), `${winId()}`);
  await click(tab('studio:k2').querySelector('button, [role="button"]') ?? tab('studio:k2').firstElementChild);
  ok('…and its tab opens it again', winId() === 'studio:k2', winId());
  await click(btn('Close', win()));
  ok('× closes it: no window, no tab, but still waiting under Needs you',
    winId() !== 'studio:k2' && !tab('studio:k2') && !!row('studio:k2'), `${winId()} ${!!tab('studio:k2')}`);
  await board();
  await reload();
  ok('a closed question does not jump back on the next poll or a reload', !tab('studio:k2') && !!row('studio:k2'));
  await click(btn('Reply', row('studio:k2')));
  ok('Reply on the row reopens it as the open window', winId() === 'studio:k2', winId());
}

// ── 5 ───────────────────────────────────────────────────────────────────────

group('several questions are each their own, and an answer cannot cross over');
{
  await click(tab('mini:m1').firstElementChild);
  const said = win()?.textContent ?? '';
  asked.length = 0;
  await typeAndSend('eu-west-1');
  const sent = notes();
  ok('the mini’s tab opens the mini’s question, and its answer goes to the mini’s ticket only',
    winId() === 'mini:m1' && said.includes('Which region') && !said.includes('weekly or daily')
      && sent.length === 1 && sent[0].key === 'mini' && sent[0].data.id === 44 && sent[0].data.text === 'eu-west-1',
    `${winId()} ${JSON.stringify(sent)}`);
  await click(tab('studio:k2').firstElementChild);
  ok('…and the studio’s conversation did not get the mini’s answer',
    winId() === 'studio:k2' && !win().textContent.includes('eu-west-1'), win()?.textContent?.slice(-120));
}

group('a chat holding a structured question and an approval answers through its own handlers');
{
  // The chat's timeline as the computer holds it: a structured question and
  // an approval, both open. Seeded rather than fetched: the timeline reaches a
  // computer through its socket, and there is none here.
  const { useLogs, logKey, apply } = await load('src/lib/timeline.js');
  const evs = [
    { seq: 1, event: 'message.user', chat_id: 'q1', ts: NOW - 200, data: { text: 'Price the plans', attachments: [] } },
    { seq: 2, event: 'approval.request', chat_id: 'q1', ts: NOW - 150, data: {
      request_id: 'rq', tool: 'AskUserQuestion', preview: 'Which model?',
      input: { kind: 'user_input', questions: [{ id: 'model', question: 'Which pricing model?',
                                                  options: [{ label: 'Seats' }, { label: 'Usage' }] }] } } },
    { seq: 3, event: 'approval.request', chat_id: 'q1', ts: NOW - 140, data: {
      request_id: 'rb', tool: 'Bash', preview: 'npm run price-check', input: { command: 'npm run price-check' } } },
  ];
  await act(async () => {
    useLogs.setState({ logs: { [logKey('studio', 'q1')]: {
      items: evs.reduce((acc, ev) => apply(acc, ev), []), seq: 3, truncated: false, busy: false,
      pending: [], loading: false, error: null,
    } } });
  });
  await click(tab('chat:studio:q1').firstElementChild);
  const here = win();
  ok('the chat’s window is the chat: its question form and its approval are in it',
    winId() === 'chat:studio:q1' && !!here.querySelector('form') && here.textContent.includes('Which pricing model?')
      && !!btn('Allow', here), here?.textContent?.slice(0, 160));
  asked.length = 0;
  await click([...here.querySelectorAll('form button')].find((b) => b.textContent.includes('Usage')));
  await click(btn('Submit answers', here));
  await click(btn('Allow', here));
  const responses = asked.filter((a) => a.type === 'approval.respond');
  ok('the form answers request rq once with its answers, Allow answers rb once, both on chat q1, and nothing goes to a ticket',
    responses.length === 2
      && responses[0].data.chat_id === 'q1' && responses[0].data.request_id === 'rq' && responses[0].data.decision === 'allow'
      && JSON.stringify(responses[0].data.response) === JSON.stringify({ answers: { model: { answers: ['Usage'] } } })
      && responses[1].data.chat_id === 'q1' && responses[1].data.request_id === 'rb' && responses[1].data.decision === 'allow'
      && !notes().length && winId() === 'chat:studio:q1',
    JSON.stringify(asked));
}

// ── 6 ───────────────────────────────────────────────────────────────────────

group('it closes by itself only when the agent says the exchange is over');
{
  await click(tab('studio:k2').firstElementChild);
  miniCard = { agent_status: 'cancelled', agent_status_at: NOW - 2, agent_detail: '' };
  studioCard = { agent_status: 'running', agent_status_at: NOW - 2, agent_detail: '' };
  await board();
  ok('a withdrawn request clears its asking state and says so, and is left for the reader to close',
    !row('mini:m1') && tab('mini:m1')?.getAttribute('data-phase') === 'withdrawn', tab('mini:m1')?.getAttribute('data-phase'));
  ok('the studio ticket back at work still has its window', winId() === 'studio:k2');
  studioCard = { agent_status: 'verified', agent_status_at: NOW - 1, agent_detail: '', column: 'done' };
  await board();
  ok('the ticket finished and verified — the agent’s own word that it has what it needed — and the window closes',
    !tab('studio:k2') && winId() !== 'studio:k2' && !row('studio:k2'), `${winId()} ${!!tab('studio:k2')}`);
}

// ── the rules, without a document ───────────────────────────────────────────

group('the rules');
{
  ok('points: a list on one line is split, a repeated point dropped, a wrapped line kept with its point',
    JSON.stringify(points('- A one? - B two? - A one?')) === JSON.stringify(['A one?', 'B two?'])
      && JSON.stringify(points('- first point that\nwraps here.\n- second.')) === JSON.stringify(['first point that wraps here.', 'second.']));
  const view = (await load('src/lib/divan.js')).merge(
    Object.entries(snaps()).map(([key, state]) => ({ key, name: key, state })), NOW);
  const list = pending(view, {});
  const once = sync(NO_ASK, list, view, NOW);
  ok('sync is idempotent: the same input twice is the same state', sync(once, list, view, NOW) === once);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
