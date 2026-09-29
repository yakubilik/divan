/** The eight screens Divan drew no frame for, carried into its language: all of
 *  them stood up in both themes with no data, with stale data and with a machine
 *  that cannot be reached, and held to the four things the ticket asks —
 *  Divan's parts, Divan's colours only, every way through them still leading
 *  where it led, and no placeholder anywhere.
 */
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

// ── the eight ───────────────────────────────────────────────────────────────

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

// ── what the phone knows, in the three states the ticket names ──────────────

/** The one agent the store offers, with a colour of its own — an agent brings
 *  its colour the way a project's monogram does, and `AgentGlyph` draws the
 *  letter in it over a tint of it. */
const AGENT_COLOUR = '#7A4475';
const SOURCE = {
  id: 'hermes', label: 'hermes', repo: 'yakubilik/hermes', note: '', items: [
    { id: 'hermes:assistant', kind: 'bundle', skills: 9, label: 'Hermes', glyph: 'H',
      color: AGENT_COLOUR, repo: 'yakubilik/hermes' },
  ],
};

const ACCOUNTS = [
  { id: 'own', provider: 'claude', label: 'own', logged_in: true, detail: 'max · yakup', is_default: true },
  { id: 'a2', provider: 'claude', label: 'work', logged_in: false, detail: '', is_default: false },
  { id: 'a3', provider: 'codex', label: 'codex', logged_in: true, detail: 'plus', is_default: false },
];

const TOOLS = [
  { provider: 'claude', version: '1.2.4', path: '/usr/local/bin/claude',
    login_methods: [{ id: 'subscription' }] },
  // Codex is the tool this computer has not got: the one row on the page that
  // is asking for something.
  { provider: 'codex', version: null, path: null, login_methods: [] },
];

const CATALOG = {
  claude: { models: [{ id: 'opus', label: 'Opus 5', hint: 'default' }, { id: 'sonnet', label: 'Sonnet 5', hint: '' }],
            efforts: ['medium', 'high'], perm_modes: ['safe', 'bypass'] },
  codex: { models: [{ id: 'gpt', label: 'Codex', hint: 'default' }],
           efforts: ['low', 'medium', 'high'], perm_modes: ['safe'] },
};

const HOST_INFO = {
  name: 'studio.local', os: 'Darwin', os_version: '25.3.0', daemon_version: '1.9.0',
  uptime_s: 3 * 86400 + 4 * 3600, active_sessions: 2, connected_devices: 1,
  versions: { claude: '1.2.4', codex: '0.48.0' }, roots: ['/Users/x/projects', '/Users/x/server'],
};

/** Behind main, with nothing in the way — the one state of the software block
 *  that offers a button. */
const UPDATE = {
  repo: true, auto: false, behind: 4, ahead: 0, busy: false,
  local: { repo: true, commit: 'a1b2c3d', branch: 'main', dirty_files: 0 },
  remote: { commit: 'ffee110', subject: 'The three screens held to their four promises' },
  blockers: [],
};

const PREFS = { faceIdLaunch: false, faceIdBypass: true };
const DEFAULTS = { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'safe',
                   byProvider: {}, agentAccountId: null };

const nothing = () => {};
const async0 = () => Promise.resolve();

/** Everything a screen can ask the store for, so that what is missing in a
 *  state is missing on purpose. */
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

