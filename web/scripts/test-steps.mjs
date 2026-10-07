#!/usr/bin/env node
/** A run of tool calls is read as one sentence, in the person's language.
 *
 *     cd web && npm test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    said('user', 'şunu düzelt'), bash('git status'), { kind: 'thinking', id: 'k', ts: 3, text: '…' },
    tool('Read', { file_path: '/a.ts' }), said('assistant', 'Buldum.'), bash('npm test'),
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
  const done = tell(run, false, 'tr');
  ok('over, it names the kinds of work done most, in the order they began, and counts the calls',
    done.text === 'Tarayıcıda sayfayı kontrol ettim, ekran görüntüsü aldım, değişiklikleri gönderdim' && done.count === 7,
    JSON.stringify(done));
  ok('going on, it says what is being done now',
    tell([...run, bash('npm run test', { running: true })], true, 'tr').text === 'Testleri çalıştırıyorum…');
  ok('in English for a person who writes English',
    tell([bash('npm install'), tool('Read')], false, 'en').text === 'Installed packages, read files');
  ok('a command nothing recognises is still a sentence, not the command',
    workOf(bash('./deploy-thing --now')) === 'run');
}

group('the language is the person’s');
{
  ok('Turkish is heard in what they wrote', langOf([said('user', 'bunu düzelt')], 'en') === 'tr');
  ok('English likewise, whatever the browser is set to', langOf([said('user', 'fix the login redirect')], 'tr') === 'en');
  ok('before they have written anything it is the browser’s', langOf([], 'tr-TR') === 'tr');
}

group('a title under its project’s heading');
{
  ok('leaves the project out', bareTitle('grikoc · Tasarım eksikleri', '/Users/x/projects/grikoc') === 'Tasarım eksikleri');
  ok('by the name the product goes by too', bareTitle('Grikoç · Tasarım', '/Users/x/projects', 'Grikoç') === 'Tasarım');
  ok('and keeps a dot that is the person’s own', bareTitle('Fix · the thing', '/Users/x/projects/grikoc') === 'Fix · the thing');
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
