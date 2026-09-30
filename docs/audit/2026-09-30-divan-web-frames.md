# Divan on the web, page by page against its frame

*30 September 2026. Run with `cd web && node scripts/audit-frames.mjs ../../remote-ai-chat/design/divan/frames`
on `ustabasi/58-…` at the state of this commit. Seventeen web artboards — Web12 W1–W2,
Web13 W3–W4, Web14 W6–W10, Web15 W11–W18; there is no W5 — each one rendered, and the
panel driven to the page it drew and rendered too. Nothing here was fixed; this is the
comparison.*

## The answer

**No page is word-for-word its frame — all seventeen differ — but almost all of what
differs is either the fixture or a decision somebody already wrote down.** Every artboard
is drawn on four invented products, three invented machines and one invented evening, and
the panel draws what its paired computers actually report, so the data differs everywhere
and always will. Set that aside and what is left is small: **eleven places where the two
say different words, and two more that every page has.** Six variants — W1, W3, W6, W11,
W14 and W16 — have nothing against them but those two and gaps the screens' own comments
already record. None of the thirteen is a missing screen, a missing column or a missing
button; the worst is a word in the top bar that is a character off the frame for one month
a year, and the rest are a label here and a section head there.

The two every page has: the bar's clock says **`Wed 30 Sept`** where every frame says
`Sep` — `Intl`'s `en-GB` `month: 'short'` is *Sept* and no other month is four letters, so
the bar is one character wide of the frame through September and exact for the other
eleven — and the bar carries a **theme chip (`Light` / `Dark`) that no artboard draws**,
because the frames are one dark set and one light set and the switch between them was this
end's idea.

If you want to fix two things, fix those two. Everything below them is a judgement call
somebody already wrote down in the code, and the rest is the fixture.

## Worst first

