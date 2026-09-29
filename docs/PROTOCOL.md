# WebSocket protocol (v1)

Endpoint: `ws://<host>:8790/ws?token=<token>` (or `Authorization: Bearer`).
A wrong token closes with 4401. Five failed attempts from one IP within ten
minutes earns a temporary lockout.

## Envelope

Request (client → daemon):
```json
{"id": 12, "type": "chat.send", "data": {...}}
```
Reply:
```json
{"id": 12, "type": "ok", "data": {...}}
{"id": 12, "type": "error", "data": {"message": "..."}}
```
Event (daemon → client, unasked):
```json
{"type": "event", "event": "text.delta", "chat_id": "ab12", "seq": 1042, "data": {...}, "ts": 1757000000.1}
```
`seq` is set on durable events (the ones written to SQLite) and `null` on live
ones. After a reconnect, `chat.get {since_seq}` replays the durable events that
were missed.

Every connected client has a queue of its own on the daemon side, and a writer
that drains it. A client that stops accepting — a phone in a pocket, a laptop
that slept — is closed once it falls a thousand events behind or takes twenty
seconds over one message, rather than waited for: a turn awaits the events it
emits, so waiting on one dead socket used to stop the turn itself, and every
other device watching it.

## Requests

| type | data | returns |
|---|---|---|
| `hello` | `{device_name?, push_token?}` | `{host, catalog, device}` |
| `ping` | – | `{ts}` — the client's heartbeat. A socket can die without either end being told (the computer slept, a NAT dropped an idle flow) and the client goes on reporting it open while the turn it is watching silently stops arriving. Both clients ask every 15 s and give up on the socket after 10 s of silence |
| `host.info` | – | host information |
| `host.models` | – | `{claude: {models, efforts, perm_modes}, codex: {...}}` |
| `host.projects` | – | `{projects: [{path,name,is_git}], roots}` |
| `host.git` | `{paths?}` | `{repos: {<path>: {is_git, branch, dirty, staged, untracked, subject, author, committed_at}}}` — read-only git status, for the desktop panel's project grid. Without `paths`, every allowed project. Runs in a thread pool behind a 20 s cache. `host.projects` does not carry this: the phone's folder picker would have to wait on dozens of git calls every time it opened. |
| `device.prefs` | `{push_approval?, push_done?, push_token?}` | the device's current preferences |
| `device.revoke_self` | – | revokes this device's token |
| `group.list` / `group.create {name}` / `group.rename {group_id,name}` / `group.delete {group_id}` | | |
| `chat.list` | `{include_archived?}` | `{chats, groups}` |
| `chat.create` | `{provider, model?, effort?, perm_mode?, cwd?, group_id?, title?, max_turns?, max_budget_usd?, pool_pinned?}` | chat. Omitted fields take the first thing the tool offers — except `perm_mode` on a chat with an `agent_id`, which defaults to `bypass`: an agent is work handed over, and a delegated turn that stops on the first prompt has been stopped rather than delegated. Sending `perm_mode` still decides it; this is only what happens when nobody does |
| `chat.get` | `{chat_id, since_seq?, limit?}` | `{chat, events, pending_approvals, busy, more, truncated}` — `events` are shaped like the envelope's events (`{event, chat_id, seq, data, ts}`). At most `limit` (500) at a time, and **which end** depends on the ask: `since_seq: 0` is a cold open and is answered from the *tail*, with `truncated: true` when there is older history above it; a `since_seq` is a catch-up and is answered forward, with `more: true` while events remain. A client that stops on `more` leaves a hole in its own timeline — the live feed only ever appends — so it asks again from the last seq it got until `more` is false |
| `chat.update` | `{chat_id, ...fields}` | chat (changing model/perm/cwd rebuilds the provider; the resume id survives) |
| `chat.delete` | `{chat_id}` | – |
| `chat.send` | `{chat_id, text, attachments?: [{path}]}` | `{accepted, queued}` — if a turn is running the message is queued (`queued: true`) and runs in order once the turn ends; `chat.interrupt` empties the queue. A full queue (20) returns `error: busy` |
| `chat.interrupt` | `{chat_id}` | – |
| `approval.respond` | `{chat_id, request_id, decision: allow \| allow_session \| deny}` | – |
| `limits.get` | – | `{accounts: {<account_id>: [window, …]}}` — the last word on every plan, as the tool reported it |
| `pool.get` | `{provider?}` | `{settings, accounts}` — see *The account pool* |
| `pool.set` | any of `{enabled, threshold, thresholds, use_overage, overage_by_account, reserve, order, max_hops}` | `{settings, accounts}` — only the keys sent are changed |
| `ustabasi.list` | – | `{available, tickets, queue}` — a snapshot of the ustabasi ticket queue, if this computer runs one. `available: false` is the ordinary answer: most computers have no queue, which is not an error and not an empty one. A ticket carries `{id, title, status, stage, round, repo, branch, goal, done_criteria, escalation, verdict, notes, note_count, last_event, …timestamps}`; `status` is one of `queued running done blocked failed cancelled`, and `escalation` is what a stopped worker is waiting to be told (on a finished ticket, its closing report). `queue` is `{last_tick, paused_until}` — the supervisor stamps `last_tick` at the start of every tick, and a stale one means the queue is not running whatever the tickets say. Read-only, and read straight from that queue's own database |
| `ustabasi.note` | `{id, text}` | `{ok, message}` — answer a ticket that stopped to ask. Runs the queue's own CLI: the note is appended, the escalation cleared and a blocked or failed ticket put back in front of the worker, which is that program's sequence to define rather than this one's to copy. The only write this daemon makes to that queue — starting work, cancelling it and editing a card all stay on the other side of that CLI. `error: ustabasi_refused` with the CLI's own words when it says no |
| `ustabasi.run` | `{id, cursor?}` | `{available, reason, run, events, cursor, reset, live, caught_up, size}` — what the agent on that ticket has printed, a page at a time. Every run writes the model's stream-json to a file that is hundreds of kilobytes long by the time a worker is done, so a first open (no cursor, or one naming another run) answers with the **end** of it and `reset: true`; every later call with the cursor it gave back answers with what has been appended since, and a poll that finds nothing is a couple of hundred bytes and an empty `events`. A page is capped in records **and** in bytes, and a reader that has fallen further behind than one page is moved up to the end with `reset: true` rather than made to read its way there. `cursor` is `<run directory name>:<byte offset>` and carries no path. `live` is a run that is still being written — the ticket is running and the queue has not written its exit code. `reason` is the silence, where there is one: `no_queue`, `no_ticket`, `never_run` (nobody has been handed this ticket yet), `no_log`; each answers the same shape, with no events, no cursor and `caught_up: true`. Read-only |
| `update.status` | `{refresh?}` | `{repo, auto, behind, ahead, busy, error, checked_at, local, remote, web, release, latest, last_update, blockers}` — where this computer stands against `origin/main`. `refresh` costs a `git fetch`, so clients only send it when someone is looking. `local` and `remote` are commits, not version numbers: the package version is a constant and cannot tell two computers apart. `web` is the bundle the browser is being served (below). `blockers` is why an update cannot run right now, in words a phone can show — `already up to date`, `uncommitted changes`, `unpushed commits`, `a turn is running` |
| `daemon.status` | – | `{started_at, uptime_s, restarts, pending, draining, last_restart, supervisor}` — what a restart would cost right now. `pending` is one row per chat holding work a stop would destroy: `{chat_id, busy, queued}` |
| `daemon.restart` | `{reason?, force?, timeout_s?}` | `{ok, draining, pending, deadline, reason, supervisor}` — stop, so the supervisor starts us again on whatever is on disk. **Drains first:** new `chat.send`s are refused with `restarting`, turns in flight are allowed to finish, and only then does the process exit. Each chat's CLI is a child of this process, so killing it kills every turn mid-sentence — that is what the draining is for. When the deadline passes the restart is **abandoned**, not forced: `daemon.restarting {state: "cancelled"}` and the daemon carries on. `force` waives the waiting and only that. Refused with `no_supervisor` where nothing would bring the process back, unless `force` — doubt is not refusal, a platform this daemon cannot read goes ahead |
| `daemon.restart.cancel` | – | `{ok}` — changed your mind while it was still waiting |
| `ustabasi.list` | – | `{available, tickets, queue}` — the ticket queue on that computer, read-only, for the panel's second wall. `available: false` on a machine that does not run one, which is most of them. A ticket carries the queue's own row (`id, title, status, stage, round, repo, branch, created_at, updated_at, started_at, finished_at, goal, done_criteria, escalation, verdict, notes, note_count, last_event`) and three readings the queue does not store: `project` — the project the repository belongs to, by the same rule as a chat title's prefix; `round_started_at` — when the current round began, which is not `updated_at` and not `started_at`; and `git: {commits, subject} | null` — what the worker has committed on the branch, read from its worktree. All three are `null` where there is nothing to say, and the wall then shows nothing rather than a placeholder. `steps` is the fourth: the stage history read out of the events table, oldest first, each `{stage, round, at, ended_at?, outcome?, pid?, model?, account?, note?}` — `outcome` is `ok`, `rejected`, `blocked`, `failed`, `cancelled` or `stopped`, and the one step with no `ended_at` is the one running now. Absent keys are absent rather than null: a wall of twenty tickets carries a hundred of these |
| `ustabasi.note` | `{id, text}` | `{ok, message}` — answer a ticket that stopped to ask a question. The one write, and it runs the queue's own CLI rather than touching its database: a note clears the escalation and puts the ticket back in the queue, and that sequence is the other program's to define. `ustabasi_refused` carries the CLI's own words |
| `ustabasi.run` | `{id, cursor?}` | `{available, reason, run, events, cursor, reset, live, caught_up, size}` — what the agent on that ticket has printed, a page at a time. Every run writes the model's stream-json to a file that is hundreds of kilobytes long by the time a worker is done, so a first open (no cursor, or one naming another run) answers with the **end** of it and `reset: true`; every later call with the cursor it gave back answers with what has been appended since, and a poll that finds nothing is a couple of hundred bytes and an empty `events`. A page is capped in records **and** in bytes, and a reader that has fallen further behind than one page is moved up to the end with `reset: true` rather than made to read its way there. `cursor` is `<run directory name>:<byte offset>` and carries no path. `live` is a run that is still being written — the ticket is running and the queue has not written its exit code. `reason` is the silence, where there is one: `no_queue`, `no_ticket`, `never_run` (nobody has been handed this ticket yet), `no_log`; each answers the same shape, with no events, no cursor and `caught_up: true`. Read-only |
| `update.apply` | `{force?}` | `{ok, error, pulled, web, restarting, revision}` — fast-forward onto `origin/main` **and** rebuild the panel; either half can be the only work there is. Never anything but a fast-forward, and never on a checkout with uncommitted or unpushed work — `force` waives only *waiting* (being behind, being idle), never somebody's work. A pull ends by asking the supervisor to restart the daemon, so the answer arrives before the socket drops and there is nothing to re-read afterwards; a panel-only rebuild restarts nothing |
| `divan.snapshot` | – | `{machine, os, os_version, daemon_version, at, projects, cards, agents, quota, queue}` — **everything this computer has to say about Divan, in one answer.** The phone is paired with several computers and the project is the context rather than the machine, so every Divan screen is every machine at once and has to ask all of them; asked project by project that is a dozen round trips per computer and a dozen waits on one that is asleep. `projects` is `divan.projects`' list, `cards` is the **open** board — every card outside `done`, since that column grows for ever and the counts already say how many are in it — and `agents` is one row per agent actually running (`{card_id, project_id, project, branch, title, executor, machine, status, detail, since, ustabasi_id}`); a card that stopped to ask is waiting on a person, not working, and is read as a card. `machine` is this computer's name, `at` is when the answer was true, and `quota` is `{enabled, accounts, blocked, spent, left, resets_at, unknown}` from the account pool: `left` is the share of a window the roomiest sign-in still has — not a number of turns, and `null` while nothing has ever been measured — and `resets_at` is when that goes back up, or when a spent machine starts work again. `queue` is `{available, last_tick, paused_until}`. The mirror runs first, as on `ustabasi.list`: a dashboard that read the board without it would draw a worker that finished at four in the morning as still running. Nothing here is merged or ranked — which machines a project lives on, and what a silent one's numbers are worth, is the client's to work out, because it is the only party that knows how long ago each machine answered |
| `divan.projects` | – | `{projects, machine}` — every product, each with its branches and one line saying where it stands. A project carries `{id, name, slug, summary, repos, branches, counts, running, waiting, summary_line}`; `repos` is a list because a product is a product and not a folder — isghocam owns its site and its API — and `counts` is its cards per column. `summary_line` is counted, never guessed: `2 running · 1 waiting on you · 5 queued`, with everything that is zero left out, and `nothing running` when all of it is. `waiting` is the dashboard's real number — an agent that stopped to ask, one that was turned down, and every card whose executor is a person. A branch carries `{id, kind, name, summary, summary_at, cards, open}`; `summary` is empty until that branch has a source connected, and a branch with nothing to say says nothing rather than a placeholder number |
| `divan.project.create` | `{name, repos?, branches?}` | the project, as `divan.projects` lists one. `branches` names kinds beyond the default five, so a product with a support desk gets a support branch without a migration. Every path in `repos` goes through the same fence a chat's `cwd` does — inside an allowed root, outside every denied path, and a folder that exists — because a repository is where an autonomous coding agent gets started with a shell: `cwd_outside` or `no_such_folder`. `bad_project` on an empty name or one this computer already has |
| `divan.board` | `{project_id}` | `{project, branches, columns}` — one project's board. `columns` is keyed by `ice_box`, `queued`, `in_progress`, `done`, each an array **in the order somebody put it in**: `position` is 0..n-1 with no gaps, and the order of `queued` is the only planning this product has. The cards here carry the human face and the marks (`executor`, `machine`, `agent_status`, `ustabasi_id`) and **not** the agent face — `divan.card.get` is where that lives. `no_such_project` |
| `divan.card.create` | `{project_id, title, summary?, branch?, column?, executor?, machine?, repo?, agent?}` | the card. Everything but `project_id` and `title` is optional, which is the point: a card written down mid-conversation is a line, and it lands in `ice_box`, which starts nothing. `branch` defaults to `engineering`, `machine` to this computer, `repo` to the product's first. A `repo` sent here goes through the path fence, as `divan.project.create`'s do: `cwd_outside` or `no_such_folder`. `agent` is `{goal?, done_criteria?, verify_cmd?, constraints?, paths?, notes?}` and may be left out entirely. `bad_card` on a missing title, a column or branch that does not exist, or an executor that is not one of the four |
| `divan.card.move` | `{card_id, column, position?}` | `{card, error}` — **the only request that writes a column.** `position` is the index in the target column *after* the card has left where it was: `0` is the top, past the end is the bottom, and omitting it means the bottom of a column the card is arriving in and no move at all within the one it is already in. Moving into `in_progress` on the `coding_agent` executor is what starts work — the card is filed as an ustabasi ticket and its number comes back as `ustabasi_id`. The repository the ticket would be filed against is checked against the allowed roots once more here, on the way out: the handlers fence a path on the way in, and what leaves through this door starts a shell in that directory. That half can fail on its own (no queue on this computer, no repository on the product, one outside the roots, the CLI saying no) and then `error` carries the reason **and the move still stands**: a card that springs back under your thumb is worse than a card with a red line on it. A card that already has a `ustabasi_id` is never filed twice, and filings are serialised, so two devices dragging one card at the same moment start one worker rather than two. A mirror poll that lands between the queue writing the ticket and the number being written back imports that ticket as a card of its own; that card is folded into the one that was dragged rather than left beside it, so there is never more than one card per ticket. `bad_move` |
| `divan.card.update` | `{card_id, title?, summary?, repo?, machine?, agent?}` | the card. Only what is sent is touched, and `agent` takes the same six fields `divan.card.create` does. This is where a card that was written down as one line grows an agent face — a goal, done criteria, a test — some time after the line. It cannot write a `column`, an `executor` or anything the mirror owns: each of those has a request of its own, and a field writable from two places is how a status update ends up dragging a card. A `repo` goes through the path fence here too. `no_such_card`, `bad_card`, `cwd_outside`, `no_such_folder` |
| `divan.card.executor` | `{card_id, executor, machine?}` | the card. One of `coding_agent`, `branch_agent`, `assistant`, `human`, or `null` to clear it — clearing is a value and not an omission, because a card whose agent was the wrong guess goes back to having none rather than to having a person. `machine` is only written when sent, so setting an executor twice does not forget which computer it was set on. `bad_executor` |
| `divan.card.get` | `{card_id, cursor?}` | `{card, project, ticket, run}` — one card with **both faces**: `card.agent` is `{goal, done_criteria, verify_cmd, constraints, paths, notes}` beside the human face's `title` and `summary`. `ticket` and `run` are the live half and are `null` on a card no coding ticket was filed for; where there is one, `ticket` is that ticket as `ustabasi.list` reports it and `run` is a page of what the worker has printed, paged by `cursor` exactly as `ustabasi.run` describes. `no_such_card` |

