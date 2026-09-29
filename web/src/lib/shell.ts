/** Divan's three places on the desktop, decided away from the screens that draw
 *  them.
 *
 *  The panel used to be shaped like the computers it held sockets to. A sidebar
 *  listed eight screens — Chats, Terminal, Screen, Panel, Projects, Agents,
 *  Admin, Settings — and seven of those eight were about a machine: its
 *  sessions, its folders, its agents, its update, its sign-ins. The work itself
 *  had no screen.
 *
 *  Divan has three places. The **Dashboard** is every product on every machine,
 *  the **Chat** is the conversation, and **Machine** is the infrastructure —
 *  "findable, forgettable", as the phone's own frame puts it. Everything that
 *  was about a computer rather than about work lives under the third one, and
 *  nothing but those three is at the top level. It is the same shape the phone
 *  took in `app/src/shell.ts`, for the same reason and with the same names.
 *
 *  What is in here is everything about that shell with one right answer: which
 *  place a screen belongs to, what the Machine list is made of, what the project
 *  bar says, and how a chosen project is written into the address. No React, no
 *  store, no palette — so `scripts/test-shell.mjs` can hold the shell to it
 *  without a browser.
 */
import type { DivanView, MergedProject } from './divan';
import { stuck } from './divan';
import type { State } from './theme';

/** The three. */
export type Place = 'dashboard' | 'chat' | 'machine';

/** Left to right, and the order the top bar draws them in (Web14 W6). */
export const PLACES: Place[] = ['dashboard', 'chat', 'machine'];

/** Every screen the panel can be showing. The first two are places in their own
 *  right; the rest are the pages of the third one, and each of them is a screen
 *  the panel already had. */
export type View =
  | 'overview'
  | 'chats'
  | 'machines' | 'agents' | 'terminal' | 'screen' | 'projects' | 'admin' | 'settings';

/** What each place is drawn with. The frames use Lucide's `layout-grid`,
 *  `message-circle` and `server`; these are the three paths out of the panel's
 *  own icon vocabulary (`ui/kit.tsx`) that draw the same things. */
export const PLACE_ICON: Record<Place, string> = {
  dashboard: 'grid', chat: 'chat', machine: 'server',
};

/** …and the name beside it, which is the frames' own word for each. */
export const PLACE_LABEL: Record<Place, string> = {
  dashboard: 'Dashboard', chat: 'Chat', machine: 'Machine',
};

/** A page of the Machine place: the row in the side panel, and the screen it
 *  opens. Every one of these is a screen that already existed and moved here
 *  unchanged. */
export interface MachineRow {
  view: View;
  label: string;
  /** The grey line under it, saying what is on that page. */
  note: string;
  /** A path out of `P`. */
  icon: string;
  /** The shortcut it kept from the old sidebar. */
  shortcut?: string;
}

/** The Machine list, in the order Web15's own side panel runs in — Machines,
 *  Executors, Terminals, Remote screen, …, Admin, Settings — as far as the
 *  panel has a screen for each.
 *
 *  Two of that frame's rows have nothing here to stand behind them: quota
 *  thresholds are not settable from anywhere yet, and accounts & sign-ins are a
 *  section of Settings rather than a page. They arrive with the screens that own
 *  them rather than as rows that lead nowhere. What is here instead is what the
 *  old sidebar had and what was about a computer — and that is all of it: the
 *  fleet panel, the agents, the wall of chats with the ticket queue in it, the
 *  computer's screen, its folders, its update and its settings. */
export const MACHINE_ROWS: MachineRow[] = [
  {
    view: 'machines', label: 'Machines', icon: 'cpu', shortcut: '⌘1',
    note: 'every paired computer, what it is running and how full its plans are',
  },
  {
    view: 'agents', label: 'Agents', icon: 'agent', shortcut: '⌘3',
    note: 'what is installed on this computer, and the store',
  },
  {
    view: 'terminal', label: 'Terminals', icon: 'terminal', shortcut: '⌘4',
    note: 'every chat at once, and the ticket queue',
  },
  {
    view: 'screen', label: 'Remote screen', icon: 'monitor', shortcut: '⌘5',
    note: "this computer's own screen, watched and driven",
  },
  {
    view: 'projects', label: 'Folders', icon: 'folder', shortcut: '⌘2',
    note: 'the repositories on this computer, and what git says about them',
  },
  {
    view: 'admin', label: 'Admin', icon: 'download', shortcut: '⌘6',
    note: 'what is running here, and the update',
  },
  {
    view: 'settings', label: 'Settings', icon: 'gear', shortcut: '⌘,',
    note: 'sign-ins, defaults, tools and the paired computers',
  },
];

/** Where a place is entered: the page it opens on. The Machine place opens on
 *  the first row of its list, the way Web15 W12 draws it. */
export const PLACE_VIEW: Record<Place, View> = {
  dashboard: 'overview', chat: 'chats', machine: MACHINE_ROWS[0].view,
};

/** Which place a screen is in. Everything that is not one of the first two is a
 *  page of the Machine place, which is the whole of the move. */
export function placeOf(view: View): Place {
  if (view === 'overview') return 'dashboard';
  if (view === 'chats') return 'chat';
  return 'machine';
}

