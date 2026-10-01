/** What the eight pages of the Machine drawer say, decided away from the screens
 *  that draw them.
 *
 *  Web15 draws all eight — Machines, Executors, Terminals, Remote screen,
 *  Accounts & sign-ins, Quota thresholds, Admin, Settings — as one column of
 *  rows and one page beside it, and six of those eight are a table: a machine
 *  and what it is doing, an executor and what it is on, a sign-in and when it
 *  stops working, a threshold and what it does when it is crossed. A table is
 *  arithmetic, and arithmetic belongs where `scripts/test-machine.mjs` can run
 *  it without a browser. Nothing in here draws anything and nothing in here
 *  holds a socket.
 *
 *  Two rules, and they are the same two the Dashboard's own decisions
 *  (`lib/overview.ts`) follow:
 *
 *    · **a figure with no source is not drawn.** A machine that has never
 *      answered has no quota, no last contact and no running count — it says so
 *      rather than reading `0%`, which is a measurement nobody made.
 *    · **a state is a word before it is a colour.** Every row carries the
 *      sentence as well as the tone, so the page is readable in grey.
 *
 *  What the panel cannot answer it does not put on screen. Web15's own frames
 *  draw a fleet of connected services — GitHub, Stripe, App Store Connect — and
 *  a cloud with backups in it; this panel talks to daemons on paired computers
 *  and the sign-ins it knows about are the ones its agents work through, so
 *  those are the rows. The shape is the frame's; the facts are the daemon's.
 */
import { create } from 'zustand';
import { outOfQuota, spent, waiting, type DivanView, type HostView, type MergedCard,
  type MergedQuota } from './divan';
import { executorWord } from './overview';
import { executorFace } from './sessions';
import type { Chat, CliAccount, DivanExecutor, LimitWindow, Provider } from './protocol';
import { EXECUTORS, type State, type Tone } from './theme';

/** How long ago, in whole words — the panel's own `uptime` where a duration is
 *  said out loud, and `ago` where a moment is. Passed in rather than chosen
 *  here, the way `lib/overview.ts` takes its own. */
export type Ago = (seconds: number | null) => string;
export type Stamp = (at: number | null) => string;

/** A percentage the frames' way: `41%`, and a word where nobody measured — a
 *  dash in a column of numbers is a number you cannot read, not an absence you
 *  can. */
export function pct(share: number | null | undefined): string {
  return share == null || !Number.isFinite(share) ? 'not measured' : `${Math.round(share * 100)}%`;
}

// ── 1 · the machines table (Web15 W12, Web14 W10) ───────────────────────────

/** What a row of that table can offer. The frame draws two or three buttons at
 *  the end of every row and a `···` after them; these are the ones that do
 *  something this panel can do, and the `···` is not drawn as a menu of
 *  nothing. `terminal`, `screen` and `folders` are the three pages that are
 *  about one computer, and pressing one goes there with that computer in hand. */
export type MachineAction = 'terminal' | 'screen' | 'folders' | 'retry' | 'remove';

export const ACTION_LABEL: Record<MachineAction, string> = {
  terminal: 'Terminal', screen: 'Screen', folders: 'Folders',
  retry: 'Try again', remove: 'Remove',
};

/** One machine, as the table reads it. */
export interface MachineLine {
  /** The key it was paired under, which is what an action names. */
  key: string;
  /** Its own name for itself, in mono. */
  machine: string;
  /** The grey line under it: `Mac Studio M2 Ultra · macOS 15.1`. Empty where the
   *  machine has never said what it is. */
  detail: string;
  state: State;
  /** `reachable`, `unreachable`, `never answered`. */
  says: string;
  tone: Tone;
  /** `12s ago`, or nothing at all where it never has. */
  contact: string;
  /** `3 tasks`, `1 · unknown`, `idle`. */
  running: string;
  /** How much of its plan today is gone — the frame's `quota use today`.
   *  `not measured` on a machine that measures none: a table with nothing to
   *  put in a cell says so in words, it does not draw a dash. */
  quota: string;
  quotaTone: Tone;
  actions: MachineAction[];
  /** The row washed in its state, which is what the frame does to the machine
   *  that cannot be reached. */
  wash: boolean;
}

