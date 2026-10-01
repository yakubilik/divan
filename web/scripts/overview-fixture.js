/** The boards the Dashboard is checked against: whole `divan.snapshot` answers,
 *  in the shape the wire carries them, with nothing in them that belongs to one
 *  client.
 *
 *  It is a file of its own — rather than more of `divan-fixture.js` — because
 *  what these boards are for is holding the panel and the phone to *the same
 *  data*: `scripts/test-overview.mjs` feeds every one of them to `src/lib/divan.ts`
 *  and to `app/src/divan.ts` and compares what the two say about it. So nothing
 *  in here may be shaped by what either one happens to do with it, and the
 *  hidden holding place `divan-fixture.js` carries deliberately is not here: the
 *  daemon never sends one (`docs/PROTOCOL.md`, "never in snapshot.projects"), it
 *  exists there to prove the panel drops it, and on a board being compared it
 *  would only be the phone drawing a project the panel does not.
 *
 *  Between them the boards cover every state the four counters and a project
 *  card have: a question and a card that was turned down, an agent paused because
 *  a machine is out of quota, an agent whose machine has gone quiet, a card that
 *  is a person's own, a product dormant for a month, a product with no repository
 *  at all, a morning where nothing needs anybody, and two computers that have
 *  never answered.
 */

/** A face of a product, as the wire carries one. `summary` is empty until a
 *  source is connected behind it, which is every branch but engineering today —
 *  the state the branch pages have to say out loud. */
const branch = (kind, over = {}) => ({
  id: `b-${kind.toLowerCase().replace(/\s+/g, '-')}`, kind, name: kind,
  summary: '', summary_at: null, cards: {}, open: 0,
  ...over,
});

const project = (over = {}) => ({
  id: 'p-quire', name: 'Quire', slug: 'quire', summary: 'client portals for studios',
  kind: 'SaaS', repos: ['/w/quire'], sort: 1, archived: false,
  started_at: null, stage: '', milestones: [], created_at: 0, updated_at: 0,
  branches: [], counts: { in_progress: 1 }, running: 1, waiting: 0, summary_line: '',
  ...over,
});

const card = (over = {}) => ({
  id: 'k1', project_id: 'p-quire', branch_id: 'b-eng', branch: 'Engineering',
  column: 'in_progress', position: 1, title: 'Webhook retry policy', summary: '',
  executor: 'coding_agent', machine: null, repo: '/w/quire', ustabasi_id: 41,
  agent_status: 'running', agent_status_at: 0, agent_detail: '',
  created_at: 0, updated_at: 0, moved_at: 0,
  ...over,
});

const agent = (over = {}) => ({
  card_id: 'k1', project_id: 'p-quire', project: 'Quire', branch: 'Engineering',
  title: 'Webhook retry policy', executor: 'coding_agent', machine: null,
  status: 'running', detail: '', since: 0, ustabasi_id: 41,
  ...over,
});

const quota = (over = {}) => ({
  enabled: true, accounts: 2, blocked: 0, spent: false, left: 0.64, resets_at: null, unknown: false,
  ...over,
});

/** Where a product is in its life and how it got there: the one pair on a
 *  product that nothing on the machine counts. Given to the studio's Quire and
 *  to nothing else, so that both states are on the boards — a product somebody
 *  has written down, and one nobody has. */
