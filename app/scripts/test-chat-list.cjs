/** The phone's chat list reads the chats into the same sections as the web's
 *  sidebar (#221).
 *
 *   · the sectioning is one file kept twice — `web/src/lib/chat-list.ts` and
 *     `app/src/chat-list.ts` — and the two are byte for byte the same;
 *   · over one fixture (groups, product-filed chats, folder-only chats, pinned,
 *     Daily, old and archived chats, two people, two computers, searches and a
 *     saved order) the web's sectioning and the phone's answer with the same
 *     section ids, titles, counts and chats in the same order — and the web's
 *     answer is the one its sidebar always gave, pinned here by hand;
 *   · search on the phone keeps exactly what the web's `matches()` keeps;
 *   · the person filter: this phone's own person by default, everyone a pick
 *     away, and only that person's chats counted and listed;
 *   · driven: the chat screen, stood up over the fixture, draws the web's
 *     headings in the web's order, pinned first inside a section.
 *
 *  Run: node scripts/test-chat-list.cjs
 */
const fs = require('fs');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const WEB_FILE = path.join(root, '..', 'web/src/lib/chat-list.ts');
const APP_FILE = path.join(root, 'src/chat-list.ts');
const web = require(WEB_FILE);
const phone = require(path.join(root, 'src/chat-sections.ts'));
const appCopy = require(APP_FILE);

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const chat = (id, title, o = {}) => ({
  id, title, group_id: null, owner: 'Yakup', provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default',
  cwd: '/Users/y/r/walk', provider_session_id: null, account_id: null, status: 'idle', last_preview: 'ok',
  max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0, created_at: 0,
  updated_at: NOW - 60, project_id: null, project: null, project_set: 0, ...o,
});

/** studio: two people, three groups (one named like a product), products,
 *  folders, Daily, a pinned chat gone quiet, a running one, old and archived ones. */
const STUDIO = {
  people: { names: ['Yakup', 'Bedriyan'], me: 'Yakup' },
  groups: [{ id: 'g1', name: 'Quire', sort: 1 }, { id: 'g2', name: 'Ops', sort: 0 }, { id: 'g3', name: 'Divan', sort: 2 }],
  chats: [
    chat('a1', 'Refund flow', { group_id: 'g1', cwd: '/Users/y/r/quire', updated_at: NOW - 100 }),
    chat('a2', 'Pinned plan', { group_id: 'g1', cwd: '/Users/y/r/quire', pinned: 1, updated_at: NOW - 5000 }),
    chat('a3', 'Judging rubric', { project: 'Freya', project_id: 'pf', cwd: '/Users/y/p/freya', updated_at: NOW - 50 }),
    chat('a4', 'Reel cut', { project: 'Divan', project_id: 'pd', cwd: '/Users/y/r/devtrace', updated_at: NOW - 300 }),
    chat('a5', 'Mail search', { project_set: 1, project_id: '', cwd: '/r/mailbox', updated_at: NOW - 200 }),
    chat('a6', 'Pricing', { cwd: '/Users/y/r/hush', updated_at: NOW - 400 }),
    chat('a7', 'Logs', { cwd: '/Users/y/r/walk', updated_at: NOW - 30 }),
    chat('a8', 'Old notes', { cwd: '/Users/y/r/hush', updated_at: NOW - 3 * DAY }),
    chat('a9', 'Old pinned', { cwd: '/Users/y/r/hush', pinned: 1, updated_at: NOW - 3 * DAY }),
    chat('a10', 'Long run', { cwd: '/Users/y/r/walk', status: 'running', updated_at: NOW - 2 * DAY }),
    chat('a11', 'Archived by hand', { cwd: '/Users/y/r/walk', archived: 1, updated_at: NOW - 60 }),
    chat('a12', 'Legacy one', { owner: '', cwd: '/Users/y/r/walk', updated_at: NOW - 700 }),
    chat('a13', 'İzmir trip', { group_id: 'g2', cwd: '/Users/y/r/ops', last_preview: 'Ferry times', updated_at: NOW - 900 }),
    chat('b1', 'Brother notes', { owner: 'Bedriyan', cwd: '/Users/b/r/quire', updated_at: NOW - 20 }),
    chat('b2', 'Ops budget', { owner: 'Bedriyan', group_id: 'g2', cwd: '/Users/b/r/ops', updated_at: NOW - 1000 }),
    chat('b3', 'Old brother', { owner: 'Bedriyan', cwd: '/Users/b/r/quire', updated_at: NOW - 4 * DAY }),
  ],
};
/** mini: one person, no groups, one folder — the plain list. */
const MINI = {
  people: { names: ['Yakup'], me: 'Yakup' },
  groups: [],
  chats: [
    chat('m1', 'Build fix', { owner: null, cwd: '/home/m/x', updated_at: NOW - 10 }),
    chat('m2', 'Notes', { owner: null, cwd: '/home/m/x', updated_at: NOW - 20, pinned: 1 }),
    chat('m3', 'Stale', { owner: null, cwd: '/home/m/x', updated_at: NOW - 5 * DAY }),
  ],
};

