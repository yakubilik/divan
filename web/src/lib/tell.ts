/** The command bar's own work: what "Tell Divan anything" does.
 *
 *  The bar across the bottom of every desktop frame (Web12 W1) is a composer
 *  and not a way in to somewhere else. A sentence typed into it starts a chat on
 *  the computer in focus, with that computer's own new-chat defaults, and the
 *  sentence is the first thing said in it — no dialog to fill in first, because
 *  a thought typed into a bar is a thought and not a form.
 *
 *  **The page does not move.** The Dashboard is the thing being looked at; a
 *  chat started from it opens as a window on it, bottom right, beside the
 *  questions the board is asking — the same dock, the same tabs, the same two
 *  characters in the corner of a window. The chat itself is an ordinary chat:
 *  it is in the Chat place's list the moment it exists, and closing its window
 *  here leaves it there.
 *
 *  What is in this file is the judgement and the sending, and no drawing at all:
 *  what a chat started this way is called, which defaults it opens on, which of
 *  them have a window and which are tabs, and what the reader has done with
 *  them. `scripts/test-overview.mjs` holds those without a browser and
 *  `scripts/test-drive.mjs` types into the bar in one.
 */
import { create } from 'zustand';
import { createChat, listAgents, send } from './actions';
import type { Provider } from './protocol';
import { useFleet } from './fleet';
import { hostDefaults, providerDefaults, resolveDefaults, usePrefs } from './prefs';
import { PANELS, TABS } from './sessions';
import { useLogs } from './timeline';

/** A chat the bar started, as the Dashboard remembers it.
 *
 *  The title is kept here as well as on the chat: the window has to be able to
 *  say what it is about in the moment between `chat.create` answering and the
 *  computer's own chat list catching up. */
export interface Told {
  host: string;
  chatId: string;
  title: string;
  /** When it was started, in seconds — newest first is the order they are
   *  drawn in, and the one just typed is the one being read. */
  at: number;
}

/** One spelling of a started chat's id, the way `sessions.ts` has one for a
 *  question: the dock raises a window by it. */
export const idOfTold = (t: { host: string; chatId: string }): string => `${t.host}:${t.chatId}`;

// ── what a chat started from the bar is called ──────────────────────────────

/** A title is a line on a 136 pt tab; past this it is a paragraph. */
export const TITLE_CHARS = 48;

/** The words themselves, cut to a title.
 *
 *  Not "New chat": the dock draws these side by side, and three tabs all
 *  reading `New chat` are three tabs nobody can tell apart. Cut on a word
 *  rather than mid-syllable, and never on a trailing comma. */
export function chatTitle(text: string): string {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  if (!line) return 'New chat';
  if (line.length <= TITLE_CHARS) return line;
  const cut = line.slice(0, TITLE_CHARS);
  const space = cut.lastIndexOf(' ');
  const body = (space > TITLE_CHARS / 3 ? cut.slice(0, space) : cut).replace(/[\s,;:.·—–-]+$/, '');
  return `${body}…`;
}

// ── what it opens on ────────────────────────────────────────────────────────

/** What a chat started from the bar opens with on this computer: the same
 *  values New chat would have shown in its dialog, resolved the same way
 *  (`prefs.ts`), so that the bar and the dialog cannot disagree about what "a
 *  new chat" means here.
 *
 *  The sign-in is the stored one and nothing cleverer. The panel does not pick
 *  an account by how full it is: which subscription a chat spends is a choice,
 *  and it is made in the window itself (`components/ChatPanel.tsx`), where the
 *  head says which one it is on and pressing it moves the chat to another.
 *
 *  Null when that computer has no tool to open a chat on — a slot that has not
 *  reported its catalog yet, or one with no model in it. The bar says so
 *  instead of sending a chat nobody can answer. */