export function machineLines(view: DivanView, ago: Ago, t: Thresholds): MachineLine[] {
  return view.hosts.map((h) => {
    const never = h.missing && h.age == null;
    const state: State = h.reachable ? 'running' : never ? 'quiet' : 'asking';
    return {
      key: h.key,
      machine: h.machine,
      detail: [[h.os, h.osVersion].filter(Boolean).join(' '), h.error]
        .filter(Boolean).join(' · '),
      state,
      says: h.reachable ? 'reachable' : never ? 'never answered' : 'unreachable',
      tone: h.reachable ? 'run' : never ? 'ink3' : 'amber',
      contact: h.age == null ? '' : `${ago(h.age)} ago`,
      running: runningWords(h),
      // Spent is not 100% used: a machine with nothing left says so in words.
      quota: outOfQuota(h) ? 'none left'
        : h.quota?.left == null ? 'not measured' : pct(1 - h.quota.left),
      quotaTone: hostQuotaTone(h, t),
      actions: h.reachable ? ['terminal', 'screen', 'folders'] : ['retry', 'remove'],
      wash: !h.reachable && !never,
    };
  });
}

/** What a machine is running, and whether that is still true. A machine that
 *  has gone quiet was running something when it was last heard and nobody can
 *  say what it is doing now, which is the frame's `1 · unknown`. */
function runningWords(h: HostView): string {
  if (h.missing) return 'unknown';
  if (!h.running) return h.reachable ? 'idle' : '0 · unknown';
  const tasks = `${h.running} task${h.running === 1 ? '' : 's'}`;
  return h.reachable ? tasks : `${h.running} · unknown`;
}

/** Which tone one machine's plan is read in — the thresholds applied to one
 *  computer rather than to the fleet, because it is one computer's row. */
function hostQuotaTone(h: HostView, t: Thresholds): Tone {
  if (!h.quota || h.stale || h.quota.unknown) return 'ink3';
  if (h.quota.spent) return 'red';
  if (h.quota.left == null) return 'ink3';
  if (h.quota.left <= t.stop) return 'red';
  if (h.quota.left <= t.warn) return 'amber';
  return 'ink2';
}

// ── 2 · the executors (Web15 W13, Web14 W10) ────────────────────────────────

/** One worker, running or not. The frame's columns are executor · what it's
 *  for · machine · doing now · state, and every one of them is read off the
 *  merge: an agent at work is a row, a reachable machine with no coding agent
 *  on it is the row that says that machine could take a ticket, and the cards
 *  whose executor is a person are one row for the person. */
export interface ExecutorLine {
  key: string;
  /** Which square the design system draws it with (`theme.EXECUTORS`). */
  face: string;
  who: string;
  /** What that kind of worker is for — the vocabulary's own sentence. */
  kind: string;
  /** The machine it is on, or nothing for the row that is you. */
  machine: string;
  /** What it is on right now. */
  doing: string;
  says: string;
  tone: Tone;
}

/** The order the table runs in: what is in trouble, then what is at work, then
 *  what is free. `unavailable` first because a worker on a machine that has
 *  gone quiet is the one fact on this page that wants a person. */
const EXEC_RANK: Record<string, number> = { unavailable: 0, waiting: 1, busy: 2, idle: 3 };

