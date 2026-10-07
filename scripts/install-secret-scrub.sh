#!/bin/zsh
# Install (or refresh) com.remote-ai-chat.secret-scrub: every hour, `python -m remote_ai_chat.scrub
# --apply`, so keys the CLIs write into their transcripts later are kept in the keychain
# and masked too. The report it keeps is ~/.remote-ai-chat/secret-report.md.
#
# Usage: scripts/install-secret-scrub.sh [uninstall]
#   RAC_DAEMON_DIR  the daemon checkout to run from (default: the one this script is in)
#   RAC_PYTHON      its interpreter (default: .venv312, then .venv, inside that checkout)
set -e
LABEL=com.remote-ai-chat.secret-scrub
DAEMON="${RAC_DAEMON_DIR:-${0:A:h:h}/daemon}"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"
LOGS="$HOME/.remote-ai-chat/logs"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
if [[ "$1" == "uninstall" ]]; then
  rm -f "$PLIST"
  echo "removed"
  exit 0
fi

PY="${RAC_PYTHON:-}"
if [[ -z "$PY" ]]; then
  for v in .venv312 .venv; do
    [[ -x "$DAEMON/$v/bin/python" ]] && { PY="$DAEMON/$v/bin/python"; break; }
  done
fi
[[ -x "$PY" ]] || { echo "no python under $DAEMON (.venv312 or .venv); set RAC_PYTHON" >&2; exit 1; }

mkdir -p "$AGENTS" "$LOGS"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$PY</string>
    <string>-m</string>
    <string>remote_ai_chat.scrub</string>
    <string>--apply</string>
  </array>
  <key>WorkingDirectory</key><string>$DAEMON</string>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$LOGS/secret-scrub.out</string>
  <key>StandardErrorPath</key><string>$LOGS/secret-scrub.out</string>
</dict></plist>
EOF
plutil -lint -s "$PLIST"
launchctl bootstrap "gui/$UID" "$PLIST"
echo "installed $LABEL: hourly, $PY -m remote_ai_chat.scrub --apply in $DAEMON"
