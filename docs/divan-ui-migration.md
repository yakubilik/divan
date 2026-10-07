# Divan UI migration — what moved where

7 October 2026 · ustabasi #128, the last of six steps. This compares the `divan-ui`
branch with `main` on both clients: every action a person could reach on `main`, where
it lives now, and the request it sends to the daemon. Spec: the handover of 7 Oct 2026
(`HANDOVER.md` and the twelve frames under `design/divan/handover-2026-10-07/frames/`,
private, not in this repo).

## How this was checked

| What | Command | Covers |
|---|---|---|
| Every route of the panel, Night and Day, 1440 and 390 wide, with a picture of each | `cd web && node scripts/test-walk-ui.mjs` | console errors, Back / reload / cold open, the §2 rules, sample figures, the empty computer |
| Calls nothing else pressed (web) | `cd web && node scripts/test-actions-ui.mjs` | update, restart, remote screen, folders, agents, accounts, keys, palette, pairing |
| The panel mounted and pressed | `cd web && node scripts/test-drive.mjs` (in `npm test`) | almost every row below |
| Every phone route in both schemes | `cd app && node scripts/test-every-screen.cjs` (in `npm test`) | 34 routes × 2 schemes render |
| Calls nothing else pressed (phone) | `cd app && node scripts/test-phone-actions.cjs` (in `npm test`) | accounts, agents, pool, chats, groups, settings, picker |
| This table | `cd web && node scripts/test-inventory.mjs` (in `npm test`) | every row has a new place, and every citation is a check that exists |

The daemon calls are the same set on both branches: a grep of the request types in
`web/src`, `app/src` and `app/app` gives the same 74 names on `main` and on `divan-ui`,
and every web screen and component that `main` mounts is still mounted.