export function executorLines(view: DivanView): ExecutorLine[] {
  const stopped = spent(view);
  const out: ExecutorLine[] = [];

  for (const a of view.agents) {
    const says = a.unknown ? 'unavailable' : stopped.has(a.host) ? 'paused' : 'busy';
    const branch = (a.branch || '').trim();
    out.push({
      key: `${a.host}:${a.card_id}`,
      face: executorFace(a),
      // A branch agent is named by its branch — that is what it is — the same
      // way a card names the worker on it (`lib/board.ts`).
      who: a.executor === 'branch_agent' && branch ? branch : executorWord(a.executor),
      kind: kindOf(a.executor, branch),
      machine: a.machine,
      doing: [a.title, (a.detail || '').trim()].filter(Boolean).join(' · '),
      says,
      tone: says === 'unavailable' ? 'amber' : says === 'paused' ? 'red' : 'run',
    });
  }

  // A machine with nothing running on it is a machine that could take the next
  // ticket — which is what the frame's idle Coder row says. A machine that
  // cannot be reached cannot, and says that instead.
  const busy = new Set(view.agents.map((a) => a.host));
  for (const h of view.hosts) {
    if (busy.has(h.key) || h.missing) continue;
    const free = h.reachable && !outOfQuota(h);
    out.push({
      key: `${h.key}:free`,
      face: 'coder',
      who: executorWord('coding_agent'),
      kind: kindOf('coding_agent'),
      machine: h.machine,
      doing: free ? 'nothing assigned' : h.reachable ? 'no quota left' : 'machine silent',
      says: free ? 'idle' : 'unavailable',
      tone: free ? 'ink3' : 'amber',
    });
  }

  // …and the one worker that is not on any machine. Its work is every card a
  // person has to move, which is the count the Dashboard calls "needs you".
  const mine = view.cards.filter((c) => c.executor === 'human' && waiting(c));
  out.push({
    key: 'you',
    face: 'you',
    who: executorWord('human'),
    kind: kindOf('human'),
    machine: '',
    doing: mine.length ? youDoing(mine) : 'nothing waiting',
    says: mine.length ? `${mine.length} waiting` : 'idle',
    tone: mine.length ? 'amber' : 'ink3',
  });

  return out.sort((a, b) => rank(a) - rank(b));
}

const rank = (l: ExecutorLine) => EXEC_RANK[l.says] ?? (l.says.endsWith('waiting') ? 1 : 2);

function youDoing(cards: MergedCard[]): string {
  return cards.slice(0, 2).map((c) => c.title).join(' · ')
    + (cards.length > 2 ? ` · +${cards.length - 2}` : '');
}

/** What a kind of worker is for, in the design's own words (`EXECUTORS`) — and
 *  for a branch agent the design has no square for, its branch, which is the
 *  only thing that says what that one is for. */
export function kindOf(e: DivanExecutor | null, branch = ''): string {
  const known = EXECUTORS[executorFace({ executor: e, branch })];
  if (!known && e === 'branch_agent' && branch) return `branch agent · ${branch}`;
  return (known ?? EXECUTORS.unassigned).kind;
}

// ── 3 · accounts and sign-ins (Web15 W16) ───────────────────────────────────

/** A sign-in is expiring when it has less than this left. Two weeks: long
 *  enough that renewing it is a thing you do when it suits you, short enough
 *  that the row is not amber for a month. */
export const EXPIRING_SOON_S = 14 * 24 * 3600;

export type SignInState = 'connected' | 'expiring' | 'expired' | 'signedOut' | 'missing';

/** What one computer has to say about its sign-ins. Built from a `HostSlot`
 *  by the screen; taken as a plain shape here so the arithmetic can be run
 *  without a store. */
export interface SignInSource {
  hostKey: string;
  machine: string;
  online: boolean;
  accounts: CliAccount[];
  /** account id → the plan windows that account last reported */
  limits: Record<string, LimitWindow[]>;
  /** Which CLIs that computer actually has. A sign-in to a tool the machine
   *  has not installed is not a sign-in you can renew — it is a tool to
   *  install — and the computer says which it has (`host.info`). */
  versions?: { claude: string | null; codex: string | null } | null;
  /** what is open on that computer, for "used by" and "last used" */
  chats: Pick<Chat, 'account_id' | 'updated_at' | 'status'>[];
}

