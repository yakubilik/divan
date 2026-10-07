import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback } from 'react';
import { callOnce, client, httpBase, type ConnStatus } from './ws';
import { t as tt, type Key } from './i18n';
import { dismissChatNotifications } from './push';
import type { Agent, Catalog, Chat, CliAccount, DivanCard, DivanCardDetail, DivanColumn, DivanExecutor, DivanSnapshot, LimitWindow, LimitsEvent, PoolAccount, PoolSettings, UpdateStatus, StoreSource, Provider, Defaults, Group, HostConfig, HostInfo, LoginDone, LoginPrompt, Project, RacEvent, RunPage, ToolStatus, UstabasiSnapshot } from './protocol';
import { oldHost } from './tickets';
import { answered, DIVAN_TIMEOUT_MS, Polls, silent, type HostDivan } from './divan';
import { missed, opening, took, type Open, type Say } from './card';
import { filed, NO_DRAFT, type ComposeDraft, type Filing } from './compose';

const HOSTS_KEY = 'rac.hosts';
const ACTIVE_KEY = 'rac.activeHost';
const DEFAULTS_KEY = 'rac.defaults';
const PREFS_KEY = 'rac.prefs';
const PERM_MIGRATED_KEY = 'rac.defaults.perm.bypass';

export interface LiveText { segment: number; text: string; final?: boolean }
export interface TurnProgress { output_tokens: number; open_tools: number }
export interface StoredHost extends HostConfig { id: string }
/** How the chat list is laid out. `grouped` keeps the project/group sections;
 *  `flat` is one list, newest first. A preference, not a computed thing — the
 *  same list can be read either way and only the person reading it knows which. */
export type ChatView = 'grouped' | 'flat';
export interface Prefs {
  faceIdLaunch: boolean; faceIdBypass: boolean; chatView: ChatView;
  // Which voice reads the concierge's answers, per language. Chosen on the call
  // screen; empty means "whatever the phone has that sounds best".
  /** Keyed by language tag, e.g. 'tr-TR'. */
  voiceIds?: Record<string, string>;
}
export interface DeviceInfo { id: string; name: string; push_approval: boolean; push_done: boolean; has_push_token: boolean }
/** `path` is the file the message names — what a link opens, and what the text
 *  is matched against. `view` is the copy the computer kept for the bubble to
 *  draw, which outlives the original being deleted (see attachments.py). */
export interface Attachment { path: string; view?: string; name: string; size?: number; kind?: 'image' | 'video' | 'audio' | 'file'; url?: string; transcript?: string; duration?: number; localUri?: string;
  /** How loud the sound is across its length, 0-100, measured by the daemon (absent on older messages). */
  peaks?: number[] }

/** What a computer answers a move with. The move itself always happened; this
 *  is about the worker it may also have asked for — empty where nothing was
 *  asked for or where it started, and the queue's own refusal otherwise. */
export interface Moved { error: string }

interface State {
  ready: boolean;
  hosts: StoredHost[];
  activeHostId: string | null;
  host: StoredHost | null;                // derived: the active host
  conn: ConnStatus;
  // A computer switch is in flight: the outgoing computer's chats are still on
  // screen (inert) so the swap reads as a crossfade instead of a blank list.
  switching: boolean;
  hostInfo: HostInfo | null;
  catalog: Catalog | null;
  device: DeviceInfo | null;
  projects: Project[];
  accounts: CliAccount[];
  tools: ToolStatus[];
  npmAvailable: boolean;
  loginPrompt: LoginPrompt | null;
  loginDone: LoginDone | null;
  // a sign-in is running somewhere: the CLI drives one browser session at a
  // time, so a second one started in parallel puts its code in the wrong pty
  // a list that has not answered yet must not be drawn as an empty list
  agents: Agent[];
  agentsLoaded: boolean;
  storeSources: StoreSource[];
  storeLoaded: boolean;
  loadStore: () => Promise<void>;
  installAgent: (id: string, accountId?: string | null) => Promise<void>;
  removeAgent: (name: string, accountId?: string | null) => Promise<void>;
  loadAgents: (accountId?: string | null, cwd?: string | null) => Promise<void>;
  /** The same list, handed back rather than stored: the new-chat sheet asks for
   *  the account and folder it is about without moving the Agents tab's list. */
  listAgents: (accountId?: string | null, cwd?: string | null) => Promise<Agent[]>;
  // account id -> the windows that account's plan reports
  limits: Record<string, LimitWindow[]>;
  // Several sign-ins of one tool, driven as one. Null until the computer has
  // been asked — an off pool and an unasked one are not the same thing.
  pool: PoolSettings | null;
  poolAccounts: PoolAccount[];
  loadPool: () => Promise<void>;
  setPool: (patch: Partial<PoolSettings>) => Promise<void>;
  /** The ticket queue on the computer, as it last answered. Null until it has
   *  answered at all — an empty wall and an unasked computer are not the same
   *  thing, and the screen says something different about each. */
  ustabasi: UstabasiSnapshot | null;
  /** The last poll failed, in words. Kept next to the snapshot rather than
   *  replacing it: a queue eight seconds stale beats an error where a wall was. */
  ustabasiError: string | null;
  /** …and the failure was "I have never heard of that request", which is a
   *  computer running a daemon older than this screen, not a broken one. */
  ustabasiOld: boolean;
  loadUstabasi: () => Promise<void>;
  /** One Divan snapshot per **paired** computer, keyed by host id — not by the
   *  active one, and deliberately not part of `perHost()`. Divan's whole subject
   *  is every machine at once: the project is the context and the machine is a
   *  detail of a running task, so switching which computer the phone holds a
   *  socket to must not change what a board or a dashboard shows. It is merged
   *  into one view by `src/divan.ts`, which is also where staleness is read.
   *
   *  An entry is dropped when a machine is unpaired and at no other time: a
   *  computer that has gone quiet keeps the last answer it gave, marked with how
   *  old it is, because dropping it would quietly remove five running agents
   *  from a screen. */
  divan: Record<string, HostDivan>;
  /** Ask every paired computer, or one of them, for its Divan snapshot. Gentle
   *  on purpose — on connect, on foreground, and on a slow timer. */
  loadDivan: (hostId?: string) => Promise<void>;
  /** Answer a blocked ticket. The queue's own CLI does the work on the
   *  computer; this is the only write the wall can make. */
  noteTicket: (id: number, text: string) => Promise<string>;
  /** The same answer, to a ticket on whichever computer holds it.
   *
   *  `noteTicket` above goes to the computer this phone has a socket to, which
   *  is the only one the ticket wall can be about. A Divan screen is every
   *  machine at once: the question on it was asked by a worker on the mini, and
   *  answering it has to reach the mini — so the machine is named rather than
   *  assumed, the same way a sign-in is read off a second computer. */
  answerCard: (what: { ticket: number; host: string }, text: string) => Promise<void>;
  /** Hand a card to another executor, or to nobody, on the computer it is on
   *  (`divan.card.executor`). */
  handCard: (what: { card: string; host: string }, executor: DivanExecutor | null) => Promise<void>;
  /** Close a product's Still open item, or add a line to its thread, on the
   *  computer it is written on (`divan.project.open`, the project page's own
   *  call on the panel). */
  openItem: (what: { host: string; project: string; item: string },
             d: { set?: Record<string, unknown>; comment?: string }) => Promise<void>;
  /** Move a card to a column, on whichever computer it is on, and to a place in
   *  that column where one was picked — position is priority on this board.
   *
   *  The one board write this app makes: a card that is a person's own, done, and
   *  a card dragged into In Progress, which is what starts a worker on it.
   *
   *  It answers with what the computer said rather than nothing, because the
   *  interesting case is the half-done one: the move always happens and the
   *  filing may not, and a queue that is not installed leaves the card where the
   *  finger put it with a reason attached (`server.py h_divan_card_move`). A
   *  screen that threw that away would show a card in In Progress with nothing
   *  running on it and no explanation. */
  moveCard: (what: { card: string; host: string; column: DivanColumn; position?: number | null })
    => Promise<Moved>;
  /** Write a card down on one computer's board (Mobile8 S9).
   *
   *  The other board write, and the quiet one: a card filed into Ice Box or
   *  Queued starts nothing. Which machine it goes to and what it carries are
   *  `src/compose.ts`'s; what is here is the pair of requests it takes — the
   *  card, and then that machine's board again, so the board the phone lands on
   *  already has it. */
  createCard: (what: { host: string; card: Filing }) => Promise<void>;
  /** A page of what the agent on a ticket has printed. Nothing of it is kept
   *  here: the log is a river and only the page being read is worth holding,
   *  which is the screen's business and not the store's. */
  readRun: (id: number, cursor: string | null) => Promise<RunPage>;
  /** The card that is open, and everything the machine it is on has said about
   *  it: its two faces, its ticket, the run being written on it and whatever has
   *  been said into that run from here (`src/card.ts`).
   *
   *  One card, because one is open at a time — and here rather than on the
   *  screen because a run arrives a page at a time while somebody is reading it,
   *  and a screen that held it would lose the whole log on the way to another
   *  page and back. */
  openCard: Open | null;
  /** Ask the machine a card is on for it, and fold the answer into the above.
   *
   *  Named rather than assumed, for the reason `answerCard` is: a Divan screen
   *  is every machine at once, and the card being read may be on the mini while
   *  this phone holds a socket to the studio. */
  loadCard: (what: { card: string; host: string }) => Promise<void>;
  /** Say one sentence into the run on the open card. It lands in the log where
   *  it was said and goes to the queue that is running it, which is on that
   *  card's machine and not necessarily this phone's. */
  sayCard: (to: { ticket: number; host: string }, text: string) => Promise<void>;
  // tool call id -> what the background agent it started is doing right now.
  // Live only: a helper's step-by-step is progress, not conversation, and the
  // answer it produces arrives as that tool's result.
  agentActivity: Record<string, { tools: number; tool?: string | null; text?: string }>;
  chatsLoaded: boolean;
  accountsLoaded: boolean;
  projectsLoaded: boolean;
  loginBusy: boolean;
  // set the moment a code goes to the computer, so no screen offers the code
  // field again while the CLI is finishing
  loginSubmitting: boolean;
  installLog: string;
  defaults: Defaults;                     // derived: the active host's entry
  defaultsByHost: DefaultsByHost;
  prefs: Prefs;
  locked: boolean;
  pushToken: string | null;
  chats: Record<string, Chat>;
  groups: Group[];
  showArchived: boolean;
  events: Record<string, RacEvent[]>;
  live: Record<string, LiveText | null>;
  progress: Record<string, TurnProgress | null>;
  thinking: Record<string, string>;
  busy: Record<string, boolean>;
  loadedChats: Record<string, boolean>;

