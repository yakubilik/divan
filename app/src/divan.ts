// One Divan view across every paired computer, kept away from the screens that
// draw it so it can be checked without a phone (scripts/test-divan-merge.cjs).
// Nothing in here touches React, the store or the palette.
//
// The phone used to be able to look at one computer at a time: the machine was
// the top-level context and everything — chats, folders, accounts, the ticket
// wall — was scoped to whichever one was active. Divan turns that over. The
// project is the context and the machine is a detail of a running task:
// isghocam's site may be checked out on the studio and its API on the mini, and
// that is one project with cards on two machines, not two projects and not a
// question about which computer you happen to be holding a socket to.
//
// So every Divan surface reads all of them at once, and the merging has to
// happen here rather than on any daemon: each daemon knows only its own board,
// and the fact the whole merge turns on — how long ago each machine last
// answered — exists only where the asking happens.
//
// Three rules come out of that, and they are what this file is:
//
//   * **a silent machine never disappears.** Its last answer is kept and shown
//     as what it was, with how long ago that was. Dropping it would quietly
//     remove five running agents from a dashboard, which is worse than a number
//     that admits it is old.
//   * **freshness travels with the data.** Every host, project, card and agent
//     carries the machine it came from and whether that machine is still
//     answering, so a screen can mark the two rows that are stale and leave the
//     rest live.
//   * **totals say when they are incomplete.** A counter built out of one live
//     machine and one that has been quiet for two hours is not a count, unless
//     it says so.
//
// The active computer decides where a terminal opens and whose screen is
// mirrored. Nothing here reads it, and nothing here can: the paired list and the
// snapshots are the whole input.
import type {
  DivanAgent, DivanBranch, DivanCard, DivanColumn, DivanProject, DivanQuota, DivanSnapshot,
  RepoActivity,
} from './protocol';

/** How often a screen that is open re-asks every machine. The board moves when
 *  a worker does — a stage boundary is minutes apart, not seconds — and this is
 *  several requests rather than one, each waking a computer that may be asleep.
 *  The wall's own eight seconds is for a screen somebody is watching a single
 *  ticket on; a dashboard has no business polling that hard. */
export const DIVAN_POLL_MS = 60_000;

/** How long one machine is given to answer before the view is drawn without it.
 *  A laptop with the lid shut does not refuse a connection, it says nothing, and
 *  the default thirty seconds of a request would mean half a minute of blank
 *  screen for a machine that was never going to answer. */
export const DIVAN_TIMEOUT_MS = 8000;

/** After this long without a successful contact, a machine's data is old whether
 *  or not the last attempt failed. Three missed polls: the timer has been asleep
 *  in the background, or the app has been, and neither is a reason to keep
 *  presenting a two-hour-old count as current. */
export const STALE_AFTER_S = 3 * (DIVAN_POLL_MS / 1000);

/** Left to right, and the order a board is drawn in. */
export const COLUMNS: DivanColumn[] = ['ice_box', 'queued', 'in_progress', 'done'];

/** What the phone keeps for one paired computer: its last answer, however old,
 *  and whether the last attempt to get one worked. The two are separate on
 *  purpose — a snapshot eight minutes stale beats an error where a board was. */
export interface HostDivan {
  snapshot: DivanSnapshot | null;
  /** When that snapshot arrived, in seconds. Null until one ever has. */
  at: number | null;
  /** The last attempt succeeded. */
  reachable: boolean;
  /** …and why not, where it did not. */
  error: string | null;
  /** The failure was "I have never heard of that request": a computer running a
   *  daemon older than this screen, which is a thing to say once rather than a
   *  machine that is down. */
  old: boolean;
}

export const NO_DIVAN: HostDivan = { snapshot: null, at: null, reachable: false, error: null, old: false };

/** What a machine's entry becomes when it answers. `at` is this end's clock and
 *  not the snapshot's: the two computers' clocks are not the same clock, and
 *  what a screen says out loud — "silent for 2h 14m" — is time this phone has
 *  waited, which is the only one it can measure honestly.
 *
 *  The shape is filled in here rather than trusted, because a daemon one version
 *  older than this screen is an ordinary thing to be paired with and a missing
 *  list must read as an empty one, not crash a dashboard. */