/** One row of Accounts & sign-ins. */
export interface SignIn {
  key: string;
  hostKey: string;
  accountId: string;
  /** Which tool this sign-in is for — what an installer would be asked to
   *  install, and which catalog it belongs to. */
  provider: Provider;
  /** The two letters in the square: `CL`, `CX`. */
  mark: string;
  title: string;
  /** Who it is signed in as, and on which computer. */
  note: string;
  state: SignInState;
  /** `connected`, `expires in 12 days`, `signed out`. */
  says: string;
  tone: Tone;
  /** What works through it: `4 chats · studio`. */
  usedBy: string;
  /** How much of the plan is gone, 0–1, for the ring in its own column. Null
   *  where nothing has ever been measured — which is not the same as a plan
   *  with everything left, so the ring is drawn hollow rather than empty. */
  used: number | null;
  /** A window refused a send and has not reset. */
  spent: boolean;
  /** When it last did. */
  lastUsed: string;
  /** `Renew`, `Sign in`, `Manage` — and pressing it opens the sign-in itself,
   *  which is the only thing that fixes any of the three. */
  action: string;
  /** This row is why the drawer's own count is amber. */
  wants: boolean;
}

const PROVIDER_MARK: Record<string, string> = { claude: 'CL', codex: 'CX' };

/** When a sign-in stops working, where the computer says. Null on a sign-in
 *  that has no end — an API key, and a tool that does not report one. */
