# web — the desktop panel

A control panel that runs in a browser. The daemon serves the built files
itself (`daemon/remote_ai_chat/webui/`); there is no separate server.

```
npm install
npm run dev      # http://localhost:5177 (pairs through public/dev-host.json)
npm run build    # -> daemon/remote_ai_chat/webui/
```

`public/dev-host.json` holds a real pairing token and is for `npm run dev` only.
A build strips it back out (`vite.config.ts`), because the daemon serves the
bundle as plain static files with no token of its own — shipping it would hand
the computer's credentials to anyone who can reach the port.

The same step writes `build.json` into the bundle: the commit it was built from.
The bundle is not in git and the daemon is, so without that note nothing can
tell whether the panel in the browser still matches the code behind it. The
Admin screen shows the answer, and the daemon's updater rebuilds when it is no.

On the computer, `remote-ai-chat web` hands the panel its own device token and
opens the browser. The panel shows up in `devices` and `revoke <id>` cuts it off
like it cuts off a phone.

## How it differs from the phone

The phone connects to one computer at a time. The panel connects to **all of
them at once** — that is the answer to "what is running where". One `RacClient`
per computer, all live, results merged in one place.

## The three places

The panel is Divan: **Dashboard**, **Chat**, **Machine**, in a top bar over
everything. The Dashboard is every product on every machine, with the project
chips across the bar scoping it — the chosen one lives in the address
(`?project=quire`), so a scoped page survives a reload and can be sent to
somebody. A scoped page has tabs over it: what the product is, and its **Board**
— four columns, cards dragged between them with a mouse, and the chat of the
agent that stopped to ask open over the corner, because answering it is the
reason you went and looked at the board.
The Chat is the conversation and the list it is picked from, unchanged.
Machine is where everything that was about a computer went: the fleet panel, the
agents, the wall of sessions with the ticket queue in it, the computer's screen,
its folders, Admin and Settings, each a page of one side panel. The six keyboard
shortcuts the panel already had still open the six pages they always did; ⌘0 is
the Dashboard.

`lib/shell.ts` is the whole of that arrangement with no React in it, and
`app/src/shell.ts` is the same file for the phone. `npm test` holds the two ends
together: every screen the old sidebar had has to be a place or a page of the
Machine list, and the old list is read out of git rather than typed out again.

## Layers

