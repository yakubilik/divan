# Reviewing a plan, or shaping a ticket

Read this before agreeing to a plan, and before filing a card as a ticket —
whoever picks the ticket up works alone, so what is unresolved here is
unresolved for them.

## First, challenge the premise

Four questions, in this order, before any review of the plan as written:

1. **Is this the right problem?** Would a different framing make it
   dramatically simpler or dramatically more useful?
2. **What is the actual outcome wanted** — and is this the most direct path to
   it, or is it solving a proxy for it?
3. **What happens if we do nothing?** Real pain, or imagined pain.
4. **What already does this?** Map every part of the plan to code that exists.
   Rebuilding something the repo already has is the most common failure here,
   and it is invisible unless somebody looks.

## Then: two or three ways to do it

Never one. Name each approach, and for each give effort (S/M/L/XL), risk, two
or three real pros and cons, and what existing code it reuses. One of them must
be the minimal version that achieves the outcome; one must be the version you
would build with no constraints.

Then recommend one, with the reason. Ask before proceeding — this is the
decision, and it is not yours.

## Scope is an explicit choice

Pick one and hold it. Do not drift, and never add or drop scope silently.

- **Hold** — scope accepted, make it bulletproof. Default for a bug fix, a
  hotfix, or a refactor.
- **Reduce** — find the minimum that achieves the core outcome, cut the rest.
  Default for anything touching more than about fifteen files.
- **Expand selectively** — current scope is the baseline; surface each
  expansion separately so it can be taken or left one at a time.
- **Expand** — propose the ambitious version. Only for something greenfield,
  and only when the ambition was asked for.

Every scope change is opted into, one at a time. A batch of five proposals gets
one distracted yes.

## What a plan has to answer before it is a ticket

- **Done** stated as something observable, not as "works correctly".
- **How it is verified** — the command, the URL, the thing to look at. A
  ticket with no way to check it cannot be finished, only abandoned.
- **Every failure mode named.** Not "handle errors": which error, what triggers
  it, what catches it, what the person sees.
- **The shadow paths.** Every data flow has a happy path and three others:
  absent input, empty input, and a failure upstream. Walk all four.
- **What is deliberately out**, written down. A deferral nobody wrote down is
  not a deferral.

Nothing in here licenses writing code. Reviewing a plan is the whole job.
