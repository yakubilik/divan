#!/usr/bin/env node
/** The test runner for web/ and app/: finds the test files by name and runs them.
 *
 *     cd web && npm test           # node ../scripts/run-tests.mjs web
 *     cd web && npm run test:ui    # node ../scripts/run-tests.mjs web-ui
 *     cd app && npm test           # node ../scripts/run-tests.mjs app
 *
 *  A test is added by adding a file to the package's scripts/ whose name the
 *  suite matches — never by editing package.json. Those lines used to be one
 *  hand-kept `node scripts/test-x && ...` chain each, and every two tickets that
 *  added a test conflicted on it.
 *
 *  The files run one after another, in name order, each in its own `node`, from
 *  the package directory (where npm runs scripts). Each name is printed before it
 *  runs; the first failure stops the run, is named, and its exit code is ours.
 *
 *  Flags:  --dir <path>  read the test files from <path> instead of ./scripts
 *          --list        print the files that would run, and run nothing
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SUITES = {
  // Everything that runs without a browser; the -ui files are `test:ui`.
  web: { match: /^test-.*\.mjs$/, except: /-ui\.mjs$/ },
  'web-ui': { match: /^test-.*-ui\.mjs$/ },
  app: {
    match: /^test-.*\.cjs$/,
    // Not run on their own: each is a module `test-ustabasi.cjs` requires and
    // folds into its own run (look for `require('./test-…')` there), so running
    // it again here would only repeat it — and the voice ones would start a
    // second isolated daemon. A file `test-ustabasi.cjs` stops folding in
    // leaves this list and is run on its own.
    skip: [
      'test-board.cjs',
      'test-call-chat.cjs',
      'test-call-live.cjs',
      'test-call-pickup.cjs',
      'test-card.cjs',
      'test-composer.cjs',
      'test-dashboard.cjs',
      'test-divan-merge.cjs',
      'test-divan-screens.cjs',
      'test-divan.cjs',
      'test-drag.cjs',
      'test-ema.cjs',
      'test-every-screen.cjs',
      'test-fresh-chat.cjs',
      'test-handover-machine.cjs',
      'test-handover-project.cjs',
      'test-handover-ticket.cjs',
      'test-machine-switch.cjs',
      'test-machine.cjs',
      'test-new-ticket.cjs',
      'test-notice.cjs',
      'test-phone-actions.cjs',
      'test-project.cjs',
      'test-shell.cjs',
      'test-tts.cjs',
      'test-voice-session.cjs',
      'test-voicenote.cjs',
      'test-waiting.cjs',
      'test-ws.cjs',
    ],
  },
};

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
const suite = SUITES[name];
if (!suite) {
  console.error(`usage: run-tests.mjs <${Object.keys(SUITES).join('|')}> [--dir <path>] [--list]`);
  process.exit(2);
}
const dirAt = args.indexOf('--dir');
const dir = resolve(dirAt >= 0 ? args[dirAt + 1] : 'scripts');
const skip = new Set(suite.skip ?? []);

const files = readdirSync(dir)
  .filter((f) => suite.match.test(f) && !(suite.except && suite.except.test(f)) && !skip.has(f))
  .sort();

if (args.includes('--list')) {
  for (const f of files) console.log(f);
  process.exit(0);
}
if (files.length === 0) {
  // A suite that matches nothing is a broken pattern or a wrong directory, not a pass.
  console.error(`run-tests: no ${name} tests in ${dir}`);
  process.exit(1);
}

for (const [i, f] of files.entries()) {
  const file = join(dir, f);
  const shown = relative(process.cwd(), file) || file;
  console.log(`\n▶ [${i + 1}/${files.length}] ${shown}`);
  const run = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (run.status !== 0) {
    const why = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit ${run.status}`;
    console.error(`\n✗ run-tests: ${shown} failed (${why}); ${files.length - i - 1} not run`);
    process.exit(run.status || 1);
  }
}
console.log(`\n✓ run-tests: ${files.length} ${name} test files passed`);