  init: () => Promise<void>;
  addHost: (cfg: HostConfig) => Promise<void>;
  switchHost: (id: string) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  setDefaults: (d: Partial<Defaults>) => Promise<void>;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
  setDevicePrefs: (p: { push_approval?: boolean; push_done?: boolean }) => Promise<void>;
  setPushToken: (t: string | null) => void;
  authenticate: (reason: string) => Promise<boolean>;
  unlock: () => Promise<boolean>;
  lock: () => void;
  refresh: () => Promise<void>;
  refreshHost: () => Promise<void>;
  // Where the active computer stands against origin/main.
  updateStatus: UpdateStatus | null;
  /** Set while the computer is deliberately stopping; cleared once it answers
   *  again. `null` is the normal state, including after a cancelled restart. */
  restarting: { state: string; pending?: unknown[]; forced?: boolean } | null;
  checkUpdate: (refresh?: boolean) => Promise<void>;
  applyUpdate: () => Promise<{ ok: boolean; error?: string }>;
  setShowArchived: (v: boolean) => void;
  /** What is typed into the Dashboard's Composer, and the mode and chips under
   *  it. Here rather than in the screen so that leaving the Dashboard for a
   *  moment does not lose a half-written sentence. */
  compose: ComposeDraft;
  setCompose: (patch: Partial<ComposeDraft>) => void;
  /** …and the Composer at the foot of each product's page, by product: its own
   *  draft, so a sentence about one product is not waiting on the Dashboard. */
  drafts: Record<string, ComposeDraft>;
  setDraft: (project: string, patch: Partial<ComposeDraft>) => void;
  settleLive: (chatId: string) => void;
  loadProjects: () => Promise<void>;
  openChat: (id: string) => Promise<void>;
  createChat: (d: Partial<Chat> & { provider: string }) => Promise<Chat>;
  updateChat: (id: string, fields: Partial<Chat>) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  send: (id: string, text: string, attachments?: Attachment[]) => Promise<void>;
  interrupt: (id: string) => Promise<void>;
  respond: (id: string, requestId: string, decision: 'allow' | 'allow_session' | 'deny') => Promise<void>;
  uploadAttachment: (chatId: string, uri: string, name: string) => Promise<Attachment>;
  loadAccounts: () => Promise<void>;
  createAccount: (provider: Provider, label: string) => Promise<CliAccount>;
  importSignIn: (accountId: string, credentials: Record<string, unknown>) =>
    Promise<CliAccount & { verified: boolean; verify_error: string | null }>;
  startLogin: (accountId: string, opts?: { email?: string; method?: string; api_key?: string }) => Promise<{ needs_code: boolean }>;
  submitLoginCode: (accountId: string, code: string) => Promise<void>;
  cancelLogin: (accountId: string) => Promise<void>;
  renameAccount: (accountId: string, label: string) => Promise<void>;
  logoutAccount: (accountId: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  loadTools: () => Promise<void>;
  installTool: (provider: Provider) => Promise<void>;
  createGroup: (name: string) => Promise<Group>;
  renameGroup: (id: string, name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
}

// `bypass` is the default a new chat opens in: the agent runs without asking.
// Both CLIs have a mode by that name, so it survives switching provider — the
// `perm_modes[0]` fallbacks elsewhere only fire for modes one provider lacks.
export const DEFAULT_PERM = 'bypass';
const DEFAULTS: Defaults = { provider: 'claude', model: 'opus', effort: 'high', perm_mode: DEFAULT_PERM, cwd: null };

/** The stored per-host defaults, raised to `bypass` once.
 *
 *  Changing the constant above is not enough on a phone that has been used:
 *  `setDefaults` writes the mode back on every new chat, so an install that
 *  has ever created one carries its own copy and would never see the new
 *  default. Done once, behind a marker, and per provider too — the
 *  per-provider block is what model-sheet restores from when the provider
 *  changes, so leaving it behind would put the old mode back on the next
 *  switch.
 */
async function raiseStoredPerm(byHost: DefaultsByHost): Promise<DefaultsByHost> {
  if (await SecureStore.getItemAsync(PERM_MIGRATED_KEY).catch(() => null)) return byHost;
  const out: DefaultsByHost = {};
  for (const [id, d] of Object.entries(byHost)) {
    const byProvider = Object.fromEntries(Object.entries(d.byProvider ?? {})
      .map(([p, v]) => [p, { ...v!, perm_mode: DEFAULT_PERM }]));
    out[id] = { ...d, perm_mode: DEFAULT_PERM, ...(d.byProvider ? { byProvider } : {}) };
  }
  await SecureStore.setItemAsync(PERM_MIGRATED_KEY, '1').catch(() => {});
  if (Object.keys(out).length) {
    await SecureStore.setItemAsync(DEFAULTS_KEY, JSON.stringify(out)).catch(() => {});
  }
  return out;
}

/** Defaults are about one computer — its folders, its accounts, the CLIs it has
 *  installed — so they are kept per host. Shared, the other computer's last
 *  folder follows you to this one and the first new chat opens on a path that
 *  is not there. */
export type DefaultsByHost = Record<string, Defaults>;

function defaultsFor(byHost: DefaultsByHost, hostId: string | null): Defaults {
  return { ...DEFAULTS, ...(hostId ? byHost[hostId] : undefined) };
}

/** A folder this computer still has: one of the paths it named, or something
 *  inside one. A remembered path that fails this was renamed, deleted, or
 *  belongs to another computer — either way it is not worth offering again.
 *  The roots count as well as the projects: a chat may sit on a root itself,
 *  and the project list only names what is directly under one. */
function onThisHost(cwd: string | null | undefined, known: string[]): boolean {
  if (!cwd) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = norm(cwd);
  return known.some((k) => { const r = norm(k); return c === r || c.startsWith(r + '/'); });
}

/** The account the Agents tab works in. Unset means "whatever new chats use";
 *  null is a real answer meaning the computer's own account. Listing, opening
 *  and installing all have to agree, or the tab shows agents a chat cannot
 *  find. */
export function agentAccountOf(d: Defaults): string | null {
  return d.agentAccountId !== undefined ? d.agentAccountId : (d.byProvider?.claude?.account_id ?? null);
}
const PREFS: Prefs = { faceIdLaunch: false, faceIdBypass: true, chatView: 'grouped', voiceIds: {} };

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return (Array.isArray(parsed) ? parsed : fallback) as T;
    return { ...(fallback as any), ...parsed } as T;
  } catch { return fallback; }
}

