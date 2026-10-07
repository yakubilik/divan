#!/usr/bin/env node
/** The desktop board, Web12 W2 and Web13 W4.
 *
 *     cd web && npm test
 *
 *  Covered here: what a board says about itself (`src/lib/board.ts`), and that
 *  the page drawing it is the frame in both themes and stands up on a board
 *  with nothing on it, on one read off a machine that has gone quiet and on one
 *  whose machine refuses the connection. Pressing a card, answering the window
 *  it opens and dragging a card between columns are in `test-drive.mjs`, where
 *  there is a document to do them in.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'board');
const src = (p) => readFileSync(join(web, p), 'utf8');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── build ───────────────────────────────────────────────────────────────────

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/board.ts', 'src/screens/Board.tsx', 'src/screens/Overview.tsx', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.',
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

// ── a browser, as far as a static render needs one ──────────────────────────

const html = { dataset: {} };
const query = { matches: false, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
  documentElement: html, hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelectorAll: () => [],
};
globalThis.window = {
  matchMedia: () => query, addEventListener() {}, removeEventListener() {},
  location: { pathname: '/', search: '', hash: '' },
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.location = globalThis.window.location;

const load = (p) => import(pathToFileURL(join(out, p)).href);
const K = await load('src/lib/theme.js');
const D = await load('src/lib/divan.js');
const B = await load('src/lib/board.js');
const S = await load('src/lib/sessions.js');
const BoardUI = await load('src/screens/Board.js');
const OverviewUI = await load('src/screens/Overview.js');
const { createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { boards } = await import(pathToFileURL(join(web, 'scripts', 'overview-fixture.js')).href);

const NOW = 1_790_600_000;
const BOARDS = boards(NOW);
const ago = (s) => (s == null ? '' : `${Math.round(s / 60)}m`);

function state(spec) {
  if (!spec.snap) return D.silent(null, spec.error ?? 'not connected', !!spec.old);
  const was = D.answered(spec.snap, NOW - (spec.age ?? 0));
  return spec.error ? D.silent(was, spec.error) : was;
}
const view = (name) => D.merge(
  BOARDS[name].map((s) => ({ key: s.key, name: s.name, state: state(s) })), NOW);
const productOf = (name, key) => view(name).projects.find((p) => p.key === key) ?? null;

function styles(markup) {
  return [...markup.matchAll(/style="([^"]*)"/g)].map((m) => {
    const decl = {};
    for (const pair of m[1].replace(/&quot;/g, '"').split(';')) {
      const cut = pair.indexOf(':');
      if (cut > 0) decl[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
    }
    return decl;
  });
}
const anyStyle = (markup, pred) => styles(markup).some(pred);
const countStyles = (markup, pred) => styles(markup).filter(pred).length;
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\)/g;
const v = (n) => `var(--dv-${n})`;
const OWN = new Set([K.ON_COLOUR,
                     ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                     ...Object.values(K.MEDIA)]);

const board = (name, key) => renderToStaticMarkup(h(BoardUI.Board, {
  view: view(name), project: productOf(name, key),
}));

// ── 1 · what the board says ────────────────────────────────────────────────

group('the four columns, and what is in them');
{
  const quire = productOf('busy', 'quire');
  const cols = B.columns(quire, NOW, ago);
  ok('the columns are the four the handover names, with review folded into In Progress',
    eq(cols.map((c) => c.label), ['Ice Box', 'Queued', 'In Progress', 'Done'])
    && eq(cols.map((c) => c.sub), ['someday', 'top = next', 'drop here = start', 'this month']));
  ok('…each holding the cards the machines put in it, however many machines',
    eq(cols.map((c) => c.tickets.map((t) => t.card.id)), [['k3'], [], ['m1', 'k2', 'k1'], []]),
    JSON.stringify(cols.map((c) => c.tickets.map((t) => t.card.id))));
  ok('Done counts this month’s cards, never an all-time total over them',
    cols[3].count === 0 && quire.counts.done === 3);
  const by = Object.fromEntries(cols.flatMap((c) => c.tickets).map((t) => [t.card.id, t]));
  ok('the status word is the real one, and only the asking or stuck card carries a sentence',
    eq([by.k2.status, by.m1.status], [{ kind: 'ask', word: 'asking' }, { kind: 'stuck', word: 'stuck' }])
    && by.k2.line.length > 0 && by.k3.status === null && by.k3.line === '');
  const dropped = B.columns(quire, NOW, ago, { k3: 'queued' });
  ok('a card that was dropped is in the column it was dropped in, until the machine agrees',
    eq(dropped.map((c) => c.tickets.map((t) => t.card.id)), [[], ['k3'], ['m1', 'k2', 'k1'], []])
    && eq(B.settled({ k3: 'queued' }, quire.cards), { k3: 'queued' })
    && eq(B.settled({ k3: 'ice_box' }, quire.cards), {}));
  ok('and a column never offers to take the card it already holds',
    B.takes('queued', 'ice_box') === true && B.takes('ice_box', 'ice_box') === false
    && B.takes('ice_box', null) === false);
}

group('a card dragged in front of the queue says so');
{
  const one = (patch) => ({
    id: 'k9', project_id: 'p1', branch: 'engineering', column: 'in_progress', position: 0,
    title: 'Klinik hesabi', summary: '', executor: 'coding_agent', machine: 'studio',
    repo: null, ustabasi_id: 71, agent_status: 'queued', agent_status_at: NOW - 60,
    agent_detail: '', created_at: NOW - 900, updated_at: NOW - 60, moved_at: NOW - 60,
    host: 'studio', hostName: 'studio', projectKey: 'quire', stale: false, ...patch,
  });
  const ago = (s) => `${Math.round(s / 60)}m`;
  ok('a ticket the queue has not started yet, put in In Progress, says it is next',
    B.cardMark(one({}), NOW, ago)?.label === 'Next up',
    JSON.stringify(B.cardMark(one({}), NOW, ago)));
  ok('…and the moment a worker picks it up it says what it is doing instead',
    B.cardMark(one({ agent_status: 'running' }), NOW, ago)?.label.startsWith('Running'));
  ok('…while a card in Queued still carries no mark at all',
    B.cardMark(one({ column: 'queued' }), NOW, ago) === null);
  ok('…and one with no ticket behind it is not the queue’s to talk about',
    B.cardMark(one({ ustabasi_id: null }), NOW, ago) === null);
}

group('a card pressed on the board takes a window');
{
  const live = S.sessions(view('busy'));
  const four = [...live, { ...live[0], id: 'studio:k9' }];
  const last = four[3];
  const raised = S.arrange(four, { minimised: [], closed: {}, raised: [last.id] });

  ok('a question past the two the desktop opens by itself has no window until it is asked for',
    !S.arrange(four).panels.some((p) => p.id === last.id) && raised.panels[0].id === last.id,
    `${S.arrange(four).panels.map((p) => p.id).join(', ')} → ${raised.panels.map((p) => p.id).join(', ')}`);

  S.useDock.setState({ minimised: [], closed: {}, raised: [] });
  S.useDock.getState().close(last.id, S.at(last));
  const shut = S.arrange(four, S.useDock.getState());
  S.useDock.getState().raise(last.id);
  const back = S.arrange(four, S.useDock.getState());
  ok('…and one that was closed opens again when it is, rather than staying dealt with',
    !shut.live.some((s) => s.id === last.id) && back.panels[0].id === last.id,
    `${shut.live.length} live while closed · ${back.panels.map((p) => p.id).join(', ')}`);
}

// ── 4 · every state of a board ─────────────────────────────────────────────

group('a board with nothing on it, one that is old, and one nobody can reach');
{
  const broken = [];
  let count = 0;
  for (const name of Object.keys(BOARDS)) {
    for (const scheme of ['dark', 'light']) {
      K.setThemeChoice(scheme);
      const fleet = view(name);
      for (const p of fleet.projects) {
        try { renderToStaticMarkup(h(BoardUI.Board, { view: fleet, project: p })); count++; }
        catch (e) { broken.push(`${name} · ${scheme} · ${p.key}: ${e.message.slice(0, 140)}`); }
      }
      // …and the whole page around it, scoped and on the board tab, which is
      // the only way a reader ever meets it.
      try {
        renderToStaticMarkup(h(OverviewUI.Overview, {
          view: fleet, project: fleet.projects[0] ?? null, onProject() {}, onAsk() {},
        }));
        count++;
      } catch (e) { broken.push(`${name} · ${scheme} · the page: ${e.message.slice(0, 140)}`); }
    }
  }
  K.setThemeChoice('dark');
  ok('the board stands up on every board, in both themes', broken.length === 0,
    [...new Set(broken)].slice(0, 6).join('\n    '));
  ok('…and there were enough of them for that to mean something', count >= 20, `${count} renders`);

  ok('a product whose board is empty is a sentence rather than four empty columns',
    board('slow', 'pebble').includes('Nothing on this board yet'));
  ok('…and one whose cards are all on a machine that never sent them still says how many',
    board('slow', 'the-long-walk').includes('Ice Box')
    && board('slow', 'the-long-walk').includes('+ 3 more'));
  ok('the board is drawn in the handover’s classes and no blur',
    board('busy', 'quire').includes('dv-card') && !/backdrop-filter/.test(src('src/screens/Board.tsx')));
  ok('a board read off a machine that has gone quiet keeps the cards it last sent',
    board('quiet', 'quire').includes('Out-of-order deliveries'));
  ok('…and so does one whose machine refuses the connection',
    board('unreachable', 'quire').includes('Out-of-order deliveries'));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