const STATES = {
  /** A phone that has just been installed: nothing paired, nothing asked for,
   *  nothing answered. */
  'no data': () => base(),

  /** Everything answered, and the computer is there. */
  'a computer answering': () => ({
    ...base(),
    hosts: [{ id: 'h1', name: 'studio', host: '100.64.1.2', port: 8790 },
            { id: 'h2', name: 'mini', host: '100.64.1.3', port: 8790 }],
    activeHostId: 'h1', hostInfo: HOST_INFO, host: { id: 'h1', name: 'studio' }, conn: 'online',
    accounts: ACCOUNTS, accountsLoaded: true, tools: TOOLS, npmAvailable: true,
    storeSources: [SOURCE], storeLoaded: true, agents: [],
    catalog: CATALOG, device: { push_approval: true, push_done: false },
    pool: { enabled: true }, pushToken: 'ExponentPushToken[x]', updateStatus: UPDATE,
  }),

  /** Stale: the computer answered once and the answer is old. The pages still
   *  have the last answer in them, and the socket is no longer up. */
  'stale data': () => ({
    ...STATES['a computer answering'](),
    conn: 'connecting',
    updateStatus: { ...UPDATE, checked_at: NOW - 6 * 3600, blockers: ['uncommitted changes'] },
  }),

  /** A machine that cannot be reached: paired, never answering, and no snapshot
   *  behind any of it. */
  'an unreachable machine': () => ({
    ...base(),
    hosts: [{ id: 'h3', name: 'cloud', host: '100.64.1.9', port: 8790 }],
    activeHostId: 'h3', conn: 'offline', host: { id: 'h3', name: 'cloud' },
    accountsLoaded: true, tools: TOOLS, npmAvailable: false, storeLoaded: true,
    storeSources: [{ ...SOURCE, items: [], error: 'could not reach github.com' }],
    catalog: CATALOG, device: null, pool: { enabled: false },
    updateStatus: { repo: true, auto: true, behind: 0, ahead: 0, busy: false,
                    local: { repo: true, commit: 'a1b2c3d', branch: 'main', dirty_files: 2 },
                    remote: null, blockers: ['already up to date'] },
  }),
};

/** The camera, which only the pairing screen has: its three faces are three
 *  renders and not one. */
const CAMERAS = { granted: () => R.camera.granted(), refused: () => R.camera.denied(),
                  'not asked yet': () => R.camera.reset() };

function draw(scheme, name, state, params = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set(STATES[state]());
  R.params.set(params);
  return R.render(scheme, h(SCREENS[name]));
}

/** Which address each screen needs to be opened at. `agent-install` is opened
 *  on one agent, and the model sheet has two faces — the defaults, and one
 *  chat's own — so both are drawn. */
const AT = {
  'agent-install': { id: 'hermes:assistant' },
  'model-sheet': { defaults: '1' },
};

// ── 1 · every one of them stands up, in both themes, in every state ──────────

const drawn = {};
{
  const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;
  for (const scheme of ['dark', 'light']) {
    const tok = K.tokensFor(scheme);
    // The agent's own colour and the tint `AgentGlyph` lays it over: a thing
    // that brings its colour with it does not follow the page, which is the same
    // licence `ON_COLOUR` and the monogram ramp have.
    const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR, 'transparent',
                         ...K.MONOGRAM, AGENT_COLOUR, `${AGENT_COLOUR}22`]);
    const strayed = new Set();
    let threw = null;
    for (const name of Object.keys(SCREENS)) {
      for (const state of Object.keys(STATES)) {
        for (const [cam, set] of Object.entries(CAMERAS)) {
          // Only the pairing screen has a camera; the others are drawn once.
          if (name !== 'pair' && cam !== 'granted') continue;
          set();
          let markup;
          try { markup = draw(scheme, name, state, AT[name] ?? {}); }
          catch (e) { threw = `${name}, ${state}, camera ${cam}: ${e.message}`; break; }
          drawn[`${scheme}:${name}:${state}${name === 'pair' ? `:${cam}` : ''}`] = markup;
          for (const v of R.paint(markup)) {
            const inside = v.match(COLOUR) ?? [];
            for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) if (!own.has(c)) strayed.add(c);
          }
        }
        if (threw) break;
      }
      if (threw) break;
    }
    checks.push([`${scheme}: all eight stand up with no data, with stale data and with a machine that cannot be reached${threw ? ` (${threw})` : ''}`,
      threw === null]);
    checks.push([`${scheme}: and none of the eight paints a colour the artboards did not name${strayed.size ? ` (${[...strayed].join(', ')})` : ''}`,
      strayed.size === 0]);
  }
  R.camera.granted();
  R.store.reset();
  R.params.reset();
}

const page = (name, state = 'a computer answering') => drawn[`dark:${name}:${state}`] ?? '';

// ── 2 · they are built out of the design system ─────────────────────────────

