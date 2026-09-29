// One card, opened — decided away from the screen that draws it. No React, no
// store, no palette: `scripts/test-card.cjs` holds the screen to every judgement
// in here without a phone.
//
// A card has three faces and they are written for three different readers
// (Mobile4 T1, T2, T3):
//
//   * **the human face** is what the card is: a title, two or three sentences,
//     who is on it and on which computer, when it was made and what has happened
//     to it. It is the one that opens, and it is the one rule this file exists
//     to keep — **no text an agent produced is on it**. Not the brief, which
//     Divan usually drafts; not the worker's own words; not a verdict. Those are
//     each a face of their own, one tap away. A person opening a card at seven in
//     the morning is reading their own writing, and a page that mixes the two is
//     a page nobody can trust the first sentence of.
//   * **the agent face** is the brief, as the machine gets it: the goal, what
//     done means, the commands that settle it, what it may not touch, the files.
//     Monospace, as long as it needs to be, and the criteria double as progress
//     because the verifier answers them one by one.
//   * **the live face** is the run as it is being written: one line per step,
//     and one line a person can say into it while it works.
//
// Two facts about several computers travel through all of it. A card says which
// machine it runs on, because the work is there and not on whichever computer
// this phone holds a socket to — and a sentence said on the live face goes to
// *that* machine's queue (`saying`). And a machine that has gone quiet does not
// empty the page: the human face is read off the merged view, which keeps a
// silent machine's last answer, so only the two faces that need the machine
// itself say it is not answering.
import { column, type DivanView, type MergedCard, type MergedProject } from './divan';
import { executorKey, type Ago, type Said } from './dashboard';
import { executorFace } from './waiting';
import { mark, type Mark } from './board';
import { marks } from './tickets';
import { LOCALE, type Key } from './i18n';
import type { DivanBrief, DivanCardDetail, DivanColumn, Ticket } from './protocol';
import { attach, silence as silenceOf, trim, turns, type RunSilence, type Turn } from './transcript';
import type { Tone } from './tokens';

/** The three faces, left to right (Mobile4 T1, T2, T3). */
export type Face = 'human' | 'agent' | 'live';

export const FACES: Face[] = ['human', 'agent', 'live'];

export const FACE_LABEL: Record<Face, Key> = {
  human: 'caHuman', agent: 'caAgent', live: 'caLive',
};

/** Which face a card opens on. The human one, always: the brief is written for a
 *  machine and the run is a river, and neither is what somebody who has just
 *  tapped a card is asking about. */
export const OPENS_ON: Face = 'human';

/** The card being read, out of the merged view. By its own id and the machine it
 *  came from, because two computers number their own rows and a card id is only
 *  unique on the machine that wrote it.
 *
 *  The view rather than a request: a card whose machine has gone quiet is still
 *  in it, as it was when that machine last answered, which is the whole reason
 *  the human face can be drawn about an unreachable computer. */
export function find(view: DivanView, id: string, host?: string | null): MergedCard | null {
  const wanted = (id || '').trim();
  if (!wanted) return null;
  return view.cards.find((c) => c.id === wanted && (!host || c.host === host))
    ?? view.cards.find((c) => c.id === wanted)
    ?? null;
}

/** The head every face wears, so that the context never changes between them
 *  (Mobile4 T1-T3, which draw the same seven lines over all three). */
export interface Head {
  /** The breadcrumb: the product, the branch it is work on, and the card's own
   *  key. */
  project: string;
  branch: string;
  /** `#142` where the queue has it, and the card's own short id where it does
   *  not. The frames write `QUI-142`; nothing on the wire issues a key like
   *  that, and a made-up one would be a key that finds nothing anywhere else. */
  key: string;
  title: string;
  column: DivanColumn;
  columnLabel: Key;
  /** What is actually happening to it — the board's own chip, so a card reads
   *  the same in the column and on its own page. */
  mark: Mark | null;
  /** …and how far the verifier has got through the criteria, where it has said
   *  anything at all. */
  progress: { met: number; of: number } | null;
  /** Where it sits in its column, as the frame writes it: `#3 in column`. */
  place: number | null;
  of: number;
  /** The computer the work is on, and when that computer last answered where it
   *  has gone quiet. Never null: which machine a card runs on is part of the
   *  card, on a board that is several computers at once. */
  machine: { name: string; seen: number | null };
}