export function expiresAt(a: CliAccount): number | null {
  const n = Number(a.expires_at);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function signInState(a: CliAccount, now: number, installed?: boolean): SignInState {
  // The computer's own answer first: a tool that is not on the machine is
  // `missing` whatever the account's own words say, because what that row
  // needs is an installer and not a login.
  if (installed === false) return 'missing';
  if (!a.logged_in) return /not installed/i.test(a.detail) ? 'missing' : 'signedOut';
  const at = expiresAt(a);
  if (at == null) return 'connected';
  if (at <= now) return 'expired';
  return at - now <= EXPIRING_SOON_S ? 'expiring' : 'connected';
}

/** What the row says out loud: the state in whole words and, while it is still
 *  working, how long that is true for. */
export function signInWords(a: CliAccount, now: number, ago: Ago, installed?: boolean): string {
  const state = signInState(a, now, installed);
  if (state === 'missing') return 'the CLI is not installed';
  if (state === 'signedOut') return 'signed out';
  if (state === 'expired') return 'expired · sign in again';
  if (state === 'expiring') return `expires in ${ago(Math.max(0, (expiresAt(a) as number) - now))}`;
  return 'connected';
}

const SIGN_IN_TONE: Record<SignInState, Tone> = {
  connected: 'run', expiring: 'amber', expired: 'red', signedOut: 'amber', missing: 'ink3',
};

const SIGN_IN_ACTION: Record<SignInState, string> = {
  connected: 'Manage', expiring: 'Renew', expired: 'Renew', signedOut: 'Sign in',
  // A tool that is not on the computer is installed, not managed. It is the
  // one row on that page whose button does the job itself.
  missing: 'Install',
};

/** Every sign-in on every paired computer, worst first: the ones that have
 *  stopped working, then the ones that are about to, then the rest. A sign-in
 *  that is about to stop is the one thing this page exists to say before it is
 *  too late to say it — so it is above the working ones and carries an amber
 *  count into the drawer, which is how you see it without opening the page. */
export function signIns(sources: SignInSource[], now: number, ago: Ago, stamp: Stamp): SignIn[] {
  const rows: SignIn[] = [];
  for (const s of sources) {
    for (const a of s.accounts) {
      const has = s.versions ? !!s.versions[a.provider as 'claude' | 'codex'] : undefined;
      const state = signInState(a, now, has);
      const used = s.chats.filter((c) => (c.account_id ?? '') === (a.is_default ? '' : a.id));
      // The default sign-in reports its windows under `default-<tool>`, which
      // is what "no account id" is called on the wire.
      const use = planUse(s.limits[a.is_default ? `default-${a.provider}` : a.id], now);
      const last = used.reduce((n, c) => Math.max(n, c.updated_at || 0), 0)
        || windowAt(s.limits[a.id]);
      rows.push({
        key: `${s.hostKey}:${a.id}`,
        hostKey: s.hostKey,
        accountId: a.id,
        provider: a.provider as Provider,
        mark: PROVIDER_MARK[a.provider] ?? a.provider.slice(0, 2).toUpperCase(),
        title: a.label,
        note: [a.detail.trim(), s.machine].filter(Boolean).join(' · '),
        state,
        says: signInWords(a, now, ago, has),
        tone: SIGN_IN_TONE[state],
        usedBy: usedWords(used.length, a.is_default, s.machine),
        used: use.top ? use.top.share : null,
        spent: use.spent,
        lastUsed: last ? stamp(last) : '',
        action: SIGN_IN_ACTION[state],
        // Everything that is not working wants something doing: a renewal, a
        // sign-in, or — now that the page can do it — an installer. A tool
        // that is not on the computer used to be the one broken row nobody
        // counted, because nothing here could have fixed it.
        wants: state !== 'connected',
      });
    }
  }
  const order: Record<SignInState, number> = {
    expired: 0, expiring: 1, signedOut: 2, missing: 3, connected: 4,
  };
  return rows.sort((a, b) => order[a.state] - order[b.state] || a.title.localeCompare(b.title));
}

function usedWords(chats: number, isDefault: boolean, machine: string): string {
  if (chats) return `${chats} chat${chats === 1 ? '' : 's'} · ${machine}`;
  return isDefault ? `new chats · ${machine}` : `nothing yet · ${machine}`;
}

/** The newest moment any of an account's plan windows was measured at. The
 *  tool only measures during a turn, so it is the last time that sign-in did
 *  any work — which is exactly the frame's `last used`. */
function windowAt(windows: LimitWindow[] | undefined): number {
  return (windows ?? []).reduce((n, w) => Math.max(n, w.at ?? 0), 0);
}

/** How many sign-ins want a person, for the amber number the drawer puts on the
 *  row (Web15 W16 draws `1`). Nothing rather than a zero. */
export function signInsWanting(rows: SignIn[]): number {
  return rows.filter((r) => r.wants).length;
}

// ── 4 · quota thresholds (Web15 W11) ────────────────────────────────────────

/** Where a thin plan starts to change what happens. Shares of a window rather
 *  than percentages, because that is what the daemon reports and a conversion
 *  in two places is a conversion that drifts.
 *
 *  Two of the frame's three are the panel's to keep: it is the panel that warns
 *  on the system line, and it is the panel that starts work when a card is
 *  dropped into In Progress. The third — pausing an agent that is already
 *  running — belongs to the machine it runs on, which does it at zero on its
 *  own (`DivanQuota.spent`), so it is stated on the page and not offered as a
 *  setting the panel cannot keep. */
export interface Thresholds {
  /** Below this, the fleet's quota is said in amber wherever it is said. */
  warn: number;
  /** Below this, the panel will not start new work on that machine. */
  stop: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { warn: 0.2, stop: 0.05 };

/** The one the machines keep themselves. */
export const PAUSE_AT = 0;

/** A threshold is a whole percent between nothing and everything, and stopping
 *  new work can never be set above warning about it — a panel that refused to
 *  start a ticket without having said anything first would be a panel that
 *  broke silently. Whichever of the two was moved is the one that wins. */
export function clampThresholds(next: Partial<Thresholds>, was: Thresholds): Thresholds {
  const round = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));
  const warn = next.warn == null ? was.warn : round(next.warn);
  const stop = next.stop == null ? was.stop : round(next.stop);
  if (next.stop != null && stop > warn) return { warn: stop, stop };
  if (next.warn != null && warn < stop) return { warn, stop: warn };
  return { warn, stop };
}

