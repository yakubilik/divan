#!/usr/bin/env node
/** docs/divan-ui-migration.md held to itself: every action on main has a new
 *  place, none is marked missing, and every proof it cites is a check that
 *  exists in the file it names.
 *
 *     cd web && node scripts/test-inventory.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = readFileSync(join(repo, 'docs', 'divan-ui-migration.md'), 'utf8');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const app = readdirSync(join(repo, 'app', 'scripts')).filter((f) => /^test-.*\.cjs$/.test(f))
  .map((f) => read(`app/scripts/${f}`)).join('\n');
const SOURCES = {
  drive: read('web/scripts/test-drive.mjs'),
  actions: read('web/scripts/test-actions-ui.mjs'),
  walk: read('web/scripts/test-walk-ui.mjs'),
  machine: read('web/scripts/test-machine.mjs'),
  refusal: read('web/scripts/test-refusal.mjs'),
  overview: read('web/scripts/test-overview.mjs'),
  phone: app,
};

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
};

const section = (title) => {
  const at = doc.indexOf(`## ${title}\n`);
  const next = doc.indexOf('\n## ', at + 4);
  return doc.slice(at, next < 0 ? undefined : next);
};
const rows = (text) => text.split('\n').filter((l) => l.startsWith('| ') && !/^\|\s*(Action|---)/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

for (const platform of ['Web', 'Phone']) {
  const table = rows(section(platform));
  const empty = table.filter((r) => r.length !== 5 || !r[0] || !r[2]);
  const missing = table.filter((r) => /missing|not built|gone|removed/i.test(r[2]));
  const unproven = table.filter((r) => {
    const m = r[4].match(/^(\w+): "(.+)"$/);
    return !m || !SOURCES[m[1]] || !SOURCES[m[1]].includes(m[2]);
  });
  ok(`${platform}: ${table.length} actions, each with a new place and none marked missing`,
    table.length >= 30 && !empty.length && !missing.length, [...empty, ...missing].map((r) => r[0]).join('; '));
  ok(`${platform}: every proof names a check that exists in the file it cites`,
    !unproven.length, unproven.map((r) => `${r[0]} → ${r[4]}`).join('\n    '));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
