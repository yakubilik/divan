# Contributing

Thanks for looking. This is a small project with three moving parts that have to
agree with each other, so most of this file is about that agreement.

## The shape of it

```
app/     iOS app        (Expo Router, React Native, zustand)
web/     desktop panel  (React + Vite, built into the daemon)
daemon/  the daemon     (Python 3.11–3.13, websockets, SQLite)
docs/    the protocol, and notes that outlive a session
design/  the artboards the interface was drawn from
```

`docs/PROTOCOL.md` is the contract. Every request, every event, every field.
**If your change touches the wire, change that file in the same commit.** A
client and a daemon that disagree fail in ways that are miserable to debug from
a phone on a bus.

## Getting set up

```bash
cd daemon
uv --no-config venv --python 3.12 .venv312
uv --no-config pip install --python .venv312/bin/python -e .
.venv312/bin/divan pair --name dev     # prints a token
.venv312/bin/divan serve
```

```bash
cd app && npm install --legacy-peer-deps && npx expo run:ios
cd web && npm install && npm run dev            # http://localhost:5177
```

The simulator has no camera. Pair with **Enter IP and token**: `127.0.0.1`,
port `8790`. For the panel, put a `web/public/dev-host.json` in place — it is
gitignored, and it stands in for the token the daemon normally hands over:

```json
{"host": "127.0.0.1", "port": 8790, "token": "…", "name": "This computer", "device_id": "…"}
```

`DIVAN_HOME=/tmp/rac-dev DIVAN_PORT=8791` gives you a second daemon with its own
config, database and devices — useful when you do not want to disturb the one
you actually use.

## Before you open a PR

```bash
python scripts/audit.py                        # nothing private, nothing not-English
python scripts/test_audit.py                   # and the scanner still finds what it claims to
python scripts/test_i18n_keys.py               # the app asks for no string that is not there

cd daemon
python scripts/smoke.py --token TOKEN          # 18 protocol checks, no model turns
.venv312/bin/python scripts/test_preamble.py   # session context and register
.venv312/bin/python scripts/test_session.py
.venv312/bin/python scripts/test_stream.py
.venv312/bin/python scripts/test_attachments.py
.venv312/bin/python scripts/test_pool.py
.venv312/bin/python scripts/test_replay.py
.venv312/bin/python scripts/test_fanout.py
.venv312/bin/python scripts/test_agents.py
.venv312/bin/python scripts/test_titles.py
.venv312/bin/python scripts/test_push.py
.venv312/bin/python scripts/test_ustabasi.py   # the queue's snapshot, its one write, its readings
.venv312/bin/python scripts/test_ustabasi_run.py  # a run's log, read a page at a time
.venv312/bin/python scripts/test_divan.py      # the board, the mirror, and one answer per machine

cd app && npx tsc --noEmit
node scripts/test-login-web.cjs                # the sign-in WebView's two judgements
node scripts/test-ustabasi.cjs                 # the wall's judgements, the Divan design system,
                                               # the merged view across machines, and the i18n table
cd web && npm run build                        # typechecks, then builds into the daemon
cd web && npm test                             # the wall's figures, and a ticket as a conversation

cd <the repo root>
python3 scripts/check-links.py                 # no dead path in the docs
```

If you moved or renamed anything under `docs/`, that last one is the check that
notices. `scripts/test_check_links.py` is the checker's own test, and it is the
one to run if you touch the checker.

`cd web && npm run test:ui` drives a real browser over the DevTools protocol —
typing a note, folding the paperwork open, and the wall itself in portrait and on
a desk. It needs a Chrome on the machine (`CHROME=/path/to/chrome`), so it is not
in CI. Run it if you touch the ustabasi screen.