/** The one thing any of the eight may still take from `components/ui`: the
 *  tool's own app icon. It is a trademark used to say which tool a sign-in is
 *  for, not a shape or a colour of the older language — and where a tool has no
 *  icon to draw it already falls back to the `line2` dashed square the frames
 *  draw an unfilled mark as. Everything else in that file is the older
 *  language, and a screen that still imports one is still speaking it. */
const UI_ALLOWED = ['ProviderBadge'];

{
  const missing = [];
  const older = [];
  for (const [name, file] of Object.entries(FILES)) {
    const code = src(file);
    if (!/from '\.\.\/src\/components\/divan'/.test(code)) missing.push(name);
    if (/from '\.\.\/src\/components\/page'/.test(code)) older.push(`${name}: LargeTitlePage`);
    const ui = code.match(/import \{([^}]*)\} from '\.\.\/src\/components\/ui'/);
    for (const part of (ui ? ui[1].split(',').map((x) => x.trim()).filter(Boolean) : [])) {
      if (!UI_ALLOWED.includes(part)) older.push(`${name}: ${part}`);
    }
    // …and the palette under the names the older screens used, which is the
    // same table but not the design's own sixteen names.
    if (/useColors\(/.test(code)) older.push(`${name}: useColors`);
  }
  checks.push([`every one of the eight is built out of components/divan${missing.length ? ` (${missing.join(', ')} is not)` : ''}`,
    missing.length === 0]);
  checks.push([`…and none of them still reaches for the parts or the palette of the screens before Divan${older.length ? ` (${older.join(', ')})` : ''}`,
    older.length === 0]);
}

// ── 3 · function unchanged ──────────────────────────────────────────────────

/** Every route each of the eight led to before this ticket, read off the commit
 *  the branch started from. A screen that has lost one of them has lost a way
 *  through the app, whatever it looks like now. */
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

