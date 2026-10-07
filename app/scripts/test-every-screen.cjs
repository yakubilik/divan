/** Every route under app/, rendered in Night and in Day through the shared
 *  harness, over the fleet `test-handover-machine.cjs` stands up.
 *
 *  Run: node scripts/test-every-screen.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { R } = require('./render-chat.cjs');

// The remote screen locks the phone's orientation; the lock is all it asks of it.
const beneath = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'expo-screen-orientation') {
    return { lockAsync: () => Promise.resolve(), OrientationLock: { DEFAULT: 0, LANDSCAPE: 1, PORTRAIT_UP: 2 } };
  }
  return beneath.call(this, request, parent, isMain);
};
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

/** What a dynamic route is opened with: the fixture's own ids. */
const PARAMS = {
  'branch/[id].tsx': { id: 'engineering', project: 'quire' },
  'card/[id].tsx': { id: 'k1' },
  'chat/[id].tsx': { id: 'c1' },
  'ticket/[id].tsx': { id: '41' },
  'ticket-about/[id].tsx': { id: '41' },
};

function routes() {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, 'app', rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(next);
      else if (/\.tsx$/.test(e.name) && !e.name.startsWith('_')) out.push(next);
    }
  };
  walk('');
  return out.sort();
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  const failed = [];
  const all = routes();
  for (const file of all) {
    for (const scheme of ['dark', 'light']) {
      try {
        const Screen = require(path.join(root, 'app', file)).default;
        machine.stand({ params: PARAMS[file] });
        // The lists the agent, store and pool pages read, empty as on a computer
        // that has not been asked yet.
        R.store.set({ agents: [], agentsLoaded: true, loadAgents: async () => {}, removeAgent: async () => {},
          storeSources: [], storeLoaded: true, loadStore: async () => {}, installAgent: async () => {},
          pool: null, poolAccounts: [], loadPool: async () => {}, setPool: async () => {} });
        const page = R.render(scheme, h(Screen, PARAMS[file] ?? {}));
        // A route that sends you elsewhere renders nothing of its own, which is
        // its answer; anything else has to draw something.
        if (typeof page !== 'string') failed.push(`${file} ${scheme}: no markup`);
      } catch (e) {
        failed.push(`${file} ${scheme}: ${String(e && e.message || e).split('\n')[0]}`);
      }
    }
  }
  // The busy tile Hermes saw run out on the web: four marks and a resume time.
  const { Tile } = require(path.join(root, 'src/components/dashboard.tsx'));
  const tile = R.render('dark', h(Tile, { name: 'Quire', index: 0, now: 'Wrote the retry table', onPress() {},
    when: 'resume 23:59 tomorrow', counts: [{ state: 'running', n: 12, word: 'working' },
      { state: 'asking', n: 3, word: 'need you' }, { state: 'stuck', n: 2, word: 'stuck' }] }));
  const styles = R.styles(tile);
  checks.push(['phone: a busy tile keeps its footer inside the tile — the tile can shrink, the footer wraps and the time is one line cut short',
    styles.some((s) => s.flex === 1 && s.minWidth === 0 && s.minHeight === 132)
    && styles.some((s) => s.flexDirection === 'row' && s.flexWrap === 'wrap' && s.marginTop === 'auto')
    && /data-style="[^"]*flexShrink&quot;:1[^"]*" data-lines="1">resume 23:59 tomorrow</.test(tile)]);

  checks.push([`phone: all ${all.length} routes render in Night and in Day without throwing${failed.length ? ` — ${failed.join('; ')}` : ''}`,
    all.length >= 30 && !failed.length]);
})();

module.exports = { checks, ready };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) { console.log((ok ? '  ok    ' : '  FAIL  ') + name); if (!ok) bad++; }
    process.exit(bad ? 1 : 0);
  });
}
