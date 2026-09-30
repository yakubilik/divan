# Divan mobile against its frames — 30 September 2026

## The answer

**Every screen the frames drew is there, in the right shape, and nothing on any
of them is invented. None of the twenty-five artboards is word-for-word identical
to the screen it drew, and in almost all of them the leftover is either a figure
nobody has a source for or the same sentence written slightly differently.**
Three things are worth a decision, and the first is a bug rather than a choice:

1. **Every date on the phone is month-first and every date in the frames is
   day-first.** `Sep 27, 02:10` where the artboard says `26 Sep, 21:40`, `Wed,
   Sep 30` where it says `Mon 28 Sep`. The code says it means the frame's order —
   `src/card.ts:222` calls its own output "the frame's own stamp" — and then asks
   `en-US` for it, which reverses it. One locale, two call sites — the Dashboard's
   aside and the card's stamp — showing on the Dashboard, the ticket's `Created`
   row and its activity trail. `src/i18n.ts:670`, `app/dashboard.tsx:101`,
   `src/card.ts:222-228`, `app/card/[id].tsx:227`.
2. **The ticket page keeps the tab bar and the chat page has none — the frames
   have it exactly the other way round.** Mobile4 T1/T2/T3 draw a pushed page
   with no tab bar under it; the app draws one (`app/card/[id].tsx:132`). Mobile4
   C1 draws the tab bar under the conversation; the app's chat screen has none
   (`app/chat/[id].tsx`, which mounts no `Shell`).
3. **Chat is the old screen, on purpose, and the two behaviours the frames asked
   for are not there.** `docs/divan-uygulama-plani.md` says chat is not touched
   and that two things would be taken from its frames: filing a message as a
   ticket in one gesture (Mobile10 S12) and voice mode (S13). Neither exists.
   The composer still reads `Message` where the frames read `Say it…`, and the
   cost of each turn is printed where the frames print nothing.

Everything else on the list below is one of three kinds, and all three were
decided in the tickets that drew these screens, with the reason in the source:
a figure with no source connected (revenue, retention, ratings, PR checks, a
thirty-day chart), a row that leads nowhere yet (Terminals, Admin, quota
thresholds), or a sentence the app writes in its own words. If the answer to
this report is "fix one thing", fix the dates.

## How it was read

    cd app && node scripts/audit-frames.cjs ../../remote-ai-chat/design/divan/frames

`app/scripts/audit-frames.cjs` reads the eleven mobile frame files, interprets
each artboard's template against its own `renderVals()`, stands the screen that
artboard drew up through `scripts/render-divan.cjs`, and prints two lists per
variant: what the frame says and the screen does not, and the reverse. A
difference is not an error there — the exit code is zero whenever the run
finished — and it is in no npm script, because the frames are private and are not
in this repository.

Three things are waived by the script itself, each with its reason printed beside
the units it swallowed, so nothing is dropped in silence:

* **the status bar.** The clock and the battery, which iOS draws over every app.
  Waived by position — the two texts every artboard opens with — rather than by
  pattern, so that a real time on a branch page is not swallowed with them.
* **the artboards' own data.** Five invented products, three invented machines,
  one invented evening. Told from the artboards' chrome by provenance: a unit
  that came out of a `{{ … }}` is a value `renderVals()` supplied.
* **this run's own data.** The fleet seeded in the script — named outright in
  `FIXTURE`, so a reader can check nothing else was swept in with it.

Per-variant rules add two more kinds, both printed with their reason: a line the
app draws too with this fleet's figure in it (the quota window, how long the
quiet machine has been quiet, when a paused agent returns), and a word that is on
another artboard of the same screen — V1 and V2 are the Dashboard at two scroll
heights, S1 and S2 the same screen in two states, T1/T2/T3 three faces of one
page.

`AUDIT_DUMP=V1 node scripts/audit-frames.cjs <frames>` prints both sides of one
variant in full. Every line below was read off that.

The verdict beside each variant is the script's own word: **`birebir`** where
both lists came out empty — every word the artboard drew is on the screen and
every word the screen draws is on the artboard, with nothing left that a rule did
not explain — and **`farkli`** where either list has something in it. All
twenty-five came out `farkli`, so nothing in here is a `birebir` claim that would
need the script's output to stand behind it; every `farkli` is followed by the
lines that made it one. Two variants come close: **S1**, whose frame-side list is
empty, and **S9**, which has two units left on one side and one on the other.

