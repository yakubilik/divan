/** Switching computers from the Machine page itself (#206).
 *
 *  Which card offers what is decided in `src/machine.ts machineActions`, and is
 *  checked here off the three cases that matter: the computer this phone is
 *  holding has no switch, any other paired one does, and one this phone has no
 *  pairing for — a machine from the shared directory (#194) — offers pairing,
 *  because `switchHost` would quietly do nothing with it.
 *
 *  Then the page is stood up over `test-handover-machine.cjs`'s fleet and the
 *  buttons are pressed: `Use this machine` switches and stays, `Screen` on the
 *  held one still opens the remote screen, and an unpaired card opens pairing.
 *
 *  Run: node scripts/test-machine-switch.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const A = require(path.join(root, 'src/machine.ts'));
const I = require(path.join(root, 'src/i18n.ts'));
const { useStore } = require('../src/store');
const current = () => useStore.getState();

const checks = [];

// ── 1 · the choice, without a phone ─────────────────────────────────────────
const held = { active: 'h1', paired: ['h1', 'h2'] };
checks.push(
  ['switch: the held computer offers no switch — its screen when it answers, asking again when not',
    eq(A.machineActions({ id: 'h1', reachable: true }, held), ['screen'])
    && eq(A.machineActions({ id: 'h1', reachable: false }, held), ['retry'])],
  ['switch: a paired computer that is not the held one offers `use` first',
    eq(A.machineActions({ id: 'h2', reachable: true }, held), ['use', 'screen'])
    && eq(A.machineActions({ id: 'h2', reachable: false }, held), ['use', 'retry'])],
  ['switch: a computer this phone is not paired with offers pairing and nothing else, answering or not',
    eq(A.machineActions({ id: 'peer', reachable: true }, held), ['pair'])
    && eq(A.machineActions({ id: 'peer', reachable: false }, held), ['pair'])],
  ['switch: with nothing held every paired computer can be switched to',
    eq(A.machineActions({ id: 'h1', reachable: true }, { active: null, paired: ['h1'] }), ['use', 'screen'])],
  ['switch: the words are there in English and Turkish',
    ['maUse', 'maCurrent', 'maPairThis', 'maNotPaired'].every((k) => !!I.t(k) && I.t(k) !== k && !!I.tr[k])
    && I.t('maUse') === 'Use this machine' && I.tr.maUse === 'Bu makineye geç'],
  // Why `pair` exists at all: the store's switch returns on an id it has no
  // pairing for, and that is left as it is.
  ['switch: the store still ignores an id it is not paired with, which is why the page must not offer it',
    /switchHost: async \(id\) => \{\s*const h = get\(\)\.hosts\.find\(\(x\) => x\.id === id\);\s*if \(!h \|\| id === get\(\)\.activeHostId\) return;/
      .test(fs.readFileSync(path.join(root, 'src/store.ts'), 'utf8'))],
);

// ── 2 · the page, pressed ───────────────────────────────────────────────────
let switched;
/** The fleet, with a switch that does what the store's does to the state a
 *  screen reads: nothing on an unknown or held id, otherwise the new id held. */
function stand() {
  machine.stand();
  R.nav.reset();
  switched = [];
  R.store.set({
    switchHost: async (id) => {
      switched.push(id);
      const host = current().hosts.find((x) => x.id === id);
      if (!host || id === current().activeHostId) return;
      R.store.set({ activeHostId: id, host });
    },
  });
}
const Machine = () => require(path.join(root, 'app/machine.tsx')).default;
const page = () => R.render('dark', h(Machine()));
const buttons = (text) => R.presses().filter((p) => p.text === text);
/** The markup of the card a machine's name heads, up to the next card's name
 *  or the quota heading after the last one. The fleet is studio, then mini. */
const cardOf = (html, name) => {
  const at = html.indexOf(`>${name}<`);
  if (at < 0) return '';
  const ends = ['>studio<', '>mini<', '>Agent quota<'].map((m) => html.indexOf(m, at + 1)).filter((i) => i > at);
  return html.slice(at, ends.length ? Math.min(...ends) : undefined);
};

const ready = (async () => {
  await machine.ready;
  R.words.real();
  try {
    {
      stand();
      const before = page();
      const use = buttons('Use this machine');
      const marked = cardOf(before, 'studio').includes('>current<') && !cardOf(before, 'mini').includes('>current<');
      use[0].press();
      await flush();
      const after = page();
      checks.push(
        ['switch: the held machine is marked current and has no switch; the other paired one has one',
          use.length === 1 && marked && (before.match(/>current</g) || []).length === 1],
        ['switch: pressing `Use this machine` calls switchHost with that id, stays on the page, and that id is held',
          eq(switched, ['h2']) && eq(R.nav.pushed(), []) && eq(R.nav.replaced(), []) && current().activeHostId === 'h2'],
        ['switch: …and the page then marks the new one current and offers the switch on the old one',
          cardOf(after, 'mini').includes('>current<') && !cardOf(after, 'studio').includes('>current<')
          && cardOf(after, 'studio').includes('Use this machine') && !cardOf(after, 'mini').includes('Use this machine')],
      );
    }
    {
      stand();
      page();
      const screen = buttons('Screen');
      screen.forEach((b) => b.press());
      await flush();
      checks.push(['switch: `Screen` on the held machine still opens the remote screen',
        screen.length === 1 && eq(R.nav.pushed(), ['/screen']) && current().activeHostId === 'h1']);
    }
    {
      // A machine in the list the phone holds no pairing for: what the shared
      // directory can put on the page. Drawn by narrowing what the page is told
      // is paired, so the card is the page's own.
      stand();
      const real = A.machineLines;
      A.machineLines = (view, ago, held) => real(view, ago, { ...held, paired: held.paired.filter((id) => id !== 'h2') });
      let html;
      try { html = page(); } finally { A.machineLines = real; }
      const mini = cardOf(html, 'mini');
      const offer = buttons('Pair to use');
      offer.forEach((b) => b.press());
      await flush();
      checks.push(['switch: an unpaired machine says why and its button opens pairing to add it — never a dead tap',
        offer.length === 1 && mini.includes(I.t('maNotPaired')) && !mini.includes('Use this machine')
        && eq(switched, []) && eq(R.nav.pushed(), [{ pathname: '/pair', params: { add: '1' } }])]);
    }
    {
      stand();
      page();
      R.presses().filter((p) => p.text.startsWith('Computer picker')).forEach((p) => p.press());
      checks.push(['switch: the computer picker at the foot still opens', eq(R.nav.pushed(), ['/host-sheet'])]);
    }
  } finally {
    R.words.keys();
    R.store.reset();
    R.params.reset();
    R.nav.reset();
  }
})();

module.exports = { checks, ready };

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