export function head(view: DivanView, card: MergedCard, project: MergedProject | null,
                     ticket: Ticket | null, ago: Ago): Head {
  const list = project ? column(project, card.column) : [];
  const at = list.findIndex((c) => c.id === card.id && c.host === card.host);
  const branch = project?.branches.find((b) => b.kind === card.branch);
  const seen = view.hosts.find((h) => h.id === card.host);
  return {
    project: project?.name || '',
    branch: branch?.name || card.branch || '',
    key: card.ustabasi_id != null ? `#${card.ustabasi_id}` : short(card.id),
    title: card.title,
    column: card.column,
    columnLabel: COLUMN_KEY[card.column],
    mark: mark(card, view.now, ago),
    progress: progress(ticket),
    place: at < 0 ? null : at + 1,
    of: list.length,
    machine: { name: card.machine, seen: card.stale ? seen?.at ?? null : null },
  };
}

/** What each column is called. The board's own words (`src/board.ts`), read
 *  through a table of this file's own so that the head does not have to import a
 *  board to name one column. */
const COLUMN_KEY: Record<DivanColumn, Key> = {
  ice_box: 'bdIceBox', queued: 'bdQueued', in_progress: 'bdInProgress', done: 'bdDone',
};

/** A card's own id, cut to the eight characters that identify it. What the
 *  breadcrumb wears where the queue has no number for it. */
function short(id: string): string {
  return (id || '').trim().slice(0, 8);
}

/** How much of the brief the verifier has answered. Null where nothing has been
 *  judged — a ticket nobody has verified yet is not "0 of 5 done", it is a
 *  ticket nobody has verified yet. */
export function progress(ticket: Ticket | null | undefined): { met: number; of: number } | null {
  const criteria = ticket?.done_criteria ?? [];
  if (!criteria.length) return null;
  const judged = marks(criteria, ticket?.verdict);
  if (!judged.some(Boolean)) return null;
  return { met: judged.filter((m) => m?.met).length, of: criteria.length };
}

/** The three tabs. The brief's own size is on the agent one — the frame's `46`,
 *  which is the only honest reading of it: how many lines the machine is being
 *  handed. Null where there is no brief to count, and the tab is then a word. */
export function tabs(brief: DivanBrief | null | undefined, running: boolean):
    { key: Face; label: Key; count: number | null; live: boolean }[] {
  const n = brief ? lines(brief) : null;
  return FACES.map((face) => ({
    key: face,
    label: FACE_LABEL[face],
    count: face === 'agent' ? (n || null) : null,
    live: face === 'live' && running,
  }));
}

/** How many lines the brief is. */
function lines(b: DivanBrief): number {
  return split(b.goal).length + b.done_criteria.length + split(b.verify_cmd).length
    + b.constraints.length + b.paths.length + split(b.notes).length;
}

