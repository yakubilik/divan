/** The phone's Dashboard and its Composer (HANDOVER §4.1, §5), pressed.
 *
 *  Run: node scripts/test-composer.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const M = require(path.join(root, 'src/divan.ts'));
const C = require(path.join(root, 'src/compose.ts'));
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
const Waiting = require(path.join(root, 'app/waiting.tsx')).default;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase(), summary: '', repos: o.repos || [], sort: 0,
  archived: false, created_at: 0, updated_at: NOW - 60,
  branches: [{ id: 'e', kind: 'engineering', name: 'Engineering', summary: '', summary_at: null, cards: {}, open: 0 }],
  counts: o.counts || {}, running: o.running || 0, waiting: o.waiting || 0, summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: 'e', branch: 'engineering', column: 'in_progress', position: 0,
  title: o.title || id, summary: '', executor: o.executor ?? 'coding_agent', machine: null, repo: null,
  ustabasi_id: o.ticket ?? null, agent_status: o.status ?? null, agent_status_at: NOW - 600,
  agent_detail: o.detail || '', created_at: 0, updated_at: 0, moved_at: NOW - 600,
});
const agent = (id, o) => ({
  card_id: id, project_id: o.project, project: o.name, branch: 'engineering', title: o.title,
  executor: 'coding_agent', machine: '', status: 'running', detail: '', since: NOW - 900, ustabasi_id: null,
});
const board = (o) => ({ id: 'h1', name: 'studio', state: { at: NOW, reachable: true, error: null, old: false,
  snapshot: { machine: 'studio', os: 'Darwin', at: NOW, quota: null, queue: {},
    projects: o.projects, cards: o.cards || [], agents: o.agents || [], activity: o.activity || {} } } });

const BUSY = board({
  projects: [project('Quire', { repos: ['/r/quire'], running: 1, waiting: 1 }), project('Hush', { repos: ['/r/hush'] }),
             project('Walk', { repos: ['/r/walk'] })],
  cards: [card('k2', { project: 'Quire-id', status: 'asking', ticket: 42, title: 'Stripe keys',
                       detail: 'The test keys work. Use the live ones now, or wait for the review?' }),
          card('k3', { project: 'Quire-id', status: 'running', ticket: 43, title: 'Retry policy' })],
  agents: [agent('k3', { project: 'Quire-id', name: 'Quire', title: 'Retry policy' })],
  activity: { '/r/quire': { at: NOW - 3600, week: 4, today: 1 }, '/r/hush': { at: NOW - DAY, week: 1, today: 0 },
              '/r/walk': { at: NOW - 35 * DAY, week: 0, today: 0 } },
});
const CALM = board({ projects: [project('Quire', { repos: ['/r/quire'] })],
  activity: { '/r/quire': { at: NOW - 3600, week: 4, today: 1 } } });

let calls = [];
let draft = { ...C.NO_DRAFT };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function stand(fleet = BUSY, o = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.menus.reset();
  calls = [];
  draft = { ...C.NO_DRAFT, picks: {} };
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: fleet.state }, host: { id: 'h1' }, conn: 'online',
    loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
    catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: '' }, { id: 'sonnet', label: 'Sonnet 5', hint: '' }],
                         efforts: ['low', 'high'], perm_modes: ['default', 'bypass'] } },
    defaults: { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: '/r/home',
                byProvider: { claude: { model: 'opus', effort: 'high', perm_mode: 'default', account_id: '' } } },
    accounts: [{ id: 'default-claude', provider: 'claude', label: 'own', logged_in: true, is_default: true, detail: '' },
               { id: 'a2', provider: 'claude', label: 'yakup@', logged_in: true, is_default: false, detail: '' }],
    accountsLoaded: true, loadAccounts: async () => {},
    limits: o.limits ?? { 'default-claude': [{ window: '7d', status: 'allowed', utilization: 0.91, resets_at: null }] },
    projects: [{ path: '/r/quire', name: 'quire', is_git: true }],
    listAgents: async () => [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true }],
    createChat: async (d) => { calls.push(['chat.create', d]); return { id: 'new1' }; },
    send: async (id, text) => { calls.push(['chat.send', { id, text }]); },
    createCard: async (w) => { calls.push(['divan.card.create', w]); },
    answerCard: async (w, text) => { calls.push(['ustabasi.note', { ...w, text }]); },
    moveCard: async (w) => { calls.push(['divan.card.move', w]); return { error: null }; },
    compose: draft,
    setCompose: (patch) => { draft = { ...draft, ...patch }; R.store.set({ compose: draft }); },
  });
  return R.render('dark', h(Dashboard));
}
const draw = () => R.render('dark', h(Dashboard));
const press = (find) => {
  const all = R.presses().filter(find);
  if (all.length !== 1) throw new Error(`press: ${all.length} of them`);
  all[0].press();
};
const label = (l) => (x) => x.label === l;
const chip = (name) => (x) => x.text.startsWith(name) && x.text !== name;
const ASKERS = ['/new-chat', '/model-sheet', '/host-sheet', '/agents', '/accounts'];

const checks = [];

(async () => {
  // 1 · Ask
  stand();
  R.typeInto('cmLabel', 'ship the beta tonight');
  draw();
  press(label('cmSend'));
  await flush();
  checks.push(['Ask: one press sends chat.create then chat.send with the words and lands in that chat, with no sheet or picker in between',
    calls.map((c) => c[0]).join(',') === 'chat.create,chat.send' && calls[1][1].text === 'ship the beta tonight'
    && calls[1][1].id === 'new1' && JSON.stringify(R.nav.pushed()) === '["/chat/new1"]'
    && R.menus.all().length === 0 && !R.nav.pushed().some((p) => ASKERS.includes(p))]);

  // 2 · Ice Box and Start now
  const filed = [];
  for (const [mode, column] of [['cmIce', 'ice_box'], ['cmNow', 'in_progress']]) {
    stand();
    R.pressOn(mode);
    draw();
    R.typeInto('cmLabel', '@quire write the retry doc');
    draw();
    press(label('cmSend'));
    await flush();
    filed.push({ column, calls, pushed: R.nav.pushed(), menus: R.menus.all().length });
  }
  checks.push(['Ice Box files the card into Ice Box and Start now into In Progress, starting no chat and asking nothing',
    filed.every((f) => f.calls.length === 1 && f.calls[0][0] === 'divan.card.create'
      && f.calls[0][1].host === 'h1' && f.calls[0][1].card.project_id === 'Quire-id'
      && f.calls[0][1].card.title === 'write the retry doc' && f.calls[0][1].card.column === f.column
      && f.pushed.length === 0 && f.menus === 0)]);

  // 3 · the four chips
  const home = stand();
  const values = ['cmProject: cmAuto', 'cmAgent: cmHermes', 'cmAccount: cmOwnAccount', 'cmModel: Opus 5']
    .every((v) => home.includes(`data-label="${v}`));
  press(chip('cmModel'));
  await flush();
  const listed = R.menus.last().items.map((i) => i.label);
  R.menus.last().items.find((i) => i.label === 'Sonnet 5').onPress();
  draw();
  press(chip('cmAccount'));
  await flush();
  R.menus.last().items.find((i) => i.label === 'yakup@').onPress();
  const changed = draw();
  const marked = changed.includes('data-label="cmModel: Sonnet 5"') && changed.includes('data-label="cmAccount: yakup@"')
    && R.presses().filter(label('cmReset')).length === 2;
  R.typeInto('cmLabel', 'which plan am I on');
  draw();
  press(label('cmSend'));
  await flush();
  const made = calls.find((c) => c[0] === 'chat.create')?.[1] ?? {};
  const after = draw();
  checks.push(['four chips show the defaults, list what the computer reports, mark a changed one with an ×, and that is what chat.create carries',
    values && JSON.stringify(listed) === '["Opus 5","Sonnet 5"]' && marked
    && made.model === 'sonnet' && made.account_id === 'a2' && made.agent_id === 'hermes'
    && after.includes('data-label="cmModel: Opus 5"')]);

  // 4 · @project is the scope chip
  stand();
  R.typeInto('cmLabel', '@quire why is the retry policy like this ');
  const typed = draw();
  const typedScope = draft.picks.project;
  const left = draft.text;
  stand();
  press((x) => x.text === 'cmAddProject');
  await flush();
  R.menus.last().items.find((i) => i.label === 'Quire').onPress();
  const pressed = draw();
  R.typeInto('cmLabel', 'why is the retry policy like this');
  draw();
  press(label('cmSend'));
  await flush();
  const scoped = calls.find((c) => c[0] === 'chat.create')?.[1] ?? {};
  const chipOf = (m) => (m.match(/data-label="cmClearScope"[\s\S]*?>Quire</) ?? [''])[0];
  checks.push(['typing @quire makes the same scope chip as pressing + project, and the chat opens in that project',
    typedScope === 'quire' && draft.picks.project === undefined && left === 'why is the retry policy like this '
    && chipOf(typed) !== '' && chipOf(typed) === chipOf(pressed) && scoped.cwd === '/r/quire']);

  // 5 · Needs you
  const calm = stand(CALM);
  const busy = stand(BUSY);
  press((x) => x.text === 'Use the live ones now');
  await flush();
  const note = calls.find((c) => c[0] === 'ustabasi.note');
  draw();
  press((x) => x.text === 'cmOpen');
  checks.push(['Needs you is absent with nothing waiting; the amber answer sends the Waiting screen’s note in one press, and Open goes to the ticket',
    !calm.includes('>needsYou<') && busy.includes('>needsYou<')
    && note && note[1].ticket === 42 && note[1].host === 'h1' && note[1].text === 'Use the live ones now'
    && JSON.stringify(R.nav.pushed()) === '["/card/k2?host=h1&from=dashboard"]']);

  // 6 · tiles and the line
  const tiles = stand(BUSY);
  const order = R.presses().filter((x) => ['Quire', 'Hush', 'Walk'].includes(x.label)).map((x) => x.label);
  const dim = /data-label="Walk"[\s\S]*?cmQuiet/.test(tiles);
  press(label('Quire'));
  const entered = draw();
  const calmLine = stand(CALM);
  checks.push(['tiles open the project, the dormant one comes last as a dimmed row, and the line counts from the boards and says nothing is stuck at zero',
    JSON.stringify(order) === '["Quire","Hush","Walk"]' && dim && entered.includes('>pjChats<')
    && tiles.includes('>cmNeedsOne<') && tiles.includes('>cmWorking<') && tiles.includes('>cmStuckNone<')
    && calmLine.includes('>cmNeedsNone<') && calmLine.includes('>cmStuckNone<')]);

  // 7 · back, relaunch, and every old destination
  stand(BUSY);
  R.params.set({ project: 'quire' });
  const inside = draw();
  press(label('cmBackTo'));
  const out = draw();
  R.params.reset();
  const wanted = ['tabChat', 'tabMachine'];
  const fromHome = R.presses();
  const reach = wanted.every((w) => fromHome.some(label(w)))
    && fromHome.some((x) => x.text === 'waitTitle') && fromHome.some((x) => x.text === 'cmMore')
    && fromHome.some((x) => x.text.startsWith('conversations'));
  R.params.set({ project: 'quire' });
  const relaunched = R.render('dark', h(Dashboard));
  const fromProject = wanted.every((w) => R.presses().some(label(w)));
  R.params.reset();
  R.render('dark', h(Waiting));
  const fromWaiting = wanted.every((w) => R.presses().some(label(w)));
  checks.push(['the line leads from a project back to the Dashboard, the address redraws the page it names, and Chat, Machine, Waiting, the chats and every new-chat option stay one press away',
    inside.includes('>pjChats<') && out.includes('>cmNeedsOne<') && relaunched.includes('>pjChats<')
    && reach && fromProject && fromWaiting]);

  // 8 · low quota
  const low = stand(BUSY);
  R.typeInto('cmLabel', 'is the plan nearly spent');
  draw();
  press(label('cmSend'));
  await flush();
  const sent = calls.map((c) => c[0]).join(',');
  const asked = R.menus.all().length + R.nav.pushed().filter((p) => ASKERS.includes(p)).length;
  const ample = stand(BUSY, { limits: { 'default-claude': [{ window: '7d', status: 'allowed', utilization: 0.3, resets_at: null }] } });
  checks.push(['the account in use under the line carries an amber dot and the words, and the send still asks nothing',
    low.includes('data-label="cmAccount: cmOwnAccount, cmLowQuota"') && low.includes('>cmLowQuota<')
    && !ample.includes('cmLowQuota') && sent === 'chat.create,chat.send' && asked === 0]);
  R.store.reset();
  R.params.reset();
  R.nav.reset();
})().then(() => {
  module.exports.done = true;
}).catch((e) => { checks.push([`the composer checks ran (${e.message})`, false]); module.exports.done = true; });

module.exports = { checks, done: false, ready: () => new Promise((r) => {
  const wait = () => (module.exports.done ? r() : setTimeout(wait, 5));
  wait();
}) };

if (require.main === module) {
  module.exports.ready().then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