export function toldDefaults(
  slot: { catalog: any; accounts?: any[] } | null | undefined,
  defaults: Record<string, any>,
  host: string,
  /** Asked for by name rather than the computer's usual tool: the bar's chats
   *  are Hermes', and an agent is a Claude idea. */
  want?: Provider,
) {
  const d = hostDefaults(defaults as any, host);
  const provider = want ?? d.provider;
  const pc = slot?.catalog?.[provider] ?? null;
  // The same filter New chat uses: this tool's sign-ins that are actually
  // signed in, plus the computer's own, which always counts.
  const accounts = (slot?.accounts ?? []).filter((a: any) => a.provider === provider
    && (a.logged_in || a.is_default));
  const pd = providerDefaults(d, provider);
  const r = resolveDefaults(pd, pc, accounts);
  if (!r.model) return null;
  // `account.list` is a slow question and the Dashboard has not asked it: with
  // no list to check against, the stored sign-in is taken at its word rather
  // than resolved away to the computer's own, which would quietly move every
  // chat off the subscription that was chosen.
  const account_id = accounts.length ? r.account_id : (pd.account_id ?? '');
  return { provider, cwd: d.cwd ?? null, ...r, account_id };
}

// ── where a scoped page opens a chat ────────────────────────────────────────

/** The product a page is scoped to, as much of it as this needs. */
export interface Scoped {
  name: string;
  /** Every repository the product owns, across the machines it is on. */
  repos: string[];
  /** …and the paired computers it has work on. */
  hosts: string[];
}

/** Which computer a chat opens on and in which folder, for a page that is
 *  about one product.
 *
 *  Asking Divan something while looking at Quire is asking about Quire, and
 *  a chat that opened in whatever folder this computer last used is a chat you
 *  have to tell where it is before it can do anything. So a scoped page opens
 *  the chat *in the product*: on a machine that product has work on, in the
 *  first of its repositories that machine actually has.
 *
 *  The machine matters as much as the folder — a repository of Quire is a
 *  path on the computer that holds it and nothing at all on the others — so the
 *  computer in focus only wins if the product is on it.
 *
 *  Null cwd is not a failure: a product with no repository attached is an
 *  ordinary product, and a chat about it opens where new chats open and carries
 *  its name instead. */
export function whereFor(
  scope: Scoped | null | undefined,
  hosts: Record<string, any>,
  focus: string | null,
): { host: string | null; cwd: string | null; project: string | null } {
  if (!scope) return { host: focus, cwd: null, project: null };
  const paired = scope.hosts.filter((h) => hosts[h]);
  const host = (focus && paired.includes(focus) ? focus : null)
    ?? paired.find((h) => hosts[h]?.status === 'online')
    ?? paired[0]
    ?? focus;
  // The folder has to be one that computer has: a product on two machines
  // carries both their paths, and the other machine's is a path to nothing.
  const known: string[] = (host ? hosts[host]?.projects ?? [] : []).map((p: any) => p.path);
  const cwd = scope.repos.find((r) => known.includes(r)) ?? scope.repos[0] ?? null;
  return { host, cwd, project: scope.name };
}

/** What the bar says it will do, where that is not the obvious thing: the
 *  product the chat will be about, by name and nothing else.
 *
 *  The folder and the machine are how it is done rather than what is being
 *  said, and a bar that spelled out a path every time you scoped a page would
 *  be a bar with a path on it all day. Null on an unscoped page: "it opens
 *  where new chats open" is not worth a line. */
export function whereNote(
  at: { host: string | null; cwd: string | null; project: string | null },
): string | null {
  return at.project || null;
}

// ── starting one ────────────────────────────────────────────────────────────

/** Say it: a chat on the computer in focus, and these words in it.
 *
 *  The window is remembered before the message is sent, so a first turn that
 *  takes a minute is a window with a chat opening in it rather than a bar that
 *  swallowed a sentence. A `chat.create` that fails throws with the computer's
 *  own words, and the bar keeps what was typed. */
/** What the Composer's chips were changed to for this one chat (`lib/compose.ts`).
 *  Every field left out is the computer's own default; `agent: null` is a real
 *  answer, no agent, and `undefined` is Hermes. */
