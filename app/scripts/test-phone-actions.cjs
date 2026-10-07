/** The phone's actions no other check presses, pressed: each control on a screen
 *  that came over from main, driven to the store call (and so the daemon
 *  request) it makes. Cited by docs/divan-ui-migration.md.
 *
 *  Run: node scripts/test-phone-actions.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const every = require('./test-every-screen.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

// The app's own dialogs, answered: a confirmation by its destructive button, a
// prompt with a value.
const overlay = require('../src/components/overlay');
const DIALOGS = [];
overlay.alert = (title, message, buttons) => DIALOGS.push({ title, buttons: buttons ?? [] });
overlay.prompt = (o) => DIALOGS.push({ title: o.title, submit: o.submit });
const confirm = async () => {
  const d = DIALOGS.pop();
  if (!d) return false;
  // Where a screen goes after the call is the router's business, and the
  // harness's router is a stand-in that cannot dismiss a stack.
  const after = (e) => { if (!/dismissAll|is not a function/.test(String(e?.message))) throw e; };
  try {
    if (d.submit) await d.submit('Second');
    else await (d.buttons.find((b) => b.style === 'destructive') ?? d.buttons[d.buttons.length - 1])?.onPress?.();
  } catch (e) { after(e); }
  await flush();
  return true;
};

const METHODS = ['createAccount', 'renameAccount', 'logoutAccount', 'deleteAccount', 'installTool', 'removeAgent',
  'setPool', 'setDefaults', 'updateChat', 'deleteChat', 'createChat', 'setDevicePrefs', 'switchHost', 'removeHost',
  'createGroup', 'renameGroup', 'deleteGroup', 'setShowArchived', 'checkUpdate', 'applyUpdate', 'refreshHost'];
let calls = [];
function stand(params) {
  machine.stand({ params });
  calls = [];
  const rec = Object.fromEntries(METHODS.map((m) => [m, async (...args) => { calls.push([m, args]); return { id: 'n1' }; }]));
  R.store.set({
    ...rec,
    agents: [{ id: 'user:reviewer', name: 'reviewer', label: 'Reviewer', installed: true, scope: 'user', path: '/x' }],
    agentsLoaded: true, loadAgents: async () => {}, storeSources: [], storeLoaded: true, loadStore: async () => {},
    pool: { enabled: false, threshold: 0.9 }, poolAccounts: [], loadPool: async () => {},
    tools: [{ provider: 'claude', version: '1.2.4', path: '/usr/local/bin/claude', login_methods: [{ id: 'subscription' }] },
            { provider: 'codex', version: null, path: null, login_methods: [] }],
    loadTools: async () => {}, updateStatus: { repo: true, behind: 2, ahead: 0, busy: false, auto: false },
  });
}
const screen = (file, params) => {
  stand(params);
  const S = require(path.join(root, 'app', file)).default;
  return R.render('dark', h(S, params ?? {}));
};
const press = async (pred) => {
  const p = R.presses().find(typeof pred === 'string' ? (x) => x.text === pred || x.label === pred : pred);
  if (!p) return false;
  p.press();
  await flush();
  return true;
};
/** The newest menu a press opened: its item with these words, chosen. */
const choose = async (words) => {
  const m = R.menus.last();
  const item = (m?.items ?? []).find((i) => (i.label ?? i.title ?? '').startsWith(words));
  if (!item) return false;
  (item.onPress ?? item.onSelect)?.();
  await flush();
  return true;
};
const made = (name, pred = () => true) => calls.some(([m, a]) => m === name && pred(...a));