const life = (NOW) => ({
  stage: 'live',
  started_at: NOW - 560 * 86_400,
  milestones: [
    { id: 'm1', at: NOW - 560 * 86_400, title: 'Project started', note: 'first commit',
      kind: 'start' },
    { id: 'm2', at: NOW - 380 * 86_400, title: 'v1.0 live', note: 'first paying studio',
      kind: 'live' },
    { id: 'm3', at: NOW + 30 * 86_400, title: 'v4.0 · Custom domains', note: 'target launch',
      kind: 'target' },
  ],
  // …and what it has not done. The three states that are not `done`, so the
  // panel's ordering has something to order, plus one settled with a thread on
  // it in both voices.
  open_items: [
    { id: 'o1', project_id: 'p-quire', title: 'Payment provider keys',
      body: 'The production parameter is still a placeholder, so nothing can be charged.',
      state: 'blocked', owner: '', area: 'payments', sort: 1, comments: [],
      created_at: NOW - 9 * 86_400, updated_at: NOW - 9 * 86_400, closed_at: null },
    { id: 'o2', project_id: 'p-quire', title: 'Custom domain approval',
      body: 'The registrar has had the transfer for a week.',
      state: 'waiting', owner: 'the registrar', area: 'infra', sort: 2,
      comments: [
        { at: NOW - 3 * 86_400, who: 'hermes', text: 'Still pending as of this morning.' },
        { at: NOW - 2 * 86_400, who: 'you', text: 'Bedirhan has the registrar login.' },
      ],
      created_at: NOW - 7 * 86_400, updated_at: NOW - 2 * 86_400, closed_at: null },
    { id: 'o3', project_id: 'p-quire', title: 'Write the onboarding mail',
      body: '', state: 'todo', owner: '', area: '', sort: 3, comments: [],
      created_at: NOW - 2 * 86_400, updated_at: NOW - 2 * 86_400, closed_at: null },
    { id: 'o4', project_id: 'p-quire', title: 'Pick a hosting region',
      body: '', state: 'done', owner: '', area: 'infra', sort: 4, comments: [],
      created_at: NOW - 30 * 86_400, updated_at: NOW - 20 * 86_400,
      closed_at: NOW - 20 * 86_400 },
  ],
});

/** Every board, built against one clock. A host spec is what the panel and the
 *  phone are each handed: the answer, how long ago it came, and why the last
 *  attempt failed where it did. */
