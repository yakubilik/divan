// The fastest screen in the product, decided away from the screen that draws
// it. No React, no store, no palette — `scripts/test-new-ticket.cjs` holds the
// screen to every judgement in here without a phone.
//
// Mobile8 S9 is four things on one page: which product it is for, a title, a
// fixed three-line space for two or three sentences, and two buttons. What is
// *not* on it is the whole point. There is no executor picker, no brief form,
// no wizard and nothing to approve: a card written down mid-conversation is a
// line, and the agent face is filled in later or drafted by Divan. The daemon
// is written the same way round — `divan.card.create` takes a title and
// invents no agent face (`server.py h_divan_card_create`).
//
// Two things in here are not layout and are the reason this file exists:
//
//   * **a card is written on one machine.** A product checked out on the studio
//     and the mini is one product with two boards behind it, and each of them
//     has its own id for it (`divan.ts` `MergedProject.ids`). `writer` picks
//     which, and it is allowed to pick one that is not answering.
//   * **the board is told about the card, not asked.** Divan polls on a minute
//     and a quiet machine's read runs to a timeout, so waiting for either is
//     waiting: `filed` puts the row the machine just handed back onto the board
//     the phone is already holding. The store makes the request and applies it
//     (`createCard`); the reading is here, where it can be checked.
import type { DivanView, HostDivan, MergedProject } from './divan';
import type { CliAccount, DivanCard, DivanColumn, LimitWindow, Provider, ProviderCatalog } from './protocol';
import type { Key } from './i18n';

/** How long the card's own sentences are allowed to be. S9 counts `108 / 220`
 *  under the box and the desktop's composer counts against the same limit
 *  (`web/src/lib/ticket.ts`): one field, written from two places.
 *
 *  It is a number the line under the box counts against and nothing else.
 *  Nothing shortens a description: what is in the box is what is filed, down
 *  to the last character — a card quietly filed without its last sentence is
 *  one whose author will never find out — and the desktop's composer counts
 *  against the same number and sends the whole thing too. The cap that is real
 *  is the daemon's (`divan.py MAX_SUMMARY`), and it is far above this. */
export const SUMMARY_MAX = 220;

/** The description box is the same fixed three-line space as the ticket's human
 *  face (S9's own note), at the frame's `16px/24px`. It does not grow: the
 *  buttons under it are what the thumb is going to, and a box that pushed them
 *  down the page as you typed would move the target while you aimed at it. */
export const SUMMARY_LINES = 3;
export const LINE_HEIGHT = 24;

/** Where the two buttons file it. Neither starts anything: Ice Box is the
 *  someday pile and Queued is next up, and work begins when a card is dragged
 *  into In Progress (`src/drag.ts`). That is why this screen has no approval
 *  step to skip — there is nothing to approve. */
export type Landing = Extract<DivanColumn, 'ice_box' | 'queued'>;

/** Ice Box first and filled in, Queued beside it as an outline (S9). */
export const LANDINGS: Landing[] = ['ice_box', 'queued'];

/** The computer the card is written on, and that machine's own id for this
 *  product.
 *
 *  Whichever of its machines is answering; failing that the first that has the
 *  product at all. A machine that has gone quiet is still asked where it is the
 *  only one that has this product: what the phone holds of it is a memory, and
 *  a card refused on the strength of a memory is a card nobody wrote. If the
 *  computer really is gone the request fails in words, which the screen shows
 *  with the typing still in the boxes.
 *
 *  Null where no paired computer has this product — the one state of this
 *  screen with nowhere to put a card. */
export interface Writer {
  host: string;
  /** What that computer calls itself, for the line that says it did not
   *  answer. */
  machine: string;
  /** Its own id for this product, which is what `divan.card.create` is given. */
  project: string;
  /** It has not answered recently. Worth saying before the button is pressed
   *  rather than after. */
  quiet: boolean;
}

export function writer(view: DivanView, p: MergedProject | null): Writer | null {
  if (!p) return null;
  const mine = view.hosts.filter((h) => p.ids[h.id]);
  const h = mine.find((x) => x.reachable) ?? mine[0];
  return h ? { host: h.id, machine: h.machine, project: p.ids[h.id], quiet: !h.reachable } : null;
}

/** Which product the screen opens on: the one it was opened from — the board's
 *  own `+ ticket`, or the Dashboard with a product selected — and failing that
 *  the first in the view. The chip at the top is a picker, so a wrong guess
 *  costs one tap and no product at all costs a screen. */
