#!/usr/bin/env bash
# Fixture tests for mac-security-audit.sh. Exit 0 on success.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
S="$here/mac-security-audit.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
H="$T/home"
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$H/.remote-ai-chat" "$H/.ssh" "$H/projects/app/secrets" "$H/projects/repo"
echo 'X=1' > "$H/projects/app/.env"; chmod 644 "$H/projects/app/.env"
chmod 755 "$H/projects/app/secrets" "$H/.remote-ai-chat"
echo x > "$H/.remote-ai-chat/db.sqlite"; chmod 644 "$H/.remote-ai-chat/db.sqlite"
chmod 755 "$H/.ssh"
# tracked secret file + key-like string in a repo
git -C "$H/projects/repo" init -q
echo 'K=1' > "$H/projects/repo/.env"
fake="AKIA$(printf 'ABCDEFGHIJKLMNOP')"
echo "aws=$fake" > "$H/projects/repo/notes.txt"
git -C "$H/projects/repo" add -A
git -C "$H/projects/repo" -c user.email=a@b -c user.name=t commit -qm init

export AUDIT_HOME="$H" AUDIT_ROOTS="$H/projects" AUDIT_SYSTEM=0 AUDIT_REPORT="$T/report.md"
snap() { find "$H" -not -path '*/.git/*' -exec stat -f '%N %Lp' {} + | sort; }

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
[ "$(stat -f %Lp "$H/projects/app/.env")" = 600 ] || fail ".env not 600"
[ "$(stat -f %Lp "$H/projects/app/secrets")" = 700 ] || fail "secrets not 700"
[ "$(stat -f %Lp "$H/.remote-ai-chat")" = 700 ] || fail "rac dir not 700"
[ "$(stat -f %Lp "$H/.remote-ai-chat/db.sqlite")" = 600 ] || fail "db not 600"
[ "$(stat -f %Lp "$H/.ssh")" = 700 ] || fail ".ssh not 700"
grep -q 'Needs a person' "$T/report.md" || fail "report lacks needs section"
echo "ok"
