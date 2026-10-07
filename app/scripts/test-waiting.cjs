/** Waiting on you, checked without a phone.
 *
 *  This is the screen that is opened when the Dashboard's first counter is not
 *  zero, and what it promises is not a layout. It is four things:
 *
 *    * **everything that needs a person is on it, once, grouped by the kind of
 *      answer it needs.** A worker that stopped with a question, a decision
 *      nobody is blocked on, something that fell over and a card that is yours
 *      are four different problems, and Mobile6 S3 gives each its own head, its
 *      own mark and its own colour. Yours last, because they can wait;
 *    * **every item says where it came from.** The product and the computer, on
 *      every card, because a list gathered off four machines cannot be read
 *      without it — and because the answer goes back to that machine;
 *    * **what can be answered in one tap is answered here.** The pills are the
 *      question's own words and tapping one sends the note. Pressed for real:
 *      the handler is called, the words that were tapped are the words that are
 *      sent, and nothing navigates;
 *    * **with nothing waiting it is a designed state**, not the busy screen
 *      with the cards taken out.
 *
 *  Half the checks are put to `src/waiting.ts`, which is the judgement with no
 *  pixels in it; the other half stand the screen up for real through
 *  `render-divan.cjs`, in both themes, with no machines, with a machine that
 *  has gone quiet, and with one that never answered at all.
 *
 *  Run: node scripts/test-waiting.cjs  (also folded into test-ustabasi.cjs, so
 *  one command covers everything.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const src = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const h = R.React.createElement;

const W = require(path.join(root, 'src/waiting.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the fleet the frame draws ───────────────────────────────────────────────
//
// Mobile6 S3's own four items, plus the one the frame does not draw and the app
// certainly has: a fifth waiting on a laptop that stopped answering two hours
// ago. Two computers, three products, and one of each kind.
//
// The clock is this moment rather than a round number: the screen ages every
// card against the phone's own `Date.now()`, so a fixture stamped in 2023 would
// put "3 years" on all five.
const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const HOUR = 3600;
const QUIET = 2 * HOUR + 14 * MIN;

const branch = (kind) => ({ id: kind, kind, name: kind, summary: '', summary_at: null, cards: {}, open: 0 });
const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), summary: '',
  repos: o.repos || [], sort: 0, archived: false, created_at: 0, updated_at: o.updated_at || NOW - 60,
  branches: [branch('engineering')], counts: {}, running: o.running || 0, waiting: o.waiting || 0,
  summary_line: '',
});
const card = (id, o = {}) => ({
  id, project_id: o.project, branch_id: 'e', branch: o.branch || 'engineering',
  column: o.column || 'in_progress', position: 0, title: o.title || id, summary: '',
  executor: o.executor ?? 'coding_agent', machine: o.machine ?? null, repo: null,
  ustabasi_id: o.ustabasi ?? null, agent_status: o.status ?? null, agent_status_at: o.at ?? null,
  agent_detail: o.detail || '', created_at: 0, updated_at: 0, moved_at: o.moved ?? null,
});
const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW, projects: o.projects || [],
  cards: o.cards || [], agents: o.agents || [], quota: o.quota ?? null, activity: o.activity || {}, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: o.error ?? null, old: false } });

/** The question Mobile6 S3 puts on its first card, in the shape a worker
 *  actually writes one: a sentence of context and then the choice. */
const RETRIES = "Stripe retries failed webhooks for 3 days. Keep our 3 attempts, or follow Stripe's schedule?";
/** …and the one on its second, which is a report and not a question. */
const SAFARI = "Can't reproduce on the simulator. It needs a real Safari 17 session to continue.";
/** The decision, asked by something that is not a coding agent. */
const PAYWALL = 'Apple rejected 2.4 over the paywall wording. Resubmit with the free-trial line, or wait for 2.5?';

