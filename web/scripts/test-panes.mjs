#!/usr/bin/env node
/** The Panes screen's layout, without a browser.
 *
 *     cd web && node scripts/test-panes.mjs
 *
 *  `lib/panes.ts` is the whole of what the layout is: a split tree, and the
 *  operations on it. This holds each operation to its word — a drop on an edge
 *  splits that pane that way, a drop on the screen's edge takes a strip of the
 *  whole screen, a close gives the space to the neighbour, a pane moved is the
 *  same pane somewhere else, a divider stops at the minimum, nothing overlaps
 *  and every pane is on screen, with no limit on how many there are — and that
 *  a layout written down is read back as the same layout. The screen itself is
 *  `test-panes-drive.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'panes');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/panes.ts', '--outDir', '.test-build/panes', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`)));
}
const P = await import(pathToFileURL(join(out, 'src', 'lib', 'panes.js')).href);
const { insert, remove, move, drag, boxes, leaves, leaf, dropAt, readLayout, autoDrop, MIN_W, MIN_H } = P;

const AREA = { w: 1100, h: 800 };
const L = (n) => leaf('studio', `c${n}`);
const id = (n) => `studio:c${n}`;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const box = (root, n) => boxes(root).panes[id(n)];
const show = (root) => JSON.stringify(Object.fromEntries(Object.entries(boxes(root).panes)
  .map(([k, r]) => [k, [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(3))])));

/** Every pane inside the area, none on top of another, and together they
 *  cover all of it. */
function tiles(root) {
  const rs = Object.values(boxes(root).panes);
  const inside = rs.every((r) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9 && r.w > 0 && r.h > 0);
  let overlap = false;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i]; const b = rs[j];
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w > 1e-9 && h > 1e-9) overlap = true;
  }
  const area = rs.reduce((t, r) => t + r.w * r.h, 0);
  return inside && !overlap && near(area, 1, 1e-6);
}

group('building a layout');
{
  let r = insert(null, L(1), null, AREA);
  ok('the first chat is the whole screen', r.kind === 'pane' && near(box(r, 1).w, 1) && near(box(r, 1).h, 1));
  r = insert(r, L(2), null, AREA);
  r = insert(r, L(3), null, AREA);
  r = insert(r, L(4), null, AREA);
  const [a, b, c, d] = [1, 2, 3, 4].map((n) => box(r, n));
  ok('four chats added without saying where are a 2×2 grid, like the terminal reference',
    [a, b, c, d].every((x) => near(x.w, 0.5) && near(x.h, 0.5))
    && near(a.x, 0) && near(a.y, 0) && near(b.x, 0.5) && near(b.y, 0) && near(c.x, 0) && near(c.y, 0.5) && near(d.x, 0.5) && near(d.y, 0.5),
    show(r));
  ok('…tiling the screen with no overlap', tiles(r));
  ok('the same chat twice is one pane', leaves(insert(r, L(1), null, AREA)).length === 4);

  const five = insert(r, L(5), null, AREA);
  ok('a fifth added to the full grid takes room from the open ones, and still nothing overlaps',
    leaves(five).length === 5 && tiles(five) && box(five, 1).w < box(r, 1).w, show(five));
}

group('dropping on an edge');
{
  const base = insert(insert(null, L(1), null, AREA), L(2), { target: id(1), edge: 'right' }, AREA);
  ok('dropped on a pane’s right edge, the new pane is to its right, halving it',
    near(box(base, 1).w, 0.5) && near(box(base, 2).x, 0.5), show(base));
  const top = insert(base, L(3), { target: id(2), edge: 'top' }, AREA);
  ok('dropped on a pane’s top edge, that pane splits into two, the new one above',
    near(box(top, 3).x, 0.5) && near(box(top, 3).y, 0) && near(box(top, 3).h, 0.5) && near(box(top, 2).y, 0.5)
    && near(box(top, 1).h, 1), show(top));
  const left = insert(top, L(4), { target: id(1), edge: 'left' }, AREA);
  ok('dropped on a pane’s left edge, the new one is to its left and only that pane gave up room',
    near(box(left, 4).x, 0) && near(box(left, 4).w, 0.25) && near(box(left, 1).x, 0.25) && near(box(left, 1).w, 0.25)
    && near(box(left, 2).w, 0.5) && near(box(left, 3).w, 0.5), show(left));
  const bottom = insert(left, L(5), { target: id(4), edge: 'bottom' }, AREA);
  ok('…and on its bottom edge, below it', near(box(bottom, 5).y, 0.5) && near(box(bottom, 5).x, 0) && near(box(bottom, 4).h, 0.5), show(bottom));
  const strip = insert(bottom, L(6), { target: null, edge: 'bottom' }, AREA);
  ok('dropped on the screen’s own bottom edge, it is a strip along the whole bottom and every pane shrinks for it',
    near(box(strip, 6).x, 0) && near(box(strip, 6).w, 1) && near(box(strip, 6).y + box(strip, 6).h, 1)
    && [1, 2, 3, 4, 5].every((n) => box(strip, n).y + box(strip, n).h <= box(strip, 6).y + 1e-9) && tiles(strip), show(strip));
}

