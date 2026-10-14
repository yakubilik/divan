/** Every chat flow on the phone does what the web panel's does (#222).
 *
 *  Both sides are the real thing, each asked the way its own screen asks it:
 *
 *   · the web: `ChatMenu.tsx` and `GroupDialogs.tsx` themselves, pressed in a
 *     test renderer, wired the way `App.tsx` and `Sidebar.tsx` wire them to the
 *     real `web/src/lib/actions.ts` — whose socket is the one thing stood in
 *     for, so what it would send the computer is written down;
 *   · the phone: the chat list (`app/chat/index.tsx`) and the New chat sheet
 *     (`app/new-chat.tsx`), pressed
 *     in the screen harness, over the real store (`src/store.ts`) whose socket
 *     client (`src/ws.ts`) writes down what it would send the same way.
 *
 *  Then, flow by flow: New chat (the pen is chat.create, the chat opens
 *  and is listed where the web lists it), a heading's
 *  + (the web's onNewChatIn: that folder, and that group), a chat's long-press
 *  menu (the web ChatMenu's entries in its order; rename, pin, archive, move to
 *  a group, to Daily and to a new group, delete with a confirm — each the same
 *  request with the same params), and a group's ... menu (rename and delete as
 *  the web's GroupMenu; the chats of a deleted group fall back to their
 *  product or folder heading, as on the web).
 *
 *  Run: node scripts/test-chat-flows.cjs
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const WEB = path.join(root, '..', 'web');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the web, loaded from its own source ─────────────────────────────────────
// Its components are drawn with the app's React (one React per renderer), and
// `actions.ts` reaches its computers through `useFleet().call`: that is where
// the web's requests are written down.
const WEB_RPC = [];
const FLEET = {
  useFleet: { getState: () => ({ hosts: {}, call: async (key, type, data) => {
    WEB_RPC.push([type, data]);
    if (type === 'group.create') return { id: 'g9', name: data.name, sort: 9 };
    return {};
  } }) },
  directoryKey: () => '', hostKey: () => '',
};
const inWeb = (parent) => !!parent?.filename?.startsWith(path.join(WEB, 'src'));
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (inWeb(parent)) {
    if (/^react(-dom)?(\/|$)/.test(request)) {
      return beneath.call(this, request, { ...parent, filename: path.join(root, 'index.js'), paths: Module._nodeModulePaths(root) }, isMain);
    }
    if (parent.filename.endsWith(path.join('lib', 'actions.ts'))) {
      if (request === './fleet') return FLEET;
      if (request === './ws') return { httpBase: () => '' };
      if (request === './refusal') return { noteRefusal() {}, refusedFor: () => null, refusalText: () => '' };
    }
  }
  return beneath.call(this, request, parent, isMain);
};
globalThis.window = globalThis.window ?? { addEventListener() {}, removeEventListener() {} };
const web = require(path.join(WEB, 'src/lib/chat-list.ts'));
const webActions = require(path.join(WEB, 'src/lib/actions.ts'));
const { ChatMenu } = require(path.join(WEB, 'src/components/ChatMenu.tsx'));
const { GroupNameDialog, DeleteGroupDialog } = require(path.join(WEB, 'src/components/GroupDialogs.tsx'));
const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act|unique "key"/.test(String(a[0]))) real(...a); };
}

// ── the phone's store, real, with its socket written down ───────────────────
const { useStore: real } = require(path.join(root, 'src/store.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));
const overlay = require('../src/components/overlay');
const PHONE_RPC = [];
let listed = () => [];
client.call = async (type, data) => {
  PHONE_RPC.push([type, data]);
  if (type === 'chat.create') return { ...chat('n1', 'New chat'), ...data, cwd: data.cwd, group_id: data.group_id ?? null };
  if (type === 'chat.update') {
    // Filed under no product for good, as the daemon files it.
    const { chat_id, ...patch } = data;
    return { ...real.getState().chats[chat_id], ...patch, ...(patch.project_id === '' ? { project: null, project_set: 1 } : {}) };
  }
  if (type === 'group.create') return { id: 'g9', name: data.name, sort: 9 };
  if (type === 'chat.list') return { chats: listed(), groups: real.getState().groups, people: PEOPLE };
  return {};
};

// ── one computer: groups, products, folders, two people ─────────────────────
const NOW = Math.floor(Date.now() / 1000);
const PEOPLE = { names: ['Yakup', 'Bedriyan'], me: 'Yakup' };
const GROUPS = [{ id: 'g1', name: 'Quire', sort: 0 }, { id: 'g2', name: 'Ops', sort: 1 }];
const PROJECTS = [{ path: '/Users/y/r/quire', name: 'quire', is_git: true }, { path: '/r/quire', name: 'quire2', is_git: true }];
function chat(id, title, o = {}) {
  return { id, title, group_id: null, owner: 'Yakup', provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default',
    cwd: '/Users/y/r/walk', provider_session_id: null, account_id: null, status: 'idle', last_preview: 'ok',
    max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0, created_at: 0,
    updated_at: NOW - 60, project_id: null, project: null, project_set: 0, ...o };
}
const CHATS = () => [
  chat('a1', 'Refund flow', { group_id: 'g1', cwd: '/Users/y/r/quire', updated_at: NOW - 100 }),
  chat('a2', 'Judging rubric', { group_id: 'g1', project: 'Freya', project_id: 'pf', cwd: '/Users/y/p/freya', updated_at: NOW - 50 }),
  chat('a3', 'Pinned plan', { pinned: 1, cwd: '/Users/y/r/hush', updated_at: NOW - 400 }),
  chat('a4', 'Logs', { group_id: 'g2', cwd: '/Users/y/r/ops', updated_at: NOW - 30 }),
  chat('a5', 'Old archived', { archived: 1, cwd: '/Users/y/r/hush', updated_at: NOW - 500 }),
  chat('a6', 'Notes', { cwd: '/Users/y/r/notes', updated_at: NOW - 200 }),
];

/** The phone, stood up over the real store's chats with its actions wired to it. */
function stand(showArchived = false) {
  machine.stand();
  const s = real.getState();
  R.store.set({
    chats: s.chats, groups: s.groups, people: PEOPLE, projects: PROJECTS, showArchived,
    prefs: { chatView: 'grouped', voiceIds: {} }, setPrefs: async () => {},
    createChat: s.createChat, updateChat: s.updateChat, deleteChat: s.deleteChat, send: s.send,
    createGroup: s.createGroup, renameGroup: s.renameGroup, deleteGroup: s.deleteGroup, refresh: s.refresh,
    listAgents: async () => [],
    defaults: { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: '/r/quire', lastAgent: null,
      byProvider: { claude: { model: 'opus', effort: 'high', perm_mode: 'default', account_id: '' } } },
  });
}
async function reset(chats = CHATS()) {
  listed = () => chats;
  real.setState({ chats: Object.fromEntries(chats.map((c) => [c.id, c])), groups: GROUPS.map((g) => ({ ...g })) });
  PHONE_RPC.length = 0;
  WEB_RPC.length = 0;
}
const list = (archived = false) => { stand(archived); return R.render('light', h(require(path.join(root, 'app/chat/index.tsx')).default, {})); };