/** If the chat screen is not mounted to type it out, drop the finished segment
 *  anyway — the persisted message renders it in full. */
function scheduleSettle(chatId: string) {
  setTimeout(() => {
    const st = useStore.getState();
    if (st.live[chatId]?.final) st.settleLive(chatId);
  }, 4000);
}

/** chat id -> the chat.get already in the air for it. */
const inFlightOpen = new Map<string, Promise<void>>();

/** Take a chat out of every per-chat table at once. Forgetting it in `chats`
 *  alone left its transcript, its live text and its "loaded" flag behind, so a
 *  chat that came back under the same id started half-remembered. */
function forgetChat(get: () => State, set: (p: Partial<State>) => void, id: string) {
  void dismissChatNotifications(id);
  const drop = <T,>(m: Record<string, T>) => { const n = { ...m }; delete n[id]; return n; };
  const st = get();
  set({
    chats: drop(st.chats), events: drop(st.events), live: drop(st.live),
    progress: drop(st.progress), thinking: drop(st.thinking), busy: drop(st.busy),
    loadedChats: drop(st.loadedChats),
  });
}

/** Tokens arrive from the tool one or two characters at a time - sixty-odd
 *  events a second on a fast model. Writing each one to the store re-rendered
 *  the open chat that many times a second, on top of the typewriter's own tick.
 *  Collect them and write on a frame the eye can actually see; the chat screen
 *  still types out whatever has landed. */
const pendingDeltas = new Map<string, { segment: number; text: string }>();
let deltaTimer: ReturnType<typeof setTimeout> | null = null;
const DELTA_FLUSH_MS = 80;

function flushDeltas() {
  if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
  if (pendingDeltas.size === 0) return;
  const live = { ...useStore.getState().live };
  for (const [cid, d] of pendingDeltas) {
    const cur = live[cid];
    live[cid] = cur && cur.segment === d.segment ? { ...cur, text: cur.text + d.text } : { segment: d.segment, text: d.text };
  }
  pendingDeltas.clear();
  useStore.setState({ live });
}

function bufferDelta(cid: string, segment: number, text: string) {
  const cur = pendingDeltas.get(cid);
  if (cur && cur.segment === segment) cur.text += text;
  else {
    // A new segment cannot wait behind the previous one's tail.
    if (cur) flushDeltas();
    pendingDeltas.set(cid, { segment, text });
  }
  if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS);
}

/** Which machines have a Divan poll out right now, and whose answer is still
 *  worth keeping. Module-level rather than in the store: it is about requests
 *  in flight, not about anything a screen draws, and a re-render has no
 *  business being triggered by it. The rules themselves are `Polls`
 *  (`src/divan.ts`), where they can be driven without a phone. */
const polls = new Polls();

/** …and which card has one out. Module-level for the same reason, and one value
 *  rather than a set because one card is open at a time — but the card itself
 *  rather than a flag: a read still out for the card somebody has just left must
 *  not be the reason the card they opened waits a minute for its first page. */
let cardPoll: string | null = null;

