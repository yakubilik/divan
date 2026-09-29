// Mirrors docs/PROTOCOL.md

export type Provider = 'claude' | 'codex';
export type ChatStatus = 'idle' | 'running' | 'awaiting_approval';

export interface Chat {
  agent_id?: string | null;
  id: string;
  group_id: string | null;
  title: string;
  provider: Provider;
  model: string;
  effort: string | null;
  perm_mode: string;
  cwd: string;
  provider_session_id: string | null;
  account_id: string | null;
  status: ChatStatus;
  last_preview: string;
  max_turns: number | null;
  max_budget_usd: number | null;
  total_cost_usd: number;
  pinned: number;
  archived: number;
  created_at: number;
  updated_at: number;
  session_ids?: string;
  /** 1 to keep this chat on the sign-in named above even while the account
   *  pool is on. Off by default: the pool is a mode, and a chat is in it
   *  unless somebody says otherwise. */
  pool_pinned?: number;
}

export interface Group { id: string; name: string; sort: number; created_at: number }

export interface HostInfo {
  name: string; os: string; os_version: string; daemon_version: string;
  uptime_s: number; active_sessions: number; connected_devices: number;
  versions: { claude: string | null; codex: string | null };
  roots: string[];
  transcription?: boolean;
  /** The commit this computer is actually running. `daemon_version` is a
   *  constant and cannot tell two computers apart; this can. */
  revision?: Revision | null;
  update?: { behind: number; ahead: number; auto: boolean; repo: boolean;
             error?: string | null; checked_at?: number | null };
}

export interface Revision {
  repo: boolean;
  commit?: string; sha?: string; committed_at?: string; subject?: string;
  branch?: string; dirty?: boolean; dirty_files?: number;
  error?: string;
}

/** Where a computer stands against origin/main, and what is stopping it from
 *  moving onto it. */
export interface UpdateStatus {
  repo: boolean;
  auto: boolean;
  behind: number;
  ahead: number;
  busy: boolean;
  error?: string | null;
  checked_at?: number | null;
  local?: Revision | null;
  remote?: { commit?: string; committed_at?: string; subject?: string } | null;
  blockers?: string[];
}

export interface ProviderCatalog {
  /** `efforts` is per model — they differ, and a model with an empty list takes
   *  no effort setting at all. Absent from a daemon older than this app, which
   *  is why the provider-level list below is still read. */
  models: { id: string; label: string; hint: string; model_id?: string; efforts?: string[] }[];
  efforts: string[];
  perm_modes: string[];
}
export type Catalog = Record<Provider, ProviderCatalog>;

export interface Project { path: string; name: string; is_git: boolean }

export interface RacEvent<T = any> {
  event: string;
  chat_id: string | null;
  seq: number | null;
  data: T;
  ts: number;
}

export interface HostConfig {
  host: string; port: number; token: string; name: string; device_id?: string;
}

export interface ProviderDefaults { model: string; effort: string | null; perm_mode: string; account_id?: string | null }
export interface Defaults {
  provider: Provider; model: string; effort: string; perm_mode: string; cwd: string | null;
  byProvider?: Partial<Record<Provider, ProviderDefaults>>;
  /** Which account the Agents tab reads from and installs into. Agents live in
   *  one account's folder, so this decides which ones exist at all. Left unset
   *  it follows the account new chats use; setting it here does not drag the
   *  chat default along, which is the point of it being its own value. */
  agentAccountId?: string | null;
}

export interface StoreItem {
  id: string;
  kind?: 'bundle';
  skills?: number;
  about?: string;
  label: string;
  glyph: string;
  color: string;
  repo: string;
}

export interface StoreSource {
  id: string;
  label: string;
  repo: string;
  note: string;
  items: StoreItem[];
  error?: string;
}

export interface Agent {
  id: string;
  name: string;
  label: string;
  description: string;
  color: string;
  glyph: string;
  model: string | null;
  scope: 'project' | 'user' | 'builtin';
  // several agents a tool shipped together; the app shows them as one
  family?: string | null;
  // put here by this app, rather than borrowed from the computer's own set
  installed?: boolean;
  path: string;
}

