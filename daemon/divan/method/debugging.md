# Debugging a reported fault

**No fix without a root cause first.** A fix aimed at a symptom makes the next
bug harder to find, and on a queue that runs unattended it makes it harder for
somebody who was not here.

1. **Collect.** Error text, stack trace, the steps that produce it. If the
   report is too thin to act on, ask one question — not five.
2. **Read the path.** Trace from the symptom back through the code that could
   produce it. Search every reference to the failing thing.
3. **Check what changed.** `git log --oneline -20 -- <files>`. If it worked
   before, the cause is in the diff and the diff is short.
4. **Reproduce.** Deterministically, or say you could not and gather more
   before going on.

Then state it out loud: **"Root cause hypothesis: …"** — a specific, testable
claim, not an area of suspicion.

## Before writing the fix

Confirm the hypothesis with evidence: a temporary log line, an assertion, a
failing test at the suspected cause. Run the reproduction. Does the evidence
match? If not, back to step 1 — do not guess the next one.

**Three strikes.** If three hypotheses have failed, stop. Three failures is not
a fourth hypothesis, it is a sign the problem is not where the shape of the
code suggests. Say so, and offer: keep going with a named new hypothesis,
hand it to a person who knows the system, or instrument the area and catch it
next time.

Slow down if you notice any of these: "quick fix for now" (there is no for
now); proposing a fix before tracing the data; each fix revealing a new problem
somewhere else (wrong layer, not wrong line).

## The fix

The smallest change that removes the actual cause. Fewest files, fewest lines;
resist refactoring what happens to be next to it. Write a regression test that
**fails without the fix and passes with it** — a test that passes either way
proves nothing. Run the whole suite.

If the fix touches more than five files, stop and say so before going on. That
is large for a bug fix and usually means the cause was diagnosed one layer too
high.

## Finishing

Reproduce the original fault once more against the fixed code. Not optional —
"this should fix it" is not a result.

Report: symptom · root cause · what changed (with file references) · evidence
it works · where the regression test is · prior bugs in the same area. End with
one of **done** (cause found, fixed, tested, suite green), **done with
concerns** (fixed but not fully verifiable — say exactly what is unverified),
or **blocked** (cause still unclear; say what was ruled out).

Never ship a fix you could not verify. On an unattended run, blocked and honest
beats done and wrong: a person can answer a blocked ticket, but nobody
re-reads one that claimed success.