export const useStore = create<State>((set, get) => {
  // Fast Refresh can re-evaluate this module; make sure only the newest store listens.
  const anyClient = client as any;
  if (anyClient.__unbind) anyClient.__unbind();
  const unsubs: (() => void)[] = [];
  anyClient.__unbind = () => { for (const u of unsubs) u(); };

  unsubs.push(client.onStatus((conn) => {
    set({ conn });
    // Answering again is the end of the restart, whatever the last event said.
    // The daemon that announced it is not the one on the other end now.
    if (conn === 'online') { set({ restarting: null }); void afterConnect(); return; }
    // The new computer answered with a refusal or is unreachable: keeping the
    // previous one's chats on screen would be a lie, so end the switch empty.
    if (get().switching && (conn === 'offline' || conn === 'unauthorized')) settleSwitch({ chats: {}, groups: [] });
  }));

  async function afterConnect(attempt = 0): Promise<void> {
    try {
      const hello = await client.call('hello', { device_name: 'iPhone', push_token: get().pushToken ?? undefined });
      set({ hostInfo: hello.host, catalog: hello.catalog, device: hello.device ?? null });
      // What the computer already knows about the plan, so the ring is filled
      // in before the first turn rather than after it.
      client.call<{ accounts: Record<string, LimitWindow[]> }>('limits.get', {})
        .then((r) => set({ limits: r.accounts ?? {} }))
        .catch(() => {});
      // An older computer has no pool at all; that is not an error, it just
      // means the settings screen has nothing to offer.
      void get().loadPool();
      // The red count on the chats screen: the queue is asked once on connect
      // so a ticket waiting since last night is visible before anybody goes
      // looking for it. Costs one existence check on a computer with no queue.
      void get().loadUstabasi();
      // Every paired machine, not just this one: a dashboard is every computer
      // at once, and a connection is the moment its numbers are most likely to
      // be hours old. One request each, and a machine that is asleep costs one
      // timeout rather than a blank screen.
      void get().loadDivan();
      await get().refresh();
      // Nothing else is caught up here on purpose. Every chat ever opened used
      // to be re-fetched, one await after another, on every single reconnect —
      // and coming back from the background is a reconnect. Twenty chats meant
      // twenty round trips of up to five hundred events each, twenty store
      // writes and twenty full re-renders before the phone would answer a tap.
      // That is the freeze, and the backlog landing all at once is what it
      // looked like from the outside.
      //
      // The chat on screen already re-fetches itself the moment the connection
      // comes back (see the chat screen's effect on `conn`), and any other chat
      // re-fetches when it is opened. The loop was racing that effect too: both
      // read the same since_seq, so whichever answer landed last won and the
      // events only the other one had seen were dropped.
    } catch (e) {
      console.warn('hello failed', e);
      // The daemon answers slowly right after a restart; try once more before giving up.
      if (attempt < 2 && get().conn === 'online') { setTimeout(() => void afterConnect(attempt + 1), 3000); return; }
      // Out of retries. A switch still holding the previous computer's chats has
      // to let go of them, or the list stays dimmed and inert for good.
      if (get().switching) settleSwitch({ chats: {}, groups: [] });
    }
  }

  unsubs.push(client.on((ev) => {
    // Buffered tokens have to land before anything that reads or replaces the
    // live text, or a flush lands after `message.assistant` and appends a tail
    // the authoritative message already contains.
    if (ev.event !== 'text.delta' && pendingDeltas.size) flushDeltas();
    const s = get();
    const cid = ev.chat_id;
    switch (ev.event) {
      case 'host.status': set({ hostInfo: ev.data }); return;
      // The computer is stopping on purpose. Worth knowing, because a socket
      // that closes for a reason is a gap and a socket that closes for no
      // reason is a fault, and they deserve different faces. The poke is what
      // makes it a blink: the reconnect backoff would otherwise sit out the
      // first second of a restart that is already over.
      case 'daemon.restarting': {
        const st = ev.data?.state;
        set({ restarting: st === 'cancelled' ? null : ev.data });
        if (st === 'stopping') setTimeout(() => client.poke(), 1500);
        return;
      }
      // What is left of the plan, straight from the tool. Kept per account so a
      // second subscription's numbers never show up under the first.
      case 'limits': {
        const chat = ev.chat_id ? get().chats[ev.chat_id] : null;
        const key = chat?.account_id || `default-${chat?.provider ?? 'claude'}`;
        const at = Date.now() / 1000;
        // `windows` is the whole plan; the fields beside it describe only the
        // window the tool singled out. Take the list when it is there, and fall
        // back to the single window for a computer that has not been updated.
        const { windows, windows_complete: whole, ...headline } = (ev.data ?? {}) as LimitsEvent;
        const complete = !!whole && !!windows?.length;
        const incoming: LimitWindow[] = (windows?.length ? windows : [headline as LimitWindow])
          .filter((w) => w && w.window)
          .map((w) => ({ ...w, at }));
        if (incoming.length === 0) return;
        // A complete report replaces; anything else adds. Merging a complete
        // one left windows the plan had stopped having pinned at the last
        // number the tool ever gave them — a spent overage allowance drew a
        // full ring for as long as the app stayed open.
        const fresh = new Set(incoming.map((w) => w.window));
        const rest = complete
          ? []
          : (get().limits[key] ?? []).filter((w) => !fresh.has(w.window));
        set({ limits: { ...get().limits, [key]: [...rest, ...incoming] } });
        return;
      }
      case 'pool.updated':
        set({ pool: ev.data.settings ?? null, poolAccounts: ev.data.accounts ?? [] });
        return;
      case 'update.available': set({ updateStatus: { ...(get().updateStatus ?? {} as UpdateStatus), ...ev.data } }); return;
      case 'update.applied': return;   // the socket is about to drop; the reconnect tells the truth
      case 'agent.activity': {
        const id = ev.data?.id;
        if (!id) return;
        set({ agentActivity: { ...get().agentActivity, [id]: {
          tools: ev.data.tools ?? 0, tool: ev.data.tool, text: ev.data.text } } });
        return;
      }
      case 'account.login.prompt': set({ loginPrompt: ev.data }); return;
      case 'account.login.done': set({ loginDone: ev.data, loginPrompt: null, loginBusy: false, loginSubmitting: false }); return;
      case 'tool.install.output': set({ installLog: (s.installLog + ev.data.line).slice(-4000) }); return;
      case 'groups.changed': set({ groups: ev.data.groups }); return;
      case 'chats.changed': { const chats: Record<string, Chat> = {}; for (const c of ev.data.chats as Chat[]) chats[c.id] = c; set({ chats }); return; }
      case 'chat.created':
      case 'chat.updated': set({ chats: { ...s.chats, [ev.data.id]: ev.data } }); return;
      case 'chat.deleted': { const chats = { ...s.chats }; delete chats[ev.data.id]; set({ chats }); return; }
    }
    if (!cid) return;
    switch (ev.event) {
      case 'turn.started':
        set({ busy: { ...s.busy, [cid]: true }, live: { ...s.live, [cid]: null },
              progress: { ...s.progress, [cid]: null }, thinking: { ...s.thinking, [cid]: '' } });
        return;
      case 'text.delta':
        bufferDelta(cid, ev.data.segment as number, ev.data.text as string);
        return;
      case 'turn.progress':
        set({ progress: { ...s.progress, [cid]: ev.data } });
        return;
      case 'thinking.delta':
        set({ thinking: { ...s.thinking, [cid]: ((s.thinking[cid] || '') + ev.data.text).slice(-600) } });
        return;
    }
    if (ev.seq != null) {
      // Only a chat this phone has actually loaded keeps its events. A chat
      // nobody has opened has no history here, just whatever happened to
      // stream past while it was on another screen — and appending to that
      // builds a timeline that starts in the middle. openChat then asks for
      // everything *after* that fragment, so the chat opens as a fragment for
      // good, which is the phone showing an afternoon-old conversation while
      // the panel shows the real one. chat.get is what fills a chat in.
      const known = s.loadedChats[cid] || inFlightOpen.has(cid);
      const patch: Partial<State> = {};
      if (known) {
        const list = s.events[cid] || [];
        const last = list.length ? list[list.length - 1].seq! : 0;
        if (ev.seq <= last) return;
        patch.events = { ...s.events, [cid]: [...list, ev] };
      }
      if (ev.event === 'message.assistant') {
        const cur = s.live[cid];
        // Hand the authoritative text to the live item and mark it final; the chat
        // screen keeps typing it out and calls settleLive() when it catches up.
        if (cur && cur.segment === ev.data.segment) {
          patch.live = { ...s.live, [cid]: { segment: cur.segment, text: ev.data.text, final: true } };
          scheduleSettle(cid);
        }
        patch.thinking = { ...s.thinking, [cid]: '' };
      }
      if (ev.event === 'turn.done' || ev.event === 'turn.error') {
        patch.busy = { ...s.busy, [cid]: false };
        const cur = s.live[cid];
        if (!cur?.final) patch.live = { ...s.live, [cid]: null };
        patch.thinking = { ...s.thinking, [cid]: '' };
        // No agent is still working once the turn is over, and a stale "running
        // 12 tools" under a finished card would be a lie.
        patch.agentActivity = {};
      }
      set(patch);
    }
  }));

  /** Everything that belongs to one computer and must not outlive it. */
  const perHost = () => {
    pendingDeltas.clear();
    return {
      chats: {}, groups: [], events: {}, live: {}, busy: {}, loadedChats: {}, hostInfo: null, catalog: null, device: null, projects: [],
      chatsLoaded: false, accountsLoaded: false, projectsLoaded: false, accounts: [],
      agents: [], agentsLoaded: false, storeSources: [], storeLoaded: false, limits: {}, pool: null, poolAccounts: [], agentActivity: {}, updateStatus: null, restarting: null,
      ustabasi: null, ustabasiError: null, ustabasiOld: false,
    };
  };

  /** Wipe what the outgoing computer left behind and clear the switching flag. */
  function settleSwitch(extra: Partial<State> = {}) {
    pendingDeltas.clear();
    set({ events: {}, live: {}, busy: {}, loadedChats: {}, switching: false, ...extra } as any);
  }

  function connectTo(h: StoredHost | null, keepList = false) {
    client.disconnect();
    if (keepList) {
      // Hold on to `chats`/`groups` — they are what is on screen — and drop
      // everything else now, since no screen draws it without a live computer.
      set({ hostInfo: null, catalog: null, device: null, projects: [], accounts: [],
            agents: [], agentsLoaded: false, storeSources: [], storeLoaded: false, limits: {}, pool: null, poolAccounts: [], agentActivity: {}, updateStatus: null, restarting: null,
            ustabasi: null, ustabasiError: null, ustabasiOld: false,
            chatsLoaded: false, accountsLoaded: false, projectsLoaded: false, switching: true });
    } else {
      set({ ...perHost(), switching: false });
    }
    if (h) client.connect(h.host, h.port, h.token);
  }

  async function persistHosts(hosts: StoredHost[], active: string | null) {
    await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(hosts));
    await SecureStore.setItemAsync(ACTIVE_KEY, active ?? '');
    set({ hosts, activeHostId: active, host: hosts.find((h) => h.id === active) ?? null,
          defaults: defaultsFor(get().defaultsByHost, active) });
  }

  /** One request to a named computer, whichever one it is.
   *
   *  Every Divan surface reads all the paired machines at once, so a write that
   *  comes out of one of them is about a machine that may not be the one this
   *  phone is holding a socket to. The live socket is used where it is that
   *  computer — a second socket to it would be a second session for no reason —
   *  and a socket of its own is opened for every other, the same way a sign-in
   *  is read off a second machine (`callOnce`).
   *
   *  It throws where the computer cannot be reached, which is the honest answer
   *  and the one the screen draws: an answer that silently did not arrive is
   *  worse than one that says it did not. */
  async function onHost<T>(hostId: string, type: string, data: Record<string, any>): Promise<T> {
    const h = get().hosts.find((x) => x.id === hostId);
    if (!h) throw new Error(tt('wsNotConnected'));
    if (hostId === get().activeHostId) {
      if (get().conn !== 'online') throw new Error(tt('wsNotConnected'));
      return await client.call<T>(type, data, DIVAN_TIMEOUT_MS);
    }
    return await callOnce<T>(h.host, h.port, h.token, type, data, DIVAN_TIMEOUT_MS);
  }

  async function persistDefaults(byHost: DefaultsByHost) {
    set({ defaultsByHost: byHost, defaults: defaultsFor(byHost, get().activeHostId) });
    await SecureStore.setItemAsync(DEFAULTS_KEY, JSON.stringify(byHost));
  }

  return {
    ready: false, hosts: [], activeHostId: null, host: null, conn: 'idle', switching: false, hostInfo: null, catalog: null, device: null,
    projects: [], accounts: [], tools: [], npmAvailable: true, loginPrompt: null, loginDone: null,
    loginBusy: false, loginSubmitting: false, installLog: '',
    defaults: DEFAULTS, defaultsByHost: {}, prefs: PREFS, locked: false, pushToken: null,
    compose: NO_DRAFT, drafts: {},
    chats: {}, groups: [], showArchived: false, events: {}, live: {}, progress: {}, thinking: {}, busy: {}, loadedChats: {},
    agents: [], agentsLoaded: false, storeSources: [], storeLoaded: false, limits: {}, pool: null, poolAccounts: [], agentActivity: {}, updateStatus: null, restarting: null,
    ustabasi: null, ustabasiError: null, ustabasiOld: false, divan: {}, openCard: null,
    chatsLoaded: false, accountsLoaded: false, projectsLoaded: false,

    init: async () => {
      let hosts = await loadJSON<StoredHost[]>(HOSTS_KEY, []);
      if (!Array.isArray(hosts)) hosts = [];
      // migrate the single-host key from the first build
      try {
        const legacy = await SecureStore.getItemAsync('rac.host');
        if (legacy && hosts.length === 0) {
          const h = JSON.parse(legacy);
          hosts = [{ ...h, id: h.device_id || `${h.host}:${h.port}` }];
          await SecureStore.deleteItemAsync('rac.host');
          await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(hosts));
        }
      } catch {}
      let active = (await SecureStore.getItemAsync(ACTIVE_KEY).catch(() => null)) || null;
      if (!active || !hosts.some((h) => h.id === active)) active = hosts[0]?.id ?? null;
      // Builds before per-host defaults kept one flat blob: it was whatever the
      // last computer used, so it becomes that computer's entry and no other's.
      const stored = await loadJSON<any>(DEFAULTS_KEY, {});
      const byHost: DefaultsByHost = await raiseStoredPerm(typeof stored?.provider === 'string'
        ? (active ? { [active]: stored as Defaults } : {})
        : (stored as DefaultsByHost));
      const prefs = await loadJSON(PREFS_KEY, PREFS);
      const host = hosts.find((h) => h.id === active) ?? null;
      set({ hosts, activeHostId: active, host, defaultsByHost: byHost,
            defaults: defaultsFor(byHost, active), prefs, locked: prefs.faceIdLaunch, ready: true });
      if (host) client.connect(host.host, host.port, host.token);
    },

    addHost: async (cfg) => {
      const id = cfg.device_id || `${cfg.host}:${cfg.port}`;
      // one entry per host:port — re-pairing the same computer replaces its token
      const hosts = [...get().hosts.filter((h) => h.id !== id && !(h.host === cfg.host && h.port === cfg.port)), { ...cfg, id }];
      await persistHosts(hosts, id);
      connectTo(hosts.find((h) => h.id === id)!);
    },

    switchHost: async (id) => {
      const h = get().hosts.find((x) => x.id === id);
      if (!h || id === get().activeHostId) return;
      await persistHosts(get().hosts, id);
      connectTo(h, true);
    },

    removeHost: async (id) => {
      const wasActive = get().activeHostId === id;
      if (wasActive) {
        try { await client.call('device.revoke_self', {}); } catch {}
      }
      const hosts = get().hosts.filter((h) => h.id !== id);
      const active = wasActive ? (hosts[0]?.id ?? null) : get().activeHostId;
      const byHost = { ...get().defaultsByHost };
      delete byHost[id];                  // its folders and accounts go with it
      // …and so does its board. This is the one thing that drops a machine out
      // of the merged view: unreachable keeps its last answer, unpaired is gone.
      const divan = { ...get().divan };
      delete divan[id];
      set({ divan });
      await persistDefaults(byHost);
      await persistHosts(hosts, active);
      if (wasActive) connectTo(hosts.find((h) => h.id === active) ?? null);
    },

    setDefaults: async (d) => {
      const id = get().activeHostId;
      const defaults = { ...get().defaults, ...d };
      set({ defaults });
      if (!id) return;                    // nothing paired yet: nowhere to file it
      await persistDefaults({ ...get().defaultsByHost, [id]: defaults });
    },

    setPrefs: async (p) => {
      const prefs = { ...get().prefs, ...p };
      set({ prefs });
      await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
    },

    setDevicePrefs: async (p) => {
      const r = await client.call('device.prefs', p);
      set({ device: { ...(get().device as DeviceInfo), ...r } });
    },

    setPushToken: (t) => {
      set({ pushToken: t });
      if (t && get().conn === 'online') void client.call('device.prefs', { push_token: t }).catch(() => {});
    },

    authenticate: async (reason) => {
      try {
        const hw = await LocalAuthentication.hasHardwareAsync();
        const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
        if (!enrolled) return true; // no biometrics on this device → don't lock the user out
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: tt('cancel'), disableDeviceFallback: false });
        return r.success;
      } catch { return false; }
    },

    unlock: async () => {
      const ok = await get().authenticate(tt('unlockReason'));
      if (ok) set({ locked: false });
      return ok;
    },

    lock: () => { if (get().prefs.faceIdLaunch) set({ locked: true }); },

    refreshHost: async () => {
      const info = await client.call('host.info', {});
      set({ hostInfo: info });
    },

    checkUpdate: async (refresh = false) => {
      try {
        const st = await client.call<UpdateStatus>('update.status', { refresh });
        set({ updateStatus: st });
      } catch {
        // An older daemon has no update.status. Saying nothing is right: the
        // screen falls back to showing no version row at all.
      }
    },

    applyUpdate: async () => {
      try {
        const r = await client.call<{ ok: boolean; error?: string }>('update.apply', {});
        // A successful apply ends with the daemon exiting, so there is no
        // point re-reading status here — the socket is about to drop and the
        // reconnect brings back the new commit by itself.
        if (!r.ok) await get().checkUpdate(true);
        return r;
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },

    refresh: async () => {
      const r = await client.call('chat.list', { include_archived: true });
      const chats: Record<string, Chat> = {};
      for (const c of r.chats as Chat[]) chats[c.id] = c;
      // Swapping the list and dropping the old computer's per-chat state in one
      // set() is what makes the switch a single frame instead of a flicker.
      if (get().switching) settleSwitch({ chats, groups: r.groups, chatsLoaded: true });
      else set({ chats, groups: r.groups, chatsLoaded: true });
    },

    setShowArchived: (v) => { set({ showArchived: v }); },
    setCompose: (patch) => { set({ compose: { ...get().compose, ...patch } }); },
    setDraft: (project, patch) => {
      set({ drafts: { ...get().drafts, [project]: { ...(get().drafts[project] ?? NO_DRAFT), ...patch } } });
    },

    /** Drop a finished live segment once the chat screen has typed it out. */
    settleLive: (chatId) => {
      const cur = get().live[chatId];
      if (cur?.final) set({ live: { ...get().live, [chatId]: null } });
    },

    loadProjects: async () => {
      const r = await client.call('host.projects', {});
      set({ projects: r.projects, projectsLoaded: true });
      // The computer just listed what it has. A remembered folder that is not
      // on that list is gone — renamed, deleted, or another computer's — and
      // keeping it only means the next chat fails on a path nobody can open.
      const { defaults, hostInfo } = get();
      const known = [...r.projects.map((p: Project) => p.path), ...(hostInfo?.roots ?? [])];
      if (defaults.cwd && known.length && !onThisHost(defaults.cwd, known)) {
        await get().setDefaults({ cwd: null });
      }
    },

    openChat: async (id) => {
      // Two callers asking for the same chat at once both read the same
      // since_seq, and the slower answer overwrites the fuller one. Sharing the
      // in-flight request means they cannot disagree about where the chat ends.
      const running = inFlightOpen.get(id);
      if (running) return running;
      const run = (async () => {
        const list = get().loadedChats[id] ? (get().events[id] || []) : [];
        let since = list.length ? list[list.length - 1].seq! : 0;
        // A cold open is answered from the end of the chat; a reconnect asks
        // forward from where this phone left off, and keeps asking while the
        // computer says there is more. Stopping at the first page would leave
        // a hole that every later event is appended after, and nothing ever
        // goes back for it.
        let chat: any = null;
        let busy = false;
        let events: RacEvent[] = [];
        for (let page = 0; page < 10; page++) {
          const r = await client.call('chat.get', { chat_id: id, since_seq: since });
          chat = r.chat;
          busy = !!r.busy;
          const page_events = (r.events as RacEvent[]).filter((e) => (e.seq ?? 0) > since);
          events = [...events, ...page_events];
          if (!r.more || !page_events.length) break;
          since = page_events[page_events.length - 1].seq!;
        }
        // Re-read rather than close over `list`: events that streamed in while
        // the request was in the air are already in the store, and dropping
        // back to the old array would throw them away. On a cold open only
        // the ones past the answer are kept — anything earlier would be a
        // fragment sitting in front of the history that was just fetched.
        const answered = events.length ? (events[events.length - 1].seq ?? 0) : 0;
        const now = get().events[id] || [];
        const keep = list.length ? now : now.filter((e) => (e.seq ?? 0) > answered);
        const seen = new Set(keep.map((e) => e.seq));
        const merged = [...keep, ...events.filter((e) => !seen.has(e.seq))]
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        set({
          chats: { ...get().chats, [id]: chat },
          events: { ...get().events, [id]: merged },
          busy: { ...get().busy, [id]: busy },
          loadedChats: { ...get().loadedChats, [id]: true },
        });
      })();
      inFlightOpen.set(id, run);
      try {
        await run;
      } catch (e: any) {
        // The computer does not have this chat any more — deleted here, or on
        // another device, or by this app itself on the way out. Nothing will
        // ever answer for it, so drop it instead of leaving a row in the list
        // and a screen waiting for a transcript. The caller still gets the
        // error; it is the one that knows whether to go back.
        if (e?.code === 'no_chat') forgetChat(get, set, id);
        throw e;
      } finally { inFlightOpen.delete(id); }
    },

    createChat: async (d) => {
      const chat = await client.call<Chat>('chat.create', d);
      set({ chats: { ...get().chats, [chat.id]: chat } });
      return chat;
    },

    updateChat: async (id, fields) => {
      const chat = await client.call<Chat>('chat.update', { chat_id: id, ...fields });
      set({ chats: { ...get().chats, [id]: chat } });
    },

    deleteChat: async (id) => {
      await client.call('chat.delete', { chat_id: id });
      forgetChat(get, set, id);
    },

    send: async (id, text, attachments) => {
      await client.call('chat.send', { chat_id: id, text, attachments: attachments ?? [] });
    },

    interrupt: async (id) => { await client.call('chat.interrupt', { chat_id: id }); },

    respond: async (id, requestId, decision) => {
      await client.call('approval.respond', { chat_id: id, request_id: requestId, decision });
    },

    uploadAttachment: async (chatId, uri, name) => {
      const h = get().host;
      if (!h) throw new Error(tt('wsNotConnected'));
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('file', { uri, name, type: guessMime(name) } as any);
      const res = await fetch(`${httpBase(h.host, h.port)}/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${h.token}` }, body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `${tt('uploadFailed')} (${res.status})`);
      const att = (await res.json()) as Attachment;
      return { ...att, localUri: uri };
    },

    listAgents: async (accountId, cwd) => {
      const r = await client.call<{ agents: Agent[] }>('agent.list',
        { account_id: accountId ?? null, cwd: cwd ?? null });
      return r.agents ?? [];
    },

    loadAgents: async (accountId, cwd) => {
      const r = await client.call<{ agents: Agent[] }>('agent.list',
        { account_id: accountId ?? null, cwd: cwd ?? null });
      set({ agents: r.agents, agentsLoaded: true });
    },

    loadPool: async () => {
      try {
        const r = await client.call<{ settings: PoolSettings; accounts: PoolAccount[] }>('pool.get', {});
        set({ pool: r.settings ?? null, poolAccounts: r.accounts ?? [] });
      } catch {
        // A computer that predates the pool answers "unknown request". Nothing
        // is broken; there is simply nothing to show.
        set({ pool: null, poolAccounts: [] });
      }
    },

    setPool: async (patch) => {
      const r = await client.call<{ settings: PoolSettings; accounts: PoolAccount[] }>('pool.set', patch);
      set({ pool: r.settings ?? null, poolAccounts: r.accounts ?? [] });
    },

    loadUstabasi: async () => {
      try {
        const snap = await client.call<UstabasiSnapshot>('ustabasi.list', {});
        set({ ustabasi: { available: !!snap?.available, tickets: snap?.tickets ?? [], queue: snap?.queue ?? {} },
              ustabasiError: null, ustabasiOld: false });
      } catch (e: any) {
        // Three different silences, and the wall says which: a daemon that
        // predates the two requests, a queue that would not open, and a
        // connection that went away mid-poll (which is already on screen).
        set({ ustabasiError: e?.message ?? null, ustabasiOld: oldHost(e) });
      }
    },

    loadDivan: async (only) => {
      const targets = get().hosts.filter((h) => !only || h.id === only);
      // Every machine at once, and each on its own clock: one that is asleep
      // must not hold up the view, so nothing here awaits another host's turn.
      await Promise.all(targets.map(async (h) => {
        // A poll that is still out is the answer to this one. Without this, a
        // foreground while a timer's requests are in flight is two requests per
        // machine, and a machine that always times out never stops being asked.
        const era = polls.start(h.id);
        if (era == null) return;
        // …and an answer from before something was written to this board is not
        // an answer about now: it comes back without the card that was just
        // filed on it, and drawing it would take that card off the board again.
        const put = (d: HostDivan) => {
          if (!polls.keep(h.id, era)) return;
          set((st) => ({ divan: { ...st.divan, [h.id]: d } }));
        };
        try {
          const active = h.id === get().activeHostId;
          // The live socket for the computer the phone is on, and a socket of
          // its own for each of the others — the same way a sign-in is read off
          // a second machine (`callOnce`). A second socket to the computer that
          // already has one would be a second session for no reason.
          if (active && get().conn !== 'online') throw new Error(tt('wsNotConnected'));
          const snap = active
            ? await client.call<DivanSnapshot>('divan.snapshot', {}, DIVAN_TIMEOUT_MS)
            : await callOnce<DivanSnapshot>(h.host, h.port, h.token, 'divan.snapshot', {}, DIVAN_TIMEOUT_MS);
          put(answered(snap, Date.now() / 1000));
        } catch (e: any) {
          // The last answer stays, and `silent` is where that rule lives — the
          // one the merged view is built on, so it is checked where the merge is
          // rather than written out again here.
          put(silent(get().divan[h.id], e?.message ?? null, oldHost(e)));
        } finally {
          polls.done(h.id);
        }
      }));
    },

    readRun: async (id, cursor) => {
      return await client.call<RunPage>('ustabasi.run', { id, ...(cursor ? { cursor } : {}) });
    },

    loadCard: async ({ card, host }) => {
      const had = get().openCard;
      const mine = (o: Open | null) => !!o && o.id === card && o.host === host;
      // Another card than the one that was open is a different run and a
      // different brief; nothing of the last one is carried over.
      if (!mine(had)) set({ openCard: opening(card, host) });
      // A read that is still out for this card is the answer to this one.
      // Without it, a foreground while a request is in flight is two requests
      // for one page, and a machine that always times out never stops being
      // asked.
      const key = `${host}:${card}`;
      if (cardPoll === key) return;
      cardPoll = key;
      try {
        const open = get().openCard!;
        const got = await onHost<DivanCardDetail>(host, 'divan.card.get',
          { card_id: card, ...(open.cursor ? { cursor: open.cursor } : {}) });
        set((st) => (mine(st.openCard) ? { openCard: took(st.openCard!, got, Date.now() / 1000) } : {}));
      } catch (e: any) {
        set((st) => (mine(st.openCard)
          ? { openCard: missed(st.openCard!, e?.message ?? null, oldHost(e)) } : {}));
      } finally {
        if (cardPoll === key) cardPoll = null;
      }
    },

    sayCard: async (to, text) => {
      const open = get().openCard;
      if (!open) return;
      // Where in the log it was said. The run's own file has no clock in it, so
      // a sentence's place among its steps is not something that can be worked
      // out later — it is what the screen knows at the moment it is sent.
      const mine: Say = { id: `say-${Date.now()}`, at: Date.now() / 1000, text,
                          after: open.turns.length };
      const put = (list: (said: Say[]) => Say[]) =>
        set((st) => (st.openCard ? { openCard: { ...st.openCard, said: list(st.openCard.said) } } : {}));
      put((said) => [...said, mine]);
      try {
        await get().answerCard(to, text);
      } catch (e) {
        // A sentence the machine never took is not in the log, whatever the
        // screen said for a second.
        put((said) => said.filter((s) => s.id !== mine.id));
        throw e;
      }
    },

    answerCard: async (what, text) => {
      await onHost(what.host, 'ustabasi.note', { id: what.ticket, text });
      // The note re-opens the ticket on that computer, so its board is stale the
      // moment this returns — and the whole point of the screen the answer came
      // from is that the card stops waiting once it has been answered. Only the
      // machine that was written to: asking the other three would be three
      // requests about a thing that did not change.
      await get().loadDivan(what.host);
    },

    handCard: async (what, executor) => {
      await onHost(what.host, 'divan.card.executor', { card_id: what.card, executor });
      await get().loadDivan(what.host);
    },

    openItem: async (what, d) => {
      await onHost(what.host, 'divan.project.open', {
        project_id: what.project, item_id: what.item,
        ...(d.set ? { set: d.set } : {}),
        ...(d.comment != null ? { comment: d.comment, who: 'you' } : {}),
      });
      await get().loadDivan(what.host);
    },

    moveCard: async (what) => {
      // Position omitted rather than sent as null: no position means the bottom
      // of the column it is arriving in, which is what the daemon's own `move`
      // reads an absent one as.
      const at = what.position == null ? {} : { position: what.position };
      const r = await onHost(what.host, 'divan.card.move',
                             { card_id: what.card, column: what.column, ...at }) as Moved;
      await get().loadDivan(what.host);
      return { error: r?.error || '' };
    },

    createCard: async ({ host, card }) => {
      const made = await onHost<DivanCard>(host, 'divan.card.create', card);
      // The second half of filing, and the whole of "it appears on the board
      // without a refresh". The board is merged out of the last answer each
      // machine gave and the next one is a minute away, so it is told rather
      // than asked: the row that came back is the row that snapshot will carry
      // (`compose.filed`), and `wrote` is what stops a poll that went out
      // before the card from taking it off the board again.
      polls.wrote(host);
      set((st) => ({ divan: filed(st.divan, host, made) }));
      // …and the ordinary read after it, for whatever else that machine has
      // done. Best effort and only that machine: the board is already right
      // without it, and a quiet one's read runs to the timeout.
      void get().loadDivan(host);
    },

    noteTicket: async (id, text) => {
      const r = await client.call<{ ok?: boolean; message?: string }>('ustabasi.note', { id, text });
      // The note re-queues the ticket on the computer, so the wall is stale the
      // moment this returns — and the whole point of the screen is that the red
      // goes away when it has been answered.
      await get().loadUstabasi();
      return r?.message || '';
    },

    loadStore: async () => {
      const r = await client.call<{ sources: StoreSource[] }>('agent.store', {});
      set({ storeSources: r.sources, storeLoaded: true });
    },

    installAgent: async (id, accountId) => {
      await client.call('agent.install', { id, account_id: accountId ?? null });
      await get().loadAgents(accountId ?? null, get().defaults.cwd ?? null);
    },

    removeAgent: async (name, accountId) => {
      await client.call('agent.remove', { name, account_id: accountId ?? null });
      await get().loadAgents(accountId ?? null, get().defaults.cwd ?? null);
    },

    loadAccounts: async () => {
      const r = await client.call('account.list', {});
      set({ accounts: r.accounts, accountsLoaded: true });
    },

    importSignIn: async (accountId, credentials) => {
      // The blob is a bearer credential: it is passed straight through and
      // never kept in the store or on disk.
      const r = await client.call<CliAccount & { verified: boolean; verify_error: string | null }>(
        'account.import', { account_id: accountId, credentials });
      await get().loadAccounts();
      return r;
    },

    createAccount: async (provider, label) => {
      const a = await client.call<CliAccount>('account.create', { provider, label });
      // Show it straight away; asking every account whether it is signed in
      // means shelling out to the tools, and that is not worth waiting for.
      set({ accounts: [...get().accounts, a] });
      void get().loadAccounts().catch(() => {});
      return a;
    },

    startLogin: async (accountId, opts) => {
      set({ loginPrompt: null, loginDone: null, loginBusy: true, loginSubmitting: false });
      try {
        return await client.call('account.login', {
          account_id: accountId, email: opts?.email ?? null,
          method: opts?.method ?? null, api_key: opts?.api_key ?? null });
      } catch (e) {
        set({ loginBusy: false });
        throw e;
      }
    },

    submitLoginCode: async (accountId, code) => {
      set({ loginSubmitting: true });
      try {
        await client.call('account.login.submit', { account_id: accountId, code });
      } catch (e) {
        set({ loginSubmitting: false });
        throw e;
      }
    },

    cancelLogin: async (accountId) => {
      await client.call('account.login.cancel', { account_id: accountId }).catch(() => {});
      set({ loginPrompt: null, loginDone: null, loginBusy: false, loginSubmitting: false });
    },

    renameAccount: async (accountId, label) => {
      await client.call('account.rename', { account_id: accountId, label });
      await get().loadAccounts();
    },

    logoutAccount: async (accountId) => {
      await client.call('account.logout', { account_id: accountId });
      await get().loadAccounts();
      await get().refresh().catch(() => {});
    },

    deleteAccount: async (accountId) => {
      await client.call('account.delete', { account_id: accountId });
      await get().loadAccounts();
      await get().refresh().catch(() => {});
    },

    loadTools: async () => {
      const r = await client.call('tool.status', {});
      set({ tools: r.tools, npmAvailable: r.npm });
    },

    installTool: async (provider) => {
      set({ installLog: '' });
      await client.call('tool.install', { provider });
      await get().loadTools();
      await get().loadAccounts().catch(() => {});
    },

    createGroup: async (name) => {
      const g = await client.call<Group>('group.create', { name });
      set({ groups: [...get().groups, g] });
      return g;
    },

    renameGroup: async (id, name) => {
      await client.call('group.rename', { group_id: id, name });
      set({ groups: get().groups.map((g) => (g.id === id ? { ...g, name } : g)) });
    },

    deleteGroup: async (id) => {
      await client.call('group.delete', { group_id: id });
      set({ groups: get().groups.filter((g) => g.id !== id) });
      await get().refresh();
    },
  };
});

