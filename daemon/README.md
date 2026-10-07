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

## Commands

```
remote-ai-chat pair --name iPhone   # QR + token + deep link
remote-ai-chat serve                # ws://<tailscale-ip>:8790/ws and 127.0.0.1
remote-ai-chat web                  # open the desktop panel, paired
remote-ai-chat devices              # every paired device: tunnel or not, last seen, last address
remote-ai-chat revoke <id>          # cut one off
remote-ai-chat unlock <ip>          # lift a tunnel lock on an address, no restart (docs/TUNNEL.md)
remote-ai-chat project list         # the board's products, and what is unclaimed
remote-ai-chat project create NAME --repo PATH --kind app --purpose "..." --started 2026-03-01
remote-ai-chat project update NAME --purpose "..." --repo PATH   # or an id, or a slug
remote-ai-chat demo-seed            # a demo machine's sample product, cards and chat
remote-ai-chat status
remote-ai-chat install | uninstall  # the login service
python -m remote_ai_chat.scrub [--apply]   # keys already in chat history, into the keychain
```

`scrub` reads the events table and the transcripts Claude Code and Codex keep
(`~/.remote-ai-chat`, `~/.claude/projects`, `~/.codex/sessions`), plus any
directory listed under `scrub_extra_paths` in `config.toml` — a folder of
session notes, say; none by default. Without `--apply` it only writes `~/.remote-ai-chat/secret-report.md`:
each key's kind, fingerprint and keychain service, how many files held it and
when — the list to rotate, never a value. With `--apply` every key goes into the
login keychain first and the file is then rewritten with the placeholder; a file
written in the last ten minutes is left for the next run.
`../scripts/install-secret-scrub.sh` runs it hourly under launchd
(`com.remote-ai-chat.secret-scrub`), so what the CLIs write later is masked too.

`project` is the entrance to the board's products: the Divan clients have no form
for making one and are not getting one, so a product is created and edited by
saying so in a chat, and the agent in that chat has this shell. It talks to the
running daemon over its own socket — the same `divan.project.create` and
`divan.project.update` the phone would call — rather than writing to the database
behind it, so a repository path goes through the allowed roots either way.

`RAC_HOME` and `RAC_PORT` give one machine a second, fully separate daemon —
its own config, database, uploads and port. That is what the tests run against.

## Demo machine

A daemon that needs no Claude Code and no Codex: every chat plays the same
short script — a few lines saying it is a demo, one `git status` with a canned
answer, one approval, then an edit or a skip — through the events the real
tools send, so the phone and the panel draw it as they would any chat. It is
for lending a computer to somebody with no subscription of their own: App
Review. The demo provider (`providers/demo.py`) starts no process, writes no
file and opens no connection; the edit it shows is never made.

Turn it on in `~/.remote-ai-chat/config.toml` (or `$RAC_HOME/config.toml`) and
restart the daemon:

```toml
demo = true
```

Every chat then runs the demo, whatever tool the client asks for, and the
catalog a client receives lists only the demo tool and its one model. The
daemon starts on a machine with neither CLI installed.

Seed it, with the daemon running, so Divan is not empty on first pairing:

```bash
remote-ai-chat demo-seed
```

That makes one product, "Sample app", with cards in several columns, and one
finished chat in `<first allowed root>/sample-app` (the folder is created with
a README if it is not there). It goes through the daemon's own socket, as
`project` does, and looks everything up before making it — running it again
adds nothing. It refuses to run unless `demo = true`.

Pair the reviewer's device as any other, and revoke it when the review is over:

```bash
remote-ai-chat pair --name "App Review"    # QR, token and deep link
remote-ai-chat devices
remote-ai-chat revoke <id>
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
```

`smoke.py` spends no model turns and is the one to run right after installing.
`e2e.py` spends a few real ones.