const KEY = 'rac.quota';

function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d !== 'object') return DEFAULT_THRESHOLDS;
    return clampThresholds({
      warn: Number.isFinite(d.warn) ? d.warn : DEFAULT_THRESHOLDS.warn,
      stop: Number.isFinite(d.stop) ? d.stop : DEFAULT_THRESHOLDS.stop,
    }, DEFAULT_THRESHOLDS);
  } catch { return DEFAULT_THRESHOLDS; }
}

interface ThresholdState {
  thresholds: Thresholds;
  setThreshold: (patch: Partial<Thresholds>) => void;
}

/** Where the two live. They are this browser's, not a computer's: the machines
 *  do not know them and nothing is sent anywhere when they change — what they
 *  govern is what this panel says and what it starts. */
export const useThresholds = create<ThresholdState>((set, get) => ({
  thresholds: loadThresholds(),
  setThreshold: (patch) => {
    const thresholds = clampThresholds(patch, get().thresholds);
    set({ thresholds });
    try { localStorage.setItem(KEY, JSON.stringify(thresholds)); } catch { /* private mode */ }
  },
}));

export type QuotaState = 'unknown' | 'ok' | 'warn' | 'stop' | 'spent';

/** Where the fleet stands against the two thresholds, as a word, a tone and a
 *  sentence. This is the one reading of quota the Machine place has: the
 *  drawer's dot, the machines page's own line and the refusal to start work are
 *  three drawings of it, not three opinions. */
export interface QuotaVerdict {
  state: QuotaState;
  says: string;
  tone: Tone;
  /** What it means, in one line under it. */
  body: string;
}

export function quotaVerdict(q: MergedQuota, t: Thresholds): QuotaVerdict {
  if (q.unknown || (q.left == null && !q.spent)) {
    return {
      state: 'unknown', says: 'not measured', tone: 'ink3',
      body: 'No computer has measured a plan window yet. Nothing is being held back.',
    };
  }
  if (q.spent) {
    return {
      state: 'spent', says: 'no quota left', tone: 'red',
      body: 'Agents are stopped where they were. They pick up again on their own at reset.',
    };
  }
  const left = q.left ?? 0;
  const says = `${pct(left)} left`;
  if (left <= t.stop) {
    return { state: 'stop', says, tone: 'red',
      body: `Under the ${pct(t.stop)} you set: new tickets will not be started.` };
  }
  if (left <= t.warn) {
    return { state: 'warn', says, tone: 'amber',
      body: `Under the ${pct(t.warn)} you set: work still starts, and this line is amber.` };
  }
  return { state: 'ok', says, tone: 'run', body: 'Enough left to start work anywhere.' };
}

/** Would the panel start a ticket on this machine? The one place the `stop`
 *  threshold is enforced — a card dropped into In Progress is what starts a
 *  worker, so it is where the answer is asked for. Unknown is yes: a machine
 *  that has never measured a window is not a machine that is out. */
export function startsWork(h: HostView | null | undefined, t: Thresholds): boolean {
  if (!h) return true;
  if (outOfQuota(h)) return false;
  if (h.stale || !h.quota || h.quota.unknown || h.quota.left == null) return true;
  return h.quota.left > t.stop;
}

/** …and what the board says when it will not. Names the machine and the
 *  setting, because a refusal whose reason is a number you chose is a refusal
 *  you can undo. */
export function refusedWords(h: HostView, t: Thresholds): string {
  return outOfQuota(h)
    ? `${h.machine} has no quota left. Its agents pick up again at reset.`
    : `${h.machine} is at ${pct(h.quota?.left ?? 0)}, under the ${pct(t.stop)} you set for starting new work.`;
}