| # | what | where |
|---|---|---|
| 1 | the bar's clock writes `Sept` through September, not the frames' `Sep` | `web/src/components/Shell.tsx:26-30` |
| 2 | the bar carries a theme chip no artboard draws | `web/src/components/Shell.tsx:111` |
| 3 | W10's command bar (`Tell Divan anything…` · `⌘K`) is drawn over a Machine page; the panel only draws it on the Dashboard | `web/src/screens/Overview.tsx:204` |
| 4 | W2/W4's board head counts `○ 1 yours`; the panel's head counts stuck, asking and running and not that | `web/src/lib/overview.ts:339` |
| 5 | W7's `Pull requests` and `Recent commits` blocks are `Cards` and `Recent activity` | `web/src/screens/Branch.tsx:129,147` |
| 6 | W8's detail rows `Created by · Divan · from your chat` are not there; the panel has `Ticket`, `Repository` and `Product` instead | `web/src/lib/ticket.ts:211-226` |
| 7 | W9's hint `press N anywhere on the board` is not on the page — the key itself is wired, the line was never drawn | `web/src/screens/Board.tsx:74-87` |
| 8 | W10/W12's bar ends in `mini unreachable · 2h 14m · quota 64%`; the panel's bar ends in the clock, and the fleet's state is `mini cannot be reached.` under the drawer title with the quota as a card on the page | `web/src/screens/Machine.tsx:67`, `web/src/components/Shell.tsx:110-111` |
| 9 | W13's column head is `what it's for`, the panel's is `what it is for`; and its `Writes code, runs tests, opens PRs` is `writes code · opens PRs` | `web/src/screens/Executors.tsx:31`, `web/src/lib/theme.ts:334` |
| 10 | W15's first button is `View only`, the panel's is `Connect` | `web/src/screens/Screen.tsx:453` |
| 11 | W17's page note is `backups, logs, keys, data`, the panel's is `the update, the logs, the keys and the folders` | `web/src/screens/Admin.tsx:68` |
| 12 | W10's `+ Pair a machine` is a button in the page head; the panel pairs from a card under the table | `web/src/screens/Machines.tsx:166` |
| 13 | W18's Theme row reads `Follows the system; night falls at sunset`; the panel's reads `Follows this computer, which is <dark/light> right now` | `web/src/screens/Settings.tsx:67` |

Nine, eleven and thirteen are wording. Three, five, six, seven, ten and twelve are a
thing in a different place or under a different name. Four and eight are a count and a
line that say less than the frame's.

## How to read a section below

Each variant carries the script's own numbers for it: how many texts the frame draws, how
many the page draws, how many of each side's have no counterpart at all, and how many
differences carry a reason already written down in the code. `birebir` would mean *none of
those four numbers is anything but zero, and the bar over it agrees too*; it is a strict
word and nothing earned it. Every "gap with a reason written down" is printed by the
script with that reason and the file and line it is written at — the run's full output is
what this document was written from.

The comparison is on text and asks *whether a word is on the page*, not where: a line the
panel splits over two elements and the frame keeps in one still matches. Position,
spacing and colour are not this audit's business — `test-divan.mjs` holds the palette and
`test-shell.mjs` / `test-machine.mjs` hold the tracks.

---

## W1 · Overview · Web12 (dark)

**farkli.** Frame 125 texts, panel 84 · 0 in the frame only · 0 on the page only · 2 gaps
with a reason written down · and the bar's 2.

- the bar's clock and its theme chip — *Across every page*, items 1 and 2
- the frame's per-product figures (`€4,812 MRR`, `8,930 DAU`, the fourteen-bar sparkline) are not drawn — nothing carries either number, so the panel draws the two figures it has and no chart of figures it does not (`web/src/screens/Overview.tsx:20-28`)
- the fourth counter is `Paused` here and `Done today` on the frame — whichever of three truths applies, worst first (`web/src/lib/overview.ts:96-113`)

Everything else — the four products and their names, the seven agents, the two questions
open over the corner with the words their workers used and the answers they proposed — is
the artboard's own invented evening against the fixture's, and the script accounts for all
86 of those units by provenance: each one came out of the frame's own `renderVals()`.

## W2 · Quire board, the asking agent's chat beside it · Web12 (dark)

**farkli.** Frame 143 texts, panel 82 · 1 in the frame only · 0 on the page only · 3 gaps
· and the bar's 2.

- **frame:** `○ 1 yours` in the product head. **panel:** stuck, asking and running, and no count of the cards that are a person's own — `marks()` has three states where `cardMarks()` on the project card has four (`web/src/lib/overview.ts:339-346`, used at `web/src/screens/Overview.tsx:126`)
- the bar's clock and its theme chip — *Across every page*
- the frame's third tab, `Chats 6`, is not drawn: a chat carries a folder and nothing else on this daemon (`web/src/screens/Project.tsx:12-16`)
- the panel's head carries `+ New ticket` where W2 does not; it is one head for both tabs and Web14 W6 draws that word on it (`web/src/screens/Overview.tsx:70-74`)

The four columns, their names, their counts and their subtitles, the card faces, the
executor squares and the chat window beside the board are all there; the twelve ticket
titles and their summaries are the artboard's.

## W3 · Overview · Web13 (light)

**farkli.** Frame 125 texts, panel 84 · 0 in the frame only · 0 on the page only · 2 gaps
· and the bar's 2.

The same page as W1 in the other theme, and the same three differences — the bar's two,
and the two gaps W1 carries. The theme itself is right: `test-divan.mjs` reads the sixteen
values back off the markup in both, and this run found nothing in the light artboard that
the dark one did not also have.

## W4 · Quire board · Web13 (light)

**farkli.** Frame 143 texts, panel 82 · 1 in the frame only · 0 on the page only · 3 gaps
· and the bar's 1.

Word for word W2's list: `○ 1 yours`, the `Chats 6` tab, `+ New ticket`, and the bar's
clock. The bar's theme chip is not counted here — in the light theme it reads `Dark`, and
this artboard happens to carry the word inside a ticket title (`Dark mode for client
portal`), so the text comparison finds it. It is the same difference as W2's; the method
cannot see that it is in the wrong place.

## W6 · Project · Quire · Overview tab · Web14

**farkli.** Frame 95 texts, panel 70 · 0 in the frame only · 0 on the page only · 8 gaps
· and the bar's 2.

- the bar's clock and its theme chip — *Across every page*
- the frame's measured figures on a product and on each branch (`MRR`, `trial→paid`, `churn`, `clicks 28d`, `avg pos`, `indexed`, `open PRs`, `212/214 tests`, `v3.18 deployed`) are not drawn: nothing carries a history, a test result or a deploy (`web/src/screens/Overview.tsx:20-28`, `web/src/screens/Branch.tsx:12-20`)
- the frame's third column, `Conversations filed here` with its four filed items, and the `Chats 6` tab over the page: a chat carries a folder and nothing else here, and what stands in that column is the repositories and what the agents last said (`web/src/screens/Project.tsx:12-16`)
- `+ Add branch` is not offered: nothing creates a branch from a client (`web/src/screens/Project.tsx:17-21`)
- a branch with nothing behind it says `no source connected yet` where the frame writes a sentence about it (`web/src/screens/Branch.tsx:11-25`)

The `now` / `waiting` block, the branch grid, the tabs, the head and the command bar are
all the frame's. This is the variant with the most written-down gaps and the fewest
surprises.

## W7 · Branch · Quire / Engineering · Web14

**farkli.** Frame 67 texts, panel 51 · 2 in the frame only · 2 on the page only · 3 gaps
· and the bar's 2.

- **frame:** `Pull requests` (three, with their states) and `Recent commits` (three, with hashes). **panel:** `Cards` and `Recent activity` (`web/src/screens/Branch.tsx:129,147`) — the board's own where the frame has git's
- the bar's clock and its theme chip — *Across every page*
- the frame's `deploys per day · 30 days` chart, `212/214 tests`, `v3.18 deployed` and the per-repository check marks are not drawn (`web/src/screens/Branch.tsx:12-20`)
- the numbers against the branch name are how much is open, in progress and done, which is what the board can answer (`web/src/screens/Branch.tsx:22-25`)

The breadcrumb, the name, the line under it, the `Repositories` block and the three-column
grid are the frame's.

## W8 · Ticket · QUI-142 · Web14

**farkli.** Frame 86 texts, panel 71 · 2 in the frame only · 3 on the page only · 4 gaps
· and the bar's 2.

- **frame:** `Created by` · `Divan` · `from your chat`. **panel:** no such row — the wire does not say who wrote a card (`web/src/lib/ticket.ts:211-226`)
- **panel:** `Ticket #41`, `Repository`, `Product` — three rows the frame's panel does not have, and the frame's `Chat · 2 conversations` is not one of them (`web/src/lib/ticket.ts:211-226`)
- the bar's clock and its theme chip — *Across every page*
- the column pill has no chevron and the corner has no link or ellipsis: the column is what a board writes, and dragging a card is how it is written (`web/src/screens/Ticket.tsx:26-30`)
- a card nobody has written sentences for says so in the box rather than borrowing the agent's goal, and a machine that cannot be reached says so where the brief would be (`web/src/screens/Ticket.tsx:14-17,23-24`)