const STUDIO = paired('h1', 'studio', {
  reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10,
    projects: [project('Quire', { waiting: 2, repos: ['/r/quire'] }),
               project('Hush', { waiting: 2, repos: ['/r/hush'] })],
    cards: [
      card('q1', { project: 'Quire-id', status: 'asking', ustabasi: 12, at: NOW - 12 * MIN,
                   title: 'Webhook retry policy', detail: RETRIES }),
      card('q2', { project: 'Quire-id', status: 'failed', ustabasi: 7, at: NOW - (HOUR + 12 * MIN),
                   title: 'Safari 17 login', detail: SAFARI }),
      card('s1', { project: 'Hush-id', status: 'asking', ustabasi: 21, at: NOW - 27 * MIN,
                   executor: 'assistant', title: 'App Review', detail: PAYWALL }),
      card('s2', { project: 'Hush-id', executor: 'human', moved: NOW - 2 * 24 * HOUR,
                   title: 'Write the onboarding email' }),
      // …and one nobody is waiting on, which must not be on this screen at all.
      card('s3', { project: 'Hush-id', status: 'running', ustabasi: 30, title: 'Bulk CSV invite' }),
    ] }),
});

/** The laptop with the lid shut, and the question that stopped on it. */
const MINI = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Kanji Daily', { waiting: 1, repos: ['/r/kanji'] })],
    cards: [card('k1', { project: 'Kanji Daily-id', status: 'asking', ustabasi: 4, at: NOW - QUIET - HOUR,
                         title: 'Gradle 8.7 bump', detail: 'Should we ship the Gradle 8.7 bump now?' })] }),
});

/** The same laptop, with a question on it that does offer two words to quote.
 *  `MINI`'s does not, and between them they are the two halves of the rule: the
 *  machine an answer is sent to is the card's, and whether there is an answer to
 *  send at all is the question's. */
const MINI_ASKING = paired('h2', 'mini', {
  at: NOW - QUIET, reachable: false,
  snapshot: snapshot('mini', { at: NOW - QUIET,
    projects: [project('Kanji Daily', { waiting: 1, repos: ['/r/kanji'] })],
    cards: [card('k2', { project: 'Kanji Daily-id', status: 'asking', ustabasi: 4, at: NOW - HOUR,
                         title: 'Gradle 8.7 bump', detail: 'Bump to 8.7, or pin 8.5?' })] }) });

/** A computer that has never answered at all: nothing of it to draw. */
const NEVER = paired('h3', 'cloud', { reachable: false, at: null, snapshot: null });

/** …and one with a board on it and nothing waiting on anybody. */
const EASY = paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, projects: [project('Quire', { running: 1, repos: ['/r/quire'] })],
    cards: [card('c3', { project: 'Quire-id', status: 'running', title: 'Bulk CSV invite' })],
    activity: { '/r/quire': { at: NOW - HOUR, week: 9, today: 4 } } }) });

const view = (hosts) => M.merge(hosts, NOW);
const BUSY = view([STUDIO, MINI]);
const CALM = view([EASY]);

// ── 1 · which of the four an item is ────────────────────────────────────────

{
  const of = (id) => BUSY.cards.find((c) => c.id === id);
  checks.push(
    ['a coding agent that stopped to ask is a question', W.kindOf(of('q1')) === 'question'],
    ['…one that fell over or was turned down is stuck', W.kindOf(of('q2')) === 'stuck'],
    ['…anything else that stopped to ask is a decision, because no work is held up by it',
      W.kindOf(of('s1')) === 'decision'],
    ['…and a card nothing runs on is yours', W.kindOf(of('s2')) === 'yours'],
    ['an agent merrily at work is on none of them', W.kindOf(of('s3')) === null],
    ['…and the rule for that is the merge’s own `waiting`, not a second spelling of it',
      BUSY.cards.filter((c) => W.kindOf(c) !== null).length === BUSY.totals.needsYou
      && BUSY.cards.every((c) => (W.kindOf(c) !== null) === M.waiting(c))],
    ['a card in Done is waiting on nobody, whatever its agent last said',
      W.kindOf({ ...of('q1'), column: 'done' }) === null],
    ['the three groups are An agent is asking, A decision and On your plate, a stopped agent among the asking',
      eq(W.BUCKETS, ['asking', 'decision', 'plate'])
      && eq(W.KINDS.map(W.bucketOf), ['asking', 'decision', 'asking', 'plate'])],
  );
}