A record in `ustabasi.run`'s `events` is one block of the stream, by `k`:

| `k` | what it is |
|---|---|
| `text` | what the agent said |
| `thinking` | what it thought. Usually empty — the block is a signature and nothing else — and an empty one is not worth drawing |
| `tool` | a call: `{id, name, input}`. Every string in `input` is cut to a line's worth, and the whole again, so a file being written does not travel twice |
| `result` | what the call answered: `{id, text, error}`, cut to a couple of thousand characters |
| `done` | the run's own closing line: `{error, subtype, duration_ms, cost, output_tokens}` |
| `system` / `other` | a hook firing, a rate-limit warning, a line that was not JSON. Forty bytes each and nothing to read; they travel so that what is worth drawing is the client's decision and not this end's, and they are not counted against the page's record budget |

`clipped: true` on any of them means this end cut it.

`release` is what this computer calls itself, derived from tags rather than
declared: `{version, tag, distance, dirty, commit}`. `version` is `v0.2.0` on a
release and `v0.2.0+7` seven commits past one — a machine following `main`
between releases says so instead of rounding down to the last tag. `null`
before the repository's first tag, and on a copied install with no git.
`latest` is the newest tag reachable from `origin/main`, so one fetch answers
both "which commit" and "which version".

`last_update` is the last time this computer actually moved:
`{at, from, to, version, subject, pulled, web, error}`, read off disk because
the process that did it has since been restarted. `null` on a computer that has
never updated itself.

