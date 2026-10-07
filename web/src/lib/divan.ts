/** One Divan view across every paired computer, for the panel.
 *
 *  The panel has always talked to every computer at once — that is what it is
 *  for — but what it merged was chats: a list per machine, and the machine was
 *  the thing you were looking at. Divan turns that over. The project is the
 *  context and the machine is a detail of a running task: Quire's site may be
 *  checked out on the studio and its API on the mini, and that is one product
 *  with cards on two machines, not two products and not a question about which
 *  socket you happen to be holding.
 *
 *  So the merging happens here, on this end, rather than on any daemon: each
 *  daemon knows only its own board, and the fact the merge turns on — how long
 *  ago each machine last answered — exists only where the asking happens. Three
 *  rules come out of that, and they are what this file is:
 *
 *    · **a silent machine never disappears.** Its last answer is kept and shown
 *      as what it was. Dropping it would quietly remove five running agents
 *      from a page, which is worse than a number that admits it is old.
 *    · **freshness travels with the data.** Every host, project and card
 *      carries the machine it came from and whether that machine is still
 *      answering, so a screen can mark the two projects that are stale and
 *      leave the rest live.
 *    · **a total says when it is incomplete.** A count built out of one live
 *      machine and one that has been quiet for two hours is not a count unless
 *      it says so.
 *
 *  It is deliberately the phone's file under another roof: `app/src/divan.ts`
 *  merges the same snapshots by the same rules for the same screens, down to
 *  the names (`answered`, `silent`, `waiting`, `stuck`, `projectKey`). Two
 *  clients that disagreed about which product a card belongs to would be two
 *  different products. The agreement is not a hope: `scripts/test-overview.mjs`
 *  compiles this file and the phone's together, hands them the same boards and
 *  compares every figure the two put on a screen. What is here is everything a
 *  desktop screen counts — the machines, the products, the agents at work, what
 *  each computer has left to start one on and what git said about the
 *  repositories a product owns, and the faces it has beside its code.
 *
 *  Nothing in here draws anything, and the poll at the bottom is the only part
 *  that knows there is a socket: `scripts/test-shell.mjs` and
 *  `scripts/test-overview.mjs` hold the merge to these rules with no daemon
 *  anywhere.
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useFleet, type HostSlot } from './fleet';
import { limitsKey } from './compose';
import { usePrefs } from './prefs';
import { toldDefaults } from './tell';
import type {
  DivanAgent, DivanBranch, DivanCard, DivanColumn, DivanMilestone, DivanOpenItem, DivanProject, DivanQuota,
  DivanSnapshot, RepoActivity,
} from './protocol';

/** How often a screen that is open re-asks every machine. The board moves when
 *  a worker does — a stage boundary is minutes apart, not seconds — and this is
 *  one request per machine rather than one in total. */
export const DIVAN_POLL_MS = 60_000;

/** The four, in the order the board runs in. The labels are `lib/overview.ts`'s;
 *  this is the set, for the places that add a column up rather than name it. */
export const COLUMNS: DivanColumn[] = ['ice_box', 'queued', 'in_progress', 'done'];

/** How long one machine is given to answer before the view is drawn without it.
 *  A laptop with the lid shut does not refuse a request, it says nothing, and
 *  the socket's own thirty seconds would mean half a minute of a page that
 *  cannot say which machine it is waiting for. */
export const DIVAN_TIMEOUT_MS = 8000;

/** After this long without a successful contact, a machine's data is old
 *  whether or not the last attempt failed. Three missed polls: the tab has been
 *  in the background, or asleep, and neither is a reason to keep presenting a
 *  two-hour-old count as current. */
export const STALE_AFTER_S = 3 * (DIVAN_POLL_MS / 1000);

/** What the panel keeps for one paired computer: its last answer, however old,
 *  and whether the last attempt to get one worked. The two are separate on
 *  purpose — a board eight minutes stale beats an error where a board was. */
export interface HostDivan {
  snapshot: DivanSnapshot | null;
  /** When that snapshot arrived, in seconds. Null until one ever has. */
  at: number | null;
  /** The last attempt succeeded. */
  reachable: boolean;
  /** …and why not, where it did not. */
  error: string | null;
  /** The failure was "I have never heard of that request": a computer running a
   *  daemon older than this panel, which is a thing to say once rather than a
   *  machine that is down. */
  old: boolean;
}