// ── 2 · the list, and where every item came from ────────────────────────────

{
  const list = W.items(BUSY);
  const blocks = W.buckets(BUSY);
  const byId = Object.fromEntries(list.map((i) => [i.card.id, i]));
  checks.push(
    ['the list is everything waiting on a person, across every computer',
      list.length === 5 && list.length === BUSY.totals.needsYou],
    ['…grouped in the handover’s order, with nothing in it twice',
      eq(blocks.map((b) => b.bucket), ['asking', 'decision', 'plate'])
      && blocks.reduce((n, b) => n + b.entries.length, 0) === list.length],
    ['…and a group with nothing in it is not a head over an absence',
      W.buckets(view([paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
        projects: [project('Hush')],
        cards: [card('s2', { project: 'Hush-id', executor: 'human', title: 'Write the email' })] }) })]))
        .map((b) => b.bucket).join() === 'plate'],
    ['oldest first within each group, which is what the line under the title promises',
      eq(blocks[0].entries.map((e) => e.item.card.id), ['k1', 'q2', 'q1'])],
    ['…and a card nothing ever stamped sorts after one that was: not knowing when is not just now',
      (() => {
        const two = view([paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
          projects: [project('Hush')],
          cards: [card('a', { project: 'Hush-id', executor: 'human', title: 'A' }),
                  card('b', { project: 'Hush-id', executor: 'human', moved: NOW - HOUR, title: 'B' })] }) })]);
        return eq(W.items(two).map((i) => i.card.id), ['b', 'a']);
      })()],

    // Every item says which product and which computer. The whole screen turns
    // on this: the same question on two machines is two questions.
    ['every item names the product it is work on',
      list.length === 5 && list.every((i) => !!i.project)],
    ['…and the computer it came off',
      list.length === 5 && list.every((i) => !!i.machine)],
    ['…and both of them, with the card itself between, are the line the card draws',
      eq(W.source(byId.q1), { key: 'waitFrom',
        params: { project: 'Quire', title: 'Webhook retry policy', machine: 'studio' } })
      && eq(W.source(byId.k1), { key: 'waitFrom',
        params: { project: 'Kanji Daily', title: 'Gradle 8.7 bump', machine: 'mini' } })],
    ['…on every one of them, with nothing left empty',
      list.length === 5 && list.map(W.source).every((x) => x.key === 'waitFrom'
        && ['project', 'title', 'machine'].every((k) => typeof x.params[k] === 'string' && !!x.params[k]))],
    ['…the machine’s own name, not the one the phone paired it under',
      byId.k1.machine === 'mini' && byId.q1.machine === 'studio'],
    ['…and a card that names its own machine keeps it, whichever snapshot carried it',
      W.items(view([paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
        projects: [project('Quire')],
        cards: [card('x', { project: 'Quire-id', status: 'asking', machine: 'shed' })] }) })]))[0]
        .machine === 'shed'],
    ['a card off a machine that has gone quiet says so',
      byId.k1.stale === true && byId.q1.stale === false],
    ['the product’s place in the list travels with the item, so one product is one hue',
      list.every((i) => i.index === BUSY.projects.findIndex((p) => p.key === i.card.projectKey))],
    ['what a card says is what was said on it, in those words',
      byId.q1.said === RETRIES && byId.q2.said === SAFARI],
    ['…and a card nobody said anything about leaves its own title standing, never a blank card',
      byId.s2.said === 'Write the onboarding email'],
    ['a question is drawn as a question and a report as a report',
      byId.q1.asked === true && byId.q2.asked === false],
    ['how long it has been waiting is measured against the view’s own clock',
      byId.q1.age === 12 * MIN && byId.q2.age === HOUR + 12 * MIN],
    ['…and a card that is yours has waited since it was made yours',
      byId.s2.age === 2 * 24 * HOUR],
    ['who is waiting is who the card is on',
      eq(list.map((i) => i.who).sort(), ['exAssistant', 'exCoder', 'exCoder', 'exCoder', 'exYou'])],
    ['…wearing the face the design gives that executor',
      W.executorFace(byId.q1.card) === 'coder' && W.executorFace(byId.s1.card) === 'research'
      && W.executorFace(byId.s2.card) === 'you'],
    ['…a branch agent being named by its branch, and an unknown one by nothing at all',
      W.executorFace({ executor: 'branch_agent', branch: 'SEO' }) === 'seo'
      && W.executorFace({ executor: null, branch: 'engineering' }) === 'unassigned'],
    ['the title says the counts: answers for the asking and the decisions, tasks for the plate',
      eq(W.headline(blocks), [{ key: 'waitAnswers', params: { n: 4 } }, { key: 'waitTaskOne' }])
      && eq(W.headline([]), [{ key: 'waitNothing' }])],
    ['On your plate also holds the Still open items nobody else has been named for, oldest first',
      (() => {
        const item = (id, state, owner, age) => ({ id, project_id: 'Hush-id', title: id, body: '', state, owner,
          area: '', sort: 0, comments: [], created_at: NOW - age, updated_at: NOW, closed_at: null });
        const v = view([paired('h1', 'studio', { reachable: true, at: NOW, snapshot: snapshot('studio', {
          projects: [{ ...project('Hush'), open_items: [item('o1', 'todo', '', HOUR), item('o2', 'waiting', 'Bedirhan', 9 * HOUR),
                                                         item('o3', 'done', '', 9 * HOUR), item('o4', 'blocked', 'Yakup', 3 * HOUR)] }],
          cards: [card('s2', { project: 'Hush-id', executor: 'human', moved: NOW - 2 * HOUR, title: 'Write the email' })] }) })]);
        const plate = W.buckets(v)[0];
        return plate.bucket === 'plate'
          && eq(plate.entries.map((e) => (e.kind === 'open' ? e.open.id : e.item.card.id)), ['o4', 's2', 'o1'])
          && eq(W.headline([plate]), [{ key: 'waitTasks', params: { n: 3 } }])
          && plate.entries[0].open.projectId === 'Hush-id' && plate.entries[0].open.host === 'h1';
      })()],
  );
}