## What it found, variant by variant

Counts are what the script printed: texts on each side, then what was left
unexplained on each side.

### Mobile1 · Dashboard: Overview (all projects)

**V1 — Overview, top · `farkli`** · `app/dashboard.tsx`, dark · frame 44, app 115
· 2 / 6 left

* frame `4 projects · Mon 28 Sep` → app `5 projects · Wed, Sep 30`. Day-first
  against month-first: the count is this run's, the order is `en-US`'s.
  `app/dashboard.tsx:101`.
* frame `SaaS` on the product card → app draws no kind there. `ProjectCard` takes
  a name, a mono line, a chip, a figure and marks, and no product kind;
  `SaaS · client portals for studios` is on the product's own page instead.
  `src/components/dashboard.tsx:224-252`, `app/dashboard.tsx:336`.
* app `Conversations` + `every chat on this computer, including the ones put
  away` → not on any mobile artboard. Deliberate: the two things on this screen
  that are work rather than infrastructure, the queue and every conversation.
  `app/dashboard.tsx:156-170`.
* app `? Research asks` → the frames call the assistant **Divan**; the app calls
  it **Research**. `src/i18n.ts:311`.
* app `■ Coder stopped` and `Answer it` on a card in *Needs you* → V1's own
  *Needs you* holds two questions and no stuck card, and its cards offer the
  question's two answers and nothing else. The app's list is everything waiting
  on a person, worst first, and a card whose queue this phone holds also offers
  the way in. `app/dashboard.tsx:228-253`, `src/dashboard.ts:317-345` (`asks`).

**V2 — Overview, scrolled · `farkli`** · frame 72, app 115 · 3 / 6 left

* frame `all projects`, `2 you`, `2 stuck` → the app has no condensed header.
  V2 draws the head as a sticky strip once the page has scrolled — the title,
  `all projects`, and two counters carried up into it. The app has one head, V1's,
  and it does not condense. `app/dashboard.tsx:126-130`.
* the four remaining app-side lines are V1's, above.

**V3 — Overview, calm, light · `farkli`** · frame 55, app 69 · 6 / 4 left

* frame `While you slept` with `✓ Hush 2.4 approved and live · 04:30`,
  `✓ Kanji Android build green on 8.6 · 01:12`,
  `✓ 3 posts published on The Long Walk · 06:00` → app draws the calm block's
  title and one line, `22 finished today`. The overnight list itself is not
  there: nothing records *which* things landed, only how many.
  `app/dashboard.tsx:213-226`, `src/i18n.ts:333-334`.
* frame `Done overnight` → app `Done today`. The fourth counter has one word for
  both times of day. `src/i18n.ts:310`.
* frame `4 projects · Tue 29 Sep` → app `4 projects · Wed, Sep 30`: the date
  again.

### Mobile2 · Project dashboard and board: Quire

**V4 — Project dashboard, Overview tab · `farkli`** · frame 59, app 66 · 9 / 3 left

* frame `Chats 6` as a third tab → app draws two. The chats a product owns are
  not filed yet and a tab that does nothing is worse than no tab.
  `app/dashboard.tsx:309-315`.
* frame `MRR €4,812 ▲ 2.1% 7d`, `Trials 38 this week`, `Churn 2.1% ▼ 0.3` → app
  draws no such tiles. Nothing carries revenue, trials or churn.
  `src/project.ts:336-420`.
* frame `? Coder asks` with `Keep 3 webhook retries, or follow Stripe?` and its
  two answers, on the product's own page → the app answers questions on one
  screen (Mobile6 S3) and not on two. Mobile7 S4 draws this same page without
  the card. `app/dashboard.tsx:399-403`.
* app `3 things are waiting on you.` → the app's second state line. Mobile7 S4
  draws the same pair of lines (`now` / `waiting`); V4 spends that space on the
  ask card. `src/project.ts:114-150`.
* app `in progress`, `done` as branch-card slot labels → the frame's slots are
  `open PRs`, `tests`, `deployed`. Same three fixed slots, different contents:
  what the board counts against what a code host and a deploy would say.
  `src/project.ts:36-56`, `src/project.ts:336-420`.

**V5 — Board tab · `farkli`** · frame 51, app 73 · 5 / 2 left

