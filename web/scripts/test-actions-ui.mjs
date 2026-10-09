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
  // A computer whose socket the harness holds, so the daemon's own narration of
  // a restart can be sent down it.
  await b.evaluate(`window.__fleet.getState().addHost({ host: '127.0.0.1', port: 9999, token: 't', name: 'spare' });
    await new Promise((r) => setTimeout(r, 400));`);
  await press('Restart', 'button', true);
  await b.evaluate(`window.__emit('daemon.restarting', { state: 'draining', pending: [{ chat_id: 'c2', busy: true, queued: 0 }] });
    await new Promise((r) => setTimeout(r, 300));`);
  const drained = await press('Cancel', 'button', true);
  ok('a restart that is waiting on work can be called off: Cancel sends daemon.restart.cancel',
    drained && await sent('daemon.restart.cancel'), JSON.stringify({ drained }));

  console.log('── Machine › Machines › Remote screen and Folders');
  await b.cold('/machine/screen');
  const info = await sent('screen.info');
  const control = await press('Take control') && await sent('screen.enable', (d) => d.enabled === true);
  ok('the remote screen asks screen.info and Take control sends screen.enable', info && control, JSON.stringify({ info, control }));
  const connected = await press('Connect');
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));`);
  ok('connected and in control, a key pressed on the page goes to the computer as screen.input',
    connected && await sent('screen.input', (d) => JSON.stringify(d.actions).includes('enter')), JSON.stringify({ connected }));
  // The picture itself is asked of a computer that is not there.
  b.drain();
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
  const coded = signIn && await type('the code from the page', 'abcdef-123456');
  const verified = coded && await press('Verify')
    && await sent('account.login.submit', (d) => d.code === 'abcdef-123456');
  const cancelled = await press('Cancel') && await sent('account.login.cancel');
  ok('Sign in sends account.login, the code goes as account.login.submit, and leaving the sheet sends account.login.cancel',
    signIn && verified && cancelled, JSON.stringify({ signIn, coded, verified, cancelled }));

  console.log('── the keyboard, the palette and the chat window');
  const key = (k) => b.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, metaKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));`);
  await b.cold('/');
  await key('f');
  const searching = await b.evaluate(`return location.pathname.startsWith('/chats') && document.activeElement?.name === 'chat-search';`);
  await key('b');
  const railed = await b.evaluate(`return localStorage.getItem('rac.sidebar') === 'rail';`);
  ok('⌘F opens the chat list with its search focused, and ⌘B folds the list to a rail', searching && railed,
    JSON.stringify({ searching, railed }));
  await b.cold('/');
  await key('k');
  const stopAll = await press('Stop every session', '*')
    && await sent('chat.interrupt', (d) => d.chat_id === 'c2');
  await key('k');
  const everyBefore = await b.evaluate(`return document.body.textContent.includes('Show every computer');`);
  await press('Show every computer', '*');
  await key('k');
  const everyAfter = await b.evaluate(`return document.body.textContent.includes('Show one computer');`);
  ok('the palette still stops every running session (chat.interrupt) and shows every computer',
    stopAll && everyBefore && everyAfter, JSON.stringify({ stopAll, everyBefore, everyAfter }));
  await b.cold('/chats/c1');
  await b.evaluate(`window.open = (u) => { window.__opened = u; return null; };`);
  await press('Details');
  await press('Open in a new window');
  const popped = await b.evaluate(`return window.__opened || '';`);
  ok('a chat still opens in a window of its own from Details', /\?host=studio&chat=c1$/.test(popped), popped);

  console.log('── Machine › Machines and Sessions');
  await b.cold('/machine/fleet');
  const stopped = await press('Stop') && await sent('chat.interrupt', (d) => d.chat_id === 'c2');
  ok('Sessions and plan limits stops a running turn (chat.interrupt)', stopped);
  await b.cold('/machine/machines');
  b.drain();
  const paired = await type('divan://pair?host=…', 'divan://pair?host=127.0.0.1&port=9&token=t0k3n&name=laptop')
    && await press('Pair')
    && await b.evaluate(`return JSON.parse(localStorage.getItem('rac.hosts') || '[]').some((h) => h.name === 'laptop' && h.port === 9);`);
  ok('a pairing link pasted on Machines adds that computer to the panel', paired);
  // The computer just paired does not exist, and a refused socket is what the
  // browser logs about it.
  b.drain();

  const bad = b.drain();
  ok('no console errors on the way', !bad.length, bad.join('\n    '));
} finally {
  b.close();
}
process.exit(done());