/** Long-press a row on the phone: the menu it opens. */
async function phoneMenu(title) {
  list(true);
  R.menus.reset();
  R.holds().find((x) => x.text.startsWith(title))?.hold();
  await flush();
  return R.menus.last()?.items ?? [];
}
const words = (items) => items.filter((i) => i.kind !== 'divider' && i.kind !== 'cancel' && i.kind !== 'back').map((i) => i.label);
const pick = (items, label) => items.find((i) => i.label === label);

/** The web's ChatMenu for this chat, wired as `App.tsx`'s chatProps wire it. */
async function webMenu(c) {
  let tree;
  const props = {
    chat: c, groups: GROUPS, people: PEOPLE.names,
    onUpdate: (patch) => { webActions.updateChat('h1', c.id, patch).catch(() => {}); },
    onNewGroup: async (name) => { const made = await webActions.createGroup('h1', name); await webActions.updateChat('h1', c.id, { group_id: made.id }); },
    onDelete: () => { webActions.deleteChat('h1', c.id).catch(() => {}); },
    onClose: () => {},
  };
  await act(async () => { tree = TR.create(h(ChatMenu, props)); });
  return tree;
}
const textOf = (n) => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));
const buttons = (tree) => tree.root.findAll((n) => n.type === 'button').map(textOf);
async function click(tree, label) {
  const b = tree.root.findAll((n) => n.type === 'button' && textOf(n) === label)[0];
  if (!b) throw new Error(`web: no button ${label} in ${buttons(tree).join(' / ')}`);
  await act(async () => { b.props.onClick({ preventDefault() {} }); });
  await flush();
}
async function typeAndSubmit(tree, value) {
  const input = tree.root.findAll((n) => n.type === 'input')[0];
  await act(async () => { input.props.onChange({ target: { value } }); });
  const form = tree.root.findAll((n) => n.type === 'form')[0];
  await act(async () => { await form.props.onSubmit({ preventDefault() {} }); });
  await flush();
}

