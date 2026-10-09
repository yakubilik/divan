#!/usr/bin/env bash
# Mac security audit. Read-only by default; --fix applies chmod fixes only.
# Never reads .env/key contents for permission checks; secret-pattern scans
# use grep -l / git grep -l so only paths and kinds are ever printed.
#
# Env overrides (used by scripts/test_mac_audit.sh):
#   AUDIT_HOME     home dir            (default $HOME)
#   AUDIT_ROOTS    scan roots, colon-separated (default $HOME/projects:$HOME/server)
#   AUDIT_REPORT   report path         (default $AUDIT_HOME/.divan/mac-audit.md)
#   AUDIT_SYSTEM=0 skip FileVault/firewall/sharing/port checks
#   AUDIT_HISTORY=0 skip git history scan
set -u
PATH="$PATH:/usr/sbin:/usr/bin:/sbin:/bin"

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1
H="${AUDIT_HOME:-$HOME}"
ROOTS="${AUDIT_ROOTS:-$H/projects:$H/server}"
RAC="$H/.divan"
REPORT="${AUDIT_REPORT:-$RAC/mac-audit.md}"
ME="$(id -un)"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

say() { printf '%s\n' "$*" >> "$OUT"; }
mode() { stat -f '%Lp' "$1"; }
owner() { stat -f '%Su' "$1"; }

FIXED=0; ISSUES=0
NEEDS=()
# ensure <path> <mode>: report and (with --fix) repair a mode mismatch
ensure() {
  local p="$1" want="$2" have
  [ -e "$p" ] || return 0
  [ -L "$p" ] && return 0
  have="$(mode "$p")"
  [ "$have" = "$want" ] && return 0
  if [ "$FIX" = 1 ] && chmod "$want" "$p" 2>/dev/null; then
    say "- fixed: \`$p\` $have -> $want"; FIXED=$((FIXED+1))
  else
    say "- wrong mode: \`$p\` is $have, want $want"; ISSUES=$((ISSUES+1))
  fi
}
check_owner() {
  local p="$1"
  [ "$(owner "$p")" = "$ME" ] && return 0
  say "- not owned by $ME: \`$p\` (owner $(owner "$p"))"; ISSUES=$((ISSUES+1))
  NEEDS+=("sudo chown $ME '$p'")
}

say "# Mac security audit"
say ""
say "Mode: $([ $FIX = 1 ] && echo '--fix' || echo 'read-only') — $(date '+%Y-%m-%d %H:%M')"
say ""

# 1. ~/.divan
say "## ~/.divan permissions"
mark=$(wc -l < "$OUT")
if [ -d "$RAC" ]; then
  ensure "$RAC" 700
  for f in "$RAC"/db.sqlite* "$RAC"/chats.db* "$RAC"/config.toml* "$RAC"/secret-scrub.json; do
    [ -f "$f" ] && ensure "$f" 600
  done
  if [ -d "$RAC/agent-store" ]; then
    ensure "$RAC/agent-store" 700
    while IFS= read -r f; do ensure "$f" 600; done < <(find "$RAC/agent-store" -type f 2>/dev/null)
  fi
else
  say "- $RAC not found"
fi
[ "$(wc -l < "$OUT")" = "$mark" ] && say "- ok"
say ""