| File | Job |
|---|---|
| `lib/protocol.ts`, `lib/ws.ts`, `lib/i18n.ts` | **Copied verbatim** from the iOS app. Do not edit here; if the originals under `app/src/` change, copy them again. |
| `lib/fleet.ts` | The computers. `useFleet()` → `{hosts, order, focus, activity}`. Each `hosts[key]`: `{cfg, status, info, catalog, chats, groups, projects, accounts, limits}`. `onAnyEvent(cb)` gives you every event from every computer. `selectRunning(state)` dumps everything that is running. |
| `lib/timeline.ts` | A chat's timeline. `useLogs().open(hostKey, chatId)` loads it and events stream in on their own. `logs[logKey(h,c)]` → `{items, busy, pending}`. |
| `lib/actions.ts` | `send`, `interrupt`, `respond`, `ticketNote`, `moveCard`, `createChat`, `updateChat`, `deleteChat`, `listAgents`, `agentStore`, `installAgent`, `removeAgent`, `toolStatus`, `upload`, `fileUrl`, `parsePairing`. |
| `lib/format.ts` | `tilde`, `tildeAll`, `shortPath`, `cost`, `tokens`, `duration`, `uptime`, `ago`, `until`, `clock`, `windowName`, `toolSummary`. |
| `lib/ustabasi.ts` | A ticket, twice: as a card on the wall (`groupByProject`, `sortTickets`, `projectName`, and the card's own lines `cardLine`, `totalAge`, `roundAge`, `stageLine`, `commitCount`) and as a conversation when it is opened (`conversation`, `question`, `stateLine`, `bullets`). No progress percentage on a card, and there will not be one: nothing in the queue knows how far along a ticket is. `npm test` checks all of it. |
| `lib/divan.ts` | The board of every paired computer, merged: `useDivanView()` → `{hosts, projects, cards, agents, totals, quota, now}`. One product however many machines it is checked out on, a silent machine's snapshot kept and marked old rather than dropped, what git said folded per product, and counters counted off the cards and the agents — including the two that only a fleet in trouble has, agents nobody has heard from and agents a spent quota stopped. The phone's `app/src/divan.ts` by the same rules, the same names and the same numbers; `scripts/test-overview.mjs` compiles both and compares them. |
| `lib/shell.ts` | The three places, the Machine list, the project chips and where the chosen product is kept. No React, no store, no palette. |
| `lib/overview.ts` | What the Dashboard says: how old the page is, which four counters are across the top, what a project card says about itself (its corner, the line under its name, how fresh it is, what git says, the board's marks, the worst card's line), who is at work, and whether this is a morning where nothing needs anybody. Every sentence is the phone's string table's entry for the same key. |
| `lib/board.ts` | What one product's board says: the four columns and what is in each, what a ticket says about itself (whose square, what the mirror last wrote, whether it needs a person), which columns would take the card in the air, and where a card that was dropped is until the machine that holds the board agrees. Every column says how much of itself it is not carrying — on Done that is all of it, because the daemon sends the open board and the number. |
| `lib/usage.ts` | What a ticket's runs took and used, as the rows its page draws under the side column: the current or last run's duration, the time the ticket's runs add up to, and the whole ticket's tokens and cost. It counts nothing — the daemon sends `usage` on `divan.card.get` — and decides what each figure is called: a duration is a run's and never the ticket's age, a figure nobody reported is `unavailable` and not zero, and a cost with no API key behind it is an estimate nobody was charged. A ticket's page has no Composer; the line in Live talks to the ticket. `scripts/test-usage.mjs` checks the reading, `scripts/test-usage-ui.mjs` drives a running and a finished ticket in a browser. |
| `lib/asking.ts`, `components/Asking.tsx` | What agents are asking, as a floating chat on the Dashboard: a ticket's question (answered with `ustabasi.note`) or a chat holding an approval or structured question (the chat itself, `approval.respond`). An answer keeps the window open for the follow-up; it closes by itself only when the ticket is verified, otherwise only by hand, and a closed question stays as a one-line row under Needs you. `scripts/test-asking.mjs` drives it in jsdom, `scripts/test-asking-ui.mjs` measures it at phone and desktop widths. |
| `lib/sessions.ts` | What needs a person, as the conversations the desktop opens by itself: which cards are sessions and of which kind, who is asking, the answers quoted out of the question itself, and how many windows open before the rest are tabs — including the one asked for by name, which is how a card pressed on the board takes a window over two that opened themselves. The phone's `app/src/waiting.ts` rules, drawn as windows instead of a list. |
| `lib/theme.ts` | Divan's palette in **both themes**, the `--dv-*` rules, the switch, the marks, the radii and the shadows — and `C`, the older vocabulary the screens speak, pointed at the same table. No colour exists outside this file. `T.ink3` is a reference (`var(--dv-ink3)`), not a value, so one render is correct in either theme. |
| `ui/divan.tsx` | The parts the new desktop screens are made of: `Card`, `Row`, `Pill`, `Button`, `Tabs`, `ColumnTab`, `StatusDot`, `StateMark`, `ExecutorBadge`, `Monogram`, `Counter`, `SectionHeader`, `EmptyState`, `SidePanel`, `Note`, `Tag`, `RosterRow`, the window a question opens in — `Panel`, `PanelHead`, `Quoted`, `Composer` — the dock (`DockTab`, `DockMore`), the `CommandBar`, and the top bar: `TopBar`, `NavItem`, `BarDivider`, `BarChip`, `BarStamp`. Each names the frame it was measured off. |
| `ui/kit.tsx` | The older set the existing screens are built from: `Chip`, `Btn`, `Dot`, `Pulse`, `Spinner`, `Segment`, `Label`, `Empty`, `Icon`+`P` (icon paths). |

## The two themes

Light and dark are equals. The switch follows the computer by default, can be
set by hand in Settings › Appearance or from the command palette, and is
remembered; the resolved theme is on `<html>` before the first paint, so the
panel never opens in the wrong one. Everything else is CSS custom properties,
which is why a theme change costs no render.

```
npm test                          # the palette, the parts, the switch, the shell, every screen
npm run test:ui                   # the same in a real browser, with screenshots
```

`npm test` renders every part, every screen — with a computer paired and
without one — and every panel a screen opens over itself, holds the colours to
the table, and measures every pair of tokens that meets, this ink on that
surface, in both themes at 3:1. `scripts/panel-fixture.js` is the computer, the
chat and the approvals it is all drawn from. `npm run test:ui` opens the same page
in Chrome (`CHROME=…` if it is somewhere unusual; it needs a browser on the
machine, which is why it is a command of its own and not part of `npm test`),
reads back what the browser actually resolved, and measures every pair it
painted — text and glyphs against what is behind them — at 3:1.
It leaves `.test-build/divan/` behind: `gallery.html`, every part in both themes
with no daemon and no pairing, and screenshots of the parts and of nine screens
in each theme — the shell among them, and the board of one product, which are
the two pages to hold up against `12-web12-*.html` (W1, W2) and
`13-web13-*.html` (W3, W4).

`scripts/test-shell.mjs` is the third check in `npm test` and is about the shape
rather than the colours: the three places, the old panel's own list read out of
git, the rules the merge folds two machines by, the bar measured against the
frames' own numbers, both themes producing the *same markup* — which is what "the
switch needs no reload" means mechanically — and every screen of the shell drawn
in five states of the fleet: nothing paired, two machines answering, one gone
quiet, one refusing with its board still in hand, and one that has never
answered. `scripts/divan-fixture.js` is the board it is all drawn from.

`scripts/test-overview.mjs` is the fourth, and it is the one that holds the two
clients to each other. It compiles the panel's Dashboard **and the phone's**
(`app/src/divan.ts`, `app/src/dashboard.ts`) into one tree and hands them the same
boards, then compares every figure and every sentence on the counters, the project
cards and the agent roster: two clients that disagreed about how many things need
you would be two products. Beside that it measures the page against Web12 W1 and
Web13 W3 — the head, the four counters, the two-abreast products, the 380 pt
roster, the bar across the bottom, the window in the corner — proves the two
themes are one markup, drives the sessions' own rules (which cards are questions,
which answers a question offers in its own words, two windows and then tabs with a
count), and draws all eight boards of `scripts/overview-fixture.js` in both
themes: nothing paired, nothing answered, a daemon too old, an empty board, a
machine quiet, a machine refusing, a dormant product and a product with no
repository.