/** What the web's sidebar draws for one computer: the daemon's `chat.list`
 *  (which leaves out what was archived by hand), read the way Sidebar.tsx
 *  reads it. */
function webList(host, hostKey, { query = '', chosen, saved = [] }) {
  const names = host.people.names;
  const who = names.length > 1 ? web.whoseChats(names, host.people.me, chosen) : null;
  const chats = host.chats.filter((c) => !c.archived);
  return web.hostSections({ chats, groups: host.groups, hostKey, query, who, names, saved, now: NOW });
}
/** What the phone draws: everything (it asks with `include_archived`), through
 *  its own screen's reading, with every heading open so the chats can be compared. */
function phoneList(host, { query = '', chosen, saved = [] }) {
  const byId = Object.fromEntries(host.chats.map((c) => [c.id, c]));
  return phone.chatSections({ chats: byId, groups: host.groups, people: host.people, chosen, saved, productNames: {},
    q: query, collapsed: { __archive: false }, showArchived: false, flat: false, now: NOW }).sections;
}
const readWeb = (list) => list.map((s) => ({ id: s.key, title: s.title, count: s.chats.length, chats: s.chats.map((c) => c.id) }));
const readPhone = (list) => list.map((s) => ({ id: s.id, title: s.title, count: s.count, chats: s.data.map((c) => c.id) }));
const show = (list) => list.map((s) => `${s.title} ${s.count}[${s.chats.join(',')}]`).join(' | ');

