// What the two pages under the Machine tab say, decided away from the screens
// that draw them (Mobile11 S15 Machines, S14 Executors).
//
// The drawer itself is `src/shell.ts` — it is a list of routes and belongs with
// the rest of the shell. What is here is the two pages it opens that are made
// of what the machines answered, and both of them are arithmetic: a computer
// and whether it is still there, a worker and what it is on. Arithmetic belongs
// where `scripts/test-machine.cjs` can run it without a phone, so there is no
// React, no store and no palette in this file.
//
// Two rules run through both pages, and they are the Dashboard's own
// (`src/dashboard.ts`):
//
//   * **a figure with no source is not drawn.** A machine that has never
//     answered has no last contact and no running count, and says that rather
//     than printing `0` — a measurement nobody made.
//   * **a state is a word before it is a colour.** Every row carries the
//     sentence as well as the tone, so both pages are readable in grey.
import { clock, type Ago, type Said } from './dashboard';
import { outOfQuota, spent, waiting, type DivanView, type HostView, type MergedAgent,
         type MergedCard } from './divan';
import type { Key } from './i18n';
import { executorFace, executorKey } from './waiting';
import type { State, Tone } from './tokens';

/** A line that is sometimes the string table's and sometimes the machine's own.
 *  A worker's name is `Coder` where the vocabulary has a word for it and the
 *  branch's own name where only the branch says what it is; what it is doing is
 *  a card's title, which nothing here may translate. The same pair the branch
 *  page uses for its status line (`src/branch.ts`). */
export interface Words {
  said: Said | null;
  text: string;
}

const key = (k: Key, params?: Record<string, string | number>): Words => ({ said: { key: k, params }, text: '' });
const plain = (text: string): Words => ({ said: null, text });

// ── 1 · Machines (Mobile11 S15) ─────────────────────────────────────────────

/** Under this much of a window left, the fleet's quota is said in amber. The
 *  frame's own `warn at 20%` — a threshold on the desktop panel, where there is
 *  a screen to change it on; on the phone it is the design's number and there
 *  is nothing to set. */
export const WARN_AT = 0.2;

/** What a machine's card offers. The frame draws `Terminal` and `Screen` on a
 *  computer that answered and `Try again` beside a greyed `Terminal` on one
 *  that did not. There is no terminal on this phone — that page is the desktop
 *  panel's — so what is left is the one page about one computer that the app
 *  does have, and asking the silent one again. Removing is the frame's own
 *  long-press, and pairing is the head's `+ Pair`. */
export type MachineAction = 'screen' | 'retry';

/** One mono figure under a machine's head: `12s ago` over `last contact`. */
export interface Figure {
  value: Words;
  label: Key;
  /** Amber on the last contact of a machine that has stopped answering — the
   *  one number on this page that is the reason for reading it. */
  tone?: Tone;
}

/** One computer, as its card reads it. */
export interface MachineLine {
  id: string;
  /** The name it calls itself, in mono. */
  machine: string;
  /** What sort of computer it is. Empty where it has never said. */
  detail: string;
  state: State;
  /** `reachable`, `unreachable`, `never answered`. */
  says: Key;
  tone: Tone;
  /** The card is ringed in amber while a machine that used to answer does not
   *  (Mobile11 S15 draws `mini` that way). */
  ring: 'amber' | 'line';
  figures: Figure[];
  actions: MachineAction[];
  /** HANDOVER §4.9: what it is running by name, and on a machine that has gone
   *  quiet what it was running and that this may no longer be true. */
  line: Words[];
  /** `seen just now`, `last seen 3h ago`, `never seen`. */
  seen: Words;
}

export function machineLines(view: DivanView, ago: Ago): MachineLine[] {
  return view.hosts.map((h) => ({
    id: h.id,
    machine: h.machine,
    detail: [h.os, h.error].filter(Boolean).join(' · '),
    state: h.reachable ? 'running' : h.missing ? 'quiet' : 'stuck',
    says: h.reachable ? 'maOnline' : h.missing ? 'maNever' : 'maUnreachable',
    // Unreachable is red, as a word (HANDOVER §2): never a fill.
    tone: h.reachable ? 'run' : h.missing ? 'ink3' : 'red',
    ring: 'line',
    figures: figures(h, ago),
    actions: h.reachable ? ['screen'] : ['retry'],
    line: runningLine(view, h),
    seen: seenWords(h, ago),
  }));
}

/** What a machine runs, by the titles of the work on it. */
function runningLine(view: DivanView, h: HostView): Words[] {
  const titles = view.agents.filter((a) => a.host === h.id).map((a) => a.title).filter(Boolean);
  const list = { n: titles.length, list: titles.join(', ') };
  if (h.reachable) return [titles.length ? key('maRunningList', list) : key('maNothingRunning')];
  if (h.missing) return [key('maNeverSaid')];
  return [titles.length ? key('maWasRunning', list) : key('maNothingWas'), key('maStale')];
}

