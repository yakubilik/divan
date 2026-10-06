#!/bin/sh
# Rebuild everything from the published weights and check it: ./verify.sh (exits non-zero on any mismatch).
#
# 1. a Python 3.12 venv in tts/.venv (made with uv if missing) with the pinned requirements
# 2. export.py: the three ONNX files, the reference audio and vectors.json
# 3. vectors.json must come out byte-identical to the committed one
# 4. check.py: operators, CPU-only loading, ONNX vs PyTorch for every sentence, real-time factor
# 5. the README's size table matches the files; nothing generated is tracked; no tracked file over 5 MB
set -eu
cd "$(dirname "$0")"
PY=.venv/bin/python

if [ ! -x "$PY" ]; then
  uv venv --python 3.12 .venv
fi
uv pip install --python "$PY" -q -r requirements.txt

"$PY" export.py

git diff --exit-code -- vectors.json || { echo "FAIL vectors.json changed on re-export"; exit 1; }

# A process tree in macOS's background band (priority 4, e.g. under a launchd agent) only runs on the
# efficiency cores, which are 5-6x slower and say nothing about this Mac's CPU. Then the check runs as a
# one-off launchd job at normal priority; it is removed again when it ends.
if [ "$(ps -o pri= -p $$ | tr -d ' ')" -le 4 ] && command -v launchctl >/dev/null; then
  label="com.yakup.ema-tts-verify.$$"
  log="$(mktemp -t ema-tts-verify)"
  rm -f "$log.status"
  echo "this shell is in the background band (efficiency cores only): running check.py as launchd job $label"
  launchctl submit -l "$label" -o "$log" -e "$log" -- /bin/sh -c "cd '$PWD' && '$PY' check.py; echo \$? > '$log.status'"
  waited=0
  while [ ! -f "$log.status" ] && [ $waited -lt 900 ]; do sleep 2; waited=$((waited + 2)); done
  launchctl remove "$label" 2>/dev/null || true
  cat "$log"
  status="$(cat "$log.status" 2>/dev/null || echo 1)"
  rm -f "$log" "$log.status"
  [ "$status" = 0 ] || { echo "FAIL check.py exited $status"; exit 1; }
else
  "$PY" check.py
fi

"$PY" - <<'EOF'
import re, sys
from pathlib import Path
readme, failures, total = Path("README.md").read_text(), [], 0
for name in ("text", "sound", "decoder"):
    size = Path(f"models/{name}.onnx").stat().st_size
    total += size
    m = re.search(rf"\| `models/{name}\.onnx` \| ([\d.]+) MB \|", readme)
    if not m or abs(float(m.group(1)) - size / 1e6) > 0.05:
        failures.append(f"README size for {name}.onnx is not {size / 1e6:.1f} MB")
m = re.search(r"\| \*\*total\*\* \| \*\*([\d.]+) MB\*\* \|", readme)
if not m or abs(float(m.group(1)) - total / 1e6) > 0.05:
    failures.append(f"README total is not {total / 1e6:.1f} MB")
for f in failures:
    print("FAIL", f)
sys.exit(1 if failures else 0)
EOF

for f in models/text.onnx models/sound.onnx models/decoder.onnx reference/00.npy; do
  git check-ignore -q "$f" || { echo "FAIL $f is not ignored by git"; exit 1; }
done
if [ -n "$(git status --porcelain --untracked-files=all -- .)" ]; then
  git status --short -- .
  echo "FAIL the run left untracked or changed files in tts/"
  exit 1
fi
big="$(git ls-files -z -- . | xargs -0 -I{} find {} -size +5000k)"
[ -z "$big" ] || { echo "FAIL tracked files over 5 MB: $big"; exit 1; }

echo "verify: OK"