* frame head `Q Quire · Board` → app draws the product head (`Quire`,
  `SaaS · client portals for studios`) and the Overview/Board segments above the
  columns. One head for both faces, which is Mobile2 V4's own head.
  `app/dashboard.tsx:333-348`.
* frame column line `? 1 asking · ■ 1 stuck · ● 2 running · ○ 1 yours` → app
  `? 1 · × 1 · ● 3 · ✓ 1 · ○ 1`, marks and counts with no words. Mobile8 S7
  draws the line the app draws; V5 and S7 disagree and the app followed S7.
  `src/board.ts:201-213`, `src/components/board.tsx:36-52`.
* app `× Failed 9m`, `● Running 23m` → frame `× Failed · 3/5`, `● Picked up`.
  The app's chip carries how long the card has been in that state; the frame's
  carries the verifier's progress. `src/board.ts` `mark`.

### Mobile3 · Drag into In Progress · `farkli`

**M3 — the drag frame, D1–D4** · `app/dashboard.tsx`, `src/components/drag.tsx`,
dark · frame 47, app 93 · 2 / 4 left

The four moments are one template drawn four times, so they are read as one
variant against the union of their words. A static render cannot hold a gesture —
each moment is a state a hook took on after a touch — so the board is rendered
the ordinary way and the surfaces the gesture puts over it are mounted with the
state `src/drag.ts` gives each moment. The arithmetic that chooses between them
is `scripts/test-drag.cjs`'s and is not re-asked here.

* frame `next free one` under the carried card's executor name → the `Float`
  draws the badge, the name and the title, and no second line.
  `src/components/drag.tsx:111-130`.
* frame head `Q Quire · Board` → as V5 above.
* app `Moved to Ice Box`, `Moved, but nothing started: the queue is full` → the
  frame's landed card says `Started · Coder` and nothing else. The app has four
  sentences rather than one, because a move can arrive and fail to start, or not
  arrive at all, and an Undo is offered on every one of them except the start.
  `src/drag.ts:454-497`.
* app `× Failed 9m`, `● Running 23m` → as V5 above.

### Mobile4 · Ticket (human / agent / live) and Chat

The head is one part above all three faces, so the three lines it contributes are
the same on T1, T2 and T3 and are listed once, on T1.

**T1 — human face · `farkli`** · `app/card/[id].tsx`, dark · frame 45, app 38 ·
15 / 9 left

* frame `QUI-142` → app `#9`. The breadcrumb wears the queue's own ticket number,
  or the first eight characters of the card id where there is no ticket. Nothing
  on the wire carries a per-product key. `src/card.ts:101-120`.
* frame `● Running · 3/5` → app `● Running 23m · 3/5`: the app's chip adds how
  long. `src/card.ts:114`, `app/card/[id].tsx:140-146`.
* frame `Created by · Divan · from your chat` and `by Coder` after the update →
  neither row is there. Nothing records who wrote a card or who touched it last,
  and the human face is the one face that must invent nothing.
  `app/card/[id].tsx:50-54`, `src/card.ts:170-177`.
* frame `What to do · title + 3 sentences` and `148 / 220` → the app's summary is
  read-only, with no label over it and no counter under it. A writing aid on a
  screen that reads. `app/card/[id].tsx:60-61`, `app/card/[id].tsx:184`.
* frame `Created 26 Sep, 21:40`, `Updated 4 min ago` → the app draws both rows;
  the stamp is month-first (`Sep 27, 02:10`). The date again, `src/card.ts:222-228`.
* frame activity `You moved it to In Progress` → app `Moved to In Progress`; frame
  `Divan created it from chat` → app `The card was written`. Same two moments,
  said without an author, for the same reason as the missing rows.
  `src/i18n.ts:467-470`.
* app `Dashboard`, `Chat`, `Machine` → the tab bar, which Mobile4 T1 does not
  draw on a pushed page. `app/card/[id].tsx:132`.

**T2 — agent face · `farkli`** · frame 46, app 45 · 12 / 5 left

* frame `Drafted by Divan · edited by you 26 Sep` with its `Edit` → neither. Same
  gap as T1's author rows, and there is no screen to edit a brief on yet.
  `app/card/[id].tsx:54-56`.
* the rest of this variant's list is the brief's own words — this run's brief
  against the artboard's (`pnpm` against `npm`, `upload_id` against `upload id`)
  and the frame's `web/src/portal/ImportClients.tsx · +4`, which is the same
  file list with the overflow counted. No structural difference on this face:
  goal, criteria with their marks, commands, constraints, files and notes are all
  drawn, in that order.
