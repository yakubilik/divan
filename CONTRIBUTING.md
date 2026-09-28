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
.venv312/bin/remote-ai-chat pair --name dev     # prints a token
.venv312/bin/remote-ai-chat serve
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

`RAC_HOME=/tmp/rac-dev RAC_PORT=8791` gives you a second daemon with its own
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

cd app && npx tsc --noEmit
cd web && npm run build                        # typechecks, then builds into the daemon

cd <the repo root>
python3 scripts/check-links.py                 # no dead path in the docs
```

If you moved or renamed anything under `docs/`, that last one is the check that
notices. `scripts/test_check_links.py` is the checker's own test, and it is the
one to run if you touch the checker.

`scripts/e2e.py` is the one that spends real model turns. Run it when you have
touched the session or the provider adapters.

Everything above except `smoke.py` and `e2e.py` also runs on CI
(`.github/workflows/ci.yml`) against the two ends of the supported Python range,
because the middle is what everybody develops on and the ends are where it
breaks. `scripts/audit.py` runs there as well, on the tracked files only — the
history is a report for a person, not a build step (see `docs/audit/`).

If you changed the panel, commit the rebuilt `daemon/remote_ai_chat/webui/`?
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
another language is allowed is `daemon/remote_ai_chat/call.py`, where it is data
a language detector cannot work without; that exception is listed in the script.

The app and the panel each keep their strings in one table (`app/src/i18n.ts`,
`web/src/lib/i18n.ts`) rather than inline. The daemon tags every user-visible
error with a stable `code` in `daemon/remote_ai_chat/errors.py`; a new code
means a new entry in `ERR_KEYS` in both clients.

**Comments explain why.** The codebase leans on comments that say what a piece
of code is defending against, not what the next line does. Match that. A
comment that restates the code is worse than no comment.

**Commit messages are sentences, not labels.** `A reader that outlives the
turn`, not `fix: client.py`. Say what is now true that was not true before.

**No secrets, ever.** Tokens are stored as sha256. Paths under
`~/.remote-ai-chat/` are machine state and are gitignored. `security.py` has a
redaction list for anything key-shaped that reaches a log or a bubble; if you
add a credential format, add the pattern.

**Security changes get their own PR.** The permission policy, the dangerous
command list, `allowed_roots` / `denied_paths`, and anything touching pairing
or tokens. Small, readable, and on its own.

## What is welcome

- Android. The protocol is platform-neutral and `app/` is Expo; the work is
  real but nothing in the design is in the way.
- More provider adapters — `daemon/remote_ai_chat/providers/` is a small
  interface and Claude Code and Codex are both implementations of it.
- Bug reports with the daemon log (`~/.remote-ai-chat/logs/daemon.log`) and what
  the phone showed. Scrub paths you would rather not publish.

## What is not

Anything that puts a server between the phone and the computer. That is the one
design decision the whole project is built around: your machine, your account,
your network, no middle.