export function answered(snap: Partial<DivanSnapshot> | null | undefined, at: number): HostDivan {
  return {
    snapshot: {
      machine: snap?.machine ?? '',
      os: snap?.os, os_version: snap?.os_version, daemon_version: snap?.daemon_version,
      at: typeof snap?.at === 'number' ? snap.at : at,
      projects: snap?.projects ?? [],
      cards: snap?.cards ?? [],
      agents: snap?.agents ?? [],
      quota: snap?.quota ?? null,
      activity: snap?.activity ?? {},
      queue: snap?.queue ?? {},
    },
    at, reachable: true, error: null, old: false,
  };
}

/** …and what it becomes when it does not answer: exactly what it was, plus the
 *  reason it did not.
 *
 *  This is the rule the whole ticket turns on. A board eight minutes stale,
 *  marked as eight minutes stale, beats an empty screen about a computer that was
 *  working a moment ago — and five running agents dropped from a dashboard
 *  because a laptop lid closed is the failure nobody would notice. Nothing is
 *  thrown away here; only `merge` decides what the kept data is still worth. */
export function silent(prev: HostDivan | null | undefined,
                       error: string | null, old = false): HostDivan {
  const was = prev ?? NO_DIVAN;
  return { snapshot: was.snapshot, at: was.at, reachable: false, error, old };
}

/** A paired computer and what the phone has of it. */
export interface HostEntry { id: string; name: string; state: HostDivan }

/** One machine in the merged view: whether it is answering, how long since it
 *  was, and what it is carrying. */
export interface HostView {
  id: string;
  /** The name this phone pairs it under. */
  name: string;
  /** The name it calls itself, which is the one the frames show. Falls back to
   *  the paired name until it has answered once. */
  machine: string;
  os: string | null;
  reachable: boolean;
  /** It has answered at some point, but what is in hand is not current. */
  stale: boolean;
  /** It has never answered at all: there is nothing of it to draw. */
  missing: boolean;
  /** Its daemon has never heard of the request. */
  old: boolean;
  error: string | null;
  /** When it last answered, and how long ago that is. Null where it never has. */
  at: number | null;
  age: number | null;
  /** What it was carrying when it last answered. */
  projects: number;
  cards: number;
  running: number;
  waiting: number;
  quota: DivanQuota | null;
  queue: DivanSnapshot['queue'] | null;
}

/** A card, with the machine it runs on and whether that machine is still
 *  answering. `machine` is the card's own where it has one and otherwise the
 *  computer that carried it: a card nobody assigned is worked where it lives. */
export interface MergedCard extends DivanCard {
  host: string;
  hostName: string;
  machine: string;
  /** Which merged product it belongs to. `project_id` is one machine's id for
   *  its own copy and means nothing on the other; this is the key both copies
   *  were folded under, so a screen can attribute a card without doing the
   *  matching again. */
  projectKey: string;
  stale: boolean;
}

export interface MergedAgent extends DivanAgent {
  host: string;
  hostName: string;
  projectKey: string;
  /** Its machine has gone quiet: this agent was running when we last heard, and
   *  nobody can say what it is doing now. The fourth counter on the dashboard. */
  unknown: boolean;
  /** …and when that was. */
  since_contact: number | null;
}

export interface MergedBranch extends Omit<DivanBranch, 'cards'> {
  cards: Partial<Record<DivanColumn, number>>;
  /** Which machines this branch's work is spread over. */
  machines: string[];
}

/** A product's own history, folded out of every repository it owns on every
 *  machine it is on. `at` is the newest commit any of them has seen; the two
 *  counts add up across repositories, which is what makes a product with its
 *  site on one machine and its API on another one figure. */
export interface ProjectActivity {
  at: number | null;
  week: number;
  today: number;
}

