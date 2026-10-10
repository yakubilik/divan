import { create } from 'zustand';
import { RacClient, dialable, type ConnStatus } from './ws';
import type {
  Catalog, Chat, CliAccount, DirectoryPeer, Group, HostConfig, HostInfo, LimitWindow, Project, RacEvent,
} from './protocol';
import type { Refusal } from './refusal';

/** A computer is identified by where it answers, not by the name it was paired
 *  under: two entries pointing at the same daemon are the same computer. */
export function hostKey(cfg: Pick<HostConfig, 'host' | 'port' | 'via' | 'addr'>): string {
  // A peer reached through a gateway is still the computer at its own address:
  // the same row whether this browser dials it or the gateway does.
  if (cfg.via) return cfg.addr || `${cfg.host}:${cfg.port}/peer/${cfg.via}`;
  return `${cfg.host}:${cfg.port}`;
}

/** Where a computer itself answers — for a peer behind a gateway, its own
 *  address rather than the gateway's. What a screen shows as "address". */
export function hostAddr(cfg: HostConfig): { host: string; port: number } {
  if (cfg.via && cfg.addr) {
    const i = cfg.addr.lastIndexOf(':');
    return { host: cfg.addr.slice(0, i), port: Number(cfg.addr.slice(i + 1)) };
  }
  return { host: cfg.host, port: cfg.port };
}

/** Whether this is the computer that served the page. */
function isHome(cfg: HostConfig): boolean {
  if (cfg.via || typeof location === 'undefined') return false;
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  return cfg.host === location.hostname && String(cfg.port) === port;
}

/** The computer whose shared machine directory this panel shows: the one that
 *  served the page, else the first one paired here that this page can dial.
 *  One directory only — two computers listing each other would otherwise be
 *  four rows. */
export function directoryKey(s: Pick<FleetState, 'hosts' | 'order'>): string | null {
  const direct = s.order.map((k) => s.hosts[k]).filter((sl): sl is HostSlot => !!sl && !sl.cfg.via);
  const home = direct.find((sl) => isHome(sl.cfg)) ?? direct.find((sl) => dialable(sl.cfg.host));
  return home ? hostKey(home.cfg) : null;
}

export interface HostSlot {
  cfg: HostConfig;
  status: ConnStatus;
  info: HostInfo | null;
  catalog: Catalog | null;
  chats: Chat[];
  groups: Group[];
  /** Who shares that computer, and which of them this browser is. One name
   *  or none is a computer with nobody to tell apart. */
  people: { names: string[]; me: string | null };
  projects: Project[];
  accounts: CliAccount[];
  /** account id → the windows that account last reported */
  limits: Record<string, LimitWindow[]>;
  /** set while a slow refresh (account.list shells out to the CLIs) is in flight */
  loading: Record<string, boolean>;
  lastOnline: number | null;
  /** Why the computer refused this panel's token, while status is unauthorized. */
  refusal?: Refusal | null;
}

export interface Activity {
  id: number;
  hostKey: string;
  hostName: string;
  chatId: string | null;
  event: string;
  ts: number;
  text: string;
}

const ACTIVITY_MAX = 300;

/** The panel is the only client that talks to every paired computer at once —
 *  that is the whole point of it, and the reason it cannot reuse the phone's
 *  single-socket store. One RacClient per computer, all live, merged here.
 *  Clients are kept outside the store because they are not state: they are the
 *  thing that produces it. */
const clients = new Map<string, RacClient>();
const unsubs = new Map<string, (() => void)[]>();

let activitySeq = 0;

/** Anything that wants every event from every computer without owning a socket.
 *  timeline.ts registers here; keeping it a plain registry is what stops the
 *  two stores from importing each other in a circle. */
type Tap = (hostKey: string, ev: RacEvent) => void;
const taps = new Set<Tap>();
export function onAnyEvent(tap: Tap): () => void {
  taps.add(tap);
  return () => { taps.delete(tap); };
}

interface FleetState {
  hosts: Record<string, HostSlot>;
  order: string[];
  activity: Activity[];
  /** which computer the chat/projects/agents screens are looking at */
  focus: string | null;
  /** chats from every paired computer in one list, rather than just `focus`.
   *  `focus` keeps running underneath it — it is still the computer a new chat
   *  would start on, and the one the other screens look at. */
  allHosts: boolean;
  ready: boolean;

