// Divan's three places, decided away from the screens that draw them.
//
// The app used to be shaped like the computer it was holding a socket to: a
// picker at the top said which machine you were looking at, the two tabs under
// it were that machine's chats and that machine's agents, and its ticket wall
// was a button in the corner. Seven entry points, all of them about a computer.
//
// Divan has three: the **Dashboard** is every project on every machine, the
// **Chat** is this computer's conversations — the list, and the one you opened
// off it — and **Machine** is the infrastructure — "findable, forgettable", as
// Mobile11 S16 puts it. Everything that was about a computer rather than about
// work lives under the third one, and nothing but those three is at the top
// level.
//
// What is in here is everything about that shell that has one right answer:
// which place a route belongs to, what the project bar says, and what the
// Machine list is made of. No React, no store, no palette — so
// `scripts/test-shell.cjs` can hold the shell to it without a phone.
import { stuck, type DivanView, type MergedProject } from './divan';
import type { Key } from './i18n';
import type { State, Tone } from './tokens';

/** The three. */
export type Place = 'dashboard' | 'chat' | 'machine';

/** Left to right, and the order the tab bar draws them in (Mobile1 V1). */
export const PLACES: Place[] = ['dashboard', 'chat', 'machine'];

/** Where each of them lives. A place is a route and not a tab in a navigator:
 *  the app is one stack, and the three swap each other out at its root — which
 *  is the same thing the two old home screens did to each other. */
export const PLACE_ROUTE: Record<Place, string> = {
  dashboard: '/dashboard',
  chat: '/chat',
  machine: '/machine',
};

/** The place the app opens on, and the one a notification pops the stack back
 *  to before opening what it is about. It used to be the chat list. */
export const HOME = PLACE_ROUTE.dashboard;

/** What each place is drawn with. The frames use Lucide's `layout-grid`,
 *  `message-circle` and `server`; these are the Material Symbols the app
 *  generates that draw the same three things (`src/icons.gen.ts`). */
export const PLACE_ICON: Record<Place, string> = {
  dashboard: 'grid_view', chat: 'chat_bubble', machine: 'dns',
};

/** …and the name under it. */
export const PLACE_LABEL: Record<Place, Key> = {
  dashboard: 'tabDashboard', chat: 'tabChat', machine: 'tabMachine',
};

/** Which place a route is in, or null for a screen that is not one of the three
 *  — a pushed page like the ticket wall or Settings, which draws no tab bar.
 *
 *  `/chat/<id>` is the Chat place: a notification opens one conversation by
 *  name, and that is the conversation a row of the tab's own list opens. */