/** One product, however many machines it is checked out on. */
export interface MergedProject {
  /** What the same product on two machines is matched by. */
  key: string;
  name: string;
  slug: string;
  summary: string;
  /** What sort of thing it is — `app`, `web`, `content`, `client-work` — as
   *  somebody wrote it. Empty where nobody said, which is every product that
   *  predates the field; the project page then draws what it is *for* alone
   *  rather than a guessed word. */
  kind: string;
  repos: string[];
  /** The paired computers this product has work on, and their names. */
  hosts: string[];
  machines: string[];
  /** Each machine's own id for this product, by host id. Two computers are two
   *  databases and give the same product two ids, so this is the only way to
   *  write to one of them — a card is created on one machine (`src/compose.ts`)
   *  and `project_id` there means nothing on the other. */
  ids: Record<string, string>;
  branches: MergedBranch[];
  counts: Partial<Record<DivanColumn, number>>;
  running: number;
  waiting: number;
  cards: MergedCard[];
  /** How many of `running` are on a machine that has gone quiet — the frame's
   *  "2 agents, state unknown". The figure above is what was last known and is
   *  drawn as such; this is how much of it is a memory. */
  unknown: number;
  /** …and how many are stopped where they were because their machine has no
   *  quota left (Mobile5 S2). They pick up again on their own, so this is a
   *  clock rather than a fault. */
  paused: number;
  /** …and that clock: the first moment any of *those* agents can start again,
   *  read off the machines they are stopped on and nowhere else.
   *
   *  It is on the project rather than being looked up from the fleet's figure
   *  because the two are not the same number. `MergedQuota.resets_at` is when
   *  the roomiest machine's window rolls over, which on a fleet where one
   *  computer is spent and another is not belongs to the computer that is
   *  *still running* — printing it beside "3 paused" would put a live machine's
   *  hour on a card whose work stopped somewhere else.
   *
   *  Null where none of the stopped machines said when, which is a card that
   *  says its agents are paused and does not say until when. */
  pausedUntil: number | null;
  updated_at: number;
  /** What git says about the repositories it owns: when the product last moved
   *  and how much landed in the last seven days. Null where no repository of it
   *  could be read — a product with no repository attached, or a machine whose
   *  daemon is older than the figure. Absent, never zero: nobody measured it.
   *
   *  What a product *earns* is the third figure and has no source yet, so there
   *  is no field for it here at all. */
  activity: ProjectActivity | null;
  /** One of the machines it lives on has gone quiet, so these numbers are not
   *  all current. */
  stale: boolean;
  /** Which ones, and when the oldest of them last answered. */
  staleMachines: string[];
  lastSeen: number | null;
}

/** The counters at the top of a dashboard. Every one of them is counted, and
 *  the last three exist because counting across a machine that is not answering
 *  needs saying out loud. */
export interface Totals {
  needsYou: number;
  stuck: number;
  running: number;
  /** Agents that were running on a machine that has since gone quiet. */
  unknown: number;
  queued: number;
  /** Agents on a machine that has run out of quota: stopped where they were,
   *  and they pick up again on their own. */
  paused: number;
  machines: number;
  reachable: number;
  /** Every paired machine answered, and recently enough to be believed. */
  complete: boolean;
  /** The oldest answer any of this is built out of — "partly as of 21:02". Null
   *  when nothing has answered at all. */
  asOf: number | null;
  /** What was finished today, across every repository every product owns. Null
   *  where no machine could read one: the fourth counter is then a figure with
   *  no source and the dashboard puts something it does count in its place. */
  doneToday: number | null;
}

/** What the whole fleet has left to run an agent on. */
export interface MergedQuota {
  /** The roomiest machine's share, which is where the next agent would start. */
  left: number | null;
  resets_at: number | null;
  /** No machine has a sign-in left that could take a turn. */
  spent: boolean;
  /** The ones that are out, by name. */
  spentMachines: string[];
  /** Nothing has ever been measured anywhere. */
  unknown: boolean;
}

