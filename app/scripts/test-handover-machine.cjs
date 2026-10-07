/** The phone's Branch, Chat and Machine (HANDOVER §4.7, §4.8, §4.9), one check
 *  per criterion of ustabasi #127.
 *
 *  Run: node scripts/test-handover-machine.cjs  (also folded into test-ustabasi.cjs.)
 */
const Module = require('module');
const path = require('path');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

// The native half of an incoming call: what `src/incoming-call.ts` listens to.
const RINGS = {};
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request.endsWith('/modules/call') || request === '../modules/call') {
    return { callAvailable: true, onCallEvent: (name, fn) => { RINGS[name] = fn; } };
  }
  return beneath.call(this, request, parent, isMain);
};

const K = require(path.join(root, 'src/tokens.ts'));
const C = require(path.join(root, 'src/compose.ts'));
const Conversation = require(path.join(root, 'app/chat/[id].tsx')).Conversation;
const ChatPlace = require(path.join(root, 'app/chat/index.tsx')).default;
const Machine = require(path.join(root, 'app/machine.tsx')).default;
const Executors = require(path.join(root, 'app/executors.tsx')).default;
const Terminal = require(path.join(root, 'app/terminal.tsx')).default;
const Settings = require(path.join(root, 'app/settings.tsx')).default;
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;
const Branch = require(path.join(root, 'app/branch/[id].tsx')).default;
const Pair = require(path.join(root, 'app/pair.tsx')).default;
const AccountLogin = require(path.join(root, 'app/account-login.tsx')).default;
const Call = require(path.join(root, 'app/call.tsx')).default;
const Incoming = require(path.join(root, 'src/incoming-call.ts'));

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const one = (pred) => {
  const found = R.presses().filter(pred);
  if (found.length !== 1) throw new Error(`press: ${found.length} of them`);
  return found[0];
};

// ── a fleet: studio answering with one agent at work, mini silent for 3h ────
const branch = (kind, name, o = {}) => ({ id: `${kind}-id`, kind, name, summary: o.summary ?? '',
  summary_at: o.at ?? null, cards: o.cards ?? {}, open: o.open ?? 0 });
const project = (o = {}) => ({ id: 'quire-id', name: 'Quire', slug: 'quire', summary: '', kind: 'web',
  repos: ['/r/quire'], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60, counts: { in_progress: 1 },
  running: 1, waiting: 0, summary_line: '',
  branches: [branch('engineering', 'Engineering', { summary: 'Bulk invite is three checks in.', at: NOW - 600,
                                                     cards: { in_progress: 1, done: 2 }, open: 3 }),
             branch('seo', 'SEO')], ...o });
const card = (id, o = {}) => ({ id, project_id: 'quire-id', branch_id: 'engineering-id', branch: 'engineering',
  column: o.column ?? 'in_progress', position: 0, title: o.title ?? id, summary: '', executor: 'coding_agent',
  machine: null, repo: '/r/quire', ustabasi_id: o.ticket ?? null, agent_status: o.status ?? 'running',
  agent_status_at: NOW - 300, agent_detail: o.detail ?? '', created_at: NOW - 86400, updated_at: NOW - 300,
  moved_at: NOW - 600 });
const quota = (left) => ({ enabled: true, accounts: 1, blocked: 0, spent: false, left, resets_at: NOW + 2 * HOUR, unknown: false });
const studio = (left = 0.64) => ({ at: NOW, reachable: true, error: null, old: false, snapshot: {
  machine: 'studio', os: 'Darwin', at: NOW, quota: quota(left), queue: {}, activity: {},
  projects: [project()],
  cards: [card('k1', { ticket: 41, title: 'Webhook retry policy', detail: 'Wrote the retry table.' })],
  agents: [{ card_id: 'k1', project_id: 'quire-id', project: 'Quire', branch: 'engineering', title: 'Webhook retry policy',
             executor: 'coding_agent', machine: 'studio', status: 'running', detail: '', since: NOW - 300, ustabasi_id: 41 }] } });
const mini = () => ({ at: NOW - 3 * HOUR, reachable: false, error: 'connection refused', old: false, snapshot: {
  machine: 'mini', os: 'Darwin', at: NOW - 3 * HOUR, quota: null, queue: {}, activity: {}, projects: [], cards: [], agents: [] } });

// ── a conversation: filed under Quire, two tickets filed, an approval open ──
const CHAT = (id, o = {}) => ({ id, group_id: null, title: o.title ?? 'Refunds', provider: 'claude', model: 'opus',
  effort: 'high', perm_mode: 'default', cwd: '/r/quire', provider_session_id: 's', account_id: null,
  status: o.status ?? 'idle', last_preview: o.preview ?? 'ok', max_turns: null, max_budget_usd: null, total_cost_usd: 0,
  pinned: 0, archived: 0, created_at: NOW - HOUR, updated_at: o.at ?? NOW - 60, project_id: o.project ?? null });