* app `#9`, `● Running 23m · 3/5`, tab bar → the head, as T1.

**T3 — live face · `farkli`** · frame 36, app 33 · 11 / 7 left

* frame `Say one sentence to the Coder…` → app `Say one sentence to Coder…`
  (no article). `src/i18n.ts:480`.
* frame `It reads this at its next step. The run doesn't stop.` → app
  `… The run does not stop.` (no contraction). `src/i18n.ts:481`.
* frame timestamps carry seconds (`23:08:40`) → the app's carry minutes
  (`02:10`). A run writes several lines a minute and the frame's precision is the
  useful one. `src/dashboard.ts:53` `clock`.
* frame log lines are the agent's own prose (`read routes/clients/import.ts`,
  `wrote dry-run preview +84 −3`) → the app draws the tool and its argument
  (`Read /.../clients/import.ts`, `Bash npm test clients/import`). What the
  daemon sends is a tool call, not a sentence about one.
* app tab bar → as T1.

**C1 — Chat · `farkli`** · `app/chat/[id].tsx`, dark · frame 21, app 21 · 10 / 10
left

Chat is deliberately the screen it was: `docs/divan-uygulama-plani.md` ("Chat.
Ellenmiyor.") keeps its layout and takes two behaviours from these frames. This
is the one screen no other check in the repository stands up, and standing it up
is how this list was got.

* frame `→ filed under Kanji Daily`, `→ filed under Quire · Marketing` → the app
  files nothing from a conversation and says nothing about a product. The
  passive-filing note is the whole of Mobile10 S12's behaviour and it is not
  there.
* frame a filed card inside the transcript (`Upgrade to Gradle 8.7`,
  `Kanji Daily · Ice Box`, `Coder`) → no card is ever drawn in the transcript.
* frame composer `Say it…` → app `Message`. `src/i18n.ts:46`.
* frame send button `↑` → the app's is the same arrow drawn as an icon
  (`arrow_upward`) rather than as a character, so it is on the screen and a
  reading of the words cannot see it. `app/chat/[id].tsx:646-647`. The one false
  positive of this method in the twenty-five.
* frame `Tonight` at the top → the app draws the conversation's own name only
  while the transcript is empty (`app/chat/[id].tsx:541`); a conversation with
  messages in it has the plan, the permission mode, the machine and the folder in
  that place instead.
* frame tab bar `Dashboard · Chat · Machine` → the app's chat screen draws none.
* app `Claude`, `safe · studio · .../projects/kanji`, `$0.040` per turn,
  `Opus 5 · high`, the attach sheet (`Photos`, `Camera`, `Video`, `File`,
  `Uploads are saved on studio in ~/.remote-ai-chat/uploads`,
  `Up to 4 photos · videos up to 120 s`) → the old screen's own chrome, none of
  it on any Divan artboard.

### Mobile5 · System line: machines and quota

**S1 — a machine is unreachable · `farkli`** · `app/dashboard.tsx`, dark ·
frame 46, app 116 · 0 / 5 left

**Nothing the artboard draws is missing from the screen** — the only one of the
twenty-five where the frame's side of the list is empty. The staleness sentence,
the amber aside, the fourth counter as `Unknown`, the product lines
(`on mini · 2 agents, state unknown`, `last seen 21:02`) and the chips are all
there, in this fleet's own figures. `◌ stale 2h 14m` and `○ yours` are drawn by
the same chip in another branch of its precedence — in this run those two
products carry a stuck card, and stuck outranks both (`src/dashboard.ts:354-364`).
The verdict is `farkli` only because of the app's own five, which are V1's and are
listed there: the date, `Conversations` and its note, `? Research asks`,
`■ Coder stopped` and `Answer it`.

**S2 — agent quota used up · `farkli`** · frame 46, app 117 · 5 / 6 left

* frame `Quota ›` → no such link. Quota thresholds are not settable from anywhere
  in the app yet, so the row that would lead there is not drawn.
  `src/shell.ts:135-140`.
* frame section head `You can still do` over the card that is yours → the app's
  head is `Needs you` in every state of the fleet. `src/i18n.ts:331`.
* frame `○ Waiting on you` on that card → app `○ Your call`; Mobile1 V1 draws
  `○ Your call` on the same card, so the two artboards disagree and the app
  followed V1. `app/dashboard.tsx:228-253`.
* frame aside `4 projects` with no date → V1's is `4 projects · Mon 28 Sep`; the
  app always draws the date. Two artboards disagree.
* frame `Quire · The first email after signup is still the default one.` → the app
  draws the product name in its own row above the sentence rather than in front
  of it.
* the paused block itself — its title, its sentence, `used 100%`, `resets 04:00`,
  the `⏸ n paused` chips and `resume 04:00` — is all there, in this fleet's
  figures. `src/dashboard.ts:162-177`.

### Mobile6 · Waiting on you

**S3 — everything that needs a human · `farkli`** · `app/waiting.tsx`, dark ·
frame 42, app 42 · 11 / 1 left

* frame `Coder asks`, `Coder is stuck` → app `Coder`. The card names the executor
  and the group head says which kind it is; the frame says the verb twice.
  `src/components/waiting.tsx:54-84`, `src/waiting.ts:33-50`.
* frame `Back to Queued` on the stuck card → not offered. A stuck card offers
  `Open live view`, which is the run itself; moving a card back is the board's
  gesture. `src/waiting.ts:366-388`.
* frame `Start` and `Hand to Divan` on the card that is yours → app `Mark it
  done`. Nothing hands a card to the assistant, and *Start* is a drag into In
  Progress. `src/waiting.ts:370-373`.
* frame `Divan` on the decision card → app `Research`, as V1.
* frame `Hush · App Review` → app `Hush · Resubmit 2.4 to App Review · on
  studio`: the app's mono line always carries the card's own title and the
  machine, because the answer goes back to that machine.
  `src/waiting.ts:261-277`.
* the four groups, in the frame's order, with their marks and colours, the age on
  each card, the question's own two answers as pills and `Reply…` where it offers
  none — all there.

### Mobile7 · Project variants

**S4 — Kanji Daily, different numbers per branch, light · `farkli`** ·
`app/dashboard.tsx`, light · frame 52, app 52 · 18 / 3 left

* frame `open PRs`, `99.2% crash-free`, `✓ passed`, `build 1.9.3`, `9,012 DAU`,
  `21% D30`, `€1,140 MRR`, `4.7★ rating`, `#14 rank · Education`, `91% reply <1h`
  → none of these has a source. The three slots on a branch card are drawn with
  what the board counts (`open`, `in progress`, `done`).
  `src/project.ts:36-56`, `src/project.ts:336-420`.
* frame `App Store` as a fourth branch → the app draws the branches the product
  reports; a store is not one of them.
* frame's per-branch sentences (`Android build green again on Gradle 8.6.`,
  `Steady. No new reviews below 4 stars.`) → the app draws the branch summary the
  daemon has, or `no source connected yet`. `src/project.ts:336-420`.
