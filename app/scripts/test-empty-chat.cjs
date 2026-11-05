/** A chat nobody wrote in is in no list (Yakup, 5 Nov 2026: "boş chat diye bir
 *  şey olmasın"). The pen makes the chat at once, so one opened and put down
 *  used to sit in the list as "New chat" until auto-archive took it.
 *
 *   · on the web's sidebar and the phone's list alike (the file is kept twice):
 *     an empty chat is in no section, no computer and no product list, and is
 *     not counted for its person;
 *   · it appears the moment its first line is sent (the daemon writes the
 *     preview and sets it running);
 *   · a pinned one stays, being put there on purpose.
 *
 *  Run: node scripts/test-empty-chat.cjs
 */
const path = require('path');
require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const copies = {
  web: require(path.join(root, '..', 'web/src/lib/chat-list.ts')),
  phone: require(path.join(root, 'src/chat-list.ts')),
};
const NOW = Math.floor(Date.now() / 1000);
const chat = (id, o = {}) => ({
  id, title: id, group_id: null, owner: 'Yakup', provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default',
  cwd: '/Users/y/r/walk', provider_session_id: null, account_id: null, status: 'idle', last_preview: 'ok',
  max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0, created_at: NOW - 30,
  updated_at: NOW - 30, project_id: 'p1', project: 'walk', project_set: 1, ...o,
});

let failed = 0;
const check = (ok, what, got) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${what}${ok ? '' : `  — ${got}`}`);
  if (!ok) failed++;
};
const ids = (sections) => sections.flatMap((s) => s.chats.map((c) => c.id)).sort().join(',');

for (const [name, L] of Object.entries(copies)) {
  console.log(`── ${name}`);
  const chats = [
    chat('said'),
    chat('empty', { last_preview: '' }),
    chat('first-line', { last_preview: '', status: 'running' }),
    chat('pinned-empty', { last_preview: '', pinned: 1 }),
    chat('other', { owner: 'Bedirhan', last_preview: '' }),
  ];
  const listed = ids(L.hostSections({ chats, groups: [], hostKey: 'h', query: '', who: null,
    names: ['Yakup', 'Bedirhan'], saved: [], now: NOW }));
  check(listed === 'first-line,pinned-empty,said', 'an empty chat is not in the list', listed);
  const searched = ids(L.hostSections({ chats, groups: [], hostKey: 'h', query: 'empty', who: null,
    names: ['Yakup', 'Bedirhan'], saved: [], now: NOW }));
  check(searched === 'pinned-empty', 'nor found by a search for its title', searched);
  const hosts = { h: { chats, cfg: { name: 'Mac' }, info: null } };
  const fleet = ids(L.fleetSections(hosts, ['h'], ''));
  check(fleet === 'first-line,pinned-empty,said', 'nor under its computer', fleet);
  const product = ids(L.projectSections(hosts, { h: 'p1' }, '', NOW));
  check(product === 'first-line,pinned-empty,said', 'nor under its product', product);
  const counts = L.personCounts(chats, ['Yakup', 'Bedirhan']);
  check(counts.Yakup === 3 && !counts.Bedirhan, 'nor counted for its person', JSON.stringify(counts));
  const sent = ids(L.hostSections({ chats: chats.map((c) => (c.id === 'empty' ? { ...c, last_preview: 'merhaba' } : c)),
    groups: [], hostKey: 'h', query: '', who: 'Yakup', names: ['Yakup', 'Bedirhan'], saved: [], now: NOW }));
  check(sent === 'empty,first-line,pinned-empty,said', 'and is listed once its first line is sent', sent);
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all ok');