export interface DivanView {
  hosts: HostView[];
  projects: MergedProject[];
  cards: MergedCard[];
  agents: MergedAgent[];
  totals: Totals;
  quota: MergedQuota;
  /** The moment this was worked out, in seconds. The one thing in the view that
   *  is not read off a snapshot — staleness is measured against it — so it
   *  travels with the answer rather than each screen fetching a clock of its own
   *  and ageing the same machine to two different numbers on one page. */
  now: number;
}

/** The paired list and what the phone holds for each, as one list. Hosts with
 *  nothing yet are in it too: a machine that has never answered is part of the
 *  view — it is the part that says so. */
export function entries(hosts: { id: string; name: string }[],
                        divan: Record<string, HostDivan>): HostEntry[] {
  return hosts.map((h) => ({ id: h.id, name: h.name, state: divan[h.id] ?? NO_DIVAN }));
}

/** A card that needs a person before anything else happens to it. The same rule
 *  the daemon counts `waiting` by (divan.py `_waiting`), applied to one card so
 *  that a screen can mark it as well as count it. */
export function waiting(card: { column: string; agent_status: string | null; executor: string | null }): boolean {
  if (card.column === 'done') return false;
  if (card.agent_status === 'asking' || card.agent_status === 'blocked' || card.agent_status === 'failed') return true;
  return card.executor === 'human' && card.column === 'in_progress';
}

/** A card an agent gave up on or was turned down on. Red, and a subset of the
 *  above: it needs a person, and it needs one because something went wrong
 *  rather than because somebody was asked a question. */
export function stuck(card: { agent_status: string | null }): boolean {
  return card.agent_status === 'blocked' || card.agent_status === 'failed';
}

/** What the same product on two machines is matched by. The slug is the
 *  daemon's own (`divan.py slugify`) and two computers that were told the same
 *  name produce the same one; the lower-cased name is the fallback for a
 *  daemon that sends none. */
function projectKey(p: DivanProject): string {
  return (p.slug || '').trim() || (p.name || '').trim().toLowerCase();
}

/** How one machine stands, before anything is merged. */
function hostView(e: HostEntry, now: number): HostView {
  const snap = e.state.snapshot;
  const at = e.state.at;
  const age = at == null ? null : Math.max(0, now - at);
  // Old data is old whether the last attempt failed or nobody made one. A
  // machine that answered two hours ago and has been asked nothing since is
  // exactly as unreliable as one that refused two hours ago.
  const past = age != null && age > STALE_AFTER_S;
  return {
    id: e.id,
    name: e.name,
    machine: (snap?.machine || '').trim() || e.name,
    os: snap?.os ?? null,
    reachable: e.state.reachable && !past,
    stale: !!snap && (!e.state.reachable || past),
    missing: !snap,
    old: e.state.old,
    error: e.state.error,
    at,
    age,
    projects: snap?.projects.length ?? 0,
    cards: snap?.cards.length ?? 0,
    running: snap?.agents.length ?? 0,
    waiting: (snap?.projects ?? []).reduce((n, p) => n + (p.waiting || 0), 0),
    quota: snap?.quota ?? null,
    queue: snap?.queue ?? null,
  };
}

/** A machine is out of quota: its agents are stopped where they were and pick
 *  up again on their own. Only a machine that is answering can be said to be
 *  out — a quota reading from a computer that has been quiet for two hours says
 *  nothing about now.
 *
 *  Exported because every screen that says anything about an agent has to ask
 *  it: the merge's own `paused` count, the Dashboard's agent roster and a
 *  product's `now` line are three readings of one fact, and a second spelling of
 *  it is how one of them came to call a stopped agent a running one. */
export function outOfQuota(h: HostView): boolean {
  return !!h.quota?.spent && !h.stale;
}

/** …and the machines that are, by id, out of a whole view. The set a screen
 *  actually wants: an agent is stopped if its host is in here. */
export function spent(view: { hosts: HostView[] }): Set<string> {
  return new Set(view.hosts.filter(outOfQuota).map((h) => h.id));
}

/** Everything the phone has, as one view. `now` is a clock in seconds — the
 *  only thing in here that is not read off the snapshots, because staleness is
 *  the one fact that goes on changing while nobody asks anything. */