const checks = [];
const ready = (async () => {
  await every.ready;
  R.words.real();

  // Accounts: add, rename, sign out, delete, and the missing tool's install.
  screen('accounts.tsx');
  await press('Add Claude account');
  await confirm();
  const added = made('createAccount', (p, label) => p === 'claude' && label === 'Second');
  const flow = {};
  for (const [item, method] of [['Rename', 'renameAccount'], ['Sign out', 'logoutAccount'], ['Delete', 'deleteAccount']]) {
    screen('accounts.tsx');
    R.menus.reset();
    // The second account: the computer's own one cannot be renamed or deleted.
    const opened = await press((p, i, all) => p.label === 'Account' && all.slice(0, i).some((q) => q.label === 'Account'));
    const chose = opened && await choose(item);
    if (chose && DIALOGS.length) await confirm();
    flow[item] = made(method);
  }
  checks.push([`phone: Accounts adds (createAccount), renames, signs out and deletes an account from its menu — ${JSON.stringify({ added, ...flow })}`,
    added && flow.Rename && flow['Sign out'] && flow.Delete]);

  // Agents: an installed agent is removed from its menu.
  screen('agents.tsx');
  const held = R.holds().find((x) => x.text.startsWith('Reviewer'));
  if (held) { held.hold(); await flush(); await confirm(); }
  checks.push(['phone: holding an installed agent asks, then removes it (removeAgent)', made('removeAgent', (n) => n === 'reviewer')]);

  // Pool: the switch turns it on.
  screen('pool.tsx');
  await press((p) => p.text === '' && !p.label);
  checks.push(['phone: the pool switch writes setPool', made('setPool', (d) => d.enabled === true)]);

  // Chat settings: Save writes updateChat; Delete chat asks and deletes.
  screen('chat-settings.tsx', { id: 'c1' });
  await press('Sonnet 5');
  await press('Save');
  const saved = made('updateChat');
  screen('chat-settings.tsx', { id: 'c1' });
  await press('Delete chat');
  await confirm();
  checks.push(['phone: chat settings save through updateChat and Delete chat asks, then deleteChat',
    saved && made('deleteChat', (id) => id === 'c1')]);

  // The full chat list (Earlier): archive and delete from a row.
  screen('chat/index.tsx', { all: '1' });
  await press('Archive');
  const shown = made('setShowArchived');
  screen('chat/index.tsx', { all: '1' });
  await press((p, i, all) => p.text === 'Archive' && all.slice(0, i).some((q) => q.text === 'Archive'));
  const archived = shown && made('updateChat', (id, f) => !!f && 'archived' in f);
  screen('chat/index.tsx', { all: '1' });
  await press('Delete');
  await confirm();
  checks.push(['phone: under Earlier the archive opens (setShowArchived), a row archives (updateChat) and deletes (deleteChat, after asking)',
    archived && made('deleteChat')]);

  // Groups: made from the list's view menu, renamed and deleted from a heading's.
  screen('chat/index.tsx', { all: '1' });
  R.menus.reset();
  await press('Flat');
  const grouped = await choose('New group') && await confirm() && made('createGroup', (n) => n === 'Second');
  machine.stand({ params: { all: '1' } });
  R.store.set({ prefs: { chatView: 'grouped', voiceIds: {} }, groups: [{ id: 'g1', name: 'Quire', sort: 0 }],
    chats: { c1: { id: 'c1', group_id: 'g1', title: 'Refunds', provider: 'claude', model: 'opus',
      effort: 'high', perm_mode: 'default', cwd: '/r/quire', status: 'idle', last_preview: 'ok', pinned: 0, archived: 0,
      created_at: 0, updated_at: Math.floor(Date.now() / 1000) - 60 } } });
  const rec = (m) => async (...args) => { calls.push([m, args]); };
  R.store.set({ renameGroup: rec('renameGroup'), deleteGroup: rec('deleteGroup') });
  const Chats = require(path.join(root, 'app/chat/index.tsx')).default;
  const heads = () => R.holds().filter((x) => x.text.startsWith('Quire'));
  R.render('dark', h(Chats, { all: '1' }));
  R.menus.reset();
  if (heads()[0]) { heads()[0].hold(); await flush(); }
  const renamed = await choose('Rename') && await confirm() && made('renameGroup', (id, n) => id === 'g1' && n === 'Second');
  R.render('dark', h(Chats, { all: '1' }));
  R.menus.reset();
  if (heads()[0]) { heads()[0].hold(); await flush(); }
  const removed = await choose('Delete') && await confirm() && made('deleteGroup', (id) => id === 'g1');
  checks.push([`phone: a group is made (createGroup), renamed (renameGroup) and deleted (deleteGroup) from the chat list — ${JSON.stringify({ grouped, renamed, removed })}`,
    grouped && renamed && removed]);

  // Settings: notifications, the default model, and removing a computer.
  screen('settings.tsx');
  await press((p) => p.label === 'Approval requests');
  const prefs = made('setDevicePrefs');
  screen('settings.tsx');
  R.menus.reset();
  await press((p) => p.text.startsWith('Default model'));
  const model = await choose('Sonnet') && made('setDefaults');
  screen('settings.tsx');
  await press("Revoke this device's access");
  await confirm();
  const revoked = made('removeHost');
  checks.push([`phone: Settings writes setDevicePrefs, the default model through setDefaults, and Revoke removes the computer — ${JSON.stringify({ prefs, model, revoked })}`,
    prefs && model && revoked]);

  // The computer picker switches the phone to another computer.
  screen('host-sheet.tsx');
  await press((p) => p.text.startsWith('mini'));
  checks.push(['phone: the computer picker switches computer (switchHost)', made('switchHost', (id) => id === 'h2')]);

  // A new chat with every option still starts one.
  screen('new-chat.tsx');
  await press('Start chat');
  checks.push(['phone: New chat with every option starts one through createChat', made('createChat')]);
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    process.exit(bad ? 1 : 0);
  });
}