// ── 5 · admin (Web15 W17) ───────────────────────────────────────────────────

/** One row of the Admin page: a thing about this installation, what is true of
 *  it, and the one button that does something about it. The frame's own rows
 *  are backups to a cloud, a log kept ninety days and a monthly budget; this
 *  panel has no cloud and no budget, and what it does have is a computer
 *  running a checkout of this repository, a wall with every step on it, the
 *  sign-ins the agents work through and the folders they may open. Those are
 *  the rows. */
export interface AdminLine {
  key: string;
  title: string;
  note: string;
  says: string;
  tone: Tone;
  /** The button, and the page it opens. */
  action: string;
  goes: string;
}

export interface AdminSource {
  machine: string;
  online: boolean;
  /** `host.info.update`, as it arrives on connect. */
  behind: number;
  webStale: boolean;
  update: boolean;
  version: string;
  roots: number;
  /** How many sign-ins every paired computer has between them, and null while
   *  no computer has answered `account.list` yet — which is not zero. A daemon
   *  always reports at least its own two, so an empty list is a question nobody
   *  has asked rather than a computer with nothing signed in. */
  signIns: number | null;
  wantingSignIns: number;
  chats: number;
  spend: number;
  folders: number;
}

export function adminLines(s: AdminSource, cost: (n: number) => string): AdminLine[] {
  return [
    {
      key: 'update',
      title: 'Update',
      note: 'the daemon on this computer and the panel it serves, from this repository',
      says: !s.online ? 'offline'
        : s.update ? (s.behind > 0 ? `${s.behind} behind` : 'panel behind the daemon')
        : s.version || 'up to date',
      tone: s.update ? 'amber' : 'ink3',
      action: 'Open',
      goes: 'update',
    },
    {
      key: 'logs',
      title: 'Agent logs',
      note: 'every step every agent took, on the wall it took them on',
      says: `${s.chats} session${s.chats === 1 ? '' : 's'}`,
      tone: 'ink3',
      action: 'Open',
      goes: 'terminal',
    },
    {
      key: 'keys',
      title: 'Sign-ins and keys',
      note: 'what the agents work through, and which of them is expiring',
      says: s.signIns == null ? 'not read yet'
        : s.wantingSignIns ? `${s.wantingSignIns} want you`
        : `${s.signIns} connected`,
      tone: s.wantingSignIns ? 'amber' : 'ink3',
      action: 'Manage',
      goes: 'accounts',
    },
    {
      key: 'folders',
      title: 'Folders',
      note: 'the repositories on this computer, and what git says about them',
      says: `${s.folders} folder${s.folders === 1 ? '' : 's'}`,
      tone: 'ink3',
      action: 'Open',
      goes: 'projects',
    },
    {
      key: 'roots',
      title: 'What an agent may open',
      note: 'the folders outside which nothing that runs here can read or write',
      says: s.roots ? `${s.roots} root${s.roots === 1 ? '' : 's'}` : 'not reported',
      tone: s.roots ? 'ink3' : 'amber',
      action: 'Change',
      goes: 'preferences',
    },
    {
      key: 'spend',
      title: 'What this has cost',
      note: 'every session this computer holds, added up — what was spent, not what is left',
      says: cost(s.spend),
      tone: 'ink3',
      action: 'Open',
      goes: 'terminal',
    },
  ];
}

// ── 6 · what is left of a plan (the ring on the chat head) ──────────────────

/** A plan's windows, in the order the plan names them rather than by how full
 *  they are. A reader looking for the weekly figure looks in the same place
 *  every time; sorting by fullness moves it. */
const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];

/** …and what each is called. The phone's words (`app/src/i18n.ts`), because a
 *  window that reads `5-hour` on the phone and `Session` here is two things to
 *  anybody holding both. */