export interface ToldPicks {
  provider?: Provider;
  model?: string;
  account_id?: string;
  agent?: string | null;
}

export async function tell(text: string, scope?: Scoped | null, picks: ToldPicks = {}): Promise<Told> {
  const words = (text || '').trim();
  if (!words) throw new Error('Nothing to send');
  const fleet = useFleet.getState();
  // A page about one product opens the chat in that product; anywhere else it
  // is the computer in focus and its own usual folder.
  const at = whereFor(scope, fleet.hosts, fleet.focus);
  const host = at.host;
  const slot = host ? fleet.hosts[host] : null;
  if (!host || !slot) throw new Error('No computer is paired');
  // Every chat the bar starts is Hermes': the one agent that reads the skills
  // and knows this person's work, which is what a sentence typed at the whole
  // of Divan is asking for. Claude because an agent is a Claude idea; a
  // computer that cannot open a Claude chat opens its usual one, plain.
  const prefs = usePrefs.getState().defaults;
  const open = picks.provider
    ? toldDefaults(slot, prefs, host, picks.provider)
    : toldDefaults(slot, prefs, host, 'claude') ?? toldDefaults(slot, prefs, host);
  if (!open) {
    const name = slot.info?.name ?? slot.cfg?.name ?? host;
    throw new Error(`${name} has not said what it can open a chat on yet`);
  }
  const cwd = at.cwd ?? open.cwd;
  const account = picks.account_id ?? open.account_id;
  const agent = picks.agent !== undefined ? picks.agent
    : open.provider === 'claude' ? await hermesOn(host, account || null, cwd) : null;
  // The computer names a chat after the folder it is in (`with_project`), so a
  // chat that opened in the product's repository already says which product it
  // is about. One with no repository to open in says it here instead.
  const title = at.project && !at.cwd
    ? `${at.project} · ${chatTitle(words)}`
    : chatTitle(words);
  const chat = await createChat(host, {
    provider: open.provider,
    model: picks.model ?? open.model!,
    effort: open.effort,
    perm_mode: open.perm_mode ?? undefined,
    account_id: account || undefined,
    cwd: cwd ?? undefined,
    title,
    ...(agent ? { agent_id: agent } : {}),
  });
  const told: Told = {
    host, chatId: chat.id, title: chat.title || title,
    at: Math.floor(Date.now() / 1000),
  };
  useTold.getState().start(told);
  // The timeline is opened before the send rather than after it: what comes
  // back from the turn arrives as events, and a window with no log behind it
  // has nowhere to put them.
  void useLogs.getState().open(host, chat.id);
  // A chat that opened in the product's repository has already been told which
  // product it is about — it is standing in it. One that could not (a product
  // with no repository attached) is told in a line, because "which product is
  // this about" is the first thing the answer depends on and the agent cannot
  // see the chat's own title.
  await send(host, chat.id, at.project && !at.cwd
    ? `${words}\n\n(This is about ${at.project}.)`
    : words);
  return told;
}

/** Hermes' id on that computer, under that sign-in and in that folder, the
 *  way New chat finds it. Null when it is not installed there or the computer
 *  will not say: the chat still opens, without the agent, rather than not at
 *  all. */