export function merge(list: HostEntry[], now: number): DivanView {
  const hosts = list.map((e) => hostView(e, now));
  const byId = new Map(hosts.map((h) => [h.id, h]));

  // Which merged product each machine's own project id belongs to. Two machines
  // give the same product two ids — they are separate databases — so this is the
  // only bridge between a card and the product it is work on.
  const keyOf = new Map<string, string>();
  for (const e of list) {
    for (const p of e.state.snapshot?.projects ?? []) keyOf.set(`${e.id}:${p.id}`, projectKey(p));
  }

  const cards: MergedCard[] = [];
  const agents: MergedAgent[] = [];
  for (const e of list) {
    const h = byId.get(e.id)!;
    const snap = e.state.snapshot;
    if (!snap) continue;
    for (const c of snap.cards) {
      cards.push({ ...c, host: h.id, hostName: h.name, machine: (c.machine || '').trim() || h.machine,
                   projectKey: keyOf.get(`${h.id}:${c.project_id}`) ?? '', stale: h.stale });
    }
    for (const a of snap.agents) {
      agents.push({ ...a, host: h.id, hostName: h.name, machine: (a.machine || '').trim() || h.machine,
                    projectKey: keyOf.get(`${h.id}:${a.project_id}`) ?? '',
                    unknown: h.stale, since_contact: h.at });
    }
  }

  // ── one entry per product, however many machines it is on ────────────────
  const byKey = new Map<string, MergedProject>();
  for (const e of list) {
    const h = byId.get(e.id)!;
    for (const p of e.state.snapshot?.projects ?? []) {
      const key = projectKey(p);
      const found = byKey.get(key);
      if (!found) {
        byKey.set(key, {
          key,
          name: p.name,
          slug: p.slug,
          summary: p.summary || '',
          kind: p.kind || '',
          repos: [...(p.repos || [])],
          hosts: [h.id],
          machines: [h.machine],
          ids: { [h.id]: p.id },
          branches: (p.branches || []).map((b) => ({
            ...b, cards: { ...(b.cards || {}) }, machines: work(b) ? [h.machine] : [] })),
          counts: { ...(p.counts || {}) },
          running: p.running || 0,
          waiting: p.waiting || 0,
          cards: [],
          unknown: 0,
          paused: 0,
          pausedUntil: null,
          activity: null,
          updated_at: p.updated_at || 0,
          stale: h.stale,
          staleMachines: h.stale ? [h.machine] : [],
          lastSeen: h.stale ? h.at : null,
        });
        continue;
      }
      // The second machine this product is on. Everything countable adds up;
      // everything written down is taken from whichever copy was edited last,
      // because a product's name and description are one thing said twice and
      // not two halves of one thing.
      const newer = (p.updated_at || 0) > found.updated_at;
      found.name = newer ? p.name : found.name;
      found.summary = newer && p.summary ? p.summary : (found.summary || p.summary || '');
      found.kind = newer && p.kind ? p.kind : (found.kind || p.kind || '');
      found.updated_at = Math.max(found.updated_at, p.updated_at || 0);
      found.repos = [...new Set([...found.repos, ...(p.repos || [])])].sort();
      found.hosts = [...new Set([...found.hosts, h.id])];
      found.machines = [...new Set([...found.machines, h.machine])];
      found.ids[h.id] = p.id;
      found.running += p.running || 0;
      found.waiting += p.waiting || 0;
      for (const col of COLUMNS) {
        const n = (p.counts || {})[col];
        if (n) found.counts[col] = (found.counts[col] || 0) + n;
      }
      mergeBranches(found, p, h.machine);
      if (h.stale) {
        found.stale = true;
        found.staleMachines = [...new Set([...found.staleMachines, h.machine])];
        // The oldest of them: a project half of whose numbers are from 21:02
        // and half from 22:40 is as old as the older half.
        found.lastSeen = found.lastSeen == null ? h.at
          : h.at == null ? found.lastSeen : Math.min(found.lastSeen, h.at);
      }
    }
  }

  // ── what git said, by path ───────────────────────────────────────────────
  // Keyed by path on the wire for exactly this: the same checkout reported by
  // two machines is one entry here, not two, so a product on both of them is
  // not counted twice. Where they disagree the newer reading wins — a machine
  // that has been asleep for two hours read its own `git log` two hours ago.
  const history = new Map<string, RepoActivity>();
  for (const e of list) {
    for (const [path, a] of Object.entries(e.state.snapshot?.activity ?? {})) {
      const had = history.get(path);
      if (!had || (a.at ?? 0) > (had.at ?? 0)) history.set(path, a);
    }
  }

  // A machine with no quota left has stopped its agents where they were; that is
  // a different thing from a machine that is not answering, and a project card
  // has to be able to say which (Mobile5 S1 against S2).
  const stopped = new Set(hosts.filter(outOfQuota).map((h) => h.id));

  const projects = [...byKey.values()].sort(order);
  for (const p of projects) {
    p.cards = cards.filter((c) => c.projectKey === p.key);
    p.unknown = agents.filter((a) => a.projectKey === p.key && a.unknown).length;
    const held = agents.filter((a) => a.projectKey === p.key && !a.unknown && stopped.has(a.host));
    p.paused = held.length;
    // The earliest of the machines its own agents are stopped on: the first
    // moment any of this product's work moves again. A machine that is spent and
    // cannot say when it comes back contributes nothing rather than a guess.
    p.pausedUntil = held
      .map((a) => byId.get(a.host)?.quota?.resets_at ?? null)
      .filter((at): at is number => at != null)
      .sort((x, y) => x - y)[0] ?? null;
    p.activity = fold(p.repos.map((path) => history.get(path)));
  }

  // ── the counters ─────────────────────────────────────────────────────────
  // A machine that has gone quiet still counts for what a person has to do:
  // a ticket that stopped to ask a question does not answer itself while the
  // machine is unreachable, and nothing but a person changes it. What cannot be
  // carried over is what an agent is *doing*, which is why running and unknown
  // are two counters and not one.
  const totals: Totals = {
    needsYou: cards.filter(waiting).length,
    stuck: cards.filter(stuck).length,
    running: agents.filter((a) => !a.unknown && !stopped.has(a.host)).length,
    unknown: agents.filter((a) => a.unknown).length,
    queued: cards.filter((c) => c.column === 'queued').length,
    paused: agents.filter((a) => !a.unknown && stopped.has(a.host)).length,
    machines: hosts.length,
    reachable: hosts.filter((h) => h.reachable).length,
    complete: hosts.length > 0 && hosts.every((h) => h.reachable && !h.missing),
    asOf: hosts.reduce<number | null>((oldest, h) => (
      h.at == null ? oldest : oldest == null ? h.at : Math.min(oldest, h.at)), null),
    // Every repository once, whatever product claims it: the counter is "what
    // was finished today", and a repository two products share is one history.
    doneToday: history.size === 0 ? null
      : [...history.values()].reduce((n, a) => n + (a.today || 0), 0),
  };

  return { hosts, projects, cards, agents, totals, quota: fleetQuota(hosts), now };
}