Both faces and the live half are the frame's: the fixed box with its character count, the
brief with `GOAL`, `DONE WHEN · n/m`, `TEST` and `CONSTRAINTS · FILES`, the details panel,
the log and its one-line input. This run answers `divan.card.get` with a brief so the page
is read with one on it (the fixture is `BRIEF` in the script) rather than in its empty
state.

## W9 · New ticket, inline at the top of Ice Box · Web14

**farkli.** Frame 74 texts, panel 71 · 1 in the frame only · 1 on the page only · 4 gaps
· and the bar's 2.

- **frame:** `press N anywhere on the board`, at the end of the head. **panel:** nothing there. The key itself is wired — an effect on `window` that opens a draft on N and stands aside while something is being typed into (`web/src/screens/Board.tsx:74-87`) — and this variant is driven through it rather than through the word in the head, so a run that finished at all is the evidence that it works. It is the line telling you about the key that was never drawn
- **panel:** a card carries `writes code · opens PRs` under the executor's square where the frame carries only `Coder` (`web/src/lib/theme.ts:334`)
- the bar's clock and its theme chip — *Across every page*
- the `Chats 6` tab (`web/src/screens/Project.tsx:12-16`), and `+ New ticket` where the frame put the hint (`web/src/screens/Overview.tsx:70-74`)