export async function hermesOn(host: string, accountId: string | null, cwd: string | null): Promise<string | null> {
  try {
    const r: any = await listAgents(host, accountId, cwd ?? undefined);
    const hit = (r?.agents ?? []).find((a: any) => a.installed && (a.name === 'hermes' || a.id === 'hermes'));
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** How long a chat is believed in before its computer has mentioned it.
 *
 *  `chat.create` answers on the socket and the `chat.created` broadcast that
 *  puts the chat in that computer's list arrives beside it, in either order. A
 *  window that waited for the list would flicker; one that never checked would
 *  outlive a deleted chat. So: young enough, and it is there. */
export const TOLD_GRACE = 30;

/** The started chats that are still chats: the computer is paired, and — where
 *  it is online, has answered with its list, and has had a moment to hear about
 *  this one — the chat is in that list. A chat deleted in the Chat place loses
 *  its window here too; a computer that cannot be reached keeps its windows,
 *  because "I cannot see it" is not "it is gone". */
export function liveTold(
  chats: Told[], hosts: Record<string, any>, now = Date.now() / 1000,
): Told[] {
  return chats.filter((c) => {
    const slot = hosts[c.host];
    if (!slot) return false;
    if (slot.status !== 'online' || !slot.chats?.length) return true;
    if (now - c.at < TOLD_GRACE) return true;
    return slot.chats.some((x: any) => x.id === c.chatId);
  });
}

/** Where a window stands when nobody has put it anywhere: the corner, and each
 *  one after that to the left of the last. */
export function slot(i: number, corner = { right: 24, bottom: 78 },
                    size = { width: 350, height: 500 }): Place {
  return {
    right: corner.right + i * (size.width + 10),
    bottom: corner.bottom,
    width: size.width,
    height: size.height,
  };
}

/** A place for a window that has none yet: the first slot no other window is
 *  standing in.
 *
 *  Windows used to be positioned by where they came in a list — the newest in
 *  the corner, the next one to the left of it — which meant a window moved
 *  whenever *another* one opened, closed, or dropped out of the list for a
 *  poll. A window is furniture: it is where it is, and what happens to its
 *  neighbour is not its business. So a window is given a place the first time
 *  it is drawn and keeps it until somebody drags it.
 *
 *  "Standing in" is measured by the corner it is pinned to rather than by an
 *  overlap: two windows a person has dragged half over each other is their own
 *  arrangement, and this is only ever asked about a window that has just
 *  appeared. */
export function freeSlot(taken: Place[], corner?: { right: number; bottom: number },
                         size?: { width: number; height: number }): Place {
  for (let i = 0; i < 8; i++) {
    const at = slot(i, corner, size);
    if (!taken.some((p) => Math.abs(p.right - at.right) < 40
        && Math.abs(p.bottom - at.bottom) < 40)) {
      return at;
    }
  }
  return slot(0, corner, size);
}

// ── which have a window, which are tabs ─────────────────────────────────────

export interface ToldDock {
  /** Nearest the corner first, newest first. */
  panels: Told[];
  tabs: { told: Told; open: boolean }[];
  more: number;
}

/** The windows and the tabs, out of what has been started and what has been put
 *  away.
 *
 *  `room` is how many windows are left after the board's own questions have
 *  taken theirs — the corner holds two (`PANELS`), and a chat you have just
 *  typed takes one of them, because it is the thing you are doing. Everything
 *  else is a tab, side by side along the bottom, and past three of those the
 *  rest are a count. */
export function arrangeTold(
  chats: Told[], minimised: string[] = [], room = PANELS, tabs = TABS,
): ToldDock {
  const away = new Set(minimised);
  const panels = chats.filter((c) => !away.has(idOfTold(c))).slice(0, Math.max(0, room));
  const shown = new Set(panels.map(idOfTold));
  const space = Math.max(0, tabs - panels.length);
  const also = new Set(chats.filter((c) => !shown.has(idOfTold(c))).slice(0, space).map(idOfTold));
  const row = chats.filter((c) => shown.has(idOfTold(c)) || also.has(idOfTold(c)))
    .map((told) => ({ told, open: shown.has(idOfTold(told)) }));
  return { panels, tabs: row, more: Math.max(0, chats.length - row.length) };
}

// ── where a window has been put, and how big ────────────────────────────────

/** A window the reader has moved or resized. Held from the corner the dock
 *  stands in — `right`/`bottom` rather than left/top — so that a window keeps
 *  its place against that corner when the browser is resized, which is where
 *  every other window on this page is measured from. */
export interface Place { right: number; bottom: number; width: number; height: number }

/** A window cannot be made so small that nothing fits in it, nor so large that
 *  its own head is off the screen. */
export const MIN_W = 280;
export const MIN_H = 220;

/** Keep a window on the screen. A panel dragged past an edge is a panel you
 *  cannot drag back, so the corner it is measured from is held inside the
 *  viewport and its size inside what there is room for. */
export function inView(place: Place, view: { width: number; height: number }): Place {
  const width = Math.max(MIN_W, Math.min(place.width, Math.max(MIN_W, view.width - 16)));
  const height = Math.max(MIN_H, Math.min(place.height, Math.max(MIN_H, view.height - 16)));
  return {
    width,
    height,
    right: Math.max(0, Math.min(place.right, Math.max(0, view.width - width))),
    bottom: Math.max(0, Math.min(place.bottom, Math.max(0, view.height - height))),
  };
}

// ── what the reader has done with them ──────────────────────────────────────

const KEPT = 'rac.told';

/** How many the Dashboard keeps. A chat is not lost by falling off this — it is
 *  a chat, and the Chat place has all of them; what is dropped is the window. */
const KEEP = 8;

interface Kept { chats: Told[]; minimised: string[]; places: Record<string, Place> }

function read(): Kept {
  try {
    const raw = localStorage.getItem(KEPT);
    const held = raw ? JSON.parse(raw) : null;
    const chats = (held?.chats ?? [])
      .filter((c: any) => c && typeof c.host === 'string' && typeof c.chatId === 'string')
      .map((c: any) => ({
        host: c.host, chatId: c.chatId, title: String(c.title ?? 'New chat'), at: Number(c.at) || 0,
      }));
    const minimised = (held?.minimised ?? []).filter((x: any) => typeof x === 'string');
    const places = Object.fromEntries(Object.entries(held?.places ?? {})
      .filter(([, p]: any) => p && ['right', 'bottom', 'width', 'height']
        .every((k) => Number.isFinite(p[k])))) as Record<string, Place>;
    return { chats, minimised, places };
  } catch { return { chats: [], minimised: [], places: {} }; }
}

function write(state: Kept): void {
  try { localStorage.setItem(KEPT, JSON.stringify(state)); } catch { /* private mode */ }
}

interface ToldStore {
  chats: Told[];
  minimised: string[];
  /** Only the windows that have been moved or resized by hand: one that has not
   *  been touched stands where the dock puts it, and goes on doing so as others
   *  open and close beside it. */
  places: Record<string, Place>;
  start: (told: Told) => void;
  minimise: (id: string) => void;
  restore: (id: string) => void;
  /** Take the window off the page. The chat stays where every chat is. */
  close: (id: string) => void;
  place: (id: string, place: Place) => void;
}

/** A store rather than a screen's state, for the reason the question dock is
 *  one: the Dashboard is unmounted while you are looking at a machine, and a
 *  chat you started must still be on the page when you come back. Kept in
 *  `localStorage` for the same reason across a reload. */
export const useTold = create<ToldStore>((set) => ({
  ...read(),
  start: (told) => set((s) => {
    const id = idOfTold(told);
    const chats = [told, ...s.chats.filter((c) => idOfTold(c) !== id)].slice(0, KEEP);
    const next = { ...s, chats, minimised: s.minimised.filter((x) => x !== id) };
    write(next);
    return next;
  }),
  minimise: (id) => set((s) => {
    if (s.minimised.includes(id)) return s;
    const next = { ...s, minimised: [...s.minimised, id] };
    write(next);
    return next;
  }),
  restore: (id) => set((s) => {
    const next = { ...s, minimised: s.minimised.filter((x) => x !== id) };
    write(next);
    return next;
  }),
  close: (id) => set((s) => {
    const next = {
      ...s,
      chats: s.chats.filter((c) => idOfTold(c) !== id),
      minimised: s.minimised.filter((x) => x !== id),
      places: Object.fromEntries(Object.entries(s.places).filter(([k]) => k !== id)),
    };
    write(next);
    return next;
  }),
  place: (id, place) => set((s) => {
    const next = { ...s, places: { ...s.places, [id]: place } };
    write(next);
    return next;
  }),
}));
