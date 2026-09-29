/** One card opened: the three faces of Mobile4 in both themes, the rule that no
 *  text an agent produced reaches the human one, the run streaming onto the live
 *  one with a sentence said into it, and the machine it all runs on.
 *  Run: node scripts/test-card.cjs  (also folded into test-ustabasi.cjs.)
 */
const fs = require('fs');
const path = require('path');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;

const C = require(path.join(root, 'src/card.ts'));
const M = require(path.join(root, 'src/divan.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const Screen = require(path.join(root, 'app/card/[id].tsx')).default;

const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const HOUR = 3600;
const QUIET = 2 * HOUR + 14 * MIN;
const COLOUR = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g;

// ── the card, as a person wrote it ──────────────────────────────────────────

const SUMMARY = 'Studios want to add a whole client roster at once. Let them upload a CSV, '
  + 'preview who will be invited, then send in one go.';

const card = (id, o = {}) => ({
  id, project_id: 'Quire-id', branch_id: 'engineering-id', branch: 'engineering',
  column: o.column || 'in_progress', position: o.position || 0,
  title: o.title || 'Bulk invite clients from a CSV', summary: o.summary ?? SUMMARY,
  executor: o.executor ?? 'coding_agent', machine: o.machine ?? null, repo: null,
  ustabasi_id: o.ustabasi === undefined ? 9 : o.ustabasi,
  agent_status: o.status ?? 'running', agent_status_at: o.at ?? NOW - 23 * MIN,
  agent_detail: o.detail ?? 'AGENT DETAIL round two of the worker',
  created_at: NOW - 3 * 24 * HOUR, updated_at: NOW - 4 * MIN, moved_at: o.moved ?? NOW - 26 * MIN,
});

const project = (name, o = {}) => ({
  id: `${name}-id`, name, slug: name.toLowerCase(), summary: '', kind: 'SaaS', repos: [],
  sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  branches: [{ id: 'engineering-id', kind: 'engineering', name: 'Engineering', summary: '',
               summary_at: null, cards: { in_progress: o.n ?? 3 }, open: 3 }],
  counts: o.counts || { in_progress: 3 }, running: 1, waiting: 0, summary_line: '',
});

const snapshot = (machine, o) => ({ machine, os: 'Darwin', at: o.at ?? NOW,
  projects: o.projects || [], cards: o.cards || [], agents: [], quota: null, activity: {}, queue: {} });
const paired = (id, name, o) => ({ id, name, state: { snapshot: o.snapshot ?? null, at: o.at ?? null,
  reachable: !!o.reachable, error: o.error ?? null, old: false } });

const STUDIO = paired('h1', 'studio', { reachable: true, at: NOW - 10,
  snapshot: snapshot('studio', { at: NOW - 10, projects: [project('Quire')],
    cards: [card('q3'), card('q7', { column: 'ice_box', title: 'Zapier integration',
                                     ustabasi: null, status: null, at: null, detail: '' })] }) });

const MINI = paired('h2', 'mini', { at: NOW - QUIET, reachable: false, error: 'no answer',
  snapshot: snapshot('mini', { at: NOW - QUIET, projects: [project('Quire')],
    cards: [card('m1', { title: 'Fix portal login on Safari 17', ustabasi: 21, status: 'blocked',
                         at: NOW - QUIET - HOUR })] }) });

const VIEW = M.merge([STUDIO, MINI], NOW);

// ── …and the same card as the machine has it ────────────────────────────────

const BRIEF = {
  goal: 'AGENT GOAL add POST /clients/import accepting text/csv, max 500 rows',
  done_criteria: ['AGENT CRITERION dry run returns valid, duplicate and invalid',
                  'AGENT CRITERION duplicates matched on lower(email)',
                  'AGENT CRITERION 501 rows answer 422 with the row count',
                  'AGENT CRITERION commit is idempotent per upload id',
                  'AGENT CRITERION the preview passes axe with no violations'],
  verify_cmd: 'npm test clients/import\nnpm run lint',
  constraints: ['AGENT CONSTRAINT no new dependencies', 'AGENT CONSTRAINT do not touch billing'],
  paths: ['api/src/routes/clients/import.ts', 'web/src/portal/ImportClients.tsx'],
  notes: 'AGENT NOTE studios paste Excel exports with a BOM, strip it',
};

const TICKET = {
  id: 9, title: 'Bulk invite clients from a CSV', status: 'running', stage: 'work', round: 1,
  repo: '/r/quire', branch: 'ustabasi/9', created_at: NOW - 3 * 24 * HOUR, updated_at: NOW - 4 * MIN,
  started_at: NOW - 23 * MIN, finished_at: null, goal: BRIEF.goal, done_criteria: BRIEF.done_criteria,
  escalation: 'AGENT QUESTION which mailer should the invites go through?',
  verdict: { round: 1, verdict: 'partly', findings: BRIEF.done_criteria.slice(0, 3).map((c) => ({
    criterion: c, status: 'met' })).concat([{ criterion: BRIEF.done_criteria[3], status: 'unmet',
    detail: 'AGENT FINDING the second upload wrote the rows twice' }]) },
  notes: [], note_count: 0, last_event: null, project: 'quire', round_started_at: NOW - 23 * MIN,
  git: null, steps: [],
};

const FIRST = [
  { k: 'tool', id: 't1', name: 'Read', input: { file_path: '/r/quire/api/src/routes/clients/import.ts' } },
  { k: 'result', id: 't1', text: 'ok' },
  { k: 'text', text: 'AGENT SAID the dry run needs its own preview shape' },
];
const SECOND = [
  { k: 'tool', id: 't2', name: 'Bash', input: { command: 'npm test clients/import' } },
  { k: 'result', id: 't2', text: 'AGENT OUTPUT 11 passed', error: false },
  { k: 'text', text: 'AGENT SAID splitting the commit into batches of 100' },
];

const page = (events, o = {}) => ({ available: true, reason: '', run: 'r1', events,
  cursor: o.cursor ?? 'r1:120', live: o.live ?? true, caught_up: true, reset: o.reset });

const detail = (o = {}) => ({
  card: { ...card(o.id || 'q3'), ...(o.brief === null ? {} : { agent: o.brief || BRIEF }) },
  project: project('Quire'),
  ticket: o.ticket === null ? null : TICKET,
  run: o.run === null ? null : page(o.events || FIRST, o),
});

/** The card as it stands after its first page, and after a second one that
 *  arrived while somebody was watching. */
const READ = C.took(C.opening('q3', 'h1'), detail(), NOW - 5);
const OPEN = C.took(READ, detail({ events: SECOND }), NOW);

// ── the page itself ─────────────────────────────────────────────────────────

function draw(scheme, o = {}) {
  R.store.reset();
  R.params.reset();
  R.nav.reset();
  R.store.set({
    hosts: (o.hosts ?? [STUDIO, MINI]).map((e) => ({ id: e.id, name: e.name })),
    divan: Object.fromEntries((o.hosts ?? [STUDIO, MINI]).map((e) => [e.id, e.state])),
    host: { id: 'h1' }, conn: 'online',
    loadDivan() {}, loadCard() {}, sayCard() {},
    openCard: o.open === undefined ? OPEN : o.open,
    ustabasi: null, ustabasiOld: false, loadUstabasi() {},
  });
  R.params.set({ id: o.id ?? 'q3', host: o.host ?? 'h1', ...(o.face ? { face: o.face } : {}) });
  return R.render(scheme, h(Screen));
}

/** The flattened style of every element whose words are exactly this. */
const stylesOf = (markup, word) => [...markup.matchAll(/<span data-rn="Text"([^>]*)>([^<]*)<\/span>/g)]
  .filter((m) => m[2] === word)
  .map((m) => JSON.parse((m[1].match(/data-style="([^"]*)"/) ?? [, '{}'])[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")));
const styleOf = (markup, word) => stylesOf(markup, word)[0] ?? {};

const paintOf = (markup) => {
  const out = new Set();
  for (const v of R.paint(markup)) {
    const inside = v.match(COLOUR);
    if (inside && (inside.length > 1 || inside[0] !== v)) inside.forEach((c) => out.add(c));
    else out.add(v);
  }
  return out;
};

// ── 1 · the three faces, in both themes ─────────────────────────────────────

const HEAD = ['Quire', 'Engineering', '#9', 'Bulk invite clients from a CSV',
              'bdInProgress', 'caInColumn', 'caHuman', 'caAgent', 'caLive'];

for (const scheme of ['dark', 'light']) {
  const t = K.tokensFor(scheme);
  const human = draw(scheme);
  const agent = draw(scheme, { face: 'agent' });
  const live = draw(scheme, { face: 'live' });

  checks.push(
    [`${scheme}: the head says which card this is, and says the same on all three faces`,
      [human, agent, live].every((m) => HEAD.every((word) => m.includes(word)))
      && styleOf(human, '● bdRunning · 3/5').color === t.run],
    [`${scheme}: the human face is the card's own writing, its list and what has happened to it`,
      human.includes(SUMMARY)
      && ['caExecutor', 'caCreated', 'caUpdated', 'caBranch', 'caBrief', 'caActivity',
          'caPickedUp', 'caMoved', 'caMade'].every((word) => human.includes(`>${word}<`))
      && human.includes('caCriteria · caCommands · caFiles')],
    [`${scheme}: the agent face is the brief, block by block, with the verifier's marks on it`,
      ['caGoal', 'caTest', 'caConstraints', 'caFiles2', 'caNotes']
        .every((word) => agent.includes(`>${word}<`))
      && agent.includes('caDoneWhen · 3 / 5')
      && agent.includes(BRIEF.goal) && agent.includes('npm run lint')
      && stylesOf(agent, '✓').length === 3 && styleOf(agent, '✓').color === t.run
      && stylesOf(agent, '×').length === 1 && styleOf(agent, '×').color === t.red
      && stylesOf(agent, '○').length === 1 && styleOf(agent, '○').color === t.ink3],
    [`${scheme}: the live face is the run as it is written, and the box that says one line into it`,
      live.includes('Read /…/clients/import.ts')
      && live.includes('Bash npm test clients/import')
      && live.includes('>caNow ▍<') && live.includes('data-placeholder="caSay"')
      && live.includes('>caSayFoot<')
      && R.styles(live).some((s) => s.backgroundColor === t.runBg)],
    [`${scheme}: nothing on any of the three is painted in a colour that is not this theme's`,
      (() => {
        const own = new Set([...Object.values(t), K.ON_COLOUR, ...K.MONOGRAM,
                             K.EXEC_PENDING_LINE, K.EXEC_PENDING_INK,
                             ...Object.values(K.EXECUTORS).map((e) => e.fill).filter(Boolean)]);
        const stray = [human, agent, live].flatMap((m) => [...paintOf(m)].filter((c) => !own.has(c)));
        return stray.length === 0;
      })()],
  );
}

// ── 2 · no text an agent produced on the human face ─────────────────────────

{
  const human = draw('dark');
  const agent = draw('dark', { face: 'agent' });
  const live = draw('dark', { face: 'live' });
  const words = C.agentWords(detail(), OPEN.turns);
  const leaked = words.filter((w) => human.includes(w));
  checks.push(
    [`the human face carries no string the agent side holds${leaked.length ? ` (${leaked[0]})` : ''}`,
      words.length >= 12 && leaked.length === 0],
    ['…and every one of them is on the face it does belong to',
      [BRIEF.goal, BRIEF.notes, ...BRIEF.done_criteria, ...BRIEF.constraints, ...BRIEF.paths]
        .every((w) => agent.includes(w))
      && live.includes('AGENT SAID the dry run needs its own preview shape')],
  );
}

// ── 3 · the run streams, and one sentence reaches it mid-run ────────────────

{
  const first = C.live(READ.turns, [], READ.stamps, true);
  const both = C.live(OPEN.turns, [], OPEN.stamps, true);
  checks.push(
    ['a page of the run is appended to the one before it, and only what arrived while somebody watched is stamped',
      first.length === 2 && both.length === 4
      && first.every((l) => l.at === null)
      && both.slice(0, 2).every((l) => l.at === null)
      && both.slice(2).every((l) => l.at === NOW)],
    ['…and the step being written right now is the last line, drawn as the step it is on',
      both[3].now === true && both[3].tone === 'run'
      && eq(both[3].said, { key: 'caNow', params: { text: 'AGENT SAID splitting the commit into batches of 100' } })
      && both[2].now !== true],
  );

  const mine = { id: 's1', at: NOW - 30, text: 'batch the commit, 100 at a time', after: 2 };
  const said = C.live(OPEN.turns, [mine], OPEN.stamps, true);
  const drawn = draw('dark', { face: 'live', open: { ...OPEN, said: [mine] } });
  checks.push(
    ['a sentence said mid-run lands in the log where it was said, in the reader’s own colour',
      said.length === 5 && said[2].mine === true && said[2].tone === 'amber'
      && said[2].at === NOW - 30
      && eq(said[2].said, { key: 'caYouSaid', params: { text: 'batch the commit, 100 at a time' } })
      && styleOf(drawn, 'caYouSaid').color === K.DARK.amber],
    ['…and goes to the queue on the machine the card is on, not to the one the phone holds',
      eq(C.saying(M.merge([MINI], NOW).cards[0]), { ticket: 21, host: 'h2' })
      && C.saying(VIEW.cards.find((c) => c.id === 'q7')) === null
      && /await sayCard\(to, text\);/.test(src('app/card/[id].tsx'))
      && /const to = card \? saying\(card\) : null;/.test(src('app/card/[id].tsx'))],
    ['a card with no worker on it is offered no box to say anything into',
      (() => {
        const none = draw('dark', { id: 'q7', face: 'live',
          open: C.took(C.opening('q7', 'h1'), detail({ id: 'q7', ticket: null, run: null }), NOW) });
        return none.includes('>caSayNobody<') && !none.includes('data-placeholder="caSay"');
      })()],
  );
}

// ── 4 · which machine it runs on ────────────────────────────────────────────

{
  const human = draw('dark');
  const live = draw('dark', { face: 'live' });
  const quiet = draw('dark', { id: 'm1', host: 'h2',
    open: C.missed(C.opening('m1', 'h2'), 'no answer', false) });
  checks.push(
    ['which machine the work is on is on the card, on the face that describes it and on the live one',
      human.includes('>studio<') && live.includes('>studio<')],
    ['…and a machine that has gone quiet says when it was last heard from, in amber',
      styleOf(quiet, 'mini · pfLastSeen').color === K.DARK.amber
      && quiet.includes('Fix portal login on Safari 17')],
  );
}

// ── 5 · every state of the page ─────────────────────────────────────────────

{
  const STATES = {
    'a card being read for the first time': { open: C.opening('q3', 'h1') },
    'a card whose machine will not answer': { open: C.missed(C.opening('q3', 'h1'), 'no answer', false) },
    'a card on a machine that has gone quiet': { id: 'm1', host: 'h2', open: C.opening('m1', 'h2') },
    'a card with no brief on it': { open: C.took(C.opening('q3', 'h1'), detail({ brief: null }), NOW) },
    'a card nothing has ever run on': { id: 'q7',
      open: C.took(C.opening('q7', 'h1'), detail({ id: 'q7', ticket: null, run: null }), NOW) },
    'a card that is on no board': { id: 'nowhere' },
    'nothing paired at all': { hosts: [], open: null },
  };
  let bad = null;
  for (const scheme of ['dark', 'light']) {
    for (const [name, state] of Object.entries(STATES)) {
      for (const face of ['human', 'agent', 'live']) {
        let markup = '';
        try { markup = draw(scheme, { ...state, face }); }
        catch (e) { bad = `${scheme} ${name} ${face}: ${e.message}`; }
        if (!bad && !markup.includes('tabDashboard')) bad = `${scheme} ${name} ${face}: nothing drawn`;
      }
    }
  }
  checks.push([`every state of this page renders, on every face, in both themes${bad ? ` (${bad})` : ''}`,
    bad === null]);
}

R.store.reset();
R.params.reset();
R.nav.reset();

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
