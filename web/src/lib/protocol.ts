// Mirrors docs/PROTOCOL.md

import type { Ticket } from './ustabasi';

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
}

export interface Group { id: string; name: string; sort: number; created_at: number }

export interface HostInfo {
  name: string; os: string; os_version: string; daemon_version: string;
  uptime_s: number; active_sessions: number; connected_devices: number;
  versions: { claude: string | null; codex: string | null };
  roots: string[];
  transcription?: boolean;
  /** The commit this computer is actually running. `daemon_version` is a
   *  constant nobody remembers to raise and cannot tell two computers apart;
   *  this can. */
  revision?: Revision | null;
  /** …and this is the same fact said as a version. */
  release?: Release | null;
  /** When this daemon came up, and how many times it ever has. A restart is
   *  the one event a daemon cannot watch itself have — the process that would
   *  report it is the one that ended — so it is counted on the way back in. */
  started_at?: number;
  restarts?: number;
  last_update?: LastUpdate | null;
  update?: { behind: number; ahead: number; auto: boolean; repo: boolean;
             error?: string | null; checked_at?: number | null;
             web?: PanelBuild | null; latest?: string | null };
}

/** What a computer calls itself, derived from tags rather than declared.
 *  `v0.2.0` sits on a release; `v0.2.0+7` is seven commits past one, which is
 *  the normal state of a machine following main and is worth saying rather
 *  than rounding down. Null before the first tag, and on an install with no
 *  git to ask. */
export interface Release {
  version: string | null;
  tag: string | null;
  distance: number | null;
  dirty: boolean;
  commit: string | null;
}

/** The last time this computer actually moved. Read off disk: an update ends
 *  by restarting the daemon, so the process that did it is never the one
 *  reporting it. */
export interface LastUpdate {
  at: number;
  from: string | null;
  to?: string | null;
  version?: string | null;
  subject?: string | null;
  pulled?: boolean;
  web?: boolean;
  error?: string | null;
}

export interface Revision {
  repo: boolean;
  commit?: string; sha?: string; committed_at?: string; subject?: string;
  branch?: string; dirty?: boolean; dirty_files?: number;
  error?: string;
}

/** The bundle the browser is being served. It is build output and is not in
 *  git, so it can sit weeks behind the daemon serving it with nothing on
 *  screen to say so — which is the only reason this exists. `stale` is
 *  three-valued: null is a bundle nobody can place, not a current one. */
export interface PanelBuild {
  built: boolean;
  stale: boolean | null;
  npm: boolean;
  sha?: string | null;
  built_at?: number | null;
  reason?: string | null;
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
  web?: PanelBuild | null;
  release?: Release | null;
  /** The newest tag reachable from origin/main — one fetch answers both
   *  "which commit" and "which version". */
  latest?: string | null;
  last_update?: LastUpdate | null;
  blockers?: string[];
}

/** One chat holding work that stopping the daemon would destroy. */
export interface PendingWork { chat_id: string; busy: boolean; queued: number }

/** Who, if anyone, would start the daemon again. Three-valued on purpose:
 *  null is a platform the daemon cannot read, which is not the same as no. */
export interface Supervisor {
  supervised: boolean | null;
  how: string | null;
  detail: string | null;
}

export interface DaemonStatus {
  started_at: number;
  uptime_s: number;
  restarts: number;
  pending: PendingWork[];
  draining: { reason?: string; since?: number; deadline?: number; forced?: boolean } | null;
  last_restart?: { at: number; reason?: string; forced?: boolean; abandoned_chats?: string[] } | null;
  supervisor: Supervisor;
}

export interface Restarting {
  state: 'draining' | 'stopping' | 'cancelled';
  reason?: string | null;
  pending: PendingWork[];
  deadline?: number | null;
  forced?: boolean;
}

export interface RestartResult {
  ok: boolean;
  draining?: boolean;
  pending?: PendingWork[];
  deadline?: number | null;
  reason?: string | null;
  supervisor?: Supervisor;
  already?: boolean;
}

/** What `update.apply` answers with. The daemon and the panel are two jobs
 *  behind one button, and either can fail alone. */
export interface UpdateResult {
  ok: boolean;
  error?: string | null;
  pulled?: boolean;
  restarting?: boolean;
  revision?: Revision | null;
  web?: { rebuilt: boolean; commit?: string | null; error?: string | null };
}