export const NO_DIVAN: HostDivan = { snapshot: null, at: null, reachable: false, error: null, old: false };

/** What a machine's entry becomes when it answers. `at` is this end's clock and
 *  not the snapshot's: the two computers' clocks are not the same clock, and
 *  what a screen says out loud — "silent for 2h 14m" — is time this browser has
 *  waited, which is the only one it can measure honestly.
 *
 *  The shape is filled in here rather than trusted, because a daemon one
 *  version older than this panel is an ordinary thing to be paired with and a
 *  missing list must read as an empty one, not throw on a render. */
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
 *  reason it did not. Nothing is thrown away here; only `merge` decides what
 *  the kept data is still worth. */
export function silent(prev: HostDivan | null | undefined,
                       error: string | null, old = false): HostDivan {
  const was = prev ?? NO_DIVAN;
  return { snapshot: was.snapshot, at: was.at, reachable: false, error, old };
}

/** "This computer has never heard of that request" — an older daemon, which is
 *  a sentence rather than a fault. */
export function oldDaemon(e: { message?: string } | null | undefined): boolean {
  return /unknown (type|request)/i.test(e?.message || '');
}

/** A paired computer and what the panel has of it. */
export interface HostEntry { key: string; name: string; state: HostDivan }

/** One machine in the merged view: whether it is answering, how long since it
 *  was, and what it is carrying. */
export interface HostView {
  key: string;
  /** The name this browser paired it under. */
  name: string;
  /** The name it calls itself, which is the one the frames show. Falls back to
   *  the paired name until it has answered once. */
  machine: string;
  os: string | null;
  /** …and which of it, where the machine says: the grey line under a machine's
   *  name on Web15 W12 is what it is running, not only what kind of thing it
   *  is. Null on a daemon that does not say. */
  osVersion: string | null;
  reachable: boolean;
  /** It has answered at some point, but what is in hand is not current. */
  stale: boolean;
  /** It has never answered at all: there is nothing of it to draw. */
  missing: boolean;
  /** Its daemon has never heard of the request. */
  old: boolean;
  error: string | null;
  /** When it last answered, and how long ago that is. */
  at: number | null;
  age: number | null;
  projects: number;
  cards: number;
  running: number;
  waiting: number;
  /** What it has left to start an agent on, as it last said. Null on a daemon
   *  that does not measure one. */
  quota: DivanQuota | null;
}

/** One face of a product — engineering, seo, analytics — as both machines have
 *  it. The phone's own type, down to the name (`app/src/divan.ts`). */
export interface MergedBranch extends Omit<DivanBranch, 'cards'> {
  cards: Partial<Record<DivanColumn, number>>;
  /** Which machines this branch's work is spread over. */
  machines: string[];
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
   *  were folded under. */
  projectKey: string;
  stale: boolean;
}

