# daemon

The part that runs on the computer. It owns the WebSocket, the chats, the
permission policy and the CLI sessions; the phone and the desktop panel are both
just clients of it.

See the [repository README](../README.md) for what the project is, and
[docs/PROTOCOL.md](../docs/PROTOCOL.md) for every request and event on the wire.

## Install

```bash
./install.sh                    # macOS / Linux: venv, login service, pairing QR
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Or by hand:

```bash
uv --no-config venv --python 3.12 .venv312
uv --no-config pip install --python .venv312/bin/python -e . "mlx-whisper>=0.4"
```

Python 3.11–3.13; 3.12 is the version this is run on. Newer Pythons are
usually held back by mlx-whisper's dependency chain rather than by anything
here, so if you do not need voice transcription any supported version is fine.

### Coming from before the rename

An install made when the daemon had another name keeps working: its data home
is still read while `~/.divan` does not exist. To move it over, stop the daemon
and run

```bash
python3 scripts/migrate_to_divan.py --dry-run    # what it would do
python3 scripts/migrate_to_divan.py
```

It moves the data home to `~/.divan`, leaves the old path behind as a symlink
so recorded session paths keep resolving, rewrites the old home inside
`config.toml`, and writes the launchd plist under the new label. It does not
call `launchctl`; it prints the two commands to run.

## Commands

```
divan pair --name iPhone   # QR + token + deep link
divan serve                # ws://<tailscale-ip>:8790/ws and 127.0.0.1
divan web                  # open the desktop panel, paired
divan devices              # every paired device: tunnel or not, last seen, last address
divan revoke <id>          # cut one off
divan unlock <ip>          # lift a tunnel lock on an address, no restart (docs/TUNNEL.md)
divan project list         # the board's products, and what is unclaimed
divan project create NAME --repo PATH --kind app --purpose "..." --started 2026-03-01
divan project update NAME --purpose "..." --repo PATH   # or an id, or a slug
divan demo-seed            # a demo machine's sample product, cards and chat
divan status
divan install | uninstall  # the login service
python -m divan.scrub [--apply]   # keys already in chat history, into the keychain
```

`scrub` reads the events table and the transcripts Claude Code and Codex keep
(`~/.divan`, `~/.claude/projects`, `~/.codex/sessions`), plus any
directory listed under `scrub_extra_paths` in `config.toml` — a folder of
session notes, say; none by default. Without `--apply` it only writes `~/.divan/secret-report.md`:
each key's kind, fingerprint and keychain service, how many files held it and
when — the list to rotate, never a value. With `--apply` every key goes into the
login keychain first and the file is then rewritten with the placeholder; a file
written in the last ten minutes is left for the next run.
`../scripts/install-secret-scrub.sh` runs it hourly under launchd
(`com.divan.secret-scrub`), so what the CLIs write later is masked too.

`project` is the entrance to the board's products: the Divan clients have no form
for making one and are not getting one, so a product is created and edited by
saying so in a chat, and the agent in that chat has this shell. It talks to the
running daemon over its own socket — the same `divan.project.create` and
`divan.project.update` the phone would call — rather than writing to the database
behind it, so a repository path goes through the allowed roots either way.

`DIVAN_HOME` and `DIVAN_PORT` give one machine a second, fully separate daemon —
its own config, database, uploads and port. That is what the tests run against.

## Demo machine

A daemon that needs no Claude Code and no Codex: every chat plays the same
short script — a few lines saying it is a demo, one `git status` with a canned
answer, one approval, then an edit or a skip — through the events the real
tools send, so the phone and the panel draw it as they would any chat. It is
for lending a computer to somebody with no subscription of their own: App
Review. The demo provider (`providers/demo.py`) starts no process, writes no
file and opens no connection; the edit it shows is never made.

Turn it on in `~/.divan/config.toml` (or `$DIVAN_HOME/config.toml`) and
restart the daemon:

```toml
demo = true
```

Every chat then runs the demo, whatever tool the client asks for, and the
catalog a client receives lists only the demo tool and its one model. The
daemon starts on a machine with neither CLI installed.

Seed it, with the daemon running, so Divan is not empty on first pairing:

```bash
divan demo-seed
```

That makes one product, "Sample app", with cards in several columns, and one
finished chat in `<first allowed root>/sample-app` (the folder is created with
a README if it is not there). It goes through the daemon's own socket, as
`project` does, and looks everything up before making it — running it again
adds nothing. It refuses to run unless `demo = true`.

Pair the reviewer's device as any other, and revoke it when the review is over:

```bash
divan pair --name "App Review"    # QR, token and deep link
divan devices
divan revoke <id>
```

For a reviewer outside the tailnet the daemon has to be reachable some other
way — a Cloudflare tunnel, with `web --at` for the panel (docs/TUNNEL.md).

## Layout

| | |
|---|---|
| `server.py` | The WebSocket endpoint, every request handler, the HTTP upload/file routes. |
| `session.py` | One chat's CLI session: turns, queueing, interrupts, resume. |
| `providers/` | `claude.py` and `codex.py` — the two adapters, behind one interface; `demo.py`, the scripted one a demo machine runs. |
| `security.py` | Dangerous-command patterns, the path fence, secret redaction. |
| `config.py` | `config.toml`, devices, token hashes, `allowed_roots`. |
| `agents.py` | Agent definitions, and the store that lists them. |
| `updater.py` | Follows `origin/main` and lets the supervisor restart it. |
| `push.py`, `transcribe.py`, `errors.py`, `preamble.py`, `db.py` | The rest. |

## Tests

```bash
python scripts/smoke.py --token TOKEN [--cwd ~/projects] [--audio sample.m4a]
python scripts/e2e.py   --token TOKEN --image <an uploaded file>
python scripts/test_preamble.py [--live]
python scripts/test_session.py
python scripts/test_stream.py
python scripts/test_demo.py      # a demo daemon with no CLI on PATH, end to end
python scripts/test_secrets.py
python scripts/test_scrub.py
python scripts/test_uninstall.py # the launchd label goes on uninstall, old ones too
python scripts/test_rename.py    # the data home, the pairing link, a chat's environment
python scripts/test_migrate_to_divan.py
```

`smoke.py` spends no model turns and is the one to run right after installing.
`e2e.py` spends a few real ones.