// ── 3 · the answers a question offers are the question’s own words ──────────
//
// The whole of "answerable in one tap" is here, and so is the whole of the risk
// in it: a wrong button sends a wrong answer to a worker that acts on it. So
// the reading is deliberately narrow, and what it refuses is checked harder
// than what it accepts.

{
  const A = W.answers;
  checks.push(
    ['a question that ends on a choice offers it, in the words it was written in',
      eq(A(RETRIES), ['Keep our 3 attempts', "Follow Stripe's schedule"])],
    ['…including one asked by something that is not a coding agent',
      eq(A(PAYWALL), ['Resubmit with the free-trial line', 'Wait for 2.5'])],
    ['…and only the last sentence, because the ones before it are the worker explaining itself',
      eq(A('We use one retry or two today. Keep three, or follow Stripe?'),
         ['Keep three', 'Follow Stripe'])],
    ['a report is not a question and offers nothing', eq(A(SAFARI), [])],
    ['a Turkish "A mı, B mi?" offers its two halves', eq(A('Postgres mi, SQLite mı?'), ['Postgres', 'SQLite'])],
    ['…and a Turkish yes-or-no only Evet, since a no needs saying in words',
      eq(A('Bu iş bitti ama ana koda eklenemedi. Ben ekleyeyim mi?'), ['Evet'])
      && eq(A('Postgres mi yoksa SQLite mı?'), [])],
    ['…nor is a question with nothing to choose between',
      eq(A('Which Stripe account should the beta use?'), [])],
    ['a question that opens on an auxiliary is not split: half of it would be a button',
      eq(A('Should we keep our 3 attempts, or follow Stripe?'), [])
      && eq(A('Do I keep three, or follow Stripe?'), [])
      && eq(A('Is it three, or is it Stripe?'), [])],
    ['…nor is one with three ways in it, which is not the shape of a pair of buttons',
      eq(A('Keep three, or follow Stripe, or drop the webhook?'), [])],
    ['…nor one whose halves are paragraphs',
      eq(A(`Keep our current three attempts spread over the first hour after the failure, or ${'x'.repeat(60)}?`), [])],
    ['…nor a wall of text that happens to have an "or" in it',
      A(`${'Reasons abound. '.repeat(20)}Keep three, or follow Stripe?`).length === 2
      && eq(A(`Keep three ${'and think about it '.repeat(12)}, or follow Stripe?`), [])],
    ['…and nothing at all is nothing at all',
      eq(A(''), []) && eq(A(null), []) && eq(A('   '), [])],
    ['the second half is given back the capital it lost by being the second half',
      A('Keep three, or follow Stripe?')[1] === 'Follow Stripe'],
    ['the words on the button and the words sent are one string',
      (() => {
        const item = W.items(BUSY).find((i) => i.card.id === 'q1');
        const [first] = W.actions(item, 'h1');
        return first.label === item.answers[0] && first.doing.text === item.answers[0];
      })()],
  );
}