{
  const lost = [];
  for (const [name, routes] of Object.entries(LED_TO)) {
    const code = src(FILES[name]);
    const found = new Set();
    for (const m of code.matchAll(/router\.(?:push|replace)\(\s*['"`](\/[\w\-/[\]]+)['"`]/g)) found.add(m[1]);
    for (const m of code.matchAll(/pathname:\s*['"`](\/[\w\-/[\]]+)['"`]/g)) found.add(m[1]);
    for (const r of routes) if (!found.has(r)) lost.push(`${name} → ${r}`);
  }
  checks.push([`every screen each of the eight led to before this ticket it still leads to${lost.length ? ` (lost ${lost.join(', ')})` : ''}`,
    lost.length === 0]);
}

/** …and the same asked of the presses rather than of the source: a tap that
 *  looks right and pushes nowhere is the failure this is for. `pressOn` is not
 *  used — several of these rows carry the same word in two states — so each is
 *  found by the words on it. */
function pressWith(markup, text) {
  const found = R.presses().filter((p) => p.text.includes(text));
  return found.length ? (found[0].press(), true) : false;
}

/** …and one with no words in it, by the name it answers to. */
function pressNamed(name) {
  const found = R.presses().filter((p) => p.label === name);
  return found.length === 1 ? (found[0].press(), true) : false;
}

{
  // Sign-in: the row of an account nobody is signed in to offers the button, and
  // the button opens the method list for that account.
  draw('dark', 'accounts', 'a computer answering');
  const signIn = pressWith(null, 'signIn');
  const toMethod = R.nav.pushed().find((x) => x && x.pathname === '/login-method');
  checks.push(['signing in still starts from the account that is not signed in',
    signIn && !!toMethod && toMethod.params.id === 'a2' && toMethod.params.provider === 'claude']);

  // Install: a store row opens that agent's install page, named.
  draw('dark', 'agent-store', 'a computer answering');
  const tapped = pressWith(null, 'Hermes');
  const toInstall = R.nav.pushed().find((x) => x && x.pathname === '/agent-install');
  checks.push(['the store still opens the agent it was tapped on, and no other',
    tapped && !!toInstall && toInstall.params.id === 'hermes:assistant']);

  // Pairing: the screen a computer is added from is still one press from
  // Settings, and it says it is adding rather than starting.
  draw('dark', 'settings', 'a computer answering');
  const add = pressWith(null, 'addComputer');
  const toPair = R.nav.pushed().find((x) => x && x.pathname === '/pair');
  checks.push(['pairing another computer is still one press from Settings, and it knows it is another',
    add && !!toPair && toPair.params.add === '1']);

  // Settings: the three rows that are a screen of their own still go there.
  draw('dark', 'settings', 'a computer answering');
  pressWith(null, 'accounts');
  pressWith(null, 'pool');
  const went = R.nav.pushed().map((x) => (typeof x === 'string' ? x : x.pathname));
  checks.push(['…and its rows still open the pages behind them',
    went.includes('/accounts') && went.includes('/pool')]);

  // Install: the button installs that agent under the account the page is
  // showing, and asks the computer once.
  {
    const asked = [];
    R.store.reset(); R.params.reset();
    R.store.set({ ...STATES['a computer answering'](),
                  defaults: { ...DEFAULTS, agentAccountId: 'own' },
                  installAgent: (id, account) => { asked.push([id, account]); return Promise.resolve(); } });
    R.params.set({ id: 'hermes:assistant' });
    R.render('dark', h(SCREENS['agent-install']));
    const pressed = pressWith(null, 'installNamed');
    checks.push(['installing an agent still asks the computer for that agent, under the account the page shows',
      pressed && asked.length === 1 && asked[0][0] === 'hermes:assistant' && asked[0][1] === 'own']);
  }

  // Settings: a switch still writes the setting it is beside, and the value it
  // writes is the other one.
  {
    const wrote = [];
    R.store.reset(); R.params.reset();
    R.store.set({ ...STATES['a computer answering'](),
                  setDevicePrefs: (patch) => { wrote.push(patch); return Promise.resolve(); } });
    R.render('dark', h(SCREENS.settings));
    const flipped = pressNamed('pushApproval');
    checks.push(['a switch in Settings still writes the setting it is beside, flipped',
      flipped && wrote.length === 1 && wrote[0].push_approval === false]);
  }

  // The computer picker: picking the one that is not live switches to it, and
  // the sheet's own two rows still go where they went.
  let switched = null;
  R.store.reset(); R.nav.reset();
  R.store.set({ ...STATES['a computer answering'](), switchHost: (id) => { switched = id; } });
  R.render('dark', h(SCREENS['host-sheet']));
  pressWith(null, 'mini');
  checks.push(['the computer picker still switches to the one that was picked', switched === 'h2']);
}

/** The one judgement on the pairing screen, which is also the one thing on it a
 *  script can reach: what a scanned or typed code is taken to be. Everything
 *  else there is a camera and three boxes. */
{
  const LINK = 'remoteaichat://pair?host=100.64.1.2&port=8791&token=tok%2F1&name=studio&device_id=d1';
  checks.push(
    ['a pairing code is still read the way `remote-ai-chat pair` prints it, link and payload alike',
      eq(P.parsePairCode(LINK), { host: '100.64.1.2', port: 8791, token: 'tok/1', name: 'studio', device_id: 'd1' })
      && eq(P.parsePairCode('{"host":"100.64.1.3","token":"t2"}'),
            { host: '100.64.1.3', port: P.DEFAULT_PORT, token: 't2', name: '100.64.1.3', device_id: undefined })],
    ['…and half a code is no code: a host with no token pairs with nothing, and neither does anything else',
      P.parsePairCode('remoteaichat://pair?host=100.64.1.2') === null
      && P.parsePairCode('{"host":"100.64.1.2"}') === null
      && P.parsePairCode('https://example.com') === null
      && P.parsePairCode('') === null],
  );
}

// ── 4 · nothing is a placeholder ────────────────────────────────────────────

/** A screen that has not been carried over says so, in one of these ways. None
 *  of them may be on any of the eight, in any state. (A text field's
 *  `placeholder` is deliberately not one of them — that is a box saying what
 *  goes in it, which is the opposite of a stub.) */
const STUB = /coming soon|not implemented|not available yet|nothing here yet|lorem ipsum|\bTODO\b|\bTBD\b/i;

{
  const stubbed = [];
  for (const [key, markup] of Object.entries(drawn)) {
    if (STUB.test(markup)) stubbed.push(key);
  }
  for (const [name, file] of Object.entries(FILES)) {
    if (STUB.test(src(file))) stubbed.push(`${name} (source)`);
  }
  checks.push([`nothing on any of the eight, in any state, is a placeholder${stubbed.length ? ` (${stubbed.join(', ')})` : ''}`,
    stubbed.length === 0]);

  // …and the other half of that: a page with nothing to show still says what it
  // is and why it is empty, rather than drawing an empty frame.
  const empty = {
    welcome: ['welStep1', 'welTitle1'],
    pair: ['pairTitle', 'pairPoint'],
    accounts: ['accounts', 'addAccount'],
    'agent-store': ['addAgent', 'asLoading'],
    // The store has not answered yet, so there is no agent to name and no
    // account to install it under: the page says which of the two silences it is.
    'agent-install': ['addAgent', 'asLoading'],
    settings: ['settings', 'sgComputers', 'addComputer'],
    'model-sheet': ['defaultsShort'],
    'host-sheet': ['computersTitle', 'addComputer'],
  };
  const silent = [];
  for (const [name, words] of Object.entries(empty)) {
    const markup = drawn[`dark:${name}:no data${name === 'pair' ? ':granted' : ''}`] ?? '';
    for (const w of words) if (!markup.includes(w)) silent.push(`${name}: ${w}`);
  }
  checks.push([`…and a phone with nothing on it is told what each page is and what it is missing${silent.length ? ` (${silent.join(', ')})` : ''}`,
    silent.length === 0]);
}

// ── the two states the pages are about ──────────────────────────────────────

checks.push(
  // A tool the computer has not got is the one row asking for something, and it
  // is asking in amber rather than being left off the page.
  ['a tool the computer has not got is one washed row on the accounts page, with the install on it',
    page('accounts').includes('cliMissing') && page('accounts').includes('install')
    && R.styles(page('accounts')).some((s) => s.backgroundColor === K.DARK.amberBg)],
  ['…and with no npm to install it with, the row says that instead of offering a button that cannot work',
    drawn['dark:accounts:an unreachable machine'].includes('needNode')
    && !drawn['dark:accounts:an unreachable machine'].includes('cliInstallHint')],
  ['a source that would not answer says so on its own row, and the rest of the page is still there',
    drawn['dark:agent-store:an unreachable machine'].includes('asSourceFailed')
    && drawn['dark:agent-store:an unreachable machine'].includes('could not reach github.com')
    && drawn['dark:agent-store:an unreachable machine'].includes('addAgent')],
  ['…and an agent that is in no source it answered with is not a page with an unnamed Install on it',
    drawn['dark:agent-install:an unreachable machine'].includes('aiUnknown')
    && !drawn['dark:agent-install:an unreachable machine'].includes('installNamed')
    && drawn['dark:agent-install:no data'].includes('asLoading')
    && !drawn['dark:agent-install:no data'].includes('installNamed')],
  // The words of the reason are interpolated into `cantUpdate`, and the harness's
  // `T` hands back the key rather than the sentence, so what is held here is the
  // decision and not the wording: blocked means the reason and no button.
  ['a checkout behind main with something in the way says what is in the way instead of offering the button',
    drawn['dark:settings:stale data'].includes('sgBlocked')
    && drawn['dark:settings:stale data'].includes('cantUpdate')
    && !drawn['dark:settings:stale data'].includes('updateNow')
    && page('settings').includes('updateNow') && page('settings').includes('sgWaiting')],
  ['the computer that is answering is the only one with a colour on it, on both pages that list them',
    R.styles(page('settings')).filter((s) => s.backgroundColor === K.DARK.run).length === 1
    && R.styles(page('host-sheet')).filter((s) => s.backgroundColor === K.DARK.run).length === 1],
  ['the pairing screen falls back to the three fields when the camera was refused, and says why',
    drawn['dark:pair:no data:refused'].includes('pairCameraOff')
    && ['pairHost', 'pairPort', 'pairToken'].every((k) => drawn['dark:pair:no data:refused'].includes(k))
    && !drawn['dark:pair:no data:refused'].includes('pairPoint')],
  ['…and draws the viewfinder, and nothing to type into, when the camera is ours',
    drawn['dark:pair:no data:granted'].includes('CameraView')
    && !drawn['dark:pair:no data:granted'].includes('pairHost')],
);

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