export function placeOf(pathname: string | null | undefined): Place | null {
  const path = (pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  for (const place of PLACES) {
    const route = PLACE_ROUTE[place];
    if (path === route || path.startsWith(`${route}/`)) return place;
  }
  return null;
}

// ── the project bar ─────────────────────────────────────────────────────────

/** One chip in the bar across the top of the Dashboard (Mobile1 V1): a
 *  project, or the "All" that stands for every one of them. `key` is the key
 *  the merge folded the product under, and null on the All chip. */
export interface Chip {
  key: string | null;
  label: string;
  /** The 7 pt dot in front of the name. */
  state: State;
  selected: boolean;
}

/** How a project's chip is coloured. Red where an agent stopped or was turned
 *  down, amber where something is waiting for a person, grey where the numbers
 *  are stale or nothing has happened in weeks, green while work is running.
 *  The order is the order the question is asked in, worst first — the same one
 *  the merge sorts the list by. */
export function projectState(p: MergedProject): State {
  if (p.cards.some(stuck)) return 'stuck';
  if (p.waiting > 0) return 'asking';
  if (p.stale) return 'quiet';
  if (p.running > 0) return 'running';
  return 'quiet';
}

/** …and how the All chip is. It is amber the moment anything needs a person —
 *  Mobile1 V1 draws it amber beside two red projects, because "two of these
 *  need you" is what the chip is for, not "one of them fell over". */
export function allState(view: DivanView): State {
  if (view.totals.needsYou > 0) return 'asking';
  if (view.totals.running > 0) return 'running';
  return 'quiet';
}

/** The bar itself: All, then every product, in the order the merge put them
 *  in. `selected` is the key of the project being read, or null for all of
 *  them. A key that is no longer in the view — a project on a machine that has
 *  been unpaired — leaves the All chip selected rather than nothing. */
export function chips(view: DivanView, selected: string | null, allLabel: string): Chip[] {
  const known = selected != null && view.projects.some((p) => p.key === selected);
  return [
    { key: null, label: allLabel, state: allState(view), selected: !known },
    ...view.projects.map((p) => ({
      key: p.key, label: p.name, state: projectState(p), selected: p.key === selected,
    })),
  ];
}

// ── the machine list ────────────────────────────────────────────────────────

/** A row of Mobile11 S16: a name, one grey line under it, and — only where
 *  there is something to say — a mono word at the end in a state's colour.
 *  Every row goes one level deeper and no further. */
export interface MachineRow {
  key: string;
  icon: string;
  /** What the row opens: one of the frame's own two pages, or one of the
   *  screens that already existed and moved here unchanged. */
  route: string;
  title: Key;
  note: Key;
  noteParams?: Record<string, string | number>;
  meta?: Key;
  metaParams?: Record<string, string | number>;
  tone?: Tone;
}

/** The list, in the frame's order.
 *
 *  Three of Mobile11 S16's rows have nothing on this phone to stand behind
 *  them: Terminals and Admin are screens the desktop panel has and the app
 *  never had, and quota thresholds are not settable from anywhere yet. They
 *  arrive with the screens that own them rather than as rows that lead
 *  nowhere. The other five are here — Machines and Executors as the two pages
 *  this ticket draws (`src/machine.ts`), the computer's screen, its sign-ins
 *  and Settings — and beside them what the app already had that was about a
 *  computer: the agent definitions it can install, the sign-in pool, and the
 *  voice line.
 *
 *  `face` and not `group` on the agents row: the frame draws Executors with
 *  Lucide's `users`, the app's agents are personas it installs, and two
 *  people-shaped glyphs one above the other would say the two rows were the
 *  same kind of thing. */
export function machineRows(m: { machines: number; unreachable: number; executors: number }): MachineRow[] {
  return [
    {
      key: 'machines', icon: 'monitor', route: '/machines',
      title: 'mMachines', note: 'mMachinesNote', noteParams: { n: m.machines },
      ...(m.machines === 0 ? {} : m.unreachable > 0
        ? { meta: 'mUnreachable' as Key, metaParams: { n: m.unreachable }, tone: 'red' as Tone }
        : { meta: 'mAllReachable' as Key, tone: 'run' as Tone }),
    },
    { key: 'executors', icon: 'group', route: '/executors',
      title: 'mExecutors', note: 'mExecutorsNote', noteParams: { n: m.executors } },
    { key: 'agents', icon: 'face', route: '/agents', title: 'mAgents', note: 'mAgentsNote' },
    { key: 'screen', icon: 'screen_share', route: '/screen', title: 'mScreen', note: 'mScreenNote' },
    { key: 'accounts', icon: 'key', route: '/accounts', title: 'mAccounts', note: 'mAccountsNote' },
    { key: 'pool', icon: 'swap_horiz', route: '/pool', title: 'mPool', note: 'mPoolNote' },
    { key: 'call', icon: 'call', route: '/call', title: 'mCall', note: 'mCallNote' },
    { key: 'settings', icon: 'settings', route: '/settings', title: 'mSettings', note: 'mSettingsNote' },
  ];
}

/** Every route the Machine list leads to. Nothing outside that place may link
 *  to one of them — that is the whole point of the move, and it is what
 *  `scripts/test-shell.cjs` holds the three screens to. */
export const MACHINE_ROUTES: string[] = machineRows({ machines: 0, unreachable: 0, executors: 0 })
  .map((r) => r.route);

// ── the four tabs (HANDOVER §4.9) ───────────────────────────────────────────

/** A page that sits under a tab of the Machine place: the row that opens it. */
export interface MachinePage { key: string; route: string; icon: string; title: Key; note: Key }

/** One tab of the Machine place, at its own route, and the pages under it. */
export interface MachineTab { key: 'machines' | 'executors' | 'terminal' | 'settings'; label: Key; route: string; pages: MachinePage[] }

/** Machines · Executors · Terminal · Settings. Every screen the Machine list
 *  reached is under one of them: the computer's own screen under Machines; the
 *  agents, the sign-ins and the pool under Executors; the ticket queue under
 *  Terminal; the voice line under Settings. */
export const MACHINE_TABS: MachineTab[] = [
  { key: 'machines', label: 'mMachines', route: '/machine', pages: [
    { key: 'screen', route: '/screen', icon: 'screen_share', title: 'mScreen', note: 'mScreenNote' },
  ] },
  { key: 'executors', label: 'mExecutors', route: '/executors', pages: [
    { key: 'agents', route: '/agents', icon: 'face', title: 'mAgents', note: 'mAgentsNote' },
    { key: 'accounts', route: '/accounts', icon: 'key', title: 'mAccounts', note: 'mAccountsNote' },
    { key: 'pool', route: '/pool', icon: 'swap_horiz', title: 'mPool', note: 'mPoolNote' },
  ] },
  { key: 'terminal', label: 'mTerminal', route: '/terminal', pages: [
    { key: 'queue', route: '/ustabasi', icon: 'terminal', title: 'mQueue', note: 'mQueueNote' },
  ] },
  { key: 'settings', label: 'mSettings', route: '/settings', pages: [
    { key: 'call', route: '/call', icon: 'call', title: 'mCall', note: 'mCallNote' },
  ] },
];

/** Every route the four tabs reach, the tabs' own first. */
export const MACHINE_TAB_ROUTES: string[] = MACHINE_TABS.flatMap((t) => [t.route, ...t.pages.map((p) => p.route)]);

