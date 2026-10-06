# tts: EMA Lightning as ONNX, for the phone

[EMA Lightning](https://github.com/canberk7/ema-lightning) (Apache-2.0) is a small Turkish text-to-speech
model: 5.6M acoustic + 3.0M decoder parameters, 48 kHz mono out. This folder turns its published weights
([canberkkkkkk/ema-lightning](https://huggingface.co/canberkkkkkk/ema-lightning), revision `7a6ba1a`) into
ONNX files that onnxruntime runs on the iPhone, and keeps the test vectors later work checks against.
Nothing here is used by `app/` or `daemon/` yet.

## Regenerate

```sh
cd tts
./verify.sh        # builds .venv (uv, Python 3.12) if missing, exports, checks; exits non-zero on any mismatch
```

or by hand:

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python export.py   # models/*.onnx, reference/*.npy, vectors.json (downloads ~34 MB of weights once)
.venv/bin/python check.py    # ONNX (onnxruntime, CPU) against the PyTorch reference, plus real-time factor
```

ema-lightning needs CPython 3.11-3.13, so this venv is separate from the daemon's. `models/` and
`reference/` are ignored by git; `vectors.json` is committed and `verify.sh` fails if a re-export changes it.

## Files

| file | size | what |
|---|---|---|
| `models/text.onnx` | 4.8 MB | `ids [1, L]` int64 → `h [1, L, 224]`, `dur [1, L]` (frames per letter) |
| `models/sound.onnx` | 17.8 MB | `h`, `dur`, `cw`, `wstart [1, L]`; `fw`, `fp [1, T]`; `noise [1, 4, T, 64]` → `latents [1, T, 64]` |
| `models/decoder.onnx` | 12.0 MB | `z [1, n, 64]` → `audio [1, n · 1920]` at 48 kHz |
| **total** | **34.6 MB** | float32 weights |

`L` (letters), `T` (frames) and `n` (frames in a decoded window) are dynamic. Batch is 1: the phone speaks
one piece at a time, so there is no padding and no mask input.

## The pipeline, and what the host does

1. **Frontend** (host, not ONNX): `normalizer_tr` reads numbers, dates, money, units and abbreviations
   aloud, then the text is lowercased the Turkish way and cut to the model's alphabet; long text is chunked
   into pieces of at most ~10 s (`ema_lightning.frontend`, `ema_lightning.chunker`). Each letter's id is its
   index in `vectors.json` → `vocab` (unknown letters are 1). `vectors.json` holds the frontend's output for
   every test sentence, so the phone's port of it can be checked without Python.
2. `common.words`: each letter's word index `cw` and the first letter of its word `wstart`.
3. **text.onnx**: letter features and durations.
4. `common.plan` (host): per word, sum its letters' durations, round half to even, clamp to 1..250 frames;
   cut the timeline at 3000 frames. `fw` is each frame's word, `fp` its position inside the word
   (`(frame - word start) / word frames`, in float64 then float32). It is data-dependent and a few lines of
   code, so it stays outside the graph.
5. `common.noise(seed, T)` (host): Gaussian noise `[4, T, 64]`, one slice per step. It is splitmix64 on a
   counter plus Box-Muller, specified in `common.py` so Swift reproduces it; torch's generator cannot be
   reproduced off torch, so the reference uses this noise too.
6. **sound.onnx**: aligner and the 4-step flow DiT. **The four steps (t = 0, .25, .5, .75) are unrolled
   inside the graph**; the host runs it once.
7. **decoder.onnx**, window by window as EMA does it (`common.decode`): windows of 100 frames (4 s), each
   decoded with 8 frames of context on both sides and cut back to itself. The first window can be made
   shorter for streaming; the decoder does not care.

## Operators and opset

All three graphs are **opset 15**, default ONNX domain only, float32 tensors (bool and int64 only for
masks, indices and shapes), no `Constant` nodes (lifted to initializers). Every operator is in the operator
set of onnxruntime's mobile package (`mobile_package.required_operators.config` at v1.18.0, the last release
that shipped it, opsets 12-15); `check.py` enforces this and fails on anything else.

| graph | operators |
|---|---|
| text | Add Clip Conv Div Erf Exp Gather MatMul Mul Pow ReduceMean Sigmoid Sqrt Squeeze Sub Transpose |
| sound | Add And Cast Clip Concat ConstantOfShape Cos CumSum Div Equal Exp Expand Gather Gemm GreaterOrEqual Identity LessOrEqual MatMul Mul Neg Pow Range ReduceMean Reshape Shape Sigmoid Sin Slice Softmax Split Sqrt Squeeze Sub Transpose Unsqueeze Where |
| decoder | Add Conv ConvTranspose Div Gather LeakyRelu Mul Shape Slice Tanh Transpose Unsqueeze |

To get there the export rewrites three things from the PyTorch model, with the same arithmetic:
LayerNorm is written out (no `LayerNormalization`, which needs opset 17), `scatter_add`/`gather` along a
dimension become a one-hot letter-to-word matrix and plain `Gather` (no `ScatterElements`/`GatherElements`),
and attention is written as MatMul + Softmax.

**CPU EP is the path to use.** `python -m onnxruntime.tools.check_onnx_model_mobile_usability` reports that
CoreML EP would take only small scattered partitions with these dynamic shapes (decoder: 2 of 299 nodes;
with fixed window sizes NeuralNetwork could take 292 of 299, except ConvTranspose). With CoreML EP enabled
(checked on macOS, onnxruntime 1.30) the graphs load and run, falling back to CPU for most nodes, and
sentence 4 still matches the reference at correlation 1.0000. A fixed-size decoder for CoreML is a
possible later step.

## Test vectors

`vectors.json` has 12 sentences (four 2-4 word answers, three long ones, five with numbers, dates, times,
money, percent, units and an abbreviation). Per sentence: `text`, the frontend's `spoken` text, `ids`, `cw`,
`wstart`, the reference letter durations `dur`, frames per word `word_frames`, `frames`, the noise `seed`
(with `noise_sha256` and its first values), and the PyTorch reference audio's `samples`, `seconds`,
`audio_sha256` (over little-endian float32) and `rms` (one value per frame, a loudness fingerprint that
needs no audio file).

The reference is EMA's own engine (`Engine.plan`, `think`, `decode` per window) with its noise swapped for
`common.noise`, on one thread, so it is bit-for-bit repeatable.

## Results on this Mac (Apple M1)

`check.py`, onnxruntime 1.30 CPU EP, one thread:

- every sentence: same frame count as PyTorch, waveform correlation 1.0000 (threshold 0.98)
- 44.3 s of audio in 5.1 s: **8.7x real time** (RTF 0.116) at normal priority

macOS keeps a process tree started at background priority (`ps` shows priority 4, as under a launchd agent)
on the efficiency cores, where the same run is 1.4x real time. `verify.sh` notices that and runs `check.py`
as a one-off launchd job at normal priority, so the number it checks is this Mac's CPU, not the agent's
scheduling class. Almost all of the time is the decoder (about 90%); sound.onnx is about 8%.
