#!/usr/bin/env node
/** The calls no other check presses for, pressed in the built panel: the pages
 *  of the Machine place that came over from main unchanged, driven to the
 *  request each of their buttons sends. Cited by docs/divan-ui-migration.md.
 *
 *     CHROME=/path/to/chrome node scripts/test-actions-ui.mjs
 */
import { checker, launch } from './walk-browser.mjs';

const { ok, done } = checker();
const b = await launch('actions');
await b.size(1440, false);

/** The first button with these words — or the last, which is the one a
 *  confirmation that has just opened over the page holds. */
const press = async (text, css = 'button', last = false) => {
  const found = await b.evaluate(`
    const all = [...document.querySelectorAll(${JSON.stringify(css)})].filter((e) => !e.disabled
      && (e.textContent || e.getAttribute('aria-label') || '').trim() === ${JSON.stringify(text)});
    const el = ${last} ? all.pop() : all[0];
    if (!el) return false; el.click(); await new Promise((r) => setTimeout(r, 350)); return true;`);
  return found;
};
const type = (placeholder, words) => b.evaluate(`
  const el = document.querySelector('[placeholder=${JSON.stringify(placeholder)}]');
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  set.call(el, ${JSON.stringify(words)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150)); return true;`);
const asked = () => b.evaluate('return window.__asked.map((a) => ({ type: a.type, data: a.data }));');
const sent = async (type, pred = () => true) => (await asked()).some((a) => a.type === type && pred(a.data));

try {
  console.log('── Machine › Machines › Update');
  await b.cold('/machine/update');
  const status = await sent('update.status');
  const updated = await press('Update') && await sent('update.apply');
  const restarted = await press('Restart') && await sent('daemon.restart', (d) => d.force === false);
  ok('the update page asks update.status, Update sends update.apply and Restart sends daemon.restart',
    status && updated && restarted, JSON.stringify({ status, updated, restarted }));

  console.log('── Machine › Machines › Remote screen and Folders');
  await b.cold('/machine/screen');
  const info = await sent('screen.info');
  const control = await press('Take control') && await sent('screen.enable', (d) => d.enabled === true);
  ok('the remote screen asks screen.info and Take control sends screen.enable', info && control, JSON.stringify({ info, control }));
  await b.cold('/machine/projects');
  ok('Folders asks the computer for host.git on its repositories', await sent('host.git'));

  console.log('── Machine › Executors › Agents');
  await b.cold('/machine/agents');
  const removing = await press('Remove');
  const confirmed = removing && await press('Remove', 'button', true);
  ok('an installed agent can be removed, which sends agent.remove with its name',
    await sent('agent.remove', (d) => d.name === 'reviewer'), JSON.stringify({ removing, confirmed }));

  console.log('── Machine › Settings › This computer › Accounts and Tools');
  await b.cold('/machine/preferences');
  await press('Accounts', 'nav button');
  const tools = await sent('tool.status');
  const typed = await type('e.g. Work, Second subscription', 'Second');
  const created = typed && await press('Add') && await sent('account.create', (d) => d.label === 'Second');
  ok('the accounts page reads tool.status, and Add sends account.create with the name typed',
    tools && created, JSON.stringify({ tools, typed, created }));
  const renamed = await press('Rename') && await type('Account name', 'Work') && await press('Save')
    && await sent('account.rename', (d) => d.label === 'Work');
  ok('Rename sends account.rename with the new name', renamed);
  const out = await press('Sign out') && await press('Sign out', 'button', true)
    && await sent('account.logout');
  ok('Sign out asks first, then sends account.logout', out);
  await b.cold('/machine/preferences');
  await press('Accounts', 'nav button');
  const signIn = await press('Sign in') && await press('Start') && await sent('account.login');
  const cancelled = await press('Cancel') && await sent('account.login.cancel');
  ok('Sign in sends account.login, and leaving the sheet sends account.login.cancel',
    signIn && cancelled, JSON.stringify({ signIn, cancelled }));

  const bad = b.drain();
  ok('no console errors on the way', !bad.length, bad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
