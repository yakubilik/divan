"""Check the exported ONNX files against vectors.json and the PyTorch reference, with onnxruntime only.

    .venv/bin/python check.py

Exits non-zero if any of these fail:
- every graph is opset <= 15 and uses only operators of onnxruntime's mobile package;
- every graph loads with onnxruntime restricted to CPUExecutionProvider;
- for every sentence: the host plan matches the reference's frames per word, the noise matches its hash,
  the reference audio matches its hash, and the ONNX audio is within 1 frame of the reference's length
  with waveform correlation above 0.98;
- the 12 sentences synthesise faster than 3x real time on one CPU thread.
"""
import json
import os
import subprocess
import sys
import time

import numpy as np
import onnx
import onnxruntime as ort

import common

MIN_CORRELATION = 0.98
MIN_SPEED = 3.0  # times real time, single-threaded
STAGES = ("text", "sound", "decoder")

# Operators of onnxruntime's mobile package: tools/ci_build/github/android/mobile_package.required_operators.config
# at v1.18.0, the last release that shipped that package (opsets 12-15). A graph inside this set runs on any
# onnxruntime build, the reduced mobile one included; CoreML EP takes what it supports and leaves the rest on CPU.
MOBILE_OPSET = 15
MOBILE_OPS = set("""
Abs Add And ArgMax ArgMin AveragePool Cast Ceil Clip Concat ConstantOfShape Conv ConvTranspose Cos CumSum
DepthToSpace DequantizeLinear Div DynamicQuantizeLinear Elu Equal Exp Expand Flatten Floor Gather GatherND Gemm
Greater GreaterOrEqual Identity If LRN LeakyRelu Less LessOrEqual Log LogSoftmax Loop MatMul Max MaxPool Mean Min
Mul Neg NonMaxSuppression NonZero Not Or PRelu Pad Pow QuantizeLinear Range Reciprocal ReduceMax ReduceMean
ReduceMin ReduceProd ReduceSum Relu Reshape Resize ReverseSequence Round ScatterND Shape Sigmoid Sin Size Slice
Softmax SpaceToDepth Split Sqrt Squeeze Sub Sum Tanh ThresholdedRelu Tile TopK Transpose Unique Unsqueeze Where
Erf GlobalAveragePool InstanceNormalization HardSigmoid MatMulInteger QLinearConv QLinearMatMul Scan
""".split())
# the package's type reduction keeps float (and int8/uint8); bool and int32/int64 only where indices and shapes need them
TYPES = {onnx.TensorProto.FLOAT, onnx.TensorProto.BOOL, onnx.TensorProto.INT64, onnx.TensorProto.INT32}


def check_operators():
    failures = []
    for stage in STAGES:
        model = onnx.load(str(common.MODELS / f"{stage}.onnx"))
        opsets = {o.domain or "ai.onnx": o.version for o in model.opset_import}
        if set(opsets) != {"ai.onnx"} or opsets["ai.onnx"] > MOBILE_OPSET:
            failures.append(f"{stage}: opset {opsets}")
        ops = {n.op_type for n in model.graph.node}
        domains = {n.domain for n in model.graph.node} - {""}
        if ops - MOBILE_OPS or domains:
            failures.append(f"{stage}: operators outside the mobile set: {sorted(ops - MOBILE_OPS)} {sorted(domains)}")
        inferred = onnx.shape_inference.infer_shapes(model).graph
        types = {v.type.tensor_type.elem_type for v in [*inferred.value_info, *inferred.input, *inferred.output]}
        types |= {t.data_type for t in model.graph.initializer}
        if types - TYPES:
            failures.append(f"{stage}: tensor types outside float/bool/int: {sorted(types - TYPES)}")
        print(f"{stage}.onnx  opset {opsets['ai.onnx']}  {len(model.graph.node)} nodes  ops: {' '.join(sorted(ops))}")
    return failures