export interface ProviderCatalog {
  models: { id: string; label: string; hint: string }[];
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

export interface CliAccount {
  has_key?: boolean;
  id: string;
  provider: Provider;
  label: string;
  logged_in: boolean;
  detail: string;
  is_default: boolean;
  /** The plan the sign-in is on ("max", "pro", "api", …), where the tool says. */
  plan?: string;
  /** A sign-in copied from another computer: signing out here does not sign
   *  that one out. */
  imported?: boolean;
  /** When this sign-in stops working and has to be made again — the moment the
   *  tool's own refresh token runs out, not the hourly token it renews by
   *  itself. Absent on a sign-in that does not end (an API key) and on a
   *  computer whose daemon does not report one, which is not the same as one
   *  that never expires: `lib/machine.ts` says nothing about a sign-in with no
   *  date rather than guessing at one. */
  expires_at?: number | null;
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

// ── the Divan board ──────────────────────────────────────────────────────────
// The daemon owns how work is arranged; the ustabasi queue stays the thing that
// does the coding. A project is a product and may own several repositories; a
// card sits in one of four columns at a position somebody chose, and what the
// agent on it is doing is a separate field the mirror writes. See
// docs/PROTOCOL.md, "The Divan board" — and `app/src/protocol.ts`, which is the
// same block: the phone and the panel read the same daemon.

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
  /** Empty until that branch has a source connected. */
  summary: string;
  summary_at: number | null;
  cards: Partial<Record<DivanColumn, number>>;
  open: number;
}

export interface DivanProject {
  /** `name` is what a screen says and `slug` is what two machines match the
   *  same product by. `summary` is what it is *for*. */
  id: string; name: string; slug: string; summary: string;
  /** What sort of thing it is — `app`, `web`, `library`, `client-work`… an open
   *  set. Empty where nobody said. */
  kind?: string;
  /** The day the product began, which is not `created_at`. */
  started_at?: number | null;
  /** A product is not a folder: isghocam owns its site and its API. */
  repos: string[];
  sort: number; archived: boolean; created_at: number; updated_at: number;
  /** The one row in that table that is not a product: the holding place for
   *  cards no product has claimed. Never in `snapshot.projects`. */
  hidden?: boolean;
  branches: DivanBranch[];
  counts: Partial<Record<DivanColumn, number>>;
  running: number;
  /** An agent that stopped to ask, one that was turned down, and every card
   *  whose executor is a person. */
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

/** The other face of a card: what an agent is told, as long as it needs to be.
 *  It travels only on `divan.card.get` — the board's card list carries the human
 *  face and the marks, which is how the rule that agent text never lands on
 *  `title` or `summary` is kept by the wire and not by a screen. */
export interface DivanAgentFace {
  goal: string;
  done_criteria: string[];
  verify_cmd: string;
  constraints: string[];
  paths: string[];
  notes: string;
}

/** …and the card with both of them, which is the one answer that has both. */
export interface DivanCardFull extends DivanCard {
  agent?: DivanAgentFace;
}

/** `divan.card.get`: one card, the product it is on, and the live half. `ticket`
 *  and `run` are null on a card no coding ticket was filed for. */
export interface DivanCardGet {
  card: DivanCardFull;
  project: DivanProject | null;
  /** That ticket as `ustabasi.list` reports one (`lib/ustabasi.ts`). */
  ticket: Ticket | null;
  /** A page of what the worker has printed. The wall is where a run is read —
   *  this page draws the conversation and not the stream — so nothing here
   *  unpacks it. */
  run: unknown;
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
 *  in it lately. A repository git would not answer about is left out of the map
 *  rather than reported as zero. */
export interface RepoActivity {
  at: number | null;
  week: number;
  today: number;
}

/** Everything one computer has to say about Divan, in one answer. `at` is when
 *  it was true, which is what a silent machine is aged against. */
export interface DivanSnapshot {
  machine: string;
  os?: string;
  os_version?: string;
  daemon_version?: string;
  at: number;
  projects: DivanProject[];
  /** The **open** board: everything outside `done`. That column grows for ever
   *  and `DivanProject.counts` already says how many are in it, so nothing on a
   *  dashboard is drawn from a card finished last March. */
  cards: DivanCard[];
  /** The work no product has claimed. Whole, `done` included, and in none of
   *  the counts above. Absent on a daemon older than the list. */
  unfiled?: DivanCard[];
  /** Which board to ask for to see them. */
  unfiled_project_id?: string;
  agents: DivanAgent[];
  quota: DivanQuota | null;
  /** Keyed by repository path, not by project. Absent on a daemon older than
   *  the figure. */
  activity?: Record<string, RepoActivity>;
  queue: { available?: boolean; last_tick?: number | null; paused_until?: number | null };
}
