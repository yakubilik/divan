// What one branch's page says, decided away from the screen that draws it.
//
// A branch is a face of a product — engineering, seo, analytics, marketing,
// customers, and whatever else somebody named — and the design gives all of
// them **one page** (Mobile9 S10 and S11). S10 is SEO and is the layout; S11 is
// Engineering, which has three more blocks in the middle of that same layout and
// is not a second screen. The frame's own note is explicit about it: "the layout
// doesn't depend on them: without them it's the SEO page."
//
// So this module answers the same six questions for every branch — what it is,
// how it is, its numbers, its numbers over time, what its agent did, and which
// cards belong to it — and one more for the branch that owns the code.
//
// The two rules the Dashboard and the project page are written under hold here
// and decide most of the file:
//
//   * **no invented figures.** The frames put a branch's own measurements on
//     this page (`6,412 clicks 28d`, `11.3 avg position`, `212/214 tests`,
//     `v3.18 deployed`) and a thirty-day chart under them. What is drawn is what
//     something actually measured: the board's own counts, what git says about
//     the product's repositories, what the code host says is open on them and
//     how the checks on that stand, and the mirror's own words about what ran.
//     A branch's own daily figures still have no source — the plan puts them
//     after the screens — and the chart's place *says so* rather than being
//     quietly left out: a page that dropped its chart would not tell anybody why
//     there is no chart.
//   * **a machine that has gone quiet is said out loud.** The cards of a branch
//     can come off two computers; when one stops answering, the page says which
//     and how old what is on it is (the project page's own `oldWords`).
//
// Nothing here touches React, the store or the palette, so
// `scripts/test-project.cjs` can hold the page to it without a phone.
import { COLUMNS, type DivanView, type MergedBranch, type MergedCard,
         type MergedProject } from './divan';
import { cards as columnCards, COLUMN_LABEL, mark, type Mark } from './board';
import { executorKey, latest, type Ago, type Said } from './dashboard';
import { branchState, figures, refreshed, when, type Figure } from './project';
import { executorFace } from './waiting';
import type { Key } from './i18n';
import type { DivanColumn, RepoActivity } from './protocol';
import type { State, Tone } from './tokens';

/** The branch that owns the code, which is the one the frames draw dense
 *  (Mobile9 S11). The kinds are an open set on the wire, and this is the one
 *  name the daemon creates for every product (`divan.py BRANCH_KINDS`). */
export const ENGINEERING = 'engineering';

/** How many lines of the log the page draws. The frames draw three (S10) and
 *  one (S11), which is what there was to draw; this is the ceiling, and it is
 *  what keeps a branch with forty cards from being a page of timestamps. */
export const LOG_ROWS = 6;

/** The order the cards of a branch are read in: what is happening, then what is
 *  next, then what is shelved, then what is finished. Not the board's own
 *  left-to-right, because this list is a reading rather than an arrangement —
 *  nothing is dragged here. */
export const TICKET_COLUMNS: DivanColumn[] = ['in_progress', 'queued', 'ice_box', 'done'];

/** A branch, and the product it is a face of. */
export interface Found {
  project: MergedProject;
  branch: MergedBranch;
}

/** The branch a page was opened for: a product, and one of its faces by kind.
 *
 *  By kind and not by id. Two computers are two databases and give the same
 *  branch two ids (`divan.ts mergeBranches` folds them by kind), so an id is not
 *  a name a link can be written with — the pair that survives the merge is the
 *  product's key and the branch's kind. */
export function find(view: DivanView, projectKey: string | null,
                     kind: string | null): Found | null {
  const key = (projectKey || '').trim().toLowerCase();
  const want = (kind || '').trim().toLowerCase();
  if (!key || !want) return null;
  const project = view.projects.find((p) => p.key === key || p.slug === key) ?? null;
  if (!project) return null;
  const branch = project.branches.find((b) => (b.kind || '').toLowerCase() === want) ?? null;
  return branch ? { project, branch } : null;
}

/** Is this the dense variant? The three extra blocks are Engineering's, and
 *  every other branch draws the page without them. */
export function dense(b: MergedBranch): boolean {
  return (b.kind || '').toLowerCase() === ENGINEERING;
}

/** The cards of this branch, wherever they are on the board.
 *
 *  Read through the board's own column rule rather than off `project.cards`, so
 *  that Done reaches back exactly as far here as it does there — a branch page
 *  must not be the one screen in the app with work finished last March on it. */
