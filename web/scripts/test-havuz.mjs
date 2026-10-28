#!/usr/bin/env node
/** Havuz (`/havuz`): the tool pool, by category.
 *
 *     cd web && npm test
 *
 *  `lib/nav.ts`: `/havuz` and `/havuz?g=video` read back as the page and the
 *  group, write out as the same address, and a group is never carried onto
 *  any other page. `lib/havuz.ts`: every tool lands in exactly one group, known
 *  groups come first in their order, ready tools before catalogued ones, and a
 *  group named in the address that the pool does not have is "all".
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'havuz');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/nav.ts', 'src/lib/havuz.ts', 'src/vite-env.d.ts',
  '--outDir', '.test-build/havuz', '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`)));
}

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5177/' });
for (const name of ['window', 'document', 'location', 'history', 'localStorage', 'navigator']) {
  try { globalThis[name] = dom.window[name]; } catch { /* read-only here */ }
}

const nav = await import(pathToFileURL(join(out, 'src', 'lib', 'nav.js')).href);
const hv = await import(pathToFileURL(join(out, 'src', 'lib', 'havuz.js')).href);

console.log('── /havuz in the address');
const all = nav.readPlace('/havuz', '');
ok('/havuz reads as the Havuz page', all.view === 'overview' && all.tab === 'havuz' && all.group === null);
ok('…and writes back as /havuz', nav.pathOf(all) + nav.searchOf(all) === '/havuz');
const vid = nav.readPlace('/havuz', '?g=video');
ok('?g=video reads as the group', vid.tab === 'havuz' && vid.group === 'video');
ok('…and writes back as /havuz?g=video', nav.pathOf(vid) + nav.searchOf(vid) === '/havuz?g=video');
ok('canonical keeps the group on /havuz', nav.canonical(vid).group === 'video');
ok('canonical drops a group anywhere else',
  nav.canonical({ ...nav.HOME, tab: 'work', group: 'video' }).group === null
  && nav.canonical({ ...nav.HOME, view: 'chats', group: 'video' }).group === null
  && nav.canonical({ ...nav.HOME, group: 'video' }).group === null);
ok('two groups are two places', !nav.samePlace(all, vid));
ok('the Dashboard is still /', nav.pathOf(nav.HOME) === '/' && nav.searchOf(nav.HOME) === '');

console.log('── grouping');
const tools = [
  { id: 'a', name: 'Zeta', group: 'video', status: 'catalogued', priority: 'high' },
  { id: 'b', name: 'Alpha', group: 'video', status: 'verified', priority: 'low' },
  { id: 'c', name: 'Mid', group: 'video', status: 'installed', priority: 'medium' },
  { id: 'd', name: 'Sec', group: 'security', status: 'catalogued', priority: 'high' },
  { id: 'e', name: 'Odd', group: 'brand-new', status: 'catalogued' },
  { id: 'f', name: 'Plain', group: '', status: 'catalogued' },
  { id: 'g', name: 'Design', group: 'design', status: 'installed' },
];
const gs = hv.grouped(tools);
ok('every tool is in exactly one group', gs.reduce((n, g) => n + g.tools.length, 0) === tools.length);
ok('known groups first, in their order', gs[0].key === 'design' && gs.findIndex((g) => g.key === 'video') < gs.findIndex((g) => g.key === 'security'),
  gs.map((g) => g.key).join(' '));
ok('a tool with no group is under Other', gs.find((g) => g.key === 'other')?.tools.some((t) => t.id === 'f'));
ok('an unknown group gets a heading of its own', gs.find((g) => g.key === 'brand-new')?.word === 'Brand new');
ok('ready tools before catalogued ones', gs.find((g) => g.key === 'video').tools.map((t) => t.id).join('') === 'bca');
ok('a group the pool has is kept', hv.knownGroup(tools, 'security') === 'security');
ok('a group it does not have is all', hv.knownGroup(tools, 'nope') === null && hv.knownGroup(tools, null) === null);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