export function opens(view: DivanView, key: string | null | undefined): MergedProject | null {
  return (key ? view.projects.find((p) => p.key === key) : null) ?? view.projects[0] ?? null;
}

/** What is in the two boxes, and whether it is enough.
 *
 *  Enough is a title. Not a title and a description, not a title and an
 *  executor, not a brief: the sentences are optional and everything an agent
 *  would need is absent from this screen by design. */
export interface Draft {
  title: string;
  summary: string;
  ready: boolean;
  /** The left-hand number under the box. */
  used: number;
}

export function draft(title: string, summary: string): Draft {
  const text = (summary || '').trim();
  return { title: (title || '').trim(), summary: text, ready: !!(title || '').trim(), used: text.length };
}

/** What `divan.card.create` is asked for, and nothing else.
 *
 *  Four fields. No `executor`, no `agent`, no branch and no repository: the
 *  daemon defaults the branch and requires none of the rest, and a field this
 *  screen guessed at would be an agent face nobody wrote. */
export interface Filing {
  project_id: string;
  title: string;
  summary: string;
  /** …or In Progress, which only the Dashboard's Start now writes into. */
  column: Landing | 'in_progress';
}

export function filing(w: Writer, d: Draft, into: Landing | 'in_progress'): Filing {
  return { project_id: w.project, title: d.title, summary: d.summary, column: into };
}

/** The card the machine just made, put on the board this phone is holding.
 *
 *  This is the whole of "it appears on the board without a refresh". A board is
 *  merged out of the last answer each machine gave and the next one is a minute
 *  away (`DIVAN_POLL_MS`), so the board is not asked whether the card exists —
 *  it is told. The row that came back is the row the next snapshot will carry,
 *  and the count on its column goes up with it; that snapshot then replaces the
 *  lot. Nothing here waits on a poll, which matters most exactly where waiting
 *  is worst: a machine that has gone quiet, whose next read runs to the timeout.
 *
 *  A machine the phone has never had an answer from is left alone. There is no
 *  board of it to put a card on, and a snapshot invented here would be a
 *  machine invented here. */
export function filed(divan: Record<string, HostDivan>, host: string,
                      card: DivanCard): Record<string, HostDivan> {
  const had = divan[host];
  const snap = had?.snapshot;
  // Already reported: a second copy of one card is worse than a slow board,
  // and so is a column counted twice.
  if (!snap || snap.cards.some((c) => c.id === card.id)) return divan;
  return {
    ...divan,
    [host]: {
      ...had,
      snapshot: {
        ...snap,
        // At the top of its column, which is where the machine put it
        // (`divan.py create_card`) and where the thing just written down
        // belongs.
        cards: [card, ...snap.cards],
        projects: snap.projects.map((p) => (p.id !== card.project_id ? p : {
          ...p,
          counts: { ...p.counts, [card.column]: (p.counts?.[card.column] ?? 0) + 1 },
        })),
      },
    },
  };
}

// ── the Dashboard's Composer (HANDOVER §3, §5) ──────────────────────────────
//
// One field for what new-chat and new-ticket used to be, with the mode under it
// and four chips under that. The same rules as the panel's
// (`web/src/lib/compose.ts`), so the two cannot disagree about what one press
// sends.

export type Mode = 'ask' | 'ice' | 'now';

export const MODES: { key: Mode; label: Key; hint: Key }[] = [
  { key: 'ask', label: 'cmAsk', hint: 'cmAskHint' },
  { key: 'ice', label: 'cmIce', hint: 'cmIceHint' },
  { key: 'now', label: 'cmNow', hint: 'cmNowHint' },
];

export const MODE_COLUMN: Record<Exclude<Mode, 'ask'>, 'ice_box' | 'in_progress'> = {
  ice: 'ice_box', now: 'in_progress',
};

/** What a chip was changed to, for one send. `undefined` is the default in
 *  every field; `agent: null` is a real answer, no agent. */
export interface Picks {
  project?: string | null;
  agent?: string | null;
  account?: string;
  /** `provider/model`. */
  model?: string;
}

/** What is in the Composer between two presses. */
export interface ComposeDraft { text: string; mode: Mode; picks: Picks }
export const NO_DRAFT: ComposeDraft = { text: '', mode: 'ask', picks: {} };

