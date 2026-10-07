/** The phone's ticket page and Waiting on you (HANDOVER §4.4, §4.6), one check
 *  per criterion of ustabasi #126.
 *
 *  Run: node scripts/test-handover-ticket.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const C = require(path.join(root, 'src/card.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const CardScreen = require(path.join(root, 'app/card/[id].tsx')).default;
const Waiting = require(path.join(root, 'app/waiting.tsx')).default;
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;
const QUESTION = 'The test keys work. Use the live ones now, or wait for the review?';

const branch = { id: 'engineering-id', kind: 'engineering', name: 'Engineering', summary: '', summary_at: null,
                 cards: { in_progress: 4 }, open: 4 };
const project = (o = {}) => ({
  id: 'Quire-id', name: 'Quire', slug: 'quire', summary: '', kind: 'SaaS', repos: ['/r/quire'], sort: 0,
  archived: false, created_at: 0, updated_at: NOW - 60, branches: [branch], counts: { in_progress: 4 },
  running: 1, waiting: 3, summary_line: '', ...o,
});
const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering', column: o.column || 'in_progress',
  position: o.position ?? 0, title: o.title || id, summary: o.summary ?? 'Live keys go in before launch.',
  executor: o.executor ?? 'coding_agent', machine: 'studio', repo: null, ustabasi_id: o.ticket ?? null,
  agent_status: o.status ?? null, agent_status_at: o.at ?? NOW - 600, agent_detail: o.detail || '',
  created_at: NOW - 86400, updated_at: NOW - 600, moved_at: o.moved ?? NOW - 600,
});
const OPEN_ITEMS = [
  { id: 'o1', project_id: 'Quire-id', title: 'Generate a Shopier API key', body: 'Paste it into the project.', state: 'todo',
    owner: '', area: '', sort: 0, comments: [], created_at: NOW - 3 * 86400, updated_at: NOW, closed_at: null },
  { id: 'o2', project_id: 'Quire-id', title: 'Domain transfer', body: '', state: 'waiting', owner: 'Bedirhan',
    area: '', sort: 1, comments: [], created_at: NOW - 5 * 86400, updated_at: NOW, closed_at: null },
];
const CARDS = [
  card('a1', { status: 'asking', ticket: 41, title: 'Stripe keys', detail: QUESTION, at: NOW - 1800 }),
  card('d1', { status: 'asking', ticket: 43, executor: 'assistant', title: 'Paywall copy', at: NOW - 3600,
               detail: 'Keep the calm version, or test the urgent one?', position: 1 }),
  card('s1', { status: 'blocked', ticket: 45, title: 'Exam timer', detail: 'Test fails on Safari 17.', at: NOW - 9000, position: 2 }),
  card('r1', { status: 'running', ticket: 42, title: 'Lesson search', position: 3 }),
  card('h1', { executor: 'human', title: 'Write the onboarding email', status: null, moved: NOW - 7200, position: 4 }),
];
const fleet = (cards, open = OPEN_ITEMS) => ({ id: 'h1', name: 'studio', state: { at: NOW, reachable: true, error: null, old: false,
  snapshot: { machine: 'studio', os: 'Darwin', at: NOW, quota: null, queue: {}, agents: [], activity: {},
              projects: [project({ open_items: open })], cards } } });

const BRIEF = { goal: 'Swap the test keys for the live ones', done_criteria: ['checkout uses live keys'],
                verify_cmd: 'npm test payments', constraints: [], paths: ['api/payments.ts'], notes: '' };
const TICKET = { id: 41, title: 'Stripe keys', status: 'blocked', stage: 'worker', round: 1, repo: '/r/quire',
  branch: 'ustabasi/41', created_at: NOW - 86400, updated_at: NOW - 600, started_at: NOW - 3600,
  finished_at: null, goal: BRIEF.goal, done_criteria: BRIEF.done_criteria, escalation: '', ask: QUESTION,
  verdict: null, notes: [], note_count: 0, last_event: null, project: 'quire', round_started_at: NOW - 3600,
  git: null, steps: [] };
const page = (events, cursor) => ({ available: true, reason: '', run: 'r', events, cursor, live: true, caught_up: true });
const detail = (events, cursor) => ({ card: { ...CARDS[0], agent: BRIEF }, project: project(), ticket: TICKET, run: page(events, cursor) });
const FIRST = [{ k: 'text', text: 'Reading the payment handler first.' }, { k: 'text', text: 'Looking at the keys.' }];
const SECOND = [{ k: 'text', text: 'Wrote the checkout route.' }, { k: 'text', text: 'Running the payment tests.' }];
const READ = C.took(C.opening('a1', 'h1'), detail(FIRST, 'c1'), NOW - 30);
const MOVED = C.took(READ, detail(SECOND, 'c2'), NOW);

let calls = [];
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
function stand(o = {}) {
  R.store.reset();
  if (!o.keep) R.params.reset();
  R.nav.reset();
  R.menus.reset();
  calls = [];
  let drafts = {};
  let openCard = o.open === undefined ? READ : o.open;
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: (o.fleet ?? fleet(CARDS)).state }, host: { id: 'h1' },
    conn: 'online', loadDivan() {}, loadCard() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
    tickets: [], openCard,
    drafts, setDraft: (key, patch) => { drafts = { ...drafts, [key]: { ...(drafts[key] ?? {}), ...patch } }; R.store.set({ drafts }); },
    // The store's own sayCard is `answerCard` — `ustabasi.note` on the card's
    // machine — and a line in the log where it was said (`src/store.ts`).
    sayCard: async (to, text) => {
      calls.push(['ustabasi.note', { ...to, text }]);
      openCard = { ...openCard, said: [...openCard.said, { id: `s${calls.length}`, at: Date.now() / 1000, text, after: openCard.turns.length }] };
      R.store.set({ openCard });
    },
    answerCard: async (to, text) => { calls.push(['ustabasi.note', { ...to, text }]); },
    moveCard: async (what) => { calls.push(['divan.card.move', what]); return { error: '' }; },
    handCard: async (what, executor) => { calls.push(['divan.card.executor', { ...what, executor }]); },
    openItem: async (what, d) => { calls.push(['divan.project.open', { ...what, ...d }]); },
  });
  if (o.params) R.params.set(o.params);
  return R.render('dark', h(o.screen ?? CardScreen));
}
const draw = (screen = CardScreen) => R.render('dark', h(screen));
const press = (pred) => {
  const found = R.presses().filter(pred);
  if (found.length !== 1) throw new Error(`press: ${found.length} of them`);
  found[0].press();
};
const byText = (text) => (p) => p.text === text;
const byLabel = (label) => (p) => p.label === label;
const after = (markup, word) => markup.slice(markup.indexOf(word));

const checks = [];

const ready = (async () => {
  try {
    // 1 · the agent's question, and answering it
    {
      const t = K.tokensFor('dark');
      const quiet = stand({ params: { id: 'r1', host: 'h1' }, open: C.opening('r1', 'h1') });
      const before = stand({ params: { id: 'a1', host: 'h1' } });
      const amber = R.styles(before).some((s) => s.borderColor === t.amberRing);
      press(byText('Use the live ones now'));
      await flush();
      const later = draw();
      checks.push(['phone: an asking agent’s question is an amber-edged card; an answer sends ustabasi.note and the card leaves the asking state',
        before.includes('>tkAsking<') && before.includes(QUESTION) && amber
        && !R.styles(quiet).some((s) => s.borderColor === t.amberRing) && !quiet.includes('>tkAsking<')
        && eq(calls, [['ustabasi.note', { ticket: 41, host: 'h1', text: 'Use the live ones now' }]])
        && !later.includes('>tkAsking<') && later.includes('>tkAnswered<')]);
    }

    // 2 · one sentence into the run
    {
      stand({ params: { id: 'a1', host: 'h1' } });
      R.typeInto('tkSay', 'Batch the commit');
      draw();
      press(byLabel('send'));
      await flush();
      const later = draw();
      checks.push(['phone: a sentence typed into Say one sentence to the agent is sent as ustabasi.note to that ticket and lands in Live',
        eq(calls, [['ustabasi.note', { ticket: 41, host: 'h1', text: 'Batch the commit' }]])
        && after(later, '>caLive<').includes('>caYouSaid<')
        && /onHost\(what\.host, 'ustabasi\.note'/.test(src('src/store.ts'))]);
    }

    // 3 · Live moves while the run goes
    {
      const first = stand({ params: { id: 'a1', host: 'h1' }, open: READ });
      const moved = stand({ params: { id: 'a1', host: 'h1' }, open: MOVED });
      const times = [...after(moved, '>caLive<').matchAll(/>(\d\d:\d\d)</g)].map((m) => m[1]);
      checks.push(['phone: Live shows the run’s latest steps as a mono time and a sentence, and a new page of the run appears on the poll without a reload',
        first.includes('Reading the payment handler first.') && !first.includes('Wrote the checkout route.')
        && moved.includes('Wrote the checkout route.') && times.length >= 1
        && /setInterval\(ask, live \? RUN_POLL_MS : DIVAN_POLL_MS\)/.test(src('src/queue.ts'))]);
    }

    // 4 · the agent face, and the side column's controls
    {
      const shut = stand({ params: { id: 'a1', host: 'h1' } });
      press(byLabel('tkAgentFace'));
      const opened = R.params.get().agent === 'open' ? draw() : '';
      press(byLabel('tkHand'));
      await flush();
      const menu = R.menus.last();
      menu?.items.find((i) => i.label === 'exAssistant')?.onPress();
      await flush();
      const rows = ['tkColumn', 'caExecutor', 'tkMachine', 'caBranch', 'tkAlone', 'tkOpened'];
      checks.push(['phone: the Agent face is shut on open and holds Goal, Done when, Test, Files; the side rows are under the page and Executor sends divan.card.executor',
        shut.includes('>tkAgentFace<') && !shut.includes(BRIEF.goal)
        && ['tkGoal', 'tkDoneWhen', 'tkTest', 'tkFiles'].every((w) => opened.includes(`>${w}<`)) && opened.includes(BRIEF.goal)
        && rows.every((w, i) => shut.indexOf(`>${w}<`) > shut.indexOf('>tkAgentFace<')
          && (i === 0 || shut.indexOf(`>${rows[i - 1]}<`) < shut.indexOf(`>${w}<`)))
        && shut.includes('>tkOff<') && shut.includes('>tkNotYet<')
        && eq(calls, [['divan.card.executor', { card: 'a1', host: 'h1', executor: 'assistant' }]])
        && /onHost\(what\.host, 'divan\.card\.executor'/.test(src('src/store.ts'))]);
    }

    // 5 · Waiting on you
    {
      const page = stand({ screen: Waiting });
      const heads = ['wgAsking', 'wgDecision', 'wgPlate'].map((w) => page.indexOf(`>${w}<`));
      const asking = page.slice(heads[0], heads[1]);
      const plate = page.slice(heads[2]);
      press(byText('Use the live ones now'));
      await flush();
      const answered = calls.slice();
      stand({ screen: Waiting });
      const done = R.presses().filter(byText('waitDone'));
      done[0].press();
      done[1].press();
      await flush();
      const marked = calls.slice();
      stand({ screen: Waiting });
      press(byText('waitComment'));
      stand({ screen: Waiting, keep: true });
      R.typeInto('waitCommentBox', 'Bedirhan has the account');
      draw(Waiting);
      press(byLabel('send'));
      await flush();
      checks.push(['phone: Waiting on you says the counts, three groups oldest first, an answer is one press, and Mark done / Comment send their calls',
        page.includes('>waitAnswers, waitTasks.<') && heads.every((at, i) => at > 0 && (i === 0 || heads[i - 1] < at))
        && asking.indexOf('Test fails on Safari 17.') >= 0 && asking.indexOf('Test fails on Safari 17.') < asking.indexOf(QUESTION)
        && plate.indexOf('Generate a Shopier API key') < plate.indexOf('Write the onboarding email')
        && !page.includes('Domain transfer')
        && eq(answered, [['ustabasi.note', { ticket: 41, host: 'h1', text: 'Use the live ones now' }]])
        && eq(marked, [['divan.project.open', { host: 'h1', project: 'Quire-id', item: 'o1', set: { state: 'done' } }],
                       ['divan.card.move', { do: 'move', card: 'h1', host: 'h1', column: 'done' }]])
        && eq(calls, [['divan.project.open', { host: 'h1', project: 'Quire-id', item: 'o1', comment: 'Bedirhan has the account' }]])
        && /'divan\.project\.open', \{/.test(src('src/store.ts'))]);
    }

    // 6 · nothing waiting
    {
      const calm = fleet([card('r1', { status: 'running', ticket: 42, title: 'Lesson search' })], []);
      const page = stand({ screen: Waiting, fleet: calm });
      const home = stand({ screen: Dashboard, fleet: calm });
      checks.push(['phone: with nothing waiting the page is one sentence and the Dashboard has no Needs you',
        page.includes('>waitNothing<') && !/wgAsking|wgDecision|wgPlate|waitOldest/.test(page)
        && !home.includes('>needsYou<') && home.includes('Lesson search')]);
    }

    // 7 · Back, a cold link, and what the old ticket page could do
    {
      stand({ params: { id: 'a1', host: 'h1', from: 'waiting' } });
      press(byText('waitTitle'));
      const toWaiting = R.nav.replaced();
      // A bare `/ticket/41` — a notification, the wall — is the card that
      // ticket is, drawn as the same page; `?run=1` is the run as a
      // conversation, which is the page the route keeps for itself.
      const view = M.merge([fleet(CARDS)], NOW);
      const found = C.cardForTicket(view, 41, 'h1');
      const route = src('app/ticket/[id].tsx');
      const cold = stand({ params: { id: found?.id ?? '', host: found?.host ?? '' } });
      press(byText('Quire · bdBoard'));
      const toBoard = R.nav.replaced();
      stand({ params: { id: 'a1', host: 'h1' } });
      press(byText('tkWholeRun'));
      const whole = R.nav.pushed();
      checks.push(['phone: a ticket link opened cold draws the ticket, Back returns to where it was opened from, and the note box and the whole run are on it',
        eq(toWaiting, ['/waiting']) && cold.includes('>Stripe keys<') && cold.includes('>tkAgentFace<')
        && eq(toBoard, ['/dashboard?project=quire&tab=board'])
        && cold.includes('data-placeholder="tkSay"') && eq(whole, ['/ticket/41?run=1'])
        && found?.id === 'a1' && C.cardForTicket(view, 41, 'h2') === null
        && /one\(params\.run\) === '1' \? null : cardForTicket\(view, n, active\?\.id\)/.test(route)
        && /if \(card\) return <TicketPage id=\{card\.id\} host=\{card\.host\}/.test(route)]);
    }
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
