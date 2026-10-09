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

const METHODS = ['setPrefs', 'authenticate', 'installAgent', 'createAccount', 'renameAccount', 'logoutAccount', 'deleteAccount', 'installTool', 'removeAgent',
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
    agentsLoaded: true, loadAgents: async () => {}, storeLoaded: true, loadStore: async () => {},
    pool: { enabled: false, threshold: 0.9 }, poolAccounts: [], loadPool: async () => {},
    tools: [{ provider: 'claude', version: '1.2.4', path: '/usr/local/bin/claude', login_methods: [{ id: 'subscription' }] },
            { provider: 'codex', version: null, path: null, login_methods: [] }],
    loadTools: async () => {}, updateStatus: { repo: true, behind: 2, ahead: 0, busy: false, auto: false,
      local: { commit: 'a1b2c3d' }, remote: { commit: 'e4f5a6b' } },
    storeSources: [{ id: 'src', label: 'src', repo: 'x/y', note: '', items: [
      { id: 'src:reviewer', kind: 'agent', label: 'Reviewer', glyph: 'R', color: '#777777', repo: 'x/y' }] }],
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

  // Daily: the move sheet's Daily row takes a chat out of its group and the
  // product the computer filed it under, and a chat put there is listed there
  // rather than under the folder it works in.
  const chat = (id, cwd, more) => ({ id, group_id: null, title: id, provider: 'claude', model: 'opus',
    effort: 'high', perm_mode: 'default', cwd, status: 'idle', last_preview: 'ok', pinned: 0, archived: 0,
    created_at: 0, updated_at: Math.floor(Date.now() / 1000) - 60, ...more });
  machine.stand({ params: { all: '1' } });
  R.store.set({ prefs: { chatView: 'grouped', voiceIds: {} }, groups: [{ id: 'g1', name: 'Quire', sort: 0 }],
    chats: { c1: chat('Refunds', '/r/quire', { id: 'c1', group_id: 'g1', project_id: 'p1', project_set: 0 }),
             c2: chat('Pricing', '/r/hush'), c3: chat('Mail search', '/r/mailbox', { project_id: '', project_set: 1 }) },
    updateChat: rec('updateChat') });
  const replaced = [];
  const realReplace = overlay.replaceMenu;
  overlay.replaceMenu = (items) => { replaced.push(items); };
  const markup = R.render('dark', h(Chats, { all: '1' }));
  R.menus.reset();
  const row = R.holds().find((x) => x.text.startsWith('Refunds'));
  if (row) { row.hold(); await flush(); }
  await choose('Move to group');
  const daily = (replaced.at(-1) ?? []).find((i) => i.label === 'Daily');
  daily?.onPress?.();
  await flush();
  overlay.replaceMenu = realReplace;
  const sent = calls.filter(([m]) => m === 'updateChat').map(([, a]) => a);
  const listed = markup.indexOf('>Daily<') >= 0 && !markup.includes('/r/mailbox') && markup.includes('Mail search');
  checks.push([`phone: Daily in the move sheet sends updateChat with group_id null and project_id '', and a chat put in Daily is listed under Daily — ${JSON.stringify({ sent, listed })}`,
    sent.length === 1 && sent[0][0] === 'c1' && sent[0][1].group_id === null && sent[0][1].project_id === '' && listed]);

  // Placement, read the way the web's sidebar reads it: a group that exists,
  // then the product the chat is saved under (by name, or by id through the
  // board), and only then the folder or Daily. Never the title.
  {
    const { chatSections } = require(path.join(root, 'src/chat-sections.ts'));
    const FREYA = '62d17d0a16ab';
    const fixture = () => ({
      freya: chat('Judging rubric', '/Users/x/projects/freya-agent', { id: 'freya', project_id: FREYA, project: 'Freya Hackathon' }),
      // Only the id came with it: the name is the board's.
      pitch: chat('Pitch deck', '/Users/x/projects/scratch', { id: 'pitch', project_id: FREYA, project: null }),
      reel: chat('Reel notes', '/Users/x/projects/DevTrace-main', { id: 'reel', project_id: 'pdivan', project: 'Divan' }),
      ledger: chat('Ledger fix', '/r/quire', { id: 'ledger', group_id: 'g1', project_id: FREYA, project: 'Freya Hackathon' }),
      orphan: chat('Orphan', '/r/hush', { id: 'orphan', group_id: 'gone' }),
      mail: chat('Mail search', '/r/mailbox', { id: 'mail', project_id: '', project_set: 1 }),
      decoy: chat('Divan pitch', '/r/alpha', { id: 'decoy' }),
    });
    const quire = { id: 'g1', name: 'Quire', sort: 0 };
    const stage = (chats, groups, view = 'grouped') => {
      machine.stand({ params: { all: '1' } });
      R.store.set({ prefs: { chatView: view, voiceIds: {} }, groups, chats, updateChat: rec('updateChat'),
        divan: { h1: { at: 0, reachable: true, error: null, old: false, snapshot: { machine: 'studio', at: 0, quota: null, queue: {}, activity: {},
          projects: [{ id: FREYA, name: 'Freya Hackathon', slug: 'freya', summary: '' }, { id: 'pdivan', name: 'Divan', slug: 'divan', summary: '' }],
          cards: [], agents: [] } } } });
      R.render('dark', h(Chats, { all: '1' }));
    };
    // Heading → the chats drawn under it, off what the render left holdable:
    // a row starts with its chat's title, and anything else held is a heading
    // (its title, then its count).
    const layout = () => {
      const at = {}; let cur = null;
      for (const { text } of R.holds()) {
        const row = Object.values(fixture()).find((c) => text.startsWith(c.title));
        if (row) (at[cur] ||= []).push(row.title);
        else if (text) cur = text.replace(/\d+$/, '');
      }
      return at;
    };
    const once = (at) => Object.values(fixture()).every((c) => Object.values(at).flat().filter((t) => t === c.title).length === 1);

    stage(fixture(), [quire]);
    const a = layout();
    const products = a['Freya Hackathon']?.join() === 'Judging rubric,Pitch deck' && a.Divan?.join() === 'Reel notes'
      && !a['~/projects/DevTrace-main'] && a['/r/alpha']?.join() === 'Divan pitch';
    checks.push([`phone: a Freya chat is listed under Freya Hackathon (by name, and by id through the board) and a Divan chat opened in DevTrace-main under Divan, never by title — ${JSON.stringify(a)}`,
      products && once(a)]);

    const merged = { id: 'g2', name: 'divan', sort: 1 };
    stage(fixture(), [quire, merged]);
    const b = layout();
    const headings = R.holds().filter((x) => /^divan\d+$/i.test(x.text)).length;
    const rules = a.Quire?.join() === 'Ledger fix' && b.divan?.join() === 'Reel notes' && headings === 1
      && a['/r/hush']?.join() === 'Orphan' && a.Daily?.join() === 'Mail search';
    checks.push([`phone: an existing group wins over the product, a product shares the heading of a group with its name, a deleted group's chat falls to its folder, and no chat is listed twice — ${JSON.stringify({ a, b, headings })}`,
      rules && once(a) && once(b)]);

    // Search and the flat view answer with the same conversations.
    const ids = (s) => s.flatMap((x) => x.data.map((c) => c.id)).sort().join();
    const read = (q, flat) => chatSections({ chats: fixture(), groups: [quire], productNames: { [FREYA]: 'Freya Hackathon' }, q, collapsed: {},
      showArchived: false, flat, daily: 'Daily', only: 'Chats' });
    const same = ['', 'notes', 'pitch', 'ok'].every((q) => ids(read(q, true)) === ids(read(q, false)))
      && ids(read('pitch', false)) === 'decoy,pitch';
    stage(fixture(), [quire], 'flat');
    const flatRows = R.holds().filter((x) => Object.values(fixture()).some((c) => x.text.startsWith(c.title))).length;
    checks.push([`phone: the flat view and every search list the same conversations grouped or not — ${JSON.stringify({ same, flatRows })}`,
      same && flatRows === Object.keys(fixture()).length]);

    // A row opens its own chat; Daily takes a product's chat out of it; and the
    // computer's echo (`chat.updated`, which replaces the one record) moves the
    // row rather than copying it.
    stage(fixture(), [quire]);
    R.nav.reset();
    await press((p) => (p.text ?? '').startsWith('Reel notes'));
    const opened = R.nav.pushed().includes('/chat/reel');
    calls = [];
    R.menus.reset();
    const held = R.holds().find((x) => x.text.startsWith('Reel notes'));
    const sheets = [];
    const realReplace = overlay.replaceMenu;
    overlay.replaceMenu = (items) => { sheets.push(items); };
    if (held) { held.hold(); await flush(); }
    await choose('Move to group');
    (sheets.at(-1) ?? []).find((i) => i.label === 'Daily')?.onPress?.();
    await flush();
    overlay.replaceMenu = realReplace;
    const moved = calls.filter(([m]) => m === 'updateChat').map(([, x]) => x);
    const live = fixture();
    live.reel = { ...live.reel, group_id: null, project_id: '', project: null, project_set: 1 };
    live.decoy = { ...live.decoy, project_id: FREYA, project: 'Freya Hackathon' };
    stage(live, [quire]);
    const c = layout();
    const echoed = c.Daily?.includes('Reel notes') && !c.Divan && c['Freya Hackathon']?.includes('Divan pitch') && !c['/r/alpha'];
    checks.push([`phone: a row opens its chat, Daily sends updateChat with group_id null and project_id '', and a live update moves the row without a copy — ${JSON.stringify({ opened, moved, c })}`,
      opened && moved.length === 1 && moved[0][0] === 'reel' && moved[0][1].group_id === null && moved[0][1].project_id === ''
        && echoed && once(c)]);
  }

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

  // Software update, an agent from the store, the model sheet, and the way to
  // move a sign-in over from another computer.
  screen('settings.tsx');
  await press((p) => p.label === 'Face ID on launch');
  const on = made('setPrefs', (p) => p.faceIdLaunch === true);
  screen('settings.tsx');
  R.store.set({ prefs: { chatView: 'flat', voiceIds: {}, faceIdLaunch: true } });
  R.render('dark', h(require(path.join(root, 'app/settings.tsx')).default, {}));
  await press((p) => p.label === 'Face ID on launch');
  const off = made('authenticate') && made('setPrefs', (p) => p.faceIdLaunch === false);
  checks.push(['phone: Face ID on launch is written with setPrefs, and turning it off asks Face ID first', on && off]);
  screen('settings.tsx');
  await press('Update now');
  const updated = made('applyUpdate');
  screen('agent-install.tsx', { id: 'src:reviewer' });
  await press('Install Reviewer');
  const installed = made('installAgent', (id) => id === 'src:reviewer');
  screen('model-sheet.tsx');
  await press('Sonnet 5');
  const sheet = made('setDefaults', (d) => d.model === 'sonnet');
  screen('accounts.tsx');
  R.nav.reset();
  await press('Move from another computer');
  const moving = R.nav.pushed().some((to) => (typeof to === 'string' ? to : to?.pathname) === '/move-signin');
  checks.push([`phone: Update now sends applyUpdate, Install sends installAgent, the model sheet writes setDefaults, and Move a sign-in is one press from Accounts — ${JSON.stringify({ updated, installed, sheet, moving })}`,
    updated && installed && sheet && moving]);

  // What the queue sent (main, after the handover): the Dashboard's Inbox row
  // counts it and opens the list, a notice opens its ticket, and that page
  // mounts the Report the computer reads back. The harness renders once and
  // runs no effects, so the last is read off the source.
  {
    const { useInbox } = require(path.join(root, 'src/inbox.ts'));
    const fs = require('fs');
    stand();
    // A static render reads a zustand store's initial state, so the notice is
    // put there for the length of this check.
    const initial = useInbox.getInitialState();
    const before = { ...initial };
    Object.assign(initial, { host: 'studio', seen: 8, last: 9, items: [{ id: 9, ticket: 42, ts: Date.now() / 1000 - 60,
      kind: 'done', headline: '', body: 'Live keys are in.', title: 'Stripe keys', status: 'done', project: 'Quire' }] });
    R.nav.reset();
    const dash = R.render('dark', h(require(path.join(root, 'app/dashboard.tsx')).default));
    const counted = /Inbox/.test(dash) && /1 new/.test(dash);
    const row = await press((x) => (x.text ?? '').startsWith('Inbox'));
    const listed = R.nav.pushed().some((to) => (typeof to === 'string' ? to : to?.pathname) === '/inbox');
    screen('inbox.tsx');
    R.nav.reset();
    const notice = await press((x) => (x.text ?? '').startsWith('Stripe keys'));
    const opened = R.nav.pushed().some((to) => to === '/ticket/42');
    const mounted = /<Report id=\{t\.id\} status=\{t\.status\} \/>/.test(fs.readFileSync(path.join(root, 'app/ticket/[id].tsx'), 'utf8'))
      && /ticketReport\(id\)/.test(fs.readFileSync(path.join(root, 'src/components/report.tsx'), 'utf8'));
    Object.assign(initial, before);
    checks.push([`phone: the Dashboard's Inbox row counts what the queue sent and opens the list, a notice opens its ticket, and the ticket page mounts its Report — ${JSON.stringify({ counted, row, listed, notice, opened, mounted })}`,
      counted && row && listed && notice && opened && mounted]);
  }

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