  boot: () => void;
  addHost: (cfg: HostConfig) => void;
  /** Register a computer in the shared machine directory from the link its
   *  `divan pair` printed, and show it. Resolves to its row's key. */
  registerPeer: (link: string) => Promise<string>;
  removeHost: (key: string) => void;
  setFocus: (key: string | null) => void;
  setAllHosts: (on: boolean) => void;
  refresh: (key: string) => Promise<void>;
  refreshAccounts: (key: string) => Promise<void>;
  call: <T = any>(key: string, type: string, data?: Record<string, any>) => Promise<T>;
}

function emptySlot(cfg: HostConfig): HostSlot {
  return {
    cfg, status: 'idle', info: null, catalog: null,
    chats: [], groups: [], people: { names: [], me: null }, projects: [], accounts: [], limits: {},
    loading: {}, lastOnline: null,
  };
}

function loadHosts(): HostConfig[] {
  try {
    const raw = localStorage.getItem('rac.hosts');
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((h) => h && h.host && h.port && h.token) : [];
  } catch { return []; }
}

function saveHosts(hosts: HostConfig[]) {
  localStorage.setItem('rac.hosts', JSON.stringify(hosts));
}

/** Which way the chat list was left last time. Remembered because it is a way
 *  of working, not a filter you re-pick every morning. */
function loadAllHosts(): boolean {
  try { return localStorage.getItem('rac.allHosts') === '1'; } catch { return false; }
}

/** A pairing handed over in the address bar: the `web` command opens the panel
 *  at …/#t=<token>&h=<host>&p=<port>&n=<name>. Consumed once, then wiped from
 *  the URL so the token does not sit in the address bar or in history. */
function hostFromHash(): HostConfig | null {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const q = new URLSearchParams(hash);
  const token = q.get('t');
  if (!token) return null;
  const cfg: HostConfig = {
    token,
    host: q.get('h') || location.hostname || '127.0.0.1',
    port: Number(q.get('p') || location.port || 8790),
    name: q.get('n') || 'This computer',
    device_id: q.get('d') || undefined,
  };
  history.replaceState(null, '', location.pathname + location.search);
  return Number.isFinite(cfg.port) && cfg.port > 0 ? cfg : null;
}

