/** One ticket, made up, in the shape `ustabasi.list` hands them over.
 *
 *  Shared by the two checks so that what is asserted about the reading of a
 *  ticket and what is clicked on in a browser are the same ticket.
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
    branch: 'topic',
    created_at: 1000,
    updated_at: 5000,
    started_at: 1100,
    finished_at: null,
    goal: 'Make a tile open as a conversation instead of a report.',
    done_criteria: ['the sequence reads as a chat', 'the box sends a note'],
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
