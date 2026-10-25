#!/usr/bin/env node
/** The order the computers stand in on the All computers list (`lib/fleet-order.ts`).
 *
 *     cd web && npm test
 *
 *  What has to hold: the order this browser saved is applied to the list
 *  `fleetSections` draws, a computer paired since it was saved comes last, one
 *  removed since is skipped, and a heading moves above or below another.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'fleet-order');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/fleet-order.ts', 'src/lib/chat-list.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8')
    .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => (spec.endsWith('.js') ? m : `${a}${spec}.js${z}`)));
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const load = (p) => import(pathToFileURL(join(out, p)).href);
const O = await load('src/lib/fleet-order.js');
const { fleetSections } = await load('src/lib/chat-list.js');

const chat = (id) => ({ id, title: id, archived: 0, pinned: 0, status: 'idle', updated_at: 100, cwd: '' });
const host = (name, ...ids) => ({ cfg: { name }, info: { name }, chats: ids.map(chat) });
const hosts = {
  mac: host('DILARA-MACBOOK-AIR', 'm1'),
  cinema: host('CINEMA PC', 'c1'),
  salure: host('SALURE-5986', 's1'),
  quiet: host('QUIET', /* no chats: no section */),
};
const keys = (order) => fleetSections(hosts, order, '').map((s) => s.key).join();

group('a saved order applied to fleetSections');
ok('nothing saved: pairing order', keys(O.fleetOrder(['mac', 'cinema', 'salure'], [])) === 'mac,cinema,salure');
ok('the saved order is the list’s order',
  keys(O.fleetOrder(['mac', 'cinema', 'salure'], ['cinema', 'salure', 'mac'])) === 'cinema,salure,mac');
ok('one paired since comes last, in pairing order',
  O.fleetOrder(['mac', 'new1', 'cinema', 'new2'], ['cinema', 'mac']).join() === 'cinema,mac,new1,new2',
  O.fleetOrder(['mac', 'new1', 'cinema', 'new2'], ['cinema', 'mac']).join());
ok('one removed since it was saved is skipped',
  O.fleetOrder(['mac', 'cinema'], ['salure', 'cinema', 'mac']).join() === 'cinema,mac');
ok('a key saved twice counts once', O.fleetOrder(['mac', 'cinema'], ['cinema', 'cinema', 'mac']).join() === 'cinema,mac');
ok('a computer with no chats keeps its place and draws no section',
  keys(O.fleetOrder(['mac', 'quiet', 'cinema'], ['quiet', 'cinema', 'mac'])) === 'cinema,mac');

group('a heading moved above or below another');
const three = ['mac', 'cinema', 'salure'];
ok('above the first', O.moveHost(three, 'cinema', 'mac', false).join() === 'cinema,mac,salure');
ok('below the last', O.moveHost(three, 'mac', 'salure', true).join() === 'cinema,salure,mac');
ok('below the one above it: where it was', O.moveHost(three, 'cinema', 'mac', true).join() === 'mac,cinema,salure');
ok('onto itself, or a key it does not know: unchanged',
  O.moveHost(three, 'mac', 'mac', false) === three && O.moveHost(three, 'gone', 'mac', false) === three
    && O.moveHost(three, 'mac', 'gone', false) === three);

group('kept in this browser');
ok('nothing stored: empty', O.savedFleetOrder().length === 0);
O.saveFleetOrder(['salure', 'mac']);
ok('read back what was saved', O.savedFleetOrder().join() === 'salure,mac', store.get(O.FLEET_ORDER_KEY));
store.set(O.FLEET_ORDER_KEY, '{not json');
ok('a broken entry reads as nothing', O.savedFleetOrder().length === 0);
store.set(O.FLEET_ORDER_KEY, '{"a":1}');
ok('…and so does one that is not a list', O.savedFleetOrder().length === 0);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