def sessions():
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    out = {}
    for stage in STAGES:
        s = ort.InferenceSession(str(common.MODELS / f"{stage}.onnx"), options, providers=["CPUExecutionProvider"])
        assert s.get_providers() == ["CPUExecutionProvider"], s.get_providers()
        out[stage] = s
    return out


def synthesise(run, ids, cw, wstart, noise_for):
    """One piece through the three graphs and the host steps: (audio, word_frames)."""
    h, dur = run["text"].run(None, {"ids": ids[None]})
    word_frames, fw, fp = common.plan(dur[0], cw)
    noise = noise_for(fw.size)
    (latents,) = run["sound"].run(None, {"h": h, "dur": dur, "cw": cw[None], "wstart": wstart[None],
                                         "fw": fw[None], "fp": fp[None], "noise": noise[None]})
    decoder = run["decoder"]
    audio = common.decode(lambda z: decoder.run(None, {"z": z})[0], latents[0])
    return audio, word_frames


def main():
    failures = check_operators()
    vectors = json.loads(common.VECTORS.read_text())
    run = sessions()
    print(f"loaded {', '.join(STAGES)} with {run['text'].get_providers()}, one thread")
    priority = subprocess.run(["ps", "-o", "pri=", "-p", str(os.getpid())], capture_output=True, text=True).stdout.strip()
    print(f"process priority {priority or '?'} (4 = macOS background band, efficiency cores only)")
    warm = np.array(vectors["sentences"][0]["ids"], np.int64)  # first runs allocate; keep them out of the timing
    synthesise(run, warm, *common.words(vectors["sentences"][0]["spoken"]), lambda n: common.noise(0, n))

    spent = spoken = 0.0
    print(f"{'#':>2}  {'seconds':>7}  {'frames':>11}  {'corr':>6}  {'RTF':>5}  text")
    for i, s in enumerate(vectors["sentences"]):
        ids, cw, wstart = (np.array(s[k], np.int64) for k in ("ids", "cw", "wstart"))
        if not all(np.array_equal(a, b) for a, b in zip(common.words(s["spoken"]), (cw, wstart), strict=True)):
            failures.append(f"{i}: common.words disagrees with the vectors' cw/wstart")
        noise = common.noise(s["seed"], s["frames"])
        if common.sha256(noise) != s["noise_sha256"]:
            failures.append(f"{i}: noise hash differs")
        reference = np.load(common.REFERENCE / f"{i:02d}.npy")
        if common.sha256(reference) != s["audio_sha256"]:
            failures.append(f"{i}: reference audio hash differs from vectors.json")

        start = time.perf_counter()
        audio, word_frames = synthesise(run, ids, cw, wstart, lambda n, seed=s["seed"]: common.noise(seed, n))
        took = time.perf_counter() - start
        spent, spoken = spent + took, spoken + audio.size / common.RATE

        frames, ref_frames = audio.size // common.HOP, reference.size // common.HOP
        corr = common.correlation(audio, reference)
        if word_frames.tolist() != s["word_frames"]:
            failures.append(f"{i}: host plan {word_frames.tolist()} != reference {s['word_frames']}")
        if abs(frames - ref_frames) > 1:
            failures.append(f"{i}: {frames} frames vs reference {ref_frames}")
        if not corr > MIN_CORRELATION:
            failures.append(f"{i}: correlation {corr:.4f} <= {MIN_CORRELATION}")
        print(f"{i:2d}  {audio.size / common.RATE:7.2f}  {frames:4d} / {ref_frames:4d}  {corr:6.4f}  "
              f"{took * common.RATE / audio.size:5.3f}  {s['spoken']}")

    speed = spoken / spent
    print(f"total: {spoken:.2f} s of audio in {spent:.2f} s on one CPU thread = {speed:.1f}x real time "
          f"(RTF {spent / spoken:.3f})")
    if speed <= MIN_SPEED:
        failures.append(f"{speed:.1f}x real time is not faster than {MIN_SPEED}x")
    for f in failures:
        print("FAIL", f)
    print("OK" if not failures else f"{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