function guessMime(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[ext ?? ''] || 'application/octet-stream';
}

export interface TimelineItem {
  key: string;
  kind: 'user' | 'assistant' | 'tool' | 'tools' | 'approval' | 'done' | 'error' | 'switch';
  data: any;
  result?: any;
  decision?: string | null;
}

export function buildTimeline(events: RacEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolIdx = new Map<string, number>();
  const apprIdx = new Map<string, number>();
  for (const ev of events) {
    switch (ev.event) {
      case 'message.user': items.push({ key: `u${ev.seq}`, kind: 'user', data: ev.data }); break;
      case 'message.assistant': items.push({ key: `a${ev.seq}`, kind: 'assistant', data: ev.data }); break;
      case 'tool.use': toolIdx.set(ev.data.id, items.length); items.push({ key: `t${ev.seq}`, kind: 'tool', data: ev.data }); break;
      case 'tool.result': { const i = toolIdx.get(ev.data.id); if (i != null) items[i] = { ...items[i], result: ev.data }; break; }
      case 'approval.request': {
        // The tool card for this call arrives just before its approval; show the decision above it.
        const last = items[items.length - 1];
        const pos = last && last.kind === 'tool' && !last.result && last.data.tool === ev.data.tool ? items.length - 1 : items.length;
        items.splice(pos, 0, { key: `p${ev.seq}`, kind: 'approval', data: ev.data, decision: null });
        apprIdx.set(ev.data.request_id, pos);
        if (pos === items.length - 2) toolIdx.set(last.data.id, items.length - 1);
        break;
      }
      case 'approval.resolved': { const i = apprIdx.get(ev.data.request_id); if (i != null) items[i] = { ...items[i], decision: ev.data.decision }; break; }
      case 'turn.done': items.push({ key: `d${ev.seq}`, kind: 'done', data: ev.data }); break;
      case 'turn.error': items.push({ key: `e${ev.seq}`, kind: 'error', data: ev.data }); break;
      // The pool moved this chat to another sign-in, or found it had nowhere
      // to move it to. Either way the reader is owed a line saying so: the
      // answer that follows comes from a session that was handed a summary.
      case 'account.switched': items.push({ key: `s${ev.seq}`, kind: 'switch', data: ev.data }); break;
      case 'pool.exhausted': items.push({ key: `x${ev.seq}`, kind: 'switch', data: { ...ev.data, to: null } }); break;
    }
  }
  return groupTools(items);
}

