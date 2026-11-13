# ChatGPT's dot → Divan

A dot (OpenAI's always-on agent in ChatGPT) can read this computer's chats and
ustabasi tickets through a read-only MCP server, reached over OpenAI's
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
Nothing is exposed to the internet: `tunnel-client` only polls OpenAI.

```
dot (ChatGPT) ─▶ api.openai.com/v1/mcp/<tunnel_id> ◀─poll─ tunnel-client ─stdio─▶ python -m divan.mcp_bridge ─ro─▶ ~/.divan/db.sqlite, ustabasi
```

Tools, all read-only: `divan_list_chats`, `divan_read_chat`, `divan_chat_result`,
`divan_list_tickets`, `divan_ticket`. Texts go through `secrets.mask` and are
cut at 4000 characters. Giving work to Divan is not here yet; when it comes it
goes through the daemon's own approval, not around it.

What this sends to OpenAI: the titles, results and messages of the chats the dot
asks about. That is the point of it, and the one way it differs from the rest of
Divan, which keeps everything on the computer.

## Setup

1. platform.openai.com, in the **personal** organization that belongs to the
   ChatGPT account the dot lives in: Settings → Organization → Tunnels → create.
   Keep the `tunnel_…` id in `~/.divan/dot-tunnel-id`.
2. Settings → API keys: a key whose principal has Tunnels Read + Use. Keep it in
   the keychain as `divan-openai-tunnel`.
3. `tunnel-client` in `~/.local/bin` (release from github.com/openai/tunnel-client,
   SHA256SUMS checked), then `daemon/scripts/dot_tunnel.sh`. Health: http://127.0.0.1:8795/ui
4. ChatGPT → Settings → Apps/Plugins → Add custom MCP server → Connection: Tunnel,
   pick the tunnel, no authentication.
5. Ask the dot: "Divan'da şu an çalışan sohbetler ne?"

## Without Platform Tunnels: Cloudflare + OAuth

When the Tunnels page is not open to the account, the same bridge is served over
HTTPS by the Cloudflare tunnel that already carries the panel:

```
dot (ChatGPT) ─https─▶ mcp.yakupkeskin.dev (cloudflared) ─▶ 127.0.0.1:8798  python -m divan.mcp_bridge --http
```

`--http` refuses to start without `--public-url`, and that turns OAuth on
(`mcp_auth.py`): ChatGPT registers itself, the browser lands on `/login`, the
password is the keychain item `rac-secret-divan-mcp`. Only OpenAI hosts may
receive a code; 5 wrong passwords close the page for 15 minutes; tokens are kept
as hashes in `~/.divan/mcp-oauth.json`. Revoke everything by deleting that file
and restarting the bridge.

- launchd: `~/Library/LaunchAgents/com.yakup.divan-mcp.plist`
- cloudflared: the `mcp.yakupkeskin.dev` ingress in `~/.cloudflared/divan.yml`
- ChatGPT: Settings → Apps → Advanced → Developer mode on → Create →
  URL `https://mcp.yakupkeskin.dev/mcp`, authentication OAuth.