The draft itself is the frame's, down to the character counter, `executor & brief later`,
`Add · ↵` and `Esc`, and the columns under it keep their names, counts and subtitles.

## W10 · Machine › Machines and Executors · Web14

**farkli.** Frame 92 texts, panel 105 · 5 in the frame only · 2 on the page only · 7 gaps
· and the bar's 2.

One artboard with two of the panel's pages side by side on it, so it is compared against
both — the Machines table and the Executors table.

- **frame:** `Tell Divan anything…` and `⌘K` across the bottom of a Machine page. **panel:** the command bar is drawn on the Dashboard only (`web/src/screens/Overview.tsx:204`; the chips are the same story, `web/src/components/Shell.tsx:32-35`)
- **frame:** `mini unreachable · 2h 14m · quota 64%` at the end of the bar. **panel:** the bar ends in the clock, and the fleet's state is `mini cannot be reached.` under the drawer's title — without the age, and with the quota as a card on the page rather than a word in the bar (`web/src/screens/Machine.tsx:61-68`, `web/src/components/Shell.tsx:110-111`)
- **frame:** `+ Pair a machine` as a button in the page head. **panel:** a `Pair a new machine` card under the table (`web/src/screens/Machines.tsx:166`)
- **frame:** `write code, run tests, open PRs`. **panel:** `writes code · opens PRs` (`web/src/lib/theme.ts:334`)
- **panel:** the Executors table's column heads (`executor`, `what it is for`, `doing now`) — W10 draws the roster as a list at this width and Web15 W13 draws the table in full (`web/src/screens/Executors.tsx:25-27`)
- the bar's clock and its theme chip — *Across every page*
- the quota card's own line is `warn 20%` and `stop 5%`, not the frame's `warn 20% · pause 0%`: warning is this browser's and stopping is this panel's, while pausing a running agent is the machine's own and is a fact rather than a setting (`web/src/screens/Quota.tsx:8-19`)
- the panel is on the full Machine place, so the drawer's other six rows are on screen; W10 is the narrow artboard with no drawer (`web/src/lib/shell.ts:76-108`)
- the two cards under the table say how pairing really works and what the merge really does with a quiet machine (`web/src/screens/Machines.tsx:11-21`), and the roster ends on `Agents on this computer` rather than the frame's two settings (`web/src/screens/Executors.tsx:10-15`)

## W11 · Machine drawer · quota thresholds open · Web15 (light)

**farkli.** Frame 26 texts, panel 38 · 0 in the frame only · 0 on the page only · 3 gaps
· and the bar's 2.

- the bar's clock and its theme chip — *Across every page*
- the frame's opening sentence and its `quota resets daily at 04:00 · account: Max plan` are the panel's own wording, and the mono line reads off the fleet rather than naming one plan (`web/src/screens/Quota.tsx:4-20`)
- each slider carries a note saying what that number actually does here, and under them the panel states where the fleet stands against the two (`web/src/screens/Quota.tsx:18-20`)

All three rows are there under the frame's own labels — `Warn on the system line at`,
`Stop starting new tickets at`, `Pause running agents at` — with the frame's 20 / 5 / 0.
The smallest list in the audit, and the closest page to its frame.

## W12 · Machine drawer · Machines · Web15

**farkli.** Frame 55 texts, panel 58 · 1 in the frame only · 0 on the page only · 4 gaps
· and the bar's 2.

- **frame:** `mini unreachable · 2h 14m` at the end of the bar. **panel:** the bar ends in the clock and the fleet's state is `mini cannot be reached.` under the drawer title (`web/src/screens/Machine.tsx:61-68`) — the same difference as W10's
- the bar's clock and its theme chip — *Across every page*
- the pairing card counts no code down: `pair` prints a link with no clock on it, so the card says how pairing really works (`web/src/screens/Machines.tsx:17-21`)
- `Change to 10 min` and `Move tasks automatically` are not offered: nothing moves work between machines and `STALE_AFTER_S` is the merge's own rule (`web/src/screens/Machines.tsx:11-21`)
- the `Agent quota` card is on the page where W12 ends on the pairing and the quiet machine; Web14 W10 draws it on this same page (`web/src/screens/Machines.tsx:11-15`)

