#!/usr/bin/env node
/** A ticket's time, tokens and cost, and what each figure is called.
 *
 *     cd web && npm test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'usage');

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
  'src/lib/usage.ts', 'src/vite-env.d.ts',
  '--outDir', out, '--rootDir', '.',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--strict', '--skipLibCheck',
], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const p = join(f.parentPath ?? f.path, f.name);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g,
    (m, a, b, c) => (/\.(js|json)$/.test(b) ? m : `${a}${b}.js${c}`)));
}
const { usageFace } = await import(pathToFileURL(join(out, 'src/lib/usage.js')));

const T0 = 1_791_000_000;
const run = (stage, round, at, took, more = {}) => ({
  run: `r${round}-${stage}-${at}`, stage, round, started_at: at,
  ended_at: took == null ? null : at + took, live: took == null, model: stage !== 'check',
  tokens: null, cost_usd: null, ...more,
});
const row = (face, key) => face.rows.find((r) => r.key === key);

group('a ticket on its second round, the worker still going');
{
  const usage = {
    runs: [
      run('worker', 1, T0, 600, { tokens: { input: 100, output: 1000, cache_read: 50000, cache_write: 2000 }, cost_usd: 1 }),
      run('check', 1, T0 + 700, 30),
      run('worker', 2, T0 + 5000, null),
    ],
    active_seconds: 630, tokens: { input: 100, output: 1000, cache_read: 50000, cache_write: 2000 },
    cost_usd: 1, cost_basis: 'estimate', unreported: 0,
  };
  const at = usageFace(usage, T0 + 5000 + 125);
  const later = usageFace(usage, T0 + 5000 + 190);
  ok('the run row is the run that is going, timed from its own start',
    row(at, 'run').label === 'Current run' && row(at, 'run').scope === 'worker · round 2'
      && row(at, 'run').value === '2m 5s' && at.live, JSON.stringify(row(at, 'run')));
  ok('…and it moves with the clock', row(later, 'run').value === '3m 10s', row(later, 'run').value);
  ok('active time is the runs added up and says it is the whole ticket’s — 85 minutes of ticket, 12m 35s of running',
    row(at, 'active').value === '12m 35s' && /^whole ticket · 3 runs$/.test(row(at, 'active').scope),
    JSON.stringify(row(at, 'active')));
  ok('tokens are the whole ticket’s, with input, cached input, cache write and output apart',
    row(at, 'tokens').scope === 'whole ticket' && row(at, 'tokens').value === '53k'
      && row(at, 'tokens').fine === 'input 100 · cached input 50k · cache write 2.0k · output 1.0k',
    JSON.stringify(row(at, 'tokens')));
  ok('a cost with no API key behind it is called an estimate and says nothing was charged',
    row(at, 'cost').value === '$1.00' && row(at, 'cost').tag === 'estimate'
      && /nothing was charged/.test(row(at, 'cost').fine), JSON.stringify(row(at, 'cost')));
  ok('the totals say the run that is going is not in them yet',
    /current run reports its tokens and cost when it ends/.test(at.caveat || ''), at.caveat);
}

group('the same ticket, finished');
{
  const done = {
    runs: [run('worker', 1, T0, 600, { tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 }, cost_usd: 0.5 }),
           run('verifier', 1, T0 + 900, 54, { tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, cost_usd: 0.25 })],
    active_seconds: 654, tokens: { input: 2, output: 3, cache_read: 3, cache_write: 4 },
    cost_usd: 0.75, cost_basis: 'api', unreported: 0,
  };
  const a = usageFace(done, T0 + 2000);
  const b = usageFace(done, T0 + 90000);
  ok('nothing on it grows after the last run ended',
    JSON.stringify(a) === JSON.stringify(b) && !a.live && row(a, 'run').label === 'Last run'
      && row(a, 'run').value === '54s' && row(a, 'active').value === '10m 54s' && a.caveat === null,
    JSON.stringify(b.rows.map((r) => r.value)));
  ok('a key that paid is not called an estimate', row(a, 'cost').tag === 'API usage', row(a, 'cost').tag);
}

group('figures nobody reported');
{
  const bare = usageFace({ runs: [run('worker', 1, T0, 40)], active_seconds: 40,
    tokens: null, cost_usd: null, cost_basis: null, unreported: 1 }, T0 + 100);
  ok('missing is unavailable, never a zero',
    row(bare, 'tokens').value === 'unavailable' && row(bare, 'cost').value === 'unavailable'
      && row(bare, 'cost').tag === undefined && /1 finished run left no figures/.test(bare.caveat),
    JSON.stringify(bare.rows));
  const zero = usageFace({ runs: [run('worker', 1, T0, 5, { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0 })],
    active_seconds: 5, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0,
    cost_basis: 'estimate', unreported: 0 }, T0 + 100);
  ok('a run that said zero is drawn as zero',
    row(zero, 'tokens').value === '0' && row(zero, 'cost').value === '$0' && !row(zero, 'cost').missing,
    JSON.stringify(zero.rows));
  ok('no run on record is no box at all', usageFace(null, T0) === null && usageFace(undefined, T0) === null
    && usageFace({ runs: [] }, T0) === null);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('ok — a ticket’s time and usage');