/** One window of the plan's usage, as the tool last reported it. */
export interface LimitWindow {
  window: string;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  utilization: number | null;
  resets_at: number | null;
  overage_status?: string | null;
  overage_resets_at?: number | null;
  overage_disabled_reason?: string | null;
  is_using_overage?: boolean;
  /** When the computer heard this. The tool only measures during a turn, so a
   *  reading can be an hour old and still be the newest one there is. */
  at?: number;
}

/** How the computer drives several sign-ins of one tool as one. */
export interface PoolSettings {
  enabled: boolean;
  /** The share of a window at which a chat is handed over, for any window
   *  `thresholds` does not name. Deliberately short of 1 so the move happens
   *  before the turn dies. */
  threshold: number;
  /** Per window, because the windows are not alike: the five-hour one refills
   *  several times a day, a weekly one is most of a working week. */
  thresholds: Record<string, number>;
  /** The default for a sign-in that has not been given an answer of its own.
   *  'account' leaves a sign-in with pay-as-you-go on in play past its plan;
   *  'never' treats the plan's limit as the limit whatever billing allows. */
  use_overage: 'account' | 'never';
  /** Per sign-in, overriding the default above. One account spending past its
   *  plan while another never touches it is the ordinary case. */
  overage_by_account: Record<string, 'account' | 'never'>;
  /** The reading-to-reading step to assume before a real one has been
   *  measured. The margin is always at least this wide on a sign-in that must
   *  not spend past its plan; once the computer has watched the account long
   *  enough, a wider measured step takes over. */
  reserve: number;
  /** provider -> account ids, in the order they are tried. */
  order: Record<string, string[]>;
  max_hops: number;
}

/** Where one sign-in stands under the pool. */
export interface PoolAccount {
  account_id: string;
  provider: Provider;
  label: string;
  blocked: boolean;
  /** The window that blocked it, and when it comes back. */
  window: string | null;
  until: number | null;
  utilization: number | null;
  /** The plan is spent and pay-as-you-go is carrying the account. */
  on_overage: boolean;
  /** The tool says paid extra usage is covering sends right now. */
  spending: boolean;
  /** The widest jump seen between two readings of one window here, and the
   *  margin actually held back below the threshold because of it. */
  step: number | null;
  margin: number;
  /** This sign-in is not allowed to spend past its plan. */
  strict: boolean;
  /** Nothing has ever been measured for this sign-in. */
  unknown: boolean;
}

/** A limits report: every window the tool measured this turn. The window named
 *  at the top level is the one it singled out, and is repeated inside the list;
 *  it is kept here only for apps written before the list existed. */
export interface LimitsEvent extends LimitWindow {
  windows?: LimitWindow[];
  /** Whether `windows` is the whole plan or only the window the tool singled
   *  out. A one-window list cannot be told from a complete list of one, so the
   *  daemon says which it is — and a window missing from a complete report is
   *  a window the plan no longer has, not one to keep showing. */
  windows_complete?: boolean;
}

export interface CliAccount {
  has_key?: boolean;
  id: string;
  provider: Provider;
  label: string;
  logged_in: boolean;
  detail: string;
  /** The tier this sign-in is on — "max", "pro", "api", … Empty when the tool
   *  does not say; the app falls back to the provider's name. */
  plan?: string;
  is_default: boolean;
}

/** One way a tool can be signed in. The computer decides what is on offer;
 *  the app only knows how to describe each id. */
export interface LoginMethod {
  id: string;
  wants_email?: boolean;
  needs_code?: boolean;
  needs_key?: boolean;
  here?: boolean;
}

export interface ToolStatus {
  provider: Provider;
  version: string | null;
  path: string | null;
  login_methods?: LoginMethod[];
}

/** Sent only to the phone that started a login; never stored. */
export interface LoginPrompt {
  account_id: string;
  provider: Provider;
  url: string | null;
  url_host: string | null;
  code: string | null;
  needs_code: boolean;
  expires_at: number;
}

export interface LoginDone {
  account_id: string;
  ok: boolean;
  error_code?: string | null;
  detail: string;
  error: string | null;
  retryable: boolean;
}

// ── the ustabasi ticket queue ────────────────────────────────────────────────
// A ticket queue that runs on the computer without anybody watching: a worker,
// a check and an independent verifier, for hours. The daemon reads that queue's
// own database (`ustabasi.list`) and can answer one of its tickets through its
// own CLI (`ustabasi.note`). Nothing here is this app's state — it is a
// snapshot of somebody else's program, and most computers have none.

