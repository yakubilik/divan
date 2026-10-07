/** The phone's project page, board and new ticket (HANDOVER §4.2, §4.3, §4.5),
 *  one check per criterion of ustabasi #125.
 *
 *  Run: node scripts/test-handover-project.cjs  (also folded into test-ustabasi.cjs.)
 */
const Module = require('module');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const D = require(path.join(root, 'src/drag.ts'));
const C = require(path.join(root, 'src/compose.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const branch = (kind, name, o = {}) => ({ id: `${kind}-id`, kind, name, summary: o.summary || '',
  summary_at: o.at ?? null, cards: o.cards || {}, open: o.open || 0 });
const QUIRE = {
  id: 'Quire-id', name: 'Quire', slug: 'quire', summary: 'client portals for studios', kind: 'SaaS',
  repos: ['/r/quire'], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  stage: 'live', milestones: [{ id: 'm', at: Date.UTC(2026, 0, 4) / 1000, title: 'Live', note: '', kind: 'live' }],
  branches: [branch('engineering', 'Engineering', { open: 3, cards: { queued: 2, in_progress: 6, done: 5 } }),
             branch('seo', 'SEO', { open: 0 })],
  counts: { queued: 2, in_progress: 5, done: 40 }, running: 3, waiting: 2, summary_line: '',
};
const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering', column: o.column || 'in_progress',
  position: o.position || 0, title: o.title || id, summary: '', executor: 'coding_agent', machine: 'studio',
  repo: null, ustabasi_id: o.ticket ?? null, agent_status: o.status ?? null, agent_status_at: NOW - 600,
  agent_detail: o.detail || '', created_at: NOW - DAY, updated_at: NOW - 600, moved_at: o.moved ?? NOW - 600,
});
const CARDS = [
  card('q1', { column: 'queued', title: 'Bulk invite' }),
  card('q2', { column: 'queued', position: 1, title: 'Zapier hook' }),
  card('a1', { status: 'asking', ticket: 41, title: 'Stripe keys', detail: 'Use the live keys now?' }),
  card('r1', { status: 'running', ticket: 42, position: 1, title: 'Lesson search' }),
  card('r2', { status: 'running', ticket: 43, position: 2, title: 'Certificate PDF' }),
  card('r3', { status: 'running', ticket: 44, position: 3, title: 'Exam export' }),
  card('s1', { status: 'blocked', ticket: 45, position: 4, title: 'Exam timer', detail: 'Test fails on Safari 17.' }),
  card('v1', { column: 'review', status: 'running', ticket: 46, title: 'Payment flow' }),
  ...[1, 2, 3, 4, 5].map((n) => card(`d${n}`, { column: 'done', status: 'verified', title: `Shipped ${n}`, moved: NOW - n * DAY })),
];
const FLEET = { id: 'h1', name: 'studio', state: { at: NOW, reachable: true, error: null, old: false,
  snapshot: { machine: 'studio', os: 'Darwin', at: NOW, quota: null, queue: {}, projects: [QUIRE], cards: CARDS,
              agents: [], activity: {} } } };

let calls = [];
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
function stand(params) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.menus.reset();
  calls = [];
  let drafts = {};
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: FLEET.state }, host: { id: 'h1' }, conn: 'online',
    loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {}, chats: {},
    catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: '' }], efforts: ['high'], perm_modes: ['default'] } },
    defaults: { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: '/r/home',
                byProvider: { claude: { model: 'opus', effort: 'high', perm_mode: 'default', account_id: '' } } },
    accounts: [], accountsLoaded: true, loadAccounts: async () => {}, limits: {},
    projects: [{ path: '/r/quire', name: 'quire', is_git: true }],
    listAgents: async () => [],
    createChat: async (d) => { calls.push(['chat.create', d]); return { id: 'new1' }; },
    send: async (id, text) => { calls.push(['chat.send', { id, text }]); },
    createCard: async (w) => { calls.push(['divan.card.create', w]); },
    moveCard: async (w) => { calls.push(['divan.card.move', w]); return { error: '' }; },
    compose: C.NO_DRAFT, setCompose() {},
    drafts, setDraft: (key, patch) => { drafts = { ...drafts, [key]: { ...(drafts[key] ?? C.NO_DRAFT), ...patch } }; R.store.set({ drafts }); },
  });
  R.params.set(params);
  return R.render('dark', h(Dashboard));
}
const draw = () => R.render('dark', h(Dashboard));
const count = (markup, re) => (markup.match(re) ?? []).length;