# 2. secret files
say "## Secret files (.env, .env.*, *.pem, *.p8, *.key, secrets dirs)"
mark=$(wc -l < "$OUT")
TRACKED=()
IFS=: read -ra RARR <<< "$ROOTS"
PRUNE=(-name node_modules -o -name .git -o -name .venv -o -name venv -o -name Pods -o -name .ustabasi -o -name Library)
NSEC=0
for root in "${RARR[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r d; do
    ensure "$d" 700; check_owner "$d"
  done < <(find "$root" \( "${PRUNE[@]}" \) -prune -o -type d -name secrets -print 2>/dev/null)
  while IFS= read -r f; do
    case "$f" in *.example|*.sample|*.template|*.example.*) continue;; esac
    NSEC=$((NSEC+1))
    ensure "$f" 600; check_owner "$f"
    dir="$(dirname "$f")"
    if top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"; then
      if git -C "$dir" ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
        say "- TRACKED in git: \`$f\`"; ISSUES=$((ISSUES+1))
        NEEDS+=("git -C '$top' rm --cached '$f' && echo '$(basename "$f")' >> '$top/.gitignore'  # then rotate what it held")
      elif ! git -C "$dir" check-ignore -q -- "$f" 2>/dev/null; then
        say "- not gitignored: \`$f\`"; ISSUES=$((ISSUES+1))
      fi
    fi
  done < <(find "$root" \( "${PRUNE[@]}" \) -prune -o -type f \( -name .env -o -name '.env.*' -o -name '*.pem' -o -name '*.p8' -o -name '*.key' \) -print 2>/dev/null)
done
say "- checked $NSEC secret files"
[ "$(wc -l < "$OUT")" = "$mark" ] && say "- ok"
say ""

# 3. key-like strings in tracked files / history (patterns from daemon/divan/secrets.py)
say "## Key-like strings in git repos (path + kind only)"
KINDS=(
  'pem|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----'
  'anthropic|sk-ant-[A-Za-z0-9_-]{20,}'
  'openai|sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}[0-9][A-Za-z0-9_-]*'
  'stripe|(sk|rk)_(live|test)_[A-Za-z0-9]{16,}'
  'aws|(AKIA|ASIA)[0-9A-Z]{16}'
  'github|(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})'
  'google|AIza[0-9A-Za-z_-]{35}'
  'resend|re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}'
  'posthog|ph[cx]_[A-Za-z0-9]{30,}'
  'sentry|sntry[su]_[A-Za-z0-9+/=_-]{20,}'
  'slack|xox[abposr]-[A-Za-z0-9-]{10,}'
  'jwt|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
)
# left boundary like the (?<![A-Za-z0-9_-]) guard in secrets.py
for i in "${!KINDS[@]}"; do k="${KINDS[$i]}"; KINDS[$i]="${k%%|*}|(^|[^A-Za-z0-9_-])(${k#*|})"; done
mark=$(wc -l < "$OUT")
NREPO=0
for root in "${RARR[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r g; do
    repo="$(dirname "$g")"
    git -C "$repo" rev-parse HEAD >/dev/null 2>&1 || continue
    NREPO=$((NREPO+1))
    hit=0
    for k in "${KINDS[@]}"; do
      name="${k%%|*}"; re="${k#*|}"
      while IFS= read -r f; do
        [ -n "$f" ] && { say "- tracked file: \`$repo\` / \`$f\` — $name"; hit=1; }
      done < <(git -C "$repo" grep -I -l -E -e "$re" HEAD -- 2>/dev/null | sed 's/^HEAD://' | head -20)
    done
    if [ "${AUDIT_HISTORY:-1}" = 1 ]; then
      # one pass over added lines; perl prints only "kind file", never the match
      while IFS= read -r line; do
        say "- history: \`$repo\` — $line"; hit=1
      done < <(git -C "$repo" log --all -p --no-color --no-ext-diff --format= 2>/dev/null | \
        perl -e 'alarm 90; $SIG{ALRM}=sub{print "scan timed out (partial) -\n"; exit};
          my @k=map{[split /\|/,$_,2]}@ARGV; my $f="?"; my %s;
          while(<STDIN>){ if(/^\+\+\+ b\/(.*)/){$f=$1;next} next unless /^\+/ && length($_)<2000;
            for my $k(@k){ if(/$k->[1]/){ $s{"$k->[0] — $f"}=1 } } }
          print "$_\n" for (sort keys %s)[0..(scalar(keys %s)>15?14:scalar(keys %s)-1)]' "${KINDS[@]}")
    fi
    [ $hit = 1 ] && ISSUES=$((ISSUES+1))
  done < <(find "$root" -maxdepth 4 \( -name node_modules -o -name .venv -o -name venv -o -name Pods -o -name .ustabasi -o -name Library \) -prune -o -name .git -print 2>/dev/null)
done
say "- scanned $NREPO repos"
[ "$(wc -l < "$OUT")" = "$((mark+1))" ] && say "- ok"
say "- note: matches can be test fixtures or placeholders; history is report-only, rewrite nothing."
say ""

# 4. ~/.ssh
say "## ~/.ssh"
mark=$(wc -l < "$OUT")
if [ -d "$H/.ssh" ]; then
  ensure "$H/.ssh" 700
  while IFS= read -r f; do
    case "$f" in *.pub|*/known_hosts*) [ "$(mode "$f")" = 600 ] || ensure "$f" 644;; *) ensure "$f" 600;; esac
  done < <(find "$H/.ssh" -maxdepth 1 -type f 2>/dev/null)