`host.info` carries three more that describe the process rather than the code:
`started_at` (when this daemon came up), `restarts` (how many times it ever
has — a restart is the one event a daemon cannot watch itself have, so it is
counted on the way back in), and `last_update`.

`web`, on `update.status` and inside `host.info`'s `update`:

| field | meaning |
|---|---|
| `built` | a panel exists in `daemon/remote_ai_chat/webui/` at all |
| `stale` | **three-valued.** `false` — built from the commit that is checked out, or from one after which `web/` never moved. `true` — `web/` has moved since. `null` — the bundle carries no stamp and cannot be placed, which is not the same as current and is treated as work to do |
| `sha` / `built_at` | the commit it was built from, and when |
| `npm` | whether this computer could rebuild it. Without Node it cannot, and `update.apply` will not pretend otherwise |
| `reason` | why it is stale or unplaceable, in one line |

The panel is build output and is not in git, while the daemon is an editable
install and therefore updates with a pull. Left alone they come apart, invisibly,
on exactly the machine nobody sits in front of — hence the stamp, and hence one
button for both.

## The Divan board

The daemon owns how work is arranged; the ustabasi queue stays the thing that
does coding work. Four tables in the daemon's own database hold it.

**Projects are products, not folders.** isghocam is a product, and its
repository is a detail of its engineering branch — it may have several, or none
at all. So `repos` is a list on the project rather than the project being one
path.