const checks = [];

// 2 · the head, and the segment that is three addresses
{
  const page = stand({ project: 'quire' });
  R.pressOn('bdBoard');
  const toBoard = R.params.get().tab;
  const board = draw();
  R.pressOn('pjChats');
  const toChats = R.params.get().tab;
  const chats = draw();
  R.pressOn('overview');
  const toOverview = R.params.get().tab;
  const reloaded = ['board', 'chats'].map((tab) => stand({ project: 'quire', tab }));
  checks.push(['the head is monogram, name, one sentence and a meta line with the stage as a word, no stage bar; the segment switches the view and each view is its own address that a redraw lands on',
    R.styles(page).some((s) => s.width === 44 && s.height === 44) && page.includes('>Quire<')
    && page.includes('SaaS · client portals for studios') && page.includes('>pjSince · pjRunsOn<')
    && !/prRail|stageBar|bdIdea|bdGrowth/.test(page)
    && toBoard === 'board' && board.includes('>bdHint<') && toChats === 'chats' && chats.includes('>pjNoChats<')
    && toOverview === '' && reloaded[0].includes('>bdHint<') && reloaded[1].includes('>pjNoChats<')]);
}

// 3 · the board summary
{
  const page = stand({ project: 'quire' });
  const counted = (label) => {
    const m = page.match(new RegExp(`>(\\d+)</span><span[^>]*>${label}<`));
    return m ? Number(m[1]) : null;
  };
  const tabCount = (label) => {
    const b = stand({ project: 'quire', tab: 'board' });
    const m = b.match(new RegExp(`>${label}</span><span[^>]*>(\\d+)<`));
    return m ? Number(m[1]) : null;
  };
  const summary = ['bdIceBox', 'bdQueued', 'bdInProgress', 'bdDone'].map(counted);
  const tabs = ['bdIceBox', 'bdQueued', 'bdInProgress', 'bdDone'].map(tabCount);
  const words = ['stStuck', 'stAsking', 'stTesting', 'stRunning'].map((w) => count(page, new RegExp(`>${w}<`, 'g')));
  checks.push(['the board summary is four counts off the real columns, and In progress now lists at most five In Progress cards with their status words',
    JSON.stringify(summary) === JSON.stringify(tabs) && JSON.stringify(summary) === '[0,2,6,5]'
    && words[0] === 1 && words[1] === 1 && words[2] === 1 && words[3] === 2]);
}

// 4 · branches
{
  const page = stand({ project: 'quire' });
  const seo = page.slice(page.indexOf('>SEO<'), page.indexOf('>SEO<') + 400);
  R.presses().find((p) => p.text.startsWith('Engineering')).press();
  checks.push(['a branch with no source says Source not connected yet. and no number; a connected one opens the branch page',
    seo.includes('>pjNotConnected<') && !/>\d/.test(seo.split('pjNotConnected')[0])
    && JSON.stringify(R.nav.pushed()) === '["/branch/engineering?project=quire"]']);
}

// 6 · the asking edge, and Done this month
{
  const t = K.tokensFor('dark');
  const board = stand({ project: 'quire', tab: 'board', col: 'in_progress' });
  const edges = R.styles(board).filter((s) => s.borderColor === t.amberRing && s.overflow === 'hidden');
  const done = stand({ project: 'quire', tab: 'board', col: 'done' });
  const shown = count(done, />Shipped \d</g);
  R.pressOn('bdShowMore');
  const all = R.render('dark', h(Dashboard));
  checks.push(['an asking card carries an amber-toned edge and the word asking; Done shows this month with Show N more revealing the rest',
    edges.length === 1 && board.includes('>stAsking<') && board.includes('Use the live keys now?')
    && shown === 3 && done.includes('>bdShowMore<') && R.params.get().done === 'all'
    && count(all, />Shipped \d</g) === 5 && !all.includes('>bdShowMore<')]);
}

