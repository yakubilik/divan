# The panel from a browser that is not on the tailnet

The phone talks to the daemon over Tailscale, and so does the panel. That is
the design and it is the right one: WireGuard has already encrypted the hop,
there is no certificate a `100.x` address could present, and nothing is
listening anywhere a stranger can reach.

Sometimes the machine you want the panel on cannot join the tailnet — a laptop
in somebody else's house, a borrowed computer, a browser you do not administer.
This is how to reach it anyway, and what you are giving up.

## What it gives up

`bind` stops being the door. `cloudflared` runs on the same machine as the
daemon, so every request it forwards arrives from `127.0.0.1`: as far as the
socket is concerned, the whole internet is now local. The address that actually
asked is in a header, `CF-Connecting-IP`, written by Cloudflare's edge and not
by whoever connected to it.

So the door moves into the daemon, and it is `tunnel_allow_ips` in
`~/.divan/config.toml`:

```toml
tunnel_allow_ips = ["203.0.113.4"]        # addresses or CIDR, v4 or v6
```

A request that carries `CF-Connecting-IP` is served only if that address is in
the list. **An empty list refuses every one of them** — which is the point:
running a tunnel in front of this daemon opens nothing on its own. Nothing else
changes: a phone on the tailnet and `divan web` on the machine itself
never send that header and never meet the list.

The list is re-read when the file changes, so editing it costs nothing. A
restart would drop every phone and every chat, which is too much to ask of
somebody whose provider just handed them a new address. The three
`tunnel_access_*` settings further down are read the same way.

## Which address, exactly

Not the one you think. A machine with working IPv6 will reach Cloudflare over
IPv6, and `CF-Connecting-IP` will then be a v6 address — so a list holding only
the v4 one refuses it, which is a confusing way to spend an afternoon. Open

```
https://www.cloudflare.com/cdn-cgi/trace
```

in the browser you are allowing and read the `ip=` line: that is the address
this list is about. List both families if the machine has both, and give the v6
side a prefix rather than an address — the last half of a v6 address belongs to
the interface and changes on its own:

```toml
tunnel_allow_ips = [
  "203.0.113.4",                 # the v4 address the router presents
  "2001:db8:1234:5600::/56",     # the prefix the provider delegated
]
```

A home address is a household either way. Everyone behind that router is inside
the list; the device token is what tells one machine there from another.

## Setting it up

```bash
brew install cloudflared              # or your platform's package
cloudflared tunnel login              # once, per Cloudflare account
cloudflared tunnel create divan
cloudflared --config ~/.cloudflared/divan.yml \
  tunnel route dns <tunnel-id> divan.example.com
```

`~/.cloudflared/divan.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: divan.example.com
    service: http://127.0.0.1:8790
  - service: http_status:404
```

Pass `--config` on every command. With a `config.yml` already in
`~/.cloudflared/`, `tunnel route dns` will quietly point the new hostname at
the tunnel *that* file names — which is how you end up with one hostname
serving somebody else's service. Check what it printed: it tells you the
tunnel id it used.

Then the address the browser gets:

```bash
divan web --at divan.example.com --name "laptop"
```

It prints a link. The token is in the fragment, the part of a URL a browser
never sends to a server; the panel stores it and wipes the address bar. The
device is its own — its own line in `devices`, `revoke <id>` cuts off that
browser and nothing else. Send the link over something you trust, and mind
that anybody who reads it in transit has the token.

## A tunnel device, and only a tunnel device

`--at` is what makes the device the tunnel's: it is written to `config.toml`
with `tunnel = true`, and the two kinds of token do not cross.

- A request that carries `CF-Connecting-IP` is answered only for a tunnel
  device's token. A phone's token, or the token of a panel opened with plain
  `divan web`, is refused there — the socket closes with 4401 and
  `/upload`, `/files` and `/screen.jpg` answer 401. It is refused but not
  counted towards the lock below: it is one of your own tokens at the wrong
  door, not a guess.
- A request without the header is answered only for a token that is *not* a
  tunnel device's. The link you sent to the laptop opens the tunnel and
  nothing on the tailnet.