// ── 4 · what a tap does ─────────────────────────────────────────────────────

{
  const item = (id) => W.items(BUSY).find((i) => i.card.id === id);
  const q1 = W.actions(item('q1'));
  const k1 = W.actions(item('k1'));
  const q2 = W.actions(item('q2'));
  const s2 = W.actions(item('s2'));
  checks.push(
    ['a question offers its two answers, the first one filled, and its ticket',
      eq(q1.map((a) => a.face), ['amber', 'outline', 'outline'])
      && eq(q1.map((a) => a.doing.do), ['note', 'note', 'open'])],
    ['…and the note goes to the ticket that asked, on the machine it asked from',
      eq(q1[0].doing, { do: 'note', ticket: 12, host: 'h1', text: 'Keep our 3 attempts' })],
    ['a question with no choice in it offers its ticket alone, which is where the box is',
      eq(W.actions({ ...item('s1'), answers: [] }).map((a) => [a.key, a.doing.do]), [['waitOpenTicket', 'open']])],
    ['something stuck offers its ticket, on the machine it is on',
      eq(q2.map((a) => a.doing), [{ do: 'open', card: 'q2', host: 'h1' }])],
    ['a card that is yours offers Mark done, which moves it to Done, and its ticket',
      eq(s2.map((a) => [a.key, a.face, a.doing.do]), [['waitDone', 'ink', 'move'], ['waitOpenTicket', 'outline', 'open']])
      && eq(s2[0].doing, { do: 'move', card: 's2', host: 'h1', column: 'done' })],
    ['…and every write there is takes the card off this screen',
      (() => {
        const done = { ...item('s2').card, column: 'done' };
        const answered = { ...item('q1').card, agent_status: 'queued' };
        return W.kindOf(done) === null && W.kindOf(answered) === null;
      })()],
    ['a question on another computer with no words to quote is offered its ticket and nothing to send',
      eq(k1.map((a) => a.doing), [{ do: 'open', card: 'k1', host: 'h2' }]) && item('k1').answers.length === 0],
    ['…while one whose words do offer an answer is offered it, addressed to that machine',
      (() => {
        const quiet = view([STUDIO, MINI_ASKING]);
        const acts = W.actions(W.items(quiet).find((i) => i.card.id === 'k2'));
        return eq(acts.map((a) => a.doing),
          [{ do: 'note', ticket: 4, host: 'h2', text: 'Bump to 8.7' },
           { do: 'note', ticket: 4, host: 'h2', text: 'Pin 8.5' },
           { do: 'open', card: 'k2', host: 'h2' }]);
      })()],
    ['a card no queue is holding is offered nothing to send a note to',
      eq(W.actions({ ...item('q1'), card: { ...item('q1').card, ustabasi_id: null } }).map((a) => a.doing.do), ['open'])],
  );
}

// ── 5 · the screen itself, in both themes ───────────────────────────────────

const Waiting = require(path.join(root, 'app/waiting.tsx')).default;
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

