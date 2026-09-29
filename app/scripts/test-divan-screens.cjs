/** The eight screens Divan drew no frame for, stood up in both themes on every
 *  face they have, with no data, with stale data and with an unreachable machine.
 *  Plus their one judgement: what a pairing code is taken to be. */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const h = R.React.createElement;

const K = require(path.join(root, 'src/tokens.ts'));
const P = require(path.join(root, 'src/pair.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = Math.floor(Date.now() / 1000);

const FILES = {
  welcome: 'app/welcome.tsx',
  pair: 'app/pair.tsx',
  accounts: 'app/accounts.tsx',
  'agent-store': 'app/agent-store.tsx',
  'agent-install': 'app/agent-install.tsx',
  settings: 'app/settings.tsx',
  'model-sheet': 'app/model-sheet.tsx',
  'host-sheet': 'app/host-sheet.tsx',
};
const SCREENS = Object.fromEntries(Object.entries(FILES)
  .map(([name, file]) => [name, require(path.join(root, file)).default]));

// ── what the phone knows ────────────────────────────────────────────────────

// An agent brings its own colour, the way a project's monogram does.
const AGENT_COLOUR = '#7A4475';
const ITEM = 'hermes:assistant';
const SOURCE = {
  id: 'hermes', label: 'hermes', repo: 'yakubilik/hermes', note: '', items: [
    { id: ITEM, kind: 'bundle', skills: 9, label: 'Hermes', glyph: 'H',
      color: AGENT_COLOUR, repo: 'yakubilik/hermes' },
  ],
};
const INSTALLED = { id: 'hermes:assistant', name: 'hermes', label: 'Hermes', description: '',
                    color: AGENT_COLOUR, glyph: 'H', model: null, scope: 'user' };

const ACCOUNTS = [
  { id: 'own', provider: 'claude', label: 'own', logged_in: true, detail: 'max · yakup', is_default: true },
  { id: 'a2', provider: 'claude', label: 'work', logged_in: false, detail: '', is_default: false },
  { id: 'a3', provider: 'claude', label: 'personal', logged_in: true, detail: 'pro', is_default: false },
  { id: 'a4', provider: 'codex', label: 'codex', logged_in: true, detail: 'plus', is_default: false },
];
// Codex is the tool this computer has not got.
const TOOLS = [
  { provider: 'claude', version: '1.2.4', path: '/usr/local/bin/claude',
    login_methods: [{ id: 'subscription' }] },
  { provider: 'codex', version: null, path: null, login_methods: [] },
];
const CATALOG = {
  claude: { models: [{ id: 'opus', label: 'Opus 5', hint: 'default' }, { id: 'sonnet', label: 'Sonnet 5', hint: '' }],
            efforts: ['medium', 'high'], perm_modes: ['safe', 'bypass'] },
  codex: { models: [{ id: 'gpt', label: 'Codex', hint: 'default' }],
           efforts: ['low', 'medium', 'high'], perm_modes: ['safe'] },
};
const CHAT = { id: 'c1', group_id: null, title: 'Safari 17 login', provider: 'claude', model: 'opus',
               effort: 'high', perm_mode: 'safe', cwd: '/Users/x/projects/quire',
               provider_session_id: null, account_id: null, status: 'idle', last_preview: '',
               max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0,
               created_at: NOW - 900, updated_at: NOW - 60 };
const HOST_INFO = {
  name: 'studio.local', os: 'Darwin', os_version: '25.3.0', daemon_version: '1.9.0',
  uptime_s: 3 * 86400 + 4 * 3600, active_sessions: 2, connected_devices: 1,
  versions: { claude: '1.2.4', codex: '0.48.0' }, roots: ['/Users/x/projects', '/Users/x/server'],
};
// Behind main with nothing in the way: the one state that offers a button.
const UPDATE = {
  repo: true, auto: false, behind: 4, ahead: 0, busy: false,
  local: { repo: true, commit: 'a1b2c3d', branch: 'main', dirty_files: 0 },
  remote: { commit: 'ffee110', subject: 'The three screens held to their four promises' },
  blockers: [],
};
const PREFS = { faceIdLaunch: false, faceIdBypass: true };
const DEFAULTS = { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'safe',
                   byProvider: {}, agentAccountId: null };

const async0 = () => Promise.resolve();
const nothing = () => {};

const base = () => ({
  hosts: [], activeHostId: null, hostInfo: null, host: null, conn: 'offline', switching: false,
  accounts: [], accountsLoaded: false, tools: [], npmAvailable: false,
  loginPrompt: null, loginBusy: false,
  agents: [], storeSources: [], storeLoaded: false, chats: {},
  catalog: null, defaults: DEFAULTS, prefs: PREFS, device: null, pool: null, pushToken: null,
  updateStatus: null, divan: {},
  addHost: async0, removeHost: async0, switchHost: async0, refreshHost: async0,
  loadAccounts: async0, loadTools: async0, loadStore: async0, installTool: async0,
  installAgent: async0, createAccount: () => Promise.resolve(ACCOUNTS[1]), deleteAccount: async0,
  logoutAccount: async0, renameAccount: async0, setDefaults: async0, setPrefs: async0,
  setDevicePrefs: async0, authenticate: () => Promise.resolve(true), updateChat: async0,
  checkUpdate: async0, applyUpdate: () => Promise.resolve({ ok: true }), loadDivan: nothing,
  ustabasi: null, ustabasiOld: false, loadUstabasi: nothing,
});

const answering = () => ({
  ...base(),
  hosts: [{ id: 'h1', name: 'studio', host: '100.64.1.2', port: 8790 },
          { id: 'h2', name: 'mini', host: '100.64.1.3', port: 8790 }],
  activeHostId: 'h1', hostInfo: HOST_INFO, host: { id: 'h1', name: 'studio' }, conn: 'online',
  accounts: ACCOUNTS, accountsLoaded: true, tools: TOOLS, npmAvailable: true,
  storeSources: [SOURCE], storeLoaded: true, chats: { c1: CHAT },
  catalog: CATALOG, device: { push_approval: true, push_done: false },
  pool: { enabled: true }, pushToken: 'ExponentPushToken[x]', updateStatus: UPDATE,
});

const STATES = {
  'no data': base,
  'a computer answering': answering,
  'stale data': () => ({ ...answering(), conn: 'connecting',
    updateStatus: { ...UPDATE, checked_at: NOW - 6 * 3600, blockers: ['uncommitted changes'] } }),
  'an unreachable machine': () => ({
    ...base(),
    hosts: [{ id: 'h3', name: 'cloud', host: '100.64.1.9', port: 8790 }],
    activeHostId: 'h3', conn: 'offline', host: { id: 'h3', name: 'cloud' },
    accountsLoaded: true, tools: TOOLS, npmAvailable: false, storeLoaded: true,
    storeSources: [{ ...SOURCE, items: [], error: 'could not reach github.com' }],
    catalog: CATALOG, pool: { enabled: false }, chats: { c1: CHAT },
    updateStatus: { repo: true, auto: true, behind: 0, ahead: 0, busy: false,
                    local: { repo: true, commit: 'a1b2c3d', branch: 'main', dirty_files: 2 },
                    remote: null, blockers: ['already up to date'] },
  }),
};

// A face is an address, a camera or a patch of the store, and the words that
// say the render is that face and not another.
const FACES = {
  welcome: [['the first step', {}, ['welStep1', 'welCopy']]],
  pair: [['the viewfinder', { camera: 'granted' }, ['pairPoint', 'pairManualBtn']],
         ['the camera refused', { camera: 'denied' }, ['pairCameraOff', 'pairHost', 'pairToken']],
         ['the camera not asked yet', { camera: null }, ['pairAddTitle', 'pairPoint']]],
  accounts: [['the sign-ins', {}, ['accounts', 'addAccount', 'cliMissing', 'moveFromAnother']]],
  'agent-store': [['what can be added', {}, ['addAgent', 'Hermes']]],
  'agent-install': [
    ['an account to pick', { at: { id: ITEM } }, ['installInto', 'hermesPickAccount']],
    ['nobody signed in to install under',
      { at: { id: ITEM }, store: { accounts: [ACCOUNTS[0], ACCOUNTS[1], ACCOUNTS[3]] } },
      ['hermesNeedsAccount', 'goToAccounts']],
    ['an account chosen', { at: { id: ITEM }, store: { defaults: { ...DEFAULTS, agentAccountId: 'own' } } },
      ['installInto', 'installNamed']],
    ['already installed', { at: { id: ITEM }, store: { agents: [INSTALLED] } },
      ['hStep1', 'hStep2', 'hStep3', 'goToAgents']],
    ['an agent no source knows', { at: { id: 'nobody:nothing' } }, ['aiUnknown']]],
  settings: [['the whole page', {}, ['settings', 'sgComputers', 'sgSoftware', 'sgSecurity', 'sgHost']]],
  'model-sheet': [
    ['the defaults', { at: { defaults: '1' } }, ['defaultsShort', 'forNewChats', 'model', 'permMode']],
    ["one chat's own", { at: { id: 'c1' } },
      ['modelTitle', 'appliesNowShort', 'model', 'effort', 'accountFor', 'permMode', 'moreSettings']],
    ['a chat that is gone', { at: { id: 'gone' } }, ['modelTitle', 'modelNoChat', 'close']]],
  'host-sheet': [['the computers', {}, ['computersTitle', 'hostHint', 'viewScreen', 'addComputer']]],
};

function draw(scheme, name, state, face = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  if (face.camera === 'denied') R.camera.denied();
  else if (face.camera === null && 'camera' in face) R.camera.reset();
  else R.camera.granted();
  R.store.set({ ...STATES[state](), ...(face.store ?? {}) });
  R.params.set(face.at ?? {});
  return R.render(scheme, h(SCREENS[name]));
}

const drawn = {};
const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;

for (const scheme of ['dark', 'light']) {
  const tok = K.tokensFor(scheme);
  const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR, 'transparent',
                       ...K.MONOGRAM, AGENT_COLOUR, `${AGENT_COLOUR}22`]);
  const strayed = new Set();
  const threw = [];
  const silent = [];
  for (const name of Object.keys(SCREENS)) {
    for (const [label, face, says] of FACES[name]) {
      for (const state of Object.keys(STATES)) {
        let markup;
        try { markup = draw(scheme, name, state, face); }
        catch (e) { threw.push(`${name} · ${label} · ${state}: ${e.message}`); continue; }
        drawn[`${scheme}:${name}:${label}:${state}`] = markup;
        for (const v of R.paint(markup)) {
          const inside = v.match(COLOUR) ?? [];
          for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) if (!own.has(c)) strayed.add(c);
        }
      }
      const full = drawn[`${scheme}:${name}:${label}:a computer answering`] ?? '';
      for (const word of says) if (!full.includes(word)) silent.push(`${name} · ${label}: ${word}`);
    }
  }
  checks.push([`${scheme}: every face of the eight stands up with no data, with stale data and with a machine that cannot be reached, and each face is itself${threw.length ? ` (${threw.join('; ')})` : ''}${silent.length ? ` (missing ${silent.join(', ')})` : ''}`,
    threw.length === 0 && silent.length === 0]);
  checks.push([`${scheme}: and none of them paints a colour the artboards did not name${strayed.size ? ` (${[...strayed].join(', ')})` : ''}`,
    strayed.size === 0]);
}
R.camera.granted();
R.store.reset();
R.params.reset();

