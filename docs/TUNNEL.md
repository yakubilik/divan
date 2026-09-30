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
`~/.remote-ai-chat/config.toml`:

```toml
tunnel_allow_ips = ["203.0.113.4"]        # addresses or CIDR, v4 or v6
```

A request that carries `CF-Connecting-IP` is served only if that address is in
the list. **An empty list refuses every one of them** — which is the point:
running a tunnel in front of this daemon opens nothing on its own. Nothing else
changes: a phone on the tailnet and `remote-ai-chat web` on the machine itself
never send that header and never meet the list.

The list is re-read when the file changes, so editing it costs nothing. A
restart would drop every phone and every chat, which is too much to ask of
somebody whose provider just handed them a new address.

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
remote-ai-chat web --at divan.example.com --name "laptop"
```

It prints a link. The token is in the fragment, the part of a URL a browser
never sends to a server; the panel stores it and wipes the address bar. The
device is its own — its own line in `devices`, `revoke <id>` cuts off that
browser and nothing else. Send the link over something you trust, and mind
that anybody who reads it in transit has the token.

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

Three things, in order:

1. **Cloudflare's edge.** TLS, and the hostname is the only way in.
2. **`tunnel_allow_ips`.** An address you named. It is a household, not a
   laptop — everyone behind that router shares it.
3. **The device token.** 32 random bytes, this machine only, `revoke` cuts it
   off. This is what tells one computer in that house from another.

What is *not* standing is any notion of a person. If you want a sign-in — a
name and a password, or a one-time code to your mail — put Cloudflare Access in
front of the hostname; it sets a cookie the WebSocket handshake carries, and
only requests that passed it ever reach the tunnel. That needs a Zero Trust
team on the account and an API token that can write Access policies, neither of
which this setup requires. The address list is the cheap version.