/** Every screen the panel had before Divan, under the name the old sidebar gave
 *  it. Written down so that a check can hold the new shell to it: three places
 *  and one list have to reach all eight, or something was dropped in the move. */
export const OLD_PANEL: { view: View; was: string }[] = [
  { view: 'chats', was: 'Chats' },
  { view: 'terminal', was: 'Terminal' },
  { view: 'screen', was: 'Screen' },
  { view: 'machines', was: 'Panel' },
  { view: 'projects', was: 'Projects' },
  { view: 'agents', was: 'Agents' },
  { view: 'admin', was: 'Admin' },
  { view: 'settings', was: 'Settings' },
];

/** …and whether the shell can get to one: it is a place's own page, or a row of
 *  the Machine list. */
export function reachable(view: View): boolean {
  return PLACES.some((p) => PLACE_VIEW[p] === view)
    || MACHINE_ROWS.some((r) => r.view === view);
}

// ── the two lights the old sidebar carried ──────────────────────────────────

/** The old sidebar put an amber dot on two of its rows: one where a chat was
 *  waiting to be allowed to do something, and one where the computer had an
 *  update in hand. Both are still true of a panel with three places in it, and
 *  both belong to a place rather than to a screen now — so the rules are here,
 *  the bar draws the dot on the place, and the Machine list draws it again on
 *  the page it is actually about.
 *
 *  Neither is Divan's "needs you", which is a board's count and belongs to the
 *  Dashboard: this is a chat that cannot go on, and a computer that is running
 *  something older than what is in hand. */
export function chatNeedsYou(chats: { status: string }[]): boolean {
  return chats.some((c) => c.status === 'awaiting_approval');
}

/** Straight off `host.info`, which every computer sends on connect: no extra
 *  round trip to light this up, and it is true before anyone has opened Admin.
 *  `web.stale !== false` because a daemon that cannot answer the question is
 *  not the same as one answering no. */
export function updateWaiting(update: {
  behind: number; web?: { npm?: boolean; stale?: boolean | null } | null;
} | null | undefined): boolean {
  return !!update && (update.behind > 0 || (!!update.web?.npm && update.web?.stale !== false));
}

// ── the project bar ─────────────────────────────────────────────────────────

/** One chip in the bar across the top of the Dashboard (Web12 W1): a product, or
 *  the "All" that stands for every one of them. `key` is the key the merge
 *  folded the product under, and null on the All chip. */
export interface Chip {
  key: string | null;
  label: string;
  /** The 7 pt dot in front of the name. */
  state: State;
  selected: boolean;
}

export const ALL_LABEL = 'All';

/** How a product's chip is coloured. Red where an agent stopped or was turned
 *  down, amber where something is waiting for a person, grey where the numbers
 *  are stale, green while work is running. The order is the order the question
 *  is asked in, worst first — the same one the merge sorts the list by. */
export function projectState(p: MergedProject): State {
  if (p.cards.some(stuck) || p.stuck > 0) return 'stuck';
  if (p.waiting > 0) return 'asking';
  if (p.stale) return 'quiet';
  if (p.running > 0) return 'running';
  return 'quiet';
}

/** …and how the All chip is. It is amber the moment anything needs a person —
 *  the frame draws it amber beside two red products, because "two of these need
 *  you" is what the chip is for, not "one of them fell over". */
export function allState(view: DivanView): State {
  if (view.totals.needsYou > 0) return 'asking';
  if (view.totals.running > 0) return 'running';
  return 'quiet';
}

/** The bar itself: All, then every product, in the order the merge put them in.
 *  `selected` is the key of the product being read, or null for all of them. A
 *  key that is no longer in the view — a product on a machine that has been
 *  unpaired — leaves the All chip selected rather than nothing. */
export function chips(view: DivanView, selected: string | null,
                      allLabel: string = ALL_LABEL): Chip[] {
  const known = selected != null && view.projects.some((p) => p.key === selected);
  return [
    { key: null, label: allLabel, state: allState(view), selected: !known },
    ...view.projects.map((p) => ({
      key: p.key, label: p.name, state: projectState(p), selected: p.key === selected,
    })),
  ];
}

// ── the chosen product, in the address ──────────────────────────────────────

/** Which product is being read lives in the address and not in a `useState`,
 *  the way the phone puts it in the route's parameters: it survives a redraw and
 *  a reload, and a scoped page can be sent to somebody. */
export const PROJECT_PARAM = 'project';

/** …read back out of it. An empty value is "all of them", which is what the
 *  parameter says rather than being absent, because "no product" has to be
 *  sayable. */
export function projectFromSearch(search: string): string | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const key = (q.get(PROJECT_PARAM) || '').trim();
  return key || null;
}

/** …and written into it, leaving every other parameter exactly as it was: the
 *  panel puts the chat a popped-out window is holding in there too, and
 *  choosing a product must not close it. */
export function searchWithProject(search: string, key: string | null): string {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (key) q.set(PROJECT_PARAM, key);
  else q.delete(PROJECT_PARAM);
  const out = q.toString();
  return out ? `?${out}` : '';
}
