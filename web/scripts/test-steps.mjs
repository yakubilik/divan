#!/usr/bin/env node
/** A run of tool calls is read as one sentence, in the person's language.
 *
 *     cd web && npm test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'steps');

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
  'src/lib/steps.ts', 'src/lib/format.ts', 'src/vite-env.d.ts',
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
const { blocks, tell, langOf, workOf } = await import(pathToFileURL(join(out, 'src/lib/steps.js')));
const { resetPacks } = await import(pathToFileURL(join(out, 'src/lib/lang.js')));
// The Turkish words are the computer's language pack (lib/lang.ts); without one
// the Turkish checks are skipped and the panel is English throughout.
const packs = createRequire(import.meta.url)('../../scripts/lang.cjs');
const trSteps = packs.load('tr', 'web/steps');
const { bareTitle } = await import(pathToFileURL(join(out, 'src/lib/format.js')));

let n = 0;
const tool = (name, input = {}, more = {}) => ({
  kind: 'tool', id: `t${++n}`, ts: n, tool: name, input, output: '', isError: false, running: false, ...more,
});
const bash = (command, more) => tool('Bash', { command }, more);
const said = (kind, text) => ({ kind, id: `m${++n}`, ts: n, text, attachments: [], queued: false, segment: 0, done: true });

group('a run of steps is one block');
{
  const items = [
    said('user', 'fix this'), bash('git status'), { kind: 'thinking', id: 'k', ts: 3, text: '…' },
    tool('Read', { file_path: '/a.ts' }), said('assistant', 'Found it.'), bash('npm test'),
  ];
  const b = blocks(items);
  ok('everything between two things said is one block, and what was said stays its own',
    b.map((x) => (x.kind === 'steps' ? x.steps.length : x.item.kind)).join(',') === 'user,3,assistant,1',
    JSON.stringify(b.map((x) => x.kind)));
}

group('what the run is called');
{
  const shot = 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot';
  const evalJs = 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script';
  const run = [tool(evalJs), tool(shot), tool(evalJs), tool(shot), bash('git push origin main'), tool('Read'), bash('ls')];
  if (!trSteps) packs.skip('steps: the Turkish locale');
  else {
    resetPacks({ tr: { 'web/steps': trSteps } });
    const W = trSteps.work;
    const done = tell(run, false, 'tr');
    const said = [W.browser[1], W.shot[1], W.push[1]].join(', ');
    ok('over, it names the kinds of work done most, in the order they began, and counts the calls',
      done.text === said[0].toLocaleUpperCase('tr') + said.slice(1) && done.count === 7, JSON.stringify(done));
    ok('going on, it says what is being done now',
      tell([...run, bash('npm run test', { running: true })], true, 'tr').text === `${W.test[0]}…`);
    resetPacks();
    ok('…and without the pack the same run is told in English',
      tell(run, false, 'tr').text === 'Checked the page in the browser, took screenshots, pushed the changes');
  }
  ok('in English for a person who writes English',
    tell([bash('npm install'), tool('Read')], false, 'en').text === 'Installed packages, read files');
  ok('a command nothing recognises is still a sentence, not the command',
    workOf(bash('./deploy-thing --now')) === 'run');
}

group('the language is the person’s');
{
  ok('without a language pack everyone is written to in English', langOf([], 'tr-TR') === 'en');
  if (trSteps) {
    resetPacks({ tr: { 'web/steps': trSteps } });
    ok('Turkish is heard in what they wrote', langOf([said('user', trSteps.work.edit[0])], 'en') === 'tr');
    ok('English likewise, whatever the browser is set to', langOf([said('user', 'fix the login redirect')], 'tr') === 'en');
    ok('before they have written anything it is the browser’s', langOf([], 'tr-TR') === 'tr');
    resetPacks();
  }
}

group('a title under its project’s heading');
{
  ok('leaves the project out', bareTitle('acme · Design gaps', '/Users/x/projects/acme') === 'Design gaps');
  // A product name with a letter outside ASCII (c with cedilla).
  ok('by the name the product goes by too', bareTitle('Acm\u00e7 · Design', '/Users/x/projects', 'Acm\u00e7') === 'Design');
  ok('and keeps a dot that is the person’s own', bareTitle('Fix · the thing', '/Users/x/projects/grikoc') === 'Fix · the thing');
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
