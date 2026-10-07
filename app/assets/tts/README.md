EMA Lightning's ONNX files go here, as `ema-text.onnx`, `ema-sound.onnx` and `ema-decoder.onnx`. They are
not in git: `npm run tts:models` copies them from `tts/models/` (built by `tts/verify.sh`), and
`plugins/with-tts-models.js` adds them to the app bundle at prebuild. Without them the app builds and the
call reads Turkish with the system voice.