// A trademark saying which tool a sign-in is for, not a shape of the old language.
const UI_ALLOWED = ['ProviderBadge'];
{
  const older = [];
  for (const [name, file] of Object.entries(FILES)) {
    const code = src(file);
    if (!/from '\.\.\/src\/components\/divan'/.test(code)) older.push(`${name}: no divan`);
    if (/from '\.\.\/src\/components\/page'/.test(code)) older.push(`${name}: LargeTitlePage`);
    if (/useColors\(/.test(code)) older.push(`${name}: useColors`);
    const ui = code.match(/import \{([^}]*)\} from '\.\.\/src\/components\/ui'/);
    for (const part of (ui ? ui[1].split(',').map((x) => x.trim()).filter(Boolean) : [])) {
      if (!UI_ALLOWED.includes(part)) older.push(`${name}: ${part}`);
    }
  }
  checks.push([`all eight are built out of components/divan and reach for nothing of the app before it${older.length ? ` (${older.join(', ')})` : ''}`,
    older.length === 0]);
}

// Read off the commit the branch started from.
const LED_TO = {
  welcome: ['/pair'],
  pair: [],
  accounts: ['/login-method', '/account-login', '/move-signin'],
  'agent-store': ['/agent-install'],
  'agent-install': ['/accounts'],
  settings: ['/accounts', '/pool', '/pair', '/model-sheet', '/divan-gallery'],
  'model-sheet': ['/chat-settings'],
  'host-sheet': ['/screen', '/pair'],
};

