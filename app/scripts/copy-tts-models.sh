#!/bin/sh
# Copy EMA's ONNX files from tts/models/ into assets/tts/, where the
# with-tts-models plugin puts them into the app bundle at prebuild.
#
#   npm run tts:models            (from app/)
#
# Build them first with tts/verify.sh. Then prebuild, so the Xcode project
# lists them:  npx expo prebuild --platform ios  (or an EAS build, which
# prebuilds itself; .easignore does not exclude assets/tts/).
set -eu
cd "$(dirname "$0")/.."
src=../tts/models
for stage in text sound decoder; do
  if [ ! -f "$src/$stage.onnx" ]; then
    echo "missing $src/$stage.onnx: run tts/verify.sh first" >&2
    exit 1
  fi
done
mkdir -p assets/tts
for stage in text sound decoder; do
  cp "$src/$stage.onnx" "assets/tts/ema-$stage.onnx"
done
ls -l assets/tts/*.onnx