/** The branches of a product that is on two machines. A branch is a face of the
 *  product — engineering, seo — and both machines have the same faces, so the
 *  counts add up and the machines each face has work on are recorded. A summary
 *  is whichever machine wrote one most recently; an empty one never wins,
 *  because a branch with no source connected says nothing rather than
 *  overwriting the branch that has one. */
function mergeBranches(into: MergedProject, p: DivanProject, machine: string): void {
  for (const b of p.branches || []) {
    const found = into.branches.find((x) => x.kind === b.kind);
    if (!found) {
      into.branches.push({ ...b, cards: { ...(b.cards || {}) }, machines: work(b) ? [machine] : [] });
      continue;
    }
    for (const col of COLUMNS) {
      const n = (b.cards || {})[col];
      if (n) found.cards[col] = (found.cards[col] || 0) + n;
    }
    found.open += b.open || 0;
    if (b.summary && (b.summary_at || 0) >= (found.summary_at || 0)) {
      found.summary = b.summary;
      found.summary_at = b.summary_at;
    }
    if (work(b)) found.machines = [...new Set([...found.machines, machine])];
  }
}

/** Several repositories' histories as one product's. The counts add up and the
 *  clock is the newest of them; nothing measured at all stays nothing measured,
 *  because a product with no repository attached has no figure rather than a
 *  zero one. */
