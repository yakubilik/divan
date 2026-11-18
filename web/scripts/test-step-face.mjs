#!/usr/bin/env node
/** One step is read as a row — a few words and the file or command — and a run
 *  adds up the files it changed.
 *
 *     cd web && npm test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'step-face');

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
  'src/lib/step-face.ts', 'src/vite-env.d.ts',
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
const { stepFace, changedFiles, countsOf, shortPath } = await import(pathToFileURL(join(out, 'src/lib/step-face.js')));
const { elapsedText } = await (async () => {
  // The clock's words live beside the component that counts; read them out of
  // the source rather than load React for one function.
  const src = readFileSync(join(web, 'src/ui/kit.tsx'), 'utf8');
  const body = src.match(/export function elapsedText\(seconds: number\): string \{([\s\S]*?)\n\}/)?.[1];
  return { elapsedText: body ? new Function('seconds', body) : null };
})();

let n = 0;
const tool = (name, input = {}, more = {}) => ({
  kind: 'tool', id: `t${++n}`, ts: n, tool: name, input, output: '', isError: false, running: false, ...more,
});

group('a step as a row');
{
  const read = stepFace(tool('Read', { file_path: '/Users/x/projects/divan/web/src/ui/kit.tsx' }));
  ok('a file is its name and the folder it is in', read.label === 'Read' && read.chip === 'ui/kit.tsx' && read.mono, JSON.stringify(read));
  ok('with the whole path behind it', /projects\/divan\/web\/src\/ui\/kit\.tsx$/.test(read.title ?? ''), read.title);
  ok('a short path is left alone', shortPath('a/b.ts') === 'a/b.ts' && shortPath('/b.ts') === '/b.ts');

  const cmd = stepFace(tool('Bash', { command: 'npm run build', description: 'Build the panel' }));
  ok('a described command is read by its description', cmd.label === 'Build the panel' && cmd.chip === 'npm run build' && cmd.mono, JSON.stringify(cmd));
  const bare = stepFace(tool('Bash', { command: 'ls' }));
  ok('an undescribed one by the tool', bare.label === 'Bash' && bare.chip === 'ls', JSON.stringify(bare));

  const agent = stepFace(tool('Agent', { description: 'Find the loader' }));
  ok('a description that is all there is, is said once', agent.label === 'Agent' && agent.chip === 'Find the loader', JSON.stringify(agent));
  const mcp = stepFace(tool('mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot', {}));
  ok('an MCP tool is its own words', mcp.label === 'Take screenshot' && mcp.chip === '', JSON.stringify(mcp));
  const none = stepFace(tool('TodoWrite', null));
  ok('no input is no chip, not a crash', none.label === 'TodoWrite' && none.chip === '' && none.counts === null);

  const think = stepFace({ kind: 'thinking', id: 'k', ts: 1, text: '\nFirst line.\nSecond line.' });
  ok('a thought is its first line', think.label === 'Thinking' && think.chip === 'First line.' && !think.mono, JSON.stringify(think));
  ok('an empty thought has no chip', stepFace({ kind: 'thinking', id: 'k2', ts: 1, text: '' }).chip === '');
}

group('the lines an edit changed');
{
  const edit = { file_path: '/a/kit.tsx', old_string: 'a\nb', new_string: 'a\nc\nd' };
  ok('an edit: what went in and what came out', JSON.stringify(countsOf('Edit', edit)) === '{"add":2,"del":1}', JSON.stringify(countsOf('Edit', edit)));
  ok('a new file is all added', JSON.stringify(countsOf('Write', { content: 'x\ny\n' })) === '{"add":2,"del":0}');
  ok('several edits in one are added up',
    JSON.stringify(countsOf('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'c\nd' }] })) === '{"add":2,"del":1}');
  ok('a read changes nothing', countsOf('Read', { file_path: '/a' }) === null);
  ok('an edit cut off before its text says nothing', countsOf('Edit', { file_path: '/a' }) === null && countsOf('Write', {}) === null);
  ok('the row carries them', stepFace(tool('Edit', edit)).counts?.add === 2);
  ok('a failed edit carries none', stepFace(tool('Edit', edit, { isError: true })).counts === null);
}

group('the files a run changed');
{
  const one = tool('Edit', { file_path: '/p/kit.tsx', old_string: 'a', new_string: 'b' });
  const two = tool('Write', { file_path: '/p/loader.tsx', content: 'x\n' });
  const again = tool('Edit', { file_path: '/p/kit.tsx', old_string: 'q', new_string: 'q\nr\ns' });
  const failed = tool('Edit', { file_path: '/p/gone.tsx', old_string: 'a', new_string: 'b' }, { isError: true });
  const going = tool('Write', { file_path: '/p/later.tsx', content: 'x' }, { running: true });
  const files = changedFiles([tool('Read', { file_path: '/p/kit.tsx' }), one, two, again, failed, going,
    { kind: 'thinking', id: 'k', ts: 1, text: 'hm' }]);
  ok('one entry a file, in the order first touched', files.map((f) => f.name).join(',') === 'kit.tsx,loader.tsx', JSON.stringify(files));
  ok('its edits added up', files[0].add === 3 && files[0].del === 1, JSON.stringify(files[0]));
  ok('and the steps that made them', files[0].ids.join(',') === `${one.id},${again.id}`);
  ok('a run that changed nothing has none', changedFiles([tool('Read', { file_path: '/a' })]).length === 0 && changedFiles([]).length === 0);
}

group('how long it has been going on');
{
  ok('the function is there to read', typeof elapsedText === 'function');
  if (elapsedText) {
    ok('seconds, to a tenth', elapsedText(7.34) === '7.3s', elapsedText(7.34));
    ok('then minutes', elapsedText(65) === '1m 05s', elapsedText(65));
    ok('then hours', elapsedText(3725) === '1h 02m', elapsedText(3725));
    ok('a clock ahead of this one reads zero, not minus', elapsedText(-4) === '0.0s', elapsedText(-4));
  }
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
