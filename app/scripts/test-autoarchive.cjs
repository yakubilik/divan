/** Chats the computer archives for going quiet (#220), on the phone.
 *
 *  The daemon does the archiving (`daemon/scripts/test_autoarchive.py`); the
 *  phone only has to follow it and to set how long "quiet" is:
 *
 *   · the archive arrives as the daemon sends it — a raw `chat.updated` frame
 *     handed to the real socket client (`src/ws.ts`), read by the real store
 *     (`src/store.ts`) — and the chat list drawn from that store drops the chat
 *     with no `chat.list` asked again, shows it under Archived, and takes it
 *     back when the daemon unarchives it;
 *   · Settings asks the computer for the threshold when it opens, shows it, and
 *     a choice from its menu is sent back as `chat.autoarchive` with the hours.
 *
 *  Run: node scripts/test-autoarchive.cjs
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const { useStore: realStore } = require(path.join(root, 'src/store.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));
const harness = require('../src/store');

// ── the computer, as far as the phone can tell ──────────────────────────────
const calls = [];
let hours = 24;
let listed = [];
client.call = async (type, data) => {
  calls.push({ type, data });
  if (type === 'chat.list') return { chats: listed, groups: [], people: { names: [], me: null } };
  if (type === 'chat.autoarchive') {
    if (data && 'hours' in data) hours = data.hours;
    return { hours };
  }
  return {};
};
/** One frame off the socket, in the daemon's own shape (`Server.broadcast`). */
const frame = (event, chatId, data) => client.handle(JSON.stringify(
  { type: 'event', event, chat_id: chatId, seq: null, data, ts: Date.now() / 1000 }));

const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act/.test(String(a[0]))) real(...a); };
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();

  // ── 1 · the archive, pushed ───────────────────────────────────────────────
  machine.stand();
  // The harness's store (what screens read), whose fixture chat the two test
  // chats are dressed in.
  const fixture = harness.useStore.getState().chats.c2;
  const quiet = { ...fixture, id: 'q1', title: 'Quiet since yesterday', archived: 0, pinned: 0, status: 'idle',
    updated_at: Date.now() / 1000 - 25 * 3600 };
  const busy = { ...fixture, id: 'q2', title: 'Still talking', archived: 0, pinned: 0, status: 'idle',
    updated_at: Date.now() / 1000 - 60 };
  listed = [quiet, busy];
  await realStore.getState().refresh();
  const lists = () => calls.filter((c) => c.type === 'chat.list').length;
  const listedOnce = lists();
  /** The chat list, drawn from what the real store holds now. */
  const page = (showArchived) => {
    machine.stand();
    R.store.set({ chats: realStore.getState().chats, showArchived });
    return R.render('dark', h(require(path.join(root, 'app/chat/index.tsx')).default, {}));
  };
  const before = page(false);
  frame('chat.updated', 'q1', { ...quiet, archived: 1 });
  const after = page(false);
  const underArchived = page(true);
  checks.push(['archive: before the sweep the quiet chat is in the list', before.includes('Quiet since yesterday')
    && before.includes('Still talking')]);
  checks.push(['archive: a chat.updated frame with archived=1 off the socket lands in the store',
    realStore.getState().chats.q1?.archived === 1]);
  checks.push([`archive: the chat drops out of the list with no chat.list asked again (asked ${lists()}×)`,
    !after.includes('Quiet since yesterday') && after.includes('Still talking') && lists() === listedOnce]);
  checks.push(['archive: it is there under Archived', underArchived.includes('Quiet since yesterday')]);
  frame('chat.updated', 'q1', { ...quiet, archived: 0, updated_at: Date.now() / 1000 });
  checks.push(['archive: unarchived by the daemon (a new message), it is back in the list by itself',
    page(false).includes('Quiet since yesterday') && lists() === listedOnce]);

  // ── 2 · Settings ──────────────────────────────────────────────────────────
  machine.stand();
  R.menus.reset();
  calls.length = 0;
  hours = 24;
  const Settings = require(path.join(root, 'app/settings.tsx')).default;
  const view = () => h(R.theme.ForceScheme, { scheme: 'dark' }, h(Settings));
  let tree;
  await act(async () => { tree = TR.create(view()); });
  const settle = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
  await settle();
  const words = () => JSON.stringify(tree.toJSON());
  const asked = calls.filter((c) => c.type === 'chat.autoarchive');
  checks.push([`settings: opening it asks the computer for the threshold — ${JSON.stringify(asked)}`,
    asked.length >= 1 && !('hours' in (asked[0].data ?? {}))]);
  checks.push(['settings: the row shows it ("Archive quiet chats", "1 day")',
    words().includes('Archive quiet chats') && words().includes('1 day')]);
  const row = () => tree.root.findAll((n) => n.props.title === 'Archive quiet chats' && typeof n.props.onPress === 'function')[0];
  await act(async () => { row()?.props.onPress(); });
  await settle();
  const menu = R.menus.last();
  const labels = (menu?.items ?? []).map((i) => i.label);
  checks.push([`settings: pressing it offers the choices with the current one checked — ${JSON.stringify(labels)}`,
    JSON.stringify(labels) === JSON.stringify(['Off', '6 hours', '12 hours', '1 day', '2 days', '3 days', '7 days'])
    && menu.items.find((i) => i.checked)?.label === '1 day']);
  calls.length = 0;
  await act(async () => { menu?.items.find((i) => i.label === '2 days')?.onPress(); });
  await settle();
  checks.push([`settings: choosing "2 days" sends chat.autoarchive {hours: 48} and the row says so — ${JSON.stringify(calls)}`,
    calls.length === 1 && calls[0].type === 'chat.autoarchive' && calls[0].data.hours === 48
    && words().includes('2 days') && hours === 48]);
  R.menus.reset();
  await act(async () => { row()?.props.onPress(); });
  await settle();
  calls.length = 0;
  await act(async () => { R.menus.last()?.items.find((i) => i.label === 'Off')?.onPress(); });
  await settle();
  checks.push(['settings: choosing "Off" sends hours 0 and the row says Off',
    calls.length === 1 && calls[0].data.hours === 0 && words().includes('"Off"')]);
  await act(async () => { tree.unmount(); });
  R.words.keys();
  R.store.reset();
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