function press(text) {
  const found = R.presses().filter((p) => p.text.includes(text));
  return found.length ? (found[0].press(), true) : false;
}
function pressNamed(name) {
  const found = R.presses().filter((p) => p.label === name);
  return found.length === 1 ? (found[0].press(), true) : false;
}
const wentTo = (p) => R.nav.pushed().find((x) => x && x.pathname === p);

{
  const lost = [];
  for (const [name, routes] of Object.entries(LED_TO)) {
    const code = src(FILES[name]);
    const found = new Set();
    for (const m of code.matchAll(/router\.(?:push|replace)\(\s*['"`](\/[\w\-/[\]]+)['"`]/g)) found.add(m[1]);
    for (const m of code.matchAll(/pathname:\s*['"`](\/[\w\-/[\]]+)['"`]/g)) found.add(m[1]);
    for (const r of routes) if (!found.has(r)) lost.push(`${name} → ${r}`);
  }

  draw('dark', 'accounts', 'a computer answering');
  const signIn = press('signIn') && wentTo('/login-method');

  draw('dark', 'agent-store', 'a computer answering');
  const opened = press('Hermes') && wentTo('/agent-install');

  draw('dark', 'settings', 'a computer answering');
  const pairing = press('addComputer') && wentTo('/pair');
  press('accounts');
  press('pool');
  const rows = R.nav.pushed().map((x) => (typeof x === 'string' ? x : x.pathname));

  const asked = [];
  draw('dark', 'agent-install', 'a computer answering',
    { at: { id: ITEM },
      store: { defaults: { ...DEFAULTS, agentAccountId: 'own' },
               installAgent: (id, account) => { asked.push([id, account]); return Promise.resolve(); } } });
  press('installNamed');

  const wrote = [];
  draw('dark', 'settings', 'a computer answering', { store: { setDevicePrefs: (p) => { wrote.push(p); return Promise.resolve(); } } });
  const flipped = pressNamed('pushApproval');

  const switched = [];
  draw('dark', 'host-sheet', 'a computer answering', { store: { switchHost: (id) => switched.push(id) } });
  press('mini');

  checks.push([`every way through the eight still leads and still writes where it did${lost.length ? ` (lost ${lost.join(', ')})` : ''}`,
    lost.length === 0
    && !!signIn && signIn.params.id === 'a2' && signIn.params.provider === 'claude'
    && !!opened && opened.params.id === ITEM
    && !!pairing && pairing.params.add === '1'
    && rows.includes('/accounts') && rows.includes('/pool')
    && eq(asked, [[ITEM, 'own']])
    && flipped && wrote.length === 1 && wrote[0].push_approval === false
    && eq(switched, ['h2'])]);
}

checks.push(
  ['a pairing code is still read the way `remote-ai-chat pair` prints it, link and payload alike',
    eq(P.parsePairCode('remoteaichat://pair?host=100.64.1.2&port=8791&token=tok%2F1&name=studio&device_id=d1'),
       { host: '100.64.1.2', port: 8791, token: 'tok/1', name: 'studio', device_id: 'd1' })
    && eq(P.parsePairCode('{"host":"100.64.1.3","token":"t2"}'),
          { host: '100.64.1.3', port: P.DEFAULT_PORT, token: 't2', name: '100.64.1.3', device_id: undefined })],
  ['…and half a code is no code: a host with no token pairs with nothing, and neither does anything else',
    P.parsePairCode('remoteaichat://pair?host=100.64.1.2') === null
    && P.parsePairCode('{"host":"100.64.1.2"}') === null
    && P.parsePairCode('https://example.com') === null
    && P.parsePairCode('') === null],
);

// A field's `placeholder` is not one of these: it says what goes in the box.
const STUB = /coming soon|not implemented|not available yet|nothing here yet|lorem ipsum|\bTODO\b|\bTBD\b/i;
const EMPTY = {
  welcome: ['welStep1', 'welTitle1'],
  pair: ['pairTitle', 'pairPoint'],
  accounts: ['accounts', 'addAccount'],
  'agent-store': ['addAgent', 'asLoading'],
  'agent-install': ['addAgent', 'asLoading'],
  settings: ['settings', 'sgComputers', 'addComputer'],
  'model-sheet': ['defaultsShort'],
  'host-sheet': ['computersTitle', 'addComputer'],
};
{
  const stubbed = Object.entries(drawn).filter(([, m]) => STUB.test(m)).map(([k]) => k)
    .concat(Object.entries(FILES).filter(([, f]) => STUB.test(src(f))).map(([n]) => `${n} (source)`));
  const mute = [];
  for (const [name, words] of Object.entries(EMPTY)) {
    const first = FACES[name][0][0];
    const markup = drawn[`dark:${name}:${first}:no data`] ?? '';
    for (const w of words) if (!markup.includes(w)) mute.push(`${name}: ${w}`);
  }
  checks.push([`nothing on any of the eight is a placeholder, and a phone with nothing on it is told what each page is and what it is missing${stubbed.length ? ` (${stubbed.join(', ')})` : ''}${mute.length ? ` (silent ${mute.join(', ')})` : ''}`,
    stubbed.length === 0 && mute.length === 0]);
}

module.exports = { checks };

if (require.main === module) {
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ok    ' : '  FAIL  ') + name);
    if (!ok) bad++;
  }
  console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