export type TicketStatus = 'queued' | 'running' | 'done' | 'blocked' | 'failed' | 'cancelled';

/** One line of the verifier's answer: the criterion as *it* worded it, and
 *  whether the work met it. Positional — the verifier answers the card's
 *  criteria in order but writes its own wording for each. */
export interface TicketCriterion { criterion: string; status: string; detail?: string }

/** One step the ticket has been through: a hand-over to a worker, a check, or a
 *  verifier. Read out of the queue's events table, which is the only record of
 *  how a ticket reached the round it is in — a worker restarted twice by a usage
 *  limit is three steps, not one.
 *
 *  Absent keys are absent rather than null. The one step with no `ended_at` is
 *  the one running right now. */
export interface TicketStep {
  stage: string;
  round: number;
  at: number;
  ended_at?: number;
  /** why it ended; missing on the step that has not */
  outcome?: 'ok' | 'rejected' | 'blocked' | 'failed' | 'cancelled' | 'stopped';
  pid?: number;
  model?: string;
  account?: string;
  /** one line of why, on a step that did not simply finish */
  note?: string;
}
export interface TicketVerdict { verdict?: string; findings?: TicketCriterion[] }
export interface TicketNote { ts: number; from: string; text: string }

export interface Ticket {
  id: number;
  title: string;
  status: TicketStatus;
  stage: string;
  round: number;
  repo: string;
  branch: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  goal: string;
  done_criteria: string[];
  /** What the worker stopped to ask, when it stopped. Empty otherwise — and on
   *  a finished ticket this is its closing report instead. */
  escalation: string;
  verdict: TicketVerdict | null;
  /** The last few only; `note_count` is how many there are in all. */
  notes: TicketNote[];
  note_count: number;
  last_event: { ts: number; kind: string; msg: string } | null;
  /** the project this is work on, by name: a ticket in babysee/app is babysee */
  project: string | null;
  /** when the round it is in began, which the queue's tickets table does not hold */
  round_started_at: number | null;
  /** what the worker has committed on the branch; null when there is nothing to say */
  git: { commits: number; subject: string } | null;
  /** every step it has been through, oldest first */
  steps: TicketStep[];
}

// ── a run's own log ──────────────────────────────────────────────────────────
// What the agent on a ticket is printing, as `ustabasi.run` hands it out: one
// record per block of the model's stream-json, a page at a time. The noise
// travels too — a hook firing is forty bytes — because what is worth drawing is
// this end's decision, not that one's. See src/transcript.ts.

export type RunEvent =
  | { k: 'text'; text: string; clipped?: boolean }
  | { k: 'thinking'; text: string; clipped?: boolean }
  | { k: 'tool'; id?: string; name: string; input: Record<string, any>; clipped?: boolean }
  | { k: 'result'; id?: string; text: string; error?: boolean; clipped?: boolean }
  | { k: 'done'; error?: boolean; subtype?: string; duration_ms?: number | null; cost?: number | null; output_tokens?: number | null }
  | { k: 'system'; subtype: string }
  | { k: 'other'; type: string };

export interface RunPage {
  available: boolean;
  /** the silence, where there is one: no_queue, no_ticket, never_run, no_log */
  reason: string;
  /** the run directory's own name, never its path */
  run?: string;
  events: RunEvent[];
  /** where to carry on from; null where there is nothing to carry on from */
  cursor: string | null;
  /** this page is not continuous with the last one — start again, do not append */
  reset?: boolean;
  /** the run is still being written */
  live: boolean;
  /** nothing more to read right now */
  caught_up: boolean;
  size?: number;
}

export interface UstabasiSnapshot {
  /** False on a computer that has the daemon but no queue, which is most of
   *  them. Not an error, and not the same as a daemon too old to be asked. */
  available: boolean;
  tickets: Ticket[];
  queue: { last_tick?: number | null; paused_until?: number | null };
}

// ── the Divan board ──────────────────────────────────────────────────────────
// The daemon owns how work is arranged; the ustabasi queue above stays the thing
// that does the coding. A project is a product and may own several repositories;
// a card sits in one of four columns at a position somebody chose, and what the
// agent on it is doing is a separate field the mirror writes. See
// docs/PROTOCOL.md, "The Divan board".