/** The phone's own dialogs, answered: a prompt is typed into and confirmed, an
 *  alert has its destructive button pressed. Both are `components/overlay`'s
 *  — the app's own, never the system's. */
const DIALOGS = [];
const realPrompt = overlay.prompt;
const realAlert = overlay.alert;
const realReplace = overlay.replaceMenu;
let typed = '';
overlay.prompt = (o) => { DIALOGS.push({ kind: 'prompt', title: o.title }); return o.submit(typed); };
overlay.alert = (title, message, buttons) => {
  DIALOGS.push({ kind: 'alert', title, buttons: (buttons ?? []).map((b) => b.text) });
  (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
};
let replaced = null;
overlay.replaceMenu = (items) => { replaced = items; };

const sectionOf = (sections, id) => sections.find((s) => s.chats.some((c) => c.id === id))?.key ?? null;
const webSections = (chats, groups) => web.hostSections({ chats: chats.filter((c) => !c.archived), groups, hostKey: 'h1', query: '',
  who: 'Yakup', names: PEOPLE.names, saved: [], now: NOW }).map((s) => ({ key: s.key, title: s.title, chats: s.chats }));
/** The headings the phone drew, and the chat titles under each. */
function drawn(titles) {
  const out = []; let cur = null;
  for (const { text } of R.holds()) {
    const t = titles.find((x) => text.startsWith(x));
    if (t) { cur?.rows.push(t); continue; }
    const m = /^(.*?)(\d+)$/.exec(text);
    if (m) out.push(cur = { title: m[1], rows: [] });
  }
  return out;
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  try {
    // ── 1 · New chat: the pen makes a fresh chat and opens it ───────────────
    await reset();
    list();
    R.nav.reset();
    R.presses().find((p) => p.label === 'New chat')?.press();
    await flush();
    const sent = PHONE_RPC.map(([t]) => t);
    const made = real.getState().chats.n1;
    const went = R.nav.pushed();
    const all = Object.values(real.getState().chats);
    const webKey = sectionOf(web.hostSections({ chats: all.filter((c) => !c.archived), groups: GROUPS, hostKey: 'h1', query: '',
      who: 'Yakup', names: PEOPLE.names, saved: [], now: NOW }), 'n1');
    const webTitle = webSections(all, GROUPS).find((s) => s.key === webKey)?.title;
    list();
    const under = drawn(all.map((c) => c.title)).find((s) => s.rows.includes('New chat'))?.title;
    checks.push([`new chat: the pen is one chat.create and that chat opens at once (${went.join()}) — ${JSON.stringify(sent)}`,
      eq(sent, ['chat.create']) && !!made && eq(went, ['/chat/n1']) && eq(R.nav.replaced(), [])]);
    checks.push([`new chat: the phone lists it under the heading the web puts it under (phone "${under}", web "${webTitle}")`,
      !!under && under === webTitle]);

    // ── 2 · a heading's + is the web's onNewChatIn ──────────────────────────
    await reset();
    list();
    R.nav.reset();
    R.presses().find((p) => p.label === 'New chat in Quire')?.press();
    await flush();
    const toGroup = R.nav.pushed()[0];
    list();
    R.nav.reset();
    R.presses().find((p) => p.label === 'New chat in ~/r/notes')?.press();
    await flush();
    const toOps = R.nav.pushed()[0];
    const quire = webSections(CHATS(), GROUPS).find((s) => s.key === 'g1');
    const webSec = web.hostSections({ chats: CHATS().filter((c) => !c.archived), groups: GROUPS, hostKey: 'h1', query: '', who: 'Yakup', names: PEOPLE.names, saved: [], now: NOW });
    const g1 = webSec.find((s) => s.key === 'g1');
    // What Sidebar.tsx hands onNewChatIn for that heading, and what NewChat.tsx makes of it.
    const webIn = { cwd: web.newChatIn(g1, PROJECTS).cwd, groupId: g1.kind === 'group' ? g1.key : undefined };
    const sidebar = fs.readFileSync(path.join(WEB, 'src/components/Sidebar.tsx'), 'utf8');
    const newChatWeb = fs.readFileSync(path.join(WEB, 'src/components/NewChat.tsx'), 'utf8');
    const webWiring = /onNewChatIn\(s\.hostKey, cwd, s\.kind === 'group' \? s\.key : undefined\)/.test(sidebar)
      && /cwd: cwd \?\? undefined,\s*group_id: groupId,/.test(newChatWeb);
    stand();
    R.params.set(toGroup?.params ?? {});
    PHONE_RPC.length = 0;
    R.render('light', h(require(path.join(root, 'app/new-chat.tsx')).default, {}));
    R.presses().find((p) => p.text === 'Start chat')?.press();
    await flush();
    const created = PHONE_RPC.find(([t]) => t === 'chat.create')?.[1] ?? {};
    R.params.reset();
    checks.push([`+: a group heading's + opens New chat on that group's folder and filed in it — the web's onNewChatIn(${JSON.stringify(webIn)}) — and chat.create carries them (${JSON.stringify({ cwd: created.cwd, group_id: created.group_id })}); a folder's + carries the folder alone (${JSON.stringify(toOps?.params)})`,
      webWiring && !!quire && toGroup?.pathname === '/new-chat' && eq(toGroup.params, { cwd: webIn.cwd, group: webIn.groupId })
      && created.group_id === webIn.groupId && created.cwd === webIn.cwd
      && eq(toOps, { pathname: '/new-chat', params: { cwd: '/Users/y/r/notes' } })]);

    // ── 3 · a chat's menu: the web's entries, in its order ───────────────────
    const cases = [['Refund flow', 'a1'], ['Pinned plan', 'a3'], ['Old archived', 'a5']];
    const lists = [];
    for (const [title, id] of cases) {
      await reset();
      const phone = words(await phoneMenu(title));
      const tree = await webMenu(CHATS().find((c) => c.id === id));
      const theirs = buttons(tree);
      await act(async () => { tree.unmount(); });
      lists.push({ title, phone, web: theirs });
    }
    // One person on the computer: no Give to, on either side.
    await reset();
    const soloPeople = PEOPLE.names;
    PEOPLE.names = ['Yakup'];
    const soloPhone = words(await phoneMenu('Refund flow'));
    const soloTree = await webMenu(CHATS()[0]);
    const soloWeb = buttons(soloTree);
    await act(async () => { soloTree.unmount(); });
    PEOPLE.names = soloPeople;
    checks.push([`menu: a long-pressed chat offers exactly the web ChatMenu's entries in its order — ${lists.map((l) => `${l.title}: ${l.phone.join(' / ')}`).join(' | ')} | one person: ${soloPhone.join(' / ')}`,
      lists.every((l) => eq(l.phone, l.web)) && eq(soloPhone, soloWeb)
      && eq(lists[0].phone, ['Rename', 'Pin', 'Archive', 'Delete chat', 'Move to group…', 'Give to Bedriyan'])
      && lists[1].phone[1] === 'Unpin' && lists[2].phone[2] === 'Unarchive']);

    // The same request with the same params, action by action.
    const flows = [
      ['rename', 'Refund flow', 'a1', async (items) => { typed = '  Refund emails  '; await pick(items, 'Rename').onPress(); },
        async (t) => { await click(t, 'Rename'); await typeAndSubmit(t, '  Refund emails  '); }],
      ['rename to nothing', 'Refund flow', 'a1', async (items) => { typed = '   '; await pick(items, 'Rename').onPress(); },
        async (t) => { await click(t, 'Rename'); await typeAndSubmit(t, '   '); }],
      ['pin', 'Refund flow', 'a1', async (items) => pick(items, 'Pin').onPress(), (t) => click(t, 'Pin')],
      ['unpin', 'Pinned plan', 'a3', async (items) => pick(items, 'Unpin').onPress(), (t) => click(t, 'Unpin')],
      ['archive', 'Refund flow', 'a1', async (items) => pick(items, 'Archive').onPress(), (t) => click(t, 'Archive')],
      ['unarchive', 'Old archived', 'a5', async (items) => pick(items, 'Unarchive').onPress(), (t) => click(t, 'Unarchive')],
      ['move to a group', 'Refund flow', 'a1', async (items) => { pick(items, 'Move to group…').onPress(); pick(replaced, 'Ops').onPress(); },
        async (t) => { await click(t, 'Move to group…'); await click(t, 'Ops'); }],
      ['move to Daily', 'Judging rubric', 'a2', async (items) => { pick(items, 'Move to group…').onPress(); pick(replaced, 'Daily').onPress(); },
        async (t) => { await click(t, 'Move to group…'); await click(t, 'Daily'); }],
      ['move to a new group', 'Refund flow', 'a1', async (items) => { typed = 'Launch'; pick(items, 'Move to group…').onPress(); await pick(replaced, 'New group…').onPress(); },
        async (t) => { await click(t, 'Move to group…'); await click(t, 'New group…'); await typeAndSubmit(t, 'Launch'); }],
      ['give to the other person', 'Refund flow', 'a1', async (items) => pick(items, 'Give to Bedriyan').onPress(), (t) => click(t, 'Give to Bedriyan')],
      ['delete', 'Refund flow', 'a1', async (items) => pick(items, 'Delete chat').onPress(),
        async (t) => { await click(t, 'Delete chat'); await click(t, 'Delete'); }],
    ];
    const results = [];
    for (const [name, title, id, onPhone, onWeb] of flows) {
      await reset();
      DIALOGS.length = 0;
      replaced = null;
      const items = await phoneMenu(title);
      await onPhone(items);
      await flush();
      const phone = PHONE_RPC.slice();
      const dialogs = DIALOGS.slice();
      const tree = await webMenu(CHATS().find((c) => c.id === id));
      await onWeb(tree);
      await act(async () => { tree.unmount(); });
      results.push({ name, phone, web: WEB_RPC.slice(), dialogs });
    }
    for (const r of results) {
      checks.push([`menu › ${r.name}: the phone sends what the web sends — ${JSON.stringify(r.phone)}${eq(r.phone, r.web) ? '' : ` ≠ web ${JSON.stringify(r.web)}`}`,
        r.phone.length > 0 && eq(r.phone, r.web)]);
    }
    const del = results.find((r) => r.name === 'delete');
    checks.push([`menu › delete asks first, in the app's own dialog (${JSON.stringify(del.dialogs)}), as the web's DeleteChatDialog does`,
      del.dialogs.length === 1 && del.dialogs[0].kind === 'alert' && del.dialogs[0].title === 'Delete chat'
      && eq(del.dialogs[0].buttons, ['Cancel', 'Delete'])]);
    const daily = results.find((r) => r.name === 'move to Daily');
    await reset();
    await real.getState().updateChat('a2', { group_id: null, project_id: '' });
    const afterDaily = webSections(Object.values(real.getState().chats), GROUPS);
    checks.push([`menu › Daily takes the chat out of its group and its product (${JSON.stringify(daily.phone[0][1])}), and the web lists it under ${afterDaily.find((s) => s.chats.some((c) => c.id === 'a2'))?.title}`,
      eq(daily.phone[0][1], { chat_id: 'a2', group_id: null, project_id: '' }) && sectionOf(afterDaily, 'a2') === '__loose']);

    // ── 4 · a group's ... menu: the web's GroupMenu ─────────────────────────
    const groupMenuSrc = sidebar.slice(sidebar.indexOf('function GroupMenu('));
    const webGroupMenu = [...groupMenuSrc.matchAll(/\{row\('([^']+)'/g)].map((m) => m[1]);
    const webGroupWiring = /onSubmit=\{\(name\) => renameGroup\(asking\.hostKey, asking\.id, name\)\}/.test(sidebar)
      && /deleteGroup\(asking\.hostKey, asking\.id\)/.test(sidebar);
    await reset();
    list();
    R.menus.reset();
    R.presses().find((p) => p.label === 'Group menu: Quire')?.press();
    await flush();
    const gItems = R.menus.last()?.items ?? [];
    DIALOGS.length = 0;
    typed = 'Quire HQ';
    await pick(gItems, 'Rename')?.onPress();
    await flush();
    const phoneRename = PHONE_RPC.slice();
    let t;
    await act(async () => { t = TR.create(h(GroupNameDialog, { title: 'Rename group', confirm: 'Save', initial: 'Quire',
      onSubmit: (name) => webActions.renameGroup('h1', 'g1', name), onClose: () => {} })); });
    await typeAndSubmit(t, 'Quire HQ');
    await act(async () => { t.unmount(); });
    const webRename = WEB_RPC.slice();
    checks.push([`group: the ... on a group heading offers the web GroupMenu's entries (${words(gItems).join(' / ')}), and Rename sends what the web's sends — ${JSON.stringify(phoneRename)}`,
      eq(words(gItems), webGroupMenu) && webGroupWiring && eq(phoneRename, webRename) && eq(phoneRename, [['group.rename', { group_id: 'g1', name: 'Quire HQ' }]])
      && real.getState().groups.find((g) => g.id === 'g1')?.name === 'Quire HQ']);

    // Delete: the daemon takes the chats out of the group (`db.delete_group`)
    // and the list is asked again.
    await reset();
    listed = () => CHATS().map((c) => (c.group_id === 'g1' ? { ...c, group_id: null } : c));
    list();
    R.menus.reset();
    R.presses().find((p) => p.label === 'Group menu: Quire')?.press();
    await flush();
    DIALOGS.length = 0;
    pick(R.menus.last()?.items ?? [], 'Delete group')?.onPress();
    await flush();
    const phoneDelete = PHONE_RPC.filter(([type]) => type.startsWith('group.'));
    const asked = DIALOGS.slice();
    await act(async () => { t = TR.create(h(DeleteGroupDialog, { name: 'Quire', onDelete: () => { webActions.deleteGroup('h1', 'g1').catch(() => {}); }, onClose: () => {} })); });
    await click(t, 'Delete');
    await act(async () => { t.unmount(); });
    checks.push([`group: Delete group asks first in the app's own dialog (${JSON.stringify(asked)}) and sends what the web's sends — ${JSON.stringify(phoneDelete)}`,
      eq(phoneDelete, WEB_RPC) && eq(phoneDelete, [['group.delete', { group_id: 'g1' }]])
      && asked.length === 1 && asked[0].title === 'Delete group' && eq(asked[0].buttons, ['Cancel', 'Delete'])
      && !real.getState().groups.some((g) => g.id === 'g1')]);
    const after = Object.values(real.getState().chats);
    list();
    const phoneAfter = drawn(after.map((c) => c.title));
    const webAfter = webSections(after, real.getState().groups);
    const at = (rows, title) => rows.find((s) => s.rows.includes(title))?.title;
    const webAt = (id) => webAfter.find((s) => s.chats.some((c) => c.id === id))?.title;
    // Before the list is asked again the chats still name the group; it is gone
    // all the same, so they read as theirs on both sides.
    const stale = CHATS();
    const staleWeb = webSections(stale, GROUPS.filter((g) => g.id !== 'g1'));
    real.setState({ chats: Object.fromEntries(stale.map((c) => [c.id, c])) });
    list();
    const phoneStale = drawn(stale.map((c) => c.title));
    checks.push([`group: its chats fall back to their product or folder heading, as on the web — Refund flow under ${at(phoneAfter, 'Refund flow')}, Judging rubric under ${at(phoneAfter, 'Judging rubric')}`,
      !phoneAfter.some((s) => s.title === 'Quire')
      && at(phoneAfter, 'Refund flow') === webAt('a1') && at(phoneAfter, 'Refund flow') === '~/r/quire'
      && at(phoneAfter, 'Judging rubric') === webAt('a2') && at(phoneAfter, 'Judging rubric') === 'Freya'
      && at(phoneStale, 'Refund flow') === staleWeb.find((s) => s.chats.some((c) => c.id === 'a1'))?.title
      && at(phoneStale, 'Judging rubric') === 'Freya']);

    // ── creating a group from the list's own menu ───────────────────────────
    await reset();
    list();
    R.menus.reset();
    R.presses().find((p) => p.text === 'Grouped')?.press();
    await flush();
    typed = 'Launch';
    await pick(R.menus.last()?.items ?? [], 'New group…')?.onPress();
    await flush();
    await act(async () => { t = TR.create(h(GroupNameDialog, { title: 'New group', confirm: 'Create', onSubmit: (name) => webActions.createGroup('h1', name), onClose: () => {} })); });
    await typeAndSubmit(t, 'Launch');
    await act(async () => { t.unmount(); });
    list();
    const headings = drawn(CHATS().map((c) => c.title)).map((s) => s.title);
    checks.push([`group: New group… makes one with the web's request (${JSON.stringify(PHONE_RPC)}) and its heading is drawn (${headings.join(', ')})`,
      eq(PHONE_RPC, WEB_RPC) && eq(PHONE_RPC, [['group.create', { name: 'Launch' }]]) && headings.includes('Launch')]);
  } finally {
    overlay.prompt = realPrompt;
    overlay.alert = realAlert;
    overlay.replaceMenu = realReplace;
    R.words.keys();
    R.store.reset();
    R.params.reset();
    R.nav.reset();
  }
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [what, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); }
    console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} passed`);
    process.exit(bad ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
