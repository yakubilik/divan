#!/usr/bin/env node
/** The runner behind `npm test` (`scripts/run-tests.mjs` at the repo root).
 *
 *     cd web && npm test
 *
 *   · **one after another, first failure stops it.** A fixture directory with a
 *     passing, a failing and a later file: each name is printed as it starts,
 *     the failing file is named, the exit is non-zero, the later file never runs.
 *   · **all passing exits 0**, and the -ui files stay out of `web` and are all
 *     of `web-ui`.
 *   · **a test is a file.** A copy of this package's own package.json, next to a
 *     copy of the runner: a `test-*.mjs` dropped into its scripts/ runs under
 *     `npm test`, a `test-*-ui.mjs` under `npm run test:ui`, with package.json
 *     untouched — and neither real package.json names a test file.
 *   · **nothing dropped.** Every file the old hand-kept chains ran is still run.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(web, '..');
const runner = join(root, 'scripts', 'run-tests.mjs');

const checks = [];
const check = (name, ok, detail = '') => checks.push([name, !!ok, detail]);

const tmp = mkdtempSync(join(tmpdir(), 'divan-run-tests-'));
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, [runner, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};
const fixture = (dir, files) => {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
};
const marks = join(tmp, 'marks');
mkdirSync(marks);
const marking = (tag, code = 0) =>
  `import { writeFileSync } from 'node:fs';\n`
  + `writeFileSync(${JSON.stringify(join(marks, tag))}, '');\n`
  + `console.log('ran ${tag}');\nprocess.exit(${code});\n`;

try {
  // ── a failing file stops the run ──────────────────────────────────────────
  const failing = join(tmp, 'failing');
  fixture(failing, {
    'test-a.mjs': marking('a'),
    'test-b.mjs': marking('b', 3),
    'test-c.mjs': marking('c'),
    'test-a-ui.mjs': marking('a-ui'),
    'helper.mjs': marking('helper'),
  });
  const f = run(['web', '--dir', failing], tmp);
  check('a failure exits non-zero, with the failing file\'s own code', f.status === 3, `status ${f.status}`);
  check('the passing file before it ran', existsSync(join(marks, 'a')) && /ran a\b/.test(f.out));
  check('each file is named as it starts, in order',
    /test-a\.mjs[\s\S]*ran a[\s\S]*test-b\.mjs[\s\S]*ran b/.test(f.out), f.out);
  check('the failing file is named as the failure', /test-b\.mjs failed \(exit 3\)/.test(f.out), f.out);
  check('nothing after the failure runs', !existsSync(join(marks, 'c')) && !/test-c\.mjs/.test(f.out));
  check('a -ui file is not part of `web`', !existsSync(join(marks, 'a-ui')));
  check('a file not named test-* is not a test', !existsSync(join(marks, 'helper')));

  // ── all passing ────────────────────────────────────────────────────────────
  const passing = join(tmp, 'passing');
  fixture(passing, {
    'test-a.mjs': marking('p-a'),
    'test-b.mjs': marking('p-b'),
    'test-a-ui.mjs': marking('p-a-ui'),
  });
  const p = run(['web', '--dir', passing], tmp);
  check('all passing exits 0', p.status === 0, p.out);
  check('and ran every non-ui file', existsSync(join(marks, 'p-a')) && existsSync(join(marks, 'p-b')));
  check('and says how many passed', /2 web test files passed/.test(p.out), p.out);
  const ui = run(['web-ui', '--dir', passing, '--list'], tmp);
  check('`web-ui` is the -ui files only', ui.status === 0 && ui.out.trim() === 'test-a-ui.mjs', ui.out);
  const empty = join(tmp, 'empty');
  fixture(empty, { 'helper.mjs': '' });
  check('a suite that finds nothing fails rather than passing', run(['web', '--dir', empty], tmp).status === 1);
  check('an unknown suite is refused', run(['nope'], tmp).status === 2);

  // ── a test is added by adding a file ──────────────────────────────────────
  const pkgText = readFileSync(join(web, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgText);
  const appPkg = JSON.parse(readFileSync(join(root, 'app', 'package.json'), 'utf8'));
  for (const [where, line] of [['web test', pkg.scripts.test], ['web test:ui', pkg.scripts['test:ui']], ['app test', appPkg.scripts.test]]) {
    check(`${where} names no test file`, !/test-[\w-]+\.(mjs|cjs)/.test(line) && /run-tests\.mjs/.test(line), line);
  }
  const mirror = join(tmp, 'repo');
  fixture(join(mirror, 'scripts'), {});
  copyFileSync(runner, join(mirror, 'scripts', 'run-tests.mjs'));
  fixture(join(mirror, 'web', 'scripts'), {
    'test-dropped.mjs': marking('dropped'),
    'test-dropped-ui.mjs': marking('dropped-ui'),
  });
  writeFileSync(join(mirror, 'web', 'package.json'), pkgText);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const t = spawnSync(npm, ['test'], { cwd: join(mirror, 'web'), encoding: 'utf8' });
  check('a dropped test-*.mjs runs under `npm test`', t.status === 0 && existsSync(join(marks, 'dropped')), t.stdout + t.stderr);
  check('a dropped -ui file does not', !existsSync(join(marks, 'dropped-ui')));
  const tu = spawnSync(npm, ['run', 'test:ui'], { cwd: join(mirror, 'web'), encoding: 'utf8' });
  check('a dropped test-*-ui.mjs runs under `npm run test:ui`', tu.status === 0 && existsSync(join(marks, 'dropped-ui')), tu.stdout + tu.stderr);
  check('package.json was not touched to get there', readFileSync(join(mirror, 'web', 'package.json'), 'utf8') === pkgText);

  // ── nothing the old chains ran is dropped ─────────────────────────────────
  // The files the hand-kept chains named on the day they were replaced (#249).
  const was = {
    web: 'ustabasi divan shell board overview machine drive dictate refusal fleet steps inventory approval notice asking usage newchat chattitle chatproject screen term sidebarhead topbar nav',
    'web-ui': 'divan theme ticket wall actions walk notice icons asking filed usage brand chathead chatproject composer sidebarhead',
    app: 'chat-list chat-flows ustabasi codex-input brand screen term autoarchive',
  };
  for (const [suite, names] of Object.entries(was)) {
    const cwd = suite === 'app' ? join(root, 'app') : web;
    const ext = suite === 'app' ? 'cjs' : 'mjs';
    const listed = new Set(run([suite, '--list'], cwd).out.trim().split('\n'));
    const missing = names.split(' ').map((n) => `test-${n}${suite === 'web-ui' ? '-ui' : ''}.${ext}`).filter((n) => !listed.has(n));
    check(`\`${suite}\` still runs every file its old chain ran`, missing.length === 0, missing.join(' '));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail.split('\n').join('\n        ')}`}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`all ${checks.length} checks passed`);
