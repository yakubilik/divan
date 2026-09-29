/** The fastest screen in the product, checked without a phone: a card filed
 *  from a title alone, with no agent face asked for, landing in Ice Box on a
 *  board that already has it (Mobile8 S9).
 *  Run: node scripts/test-new-ticket.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const C = require(path.join(root, 'src/compose.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const { HOSTS } = require('./test-board.cjs');
const [STUDIO, MINI] = HOSTS;

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = Math.floor(Date.now() / 1000);

const TWO = M.merge([STUDIO, MINI], NOW);
const ONLY_QUIET = M.merge([MINI], NOW);
const NOTHING = M.merge([], NOW);
const quire = M.project(TWO, 'quire');

// ── 1 · what is enough to file ──────────────────────────────────────────────

{
  const bare = C.draft('Export client list as CSV', '');
  const long = C.draft('x', 'a'.repeat(400));
  checks.push(
    ['a title alone is enough, and the sentences are optional',
      bare.ready && bare.summary === '' && !C.draft('   ', 'sentences but no title').ready],
    ['…and the box stops at the limit it counts against',
      long.used === C.SUMMARY_MAX && long.summary.length === C.SUMMARY_MAX],
  );
}

// ── 2 · what the machine is asked for ───────────────────────────────────────

{
  const to = C.writer(TWO, quire);
  const card = C.filing(to, C.draft('Export client list as CSV', 'One button on the Clients page.'), 'ice_box');
  checks.push(
    ['the request is the human face and the column, and names no agent face',
      eq(Object.keys(card).sort(), ['column', 'project_id', 'summary', 'title'])
      && card.column === 'ice_box' && card.project_id === 'Quire-id'],
    ['the two buttons are the two columns that start nothing',
      eq(C.LANDINGS, ['ice_box', 'queued'])],
  );
}

// ── 3 · which computer takes it ─────────────────────────────────────────────

{
  const both = C.writer(TWO, quire);
  const quiet = C.writer(ONLY_QUIET, M.project(ONLY_QUIET, 'quire'));
  checks.push(
    ['a card goes to a machine that is answering, over one that is not',
      both.host === 'h1' && both.machine === 'studio' && !both.quiet],
    ['…and to a quiet one where that is the only machine that has the product',
      quiet.host === 'h2' && quiet.quiet && quiet.project === 'Quire-id'],
    ['no paired computer has the product: there is nowhere to put a card',
      C.writer(NOTHING, null) === null && C.opens(NOTHING, 'quire') === null],
  );
}

// ── 4 · the board it lands on ──────────────────────────────────────

// Filing is two requests and the second one is the whole of "without a
// refresh": Divan's own poll is a minute away, so the machine that took the
// card is asked for its board again before the phone gets there. It is the
// store's, next to the same pair the one other board write makes — which is
// where this reads it, because a store that reaches a keychain and a socket
// the moment it is imported cannot be stood up here.
{
  const store = fs.readFileSync(path.join(root, 'src/store.ts'), 'utf8');
  const write = (store.match(/createCard: async[\s\S]*?\n {4}\},/) ?? [''])[0];
  checks.push(
    ['the card is written down, and then that machine\u2019s board is read again',
      /'divan\.card\.create'/.test(write) && /loadDivan\(host\)/.test(write)
      && write.indexOf('divan.card.create') < write.indexOf('loadDivan')],
  );
}

// ── 5 · the screen itself, in both themes ───────────────────────────────────

const NewTicket = require(path.join(root, 'app/new-ticket.tsx')).default;

/** Every filing the screen asked for in the last render's presses. */
let filed = [];

function draw(scheme, hosts, params, props) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  filed = [];
  R.store.set({
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {},
    createCard: async (what) => { filed.push(what); },
  });
  R.params.set(params);
  return R.render(scheme, h(NewTicket, props));
}

