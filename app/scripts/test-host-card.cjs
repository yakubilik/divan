/** The computer card at the top of the phone's chat list (#524): the web
 *  sidebar's HostCard, on the phone.
 *
 *   · the card sits between the Chats title row and the search field, with the
 *     held computer's name and its status dot and word;
 *   · with two computers paired a press opens it onto the other one, and
 *     pressing that calls `switchHost` with its id — after which the list is
 *     that computer's;
 *   · with one computer paired the card still names it and its state, but is
 *     no button: there is nothing to open;
 *   · search, the Grouped/Flat pill, Archive and the person card are still
 *     there, in their places under and beside it, and still answer.
 *
 *  The phone holds one computer at a time, so unlike the web there is no
 *  "All computers" row: the card only switches.
 *
 *  Run: node scripts/test-host-card.cjs
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');
const { useStore } = require('../src/store');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const TR = require('react-test-renderer');
const { act } = R.React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const k of ['error', 'warn']) {
  const real = console[k];
  console[k] = (...a) => { if (!/multiple renderers|react-test-renderer is deprecated|not wrapped in act/.test(String(a[0]))) real(...a); };
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); }); };
const current = () => useStore.getState();
const SEARCH = require(path.join(root, 'src/i18n.ts')).t('searchChats');
const NOW = Math.floor(Date.now() / 1000);
const chat = (id, title, o = {}) => ({ id, title, group_id: null, owner: 'Yakup', provider: 'claude', model: 'opus', effort: 'high',
  perm_mode: 'default', cwd: '/r/quire', provider_session_id: null, account_id: null, status: 'idle', last_preview: 'ok',
  max_turns: null, max_budget_usd: null, total_cost_usd: 0, pinned: 0, archived: 0, created_at: 0, updated_at: NOW - 60,
  project_id: null, ...o });
const STUDIO_CHATS = { s1: chat('s1', 'Refund flow'), s2: chat('s2', 'Safari login', { owner: 'Bedriyan' }), s3: chat('s3', 'Pricing notes') };
const MINI_CHATS = { m1: chat('m1', 'Build fix on mini') };

let switched;
let archivedShown;
/** Two computers, studio held and online; a switch that does to the state the
 *  screen reads what the store's does: the new one held and its list in. */