/** What kind of work a tool call is, for folding: commands fold with
 *  commands and searches with searches, so the folded line can say which
 *  ("Ran 5 commands"). An edit never folds — its diff is the point of it. */
function toolKind(tool: string): 'command' | 'search' | 'edit' | 'other' {
  if (tool === 'Bash') return 'command';
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') return 'edit';
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS' || tool === 'Read' || tool === 'WebSearch' || tool === 'WebFetch') return 'search';
  return 'other';
}

/** Fold a run of tool calls into one card.
 *
 *  A turn that reads six files used to cost six cards, and the sentence that
 *  explained them scrolled off the top. A run is only folded once it is over:
 *  a call still waiting for its answer stays out in the open, because that is
 *  the one the reader is waiting on. Approvals break a run — a decision must
 *  never be hidden behind a chevron. */
function groupTools(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let run: TimelineItem[] = [];
  const flush = () => {
    if (run.length > 1) out.push({ key: `g${run[0].key}`, kind: 'tools', data: run });
    else out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (it.kind === 'tool' && it.result && toolKind(it.data.tool) !== 'edit') {
      if (run.length && toolKind(run[0].data.tool) !== toolKind(it.data.tool)) flush();
      run.push(it);
      continue;
    }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

/** Translation hook: re-renders when the language pref changes. */
export function useT() {
  return useCallback((key: Key, params?: Record<string, string | number>) => tt(key, params), []);
}

/** Absolute, authenticated URL for a file that lives on the active computer. */
export function fileUrl(path: string): string | null {
  const h = useStore.getState().host;
  if (!h) return null;
  return `${httpBase(h.host, h.port)}/files?path=${encodeURIComponent(path)}&token=${encodeURIComponent(h.token)}`;
}