const styleOf = (markup, word) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)]
  .filter((m) => m[2] === word)
  .map((m) => JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")))[0];

const boxes = (markup) => R.styles(markup).filter((s) => s.fontSize === 24 || s.height === 72);

/** Every state this screen can be in, which the last check of the loop draws. */
const STATES = {
  'a product on two machines': [[STUDIO, MINI], { project: 'quire' }, {}],
  'opened with the card already written': [[STUDIO, MINI], { project: 'quire' },
    { opening: 'Export client list as CSV', sentences: 'Studios keep asking.' }],
  'a product whose only machine has gone quiet': [[MINI], { project: 'quire' }, {}],
  'no such product in the view': [[STUDIO], { project: 'gone' }, {}],
  'nothing paired at all': [[], { project: 'quire' }, {}],
  'opened with no product named': [[STUDIO], {}, {}],
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const page = draw(scheme, [STUDIO, MINI], { project: 'quire' }, {});
  const empty = draw(scheme, [], { project: 'quire' }, {});

  checks.push(
    [`${scheme}: S9's four things are on it — the way out, the product, the two boxes and the two buttons`,
      styleOf(page, 'cancel').color === t.ink2 && page.includes('>Quire<')
      && boxes(page).length === 2
      && page.includes('>ntIceBox<') && page.includes('>ntQueued<')],
    [`${scheme}: the line under the box says what is not being asked for, and counts`,
      styleOf(page, 'ntLater').color === t.ink3 && styleOf(page, 'ntLater').fontFamily.includes('Mono')
      && page.includes('>ntCount<')],
    [`${scheme}: nothing on the page is a field for an agent face`,
      !/caGoal|caDoneWhen|caTest|caConstraints|caNotes|caExecutor|ntExecutor/.test(page)
      && (page.match(/data-placeholder=/g) ?? []).length === 2],
    [`${scheme}: with no product anywhere it says so instead of offering a card`,
      empty.includes('>ntNowhere<') && !empty.includes('>ntIceBox<')],
    [`${scheme}: every state of this screen renders`,
      Object.values(STATES).every(([hosts, params, props]) => {
        const markup = draw(scheme, hosts, params, props);
        return markup.includes('>cancel<');
      })],
  );
}

// ── 6 · pressing the buttons ───────────────────────────────────────

// Filing is a request, so what the button does is not finished in the tick it
// was pressed: the page it lands on is chosen when the machine answers. Hence
// the promise — `ready` is exported and awaited before anything is printed, by
// the runner below and by test-ustabasi.cjs.
const ready = (async () => {
  const settle = () => new Promise((done) => setImmediate(done));

  draw('dark', [STUDIO, MINI], { project: 'quire' },
       { opening: 'Export client list as CSV', sentences: 'Studios keep asking to download their list.' });
  R.pressOn('ntIceBox');
  await settle();
  const ice = filed.slice();
  const where = R.nav.replaced();

  draw('dark', [STUDIO, MINI], { project: 'quire' }, { opening: 'Export client list as CSV' });
  R.pressOn('ntQueued');
  await settle();
  const queued = filed.slice();

  draw('dark', [STUDIO, MINI], { project: 'quire' }, {});
  R.pressOn('ntIceBox');
  await settle();
  const nothing = filed.slice();

  checks.push(
    ['Add to Ice Box files it into Ice Box, on the machine that has the product',
      eq(ice, [{ host: 'h1', card: { project_id: 'Quire-id', title: 'Export client list as CSV',
                                     summary: 'Studios keep asking to download their list.',
                                     column: 'ice_box' } }])],
    ['…and leaves the phone on that column of that board, which by then has the card on it',
      eq(where, ['/dashboard?project=quire&tab=board&col=ice_box'])],
    ['Queue it is the same card one column along, with no sentences written',
      queued.length === 1 && queued[0].card.column === 'queued' && queued[0].card.summary === ''],
    ['a card with no title is not filed',
      nothing.length === 0],
  );

  // ── 7 · a machine that would not take it ───────────────────────────
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }],
    divan: { h1: STUDIO.state },
    host: { id: 'h1' }, conn: 'online', loadDivan() {},
    createCard: async () => { throw new Error('studio did not answer'); },
  });
  R.params.set({ project: 'quire' });
  R.render('dark', h(NewTicket, { opening: 'Export client list as CSV' }));
  // A press that throws would come back out of `pressOn` and take the script
  // with it; what is left to check is that nothing was filed and nothing
  // moved — the page stays, with the half-written card still on it.
  R.pressOn('ntIceBox');
  await settle();
  checks.push(
    ['a machine that would not take the card leaves the phone on the page it was written on',
      R.nav.replaced().length === 0],
  );

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