/** An agent at work, with the computer it is working on. */
export interface MergedAgent extends DivanAgent {
  host: string;
  hostName: string;
  projectKey: string;
  /** Its machine has gone quiet: this agent was running when we last heard, and
   *  nobody can say what it is doing now. The fourth counter. */
  unknown: boolean;
  /** …and when that was. */
  since_contact: number | null;
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
  kind: string;
  /** Where it is in its life (`idea`…`growth`), and the day it began. Both are
   *  written by a person and both are empty on a product nobody has said them
   *  about — a page draws the gap rather than a guess. */
  stage: string;
  started_at: number | null;
  /** What has happened to it, dated, oldest first, promises included. */
  milestones: DivanMilestone[];
  /** …and what it has not done yet, worst first. */
  open: DivanOpenItem[];
  repos: string[];
  /** The paired computers this product has work on, and their names. */
  hosts: string[];
  machines: string[];
  /** That machine's own id for this product, by host key. A write names one
   *  computer's row — a card is created on a machine — and two machines give the
   *  same product two ids, so the merged key cannot be sent anywhere. */
  ids: Record<string, string>;
  /** Its faces beside the code, in the order the computer keeps them. */
  branches: MergedBranch[];
  /** Its board: everything outside `done`, and of `done` only the last month,
   *  because that column grows for ever and nothing on a dashboard is drawn
   *  from a card finished last March. How many are in it altogether is in
   *  `counts` and nowhere else. */
  cards: MergedCard[];
  /** How many cards are in each column, added up across the machines. The
   *  daemon counts these over its whole board, `done` included, which is why
   *  they are read rather than counted here. */
  counts: Partial<Record<DivanColumn, number>>;
  running: number;
  /** Cards that need a person: an agent that stopped to ask, one that was
   *  turned down, and every card whose executor is a person. The daemon's own
   *  count (`divan.py _waiting`), added up. */
  waiting: number;
  /** …and how many of those are stuck rather than asking: an agent gave up or
   *  was turned down. Counted here, off the open cards, because it is the one
   *  of the three the daemon does not send. */
  stuck: number;
  /** How many of `running` are on a machine that has gone quiet — the frame's
   *  "2 agents, state unknown". The figure above is what was last known and is
   *  drawn as such; this is how much of it is a memory. */
  unknown: number;
  /** …and how many are stopped where they were because their machine has no
   *  quota left. They pick up again on their own, so this is a clock rather
   *  than a fault. */
  paused: number;
  /** …and that clock: the first moment any of *those* agents can start again,
   *  read off the machines they are stopped on and nowhere else. Null where
   *  none of them said when. */
  pausedUntil: number | null;
  /** What git says about the repositories it owns: when the product last moved
   *  and how much landed in the last seven days. Null where no repository of it
   *  could be read — absent, never zero: nobody measured it. */
  activity: ProjectActivity | null;
  updated_at: number;
  /** One of the machines it lives on has gone quiet, so these numbers are not
   *  all current. */
  stale: boolean;
  /** Which ones, and when the oldest of them last answered. Null while
   *  everything about the product is current: there is no age to print. */
  staleMachines: string[];
  lastSeen: number | null;
}

/** The figures the shell itself says out loud. Every one of them is counted,
 *  and the last three exist because counting across a machine that is not
 *  answering needs saying out loud. */
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
  /** The oldest answer any of this is built out of — "partly as of 21:02".
   *  Null when nothing has answered at all. */
  asOf: number | null;
  /** What was finished today, across every repository every product owns. Null
   *  where no machine could read one: the fourth counter is then a figure with
   *  no source and the page puts something it does count in its place. */
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
  /** The week of the subscription chats open on: the first machine that has
   *  one to report. Null where none does. */
  weekly: NonNullable<DivanQuota['weekly']> | null;
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
   *  travels with the answer rather than each screen fetching a clock of its
   *  own and ageing the same machine to two different numbers on one page. */
  now: number;
}

/** A card that needs a person before anything else happens to it. The same rule
 *  the daemon counts `waiting` by (divan.py `_waiting`), applied to one card so
 *  that a screen can mark it as well as count it — and so that the panel and
 *  the phone (`app/src/divan.ts`) answer "what needs you" with the same set. */
export function waiting(card: { column: string; agent_status: string | null; executor: string | null }): boolean {
  if (card.column === 'done') return false;
  if (card.agent_status === 'asking' || card.agent_status === 'blocked' || card.agent_status === 'failed') return true;
  return card.executor === 'human' && card.column === 'in_progress';
}

/** A card an agent gave up on or was turned down on. Red, and a subset of what
 *  the daemon counts as waiting: it needs a person, and it needs one because
 *  something went wrong rather than because somebody was asked a question. */
export function stuck(card: { agent_status: string | null }): boolean {
  return card.agent_status === 'blocked' || card.agent_status === 'failed';
}

/** What the same product on two machines is matched by. The slug is the
 *  daemon's own (`divan.py slugify`) and two computers that were told the same
 *  name produce the same one; the lower-cased name is the fallback for a daemon
 *  that sends none. */
export function projectKey(p: Pick<DivanProject, 'slug' | 'name'>): string {
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
    key: e.key,
    name: e.name,
    machine: (snap?.machine || '').trim() || e.name,
    os: snap?.os ?? null,
    osVersion: snap?.os_version ?? null,
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
  };
}