/** What the screen finds in the store, and what it did with it. */
const sent = { notes: [], moves: [], open: [] };
function draw(scheme, hosts, o = {}) {
  R.store.reset();
  if (!o.keep) R.params.reset();
  R.nav.reset();
  sent.notes = [];
  sent.moves = [];
  sent.open = [];
  let drafts = o.drafts ?? {};
  R.store.set({
    drafts, setDraft: (key, patch) => { drafts = { ...drafts, [key]: { ...(drafts[key] ?? {}), ...patch } }; R.store.set({ drafts }); },
    openItem: async (what, d) => {
      if (o.fail) throw new Error('wsTimeout');
      sent.open.push({ ...what, ...d });
    },
    hosts: hosts.map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries(hosts.map((e) => [e.id, e.state])),
    host: hosts.length ? { id: hosts[0].id } : null,
    conn: 'online', loadDivan() {},
    answerCard: async (what, text) => {
      if (o.fail) throw new Error('wsTimeout');
      sent.notes.push({ ...what, text });
    },
    moveCard: async (what) => {
      if (o.fail) throw new Error('wsTimeout');
      sent.moves.push(what);
    },
  });
  return R.render(scheme, h(Waiting));
}

const FLEETS = {
  'the four kinds on two computers': [STUDIO, MINI],
  'a question waiting on a machine that is not answering': [STUDIO, MINI_ASKING],
  'one computer, nothing waiting': [EASY],
  'a machine that never answered': [STUDIO, NEVER],
  'only a machine that never answered': [NEVER],
  'nothing paired at all': [],
};

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const busy = draw(scheme, [STUDIO, MINI]);
  const calm = draw(scheme, [EASY]);
  const nothing = draw(scheme, []);
  const inked = (m, colour) => R.styles(m).some((s) => s.color === colour);

  checks.push(
    [`${scheme}: the page is a way back, a title that says the counts, and the line under it`,
      busy.includes('overview') && busy.includes('>waitAnswers, waitTaskOne.<') && busy.includes('>waitOldest<')],
    [`${scheme}: …with a head per group, in the handover’s order`,
      ['wgAsking', 'wgDecision', 'wgPlate'].every((w, i, all) => busy.includes(`>${w}<`)
        && (i === 0 || busy.indexOf(`>${all[i - 1]}<`) < busy.indexOf(`>${w}<`)))],
    [`${scheme}: …colour only for state and with a word: red on the stopped one, amber on the answer`,
      inked(busy, t.red) && busy.includes('>stStuck<') && inked(busy, t.amber)],
    [`${scheme}: every card draws where it came from`,
      (busy.match(/waitFrom/g) ?? []).length === 5
      && /from=\{T\(source\(item\)\.key, source\(item\)\.params\)\}/.test(src('app/waiting.tsx'))],
    [`${scheme}: …and what was asked, in the words it was asked in`,
      busy.includes('Keep our 3 attempts, or follow Stripe') && busy.includes('Safari 17 session')],
    [`${scheme}: the answers are on the card, as the question’s own words`,
      busy.includes('>Keep our 3 attempts<') && busy.includes("Follow Stripe&#x27;s schedule")],
    [`${scheme}: …and the card off a machine that stopped answering says so`,
      busy.includes('waitStale')],
    [`${scheme}: nothing that is merely running is on this page`,
      !busy.includes('Bulk CSV invite')],
    [`${scheme}: with nothing waiting the page is one sentence`,
      calm.includes('>waitNothing<') && !calm.includes('waitOldest')
      && !['wgAsking', 'wgDecision', 'wgPlate'].some((w) => calm.includes(w)) && /tabDashboard|>divan</.test(calm)],
    [`${scheme}: a phone paired with nothing draws the same sentence without throwing`,
      nothing.includes('>waitNothing<') && /tabDashboard|>divan</.test(nothing)],
    [`${scheme}: every state this page can be in renders`,
      Object.entries(FLEETS).every(([, hosts]) => draw(scheme, hosts).includes('overview'))],
  );
}