export function held(p: MergedProject, b: MergedBranch, now: number): MergedCard[] {
  return TICKET_COLUMNS.flatMap((col) => columnCards(p, col, now)
    .filter((c) => c.branch === b.kind));
}

// ── 1 · the head, and the line under it ─────────────────────────────────────

/** What a branch's page says it is: the dot in front of the name, when its
 *  source last spoke, and whether that is old enough to be worth saying in
 *  amber. The same three the branch's card on the project page carries, read by
 *  the same rules — the card and the page it opens cannot disagree. */
export function head(p: MergedProject, b: MergedBranch, now: number): {
  name: string;
  project: string;
  state: State;
  refreshed: { said: Said; tone: Tone | null } | null;
} {
  return {
    name: b.name || b.kind,
    project: p.name,
    state: branchState(p.cards.filter((c) => c.branch === b.kind)),
    refreshed: refreshed(b, now),
  };
}

/** The sentence under the name (S10's `Rewriting comparison pages, 9 of 14
 *  done…`): the branch's own summary where something wrote one, the worst
 *  card's own line where nothing did, and "no source connected yet" where there
 *  is neither.
 *
 *  Exactly the rule the branch card follows, and exactly the same two fields, so
 *  that opening a card cannot change what it said. `text` is somebody else's
 *  words and `said` is ours; never both. */
export function status(p: MergedProject, b: MergedBranch): { said: Said | null; text: string } {
  const wrote = (b.summary || '').trim();
  const mine = p.cards.filter((c) => c.branch === b.kind);
  const text = wrote || latest(mine);
  return text ? { said: null, text } : { said: { key: 'branchNoSource' as Key }, text: '' };
}

/** The three numbers, which are the board's own counts (`project.ts figures`):
 *  what is open on this branch, what is in progress, what is done. */
export function numbers(b: MergedBranch): Figure[] {
  return figures(b);
}

// ── 2 · a block whose source cannot answer ──────────────────────────────────

/** A block of this page that has a place in the layout and no source behind it
 *  yet: what it would say, and why it says nothing. */
export interface Gap {
  key: Key;
  body: Key;
}

/** The chart's place, which every branch on this page has (S10's `clicks per
 *  day · 30 days`, S11's `deploys per day · 30 days`) and nothing fills. A
 *  series over time needs a source that measures a branch daily; the board
 *  carries what is open now, and git carries a count for today and a count for
 *  the week, which is two points and not a month.
 *
 *  Said in the block's own place, and not left out. "No chart" and "no source
 *  for a chart" are different things to somebody reading the page for the first
 *  time, and only one of them is true. */
export const OVER_TIME: Gap = { key: 'bpOverTime', body: 'bpOverTimeBody' };

/** …and the same for Engineering's pull requests, on a product whose
 *  repositories nobody could be asked about: not a GitHub checkout, or a
 *  machine with no `gh` signed in.
 *
 *  It is the block's *unanswered* state and not its empty one. A repository with
 *  nothing open is an answer and is drawn as an empty list (`bpPullsNone`);
 *  this is the sentence for nobody having asked, and the two must not look the
 *  same on a page whose whole promise is that no figure on it is invented. */
export const PULLS: Gap = { key: 'bpPulls', body: 'bpPullsBody' };

// ── 3 · what the agent did, and when ────────────────────────────────────────

/** One line of the log: a clock, and what was said at it. */
export interface Moment {
  at: number;
  /** The worker it was, where the card names one. */
  who: Key | null;
  /** The mirror's own words — what the run last said about itself — and the
   *  card's title where it has said nothing. Never composed here. */
  text: string;
  /** Which computer it happened on, where the product is on more than one. */
  machine: string | null;
  /** …and that computer has since gone quiet, so this is the last thing it
   *  said rather than the last thing that happened. */
  stale: boolean;
  /** The card it happened on: which run this was, which is not the same
   *  question as which kind of worker (`logTitle`). */
  card: MergedCard;
}