export const useFleet = create<FleetState>((set, get) => ({
  hosts: {},
  order: [],
  activity: [],
  focus: null,
  allHosts: loadAllHosts(),
  ready: false,

  boot: () => {
    if (get().ready) return;
    const stored = loadHosts();
    const fromUrl = hostFromHash();
    const all = [...stored];
    if (fromUrl) {
      const i = all.findIndex((h) => hostKey(h) === hostKey(fromUrl));
      if (i >= 0) all[i] = fromUrl; else all.push(fromUrl);
      saveHosts(all);
    }
    const hosts: Record<string, HostSlot> = {};
    for (const cfg of all) hosts[hostKey(cfg)] = emptySlot(cfg);
    const order = all.map(hostKey);
    set({ hosts, order, ready: true, focus: order[0] ?? null });
    for (const cfg of all) attach(cfg, set, get);

    // Dev server only: `npm run dev` runs on its own origin with no pairing in
    // the URL, so a gitignored public/dev-host.json stands in for one. Vite
    // strips this whole block from a production build.
    if (import.meta.env.DEV && !all.length) {
      fetch('/dev-host.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => { if (cfg?.token && cfg?.host) get().addHost(cfg); })
        .catch(() => {});
    }
  },

  addHost: (cfg) => {
    const key = hostKey(cfg);
    const all = loadHosts().filter((h) => hostKey(h) !== key);
    all.push(cfg);
    saveHosts(all);
    set((s) => ({
      hosts: { ...s.hosts, [key]: emptySlot(cfg) },
      order: s.order.includes(key) ? s.order : [...s.order, key],
      focus: s.focus ?? key,
    }));
    detach(key);
    attach(cfg, set, get);
  },

  registerPeer: async (link) => {
    const home = directoryKey(get());
    if (!home) throw new Error('No computer here keeps a machine directory.');
    const peer = await get().call<DirectoryPeer>(home, 'fleet.add', { link });
    await loadDirectory(home, set, get);
    return peer.addr;
  },

  removeHost: (key) => {
    const slot = get().hosts[key];
    if (slot?.cfg.via) {
      // A computer from the shared directory is unpaired there, for every
      // browser at once: the gateway forgets it and tells it to forget the
      // gateway's credential. Nothing is revoked from this browser's token,
      // which is the gateway's own computer's and still in use.
      const home = hostKey({ host: slot.cfg.host, port: slot.cfg.port });
      void get().call(home, 'fleet.remove', { id: slot.cfg.via }).catch(() => {});
      saveHosts(loadHosts().filter((h) => hostKey(h) !== key));
      dropSlot(key, set);
      return;
    }
    // Unpairing used to be local only: the panel forgot the computer and the
    // computer went on trusting the token in it forever. So the computer is
    // told first, while there is still a socket to tell it on — best effort,
    // because a machine that cannot be reached must not be a machine you
    // cannot remove.
    // Through the store's own `call`, which is the one path a request takes.
    try { void get().call(key, 'device.revoke_self', {}).catch(() => {}); }
    catch { /* going anyway */ }
    detach(key);
    saveHosts(loadHosts().filter((h) => hostKey(h) !== key));
    set((s) => {
      const hosts = { ...s.hosts };
      delete hosts[key];
      const order = s.order.filter((k) => k !== key);
      return { hosts, order, focus: s.focus === key ? (order[0] ?? null) : s.focus };
    });
  },

  setFocus: (key) => set({ focus: key }),

  setAllHosts: (on) => {
    localStorage.setItem('rac.allHosts', on ? '1' : '0');
    set({ allHosts: on });
  },

  call: async (key, type, data = {}) => {
    const c = clients.get(key);
    if (!c) throw new Error('That computer is not connected');
    return c.call(type, data);
  },

  refresh: async (key) => {
    const c = clients.get(key);
    if (!c) return;
    const [list, projects, info] = await Promise.allSettled([
      c.call('chat.list', {}),
      c.call('host.projects', {}),
      c.call('host.info', {}),
    ]);
    patch(set, key, (slot) => ({
      ...slot,
      chats: list.status === 'fulfilled' ? list.value.chats : slot.chats,
      groups: list.status === 'fulfilled' ? list.value.groups : slot.groups,
      people: list.status === 'fulfilled' && list.value.people ? list.value.people : slot.people,
      projects: projects.status === 'fulfilled' ? projects.value.projects : slot.projects,
      info: info.status === 'fulfilled' ? info.value : slot.info,
    }));
    // Plan usage only reaches the phone as an event during a turn, so a panel
    // that just opened would show nothing. limits.get is the cold-start read.
    try {
      const lim = await c.call('limits.get', {});
      patch(set, key, (slot) => ({ ...slot, limits: lim?.accounts ?? {} }));
    } catch { /* older daemon: no limits.get, events will fill it in */ }
  },

  /** account.list shells out to both CLIs and can take seconds, so it is never
   *  part of the connect path — whoever needs it asks for it, and the Machine
   *  place asks on the way in because the sign-in that is expiring is counted
   *  on a row of its drawer.
   *
   *  Asked through this store's own `call` rather than by reaching into the
   *  client map, like every other request the panel makes: a caller that wants
   *  to say why it failed (Settings › Accounts does) still gets the rejection. */
  refreshAccounts: async (key) => {
    patch(set, key, (s) => ({ ...s, loading: { ...s.loading, accounts: true } }));
    try {
      const r = await get().call<{ accounts?: CliAccount[] }>(key, 'account.list', {});
      patch(set, key, (s) => ({ ...s, accounts: r.accounts ?? [] }));
    } finally {
      patch(set, key, (s) => ({ ...s, loading: { ...s.loading, accounts: false } }));
    }
  },
}));

type Setter = (fn: (s: FleetState) => Partial<FleetState>) => void;

function patch(set: Setter, key: string, fn: (slot: HostSlot) => HostSlot) {
  set((s) => {
    const slot = s.hosts[key];
    if (!slot) return {};
    return { hosts: { ...s.hosts, [key]: fn(slot) } };
  });
}

function pushActivity(set: Setter, key: string, name: string, ev: RacEvent, text: string) {
  const item: Activity = {
    id: ++activitySeq, hostKey: key, hostName: name,
    chatId: ev.chat_id, event: ev.event, ts: ev.ts || Date.now() / 1000, text,
  };
  set((s) => ({ activity: [item, ...s.activity].slice(0, ACTIVITY_MAX) }));
}

/** One line for the live feed, or null for the events that are only noise at
 *  fleet level (every token of a streaming answer, for one). */
function activityText(ev: RacEvent): string | null {
  const d = ev.data || {};
  switch (ev.event) {
    case 'tool.use': return `${d.tool} ${firstArg(d.input)}`.trim();
    case 'tool.result': return d.is_error ? 'the tool errored' : null;
    case 'approval.request': return `awaiting approval · ${d.tool}`;
    case 'approval.resolved': return `approval ${d.decision}`;
    case 'turn.started': return 'turn started';
    case 'turn.done': { const c = fmtCost(d.cost_usd); return c ? `turn done · ${c}` : 'turn done'; }
    case 'turn.error': return `error · ${String(d.message ?? '').slice(0, 120)}`;
    case 'message.user': return d.queued ? 'message queued' : 'message sent';
    default: return null;
  }
}

function firstArg(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.prompt ?? '';
  return String(v).replace(/\s+/g, ' ').slice(0, 90);
}

/** Empty where the turn reported no cost, so that the line says `turn done`
 *  rather than `turn done · —`: a dash is not a figure. */
function fmtCost(v: any): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(3)}` : '';
}

function attach(cfg: HostConfig, set: Setter, get: () => FleetState) {
  const key = hostKey(cfg);
  const c = new RacClient();
  clients.set(key, c);

  const offStatus = c.onStatus((status: ConnStatus) => {
    patch(set, key, (slot) => ({
      ...slot, status, refusal: c.refusal,
      lastOnline: status === 'online' ? Date.now() : slot.lastOnline,
    }));
    if (status === 'online') {
      c.call('hello', { device_name: cfg.name || 'Panel' })
        .then((r: any) => patch(set, key, (slot) => ({
          ...slot, info: r.host ?? slot.info, catalog: r.catalog ?? slot.catalog,
        })))
        .then(() => get().refresh(key))
        .then(() => loadDirectory(key, set, get))
        .catch((e) => console.warn('rac: greeting', key, 'failed', e));
    }
  });

  const offEvent = c.on((ev: RacEvent) => {
    const name = get().hosts[key]?.info?.name || cfg.name;
    patch(set, key, (slot) => reduce(slot, ev));
    for (const tap of taps) tap(key, ev);
    if (ev.event === 'fleet.changed') void loadDirectory(key, set, get);
    const line = activityText(ev);
    if (line) pushActivity(set, key, name, ev, line);
    // A finished turn is when spend and plan usage actually moved.
    if (ev.event === 'turn.done') {
      c.call('limits.get', {})
        .then((lim: any) => patch(set, key, (slot) => ({ ...slot, limits: lim?.accounts ?? slot.limits })))
        .catch(() => {});
    }
  });

  unsubs.set(key, [offStatus, offEvent]);
  // An HTTPS page may not open a plain socket, and the browser says so in red
  // on every retry. A computer this page cannot dial is left offline here;
  // if the directory has it, loadDirectory replaces this row with one that
  // goes through the gateway.
  if (!cfg.via && !dialable(cfg.host)) {
    patch(set, key, (slot) => ({ ...slot, status: 'offline' }));
    return;
  }
  c.connect(cfg.host, cfg.port, cfg.token, cfg.via);
}

/** Forget a row in this tab only: its socket and its slot. */
function dropSlot(key: string, set: Setter) {
  detach(key);
  set((s) => {
    if (!s.hosts[key]) return {};
    const hosts = { ...s.hosts };
    delete hosts[key];
    const order = s.order.filter((k) => k !== key);
    return { hosts, order, focus: s.focus === key ? (order[0] ?? null) : s.focus };
  });
}

/** Show every computer in the shared directory of `key`, reached through it.
 *
 *  The directory is the computer's, not this browser's: nothing of it is put
 *  in localStorage, so a reload, or a browser that has never seen the peer,
 *  asks again and finds the same rows. A computer this browser paired on its
 *  own and can still dial keeps that pairing; one it cannot dial from this
 *  page — any tailnet address, from the HTTPS panel — is reached through the
 *  gateway instead. A daemon too old to know `fleet.list` simply has no
 *  directory. */
async function loadDirectory(key: string, set: Setter, get: () => FleetState): Promise<void> {
  const home = get().hosts[key];
  if (!home || home.cfg.via || directoryKey(get()) !== key) return;
  let peers: DirectoryPeer[];
  try {
    peers = (await get().call<{ peers?: DirectoryPeer[] }>(key, 'fleet.list', {})).peers ?? [];
  } catch { return; }
  const wanted = new Map<string, HostConfig>();
  for (const p of peers) {
    if (p.addr === key) continue;
    wanted.set(p.addr, {
      host: home.cfg.host, port: home.cfg.port, token: home.cfg.token,
      name: p.name, via: p.id, addr: p.addr,
    });
  }
  for (const k of get().order) {
    const sl = get().hosts[k];
    if (sl?.cfg.via && !wanted.has(k)) dropSlot(k, set);
  }
  for (const [k, cfg] of wanted) {
    const sl = get().hosts[k];
    if (sl && !sl.cfg.via && dialable(sl.cfg.host)) continue;
    if (sl && sl.cfg.via === cfg.via && sl.cfg.host === cfg.host && sl.cfg.port === cfg.port
        && sl.cfg.token === cfg.token) {
      if (sl.cfg.name !== cfg.name) patch(set, k, (x) => ({ ...x, cfg: { ...x.cfg, name: cfg.name } }));
      continue;
    }
    detach(k);
    set((s) => ({
      hosts: { ...s.hosts, [k]: emptySlot(cfg) },
      order: s.order.includes(k) ? s.order : [...s.order, k],
      focus: s.focus ?? k,
    }));
    attach(cfg, set, get);
  }
}

function detach(key: string) {
  for (const off of unsubs.get(key) ?? []) off();
  unsubs.delete(key);
  clients.get(key)?.disconnect();
  clients.delete(key);
}

/** Fold one event into a computer's slot. Chat timelines are built elsewhere
 *  (timeline.ts); this only keeps the fleet-level lists true. */
function reduce(slot: HostSlot, ev: RacEvent): HostSlot {
  const d: any = ev.data || {};
  switch (ev.event) {
    case 'host.status':
      return { ...slot, info: d };
    case 'chats.changed':
      return { ...slot, chats: d.chats ?? slot.chats };
    case 'groups.changed':
      return { ...slot, groups: d.groups ?? slot.groups };
    case 'chat.created':
      return { ...slot, chats: [d, ...slot.chats.filter((c) => c.id !== d.id)] };
    case 'chat.updated':
      return { ...slot, chats: slot.chats.map((c) => (c.id === d.id ? d : c)) };
    case 'chat.deleted':
      return { ...slot, chats: slot.chats.filter((c) => c.id !== d.id) };
    default:
      return slot;
  }
}

export function clientFor(key: string): RacClient | undefined {
  return clients.get(key);
}

/** Check every computer now, rather than at the next heartbeat. What the tab
 *  was doing while it was in the background is exactly what kills a socket
 *  quietly, so coming back to the front is the moment to ask. */
export function pokeAll(): void {
  for (const c of clients.values()) c.poke();
}

/** Everything that is running, anywhere, newest first — the one question the
 *  panel exists to answer. */
export interface Running { hostKey: string; hostName: string; chat: Chat }

export function selectRunning(s: FleetState): Running[] {
  const out: Running[] = [];
  for (const key of s.order) {
    const slot = s.hosts[key];
    if (!slot) continue;
    const name = slot.info?.name || slot.cfg.name;
    for (const chat of slot.chats) {
      if (chat.status !== 'idle') out.push({ hostKey: key, hostName: name, chat });
    }
  }
  return out.sort((a, b) => {
    const rank = (c: Chat) => (c.status === 'awaiting_approval' ? 0 : 1);
    return rank(a.chat) - rank(b.chat) || b.chat.updated_at - a.chat.updated_at;
  });
}
