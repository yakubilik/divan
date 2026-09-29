/** A chat, an approval and a timeline, made up for the purpose.
 *
 *  The panel's screens are drawn from a daemon it is not going to have in a
 *  check, and its modals, sheets and popovers need something concrete to be
 *  about. This is that something, in one place, so that the static pass
 *  (`test-divan.mjs`) and the browser pass (`test-divan-ui.mjs`) are looking at
 *  the same chat — `ticket-fixture.js` does the same job for the ticket queue.
 */

/** The same moment `ticket-fixture.js` is set at, so that a screen drawn from
 *  both fixtures does not report two different days. */
export const NOW = 1_790_600_000;

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

/** One of every kind the timeline can draw, including the three that are a
 *  colour — a tool that failed, an approval nobody has answered, and one that
 *  has been answered, which is a state of its own and was drawn by no check
 *  until it was in here. */
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
  { kind: 'approval', id: 'i6b', ts: NOW - 230, requestId: 'r0', tool: 'Write',
    input: { file_path: 'src/retry.ts' }, preview: 'write src/retry.ts', danger: false,
    reason: null, decision: 'allow' },
  { kind: 'turn', id: 'i7', ts: NOW - 200, costUsd: 0.41, usage: {},
    durationMs: 41000, numTurns: 3, stopReason: null },
  { kind: 'error', id: 'i8', ts: NOW - 100, message: 'the socket went' },
]);

export const shots = () => ([{ src: 'a.png', download: 'a.png', name: 'a.png' }]);

export const groups = () => ([{ id: 'g1', name: 'Quire' }]);

/** A computer, paired and online, with one tool on it and not the other.
 *
 *  Every screen in the panel is drawn from a daemon, and a check has none — so
 *  without this they all draw their empty state, which is the one state that
 *  cannot be wrong. The shape is `HostSlot` (`src/lib/fleet.ts`); seeding it
 *  with `useFleet.setState` is what a check does instead of pairing.
 *
 *  `versions.codex` is null and the codex account is not signed in on purpose:
 *  that is what draws the two marks the panel dims, which is the state that
 *  used to be 2.2:1 on a light page. */
export const host = () => ({
  cfg: { host: '127.0.0.1', port: 8765, token: 'x'.repeat(32), name: 'studio' },
  status: 'online',
  info: {
    name: 'studio', os: 'darwin', os_version: '15.1', daemon_version: '0.9.0',
    uptime_s: 412_000, active_sessions: 2, connected_devices: 1,
    versions: { claude: '1.2.3', codex: null },
    roots: ['/Users/x/projects'],
    started_at: NOW - 412_000, restarts: 3,
  },
  catalog: {
    claude: {
      models: [
        { id: 'claude-opus-5', label: 'Opus 5', hint: 'the roomy one' },
        { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'the quick one' },
      ],
      efforts: ['low', 'medium', 'high'],
      perm_modes: ['default', 'accept-edits', 'bypass'],
    },
  },
  chats: [chat(), chat({ id: 'c2', title: 'Safari login', status: 'running', pinned: 1 }),
          chat({ id: 'c3', title: 'Invoice PDF', status: 'awaiting_approval' })],
  groups: groups(),
  projects: [{ path: '/Users/x/projects/quire', name: 'quire', is_git: true },
             { path: '/Users/x/projects/hush', name: 'hush', is_git: true }],
  accounts: [
    { id: 'default-claude', provider: 'claude', label: 'this computer’s own', logged_in: true,
      detail: 'Claude Code', is_default: true },
    { id: 'a2', provider: 'claude', label: 'yakup@…', logged_in: true,
      detail: 'subscription', is_default: false },
    { id: 'a3', provider: 'codex', label: 'not signed in', logged_in: false,
      detail: 'codex app-server', is_default: false },
  ],
  limits: {
    'default-claude': [
      { window: '5h', status: 'allowed', utilization: 0.64, resets_at: NOW + 3600, at: NOW - 120 },
      { window: '7d', status: 'allowed_warning', utilization: 0.91, resets_at: NOW + 86_400, at: NOW - 120 },
    ],
  },
  loading: {},
  lastOnline: NOW * 1000,
});