function split(text: string | null | undefined): string[] {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

// ── the human face ──────────────────────────────────────────────────────────

/** One row of the list under the card's own sentences (Mobile4 T1's Jira-like
 *  block: a 96 pt label and the value beside it).
 *
 *  The frame has two more rows this does not: `Created by · Divan · from your
 *  chat`, and `by Coder` after the update. Nothing on the wire records who wrote
 *  a card or who touched it last, and a guessed author on the one face that is
 *  supposed to be a person's own writing is the worst place in the app to invent
 *  something. */
export interface Detail {
  key: 'executor' | 'created' | 'updated' | 'branch' | 'brief';
  label: Key;
  /** A plain value: a date, a branch's name. */
  text?: string;
  /** …or several sentences to be joined: the brief, counted. */
  parts?: Said[];
  /** …or the executor, which is a face, a name and a computer. */
  who?: { face: string; name: Key; machine: { name: string; seen: number | null } };
}

export function details(view: DivanView, card: MergedCard, project: MergedProject | null,
                        brief: DivanBrief | null | undefined, ago: Ago): Detail[] {
  const seen = view.hosts.find((h) => h.id === card.host);
  const branch = project?.branches.find((b) => b.kind === card.branch);
  const out: Detail[] = [{
    key: 'executor', label: 'caExecutor',
    who: { face: executorFace(card), name: executorKey(card.executor),
           machine: { name: card.machine, seen: card.stale ? seen?.at ?? null : null } },
  }];
  if (card.created_at) out.push({ key: 'created', label: 'caCreated', text: stamp(card.created_at) });
  if (card.updated_at) {
    out.push({ key: 'updated', label: 'caUpdated',
               text: ago(Math.max(0, view.now - card.updated_at)) });
  }
  const name = branch?.name || card.branch;
  if (name) out.push({ key: 'branch', label: 'caBranch', text: name });
  // The brief, as its own size and nothing of its content — this row is the
  // whole of the agent face that is allowed on this one.
  if (brief) {
    const parts: Said[] = [];
    const count = (n: number, one: Key, many: Key) => (n === 1 ? { key: one } : { key: many, params: { n } });
    if (brief.done_criteria.length) parts.push(count(brief.done_criteria.length, 'caOneCriterion', 'caCriteria'));
    if (split(brief.verify_cmd).length) parts.push(count(split(brief.verify_cmd).length, 'caOneCommand', 'caCommands'));
    if (brief.paths.length) parts.push(count(brief.paths.length, 'caOneFile', 'caFiles'));
    out.push({ key: 'brief', label: 'caBrief',
               parts: parts.length ? parts : [{ key: 'caBriefBare' }] });
  }
  return out;
}

/** `26 Sep, 21:40` — the frame's own stamp for a moment that is not today's. */
export function stamp(at: number | null | undefined, locale = LOCALE): string {
  if (at == null || !Number.isFinite(at)) return '';
  const d = new Date(at * 1000);
  const day = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** One line of the activity trail (Mobile4 T1: three lines, a time and a
 *  sentence). */
export interface Moment {
  at: number;
  said: Said;
  /** The executor named in it, to be put into the reader's language first — the
   *  same two-step every other sentence in this app takes. */
  who?: Key;
}

/** What has happened to this card, newest first.
 *
 *  Three things are recorded about a card and each is one line: when it was
 *  made, when a person last moved it, and when what is running on it last
 *  changed. Nothing else is on the wire — there is no event log for a card — and
 *  none of these is a sentence anybody wrote, which is what keeps this list on
 *  the human face.
 *
 *  The move is drawn only where a card has actually been moved: a new card is
 *  stamped as moved the moment it is created (`divan.py create_card`), and
 *  "you moved it to Ice Box" about a card nobody has touched would be a line
 *  about nothing. */
export function trail(card: MergedCard): Moment[] {
  const out: Moment[] = [];
  if (card.agent_status && card.agent_status_at) {
    const said = STATUS_MOMENT[card.agent_status];
    if (said) {
      out.push({ at: card.agent_status_at, who: executorKey(card.executor),
                 said: { key: said, params: { machine: card.machine } } });
    }
  }
  if (card.moved_at && card.moved_at - (card.created_at || 0) > 1) {
    out.push({ at: card.moved_at, said: { key: 'caMoved', params: { col: COLUMN_KEY[card.column] } } });
  }
  if (card.created_at) out.push({ at: card.created_at, said: { key: 'caMade' } });
  return out.sort((a, b) => b.at - a.at);
}

/** What the last change of state was, as a thing that happened rather than as a
 *  state. `queued` is not one: a card waiting its turn has had nothing happen to
 *  it yet. */
const STATUS_MOMENT: Record<string, Key | null> = {
  queued: null,
  running: 'caPickedUp',
  asking: 'caAsked',
  blocked: 'caStopped',
  failed: 'caFell',
  verified: 'caPassed',
  cancelled: 'caCancelled',
};

// ── the agent face ──────────────────────────────────────────────────────────

/** One block of the brief (Mobile4 T2: a mono label in `ink3` over the block
 *  itself). */
export interface Section {
  key: 'goal' | 'done' | 'test' | 'constraints' | 'files' | 'notes';
  label: Key;
  /** The block's lines: one for a paragraph, several for a list. */
  lines: string[];
  /** How they are drawn: as prose, as a list, or as a block of commands. */
  kind: 'prose' | 'list' | 'code';
  /** For the criteria: what the verifier made of each, null where it said
   *  nothing about that one (`src/tickets.ts marks`). */
  met?: (boolean | null)[];
  /** `3 / 5` after the label, where the block can be counted. */
  count?: string;
}

/** The brief, block by block. A block nobody filled in is left out rather than
 *  drawn empty: a card written down in a sentence and dragged into In Progress
 *  has a goal and nothing else, and five empty headings would say it was
 *  incomplete when it is simply short. */
export function sections(brief: DivanBrief | null | undefined,
                         ticket: Ticket | null | undefined): Section[] {
  if (!brief) return [];
  const out: Section[] = [];
  if (brief.goal.trim()) out.push({ key: 'goal', label: 'caGoal', kind: 'prose', lines: [brief.goal.trim()] });
  if (brief.done_criteria.length) {
    const judged = marks(brief.done_criteria, ticket?.verdict);
    const done = progress(ticket && { ...ticket, done_criteria: brief.done_criteria } as Ticket);
    out.push({ key: 'done', label: 'caDoneWhen', kind: 'list', lines: brief.done_criteria,
               met: judged.map((m) => (m ? m.met : null)),
               ...(done ? { count: `${done.met} / ${done.of}` } : {}) });
  }
  const commands = split(brief.verify_cmd);
  if (commands.length) out.push({ key: 'test', label: 'caTest', kind: 'code', lines: commands });
  if (brief.constraints.length) {
    out.push({ key: 'constraints', label: 'caConstraints', kind: 'list', lines: brief.constraints });
  }
  if (brief.paths.length) out.push({ key: 'files', label: 'caFiles2', kind: 'list', lines: brief.paths });
  if (brief.notes.trim()) out.push({ key: 'notes', label: 'caNotes', kind: 'prose', lines: [brief.notes.trim()] });
  return out;
}

/** Every string on this card that an agent may have written.
 *
 *  The brief is in it whole, because nothing on the wire records who drafted one
 *  and Divan usually did; so is what the worker printed, what it stopped to ask,
 *  and every line of a verdict. It exists for one reason: the check that the
 *  human face carries none of it (`scripts/test-card.cjs`) needs the list to be
 *  a fact about this file rather than a list somebody remembered to keep up to
 *  date. */
export function agentWords(detail: DivanCardDetail | null | undefined, turns: Turn[] = []): string[] {
  const brief = detail?.card.agent;
  const ticket = detail?.ticket;
  const out = [
    ...(brief ? [brief.goal, brief.verify_cmd, brief.notes,
                 ...brief.done_criteria, ...brief.constraints, ...brief.paths] : []),
    detail?.card.agent_detail ?? '',
    ticket?.escalation ?? '',
    ...(ticket?.verdict?.findings ?? []).flatMap((f) => [f.criterion, f.detail ?? '']),
    ...(ticket?.notes ?? []).map((n) => n.text ?? ''),
    ...turns.map((t) => (t.kind === 'say' || t.kind === 'thought' ? t.text
      : t.kind === 'did' ? `${t.tool} ${t.summary}` : '')),
  ];
  return out.map((s) => (s || '').trim()).filter(Boolean);
}

// ── the live face ───────────────────────────────────────────────────────────

/** A card being read, and everything the machine it is on has said about it.
 *
 *  It is kept in the store rather than in the screen, for the reason a board is:
 *  a page of a run arrives while somebody is reading it, and a screen that held
 *  it would lose the whole log — and every sentence said into it — the moment
 *  the reader stepped off the page and came back. One card, because one is open
 *  at a time.
 *
 *  `cursor` and `numbered` are the bookkeeping of reading a file a page at a
 *  time: where to carry on from, and where the turn numbering got to (which is
 *  not how many turns are on screen — `src/transcript.ts turns` says why). */
export interface Open {
  id: string;
  host: string;
  /** Both faces and the ticket, as that machine last answered. Null until it
   *  has answered at all. */
  detail: DivanCardDetail | null;
  turns: Turn[];
  /** When this phone first saw each turn, by turn id. Empty for the page that
   *  was already in the file when the card was opened. */
  stamps: Record<string, number>;
  /** What has been said into the run from here, and where in the log. */
  said: Say[];
  /** The run is still being written. */
  live: boolean;
  silence: RunSilence;
  /** The last ask failed, in words. Beside the answer rather than instead of
   *  it: a brief eight seconds stale beats an error where a brief was. */
  error: string | null;
  /** Nothing has come back yet. */
  loading: boolean;
  /** The reader had fallen more than a page behind and was moved to the end. */
  jumped: boolean;
  cursor: string | null;
  numbered: number;
}

/** A card just opened: nothing read yet. */
export function opening(id: string, host: string): Open {
  return { id, host, detail: null, turns: [], stamps: {}, said: [], live: false,
           silence: null, error: null, loading: true, jumped: false, cursor: null, numbered: 0 };
}

/** …and what it becomes when the machine answers.
 *
 *  The page of the run is folded in the way the ticket chat folds one: appended
 *  to what is on screen, or replacing it where the page is not continuous with
 *  the last one, and trimmed from the front so that a three-hour run stays
 *  cheap. `at` is this phone's clock, and it stamps the turns that arrived with
 *  this page — never the first one, which is a file nobody was watching being
 *  written. */
export function took(prev: Open, got: DivanCardDetail, at: number): Open {
  const page = got.run;
  // No ticket on the card is not a silent queue: there is nothing running on it
  // and nothing to read, which is what `never_run` says.
  const quiet: RunSilence = page ? (page.available ? silenceOf(page.reason) : 'noQueue') : 'neverRun';
  if (!page) {
    return { ...prev, detail: got, live: false, silence: quiet, error: null, loading: false };
  }
  const fresh = !!page.reset;
  const from = fresh ? 0 : prev.numbered;
  const { turns: more, answers, next } = turns(page.events || [], from);
  const stamped = prev.loading || !more.length ? prev.stamps
    : { ...prev.stamps, ...Object.fromEntries(more.map((t) => [t.id, at])) };
  return {
    ...prev,
    detail: got,
    turns: trim(attach([...(fresh ? [] : prev.turns), ...more], answers)),
    stamps: fresh ? {} : stamped,
    live: !!page.live,
    silence: quiet,
    error: null,
    loading: false,
    jumped: fresh && !prev.loading,
    cursor: page.cursor,
    numbered: next,
  };
}

/** …and when it does not answer: exactly what it was, plus the reason. Only a
 *  card nothing has ever been read about says the silence out loud; everything
 *  else keeps what it had, with a line saying the machine is not answering. */
export function missed(prev: Open, error: string | null, old: boolean): Open {
  return {
    ...prev,
    error: error ?? '',
    loading: false,
    silence: prev.loading ? (old ? 'oldHost' : 'offline') : prev.silence,
  };
}

/** A sentence said into a running worker from this screen: what it was, when it
 *  was said, and how much of the run was on screen at the time.
 *
 *  `after` is what puts it back where it happened. The run's own log carries no
 *  clock — it is a stream of blocks — so a sentence's place in it is not
 *  something that can be worked out later; it is something the screen knows at
 *  the moment the send button is pressed, and this is where it is kept. */
export interface Say {
  id: string;
  at: number;
  text: string;
  after: number;
}

/** One line of the live face (Mobile4 T3: a time, and what happened). */
export interface LiveLine {
  id: string;
  /** When the phone saw it. Null for everything that was already in the log when
   *  the screen opened: the run's file has no clock in it, and a time for a line
   *  that was written before anybody looked would be invented. */
  at: number | null;
  /** What to draw, where the words are the run's own. */
  text?: string;
  /** …or a sentence in the reader's language: the person's own line, the one
   *  being written right now, and the run's last line. */
  said?: Said;
  tone: Tone | null;
  /** The step the worker is on, washed in its colour with the cursor after it. */
  now?: boolean;
  /** The person's own sentence. */
  mine?: boolean;
}

/** The run as one line per step, with whatever has been said into it in its
 *  place.
 *
 *  Every turn is a line: what it said, what it thought, every tool it called —
 *  the same reading the ticket chat draws, cut to one line each, because the
 *  question this face answers is "what is it doing", not "what did it write".
 *  A call that failed is red. While the run is live the last line is the step it
 *  is on and is drawn as such.
 *
 *  `stamps` is when this phone first saw a turn, by turn id, and is empty for
 *  the page that was already in the file when the screen opened. */
export function live(turns: Turn[], said: Say[], stamps: Record<string, number>,
                     running: boolean): LiveLine[] {
  const out: LiveLine[] = [];
  const at = (id: string) => (stamps[id] == null ? null : stamps[id]);
  const sentences = [...said].sort((a, b) => a.after - b.after || a.at - b.at);
  const upto = (n: number) => {
    while (sentences.length && Math.min(sentences[0].after, turns.length) <= n) {
      const s = sentences.shift()!;
      out.push({ id: s.id, at: s.at, said: { key: 'caYouSaid', params: { text: s.text } },
                 tone: 'amber', mine: true });
    }
  };
  upto(0);
  turns.forEach((turn, i) => {
    const last = running && i === turns.length - 1;
    out.push({ ...step(turn, last), at: at(turn.id) });
    upto(i + 1);
  });
  upto(turns.length);
  return out;
}

/** One turn as one line. */
function step(turn: Turn, now: boolean): LiveLine {
  if (turn.kind === 'ended') {
    return { id: turn.id, at: null, tone: turn.failed ? 'red' : null,
             said: { key: turn.failed ? 'runEndedBadly' : 'runEnded' } };
  }
  const text = turn.kind === 'did'
    ? [turn.tool, turn.summary].filter(Boolean).join(' ')
    : flat(turn.text);
  if (now) return { id: turn.id, at: null, tone: 'run', now: true, said: { key: 'caNow', params: { text } } };
  return { id: turn.id, at: null, text,
           tone: turn.kind === 'did' && turn.failed ? 'red' : turn.kind === 'thought' ? 'ink3' : null };
}

/** A block of prose as one line. */
function flat(text: string): string {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
}

/** Why there is nothing to read on the live face, in the words of the thing that
 *  is missing. The key type is what keeps them honest: a renamed string is a
 *  compiler error here rather than a screen showing the name of a variable. */
export const SILENCE: Record<Exclude<RunSilence, null>, { title: Key; body: Key }> = {
  neverRun: { title: 'caLiveQuiet', body: 'caLiveQuietBody' },
  noLog: { title: 'runNoLog', body: 'runNoLogBody' },
  noTicket: { title: 'caGone', body: 'caGoneBody' },
  noQueue: { title: 'queueNone', body: 'runNoQueueBody' },
  oldHost: { title: 'runOldHost', body: 'runOldHostBody' },
  offline: { title: 'queueUnreachable', body: 'hintOffline' },
};

/** Where a sentence said on this screen goes: to the queue that is running the
 *  card, on the machine the card is on — which is not necessarily the computer
 *  this phone holds a socket to (`store.answerCard`).
 *
 *  Null where there is nothing running to say it to: a card with no ticket in
 *  any queue has nobody to read a sentence, and the box is not offered. */
export function saying(card: MergedCard): { ticket: number; host: string } | null {
  return card.ustabasi_id == null ? null : { ticket: card.ustabasi_id, host: card.host };
}