`scripts/test-board.mjs` is the fifth, and it is one product's board: the four
columns and what the merge puts in each, the mark a ticket wears, a card that was
dropped staying dropped until the machine agrees, a question past the two the
desktop opens by itself taking a window when a card is pressed — and one that had
been closed opening again — and the page measured against
Web12 W2 and Web13 W4 — the four-abreast grid, the ticket's own corner and
padding, the square and the two lines beside it, the tag in the corner, the card
nothing runs on drawn as an outline — with the two themes proved to be one
markup. It draws every product of every board in `scripts/overview-fixture.js` in
both themes: an empty board, a board whose cards are on a machine that never sent
them, one read off a machine that has gone quiet and one whose machine refuses
the connection.

`scripts/test-drive.mjs` is the sixth, and it is the only one that presses
anything. It mounts the whole panel into a document (jsdom, the one dependency
these checks add) with the renderer the panel actually ships with, and then uses
it: ⌘0 and the six keys the panel already had are dispatched at the window and
the page that comes up is read off the Machine list's own selected row; a place
and a project chip are clicked and the place, the address and the scoped page are
read back; the switch is clicked and the document's theme moves while the markup
under the bar does not; and a question that opened itself in the corner is
answered — the proposed answer is pressed and what goes out is a note on that
ticket, to the machine that asked, after which the window is put away, brought
back and closed. The board is driven there too: the Board tab of a product is
opened, the card of an agent that is asking is pressed and its chat opens beside
the board without leaving the page, the answer pressed in it goes out as a note
on that ticket and the card's mark clears when the board says it has, and a card
is carried from one column into another with the events a mouse produces — the
column that would take it lights up, the drop asks that machine to move it, and
the card is in the new column before the answer comes back. A render cannot say whether an effect ran or a handler is
wired — this can, and it is where "the switch changes the theme without a reload"
and "the bar scopes the page" are actually settled. `design/divan/TOKENS.md` is where the values come from and what
was decided; the artboards it quotes are private and not in this repository.

## Language

The panel's own copy is English only. `lib/i18n.ts` is still here and still
mirrors the phone's table, but it does one job now: turning the daemon's error
codes into sentences. `main.tsx` pins the language rather than following the
browser.

## The rule

A screen shows only fields the daemon actually sends. If a number is not in the
protocol, it either gets added to the daemon or it does not appear at all —
there are no invented indicators. The artboards are Divan's
(`design/divan/frames/`, private); `design/desktop/` is what came before them.