// ── 5b · not one colour of its own ──────────────────────────────────────────
//
// The screen is built out of the design system's parts, and the check for that
// is not what it imports: it is what comes out. Every colour on the whole page,
// in either theme and in every state, has to be one the artboards named.

{
  const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)/g;
  for (const scheme of ['dark', 'light']) {
    const tok = K.tokensFor(scheme);
    const own = new Set([...Object.values(tok), K.scrim(tok), K.veil(tok), K.ON_COLOUR,
                         ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean),
                         K.EXEC_PENDING_INK, K.EXEC_PENDING_LINE, 'transparent']);
    const strayed = new Set();
    for (const [, hosts] of Object.entries(FLEETS)) {
      for (const v of R.paint(draw(scheme, hosts))) {
        const inside = v.match(COLOUR) ?? [];
        for (const c of (inside.length > 1 || inside[0] !== v ? inside : [v])) {
          if (!own.has(c)) strayed.add(c);
        }
      }
    }
    checks.push([`${scheme}: the whole screen is drawn in the design's own colours${
      strayed.size ? ` (${[...strayed].join(', ')})` : ''}`, strayed.size === 0]);
  }
}

// ── 6 · pressed ─────────────────────────────────────────────────────────────
//
// "Answered in one tap, without leaving the screen" is a claim about a finger
// and about a request, and neither is visible in the markup a render left. So
// the buttons are pressed for real: what the handler was given is recorded, and
// so is every route anything tried to push.