const ev = (seq, event, data) => ({ event, chat_id: 'c1', seq, ts: NOW - 600 + seq, data });
const TURN = [
  ev(1, 'message.user', { text: 'Students keep asking about refunds.',
    attachments: [{ path: '/tmp/refunds.png', name: 'refunds.png', kind: 'image' },
                  { path: '/tmp/note.m4a', name: 'note.m4a', kind: 'audio', duration: 4, transcript: 'about refunds' }] }),
  ev(2, 'message.assistant', { text: 'Agreed. I put it in Ice Box.' }),
  ev(3, 'tool.use', { id: 't1', tool: 'Bash', input: { command: 'ustabasi add retry.json' } }),
  ev(4, 'tool.result', { id: 't1', output: '#41 queued: Webhook retry policy  (worker opus, verifier opus)' }),
  ev(5, 'tool.use', { id: 't2', tool: 'Write', input: { file_path: '/tmp/x' } }),
  ev(6, 'tool.use', { id: 't3', tool: 'Bash', input: { command: 'ustabasi add refund.json' } }),
  ev(7, 'tool.result', { id: 't3', output: '#99 queued: Refund policy page  (worker opus, verifier opus)' }),
  ev(8, 'approval.request', { request_id: 'r9', tool: 'Bash', input: { command: 'git push' }, preview: 'git push', danger: false }),
];

let calls = [];
let defaults;
function stand(o = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.menus.reset();
  calls = [];
  defaults = o.defaults ?? { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: '/r/quire',
    byProvider: { claude: { model: 'opus', effort: 'high', perm_mode: 'default', account_id: '' } } };
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio', host: '100.64.0.1', port: 8790 }, { id: 'h2', name: 'mini', host: '100.64.0.2', port: 8790 }],
    activeHostId: 'h1', host: { id: 'h1', name: 'studio' }, conn: 'online',
    divan: { h1: o.studio ?? studio(), h2: mini() }, loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
    chats: o.chats ?? { c1: CHAT('c1', { project: 'quire-id', at: NOW - 10 }), c2: CHAT('c2', { title: 'Safari login', at: NOW - 900 }) },
    events: { c1: TURN, c2: [] }, agentActivity: {}, live: {}, thinking: {}, progress: {}, busy: { c1: !!o.busy }, loadedChats: { c1: true, c2: true },
    limits: {}, groups: [], showArchived: false, chatsLoaded: true, switching: false,
    prefs: { chatView: 'flat', voiceIds: {} }, hostInfo: { name: 'studio', os: 'Darwin', os_version: '25', daemon_version: '1',
      versions: { claude: '1' }, roots: ['/r'], uptime_s: 1, active_sessions: 1, transcription: true },
    catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: '' }, { id: 'sonnet', label: 'Sonnet 5', hint: '' }],
                         efforts: ['low', 'high'], perm_modes: ['default', 'bypass'] } },
    defaults,
    accounts: [{ id: 'default-claude', provider: 'claude', label: 'own', logged_in: true, is_default: true, detail: '' },
               { id: 'a2', provider: 'claude', label: 'yakup@', logged_in: true, is_default: false, detail: '' }],
    accountsLoaded: true, loadAccounts: async () => {}, projects: [{ path: '/r/quire', name: 'quire', is_git: true }],
    pool: null, device: null, pushToken: null, updateStatus: null, tools: [], loginPrompt: null, loginDone: null,
    loginSubmitting: false,
    openChat() {}, settleLive() {}, refresh: async () => {}, loadProjects: async () => {}, refreshHost: async () => {},
    checkUpdate: async () => {}, applyUpdate: async () => ({ ok: true }),
    send: async (id, text) => { calls.push(['chat.send', { id, text }]); },
    interrupt: async (id) => { calls.push(['chat.interrupt', { id }]); },
    respond: async (id, request_id, decision) => { calls.push(['approval.respond', { id, request_id, decision }]); },
    uploadAttachment: async () => null, updateChat: async () => {}, deleteChat: async () => {},
    createGroup: async () => ({ id: 'g' }), renameGroup: async () => {}, deleteGroup: async () => {},
    createChat: async (d) => { calls.push(['chat.create', d]); return { id: 'n1' }; },
    setShowArchived() {}, setPrefs: async () => {}, setDevicePrefs: async () => {},
    switchHost: async () => {}, removeHost: async () => {}, authenticate: async () => true,
    setDefaults: async (patch) => { defaults = { ...defaults, ...patch }; calls.push(['setDefaults', patch]); R.store.set({ defaults }); },
    addHost: async (cfg) => { calls.push(['addHost', cfg]); },
    startLogin: async (id, d) => { calls.push(['account.login', { account_id: id, ...d }]); },
    submitLoginCode: async () => {}, cancelLogin: async () => {},
    listAgents: async () => [{ id: 'hermes', name: 'hermes', label: 'Hermes', installed: true }],
    compose: { ...C.NO_DRAFT, picks: {} }, setCompose() {}, drafts: {}, setDraft() {},
    createCard: async () => {}, answerCard: async () => {}, moveCard: async () => ({ error: null }),
  });
  if (o.params) R.params.set(o.params);
}

