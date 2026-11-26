#!/usr/bin/env node
/** Where a sign-in stands, whatever order the computer's two voices arrive in.
 *
 *     cd web && npm test
 *
 *  `lib/signin.ts` on its own. The sheet that draws it sends two requests and
 *  hears two events, and the computer does not wait for one before sending the
 *  other: a key is settled inside the request, so `account.login.done` comes
 *  down the socket before the answer to `account.login` does. The sheet took
 *  that answer as "now wait for a page" and stayed on a spinner over an
 *  account that was already signed in (26 Nov 2026) — the first group here.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'signin');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  · ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}
function group(name) { console.log(`── ${name}`); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules', '.bin', 'tsc'), [
  'src/lib/signin.ts', 'src/vite-env.d.ts',
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
const { START, step, inFlight, looksLikeEmailCode, sameSignIn } = await import(pathToFileURL(join(out, 'src/lib/signin.js')));

const walk = (...steps) => steps.reduce(step, START);
const page = (more = {}) => ({ type: 'prompt', prompt: {
  account_id: 'a1', provider: 'claude', url: 'https://claude.ai/oauth/authorize?x', url_host: 'claude.ai',
  code: null, needs_code: true, expires_at: 1_791_000_900, ...more } });

group('a sign-in the computer settles inside the request');
{
  // The order the daemon sends them in for a key: done, then the answer.
  const s = walk({ type: 'start', key: true }, { type: 'done', ok: true, detail: 'api key' },
    { type: 'started', needsCode: false });
  ok('done before the answer still ends on done', s.stage === 'done' && s.ok && s.detail === 'api key', JSON.stringify(s));
  const late = walk({ type: 'start', key: false }, { type: 'done', ok: true }, { type: 'started', needsCode: true });
  ok('…and a late answer that speaks of a code does not ask for one', late.stage === 'done', late.stage);
  ok('a key is being checked from the moment it is sent, with no page to prepare',
    walk({ type: 'start', key: true }).stage === 'finishing');
  const refused = walk({ type: 'start', key: true }, { type: 'done', ok: false, why: 'that key was refused' });
  ok('a key the computer refuses says why', refused.stage === 'done' && !refused.ok && refused.problem === 'that key was refused');
}

group('a sign-in on a page, with a code to bring back');
{
  const waiting = walk({ type: 'start', key: false });
  ok('Start waits for the page', waiting.stage === 'waiting' && inFlight(waiting));
  const asked = walk({ type: 'start', key: false }, { type: 'started', needsCode: true }, page());
  ok('the answer and the prompt, in that order, ask for the code', asked.stage === 'code' && !!asked.prompt?.url);
  const other = walk({ type: 'start', key: false }, page(), { type: 'started', needsCode: true });
  ok('…and in the other order', other.stage === 'code' && !!other.prompt?.url);
  const sent = step(asked, { type: 'submit' });
  ok('once the code is sent the sheet is finishing, not still asking', sent.stage === 'finishing' && inFlight(sent));
  ok('a prompt that repeats after that does not ask for the code again',
    step(sent, page()).stage === 'finishing');
  const unsent = step(sent, { type: 'unsent', why: 'that is not the authorization code' });
  ok('a code the computer would not take leaves the field open, with the reason',
    unsent.stage === 'code' && unsent.problem === 'that is not the authorization code');
  const done = step(sent, { type: 'done', ok: true, detail: 'you@example.com' });
  ok('done says who is signed in, and nothing is in flight', done.stage === 'done' && done.ok
    && done.detail === 'you@example.com' && !inFlight(done));
  ok('…and it stays done whatever arrives after', step(step(done, page()), { type: 'unsent', why: 'x' }).stage === 'done');
  const failed = step(sent, { type: 'done', ok: false, why: 'signed in as a@x, not b@x' });
  ok('a sign-in that failed says why', failed.stage === 'done' && !failed.ok && failed.problem === 'signed in as a@x, not b@x');
  ok('Try again starts from the top', step(failed, { type: 'again' }).stage === 'method'
    && step(failed, { type: 'again' }).problem === null);
}

group('a sign-in with nothing to paste back');
{
  const device = walk({ type: 'start', key: false }, { type: 'started', needsCode: false },
    page({ needs_code: false, code: 'ABCD-1234' }));
  ok('a one-time code is shown while the sheet waits', device.stage === 'waiting' && device.prompt?.code === 'ABCD-1234');
  ok('the sheet cannot send a code nobody asked for', step(device, { type: 'submit' }).stage === 'waiting');
}

group('a request the computer refuses');
{
  const s = walk({ type: 'start', key: false }, { type: 'refused', why: 'too many sign-ins are already in progress' });
  ok('goes back to the start with the reason', s.stage === 'method' && s.problem === 'too many sign-ins are already in progress'
    && !inFlight(s));
}

group('the e-mailed code');
{
  ok('six digits look like it', looksLikeEmailCode('123456') && looksLikeEmailCode(' 123 456 '));
  ok('the page’s own code does not', !looksLikeEmailCode('abcdef-123456#state') && !looksLikeEmailCode(''));
}

group('a sign-in that came back as an account the computer already has');
{
  const others = [{ detail: 'work@example.com', name: 'Work' }, { detail: 'Logged in using ChatGPT', name: 'Codex one' }];
  ok('the same address is the same account, whatever its case', sameSignIn('Work@Example.com ', others)?.name === 'Work');
  ok('another address is another account', sameSignIn('home@example.com', others) === null);
  ok('words that are not an address never match: Codex says the same of every sign-in',
    sameSignIn('Logged in using ChatGPT', others) === null && sameSignIn('', others) === null);
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('ok — a sign-in, in any order');