export function named(view: Pick<DivanView, 'projects'>, word: string): MergedProject | null {
  const w = word.toLocaleLowerCase('en');
  return view.projects.find((p) => [p.slug, p.key, p.name]
    .some((n) => (n || '').toLocaleLowerCase('en') === w)) ?? null;
}

/** `@project` becomes the scope chip and leaves the sentence. A finished word
 *  only — followed by a space, or anything at all when `final` — and a word
 *  that names no product stays where it was typed. */
export function mention(view: Pick<DivanView, 'projects'>, text: string, final = false):
  { project: string | null; text: string } {
  const re = final ? /(^|\s)@([\w.-]+)(?=\s|$)/ : /(^|\s)@([\w.-]+)(?=\s)/;
  let out = text;
  let project: string | null = null;
  for (;;) {
    const m = re.exec(out);
    if (!m) break;
    const p = named(view, m[2]);
    if (!p) {
      const rest = mention(view, out.slice(m.index + m[0].length), final);
      return { project: rest.project ?? project, text: out.slice(0, m.index + m[0].length) + rest.text };
    }
    project = p.key;
    out = (out.slice(0, m.index) + m[1] + out.slice(m.index + m[0].length)).replace(/^\s+/, '');
  }
  return { project, text: out };
}

/** A line is a title; past 48 characters it is cut on a word, and the whole
 *  sentence becomes the card's description so that nothing typed is lost. */
export const TITLE_CHARS = 48;
export function cardOf(text: string): { title: string; summary: string } {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_CHARS) return { title: line, summary: '' };
  const cut = line.slice(0, TITLE_CHARS);
  const space = cut.lastIndexOf(' ');
  const body = (space > TITLE_CHARS / 3 ? cut.slice(0, space) : cut).replace(/[\s,;:.·—–-]+$/, '');
  return { title: `${body}…`, summary: line };
}

/** The greeting, by the phone's own clock. No name: nothing reports one. */
export function greeting(hour: number): Key {
  if (hour >= 5 && hour < 12) return 'cmMorning';
  if (hour >= 12 && hour < 18) return 'cmAfternoon';
  return 'cmEvening';
}

/** The line under it: needs you · working · stuck, each counted, a zero in words. */
export function summary(view: Pick<DivanView, 'totals'>): { key: string; n: number; said: Key }[] {
  const { needsYou, running, stuck } = view.totals;
  return [
    { key: 'needs', n: needsYou, said: needsYou === 0 ? 'cmNeedsNone' : needsYou === 1 ? 'cmNeedsOne' : 'cmNeeds' },
    { key: 'working', n: running, said: running === 0 ? 'cmWorkingNone' : 'cmWorking' },
    { key: 'stuck', n: stuck, said: stuck === 0 ? 'cmStuckNone' : 'cmStuck' },
  ];
}

export const modelValue = (provider: Provider, id: string) => `${provider}/${id}`;
export function readModel(value: string | undefined): { provider: Provider; model: string } | null {
  if (!value) return null;
  const at = value.indexOf('/');
  return at < 0 ? null : { provider: value.slice(0, at) as Provider, model: value.slice(at + 1) };
}

export function modelOptions(catalog: Partial<Record<Provider, ProviderCatalog>> | null | undefined):
  { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const provider of ['claude', 'codex'] as Provider[]) {
    for (const m of catalog?.[provider]?.models ?? []) out.push({ value: modelValue(provider, m.id), label: m.label || m.id });
  }
  return out;
}

/** The sign-ins one tool can open a chat on, `''` for the computer's own. */
export function accountValues(accounts: CliAccount[], provider: Provider): { value: string; label: string | null }[] {
  return accounts.filter((a) => a.provider === provider && (a.logged_in || a.is_default))
    .map((a) => ({ value: a.is_default ? '' : a.id, label: a.is_default ? null : a.label }));
}

/** Under the design's own `warn at 20%` (`machine.ts WARN_AT`), or refused
 *  outright. Null where nothing was measured: no dot and no words. */
export function lowQuota(windows: LimitWindow[] | undefined, warn: number): boolean | null {
  const list = windows ?? [];
  const used = list.map((w) => w.utilization).filter((u): u is number => typeof u === 'number');
  const refused = list.some((w) => w.status === 'rejected');
  if (!used.length) return refused ? true : null;
  return refused || 1 - Math.max(...used) <= warn;
}

export const limitsKey = (provider: Provider, account: string) => account || `default-${provider}`;

/** `14m`, `3h`, `5w`, `2mo`. */
export function short(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}