**Branches are the faces of a product**: `engineering`, `seo`, `analytics`,
`marketing`, `customers`, one row per project per branch, seeded when the
project is created. The set is open — `divan.project.create {branches}` adds
kinds beyond those five — because a product that grows a support desk should not
need a migration. Only engineering has a real source behind it today; the rest
report an empty `summary` and the client says so rather than drawing a number
nobody measured.

**Cards sit in one of four columns** — `ice_box`, `queued`, `in_progress`,
`done` — at an explicit `position` in it. There is no calendar and no due date:
planning is the order of `queued`, top to bottom, and it is an order somebody
arranged by hand rather than a sort. Positions are contiguous, and every request
that moves a card closes the gap behind it and opens one where it goes.

**A card has two faces.** The human face is `title` — one line — and `summary`,
two or three sentences. The agent face is `goal`, `done_criteria`, `verify_cmd`,
`constraints`, `paths` and `notes`, as long as it needs to be. Text an agent
produced never lands on the human face, including on the cards made out of
tickets that predate the board: their titles come across and their goals go to
the agent face. The board's card list carries the human face and the marks only;
`divan.card.get` is the one place both travel together.

**Every card has an executor, or none yet.** `coding_agent` is ustabasi and is
the only one this daemon can start. `branch_agent` is the overnight
SEO/marketing/customer kind. `assistant` is a one-off piece of research or
writing. `human` is a card nothing runs on: it waits for a person and shows up
in `waiting`. `machine` says which computer the work runs on.