* frame `Analyst is building September cohorts on studio.` / `Nothing waiting on
  you.` → the app draws the same two lines with its own fleet in them
  (`4 agents are running on studio, mini.`, `Coder has stopped: …`).
  `src/project.ts:114-230`.
* frame `live` beside a branch → the app's freshness word is the age
  (`01:22`, `21:02`, `2 days old`); `live` has no counterpart word.

**S5 — The Long Walk, no activity in weeks · `farkli`** · frame 46, app 43 ·
14 / 2 left

* frame `Open board` and `Ask Divan what's worth doing` → the dormant block
  carries the sentence and no buttons. Nothing asks the assistant what is worth
  doing. `src/project.ts:256-288`.
* frame `The last activity was 3 posts published on 5 Sep. …` → app `No agents
  are running. 2 cards are waiting on the board, and the last commit was 23d 0h
  ago.` Same block, composed out of what is known rather than out of what
  happened. `src/project.ts:256-288`.
* frame `18,240 clicks 28d`, `8.1 avg pos`, `212 posts`, `41.2k visits 7d`,
  `▼ 8% vs last yr`, `€612/mo affiliate`, `6,904 list`, `18 Aug last send` → the
  same gap as S4.
* the `quiet for 23 days` head, the faint branch cards and the ages are all there.

**S6 — brand-new project, empty board · `farkli`** · frame 21, app 30 · 4 / 2 left