The table is on W12's own tracks bar the last column, which the panel's third action
widens (`web/src/screens/Machines.tsx:47-58`), all three of the frame's closing cards are
there, and the drawer's eight rows are the frame's eight in the frame's order.

## W13 · Machine drawer · Executors · Web15

**farkli.** Frame 85 texts, panel 47 · 2 in the frame only · 2 on the page only · 3 gaps
· and the bar's 2.

- **frame:** the column head `what it's for`. **panel:** `what it is for` (`web/src/screens/Executors.tsx:31`)
- **frame:** `Writes code, runs tests, opens PRs`. **panel:** `writes code · opens PRs` (`web/src/lib/theme.ts:334`)
- the bar's clock and its theme chip — *Across every page*
- the frame keeps `40px` at the end for a `···` menu and the panel's table stops at the six columns that say something: a row here goes nowhere and does nothing (`web/src/screens/Executors.tsx:25-27`)
- the frame's two closing cards (`Up to 2 per machine`, `Add a branch agent`) are settable from nowhere, so what is there instead is `Agents on this computer` (`web/src/screens/Executors.tsx:10-15`)

The table is the frame's table; the nine executors on it are the artboard's roster against
the three the fixture's boards actually have at work.

## W14 · Machine drawer · Terminals · Web15

**farkli.** Frame 46 texts, panel 95 · 0 in the frame only · 0 on the page only · 2 gaps
· and the bar's 2.

The largest single difference in the audit, and the only one that is a whole page:

- the frame draws **a different product** — tabs of a real shell on a reachable machine, a pty with `git status -sb` and `divan ps` typed into it, an agent's own session attached to, `sessions close after 30 min idle`. Nothing carries one: there is no request that opens a shell and none that writes to one. So the page is every chat at once with the ticket queue beside it, under the frame's own head (`web/src/screens/Terminal.tsx:25-30`)
- the bar's clock and its theme chip — *Across every page*

`Terminals` and `a shell on any reachable machine` are the frame's words and are on the
page. Everything under them is the wall.

## W15 · Machine drawer · Remote screen · Web15

**farkli.** Frame 31 texts, panel 31 · 1 in the frame only · 0 on the page only · 2 gaps
· and the bar's 2.

- **frame:** the first button is `View only`. **panel:** `Connect` — nothing is streamed until somebody asks for it (`web/src/screens/Screen.tsx:449-453`)
- the bar's clock and its theme chip — *Across every page*
- the frame's status line under the picture (`live screen · studio · 2560 × 1440`, `latency 38 ms`, `quality auto`, `audio off`, `nobody else is watching`) is not drawn: `screen.info` carries the displays and whether control is allowed, and nothing else (`web/src/screens/Screen.tsx:7-14`)

`Take control`, `Full screen`, the machine chips and the page head are the frame's.

## W16 · Machine drawer · Accounts & sign-ins, one expiring · Web15

**farkli.** Frame 75 texts, panel 70 · 0 in the frame only · 0 on the page only · 3 gaps
· and the bar's 2.

- the bar's clock and its theme chip — *Across every page*
- the frame's seven third-party services (GitHub, App Store Connect, Google Play, Stripe, Search Console, Postmark, Hetzner) and their `+ Connect an account` are not the panel's rows: its sign-ins are the ones its agents actually work through — the Claude and Codex accounts on each paired computer, as `account.list` reports them (`web/src/screens/Accounts.tsx:12-18`)
- the note under the table is the panel's own, and says the stronger thing: a sign-in never leaves the computer it is on (`web/src/screens/Accounts.tsx:12-22`)

All five of the frame's columns, its `expires in 12 days` in amber at the top of the table,
its `n connected` count and its per-row button are there. What the rows are about is the
difference, and it is the one this screen's comment opens with.

## W17 · Machine drawer · Admin · Web15

**farkli.** Frame 42 texts, panel 49 · 1 in the frame only · 0 on the page only · 3 gaps
· and the bar's 2.