function stand(o = {}) {
  machine.stand();
  switched = [];
  archivedShown = [];
  R.store.set({
    chats: STUDIO_CHATS, groups: [], people: { names: ['Yakup', 'Bedriyan'], me: 'Yakup' },
    prefs: { chatView: 'grouped', voiceIds: {} },
    setShowArchived: (v) => { archivedShown.push(v); },
    switchHost: async (id) => {
      switched.push(id);
      const host = current().hosts.find((x) => x.id === id);
      if (!host || id === current().activeHostId) return;
      R.store.set({ activeHostId: id, host, hostInfo: { ...current().hostInfo, name: host.name }, chats: MINI_CHATS,
        people: { names: ['Yakup'], me: 'Yakup' } });
    },
    ...o,
  });
}
const Chats = () => require(path.join(root, 'app/chat/index.tsx')).default;
const view = () => h(R.theme.ForceScheme, { scheme: 'dark' }, h(Chats()));
/** Every string the live tree draws, in order. */
const strings = (node, out = []) => {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => strings(n, out)); return out; }
  if (node.props?.['data-placeholder'] === SEARCH) out.push('[search]');
  (node.children ?? []).forEach((n) => strings(n, out));
  return out;
};
const pressable = (tree, test) => tree.root.findAll((n) => typeof n.props.onPress === 'function' && typeof n.type !== 'string' && test(n.props));

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  let tree;
  try {
    // ── 1 · drawn, two computers ─────────────────────────────────────────────
    stand();
    await act(async () => { tree = TR.create(view()); });
    await flush();
    let words = strings(tree.toJSON());
    const at = (s) => words.indexOf(s);
    const card = pressable(tree, (p) => p.accessibilityLabel === 'Computer');
    const order = [at('Chats'), at('Grouped'), at('Archive'), at('studio'), at('online'), at('[search]'), at('Yakup')];
    checks.push([`drawn: title row (Chats, Grouped, Archive), then the card (studio, online), then search, then the person card — at ${order.join(' < ')}`,
      order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1])]);
    const json = JSON.stringify(tree.toJSON());
    const markup = R.render('dark', h(Chats()));
    checks.push(['drawn: the card is the design system\'s (components/divan Card, StatusDot, Tap), with a computer glyph and :port while online',
      /from '\.\/divan'/.test(require('fs').readFileSync(path.join(root, 'src/components/host-card.tsx'), 'utf8'))
      && /import \{ HostCard \} from '\.\.\/\.\.\/src\/components\/host-card'/.test(require('fs').readFileSync(path.join(root, 'app/chat/index.tsx'), 'utf8'))
      && words.includes(':') && words.includes('8790') && card.length === 1
      && tree.root.findAll((n) => n.props.name === 'monitor').length === 1]);
    const { HostCard } = require(path.join(root, 'src/components/host-card.tsx'));
    const dots = tree.root.findByType(HostCard).findAll((n) => typeof n.type === 'function' && n.type.name === 'StatusDot');
    checks.push([`drawn: the held computer's status dot is the running one while online (${dots.map((d) => d.props.state).join()})`,
      dots.length === 1 && dots[0].props.state === 'running' && !dots[0].props.hollow && /studio/.test(markup)]);
    checks.push(['drawn: shut, the other computer is not listed', !words.includes('mini') && !json.includes('100.64.0.2:8790')]);

    // ── 2 · opened and picked ────────────────────────────────────────────────
    await act(async () => { card[0].props.onPress(); });
    words = strings(tree.toJSON());
    const row = pressable(tree, (p) => p.title === 'mini');
    checks.push([`open: a press lists the other paired computer with its address and a hollow dot — ${words.slice(at('studio'), words.indexOf('[search]')).join(' ')}`,
      words.includes('mini') && words.includes('100.64.0.2:8790') && row.length === 1 && words.indexOf('mini') < words.indexOf('[search]')]);
    await act(async () => { row[0].props.onPress(); });
    await flush();
    await act(async () => { tree.update(view()); });
    words = strings(tree.toJSON());
    checks.push([`pick: switchHost is called with the picked id (${JSON.stringify(switched)}), mini is held, and the list is mini's`,
      JSON.stringify(switched) === '["h2"]' && current().activeHostId === 'h2'
      && words.includes('Build fix on mini') && !words.includes('Refund flow') && words.includes('mini') && !words.includes('100.64.0.2:8790')]);
    await act(async () => { tree.unmount(); });

    // ── 3 · one computer ─────────────────────────────────────────────────────
    stand({ hosts: [{ id: 'h1', name: 'studio', host: '100.64.0.1', port: 8790 }] });
    await act(async () => { tree = TR.create(view()); });
    words = strings(tree.toJSON());
    const lone = tree.root.findAll((n) => n.props.accessibilityLabel === 'Computer');
    checks.push([`one computer: the card still names it and its state (${words.slice(words.indexOf('studio'), words.indexOf('studio') + 2).join(' ')}) but is no button, so nothing opens`,
      words.includes('studio') && words.includes('online') && lone.length === 0
      && !R.render('dark', h(Chats())).includes('Computer') && R.presses().every((p) => p.label !== 'Computer')]);
    await act(async () => { tree.unmount(); });

    // ── 3b · offline ─────────────────────────────────────────────────────────
    stand({ conn: 'offline' });
    await act(async () => { tree = TR.create(view()); });
    words = strings(tree.toJSON());
    checks.push([`offline: the card says so (${words.slice(words.indexOf('studio'), words.indexOf('studio') + 2).join(' ')}) and draws no port`,
      words.includes('offline') && !words.includes('8790')]);
    await act(async () => { tree.unmount(); });

    // ── 4 · the rest of the header still answers ─────────────────────────────
    stand();
    R.menus.reset();
    await act(async () => { tree = TR.create(view()); });
    const search = tree.root.findAll((n) => n.props.placeholder === SEARCH && typeof n.props.onChangeText === 'function')[0];
    await act(async () => { search.props.onChangeText('pricing'); });
    words = strings(tree.toJSON());
    const searched = words.includes('Pricing notes') && !words.includes('Refund flow');
    await act(async () => { search.props.onChangeText(''); });
    R.render('dark', h(Chats()));
    const pills = R.presses().map((p) => p.text);
    R.presses().find((p) => p.text === 'Grouped')?.press(); await flush();
    const viewMenu = (R.menus.last()?.items ?? []).map((i) => i.label).filter(Boolean);
    R.presses().find((p) => p.text === 'Archive')?.press();
    R.presses().find((p) => p.label === 'Whose chats')?.press(); await flush();
    const personMenu = (R.menus.last()?.items ?? []).map((i) => i.label).filter(Boolean);
    checks.push([`header: search still filters (pricing → Pricing notes), Grouped opens its menu (${viewMenu.slice(0, 2).join(', ')}), Archive toggles (${JSON.stringify(archivedShown)}), the person card opens (${personMenu.slice(0, 2).join(', ')})`,
      searched && pills.includes('Grouped') && pills.includes('Archive') && viewMenu.includes('Grouped') && viewMenu.includes('Flat')
      && archivedShown.includes(true) && personMenu.some((l) => l.startsWith('Everyone'))]);
    await act(async () => { tree.unmount(); });
  } finally {
    tree = null;
  }
})();

module.exports = { ready, checks };

if (require.main === module) {
  ready.then(() => {
    let bad = 0;
    for (const [what, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); }
    console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} passed`);
    process.exit(bad ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