// 1 · a held card dropped on the In Progress tab moves it there and starts it
{
  stand({ project: 'quire', tab: 'board', col: 'queued' });
  const hold = R.holds().find((x) => x.text.includes('Bulk invite'));
  const carried = D.carry({ ...CARDS[0], host: 'h1', stale: false }, 'coder', 'exCoder');
  const tab = { x: 200, y: 143 };
  let drag = null;
  const effects = [];
  for (const e of [{ do: 'lift', carried, open: 'queued', at: { x: 195, y: 300 } },
                   { do: 'over', at: tab, column: 'in_progress', onBoard: true, slot: null, position: null, now: 1000 },
                   { do: 'drop' }]) {
    const r = D.step(drag, e);
    drag = r.drag;
    effects.push(...r.effects);
  }
  const move = effects.find((e) => e.do === 'move');
  checks.push(['phone: a card held 350 ms and dropped on the In Progress tab is one move into In Progress that starts it, with nothing asked first',
    !!hold && hold.delay === D.HOLD_MS && move?.column === 'in_progress' && move.starts === true
    && effects.every((e) => ['haptic', 'open', 'move'].includes(e.do))]);
}

// 7 · the Composer at the foot is locked
async function locked() {
  const page = stand({ project: 'quire' });
  const chip = /data-label="Quire"/.test(page);
  const clear = /cmClearScope|cmAddProject/.test(page) || R.presses().some((p) => p.label === 'cmReset' && p.text === '');
  R.pressOn('cmIce');
  draw();
  R.typeInto('cmLabel', '@hush write the changelog');
  draw();
  R.presses().find((p) => p.label === 'cmSend').press();
  await flush();
  const filed = calls.find((c) => c[0] === 'divan.card.create');
  checks.push(['the Composer at the foot of a project carries that project, and its chip cannot be removed',
    chip && !clear && !page.includes('>cmProject<')
    && filed && filed[1].card.project_id === 'Quire-id' && filed[1].card.column === 'ice_box']);
}

// 1 (wire) · what the board's move asks the computer for
async function wire() {
  const asked = [];
  const client = { onStatus: () => () => {}, on: () => () => {}, poke() {}, connect() {}, disconnect() {},
                   call: async (type, data) => { asked.push([type, data]); return type === 'divan.card.move' ? { error: null } : {}; } };
  const stand2 = { [path.join(root, 'src/ws.ts')]: { client, callOnce: async () => ({}) },
                   [path.join(root, 'src/push.ts')]: { dismissChatNotifications() {} } };
  const packaged = {
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} },
    'expo-local-authentication': { hasHardwareAsync: async () => false, isEnrolledAsync: async () => false,
                                   authenticateAsync: async () => ({ success: true }) },
  };
  const file = path.join(root, 'src/store.ts');
  const had = require.cache[file];
  delete require.cache[file];
  const under = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (packaged[request]) return packaged[request];
    if (request.startsWith('.') && parent) {
      const to = path.resolve(path.dirname(parent.filename), request);
      for (const ext of ['', '.ts', '.tsx']) if (stand2[to + ext]) return stand2[to + ext];
    }
    return under.call(this, request, parent, isMain);
  };
  let store;
  try { store = require(file).useStore; } finally {
    Module._load = under;
    if (had) require.cache[file] = had; else delete require.cache[file];
  }
  store.setState({ hosts: [{ id: 'h1', name: 'studio', host: 'studio', port: 1, token: 't' }], activeHostId: 'h1',
                   conn: 'online', divan: { h1: FLEET.state } });
  const answer = await store.getState().moveCard({ card: 'q1', host: 'h1', column: 'in_progress', position: null });
  const move = asked.find((a) => a[0] === 'divan.card.move');
  checks.push(['phone: that move is divan.card.move with the In Progress column, and nothing else is asked first',
    !!move && move[1].card_id === 'q1' && move[1].column === 'in_progress' && !('position' in move[1])
    && asked[0][0] === 'divan.card.move' && answer.error === '']);
}

// 5 is `test-new-ticket.cjs` (Create into Ice Box, Queued, In Progress).

const ready = (async () => {
  try {
    await locked();
    await wire();
  } catch (e) {
    checks.push([`every section of this file ran to the end (${e.message})`, false]);
  }
  R.store.reset();
  R.params.reset();
  R.nav.reset();
})();

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