- **frame:** the page note `backups, logs, keys, data`. **panel:** `the update, the logs, the keys and the folders` (`web/src/screens/Admin.tsx:68`)
- the bar's clock and its theme chip — *Across every page*
- four of the frame's rows have nothing behind them and are left off rather than faked — nightly backups to a cloud, agent logs as a download, retention as a setting, a monthly budget in euros — and `Remove a project` with them, because `divan.project.delete` does not exist (`web/src/screens/Admin.tsx:9-17`)
- what is there instead is every administrative fact this panel can answer, each row's button opening the page that does that job (`web/src/screens/Admin.tsx:9-17`)

The shape is the frame's exactly: a list of cards, each one a thing, a grey line saying
what it is, a word for where it stands and one button.

## W18 · Machine drawer · Settings · Web15

**farkli.** Frame 48 texts, panel 44 · 1 in the frame only · 0 on the page only · 3 gaps
· and the bar's 1.

- **frame:** the Theme row's note is `Follows the system; night falls at sunset`. **panel:** `Follows this computer, which is <dark/light> right now`, or `Set by hand · …` once it has been chosen (`web/src/screens/Settings.tsx:67-69`) — the sunset behaviour is real and driven by `test-divan.mjs`; it is the sentence that differs
- the bar's clock — *Across every page*. The theme chip is not counted here: this artboard carries `Dark` as one of its own Theme options, so the text comparison finds the word. It is the same difference as everywhere else
- the frame's *reaching you* and *voice and language* groups are left off rather than faked: the first is a phone's and this panel has no push registration, and neither a voice for the daemon's answers nor a language for this browser exists to be chosen (`web/src/screens/Settings.tsx:10-18`)
- `Density` and `Running dot pulse` are off for a smaller reason: nothing on any screen reads either (`web/src/screens/Settings.tsx:15-18`)
- what is there instead is the panel's own two groups — what this browser keeps, and the way into what one computer keeps (`web/src/screens/Settings.tsx:1-9,37-40`)

`Theme` with `Auto` / `Light` / `Dark` is the frame's row, with the frame's three options.

---

## Pages no web artboard draws

Six screens the panel has and no web frame covers. Every one of them says so in its own
opening comment; none is an orphan.

| page | what it is | why no frame |
|---|---|---|
| `web/src/screens/Agents.tsx` | the workers installed on one computer, and the collections they come from | one level under Executors; Web15's drawer has eight rows and this is not one of them |
| `web/src/screens/Fleet.tsx` | what is running on every computer right now, and each sign-in's plan windows | one level under Machines, same reason |
| `web/src/screens/Projects.tsx` | folders on one computer an agent may be pointed at | one level under Machines, same reason |
| `web/src/screens/Update.tsx` | what each computer is running against `origin/main` | one level under Admin, drawn as a row on W17 rather than a page |
| `web/src/screens/Preferences.tsx` | everything one paired machine keeps | one level under Settings, drawn as rows on W18 |
| `web/src/screens/Onboarding.tsx` | a panel with no computer behind it yet | every desktop artboard opens on a day's work already in progress; there is no pairing flow among them |

`web/src/screens/Ustabasi.tsx` is not in this list: it is the ticket queue drawn inside
the Terminals page, so it is compared as part of W14 — where the frame draws a shell
instead of either of them.

## One thing found on the way, not a frame difference

Driving W14 with tiles on the wall makes React report
`validateDOMNesting: <button> cannot appear as a descendant of <button>` —
`Tile` renders a pressable `Card` (`web/src/ui/divan.tsx:41-56`, which renders a `<button>`
when it has an `onClick`) and puts `TileButton`s inside it
(`web/src/screens/Terminal.tsx:247,296`). Invalid markup, and a nested button is not
reachable the way the outer one is. No existing check presses `Add`, which is why nothing
has said so before. Reported, not fixed — this ticket only looks.

## Running it again

```
cd web && node scripts/audit-frames.mjs [path/to/frames]      # default ../design/divan/frames
```

It is **not** part of `npm test` and must not become part of it: the frames are private
and are not in this repository, so a check that reads them cannot run on a clone. A
difference is not an error — the exit code is zero whenever the run finished, and non-zero
only when it could not happen at all (no frame directory, no `INDEX.json`, an artboard
missing from the file `INDEX.json` says it is in).
