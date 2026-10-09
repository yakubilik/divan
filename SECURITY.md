# Security

## Reporting

Open a [private security advisory](https://github.com/yakubilik/divan/security/advisories/new)
rather than a public issue. Include what the daemon was doing, what the phone
sent, and the version (`divan status`). You will get an answer; this is
a small project run by one person, so the honest estimate is days, not hours.

Please do not include real tokens, real paths or real transcripts in a report —
a reduced reproduction is more useful anyway.

## The threat model, stated plainly

The daemon runs shell commands on your computer because your phone asked it to.
That is the product. What the design does is bound it.

**What it defends against**

- *Anyone who is not on your tailnet.* The daemon binds the Tailscale address
  and `127.0.0.1`, nothing else. There is no relay and no account, so there is
  no server holding your sessions and nothing to breach but your own machine.
  A tunnel is the one way past that, and it is off: see `docs/TUNNEL.md` and
  the paragraph below.
- *A stolen or guessed token.* Tokens are 32 random bytes, stored only as
  sha256, and handed out in plaintext exactly once — in the pairing QR for a
  phone, in the URL fragment for the panel. Every device has its own;
  `revoke <id>` cuts one off without touching the others. Guessing one is not a
  practical attack: there is nothing to guess towards, and a wrong token is
  refused without ever reaching a handler.
- *An agent wandering out of its folder.* A chat can only open under
  `allowed_roots`, minus `denied_paths` (`~/.ssh`, `~/.aws`, credential stores,
  browser profiles). The check is in the daemon, not the client, so it holds in
  `bypass` permission mode too, and `chat.update` re-checks on every move.
- *A destructive command slipping past a tired thumb.* A pattern list —
  `rm -rf`, `git push --force`, `dd of=/dev/…` and friends — asks for approval
  in every permission mode, and says so in the notification.
- *Secrets leaking into scrollback.* Output is scrubbed for key-shaped strings
  (`sk-ant-`, `ghp_`, `AKIA`, bot tokens…) before it is stored or sent.
- *A phone that leaves your pocket.* Face ID can lock the app, and can be
  required again before a chat enters bypass mode.
- *`/files` being used to read the disk.* It answers only with a valid device
  token, and only for two kinds of path: something the phone itself uploaded,
  under `~/.divan/uploads`, or a file the agent wants you to see — a
  screenshot, a built PDF — which has to pass the same `allowed_roots` /
  `denied_paths` check as everything else, including the secret-name list in
  `daemon/divan/security.py`. Anything else is a 404.

**What it does not**

- *Someone holding your unlocked phone.* They are you, as far as the daemon is
  concerned.
- *A model that is wrong in a way you approve.* The approval is the boundary.
  Read the command.
- *`bypass` permission mode.* It is exactly what it says. The folder fence and
  the dangerous-command list are all that remain.
- *A tunnel you put in front of it yourself.* `docs/TUNNEL.md` describes
  reaching the panel from a browser that is not on the tailnet, through a
  Cloudflare tunnel. It moves the boundary: `bind` no longer decides who can
  reach the daemon, because `cloudflared` runs on the machine and every
  request it forwards arrives from loopback. What decides instead is
  `tunnel_allow_ips` — a request carrying `CF-Connecting-IP` is served only if
  that address is listed. The list starts empty and empty means nobody, so
  standing a tunnel up opens nothing by itself; but it is one line of config
  between you and a daemon on the open internet, so read that file before you
  write the line. What it does *not* defend is anybody sharing the address you
  allowed — a home address is a household, not a laptop, and the device token
  is what tells one machine there from another. Three things narrow that:
  the tunnel answers only a device made for it (`divan web --at`,
  `tunnel = true` in `config.toml`) and such a device is answered nowhere
  else, so a phone's token is worth nothing through the tunnel; five
  *different* wrong tokens from one `CF-Connecting-IP` address inside ten
  minutes lock that address out for the next ten, the right token included;
  and every paired device with notifications is told when a tunnel device
  connects from an address it has not used before, and when an address is
  locked out.

  Only guesses count. One of your own tokens at the wrong door (a phone's or a
  tailnet panel's, through the tunnel) is refused but not counted, and the
  same wrong token repeated inside the window counts once — a browser
  retrying a stale token cannot lock its own household out. The lock lives in
  the daemon's memory; `divan unlock <ip>` on the computer (or the
  `tunnel.unlock` request from a paired phone, never from a tunnel device)
  lifts it without a restart. A refusal names its reason to the client
  (wrong door, unknown, revoked, locked and until when) — see
  [docs/TUNNEL.md](docs/TUNNEL.md). Telling a guesser that the address is
  locked gives them nothing they could use: the count and the window are in
  this file, and nothing is accepted while it lasts.

  A person is the one thing that list cannot name, and Cloudflare Access can:
  a sign-in at the edge, by a one-time code to a mail address. It is optional
  and set up outside this repository, but the daemon does not take the edge's
  word for it. With `tunnel_access_team` and `tunnel_access_aud` set, every
  tunnelled request — the WebSocket handshake included — must carry the token
  Access signs (`Cf-Access-Jwt-Assertion`, or the `CF_Authorization` cookie),
  and the daemon verifies it itself: RS256 against the team's published keys,
  `iss`, `aud`, `exp`, and the `email` claim against `tunnel_access_emails`
  if that is set. A request that fails is refused before its device token is
  looked at, and so is every tunnelled request while the team's keys cannot
  be fetched. What that leaves undefended is the mailbox: whoever can read
  the code is the person, as far as Access is concerned — which is why the
  address list, the device token and the lock all still apply behind it.

- *Your tailnet itself.* If someone else is on it, they can reach port 8790 and
  start guessing tokens. Nothing throttles them: the daemon counts failed
  attempts per address over a ten-minute window but does not act on the count
  off the tunnel, so the only thing standing in the way is the size of the
  token.
- *The CLIs it drives.* `claude` and `codex` are installed from npm and run with
  your sign-in. Their security is theirs.
- *Agent definitions you install.* The agent store downloads markdown from
  public GitHub repositories listed in `daemon/divan/agents.py`.
  Nothing is executed at install time, but an agent definition is an instruction
  that later runs with your tools. Read one before you install it.
- *The self-updater.* `auto_update` is on by default: every 15 minutes the
  daemon fast-forwards its own checkout to `origin/main` and restarts. Whoever
  can push to that remote can change what runs on your machine. It will not
  touch a checkout with uncommitted work and will not do anything but a
  fast-forward — but if you did not intend to follow a remote, turn it off.

## Who holds which token

Three credentials exist, and only the first two let anything in.

- **The device token.** One per paired client, 32 random bytes, kept as a sha256
  hash in `~/.divan/config.toml` (mode 600). The phone gets it by
  scanning the QR that `divan pair` prints; it is sent back on every
  connection, as `?token=` on the WebSocket or a `Bearer` header on `/upload`
  and `/files`.
- **The panel's token.** The desktop panel is not a second kind of client: it is
  a device like any other, and `divan web` registers one and hands the
  token over in the URL *fragment* — the part of a URL a browser never sends to
  a server. The panel stores it and wipes it out of the address bar. It shows up
  in `devices` and `revoke <id>` cuts it off exactly like a phone.
- **The APNs key.** Not a way in, only a way out: an `.p8` signing key that lets
  this computer send a push to Apple. `config.toml` holds pointers to it — key
  id, team id, bundle id, and a path — never the key, which lives under
  `~/.divan/` at mode 600 and is covered by `denied_paths` so a chat
  cannot open the folder it is in. Ordinary notifications do not use it at all;
  those go through Expo's push service, which sees a title and a body and no
  message text.

The Cloudflare Access token of `docs/TUNNEL.md` is not a fourth: it is issued
and held by Cloudflare and the browser, never stored by the daemon, and it lets
nothing in by itself — a tunnelled request needs it *and* a tunnel device's
token. The mail address in it is written to the log when that device connects.

No credential is logged, and the daemon has nothing else to authenticate
against — there is no account, no relay and no server of ours.

## If you think you are exposed

```bash
divan devices          # every paired device
divan revoke <id>      # delete its token
```

The token hash is deleted straight away, and nothing can connect with it again.
A connection that is *already* open is a different matter: the daemon checks the
token when a socket is accepted and not afterwards, so a device that is online at
the moment you revoke it keeps that one session until it drops. Restart the
daemon if you need it gone now — every socket is closed with it.

The chats stay; pair again to get back in.