const checks = [];

const ready = (async () => {
  R.words.real();
  try {
    const dark = K.tokensFor('dark');

    // 1 · the conversation: bubble, plain answer, approval, interrupt, picture, voice note, mic
    {
      stand({ busy: true });
      const page = R.render('dark', h(Conversation, { id: 'c1' }));
      const bubble = R.styles(page).some((s) => s.backgroundColor === dark.s2 && s.borderBottomRightRadius === 6);
      const right = R.styles(page).some((s) => s.alignSelf === 'flex-end' && s.maxWidth === '80%');
      const answer = page.includes('Agreed. I put it in Ice Box.');
      one((p) => p.text === 'Allow').press();
      one((p) => p.label === 'Stop').press();
      await flush();
      // The waveform's bars and the transcript; its speed chip and scrub are
      // pressed in test-voicenote.cjs, where a note is playing.
      const voice = R.styles(page).filter((s) => s.width === 2.5).length >= 10 && page.includes('about refunds');
      const picture = R.styles(page).some((s) => s.width === 230 && s.height === 170);
      const sent = calls.slice();
      stand();
      const idle = R.render('dark', h(Conversation, { id: 'c1' }));
      const mic = R.presses().some((p) => p.label === 'Record a voice note' || p.label === 'Record');
      checks.push(['phone: the user is a right-hand --glass-2 bubble, Hermes plain text; Allow sends approval.respond, Stop sends chat.interrupt; the picture, the voice note bubble and the mic are there',
        bubble && right && answer && voice && mic && picture && !!idle
        && sent.some(([t, d]) => t === 'approval.respond' && d.request_id === 'r9' && d.decision === 'allow')
        && sent.some(([t, d]) => t === 'chat.interrupt' && d.id === 'c1')]);
    }

    // 2 · filed under, and the card links
    {
      stand();
      const page = R.render('dark', h(Conversation, { id: 'c1' }));
      const rule = page.includes('filed under Quire');
      R.nav.reset();
      one((p) => p.label === 'In Progress: Webhook retry policy').press();
      R.render('dark', h(Conversation, { id: 'c1' }));
      one((p) => p.label === 'Queued: Refund policy page').press();
      const went = R.nav.pushed();
      checks.push(['phone: a chat filed under a project shows the thin rule, and a card it filed is a small link that opens the ticket',
        rule && eq(went, ['/card/k1?host=h1&from=chat', '/ticket/99?from=chat'])]);
    }

    // 3 · the Chat place is the list; a chat's back comes back to it
    {
      stand();
      const list = R.render('dark', h(ChatPlace));
      const landed = R.nav.replaced();
      const rows = list.includes('Refunds') && list.includes('Safari login');
      stand();
      R.render('dark', h(Conversation, { id: 'c1' }));
      R.nav.reset();
      one((p) => p.label === 'Back').press();
      const back = R.nav.replaced();
      stand();
      const cold = R.render('dark', h(Conversation, { id: 'c2' }));
      stand({ chats: {} });
      const none = R.render('dark', h(ChatPlace));
      R.typeInto('Talk to Hermes', 'hello');
      checks.push(['phone: the Chat place is the list of chats, a chat opened cold goes back to it, /chat/<id> draws one cold, and with none there is a box to talk into',
        eq(landed, []) && rows && eq(back, ['/chat']) && cold.includes('Safari login')
        && none.includes('Talk to Hermes')]);
    }

    // 4 · four tabs, each at its own route; every page under one; Terminal opens a chat
    {
      stand();
      for (const label of ['Executors', 'Terminal', 'Settings']) {
        R.render('dark', h(Machine));
        one((p) => p.text === label).press();
      }
      const tabs = R.nav.replaced();
      const pages = [];
      for (const [Screen, title] of [[Machine, 'Remote screen'], [Executors, 'Agents'], [Executors, 'Accounts & sign-ins'],
                                     [Executors, 'Sign-in pool'], [Terminal, 'Ticket queue'], [Settings, 'Call']]) {
        stand();
        R.render('dark', h(Screen));
        one((p) => p.text.startsWith(title)).press();
        pages.push(...R.nav.pushed());
      }
      stand();
      R.render('dark', h(Terminal));
      one((p) => p.text.startsWith('Refunds')).press();
      const term = R.nav.pushed();
      checks.push(['phone: Machine has four tabs at their own routes; Screen, Agents, Accounts, the pool, the queue and Call sit under one; Terminal opens a chat to type into',
        eq(tabs, ['/executors', '/terminal', '/settings'])
        && eq(pages, ['/screen', '/agents', '/accounts', '/pool', '/ustabasi', '/call']) && eq(term, ['/chat/c1'])]);
    }

    // 5 · unreachable in red, running by name, the ring
    {
      stand();
      const page = R.render('dark', h(Machine));
      const red = R.styles(page).some((s) => s.color === dark.red);
      stand({ studio: studio(0.1) });
      const low = R.render('dark', h(Machine));
      checks.push(['phone: an unreachable machine says unreachable in red, that its data may be stale, and when it was last seen; an online one what it runs; the ring is the real share and reset, amber with low when low',
        red && page.includes('unreachable') && page.includes('What it last reported may be stale.')
        && page.includes('last seen 3h') && page.includes('Running 1: Webhook retry policy.')
        && page.includes('data-label="64%"') && page.includes('left of the plan') && /resets \d\d:\d\d/.test(page)
        && !page.includes('>low<')
        && low.includes('data-label="10%"') && low.includes('>low<') && R.styles(low).some((s) => s.color === dark.amber)]);
    }

    // 6 · Machine › Settings sets what the next chat's chips show
    {
      stand();
      R.render('dark', h(Settings));
      one((p) => p.text.startsWith('Default model')).press();
      await flush();
      R.menus.last().items.find((i) => i.label === 'Sonnet 5').onPress();
      R.render('dark', h(Settings));
      one((p) => p.text.startsWith('Default account')).press();
      await flush();
      R.menus.last().items.find((i) => i.label === 'yakup@').onPress();
      R.store.set({ defaults });
      const dash = R.render('dark', h(Dashboard));
      checks.push(['phone: the default account and model set in Machine › Settings are what the Composer’s chips show for the next chat',
        dash.includes('data-label="Model: Sonnet 5"') && dash.includes('data-label="Account: yakup@"')]);
    }

    // 7 · a branch page, connected and not
    {
      stand({ params: { id: 'engineering', project: 'quire' } });
      const page = R.render('dark', h(Branch));
      const at = (w) => page.indexOf(w);
      stand({ params: { id: 'seo', project: 'quire' } });
      const bare = R.render('dark', h(Branch));
      checks.push(['phone: a branch is its title, one sentence with Updated <ago>, two or three figures, its list and tickets, then What the agent did; an unconnected one says only Source not connected yet.',
        page.includes('>Engineering<') && /Bulk invite is three checks in\. Updated (just now|.+ ago)\./.test(page)
        && at('Repositories') > 0 && at('Repositories') < at('>Tickets<') && at('>Tickets<') < at('What the agent did')
        && page.includes('Wrote the retry table.')
        && bare.includes('Source not connected yet.') && !bare.includes('>Tickets<') && !bare.includes('What the agent did')
        && !bare.includes('Open')]);
    }

    // 8 · pairing, signing in, answering a call
    {
      stand();
      R.camera.granted();
      R.render('dark', h(Pair));
      R.scans()[0]({ data: 'remoteaichat://pair?host=100.64.1.2&port=8791&token=tok&name=studio' });
      await flush();
      const paired = calls.some(([t, d]) => t === 'addHost' && d.host === '100.64.1.2' && d.token === 'tok')
        && R.nav.replaced().includes('/dashboard');
      R.camera.reset();
      stand({ params: { id: 'a2', provider: 'claude', method: 'subscription' } });
      R.render('dark', h(AccountLogin));
      R.presses().filter((p) => p.text === 'Continue' || p.text === 'Sign in').forEach((p) => p.press());
      await flush();
      const signed = calls.some(([t, d]) => t === 'account.login' && d.account_id === 'a2');
      stand();
      Incoming.startIncomingCalls();
      RINGS.onCallAnswered?.({});
      const rang = R.nav.pushed().includes('/call');
      const call = R.render('dark', h(Call));
      checks.push(['phone: pairing a phone still adds the computer and lands home, signing in still sends account.login, and answering a call still opens the call screen',
        paired && signed && rang && !!call]);
    }
  } finally {
    R.words.keys();
    R.store.reset();
    R.params.reset();
  }
})();

module.exports = { checks, ready, stand };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