### The column is intent; the status is reality

This is the rule the rest is built around, and it is why they are two fields and
not one.

`column` is written by exactly one request, `divan.card.move`, and that request
is a finger on a screen. `agent_status` is written by the mirror, on the poll of
either request that draws work — `ustabasi.list` for the wall, `divan.snapshot`
for the boards — and is one of:

| `agent_status` | the queue said |
|---|---|
| `queued` | filed, waiting for a slot |
| `running` | a worker has it |
| `asking` | `blocked`, with a question — `agent_detail` is the question. This is what "waiting on you" is made of |
| `blocked` | `blocked`, with nothing said yet |
| `failed` | the verifier turned it down, or it gave up |
| `verified` | the verifier passed it. **Not** the same as the `done` column, which is somebody deciding they are finished with it |
| `cancelled` | it was called off |

A worker that starts, stalls, asks or fails at four in the morning changes
`agent_status` and nothing else. The card stays exactly where it was left, with
a mark on it. The one exception is the **import**, which happens once per
ticket: tickets that existed before the board become cards on their product's
engineering branch, and their first column is read off their status because they
have to land somewhere honest. After that the column is the person's.

**A repository is a fenced path.** `repos` on a project and `repo` on a card are
checked against the daemon's allowed roots and denied paths exactly as a chat's
`cwd` is, on `divan.project.create`, `divan.card.create` and `divan.card.update`
— and once more inside `divan.card.move` before anything is filed. A card's
repository is the directory an autonomous worker is given a shell in, so it is
the last place on this daemon where an unchecked path from the wire would be
acceptable. Cards imported from the queue keep whatever repository the queue
recorded, which may be anywhere; they already have a ticket and are never filed
again, and the check on the way out covers them if anything ever tries.