function seenWords(h: HostView, ago: Ago): Words {
  if (h.age == null) return key('maNeverSeen');
  const when = h.age < 60 ? 'just now' : `${ago(h.age)} ago`;
  return key(h.reachable ? 'maSeen' : 'maLastSeen', { d: when });
}

/** The one sentence under the Machines title: how many answer, and whether
 *  there is quota to start work on. Nothing about quota where none was read. */
export function fleetLine(view: DivanView): Words[] {
  const n = view.hosts.length;
  const up = view.hosts.filter((h) => h.reachable).length;
  const head = up === n ? (n === 1 ? key('maOneUp') : key('maAllUp', { n })) : key('maSomeUp', { up, n });
  const q = view.quota;
  if (q.unknown || (q.left == null && !q.spent)) return [head];
  return [head, q.spent ? key('maOut') : (q.left ?? 0) <= WARN_AT ? key('maThin') : key('maEnough')];
}

/** The two numbers under the head, and neither of them is invented. A machine
 *  that has never answered has nothing to put in either slot — no moment to age
 *  and no count to carry — and its card is the head and the buttons. */
function figures(h: HostView, ago: Ago): Figure[] {
  if (h.missing) return [];
  return [
    { value: key('maAgo', { d: ago(h.age) }), label: 'maLastContact',
      ...(h.reachable ? {} : { tone: 'amber' as Tone }) },
    { value: running(h), label: 'maRunning' },
  ];
}

/** What it is running, and whether that is still true. A machine that has gone
 *  quiet was running something when it was last heard and nobody can say what it
 *  is doing now — the frame's `1 task · unknown`. */
function running(h: HostView): Words {
  if (!h.reachable) return h.running === 1 ? key('maOneTaskUnknown') : key('maUnknownTasks', { n: h.running });
  if (!h.running) return key('maIdleTasks');
  return key(h.running === 1 ? 'maOneTask' : 'maTasks', { n: h.running });
}

/** The block over the machines: what the fleet has left to start an agent on.
 *
 *  Quota belongs to the account rather than to a computer, which is why the
 *  frame puts it above the cards rather than in one. Null where nothing has
 *  ever measured a window — the page then has no such block, because an empty
 *  track is a figure nobody read. */
export interface QuotaBlock {
  /** `64% left`, `none left`. */
  says: Said;
  /** How much of the track is filled, 0 to 1. */
  left: number;
  tone: Tone;
  /** `resets 04:00 · in 4h 44m`, and nothing where no window said when. */
  foot: Said | null;
}

export function quotaBlock(view: DivanView, ago: Ago): QuotaBlock | null {
  const q = view.quota;
  if (q.unknown || (q.left == null && !q.spent)) return null;
  const left = q.spent ? 0 : q.left ?? 0;
  return {
    says: q.spent ? { key: 'maQuotaNone' } : { key: 'maQuotaLeft', params: { p: Math.round(left * 100) } },
    left,
    tone: q.spent ? 'red' : left <= WARN_AT ? 'amber' : 'ink2',
    foot: q.resets_at == null ? null
      : { key: 'maResets', params: { time: clock(q.resets_at), d: ago(Math.max(0, q.resets_at - view.now)) } },
  };
}

// ── 2 · Executors (Mobile11 S14) ────────────────────────────────────────────

/** The three, and the frame's own note says there are only three: "the state is
 *  always one of busy, idle or unavailable". Everything a worker could be —
 *  stopped because a window closed, on a machine that went quiet, waiting for a
 *  person — is one of them, and the line under the name says which of those it
 *  was. */
export type ExecutorState = 'busy' | 'idle' | 'unavailable';

/** One worker, running or not. */
export interface ExecutorLine {
  key: string;
  /** The square the design system draws it with (`tokens.EXECUTORS`). */
  face: string;
  /** Who it is. */
  who: Words;
  /** Which computer it is on, or "no machine" for the one that is on none. */
  machine: Words;
  /** What it is on right now, and why it is not where it is not. */
  doing: Words;
  state: ExecutorState;
  /** The chip at the end, which is the state in words — except on the one row
   *  that is a person, where it is how much is waiting on him. */
  says: Said;
  tone: Tone;
  /** Drawn as a ring rather than a wash: the frame's `unavailable`. */
  ring: boolean;
}

/** A run of them under one heading, with what that kind of worker is for. The
 *  frame puts the sentence on the heading rather than on every row, which is
 *  what keeps a row one line long. */
export interface ExecutorGroup {
  /** Which run of the page this is, for the list that draws it. Not a string
   *  from the table: `title` is that. */
  key: string;
  title: Key;
  /** What that kind of worker is for. Null on the last group, whose members are
   *  the house agent and a person and need no explaining — the frame leaves its
   *  note empty there too. */
  note: Key | null;
  rows: ExecutorLine[];
}

/** Worst first inside a group: what cannot work, then what is working, then
 *  what is free. A worker on a machine that has gone quiet is the one fact on
 *  this page that wants a person. */
const RANK: Record<ExecutorState, number> = { unavailable: 0, busy: 1, idle: 2 };