else
  say "- no ~/.ssh"
fi
[ "$(wc -l < "$OUT")" = "$mark" ] && say "- ok"
say ""

# 5. system state
if [ "${AUDIT_SYSTEM:-1}" = 1 ]; then
  say "## System"
  fv="$(fdesetup status 2>&1 | head -1)"
  say "- FileVault: $fv"
  case "$fv" in *"is On"*) ;; *) NEEDS+=("sudo fdesetup enable   # FileVault (or System Settings > Privacy & Security > FileVault)");; esac
  fw="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1 | head -1)"
  say "- Application firewall: $fw"
  case "$fw" in *enabled*) ;; *) NEEDS+=("sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on");; esac
  rl="$(systemsetup -getremotelogin 2>&1 | head -1)"
  case "$rl" in
    *"Off"*) say "- Remote Login (SSH): off";;
    *"On"*) say "- Remote Login (SSH): ON"; NEEDS+=("sudo systemsetup -setremotelogin off   # only if you do not need SSH into this Mac");;
    *) if launchctl print-disabled system 2>/dev/null | grep -q '"com.openssh.sshd" => enabled'; then
         say "- Remote Login (SSH): ON"; NEEDS+=("sudo systemsetup -setremotelogin off   # only if you do not need SSH into this Mac")
       elif nc -z -G 1 127.0.0.1 22 2>/dev/null; then
         say "- Remote Login (SSH): ON (port 22 answers)"; NEEDS+=("sudo systemsetup -setremotelogin off   # only if you do not need SSH into this Mac")
       else say "- Remote Login (SSH): off (port 22 closed; systemsetup needs admin to confirm)"; fi;;
  esac
  if launchctl list 2>/dev/null | grep -q com.apple.screensharing; then
    say "- Screen Sharing: ON"; NEEDS+=("sudo launchctl disable system/com.apple.screensharing   # or System Settings > General > Sharing > Screen Sharing off")
  else say "- Screen Sharing: off"; fi
  if defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser >/dev/null 2>&1; then
    say "- Auto-login: ENABLED"; NEEDS+=("sudo defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUser")
  else say "- Auto-login: disabled"; fi
  say ""
  say "### Listening TCP ports (process, address)"
  say ""
  say '```'
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1, $9}' | sort -u | \
    awk '{ if ($2 ~ /^(127\.0\.0\.1|\[::1\]|localhost):/) next; print }' >> "$OUT"
  say '```'
  say ""
  say "Anything above is reachable from the network (not bound to localhost). Check each is intended."
  say ""
fi

say "## Summary"
say ""
say "- issues found: $ISSUES; fixed this run: $FIXED"
say ""
say "## Needs a person (sudo / GUI, not done by this script)"
say ""
if [ ${#NEEDS[@]} -eq 0 ]; then say "- nothing"; else
  for n in "${NEEDS[@]}"; do say '```'; say "$n"; say '```'; done
fi

mkdir -p "$(dirname "$REPORT")"
cp "$OUT" "$REPORT"; chmod 600 "$REPORT" 2>/dev/null
cat "$OUT"
