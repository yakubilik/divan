#!/bin/sh
# Every daemon script test that spends no model turns and touches no network,
# run one after another. A failure does not stop the run: every script runs,
# the ones that failed are named at the end, and the exit status is non-zero
# if any did. scripts/e2e.py and scripts/smoke.py need a running daemon and a
# real sign-in, so they stay a human's job.
#
#     sh scripts/ci.sh                         # with `python`
#     PYTHON=.venv/bin/python sh scripts/ci.sh
#
# A script that cannot pass on some platform or Python skips itself, inside
# the script, and says why; it is never dropped from this list.

cd "$(dirname "$0")/.." || exit 2
PYTHON="${PYTHON:-python}"

TESTS="test_pool test_preamble test_replay test_session test_stream test_fanout
test_attachments test_agents test_titles test_push test_ustabasi
test_ustabasi_run test_ustabasi_usage test_divan test_model_catalog
test_dictation test_filing test_tunnel test_security test_secrets test_scrub
test_call test_demo test_peaks test_panel_paths test_uninstall
test_voice_bench test_voice test_rename test_migrate_to_divan"

failed=""
for t in $TESTS; do
  echo "── $t"
  if ! "$PYTHON" "scripts/$t.py"; then
    echo "── $t FAILED"
    failed="$failed $t"
  fi
done

if [ -n "$failed" ]; then
  echo
  echo "failed:$failed"
  exit 1
fi
echo
echo "all passed"