The mirror is one way. The daemon reads the queue's database and writes what it
saw onto its own cards; the two writes in the other direction both go through
that queue's CLI — `ustabasi.note` to answer a question, and the filing that
`divan.card.move` does when a card is dragged into `in_progress` on the coding
executor. A card with no agent face is still filed: the summary stands in for the
goal and the title for the one done criterion the queue insists on, because a
board that demanded a specification before it would accept a drag would be a
form.

### One view across several machines

Every Divan surface is every paired computer at once. A project is the context
and the machine is a detail of a running task: isghocam's site may be checked out
on the studio and its API on the mini, and that is one project with cards on two
machines, not two projects.

The daemon cannot do the merging. Each one knows only its own board, and the one
fact the merge turns on — how long ago each machine last answered — exists only
where the asking happens. So `divan.snapshot` is one honest answer per computer
and the client merges them (`app/src/divan.ts`), which is also what keeps a
sleeping laptop from taking the view down with it:

* **one snapshot per machine, per event.** On connect, when the app comes
  forward, and on a slow timer. Every request is timed out, and a machine that
  does not answer is one wait rather than a dozen.
* **the last answer is kept.** A machine that has gone quiet does not disappear
  from the view and its cards are not deleted: they are shown as they were, with
  how long ago that was, and the counters say they are incomplete rather than
  quietly dropping five running agents.
* **freshness is per machine.** Reachable or not, and how long since the last
  successful contact — carried on every project, card and agent that came from
  it, so a screen can mark the two rows that came from the silent machine and
  leave the rest live.
* **the active computer is not the scope.** Which machine the phone holds a
  socket to decides where a terminal opens and whose screen is mirrored, and
  nothing else. Switching it does not change what a board or a dashboard shows.

## Push notifications

Content-free: no message text leaves the computer. The `data` of a notification
says what it is *about*, and the phone routes on that:

| key | what a tap opens |
|---|---|
| `chat_id` (with `kind` `approval` or `done`) | that chat |
| `ticket_id`, or `ticket` | that ustabasi ticket |
| `device_id` | which pairing it was sent to — a phone paired to two computers switches to the one that actually has the chat rather than opening it against whichever one it happens to be connected to |

This daemon sends the `chat_id` ones and no others. A ticket push comes from the
ticket queue itself, which is a separate program: it builds the notification out
of the ticket's number, its title and what happened, never out of the message —
an escalation quotes the worker and the worker quotes the repository, and none
of that belongs in a banner that travels through Expo's servers. It names the
ticket `ticket`; the phone takes `ticket_id` as well, because the key is an
agreement rather than one program's spelling of it.

A tap that launches the app cold is held until the keychain is open and Face ID
has been answered, then delivered — so it lands on the chat or the ticket rather
than on the list.

## Events

| event | durable | data |
|---|---|---|
| `host.status` | – | host information (on connect) |
| `chat.created` / `chat.updated` / `chat.deleted` | – | chat |
| `groups.changed` / `chats.changed` | – | `{groups}` / `{chats}` — the full list, when another device changes a group |
| `message.user` | ✓ | `{text, attachments}` |
| `turn.started` | – | – |
| `text.delta` | – | `{segment, text}` — the same `segment` appends to the same bubble |
| `thinking.delta` | – | `{text}` |
| `message.assistant` | ✓ | `{segment, text, attachments?}` — the segment's final form; replace the live text with this. `attachments` lists the files the text names by local path (see below) |
| `tool.use` | ✓ | `{id, tool, input}` |
| `tool.result` | ✓ | `{id, output, is_error}` |
| `approval.request` | ✓ | `{request_id, tool, input, preview, danger, reason}` |
| `approval.resolved` | ✓ | `{request_id, decision}` |
| `turn.done` | ✓ | `{cost_usd, usage, duration_ms, num_turns, stop_reason}` |
| `turn.error` | ✓ | `{message, code?}` — `code: "daemon_stopped"` is written on the way *back up*, for a turn that was running when the process ended. Nothing else could write it: `text.delta` is not durable and the answer only lands as `message.assistant` once it is whole, so without this line an interrupted turn is a question with silence after it and a chat that reads as idle |
| `limits` | – | `{window, status, utilization, resets_at, overage_status, overage_resets_at, overage_disabled_reason, is_using_overage, windows: [...], windows_complete}` — what is left of the plan. Only Claude sends it, only while a turn is running, and the account it describes is the one that chat is on. `windows` is every window; the fields beside it describe only the one the tool singled out. **`windows_complete` says whether `windows` is the whole plan.** It matters because a one-window list cannot be told from a complete list of one: where it is true, a window missing from the list is a window the plan no longer has and the stored copy must be dropped — an overage allowance that was spent stops being reported at all, and a client that merges instead of replacing draws a full ring from it for days. Where it is false or absent, the report adds to what is known and says nothing about what it omits |
| `account.switched` | ✓ | `{from, to, reason, provider}` — the pool moved this chat to another sign-in |
| `pool.exhausted` | ✓ | `{account_id, window, until}` — the plan is spent and there was nowhere to move to |
| `pool.updated` | – | `{settings, accounts}` — someone changed the pool from another device |
| `update.available` | – | the whole of `update.status` — the daemon holds the fetch loop and says so when it finds this computer behind, or its panel stale |
| `daemon.restarting` | – | `{state, reason, pending, deadline, forced}` — `state` is `draining` (waiting, and `pending` says for what; re-sent whenever that count moves), `stopping` (the sockets are about to close; reconnect rather than treating it as a dropped connection) or `cancelled` (it is not happening; sends are accepted again) |
| `update.applied` | – | `{revision, web, release, last_update, error}` — an update landed, this one's or somebody else's. `error` is set when the daemon updated but the panel did not rebuild |