{
  const press = (text) => {
    const found = R.presses().filter((p) => p.text === text);
    if (found.length !== 1) throw new Error(`press(${JSON.stringify(text)}): ${found.length} of them`);
    return found[0].press();
  };
  /** The nth button with these words, where a screen has several — four cards
   *  can each carry a `Reply…`, and which one was pressed is the point. */
  const pressNth = (text, n) => R.presses().filter((p) => p.text === text)[n].press();

  draw('dark', [STUDIO, MINI]);
  press('Keep our 3 attempts');
  checks.push(
    ['tapping an answer sends it to the ticket that asked, in the words on the button',
      eq(sent.notes, [{ ticket: 12, host: 'h1', text: 'Keep our 3 attempts' }])],
    ['…without leaving the screen', eq(R.nav.pushed(), [])],
  );

  draw('dark', [STUDIO, MINI]);
  press("Follow Stripe's schedule");
  checks.push(['…and the other answer sends the other answer',
    eq(sent.notes, [{ ticket: 12, host: 'h1', text: "Follow Stripe's schedule" }])]);

  // The hardest case the promise has to hold in: a question asked by a worker
  // on the laptop whose lid is shut. The answer is sent to that laptop — it may
  // be awake again by the time a thumb reaches the button — and it is sent
  // without leaving the screen, from a phone that has no socket to it.
  draw('dark', [STUDIO, MINI_ASKING]);
  press('Bump to 8.7');
  checks.push(
    ['a question on a machine this phone is not on is answered on that machine, in one tap',
      eq(sent.notes, [{ ticket: 4, host: 'h2', text: 'Bump to 8.7' }])],
    ['…and that tap does not leave the screen either', eq(R.nav.pushed(), [])],
  );

  draw('dark', [STUDIO, MINI]);
  press('waitDone');
  checks.push(
    ['tapping Mark done on a card that is yours moves it to Done, on its own machine',
      eq(sent.moves, [{ do: 'move', card: 's2', host: 'h1', column: 'done' }])],
    ['…and that is also without leaving the page', eq(R.nav.pushed(), [])],
  );

  draw('dark', [STUDIO, MINI]);
  pressNth('waitOpenTicket', 0);
  checks.push(['Open ticket is the one that does leave: it opens the oldest question’s ticket, on its machine',
    eq(R.nav.pushed(), ['/card/k1?host=h2&from=waiting']) && eq(sent.notes, [])]);

  // A computer that does not answer is the case this screen is in half the
  // time. What a press did about it cannot be read back out of the markup — the
  // card's own state went with the render — so the press is fired for what it
  // does *not* do, and the handling it went through is held to its shape.
  draw('dark', [STUDIO, MINI], { fail: true });
  press('Keep our 3 attempts');
  checks.push(
    ['a send that never arrived leaves the card where it was, and sends nothing',
      eq(sent.notes, []) && eq(sent.moves, []) && eq(R.nav.pushed(), [])],
    ['…and is caught by the screen rather than thrown at it',
      /catch \(e: any\) \{/.test(src('app/waiting.tsx'))
      && /setBusy\(\(had\) => \(\{ \.\.\.had, \[id\]: \{ error:/.test(src('app/waiting.tsx'))],
    ['…which says which computer did not answer, in red',
      /waitNotSent/.test(src('app/waiting.tsx')) && /tone: 'red' as const/.test(src('app/waiting.tsx'))],
  );
}

// ── 7 · the way in ──────────────────────────────────────────────────────────

{
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: STUDIO.state }, host: { id: 'h1' },
    conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  const markup = R.render('dark', h(Dashboard));
  const tile = R.presses().find((p) => p.text === 'waitTitle');
  tile.press();
  checks.push(
    ['the Dashboard’s Needs you is the way into this screen', eq(R.nav.pushed(), ['/waiting'])],
    ['…and it counts the things on it',
      markup.includes('>needsYou<') && W.items(view([STUDIO])).length === 4],
  );

  // …and with nothing behind it there is nothing to open: a tile that dims
  // under a thumb and does nothing is worse than a tile that does not.
  R.store.reset();
  R.nav.reset();
  R.store.set({
    hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: EASY.state }, host: { id: 'h1' },
    conn: 'online', loadDivan() {}, ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  R.render('dark', h(Dashboard));
  checks.push(['…and it is not a way in when there is nothing behind it',
    // Against a screen that did draw something pressable, so that "nothing is
    // pressable here" is not "nothing rendered at all".
    R.presses().length > 0 && !R.presses().some((p) => p.text === 'waitTitle')]);
  R.store.reset();
  R.params.reset();
  R.nav.reset();
}

// ── 8 · the rules the screen is written under ───────────────────────────────

{
  const screen = src('app/waiting.tsx');
  const parts = src('src/components/waiting.tsx');
  const judgement = src('src/waiting.ts');
  checks.push(
    ['the screen is built out of the design system and nothing else',
      /from '\.\.\/src\/components\/divan'/.test(screen)
      && /from '\.\/divan'/.test(parts)
      && !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(parts) && !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(screen)],
    ['…and its blocks take their colour from the token table rather than being handed one',
      /useTokens\(\)/.test(parts) && /toneColours\(/.test(parts)],
    ['what the screen says is decided where a check can reach it, with no React in it',
      !/\brequire\(|from 'react/.test(judgement) && /export function items/.test(judgement)
      && /export function actions/.test(judgement)],
    ['the chat is not touched by any of it',
      !/components\/chat|chat\//.test(screen) && !/components\/chat/.test(parts)],
    ['nothing on it leads to a screen that is about a computer',
      !/'\/host-sheet'|'\/pool'|'\/accounts'|'\/screen'|'\/agents'/.test(screen)],
    ['…and it reads the paired computers, never whichever one the phone is on',
      !/activeHostId/.test(screen)],
  );

  // A judgement nothing calls is worse than no judgement: it is a rule that
  // reads as settled, has checks of its own, and is not the rule the product
  // follows. The Dashboard's module is held to the same thing next door.
  const exported = [...judgement.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const orphans = exported.filter((name) => {
    if (new RegExp(`\\b${name}\\b`).test(screen) || new RegExp(`\\b${name}\\b`).test(parts)) return false;
    return (judgement.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length <= 1;
  });
  checks.push(
    [`every rule the module states is a rule the screen follows${
      orphans.length ? ` (orphaned: ${orphans.join(', ')})` : ''}`, orphans.length === 0],
    ['…and the screen is registered in the stack like every other pushed page',
      /<Stack\.Screen name="waiting" \/>/.test(src('app/_layout.tsx'))],
  );
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
