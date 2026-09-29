/** A chat, an approval and a timeline, made up for the purpose.
 *
 *  The panel's screens are drawn from a daemon it is not going to have in a
 *  check, and its modals, sheets and popovers need something concrete to be
 *  about. This is that something, in one place, so that the static pass
 *  (`test-divan.mjs`) and the browser pass (`test-divan-ui.mjs`) are looking at
 *  the same chat — `ticket-fixture.js` does the same job for the ticket queue.
 */

export const NOW = 1_759_000_000;

export const chat = (patch = {}) => ({
  id: 'c1',
  group_id: null,
  title: 'Webhook retry policy',
  provider: 'claude',
  model: 'claude-opus-5',
  effort: 'high',
  perm_mode: 'default',
  cwd: '/Users/x/projects/quire',
  provider_session_id: null,
  account_id: '',
  status: 'idle',
  last_preview: 'Picking up the webhook retry ticket.',
  max_turns: null,
  max_budget_usd: null,
  total_cost_usd: 0.42,
  pinned: 0,
  archived: 0,
  created_at: NOW - 3600,
  updated_at: NOW - 60,
  ...patch,
});

/** A destructive one, because that is the modal worth looking at. */
export const pending = () => ({
  hostKey: 'studio', hostName: 'studio', chatId: 'c1', requestId: 'r1',
  tool: 'Bash', input: { command: 'rm -rf build' }, preview: 'rm -rf build',
  danger: true, reason: 'deletes a directory', ts: NOW - 20,
});

/** One of every kind the timeline can draw, including the two that are a
 *  colour — a tool that failed, and an approval nobody has answered. */
export const items = () => ([
  { kind: 'user', id: 'i1', ts: NOW - 300, text: 'Fix the retries.', attachments: [], queued: false },
  { kind: 'assistant', id: 'i2', ts: NOW - 280, segment: 0, text: 'Looking at it now.', done: true },
  { kind: 'thinking', id: 'i3', ts: NOW - 275, text: 'Stripe holds them for three days.' },
  { kind: 'tool', id: 'i4', ts: NOW - 260, tool: 'Bash', input: { command: 'npm test' },
    output: 'all good', isError: false, running: false },
  { kind: 'tool', id: 'i5', ts: NOW - 250, tool: 'Bash', input: { command: 'npm run build' },
    output: 'it failed', isError: true, running: false },
  { kind: 'approval', id: 'i6', ts: NOW - 240, requestId: 'r1', tool: 'Bash',
    input: { command: 'rm -rf build' }, preview: 'rm -rf build', danger: true,
    reason: 'deletes a directory', decision: null },
  { kind: 'turn', id: 'i7', ts: NOW - 200, costUsd: 0.41, usage: {},
    durationMs: 41000, numTurns: 3, stopReason: null },
  { kind: 'error', id: 'i8', ts: NOW - 100, message: 'the socket went' },
]);

export const shots = () => ([{ src: 'a.png', download: 'a.png', name: 'a.png' }]);

export const groups = () => ([{ id: 'g1', name: 'Quire' }]);