Chat `status`: `idle | running | awaiting_approval`.

## The ordering rule (clients)

The timeline is the durable events, in `seq` order. Live `text.delta`s go into a
temporary "streaming segment" bubble; when `message.assistant` arrives, that
segment becomes permanent. A `tool.use` closes the segment before it.

## HTTP: uploads

`POST /upload` (multipart: `file`, `chat_id`), `Authorization: Bearer <token>`.
Returns `{path, name, size}`; `path` is then passed in `chat.send.attachments[]`.
Allowed extensions: png jpg jpeg gif webp heic pdf txt md json csv log · 25 MB.
Files stay under `~/.remote-ai-chat/uploads/<chat_id>/`.

## HTTP: files, both directions

`GET /files?path=<abs>&token=<token>[&download=1]` serves a file to a client.
Two kinds qualify: anything under the uploads folder (the phone sent it), and
anything the path policy allows — inside an allowed root, outside every denied
path, not a secret (`.env*`, keys, `.git/`, `.ssh/`, …). `download=1` sets a
`Content-Disposition: attachment` so a browser saves instead of showing.

The agent has no upload button. To show a file it writes the path into its
message as Markdown — `![caption](/abs/path.png)` or `[name](/abs/path.pdf)` —
and the daemon lifts every such path that the policy would serve into
`message.assistant.attachments[]`, each `{path, name, size, kind, url}` with the
same shape as an upload. The text is left as written. A client shows images
inline and the rest as an openable chip; a client that does not know about
attachments still shows a readable path. At most 12 per message.

A picture also carries `view`: a copy of it kept under the uploads folder, which
`/files` serves whatever happens to the original. Draw a bubble from `view` when
it is there and fall back to `path`; `path` is still what the message says, what
a download opens, and what the text is matched against. Without this a chat
scrolled back to shows a file name where a screenshot was, because the agent
cleaned up after itself.

## Codex mapping

| perm_mode | approvalPolicy | sandbox |
|---|---|---|
| suggest | untrusted | read-only |
| auto-edit | on-request | workspace-write |
| full-auto | on-failure | workspace-write |
| bypass | untrusted (the daemon auto-approves anything not flagged dangerous) | danger-full-access |

## Accounts and tools

| type | data | returns |
|---|---|---|
| `account.list` | – | `{accounts: [{id, provider, label, logged_in, detail, is_default}]}` |
| `account.create` | `{provider, label}` | account |
| `account.login` | `{account_id}` | `{started, provider, needs_code}` — the prompt goes **only to the asking socket** |
| `account.login.submit` | `{account_id, code}` | – (Claude only) |
| `account.login.cancel` | `{account_id}` | – |
| `account.logout` | `{account_id}` | account |
| `account.delete` | `{account_id}` | – (chats bound to it are released) |
| `account.export` | `{account_id}` | `{provider, label, detail, credentials}` — the stored sign-in |
| `account.import` | `{account_id, credentials}` | account + `{verified, verify_error}` |
| `account.forget` | `{account_id}` | account — deletes the sign-in **locally only** |
| `tool.status` | – | `{tools: [{provider, version, path}], npm}` |
| `tool.install` | `{provider, force?}` | `{provider, version, path}` — output streams |

## The account pool

Several sign-ins of one tool, driven as one. Off by default; `pool.set
{enabled: true}` turns it on. It is a mode, not a per-chat setting: with it on
every chat moves, and `chats.pool_pinned = 1` is the way out for a chat that has
to stay on one sign-in.

`pool.get` answers with both halves:

```
settings  {enabled, threshold, thresholds: {<window>: 0..1}, use_overage: "account" | "never", overage_by_account: {<account_id>: "account" | "never"}, reserve, order: {<provider>: [account_id, …]}, max_hops}
accounts  [{account_id, provider, label, blocked, window, until, utilization, on_overage, spending, step, margin, strict, unknown}, …]
```