* frame head `P Pebble · Board` → the app's shared product head, as V5.
* frame `Write the first ticket. A title and a couple of sentences is all it
  needs; the agent brief can come later.` → app `Nothing is on it yet. The
  branches are ready — Engineering, Seo, Analytics, Marketing, Customers — and a
  card needs a title and a couple of sentences to begin.` The same designed
  state, naming the branches that exist. `src/project.ts:289-306`.
* frame `Tell Divan what Pebble is` with `Divan can draft the first five tickets
  into Ice Box. Nothing starts until you move one.` → the app's empty state has
  one button, `New ticket`, and its foot says `Nothing starts by itself: a card
  runs when it is moved into In Progress.` Nothing asks the assistant to draft a
  board. `app/dashboard.tsx:598-604`.
* the four columns at zero and the board's structure are there.

One thing in that sentence is this file's own doing and not the screen's: `Seo`
rather than `SEO`. The fixture gives Pebble five bare branches whose display name
is the kind with its first letter raised, and the screen prints the name it was
given. A real product names its own branches.

### Mobile8 · Board with machines, and New ticket

**S7 — board, several machines, review and failed · `farkli`** ·
`app/dashboard.tsx`, dark · frame 53, app 72 · 14 / 2 left

* frame head `Q Quire · Board` → as V5.
* frame `mini · seen 21:02` on a card → the app draws the machine name and, on a
  stale one, `last seen 21:02` — the same two facts, on two lines.
  `src/board.ts`, `src/components/board.tsx` `BoardCard`.
* frame `× Failed · 3/5`, `◐ Under review`, `● Picked up` → app `× Failed 9m`,
  `✓ Passed review`, `● Running 23m`. Three of the five state chips are worded
  differently: the app says how long, and says `Passed review` where the frame
  says `Under review`. `src/board.ts` `mark`, `src/i18n.ts:429-436`.
* frame `studio 3 · cloud 2 · mini 1` → the app draws the same line with this
  run's own spread; `src/board.ts:215-220`.
* the four columns, their counts, the card bodies, the executor badges and the
  `+ ticket` in the head are all there.

**S9 — New ticket · `farkli`** · `app/new-ticket.tsx`, dark · frame 12, app 9 ·
2 / 1 left

The closest of the twenty-five. Everything the artboard draws is on the screen:
`Cancel`, the product's monogram and name, the title, the sentences, the mono
note `executor & agent brief: later, or drafted by Divan`, the counter, and both
buttons with `Add to Ice Box` first.

* frame `system keyboard` → the artboard's own label on the grey block where iOS
  draws the keyboard. Not a thing a screen says.
* frame `108 / 220` → app `110 / 220`: this run typed two more characters.

### Mobile9 · Branch page

**S10 — SEO, the generic layout · `farkli`** · `app/branch/[id].tsx`, dark ·
frame 35, app 34 · 11 / 8 left

* frame `6,412 clicks 28d`, `11.3 avg position`, `214 indexed`, and the
  `clicks per day · 30 days` chart with its `peak 286` → a branch's daily figures
  have no source. The chart's place keeps its place and says why it is empty:
  `over time · 30 days` and `A figure a day needs a source that measures this
  branch daily. …` `app/branch/[id].tsx:38-47`, `src/branch.ts:146-155`,
  `src/i18n.ts:408`.
* frame `● live` beside the branch name → the app's head carries the branch and
  the product and no live dot.
* frame log lines (`Rewrote /vs/notion, 1,840 words`, `Found 3 pages losing rank
  for "client portal"`, `Weekly crawl. 0 errors, 2 slow pages`) → the app draws
  what the mirror actually said (`Coder: 9 of 14`). Nothing writes a branch's
  own diary.
* frame ticket rows labelled by column (`In Progress`, `Queued`) → the app's
  carry the machine too (`In Progress · cloud`, `Queued · studio`), for the same
  reason the waiting list does.
* frame `● 9/14` on a ticket row → app `● Running 40m`, as the board's chips.

**S11 — Engineering, the densest case · `farkli`** · frame 40, app 76 · 14 / 15
left

* frame `4 open PRs`, `212/214 tests`, `v3.18 deployed`, the
  `deploys per day · 30 days` chart and its `■ failed checks` legend → the same
  gap as S10. What the app draws instead is the board's counts and, under them,
  `Recent commits` with `3 today · 14 · 7d` from git.
