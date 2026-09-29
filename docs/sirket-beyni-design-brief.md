# Design brief — Divan

Prompt to hand to a design tool. Deliberately states no visual direction.

---

Design a product called **Divan**: the single screen a one-person company is
run from.

## Who uses it

One person. He builds and ships several products at once (a SaaS, a couple of
mobile apps, a content site). Most of the actual work — writing code, running
SEO, pulling analytics — is done by AI agents that run on his machine around
the clock. He is almost always on his phone, often standing up, often for
under a minute at a time.

His complaint about every tool he has tried: he has to go and ask. Open a
thread, type "what's the status", read three paragraphs, do that five times for
five projects. He wants to open one screen and *see*.

## The one rule

**Anything he would have to ask for is a screen. Reading, never interrogating.**
If the design makes him tap through to find out whether something is on fire, it
has failed.

## Surfaces

- **Primary: iOS phone, portrait.** This is where 95% of use happens. Design it
  first and design it properly; nothing important may be desktop-only.
- **Secondary: desktop web console.** Same design language, more room. Not a
  stretched phone layout.

## The structure

Three places, and only three: **Dashboard**, **Chat**, **Machine**.
(Machine is the boring infrastructure drawer — terminals, remote screen, admin,
settings. It exists, it is visited monthly, it must not compete for attention.)

### Dashboard — the opening screen

Every project, one after another. For each: what is happening right now, and
whether anything is waiting for him. He should be able to answer "is anything
on fire, anywhere" in about two seconds, without scrolling if possible.

Above or within it: the things that want something from *him*. A blocked task
with its question, a decision nobody else can make. When there is nothing, the
screen should say so plainly and feel calm — this is the common case and it
should feel like good news, not like an empty state that failed to load.

Also visible: which agent is working on which task in which project, and its
state. States are: running, blocked, asking a question, finished, failed.

### Project

Tap a project, get that project alone. A product is not a code repository — it
has **branches** of work, each of which is a face of the same product:
Engineering, SEO, Analytics, Marketing, Customers. More can be added later, so
the design must absorb an unknown number of them without being redrawn.

Each branch is a card: one line of status, two or three numbers, and when it was
last refreshed (some branches are updated by an agent overnight, so staleness is
real information). Tapping a card opens that branch's own page.

### Board

Each project has a board: **Ice Box → Queued → In Progress → Done**. Cards are
dragged between columns *on a phone*, one-handed. Dragging a card into In
Progress is what starts an agent working — this is the single most important
gesture in the product and it deserves real attention, including what it feels
like at the moment the agent picks the card up.

Crucial subtlety: **the column is his intent, the status is reality.** He moves
cards; agents do not. An agent's real state (picked it up, got stuck, asked a
question, passed review) appears *as a marking on the card* without moving it.
Both facts must be legible on one small card at the same time, without the card
turning into a dashboard.

Cards are ordered top to bottom by priority. There are no dates and no calendar.

### Ticket — two faces

Every task has two faces and this split is the heart of the product.

- **The human face:** a one-line title and two or three sentences of what is to
  be done. Nothing else, ever. The space must be *physically* small enough that
  no one can pad it out — this is a design constraint doing a job that a rule
  could not.
- **The agent face:** the goal, done-criteria, test commands, constraints, file
  paths, notes to the agent. Arbitrarily long, technical, collapsed by default,
  one tap away when he is curious.

Each task also has an **executor**: a coding agent, a branch agent, a research
assistant, or the man himself. When it is him, there is no machine running — the
card is simply waiting on a human and should read that way.

### Chat

One single, continuous conversation with one assistant. He never picks a
project, never starts a new thread, never manages a list of chats. The assistant
files the conversation under the right project behind his back, so a project
page can show the conversations that belong to it. The chat is where he
intervenes; it is not where he checks up on things.

## Hard constraints

- **No approval walls.** No modal that asks "shall I proceed?", no twenty-line
  plan he must read before anything happens. When the system genuinely needs
  something from him it asks exactly one sentence, answerable with one tap.
- **No system alerts or native action sheets.** Anything that pops does so in
  the product's own language, anchored to the thing that triggered it.
- **Density without noise.** Many projects, many branches, many cards. It must
  stay scannable at arm's length, with real hierarchy — not a uniform grid of
  equally loud boxes.
- **Long-lived screen.** It is open every day for years. It has to wear well:
  no novelty that becomes irritating by week three.
- **Dark and light, both first-class.** Most use is at night.

## What to deliver

Propose the visual direction yourself — typography, colour, density, motion,
the personality of the thing. Do not ask which direction is wanted; make the
argument with the work. Two or three distinct directions are welcome if they
genuinely differ in idea rather than in accent colour.

Show at minimum: the Dashboard with several projects and something waiting; the
Dashboard with nothing waiting; a project page with its branch cards; a board
with cards in every column, including a card whose agent is stuck and a card
whose agent is asking a question; a ticket in both faces; and the moment a card
is dragged into In Progress.

Copy in English. Invent realistic names and numbers rather than lorem ipsum —
the design has to survive real content.
