# Fixtures

## `run.log`

One real ustabasi run, as the model's CLI wrote it: stream-json, one object a
line, append-only. It is the recording both readings of that stream are checked
against — the daemon's, which hands it out a page at a time
(`daemon/scripts/test_ustabasi_run.py`), and the app's, which turns those pages
into chat turns (`app/scripts/test-ustabasi.cjs`). One recording and two
languages, so the two cannot drift apart without one of them going red.

It is a recording rather than a log written by hand because a log written by
hand agrees with its reader by construction. The shapes that actually break a
reader are the ones nobody would think to write down: a thinking block whose
words are empty and whose signature is the whole block, a tool result the size
of a file, forty-five identical `thinking_tokens` lines in a row, a line that is
not JSON at all.

Made by `scripts/capture-run-fixture.py`, which says at the top of itself what
it rewrites and why. The short version: every home directory becomes
`/Users/you`, runs of identical noise lines are cut to three, and a tool result
keeps four thousand characters — comfortably more than a reader is allowed to
hand on, which is the cut being tested.

To replace it, point that script at a `stdout.log` under the queue's `runs/`
directory and run `python scripts/audit.py` afterwards. A run log is nothing but
absolute paths, and the audit is what notices when one of them is somebody's.
