/** Two computers' worth of Divan board, made up, in the shape `divan.snapshot`
 *  hands it over.
 *
 *  The shell is a merge of every paired machine, so a fixture for it has to be
 *  more than one machine: the same product checked out twice, a card on each, and
 *  a product that lives on only one of them. That is the arrangement every rule
 *  in `src/lib/divan.ts` is about, and it is here once so that the static pass
 *  and anything a browser is pointed at are looking at the same board.
 *
 *  Kept in step with `panel-fixture.js`'s clock, so that a screen drawn from both
 *  does not report two different days.
 */
export const NOW = 1_790_600_000;

const card = (over = {}) => ({
  id: 'k1',
  project_id: 'p-quire',
  branch_id: 'b-eng',
  branch: 'Engineering',
  column: 'in_progress',
  position: 1,
  title: 'Webhook retry policy',
  summary: '',
  executor: 'coding_agent',
  machine: null,
  repo: '/Users/x/projects/quire',
  ustabasi_id: 41,
  agent_status: 'running',
  agent_status_at: NOW - 300,
  agent_detail: '',
  created_at: NOW - 86_400,
  updated_at: NOW - 300,
  moved_at: NOW - 600,
  ...over,
});

const project = (over = {}) => ({
  id: 'p-quire',
  name: 'Quire',
  slug: 'quire',
  summary: 'client portals for studios',
  kind: 'web',
  started_at: NOW - 400 * 86_400,
  repos: ['/Users/x/projects/quire'],
  sort: 1,
  archived: false,
  created_at: NOW - 400 * 86_400,
  updated_at: NOW - 300,
  branches: [],
  counts: { in_progress: 1 },
  running: 1,
  waiting: 0,
  summary_line: '',
  ...over,
});

/** The studio: two products, one of which is also on the mini. One card is
 *  running, one has stopped to ask, one was turned down. */
export function studio() {
  return {
    machine: 'studio',
    os: 'Darwin',
    daemon_version: '0.9.0',
    at: NOW,
    projects: [
      project({ running: 1, waiting: 2, counts: { ice_box: 1, in_progress: 2, done: 3 } }),
      project({
        id: 'p-hush', name: 'Hush', slug: 'hush', summary: 'a quieter phone',
        kind: 'app', repos: ['/Users/x/projects/hush'], sort: 2,
        running: 0, waiting: 0, counts: { done: 2 },
      }),
      // The holding place for work no product has claimed. Never a product, and
      // a screen that drew it as one would be inventing a product out of a
      // folder name.
      project({ id: 'p-unfiled', name: 'Unfiled', slug: '', hidden: true, repos: [] }),
    ],
    cards: [
      card(),
      card({ id: 'k2', column: 'in_progress', agent_status: 'asking', title: 'Stripe keys' }),
      card({ id: 'k3', column: 'ice_box', agent_status: null, executor: null, title: 'CSV export' }),
      card({ id: 'k4', project_id: 'p-hush', branch: 'App Review', column: 'done',
             agent_status: 'verified', title: 'Paywall wording' }),
    ],
    agents: [{
      card_id: 'k1', project_id: 'p-quire', project: 'Quire', branch: 'Engineering',
      title: 'Webhook retry policy', executor: 'coding_agent', machine: 'studio',
      status: 'running', detail: '', since: NOW - 300, ustabasi_id: 41,
    }],
    quota: { enabled: true, accounts: 2, blocked: 0, spent: false, left: 0.64, resets_at: NOW + 3600, unknown: false },
    activity: {},
    queue: { available: true, last_tick: NOW - 30, paused_until: null },
  };
}

/** The mini: the same product under the same slug, with its own id for it and a
 *  card of its own that was turned down. This is the machine the checks silence. */
export function mini() {
  return {
    machine: 'mini',
    os: 'Darwin',
    daemon_version: '0.9.0',
    at: NOW,
    projects: [
      project({
        id: 'q-1', name: 'Quire', slug: 'quire', repos: ['/Users/x/projects/quire-api'],
        running: 1, waiting: 1, counts: { in_progress: 1 },
      }),
    ],
    cards: [
      card({ id: 'm1', project_id: 'q-1', branch: 'API', agent_status: 'blocked',
             title: 'Out-of-order deliveries', machine: 'mini' }),
    ],
    agents: [{
      card_id: 'm1', project_id: 'q-1', project: 'Quire', branch: 'API',
      title: 'Out-of-order deliveries', executor: 'coding_agent', machine: 'mini',
      status: 'running', detail: '', since: NOW - 900, ustabasi_id: 44,
    }],
    quota: { enabled: true, accounts: 1, blocked: 1, spent: true, left: 0, resets_at: NOW + 7200, unknown: false },
    activity: {},
    queue: { available: false },
  };
}

/** A machine that answers with a board that has nothing on it: paired, awake,
 *  and no product created yet. The first day of a Divan that is real. */
export function empty() {
  return {
    machine: 'laptop', os: 'Darwin', daemon_version: '0.9.0', at: NOW,
    projects: [], cards: [], agents: [], quota: null, activity: {}, queue: { available: false },
  };
}