/** The log (S10's `What the agent did`, S11's `What the agents did`).
 *
 *  Every card of the branch that has a stamp on it, newest first, cut at
 *  `LOG_ROWS`. The stamp is the moment the mirror last wrote a status to the
 *  card (`agent_status_at`) and the words are what it wrote with it — so this is
 *  a log of what actually happened, in the queue's own words, and not a
 *  narration assembled on this phone.
 *
 *  A card nothing has ever run on has no stamp and is not in it. That is why an
 *  empty log is a sentence on the page rather than an absence: a branch whose
 *  cards are all waiting for a person has nothing to log, and it is worth
 *  saying. */
export function log(view: DivanView, p: MergedProject, b: MergedBranch): Moment[] {
  const several = p.machines.length > 1;
  return p.cards
    .filter((c) => c.branch === b.kind && c.agent_status_at != null)
    .sort((x, y) => (y.agent_status_at ?? 0) - (x.agent_status_at ?? 0))
    .slice(0, LOG_ROWS)
    .map((c) => ({
      at: c.agent_status_at as number,
      who: c.executor === 'human' ? null : executorKey(c.executor),
      text: (c.agent_detail || '').trim() || c.title,
      machine: several ? c.machine || null : null,
      stale: c.stale,
      card: c,
    }));
}

/** …and what stands over it: `What the agent did`, or `did` in the plural.
 *
 *  Which of the two is the difference between the frames' own headings, and it
 *  is not a count of rows. S10 has three lines and says "the agent": they are
 *  three things one branch agent did. S11 has four Coders and says "the agents":
 *  a coding agent is started per card, so four cards there are four workers.
 *
 *  So it is a count of workers, and what a worker is depends on the executor: a
 *  branch agent is one for the whole branch, however many of its cards it has
 *  touched, and a coder is one per card. */
export function logTitle(list: Moment[]): Key {
  const workers = new Set(list.map((m) => (
    m.card.executor === 'coding_agent' ? `coder:${m.card.id}` : String(m.who))));
  return workers.size > 1 ? 'bpLogMany' : 'bpLog';
}

// ── 4 · the cards that belong to the branch ─────────────────────────────────

/** One of them, as everything the row draws. The same four facts the board's
 *  own card carries, read by the same rules (`src/board.ts`): a card is one
 *  thing on every screen in this app. */
export interface Row {
  card: MergedCard;
  face: string;
  who: Key;
  /** Which column it is in — the row's own second line, because this list is
   *  the whole board of one branch rather than one column of it. */
  column: Key;
  mark: Mark | null;
  machine: string | null;
}

/** The branch's cards, in reading order. */
export function tickets(view: DivanView, p: MergedProject, b: MergedBranch, ago: Ago): Row[] {
  const several = p.machines.length > 1;
  return held(p, b, view.now).map((card) => ({
    card,
    face: executorFace(card),
    who: executorKey(card.executor),
    column: COLUMN_LABEL[card.column],
    mark: mark(card, view.now, ago),
    machine: several && card.executor !== 'human' ? card.machine || null : null,
  }));
}

// ── 5 · Engineering's three extra blocks ────────────────────────────────────

/** A repository the product owns (S11's `quire-api`, `quire-web`).
 *
 *  A product's repositories are on the wire because the daemon reads them to
 *  answer whether the product is alive at all. What the frame draws beside each
 *  one — `✓ checks`, `× 2 failing` — is the state of that repository's *default
 *  branch* on the code host, which is a third question nobody is asked here; the
 *  checks this page does draw are the ones on the pull requests below, where
 *  they were actually read. A green tick against a repository nobody measured
 *  would be the worst invention available on this page, because it says
 *  everything is fine. */
export interface Repo {
  path: string;
  /** The last segment of the path, which is what a person calls it. */
  name: string;
  /** Which of the product's computers it is checked out on. Empty where the
   *  product is on one, where naming it would be saying nothing. */
  machines: string[];
}

export function repos(p: MergedProject): Repo[] {
  const several = p.machines.length > 1;
  return p.repos.map((path) => ({
    path,
    name: path.split('/').filter(Boolean).slice(-1)[0] || path,
    machines: several ? p.machines : [],
  }));
}

/** What landed in one of them (S11's `Recent commits`).
 *
 *  What the wire carries is per repository and per day: the last commit's own
 *  time, how many landed today and how many in the last seven days
 *  (`RepoActivity`). So the block is one line per repository — when it last
 *  moved, and how much has landed since — which is the recent history of this
 *  branch's code as git told it. A list of commit subjects is not on the wire
 *  and is not guessed at here.
 *
 *  A repository git would not answer about is absent from the readings rather
 *  than reported as zero, and is drawn as a repository with nothing to say. */