export function boards(NOW) {
  const t = (s) => NOW - s;

  /** The studio of Web12 W1: a product with a question on it and one at work,
   *  and a second product with a card that is nobody's but yours. */
  const studio = () => ({
    machine: 'studio', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
    projects: [
      project({ running: 1, waiting: 2, counts: { ice_box: 1, in_progress: 2, done: 3 },
                updated_at: t(300), ...life(NOW),
                branches: [
                  // The one face with something behind it, refreshed this
                  // morning…
                  branch('Engineering', { summary: 'Bulk invite is three checks in.',
                                          summary_at: t(600),
                                          cards: { ice_box: 1, in_progress: 2, done: 3 }, open: 3 }),
                  // …one nothing is connected to and nothing has been put on…
                  branch('SEO'),
                  // …and one whose source last spoke three days ago.
                  branch('Analytics', { summary: 'Trial-to-paid up since the pricing test.',
                                        summary_at: t(3 * 86400) }),
                ] }),
      project({ id: 'p-hush', name: 'Hush', slug: 'hush', summary: 'a quieter phone',
                kind: 'app', repos: ['/w/hush'], sort: 2, running: 0, waiting: 1,
                counts: { in_progress: 1, done: 2 }, updated_at: t(900),
                branches: [branch('App Review', { cards: { in_progress: 1, done: 2 }, open: 1 })] }),
    ],
    cards: [
      card({ agent_status_at: t(300), updated_at: t(300), moved_at: t(600) }),
      card({ id: 'k2', title: 'Stripe keys', agent_status: 'asking', agent_status_at: t(1800),
             ustabasi_id: 42, summary: 'live keys are in 1Password',
             agent_detail: 'The test keys work. Use the live ones now, or wait for the review?' }),
      card({ id: 'k3', title: 'CSV export', column: 'ice_box', executor: null,
             agent_status: null, agent_status_at: null, ustabasi_id: null, moved_at: t(4000) }),
      card({ id: 'h1', project_id: 'p-hush', branch: 'App Review', title: 'App Review reply',
             executor: 'human', agent_status: null, agent_status_at: null,
             ustabasi_id: null, repo: '/w/hush', moved_at: t(7200) }),
    ],
    agents: [agent({ since: t(300) })],
    quota: quota(),
    activity: { '/w/quire': { at: t(3600), week: 7, today: 3 },
                '/w/hush': { at: t(2 * 86400), week: 1, today: 0 } },
    queue: { available: true, last_tick: t(30), paused_until: null },
  });

  /** The mini: the same product under the same slug, with its own id for it, a
   *  card that was turned down, and no quota left — so what is running there is
   *  stopped rather than working. */
  const mini = () => ({
    machine: 'mini', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
    projects: [project({ id: 'q-1', repos: ['/w/quire-api'], running: 1, waiting: 1,
                         counts: { in_progress: 1 }, updated_at: t(120),
                         branches: [
                           // The same face on the second machine, with nothing
                           // written on it: the summary the studio wrote has to
                           // survive the merge.
                           branch('Engineering', { id: 'mb-eng' }),
                           branch('API', { cards: { in_progress: 1 }, open: 1 }),
                         ] })],
    cards: [card({ id: 'm1', project_id: 'q-1', branch: 'API', machine: 'mini',
                   title: 'Out-of-order deliveries', agent_status: 'blocked',
                   agent_status_at: t(5400), ustabasi_id: 44,
                   agent_detail: 'The provider replays events out of order and I gave up.' })],
    agents: [agent({ card_id: 'm1', project_id: 'q-1', branch: 'API', machine: 'mini',
                     title: 'Out-of-order deliveries', since: t(5400), ustabasi_id: 44 })],
    quota: quota({ spent: true, left: 0, blocked: 1, resets_at: NOW + 7200 }),
    activity: { '/w/quire-api': { at: t(7200), week: 2, today: 1 } },
    queue: { available: false },
  });

  /** A morning where nothing needs anybody: work landed, nothing is waiting, and
   *  every machine is answering. */
  const calm = () => ({
    machine: 'studio', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
    projects: [project({ running: 0, waiting: 0, counts: { ice_box: 2, done: 9 }, updated_at: t(60),
                         branches: [branch('Engineering', { cards: { ice_box: 2, done: 9 },
                                                           open: 2 })] })],
    cards: [card({ id: 'c1', title: 'CSV export', column: 'ice_box', executor: null,
                   agent_status: null, agent_status_at: null, ustabasi_id: null })],
    agents: [],
    quota: quota({ left: 0.9 }),
    activity: { '/w/quire': { at: t(1800), week: 12, today: 9 } },
    queue: { available: true, last_tick: t(20), paused_until: null },
  });

  /** A product nobody has touched in a month, and one with no repository at all —
   *  which is not the same thing, and neither may be drawn as the other. */
  const slow = () => ({
    machine: 'air', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
    projects: [
      project({ id: 'p-walk', name: 'The Long Walk', slug: 'the-long-walk', kind: 'app',
                summary: '', repos: ['/w/walk'], running: 0, waiting: 0,
                counts: { ice_box: 3 }, updated_at: t(30 * 86400),
                branches: [branch('Engineering', { cards: { ice_box: 3 }, open: 3 })] }),
      // A product created and never touched: its faces are made and its board is
      // empty, which is a designed page and not an absence.
      project({ id: 'p-pebble', name: 'Pebble', slug: 'pebble', kind: '', summary: '',
                repos: [], running: 0, waiting: 0, counts: {}, updated_at: t(86400),
                branches: [branch('Engineering'), branch('SEO')] }),
    ],
    cards: [],
    agents: [],
    quota: quota({ left: null, unknown: true }),
    activity: { '/w/walk': { at: t(30 * 86400), week: 0, today: 0 } },
    queue: { available: false },
  });

  return {
    /** Two machines, both answering: the arrangement Web12 W1 draws. */
    busy: [{ key: 'studio', name: 'studio', snap: studio() },
           { key: 'mini', name: 'mini', snap: mini() }],
    /** …and the same two with the mini quiet for eight minutes: what it said is
     *  still on the page, and what its agent is doing is no longer known. */
    quiet: [{ key: 'studio', name: 'studio', snap: studio() },
            { key: 'mini', name: 'mini', snap: mini(), age: 8 * 60 }],
    /** …and the same machine refusing the connection with its board in hand. */
    unreachable: [{ key: 'studio', name: 'studio', snap: studio() },
                  { key: 'mini', name: 'mini', snap: mini(), age: 600,
                    error: 'connection refused' }],
    /** One machine, nothing waiting on anybody. */
    calm: [{ key: 'studio', name: 'studio', snap: calm() }],
    /** A dormant product and one with nothing to read. */
    slow: [{ key: 'air', name: 'air', snap: slow() }],
    /** A machine that has never answered, and one whose daemon has never heard
     *  of the request. */
    never: [{ key: 'studio', name: 'studio', snap: null, error: 'not connected' },
            { key: 'mini', name: 'mini', snap: null, error: 'unknown type divan.snapshot',
              old: true }],
    /** Paired with nothing at all. */
    alone: [],
    /** Answering with an empty board: paired, awake, no product created yet. */
    fresh: [{ key: 'laptop', name: 'laptop', snap: {
      machine: 'laptop', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
      projects: [], cards: [], agents: [], quota: null, activity: {}, queue: {},
    } }],
  };
}
