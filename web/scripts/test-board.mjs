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
    for (const pair of m[1].split(';')) {
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
const OWN = new Set([K.ON_COLOUR, ...K.MONOGRAM,
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

  ok('the four columns are the frames’, left to right',
    eq(cols.map((c) => c.label), ['Ice Box', 'Queued', 'In Progress', 'Done']));
  ok('…each holding the cards the machines put in it, however many machines',
    eq(cols.map((c) => c.tickets.map((t) => t.card.id)),
      [['k3'], [], ['m1', 'k2', 'k1'], []]),
    JSON.stringify(cols.map((c) => c.tickets.map((t) => t.card.id))));
  // The open board is what a merged view carries: the daemon leaves `done` out
  // of the cards and sends the number. A column that drew three cards and said
  // `3` over forty-eight finished ones would be the page lying about a figure
  // it was handed.
  ok('Done is the machines’ own number, and says how much of it is not here',
    cols[3].count === 3 && cols[3].tickets.length === 0 && cols[3].more === '+ 3 more');
  ok('…and a column that is whole says nothing of the sort',
    cols.slice(0, 3).every((c) => c.more === '' && c.count === c.tickets.length));
  ok('the column something is happening in says so, and how many',
    cols[2].live === true && cols[2].sub === '1 working'
    && cols[0].sub === 'someday' && cols[1].sub === 'next up' && cols[1].live === false);

  const by = Object.fromEntries(cols.flatMap((c) => c.tickets).map((t) => [t.card.id, t]));
  ok('a ticket wears the square of whoever is on it, over what that worker does',
    by.k1.face === 'coder' && by.k1.who === 'Coder' && by.k1.kind === K.EXECUTORS.coder.kind
    && by.k3.face === 'unassigned' && by.k3.who === 'Nobody',
    `${by.k1.who} · ${by.k1.kind}`);
  ok('…and the mark in its corner is the state the mirror wrote, in the frames’ words',
    eq([by.k2.mark.label, by.k2.mark.state, by.m1.mark.label, by.m1.mark.state],
      ['Asking you', 'asking', 'Stuck 90m', 'stuck']),
    JSON.stringify([by.k2.mark, by.m1.mark]));
  ok('…a card nobody has picked up carries no mark rather than an invented one',
    by.k3.mark === null && by.k3.waiting === false && by.k2.waiting === true);
  const hush = B.columns(productOf('busy', 'hush'), NOW, ago)[2].tickets[0];
  ok('a card that is a person’s own is quiet, and drawn as an outline',
    hush.mark.label === 'Waiting on you' && hush.mark.tone === 'ink2' && hush.hollow === true
    && hush.waiting === true);

  // A card dropped in another column is there until the machine that holds the
  // board says so — and not one poll longer.
  const dropped = B.columns(quire, NOW, ago, { k3: 'queued' });
  ok('a card that was dropped is in the column it was dropped in',
    eq(dropped.map((c) => c.tickets.map((t) => t.card.id)), [[], ['k3'], ['m1', 'k2', 'k1'], []])
    && dropped[0].count === 0 && dropped[1].count === 1,
    JSON.stringify(dropped.map((c) => [c.count, c.tickets.map((t) => t.card.id)])));
  ok('…until the machine agrees, and then the overlay is gone',
    eq(B.settled({ k3: 'queued' }, quire.cards), { k3: 'queued' })
    && eq(B.settled({ k3: 'ice_box' }, quire.cards), {})
    && eq(B.settled({ gone: 'done' }, quire.cards), {}));
  ok('and a column never offers to take the card it already holds',
    B.takes('queued', 'ice_box') === true && B.takes('ice_box', 'ice_box') === false
    && B.takes('ice_box', null) === false);
}

// ── 2 · the page is the frames’ page ───────────────────────────────────────

group('Web12 W2, and Web13 W4 which is the same board in the light');
{
  const drawn = board('busy', 'quire');

  ok('four columns abreast, on the frame’s grid',
    anyStyle(drawn, (d) => d['grid-template-columns'] === 'repeat(4, minmax(0, 1fr))'
      && d.gap === '12px')
    && countStyles(drawn, (d) => d['border-radius'] === `${K.RADIUS.card}px` && d.padding === '12px') === 4);
  ok('…each headed by its name, its count and the mono aside the frame gives it',
    /Ice Box/.test(drawn) && /In Progress/.test(drawn) && /someday/.test(drawn)
    && /1 working/.test(drawn) && /\+ 3 more/.test(drawn));
  ok('a ticket is the board’s card: the frame’s corner, padding and gap',
    countStyles(drawn, (d) => d.padding === '12px 14px 13px' && d.gap === '8px'
      && d['border-radius'] === `${K.RADIUS.tile}px`) === 4);
  ok('…with a 28 pt square, the name at 13 over a mono line, and its title at 15.5',
    countStyles(drawn, (d) => d.width === `${K.SIZE.executor}px`) === 4
    && countStyles(drawn, (d) => d['font-size'] === '15.5px' && d['letter-spacing'] === '-.005em') === 4
    && countStyles(drawn, (d) => d['font-size'] === '10.5px' && d.color === v('ink3')) === 4);
  ok('…and the mark in its corner as a tag, in the wash of what it is saying',
    /Asking you/.test(drawn) && /Stuck/.test(drawn)
    && anyStyle(drawn, (d) => d.background === v('amberBg') && d.padding === '4px 8px'
      && d['border-radius'] === `${K.RADIUS.chip}px`));
  ok('every ticket can be picked up, and the ones needing a person can be pressed',
    (drawn.match(/draggable="true"/g) ?? []).length === 4
    && /title="Answer Coder on Stripe keys"/.test(drawn), drawn.match(/title="[^"]*"/g)?.join(' '));
  ok('the card nothing runs on is an outline rather than a surface',
    anyStyle(board('busy', 'hush'), (d) => d.background === 'transparent'
      && d.border === `1.5px dashed ${v('line2')}`));

  // The whole of the difference between W2 and W4.
  K.setThemeChoice('dark');
  const dark = board('busy', 'quire');
  K.setThemeChoice('light');
  const light = board('busy', 'quire');
  K.setThemeChoice('dark');
  ok('W4 is W2 in the other theme: the same markup, one attribute apart',
    dark === light, `${dark.length} vs ${light.length}`);
  ok('…and it is a board with colours in it, none of them its own',
    /var\(--dv-/.test(dark)
    && (dark.replace(/var\([^)]*\)/g, '').match(COLOUR) ?? []).every((c) => OWN.has(c)));
  ok('the page is composed of the parts and spells no style of its own',
    /from '\.\.\/ui\/divan'/.test(src('src/screens/Board.tsx'))
    && !COLOUR.test(src('src/screens/Board.tsx').replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('…and the board is a tab of the product’s page rather than a place of its own',
    /<Board view=\{view\} project=\{project\} \/>/.test(src('src/screens/Overview.tsx'))
    && /<Tabs tabs=/.test(src('src/screens/Overview.tsx')));
  ok('none of it reaches the chat',
    !/from '[^']*(ChatView|Bubble|Timeline|ChatDetails|TicketChat)'/.test(src('src/screens/Board.tsx')));
}

// ── 3 · every state of a board ─────────────────────────────────────────────

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
  ok('a board read off a machine that has gone quiet keeps the cards it last sent',
    board('quiet', 'quire').includes('Out-of-order deliveries'));
  ok('…and so does one whose machine refuses the connection',
    board('unreachable', 'quire').includes('Out-of-order deliveries'));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