const checks = [];
const ready = (async () => {
  // Its own checks run on requiring it, over the same harness: let them finish.
  await machine.ready;
  // ── one source of truth ─────────────────────────────────────────────────
  const same = fs.readFileSync(WEB_FILE, 'utf8') === fs.readFileSync(APP_FILE, 'utf8');
  checks.push([`the sectioning is one file, kept byte for byte the same in web/src/lib and app/src (${path.basename(APP_FILE)})`, same]);
  const sidebar = fs.readFileSync(path.join(root, '..', 'web/src/components/Sidebar.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'app/chat/index.tsx'), 'utf8');
  checks.push(['the web sidebar and the phone both read their sections from that file, and neither keeps its own copy of the rules',
    /from '\.\.\/lib\/chat-list'/.test(sidebar) && !/function sections\(|function arrange\(|function matches\(/.test(sidebar)
      && /from '\.\/chat-list'/.test(fs.readFileSync(path.join(root, 'src/chat-sections.ts'), 'utf8'))
      && /chatSections\(/.test(screen)]);

  // ── what the web has always drawn for this fixture ──────────────────────
  const studio = readWeb(webList(STUDIO, 'h1', {}));
  const pinned = show(studio) === [
    'Ops 1[a13]', 'Quire 2[a2,a1]', 'Divan 1[a4]', 'Freya 1[a3]', '~/r/hush 2[a9,a6]',
    '~/r/walk 3[a7,a12,a10]', 'Daily 1[a5]', 'Archive 1[a8]'].join(' | ');
  const arranged = show(readWeb(webList(STUDIO, 'h1', { saved: ['__loose', 'project:Freya'] })));
  const walk = show(readWeb(webList(STUDIO, 'h1', { query: 'walk' })));
  const mini = show(readWeb(webList(MINI, 'h2', {})));
  checks.push([`web: groups by their order, then products, then folders, then Daily, quiet chats aged into Archive; pinned first, then newest — ${show(studio)}`,
    pinned]);
  checks.push([`web: a saved order puts those first and the rest after in their own order, Archive last; a search drops empty headings; one folder is a plain list — ${arranged} / ${walk} / ${mini}`,
    arranged.startsWith('Daily 1[a5] | Freya 1[a3] | Ops 1[a13] | Quire') && arranged.endsWith('Archive 1[a8]')
      && walk === 'Chats 3[a7,a12,a10]' && mini === 'Chats 2[m2,m1] | Archive 1[m3]']);

  // ── parity: the same answers, every way the list can be asked ───────────
  const cases = [];
  for (const [name, host, key] of [['studio', STUDIO, 'h1'], ['mini', MINI, 'h2']]) {
    for (const chosen of [undefined, '', 'Bedriyan', 'Nobody']) {
      for (const query of ['', 'walk', 'izmir', '  REFUND ', 'ok', 'nothing at all']) {
        for (const saved of [[], ['__loose', 'project:Freya'], ['cwd:/Users/y/r/walk', 'g3', '__archive']]) {
          cases.push({ name, host, key, o: { chosen, query, saved } });
        }
      }
    }
  }
  const differ = cases.filter(({ host, key, o }) =>
    JSON.stringify(readWeb(webList(host, key, o))) !== JSON.stringify(readPhone(phoneList(host, o))));
  checks.push([`parity: over ${cases.length} cases (2 computers × 4 person picks × 6 searches × 3 saved orders) the web and the phone give the same section ids, titles, counts and chat order${differ.length ? ` — differs: ${differ.slice(0, 2).map((d) => `${d.name} ${JSON.stringify(d.o)}`).join('; ')}` : ''}`,
    differ.length === 0]);
  const hosts = { h1: { chats: STUDIO.chats, cfg: { name: 'studio' } }, h2: { chats: MINI.chats, cfg: { name: 'mini' } } };
  const fleet = (m, q) => JSON.stringify(readWeb(m.fleetSections(hosts, ['h1', 'h2'], m.needle(q))));
  checks.push(['parity: the all-computers list (fleetSections) answers the same from both copies',
    ['', 'notes', 'BUILD'].every((q) => fleet(web, q) === fleet(appCopy, q)) && JSON.parse(fleet(web, '')).map((s) => s.title).join() === 'studio,mini']);

  // ── search: the web's matches(), not the phone's old title-or-preview ───
  const searchOk = ['walk', 'izmir', 'İZMİR', '  REFUND ', 'ferry', '/users/y/r/hush', 'nothing'].every((query) => {
    const n = web.needle(query);
    const want = STUDIO.chats.filter((c) => !c.archived && c.owner !== 'Bedriyan' && web.matches(c, n)).map((c) => c.id).sort().join();
    const got = phoneList(STUDIO, { query }).flatMap((s) => s.data.map((c) => c.id)).sort().join();
    return want === got;
  });
  const byFolder = phoneList(STUDIO, { query: 'walk' }).flatMap((s) => s.data.map((c) => c.id)).sort().join();
  const turkish = phoneList(STUDIO, { query: 'izmir' }).flatMap((s) => s.data.map((c) => c.id)).join();
  checks.push([`search: the phone keeps exactly what the web's matches() keeps — title, preview or folder, Turkish case, trimmed — walk→${byFolder}, izmir→${turkish}`,
    searchOk && byFolder === 'a10,a12,a7' && turkish === 'a13']);

  // ── the person filter ───────────────────────────────────────────────────
  const read = (chosen) => phone.chatSections({ chats: Object.fromEntries(STUDIO.chats.map((c) => [c.id, c])), groups: STUDIO.groups,
    people: STUDIO.people, chosen, saved: [], productNames: {}, q: '', collapsed: { __archive: false }, showArchived: false, flat: false, now: NOW });
  const ids = (r) => r.sections.flatMap((s) => s.data.map((c) => c.id));
  const mine = read(undefined);
  const all = read('');
  const his = read('Bedriyan');
  const counts = mine.counts;
  checks.push([`person: by default this phone's own person (${mine.who}), everyone with '' (${all.who}), and only that person's chats listed — ${JSON.stringify({ counts, mine: ids(mine).length, all: ids(all).length, his: ids(his) })}`,
    mine.who === 'Yakup' && all.who === null && his.who === 'Bedriyan' && mine.shared
      && !ids(mine).some((id) => id.startsWith('b')) && ids(his).every((id) => id.startsWith('b')) && ids(his).length === 3
      && ids(all).length === 15 && counts.Yakup === 12 && counts.Bedriyan === 3
      && !read('').sections.some((s) => s.data.some((c) => c.archived))]);

  // ── driven: the screen itself, over the fixture ─────────────────────────
  const Chats = require(path.join(root, 'app/chat/index.tsx')).default;
  const prefsSet = [];
  const stage = (chatPerson) => {
    machine.stand();
    R.store.set({
      chats: Object.fromEntries(STUDIO.chats.map((c) => [c.id, c])), groups: STUDIO.groups, people: STUDIO.people,
      prefs: { chatView: 'grouped', voiceIds: {}, ...(chatPerson === undefined ? {} : { chatPerson: { h1: chatPerson } }) },
      projects: [{ path: '/Users/y/r/quire', name: 'quire', is_git: true }],
      setPrefs: async (p) => { prefsSet.push(p); },
    });
    return R.render('light', h(Chats, {}));
  };
  const titles = new Set(STUDIO.chats.map((c) => c.title));
  const layout = () => {
    const out = []; let cur = null;
    for (const { text } of R.holds()) {
      if ([...titles].some((t) => text.startsWith(t))) { cur?.rows.push([...titles].find((t) => text.startsWith(t))); continue; }
      const m = /^(.*?)(\d+)$/.exec(text);
      if (m) out.push(cur = { title: m[1], count: Number(m[2]), rows: [] });
    }
    return out;
  };
  let markup = stage(undefined);
  const drawn = layout();
  const expect = readWeb(webList(STUDIO, 'h1', {}));
  const headings = drawn.map((s) => `${s.title} ${s.count}`).join(' | ');
  const want = expect.map((s) => `${s.title} ${s.count}`).join(' | ');
  const title = (id) => STUDIO.chats.find((c) => c.id === id).title;
  const rowsOk = expect.filter((s) => s.id !== '__archive').every((s, i) => drawn[i].rows.join() === s.chats.map(title).join());
  checks.push([`driven: the chat screen draws the web's headings, in the web's order, with its counts — ${headings}`,
    headings === want]);
  checks.push([`driven: inside a heading pinned first, then most recent, the archive drawn shut — Quire: ${drawn.find((s) => s.title === 'Quire')?.rows.join(', ')}`,
    rowsOk && drawn.find((s) => s.title === 'Quire')?.rows.join() === 'Pinned plan,Refund flow' && drawn.at(-1).title === 'Archive' && drawn.at(-1).rows.length === 0]);
  const plus = R.presses().filter((p) => (p.label ?? '').startsWith('New chat in ')).map((p) => p.label.slice(12));
  const dots = R.presses().filter((p) => (p.label ?? '').startsWith('Group menu: ')).map((p) => p.label.slice(12));
  const offered = webList(STUDIO, 'h1', {}).filter((s) => web.newChatIn(s, [{ path: '/Users/y/r/quire', name: 'quire' }]).offered).map((s) => s.title);
  checks.push([`driven: a heading carries the web's + where the web offers one (${plus.join(', ')}) and a group its ... (${dots.join(', ')})`,
    plus.join() === offered.join() && dots.join() === 'Ops,Quire,Divan' && !plus.includes('Archive')]);

  const card = R.presses().find((p) => p.label === 'Whose chats');
  const cardText = card?.text ?? '';
  const noTheirs = !/Brother notes|Ops budget/.test(markup);
  R.menus.reset();
  card?.press(); await flush();
  const items = (R.menus.last()?.items ?? []).map((i) => i.label).filter(Boolean);
  (R.menus.last()?.items ?? []).find((i) => (i.label ?? '').startsWith('Bedriyan'))?.onPress?.();
  await flush();
  const picked = prefsSet.at(-1)?.chatPerson?.h1;
  markup = stage('');
  const everyone = layout();
  const allCard = R.presses().find((p) => p.label === 'Whose chats')?.text ?? '';
  checks.push([`driven: the person card shows this phone's person and count (${cardText}), lists only theirs, offers ${items.join(' / ')}, a pick is kept per computer (${picked}), and Everyone lists both (${allCard})`,
    /^Yakup12$/.test(cardText) && noTheirs && items[0] === 'Everyone · 15' && items.includes('Bedriyan · 3') && picked === 'Bedriyan'
      && /^Everyone15$/.test(allCard) && /Brother notes/.test(markup)
      && everyone.map((s) => `${s.title} ${s.count}`).join(' | ') === readWeb(webList(STUDIO, 'h1', { chosen: '' })).map((s) => `${s.title} ${s.count}`).join(' | ')]);

  // One computer and one person: no card, the plain list.
  machine.stand();
  R.store.set({ chats: Object.fromEntries(MINI.chats.map((c) => [c.id, c])), groups: [], people: MINI.people, prefs: { chatView: 'grouped', voiceIds: {} } });
  R.render('light', h(Chats, {}));
  const plain = layout().map((s) => `${s.title} ${s.count}`).join(' | ');
  checks.push([`driven: one person on the computer draws no person card, and the plain list is the web's (${plain})`,
    !R.presses().some((p) => p.label === 'Whose chats') && plain === 'Chats 2 | Archive 1']);

  // ── the list's lights: one file kept twice, and drawn from the chat ──────
  const WEB_LIGHT = path.join(root, '..', 'web/src/lib/light.ts');
  const APP_LIGHT = path.join(root, 'src/light.ts');
  checks.push(['lights: web/src/lib/light.ts and app/src/light.ts are byte for byte the same',
    fs.readFileSync(WEB_LIGHT, 'utf8') === fs.readFileSync(APP_LIGHT, 'utf8')]);
  const { chatLight } = require(APP_LIGHT);
  const L = (o) => chatLight(chat('x', 'x', o));
  const order = [
    L({ status: 'awaiting_approval', bg: [{ id: 't', kind: 'local_bash', label: 'b', since: NOW }], done_at: NOW }),
    L({ status: 'running', bg: [{ id: 't', kind: 'local_bash', label: 'b', since: NOW }], done_at: NOW }),
    L({ bg: [{ id: 't', kind: 'local_bash', label: 'b', since: NOW }], done_at: NOW }),
    L({ done_at: NOW, done_failed: 1, seen_at: NOW - 5 }),
    L({ done_at: NOW, seen_at: null }),
    L({ done_at: NOW - 5, seen_at: NOW }),
    L({}),
  ];
  checks.push([`lights: worst news first, and an older daemon's chat lights only what it says — ${order.join(', ')}`,
    order.join(',') === 'awaiting,running,background,failed,unread,,']);
  machine.stand();
  R.store.set({
    chats: Object.fromEntries([
      chat('l1', 'Build in back', { bg: [{ id: 't1', kind: 'local_bash', label: 'npm run build', since: NOW }] }),
      chat('l2', 'Helper in back', { bg: [{ id: 't2', kind: 'local_agent', label: '', since: NOW }] }),
      chat('l3', 'Finished one', { done_at: NOW - 30, seen_at: null }),
      chat('l4', 'Broke one', { done_at: NOW - 30, done_failed: 1, seen_at: NOW - 600 }),
      chat('l5', 'Read one', { done_at: NOW - 900, seen_at: NOW - 30 }),
    ].map((c) => [c.id, c])), groups: [], people: MINI.people, prefs: { chatView: 'grouped', voiceIds: {} },
  });
  const litMarkup = R.render('light', h(Chats, {}));
  const has = (t) => litMarkup.includes(t);
  const count = (t) => litMarkup.split(t).length - 1;
  // The screens here draw a string's key, not its words.
  const what = { build: count('bgOne'), helper: count('bgAgent'),
    unread: count('data-label="lightUnread"'), failed: count('data-label="lightFailed"') };
  checks.push([`driven: a row says what is still running in the background (its own words, or "a helper"), marks a finished turn nobody read green and a failed one red, and a read one plainly — ${JSON.stringify(what)}`,
    what.build === 1 && what.helper === 1 && what.unread === 1 && what.failed === 1]);
})();

module.exports = { ready, checks, STUDIO };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [what, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); }
    console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} passed`);
    process.exit(bad ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
