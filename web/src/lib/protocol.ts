// Mirrors docs/PROTOCOL.md

import type { Ticket } from './ustabasi';
import type { TicketUsage } from './usage';

export type Provider = 'claude' | 'codex';
export type ChatStatus = 'idle' | 'running' | 'awaiting_approval';

export interface Chat {
  agent_id?: string | null;
  id: string;
  group_id: string | null;
  /** Whose chat this is, on a computer more than one person uses. Empty on a
   *  chat from before there were people: that one is the first person's. */
  owner?: string | null;
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
  /** The product this chat is work on, as that computer filed it from what
   *  its agent first touched — its id on the board, and the name a list draws.
   *  Filed once and never moved by the computer after; `chat.update` with a
   *  `project_id` sets it by hand. Absent from a daemon older than the filing;
   *  `null` when nothing claims the chat. */
  project_id?: string | null;
  project?: string | null;
  /** 1 once a person has put the chat under a product (or Unfiled) by hand. */
  project_set?: number;
  /** What the chat is working on, in a line, and what has been done in it, a
   *  line each — written by the computer as the chat goes. Absent from a
   *  daemon older than the product's Today. */
  task?: string | null;
  done?: string | null;
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
  default_perm_mode?: string;
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
  shared?: boolean;
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

/** What `pool.get` and `pool.set` both answer with. */
export interface PoolView { settings: PoolSettings; accounts: PoolAccount[] }

// ── what a worker is printing ────────────────────────────────────────────────
// A run writes the model's stream-json to a file on the computer that is doing
// the work, and `ustabasi.run` hands out the end of it a page at a time. These
// are the phone's own shapes (`app/src/protocol.ts`): one file, two clients.

export type RunEvent =
  | { k: 'text'; text: string; clipped?: boolean }
  | { k: 'thinking'; text: string; clipped?: boolean }
  | { k: 'tool'; id?: string; name: string; input: Record<string, any>; clipped?: boolean }
  | { k: 'result'; id?: string; text: string; error?: boolean; clipped?: boolean }
  | { k: 'done'; error?: boolean; subtype?: string; duration_ms?: number | null;
      cost?: number | null; output_tokens?: number | null }
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
  /** What this run left for a person to look at: the finished state of a
   *  screen it changed, as a file on that computer. Served over `/files` like
   *  anything else on disk. */
  shots?: { path: string; name: string; at: number; size: number }[];
}

// ── the Divan board ──────────────────────────────────────────────────────────
// The daemon owns how work is arranged; the ustabasi queue stays the thing that
// does the coding. A project is a product and may own several repositories; a
// card sits in one of four columns at a position somebody chose, and what the
// agent on it is doing is a separate field the mirror writes. See
// docs/PROTOCOL.md, "The Divan board" — and `app/src/protocol.ts`, which is the
// same block: the phone and the panel read the same daemon.

export type DivanColumn = 'ice_box' | 'queued' | 'in_progress' | 'review' | 'done';

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
  /** Where it is in its life: `idea`, `build`, `beta`, `live`, `growth`. The one
   *  fact about a product no counter on the machine can work out — a repository
   *  with three commits a day can be a dead experiment — so it is written by a
   *  person and empty until somebody says. */
  stage?: string;
  /** A product is not a folder: Quire owns its site and its API. */
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
  /** What happened to it, dated, oldest first — and what is promised, which is
   *  the same list with a date in the future. Absent from a daemon that
   *  predates it. */
  milestones?: DivanMilestone[];
  /** What it is still waiting on, worst first. Absent from a daemon that
   *  predates it. */
  open_items?: DivanOpenItem[];
}

/** One thing a product is still waiting on, and the thread under it.
 *
 *  Not a card: a card is work an agent can be handed, and most of these cannot
 *  be handed to anything on the computer — a token somebody has to make in a
 *  browser, a registrar sitting on a domain, a decision nobody has taken. */
export interface DivanOpenItem {
  id: string;
  project_id: string;
  title: string;
  /** What is actually needed, in a person's words. */
  body: string;
  state: DivanOpenState;
  /** Whose it is, where that is a person rather than this computer. */
  owner: string;
  /** What it is about: `payments`, `content`. */
  area: string;
  sort: number;
  comments: DivanComment[];
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export type DivanOpenState = 'blocked' | 'waiting' | 'todo' | 'done';

export interface DivanComment {
  at: number;
  /** Who said it. The two voices are a person and the assistant, and they are
   *  not the same kind of sentence. */
  who: string;
  text: string;
}

/** One dated thing in a product's life. `kind` is `start`, `live`, `target` or
 *  nothing: the three a page reads by name, and everything else is an event on
 *  the line. `note` is usually where the date was read from — a tag, a commit —
 *  so a line on a timeline can be checked against the thing behind it. */
export interface DivanMilestone {
  id: string;
  at: number;
  title: string;
  note: string;
  kind: string;
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
  /** What the ticket's runs took and used (`lib/usage.ts`). Null where there
   *  is no run of it on disk, and absent from a daemon that predates it. */
  usage?: TicketUsage | null;
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
  /** How much of its week the sign-in the snapshot was asked about has used —
   *  the subscription's own figure, read from the service for this answer.
   *  Absent from an older daemon, null where nothing current is known. */
  weekly?: { account: string; used: number; resets_at: number | null; at: number | null } | null;
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
