#!/usr/bin/env node
/** The agent a new chat opens with, which Settings › New chat defaults sets.
 *
 *     cd web && npm test
 *
 *  One rule (`defaultAgent` in `lib/prefs.ts`) that the command bar's chip, the
 *  empty chat's head, the New chat dialog and Settings all read: the agent that
 *  was chosen, Hermes where none was or where the chosen one is not on that
 *  sign-in, and nobody where "No agent" was the answer.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'default-agent');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/prefs.ts', 'src/vite-env.d.ts',
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
const { defaultAgent, defaultAgentLabel } = await import(pathToFileURL(join(out, 'src/lib/prefs.js')));

const hermes = { id: 'hermes', name: 'hermes', label: 'Hermes' };
const coach = { id: 'user:coach', name: 'coach', label: 'Health Coach' };
const both = [coach, hermes];

console.log('── which agent a new chat opens with');
ok('never chosen is Hermes', defaultAgent(both, undefined) === hermes);
ok('the one chosen in Settings, by id', defaultAgent(both, 'user:coach') === coach);
ok('…or by its name', defaultAgent(both, 'coach') === coach);
ok('a chosen agent this sign-in does not have falls back to Hermes', defaultAgent([hermes], 'user:coach') === hermes);
ok('"No agent" is an answer and stays one', defaultAgent(both, null) === null);
ok('no Hermes and nothing chosen is nobody', defaultAgent([coach], undefined) === null);

console.log('── what the chip says');
ok('the chosen agent’s own label', defaultAgentLabel(both, 'user:coach') === 'Health Coach');
ok('Hermes where none was chosen, before the list is read and after',
  defaultAgentLabel(null, undefined) === 'Hermes' && defaultAgentLabel(both, undefined) === 'Hermes');
ok('No agent, in the words the place uses', defaultAgentLabel(both, null) === 'No agent'
  && defaultAgentLabel(null, null, 'no agent') === 'no agent' && defaultAgentLabel([coach], undefined) === 'No agent');
ok('another agent is not called Hermes while the list is being read', defaultAgentLabel(null, 'user:coach') === '…');

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('ok — the default agent');
