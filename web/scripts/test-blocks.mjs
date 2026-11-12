#!/usr/bin/env node
/** `lib/blocks.ts`: an answer cut into text, code, diagrams and pipe tables —
 *  what the panel's `Prose` draws each piece as.
 *
 *     cd web && npm test
 *
 *  Before it, a table in an answer was a block of pipes in the panel while
 *  the phone drew it as a table, and a ```mermaid fence was code here and a
 *  chart there. The drawing itself is checked in a real browser by
 *  `test-prose-ui.mjs`. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'blocks');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'esbuild'), [
  'src/lib/blocks.ts', '--format=esm', `--outfile=${join(out, 'blocks.mjs')}`, '--log-level=warning',
], { cwd: web, stdio: 'inherit' });
const { blocks, isDiagram, splitRow, delimiterRow } = await import(pathToFileURL(join(out, 'blocks.mjs')).href);

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
const kinds = (bs) => bs.map((b) => b.kind).join(',');

console.log('── tables');
{
  const text = 'Here it is.\n\n| Servis | Ne yapıyor | Aylık |\n|---|---|--:|\n| **AWS EC2** (`t4g.medium`) | API | ~30 $ |\n| RDS | Postgres | 17 $ |\n\nTotal after.';
  const bs = blocks(text);
  ok('text, table, text', kinds(bs) === 'text,table,text', kinds(bs));
  const t = bs[1];
  ok('head cells', JSON.stringify(t.head) === JSON.stringify(['Servis', 'Ne yapıyor', 'Aylık']), JSON.stringify(t.head));
  ok('alignment read from the delimiter row', JSON.stringify(t.align) === JSON.stringify([null, null, 'right']), JSON.stringify(t.align));
  ok('two body rows, inline marks kept for the cell renderer', t.rows.length === 2 && t.rows[0][0] === '**AWS EC2** (`t4g.medium`)', JSON.stringify(t.rows));
  ok('blank lines at a block edge are dropped', bs[0].text === 'Here it is.' && bs[2].text === 'Total after.', JSON.stringify([bs[0].text, bs[2].text]));
}
{
  const bs = blocks('A | B\n--- | ---\n1 | 2');
  ok('a table without outer pipes', kinds(bs) === 'table' && bs[0].rows[0].join() === '1,2', JSON.stringify(bs));
}
{
  const bs = blocks('| a | b |\n|---|---|\n| only one |\n| 1 | 2 | 3 |');
  ok('short rows padded, long rows cut to the head', bs[0].rows[0].length === 2 && bs[0].rows[0][1] === '' && bs[0].rows[1].join() === '1,2', JSON.stringify(bs[0].rows));
}
ok('a pipe in inline code is not a cell edge', splitRow('| `a|b` | c |').join('§') === '`a|b`§c', splitRow('| `a|b` | c |').join('§'));
ok('an escaped pipe is a pipe', splitRow('| a \\| b | c |').join('§') === 'a | b§c');
ok('a delimiter row needs dashes', delimiterRow('| | |') === null && delimiterRow('|:-:|') !== null);
{
  const bs = blocks('x | y means or\nnot a table');
  ok('a line with a pipe is not a table without its delimiter row', kinds(bs) === 'text', kinds(bs));
}
{
  const bs = blocks('| a | b |\n|---|---|---|\n| 1 | 2 |');
  ok('head and delimiter must agree on width', kinds(bs) === 'text', kinds(bs));
}

console.log('── fences');
{
  const bs = blocks('Before\n\n```mermaid\npie title X\n  "a" : 1\n```\n\nAfter');
  ok('text, code, text', kinds(bs) === 'text,code,text', kinds(bs));
  ok('a closed mermaid fence is a diagram', isDiagram(bs[1]) && bs[1].code === 'pie title X\n  "a" : 1', JSON.stringify(bs[1]));
}
{
  const bs = blocks('Streaming\n\n```mermaid\npie title X\n  "a" : 1');
  ok('an unclosed fence (still streaming) stays code', bs[1].kind === 'code' && !bs[1].closed && !isDiagram(bs[1]), JSON.stringify(bs[1]));
}
{
  const bs = blocks('```mermaid\n```');
  ok('an empty mermaid fence is not a diagram', !isDiagram(bs[0]));
}
{
  const bs = blocks('```python\nx = "| a | b |"\n```');
  ok('other languages are code', bs[0].kind === 'code' && bs[0].lang === 'python' && !isDiagram(bs[0]));
}
{
  const bs = blocks('```\n| a | b |\n|---|---|\n| 1 | 2 |\n```');
  ok('a table inside a fence stays code', kinds(bs) === 'code', kinds(bs));
}
{
  const bs = blocks('````md\n```mermaid\npie\n```\n````');
  ok('a longer fence holds a shorter one', kinds(bs) === 'code' && bs[0].lang === 'md' && bs[0].closed && bs[0].code.includes('```mermaid'), JSON.stringify(bs));
}
{
  const bs = blocks('```Mermaid title\ngraph TD; A-->B\n```');
  ok('the fence language is its first word, any case', isDiagram(bs[0]));
}

console.log('── plain text');
{
  const bs = blocks('Just words.\n\nTwo paragraphs.');
  ok('one text block, its own blank line kept', kinds(bs) === 'text' && bs[0].text === 'Just words.\n\nTwo paragraphs.');
  ok('nothing in, nothing out', blocks('').length === 0);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
