#!/usr/bin/env bash
# Fixture tests for mac-security-audit.sh. Exit 0 on success.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
S="$here/mac-security-audit.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$T/home/.remote-ai-chat" "$T/home/.ssh" "$T/home/projects/app/secrets" "$T/home/projects/repo"
echo 'X=1' > "$T/home/projects/app/.env"; chmod 644 "$T/home/projects/app/.env"
chmod 755 "$T/home/projects/app/secrets" "$T/home/.remote-ai-chat"
echo x > "$T/home/.remote-ai-chat/db.sqlite"; chmod 644 "$T/home/.remote-ai-chat/db.sqlite"
chmod 755 "$T/home/.ssh"
# tracked secret file + key-like string in a repo
git -C "$T/home/projects/repo" init -q
echo 'K=1' > "$T/home/projects/repo/.env"
fake="AKIA$(printf 'ABCDEFGHIJKLMNOP')"
echo "aws=$fake" > "$T/home/projects/repo/notes.txt"
git -C "$T/home/projects/repo" add -A
git -C "$T/home/projects/repo" -c user.email=a@b -c user.name=t commit -qm init

export AUDIT_HOME="$T/home" AUDIT_ROOTS="$T/home/projects" AUDIT_SYSTEM=0 AUDIT_REPORT="$T/report.md"
snap() { find "$T/home" -not -path '*/.git/*' -exec stat -f '%N %Lp' {} + | sort; }

# 1. read-only run changes no mode
snap > "$T/before"
out="$(bash "$S")"
snap > "$T/after"
cmp -s "$T/before" "$T/after" || fail "read-only run changed modes"
echo "$out" | grep -q 'wrong mode' || fail "read-only run did not report wrong modes"
echo "$out" | grep -q 'TRACKED in git' || fail "tracked .env not reported"
echo "$out" | grep -q 'aws' || fail "aws-like string not reported"

# 4. no secret values in output or report
for blob in "$out" "$(cat "$T/report.md")"; do
  echo "$blob" | grep -q "$fake" && fail "secret value leaked"
  echo "$blob" | grep -q 'K=1' && fail ".env content leaked"
done

# 2. --fix repairs modes
bash "$S" --fix >/dev/null
[ "$(stat -f %Lp "$T/home/projects/app/.env")" = 600 ] || fail ".env not 600"
[ "$(stat -f %Lp "$T/home/projects/app/secrets")" = 700 ] || fail "secrets not 700"
[ "$(stat -f %Lp "$T/home/.remote-ai-chat")" = 700 ] || fail "rac dir not 700"
[ "$(stat -f %Lp "$T/home/.remote-ai-chat/db.sqlite")" = 600 ] || fail "db not 600"
[ "$(stat -f %Lp "$T/home/.ssh")" = 700 ] || fail ".ssh not 700"
grep -q 'Needs Yakup' "$T/report.md" || fail "report lacks needs section"
echo "ok"