* frame `quire-api` / `quire-web` with `main` and `✓ checks` / `× 2 failing` →
  the app draws the repositories it was told about, without a branch name, and
  the checks as `× 2 checks` / `◐ checks`. `src/branch.ts`.
* frame pull request rows `● 3/5`, `× tests`, `◐ review` → app `◐ checks`,
  `× 2 checks`, `quire · draft`. The three numbers and their words are the code
  host's own answer — how many checks are failing, whether the thing is a draft —
  rather than the frame's shorthand. `src/branch.ts`.
* frame `4 Coders on 4 tickets. One stuck on the Safari login, one failed tests
  on GBP pricing.` → the app draws the project page's own `oldWords`/state lines
  instead; nothing composes a sentence about several workers at once.
* frame `Coder: e2e timeout at 501 rows, batching` → the app draws the same kind
  of line from the mirror, with this run's words.
* the sequence is the frame's: who the branch is, how it is, its numbers, the
  chart's place, Engineering's three extra blocks, the log, the tickets.

### Mobile10 · Chat: ticket gesture, passive filing, voice

**S12 — message to ticket in one swipe · `farkli`** · `app/chat/[id].tsx`, dark ·
frame 20, app 21 · 13 / 10 left

**The behaviour this artboard exists for does not exist.** There is no swipe on a
message, no `Ice Box` target, no `filing under Quire` header, no card drawn back
into the transcript, and no `Filed from your words. I drafted a brief; it's
folded on the card.` The plan lists this as one of the two things to take from
the chat frames (`docs/divan-uygulama-plani.md`, "Chat"); nothing in `app/chat/`
or `src/` mentions filing a message.

The ten app-side lines are the old screen's chrome, as C1.

**S13 — voice mode · `farkli`** · frame 9, app 21 · 6 / 10 left

**Voice mode does not exist either.** The chat screen records a voice *message* —
an audio attachment with a transcript (`app/chat/[id].tsx:343-370`) — which is a
different thing from the frame's full-screen face: no `Close`, no live transcript
of what is being said, no `tap to send · hold to keep talking`, no `filing under
Kanji Daily`, and the assistant does not answer out loud. `app/call.tsx` is a
phone call with the computer and is not this screen either.

### Mobile11 · Machine tab: drawer, machines, executors

**S14 — Machine › Executors · `farkli`** · `app/executors.tsx`, dark · frame 59,
app 47 · 13 / 0 left

Nothing the app draws is absent from the artboard — the only variant of the
twenty-five where that is true.

* frame groups `Coders`, `Branch agents`, `Assistant and you` → the app draws all
  three, and names the third `You` where no assistant is at work.
  `src/machine.ts:231-241`.
* frame `Divan` with `Chat, filing, drafting tickets`, `Analyst`, `Research`,
  and `SEO` → the app names a branch agent by its branch and the assistant by
  `Research`; the roster is who is actually running, so an idle Analyst that
  nothing started is not a row. `src/machine.ts:213-233`, `src/i18n.ts:311`.
* frame `Bulk invite from CSV · Quire`, `Webhook retry policy · asking you`,
  `Safari 17 login · mini not reachable`, `September cohorts · Kanji Daily`,
  `Onboarding email · Hush resubmit` → the app's `doing` line is the card's
  title and its detail rather than the title and its product;
  `Safari 17 login · mini not reachable` is the app's own sentence with this
  run's card title in it. `src/machine.ts:245-263`.
* `Nothing assigned` / `idle` for a machine with nothing running, and
  `unavailable` for one that cannot be reached, are both drawn.
  `src/machine.ts:266-279`.

**S15 — Machine › Machines, one unreachable · `farkli`** · `app/machines.tsx`,
dark · frame 40, app 36 · 5 / 2 left

* frame `Mac Studio · home`, `Mac mini · office`, `Hetzner CX32 · Falkenstein` →
  app `Darwin`. A computer reports its OS and its errors; nothing reports a model
  or where it sits. `src/machine.ts:82-94`.
* frame `Terminal` beside `Screen` on every card → only `Screen` (and `Try
  again` on an unreachable one). There is no terminal on the phone.
  `src/machine.ts:92`, `src/shell.ts:135-140`.
* frame `warn at 20%` under the quota track → thresholds are not settable
  anywhere yet, so the line that would say one is not drawn.
  `src/shell.ts:135-140`.
* app `Computer picker` + `which one this phone is holding, and where it answers`
  → a row at the foot, deliberately: which machines are paired and which one this
  phone holds a socket to are different questions. `app/machines.tsx:31-35`.