function fold(list: (RepoActivity | undefined)[]): ProjectActivity | null {
  const found = list.filter((a): a is RepoActivity => !!a);
  if (!found.length) return null;
  return {
    at: found.reduce<number | null>((newest, a) => (
      a.at == null ? newest : newest == null ? a.at : Math.max(newest, a.at)), null),
    week: found.reduce((n, a) => n + (a.week || 0), 0),
    today: found.reduce((n, a) => n + (a.today || 0), 0),
  };
}

/** Is there any work on this branch at all? A branch every product has and
 *  nobody has used says nothing, and naming the machines it is "on" would be
 *  naming every machine the product is on. */
function work(b: DivanBranch): boolean {
  return (b.open || 0) > 0 || Object.values(b.cards || {}).some((n) => (n || 0) > 0);
}

/** Worst first. A project with something waiting on a person comes before one
 *  whose numbers cannot be trusted, which comes before one that is merely busy
 *  — that is the order the question "what needs me" is asked in at three in the
 *  morning, and it is the only order a list of twelve products can be read in.
 *  Ties go to whatever moved most recently, and then to the name so that the
 *  list does not shuffle under a thumb. */
function order(a: MergedProject, b: MergedProject): number {
  const rank = (p: MergedProject) => (p.waiting ? 0 : p.stale ? 1 : p.running ? 2 : 3);
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  const moved = b.updated_at - a.updated_at;
  return moved !== 0 ? moved : a.name.localeCompare(b.name);
}

/** What the fleet has left. The next agent starts on the roomiest machine, so
 *  that machine's figure is the one that matters; a machine that is not
 *  answering has no figure worth reading, whatever its last one said. */
function fleetQuota(hosts: HostView[]): MergedQuota {
  const live = hosts.filter((h) => h.quota && !h.stale);
  const room = live.filter((h) => h.quota!.left != null && !h.quota!.spent)
    .sort((x, y) => y.quota!.left! - x.quota!.left!);
  const best = room[0];
  const spentMachines = live.filter((h) => h.quota!.spent).map((h) => h.machine);
  const spent = live.length > 0 && live.every((h) => h.quota!.spent);
  const backs = live.filter((h) => h.quota!.spent && h.quota!.resets_at != null)
    .map((h) => h.quota!.resets_at!).sort((x, y) => x - y);
  return {
    left: best ? best.quota!.left : (spent ? 0 : null),
    // Spent everywhere: when the first machine comes back. Otherwise the clock
    // belongs to the figure above it, which is the roomiest machine's window.
    resets_at: spent ? (backs[0] ?? null) : (best?.quota!.resets_at ?? null),
    spent,
    spentMachines,
    unknown: live.length > 0 && !best && !spent,
  };
}

/** One project out of the merged view, by the key it was merged under or by its
 *  name. A screen that was opened on a product and then lost the machine it was
 *  reading from still has the product. */
export function project(view: DivanView, key: string): MergedProject | null {
  const k = (key || '').trim().toLowerCase();
  return view.projects.find((p) => p.key === k || p.slug === k || p.name.toLowerCase() === k) ?? null;
}

/** The cards of one project in one column, in the order somebody put them in.
 *  Position is per machine, so two machines' queues interleave by position and
 *  then by machine name — which is arbitrary, and stable, and the only honest
 *  answer to "who is third" when two people arranged two lists. */
export function column(p: MergedProject, col: DivanColumn): MergedCard[] {
  return p.cards.filter((c) => c.column === col)
    .sort((a, b) => (a.position - b.position) || a.machine.localeCompare(b.machine));
}
