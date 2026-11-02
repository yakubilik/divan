/** A cold start opens the empty Hermes chat, not the Dashboard (2 Nov 2026).
 *
 *   · `/` decides whether this is a launch on the first render where the store
 *     is loaded and a computer is paired — not on the very first render, when
 *     the hosts are still being read out of the keychain. Deciding there made
 *     every cold start a "no computer yet" and sent it to the Dashboard;
 *   · once decided it stays decided: a second visit to `/` in the same process
 *     goes to the Dashboard;
 *   · with no computer paired it still goes to Welcome.
 *
 *  Run: node scripts/test-cold-start.cjs
 */
const path = require('path');
const { R } = require('./render-chat.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act/.test(String(a[0]))) real(...a); };
}
const L = require(path.join(root, 'src/launch.ts'));
const { HOME } = require(path.join(root, 'src/shell.ts'));
const Index = require(path.join(root, 'app/index.tsx')).default;
const HOST = { id: 'air', name: 'MacBook Air' };
/** The launch screen: the computer is being waited on, centred, nothing else. */
const spinner = (tree) => JSON.stringify(tree.toJSON()).includes('\\"justifyContent\\":\\"center\\"');

const checks = [];
(async () => {
  // The store as a cold start finds it: not loaded, no computer, offline.
  R.store.reset(); R.nav.reset(); L._resetLaunch();
  R.store.set({ ready: false, host: null, hosts: [], conn: 'idle', hostInfo: null, catalog: null,
    accountsLoaded: false, loadAccounts: async () => {} });
  let tree;
  await act(async () => { tree = TR.create(h(Index)); });
  const before = R.nav.replaced();
  // The keychain answers: loaded, MacBook Air paired.
  R.store.set({ ready: true, host: HOST, hosts: [HOST], activeHostId: 'air', conn: 'connecting' });
  await act(async () => { tree.update(h(Index)); });
  checks.push(['cold start: nothing decided while the store is still loading', before.length === 0]);
  checks.push(['cold start: once the computer is in, it is a launch — no Dashboard redirect',
    !R.nav.replaced().includes(HOME) && spinner(tree)]);
  await act(async () => { tree.unmount(); });

  // A second visit to `/` in the same process is not a launch.
  R.nav.reset();
  await act(async () => { tree = TR.create(h(Index)); });
  checks.push(['second visit: the Dashboard', R.nav.replaced().includes(HOME)]);
  await act(async () => { tree.unmount(); });

  // Nothing paired: Welcome.
  R.store.set({ ready: true, host: null, hosts: [] }); R.nav.reset(); L._resetLaunch();
  await act(async () => { tree = TR.create(h(Index)); });
  checks.push(['nothing paired: Welcome', R.nav.replaced().includes('/welcome')]);
  await act(async () => { tree.unmount(); });

  let bad = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