`accounts` comes back in the order the pool tries them, which is `order` first
and then everything not named in it. An account is `blocked` when one of its
windows is at or past that window's line and has not reset since it was
measured. The line is per window — `thresholds` names the ones that differ,
`threshold` covers the rest — because the windows are not alike: `five_hour` is
held at 0.95 by default, since it refills several times a day and stopping
early there costs a couple of hours, while the weeklies sit at 0.99, where the
same 5% would be most of a working day. Pay-as-you-go rescues it — a sign-in that can spend past its plan
is reported `on_overage`, not blocked — unless `use_overage` is `"never"`. An
account nobody has run is `unknown`: it is tried, not assumed full.

`"never"` is the setting with money behind it, and it is decided **per sign-in**:
`overage_by_account` overrides `use_overage` for one account, so one can spend
past its plan while another never touches it. A sign-in under it reports
`strict: true`.

There is no flag that makes the CLI refuse overage — extra usage is an
account-level setting on Anthropic's side — so when an account *can* bill past
its plan and the user has said not to, the daemon is the only guard. Three
things make it one:

* `spending` (the tool's own `isUsingOverage`, read together with
  `overage_status`, as the CLI's own note says to) blocks the account on its
  own. It means paid usage is covering sends *now*, and no window reading makes
  that acceptable.
* A **margin**, sized by how coarsely this account actually reports. Readings
  arrive in jumps; the daemon records the widest jump one window has made
  between two consecutive readings (`step`) and holds that much back below the
  threshold (`margin`). Within one step of the line counts as over it. Until a
  step has been measured, `reserve` stands in for one (10% by default), and the
  measured one takes over when it is wider. This is the part that does not
  depend on a report arriving at the right moment — it bounds the only thing
  the daemon cannot see, which is what happens between two reports. The price
  is one step's worth of every window left unused.
* The interrupt comes before anything else. Choosing the next sign-in means
  asking the CLI whether it is still signed in, which is a subprocess; the
  running turn is stopped first and the session resolves where it goes after.

The same question is asked the same way whether a turn is about to open on an
account or is already running there. Being gentler on the running turn would
mean letting it continue into exactly the reading a new turn was not allowed to
start into.

None of this is load-bearing when extra usage is switched off on the account
itself: the platform refuses rather than bills, so a late move costs a dead turn
and not a cent (`overage_status: rejected` with an `overage_disabled_reason`).

A chat is moved at two moments:

* **before a turn opens**, which is free — nothing has been connected yet; and
* **while one is running**, on the `limits` report that crosses the threshold.
  The turn is interrupted, the chat is rebound, and the next sign-in is handed
  the chat's own transcript (the same recap a dropped session gets) plus a note
  saying it has walked into a turn already under way. Same model, same effort;
  a different context, so the move costs whatever the recap could not carry.
  Nothing queued behind the turn is lost.

Either way the chat's timeline gets a durable `account.switched`. The move
clears `provider_session_id`, as any account change does. When every sign-in is
spent the turn stops where it was interrupted, anything queued behind it is
dropped, and `pool.exhausted` says so on the timeline. Resuming on the spent
account would either be refused or — on a sign-in that bills past its plan — be
exactly the spending the pool was turned on to prevent.

Only Claude reports plan windows, so only Claude can be moved before it hits a
limit; a Codex chat in the pool is never handed over.

### Moving a sign-in to another computer

When the browser flow cannot be finished from the phone, a sign-in can be moved
off a computer that already has one. **It is a move, not a copy:** both CLIs use
single-use refresh tokens — whichever machine refreshes first gets the new
token and the other copy dies (Codex says so outright: `your refresh token was
already used`). So the order is:

1. The phone calls `account.export` on the source computer, over a separate
   socket.
2. `account.import` on the target writes the file with mode 0600 and then makes
   the CLI issue **a real request**. `auth status` only reads the local file and
   will call a revoked token "signed in"; `verified` is what tells them apart.
3. If verification passes, the phone calls `account.forget` on the source. That
   does not make the CLI log out: a real logout would revoke the token the
   target is now using.

`account.import` refuses to write into the computer's own (built-in) account: on
macOS that sign-in is read from the keychain, and the `imported` flag is not
kept for the built-in account.

Events: `account.login.prompt {account_id, provider, url, url_host, code, needs_code, expires_at}`,
`account.login.done {account_id, ok, detail, error, retryable}`, `tool.install.output {provider, line}`.
Those three are **not durable** and go only to the device that asked.

Chat-to-account rules: an empty `chats.account_id` means the computer's own
account. If the account was removed the turn is refused rather than quietly
falling back to the default. Changing account resets `provider_session_id`,
because the transcript store belongs to one account's folder.