export function executorGroups(view: DivanView): ExecutorGroup[] {
  // Nothing paired is nobody, and that includes the one worker who is on no
  // machine: his work is the cards a person has to move, and there are no
  // boards for them to be on yet. An empty list here is what lets the page and
  // the drawer's own count say the same thing about that phone.
  if (view.hosts.length === 0) return [];
  const stopped = spent(view);
  const coders: ExecutorLine[] = [];
  const branches: ExecutorLine[] = [];
  const house: ExecutorLine[] = [];

  // What a branch is called, where its product's own answer says. A branch
  // agent is named by its branch, and the branch's display name is the one the
  // branch page shows — the kind (`seo`) is how the merge folds it, not what
  // anybody calls it.
  const named = new Map<string, string>();
  for (const p of view.projects) for (const b of p.branches) named.set(`${p.key}:${b.kind}`, b.name);

  for (const a of view.agents) {
    const row = agentLine(a, stopped.has(a.host), named.get(`${a.projectKey}:${(a.branch || '').trim()}`));
    if (a.executor === 'branch_agent') branches.push(row);
    else if (a.executor === 'coding_agent') coders.push(row);
    else house.push(row);
  }

  // A machine with nothing running on it is a machine that could take the next
  // ticket, which is what the frame's idle Coder says. One that is out of quota
  // or has stopped answering cannot, and says that instead of being left out.
  // A machine that has never answered at all is in neither list: nothing is
  // known about what it could run.
  const busy = new Set(view.agents.map((a) => a.host));
  for (const h of view.hosts) {
    if (busy.has(h.id) || h.missing) continue;
    coders.push(freeLine(h));
  }

  const mine = view.cards.filter((c) => c.executor === 'human' && waiting(c));
  const assistants = house.length > 0;
  house.push(youLine(mine));

  const all: ExecutorGroup[] = [
    { key: 'coders', title: 'exgCoders', note: 'exgCodersNote', rows: coders },
    { key: 'branch', title: 'exgBranch', note: 'exgBranchNote', rows: branches },
    { key: 'house', title: assistants ? 'exgHouse' : 'exgYou', note: null, rows: house },
  ];
  for (const g of all) g.rows.sort((a, b) => RANK[a.state] - RANK[b.state]);
  return all.filter((g) => g.rows.length > 0);
}

/** A worker that was running when its machine was last heard from. */
function agentLine(a: MergedAgent, paused: boolean, branchName?: string): ExecutorLine {
  const branch = branchName || (a.branch || '').trim();
  const state: ExecutorState = a.unknown || paused ? 'unavailable' : 'busy';
  return {
    key: `${a.host}:${a.card_id}`,
    face: executorFace(a),
    // A branch agent is named by its branch — that is what it is — the same way
    // a card names the worker on it (`src/waiting.ts`).
    who: a.executor === 'branch_agent' && branch ? plain(branch) : key(executorKey(a.executor)),
    machine: plain(a.machine),
    doing: a.unknown ? key('exSilent', { what: a.title, machine: a.machine })
      : paused ? key('exNoQuota', { what: a.title })
      : plain([a.title, (a.detail || '').trim()].filter(Boolean).join(' · ')),
    state,
    says: { key: state === 'busy' ? 'exBusy' : 'exUnavailable' },
    tone: state === 'busy' ? 'run' : 'red',
    ring: state === 'unavailable',
  };
}

/** A computer with no worker on it: the next ticket's, or nobody's. */
function freeLine(h: HostView): ExecutorLine {
  const free = h.reachable && !outOfQuota(h);
  return {
    key: `${h.id}:free`,
    face: 'coder',
    who: key(executorKey('coding_agent')),
    machine: plain(h.machine),
    doing: key(free ? 'exNothing' : h.reachable ? 'exNoQuotaBare' : 'exMachineSilent'),
    state: free ? 'idle' : 'unavailable',
    says: { key: free ? 'exIdle' : 'exUnavailable' },
    tone: free ? 'ink3' : 'red',
    ring: !free,
  };
}

/** …and the one worker that is on no machine. His work is every card a person
 *  has to move, which is the count the Dashboard calls "needs you", and his
 *  state is how much of it there is — the frame's own exception, and the reason
 *  it is stated there and not left to be read off a colour. */
function youLine(mine: MergedCard[]): ExecutorLine {
  const n = mine.length;
  return {
    key: 'you',
    face: 'you',
    who: key(executorKey('human')),
    machine: key('exNoMachine'),
    doing: n ? plain(mine.slice(0, 2).map((c) => c.title).join(' · ')
                     + (n > 2 ? ` · +${n - 2}` : ''))
             : key('exNothingWaiting'),
    state: n ? 'busy' : 'idle',
    says: n ? { key: 'exNWaiting', params: { n } } : { key: 'exIdle' },
    tone: n ? 'amber' : 'ink3',
    ring: false,
  };
}

/** How many workers the drawer's own row counts (Mobile11 S16's summary line).
 *  The same list the page is, so the number and the page cannot disagree. */
export function executorCount(view: DivanView): number {
  return executorGroups(view).reduce((n, g) => n + g.rows.length, 0);
}