* the ringed card, the hollow dot, `unreachable`, the amber last contact, the two
  figures per card and `+ Pair` in the head are all there.

**S16 — Machine drawer, light · `farkli`** · `app/machine.tsx`, light · frame 24,
app 22 · 10 / 10 left

Five of the frame's eight rows are there (Machines, Executors, Remote screen,
Accounts & sign-ins, Settings), three are not, and three of the app's own are
extra. All six are decided in one place, with the reason:
`src/shell.ts:135-150`.

* frame `Terminals · studio, mini, cloud` and `Admin · backups, logs, API keys` →
  screens the desktop panel has and the app never had. Left off rather than
  drawn as rows that lead nowhere.
* frame `Quota thresholds · warn at 20% · pause at 0%` → not settable from
  anywhere yet.
* frame's own summary lines differ where the app's are read off the fleet:
  `4 Coders, 3 branch agents, Divan, you` → `7 who can do work`;
  `studio, mini` → `watch this computer, and take it over`;
  `GitHub, App Store Connect, Stripe, Search Console` → `the tools this computer
  is signed in to`; `appearance, haptics, voice` → `appearance, security,
  notifications`.
* app `Agents · the agents this computer can start`, `Sign-in pool · several
  sign-ins driven as one`, `Call · talk to this computer out loud` → three
  screens the app already had that are about a computer, moved under here.

## Screens no mobile artboard draws

Read off the route folder rather than off a list, so a screen added tomorrow
appears here. `app/_layout.tsx` is the navigator and is not a face.

    app/account-login.tsx      app/login-web.tsx
    app/accounts.tsx           app/model-sheet.tsx
    app/agent-install.tsx      app/move-signin.tsx
    app/agent-store.tsx        app/new-chat.tsx
    app/agents.tsx             app/pair.tsx
    app/call.tsx               app/pool.tsx
    app/chat/index.tsx         app/screen.tsx
    app/chat-settings.tsx      app/settings.tsx
    app/divan-gallery.tsx      app/ticket/[id].tsx
    app/host-sheet.tsx         app/ticket-about/[id].tsx
    app/index.tsx              app/ustabasi.tsx
    app/login-method.tsx       app/welcome.tsx

**Twenty-four, not eight.** `scripts/test-divan-screens.cjs` stands up eight of
them — `welcome`, `pair`, `accounts`, `agent-store`, `agent-install`, `settings`,
`model-sheet`, `host-sheet` — which is the list ticket #35 carried into the new
language, and the script checks that its eight are a subset of the twenty-four
rather than taking it on trust. The other sixteen are in no frame and in no
check of that kind:

    app/account-login.tsx   app/login-method.tsx
    app/agents.tsx          app/login-web.tsx
    app/call.tsx            app/move-signin.tsx
    app/chat/index.tsx      app/new-chat.tsx
    app/chat-settings.tsx   app/pool.tsx
    app/divan-gallery.tsx   app/screen.tsx
    app/index.tsx           app/ticket/[id].tsx
                            app/ticket-about/[id].tsx
                            app/ustabasi.tsx

Four of those sixteen are not screens in the sense the eight are: `app/index.tsx`
is the redirect that picks the first place, `app/divan-gallery.tsx` is the design
system's own gallery, and `app/login-web.tsx` is a web view with a browser in it.
The rest are real faces somebody will open — the ticket wall (`ustabasi`), a
ticket and its brief (`ticket/`, `ticket-about/`), the chat list (`chat/index`),
a new chat, chat settings, the sign-in pool, the computer's screen, the voice
line, and three steps of signing an account in. They are reached from the Machine
drawer and from chat, they were carried into the new palette in tickets #34 and
#41, and no check stands them up on every face the way the eight are stood up.
That is the gap this list is really recording.

## Baseline

Nothing in the product changed. `git diff --name-only main..HEAD` is
`app/scripts/audit-frames.cjs` and this file.

    cd app && npx tsc --noEmit                                  # clean
    cd app && for f in scripts/test-*.cjs; do node "$f"; done    # 14 of 14 green

Both were run before the script was written and again after, on 30 September
2026, on the machine this was read from. `scripts/audit-frames.cjs` is in no npm
script: `npm test` runs `test-ustabasi.cjs` and nothing else, which is what it ran
before.