`main` moved on while `divan-ui` was being built. The merge (ustabasi #136) carried three
things over that the frames do not draw, each marked "(main, …)" in the tables: a chat
dropped on a product heading (#132), the inbox of what the queue sent, and a ticket's
Report (`ustabasi.notifications` and `ustabasi.report`, two request types `divan-ui` did
not have). The demo machine for App Review (#134) has no screen of its own: it is a daemon
with `demo = true` in its config, and both clients show it as any other computer
(`daemon/scripts/test_demo.py`).

In the tables, **Proof** names the check that presses the action and asserts its call:
`drive:` is `web/scripts/test-drive.mjs`, `actions:` is `web/scripts/test-actions-ui.mjs`,
`walk:` is `web/scripts/test-walk-ui.mjs`, `machine:` is `web/scripts/test-machine.mjs`,
`refusal:` is `web/scripts/test-refusal.mjs`, `overview:` is `web/scripts/test-overview.mjs`, `phone:` is any `app/scripts/test-*.cjs`.
The quoted words are the check's own name.

## Web

| Action | Old place (main) | New place | Call | Proof |
|---|---|---|---|---|
| Go to the Dashboard | Top bar Dashboard, ⌘0 | `divan` word / Back on the top line, ⌘0 | — | drive: "⌘0 goes back to the Dashboard" |
| Go to the Chat place | Top bar Chat | Top line Chats (lands in the newest chat) | `chat.get` | drive: "the Chat place is one press away and lands writable in a chat; Earlier opens the list" |
| Go to Machine | Top bar Machine | Top line Machine | — | drive: "…and the Machine place opens on the first row of its list" |
| Switch Night / Day | Top bar switch, palette | Top line switch, palette | — | drive: "pressing it moves the document’s theme, and nothing else says it" |
| Scope to a product | Project chips in the bar | Project tiles on the Dashboard | `divan.snapshot` | drive: "pressing one writes it into the address, as a path a person can read" |
| Browser Back / reload / cold open | Address per page | Same, every page type | — | walk: "cold open and reload land on" |
| Command palette | ⌘K | ⌘K (also printed in the Composer) | — | drive: "⌘K still opens the palette" |
| New chat | ⌘N, palette, sidebar pen | ⌘N and palette focus the Composer; "More options" and palette "New chat with every option" open the full dialog | `chat.create` | drive: "Back from a project is the Dashboard, a reload redraws the page it was on, and every old destination is offered" |
| Search chats | ⌘F | ⌘F opens Earlier with search focused | — | actions: "⌘F opens the chat list with its search focused" |
| Fold the chat list | ⌘B | ⌘B, same | — | actions: "⌘B folds the list to a rail" |
| Machine pages by key | ⌘1–⌘8, ⌘, | Same keys | — | drive: "opens Machine › " |
| Stop every session | Palette | Palette | `chat.interrupt` | actions: "the palette still stops every running session (chat.interrupt) and shows every computer" |
| Show every computer | Palette | Palette | — | actions: "the palette still stops every running session (chat.interrupt) and shows every computer" |
| Ask Divan something | Command bar | Composer, mode Ask | `chat.create`, `chat.send` | drive: "Ask: one press sends chat.create then chat.send" |
| File a card without starting | Board draft (Ice Box) | Composer mode Ice Box; New ticket | `divan.card.create` | drive: "Ice Box writes the card into Ice Box and Start now into In Progress" |
| Start a card now | Drag to In Progress | Composer Start now; New ticket Start now; drag | `divan.card.create`, `divan.card.move` | drive: "Create files divan.card.create into Ice Box by default, Queued or In Progress when chosen" |
| Pick agent / account / model for one chat | NewChat dialog | Composer chips (§5), dialog behind More options | `agent.list`, `chat.create` | drive: "four chips show the defaults, list what the computer reports, mark a changed one with an ×" |
| Scope by typing | — | `@project` in the Composer | `chat.create` | drive: "typing @quire makes the same scope chip as pressing it" |
| Answer an asking agent | Question window | Needs you card (amber answer); question window kept | `ustabasi.note` | drive: "Needs you answers in one press with the same note the question window sent" |
| Put away / close / drag / open out a question window | Window corner | Same | — | drive: "a window can be put away" |
| Reply in a question window | Window box | Same | `chat.send` | drive: "…and pressing it says it in that chat" |
| Read the counters | Dashboard counters | One summary line | — | drive: "tiles open the project, dormant ones come last and dimmed" |
| See what is running | Agent roster (not pressable) | Working now (not pressable) | — | overview: "what is working now is a list row per agent" |
| Everything waiting on you | Questions spread over pages | Waiting on you (`/waiting`, Needs you › See all) | `ustabasi.note`, `divan.card.move`, `divan.project.open` | drive: "Waiting on you: the title states the counts, three groups oldest first" |
| Switch a product's view | Tabs Overview / Board / Branches / Chat | Segment Overview / Board / Chats; Repositories button | — | drive: "the head is monogram, name, one sentence and a meta line" |
| Write a new ticket | Inline draft in Ice Box, N | + New ticket form, N on the board | `divan.card.create` | drive: "+ New ticket opens one form" |
| Still open: add, state, comment | Project page | Project side column; On your plate | `divan.project.open` | drive: "Still open sits in the side column and its thread still takes a comment" |
| Ask about a product | Project command bar | Composer locked to the product | `chat.create`, `chat.send` | drive: "the Composer at the foot of a project carries that project" |
| A product's chats | Chat tab | Chats segment | `chat.create` | drive: "a chat started there starts in the product’s repository" |
| Open a branch | Branch cards | Branches section, branch page | — | drive: "a branch with no source says Source not connected yet. and no number" |
| Move a card | Board drag | Board drag (Queued reorders too) | `divan.card.move` | drive: "dragging a card from Queued into In Progress issues divan.card.move" |
| Quota refusal on a drop | Board | Same | — | drive: "a card dropped where a worker would start is not started under the threshold you set" |
| Answer from the board | Press an asking card | Same | `ustabasi.note` | drive: "answering it there is a note on that ticket" |
| Open a card | Press a card | Same, ticket page | `divan.card.get` | drive: "a card that nobody is waiting on opens as its own page" |
| Edit title / sentences | Card page | Ticket page | `divan.card.update` | drive: "…and the return key writes it on the machine that holds the card" |
| Hand a card to someone | Executor menu | Executor row | `divan.card.executor` | drive: "Executor sends divan.card.executor" |
| Say something to the run | Card say box | Live › Say one sentence to the agent | `ustabasi.note` | drive: "a sentence typed into Say one sentence to the agent is sent as ustabasi.note" |
| Read the run | Run log | Live; The whole run | `ustabasi.run` | drive: "Live shows the run’s latest steps as a mono time and a sentence" |
| Move back to Queued | Board drag only | Ticket side column (frame) and drag | `divan.card.move` | drive: "Move back to Queued on an in-progress ticket sends divan.card.move to queued" |
| Stop / run next / restart / edit / delete a ticket | Wall ticket window | Wall window and ticket page | `ustabasi.cancel`, `ustabasi.priority`, `ustabasi.restart`, `ustabasi.edit`, `ustabasi.delete` | drive: "run next, stop, restart, edit and delete are on the ticket" |
| The queue | Terminal place | Machine › Terminal | `ustabasi.list` | drive: "…and the queue’s tickets are on it" |
| What the queue sent (bell) | Bell in the top bar (added on `main` after this branch was cut, 5736dcf) | Bell at the right end of the top line, before the theme switch | `ustabasi.notifications` | drive: "the bell is in the top line and the panel asks each computer what its queue sent (ustabasi.notifications)" |
| A ticket's report | On the ticket page (added on `main`, 5736dcf) | Ticket page, between the question card and Live; in a window of its own for a ticket with no card | `ustabasi.report` | drive: "a ticket page asks for the report of its own ticket (ustabasi.report)" |
| Type into a chat on the wall | Terminal peek | Machine › Terminal peek | `chat.send` | drive: "Terminal takes a command" |
| Open a chat | Chat list | Earlier list; `/chats/<id>` | `chat.get` | drive: "the Chat place lands in a writable chat without a choice" |
| Send, stream, stop, approve | Chat | Same | `chat.send`, `chat.interrupt`, `approval.respond` | drive: "a message sends chat.send and the reply streams in" |
| Attach a file | Chat box + | Same | `/upload` | refusal: "and the upload went out" |
| Dictate | Mic | Same | `/dictate` | drive: "interrupt, approval, the picture and the mic are there and work" |
| Change account / model / effort / mode / folder | Chat head chips | Same | `chat.update` | drive: "…and choosing one moves the chat to it, on the computer that holds it" |
| Open a chat in its own window | Details | Same | — | actions: "a chat still opens in a window of its own from Details" |
| Archive | Chat list | Earlier list | `chat.update` | drive: "a chat that has not moved for a day is out of the list" |
| Groups: make, rename, delete, drag in and out | Chat list | Earlier list | `group.create`, `group.rename`, `group.delete`, `chat.update` | drive: "a chat dragged onto a group is filed in it, and dragged back out is unfiled" |
| Move a chat to a group from its menu | Chat menu | Same | `group.create`, `chat.update` | drive: "a chat’s menu makes a group and moves the chat into it" |
| Delete a chat | Row bin, menu | Same | `chat.delete` | drive: "a chat’s row deletes it, after asking" |
| New chat in a folder | Heading + | Same | `chat.create` | drive: "a heading’s + opens a chat in that folder, already on Hermes" |
| Pair a computer | Machines page | Machine › Machines › Pair | — | actions: "a pairing link pasted on Machines adds that computer to the panel" |
| Unpair a computer | Settings / Machines | Machine card Remove; Settings | `device.revoke_self` | drive: "…and removing it revokes this browser’s pairing on that computer" |
| Remote screen | Screen page | Machine › Machines › Remote screen | `screen.info`, `screen.enable` | actions: "the remote screen asks screen.info and Take control sends screen.enable" |
| Drive the remote screen | Screen page | Same | `screen.input` | actions: "connected and in control, a key pressed on the page goes to the computer as screen.input" |
| Folders | Projects page | Machine › Machines › Folders | `host.git` | actions: "Folders asks the computer for host.git on its repositories" |
| Stop a turn from the sessions list | Fleet page | Machine › Machines › Sessions and plan limits | `chat.interrupt` | actions: "Sessions and plan limits stops a running turn (chat.interrupt)" |
| Update the computer | Update page | Machine › Machines › Update | `update.status`, `update.apply`, `daemon.restart` | actions: "the update page asks update.status, Update sends update.apply and Restart sends daemon.restart" |
| Call off a restart that is waiting on work | Update page Cancel | Same | `daemon.restart.cancel` | actions: "a restart that is waiting on work can be called off: Cancel sends daemon.restart.cancel" |
| What a restart would cost | Update page | Same | `daemon.status` | drive: "the update page asks what a restart would cost" |
| Admin | Admin page | Machine › Machines › Admin | `account.list` | drive: "…and Admin says the same thing about them, on a page nobody asked twice" |
| Executors table | Executors page | Machine › Executors | — | machine: "Executors is W13’s table" |
| Agents: install, remove | Agents page | Machine › Executors › Agents on this computer | `agent.store`, `agent.install`, `agent.remove` | actions: "an installed agent can be removed, which sends agent.remove with its name" |
| Install a missing CLI | Accounts page | Machine › Executors › Accounts & sign-ins | `tool.install` | drive: "…and pressing it runs the installer on that computer, for that tool" |
| Sign-in pool | Accounts page | Same page | `pool.get`, `pool.set` | drive: "…and turning the pool on is a write to that computer, not a switch in a browser" |
| Accounts: add, rename, sign out | Settings › This computer | Machine › Settings › This computer › Accounts | `tool.status`, `account.create`, `account.rename`, `account.logout` | actions: "the accounts page reads tool.status, and Add sends account.create with the name typed" |
| Sign in, enter the code, cancel a sign-in | Same | Same | `account.login`, `account.login.submit`, `account.login.cancel` | actions: "Sign in sends account.login, the code goes as account.login.submit, and leaving the sheet sends account.login.cancel" |
| Delete an account | Same | Same | `account.delete` | drive: "agent.install, account.login and account.delete still go out" |
| Quota thresholds | Quota page | Machine › Settings › Quota thresholds | — | machine: "quota thresholds are still settable with nothing paired" |
| Default account and model | — (per chat only) | Machine › Settings | — | drive: "the default account and model set in Machine › Settings are what the composer’s chips show" |
| File a chat under a product by hand (main, #132) | Chat list: drop on a product heading | Same list in the Chats place | `chat.update` | drive: "dropping a chat on a product heading sends that product’s id, and takes it out of its group" |
| Inbox: what the queue sent (main, 7 Oct) | Bell at the end of the top bar | Bell on the top line, before the theme switch | `ustabasi.notifications` | drive: "the bell on the line counts what the queue sent, a notice opens its ticket, and the ticket page ends on its Report" |
| Read a ticket's Report (main, 7 Oct) | Ticket page; on its own for a ticket with no card | Ticket page, above the Agent face; on its own for a ticket with no card | `ustabasi.report` | drive: "the bell on the line counts what the queue sent, a notice opens its ticket, and the ticket page ends on its Report" |

## Phone

| Action | Old place (main) | New place | Call | Proof |
|---|---|---|---|---|
| Go to Dashboard / Chat / Machine | Tab bar | Top line on every place | — | phone: "reaches Chat and Machine in one press" |
| Scope to a product | Project bar | Tiles, dormant ones as rows | `divan.snapshot` | phone: "tiles open the project, the dormant one comes last as a dimmed row" |
| Everything waiting | Needs-you counter | Needs you › Waiting on you | `ustabasi.note`, `divan.card.move`, `divan.project.open` | phone: "Waiting on you says the counts, three groups oldest first" |
| Ask / file / start | New chat pen; + ticket | Dashboard Composer (Ask, Ice Box, Start now) | `chat.create`, `chat.send`, `divan.card.create` | phone: "Ask: one press sends chat.create then chat.send with the words" |
| Pick agent / account / model | New chat sheet | Composer chips; the sheet behind More options | `chat.create` | phone: "four chips show the defaults, list what the computer reports" |
| New chat with every option | Pen / sheet | More options | `chat.create` | phone: "New chat with every option starts one through createChat" |
| Answer an asking agent | Waiting / card page | Needs you amber answer; ticket question card | `ustabasi.note` | phone: "the amber answer sends the Waiting screen’s note in one press" |
| Move a card | Board long-press drag | Same, onto a column tab | `divan.card.move` | phone: "that move is divan.card.move with the In Progress column" |
| New ticket | + ticket | Board + / project + New ticket | `divan.card.create` | phone: "Ice Box files the card into Ice Box and Start now into In Progress" |
| Say something to the run | Card note box | Ticket › Live say box | `ustabasi.note` | phone: "a sentence typed into Say one sentence to the agent is sent as ustabasi.note" |
| What the queue sent (inbox) | Inbox row on the dashboard (added on `main`, a50ee2c) | Inbox row on the Dashboard above the queue row; `/inbox` | `ustabasi.notifications` | phone: "the screens ask the computer for these and no more" — names the call only; the row itself is not pressed in a test |
| A ticket's report | End of the ticket page (added on `main`, a50ee2c) | Same | `ustabasi.report` | phone: "the screens ask the computer for these and no more" — names the call only; the row itself is not pressed in a test |
| Hand a card to someone | Card page | Ticket side rows › Executor | `divan.card.executor` | phone: "Executor sends divan.card.executor" |
| Read a ticket cold | `/ticket/<n>`, `/card/<id>` | Same, one page; old run at `?run=1` | `divan.card.get`, `ustabasi.run` | phone: "a ticket link opened cold draws the ticket" |
| Open a branch | Branch cards | Branch rows | — | phone: "a branch with no source says Source not connected yet. and no number" |
| Chat: send, stop, approve, picture, voice note | Conversation | Same | `chat.send`, `chat.interrupt`, `approval.respond` | phone: "Allow sends approval.respond, Stop sends chat.interrupt" |
| The chat list | Chat tab | Earlier (`/chat?all=1`) | `chat.list` | phone: "the Chat place goes straight into the newest chat, Earlier opens the list" |
| Archive / delete a chat | Chat list row | Earlier list row | `chat.update`, `chat.delete` | phone: "a row archives (updateChat) and deletes (deleteChat, after asking)" |
| Groups | Chat list | Earlier list | `group.create`, `group.rename`, `group.delete` | phone: "a group is made (createGroup), renamed (renameGroup) and deleted (deleteGroup)" |
| Chat settings, delete chat | Chat settings | Same | `chat.update`, `chat.delete` | phone: "chat settings save through updateChat and Delete chat asks, then deleteChat" |
| Model sheet | Model sheet | Same | `chat.update` / local defaults | phone: "the model sheet writes setDefaults" |
| Pair a computer | Machines + | Machine › Machines › + Pair | `hello` | phone: "pairing a phone still adds the computer and lands home" |
| Switch computer | Computer picker | Machine › Machines › Computer picker | `hello` | phone: "the computer picker switches computer (switchHost)" |
| Remove / revoke a computer | Machines long-press, Settings | Same | `device.revoke_self` | phone: "Revoke removes the computer" |
| Remote screen, Agents, Accounts, pool, queue, Call | Machine list | Under the four Machine tabs | `screen.*`, `agent.*`, `account.*`, `pool.*`, `ustabasi.*`, `call.*` | phone: "Machine has four tabs at their own routes" |
| Accounts: add, rename, sign out, delete | Accounts | Machine › Executors › Accounts | `account.create`, `account.rename`, `account.logout`, `account.delete` | phone: "Accounts adds (createAccount), renames, signs out and deletes an account from its menu" |
| Sign in | Account login | Same | `account.login` | phone: "signing in still sends account.login" |
| Enter the sign-in code, cancel a sign-in | Account login | Same | `account.login.submit`, `account.login.cancel` | phone: "signing in still sends account.login" — proven up to the code field: the harness draws a screen once and cannot hold typed text, so the press that sends the code is not driven on the phone (the screen and its store call are unchanged from `main`; the same request is driven on the web) |
| Move a sign-in from another computer | Accounts | Same (one press) | `account.export`, `account.import`, `account.forget` | phone: "Move a sign-in is one press from Accounts" |
| Agents: install, remove | Agents, store | Machine › Executors › Agents | `agent.install`, `agent.remove` | phone: "holding an installed agent asks, then removes it (removeAgent)" |
| Install from the store | Agent install | Same | `agent.install` | phone: "Install sends installAgent" |
| Sign-in pool | Pool | Machine › Executors › pool | `pool.set` | phone: "the pool switch writes setPool" |
| Software update | Settings | Machine › Settings | `update.apply` | phone: "Update now sends applyUpdate" |
| Notifications, default model | Settings | Machine › Settings | `device.prefs` | phone: "Settings writes setDevicePrefs, the default model through setDefaults" |
| Face ID | Settings | Machine › Settings | — | phone: "Face ID on launch is written with setPrefs, and turning it off asks Face ID first" |
| Default account and model | — | Machine › Settings | — | phone: "the default account and model set in Machine › Settings are what the Composer’s chips show" |
| Call the computer | Settings › Call | Machine › Settings › Call | `call.ask` | phone: "answering a call still opens the call screen" |
| Inbox: what the queue sent (main, 7 Oct) | Dashboard Inbox row | Dashboard foot, between the queue and Conversations | `ustabasi.notifications` | phone: "phone: the Dashboard's Inbox row counts what the queue sent and opens the list, a notice opens its ticket, and the ticket page mounts its Report" |
| Read a ticket's Report (main, 7 Oct) | End of the queue ticket page | Same | `ustabasi.report` | phone: "phone: the Dashboard's Inbox row counts what the queue sent and opens the list, a notice opens its ticket, and the ticket page mounts its Report" |

Nothing on `main` is missing on `divan-ui`; `test-inventory.mjs` also fails if any request
or event type the clients name is absent from this file. Two phone rows are proven less
far than the rest, and say so in their row: entering a sign-in code (the harness cannot hold
typed text) and moving a sign-in (it needs two live computers, so the check proves the
screen is one press from Accounts but cannot send `account.export` / `account.import` / `account.forget`).
Both screens are byte-for-byte the ones on `main`.

Fixed on the way, because it blocked a `main` action: on the web, a sign-in that asked for a
code left its sheet busy, so Verify could never be pressed (`Preferences.tsx`, the same on
`main`).

## Events the clients only listen to

No press sends these; the daemon pushes them and the screens above redraw from them:
`account.login.done`, `account.login.prompt`, `account.switched`, `agent.activity`,
`approval.request`, `approval.resolved`, `chat.created`, `chat.deleted`, `chat.updated`,
`daemon.restarting`, `pool.exhausted`, `pool.updated`, `tool.install.output`,
`tool.result`, `tool.use`, `update.applied`, `update.available`. The reads a screen makes on
its own when it opens — `chat.get`, `chat.list`, `host.info`, `host.projects`,
`host.status`, `limits.get`, `call.hello`, `device.prefs`, `account.list`, `agent.list` — are
named in the rows of the pages that make them or here.

## Where a screen departs from its frame, and why

Built screens were held up against the twelve frames (structure, `dv-` classes, wording),
in both themes. Sample text and numbers in the frames are not shipped; differences that
are only sample data are not listed.

- **Dashboard.** No name in the greeting ("Good evening.") — nothing reports who is
  reading. The scope chip says "+ project" (the frame: "+ project, branch or executor") —
  branches and executors are not scopes the daemon takes. The four §5 pickers sit under
  the mode segment (§5 is not drawn).
- **Project.** No "+ branch" chip: the daemon has no request that makes a branch. The
  Repositories button keeps the old Branches tab reachable. Still open sits in the side
  column under the Timeline (kept from `main`).
- **Board.** Executor names left In Progress and Done cards; review cards show inside In
  Progress as "testing" (four columns are drawn, the daemon has five). "testing 3/4" is
  "testing" — nothing counts a verifier's checks.
- **Ticket.** The wall's queue buttons (Stop, Run next, Restart, Edit, Delete) sit under the
  side column — they had to go somewhere and the frame has none. "Runs alone" says
  "off · not settable yet": the daemon stores no such setting.
- **Waiting.** A group with nothing in it is not drawn (the frame shows all three full).
- **Branch.** No pull-request or red-check figures on the web: there is no data source for
  them; the repositories are the branch's own list instead.
- **Chat.** The conversation keeps its head (title, account, model, effort, mode, folder,
  Details, menu) — the frame draws none, but each is a `chat.update` that `main` had. The
  box is the frame's `dv-glass-strong dv-composer`, with attach, mic and send. "Earlier"
  and "Hermes" sit on a quiet row under the top line, not in it.
- **Machine.** The executors list is per machine and per worker from the boards
  ("Coder · studio · busy"), not the frame's fixed four kinds. The quota ring says "left of
  the plan" — the data does not say which window. The old pages sit under each tab as a
  row of links.
- **Phone.** Dashboard, Project and Board follow their phone frames. Everything else on the
  phone was derived (below).

## Derived, because no frame draws it

- The phone's Ticket, Waiting, Branch, Chat, Machine and New ticket: the web layout with the
  side column dropped below and card grids turned into row lists (HANDOVER §4 intro).
- §5's pickers on both platforms, the Machine sub-pages (Remote screen, Sessions, Folders,
  Admin, Update, Agents, Accounts, Quota thresholds, This computer), the palette, the
  question windows, the chat list behind Earlier, and the narrow web layout (390px): kept
  as they were on `main`, in the design system's tokens.
- On the web at 390px every press is at least 44px, side columns drop below the main one,
  a chat list sits above its chat, and the chat head's chips wrap.

## Still needs a person's eyes

- The question windows open by themselves on project pages; at 390px wide they cover most
  of the page until put away (as on `main`).
- Machine › Sessions and plan limits: a row is a button that holds Stop / Answer buttons
  (a button inside a button). It works, but it is on `main` too and wants a layout change.
- The tone of Night and Day side by side: pictures of every route in both themes at both
  widths are in the ticket's shots (`web-<page>-<night|day>-<width>.png`).
- The Agent chip defaults to Hermes when the computer lists a `hermes` agent; the live
  daemon on the studio does (`agents.listing` returns `user:hermes`, installed).

## Retired

`web/scripts/audit-frames.mjs` and `app/scripts/audit-frames.cjs` compared the clients with
the *old* frames (Web12–15, Mobile1–6) and are removed; `docs/audit/2026-09-30-*` are marked
retired. This file is the comparison now.