group('where a pointer drops');
{
  const r = insert(insert(null, L(1), null, AREA), L(2), null, AREA);
  const at = (x, y, moving) => dropAt(r, { x, y }, AREA, moving);
  ok('over nothing at all, the whole screen', dropAt(null, { x: 10, y: 10 }, AREA).drop.target === null);
  ok('near the right of the left pane, its right edge', JSON.stringify(at(530, 400).drop) === JSON.stringify({ target: id(1), edge: 'right' }));
  ok('near the top of the right pane, its top edge', JSON.stringify(at(900, 60).drop) === JSON.stringify({ target: id(2), edge: 'top' }));
  ok('near the bottom of the left pane, its bottom edge', JSON.stringify(at(300, 760).drop) === JSON.stringify({ target: id(1), edge: 'bottom' }));
  ok('…and the hint is the half of that pane it would take', JSON.stringify(at(300, 760).hint) === JSON.stringify({ x: 0, y: 0.5, w: 0.5, h: 0.5 }));
  ok('right at the screen’s own edge, the screen’s edge', JSON.stringify(at(1090, 400).drop) === JSON.stringify({ target: null, edge: 'right' }));
  ok('a pane carried over itself drops nowhere', at(300, 400, id(1)) === null);
}

group('closing and moving');
{
  let r = null;
  for (const n of [1, 2, 3, 4]) r = insert(r, L(n), null, AREA);
  const shut = remove(r, id(4), AREA);
  ok('closing a pane gives its space to the neighbour: 2 takes the whole right column',
    leaves(shut).length === 3 && near(box(shut, 2).h, 1) && near(box(shut, 2).x, 0.5)
    && near(box(shut, 1).h, 0.5) && near(box(shut, 3).h, 0.5) && tiles(shut), show(shut));
  ok('closing the last pane leaves no layout', remove(L(1), id(1)) === null);

  const moved = move(r, id(1), { target: id(4), edge: 'right' }, AREA);
  ok('a pane moved by its head lands where it was put: 1 to the right of 4',
    leaves(moved).length === 4 && box(moved, 1).x > box(moved, 4).x && near(box(moved, 1).y, box(moved, 4).y)
    && near(box(moved, 3).h, 1) && tiles(moved), show(moved));
  ok('…and it is the same pane, the same chat', leaves(moved).find((l) => l.id === id(1)).chat === 'c1');
  ok('a pane put down on itself changes nothing', move(r, id(1), { target: id(1), edge: 'left' }, AREA) === r);
  const toTop = move(r, id(4), { target: null, edge: 'top' }, AREA);
  ok('moved to the screen’s top edge, it spans the whole top and the rest rearrange under it',
    near(box(toTop, 4).w, 1) && near(box(toTop, 4).y, 0) && [1, 2, 3].every((n) => box(toTop, n).y >= box(toTop, 4).h - 1e-9)
    && tiles(toTop), show(toTop));
}

group('resizing, minimums, and no limit');
{
  let r = insert(insert(null, L(1), null, AREA), L(2), null, AREA);
  const d = boxes(r).dividers[0];
  const wider = drag(r, d, 240, AREA);
  ok('a divider pulled 240 px right widens the left pane by exactly that', near(box(wider, 1).w * AREA.w, AREA.w / 2 + 240, 1e-6), show(wider));
  const tooFar = drag(r, d, 5000, AREA);
  ok('pulled past the end, it stops at the right pane’s minimum', near(box(tooFar, 2).w * AREA.w, MIN_W, 1e-6), show(tooFar));
  const tooFarBack = drag(r, d, -5000, AREA);
  ok('…and the other way, at the left pane’s', near(box(tooFarBack, 1).w * AREA.w, MIN_W, 1e-6), show(tooFarBack));

  let many = null;
  for (let n = 1; n <= 9; n++) many = insert(many, L(n), null, AREA);
  ok('nine panes open — there is no limit — tiling the screen with no overlap', leaves(many).length === 9 && tiles(many), show(many));
  ok('…and on a 1100×800 screen every one of them is at least the minimum size',
    Object.values(boxes(many).panes).every((b) => b.w * AREA.w >= MIN_W - 1e-6 && b.h * AREA.h >= MIN_H - 1e-6), show(many));
  for (const div of boxes(many).dividers) many = drag(many, div, 3000, AREA);
  ok('every divider pulled hard one way, every pane is still at least the minimum',
    Object.values(boxes(many).panes).every((b) => b.w * AREA.w >= MIN_W - 1e-6 && b.h * AREA.h >= MIN_H - 1e-6) && tiles(many), show(many));
  ok('the auto drop is beside the biggest pane, along its longer side', (() => {
    const two = insert(L(1), L(2), null, AREA);
    const a = autoDrop(two, AREA);
    return a.target === id(1) && a.edge === 'bottom';
  })());
}

group('kept and read back');
{
  let r = null;
  for (const n of [1, 2, 3, 4]) r = insert(r, L(n), null, AREA);
  r = drag(r, boxes(r).dividers[0], 100, AREA);
  const back = readLayout(JSON.parse(JSON.stringify({ root: r, max: id(3) })));
  ok('a layout written down reads back as the same layout, sizes and the maximised pane too',
    show(back.root) === show(r) && back.max === id(3), `${show(back.root)} vs ${show(r)}`);
  ok('garbage reads back as no layout', readLayout({ root: { kind: 'split', dir: 'diag', kids: 3 } }).root === null
    && readLayout(null).root === null && readLayout('x').root === null);
  ok('a maximised pane that is not in the layout is not maximised', readLayout({ root: r, max: 'studio:gone' }).max === null);
  const dup = readLayout({ root: { kind: 'split', dir: 'row', kids: [L(1), L(1), L(2)], sizes: [1, 1, 1] } });
  ok('the same chat saved twice is read back once', leaves(dup.root).length === 2 && tiles(dup.root), show(dup.root));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
