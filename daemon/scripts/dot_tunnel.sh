#!/bin/zsh
# Connects ChatGPT's dot to this computer's Divan through OpenAI's Secure MCP
# Tunnel: tunnel-client polls OpenAI over outbound HTTPS and runs the read-only
# MCP bridge (divan.mcp_bridge) as its stdio child. No port is opened.
#
#   CONTROL_PLANE_TUNNEL_ID   the tunnel_… id, or the file ~/.divan/dot-tunnel-id
#   DOT_TUNNEL_KEY_SERVICE    keychain item holding the runtime key (default divan-openai-tunnel)
#
# Only one instance per tunnel id: stdio tunnels do not survive two clients.
set -eu
DAEMON="$(cd "$(dirname "$0")/.." && pwd)"
PY="$DAEMON/.venv312/bin/python"
[[ -x "$PY" ]] || PY="$DAEMON/.venv/bin/python"
TID="${CONTROL_PLANE_TUNNEL_ID:-$(cat "${DIVAN_HOME:-$HOME/.divan}/dot-tunnel-id")}"
CONTROL_PLANE_API_KEY="$(security find-generic-password -s "${DOT_TUNNEL_KEY_SERVICE:-divan-openai-tunnel}" -w)"
export CONTROL_PLANE_API_KEY
exec tunnel-client run \
  --control-plane.tunnel-id "$TID" \
  --control-plane.api-key env:CONTROL_PLANE_API_KEY \
  --health.listen-addr 127.0.0.1:8795 \
  --mcp.command "$PY -m divan.mcp_bridge"