`app/scripts/ustabasi.flow.yaml` is the same idea for the phone, driven by
[Maestro](https://maestro.mobile.dev) on a real build: open the wall, find the
ticket under its project's heading, watch a running one fill with what its
agent is printing, look at the steps behind the (i), then answer the one that
is waiting and wait for the queue to re-open it. It needs a device, a paired
app, a blocked ticket and a running one, so it is not in CI either; the header
of the file says how to run it.

`node app/scripts/divan-live.cjs studio=host:port:token mini=host:port:token` is
the same idea for the boards: it asks each paired computer for the real
`divan.snapshot` over a real socket, through the app's own `callOnce`, and prints
the merged view — every machine's freshness, the counters, and each product with
the machines it lives on. A machine given without a token
(`sleeping=10.255.255.1:8790`) is the case that cannot be staged on a desk: a
computer that neither refuses the connection nor answers it, which the view has
to render without, inside the timeout. `--again=20` polls once more after twenty
seconds, so stopping one of the daemons in between shows the rule the whole
feature rests on — its cards stay, marked with how long ago they were true, and
the totals stop claiming to be complete. It needs computers, so it is not in CI.

`node app/scripts/ustabasi-live.cjs` is the cheap half of that flow, without a
device: it asks the real daemon for the real snapshot and a real run's log, and
pushes both through the same pure modules the three screens draw from — so it
prints the grouped wall, the (i) page's checklist with the running step marked,
and the chat's turns, and fails on an empty group, a path used as a heading, a
pid on a card, two steps marked as running, a first open over the byte cap or
two turns sharing a key. `--watch=30` holds one cursor open at the hook's own
interval, which is the only way to see a turn arrive. It needs the queue on the
machine, so it is not in CI; with no queue it says so and exits 0.

Both readings of a run's log — the daemon's, which pages it, and the app's,
which turns those pages into a chat — are checked against one recording,
`app/scripts/fixtures/run.log`. `app/scripts/fixtures/README.md` says where it
came from and `scripts/capture-run-fixture.py` is how to replace it. That
script scrubs a home directory out of the recording in both the forms a run log
writes one — `/Users/<name>` and the dash-joined slug `-Users-<name>-` — and
`scripts/audit.py` fails on either, because a fixture went out carrying the
second one while both sides were only looking for the first.

`scripts/e2e.py` is the one that spends real model turns. Run it when you have
touched the session or the provider adapters.

Everything above except `smoke.py` and `e2e.py` also runs on CI
(`.github/workflows/ci.yml`) against the two ends of the supported Python range,
because the middle is what everybody develops on and the ends are where it
breaks. `scripts/audit.py` runs there as well, on the tracked files only — the
history is a report for a person, not a build step (see `docs/audit/`).

If you changed the panel, commit the rebuilt `daemon/divan/webui/`?
**No** — it is gitignored. The daemon builds it, or the installer does.

## Releasing

The tag is the version. Three files carry a copy of the number, and the only
reason they exist is that a wheel installed without git has nothing to ask —
so one script writes all of them and the tag, in one commit:

```bash
python scripts/release.py minor --dry-run   # say what would happen
python scripts/release.py minor             # writes, commits, tags
git push origin main --follow-tags          # yours to do
```

The changelog entries are the commit subjects, which is the other reason this
file asks for subjects that say what is now true. Pushing the tag runs
`.github/workflows/release.yml`, which refuses a tag whose copies of the number
disagree with it, refuses one that is not an ancestor of `origin/main`, runs the
tests, builds the panel, and publishes the release with a wheel attached.

Do not tag by hand. A version nothing verifies is a version nobody raises —
`__version__` said `0.1.0` on two computers that were weeks apart, and that is
the whole reason any of this is here.

What a daemon reports is derived, not declared: `git describe` gives `v0.2.0`
on a release and `v0.2.0+7` seven commits past one, so a machine following
`main` between releases says so instead of rounding down.

## House rules

**Language.** Everything is English — code, comments, commit messages,
documentation and every string either client shows. `python scripts/audit.py`
fails on anything else, so this is checked rather than asked for. The one place
another language is allowed is `daemon/divan/call.py`, where it is data
a language detector cannot work without; that exception is listed in the script.

The app and the panel each keep their strings in one table (`app/src/i18n.ts`,
`web/src/lib/i18n.ts`) rather than inline. The daemon tags every user-visible
error with a stable `code` in `daemon/divan/errors.py`; a new code
means a new entry in `ERR_KEYS` in both clients.

**Comments explain why.** The codebase leans on comments that say what a piece
of code is defending against, not what the next line does. Match that. A
comment that restates the code is worse than no comment.

**Commit messages are sentences, not labels.** `A reader that outlives the
turn`, not `fix: client.py`. Say what is now true that was not true before.

**No secrets, ever.** Tokens are stored as sha256. Paths under
`~/.divan/` are machine state and are gitignored. `security.py` has a
redaction list for anything key-shaped that reaches a log or a bubble; if you
add a credential format, add the pattern.

**Security changes get their own PR.** The permission policy, the dangerous
command list, `allowed_roots` / `denied_paths`, and anything touching pairing
or tokens. Small, readable, and on its own.

## What is welcome

- Android. The protocol is platform-neutral and `app/` is Expo; the work is
  real but nothing in the design is in the way.
- More provider adapters — `daemon/divan/providers/` is a small
  interface and Claude Code and Codex are both implementations of it.
- Bug reports with the daemon log (`~/.divan/logs/daemon.log`) and what
  the phone showed. Scrub paths you would rather not publish.

## What is not

Anything that puts a server between the phone and the computer. That is the one
design decision the whole project is built around: your machine, your account,
your network, no middle.