So what the tunnel exposes is the devices you made for it and no others: a
phone's token that leaks is still worth nothing to anybody who is not on the
tailnet. Nothing changes for a device that was already paired — no phone has
to pair again. A browser that was given a `web --at` link by a daemon older
than this has no `tunnel = true` on its row and is now refused through the
tunnel: `revoke` it and run `web --at` once more.

## Guessing, and being told

An address in the list is a household, so somebody in it can sit and try
tokens. Wrong tokens through the tunnel are counted against the address in
`CF-Connecting-IP` — the one address a request cannot choose — and **five
different ones inside ten minutes lock that address out for the next ten**,
the right token included. A v6 address is counted as its /64, for the reason
given above. The tailnet is never locked this way: a connection without the
header has no address of its own to hold to account, only the socket's.

What counts is a guess, and a browser retrying is not one:

- **A token the daemon knows but that does not open the tunnel** — a phone's,
  or a panel's from plain `divan web` — is refused and not counted.
- **The same unknown token again** inside the window is counted once. A tab
  holding a stale token and reconnecting every few seconds is one strike, not
  five; it takes five *different* wrong tokens to lock.
- **No token at all** is a page not yet paired, and is not counted.

The lock is in the daemon's memory and lifts by itself after ten minutes. To
lift it now, without a restart, on the computer:

```sh
divan unlock 203.0.113.4     # a v6 address may be given whole; its /64 is unlocked
```

It asks the running daemon over loopback, as a device minted for the call and
removed after it. A paired phone can send the same request (`tunnel.unlock`
with `{"addr": …}`); a tunnel device cannot, so a browser behind the tunnel
cannot clear its own count. `tunnel.locks` lists what is locked and until when.

### What the panel is told

A refused socket closes with 4401 and a reason, and a refused `/upload`,
`/files` or `/screen.jpg` answers 401 with the same reason as its `detail`:

| reason | meaning |
|---|---|
| `not_tunnel_device` | a tailnet token at the tunnel — pair this browser with `web --at` |
| `tunnel_only` | a tunnel token off the tunnel |
| `unknown_token` | a token this daemon never made, or has forgotten |
| `revoked` | a token whose device was removed with `revoke` |
| `no_token` | no token at all |
| `locked:<until>:<address>` | the address is locked; `until` is epoch seconds |

The panel says each in its own words (English or Turkish, by the browser's
language) — "access revoked" only for the one that was — and once a token is
refused it stops sending it from that tab: no reconnect, no frame of the
screen, no file, no upload. Reload the page after `unlock` or after pairing
again.

Two things send a notification to every paired device that takes them:

- a tunnel device connecting from an address it has not connected from before
  — the device's name and the address, once per address, remembered across
  restarts;
- an address being locked out — once per lock, with the `unlock` command
  that lifts it.

Neither is behind a switch. If the first one arrives and it was not you,
`revoke` the device it names.

`divan devices` shows the same thing at rest:

```
3f9c2a81d0b4  iPhone                push=yes          seen=2026-10-01 09:12
a1b2c3d4e5f6  laptop                push=no   tunnel  seen=2026-10-01 21:40  from=203.0.113.4
```

## A sign-in in front of it: Cloudflare Access

Everything above knows addresses and machines. None of it knows a person, and
an address is a household. Cloudflare Access puts a sign-in at the edge — here
a one-time code sent to a mail address — and only requests that passed it are
forwarded to the tunnel at all. It needs a Zero Trust team on the Cloudflare
account; the free plan is enough.

In the Zero Trust dashboard (the menu names move around; these are the ones at
the time of writing):

1. **The team.** The first visit asks for a team name. It becomes
   `<team>.cloudflareaccess.com`, the *team domain*, and is shown afterwards
   under Settings. One-time PIN is a login method that is on by default; leave
   it on.
2. **The application.** Access → Applications → Add an application →
   *Self-hosted*. The public hostname is the tunnel's, `divan.example.com`,
   with no path, so that `/ws`, `/upload` and `/files` are behind it too.
3. **How long a sign-in lasts.** *Session duration* on the application, which
   starts at 24 hours. Set it to **1 month**: when it runs out the panel's next
   request is answered with Cloudflare's sign-in page instead of the daemon, and
   once a day is more often than a panel you leave open deserves.