export const WINDOW_NAME: Record<string, string> = {
  five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet', overage: 'Extra usage',
};

/** Amber from 60 %, red from 90 %, and the plain colour under that — the same
 *  three the phone's ring uses. */
export type LimitTone = 'plain' | 'warn' | 'danger';

export function limitTone(share: number): LimitTone {
  if (share >= 0.9) return 'danger';
  if (share >= 0.6) return 'warn';
  return 'plain';
}

/** One window, ready to draw. */
export interface PlanWindow {
  key: string;
  label: string;
  /** 0–1, clamped: a reading over its own limit is still a full ring. */
  share: number;
  tone: LimitTone;
  /** When it refills, in words. Empty where the tool did not say. */
  resets: string;
  /** How old this reading is, in words. */
  measured: string;
  /** A newer report has stopped mentioning this window, so it is a leftover
   *  rather than a current reading. */
  stale: boolean;
}

/** Everything the ring and the card under it need from one account's report. */
export interface PlanUse {
  windows: PlanWindow[];
  /** The fullest window — what the ring draws, and the only number on the
   *  head. Null where nothing has been measured. */
  top: PlanWindow | null;
  /** The newest reading's age, in words, for the head of the card. */
  measured: string;
  /** Nobody has measured anything yet. Different from "nothing is used": the
   *  tool only reports during a turn, so a fresh sign-in has no reading at
   *  all, and a ring drawn at zero would be a claim nobody made. */
  unknown: boolean;
  /** A window refused a send and has not reset. The plan is spent. */
  spent: boolean;
}

export function planUse(windows: LimitWindow[] | undefined, now: number): PlanUse {
  const all = (windows ?? []).filter((w) => typeof w.utilization === 'number');
  // Every window of one report is measured at the same instant, so a window
  // behind the newest reading is one the tool has stopped reporting.
  const newest = all.reduce((n, w) => Math.max(n, w.at ?? 0), 0);
  const drawn: PlanWindow[] = all
    .slice()
    .sort((a, b) => (WINDOW_ORDER.indexOf(a.window) + 1 || 99)
      - (WINDOW_ORDER.indexOf(b.window) + 1 || 99))
    .map((w) => {
      const share = Math.max(0, Math.min(1, w.utilization ?? 0));
      return {
        key: w.window,
        label: WINDOW_NAME[w.window] ?? w.window,
        share,
        tone: limitTone(share),
        resets: resetsWords(w.resets_at, now),
        measured: measuredWords(w.at, now),
        stale: newest - (w.at ?? 0) > 60,
      };
    });
  const top = drawn.reduce<PlanWindow | null>(
    (best, w) => (best && best.share >= w.share ? best : w), null);
  return {
    windows: drawn,
    top,
    measured: measuredWords(newest || undefined, now),
    unknown: drawn.length === 0,
    spent: (windows ?? []).some((w) => w.status === 'rejected'
      && (w.resets_at == null || w.resets_at > now)),
  };
}

/** When a window refills. */
export function resetsWords(at: number | null | undefined, now: number): string {
  if (!at) return '';
  const left = at - now;
  if (left <= 0) return 'Resetting now';
  const h = Math.floor(left / 3600);
  if (h < 24) return `Resets in ${h}h ${Math.floor((left % 3600) / 60)}m`;
  const d = new Date(at * 1000);
  return `Resets ${d.toLocaleDateString(undefined, { weekday: 'short' })} `
    + `${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** How old a reading is. Said out loud because these numbers only move while a
 *  turn runs: after an idle hour the ring is a memory, not a measurement. */
export function measuredWords(at: number | null | undefined, now: number): string {
  if (!at) return '';
  const m = Math.floor((now - at) / 60);
  if (m < 2) return 'measured just now';
  if (m < 60) return `measured ${m} min ago`;
  return `measured ${Math.floor(m / 60)} h ago`;
}
