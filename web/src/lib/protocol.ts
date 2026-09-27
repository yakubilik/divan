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
