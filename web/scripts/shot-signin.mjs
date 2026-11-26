#!/usr/bin/env node
/** Pictures of Accounts, of a sign-in at each of its steps, and of Settings.
 *
 *     CHROME=/path/to/chrome node scripts/shot-signin.mjs [out-dir]
 *
 *  Not a check: what it leaves is what to look at after changing any of them.
 *  The sign-in is driven the way a person drives it — Sign in, Start, the code,
 *  Verify — and the computer's side is played by `window.__emit`. */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, web } from './walk-browser.mjs';

const out = resolve(process.argv[2] || join(web, '.test-build', 'signin-shot'));
mkdirSync(out, { recursive: true });
const b = await launch('signin-shot');
await b.size(1440, false);
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const press = (text) => b.evaluate(`
  const el = [...document.querySelectorAll('button')].find((e) => !e.disabled && (e.textContent || '').trim() === ${JSON.stringify(text)});
  if (el) el.click(); ${wait(350)} return !!el;`);
const type = (placeholder, words) => b.evaluate(`
  const el = document.querySelector('[placeholder=${JSON.stringify(placeholder)}]');
  if (!el) return false;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(words)});
  el.dispatchEvent(new Event('input', { bubbles: true })); ${wait(150)} return true;`);
const shot = async (name) => { const f = join(out, `${name}.png`); await b.shot(f, 1440, false); console.log(f); };

try {
  for (const page of ['settings', 'about', 'accounts']) {
    await b.cold(`/machine/${page}`);
    await shot(page);
  }
  // The sign-in, on a computer whose socket the harness holds.
  await b.evaluate(`window.__fleet.getState().addHost({ host: '127.0.0.1', port: 9999, token: 't', name: 'spare' });
    ${wait(500)}
    const s = window.__fleet.getState();
    s.setFocus(s.order.find((k) => s.hosts[k].cfg.name === 'spare'));
    ${wait(700)}`);
  await press('Sign in');
  await shot('signin-1-method');
  await press('Start');
  await b.evaluate(`window.__emit('account.login.prompt', { account_id: 'a3', provider: 'codex',
    url: 'https://claude.ai/oauth/authorize?x', url_host: 'claude.ai', code: null, needs_code: true,
    expires_at: Date.now() / 1000 + 900 }); ${wait(300)}`);
  await shot('signin-2-code');
  await type('the code from the page', 'abcdef-123456#state');
  await press('Verify');
  await shot('signin-3-finishing');
  await b.evaluate(`window.__emit('account.login.done', { account_id: 'a3', ok: true, detail: 'you@example.com' }); ${wait(300)}`);
  await shot('signin-4-done');
} finally {
  b.close();
}
process.exit(0);
