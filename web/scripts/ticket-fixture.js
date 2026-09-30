/** Tickets, made up, in the shape `ustabasi.list` hands them over.
 *
 *  Shared by the checks so that what is asserted about the reading of a ticket
 *  and what is clicked on in a browser are the same ticket, and so that the wall
 *  is checked against the same tickets twice.
 */
export const REPORT = 'The verifier found two of the nine criteria unmet. '
  + 'The sequence order is built but it is not tested. '.repeat(12)
  + 'This sentence is the end of the report.';

export function ticket(over = {}) {
  return {
    id: 7,
    title: 'open a ticket as a conversation',
    status: 'blocked',
    stage: 'worker',
    round: 2,
    repo: '/tmp/repo',
    project: 'repo',
    branch: 'topic',
    created_at: 1000,
    updated_at: 5000,
    started_at: 1100,
    round_started_at: 4000,
    finished_at: null,
    git: null,
    goal: 'Make a tile open as a conversation instead of a report.',
    done_criteria: ['the sequence reads as a chat', 'the box sends a note'],
    // What the queue writes down as a ticket walks its stages: the flow the
    // panel draws is these, and a fixture without them is a ticket nothing
    // ever ran on.
    steps: [
      { stage: 'worker', round: 1, at: NOW - 9000, ended_at: NOW - 7200, outcome: 'ok',
        model: 'claude-opus-5-5', account: 'yakup' },
      { stage: 'check', round: 1, at: NOW - 7200, ended_at: NOW - 7000, outcome: 'ok',
        model: 'claude-opus-5-5', account: 'yakup' },
      { stage: 'verifier', round: 1, at: NOW - 7000, ended_at: NOW - 6800, outcome: 'rejected',
        model: 'claude-opus-5-5', account: 'yakup' },
      { stage: 'worker', round: 2, at: NOW - 6800, ended_at: null, outcome: null,
        model: 'claude-opus-5-5', account: 'yakup' },
    ],
    escalation: '- A token with **write** access is needed\n'
      + '  and nobody has one yet\n'
      + '- Once that exists the whole ticket closes',
    verdict: {
      verdict: 'changes_requested',
      findings: [
        { criterion: 'first', status: 'met' },
        { criterion: 'second', status: 'unmet', detail: 'the long detail nobody reads' },
      ],
    },
    notes: [
      { ts: 3000, from: 'user', text: 'Use the staging account, not the live one.' },
      { ts: 2000, from: 'verifier', text: REPORT },
      { ts: 4000, from: 'triage', text: 'Picked this up after the crash.' },
    ],
    note_count: 3,
    last_event: { ts: 4500, kind: 'blocked', msg: 'stopped to ask about the token' },
    ...over,
  };
}

/** The hour the wall is read at: a fixed "now", so "15h 18m" is a fact and not
 *  a thing that depends on when the check ran. */
export const NOW = 1790600000;
const H = 3600;

/** A card's worth of ticket, `NOW - 15h 18m` old and 49 minutes into its round. */
export function card(over = {}) {
  return ticket({
    status: 'running',
    created_at: NOW - 15 * H - 18 * 60,
    updated_at: NOW - 600,
    started_at: NOW - 15 * H,
    round_started_at: NOW - 49 * 60,
    escalation: '',
    verdict: null,
    notes: [],
    note_count: 2,
    last_event: { ts: NOW - 600, kind: 'report', msg: 'still going' },
    ...over,
  });
}

/** A wall with something in it: three projects, one of them holding the ticket
 *  that has stopped to ask, one card with nothing committed yet, and one that is
 *  finished. */
export function wall() {
  const long = 'a-long-commit-subject-with-no-spaces-in-it-at-all-'.repeat(4);
  return [
    card({ id: 1, project: 'remote-ai-chat', git: { commits: 12, subject: long } }),
    card({
      id: 2, project: 'remote-ai-chat', status: 'blocked', round: 2,
      escalation: '- Which account should the beta bill to?',
      git: { commits: 3, subject: 'The wall is a column per project' },
    }),
    card({ id: 3, project: 'babysee', updated_at: NOW - 30 }),
    // The newest thing said about this one is the queue handing it over, which
    // is not a thing to read on a card.
    card({
      id: 4, project: 'ustabasi', status: 'queued', round_started_at: null,
      last_event: { ts: NOW - 600, kind: 'start', msg: 'worker round 1 pid 74155 model m account a' },
    }),
    card({
      id: 5, project: 'babysee', status: 'done', finished_at: NOW - 2 * H,
      updated_at: NOW - 2 * H, git: { commits: 6, subject: 'A shorter one' },
    }),
  ];
}