/** A machine is out of quota: its agents are stopped where they were and pick
 *  up again on their own. Only a machine that is answering can be said to be
 *  out — a quota reading from a computer that has been quiet for two hours says
 *  nothing about now.
 *
 *  Exported because every screen that says anything about an agent has to ask
 *  it: the merge's own `paused` count and the Dashboard's agent roster are two
 *  readings of one fact, and a second spelling of it is how one of them came to
 *  call a stopped agent a running one. */
export function outOfQuota(h: HostView): boolean {
  return !!h.quota?.spent && !h.stale;
}

/** …and the machines that are, by the key they were paired under, out of a
 *  whole view. The set a screen actually wants: an agent is stopped if its host
 *  is in here. */
export function spent(view: { hosts: HostView[] }): Set<string> {
  return new Set(view.hosts.filter(outOfQuota).map((h) => h.key));
}

/** Everything the panel has, as one view. `now` is a clock in seconds — the
 *  only thing in here that is not read off the snapshots, because staleness is
 *  the one fact that goes on changing while nobody asks anything. */
export function merge(list: HostEntry[], now: number): DivanView {
  const hosts = list.map((e) => hostView(e, now));
  const byKey = new Map(hosts.map((h) => [h.key, h]));

  // Which merged product each machine's own project id belongs to. Two machines
  // give the same product two ids — they are separate databases — so this is
  // the only bridge between a card and the product it is work on.
  const keyOf = new Map<string, string>();
  for (const e of list) {
    for (const p of e.state.snapshot?.projects ?? []) keyOf.set(`${e.key}:${p.id}`, projectKey(p));
  }

  const cards: MergedCard[] = [];
  const agents: MergedAgent[] = [];
  for (const e of list) {
    const h = byKey.get(e.key)!;
    const snap = e.state.snapshot;
    if (!snap) continue;
    for (const c of snap.cards) {
      cards.push({
        ...c, host: h.key, hostName: h.name,
        machine: (c.machine || '').trim() || h.machine,
        projectKey: keyOf.get(`${h.key}:${c.project_id}`) ?? '',
        stale: h.stale,
      });
    }
    for (const a of snap.agents) {
      agents.push({
        ...a, host: h.key, hostName: h.name,
        machine: (a.machine || '').trim() || h.machine,
        projectKey: keyOf.get(`${h.key}:${a.project_id}`) ?? '',
        unknown: h.stale, since_contact: h.at,
      });
    }
  }

  // ── one entry per product, however many machines it is on ────────────────
  const products = new Map<string, MergedProject>();
  for (const e of list) {
    const h = byKey.get(e.key)!;
    for (const p of e.state.snapshot?.projects ?? []) {
      // The holding place for unclaimed work is not a product and is never
      // drawn as one, whatever a daemon puts in the list.
      if (p.hidden) continue;
      const key = projectKey(p);
      const found = products.get(key);
      if (!found) {
        products.set(key, {
          key,
          name: p.name,
          slug: p.slug,
          summary: p.summary || '',
          kind: p.kind || '',
          stage: p.stage || '',
          started_at: p.started_at ?? null,
          milestones: [...(p.milestones || [])],
          open: [...(p.open_items || [])],
          repos: [...(p.repos || [])],
          hosts: [h.key],
          machines: [h.machine],
          ids: { [h.key]: p.id },
          branches: (p.branches || []).map((b) => ({
            ...b, cards: { ...(b.cards || {}) }, machines: work(b) ? [h.machine] : [] })),
          cards: [],
          counts: { ...(p.counts || {}) },
          running: p.running || 0,
          waiting: p.waiting || 0,
          stuck: 0,
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
      // The same product on a second machine: the numbers add up, the words are
      // whichever copy was edited last, and one quiet machine makes the product
      // stale without hiding what the other one is doing.
      const newer = (p.updated_at || 0) > found.updated_at;
      found.name = newer ? p.name : found.name;
      found.summary = newer && p.summary ? p.summary : (found.summary || p.summary || '');
      found.kind = newer && p.kind ? p.kind : (found.kind || p.kind || '');
      found.stage = newer && p.stage ? p.stage : (found.stage || p.stage || '');
      found.started_at = newer && p.started_at != null
        ? p.started_at : (found.started_at ?? p.started_at ?? null);
      // A history is one product's, not one machine's: whichever copy was
      // edited last is the one that has it, and a machine that has never been
      // told does not empty the list the other one holds.
      if ((newer && p.milestones?.length) || !found.milestones.length) {
        found.milestones = [...(p.milestones || found.milestones)];
      }
      if ((newer && p.open_items?.length) || !found.open.length) {
        found.open = [...(p.open_items || found.open)];
      }
      found.hosts = [...new Set([...found.hosts, h.key])];
      found.machines = [...new Set([...found.machines, h.machine])];
      found.ids[h.key] = p.id;
      mergeBranches(found, p, h.machine);
      found.repos = [...new Set([...found.repos, ...(p.repos || [])])].sort();
      found.running += p.running || 0;
      found.waiting += p.waiting || 0;
      for (const [column, n] of Object.entries(p.counts || {})) {
        const col = column as DivanColumn;
        found.counts[col] = (found.counts[col] ?? 0) + (n ?? 0);
      }
      found.updated_at = Math.max(found.updated_at, p.updated_at || 0);
      if (h.stale) {
        found.stale = true;
        found.staleMachines = [...new Set([...found.staleMachines, h.machine])];
        // The oldest of them: a product half of whose numbers are from 21:02
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
  // has to be able to say which.
  const stopped = new Set(hosts.filter(outOfQuota).map((h) => h.key));

  const projects = [...products.values()].sort(order);
  for (const p of projects) {
    p.cards = cards.filter((c) => c.projectKey === p.key);
    p.stuck = p.cards.filter(stuck).length;
    p.unknown = agents.filter((a) => a.projectKey === p.key && a.unknown).length;
    const held = agents.filter((a) => a.projectKey === p.key && !a.unknown && stopped.has(a.host));
    p.paused = held.length;
    // The earliest of the machines its own agents are stopped on: the first
    // moment any of this product's work moves again.
    p.pausedUntil = held
      .map((a) => byKey.get(a.host)?.quota?.resets_at ?? null)
      .filter((at): at is number => at != null)
      .sort((x, y) => x - y)[0] ?? null;
    p.activity = fold(p.repos.map((path) => history.get(path)));
  }

  // ── the counters ─────────────────────────────────────────────────────────
  // A machine that has gone quiet still counts for what a person has to do: a
  // ticket that stopped to ask a question does not answer itself while the
  // machine is unreachable, and nothing but a person changes it. What cannot be
  // carried over is what an agent is *doing*, which is why running and unknown
  // are two counters and not one. Counted off the cards and the agents, the way
  // `app/src/divan.ts` counts them — the two clients say the same number about
  // the same board or one of them is wrong.
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
 *  overwriting the branch that has one. The phone's rule, in its own words
 *  (`app/src/divan.ts mergeBranches`). */
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

/** Is there any work on this branch at all? A branch every product has and
 *  nobody has used says nothing, and naming the machines it is "on" would be
 *  naming every machine the product is on. */
function work(b: DivanBranch): boolean {
  return (b.open || 0) > 0 || Object.values(b.cards || {}).some((n) => (n || 0) > 0);
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

/** Worst first. A project with something waiting on a person comes before one
 *  whose numbers cannot be trusted, which comes before one that is merely busy
 *  — that is the order the question "what needs me" is asked in at three in the
 *  morning, and it is the order the phone reads the same list in. Ties go to
 *  whatever moved most recently, and then to the name so that the list does not
 *  shuffle under a cursor. */
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
    weekly: live.map((h) => h.quota!.weekly).find((w) => !!w) ?? null,
  };
}

/** One product by the key a chip carries, or null where the key is no longer in
 *  the view — a product on a machine that has been unpaired. */
export function project(view: DivanView, key: string | null): MergedProject | null {
  if (!key) return null;
  return view.projects.find((p) => p.key === key) ?? null;
}

/** The paired list and what the panel holds for each, as one list. Hosts with
 *  nothing yet are in it too: a machine that has never answered is part of the
 *  view — it is the part that says so. */
export function entries(hosts: Record<string, HostSlot>, order: string[],
                        snaps: Record<string, HostDivan>): HostEntry[] {
  return order.filter((k) => hosts[k]).map((k) => ({
    key: k,
    name: hosts[k].info?.name || hosts[k].cfg.name || k,
    state: snaps[k] ?? NO_DIVAN,
  }));
}

// ── the poll ────────────────────────────────────────────────────────────────

/** The sign-in a chat opens on at this computer — the subscription the bar's
 *  weekly figure is about. The Composer's own answer, so the two cannot name
 *  different accounts. */
function mainAccount(key: string): string {
  const slot = useFleet.getState().hosts[key];
  const told = toldDefaults(slot, usePrefs.getState().defaults, key, 'claude');
  return limitsKey('claude', told?.account_id ?? '');
}

interface DivanStore {
  snaps: Record<string, HostDivan>;
  load: (only?: string) => Promise<void>;
}

/** The snapshots, one per paired computer. A store rather than a screen's state
 *  because the shell and the page under it are looking at the same answer, and
 *  two of them asking would be two requests per machine for one view. */
export const useDivanStore = create<DivanStore>((set, get) => ({
  snaps: {},

  load: async (only) => {
    const fleet = useFleet.getState();
    const targets = fleet.order.filter((k) => !only || k === only);
    // Every machine at once, and each on its own clock: one that is asleep must
    // not hold up the view, so nothing here awaits another host's turn.
    await Promise.all(targets.map(async (key) => {
      // A poll that is still out is the answer to this one. Without this, a tab
      // coming back to the front while the timer's requests are in flight is
      // two requests per machine, and a machine that always times out is never
      // not being asked.
      if (inFlight.has(key)) return;
      inFlight.add(key);
      const put = (d: HostDivan) => set((s) => ({ snaps: { ...s.snaps, [key]: d } }));
      const asked = mainAccount(key);
      try {
        const snap = await withTimeout(
          fleet.call<DivanSnapshot>(key, 'divan.snapshot', { usage_for: asked }), DIVAN_TIMEOUT_MS);
        put(answered(snap, Date.now() / 1000));
      } catch (e: any) {
        // The last answer stays, and `silent` is where that rule lives.
        put(silent(get().snaps[key], e?.message ?? null, oldDaemon(e)));
      } finally {
        inFlight.delete(key);
      }
      // The list of sign-ins can arrive while this was out, and the week that
      // came back is then another account's: ask again rather than show it
      // for a minute.
      if (mainAccount(key) !== asked) void get().load(key);
    }));
  },
}));

const inFlight = new Set<string>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('That computer did not answer')), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

/** The merged view, kept fresh while the panel is open.
 *
 *  Asked for on a slow timer, when a computer comes online, and when the tab
 *  comes back to the front — the three moments the answer can have changed
 *  without anybody here noticing. `now` comes back on the view itself, so a
 *  screen never ages the same machine to two different numbers.
 *
 *  Called `useDivanView` and not `useDivan`: `ui/divan.tsx` is the design
 *  system, and a screen that reached for the wrong one would be asking for a
 *  fleet and getting a palette. */
export function useDivanView(): DivanView & { reload: () => void } {
  const order = useFleet((s) => s.order);
  const hosts = useFleet((s) => s.hosts);
  const snaps = useDivanStore((s) => s.snaps);
  const load = useDivanStore((s) => s.load);
  // A clock of its own, slow: what "silent for 2h 14m" says goes on becoming
  // true while nobody asks anything.
  const [now, setNow] = useState(() => Date.now() / 1000);

  // Which computers are online, as a string, so that a chat arriving on one of
  // them does not re-run the effect below: what it watches for is a machine
  // coming back, not the fleet store moving.
  const online = order.map((k) => (hosts[k]?.status === 'online' ? '1' : '0')).join('');
  // …and which sign-in each one's chats open on, for the same reason: the bar's
  // week is that account's, and it is not known until the accounts are listed.
  const prefs = usePrefs((s) => s.defaults);
  const mains = useMemo(() => order.map(mainAccount).join(' '), [order, hosts, prefs]);

  useEffect(() => {
    const tick = () => { setNow(Date.now() / 1000); void load(); };
    tick();
    const timer = setInterval(tick, DIVAN_POLL_MS);
    const clock = setInterval(() => setNow(Date.now() / 1000), 30_000);
    const wake = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [online, mains, load]);

  const view = useMemo(() => merge(entries(hosts, order, snaps), now), [hosts, order, snaps, now]);
  return { ...view, reload: () => { void load(); } };
}