export type DivanColumn = 'ice_box' | 'queued' | 'in_progress' | 'done';

/** Who does the work. `coding_agent` is ustabasi; `human` is a card nothing
 *  runs on — it waits for a person and says so. */
export type DivanExecutor = 'coding_agent' | 'branch_agent' | 'assistant' | 'human';

/** Reality on a card, written by the mirror and by nothing else. `asking` is a
 *  stopped ticket with a question on it and `blocked` one without; `verified` is
 *  the verifier passing it, which is not the same as somebody being finished
 *  with it — that is the `done` column. */
export type AgentStatus = 'queued' | 'running' | 'asking' | 'blocked' | 'failed'
                        | 'verified' | 'cancelled';

export interface DivanBranch {
  id: string; kind: string; name: string;
  /** Empty until that branch has a source connected: a branch with nothing to
   *  say says nothing rather than a number nobody measured. */
  summary: string;
  summary_at: number | null;
  cards: Partial<Record<DivanColumn, number>>;
  open: number;
}

export interface DivanProject {
  id: string; name: string; slug: string; summary: string;
  /** A product is not a folder: isghocam owns its site and its API. */
  repos: string[];
  sort: number; archived: boolean; created_at: number; updated_at: number;
  branches: DivanBranch[];
  counts: Partial<Record<DivanColumn, number>>;
  running: number;
  /** The dashboard's real number: an agent that stopped to ask, one that was
   *  turned down, and every card whose executor is a person. */
  waiting: number;
  summary_line: string;
}

export interface DivanCard {
  id: string; project_id: string; branch_id: string; branch: string;
  column: DivanColumn; position: number;
  title: string; summary: string;
  executor: DivanExecutor | null;
  /** Which computer the work runs on. Null where nobody said, in which case it
   *  is the machine whose snapshot carried the card. */
  machine: string | null;
  repo: string | null;
  ustabasi_id: number | null;
  agent_status: AgentStatus | null;
  agent_status_at: number | null;
  agent_detail: string;
  created_at: number; updated_at: number; moved_at: number | null;
}

/** An agent at work right now, as a line on a dashboard. Only the running ones:
 *  a card that stopped to ask is waiting on a person rather than working. */
export interface DivanAgent {
  card_id: string; project_id: string; project: string; branch: string;
  title: string;
  executor: DivanExecutor | null;
  machine: string;
  status: AgentStatus | null;
  detail: string;
  since: number | null;
  ustabasi_id: number | null;
}

/** What one machine has left to run an agent on. `left` is the share of a
 *  window the roomiest sign-in still has — not a number of turns — and null
 *  while nothing has ever been measured, which is not a full plan. */
export interface DivanQuota {
  enabled: boolean;
  accounts: number;
  blocked: number;
  /** No sign-in left that could take a turn. */
  spent: boolean;
  left: number | null;
  /** When `left` goes back up, or when a spent machine starts work again. */
  resets_at: number | null;
  unknown: boolean;
}

/** What git says about one repository: when it last moved, and how much landed
 *  in it lately. The figure that says whether a product is alive at all, which
 *  the board cannot — an empty board with nine commits this week is busy.
 *
 *  `week` is the commits of the last seven days and `today` those since
 *  midnight on the machine that answered. A repository git would not answer
 *  about is left out of the map rather than reported as zero. */
export interface RepoActivity {
  at: number | null;
  week: number;
  today: number;
}

/** Everything one computer has to say about Divan. One request per machine, on
 *  connect, on foreground and on a slow timer; `at` is when it was true, which
 *  is what a silent machine is aged against. */
export interface DivanSnapshot {
  machine: string;
  os?: string;
  os_version?: string;
  daemon_version?: string;
  at: number;
  projects: DivanProject[];
  cards: DivanCard[];
  agents: DivanAgent[];
  quota: DivanQuota | null;
  /** Keyed by repository path, not by project: one product's figure is the
   *  union of its repositories, and two machines holding the same checkout must
   *  not have their commits counted twice. Absent on a daemon older than the
   *  figure. */
  activity?: Record<string, RepoActivity>;
  queue: { available?: boolean; last_tick?: number | null; paused_until?: number | null };
}