4. **Who may sign in.** One policy, action *Allow*, with a single *Include*
   rule: *Emails*, and the addresses themselves. Not *Everyone*, and not
   *Emails ending in* unless the whole domain is yours. Anybody may type a mail
   address into the sign-in page; a code is only ever sent to one the policy
   names.
5. **The two values the daemon needs.** The team name from step 1, and the
   application's *Application Audience (AUD) Tag* — a long hex string on the
   application's overview page.

Then `~/.divan/config.toml`:

```toml
tunnel_access_team = "your-team"                  # of your-team.cloudflareaccess.com
tunnel_access_aud = "4714c1358e65fe4b408ad6d4…"   # the application's AUD tag
tunnel_access_emails = ["you@example.com"]        # optional
```

Why the daemon needs telling: Access refusing the unsigned at the edge is a
setting in somebody's dashboard, and the day the hostname is edited out of the
application — or a second hostname is routed to the same tunnel — requests
arrive that nobody signed in for and nothing says so. So Access signs what it
lets through, and the daemon checks the signature. Every request Access
forwards carries a token, in the `Cf-Access-Jwt-Assertion` header and in the
`CF_Authorization` cookie the browser sends back, the WebSocket handshake
included. With the team and the aud set, a tunnelled request is served only if
that token

- is signed (RS256) by one of the keys the team publishes at
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`,
- was issued by that team (`iss`) for this application (`aud`), and has not
  expired (`exp`),
- and, if `tunnel_access_emails` is not empty, was issued to one of those
  addresses. The policy already says who may sign in; this is the same list
  kept where a mistake in the dashboard cannot widen it.

Anything else is refused the way an unlisted address is — 403, and the socket
closed with 1008 before it is accepted — without the device token being looked
at. The address list still applies, and so does everything after it: Access
is one more thing a request has to pass, not a replacement for the others.

- **All three empty** is no Access: nothing looks for a token, and the tunnel
  behaves exactly as described above. **Some but not all of team and aud** is
  a refusal of every tunnelled request, not a silent off: whoever wrote one of
  them meant the check to be on.
- The tailnet and the machine itself never meet any of this. A request without
  `CF-Connecting-IP` is not the tunnel's and is not asked for a token.
- The keys are fetched once and kept in memory. Access rotates them, so a token
  signed by a key the daemon has not seen makes it fetch again — at most once a
  minute. If the keys cannot be fetched, tunnelled requests are refused until
  they can; the tailnet carries on.
- The token is checked when a socket opens and not afterwards, like the device
  token. A panel that is already connected stays connected past the end of its
  Access session, until the socket drops.

The mail Access signed in is written to the daemon's log when the device
connects, and is in the notification about a new address:
`Tunnel: laptop (you@example.com) connected from a new address, 203.0.113.4`.

## Why HTTPS is not optional here

The panel is served over HTTPS by the tunnel's hostname, and a page served over
HTTPS may not open an insecure socket — the browser refuses `ws://` before the
daemon hears anything. `lib/ws.ts` handles it: when the computer's address *is*
the page's own address and the page is HTTPS, the socket is `wss://` and
`/upload`, `/files` and `/screen.jpg` are `https://`. Anywhere else, including
the phone, nothing changed.

One consequence worth knowing: a panel opened through a tunnel can only talk to
the computer behind that tunnel. A second machine paired at its `100.x` address
would need a plain socket, and that page cannot open one. The panel that sees
every machine at once is the one on the tailnet.

## What is left standing

In order:

1. **Cloudflare's edge.** TLS, and the hostname is the only way in.
2. **Cloudflare Access**, if you set it up: a person, by a code sent to their
   mail, and a signed token the daemon verifies for itself on every request.
3. **`tunnel_allow_ips`.** An address you named. It is a household, not a
   laptop — everyone behind that router shares it.
4. **The device token.** 32 random bytes, this machine only, `revoke` cuts it
   off. This is what tells one computer in that house from another, and it has
   to be one made with `--at`: no other device's token is answered here.
5. **The lock.** Five different wrong tokens from one address in ten minutes
   and that address is refused for ten more — and your phone is told, with
   the `divan unlock <ip>` that lifts it early.

Without Access, what is *not* standing is any notion of a person: the address
list is the cheap version, and it is the one that needs nothing but a tunnel.
With it, a request has to come from an address you named, from somebody who
can read your mail, holding a token made for that browser.
