# Divan — screen list (append to the design brief)

Machines: the operator runs work on more than one computer. A machine is never
the top-level context — the project is — but every running task knows which
machine it is on, and the whole dashboard is only as fresh as the machines it
could reach. Staleness is information and must be visible, not hidden.

## Core screens

1. **Dashboard** — the opening screen. Every project in a scannable list: what
   is running, what is waiting on him, whether the project is alive at all. A
   thin system line above or below carries two facts only: which machines are
   reachable, and whether there is enough agent quota left to work today. Both
   have a bad state that must be unmistakable without shouting.

2. **Waiting on you** — everything that needs a human, across all projects, in
   one place: a blocked task with its one-sentence question, a decision, a task
   whose executor is the man himself. Answerable in one tap where possible.
   May live inside the Dashboard, but design it as a thing in its own right —
   it is the screen that replaces asking.

3. **Project** — one product alone. A line of what is happening right now, what
   is waiting, and a set of branch cards (Engineering, SEO, Analytics,
   Marketing, Customers; the number is open-ended). Each card: one line of
   status, two or three numbers, when it was last refreshed. The third number
   differs per project — a money figure, an error count, a test suite, a build.
   Some projects have no third number and the card must still look finished.

4. **Board** — Ice Box / Queued / In Progress / Done, per project. Touch drag,
   one-handed. Dropping into In Progress starts an agent; design that moment.
   The column is intent, the status is reality: the card carries the agent's
   real state (picked up, stuck, asking, under review, failed) and, when there
   are several machines, which machine it is running on — all on a small card
   that must stay calm.

5. **Ticket** — two faces. Human face by default: one-line title, two or three
   sentences, executor, state. Agent face collapsed: goal, done-criteria, test
   commands, constraints, file paths, notes to the agent. A third, live view:
   what the agent is doing right now, and a way to say one sentence to it
   mid-run. Also: which machine it is on.

6. **New ticket** — the fastest screen in the product. A title and two or three
   sentences, and nothing else required. Executor and agent-face detail can be
   filled later or by an agent. No wizard, no approval step.

7. **Branch page** — one design serving any branch. The branch's own status,
   its numbers over time, a log of what its agent did and when, and the tickets
   belonging to it. Engineering is the densest variant (repositories, recent
   commits, open pull requests, failing checks) and should be shown, but the
   layout must not be built around it.

8. **Chat** — a single continuous conversation with one assistant. No thread
   list, no new-chat flow, no project picker. The project the assistant has
   filed the current stretch under is visible but passive. A message can become
   a ticket in Ice Box in one gesture. Voice: the assistant can be called and
   spoken to.

9. **Executors** — who can do work: coding agents, branch agents, the
   assistant, the man. For each: what it is for, which machine it runs on, what
   it is doing now, and whether it is idle, busy or unavailable.

10. **Machines** — the computers. For each: reachable or not, how long since
    last contact, how much work is running on it, agent quota remaining and
    when it resets, and a way through to its terminal and remote screen. This
    is also where a machine is paired or removed.

11. **Machine drawer** — the infrastructure a person visits monthly: terminals,
    remote screen, accounts and sign-ins, quota thresholds, admin, settings.
    Designed to be findable and forgettable.

## States that must be drawn

- Nothing waiting on him anywhere — the common case; should feel calm and
  earned, not like a screen that failed to load.
- A machine unreachable: the dashboard is stale and says how stale.
- Quota exhausted: agents cannot work until a reset time.
- A task whose agent is stuck, and one that is asking a question.
- A task whose executor is the human.
- A project that has had no activity in weeks.
- A brand-new project with an empty board.
