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
somebody. The Chat is the conversation and the list it is picked from, unchanged.
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
| `lib/actions.ts` | `send`, `interrupt`, `respond`, `createChat`, `updateChat`, `deleteChat`, `listAgents`, `agentStore`, `installAgent`, `removeAgent`, `toolStatus`, `upload`, `fileUrl`, `parsePairing`. |
| `lib/format.ts` | `tilde`, `tildeAll`, `shortPath`, `cost`, `tokens`, `duration`, `uptime`, `ago`, `until`, `clock`, `windowName`, `toolSummary`. |
| `lib/ustabasi.ts` | A ticket, twice: as a card on the wall (`groupByProject`, `sortTickets`, `projectName`, and the card's own lines `cardLine`, `totalAge`, `roundAge`, `stageLine`, `commitCount`) and as a conversation when it is opened (`conversation`, `question`, `stateLine`, `bullets`). No progress percentage on a card, and there will not be one: nothing in the queue knows how far along a ticket is. `npm test` checks all of it. |
| `lib/divan.ts` | The board of every paired computer, merged: `useDivanView()` → `{hosts, projects, cards, totals, now}`. One product however many machines it is checked out on, a silent machine's snapshot kept and marked old rather than dropped, and totals that say when they are incomplete. The phone's `app/src/divan.ts` by the same rules and the same names. |
| `lib/shell.ts` | The three places, the Machine list, the project chips and where the chosen product is kept. No React, no store, no palette. |
| `lib/overview.ts` | What the Dashboard says about a product: how old the page is, which states it is in, what its board adds up to, and what it says when nobody wrote a description. |
| `lib/theme.ts` | Divan's palette in **both themes**, the `--dv-*` rules, the switch, the marks, the radii and the shadows — and `C`, the older vocabulary the screens speak, pointed at the same table. No colour exists outside this file. `T.ink3` is a reference (`var(--dv-ink3)`), not a value, so one render is correct in either theme. |
| `ui/divan.tsx` | The parts the new desktop screens are made of: `Card`, `Row`, `Pill`, `Button`, `Tabs`, `ColumnTab`, `StatusDot`, `StateMark`, `ExecutorBadge`, `Monogram`, `Counter`, `SectionHeader`, `EmptyState`, `SidePanel`, and the top bar — `TopBar`, `NavItem`, `BarDivider`, `BarChip`, `BarStamp`. Each names the frame it was measured off. |
| `ui/kit.tsx` | The older set the existing screens are built from: `Chip`, `Btn`, `Dot`, `Pulse`, `Spinner`, `Segment`, `Label`, `Empty`, `Icon`+`P` (icon paths). |

## The two themes

Light and dark are equals. The switch follows the computer by default, can be
set by hand in Settings › Appearance or from the command palette, and is
remembered; the resolved theme is on `<html>` before the first paint, so the
panel never opens in the wrong one. Everything else is CSS custom properties,
which is why a theme change costs no render.

```
npm test                          # the palette, the parts, the switch, the shell, every screen
node scripts/test-divan-ui.mjs    # the same in a real browser, with screenshots
```

`npm test` renders every part, every screen — with a computer paired and
without one — and every panel a screen opens over itself, holds the colours to
the table, and measures every pair of tokens that meets, this ink on that
surface, in both themes at 3:1. `scripts/panel-fixture.js` is the computer, the
chat and the approvals it is all drawn from. The browser one opens the same page
in Chrome (`CHROME=…` if it is somewhere unusual, and it is not in `npm test`
for that reason), reads back what the browser actually resolved, and measures
every pair it painted — text and glyphs against what is behind them — at 3:1.
It leaves `.test-build/divan/` behind: `gallery.html`, every part in both themes
with no daemon and no pairing, and screenshots of the parts and of seven screens
in each theme — the shell among them, which is the page to hold up against
`12-web12-*.html` and `13-web13-*.html`.

`scripts/test-shell.mjs` is the third check in `npm test` and is about the shape
rather than the colours: the three places, the old panel's own list read out of
git, the rules the merge folds two machines by, the bar measured against the
frames' own numbers, both themes producing the *same markup* — which is what "the
switch needs no reload" means mechanically — and every screen of the shell drawn
in five states of the fleet: nothing paired, two machines answering, one gone
quiet, one refusing with its board still in hand, and one that has never
answered. `scripts/divan-fixture.js` is the board it is all drawn from.

`scripts/test-drive.mjs` is the fourth, and it is the only one that presses
anything. It mounts the whole panel into a document (jsdom, the one dependency
these checks add) with the renderer the panel actually ships with, and then uses
it: ⌘0 and the six keys the panel already had are dispatched at the window and
the page that comes up is read off the Machine list's own selected row; a place
and a project chip are clicked and the place, the address and the scoped page are
read back; the switch is clicked and the document's theme moves while the markup
under the bar does not. A render cannot say whether an effect ran or a handler is
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