export interface Landed {
  name: string;
  path: string;
  today: number;
  week: number;
  /** When it last moved: the clock while it is today's, the age once it is
   *  older, in amber. Null where the reading has no last commit in it. */
  said: Said | null;
  tone: Tone | null;
}

export function commits(p: MergedProject, now: number): Landed[] {
  return repos(p)
    .map((r) => ({ r, a: p.repoActivity[r.path] as RepoActivity | undefined }))
    .filter((pair): pair is { r: Repo; a: RepoActivity } => !!pair.a)
    .map(({ r, a }) => {
      const age = when(a.at ?? null, now);
      return { name: r.name, path: r.path, today: a.today || 0, week: a.week || 0,
               said: age?.said ?? null, tone: age?.tone ?? null };
    })
    .sort((x, y) => y.week - x.week || x.name.localeCompare(y.name));
}

/** How much has landed in one of them, as the line at the end of its row.
 *  Nothing in seven days is said in words rather than in a zero: a repository
 *  that has not moved in a week is a fact about the branch, and `0 this week`
 *  reads as a measurement that failed. */
export function landedWords(l: Landed): Said {
  if (l.week === 0) return { key: 'bpLandedNone' };
  if (l.today > 0) return { key: 'bpLandedToday', params: { today: l.today, n: l.week } };
  return { key: 'bpLanded', params: { n: l.week } };
}

/** One pull request open on one of the branch's repositories (S11), with the
 *  repository it is on. */
export interface Pull {
  repo: string;
  number: number;
  title: string;
  branch: string;
  draft: boolean;
  checks: 'passing' | 'failing' | 'pending' | null;
  failing: number;
  at: number | null;
}

/** Engineering's pull requests, across every repository the product owns.
 *
 *  `null` is the one thing this page must be able to say and could not before:
 *  **nobody could be asked.** The daemon reads the code host only for a checkout
 *  whose `origin` is on GitHub and only through a `gh` that is installed and
 *  signed in, so a product with neither has no entry for any of its paths — and
 *  the page then says the source is not connected, rather than drawing an empty
 *  list and letting it be read as "nothing is open".
 *
 *  An empty array is the other answer, and it is a good one: every repository
 *  was asked and nothing is open on any of them.
 *
 *  Newest first across repositories, because a pull request is read by what
 *  moved last and not by which folder it is in. Failing checks are not sorted to
 *  the top: the row says so in red, and a list that reordered itself when a
 *  check went red would be a list nobody could keep their place in. */
export function pulls(p: MergedProject): Pull[] | null {
  const asked = repos(p).filter((r) => p.repoPulls[r.path]);
  if (!asked.length) return null;
  return asked
    .flatMap((r) => p.repoPulls[r.path].open.map((x) => ({ ...x, repo: r.name })))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** What the chip at the end of a pull request's row says about its checks.
 *
 *  Null where the pull request has no checks at all. That is deliberately not
 *  drawn as passing: a repository with no CI on it has not passed anything, and
 *  a green tick nobody measured is exactly the kind of figure this page refuses
 *  everywhere else. */
export function checkWords(x: Pull): { said: Said; tone: Tone } | null {
  if (x.checks === 'failing') {
    return { said: { key: 'bpChecksFailing', params: { n: x.failing } }, tone: 'red' };
  }
  if (x.checks === 'pending') return { said: { key: 'bpChecksPending' }, tone: 'ink3' };
  if (x.checks === 'passing') return { said: { key: 'bpChecksPassing' }, tone: 'run' };
  return null;
}

/** Is there anything at all to say about this branch?
 *
 *  A product's branch that nobody has put a card on, whose source has never
 *  written a summary and whose product owns no repository is not an error and
 *  not a broken page — it is a face of a product that has not been used yet. The
 *  page keeps its structure and says so in each block, which is the design's own
 *  rule for an empty screen; this is the one sentence that says it once, at the
 *  top, so a person does not have to read four empty blocks to work it out. */
export function bare(p: MergedProject, b: MergedBranch, now: number): boolean {
  return held(p, b, now).length === 0 && !(b.summary || '').trim()
    && !(b.open || 0) && COLUMNS.every((col) => !(b.cards[col] || 0));
}
