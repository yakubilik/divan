/** One Divan view across every paired computer, for the panel.
 *
 *  The panel has always talked to every computer at once — that is what it is
 *  for — but what it merged was chats: a list per machine, and the machine was
 *  the thing you were looking at. Divan turns that over. The project is the
 *  context and the machine is a detail of a running task: isghocam's site may be
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
 *  different products. What is here is the part the desktop shell needs — the
 *  machines, the products, and how each is doing; the branches, the quota and
 *  the git activity are read the same way by the screens that draw them.
 *
 *  Nothing in here draws anything, and the poll at the bottom is the only part
 *  that knows there is a socket: `scripts/test-shell.mjs` holds the merge to
 *  these rules with no daemon anywhere.
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useFleet, type HostSlot } from './fleet';
import type { DivanCard, DivanProject, DivanSnapshot } from './protocol';

/** How often a screen that is open re-asks every machine. The board moves when
 *  a worker does — a stage boundary is minutes apart, not seconds — and this is
 *  one request per machine rather than one in total. */
export const DIVAN_POLL_MS = 60_000;

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

/** One product, however many machines it is checked out on. */
export interface MergedProject {
  /** What the same product on two machines is matched by. */
  key: string;
  name: string;
  slug: string;
  summary: string;
  kind: string;
  repos: string[];
  /** The paired computers this product has work on, and their names. */
  hosts: string[];
  machines: string[];
  cards: MergedCard[];
  running: number;
  waiting: number;
  /** Cards an agent gave up on or was turned down on. */
  stuck: number;
  updated_at: number;
  /** One of the machines it lives on has gone quiet, so these numbers are not
   *  all current. */
  stale: boolean;
  /** Which ones, and when the newest answer behind this product arrived. */
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
  machines: number;
  reachable: number;
  /** Every paired machine answered, and recently enough to be believed. */
  complete: boolean;
  /** The oldest answer any of this is built out of — "partly as of 21:02".
   *  Null when nothing has answered at all. */
  asOf: number | null;
}

export interface DivanView {
  hosts: HostView[];
  projects: MergedProject[];
  cards: MergedCard[];
  totals: Totals;
  /** The moment this was worked out, in seconds. The one thing in the view that
   *  is not read off a snapshot — staleness is measured against it — so it
   *  travels with the answer rather than each screen fetching a clock of its
   *  own and ageing the same machine to two different numbers on one page. */
  now: number;
}

/** A card that needs a person before anything else happens to it. The same rule
 *  the daemon counts `waiting` by (`divan.py _waiting`), applied to one card so
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
  };
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
  for (const e of list) {
    const h = byKey.get(e.key)!;
    for (const c of e.state.snapshot?.cards ?? []) {
      cards.push({
        ...c, host: h.key, hostName: h.name,
        machine: (c.machine || '').trim() || h.machine,
        projectKey: keyOf.get(`${h.key}:${c.project_id}`) ?? '',
        stale: h.stale,
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
          repos: [...(p.repos || [])],
          hosts: [h.key],
          machines: [h.machine],
          cards: [],
          running: p.running || 0,
          waiting: p.waiting || 0,
          stuck: 0,
          updated_at: p.updated_at || 0,
          stale: h.stale,
          staleMachines: h.stale ? [h.machine] : [],
          lastSeen: h.at,
        });
        continue;
      }
      // The same product on a second machine: the numbers add up, the words are
      // whichever copy said anything, and one quiet machine makes the product
      // stale without hiding what the other one is doing.
      found.hosts.push(h.key);
      if (!found.machines.includes(h.machine)) found.machines.push(h.machine);
      for (const repo of p.repos || []) if (!found.repos.includes(repo)) found.repos.push(repo);
      found.summary = found.summary || p.summary || '';
      found.kind = found.kind || p.kind || '';
      found.running += p.running || 0;
      found.waiting += p.waiting || 0;
      found.updated_at = Math.max(found.updated_at, p.updated_at || 0);
      if (h.stale) {
        found.stale = true;
        if (!found.staleMachines.includes(h.machine)) found.staleMachines.push(h.machine);
      }
      found.lastSeen = Math.max(found.lastSeen ?? 0, h.at ?? 0) || null;
    }
  }

  for (const c of cards) {
    const p = products.get(c.projectKey);
    if (!p) continue;
    p.cards.push(c);
    if (stuck(c)) p.stuck += 1;
  }

  // Worst first, which is the order every screen reads them in: something
  // stopped, then something waiting on a person, then work running, then the
  // most recently touched.
  const projects = [...products.values()].sort((a, b) => (
    (b.stuck > 0 ? 1 : 0) - (a.stuck > 0 ? 1 : 0)
    || b.waiting - a.waiting
    || b.running - a.running
    || b.updated_at - a.updated_at
    || a.name.localeCompare(b.name)
  ));

  const answeredHosts = hosts.filter((h) => h.at != null);
  const totals: Totals = {
    needsYou: projects.reduce((n, p) => n + p.waiting, 0),
    stuck: projects.reduce((n, p) => n + p.stuck, 0),
    running: projects.reduce((n, p) => n + p.running, 0),
    machines: hosts.length,
    reachable: hosts.filter((h) => h.reachable).length,
    complete: hosts.length > 0 && hosts.every((h) => h.reachable),
    asOf: answeredHosts.length ? Math.min(...answeredHosts.map((h) => h.at as number)) : null,
  };

  return { hosts, projects, cards, totals, now };
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
      try {
        const snap = await withTimeout(
          fleet.call<DivanSnapshot>(key, 'divan.snapshot', {}), DIVAN_TIMEOUT_MS);
        put(answered(snap, Date.now() / 1000));
      } catch (e: any) {
        // The last answer stays, and `silent` is where that rule lives.
        put(silent(get().snaps[key], e?.message ?? null, oldDaemon(e)));
      } finally {
        inFlight.delete(key);
      }
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
  }, [online, load]);

  const view = useMemo(() => merge(entries(hosts, order, snaps), now), [hosts, order, snaps, now]);
  return { ...view, reload: () => { void load(); } };
}
